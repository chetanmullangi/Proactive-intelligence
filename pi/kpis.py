"""Layer 0 + KPI discovery.

KPIs are generated from the catalog - never a fixed list:
  count     rows per day                                (claims received, appeals filed ...)
  sum       money / count-like measures per day          (paid, billed, premium, member months ...)
  rate      share of rows with a status value or a flag  (denial rate, reversal rate, timely-decision rate ...)
  avg       average of a non-money measure               (length of stay, days supply ...)
  turnaround average days between two business dates    (received -> decided, received -> paid ...)
  active / starts / ends   for span tables              (members covered, groups joining, contracts ending ...)

Every KPI is stored as a daily numerator / denominator (PI_KPI_DAILY), plus breakdowns by business dimension for
the last ~2 years (PI_KPI_DAILY_DIM). Weeks, months, quarters and years are sums of days, so the analysis never
re-reads raw rows. Daily maintenance is incremental: only a trailing restatement window (sized from how late rows
really arrive) is re-aggregated; a weekly reconciliation against the raw table triggers a rebuild if totals drift.
All aggregation runs inside Snowflake (INSERT ... SELECT); nothing row-level comes back to Python."""
from __future__ import annotations

import hashlib
import json
import re
from datetime import date, datetime, timedelta

import pandas as pd

from .config import CONFIG, OUT, RS, as_of, overrides
from .db import execute, query_df, replace_rows, session

K = CONFIG["kpis"]
INC = CONFIG["incremental"]
BAD = ("DENI", "REJECT", "REVERS", "CANCEL", "TERMIN", "UPHELD", "DISMISS", "WITHDRAW", "PEND", "OVERTURN", "VOID",
       "FAIL", "LATE", "DUPLICATE", "ERROR", "SUSPEND", "PARTIAL", "EXPIRED", "INVALID", "READMISSION")
GOOD = ("TIMELY", "VALID", "APPROVED", "PAID", "ACTIVE", "RESOLVED")
IN_PROGRESS = ("PEND", "PENDING", "IN_REVIEW", "OPEN", "SUBMITTED", "RECEIVED", "IN_PROCESS")   # judged by receipt date
MONEY_PRIORITY = ("PLAN_PAID", "PAID", "ALLOWED", "PREMIUM", "BILLED", "COST", "REVENUE", "AMOUNT")
DIM_PRIORITY = ("TYPE", "CATEGORY", "SEGMENT", "REASON", "CLASS", "CHANNEL", "STATE", "TIER", "NETWORK", "SETTING",
                "PRODUCT", "COVERAGE", "STATUS", "LEVEL", "SUBJECT", "PRIORITY", "PATH", "SOURCE", "SPECIALTY", "GENERIC")
ENTITY_KEYS = ("PROVIDER", "GROUP", "PLAN", "DRUG", "NETWORK", "PRODUCT")    # high-cardinality keys worth breaking down by


def _q(c):
    return '"' + c + '"'


def _words(c: str) -> str:
    return re.sub(r"\b(AMOUNT|FLAG|IS|CODE|DATE)\b", "", c.replace("_", " ")).strip().lower()


def _date_expr(t: dict, cols: pd.DataFrame) -> str | None:
    ev = t.get("EVENT_DATE")
    if isinstance(ev, str) and ev:
        dt = cols.set_index("COLUMN_NAME").DATA_TYPE.get(ev, "DATE")
        if dt.upper() == "TEXT":
            return f"try_to_date({_q(ev)} || '-01')" if "MONTH" in ev.upper() else f"try_to_date({_q(ev)})"
        return f"{_q(ev)}::date"
    names = set(cols.COLUMN_NAME.str.upper())
    if "CALENDAR_YEAR" in names and "CALENDAR_MONTH" in names:
        return 'date_from_parts("CALENDAR_YEAR", "CALENDAR_MONTH", 1)'
    if "CALENDAR_YEAR" in names:
        return 'date_from_parts("CALENDAR_YEAR", 1, 1)'
    return None


def _rank(name: str, pri) -> int:
    u = name.upper()
    for i, p in enumerate(pri):
        if p in u:
            return i
    return len(pri)


