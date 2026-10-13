"""Layer 3 - the state of every KPI and the health of the data, from the daily summary (no raw rows).

Per KPI:
  - analysis grain from its native grain (daily data -> weeks, monthly -> months, yearly -> years)
  - completeness: recent periods still filling in (claims arrive weeks after the visit) are scaled to their expected
    final value when at least `min_completeness` has arrived, and marked "too early" otherwise
  - expected value for the last complete period: recent level x trend x (repeatable) seasonality
  - out-of-sample noise: the same method replayed on the previous periods; its own errors give the scale (robust z)
  - comparisons: last 7 days, last week, month-to-date, last month, quarter-to-date, year-to-date - each against
    the prior period and the same period last year, and each tested against how much that comparison normally moves
  - freshness: is data still arriving at its usual cadence?
  - dollars at stake for the movement
Data checks: future-dated records, source records missing from the warehouse, orphan keys, header-vs-line totals,
duplicate keys."""
from __future__ import annotations

import json
import re
from datetime import date, timedelta

import numpy as np
import pandas as pd
from scipy import stats

from .config import CONFIG, RS, as_of
from .db import insert_df, query_df, replace_rows, session

A = CONFIG["analysis"]
GRAIN = {"day": "week", "week": "week", "month": "month", "year": "year", None: "week"}


# ---------------------------------------------------------------------------------------------------- helpers
def period_start(d: pd.Series, grain: str) -> pd.Series:
    if grain == "week":
        return d - pd.to_timedelta(d.dt.weekday, unit="D")
    if grain == "month":
        return d.dt.to_period("M").dt.start_time
    if grain == "quarter":
        return d.dt.to_period("Q").dt.start_time
    return d.dt.to_period("Y").dt.start_time


def last_complete(today: date, grain: str) -> pd.Timestamp:
    t = pd.Timestamp(today)
    if grain == "week":
        return (t - pd.Timedelta(days=t.weekday())) - pd.Timedelta(days=7) if t.weekday() != 6 else t - pd.Timedelta(days=6)
    if grain == "month":
        return (t + pd.Timedelta(days=1)).to_period("M").start_time - pd.offsets.MonthBegin(1) \
            if (t + pd.Timedelta(days=1)).day != 1 else t.to_period("M").start_time
    return pd.Timestamp(year=t.year - 1 if t.month < 12 or t.day < 31 else t.year, month=1, day=1)


def robust_scale(x: np.ndarray) -> float:
    x = x[np.isfinite(x)]
    if len(x) < 4:
        return np.nan
    mad = np.median(np.abs(x - np.median(x))) * 1.4826
    if mad == 0:
        mad = np.std(x) or np.nan
    return float(mad)


def theil_sen(y: np.ndarray) -> float:
    y = y[np.isfinite(y)]
    if len(y) < 4:
        return 0.0
    return float(stats.theilslopes(y, np.arange(len(y)))[0])


def expected_at(vals: np.ndarray, i: int, season: int | None, use_season: bool) -> float:
    """Expected value for position i using only vals[:i]: median of the last 8 + Theil-Sen trend from the last 26,
    times a seasonal index (same period one and two seasons back vs their own trailing medians) if repeatable."""
    hist = vals[:i]
    hist = hist[np.isfinite(hist)]
    if len(hist) < 6:
        return np.nan
    recent = vals[max(0, i - 8):i]
    lvl = np.nanmedian(recent)
    slope = theil_sen(vals[max(0, i - 26):i])
    exp = lvl + slope * (min(8, i) / 2 + 0.5)          # median sits ~4 periods back; project to i
    if use_season and season and i - season - 8 >= 0:
        idx = []
        for k in (1, 2):
            j = i - k * season
            if j - 8 >= 0 and np.isfinite(vals[j]):
                base = np.nanmedian(vals[j - 8:j])
                if base and np.isfinite(base) and base != 0:
                    idx.append(vals[j] / base)
        if idx:
            exp = exp * float(np.mean(idx))
    return float(exp)


def seasonality_repeatable(vals: np.ndarray, season: int) -> bool:
    """Do deviations from the trailing median repeat one season apart? (correlation of de-trended profiles)"""
    if season is None or len(vals) < 3 * season:
        return False
    dev = np.array([vals[i] / np.nanmedian(vals[max(0, i - 8):i]) - 1 if i >= 8 and np.nanmedian(vals[i - 8:i]) else np.nan
                    for i in range(len(vals))])
    a, b = dev[season:], dev[:-season]
    m = np.isfinite(a) & np.isfinite(b)
    if m.sum() < season:
        return False
    r = np.corrcoef(a[m], b[m])[0, 1]
    return bool(r >= 0.3)


