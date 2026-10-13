"""Layer 1 - understand every table: metadata, one profile query per table, column roles, date roles, grain,
table role and a suggested owning department. Unchanged tables (same fingerprint) are not re-scanned."""
from __future__ import annotations

import hashlib
import json
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import pandas as pd

from .config import CONFIG, DB, RS, as_of, overrides, table_allowed
from .db import query_df, replace_rows, session

C = CONFIG["catalog"]

MONEY = ("AMOUNT", "PAID", "BILLED", "ALLOWED", "PREMIUM", "COST", "CHARGE", "PRICE", "FEE", "COPAY", "COINSURANCE",
         "DEDUCTIBLE", "REVENUE", "CONTRIBUTION", "CAPITATION", "SUBSIDY", "TRANSFER", "GAIN_LOSS", "BALANCE")
NOT_MONEY = ("PCT", "RATIO", "RATE", "PMPM", "INDEX", "FACTOR", "PER_", "_PER", "WEIGHT", "SCORE", "PERCENTILE")
COUNTISH = ("COUNT", "QUANTITY", "UNITS", "DAYS", "MONTHS", "VISITS", "LOS", "SCRIPT", "LIVES", "NUMBER_OF")
DATE_ROLES = [  # (role, name patterns) - first match wins
    ("birth", ("BIRTH",)),
    ("technical", ("CREATED_TS", "UPDATED_TS", "_TS", "EVALUATION", "LOAD_")),
    ("due", ("DUE", "NEXT_REVIEW")),
    ("end", ("TERMINATION", "END_DATE", "_TO_DATE", "THRU", "PAID_THROUGH", "MONTH_END")),
    ("payment", ("PAYMENT_DATE", "PAID_DATE", "CHECK")),
    ("decision", ("ADJUDICAT", "DECISION", "RESOLUTION", "STATUS_DATE", "INFO_RECEIVED")),
    ("event", ("SERVICE", "FILL", "VISIT", "ADMIT", "DISPENS", "INCURRED")),
    ("arrival", ("RECEIVED", "SUBMISSION", "REQUEST", "FILED", "POSTED", "RECORD_CREATED", "INFO_REQUESTED")),
    ("period", ("COVERAGE_MONTH", "MONTH_START", "YEAR_MONTH", "AS_OF")),
    ("start", ("EFFECTIVE", "START", "FROM_DATE", "ENROLLMENT_DATE", "ORIGINAL_EFFECTIVE")),
]
DEPARTMENTS = {  # keyword -> department; scored on table-name tokens (head noun weighs most) and lightly on columns
    "Claims Operations": ("CLAIM", "ADJUDICAT", "DENIAL", "LINE", "DIAGNOSIS", "HEADER", "PEND"),
    "Finance": ("PREMIUM", "PAYMENT", "PMPM", "REVENUE", "COST", "LOSS", "BILLING", "PAID"),
    "Enrollment & Eligibility": ("ELIGIBILITY", "SUBSCRIBER", "ENROLL", "MEMBER_MONTH", "COVERAGE", "GROUP", "MEMBER"),
    "Pharmacy": ("PHARMACY", "DRUG", "RX", "NDC", "THERAPEUTIC", "FORMULARY"),
    "Provider Network": ("PROVIDER", "NETWORK", "CONTRACT", "NPI", "LOCATION"),
    "Utilization Management": ("AUTHORIZATION", "ENCOUNTER", "UTILIZATION", "ADMIT", "READMISSION", "AUTH"),
    "Appeals & Grievances": ("APPEAL", "GRIEVANCE"),
    "Care Management": ("HEALTH_PROFILE", "RISK", "CHRONIC", "COHORT"),
    "Product & Benefits": ("PLAN", "PRODUCT", "BENEFIT"),
    "Data Platform": ("AUDIT", "LOAD", "DQ_", "SOURCE_SYSTEM", "REF_DATE"),
}


