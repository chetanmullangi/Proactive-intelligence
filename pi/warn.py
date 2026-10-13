"""Layer 8 - findings become ranked warnings people can act on.

Each warning carries: what is happening or about to happen, the (candidate) business reason, the downstream impact
(tables, KPIs, departments) and dollars at stake, timing, severity, and whether it is new, continuing or resolved
compared with the previous run. Default wording is generated from the evidence; the detector / risk agents then
replace it with plain business language and real-world context (`python -m pi annotate`), and that wording is
carried forward while a warning continues."""
from __future__ import annotations

import json

import pandas as pd

from .config import OUT, RS, as_of
from .db import query_df, replace_rows, session

DO = {
    "provider": "Contact the provider's office / provider relations to confirm what changed (billing system, contract, staffing).",
    "employer_group": "Check with account management whether the employer group changed (renewal, termination, new hires, plan change).",
    "region": "Check local news and disaster declarations for that area; prepare for a catch-up surge once the event passes.",
    "rule_or_policy": "Review recent rule, edit or authorization-policy changes for that reason code; expect appeals and resubmissions.",
    "drug": "Check FDA shortage lists, price changes and formulary updates for that drug class; prepare substitutions and member outreach.",
    "product": "Review benefit, pricing or enrollment changes for that plan or segment.",
    "intake": "Check the intake channel / clearinghouse status and the processing queue for that path.",
    "service_mix": "Review utilization and authorizations for that service; check for a high-cost case cluster or seasonal illness.",
    "processing": "Check the work queue, staffing and turnaround for the affected status; plan overtime if a backlog is building.",
    "membership": "Size the impact against membership changes before acting on the rate itself.",
    "data_issue": "Ask the data platform team to check the load / source records before acting on the business number.",
    "broad": "Treat as a business-wide shift; confirm with finance / operations whether demand, membership or the calendar explains it.",
    "upstream": "Look at the upstream measure that moved first; its owner can usually explain this one.",
}


def _fmt(v, unit):
    if v is None or (isinstance(v, float) and v != v):
        return "n/a"
    if unit == "USD":
        return f"${v:,.0f}"
    if unit == "share":
        return f"{100 * v:.1f}%"
    if unit == "days":
        return f"{v:.1f} days"
    return f"{v:,.0f}" if abs(v) >= 100 else f"{v:,.2f}"


