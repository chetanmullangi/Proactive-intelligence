"""Layer 7 - evidence for a business reason (the detector agent turns it into plain language and checks the world).

For every KPI that needs attention (and every material data problem) build a finding:
  drivers     the movement split by each business dimension - additive KPIs: each segment's exact share of
              (actual - expected); rates: rate change inside segments vs a shift in the mix of segments
  causes      candidate business causes from the shape of the evidence (one provider, one group, one region, one
              reason code, one drug class, one intake channel, membership, season, a data/recording problem,
              an upstream KPI that moved first)
  impact      what is downstream (tables, KPIs, departments) and the dollars at stake"""
from __future__ import annotations

import json
import math
import re
from datetime import timedelta

import numpy as np
import pandas as pd

from . import impact
from .config import OUT, RS, as_of
from .db import query_df, replace_rows, session

CAUSES = [  # (dimension keywords, cause family, business wording of what typically produces this shape)
    (("PROVIDER", "PRESCRIBER", "PHARMACY_PROVIDER", "PAYEE"), "provider",
     "one provider or practice accounts for most of it - typically a billing problem at that office, a contract or "
     "network change, a rate dispute, or the provider joining or leaving the network"),
    (("GROUP",), "employer_group",
     "one employer group accounts for most of it - typically a group joining, leaving, renewing or changing plans"),
    (("STATE", "CITY", "COUNTY", "ZIP", "REGION", "AREA"), "region",
     "it is concentrated in one area - typically a local event: severe weather, a disaster, an outbreak, or a "
     "facility closing or opening"),
    (("DENIAL", "REASON", "REJECT", "PEND"), "rule_or_policy",
     "one reason code dominates - typically a new or changed rule, authorization requirement, coding policy or edit"),
    (("DRUG", "THERAPEUTIC", "NDC", "CLASS", "GENERIC", "FORMULARY", "SPECIALTY"), "drug",
     "one drug or drug class dominates - typically a shortage, a price change, a new drug launch or a formulary change"),
    (("PLAN", "PRODUCT", "BENEFIT", "METAL", "COVERAGE", "SEGMENT", "LINE_OF_BUSINESS", "FUNDING", "TIER"), "product",
     "one plan, product or market segment dominates - typically a benefit design, pricing or enrollment change"),
    (("CHANNEL", "SOURCE", "SUBMISSION", "PATH", "INTAKE", "FORM"), "intake",
     "one intake channel or processing path dominates - typically an intake system, clearinghouse or workflow problem"),
    (("CATEGORY", "TYPE", "SETTING", "SERVICE", "PLACE", "PROCEDURE", "ENCOUNTER", "SUBJECT", "DISCHARGE", "ADMIT"),
     "service_mix", "one kind of service dominates - typically a utilization shift, seasonal illness, a new policy "
     "for that service, or a high-cost case cluster"),
    (("STATUS", "LEVEL", "DECISION", "OUTCOME", "PRIORITY"), "processing",
     "the processing-status mix moved - typically a backlog, a staffing gap or a workflow change"),
]


def _cause_for(dim: str):
    u = dim.upper().split(">")[-1] if ">" in dim else dim.upper()
    full = dim.upper()
    for keys, fam, text in CAUSES:
        if any(k in u for k in keys) or any(k in full for k in keys):
            return fam, text
    return "other", f"it is concentrated in {dim.lower()}"


def _period_bounds(label: str, grain: str):
    start = pd.Timestamp(re.search(r"(\d{4}-\d{2}-\d{2})", label).group(1))
    step = {"week": pd.DateOffset(days=7), "month": pd.DateOffset(months=1), "year": pd.DateOffset(years=1)}[grain]
    return start, start + step - pd.Timedelta(days=1), step