# ---------------------------------------------------------------------------------------------------- per KPI
def analyse_kpi(k: dict, daily: pd.DataFrame, comp: pd.DataFrame | None, today: date, money_per_row: float | None) -> dict:
    grain = GRAIN.get(k.get("NATIVE_GRAIN"), "week")
    additive = bool(k["ADDITIVE"])
    is_level = k["KIND"] == "active"
    d = daily.copy()
    d["D"] = pd.to_datetime(d.D)
    d = d[d.D <= pd.Timestamp(today)]
    res = {"KPI_ID": k["KPI_ID"], "GRAIN": grain}
    if d.empty:
        return {**res, "STATE": "no_data", "WHY_TECHNICAL": "no rows on or before the analysis date"}
    # completeness: counts/sums are scaled by the share already arrived; status rates wait until outcomes are decided
    status_rate = k["KIND"] == "rate" and "\" = '" in str(k["NUM_EXPR"])
    curve, thresh = None, A["min_completeness"]
    if comp is not None and not comp.empty and k["KIND"] in ("count", "sum", "rate", "avg"):
        lagged_measure = any(w in str(k["NUM_EXPR"]).upper() for w in ("PAID", "ALLOWED", "BILLED", "CLAIM", "COST",
                                                                         "ADMIT", "VISIT", "SCRIPT", "SURGERY", "STUDY"))
        is_mart = k.get("TABLE_ROLE") == "mart"
        same_date = comp[[(str(e) in str(k["DATE_EXPR"]) or e == "(period)") and (lagged_measure or not is_mart)
                          for e in comp.EVENT_DATE]]
        want = "decision" if status_rate else "arrival"
        col = re.search(r'"([A-Z0-9_]+)"', str(k["NUM_EXPR"]))
        c = same_date.iloc[0:0]
        if k["KIND"] == "sum" and col:
            stem = col.group(1).replace("TOTAL_", "")
            for kind in same_date.CURVE_KIND.unique():
                if kind.startswith("arrival:") and kind[8:].replace("TOTAL_", "") == stem:
                    c = same_date[same_date.CURVE_KIND == kind]
                    break
        if c.empty:
            c = same_date[same_date.CURVE_KIND == want]
        if c.empty and status_rate:
            c = same_date[same_date.CURVE_KIND == "arrival"]
        if not c.empty:
            curve = c.sort_values("LAG_DAYS")
            thresh = 0.9 if status_rate and (c.CURVE_KIND.iloc[0] == "decision") else A["min_completeness"]

    def cfun(days_: pd.DatetimeIndex) -> np.ndarray:
        if curve is None:
            return np.ones(len(days_))
        age = np.asarray((pd.Timestamp(today) - days_).days)
        return np.interp(age, curve.LAG_DAYS.to_numpy(), curve.CUM_SHARE.to_numpy(),
                         left=float(curve.CUM_SHARE.iloc[0]), right=1.0)
    d["COMP"] = cfun(pd.DatetimeIndex(d.D))
    # freshness: does data keep arriving at its usual cadence?
    has = d[(d.N_ROWS.fillna(1) > 0) & (d.NUM.abs() + d.DEN.fillna(0).abs() > 0)].D.sort_values()
    last = has.max() if len(has) else None
    gaps = has.diff().dt.days.dropna()
    cadence = float(gaps[-60:].median()) if len(gaps) else 1.0
    eff_today = pd.Timestamp(today)
    if comp is not None and not comp.empty and k["KIND"] in ("count", "sum", "rate", "avg"):
        arr = comp[(comp.CURVE_KIND == "arrival").to_numpy() & np.array([str(e) in str(k["DATE_EXPR"]) for e in comp.EVENT_DATE])]
        if not arr.empty:
            half = arr[arr.CUM_SHARE >= 0.5].LAG_DAYS.min()
            if pd.notna(half):
                eff_today = pd.Timestamp(today) - pd.Timedelta(days=int(half))
    stale_days = max(0, (eff_today - last).days) if last is not None else None
    recent = has[has >= eff_today - pd.Timedelta(days=60)]          # the current rhythm, not last year's
    p_day = min(0.999, len(recent.dt.normalize().unique()) / 60) if len(recent) else 0.0
    p_gap = (1 - p_day) ** stale_days if stale_days is not None and p_day > 0 else 1.0
    is_stale = bool(stale_days is not None and k["KIND"] not in ("active", "starts", "ends") and p_day > 0
                    and stale_days >= 3 and p_gap < 0.001)
    # periods
    d["P"] = period_start(d.D, grain)
    g = d.groupby("P").agg(NUM=("NUM", "sum"), DEN=("DEN", "sum"), DAYS=("D", "nunique"))
    full = pd.date_range(g.index.min(), last_complete(today, grain), freq={"week": "W-MON", "month": "MS", "year": "YS"}[grain])
    g = g.reindex(full)
    g["NUM"] = g.NUM.fillna(0)
    step = {"week": pd.DateOffset(days=7), "month": pd.DateOffset(months=1), "year": pd.DateOffset(years=1)}[grain]
    g["COMP"] = [float(np.mean(cfun(pd.date_range(p0, min(p0 + step - pd.Timedelta(days=1), pd.Timestamp(today))))))
                 for p0 in full]
    mature = (g.COMP >= thresh).to_numpy()
    if additive:
        raw = g.NUM.to_numpy(dtype=float)
        val = np.where(mature, raw / g.COMP.to_numpy(), np.nan)
    else:
        raw = (g.NUM / g.DEN.replace(0, np.nan)).to_numpy(dtype=float)
        val = np.where(mature, raw, np.nan)
    if is_level:
        val = (g.NUM / g.DAYS.replace(0, np.nan)).to_numpy(dtype=float)
        mature = np.isfinite(val)
    season = {"week": 52, "month": 12, "year": None}[grain]
    n = len(val)
    res.update({"PERIODS": n, "LAST_PERIOD": str(full[-1].date()) if n else None, "FRESHNESS_DAYS": stale_days,
                "P_GAP": p_gap,
                "IS_STALE": is_stale, "CADENCE_DAYS": cadence})
    if n < 10 or np.isfinite(val).sum() < 10:
        res.update({"STATE": "insufficient_history", "WHY_TECHNICAL": f"{np.isfinite(val).sum()} usable {grain}s (need 10)"})
        res["COMPARISONS"] = comparisons(d, today, additive, is_level, thresh)
        return res
    use_season = seasonality_repeatable(val, season) if season else False
    tested = np.where(mature & np.isfinite(val))[0]
    i = int(tested[-1]) if len(tested) else n - 1
    raw_val = val.copy()
    e1 = np.array([expected_at(val, j, season, use_season) if j >= 12 else np.nan for j in range(n)])
    r1 = val - e1
    s1 = robust_scale(r1[max(12, i - A["baseline_periods"]):i])
    if s1 and np.isfinite(s1):
        out_mask = np.abs(r1) >= A["attention_z"] * s1
        out_mask[i] = False                          # never clean the period under test
        val = np.where(out_mask & np.isfinite(e1), e1, val)
    cleaned = int(np.nansum(out_mask)) if s1 and np.isfinite(s1) else 0
    skipped_recent = n - 1 - i                    # recent periods still filling in (reported, not judged)
    actual, comp_last = raw_val[i], float(g.COMP.iloc[i])
    expected = expected_at(val, i, season, use_season)
    # replay the method on the previous periods to learn its real error size (out of sample)
    back = [raw_val[j] - expected_at(val, j, season, use_season) for j in range(max(12, i - A["baseline_periods"]), i)
            if not (cleaned and out_mask[j])]
    scale = robust_scale(np.array(back))
    z = (actual - expected) / scale if scale and np.isfinite(scale) and np.isfinite(actual) and np.isfinite(expected) else np.nan
    # persistence: how many recent periods in a row sit on the same side beyond the watch line
    run_len = 0
    for j in range(i, max(12, i - 12), -1):
        e = expected_at(val, j, season, use_season)
        zz = (raw_val[j] - e) / scale if scale else np.nan
        if np.isfinite(zz) and abs(zz) >= A["watch_z"] and np.sign(zz) == np.sign(z):
            run_len += 1
        else:
            break
    state = "normal"
    if not np.isfinite(actual):
        state = "too_early"
    elif np.isfinite(z) and abs(z) >= A["attention_z"]:
        state = "attention"
    elif np.isfinite(z) and abs(z) >= A["watch_z"]:
        state = "watch"
    mc = A["min_change"]
    if state in ("watch", "attention") and np.isfinite(expected):
        if k["UNIT"] == "share":
            small = abs(actual - expected) < mc["rate_points"]
        else:
            small = abs(actual - expected) < (mc["level"] if is_level else mc["relative"]) * max(abs(expected), 1e-9)
        if small:
            state = "normal"                       # unusual for this very steady series, but too small to matter
    if is_stale:
        state = "stale"
    direction = "up" if np.isfinite(z) and z > 0 else ("down" if np.isfinite(z) and z < 0 else "flat")
    good = k.get("DIRECTION_GOOD") or "neutral"
    polarity = "neutral" if good == "neutral" or direction == "flat" else ("good" if good == direction else "bad")
    # trend over the last 13 and 52 periods, % of level per period
    tr = {}
    for w in (13, 52):
        seg = raw_val[max(0, n - w):n]
        seg = seg[np.isfinite(seg)]
        if len(seg) >= 8:
            sl = theil_sen(seg)
            tau, p = stats.kendalltau(np.arange(len(seg)), seg)
            lvl = np.median(seg) or np.nan
            tr[f"last_{w}"] = {"pct_per_period": round(100 * sl / lvl, 3) if lvl else None,
                               "significant": bool(p < 0.05), "kendall_tau": round(float(tau), 3)}
    # dollars at stake
    delta = actual - expected if np.isfinite(actual) and np.isfinite(expected) else np.nan
    usd = None
    if np.isfinite(delta):
        if k["UNIT"] == "USD":
            usd = abs(delta)
        elif k["KIND"] == "count" and money_per_row:
            usd = abs(delta) * money_per_row
        elif k["KIND"] == "rate" and money_per_row:
            usd = abs(delta) * float(g.DEN.iloc[i] or 0) * money_per_row
    severity = (abs(z) if np.isfinite(z) else 0) * (1 + 0.15 * max(0, run_len - 1))
    lower = expected - A["watch_z"] * scale if np.isfinite(scale) else None
    upper = expected + A["watch_z"] * scale if np.isfinite(scale) else None
    if k["UNIT"] in ("count", "USD") and lower is not None:
        lower = max(0.0, lower)
    why = (f"{grain} of {full[i].date()}: actual {actual:,.4g} vs expected {expected:,.4g} (robust z {z:+.2f}, "
           f"noise scale {scale:,.4g} from {len(back)} replayed {grain}s); seasonality {'used' if use_season else 'not repeatable'}; "
           f"{run_len} consecutive {grain}(s) beyond the watch line; completeness {comp_last:.0%}; "
           f"{skipped_recent} newer {grain}(s) still filling in; {cleaned} earlier outlier {grain}(s) set aside") if np.isfinite(z) else \
        f"not testable: actual {actual}, expected {expected}, scale {scale}"
    res.update({"STATE": state, "DIRECTION": direction, "POLARITY": polarity, "Z": z, "SEVERITY": severity,
                "ACTUAL": actual, "EXPECTED": expected, "LOWER": lower, "UPPER": upper, "COMPLETENESS": comp_last,
                "RUN_LENGTH": run_len, "SEASONAL": use_season, "NEWER_PERIODS_FILLING_IN": skipped_recent, "TREND": tr, "USD_AT_STAKE": usd,
                "WHY_TECHNICAL": why, "PERIOD_LABEL": f"{grain} starting {full[i].date()}",
                "SERIES": [{"p": str(full[j].date()), "v": None if not np.isfinite(raw_val[j]) else round(float(raw_val[j]), 6),
                            "raw": None if not np.isfinite(raw[j]) else round(float(raw[j]), 6),
                            "outlier": bool(cleaned and out_mask[j]),
                            "c": round(float(g.COMP.iloc[j]), 3)} for j in range(max(0, n - 104), n)]})
    res["COMPARISONS"] = comparisons(d, today, additive, is_level, thresh)
    res["_full"] = {"periods": full, "value": raw_val, "clean": val, "raw": raw, "mature": mature,
                    "comp": g.COMP.to_numpy(), "grain": grain, "season": season, "outliers_set_aside": cleaned}
    return res