# ---------------------------------------------------------------------------------------------------- discovery
def discover(tables: pd.DataFrame, cols: pd.DataFrame, edges: pd.DataFrame) -> list[dict]:
    ov = overrides()
    kov = ov.get("kpis") or {}
    out = []
    tmeta = tables.set_index("TABLE_FQN")
    for t in tables[tables.IS_KPI_SOURCE == True].to_dict("records"):  # noqa: E712
        fqn = t["TABLE_FQN"]
        c = cols[cols.TABLE_FQN == fqn].sort_values("ORDINAL")
        label = (t.get("BUSINESS_NAME") or t["TABLE_NAME"].title()).lower()
        role = t["TABLE_ROLE"]
        dims = _dims(t, c, tables, cols, edges)
        common = {"TABLE_FQN": fqn, "DEPARTMENT": t.get("DEPARTMENT"), "DIMENSIONS": dims, "ROW_FILTER": None,
                  "FROM_SQL": fqn}
        money = c[c.ROLE == "money"].copy()
        money = money.assign(r=money.COLUMN_NAME.map(lambda n: _rank(n, MONEY_PRIORITY))).sort_values(["r", "ORDINAL"])
        money = money.head(K["max_money_per_table"])
        if role == "span":
            out += _span_kpis(t, c, label, common)
            continue
        dexpr = _date_expr(t, c)
        if not dexpr:
            continue
        base = {**common, "DATE_EXPR": dexpr}
        is_mart = role == "mart"
        if not is_mart:
            out.append({**base, "KIND": "count", "KPI_ID": f"{fqn}.count".lower(), "NUM_EXPR": "1", "DEN_EXPR": None,
                        "UNIT": "count", "ADDITIVE": True, "BUSINESS_NAME": f"Number of {label}",
                        "DESCRIPTION": f"How many {label} records there are per day, by {t.get('EVENT_DATE')}.",
                        "DIRECTION_GOOD": "neutral"})
        for m in money.itertuples():
            out.append({**base, "KIND": "sum", "KPI_ID": f"{fqn}.sum.{m.COLUMN_NAME}".lower(),
                        "NUM_EXPR": f"coalesce({_q(m.COLUMN_NAME)}, 0)", "DEN_EXPR": None, "UNIT": "USD", "ADDITIVE": True,
                        "BUSINESS_NAME": f"Total {_words(m.COLUMN_NAME)} ({label})",
                        "DESCRIPTION": f"Sum of {_words(m.COLUMN_NAME)} on {label}.",
                        "DIRECTION_GOOD": "up" if "PREMIUM" in m.COLUMN_NAME.upper() or "REVENUE" in m.COLUMN_NAME.upper() else "neutral"})
        meas = c[c.ROLE == "measure"]
        if is_mart:          # marts: their count-like columns are the measures (member months, scripts, admits)
            for m in meas.head(4).itertuples():
                out.append({**base, "KIND": "sum", "KPI_ID": f"{fqn}.sum.{m.COLUMN_NAME}".lower(),
                            "NUM_EXPR": f"coalesce({_q(m.COLUMN_NAME)}, 0)", "DEN_EXPR": None, "UNIT": "count",
                            "ADDITIVE": True, "BUSINESS_NAME": f"Total {_words(m.COLUMN_NAME)} ({label})",
                            "DESCRIPTION": f"Sum of {_words(m.COLUMN_NAME)} on {label}.", "DIRECTION_GOOD": "neutral"})
            continue
        mm = meas.assign(r=meas.COLUMN_NAME.map(lambda n: _rank(n, ("DAYS", "LOS", "UNITS", "QUANTITY", "COUNT", "MONTH"))))
        for m in mm.sort_values(["r", "ORDINAL"]).head(2).itertuples():
            if "MONTH_COUNT" in m.COLUMN_NAME.upper():      # member-month style counts are summed, not averaged
                out.append({**base, "KIND": "sum", "KPI_ID": f"{fqn}.sum.{m.COLUMN_NAME}".lower(),
                            "NUM_EXPR": f"coalesce({_q(m.COLUMN_NAME)}, 0)", "DEN_EXPR": None, "UNIT": "count",
                            "ADDITIVE": True, "BUSINESS_NAME": f"Total {_words(m.COLUMN_NAME)} ({label})",
                            "DESCRIPTION": f"Sum of {_words(m.COLUMN_NAME)} on {label}.", "DIRECTION_GOOD": "neutral"})
                continue
            out.append({**base, "KIND": "avg", "KPI_ID": f"{fqn}.avg.{m.COLUMN_NAME}".lower(),
                        "NUM_EXPR": f"{_q(m.COLUMN_NAME)}", "DEN_EXPR": f"iff({_q(m.COLUMN_NAME)} is null, 0, 1)",
                        "UNIT": "number", "ADDITIVE": False, "BUSINESS_NAME": f"Average {_words(m.COLUMN_NAME)} ({label})",
                        "DESCRIPTION": f"Average {_words(m.COLUMN_NAME)} per {label} record.", "DIRECTION_GOOD": "neutral"})
        # outcome shares are judged on records already decided, by decision date: final at once, not months later
        roles_t = json.loads(t["DATE_ROLES"]) if isinstance(t["DATE_ROLES"], str) else {}
        nn = dict(zip(c.COLUMN_NAME, c.NON_NULL))
        dec = [n for n, r in roles_t.items() if r == "decision" and nn.get(n, 0) >= 0.5 * max(int(t["ROW_COUNT"] or 1), 1)
               and c.set_index("COLUMN_NAME").DATA_TYPE.get(n, "TEXT").upper() != "TEXT"]
        rate_base = {**base, "DATE_EXPR": f'{_q(dec[0])}::date'} if dec else base
        for s in c[c.ROLE == "status"].itertuples():
            tops = json.loads(s.TOP_VALUES) if isinstance(s.TOP_VALUES, str) else []
            n = sum(v[1] for v in tops) or 1
            vals = [(v[0], v[1] / n) for v in tops if v[0] is not None and v[1] / n >= K["min_rate_share"]]
            if len(vals) < 2:
                continue
            vals.sort(key=lambda x: (0 if any(b in str(x[0]).upper() for b in BAD) else 1, -x[1]))
            for val, share in vals[:K["max_rates_per_status"]]:
                if share > 0.97:
                    continue
                bad = any(b in str(val).upper() for b in BAD)
                vv = str(val).replace("'", "''")
                in_progress = any(w in str(val).upper() for w in IN_PROGRESS)
                out.append({**(base if in_progress else rate_base), "KIND": "rate",
                            "KPI_ID": f"{fqn}.rate.{s.COLUMN_NAME}.{val}".lower(),
                            "NUM_EXPR": f"iff({_q(s.COLUMN_NAME)} = '{vv}', 1, 0)",
                            "DEN_EXPR": f"iff({_q(s.COLUMN_NAME)} is null, 0, 1)", "UNIT": "share",
                            "ADDITIVE": False, "RATE_COLUMN": s.COLUMN_NAME,
                            "BUSINESS_NAME": f"Share of {label} with {_words(s.COLUMN_NAME)} {str(val).lower().replace('_', ' ')}"
                                             + (" (by decision date)" if dec and not in_progress else ""),
                            "DESCRIPTION": f"Of the {label} records" + (f" decided each day ({_words(dec[0])})" if dec and not in_progress else "")
                                           + f", the share whose {_words(s.COLUMN_NAME)} is {val}.",
                            "DIRECTION_GOOD": "down" if bad else ("up" if any(g in str(val).upper() for g in GOOD) else "neutral")})
        flags = c[(c.ROLE == "flag") & (c.NON_NULL > 0)]
        flags = flags.assign(r=flags.COLUMN_NAME.map(lambda n: _rank(n, BAD + GOOD))).sort_values(["r", "ORDINAL"])
        for f in flags.head(4).itertuples():
            out.append({**base, "KIND": "rate", "KPI_ID": f"{fqn}.rate.{f.COLUMN_NAME}".lower(),
                        "NUM_EXPR": f"iff({_q(f.COLUMN_NAME)}::boolean, 1, 0)",
                        "DEN_EXPR": f"iff({_q(f.COLUMN_NAME)} is null, 0, 1)", "UNIT": "share",
                        "ADDITIVE": False, "RATE_COLUMN": f.COLUMN_NAME,
                        "BUSINESS_NAME": f"Share of {label} that are {_words(f.COLUMN_NAME)}",
                        "DESCRIPTION": f"Of all {label} records, the share flagged {_words(f.COLUMN_NAME)}.",
                        "DIRECTION_GOOD": "down" if any(b in f.COLUMN_NAME.upper() for b in BAD) else
                        ("up" if any(g in f.COLUMN_NAME.upper() for g in GOOD) else "neutral")})
        out += _turnaround_kpis(t, c, label, common)
    # overrides: rename, re-describe, retag, disable, or add a KPI by formula
    final = []
    for k in out:
        o = kov.get(k["KPI_ID"]) or {}
        if o.get("enabled") is False:
            continue
        for f in ("business_name", "description", "direction_good", "unit"):
            if f in o:
                k[f.upper()] = o[f]
        k["TAGS"] = o["tags"] if "tags" in o else _auto_tags(k)
        k["FORCED"] = o.get("enabled") is True
        final.append(k)
    for kid, o in kov.items():
        if o.get("custom") and o.get("enabled", True):
            final.append({"KPI_ID": kid.lower(), "TABLE_FQN": o["table"], "KIND": o.get("kind", "custom"),
                          "DATE_EXPR": o["date_expr"], "NUM_EXPR": o["num_expr"], "DEN_EXPR": o.get("den_expr"),
                          "ROW_FILTER": o.get("row_filter"), "FROM_SQL": o.get("from_sql", o["table"]),
                          "UNIT": o.get("unit", "number"), "ADDITIVE": o.get("den_expr") is None,
                          "BUSINESS_NAME": o["business_name"], "DESCRIPTION": o.get("description", ""),
                          "DIRECTION_GOOD": o.get("direction_good", "neutral"), "TAGS": o.get("tags", []),
                          "DEPARTMENT": o.get("department"), "DIMENSIONS": []})
    for k in final:
        k["NATIVE_GRAIN"] = None
        k["DEFINITION_HASH"] = hashlib.md5(json.dumps({**{x: k.get(x) for x in (
            "DATE_EXPR", "NUM_EXPR", "DEN_EXPR", "ROW_FILTER", "FROM_SQL", "KIND")},
            "dims": [d["name"] for d in k.get("DIMENSIONS") or []]}, sort_keys=True, default=str).encode()).hexdigest()
    return final