def drivers(conn, k: dict, st: dict) -> list[dict]:
    """Split the tested period's movement by every stored dimension."""
    grain = st.get("GRAIN", "week")
    if not st.get("PERIOD_LABEL") or grain == "year":
        return []
    s, e, step = _period_bounds(st["PERIOD_LABEL"], grain)
    b0 = s - 8 * step
    dd = query_df(conn, f"""select D, DIM, VAL, NUM, DEN from {RS}.PI_KPI_DAILY_DIM
                           where KPI_ID = '{k["KPI_ID"]}' and D between '{b0.date()}' and '{e.date()}'""")
    if dd.empty:
        return []
    dd["D"] = pd.to_datetime(dd.D)
    dd["CUR"] = (dd.D >= s)
    additive = bool(k["ADDITIVE"])
    comp = st.get("COMPLETENESS") or 1.0
    expected, actual = st.get("EXPECTED"), st.get("ACTUAL")
    own = set(re.findall(r'"([A-Z0-9_]+)"', str(k.get("NUM_EXPR") or "")))    # a rate is not explained by itself
    out = []
    for dim, g in dd.groupby("DIM"):
        if k["KIND"] == "rate" and dim.split(">")[-1] in own:
            continue
        cur = g[g.CUR].groupby("VAL")[["NUM", "DEN"]].sum()
        base = g[~g.CUR].groupby("VAL")[["NUM", "DEN"]].sum() / 8.0
        segs = cur.join(base, how="outer", lsuffix="_C", rsuffix="_B").fillna(0)
        if segs.empty:
            continue
        if additive:
            bt = segs.NUM_B.sum()
            f = (expected / bt) if bt and expected is not None and np.isfinite(expected) else 1.0
            segs["CONTRIB"] = segs.NUM_C / max(comp, 1e-9) - f * segs.NUM_B
            total = segs.CONTRIB.sum()
            segs["RATE_EFFECT"] = np.nan
            segs["MIX_EFFECT"] = np.nan
        else:
            wc = segs.DEN_C / max(segs.DEN_C.sum(), 1e-9)
            wb = segs.DEN_B / max(segs.DEN_B.sum(), 1e-9)
            rc = (segs.NUM_C / segs.DEN_C.replace(0, np.nan)).fillna(0)
            rb = (segs.NUM_B / segs.DEN_B.replace(0, np.nan))
            rb = rb.fillna(segs.NUM_B.sum() / max(segs.DEN_B.sum(), 1e-9))
            segs["RATE_EFFECT"] = wc * (rc - rb)
            segs["MIX_EFFECT"] = (wc - wb) * rb
            segs["CONTRIB"] = segs.RATE_EFFECT + segs.MIX_EFFECT
            total = segs.CONTRIB.sum()
        if not total or not np.isfinite(total):
            continue
        same = segs[np.sign(segs.CONTRIB) == np.sign(total)].sort_values("CONTRIB", key=lambda x: -x.abs())
        if same.empty:
            continue
        top = same.head(3)
        share = float(top.CONTRIB.iloc[0] / total)
        weight_col = "NUM_B" if additive else "DEN_B"
        bw = segs[weight_col].abs()
        base_share = float(bw.get(top.index[0], 0) / bw.sum()) if bw.sum() else 0.0
        lift = share / base_share if base_share > 0 else 99.0
        fam, text = _cause_for(dim)
        out.append({"dimension": dim, "top_share_of_change": round(min(share, 9.99), 3),
                    "top_base_share": round(base_share, 4), "lift": round(min(lift, 99.0), 2),
                    "cause_family": fam, "cause_text": text, "n_segments": int(len(segs)),
                    "segments": [{"value": str(v), "contribution": round(float(r.CONTRIB), 6),
                                  "current": round(float(r.NUM_C), 4), "baseline": round(float(r.NUM_B), 4),
                                  "rate_effect": None if not np.isfinite(r.RATE_EFFECT) else round(float(r.RATE_EFFECT), 6),
                                  "mix_effect": None if not np.isfinite(r.MIX_EFFECT) else round(float(r.MIX_EFFECT), 6)}
                                 for v, r in top.iterrows()]})
    # a segment explains a change only if it carries far more of the change than its normal share of the business
    for o in out:
        o["concentrated"] = bool(min(o["top_share_of_change"], 1.0) >= 0.35 and (o["lift"] >= 1.5 or o["top_base_share"] <= 0.2))
        o["score"] = round(min(o["top_share_of_change"], 1.0) * min(o["lift"], 10), 3)
    out.sort(key=lambda x: (-int(x["concentrated"]), -x["score"]))
    return out


