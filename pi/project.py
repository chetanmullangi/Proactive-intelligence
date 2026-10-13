"""Layers 5 + 6 - what is about to happen.

  forecast    every KPI with enough history gets a forecast; five methods compete on a 26-period out-of-sample
              backtest (last value, recent average, trend, seasonal, LightGBM) and the winner is used, with
              intervals taken from its real backtest errors and its skill versus the naive guess reported.
              Periods still filling in (recent claims not yet received) get an estimated final value (nowcast).
  outlook     this quarter and next for the executive measures (premium revenue, medical and pharmacy cost,
              member months, membership) and what follows from them (total cost, medical loss ratio, cost per
              member per month), against the same quarter last year.
  order book  open items pushed through the learned process curves: adjudicated claims -> payments in the next
              weeks, denied claims -> appeals, authorizations -> claims; scheduled coverage starts and ends.
              A coming surge or drop versus the recent run-rate becomes a finding before it happens."""
from __future__ import annotations

import json
import math
from datetime import date, timedelta

import numpy as np
import pandas as pd

from . import analyze, impact
from .config import CONFIG, OUT, RS, as_of
from .db import query_df, replace_rows, session

F = CONFIG["forecast"]


# ---------------------------------------------------------------------------------------------------- methods
def _lgbm_features(y: np.ndarray, t: int, season: int | None):
    lv = np.nanmean(y[max(0, t - 8):t + 1])
    lags = [y[t - j] / lv - 1 if t - j >= 0 and lv else 0.0 for j in range(8)]
    seas = (y[t + 1 - season] / lv - 1) if season and t + 1 - season >= 0 and lv and np.isfinite(y[t + 1 - season]) else 0.0
    return lags + [seas], lv


def methods(y: np.ndarray, m: int, H: int, season: int | None, lgbm=None) -> dict[str, np.ndarray]:
    """Forecast y[m+1 .. m+H] using y[:m+1] only."""
    hist = y[:m + 1]
    ok = np.isfinite(hist)
    if ok.sum() < 8:
        return {}
    last = hist[ok][-1]
    recent = hist[max(0, m - 7):m + 1]
    mean8 = np.nanmean(recent)
    out = {"last_value": np.full(H, last), "recent_average": np.full(H, mean8)}
    seg = hist[max(0, m - 25):m + 1]
    seg = seg[np.isfinite(seg)]
    if len(seg) >= 12:
        sl = analyze.theil_sen(seg)
        lvl = np.nanmedian(recent) + sl * 4.5
        phi = 0.9                                        # damped: a trend fades instead of running away
        out["trend"] = lvl + sl * np.cumsum(phi ** np.arange(1, H + 1))
    if season and m + 1 - season - 8 >= 0:
        ly = np.nanmean(hist[m - season - 7:m - season + 1])
        ratio = mean8 / ly if ly and np.isfinite(ly) else 1.0
        f = np.array([hist[m + h - season] if m + h - season <= m and np.isfinite(hist[m + h - season]) else np.nan
                      for h in range(1, H + 1)]) * ratio
        if np.isfinite(f).all():
            out["seasonal"] = f
    if lgbm is not None:
        try:
            feats, lv = _lgbm_features(hist, m, season)
            X = np.array([feats + [h] for h in range(1, H + 1)])
            out["lightgbm"] = lv * (1 + lgbm.predict(X))
        except Exception:
            pass
    for k_, v in out.items():
        out[k_] = np.maximum(v, 0) if np.nanmin(hist[ok]) >= 0 else v
    return out


