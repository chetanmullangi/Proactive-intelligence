"""python -m pi <command>

  setup                 create the results schema and tables (HEALTH_CARE.ANALYTICS)
  profile [--force]     layer 1+4a: catalog every table, lineage, replicas        (profiler agent)
  kpis [--rebuild]      layer 0+3: KPI definitions + incremental daily summary   (profiler agent)
  process               layer 2: business process chains (conversion and delay)  (profiler agent)
  analyze               layer 3+4b: state of every KPI, data checks, KPI links   (detector agent)
  explain               layer 7: evidence and candidate business causes          (detector agent)
  project               layer 5+6: open-items projection, forecasts, outlook     (risk agent)
  warn                  layer 8: findings -> ranked warnings with impact         (risk agent)
  annotate FILE         write agent-authored business text onto findings/warnings/KPIs/tables
  impact NODE           downstream impact of a table or KPI (prints JSON)
  export                write web/public/data/*.json for the app
  daily                 everything, in order (what the scheduler runs)
  status                last runs per step
  show WHAT [FILTER]    compact, readable listings for agents:
                        tables | columns TABLE | kpis [TABLE] | chains | links | checks | findings | warnings |
                        outlook | forecasts | overrides-template
"""
from __future__ import annotations

import json
import sys
import time
import traceback
import uuid
from datetime import datetime

from .config import RS, as_of


def _log(step: str, fn, *a, **k):
    from .db import insert_df, session
    import pandas as pd
    run_id = _run_id()
    t0, started = time.time(), datetime.utcnow()
    status, detail = "SUCCEEDED", None
    try:
        res = fn(*a, **k)
        detail = json.dumps(res, default=str)
        print(f"[{step}] ok {detail}")
        return res
    except Exception as e:
        status, detail = "FAILED", f"{type(e).__name__}: {e}"
        traceback.print_exc()
        raise
    finally:
        try:
            with session() as conn:
                insert_df(conn, f"{RS}.PI_RUN_LOG", pd.DataFrame([{
                    "RUN_ID": run_id, "AS_OF": as_of(), "STEP": step, "STATUS": status, "STARTED_TS": started,
                    "FINISHED_TS": datetime.utcnow(), "SECONDS": round(time.time() - t0, 1), "DETAIL": (detail or "")[:4000]}]))
        except Exception as e:  # logging must never mask the real error
            print(f"(run log not written: {e})")


_RID = None


def _run_id():
    global _RID
    if _RID is None:
        import os
        _RID = os.environ.get("PI_RUN_ID") or f"PI-{as_of():%Y%m%d}-{uuid.uuid4().hex[:6]}"
    return _RID


def main(argv: list[str]):
    if not argv:
        print(__doc__)
        return
    cmd, rest = argv[0], argv[1:]
    if cmd == "setup":
        from .db import session
        from .store import setup
        with session() as conn:
            setup(conn)
        print("results schema ready:", RS)
    elif cmd == "profile":
        from . import catalog, lineage
        _log("catalog", catalog.run, force="--force" in rest)
        _log("lineage", lineage.run)
    elif cmd == "kpis":
        from . import kpis
        _log("kpis", kpis.run, rebuild="--rebuild" in rest)
    elif cmd == "process":
        from . import process
        _log("process", process.run)
    elif cmd == "analyze":
        from . import analyze, relations
        _log("analyze", analyze.run, _run_id())
        _log("relations", relations.run)
    elif cmd == "explain":
        from . import explain
        _log("explain", explain.run, _run_id())
    elif cmd == "project":
        from . import project
        _log("project", project.run, _run_id())
    elif cmd == "warn":
        from . import warn
        _log("warn", warn.run, _run_id())
    elif cmd == "annotate":
        from . import annotate
        _log("annotate", annotate.run, rest[0])
    elif cmd == "impact":
        from . import impact
        print(json.dumps(impact.downstream(rest[0]), indent=2, default=str))
    elif cmd == "export":
        from . import export
        _log("export", export.run)
    elif cmd == "daily":
        for c in (["profile"], ["kpis"], ["process"], ["analyze"], ["explain"], ["project"], ["warn"], ["export"]):
            main(c)
    elif cmd == "show":
        from . import show
        show.run(rest[0] if rest else "tables", rest[1] if len(rest) > 1 else None)
    elif cmd == "status":
        from .db import query_df, session
        with session() as conn:
            print(query_df(conn, f"""select step, status, as_of, run_id, seconds, finished_ts, left(detail, 160) detail
                from {RS}.PI_RUN_LOG qualify row_number() over (partition by step order by finished_ts desc) <= 2
                order by finished_ts desc""").to_string())
    else:
        print(__doc__)
        sys.exit(2)


if __name__ == "__main__":
    main(sys.argv[1:])