# ---------------------------------------------------------------------------------------------------- metadata
def metadata(conn) -> tuple[pd.DataFrame, pd.DataFrame]:
    t = query_df(conn, f"""select table_schema, table_name, table_type, row_count, bytes, last_altered, comment
        from {DB}.information_schema.tables where table_type in ('BASE TABLE','VIEW','MATERIALIZED VIEW')""")
    t = t[[table_allowed(s, n) for s, n in zip(t.TABLE_SCHEMA, t.TABLE_NAME)]].copy()
    c = query_df(conn, f"""select table_schema, table_name, column_name, ordinal_position, data_type, comment
        from {DB}.information_schema.columns order by 1, 2, 4""")
    keep = set(zip(t.TABLE_SCHEMA, t.TABLE_NAME))
    c = c[[k in keep for k in zip(c.TABLE_SCHEMA, c.TABLE_NAME)]].copy()
    t["TABLE_FQN"] = DB + "." + t.TABLE_SCHEMA + "." + t.TABLE_NAME
    c["TABLE_FQN"] = DB + "." + c.TABLE_SCHEMA + "." + c.TABLE_NAME
    colsig = c.groupby("TABLE_FQN").apply(lambda g: "|".join(g.COLUMN_NAME + ":" + g.DATA_TYPE), include_groups=False)
    t["FINGERPRINT"] = [hashlib.md5(f"{r.ROW_COUNT}|{r.LAST_ALTERED}|{colsig.get(r.TABLE_FQN, '')}".encode()).hexdigest()
                        for r in t.itertuples()]
    return t, c


def _kind(dt: str) -> str:
    dt = dt.upper()
    if dt in ("NUMBER", "FLOAT", "DECIMAL", "INTEGER", "REAL", "DOUBLE"):
        return "num"
    if dt == "DATE" or dt.startswith("TIMESTAMP"):
        return "date"
    if dt == "BOOLEAN":
        return "bool"
    if dt in ("TEXT", "VARCHAR", "STRING", "CHAR"):
        return "text"
    return "other"


def _q(col: str) -> str:
    return '"' + col.replace('"', '""') + '"'


# ---------------------------------------------------------------------------------------------------- profiling
def profile_table(conn, fqn: str, cols: pd.DataFrame, today) -> pd.DataFrame:
    """One query for counts / distinct / min / max / future share, a second for top values of low-cardinality text."""
    parts = ["count(*) as \"__N\""]
    for i, r in enumerate(cols.itertuples()):
        k, q = _kind(r.DATA_TYPE), _q(r.COLUMN_NAME)
        parts.append(f"count({q}) as c{i}_nn")
        parts.append(f"approx_count_distinct({q}) as c{i}_nd")
        if k in ("num", "date"):
            parts.append(f"min({q})::varchar as c{i}_mn")
            parts.append(f"max({q})::varchar as c{i}_mx")
        if k == "date":
            parts.append(f"count_if({q}::date > '{today}') as c{i}_fut")
        if k == "bool":
            parts.append(f"count_if({q}) as c{i}_tr")
        if k == "text":
            parts.append(f"min(length({q})) as c{i}_ln0")
            parts.append(f"max(length({q})) as c{i}_ln1")
    row = query_df(conn, f"select {', '.join(parts)} from {fqn}").iloc[0]
    n = int(row["__N"] or 0)
    out = []
    for i, r in enumerate(cols.itertuples()):
        g = lambda s: row.get(f"C{i}_{s}".upper())
        out.append({"TABLE_FQN": fqn, "COLUMN_NAME": r.COLUMN_NAME, "ORDINAL": int(r.ORDINAL_POSITION),
                    "DATA_TYPE": r.DATA_TYPE, "KIND": _kind(r.DATA_TYPE), "N": n,
                    "NON_NULL": int(g("nn") or 0), "DISTINCT_APPROX": int(g("nd") or 0),
                    "MIN_VALUE": g("mn"), "MAX_VALUE": g("mx"),
                    "FUTURE_SHARE": (float(g("fut") or 0) / max(int(g("nn") or 0), 1)) if _kind(r.DATA_TYPE) == "date" else None,
                    "TRUE_SHARE": (float(g("tr") or 0) / max(int(g("nn") or 0), 1)) if _kind(r.DATA_TYPE) == "bool" else None,
                    "MAXLEN": g("ln1")})
    prof = pd.DataFrame(out)
    low = prof[(prof.KIND == "text") & (prof.DISTINCT_APPROX.between(1, C["category_max_distinct"] * 2))]
    tops = {}
    if len(low):
        sel = ", ".join(f"approx_top_k({_q(c)}, {C['top_values']}, 200) as t{i}" for i, c in enumerate(low.COLUMN_NAME))
        tr = query_df(conn, f"select {sel} from {fqn}").iloc[0]
        for i, c in enumerate(low.COLUMN_NAME):
            v = tr[f"T{i}"]
            tops[c] = json.loads(v) if isinstance(v, str) else v
    prof["TOP_VALUES"] = [json.dumps(tops.get(c)) if c in tops else None for c in prof.COLUMN_NAME]
    return prof


