"""Layer 2 - business process chains learned from keys and dates.

For every validated key from one business-event table (parent) to another (child) - claim -> payment, denied claim ->
appeal, authorization -> claim, claim -> corrected claim ... - measure:
  conversion  share of parent records that lead to a child record (overall and per parent status, e.g. DENIED)
  delay       days from the parent's date to the first child (a full curve, so open items can be projected forward)
  amount      child money per converted parent (e.g. dollars paid per claim)

Time-to-child is estimated with a Kaplan-Meier survival curve: every parent counts for the days it has been observed,
so a process whose child table is new (appeals only recorded for a few months) is measured correctly instead of
being dropped or under-counted. Parents are taken only from the period the child table covers (no left truncation)."""
from __future__ import annotations

import json
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

from .config import RS, as_of
from .db import query_df, replace_rows, session

MIN_AT_RISK = 30            # the curve is read only as far as at least this many parents are still being observed


def canonical(fqn: str, tables: pd.DataFrame) -> str:
    sup = dict(zip(tables.TABLE_FQN, tables.SUPERSEDED_BY))
    seen = set()
    while isinstance(sup.get(fqn), str) and fqn not in seen:
        seen.add(fqn)
        fqn = sup[fqn]
    return fqn


def _date(t: dict, cols: pd.DataFrame, prefer=("event", "arrival", "decision", "payment", "period", "start")) -> str | None:
    """SQL date expression for the table's best date of the preferred kind (real DATE columns before text months)."""
    roles = json.loads(t["DATE_ROLES"]) if isinstance(t["DATE_ROLES"], str) else {}
    types = dict(zip(cols[cols.TABLE_FQN == t["TABLE_FQN"]].COLUMN_NAME, cols[cols.TABLE_FQN == t["TABLE_FQN"]].DATA_TYPE))
    for p in prefer:
        cands = sorted([c for c, r in roles.items() if r == p], key=lambda c: types.get(c, "DATE").upper() == "TEXT")
        if cands:
            c = cands[0]
            return f"try_to_date(\"{c}\" || '-01')" if types.get(c, "").upper() == "TEXT" else f'"{c}"::date'
    return None


def _status_col(t: dict, pc: pd.DataFrame) -> str | None:
    st = pc[pc.ROLE == "status"].sort_values("ORDINAL").COLUMN_NAME.tolist()
    if not st:
        return None
    ent = set(t["TABLE_NAME"].upper().split("_"))
    own = [c for c in st if set(c.upper().split("_")[:-1]) & ent or c.upper() in ("STATUS", "CLAIM_STATUS")]
    return (own or st)[0]


def km(df: pd.DataFrame) -> tuple[np.ndarray, np.ndarray, int]:
    """Kaplan-Meier on (time, event). Returns (days, cumulative conversion), and the last reliable day."""
    t = df["T"].to_numpy(dtype=float)
    e = df["E"].to_numpy(dtype=bool)
    tmax = int(np.nanmax(t)) if len(t) else 0
    days = np.arange(0, tmax + 1)
    surv, s = [], 1.0
    reliable = 0
    for d in days:
        at_risk = int((t >= d).sum())
        ev = int(((t == d) & e).sum())
        if at_risk >= MIN_AT_RISK:
            reliable = int(d)
        if at_risk > 0:
            s *= (1 - ev / at_risk)
        surv.append(s)
    return days, 1 - np.array(surv), reliable