def _auto_tags(k: dict) -> list[str]:
    t, n = k["TABLE_FQN"].upper(), k.get("NUM_EXPR", "").upper()
    tags = []
    if k["KIND"] == "sum" and "PREMIUM" in n and "MART" not in t and "BILLED_PREMIUM" in n:
        tags.append("revenue")
    if k["KIND"] == "sum" and "PLAN_PAID" in n and "PHARMACY" in t and "MART" not in t:
        tags.append("pharmacy_cost")
    if k["KIND"] == "sum" and "TOTAL_PLAN_PAID" in n and "CLAIM" in t and "MART" not in t:
        tags.append("medical_cost")
    if k["KIND"] == "sum" and "MEMBER_MONTH_COUNT" in n and "MART" not in t:
        tags.append("member_months")
    if k["KIND"] == "active" and "ELIGIBILITY" in t:
        tags.append("membership")
    return tags


def _dims(t, c, tables, cols, edges) -> list[dict]:
    fqn = t["TABLE_FQN"]
    own = c[c.ROLE.isin(["category", "status"]) & c.DISTINCT_APPROX.between(2, CONFIG["catalog"]["category_max_distinct"])]
    own = own.assign(r=own.COLUMN_NAME.map(lambda n: _rank(n, DIM_PRIORITY))).sort_values(["r", "ORDINAL"])
    dims = [{"name": r.COLUMN_NAME, "expr": f"b.{_q(r.COLUMN_NAME)}", "join": None}
            for r in own.head(K["max_dims_per_table"]).itertuples()]
    if edges is None or edges.empty:
        return dims
    fks = edges[(edges.KIND == "foreign_key") & (edges.TO_NODE == fqn) & (edges.CONFIDENCE.isin(["high", "medium"]))]
    joined, entity = [], []
    tm = tables.set_index("TABLE_FQN")
    for i, e in enumerate(fks.itertuples()):
        parent = e.FROM_NODE
        prole = tm.TABLE_ROLE.get(parent)
        if prole not in ("dimension", "reference", "span"):
            continue
        pk_unique = tm.PRIMARY_KEY.get(parent) == e.FROM_COLUMN or prole == "reference"
        if not pk_unique:
            continue
        alias = f"j{i}"
        join = f"left join {parent} {alias} on {alias}.{_q(e.FROM_COLUMN)} = b.{_q(e.TO_COLUMN)}"
        pc = cols[(cols.TABLE_FQN == parent) & cols.ROLE.isin(["category", "status"]) &
                  cols.DISTINCT_APPROX.between(2, CONFIG["catalog"]["category_max_distinct"])]
        pc = pc.assign(r=pc.COLUMN_NAME.map(lambda n: _rank(n, DIM_PRIORITY))).sort_values(["r", "ORDINAL"])
        for r in pc.head(2).itertuples():
            if r.COLUMN_NAME in {d["name"] for d in dims + joined}:
                continue
            joined.append({"name": f"{e.TO_COLUMN}>{r.COLUMN_NAME}", "expr": f"{alias}.{_q(r.COLUMN_NAME)}", "join": join})
        if any(k in e.TO_COLUMN.upper() for k in ENTITY_KEYS) and e.TO_COLUMN.upper().endswith("_ID"):
            entity.append({"name": e.TO_COLUMN, "expr": f"b.{_q(e.TO_COLUMN)}", "join": None, "entity": parent})
    joined.sort(key=lambda d: _rank(d["name"].split(">")[1], DIM_PRIORITY))
    seen, ent = set(), []
    for d in sorted(entity, key=lambda d: _rank(d["name"], ENTITY_KEYS)):
        if d["name"] not in seen:
            seen.add(d["name"])
            ent.append(d)
    return dims + joined[:K["max_joined_dims"]] + ent[:2]