def _default_text(f: dict, ev: dict, causes: list[dict], tnames: dict) -> tuple[str, str, str, str]:
    kind = f["KIND"]
    if kind == "kpi_movement":
        name = ev.get("business_name")
        a, e, u = ev.get("actual"), ev.get("expected"), ev.get("unit")
        pct = (a / e - 1) * 100 if a is not None and e not in (None, 0) else None
        word = "higher" if ev.get("direction") == "up" else "lower"
        title = f"{name}: {_fmt(a, u)} vs about {_fmt(e, u)} expected" + (f" ({abs(pct):.0f}% {word})" if pct is not None else "") + \
                f" - {ev.get('period')}"
        c0 = causes[0] if causes else {}
        seg = c0.get("top_segment") or {}
        segtxt = seg.get("label") or seg.get("value")
        reason = (f"Most of the change sits in {c0.get('dimension', '').split('>')[-1].replace('_', ' ').lower()} "
                  f"'{segtxt}' ({100 * min(c0.get('share_of_change', 0), 1):.0f}% of the change vs {100 * c0.get('normal_share', 0):.0f}% of normal volume): "
                  f"{c0.get('why')}.") if segtxt else (c0.get("why", "No single segment explains it.").capitalize() + ".")
        todo = DO.get(c0.get("family"), DO["broad"])
    elif kind == "segment_movement":
        seg = ev.get("label") or ev.get("val")
        dimw = ev.get("dim", "").split(">")[-1].replace("_", " ").lower()
        u = ev.get("unit")
        if ev.get("kind") == "rate":
            title = (f"{ev.get('business_name')} for {dimw} '{seg}': {_fmt(ev['current'], 'share')} vs "
                     f"{_fmt(ev['baseline'], 'share')} {'last year' if ev['test'] == 'vs_last_year' else 'before'}")
        else:
            per = "week" if ev.get("grain") == "week" else "month"
            title = (f"{ev.get('business_name')} for {dimw} '{seg}': about {ev['current']:,.0f} a {per} vs "
                     f"{ev['baseline']:,.0f} {'a year ago' if ev['test'] == 'vs_last_year' else 'before'}"
                     + (f" ({ev['pct']:+.0f}%)" if ev.get("pct") is not None else ""))
        c0 = causes[0] if causes else {}
        reason = (f"The change is concentrated in this one {dimw} while the company-wide total moved much less: "
                  f"{c0.get('why', '')}." + (" It has persisted long enough to be absorbed into the recent baseline - "
                                             "it shows against last year." if ev.get("test") == "vs_last_year" else ""))
        todo = DO.get(c0.get("family"), DO["broad"])
    elif kind == "data_issue":
        title = f"Data problem in {ev.get('business_name')}: {ev.get('CHECK_TYPE', '').replace('_', ' ')} ({ev.get('FAILED')} records)"
        reason = (causes[0]["why"] if causes else "") + "."
        todo = DO["data_issue"]
    elif kind == "projection":
        title = (f"Expect about {ev['expected_next_4_weeks']:.0f} {ev['child'].lower()} records in the next 4 weeks "
                 f"({'up' if ev['direction'] == 'up' else 'down'} {abs(ev['ratio'] - 1) * 100:.0f}% vs the pipeline 4 weeks ago)")
        reason = (f"Open items now in the pipeline ({ev['open_items']} {ev['parent'].lower()} records"
                  + (f", {ev['segment'].split('=')[1].lower()}" if ev.get("segment") else "") +
                  f") and the learned delay: {ev['learned']} The same projection made 4 weeks ago was off by "
                  f"{ev['projection_check']['error_pct']}%.")
        todo = "Plan capacity / cash for the coming change now; confirm with the owning team that the pipeline is complete."
    elif kind == "scheduled":
        title = (f"{ev['next_13_weeks']} {ev['business_name'].lower()} records are already dated in the next 13 weeks "
                 f"({100 * ev['share_of_base']:.1f}% of the {ev['in_force_today']:,} in force)")
        reason = f"Dates already recorded between {ev['first_date']} and {ev['last_date']}."
        todo = "Plan outreach / retention and adjust capacity and revenue forecasts for the scheduled change."
    else:  # outlook
        title = (f"{ev['business_name']} projected {_fmt(ev['projected'], ev['unit'])} for {ev['period']} "
                 f"({ev['change_pct']:+.1f}% vs the same quarter last year)")
        reason = f"Forecast from the current run-rate and history; range {_fmt(ev['lower'], ev['unit'])} to {_fmt(ev['upper'], ev['unit'])}."
        todo = "Review the cost and revenue drivers behind the projection with finance."
    ds = json.loads(f["DOWNSTREAM"] or "{}")
    deps = json.loads(f["DEPARTMENTS"] or "[]")
    dt = [tnames.get(t["table"], t["table"]) for t in (ds.get("tables") or [])[:5]]
    impact = (f"Owners: {', '.join(deps)}." + (f" Downstream: {', '.join(dt)}." if dt else "") +
              (f" About ${f['USD_AT_STAKE']:,.0f} at stake." if f.get("USD_AT_STAKE") else ""))
    return title, reason, impact, todo


def _severity(score: float) -> str:
    return "critical" if score >= 25 else "high" if score >= 10 else "medium" if score >= 5 else "low"


def dedup_key(f: dict, ev: dict) -> str:
    if f["KIND"] == "segment_movement":
        return f"seg:{f['SUBJECT_ID']}:{ev.get('dim')}={ev.get('val')}:{ev.get('direction')}"
    if f["KIND"] == "kpi_movement":
        return f"kpi:{f['SUBJECT_ID']}:{ev.get('direction')}"
    if f["KIND"] == "outlook":
        return f"outlook:{f['SUBJECT_ID']}:{ev.get('period')}"
    return f["FINDING_ID"]