def chains(conn, tables: pd.DataFrame, cols: pd.DataFrame, edges: pd.DataFrame, today) -> list[dict]:
    tm = {r["TABLE_FQN"]: r for r in tables.to_dict("records")}
    pk_owner = {}
    for r in tables.itertuples():
        if isinstance(r.PRIMARY_KEY, str) and r.TABLE_ROLE not in ("mart", "audit", "reference"):
            pk_owner.setdefault((r.SCHEMA_NAME, r.PRIMARY_KEY), []).append(r.TABLE_FQN)
    fks = edges[(edges.KIND == "foreign_key") & edges.CONFIDENCE.isin(["high", "medium"])]
    out = []
    for e in fks.itertuples():
        P, C = tm.get(e.FROM_NODE), tm.get(e.TO_NODE)
        if not P or not C or P["TABLE_ROLE"] != "fact" or C["TABLE_ROLE"] != "fact":
            continue
        if P.get("PRIMARY_KEY") != e.FROM_COLUMN or not isinstance(C.get("PRIMARY_KEY"), str):
            continue                                       # parents are events with their own key; children not logs
        if len(pk_owner.get((P["SCHEMA_NAME"], P["PRIMARY_KEY"]), [])) > 1 and                 P["PRIMARY_KEY"].upper() != P["TABLE_NAME"].upper().split("_")[-1] + "_ID":
            continue                                       # an entity extension (profile keyed by member), not an event
        crole, cdate = None, None
        for r in ("arrival", "event", "decision", "payment", "period"):
            cdate = _date(C, cols, (r,))
            if cdate:
                crole = r
                break
        if not cdate:
            continue
        # measure from the parent milestone closest to the child (a denial is appealed from its decision date,
        # not its service date); pick the date with the shortest typical delay that still matches enough records
        best = None
        for role in ("decision", "payment", "arrival", "event", "period"):
            if role == "payment" and crole == "payment":
                continue                                   # the parent's own record of the child's milestone
            pd_ = _date(P, cols, (role,))
            if not pd_:
                continue
            m = query_df(conn, f"""select count(*) n, median(datediff(day, {pd_}, c.cd)) med from {P['TABLE_FQN']} p
                 join (select "{e.TO_COLUMN}" k, min({cdate}) cd from {C['TABLE_FQN']} group by 1) c on c.k = p."{e.FROM_COLUMN}"
                 where {pd_} is not null and c.cd >= {pd_} - 3""").iloc[0]
            if (m.N or 0) >= 10 and (best is None or m.MED < best[1]):
                best = (pd_, m.MED)
        if not best:
            continue
        pdate = best[0]
        pc = cols[cols.TABLE_FQN == P["TABLE_FQN"]]
        seg = _status_col(P, pc)
        cc = cols[(cols.TABLE_FQN == C["TABLE_FQN"]) & (cols.ROLE == "money")]
        money = cc.sort_values("ORDINAL").COLUMN_NAME.iloc[0] if len(cc) else None
        cmin = query_df(conn, f'select min({cdate}) m from {C["TABLE_FQN"]}').M.iloc[0]
        if cmin is None:
            continue
        lo = max(today - timedelta(days=730), pd.Timestamp(cmin).date())
        self_ref = P["TABLE_FQN"] == C["TABLE_FQN"]
        segexpr = f'coalesce(p."{seg}"::varchar, \'(blank)\')' if seg else "'(all)'"
        moneyexpr = f'sum(coalesce("{money}", 0))' if money else "null"
        q = f"""
          with c as (select "{e.TO_COLUMN}" k, min({cdate}) cd, {moneyexpr} amt from {C['TABLE_FQN']}
                     where "{e.TO_COLUMN}" is not null {'and "' + e.TO_COLUMN + '" <> "' + e.FROM_COLUMN + '"' if self_ref else ''}
                     group by 1),
          p as (select p."{e.FROM_COLUMN}" k, {pdate} pd, {segexpr} seg from {P['TABLE_FQN']} p
                where {pdate} between '{lo}' and '{today}')
          select p.seg, datediff(day, p.pd, '{today}') age,
                 iff(c.cd is not null and c.cd >= p.pd - 3, greatest(datediff(day, p.pd, c.cd), 0), null) lag, c.amt
          from p left join c on c.k = p.k"""
        df = query_df(conn, q)
        if df.empty or df.LAG.notna().sum() < 10:
            continue
        df["E"] = df.LAG.notna()
        df["T"] = np.where(df.E, df.LAG, df.AGE).astype(float)
        days, cdf, rel = km(df)
        if rel < 3:
            continue
        p90_all = days[np.searchsorted(cdf, 0.9 * cdf[rel])] if cdf[rel] > 0 else 0
        if p90_all == 0:
            continue                                       # recorded the same day as its parent: one event, two tables
        groups = [("(all)", df)]
        if seg:
            for s, g in df.groupby("SEG"):
                if len(g) >= MIN_AT_RISK and g.E.sum() >= 5:
                    groups.append((s, g))
        overall = None
        for s, g in groups:
            d2, c2, r2 = km(g)
            if r2 < 3:
                continue
            conv = float(c2[r2])
            if overall is None:
                overall = conv
            elif abs(conv - overall) < max(0.02, 0.25 * overall):
                continue                                   # segment behaves like the whole: nothing to learn
            if conv <= 0:
                continue
            norm = c2[: r2 + 1] / conv                     # delay curve among those who convert
            qd = {f"p{int(x * 100)}": float(d2[min(np.searchsorted(norm, x), r2)]) for x in (0.1, 0.25, 0.5, 0.75, 0.9)}
            curve = {int(d): round(float(v), 5) for d, v in zip(d2[: r2 + 1], c2[: r2 + 1])
                     if d in (0, 1, 2, 3, 5, 7, 10, 14, 21, 28, 35, 42, 49, 56, 63, 70, 84, 90, 105, 120, 150, 180, 240, 300, 365)
                     or d == r2}
            amt = g.loc[g.E, "AMT"].astype(float)
            pl = (P.get("BUSINESS_NAME") or P["TABLE_NAME"]).lower()
            cl = (C.get("BUSINESS_NAME") or C["TABLE_NAME"]).lower()
            out.append({
                "CHAIN_ID": f"{P['TABLE_FQN']}>{C['TABLE_FQN']}:{e.TO_COLUMN}:{s}".lower(),
                "PARENT_TABLE": P["TABLE_FQN"], "PARENT_DATE": pdate, "CHILD_TABLE": C["TABLE_FQN"], "CHILD_DATE": cdate,
                "JOIN_KEY": f"{e.TO_COLUMN} -> {e.FROM_COLUMN}",
                "PARENT_SEGMENT": f"{seg}={s}" if seg and s != "(all)" else None,
                "N_PARENT": int(len(g)), "CONVERSION": round(conv, 5),
                "LAG_P10": qd["p10"], "LAG_P50": qd["p50"], "LAG_P90": qd["p90"],
                "LAG_CDF": json.dumps({"observed_days": r2, "cum_conversion_by_day": curve, **qd}),
                "CHILD_AMOUNT_COLUMN": money,
                "CHILD_AMOUNT_PER_PARENT": round(float(amt.mean()), 2) if money and len(amt) else None,
                "BUSINESS_TEXT": (f"{conv:.1%} of {pl}" + (f" with {seg.lower().replace('_', ' ')} {str(s).lower()}"
                                                          if seg and s != "(all)" else "")
                                  + f" lead to {'a corrected ' + cl if self_ref else 'a ' + cl + ' record'} within {r2} days,"
                                  + f" typically {qd['p50']:.0f} days later (90% within {qd['p90']:.0f})."),
            })
    # the same process seen in the source system and in the warehouse: keep the business-layer copy
    canon = {}
    keep = []
    for ch in out:
        key = (canonical(ch["PARENT_TABLE"], tables), canonical(ch["CHILD_TABLE"], tables), ch["PARENT_SEGMENT"])
        src_layer = (ch["PARENT_TABLE"] == key[0]) + (ch["CHILD_TABLE"] == key[1])
        if key not in canon or src_layer > canon[key][0]:
            canon[key] = (src_layer, ch)
    keep = [v[1] for v in canon.values()]
    return keep