def _span_kpis(t, c, label, common) -> list[dict]:
    roles = json.loads(t["DATE_ROLES"]) if isinstance(t["DATE_ROLES"], str) else {}
    start = next((n for n, r in roles.items() if r == "start"), None)
    end = next((n for n, r in roles.items() if r == "end"), None)
    if not start or not end:
        return []
    dup = next((r.COLUMN_NAME for r in c.itertuples() if r.ROLE == "flag" and "DUPLICATE" in r.COLUMN_NAME.upper()), None)
    filt = f"not coalesce({_q(dup)}::boolean, false)" if dup else None
    base = {**common, "ROW_FILTER": filt, "SPAN_START": start, "SPAN_END": end}
    return [
        {**base, "KIND": "active", "KPI_ID": f"{t['TABLE_FQN']}.active".lower(), "DATE_EXPR": f"{_q(start)}::date",
         "NUM_EXPR": "1", "DEN_EXPR": None, "UNIT": "count", "ADDITIVE": False, "BUSINESS_NAME": f"Active {label}",
         "DESCRIPTION": f"How many {label} records are in force on each day (started and not yet ended).",
         "DIRECTION_GOOD": "up"},
        {**base, "KIND": "starts", "KPI_ID": f"{t['TABLE_FQN']}.starts".lower(), "DATE_EXPR": f"{_q(start)}::date",
         "NUM_EXPR": "1", "DEN_EXPR": None, "UNIT": "count", "ADDITIVE": True, "BUSINESS_NAME": f"New {label} starting",
         "DESCRIPTION": f"How many {label} records start on each day (future dates = already scheduled).",
         "DIRECTION_GOOD": "up"},
        {**base, "KIND": "ends", "KPI_ID": f"{t['TABLE_FQN']}.ends".lower(), "DATE_EXPR": f"{_q(end)}::date",
         "NUM_EXPR": "1", "DEN_EXPR": None, "UNIT": "count", "ADDITIVE": True, "BUSINESS_NAME": f"{label.capitalize()} ending",
         "DESCRIPTION": f"How many {label} records end on each day (future dates = already scheduled terminations).",
         "DIRECTION_GOOD": "down"},
    ]


def _turnaround_kpis(t, c, label, common) -> list[dict]:
    roles = json.loads(t["DATE_ROLES"]) if isinstance(t["DATE_ROLES"], str) else {}
    nn = dict(zip(c.COLUMN_NAME, c.NON_NULL))
    by = lambda r: sorted([n for n, x in roles.items() if x == r and nn.get(n, 0) > 0],
                          key=lambda n: 0 if "RECEIVED" in n.upper() else 1)          # payer receipt first
    pairs = []
    for a in by("arrival")[:1] or by("event")[:1]:
        for b in by("decision")[:1] + by("payment")[:1]:
            pairs.append((a, b))
    for a in by("event")[:1]:
        for b in by("arrival")[:1]:
            pairs.append((a, b))
    out = []
    for a, b in pairs[:3]:
        out.append({**common, "KIND": "turnaround", "KPI_ID": f"{t['TABLE_FQN']}.days.{a}.{b}".lower(),
                    "DATE_EXPR": f"{_q(b)}::date",
                    "NUM_EXPR": f"iff({_q(b)} >= {_q(a)}, datediff(day, {_q(a)}, {_q(b)}), null)",
                    "DEN_EXPR": f"iff({_q(b)} >= {_q(a)}, 1, 0)", "UNIT": "days", "ADDITIVE": False,
                    "BUSINESS_NAME": f"Average days from {_words(a)} to {_words(b)} ({label})",
                    "DESCRIPTION": f"For {label} records whose {_words(b)} falls on the day, the average days since {_words(a)}.",
                    "DIRECTION_GOOD": "down"})
    return out


# ---------------------------------------------------------------------------------------------------- SQL
def _from(kpis: list[dict]) -> tuple[str, list[dict]]:
    dims = kpis[0]["DIMENSIONS"] or []
    joins = []
    for d in dims:
        if d.get("join") and d["join"] not in joins:
            joins.append(d["join"])
    return f"{kpis[0]['FROM_SQL']} b " + " ".join(joins), dims


def _base_cte(kpis, lo, hi, with_dims: bool, date_expr: str) -> str:
    frm, dims = _from(kpis)
    de = date_expr
    cols = [f"({de}) as d"]
    for i, k in enumerate(kpis):
        num = _prefix(k["NUM_EXPR"])
        den = _prefix(k["DEN_EXPR"]) if k.get("DEN_EXPR") else None
        cols.append(f"({num})::float as n{i}")
        cols.append(f"({den})::float as m{i}" if den else f"null::float as m{i}")
    if with_dims:
        for j, d in enumerate(dims):
            cols.append(f"coalesce(({d['expr']})::varchar, '(blank)') as x{j}")
    filt = kpis[0].get("ROW_FILTER")
    where = f"({de}) between '{lo}' and '{hi}'" + (f" and ({_prefix(filt)})" if filt else "")
    return f"select {', '.join(cols)} from {frm} where {where}"


def _prefix(expr: str | None) -> str | None:
    """Qualify bare quoted column references with the base alias b."""
    if expr is None:
        return None
    return re.sub(r'(?<![\w."])"([A-Z0-9_]+)"', r'b."\1"', expr)


def _insert_daily_sql(group: list[dict], lo, hi) -> str:
    de = _prefix(group[0]["DATE_EXPR"])
    base = _base_cte(group, lo, hi, False, de)
    sel = " union all ".join(
        f"select '{k['KPI_ID']}', d, sum(n{i}), sum(m{i}), count(*) from base group by d" for i, k in enumerate(group))
    return f"insert into {RS}.PI_KPI_DAILY (KPI_ID, D, NUM, DEN, N_ROWS) with base as ({base}) {sel}"