def comparisons(d: pd.DataFrame, today: date, additive: bool, is_level: bool, thresh: float = 0.5) -> dict:
    """Window comparisons, completeness-adjusted, each with how unusual the change is versus its own history."""
    s = d.set_index("D")[["NUM", "DEN", "COMP"]].copy()
    idx = pd.date_range(s.index.min(), pd.Timestamp(today))
    s = s.groupby(level=0).sum(min_count=1).reindex(idx)
    s["NUM"] = s.NUM.fillna(0)
    s["DEN"] = s.DEN.fillna(0)
    s["COMP"] = s.COMP.fillna(1.0)
    cn, cd = s.NUM.cumsum().to_numpy(), s.DEN.cumsum().to_numpy()
    comp = s.COMP.to_numpy()
    days = s.index

    def win(end_i, length):
        a = end_i - length
        if a < -1 or end_i < 0:
            return np.nan
        num = cn[end_i] - (cn[a] if a >= 0 else 0)
        den = cd[end_i] - (cd[a] if a >= 0 else 0)
        c = comp[max(a + 1, 0):end_i + 1].mean()
        if is_level:
            return num / length
        if c < thresh:
            return np.nan
        if additive:
            return num / c
        return num / den if den else np.nan

    t = pd.Timestamp(today)
    end = len(days) - 1
    out = {}
    specs = {
        "last_7_days": (7, 7, 364),
        "last_28_days": (28, 28, 364),
    }
    for name, (length, prior_gap, ly_gap) in specs.items():
        cur = win(end, length)
        for vs, gap in (("prior", prior_gap), ("last_year", ly_gap)):
            base = win(end - gap, length)
            hist = []
            for back in range(7, 7 * 104, 7):
                c2, b2 = win(end - back, length), win(end - back - gap, length)
                if np.isfinite(c2) and np.isfinite(b2) and b2:
                    hist.append(c2 / b2 - 1)
            ch = cur / base - 1 if np.isfinite(cur) and np.isfinite(base) and base else np.nan
            sc = robust_scale(np.array(hist)) if len(hist) >= 8 else np.nan
            med = float(np.median(hist)) if hist else 0.0
            out[f"{name}_vs_{vs}"] = {"current": _r(cur), "base": _r(base), "change_pct": _r(100 * ch),
                                      "typical_abs_change_pct": _r(100 * sc), "unusual_z": _r((ch - med) / sc) if sc else None}
    # calendar windows: month-to-date, last complete month, quarter-to-date, year-to-date (vs prior and last year)
    def cal(start: pd.Timestamp, stop: pd.Timestamp):
        i0, i1 = days.searchsorted(start), days.searchsorted(stop, side="right") - 1
        if i1 < 0 or i0 > i1:
            return np.nan
        return win(i1, i1 - i0 + 1)

    ms = t.to_period("M").start_time
    pm_s = (ms - pd.offsets.MonthBegin(1))
    qs = t.to_period("Q").start_time
    ys = t.to_period("Y").start_time
    n_into = (t - ms).days
    calendar = {
        "month_to_date": ((ms, t), (pm_s, pm_s + pd.Timedelta(days=n_into)), (ms - pd.DateOffset(years=1), t - pd.DateOffset(years=1))),
        "last_month": ((pm_s, ms - pd.Timedelta(days=1)), (pm_s - pd.offsets.MonthBegin(1), pm_s - pd.Timedelta(days=1)),
                       (pm_s - pd.DateOffset(years=1), ms - pd.Timedelta(days=1) - pd.DateOffset(years=1))),
        "quarter_to_date": ((qs, t), (qs - pd.offsets.QuarterBegin(1, startingMonth=1), qs - pd.offsets.QuarterBegin(1, startingMonth=1) + (t - qs)),
                            (qs - pd.DateOffset(years=1), t - pd.DateOffset(years=1))),
        "year_to_date": ((ys, t), (None, None), (ys - pd.DateOffset(years=1), t - pd.DateOffset(years=1))),
    }
    for name, (cur_w, prior_w, ly_w) in calendar.items():
        cur = cal(*cur_w)
        rec = {"current": _r(cur), "window": f"{cur_w[0].date()}..{cur_w[1].date()}"}
        for vs, w in (("prior", prior_w), ("last_year", ly_w)):
            if w[0] is None:
                continue
            b = cal(*w)
            rec[f"vs_{vs}"] = {"base": _r(b), "change_pct": _r(100 * (cur / b - 1)) if np.isfinite(cur) and np.isfinite(b) and b else None}
        out[name] = rec
    return out