def run() -> dict:
    today = as_of()
    with session() as conn:
        tables = query_df(conn, f"select * from {RS}.PI_TABLE")
        cols = query_df(conn, f"select * from {RS}.PI_COLUMN")
        edges = query_df(conn, f"select * from {RS}.PI_EDGE")
        ch = chains(conn, tables, cols, edges, today)
        df = pd.DataFrame(ch)
        if df.empty:
            return {"chains": 0}
        df["UPDATED_TS"] = datetime.utcnow()
        replace_rows(conn, f"{RS}.PI_PROCESS_CHAIN", df)
        pe = []
        for r in df.itertuples():
            a, b = canonical(r.PARENT_TABLE, tables), canonical(r.CHILD_TABLE, tables)
            pe.append({"EDGE_ID": f"process:{r.CHAIN_ID}", "KIND": "process_chain", "FROM_NODE": a, "TO_NODE": b,
                       "FROM_COLUMN": r.JOIN_KEY.split(" -> ")[1], "TO_COLUMN": r.JOIN_KEY.split(" -> ")[0],
                       "SOURCE": "learned", "CONFIDENCE": "high" if r.N_PARENT >= 500 else "medium",
                       "STRENGTH": r.CONVERSION, "LAG_DAYS": r.LAG_P50,
                       "EVIDENCE": json.dumps({"text": r.BUSINESS_TEXT, "segment": r.PARENT_SEGMENT,
                                               "n_parent": r.N_PARENT, "p90_days": r.LAG_P90}),
                       "UPDATED_TS": datetime.utcnow()})
        replace_rows(conn, f"{RS}.PI_EDGE", pd.DataFrame(pe), where="KIND = 'process_chain'")
    return {"chains": len(df), "process_edges": len(pe)}