def _insert_dim_sql(group: list[dict], lo, hi) -> str | None:
    dims = group[0]["DIMENSIONS"] or []
    if not dims:
        return None
    de = _prefix(group[0]["DATE_EXPR"])
    base = _base_cte(group, lo, hi, True, de)
    sums = ", ".join(f"sum(n{i}) as n{i}, sum(m{i}) as m{i}" for i in range(len(group)))
    per_dim = " union all ".join(
        f"select d, '{d['name']}' as dim, x{j} as val, {sums} from base group by d, x{j}" for j, d in enumerate(dims))
    sel = " union all ".join(f"select '{k['KPI_ID']}', d, dim, val, n{i}, m{i} from g" for i, k in enumerate(group))
    return f"insert into {RS}.PI_KPI_DAILY_DIM (KPI_ID, D, DIM, VAL, NUM, DEN) with base as ({base}), g as ({per_dim}) {sel}"


def _active_sql(k: dict, hi) -> str:
    """Daily in-force count from span start/end: cumulative starts minus cumulative ends."""
    f = k["FROM_SQL"]
    s, e = _q(k["SPAN_START"]), _q(k["SPAN_END"])
    filt = f"where ({k['ROW_FILTER']})" if k.get("ROW_FILTER") else ""
    return f"""insert into {RS}.PI_KPI_DAILY (KPI_ID, D, NUM, DEN, N_ROWS)
        with sp as (select {s}::date s, coalesce({e}::date, '9999-12-31') e from {f} {filt}),
        ev as (select s as d, 1 as delta from sp where s <= e
               union all select dateadd(day, 1, e) as d, -1 from sp where s <= e and e < '9999-12-31'),
        dd as (select d, sum(delta) delta from ev group by d),
        lo as (select min(d) m from dd),
        spine as (select dateadd(day, seq4(), (select m from lo)) d from table(generator(rowcount => 20000))),
        c as (select sp2.d, coalesce(dd.delta, 0) delta from spine sp2 left join dd on dd.d = sp2.d
              where sp2.d <= '{hi}')
        select '{k['KPI_ID']}', d, sum(delta) over (order by d rows unbounded preceding), 1, null from c"""


# ---------------------------------------------------------------------------------------------------- completeness
def completeness(conn, t: dict, cols: pd.DataFrame, today) -> list[pd.DataFrame]:
    """How late rows arrive (event -> arrival) and how long until their outcome is final (event -> decision)."""
    ev = t.get("EVENT_DATE")
    roles = json.loads(t["DATE_ROLES"]) if isinstance(t["DATE_ROLES"], str) else {}
    if not isinstance(ev, str) or roles.get(ev) not in ("event", "period", "arrival"):
        return []
    types = dict(zip(cols[cols.TABLE_FQN == t["TABLE_FQN"]].COLUMN_NAME, cols[cols.TABLE_FQN == t["TABLE_FQN"]].DATA_TYPE))
    out = []
    targets = [("arrival", t.get("ARRIVAL_DATE"))] if roles.get(ev) != "arrival" else []
    money = [c for c in cols[(cols.TABLE_FQN == t["TABLE_FQN"]) & (cols.ROLE == "money")].sort_values("ORDINAL").COLUMN_NAME][:6]
    if targets:
        targets += [(f"arrival:{m}", t.get("ARRIVAL_DATE")) for m in money]   # expensive claims arrive later
    dec = [c for c, r in roles.items() if r == "decision" and types.get(c, "").upper() != "TEXT"]
    if dec:
        targets.append(("decision", dec[0]))
    for kind, arr in targets:
        if not isinstance(arr, str) or types.get(arr, "").upper() == "TEXT" or types.get(ev, "").upper() == "TEXT":
            continue
        df = pd.DataFrame()
        for back_lo, back_hi in ((760, 400), (400, 150), (240, 60)):    # mature window; younger tables fall back
            lo, hi = today - timedelta(days=back_lo), today - timedelta(days=back_hi)
            df = _curve_query(conn, t, ev, arr, lo, hi, kind.split(":")[1] if ":" in kind else None)
            if not df.empty and df.N.iloc[0] >= 200:
                break
        if df.empty or df.N.iloc[0] < 100:
            continue
        df["CUM_SHARE"] = df.C.cumsum() / df.N.iloc[0]     # rows never decided count against completeness
        out.append(pd.DataFrame({"TABLE_FQN": t["TABLE_FQN"], "EVENT_DATE": ev, "ARRIVAL_DATE": arr,
                                 "LAG_DAYS": df.LAG.astype(int), "CUM_SHARE": df.CUM_SHARE.round(5),
                                 "CURVE_KIND": kind, "CURVE_SOURCE": f"measured ({lo}..{hi})"}))
    return out


def _curve_query(conn, t, ev, arr, lo, hi, weight: str | None = None) -> pd.DataFrame:
    w = f'abs(coalesce("{weight}", 0))' if weight else "1"
    df = query_df(conn, f"""
        with x as (select greatest(datediff(day, "{ev}"::date, "{arr}"::date), 0) lag, {w} w from {t['TABLE_FQN']}
                   where "{ev}"::date between '{lo}' and '{hi}' and "{arr}" is not null),
        n as (select count(*) n, sum({w}) wt from {t['TABLE_FQN']} where "{ev}"::date between '{lo}' and '{hi}')
        select lag, sum(w) c, (select n from n) n, (select wt from n) wt from x group by lag order by lag""")
    if weight and not df.empty:
        df["C"] = df.C * (df.N / df.WT.replace(0, float("nan")))   # scale so that C.cumsum()/N is the dollar share
    return df