# ---------------------------------------------------------------------------------------------------- roles
def column_role(p: dict, table: str) -> tuple[str, str | None]:
    name, kind = p["COLUMN_NAME"].upper(), p["KIND"]
    n, nn, nd = p["N"], p["NON_NULL"], p["DISTINCT_APPROX"]
    if name in ("LAST_UPDATED_BY", "CREATED_BY", "SOURCE_BATCH_ID", "UPDATED_BY", "ACTION_BY") or name.startswith("LOAD_"):
        return "technical", None                  # audit columns: who/which batch wrote the row, not business facts
    if kind == "date" or (kind == "text" and re.search(r"(_DATE|YEAR_MONTH)$", name) and (p.get("MAXLEN") or 0) <= 10):
        for role, pats in DATE_ROLES:
            if any(s in name for s in pats):
                return "date", role
        return "date", "other"
    if nn == 0:
        return "empty", None
    if kind == "num" and name in ("CALENDAR_YEAR",) or name.endswith("_YEAR") and kind == "num":
        return "period_part", "year"
    if kind == "num" and name in ("CALENDAR_MONTH", "RENEWAL_MONTH", "DAY_OF_MONTH"):
        return "period_part", "month"
    if kind == "bool" or (name.startswith("IS_") or name.endswith("_FLAG")):
        return "flag", None
    is_key = bool(re.search(r"(_ID|_KEY|_NUMBER|_NPI|_CODE|_SEQ|_SEQUENCE|ZIP|_LAST4|PHONE)$", name)) or name in ("NPI", "ID")
    if kind == "num" and not is_key:
        if any(s in name for s in MONEY) and not any(s in name for s in NOT_MONEY):
            return "money", None
        if any(s in name for s in NOT_MONEY):
            return "ratio", None
        if any(s in name for s in COUNTISH) or nd > 2:
            return "measure", None
        return "other", None
    if is_key:
        if name.endswith("_CODE") and kind == "text" and 2 <= nd <= C["category_max_distinct"]:
            return "category", None             # small code sets read as business categories
        return "key", None
    if kind == "text":
        if any(s in name for s in ("STATUS", "DECISION", "OUTCOME", "STATE_")) and 2 <= nd <= C["status_max_distinct"] \
                and not name.endswith("_STATE"):
            return "status", None
        if 2 <= nd <= C["category_max_distinct"]:
            return "category", None
        if nd >= 0.9 * nn:
            return "text_id", None
        return "text", None
    return "other", None


def table_role(name: str, roles: pd.DataFrame, n: int) -> str:
    u = name.upper()
    has_date = (roles.ROLE == "date").any()
    has_measure = roles.ROLE.isin(["money", "measure"]).any()
    if u.startswith(("REF_",)):
        return "reference"
    if u.startswith(("MART_", "AGG_")) or "SUMMARY" in u or "PER_1000" in u:
        return "mart"
    if u.startswith(("AUDIT", "DQ_")) or u.endswith("_LOG"):
        return "audit"
    if u.startswith("BRIDGE_"):
        return "bridge"
    if u.startswith("DIM_"):
        return "dimension"
    dr = set(roles.DATE_ROLE.dropna())
    if {"start", "end"} <= dr and not (dr & {"event", "payment", "decision", "period"}):
        return "span"                           # rows valid from a start to an end date (coverage, contracts)
    has_status = roles.ROLE.isin(["status"]).any()
    has_money = roles.ROLE.isin(["money"]).any()
    # a fact records business events: it has an event / decision / payment / period date, or money moving
    if has_date and (has_measure or has_status) and (dr & {"event", "payment", "decision", "period"} or
                                                     (has_money and dr & {"arrival", "start"})):
        return "fact"
    return "dimension" if not has_measure else "other"


