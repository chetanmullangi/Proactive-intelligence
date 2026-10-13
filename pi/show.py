"""Readable listings of engine results, sized for an agent's context (no SQL needed)."""
from __future__ import annotations

import json

import pandas as pd

from .config import OUT, RS, as_of
from .db import query_df, session

pd.set_option("display.width", 260)
pd.set_option("display.max_colwidth", 90)
pd.set_option("display.max_rows", 500)


def _p(df):
    print(df.to_string(index=False) if len(df) else "(none)")


def run(what: str, flt: str | None):
    today = as_of()
    with session() as conn:
        q = lambda sql: query_df(conn, sql)
        if what == "tables":
            _p(q(f"""select replace(TABLE_FQN,'HEALTH_CARE.','') t, TABLE_ROLE role, ROW_COUNT rows_, DEPARTMENT, BUSINESS_NAME,
                     EVENT_DATE, ARRIVAL_DATE, replace(SUPERSEDED_BY,'HEALTH_CARE.','') superseded_by, IS_KPI_SOURCE kpi, GRAIN
                     from {RS}.PI_TABLE order by IS_KPI_SOURCE desc, TABLE_ROLE, 1"""))
        elif what == "columns":
            _p(q(f"""select COLUMN_NAME, DATA_TYPE, ROLE, DATE_ROLE, NON_NULL, DISTINCT_APPROX, MIN_VALUE, MAX_VALUE,
                     left(TOP_VALUES, 120) top from {RS}.PI_COLUMN where TABLE_FQN ilike '%{flt}' order by ORDINAL"""))
        elif what == "kpis":
            w = f"where k.TABLE_FQN ilike '%{flt}'" if flt else ""
            _p(q(f"""select k.KPI_ID, k.KIND, k.UNIT, k.NATIVE_GRAIN g, k.DIRECTION_GOOD good, k.TAGS, k.BUSINESS_NAME,
                     s.STATE, round(s.Z, 1) z from {RS}.PI_KPI k left join {RS}.PI_KPI_STATE s
                     on s.KPI_ID = k.KPI_ID and s.AS_OF = '{today}' {w} order by k.TABLE_FQN, k.KPI_ID"""))
        elif what == "chains":
            _p(q(f"select N_PARENT n, CONVERSION conv, LAG_P50 p50, LAG_P90 p90, CHILD_AMOUNT_PER_PARENT amt, BUSINESS_TEXT from {RS}.PI_PROCESS_CHAIN"))
        elif what == "links":
            df = q(f"select FROM_NODE, TO_NODE, STRENGTH r, LAG_DAYS lag, EVIDENCE from {RS}.PI_EDGE where KIND = 'kpi_link'")
            df = df[[not json.loads(e).get("mechanical") for e in df.EVIDENCE]].drop(columns="EVIDENCE")
            df["FROM_NODE"] = df.FROM_NODE.str.replace("health_care.", "")
            df["TO_NODE"] = df.TO_NODE.str.replace("health_care.", "")
            _p(df.sort_values("R", key=abs, ascending=False).head(60))
        elif what == "checks":
            _p(q(f"""select CHECK_TYPE, replace(TABLE_FQN,'HEALTH_CARE.','') t, FAILED, CHECKED, SEVERITY, left(DETAIL, 140) detail
                     from {RS}.PI_DQ_RESULT where AS_OF = '{today}' and FAILED > 0 order by SEVERITY, CHECK_TYPE"""))
        elif what == "findings":
            for f in json.loads((OUT / "findings.json").read_text())[:40]:
                print(f"#{f['RANK']} [{f['KIND']}] {f['SUBJECT_ID']} score {f['SCORE']:.1f} usd {f['USD_AT_STAKE']}")
                print("   ", f["TECHNICAL_SUMMARY"][:300])
                for c in json.loads(f["CANDIDATE_CAUSES"])[:3]:
                    seg = c.get("top_segment") or {}
                    print(f"    cause {c['family']}: {c.get('dimension', '')} {seg.get('label') or seg.get('value') or ''} "
                          f"share {c.get('share_of_change')} normal {c.get('normal_share')}")
        elif what == "warnings":
            df = q(f"""select WARNING_ID, DEDUP_KEY, STATUS, SEVERITY, KIND, TITLE, BUSINESS_REASON, WHAT_TO_DO,
                       REASON_CONFIDENCE conf, DEPARTMENTS, USD_AT_STAKE usd, TIMING from {RS}.PI_WARNING where AS_OF = '{today}'
                       order by case SEVERITY when 'critical' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end""")
            for r in df.itertuples():
                if flt and flt not in (r.KIND, r.SEVERITY):
                    continue
                print(f"{r.WARNING_ID} [{r.SEVERITY}/{r.KIND}/{r.STATUS}] {r.TITLE}")
                print(f"    reason: {r.BUSINESS_REASON}")
                print(f"    todo: {r.WHAT_TO_DO} | owners {r.DEPARTMENTS} | ${r.USD or 0:,.0f} | {r.TIMING} | conf {r.CONF}")
                print(f"    key: {r.DEDUP_KEY}")
        elif what == "outlook":
            _p(q(f"""select METRIC, PERIOD, round(POINT, 3) point, round(LOWER, 3) lower_, round(UPPER, 3) upper_,
                     round(SAME_PERIOD_LAST_YEAR, 3) last_year, UNIT, left(BASIS, 80) basis from {RS}.PI_OUTLOOK
                     where AS_OF = '{today}' order by PERIOD, METRIC"""))
        elif what == "forecasts":
            for k, v in json.loads((OUT / "forecast_quality.json").read_text()).items():
                print(f"{k}: {v['method']} skill vs naive {v['skill_vs_naive']}")
        elif what == "overrides-template":
            t = q(f"select TABLE_FQN, BUSINESS_NAME, DEPARTMENT, TABLE_ROLE from {RS}.PI_TABLE where IS_KPI_SOURCE order by 1")
            print("tables:")
            for r in t.itertuples():
                print(f"  {r.TABLE_FQN}:\n    business_name: {r.BUSINESS_NAME}\n    department: {r.DEPARTMENT}\n    description: ")
            print("kpis:")
            for r in q(f"select KPI_ID, BUSINESS_NAME, DIRECTION_GOOD from {RS}.PI_KPI order by 1").itertuples():
                print(f"  {r.KPI_ID}:\n    business_name: {r.BUSINESS_NAME}\n    direction_good: {r.DIRECTION_GOOD}")
        else:
            print("unknown: tables | columns TABLE | kpis [TABLE] | chains | links | checks | findings | warnings [kind] | outlook | forecasts | overrides-template")