def inherit_completeness(conn, compdf: pd.DataFrame, tables: pd.DataFrame, edges: pd.DataFrame,
                         cols: pd.DataFrame) -> pd.DataFrame:
    """Tables with no arrival/decision date of their own (claim lines, encounters) are recorded at the same moment as
    a linked table that has one. They inherit its curves only if, for linked rows, their own date agrees with that
    table's date (within 3 days) for at least 90% of rows - a payment or an appeal linked to a claim does not.
    Monthly marts inherit through their loads, and only claim-cost measures use it (see analyze)."""
    have = {(r.TABLE_FQN, r.CURVE_KIND) for r in compdf.drop_duplicates(["TABLE_FQN", "CURVE_KIND"]).itertuples()} \
        if len(compdf) else set()
    tm = tables.set_index("TABLE_FQN")
    fk = edges[(edges.KIND == "foreign_key") & (edges.CONFIDENCE == "high")]
    flows = edges[(edges.KIND == "data_flow") & (edges.CONFIDENCE == "high")]
    add, checked = [], {}
    for t in tables[tables.IS_KPI_SOURCE == True].itertuples():  # noqa: E712
        for kind in ("arrival", "decision"):
            if (t.TABLE_FQN, kind) in have:
                continue
            src = None
            if t.TABLE_ROLE == "mart":
                src = next((n for n in flows[flows.TO_NODE == t.TABLE_FQN].FROM_NODE if (n, kind) in have), None)
            elif isinstance(t.EVENT_DATE, str):
                for e in pd.concat([fk[fk.TO_NODE == t.TABLE_FQN], fk[fk.FROM_NODE == t.TABLE_FQN]]).itertuples():
                    other = e.FROM_NODE if e.TO_NODE == t.TABLE_FQN else e.TO_NODE
                    if (other, kind) not in have or not isinstance(tm.EVENT_DATE.get(other), str):
                        continue
                    key = (t.TABLE_FQN, other, e.TO_COLUMN)
                    if key not in checked:
                        child, parent = (e.TO_NODE, e.FROM_NODE)
                        cdate = tm.EVENT_DATE.get(child)
                        pdate = tm.EVENT_DATE.get(parent)
                        try:
                            r = query_df(conn, f"""select avg(iff(abs(datediff(day, c."{cdate}"::date, p."{pdate}"::date)) <= 3, 1, 0)) a
                                from (select * from {child} sample (50000 rows)) c join {parent} p
                                on p."{e.FROM_COLUMN}" = c."{e.TO_COLUMN}" """).iloc[0]
                            checked[key] = float(r.A or 0)
                        except Exception:
                            checked[key] = 0.0
                    if checked[key] >= 0.9:
                        src = other
                        break
            if src is None:
                continue
            c = compdf[(compdf.TABLE_FQN == src) & ((compdf.CURVE_KIND == kind) |
                                                     compdf.CURVE_KIND.str.startswith(kind + ":"))].copy()
            c["TABLE_FQN"] = t.TABLE_FQN
            c["EVENT_DATE"] = t.EVENT_DATE if isinstance(t.EVENT_DATE, str) else "(period)"
            c["CURVE_SOURCE"] = f"inherited:{src}"
            add.append(c)
    return pd.concat([compdf] + add, ignore_index=True) if add else compdf