def train_lgbm(y: np.ndarray, upto: int, H: int, season: int | None):
    if np.isfinite(y[:upto + 1]).sum() < 104:
        return None
    import lightgbm as lgb
    X, T = [], []
    for t in range(16, upto - 1):
        if not np.isfinite(y[t]):
            continue
        feats, lv = _lgbm_features(y, t, season)
        if not lv:
            continue
        for h in range(1, H + 1):
            if t + h <= upto and np.isfinite(y[t + h]):
                X.append(feats + [h])
                T.append(y[t + h] / lv - 1)
    if len(X) < 200:
        return None
    mdl = lgb.LGBMRegressor(n_estimators=200, learning_rate=0.05, num_leaves=15, min_child_samples=20,
                            subsample=0.8, subsample_freq=1, colsample_bytree=0.9, verbose=-1)
    mdl.fit(np.array(X), np.array(T))
    return mdl


def forecast_series(y: np.ndarray, m: int, H: int, season: int | None) -> dict:
    """Backtest every method on the last 26 origins (truth up to m), pick the best, forecast from m."""
    origins = [o for o in range(m - F["backtest_origins"], m) if o >= 20]
    lg = train_lgbm(y, m - F["backtest_origins"], min(H, 13), season)
    errs: dict[str, list[list[float]]] = {}
    for o in origins:
        fc = methods(y, o, min(H, 13), season, lg)
        for name, f in fc.items():
            e = errs.setdefault(name, [[] for _ in range(min(H, 13))])
            for h in range(1, min(H, 13) + 1):
                if o + h <= m and np.isfinite(y[o + h]):
                    e[h - 1].append(f[h - 1] - y[o + h])
    if not errs or "last_value" not in errs:
        return {}
    mae = {k: np.mean([np.mean(np.abs(x)) for x in v if len(x)]) for k, v in errs.items() if any(len(x) for x in v)}
    best = min(mae, key=mae.get)
    skill = 1 - mae[best] / mae["last_value"] if mae.get("last_value") else None
    lg_full = train_lgbm(y, m, min(H, 13), season) if best == "lightgbm" else None
    fc = methods(y, m, H, season, lg_full)
    point = fc.get(best, fc["last_value"])
    be = errs[best]
    lo, hi = [], []
    for h in range(1, H + 1):
        e = np.array(be[min(h, len(be)) - 1]) if be[min(h, len(be)) - 1] else np.array([0.0])
        scale = math.sqrt(h / min(h, len(be)))          # beyond the backtested horizon, widen with sqrt(h)
        lo.append(point[h - 1] - scale * np.quantile(e, 0.9) if len(e) >= 6 else point[h - 1] * 0.8)
        hi.append(point[h - 1] - scale * np.quantile(e, 0.1) if len(e) >= 6 else point[h - 1] * 1.2)
    return {"method": best, "skill_vs_naive": None if skill is None else round(float(skill), 3),
            "mae": {k: round(float(v), 4) for k, v in mae.items()}, "point": point, "lower": np.array(lo),
            "upper": np.array(hi), "backtest_origins": len(origins)}


# ---------------------------------------------------------------------------------------------------- order book
def _open_items(conn, c, as_at: date, obs: int, seg_filter: str, ck: str, pk: str, self_ref: bool) -> pd.DataFrame:
    """Parents dated within the observed window as at `as_at` that had no child yet at that moment."""
    pdate = c.PARENT_DATE.replace('"', 'p."', 1) if c.PARENT_DATE.startswith('"') else c.PARENT_DATE
    cdate = c.CHILD_DATE.replace('"', 'ch."', 1) if c.CHILD_DATE.startswith('"') else c.CHILD_DATE
    return query_df(conn, f"""select datediff(day, {pdate}, '{as_at}') age, count(*) n
            from {c.PARENT_TABLE} p
            where {pdate} between '{as_at - timedelta(days=obs)}' and '{as_at}' {seg_filter}
              and not exists (select 1 from {c.CHILD_TABLE} ch where ch."{ck}" = p."{pk}" and {cdate} <= '{as_at}'
                              {'and ch."' + ck + '" <> ch."' + pk + '"' if self_ref else ''})
            group by 1""")