def label_values(conn, drivers_: list[dict], k: dict, tables: pd.DataFrame, cols: pd.DataFrame):
    """Readable names for ids and codes (provider ids -> provider names, reason codes -> descriptions)."""
    dims = {d["name"]: d for d in json.loads(k["DIMENSIONS"] or "[]")}
    for d in drivers_[:4]:
        meta = dims.get(d["dimension"]) or {}
        vals = [s["value"] for s in d["segments"]]
        src = meta.get("entity")
        colname = d["dimension"].split(">")[-1]
        if not src and colname.upper().endswith("_CODE"):
            ref = cols[(cols.COLUMN_NAME == colname) & cols.TABLE_FQN.isin(tables[tables.TABLE_ROLE == "reference"].TABLE_FQN)]
            src = ref.TABLE_FQN.iloc[0] if len(ref) else None
        if not src:
            continue
        tc = cols[cols.TABLE_FQN == src]
        name_col = next((c for c in tc.COLUMN_NAME if c.upper().endswith(("_NAME", "_DESC"))), None)
        key = next((c for c in tc.COLUMN_NAME if c.upper() == colname.upper() or colname.upper().endswith("_" + c.upper())), None)
        if not name_col or not key:
            continue
        inlist = ", ".join("'" + v.replace("'", "''") + "'" for v in vals)
        try:
            m = query_df(conn, f'select "{key}"::varchar k, "{name_col}" n from {src} where "{key}"::varchar in ({inlist})')
            names = dict(zip(m.K, m.N))
            for s_ in d["segments"]:
                s_["label"] = names.get(s_["value"])
        except Exception:
            pass