# ---------------------------------------------------------------------------------------------------- run
def run(rebuild: bool = False) -> dict:
    today = as_of()
    now = datetime.utcnow()
    with session() as conn:
        tables = query_df(conn, f"select * from {RS}.PI_TABLE")
        cols = query_df(conn, f"select * from {RS}.PI_COLUMN")
        edges = query_df(conn, f"select * from {RS}.PI_EDGE")
        builds = query_df(conn, f"select * from {RS}.PI_KPI_BUILD")
        dropped_path = OUT / "dropped_kpis.json"
        raw = json.loads(dropped_path.read_text()) if dropped_path.exists() else {}
        if isinstance(raw, list):                           # older format: a plain list
            raw = {k: {"reason": "constant_or_empty", "date": str(today)} for k in raw}
        drops = {k: v for k, v in raw.items()                # 'never moves' is re-tested after 30 days
                 if v.get("reason") != "constant_or_empty" or (today - date.fromisoformat(v["date"])).days < 30}
        allk = discover(tables, cols, edges)
        forced = {k["KPI_ID"] for k in allk if k.get("FORCED")}
        kpis = [k for k in allk if k["KPI_ID"] not in drops or k["KPI_ID"] in forced]
        # completeness curves (how late rows arrive) - also sizes each table's restatement window
        comp = []
        for t in tables[tables.TABLE_ROLE == "fact"].to_dict("records"):
            comp += completeness(conn, t, cols, today)
        compdf = pd.concat(comp, ignore_index=True) if comp else pd.DataFrame(
            columns=["TABLE_FQN", "EVENT_DATE", "ARRIVAL_DATE", "LAG_DAYS", "CUM_SHARE", "CURVE_KIND", "CURVE_SOURCE"])
        # curves measured on a source-system copy belong to its warehouse table too
        sup = {r.TABLE_FQN: r.SUPERSEDED_BY for r in tables.itertuples() if isinstance(r.SUPERSEDED_BY, str)}
        moved = compdf[compdf.TABLE_FQN.isin(sup)].copy()
        moved["CURVE_SOURCE"] = "inherited:" + moved.TABLE_FQN
        moved["TABLE_FQN"] = moved.TABLE_FQN.map(sup)
        compdf = pd.concat([compdf[~compdf.TABLE_FQN.isin(sup)], moved], ignore_index=True)
        compdf = compdf.drop_duplicates(["TABLE_FQN", "CURVE_KIND", "LAG_DAYS"])
        compdf = inherit_completeness(conn, compdf, tables, edges, cols)
        compdf["UPDATED_TS"] = now
        replace_rows(conn, f"{RS}.PI_COMPLETENESS", compdf)

        kdf = pd.DataFrame([{**{c: k.get(c) for c in ("KPI_ID", "TABLE_FQN", "KIND", "BUSINESS_NAME", "DESCRIPTION", "UNIT",
                                                      "DATE_EXPR", "NUM_EXPR", "DEN_EXPR", "ROW_FILTER", "FROM_SQL",
                                                      "ADDITIVE", "NATIVE_GRAIN", "DIRECTION_GOOD", "DEPARTMENT",
                                                      "DEFINITION_HASH")},
                             "TAGS": json.dumps(k.get("TAGS") or []),
                             "DIMENSIONS": json.dumps([{x: d.get(x) for x in ("name", "entity")} for d in k.get("DIMENSIONS") or []]),
                             "UPDATED_TS": now} for k in kpis])
        replace_rows(conn, f"{RS}.PI_KPI", kdf)
        live = set(kdf.KPI_ID)
        execute(conn, f"delete from {RS}.PI_KPI_DAILY where KPI_ID not in (select KPI_ID from {RS}.PI_KPI)")
        execute(conn, f"delete from {RS}.PI_KPI_DAILY_DIM where KPI_ID not in (select KPI_ID from {RS}.PI_KPI)")

        bmap = {r.TABLE_FQN: r for r in builds.itertuples()} if len(builds) else {}
        fps = dict(zip(tables.TABLE_FQN, tables.FINGERPRINT))
        stats = {"tables": 0, "full": 0, "incremental": 0, "skipped": 0, "kpis": len(kpis)}
        by_table: dict[str, list[dict]] = {}
        for k in kpis:
            by_table.setdefault(k["TABLE_FQN"], []).append(k)
        brows = []
        for fqn, group in by_table.items():
            stats["tables"] += 1
            dh = hashlib.md5("|".join(sorted(k["DEFINITION_HASH"] for k in group)).encode()).hexdigest()
            prev = bmap.get(fqn)
            reconcile_due = prev is None or pd.isna(prev.RECONCILED_TS) or \
                (now - pd.Timestamp(prev.RECONCILED_TS).to_pydatetime().replace(tzinfo=None)).days >= INC["reconcile_every_days"]
            last_ok = prev is not None and pd.notna(prev.RECONCILE_OK) and bool(prev.RECONCILE_OK)
            if prev is not None and not rebuild and prev.DEFINITION_HASH == dh and prev.FINGERPRINT == fps.get(fqn) \
                    and not reconcile_due and last_ok:
                stats["skipped"] += 1
                brows.append(prev._asdict() | {"Index": None})
                continue
            mode = "full" if (rebuild or prev is None or prev.DEFINITION_HASH != dh or
                              (prev is not None and pd.notna(prev.RECONCILE_OK) and not bool(prev.RECONCILE_OK)))                 else "incremental"
            restate = _restate_days(fqn, compdf)
            lo = "1900-01-01" if mode == "full" else str(today - timedelta(days=restate))
            hi = str(today + timedelta(days=400))          # future-dated rows (scheduled ends, advance premium) kept
            ids = ", ".join(f"'{k['KPI_ID']}'" for k in group)
            execute(conn, "begin")
            try:
                execute(conn, f"delete from {RS}.PI_KPI_DAILY where KPI_ID in ({ids}) and D >= '{lo}'")
                dim_lo = max(pd.Timestamp(lo).date(), today - timedelta(days=INC["breakdown_history_days"]))
                execute(conn, f"delete from {RS}.PI_KPI_DAILY_DIM where KPI_ID in ({ids}) and "
                              f"(D >= '{dim_lo}' or D < '{today - timedelta(days=INC['breakdown_history_days'])}')")
                regular = [k for k in group if k["KIND"] != "active"]
                for sub in _split_by_date(regular):
                    execute(conn, _insert_daily_sql(sub, lo, hi))
                    dsql = _insert_dim_sql(sub, dim_lo, hi)
                    if dsql:
                        execute(conn, dsql)
                for k in group:
                    if k["KIND"] == "active":
                        execute(conn, f"delete from {RS}.PI_KPI_DAILY where KPI_ID = '{k['KPI_ID']}'")
                        execute(conn, _active_sql(k, today + timedelta(days=400)))
                execute(conn, "commit")
            except Exception:
                execute(conn, "rollback")
                raise
            ok, detail = (None, None)
            if reconcile_due or mode == "full":
                checks = [_reconcile(conn, sub) for sub in _split_by_date(regular)]
                ok = all(c[0] for c in checks) if checks else True
                detail = "; ".join(c[1] for c in checks)[:2000]
            stats[mode] += 1
            brows.append({"TABLE_FQN": fqn, "DEFINITION_HASH": dh, "FINGERPRINT": fps.get(fqn), "MODE": mode,
                          "RESTATE_FROM": lo if mode == "incremental" else None, "BUILT_TS": now,
                          "ROWS_WRITTEN": None, "RECONCILED_TS": now if ok is not None else (prev.RECONCILED_TS if prev is not None else None),
                          "RECONCILE_OK": ok if ok is not None else (prev.RECONCILE_OK if prev is not None else None),
                          "RECONCILE_DETAIL": detail})
            if ok is False:
                stats.setdefault("reconcile_failed", []).append(fqn)
        bdf = pd.DataFrame(brows)
        bdf = bdf[[c for c in bdf.columns if c in ("TABLE_FQN", "DEFINITION_HASH", "FINGERPRINT", "MODE", "RESTATE_FROM",
                                                   "BUILT_TS", "ROWS_WRITTEN", "RECONCILED_TS", "RECONCILE_OK", "RECONCILE_DETAIL")]]
        replace_rows(conn, f"{RS}.PI_KPI_BUILD", bdf)
        native = query_df(conn, f"""select KPI_ID, count(distinct D) days, datediff(day, min(D), max(D)) + 1 span,
              count(distinct date_trunc('month', D)) months, count(distinct dayofweekiso(D)) dows
              from {RS}.PI_KPI_DAILY where D <= '{today}' group by 1""")
        for r in native.itertuples():
            g = "day"
            if r.DAYS <= r.MONTHS * 1.2:
                g = "year" if r.DAYS <= max(1, r.SPAN / 330) * 1.2 else "month"
            elif r.DOWS == 1 or r.DAYS <= r.SPAN / 6:
                g = "week"
            execute(conn, f"update {RS}.PI_KPI set NATIVE_GRAIN = '{g}' where KPI_ID = '{r.KPI_ID}'")
        # the same numbers measured twice (a source table that loads into another): keep the load's target
        twins = query_df(conn, f"""with s as (select KPI_ID, count(*) n, round(sum(NUM), 2) tot, round(sum(NUM * NUM), 0) sq,
                                         round(sum(NUM * dayofyear(D)), 0) wsum
                                  from {RS}.PI_KPI_DAILY where NUM <> 0 group by 1)
              select a.KPI_ID a, b.KPI_ID b, ka.TABLE_FQN = kb.TABLE_FQN same_table
              from s a join s b on a.tot = b.tot and a.n = b.n and a.sq = b.sq and a.wsum = b.wsum and a.KPI_ID < b.KPI_ID
              join {RS}.PI_KPI ka on ka.KPI_ID = a.KPI_ID join {RS}.PI_KPI kb on kb.KPI_ID = b.KPI_ID
              where ka.KIND in ('count', 'sum') and kb.KIND in ('count', 'sum') and a.tot <> 0""")
        flows = edges[edges.KIND == "data_flow"]
        tmap = dict(zip(kdf.KPI_ID, kdf.TABLE_FQN))
        twin_drop = []
        trole = dict(zip(tables.TABLE_FQN, tables.TABLE_ROLE))
        tagged = {k["KPI_ID"] for k in kpis if k.get("TAGS")}
        for r in twins.itertuples():
            ta, tb = tmap.get(r.A), tmap.get(r.B)
            if r.A in forced or r.B in forced:
                twin_drop.append(r.B if r.A in forced else r.A)
            elif (r.A in tagged) != (r.B in tagged):
                twin_drop.append(r.B if r.A in tagged else r.A)   # keep the executive-tagged copy
            elif r.SAME_TABLE:
                twin_drop.append(r.B if r.A.endswith(".count") else r.A)   # same table: keep the plain count
            elif trole.get(ta) == "mart" and trole.get(tb) != "mart":
                twin_drop.append(r.A)                  # detailed table (with breakdowns) beats a summary mart
            elif trole.get(tb) == "mart" and trole.get(ta) != "mart":
                twin_drop.append(r.B)
            elif ((flows.FROM_NODE == ta) & (flows.TO_NODE == tb)).any():
                twin_drop.append(r.A)
            elif ((flows.FROM_NODE == tb) & (flows.TO_NODE == ta)).any():
                twin_drop.append(r.B)
        if twin_drop:
            ids = ", ".join(f"'{x}'" for x in twin_drop)
            for tbl in ("PI_KPI", "PI_KPI_DAILY", "PI_KPI_DAILY_DIM"):
                execute(conn, f"delete from {RS}.{tbl} where KPI_ID in ({ids})")
            stats["dropped_duplicates"] = twin_drop
            for x in twin_drop:
                drops[x] = {"reason": "duplicate", "date": str(today)}
            dropped_path.write_text(json.dumps(drops, indent=1))
        # a rate that never moves (always ~0% or ~100%) is not a KPI; neither is a series with no data
        dead = query_df(conn, f"""select k.KPI_ID from {RS}.PI_KPI k left join {RS}.PI_KPI_DAILY d using (KPI_ID)
              group by k.KPI_ID, k.KIND
              having count(d.D) = 0 or (k.KIND = 'rate' and (sum(d.NUM) / nullif(sum(d.DEN), 0) >= 0.997
                                                         or sum(d.NUM) / nullif(sum(d.DEN), 0) <= 0.0003))""")
        dead = dead[~dead.KPI_ID.isin(forced)] if len(dead) else dead
        if len(dead):
            ids = ", ".join(f"'{x}'" for x in dead.KPI_ID)
            for tbl in ("PI_KPI", "PI_KPI_DAILY", "PI_KPI_DAILY_DIM"):
                execute(conn, f"delete from {RS}.{tbl} where KPI_ID in ({ids})")
            stats["dropped_constant_or_empty"] = list(dead.KPI_ID)
            OUT.mkdir(parents=True, exist_ok=True)
            for x in dead.KPI_ID:
                drops[x] = {"reason": "constant_or_empty", "date": str(today)}
            dropped_path.write_text(json.dumps(drops, indent=1))
    return stats


