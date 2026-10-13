"""Layer 4a - how tables connect, without anyone supplying lineage:
  observed  - Snowflake ACCESS_HISTORY: which tables each load read and wrote (temp tables collapsed, excluded schemas dropped)
  inferred  - foreign keys from key-column names, validated by containment against the data
  replicas  - a table copied into another (source system -> warehouse) is 'superseded' so KPIs are defined once."""
from __future__ import annotations

import json
import re
from datetime import datetime

import pandas as pd

from .config import DB, RS, overrides, schema_allowed
from .db import query_df, replace_rows, session


def observed(conn, catalog_fqns: set[str]) -> pd.DataFrame:
    df = query_df(conn, f"""
        select src.value:"objectName"::string as src, tgt.value:"objectName"::string as tgt,
               count(distinct ah.query_id) as n, max(ah.query_start_time) as last_seen
        from snowflake.account_usage.access_history ah,
             lateral flatten(input => ah.base_objects_accessed) src,
             lateral flatten(input => ah.objects_modified) tgt
        where ah.query_start_time >= dateadd(day, -365, current_timestamp())
          and tgt.value:"objectName"::string ilike '{DB}.%' and src.value:"objectName"::string ilike '{DB}.%'
          and src.value:"objectName"::string <> tgt.value:"objectName"::string
        group by 1, 2""")
    if df.empty:
        return df
    df["SRC"] = df.SRC.str.upper()
    df["TGT"] = df.TGT.str.upper()
    sch = lambda f: f.split(".")[1]
    df = df[df.SRC.map(lambda f: schema_allowed(sch(f))) & df.TGT.map(lambda f: schema_allowed(sch(f)))]
    # collapse intermediates that are not catalog tables (temp / dropped work tables): A -> T -> B becomes A -> B
    known = {f.upper() for f in catalog_fqns}
    edges = {(r.SRC, r.TGT): (int(r.N), r.LAST_SEEN) for r in df.itertuples()}
    for _ in range(3):
        mids = {t for (_, t) in edges if t not in known} | {s for (s, _) in edges if s not in known}
        if not mids:
            break
        for m in mids:
            ins = [(s, v) for (s, t), v in edges.items() if t == m]
            outs = [(t, v) for (s, t), v in edges.items() if s == m]
            for s, v1 in ins:
                for t, v2 in outs:
                    if s != t:
                        edges[(s, t)] = (min(v1[0], v2[0]), max(v1[1], v2[1]))
            edges = {k: v for k, v in edges.items() if m not in k}
    out = []
    for (s, t), v in edges.items():
        if s not in known or t not in known:
            continue
        rev = edges.get((t, s))
        if rev and rev[0] > v[0]:
            continue                              # a reverse one-time copy (e.g. a history backfill) of a recurring load
        out.append({"SRC": s, "TGT": t, "N": v[0], "LAST_SEEN": v[1], "ONE_OFF": v[0] <= 1})
    return pd.DataFrame(out)


def _candidates(tables: pd.DataFrame, cols: pd.DataFrame) -> list[dict]:
    """child column -> parent key candidates (same schema), generated from names only."""
    parents = {}                                   # (schema, key column) -> parent table fqn
    for r in tables.itertuples():
        if isinstance(r.PRIMARY_KEY, str) and r.TABLE_ROLE not in ("mart", "audit"):
            parents.setdefault((r.SCHEMA_NAME, r.PRIMARY_KEY.upper()), []).append(r.TABLE_FQN)
    for r in tables[tables.TABLE_ROLE == "reference"].itertuples():   # code lookups: first column of a REF table
        c0 = cols[cols.TABLE_FQN == r.TABLE_FQN].sort_values("ORDINAL").COLUMN_NAME.iloc[0].upper()
        parents.setdefault((r.SCHEMA_NAME, c0), []).append(r.TABLE_FQN)
    out = []
    keyish = cols[cols.ROLE.isin(["key", "category", "text_id"]) | cols.COLUMN_NAME.str.upper().str.endswith(("_ID", "_CODE", "_KEY"))]
    for r in keyish.itertuples():
        schema = r.TABLE_FQN.split(".")[1]
        name = r.COLUMN_NAME.upper()
        for (s, key), pfqns in parents.items():
            if s != schema or not (name == key or name.endswith("_" + key)):
                continue
            for p in pfqns:
                if p == r.TABLE_FQN and name == key:
                    continue                       # a table's own key; ORIGINAL_CLAIM_ID -> CLAIM_ID (self reference) is kept
                if name == key and tables.set_index("TABLE_FQN").PRIMARY_KEY.get(r.TABLE_FQN, "") == name \
                        and tables.set_index("TABLE_FQN").TABLE_ROLE.get(r.TABLE_FQN) != "reference":
                    pass                           # both tables keyed on it: 1:1 extension, still worth validating
                out.append({"child": r.TABLE_FQN, "child_col": r.COLUMN_NAME, "parent": p, "parent_col": key})
    return out


def validate(conn, cands: list[dict]) -> pd.DataFrame:
    rows = []
    for i in range(0, len(cands), 12):
        batch = cands[i:i + 12]
        parts = []
        for j, c in enumerate(batch):
            parts.append(f"""select {i + j} as idx, count(c."{c['child_col']}") as child_non_null,
                count_if(c."{c['child_col']}" is not null and p.k is null) as orphans,
                approx_count_distinct(c."{c['child_col']}") as child_distinct
              from {c['child']} c left join (select distinct "{c['parent_col']}" as k from {c['parent']}) p
                on p.k = c."{c['child_col']}" """)
        df = query_df(conn, " union all ".join(parts))
        rows.append(df)
    res = pd.concat(rows, ignore_index=True) if rows else pd.DataFrame()
    out = []
    for r in res.itertuples():
        c = cands[int(r.IDX)]
        nn = int(r.CHILD_NON_NULL or 0)
        cont = 1 - (int(r.ORPHANS or 0) / nn) if nn else None
        out.append({**c, "child_non_null": nn, "orphans": int(r.ORPHANS or 0), "containment": cont,
                    "child_distinct": int(r.CHILD_DISTINCT or 0)})
    return pd.DataFrame(out)


