"""Write the app's data files (web/public/data/*.json) from the results schema and the local run files."""
from __future__ import annotations

import json
from datetime import datetime

import pandas as pd

from .config import DB, OUT, ROOT, RS, as_of
from .db import query_df, session

WEB = ROOT / "web" / "public" / "data"


def _j(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return v
    return v


def _clean(o):
    if isinstance(o, float) and o != o:
        return None
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_clean(v) for v in o]
    if isinstance(o, (pd.Timestamp, datetime)):
        return str(o)[:19]
    if hasattr(o, "isoformat"):
        return o.isoformat()
    if hasattr(o, "item"):
        return o.item()
    return o


def _write(name, obj):
    WEB.mkdir(parents=True, exist_ok=True)
    (WEB / name).write_text(json.dumps(_clean(obj), default=str), encoding="utf-8")


def run() -> dict:
    today = as_of()
    with session() as conn:
        tables = query_df(conn, f"select * from {RS}.PI_TABLE")
        cols = query_df(conn, f"select TABLE_FQN, ROLE, count(*) n from {RS}.PI_COLUMN group by 1, 2")
        kpis = query_df(conn, f"select * from {RS}.PI_KPI")
        edges = query_df(conn, f"select * from {RS}.PI_EDGE")
        chains = query_df(conn, f"select * from {RS}.PI_PROCESS_CHAIN")
        warn = query_df(conn, f"select * from {RS}.PI_WARNING where AS_OF = '{today}'")
        outlook = query_df(conn, f"select * from {RS}.PI_OUTLOOK where AS_OF = '{today}'")
        proj = query_df(conn, f"select * from {RS}.PI_PROJECTION where AS_OF = '{today}' and SUBJECT_KIND = 'kpi'")
        dq = query_df(conn, f"select * from {RS}.PI_DQ_RESULT where AS_OF = '{today}'")
        comp = query_df(conn, f"""select TABLE_FQN, CURVE_KIND, CURVE_SOURCE, LAG_DAYS, CUM_SHARE from {RS}.PI_COMPLETENESS
                                 where LAG_DAYS in (0, 7, 14, 30, 60, 90, 180) and (CURVE_KIND in ('arrival','decision'))""")
        builds = query_df(conn, f"select * from {RS}.PI_KPI_BUILD")
        runlog = query_df(conn, f"""select STEP, STATUS, SECONDS, FINISHED_TS, DETAIL from {RS}.PI_RUN_LOG
                                   qualify row_number() over (partition by STEP order by FINISHED_TS desc) = 1""")
    state = json.loads((OUT / "kpi_state.json").read_text())
    st = {s["KPI_ID"]: s for s in state["kpis"]}
    tname = dict(zip(tables.TABLE_FQN, tables.BUSINESS_NAME))
    tdept = dict(zip(tables.TABLE_FQN, tables.DEPARTMENT))

    # ---- KPIs with history and forecast
    fc = {}
    for kid, g in proj.groupby("SUBJECT_ID"):
        g = g.sort_values("PERIOD_START")
        fc[kid] = {"method": g.METHOD.iloc[0], "skill": g.SKILL_VS_NAIVE.iloc[0],
                   "points": [{"p": str(r.PERIOD_START)[:10], "point": r.POINT, "lower": r.LOWER, "upper": r.UPPER,
                               "nowcast": _j(r.DETAIL).get("nowcast"), "observed": _j(r.DETAIL).get("observed_so_far")}
                              for r in g.itertuples()]}
    klist = []
    for k in kpis.itertuples():
        s = st.get(k.KPI_ID, {})
        klist.append({"id": k.KPI_ID, "name": k.BUSINESS_NAME, "description": k.DESCRIPTION, "unit": k.UNIT, "kind": k.KIND,
                      "department": k.DEPARTMENT, "table": k.TABLE_FQN, "table_name": tname.get(k.TABLE_FQN),
                      "tags": _j(k.TAGS), "direction_good": k.DIRECTION_GOOD, "grain": s.get("GRAIN"),
                      "state": s.get("STATE"), "direction": s.get("DIRECTION"), "polarity": s.get("POLARITY"),
                      "z": s.get("Z"), "actual": s.get("ACTUAL"), "expected": s.get("EXPECTED"), "lower": s.get("LOWER"),
                      "upper": s.get("UPPER"), "period": s.get("PERIOD_LABEL"), "completeness": s.get("COMPLETENESS"),
                      "freshness_days": s.get("FRESHNESS_DAYS"), "usd_at_stake": s.get("USD_AT_STAKE"),
                      "comparisons": s.get("COMPARISONS"), "trend": s.get("TREND"), "why": s.get("WHY_TECHNICAL"),
                      "newer_filling_in": s.get("NEWER_PERIODS_FILLING_IN"),
                      "series": s.get("SERIES") or [], "forecast": fc.get(k.KPI_ID)})
    _write("kpis.json", klist)

    # ---- warnings
    wl = []
    for w in warn.sort_values(["SEVERITY"], key=lambda s: s.map({"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4})).itertuples():
        wl.append({"id": w.WARNING_ID, "key": w.DEDUP_KEY, "status": w.STATUS, "first_seen": str(w.FIRST_SEEN)[:10],
                   "severity": w.SEVERITY, "kind": w.KIND, "title": w.TITLE, "reason": w.BUSINESS_REASON,
                   "impact": w.IMPACT_TEXT, "todo": w.WHAT_TO_DO, "external": w.EXTERNAL_SIGNAL,
                   "confidence": w.REASON_CONFIDENCE, "departments": _j(w.DEPARTMENTS), "downstream": _j(w.DOWNSTREAM),
                   "usd": w.USD_AT_STAKE, "timing": w.TIMING, "evidence": _j(w.EVIDENCE)})
    _write("warnings.json", wl)

    # ---- outlook
    _write("outlook.json", [{"metric": r.METRIC, "name": r.BUSINESS_NAME, "period": r.PERIOD, "point": r.POINT,
                             "lower": r.LOWER, "upper": r.UPPER, "last_year": r.SAME_PERIOD_LAST_YEAR, "unit": r.UNIT,
                             "basis": r.BASIS} for r in outlook.itertuples()])

    # ---- catalog and departments
    cmap = {}
    for r in cols.itertuples():
        cmap.setdefault(r.TABLE_FQN, {})[r.ROLE] = int(r.N)
    tl = [{"fqn": t.TABLE_FQN, "schema": t.SCHEMA_NAME, "name": t.TABLE_NAME, "business_name": t.BUSINESS_NAME,
           "description": t.DESCRIPTION, "role": t.TABLE_ROLE, "department": t.DEPARTMENT, "grain": t.GRAIN,
           "rows": t.ROW_COUNT, "event_date": t.EVENT_DATE, "arrival_date": t.ARRIVAL_DATE,
           "superseded_by": t.SUPERSEDED_BY, "kpi_source": bool(t.IS_KPI_SOURCE) if pd.notna(t.IS_KPI_SOURCE) else False,
           "min_date": t.MIN_EVENT_DATE, "max_date": t.MAX_EVENT_DATE, "columns": cmap.get(t.TABLE_FQN, {}),
           "kpis": int((kpis.TABLE_FQN == t.TABLE_FQN).sum())} for t in tables.itertuples()]
    deps = {}
    for t in tl:
        d = deps.setdefault(t["department"], {"name": t["department"], "tables": [], "kpis": 0, "warnings": 0})
        d["tables"].append(t["fqn"])
        d["kpis"] += t["kpis"]
    for w in wl:
        if w["status"] != "resolved":
            for d in w["departments"] or []:
                if d in deps:
                    deps[d]["warnings"] += 1
    _write("catalog.json", {"tables": tl, "departments": sorted(deps.values(), key=lambda d: -d["warnings"])})

    # ---- impact graph (business tables only; mechanical KPI links collapsed)
    keep = set(tables[tables.TABLE_ROLE.isin(["fact", "span", "mart", "dimension", "bridge"])].TABLE_FQN)
    el = []
    for e in edges.itertuples():
        ev = _j(e.EVIDENCE) or {}
        if e.KIND == "data_flow" and e.CONFIDENCE != "low" and e.FROM_NODE in keep and e.TO_NODE in keep:
            el.append({"from": e.FROM_NODE, "to": e.TO_NODE, "kind": "load", "label": "loads into"})
        elif e.KIND == "process_chain" and e.FROM_NODE in keep and e.TO_NODE in keep:
            el.append({"from": e.FROM_NODE, "to": e.TO_NODE, "kind": "process", "label": ev.get("text"),
                       "lag": e.LAG_DAYS, "strength": e.STRENGTH})
        elif e.KIND == "foreign_key" and e.FROM_NODE in keep and e.TO_NODE in keep and \
                dict(zip(tables.TABLE_FQN, tables.TABLE_ROLE)).get(e.FROM_NODE) in ("fact", "dimension", "span"):
            el.append({"from": e.FROM_NODE, "to": e.TO_NODE, "kind": "key", "label": f"{e.TO_COLUMN} -> {e.FROM_COLUMN}"})
    links = []
    for e in edges[edges.KIND == "kpi_link"].itertuples():
        ev = _j(e.EVIDENCE) or {}
        if ev.get("mechanical"):
            continue
        links.append({"from": e.FROM_NODE, "to": e.TO_NODE, "r": e.STRENGTH, "lag_days": e.LAG_DAYS,
                      "leads": ev.get("leads"), "n": ev.get("n"), "pathway": ev.get("pathway")})
    used = {x["from"] for x in el} | {x["to"] for x in el}
    _write("graph.json", {"nodes": [{"id": t["fqn"], "label": t["business_name"], "department": t["department"],
                                     "role": t["role"], "schema": t["schema"], "kpi_source": t["kpi_source"]}
                                    for t in tl if t["fqn"] in used],
                          "edges": el, "kpi_links": links})

    # ---- processes
    _write("process.json", [{"id": c.CHAIN_ID, "parent": tname.get(c.PARENT_TABLE), "child": tname.get(c.CHILD_TABLE),
                             "parent_table": c.PARENT_TABLE, "child_table": c.CHILD_TABLE, "segment": c.PARENT_SEGMENT,
                             "n": c.N_PARENT, "conversion": c.CONVERSION, "p50": c.LAG_P50, "p90": c.LAG_P90,
                             "amount": c.CHILD_AMOUNT_PER_PARENT, "text": c.BUSINESS_TEXT,
                             "department": tdept.get(c.PARENT_TABLE)} for c in chains.itertuples()])

    # ---- data health and accuracy
    cl = {}
    for r in comp.itertuples():
        cl.setdefault((r.TABLE_FQN, r.CURVE_KIND), {"table": r.TABLE_FQN, "name": tname.get(r.TABLE_FQN), "kind": r.CURVE_KIND,
                                                    "source": r.CURVE_SOURCE, "by_day": {}})["by_day"][int(r.LAG_DAYS)] = r.CUM_SHARE
    _write("data_health.json", {"checks": [{"id": r.CHECK_ID, "table": r.TABLE_FQN, "name": tname.get(r.TABLE_FQN),
                                            "type": r.CHECK_TYPE, "failed": r.FAILED, "checked": r.CHECKED, "share": r.SHARE,
                                            "severity": r.SEVERITY, "detail": _j(r.DETAIL)} for r in dq.itertuples()],
                                "completeness": list(cl.values()),
                                "builds": [{"table": b.TABLE_FQN, "name": tname.get(b.TABLE_FQN), "mode": b.MODE,
                                            "built": str(b.BUILT_TS)[:19], "reconciled": str(b.RECONCILED_TS)[:19],
                                            "reconcile_ok": b.RECONCILE_OK, "detail": b.RECONCILE_DETAIL}
                                           for b in builds.itertuples()]})
    fq = json.loads((OUT / "forecast_quality.json").read_text()) if (OUT / "forecast_quality.json").exists() else {}
    ob = []
    if (OUT / "order_book_checks.jsonl").exists():
        ob = [json.loads(l) for l in (OUT / "order_book_checks.jsonl").read_text().splitlines() if l.strip()]
    _write("accuracy.json", {"forecasts": [{"id": k, "name": dict(zip(kpis.KPI_ID, kpis.BUSINESS_NAME)).get(k), **v}
                                           for k, v in fq.items()], "order_book": ob[-200:]})
    _write("meta.json", {"database": DB, "as_of": str(today), "generated_at": datetime.utcnow().isoformat()[:19] + "Z",
                         "run_id": state.get("run_id"), "tables": len(tables), "kpis": len(kpis),
                         "warnings": {s: int((warn.SEVERITY == s).sum()) for s in ("critical", "high", "medium", "low", "info")},
                         "states": pd.Series([s.get("STATE") for s in state["kpis"]]).value_counts().to_dict(),
                         "steps": [{"step": r.STEP, "status": r.STATUS, "seconds": r.SECONDS, "finished": str(r.FINISHED_TS)[:19],
                                    "detail": r.DETAIL} for r in runlog.itertuples()]})
    return {"written": sorted(p.name for p in WEB.glob("*.json"))}