def _split_by_date(group):
    """KPIs share one aggregation query only if they share the date AND the row filter."""
    out = {}
    for k in group:
        out.setdefault((k["DATE_EXPR"], k.get("ROW_FILTER") or ""), []).append(k)
    return list(out.values())


def _restate_days(fqn, compdf) -> int:
    c = compdf[(compdf.TABLE_FQN == fqn) & (compdf.CURVE_KIND == "arrival")]
    if c.empty:
        return INC["restate_days_default"]
    p99 = c[c.CUM_SHARE >= 0.99].LAG_DAYS.min()
    return int(min(INC["restate_days_max"], max(INC["restate_days_default"], (p99 or 0) + 45)))


def _reconcile(conn, group) -> tuple[bool, str]:
    """All-time totals in the summary must equal a fresh aggregate of the raw table."""
    if not group:
        return True, "nothing to check"
    frm = f"{group[0]['FROM_SQL']} b"
    sel = ", ".join(f"sum({_prefix(k['NUM_EXPR'])})::float as n{i}" for i, k in enumerate(group))
    de = _prefix(group[0]['DATE_EXPR'])
    raw = query_df(conn, f"select {sel} from {frm} where ({de}) between '1900-01-01' and '{as_of() + timedelta(days=400)}'"
                         + (f" and ({_prefix(group[0]['ROW_FILTER'])})" if group[0].get("ROW_FILTER") else "")).iloc[0]
    ids = ", ".join(f"'{k['KPI_ID']}'" for k in group)
    summ = query_df(conn, f"select KPI_ID, sum(NUM) s from {RS}.PI_KPI_DAILY where KPI_ID in ({ids}) group by 1")
    sm = dict(zip(summ.KPI_ID, summ.S))
    bad = []
    for i, k in enumerate(group):
        a, b = float(raw[f"N{i}"] or 0), float(sm.get(k["KPI_ID"]) or 0)
        if abs(a - b) > max(1e-6, 1e-4 * abs(a)):
            bad.append(f"{k['KPI_ID']}: raw {a:.2f} vs summary {b:.2f}")
    return (not bad), ("; ".join(bad)[:2000] if bad else "totals match")
