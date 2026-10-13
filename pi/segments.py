"""Segment scan - movements hidden inside a total.

A drug shortage, a lab-denial rule, one provider's dispute or a storm in one state can move one segment sharply while
the company-wide total barely changes. For every KPI and every stored business dimension, compare the latest mature
4 weeks (or month) of each segment with (a) the 13 weeks (6 months) before it - a new change - and (b) the same
period last year - a sustained shift that the recent baseline has already absorbed.

Thousands of segments are tested, so a segment is reported only if it is both statistically strong (|z| >= 4 against
its own week-to-week variability, or a two-proportion test for shares) and material in business terms (counts,
dollars or share points), and only the strongest few per KPI are kept."""
from __future__ import annotations

import math
import re

import pandas as pd

from .config import RS
from .db import query_df

Z_MIN = 4.0
MIN_COUNT_CHANGE = 15         # records per recent window
MIN_USD_CHANGE = 25000        # dollars per recent window
MIN_RATE_POINTS = 0.03        # share points
MIN_RATE_N = 40               # records behind a share


def _windows(end: pd.Timestamp, grain: str):
    if grain == "month":
        r0 = end.to_period("M").start_time
        return r0, end, r0 - pd.DateOffset(months=6), r0 - pd.Timedelta(days=1), \
            r0 - pd.DateOffset(years=1), end - pd.DateOffset(years=1), 1, 6
    r0 = end - pd.Timedelta(days=27)
    b1 = r0 - pd.Timedelta(days=1)
    return r0, end, b1 - pd.Timedelta(days=13 * 7 - 1), b1, r0 - pd.Timedelta(days=364), end - pd.Timedelta(days=364), 4, 13


def scan_kpi(conn, k: dict, st: dict, money_per_row: float | None) -> list[dict]:
    if k["KIND"] not in ("count", "rate") or not st.get("PERIOD_LABEL"):
        return []                                      # dollar sums have no per-segment variance; counts are priced below
    grain = st.get("GRAIN", "week")
    if grain not in ("week", "month"):
        return []
    start = pd.Timestamp(re.search(r"(\d{4}-\d{2}-\d{2})", st["PERIOD_LABEL"]).group(1))
    end = start + (pd.Timedelta(days=6) if grain == "week" else pd.offsets.MonthEnd(0))
    r0, r1, b0, b1, l0, l1, rw, bw = _windows(end, grain)
    unit = "week" if grain == "week" else "month"
    own = set(re.findall(r'"([A-Z0-9_]+)"', str(k.get("NUM_EXPR") or "")))
    df = query_df(conn, f"""
        with w as (select DIM, VAL, date_trunc('{unit}', D) p, sum(NUM) n, sum(DEN) dn from {RS}.PI_KPI_DAILY_DIM
                   where KPI_ID = '{k["KPI_ID"]}' and D between '{l0.date()}' and '{r1.date()}' group by 1, 2, 3)
        select DIM, VAL,
               sum(iff(p between '{r0.date()}' and '{r1.date()}', n, 0)) rn, sum(iff(p between '{r0.date()}' and '{r1.date()}', dn, 0)) rd,
               sum(iff(p between '{b0.date()}' and '{b1.date()}', n, 0)) bn, sum(iff(p between '{b0.date()}' and '{b1.date()}', dn, 0)) bd,
               sum(iff(p between '{b0.date()}' and '{b1.date()}', n * n, 0)) bnn,
               sum(iff(p between '{l0.date()}' and '{l1.date()}', n, 0)) ln, sum(iff(p between '{l0.date()}' and '{l1.date()}', dn, 0)) ld
        from w group by 1, 2""")
    if df.empty:
        return []
    comp = st.get("COMPLETENESS") or 1.0
    out = []
    for r in df.itertuples():
        if k["KIND"] == "rate" and r.DIM.split(">")[-1] in own:
            continue                                       # a share is not explained by its own column
        if str(r.VAL) in ("(blank)", "", "None"):
            continue
        if k["KIND"] == "count" and any(w in r.DIM.split(">")[-1] for w in ("STATUS", "DECISION", "OUTCOME")):
            continue                                       # statuses change as records are processed - not a mix shift
        if k["KIND"] == "rate":
            if (r.RD or 0) < MIN_RATE_N:
                continue
            pr = r.RN / r.RD
            for label, n, d in (("vs_recent_baseline", r.BN, r.BD), ("vs_last_year", r.LN, r.LD)):
                if not d or d < MIN_RATE_N:
                    continue
                pb = n / d
                pool = (r.RN + n) / (r.RD + d)                  # pooled two-proportion test (safe at 0% / 100%)
                v = max(pool * (1 - pool), 1e-9)
                z = (pr - pb) / math.sqrt(v / r.RD + v / d)
                if abs(z) >= Z_MIN and abs(pr - pb) >= MIN_RATE_POINTS:
                    out.append({"dim": r.DIM, "val": r.VAL, "test": label, "current": pr, "baseline": pb, "z": z,
                                "change": pr - pb, "volume": r.RD,
                                "usd": abs(pr - pb) * r.RD * money_per_row if money_per_row else None})
                    break
        else:
            cur = (r.RN or 0) / comp / rw                    # per week (or month), completeness-adjusted
            base_mean = (r.BN or 0) / bw
            base_sd = math.sqrt(max((r.BNN or 0) / bw - base_mean ** 2, 0))
            floor = math.sqrt(max(base_mean, 1.0)) if k["UNIT"] == "count" else 0.05 * abs(base_mean) + 1
            sd = max(base_sd, floor)
            tests = [("vs_recent_baseline", base_mean)]
            if r.LN:
                tests.append(("vs_last_year", (r.LN or 0) / rw))
            for label, b in tests:
                z = (cur - b) / (sd / math.sqrt(rw))
                change = (cur - b) * rw
                material = abs(change) >= (MIN_USD_CHANGE if k["UNIT"] == "USD" else MIN_COUNT_CHANGE)
                big_relative = b * rw >= 20 and abs(cur / b - 1) >= 0.5 if b else False
                if material and (abs(z) >= Z_MIN or (big_relative and abs(z) >= 3.3)):
                    usd = abs(change) if k["UNIT"] == "USD" else (abs(change) * money_per_row if money_per_row else None)
                    out.append({"dim": r.DIM, "val": r.VAL, "test": label, "current": cur, "baseline": b, "z": z,
                                "change": change, "volume": r.RN, "usd": usd})
                    break
    for o in out:
        o.update({"kpi_id": k["KPI_ID"], "kind": k["KIND"], "unit": k["UNIT"], "grain": grain,
                  "window": f"{r0.date()}..{r1.date()}", "business_name": k["BUSINESS_NAME"],
                  "pct": (o["current"] / o["baseline"] - 1) * 100 if o["baseline"] else None})
    out.sort(key=lambda o: -(o["usd"] or 0) - 1000 * abs(o["z"]))
    return out[:5]