def _r(v, nd=4):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return None if not np.isfinite(v) else round(v, nd)


# ---------------------------------------------------------------------------------------------------- data checks
def data_checks(conn, tables: pd.DataFrame, cols: pd.DataFrame, edges: pd.DataFrame, today: date) -> list[dict]:
    out = []
    tm = tables.set_index("TABLE_FQN")
    # 1. business dates in the future (events, receipts, decisions and payments cannot have happened yet)
    #    checked on the business-layer copy only (a source-system copy would report the same rows twice)
    for fqn in tables[(tables.TABLE_ROLE == "fact") & tables.SUPERSEDED_BY.isna()].TABLE_FQN:
        dc = cols[(cols.TABLE_FQN == fqn) & (cols.ROLE == "date") & cols.DATE_ROLE.isin(["event", "arrival", "decision", "payment"])
                  & cols.DATA_TYPE.isin(["DATE", "TIMESTAMP_NTZ", "TIMESTAMP_LTZ", "TIMESTAMP_TZ"])]
        if dc.empty:
            continue
        sel = ", ".join(f'count_if("{c}"::date > \'{today + timedelta(days=1)}\') as f{i}, max("{c}")::date as m{i}'
                        for i, c in enumerate(dc.COLUMN_NAME))
        r = query_df(conn, f"select count(*) n, {sel} from {fqn}").iloc[0]
        for i, c in enumerate(dc.COLUMN_NAME):
            f = int(r[f"F{i}"] or 0)
            latest = pd.Timestamp(r[f"M{i}"]) if r[f"M{i}"] is not None else None
            role = dc.DATE_ROLE.iloc[i]
            scheduled = latest is not None and (
                (role == "payment" and latest <= pd.Timestamp(today + timedelta(days=14))) or
                (role == "arrival" and "POST" in c.upper() and latest <= pd.Timestamp(today + timedelta(days=60))))
            if f and scheduled:
                continue                         # a payment run or a posting already scheduled for the coming days
            if f:
                out.append({"CHECK_ID": f"future:{fqn}.{c}", "TABLE_FQN": fqn, "CHECK_TYPE": "future_date", "FAILED": f,
                            "CHECKED": int(r.N), "SEVERITY": "medium",
                            "DETAIL": json.dumps({"column": c, "latest": str(r[f'M{i}']), "role": dc.DATE_ROLE.iloc[i]})})
    # 1b. feed freshness: days since the last record arrived vs how often records normally arrive
    for t in tables[(tables.TABLE_ROLE == "fact") & (tables.IS_KPI_SOURCE == True)].itertuples():  # noqa: E712
        tc = cols[cols.TABLE_FQN == t.TABLE_FQN]
        roles_t = json.loads(t.DATE_ROLES) if isinstance(t.DATE_ROLES, str) else {}
        ev_role = roles_t.get(t.EVENT_DATE) if isinstance(t.EVENT_DATE, str) else None
        arrc = t.ARRIVAL_DATE if isinstance(t.ARRIVAL_DATE, str) else (
            t.EVENT_DATE if ev_role in ("arrival", "payment", "decision") else None)   # never a service/visit date
        if not arrc or tc[tc.COLUMN_NAME == arrc].DATA_TYPE.iloc[0] == "TEXT":
            continue
        r = query_df(conn, f"""select max("{arrc}")::date last_arrival,
              count(distinct iff("{arrc}"::date between '{today - timedelta(days=90)}' and '{today}', "{arrc}"::date, null)) days_with
              from {t.TABLE_FQN} where "{arrc}"::date <= '{today}'""").iloc[0]
        if r.LAST_ARRIVAL is None:
            continue
        gap = (pd.Timestamp(today) - pd.Timestamp(r.LAST_ARRIVAL)).days
        p_day = min(0.999, (r.DAYS_WITH or 0) / 90)
        p_gap = (1 - p_day) ** gap if p_day > 0 else 1.0
        if gap >= 2 and p_gap < 0.001:
            out.append({"CHECK_ID": f"feed_stale:{t.TABLE_FQN}", "TABLE_FQN": t.TABLE_FQN, "CHECK_TYPE": "feed_stale",
                        "FAILED": int(gap), "CHECKED": None, "SEVERITY": "high",
                        "DETAIL": json.dumps({"column": arrc, "last_arrival": str(r.LAST_ARRIVAL), "days_without_new_records": gap,
                                              "normal_share_of_days_with_records": round(p_day, 3)})})
    # 2. source records not (yet) in the warehouse copy - a load delay or a stuck feed
    for e in edges[(edges.KIND == "data_flow") & (edges.CONFIDENCE == "high")].itertuples():
        src, tgt = e.FROM_NODE, e.TO_NODE
        if tm.SUPERSEDED_BY.get(src) != tgt:
            continue
        pk = tm.PRIMARY_KEY.get(src)
        if not isinstance(pk, str) or tm.PRIMARY_KEY.get(tgt) != pk:
            continue
        if "CREATED_TS" not in set(cols[cols.TABLE_FQN == src].COLUMN_NAME):
            continue
        ev = tm.ARRIVAL_DATE.get(src) if isinstance(tm.ARRIVAL_DATE.get(src), str) else tm.EVENT_DATE.get(src)
        ev_ok = isinstance(ev, str) and cols[(cols.TABLE_FQN == src) & (cols.COLUMN_NAME == ev)].DATA_TYPE.iloc[0] != "TEXT"
        latest = f'max(iff(t."{pk}" is null, s."{ev}"::date, null))' if ev_ok else "null"
        r = query_df(conn, f"""select count(*) n, count_if(t."{pk}" is null) missing,
              count_if(t."{pk}" is null and s.CREATED_TS < dateadd(day, -2, current_timestamp())) missing_old,
              {latest} latest_missing
              from {src} s left join {tgt} t on t."{pk}" = s."{pk}" """).iloc[0]
        miss = int(r.MISSING or 0)
        out.append({"CHECK_ID": f"load_gap:{src}>{tgt}", "TABLE_FQN": tgt, "CHECK_TYPE": "load_gap", "FAILED": miss,
                    "CHECKED": int(r.N), "SEVERITY": "high" if (r.MISSING_OLD or 0) > 0 else ("medium" if miss else "info"),
                    "DETAIL": json.dumps({"source": src, "missing_older_than_2_days": int(r.MISSING_OLD or 0),
                                          "latest_missing_date": str(r.LATEST_MISSING)})})
    # 3. orphan keys (validated with orphans)
    for e in edges[(edges.KIND == "foreign_key")].itertuples():
        ev = json.loads(e.EVIDENCE)
        if isinstance(tm.SUPERSEDED_BY.get(e.TO_NODE), str):
            continue
        if ev.get("orphans"):
            out.append({"CHECK_ID": f"orphans:{e.TO_NODE}.{e.TO_COLUMN}", "TABLE_FQN": e.TO_NODE, "CHECK_TYPE": "orphan_key",
                        "FAILED": int(ev["orphans"]), "CHECKED": int(ev.get("child_non_null") or 0), "SEVERITY": "low",
                        "DETAIL": json.dumps({"column": e.TO_COLUMN, "parent": f"{e.FROM_NODE}.{e.FROM_COLUMN}"})})
    # 4. header totals vs the sum of their lines (TOTAL_X on the parent vs X on the child)
    for e in edges[(edges.KIND == "foreign_key") & (edges.CONFIDENCE == "high")].itertuples():
        P, C = e.FROM_NODE, e.TO_NODE
        if tm.TABLE_ROLE.get(P) != "fact" or tm.TABLE_ROLE.get(C) != "fact" or tm.PRIMARY_KEY.get(P) != e.FROM_COLUMN:
            continue
        if isinstance(tm.SUPERSEDED_BY.get(P), str):
            continue
        pm = cols[(cols.TABLE_FQN == P) & (cols.ROLE == "money")].COLUMN_NAME
        cm = set(cols[(cols.TABLE_FQN == C) & (cols.ROLE == "money")].COLUMN_NAME)
        pairs = [(p, p.replace("TOTAL_", "")) for p in pm if p.startswith("TOTAL_") and p.replace("TOTAL_", "") in cm]
        pairs += [(p, p.replace("TOTAL_PLAN_", "PLAN_")) for p in pm if p.startswith("TOTAL_PLAN_") and p.replace("TOTAL_PLAN_", "PLAN_") in cm]
        for pcol, ccol in pairs[:3]:
            r = query_df(conn, f"""select count(*) n, count_if(abs(coalesce(p."{pcol}",0) - coalesce(l.s,0)) > 0.05) bad,
                  max(abs(coalesce(p."{pcol}",0) - coalesce(l.s,0))) worst
                  from {P} p join (select "{e.TO_COLUMN}" k, sum("{ccol}") s from {C} group by 1) l on l.k = p."{e.FROM_COLUMN}" """).iloc[0]
            if int(r.BAD or 0):
                out.append({"CHECK_ID": f"reconcile:{P}.{pcol}~{C}.{ccol}", "TABLE_FQN": P, "CHECK_TYPE": "header_line_mismatch",
                            "FAILED": int(r.BAD), "CHECKED": int(r.N), "SEVERITY": "medium",
                            "DETAIL": json.dumps({"header": pcol, "lines": f"{C}.{ccol}", "worst_difference": float(r.WORST or 0)})})
    # 5. duplicate primary keys on KPI source tables
    for t in tables[tables.IS_KPI_SOURCE == True].itertuples():  # noqa: E712
        if isinstance(t.PRIMARY_KEY, str):
            r = query_df(conn, f'select count(*) n, count(distinct "{t.PRIMARY_KEY}") d from {t.TABLE_FQN}').iloc[0]
            if int(r.N) > int(r.D):
                out.append({"CHECK_ID": f"duplicate_key:{t.TABLE_FQN}", "TABLE_FQN": t.TABLE_FQN, "CHECK_TYPE": "duplicate_key",
                            "FAILED": int(r.N) - int(r.D), "CHECKED": int(r.N), "SEVERITY": "medium",
                            "DETAIL": json.dumps({"key": t.PRIMARY_KEY})})
    for o in out:
        o["SHARE"] = (o["FAILED"] / o["CHECKED"]) if o.get("CHECKED") else None
    return out