def order_book(conn, today: date, tables: pd.DataFrame) -> tuple[list[dict], list[dict]]:
    chains = query_df(conn, f"select * from {RS}.PI_PROCESS_CHAIN")
    tm = tables.set_index("TABLE_FQN")
    proj, finds = [], []
    for c in chains.itertuples():
        roles = json.loads(tm.DATE_ROLES.get(c.PARENT_TABLE) or "{}")
        pcol = c.PARENT_DATE.split('"')[1] if '"' in c.PARENT_DATE else None
        if roles.get(pcol) not in ("arrival", "decision", "payment"):
            continue                                  # only records that exist on their own date can be rebuilt "as of" a
                                                      # past day (encounters appear with their claim; member months are utilisation)
        cdf = json.loads(c.LAG_CDF)
        curve = {int(k): v for k, v in cdf["cum_conversion_by_day"].items()}
        obs = int(cdf["observed_days"])
        days = np.array(sorted(curve))
        cum = np.array([curve[d] for d in days])
        C = lambda t: float(np.interp(t, days, cum, right=cum[-1]))
        seg_filter = ""
        if isinstance(c.PARENT_SEGMENT, str):
            col, val = c.PARENT_SEGMENT.split("=", 1)
            seg_filter = f""" and coalesce(p."{col}"::varchar, '(blank)') = '{val.replace("'", "''")}'"""
        ck, pk = [x.strip() for x in c.JOIN_KEY.split("->")]
        self_ref = c.PARENT_TABLE == c.CHILD_TABLE

        def expect(op, weeks=13):
            e = np.zeros(weeks)
            for a, n in zip(op.AGE, op.N):
                base = C(a)
                if base >= 1:
                    continue
                for w in range(weeks):
                    e[w] += n * (C(a + 7 * (w + 1)) - C(a + 7 * w)) / (1 - base)
            return e
        try:
            now = _open_items(conn, c, today, obs, seg_filter, ck, pk, self_ref)
            then = _open_items(conn, c, today - timedelta(days=28), obs, seg_filter, ck, pk, self_ref)
        except Exception as e:  # a chain whose date expression no longer parses is skipped, not fatal
            print("order book skipped", c.CHAIN_ID, e)
            continue
        if now.empty:
            continue
        exp_now, exp_then = expect(now), expect(then, 4) if not then.empty else np.zeros(4)
        # what actually arrived in the last 4 weeks from the items that were open 4 weeks ago (projection check)
        pdate = c.PARENT_DATE.replace('"', 'p."', 1) if c.PARENT_DATE.startswith('"') else c.PARENT_DATE
        cdate = c.CHILD_DATE.replace('"', 'ch."', 1) if c.CHILD_DATE.startswith('"') else c.CHILD_DATE
        t0 = today - timedelta(days=28)
        realised = query_df(conn, f"""select count(distinct p."{pk}") n from {c.PARENT_TABLE} p join {c.CHILD_TABLE} ch
                on ch."{ck}" = p."{pk}" {'and ch."' + ck + '" <> ch."' + pk + '"' if self_ref else ''}
                where {pdate} between '{t0 - timedelta(days=obs)}' and '{t0}' {seg_filter}
                  and {cdate} > '{t0}' and {cdate} <= '{today}'
                  and not exists (select 1 from {c.CHILD_TABLE} c2 where c2."{ck}" = p."{pk}"
                                  and {cdate.replace('ch.', 'c2.')} <= '{t0}')""").N.iloc[0]
        amt = c.CHILD_AMOUNT_PER_PARENT if pd.notna(c.CHILD_AMOUNT_PER_PARENT) else None
        for w in range(len(exp_now)):
            proj.append({"SUBJECT_ID": c.CHAIN_ID, "SUBJECT_KIND": "process_chain",
                         "PERIOD_START": today + timedelta(days=1 + 7 * w), "GRAIN": "week",
                         "POINT": round(float(exp_now[w]), 3), "LOWER": None, "UPPER": None,
                         "METHOD": "open_items_x_learned_delay", "SKILL_VS_NAIVE": None,
                         "DETAIL": json.dumps({"open_parents": int(now.N.sum()), "amount_per_child": amt,
                                               "expected_amount": None if amt is None else round(float(exp_now[w] * amt), 2),
                                               "segment": c.PARENT_SEGMENT, "text": c.BUSINESS_TEXT})})
        nxt4, prev4 = float(exp_now[:4].sum()), float(exp_then.sum())
        check = {"projected_4_weeks_ago": round(prev4, 1), "actually_arrived": int(realised or 0),
                 "error_pct": round(100 * (prev4 / realised - 1), 1) if realised else None}
        material = nxt4 >= 10 or (amt and nxt4 * amt >= 50000)
        ratio = nxt4 / prev4 if prev4 else None
        reliable = check["error_pct"] is not None and abs(check["error_pct"]) <= 35
        if material and ratio is not None and (ratio >= 1.3 or ratio <= 0.7) and reliable:
            finds.append({"kind": "projection", "subject": c.CHAIN_ID, "table": c.CHILD_TABLE,
                          "direction": "up" if ratio >= 1 else "down",
                          "expected_next_4_weeks": round(nxt4, 1), "same_projection_4_weeks_ago": round(prev4, 1),
                          "ratio": round(ratio, 2), "projection_check": check,
                          "expected_amount_next_4_weeks": None if amt is None else round(nxt4 * amt, 2),
                          "open_items": int(now.N.sum()), "segment": c.PARENT_SEGMENT,
                          "parent": tm.BUSINESS_NAME.get(c.PARENT_TABLE, c.PARENT_TABLE),
                          "child": tm.BUSINESS_NAME.get(c.CHILD_TABLE, c.CHILD_TABLE), "learned": c.BUSINESS_TEXT})
        OUT.mkdir(parents=True, exist_ok=True)
        with open(OUT / "order_book_checks.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps({"as_of": str(today), "chain": c.CHAIN_ID, "next_4_weeks": round(nxt4, 1), **check}) + "\n")
    return proj, finds


def scheduled(conn, today: date) -> list[dict]:
    """Coverage / contract starts and ends already dated in the coming 13 weeks, sized against the in-force base.
    (Past years cannot be compared like for like: what was *scheduled* a year ago was never recorded.)"""
    df = query_df(conn, f"""select k.KPI_ID, k.BUSINESS_NAME, k.KIND, k.TABLE_FQN,
            sum(iff(d.D between '{today + timedelta(days=1)}' and '{today + timedelta(days=91)}', d.NUM, 0)) nxt,
            min(iff(d.D between '{today + timedelta(days=1)}' and '{today + timedelta(days=91)}' and d.NUM > 0, d.D, null)) first_d,
            max(iff(d.D between '{today + timedelta(days=1)}' and '{today + timedelta(days=91)}' and d.NUM > 0, d.D, null)) last_d
            from {RS}.PI_KPI k join {RS}.PI_KPI_DAILY d using (KPI_ID)
            where k.KIND in ('starts', 'ends') group by 1, 2, 3, 4""")
    base = query_df(conn, f"""select k.TABLE_FQN, d.NUM from {RS}.PI_KPI k join {RS}.PI_KPI_DAILY d using (KPI_ID)
            where k.KIND = 'active' and d.D = '{today}'""")
    bmap = dict(zip(base.TABLE_FQN, base.NUM))
    out = []
    for r in df.itertuples():
        b = bmap.get(r.TABLE_FQN)
        share = r.NXT / b if b else None
        if r.NXT >= 10 and share is not None and share >= 0.01:
            out.append({"kind": "scheduled", "subject": r.KPI_ID, "table": r.TABLE_FQN, "business_name": r.BUSINESS_NAME,
                        "event": r.KIND, "next_13_weeks": int(r.NXT), "in_force_today": int(b), "share_of_base": round(share, 4),
                        "first_date": str(r.FIRST_D), "last_date": str(r.LAST_D),
                        "direction": "down" if r.KIND == "ends" else "up"})
    return out


# ---------------------------------------------------------------------------------------------------- run
def _quarter(d: date) -> tuple[pd.Timestamp, pd.Timestamp, str]:
    p = pd.Timestamp(d).to_period("Q")
    return p.start_time, p.end_time.normalize(), f"{p.year} Q{p.quarter}"


def run(run_id: str) -> dict:
    today = as_of()
    with session() as conn:
        kpis = query_df(conn, f"select * from {RS}.PI_KPI")
        daily = query_df(conn, f"select KPI_ID, D, NUM, DEN, N_ROWS from {RS}.PI_KPI_DAILY where D <= '{today}'")
        comp = query_df(conn, f"select * from {RS}.PI_COMPLETENESS")
        tables = query_df(conn, f"select * from {RS}.PI_TABLE")
        proj_chain, ob_finds = order_book(conn, today, tables)
        sched = scheduled(conn, today)
    roles = dict(zip(tables.TABLE_FQN, tables.TABLE_ROLE))
    by = {k: g for k, g in daily.groupby("KPI_ID")}
    projections, fc_store = [], {}
    for k in kpis.to_dict("records"):
        if k["KIND"] not in ("count", "sum", "active") or roles.get(k["TABLE_FQN"]) == "mart" and not json.loads(k["TAGS"] or "[]"):
            continue
        k["TABLE_ROLE"] = roles.get(k["TABLE_FQN"])
        c = comp[comp.TABLE_FQN == k["TABLE_FQN"]]
        st = analyze.analyse_kpi(k, by.get(k["KPI_ID"], daily.iloc[0:0]), c if len(c) else None, today, None)
        fu = st.get("_full")
        if not fu or fu["grain"] == "year":
            continue
        y = np.array(fu["clean"], dtype=float)           # one-off spikes set aside so they are not projected forward
        mature_idx = np.where(np.isfinite(y))[0]
        if len(mature_idx) < (52 if fu["grain"] == "week" else 24):
            continue
        m = int(mature_idx[-1])
        n_after = len(y) - 1 - m                                  # complete periods still filling in
        horizon = (F["horizon_weeks"] if fu["grain"] == "week" else 6) + n_after + 1
        res = forecast_series(y, m, horizon, fu["season"])
        if not res:
            continue
        step = pd.DateOffset(days=7) if fu["grain"] == "week" else pd.DateOffset(months=1)
        starts = [fu["periods"][m] + step * (h + 1) for h in range(horizon)]
        fc_store[k["KPI_ID"]] = {"grain": fu["grain"], "periods": fu["periods"], "value": np.array(fu["value"], dtype=float),
                                 "m": m, "res": res, "outliers_set_aside": fu.get("outliers_set_aside"),
                                 "starts": starts, "kind": k["KIND"], "raw": fu["raw"], "comp": fu["comp"]}
        for h in range(horizon):
            projections.append({"SUBJECT_ID": k["KPI_ID"], "SUBJECT_KIND": "kpi", "PERIOD_START": starts[h].date(),
                                "GRAIN": fu["grain"], "POINT": round(float(res["point"][h]), 4),
                                "LOWER": round(float(res["lower"][h]), 4), "UPPER": round(float(res["upper"][h]), 4),
                                "METHOD": res["method"], "SKILL_VS_NAIVE": res["skill_vs_naive"],
                                "DETAIL": json.dumps({"nowcast": starts[h] <= pd.Timestamp(today),
                                                      "observed_so_far": None if starts[h] > pd.Timestamp(today) or m + 1 + h >= len(fu["raw"])
                                                      else float(fu["raw"][m + 1 + h]), "mae_by_method": res["mae"]})})
    projections += proj_chain
    pdf = pd.DataFrame(projections)
    pdf.insert(0, "AS_OF", today)
    pdf.insert(0, "RUN_ID", run_id)

    # ------------------------------------------------------------------ executive outlook
    tag_of = {}
    for k in kpis.itertuples():
        for t in json.loads(k.TAGS or "[]"):
            tag_of.setdefault(t, k.KPI_ID)
    q0s, q0e, q0 = _quarter(today)
    q1s, q1e, q1 = _quarter((q0e + pd.Timedelta(days=1)).date())
    outlook, comps = [], {}
    for tag, kid in tag_of.items():
        f = fc_store.get(kid)
        if not f:
            continue
        per = list(f["periods"]) + [s for s in f["starts"] if s > f["periods"][-1]]
        vals, lows, highs = [], [], []
        m = f["m"]
        for i, p0 in enumerate(per):
            if i <= m and np.isfinite(f["value"][i]) if i < len(f["value"]) else False:
                vals.append(f["value"][i]); lows.append(f["value"][i]); highs.append(f["value"][i])
            else:
                h = i - m - 1
                if 0 <= h < len(f["res"]["point"]):
                    vals.append(f["res"]["point"][h]); lows.append(f["res"]["lower"][h]); highs.append(f["res"]["upper"][h])
                else:
                    vals.append(np.nan); lows.append(np.nan); highs.append(np.nan)
        ser = pd.DataFrame({"start": per, "v": vals, "lo": lows, "hi": highs})
        step_days = 7 if f["grain"] == "week" else None

        def qsum(qs, qe):
            tot = lo = hi = 0.0
            var_lo = var_hi = 0.0
            covered = 0.0
            for r in ser.itertuples():
                pe = r.start + (pd.Timedelta(days=6) if step_days else pd.offsets.MonthEnd(0))
                ov = (min(pe, qe) - max(r.start, qs)).days + 1
                if ov <= 0 or not np.isfinite(r.v):
                    continue
                frac = ov / ((pe - r.start).days + 1)
                covered += ov
                if f["kind"] == "active":
                    tot += r.v * ov
                    var_lo += ((r.v - r.lo) * ov) ** 2
                    var_hi += ((r.hi - r.v) * ov) ** 2
                else:
                    tot += r.v * frac
                    var_lo += ((r.v - r.lo) * frac) ** 2
                    var_hi += ((r.hi - r.v) * frac) ** 2
            days_q = (qe - qs).days + 1
            if covered < 0.9 * days_q:
                return None
            if f["kind"] == "active":
                return tot / covered, (tot - math.sqrt(var_lo)) / covered, (tot + math.sqrt(var_hi)) / covered
            return tot, tot - math.sqrt(var_lo), tot + math.sqrt(var_hi)

        for label, (qs, qe) in ((q0, (q0s, q0e)), (q1, (q1s, q1e))):
            cur = qsum(qs, qe)
            ly = qsum(qs - pd.DateOffset(years=1), qe - pd.DateOffset(years=1))
            if cur is None:
                continue
            comps[(tag, label)] = cur
            outlook.append({"METRIC": tag, "BUSINESS_NAME": kpis.set_index("KPI_ID").BUSINESS_NAME.get(kid), "PERIOD": label,
                            "POINT": cur[0], "LOWER": cur[1], "UPPER": cur[2],
                            "SAME_PERIOD_LAST_YEAR": None if ly is None else ly[0], "LAST_PERIOD": None,
                            "UNIT": "count" if tag in ("membership", "member_months") else "USD",
                            "BASIS": f"{fc_store[kid]['res']['method']} forecast (skill vs naive {fc_store[kid]['res']['skill_vs_naive']}) "
                                     f"+ actuals; interval approx (errors combined as independent)", "DRIVERS": kid})
    for label in (q0, q1):
        med, rx, rev, mm = (comps.get((t, label)) for t in ("medical_cost", "pharmacy_cost", "revenue", "member_months"))
        if med and rx:
            tc = (med[0] + rx[0], med[1] + rx[1], med[2] + rx[2])
            outlook.append({"METRIC": "total_cost", "BUSINESS_NAME": "Total medical + pharmacy cost", "PERIOD": label,
                            "POINT": tc[0], "LOWER": tc[1], "UPPER": tc[2], "SAME_PERIOD_LAST_YEAR": None,
                            "LAST_PERIOD": None, "UNIT": "USD", "BASIS": "medical_cost + pharmacy_cost", "DRIVERS": None})
            if rev:
                outlook.append({"METRIC": "medical_loss_ratio", "BUSINESS_NAME": "Medical loss ratio (cost / premium)",
                                "PERIOD": label, "POINT": tc[0] / rev[0], "LOWER": tc[1] / rev[2], "UPPER": tc[2] / rev[1],
                                "SAME_PERIOD_LAST_YEAR": None, "LAST_PERIOD": None, "UNIT": "share",
                                "BASIS": "total_cost / revenue", "DRIVERS": None})
            if mm:
                outlook.append({"METRIC": "cost_pmpm", "BUSINESS_NAME": "Cost per member per month", "PERIOD": label,
                                "POINT": tc[0] / mm[0], "LOWER": tc[1] / mm[2], "UPPER": tc[2] / mm[1],
                                "SAME_PERIOD_LAST_YEAR": None, "LAST_PERIOD": None, "UNIT": "USD",
                                "BASIS": "total_cost / member_months", "DRIVERS": None})
    odf = pd.DataFrame(outlook)
    # last-year comparisons for derived measures
    if len(odf):
        lyv = {(r.METRIC, r.PERIOD): r.SAME_PERIOD_LAST_YEAR for r in odf.itertuples()}
        for i, r in odf.iterrows():
            if r.METRIC == "total_cost":
                a, b = lyv.get(("medical_cost", r.PERIOD)), lyv.get(("pharmacy_cost", r.PERIOD))
                odf.at[i, "SAME_PERIOD_LAST_YEAR"] = (a + b) if a and b else None
        lyv = {(r.METRIC, r.PERIOD): r.SAME_PERIOD_LAST_YEAR for r in odf.itertuples()}
        for i, r in odf.iterrows():
            tc, rv, mmv = lyv.get(("total_cost", r.PERIOD)), lyv.get(("revenue", r.PERIOD)), lyv.get(("member_months", r.PERIOD))
            if r.METRIC == "medical_loss_ratio" and tc and rv:
                odf.at[i, "SAME_PERIOD_LAST_YEAR"] = tc / rv
            if r.METRIC == "cost_pmpm" and tc and mmv:
                odf.at[i, "SAME_PERIOD_LAST_YEAR"] = tc / mmv
        odf.insert(0, "AS_OF", today)
        odf.insert(0, "RUN_ID", run_id)

    # ------------------------------------------------------------------ projection findings
    data = impact._load()
    tm = tables.set_index("TABLE_FQN")
    findings = []
    for x in ob_finds + sched:
        ds = impact.downstream(x["table"], data=data)
        usd = x.get("expected_amount_next_4_weeks")
        if x["kind"] == "scheduled":
            score = 2.0 + 60 * x["share_of_base"]
        else:
            score = 2.0 + 2.5 * abs(math.log(max(x["ratio"], 0.05))) + (math.log10(1 + usd) / 2 if usd else 0)
        findings.append({"RUN_ID": run_id, "AS_OF": today, "FINDING_ID": f"proj:{x['subject']}", "KIND": x["kind"] if x["kind"] == "scheduled" else "projection",
                         "SUBJECT_ID": x["subject"], "SCORE": round(score, 3), "USD_AT_STAKE": usd, "MEMBERS_AFFECTED": None,
                         "TIMING": "next 4 weeks" if x["kind"] == "projection" else "next 13 weeks",
                         "DEPARTMENTS": json.dumps(sorted({tm.DEPARTMENT.get(x["table"])} | set(ds["departments"]) - {None})),
                         "DOWNSTREAM": json.dumps({"tables": ds["tables"][:12], "kpis": ds["kpis"][:15]}),
                         "EVIDENCE": json.dumps(x, default=str), "CANDIDATE_CAUSES": json.dumps([]),
                         "TECHNICAL_SUMMARY": json.dumps(x, default=str)[:1000]})
    # executive measures heading the wrong way versus last year
    for r in (odf.itertuples() if len(odf) else []):
        if r.SAME_PERIOD_LAST_YEAR and r.METRIC in ("medical_loss_ratio", "cost_pmpm", "total_cost", "revenue", "membership"):
            ch = r.POINT / r.SAME_PERIOD_LAST_YEAR - 1
            bad = (ch > 0.05) if r.METRIC in ("medical_loss_ratio", "cost_pmpm", "total_cost") else (ch < -0.03)
            if bad:
                findings.append({"RUN_ID": run_id, "AS_OF": today, "FINDING_ID": f"outlook:{r.METRIC}:{r.PERIOD}",
                                 "KIND": "outlook", "SUBJECT_ID": r.METRIC, "SCORE": round(3 + 40 * abs(ch), 3),
                                 "USD_AT_STAKE": abs(r.POINT - r.SAME_PERIOD_LAST_YEAR) if r.UNIT == "USD" else None,
                                 "MEMBERS_AFFECTED": None, "TIMING": r.PERIOD,
                                 "DEPARTMENTS": json.dumps(["Finance"]), "DOWNSTREAM": json.dumps({}),
                                 "EVIDENCE": json.dumps({"metric": r.METRIC, "business_name": r.BUSINESS_NAME, "period": r.PERIOD,
                                                         "projected": r.POINT, "lower": r.LOWER, "upper": r.UPPER,
                                                         "same_period_last_year": r.SAME_PERIOD_LAST_YEAR,
                                                         "change_pct": round(100 * ch, 2), "unit": r.UNIT}),
                                 "CANDIDATE_CAUSES": json.dumps([]), "TECHNICAL_SUMMARY": r.BASIS})
    fdf = pd.DataFrame(findings)
    with session() as conn:
        replace_rows(conn, f"{RS}.PI_PROJECTION", pdf, where=f"AS_OF = '{today}'")
        if len(odf):
            replace_rows(conn, f"{RS}.PI_OUTLOOK", odf[["RUN_ID", "AS_OF", "METRIC", "BUSINESS_NAME", "PERIOD", "POINT", "LOWER",
                                                        "UPPER", "SAME_PERIOD_LAST_YEAR", "LAST_PERIOD", "UNIT", "BASIS", "DRIVERS"]],
                         where=f"AS_OF = '{today}'")
        if len(fdf):
            fdf["RANK"] = None
            replace_rows(conn, f"{RS}.PI_FINDING", fdf[["RUN_ID", "AS_OF", "FINDING_ID", "KIND", "SUBJECT_ID", "RANK", "SCORE",
                                                        "USD_AT_STAKE", "MEMBERS_AFFECTED", "TIMING", "DEPARTMENTS", "DOWNSTREAM",
                                                        "EVIDENCE", "CANDIDATE_CAUSES", "TECHNICAL_SUMMARY"]],
                         where=f"AS_OF = '{today}' and KIND in ('projection', 'scheduled', 'outlook')")
    skills = [v["res"]["skill_vs_naive"] for v in fc_store.values() if v["res"]["skill_vs_naive"] is not None]
    (OUT / "outlook.json").write_text(json.dumps(odf.to_dict("records") if len(odf) else [], default=str, indent=1))
    (OUT / "forecast_quality.json").write_text(json.dumps({k: {"method": v["res"]["method"], "skill_vs_naive": v["res"]["skill_vs_naive"],
                                                              "mae": v["res"]["mae"]} for k, v in fc_store.items()}, indent=1))
    return {"forecasted_kpis": len(fc_store), "beats_naive": int(sum(1 for s in skills if s > 0.02)),
            "median_skill": None if not skills else round(float(np.median(skills)), 3),
            "methods": pd.Series([v["res"]["method"] for v in fc_store.values()]).value_counts().to_dict(),
            "outlook_rows": len(odf), "order_book_findings": len(ob_finds), "scheduled_findings": len(sched),
            "projection_findings": len(fdf)}
