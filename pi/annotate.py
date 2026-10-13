"""Write agent-authored business language onto today's warnings.

Input JSON (written by the detector / risk agents):
{
  "warnings": [
    {"warning_id": "W-20261011-001",            # or "dedup_key": "kpi:...:up"
     "title": "...", "business_reason": "...", "impact_text": "...", "what_to_do": "...",
     "external_signal": "FDA lists X in shortage since 2026-09-20 (https://...)",   # optional, with source link
     "reason_confidence": "high|medium|low"}     # how sure the reason is - required
  ]
}
Only these text fields change; numbers, evidence and severity stay as the engine computed them."""
from __future__ import annotations

import json
from pathlib import Path

from .config import OUT, RS, as_of
from .db import execute, session

FIELDS = ("TITLE", "BUSINESS_REASON", "IMPACT_TEXT", "WHAT_TO_DO", "EXTERNAL_SIGNAL", "REASON_CONFIDENCE")


def run(path: str) -> dict:
    today = as_of()
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    n = 0
    with session() as conn:
        for w in data.get("warnings", []):
            if not w.get("reason_confidence"):
                raise ValueError(f"reason_confidence is required ({w.get('warning_id') or w.get('dedup_key')})")
            sets, params = [], []
            for f in FIELDS:
                if f.lower() in w and w[f.lower()] is not None:
                    sets.append(f"{f} = %s")
                    params.append(str(w[f.lower()]))
            if not sets:
                continue
            if w.get("warning_id"):
                where, key = "WARNING_ID = %s", w["warning_id"]
            else:
                where, key = "DEDUP_KEY = %s", w["dedup_key"]
            n += execute(conn, f"update {RS}.PI_WARNING set {', '.join(sets)} where AS_OF = '{today}' and {where}",
                         params + [key])
    (OUT / "annotations").mkdir(parents=True, exist_ok=True)
    (OUT / "annotations" / f"{today}.json").write_text(json.dumps(data, indent=1), encoding="utf-8")
    return {"warnings_updated": n}