def run(run_id: str) -> dict:
    today = as_of()
    with session() as conn:
        fnd = query_df(conn, f"select * from {RS}.PI_FINDING where AS_OF = '{today}'")
        prev = query_df(conn, f"""select * from {RS}.PI_WARNING where AS_OF = (select max(AS_OF) from {RS}.PI_WARNING
                                  where AS_OF < '{today}')""")
        same_day = query_df(conn, f"select * from {RS}.PI_WARNING where AS_OF = '{today}'")
        tnames = dict(query_df(conn, f"select TABLE_FQN, BUSINESS_NAME from {RS}.PI_TABLE").values)
    prev_by = {r.DEDUP_KEY: r for r in prev.itertuples()} if len(prev) else {}
    today_by = {r.DEDUP_KEY: r for r in same_day.itertuples()} if len(same_day) else {}   # keep today's agent text on re-runs
    rows = []
    for f in fnd.sort_values("SCORE", ascending=False).to_dict("records"):
        ev = json.loads(f["EVIDENCE"] or "{}")
        causes = json.loads(f["CANDIDATE_CAUSES"] or "[]")
        key = dedup_key(f, ev)
        title, reason, impact, todo = _default_text(f, ev, causes, tnames)
        p = prev_by.get(key)
        t = today_by.get(key)
        carried = t if (t is not None and t.REASON_CONFIDENCE) else (p if (p is not None and p.REASON_CONFIDENCE) else None)
        polarity = ev.get("polarity", "bad")
        kind = {"kpi_movement": "happening", "segment_movement": "happening", "data_issue": "data",
                "projection": "coming", "scheduled": "coming", "outlook": "coming"}[f["KIND"]]
        if f["KIND"] in ("kpi_movement", "segment_movement") and polarity == "good":
            kind = "good_news"
        rows.append({
            "RUN_ID": run_id, "AS_OF": today, "WARNING_ID": f"W-{today:%Y%m%d}-{len(rows) + 1:03d}", "FINDING_ID": f["FINDING_ID"],
            "DEDUP_KEY": key, "STATUS": "continuing" if p is not None else "new",
            "FIRST_SEEN": p.FIRST_SEEN if p is not None else today,
            "SEVERITY": _severity(f["SCORE"]) if kind != "good_news" else "info", "KIND": kind,
            "TITLE": carried.TITLE if carried is not None else title,
            "BUSINESS_REASON": carried.BUSINESS_REASON if carried is not None else reason,
            "IMPACT_TEXT": carried.IMPACT_TEXT if carried is not None else impact,
            "WHAT_TO_DO": carried.WHAT_TO_DO if carried is not None else todo,
            "EXTERNAL_SIGNAL": carried.EXTERNAL_SIGNAL if carried is not None else None,
            "REASON_CONFIDENCE": carried.REASON_CONFIDENCE if carried is not None else None,
            "DEPARTMENTS": f["DEPARTMENTS"], "DOWNSTREAM": f["DOWNSTREAM"], "USD_AT_STAKE": f["USD_AT_STAKE"],
            "TIMING": f["TIMING"], "EVIDENCE": json.dumps({"finding": ev, "causes": causes, "score": f["SCORE"],
                                                           "technical": f["TECHNICAL_SUMMARY"]}, default=str)})
    for key, p in prev_by.items():
        if key not in {r["DEDUP_KEY"] for r in rows} and p.STATUS != "resolved":
            rows.append({**{c: getattr(p, c) for c in ("FINDING_ID", "DEDUP_KEY", "FIRST_SEEN", "KIND", "TITLE",
                                                         "BUSINESS_REASON", "IMPACT_TEXT", "WHAT_TO_DO", "EXTERNAL_SIGNAL",
                                                         "REASON_CONFIDENCE", "DEPARTMENTS", "DOWNSTREAM", "USD_AT_STAKE",
                                                         "TIMING", "EVIDENCE")},
                         "RUN_ID": run_id, "AS_OF": today, "WARNING_ID": f"W-{today:%Y%m%d}-{len(rows) + 1:03d}",
                         "STATUS": "resolved", "SEVERITY": "info"})
    df = pd.DataFrame(rows)
    with session() as conn:
        replace_rows(conn, f"{RS}.PI_WARNING", df, where=f"AS_OF = '{today}'")
    (OUT / "warnings.json").write_text(json.dumps(df.to_dict("records"), default=str, indent=1))
    return {"warnings": len(df), "by_severity": df.SEVERITY.value_counts().to_dict(), "by_kind": df.KIND.value_counts().to_dict(),
            "new": int((df.STATUS == "new").sum()), "continuing": int((df.STATUS == "continuing").sum()),
            "resolved": int((df.STATUS == "resolved").sum())}