def department(name: str, colnames: list[str]) -> tuple[str, dict]:
    toks = [t for t in re.split(r"_", name.upper()) if t not in ("FACT", "DIM", "MART", "BRIDGE", "REF", "MAIN")]
    scores: dict[str, float] = {}
    joined = "_".join(toks)
    generic = {"CLAIM", "MEMBER", "PLAN", "LINE", "GROUP"}
    for dep, keys in DEPARTMENTS.items():
        s = 0.0
        for k in keys:
            if "_" in k and k in joined:
                s += 4
            for i, t in enumerate(toks):
                if t.startswith(k) or k == t:
                    s += (1 if k in generic else 3) + 0.5 * i   # head noun ("CLAIM_PAYMENT" is about payments)
            s += 0.1 * sum(1 for c in colnames if k in c.upper())
        scores[dep] = round(s, 2)
    best = max(scores, key=scores.get)
    return best, scores


def grain(prof: pd.DataFrame, table: str) -> tuple[str | None, str]:
    n = int(prof.N.iloc[0]) if len(prof) else 0
    keys = prof[(prof.ROLE.isin(["key", "text_id"])) & (prof.NON_NULL == n)]
    uniq = keys[keys.DISTINCT_APPROX >= 0.97 * n]
    if len(uniq):
        pk = sorted(uniq.COLUMN_NAME, key=lambda c: (not c.upper().endswith("_ID"), prof.set_index("COLUMN_NAME").ORDINAL[c]))[0]
        ent = re.sub(r"_(ID|KEY|NUMBER)$", "", pk.upper()).replace("_", " ").lower()
        return pk, f"one row per {ent}"
    return None, "no single-column key (aggregate or history table)"


def pick_dates(prof: pd.DataFrame) -> tuple[str | None, str | None]:
    d = prof[(prof.ROLE == "date") & (prof.NON_NULL >= 0.5 * prof.N.clip(lower=1))]
    order = ["event", "period", "arrival", "decision", "payment", "start"]
    d = d.assign(_txt=(d.DATA_TYPE.str.upper() == "TEXT").astype(int),
                 _rcv=(~d.COLUMN_NAME.str.upper().str.contains("RECEIVED")).astype(int))
    ev = None
    for role in order:
        c = d[d.DATE_ROLE == role]
        if len(c):
            ev = c.sort_values(["_txt", "ORDINAL"]).COLUMN_NAME.iloc[0]
            break
    arr = d[d.DATE_ROLE == "arrival"]
    arrival = arr.sort_values(["_rcv", "ORDINAL"]).COLUMN_NAME.iloc[0] if len(arr) else None   # payer receipt first
    if arrival == ev:
        arrival = None
    return ev, arrival


# ---------------------------------------------------------------------------------------------------- run
def _d10(v):
    if v is None or (isinstance(v, float) and v != v):
        return None
    v = str(v)[:10]
    return v if re.match(r"\d{4}-\d{2}-\d{2}$", v) else None