def run(run_id: str) -> dict:
    today = as_of()
    state = json.loads((OUT / "kpi_state.json").read_text())
    dq = json.loads((OUT / "data_checks.json").read_text())
    with session() as conn:
        kpis = query_df(conn, f"select * from {RS}.PI_KPI").set_index("KPI_ID")
        tables = query_df(conn, f"select * from {RS}.PI_TABLE")
        cols = query_df(conn, f"select TABLE_FQN, COLUMN_NAME from {RS}.PI_COLUMN")
        links = query_df(conn, f"select * from {RS}.PI_EDGE where KIND = 'kpi_link'")
        data = impact._load()
        sts = {s["KPI_ID"]: s for s in state["kpis"]}
        findings = []
        member_moves = [s for s in state["kpis"] if set(s.get("TAGS") or []) & {"membership", "member_months"}
                        and s.get("STATE") in ("watch", "attention")]
        for kid, st in sts.items():
            if st.get("STATE") not in ("watch", "attention"):
                continue
            k = {"KPI_ID": kid, **kpis.loc[kid].to_dict()}
            drv = drivers(conn, k, st)
            label_values(conn, drv, k, tables, cols)
            causes, fams = [], set()
            for d in drv:
                if d["concentrated"] and d["cause_family"] not in fams:
                    fams.add(d["cause_family"])
                    causes.append({"family": d["cause_family"], "why": d["cause_text"], "dimension": d["dimension"],
                                   "share_of_change": d["top_share_of_change"], "normal_share": d["top_base_share"],
                                   "lift": d["lift"], "top_segment": d["segments"][0]})
            causes = causes[:3]
            if drv and not causes:
                causes.append({"family": "broad", "why": "the change is spread across segments rather than concentrated - "
                                                         "typically overall demand, membership, calendar or season"})
            if member_moves and k["KIND"] in ("count", "sum") and not any("membership" in (s.get("TAGS") or []) for s in [st]):
                causes.append({"family": "membership", "why": "membership itself moved in the same period",
                               "kpis": [m["KPI_ID"] for m in member_moves]})
            if st.get("SEASONAL"):
                causes.append({"family": "season", "why": "this KPI has a repeatable seasonal pattern; the expected value "
                                                          "already allows for it, so the remaining gap is beyond the usual season"})
            issues = [x for x in dq if x["TABLE_FQN"] == k["TABLE_FQN"] and x["SEVERITY"] in ("high", "medium") and x["FAILED"]]
            if issues:
                causes.append({"family": "data_issue", "why": "the same table has open data problems; part of the movement may be "
                                                              "a recording or loading issue rather than the business",
                               "checks": [i["CHECK_ID"] for i in issues][:5]})
            ups = []
            for l in links[links.TO_NODE == kid].itertuples():
                ev = json.loads(l.EVIDENCE)
                if ev.get("mechanical") or not ev.get("leads"):
                    continue
                us = sts.get(l.FROM_NODE)
                if us and us.get("STATE") in ("watch", "attention", "normal") and us.get("Z") is not None and abs(us["Z"]) >= 1.5:
                    ups.append({"kpi_id": l.FROM_NODE, "business_name": us.get("BUSINESS_NAME"), "lag_days": l.LAG_DAYS,
                                "r": l.STRENGTH, "its_z": round(us["Z"], 2)})
            if ups:
                causes.append({"family": "upstream", "why": "a KPI that usually moves first already moved", "kpis": ups[:3]})
            ds = impact.downstream(kid, data=data)
            polarity = st.get("POLARITY", "neutral")
            usd = st.get("USD_AT_STAKE") or 0
            score = (abs(st.get("Z") or 0)) * (1 + math.log10(1 + usd) / 3) * {"bad": 1.0, "neutral": 0.7, "good": 0.4}[polarity]
            if st.get("STATE") == "attention":
                score *= 1.3
            findings.append({
                "RUN_ID": run_id, "AS_OF": today, "FINDING_ID": f"kpi:{kid}:{st.get('PERIOD_LABEL')}", "KIND": "kpi_movement",
                "SUBJECT_ID": kid, "SCORE": round(score, 3), "USD_AT_STAKE": usd or None, "MEMBERS_AFFECTED": None,
                "TIMING": f"happened: {st.get('PERIOD_LABEL')}",
                "DEPARTMENTS": json.dumps(sorted({k.get("DEPARTMENT")} | set(ds["departments"]) - {None})),
                "DOWNSTREAM": json.dumps({"tables": ds["tables"][:12], "kpis": ds["kpis"][:15]}),
                "EVIDENCE": json.dumps({"state": st.get("STATE"), "direction": st.get("DIRECTION"), "polarity": polarity,
                                        "z": st.get("Z"), "actual": st.get("ACTUAL"), "expected": st.get("EXPECTED"),
                                        "unit": k.get("UNIT"), "business_name": k.get("BUSINESS_NAME"),
                                        "period": st.get("PERIOD_LABEL"), "completeness": st.get("COMPLETENESS"),
                                        "run_length": st.get("RUN_LENGTH"), "comparisons": st.get("COMPARISONS"),
                                        "drivers": drv[:4]}, default=str),
                "CANDIDATE_CAUSES": json.dumps(causes, default=str),
                "TECHNICAL_SUMMARY": st.get("WHY_TECHNICAL")})
        # segment scan: movements hidden inside totals (one drug, one provider, one state, one reason code)
        from . import segments
        mpr = {}
        for t, g in kpis.reset_index().groupby("TABLE_FQN"):
            cnt = g[g.KIND == "count"].KPI_ID
            mon = g[(g.KIND == "sum") & (g.UNIT == "USD")]
            if len(cnt) and len(mon):
                r = query_df(conn, f"""select sum(iff(KPI_ID = '{cnt.iloc[0]}', NUM, 0)) c, sum(iff(KPI_ID = '{mon.KPI_ID.iloc[0]}', NUM, 0)) m
                                      from {RS}.PI_KPI_DAILY where D >= dateadd(day, -365, '{today}')""").iloc[0]
                mpr[t] = (r.M / r.C) if r.C else None
        seen_seg = set()
        segs_all = []
        for kid, st in sts.items():
            if kid not in kpis.index:
                continue
            k = {"KPI_ID": kid, **kpis.loc[kid].to_dict()}
            segs_all += segments.scan_kpi(conn, k, st, mpr.get(k["TABLE_FQN"]))
        segs_all.sort(key=lambda o: -(o["usd"] or 0) - 500 * abs(o["z"]))
        for o in segs_all:
            key = (o["dim"].split(">")[-1], o["val"], o["kpi_id"].split(".")[2], o["current"] > o["baseline"])
            if key in seen_seg:
                continue                                    # the same segment through a sibling KPI of the same table
            seen_seg.add(key)
            k = {"KPI_ID": o["kpi_id"], **kpis.loc[o["kpi_id"]].to_dict()}
            fake = [{"dimension": o["dim"], "segments": [{"value": o["val"]}]}]
            label_values(conn, fake, k, tables, cols)
            o["label"] = fake[0]["segments"][0].get("label")
            fam, text = _cause_for(o["dim"])
            ds = impact.downstream(o["kpi_id"], data=data)
            bad = (o["current"] > o["baseline"]) == (k.get("DIRECTION_GOOD") == "down") if k.get("DIRECTION_GOOD") in ("up", "down") else None
            score = abs(o["z"]) * 0.8 * (1 + math.log10(1 + (o["usd"] or 0)) / 3) * (1.0 if bad else 0.6 if bad is None else 0.35)
            findings.append({
                "RUN_ID": run_id, "AS_OF": today, "FINDING_ID": f"seg:{o['kpi_id']}:{o['dim']}={o['val']}", "KIND": "segment_movement",
                "SUBJECT_ID": o["kpi_id"], "SCORE": round(score, 3), "USD_AT_STAKE": o["usd"], "MEMBERS_AFFECTED": None,
                "TIMING": f"happened: {o['window']}",
                "DEPARTMENTS": json.dumps(sorted({k.get("DEPARTMENT")} | set(ds["departments"]) - {None})),
                "DOWNSTREAM": json.dumps({"tables": ds["tables"][:12], "kpis": ds["kpis"][:15]}),
                "EVIDENCE": json.dumps({**o, "polarity": "bad" if bad else ("good" if bad is False else "neutral"),
                                        "direction": "up" if o["current"] > o["baseline"] else "down"}, default=str),
                "CANDIDATE_CAUSES": json.dumps([{"family": fam, "why": text, "dimension": o["dim"],
                                                 "top_segment": {"value": o["val"], "label": o["label"]}}]),
                "TECHNICAL_SUMMARY": (f"{o['kpi_id']} segment {o['dim']}={o['val']}: {o['baseline']:.4g} -> {o['current']:.4g} "
                                      f"({o['test']}, z {o['z']:+.1f}, window {o['window']})")})
        tm = tables.set_index("TABLE_FQN")
        for x in dq:
            if x["SEVERITY"] not in ("high", "medium") or not x["FAILED"]:
                continue
            ds = impact.downstream(x["TABLE_FQN"], data=data)
            w = {"high": 6.0, "medium": 3.5}[x["SEVERITY"]]
            findings.append({
                "RUN_ID": run_id, "AS_OF": today, "FINDING_ID": f"data:{x['CHECK_ID']}", "KIND": "data_issue",
                "SUBJECT_ID": x["TABLE_FQN"], "SCORE": round(w * (1 + math.log10(1 + x["FAILED"])) / 2, 3),
                "USD_AT_STAKE": None, "MEMBERS_AFFECTED": None, "TIMING": "now",
                "DEPARTMENTS": json.dumps(sorted({tm.DEPARTMENT.get(x["TABLE_FQN"]), "Data Platform"} | set(ds["departments"]) - {None})),
                "DOWNSTREAM": json.dumps({"tables": ds["tables"][:12], "kpis": ds["kpis"][:15]}),
                "EVIDENCE": json.dumps({**x, "business_name": tm.BUSINESS_NAME.get(x["TABLE_FQN"])}, default=str),
                "CANDIDATE_CAUSES": json.dumps([{"family": "data_issue", "why": {
                    "future_date": "records carry business dates that have not happened yet - a keying or system date error",
                    "load_gap": "records exist in the source system but have not reached the warehouse - a load delay or stuck feed",
                    "feed_stale": "no new records have arrived for longer than normal - an intake or load outage",
                    "header_line_mismatch": "claim totals do not equal the sum of their lines - an adjustment or recording inconsistency",
                    "duplicate_key": "the same record id appears more than once - a duplicate load",
                    "orphan_key": "records point at ids that do not exist in the reference table"}.get(x["CHECK_TYPE"], x["CHECK_TYPE"])}]),
                "TECHNICAL_SUMMARY": f"{x['CHECK_TYPE']} on {x['TABLE_FQN']}: {x['FAILED']} of {x.get('CHECKED')} rows; {x['DETAIL']}"})
    fdf = pd.DataFrame(findings)
    fdf = fdf.sort_values("SCORE", ascending=False)
    fdf["RANK"] = range(1, len(fdf) + 1)
    with session() as conn:
        replace_rows(conn, f"{RS}.PI_FINDING", fdf[["RUN_ID", "AS_OF", "FINDING_ID", "KIND", "SUBJECT_ID", "RANK", "SCORE",
                                                    "USD_AT_STAKE", "MEMBERS_AFFECTED", "TIMING", "DEPARTMENTS",
                                                    "DOWNSTREAM", "EVIDENCE", "CANDIDATE_CAUSES", "TECHNICAL_SUMMARY"]],
                     where=f"AS_OF = '{today}' and KIND in ('kpi_movement', 'data_issue', 'segment_movement')")
    (OUT / "findings.json").write_text(json.dumps(fdf.to_dict("records"), default=str, indent=1))
    return {"findings": len(fdf), "kpi_movements": int((fdf.KIND == "kpi_movement").sum()),
            "segment_movements": int((fdf.KIND == "segment_movement").sum()),
            "data_issues": int((fdf.KIND == "data_issue").sum())}