def run() -> dict:
    now = datetime.utcnow()
    with session() as conn:
        tables = query_df(conn, f"select * from {RS}.PI_TABLE")
        cols = query_df(conn, f"select * from {RS}.PI_COLUMN")
        obs = observed(conn, set(tables.TABLE_FQN))
        cands = _candidates(tables, cols)
        val = validate(conn, cands) if cands else pd.DataFrame()

    edges = []
    for r in obs.itertuples():
        edges.append({"EDGE_ID": f"flow:{r.SRC}>{r.TGT}", "KIND": "data_flow", "FROM_NODE": r.SRC, "TO_NODE": r.TGT,
                      "FROM_COLUMN": None, "TO_COLUMN": None, "SOURCE": "access_history",
                      "CONFIDENCE": "low" if r.ONE_OFF else "high",                 # seen once: a one-time copy
                      "STRENGTH": float(r.N), "LAG_DAYS": None,
                      "EVIDENCE": json.dumps({"loads_seen": int(r.N), "last_seen": str(r.LAST_SEEN)})})
    fk_rejected = 0
    for r in val.itertuples() if len(val) else []:
        if r.child_non_null == 0 or r.containment is None:
            continue
        if r.containment >= 0.99:
            conf, status = "high", "validated"
        elif r.containment >= 0.90:
            conf, status = "medium", "validated_with_orphans"
        else:
            fk_rejected += 1
            continue
        # edge direction for impact: parent (referenced) -> child (dependent)
        edges.append({"EDGE_ID": f"fk:{r.child}.{r.child_col}>{r.parent}.{r.parent_col}", "KIND": "foreign_key",
                      "FROM_NODE": r.parent, "TO_NODE": r.child, "FROM_COLUMN": r.parent_col, "TO_COLUMN": r.child_col,
                      "SOURCE": "inferred", "CONFIDENCE": conf, "STRENGTH": float(r.containment), "LAG_DAYS": None,
                      "EVIDENCE": json.dumps({"status": status, "child_non_null": r.child_non_null,
                                              "orphans": r.orphans, "containment": round(r.containment, 5)})})
    for e in (overrides().get("edges") or []):           # profiler-confirmed edges the data can't show
        edges.append({"EDGE_ID": e.get("id") or f"manual:{e['from']}>{e['to']}", "KIND": e.get("kind", "data_flow"),
                      "FROM_NODE": e["from"].upper(), "TO_NODE": e["to"].upper(), "FROM_COLUMN": e.get("from_column"),
                      "TO_COLUMN": e.get("to_column"), "SOURCE": "profiler", "CONFIDENCE": e.get("confidence", "medium"),
                      "STRENGTH": None, "LAG_DAYS": None, "EVIDENCE": json.dumps({"note": e.get("note")})})
    edf = pd.DataFrame(edges)
    edf["UPDATED_TS"] = now

    # replicas: a data_flow target that carries most of the source's columns supersedes it for KPI purposes
    colsets = cols.groupby("TABLE_FQN").COLUMN_NAME.apply(lambda s: set(s.str.upper()))
    sup = {}
    for r in obs.itertuples():
        if r.ONE_OFF:
            continue
        a, b = colsets.get(r.SRC, set()), colsets.get(r.TGT, set())
        if a and len(a & b) / len(a) >= 0.6:
            sup[r.SRC] = r.TGT
    if not len(obs):                                   # no recorded lineage: fall back to look-alike tables across schemas
        for a in tables.itertuples():
            for b in tables.itertuples():
                if a.SCHEMA_NAME != b.SCHEMA_NAME and a.TABLE_FQN not in sup:
                    ca, cb = colsets.get(a.TABLE_FQN, set()), colsets.get(b.TABLE_FQN, set())
                    if ca and len(ca & cb) / len(ca) >= 0.85 and b.ROW_COUNT and \
                            abs((a.ROW_COUNT or 0) - b.ROW_COUNT) / b.ROW_COUNT < 0.1 and b.SCHEMA_NAME == "MAIN":
                        sup[a.TABLE_FQN] = b.TABLE_FQN
    ov_t = overrides().get("tables") or {}
    tables["SUPERSEDED_BY"] = tables.TABLE_FQN.map(sup)
    for fqn, o in ov_t.items():
        if "superseded_by" in o:
            tables.loc[tables.TABLE_FQN.str.upper() == fqn.upper(), "SUPERSEDED_BY"] = o["superseded_by"]
    tables["IS_KPI_SOURCE"] = tables.TABLE_ROLE.isin(["fact", "span", "mart"]) & tables.SUPERSEDED_BY.isna()
    for fqn, o in ov_t.items():
        if "kpi_source" in o:
            tables.loc[tables.TABLE_FQN.str.upper() == fqn.upper(), "IS_KPI_SOURCE"] = bool(o["kpi_source"])
    with session() as conn:
        replace_rows(conn, f"{RS}.PI_EDGE", edf, where="KIND in ('data_flow','foreign_key')")
        replace_rows(conn, f"{RS}.PI_TABLE", tables)
    return {"observed_flows": int((edf.KIND == "data_flow").sum()), "foreign_keys": int((edf.KIND == "foreign_key").sum()),
            "fk_rejected": fk_rejected, "superseded": len(sup), "kpi_sources": int(tables.IS_KPI_SOURCE.sum())}