def run(force: bool = False) -> dict:
    today = as_of()
    with session() as conn:
        tables, cols = metadata(conn)
        try:
            prior = query_df(conn, f"select TABLE_FQN, FINGERPRINT from {RS}.PI_TABLE")
            prior_cols = query_df(conn, f"select * from {RS}.PI_COLUMN")
        except Exception:
            prior, prior_cols = pd.DataFrame(columns=["TABLE_FQN", "FINGERPRINT"]), pd.DataFrame()
    prior_fp = dict(zip(prior.TABLE_FQN, prior.FINGERPRINT))
    todo = [r for r in tables.itertuples() if force or prior_fp.get(r.TABLE_FQN) != r.FINGERPRINT]
    reused = [r.TABLE_FQN for r in tables.itertuples() if r not in todo]

    def work(rows):
        res = []
        with session() as c2:
            for r in rows:
                res.append(profile_table(c2, r.TABLE_FQN, cols[cols.TABLE_FQN == r.TABLE_FQN], today))
        return res

    chunks = [todo[i::4] for i in range(4)]
    profs = []
    with ThreadPoolExecutor(4) as ex:
        for res in ex.map(work, chunks):
            profs.extend(res)
    new_prof = pd.concat(profs, ignore_index=True) if profs else pd.DataFrame()
    if len(prior_cols) and reused:                      # carry unchanged tables' profiles forward
        old = prior_cols[prior_cols.TABLE_FQN.isin(reused)].copy()
        old["KIND"] = old.DATA_TYPE.map(_kind)
        nmap = dict(zip(tables.TABLE_FQN, tables.ROW_COUNT))
        old["N"] = old.TABLE_FQN.map(nmap).fillna(0).astype(int)
        old["TRUE_SHARE"] = None
        old["MAXLEN"] = None
        new_prof = pd.concat([new_prof, old.drop(columns=[c for c in ("ROLE", "DATE_ROLE", "PROFILED_TS") if c in old])],
                             ignore_index=True)
    rr = [column_role(p, p["TABLE_FQN"]) for p in new_prof.to_dict("records")]
    new_prof["ROLE"] = [r[0] for r in rr]
    new_prof["DATE_ROLE"] = [r[1] for r in rr]
    ov = overrides()
    for (fqn, col), v in ((tuple(k.rsplit(".", 1)), v) for k, v in (ov.get("columns") or {}).items()):
        m = (new_prof.TABLE_FQN.str.upper() == fqn.upper()) & (new_prof.COLUMN_NAME.str.upper() == col.upper())
        for fld in ("ROLE", "DATE_ROLE"):
            if fld.lower() in v:
                new_prof.loc[m, fld] = v[fld.lower()]

    trows = []
    tov = ov.get("tables") or {}
    for r in tables.itertuples():
        p = new_prof[new_prof.TABLE_FQN == r.TABLE_FQN].sort_values("ORDINAL")
        role = table_role(r.TABLE_NAME, p, int(r.ROW_COUNT or 0))
        pk, gdesc = grain(p, r.TABLE_NAME)
        dep, scores = department(r.TABLE_NAME, list(p.COLUMN_NAME))
        ev, arr = pick_dates(p)
        o = tov.get(r.TABLE_FQN) or tov.get(f"{r.TABLE_SCHEMA}.{r.TABLE_NAME}") or {}
        ev = o.get("event_date", ev)
        arr = o.get("arrival_date", arr)
        evp = p[p.COLUMN_NAME == ev] if ev else p.iloc[0:0]
        trows.append({
            "TABLE_FQN": r.TABLE_FQN, "SCHEMA_NAME": r.TABLE_SCHEMA, "TABLE_NAME": r.TABLE_NAME,
            "ROW_COUNT": int(r.ROW_COUNT or 0), "BYTES": int(r.BYTES or 0), "LAST_ALTERED": r.LAST_ALTERED,
            "FINGERPRINT": r.FINGERPRINT, "TABLE_ROLE": o.get("role", role), "GRAIN": gdesc, "PRIMARY_KEY": pk,
            "BUSINESS_NAME": o.get("business_name", r.TABLE_NAME.replace("_", " ").title()),
            "DESCRIPTION": o.get("description", r.COMMENT), "DEPARTMENT": o.get("department", dep),
            "DEPARTMENT_SCORES": json.dumps(scores), "EVENT_DATE": ev, "ARRIVAL_DATE": arr,
            "DATE_ROLES": json.dumps({c: dr for c, dr in zip(p.COLUMN_NAME, p.DATE_ROLE) if dr}),
            "SUPERSEDED_BY": None, "IS_KPI_SOURCE": None,
            "MIN_EVENT_DATE": _d10(evp.MIN_VALUE.iloc[0]) if len(evp) else None,
            "MAX_EVENT_DATE": _d10(evp.MAX_VALUE.iloc[0]) if len(evp) else None,
            "NOTES": o.get("notes"), "PROFILED_TS": datetime.utcnow()})
    tdf = pd.DataFrame(trows)
    cdf = new_prof[["TABLE_FQN", "COLUMN_NAME", "ORDINAL", "DATA_TYPE", "ROLE", "DATE_ROLE", "NON_NULL", "DISTINCT_APPROX",
                    "MIN_VALUE", "MAX_VALUE", "FUTURE_SHARE", "TOP_VALUES"]].copy()
    cdf["PROFILED_TS"] = datetime.utcnow()
    with session() as conn:
        replace_rows(conn, f"{RS}.PI_COLUMN", cdf)
        replace_rows(conn, f"{RS}.PI_TABLE", tdf)
    return {"tables": len(tdf), "profiled": len(todo), "reused": len(reused), "columns": len(cdf)}


def load(conn) -> tuple[pd.DataFrame, pd.DataFrame]:
    t = query_df(conn, f"select * from {RS}.PI_TABLE")
    c = query_df(conn, f"select * from {RS}.PI_COLUMN")
    return t, c
