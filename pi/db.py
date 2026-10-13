"""Snowflake access for the engine: read anything allowed, write only to the results schema."""
from __future__ import annotations

import csv
import os
import tempfile
from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal

import pandas as pd
import snowflake.connector

from .config import CONFIG, DB, RS


def connect():
    name = os.environ.get("PI_SNOWFLAKE_CONNECTION", CONFIG["connection"])
    return snowflake.connector.connect(
        connection_name=name, database=DB,
        session_parameters={"QUERY_TAG": CONFIG["query_tag"], "STATEMENT_TIMEOUT_IN_SECONDS": 3600,
                            "TIMEZONE": "UTC"})


@contextmanager
def session():
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


def _clean(v):
    if isinstance(v, Decimal):
        return float(v)
    return v


def query_df(conn, sql: str, params=None) -> pd.DataFrame:
    cur = conn.cursor()
    try:
        cur.execute(sql, params)
        cols = [c[0] for c in cur.description]
        rows = cur.fetchall()
        df = pd.DataFrame([[_clean(v) for v in r] for r in rows], columns=cols)
        return df
    finally:
        cur.close()


def execute(conn, sql: str, params=None) -> int:
    cur = conn.cursor()
    try:
        cur.execute(sql, params)
        return cur.rowcount or 0
    finally:
        cur.close()


def _guard(table: str):
    if not table.upper().startswith(RS.upper() + "."):
        raise PermissionError(f"the engine only writes to {RS}; refused {table}")


def replace_rows(conn, table: str, df: pd.DataFrame, where: str | None = None) -> int:
    """Delete (all rows, or rows matching `where`) then insert df, in one transaction. Column names must match."""
    _guard(table)
    execute(conn, "begin")
    try:
        execute(conn, f"delete from {table}" + (f" where {where}" if where else ""))
        n = insert_df(conn, table, df, _in_txn=True)
        execute(conn, "commit")
        return n
    except Exception:
        execute(conn, "rollback")
        raise


def insert_df(conn, table: str, df: pd.DataFrame, _in_txn: bool = False) -> int:
    """Bulk insert via a CSV file PUT to the table stage + COPY (fast, no pandas-version dependency)."""
    _guard(table)
    if df is None or df.empty:
        return 0
    cols = list(df.columns)
    fd, path = tempfile.mkstemp(suffix=".csv", prefix="pi_")
    os.close(fd)
    try:
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f, quoting=csv.QUOTE_MINIMAL)
            for row in df.itertuples(index=False, name=None):
                w.writerow([_csv(v) for v in row])
        parts = table.split(".")
        stage = "@" + ".".join(parts[:-1]) + ".%" + parts[-1]
        execute(conn, f"remove {stage}")
        execute(conn, f"put 'file://{path.replace(os.sep, '/')}' {stage} auto_compress=true overwrite=true")
        execute(conn, f"""copy into {table} ({', '.join(cols)}) from {stage}
            file_format = (type = csv field_optionally_enclosed_by = '"' empty_field_as_null = true null_if = ('\\\\N'))
            purge = true on_error = abort_statement""")
        return len(df)
    finally:
        os.remove(path)


def _csv(v):
    if v is None:
        return "\\N"
    if isinstance(v, float) and v != v:
        return "\\N"
    if isinstance(v, (datetime, pd.Timestamp)):
        return "\\N" if pd.isna(v) else v.isoformat(sep=" ")
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (dict, list)):
        import json
        return json.dumps(v, default=str)
    return v
