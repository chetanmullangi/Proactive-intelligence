"""Engine settings (config/pi.yaml) and the profiler-maintained business overrides (config/semantic_overrides.yaml)."""
from __future__ import annotations

import fnmatch
import os
from datetime import date, timedelta
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
CONFIG = yaml.safe_load((ROOT / "config" / "pi.yaml").read_text(encoding="utf-8"))
DB = CONFIG["database"]
RS = f"{DB}.{CONFIG['results_schema']}"                 # fully-qualified results schema
OUT = ROOT / "reports" / DB / "pi"                       # local copies of every result (agents and the web export read these)
OVERRIDES_PATH = ROOT / "config" / "semantic_overrides.yaml"


def overrides() -> dict:
    if OVERRIDES_PATH.exists():
        return yaml.safe_load(OVERRIDES_PATH.read_text(encoding="utf-8")) or {}
    return {}


def as_of() -> date:
    v = os.environ.get("PI_AS_OF")
    if v:
        return date.fromisoformat(v)
    return date.today() - timedelta(days=int(CONFIG["as_of_offset_days"]))


def schema_allowed(schema: str) -> bool:
    return not any(fnmatch.fnmatch(schema.upper(), p.upper()) for p in CONFIG["exclude_schemas"])


def table_allowed(schema: str, table: str) -> bool:
    return schema_allowed(schema) and not any(fnmatch.fnmatch(table.upper(), p.upper()) for p in CONFIG["exclude_tables"])