# ---------------------------------------------------------------------------------------------------- run
def run(run_id: str) -> dict:
    today = as_of()
    with session() as conn:
        kpis = query_df(conn, f"select * from {RS}.PI_KPI")
        daily = query_df(conn, f"select KPI_ID, D, NUM, DEN, N_ROWS from {RS}.PI_KPI_DAILY where D <= '{today}'")
        comp = query_df(conn, f"select * from {RS}.PI_COMPLETENESS")
        tables = query_df(conn, f"select * from {RS}.PI_TABLE")
        cols = query_df(conn, f"select * from {RS}.PI_COLUMN")
        edges = query_df(conn, f"select * from {RS}.PI_EDGE")
        dq = data_checks(conn, tables, cols, edges, today)
    # average money per row of each table (to price count and rate movements)
    mpr = {}
    for t, g in kpis.groupby("TABLE_FQN"):
        cnt = g[g.KIND == "count"].KPI_ID
        mon = g[(g.KIND == "sum") & (g.UNIT == "USD")]
        if len(cnt) and len(mon):
            recent = daily[pd.to_datetime(daily.D) >= pd.Timestamp(today - timedelta(days=365))]
            c = recent[recent.KPI_ID == cnt.iloc[0]].NUM.sum()
            m = recent[recent.KPI_ID == mon.KPI_ID.iloc[0]].NUM.sum()
            mpr[t] = (m / c) if c else None
    rows, local = [], []
    by = {k: g for k, g in daily.groupby("KPI_ID")}
    roles_by_table = dict(zip(tables.TABLE_FQN, tables.TABLE_ROLE))
    for k in kpis.to_dict("records"):
        k["TABLE_ROLE"] = roles_by_table.get(k["TABLE_FQN"])
        c = comp[comp.TABLE_FQN == k["TABLE_FQN"]]
        r = analyse_kpi(k, by.get(k["KPI_ID"], daily.iloc[0:0]), c if len(c) else None, today, mpr.get(k["TABLE_FQN"]))
        r.update({"BUSINESS_NAME": k["BUSINESS_NAME"], "UNIT": k["UNIT"], "TABLE_FQN": k["TABLE_FQN"],
                  "DEPARTMENT": k["DEPARTMENT"], "KIND": k["KIND"], "DIRECTION_GOOD": k["DIRECTION_GOOD"],
                  "TAGS": json.loads(k["TAGS"] or "[]")})
        local.append(r)
        rows.append({"RUN_ID": run_id, "AS_OF": today, "KPI_ID": k["KPI_ID"], "STATE": r.get("STATE"),
                     "DIRECTION": r.get("DIRECTION"), "SEVERITY": _r(r.get("SEVERITY")), "Z": _r(r.get("Z")),
                     "PERIOD_LABEL": r.get("PERIOD_LABEL"), "ACTUAL": _r(r.get("ACTUAL"), 6), "EXPECTED": _r(r.get("EXPECTED"), 6),
                     "LOWER": _r(r.get("LOWER"), 6), "UPPER": _r(r.get("UPPER"), 6), "COMPLETENESS": _r(r.get("COMPLETENESS")),
                     "COMPARISONS": json.dumps(r.get("COMPARISONS")), "TREND": json.dumps(r.get("TREND")),
                     "FRESHNESS_DAYS": r.get("FRESHNESS_DAYS"), "IS_STALE": r.get("IS_STALE"),
                     "USD_AT_STAKE": _r(r.get("USD_AT_STAKE"), 2), "WHY_TECHNICAL": r.get("WHY_TECHNICAL"),
                     "EVIDENCE": json.dumps({"grain": r.get("GRAIN"), "run_length": r.get("RUN_LENGTH"),
                                             "seasonal": r.get("SEASONAL"), "polarity": r.get("POLARITY"),
                                             "cadence_days": r.get("CADENCE_DAYS")})})
    sdf = pd.DataFrame(rows)
    dqdf = pd.DataFrame(dq)
    if len(dqdf):
        dqdf.insert(0, "AS_OF", today)
        dqdf.insert(0, "RUN_ID", run_id)
    with session() as conn:
        replace_rows(conn, f"{RS}.PI_KPI_STATE", sdf, where=f"AS_OF = '{today}'")
        if len(dqdf):
            replace_rows(conn, f"{RS}.PI_DQ_RESULT", dqdf[["RUN_ID", "AS_OF", "CHECK_ID", "TABLE_FQN", "CHECK_TYPE", "FAILED",
                                                           "CHECKED", "SHARE", "SEVERITY", "DETAIL"]], where=f"AS_OF = '{today}'")
    from .config import OUT
    OUT.mkdir(parents=True, exist_ok=True)
    clean = [{x: v for x, v in r.items() if not x.startswith("_")} for r in local]
    (OUT / "kpi_state.json").write_text(json.dumps({"as_of": str(today), "run_id": run_id, "kpis": clean}, default=_json, indent=1))
    (OUT / "data_checks.json").write_text(json.dumps(dq, default=_json, indent=1))
    st = sdf.STATE.value_counts().to_dict()
    return {"kpis": len(sdf), "states": st, "data_checks": len(dq),
            "data_issues": int(sum(1 for x in dq if x["SEVERITY"] in ("high", "medium") and x["FAILED"]))}


def _json(o):
    if isinstance(o, (np.floating,)):
        return None if not np.isfinite(o) else float(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, (pd.Timestamp, date)):
        return str(o)[:10]
    return str(o)
