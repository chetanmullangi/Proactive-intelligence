"""Grade the framework against the simulator's answer key.   py -3.12 -m eval.grade

THIS IS THE ONLY CODE ALLOWED TO READ HEALTH_CARE.SIMULATION_CONTROL. It is not part of the framework (pi/) and the
framework never sees its output. It answers: of the business events the simulator injected recently, which did the
framework surface (a finding on the same measure family, the same segment where the event was scoped, in an
overlapping period), which did it miss, and which are still too recent to judge because their data has not arrived.

Each run appends to reports/HEALTH_CARE/pi/grading.jsonl so recall can be tracked as daily runs accumulate."""
from __future__ import annotations

import json
import re
from datetime import timedelta

import pandas as pd

from pi.config import OUT, RS, as_of
from pi.db import query_df, session

# simulator metric -> words that identify the framework KPI / check family
FAMILY = {
    "claims_received": ["medical_claim_header.count", "medical_claim_line.count", "fact_encounter.count"],
    "denial": ["claim_status.denied", "line_status.denied", "authorization_status.denied"],
    "appeal": ["fact_appeal"],
    "auth_turnaround": ["fact_prior_authorization.days", "turnaround"],
    "pending": ["pended", "authorization_status.pending"],
    "paid_amount": ["plan_paid", "paid_amount", "allowed", "billed"],
    "fills": ["pharmacy_claim.count", "pharmacy_claim.sum"],
    "rx_days_to_paid": ["pharmacy_claim.days"],
    "warehouse_rows": ["load_gap", "feed_stale"],
    "duplicate": ["duplicate"],
    "provider_claims": ["medical_claim_header.count", "provider"],
    "visits": ["fact_encounter.count", "medical_claim_header.count"],
    "resubmission": ["corrected", "original_claim_id", "claim_type"],
    "grievance": ["fact_grievance"],
    "enrollment": ["member_eligibility", "member_month"],
}


def family(metric: str) -> list[str]:
    m = metric.lower()
    for key, words in FAMILY.items():
        if key.split("_")[0] in m or key in m:
            return words
    if "visit" in m or "er_" in m:
        return FAMILY["visits"]
    return [m]


def run() -> dict:
    today = as_of()
    with session() as conn:
        ev = query_df(conn, """select EVENT_ID, ARCHETYPE, DOMAIN, SEVERITY_LEVEL, START_DATE, PLANNED_END_DATE, ACTUAL_END_DATE,
                                      EXPECTED_IMPACTS::varchar IMP, SCOPE::varchar SCOPE, TITLE
                               from HEALTH_CARE.SIMULATION_CONTROL.BUSINESS_EVENT""")
        fnd = query_df(conn, f"select FINDING_ID, KIND, SUBJECT_ID, TIMING, EVIDENCE, CANDIDATE_CAUSES from {RS}.PI_FINDING where AS_OF = '{today}'")
    lo = today - timedelta(days=70)
    rows = []
    for e in ev.itertuples():
        end = pd.Timestamp(e.ACTUAL_END_DATE or e.PLANNED_END_DATE or today).date()
        start = pd.Timestamp(e.START_DATE).date()
        if end < lo or start > today:
            continue
        impacts = json.loads(e.IMP or "[]")
        words = sorted({w for i in impacts if (i.get("change_pct") or 0) != 0 for w in family(i.get("metric", ""))})
        scopes = [str(i.get("scope") or "") for i in impacts]
        hits = []
        for f in fnd.itertuples():
            text = (f.SUBJECT_ID + " " + f.FINDING_ID + " " + (f.EVIDENCE or "")[:3000]).lower()
            if not any(w.lower() in text for w in words):
                continue
            m = re.findall(r"(\d{4}-\d{2}-\d{2})", f.TIMING or "")
            if m:
                w0 = pd.Timestamp(m[0]).date()
                w1 = pd.Timestamp(m[-1]).date() if len(m) > 1 else w0 + timedelta(days=6)
                if w1 < start or w0 > end + timedelta(days=45):
                    continue
            scoped = any(s and len(s) > 3 and s.lower().split(" #")[0] in text for s in scopes)
            hits.append({"finding": f.FINDING_ID, "kind": f.KIND, "segment_match": scoped})
        too_recent = start > today - timedelta(days=21)
        status = "detected" if hits else ("too_recent" if too_recent else "missed")
        rows.append({"event": e.EVENT_ID, "archetype": e.ARCHETYPE, "severity": e.SEVERITY_LEVEL, "start": str(start),
                     "end": str(end), "title": e.TITLE, "status": status,
                     "segment_matched": any(h["segment_match"] for h in hits), "hits": hits[:5]})
    df = pd.DataFrame(rows)
    judged = df[df.status != "too_recent"] if len(df) else df
    res = {"as_of": str(today), "events_in_window": len(df), "judged": len(judged),
           "detected": int((judged.status == "detected").sum()) if len(judged) else 0,
           "recall": round(float((judged.status == "detected").mean()), 3) if len(judged) else None,
           "too_recent": int((df.status == "too_recent").sum()) if len(df) else 0,
           "findings_today": len(fnd), "events": rows}
    with open(OUT / "grading.jsonl", "a", encoding="utf-8") as fh:
        fh.write(json.dumps({k: v for k, v in res.items() if k != "events"}) + "\n")
    (OUT / "grading_latest.json").write_text(json.dumps(res, indent=1, default=str))
    return res


if __name__ == "__main__":
    r = run()
    print({k: v for k, v in r.items() if k != "events"})
    for e in r["events"]:
        print(f"  {e['status']:10s} {e['event']} {e['archetype']:28s} {e['start']}..{e['end']} {e['title'][:60]}"
              + (f"  <- {e['hits'][0]['finding'][:90]}" if e["hits"] else ""))
