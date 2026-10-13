"""Downstream impact: from a table or a KPI, everything that depends on it, how fast, and who owns it.

Traverses loads (source -> warehouse -> marts), learned process chains (claim -> payment, denial -> appeal) and
KPI links (one KPI moving ahead of another). Key lookups from a dimension are followed only one hop (a provider
record feeds the claims that reference it), so a member or date table does not make everything 'downstream'."""
from __future__ import annotations

import json
from collections import deque

import pandas as pd

from .config import RS
from .db import query_df, session

_CACHE: dict = {}


def _load():
    if not _CACHE:
        with session() as conn:
            _CACHE["edges"] = query_df(conn, f"select * from {RS}.PI_EDGE")
            _CACHE["tables"] = query_df(conn, f"select TABLE_FQN, BUSINESS_NAME, DEPARTMENT, TABLE_ROLE, SUPERSEDED_BY, IS_KPI_SOURCE from {RS}.PI_TABLE")
            _CACHE["kpis"] = query_df(conn, f"select KPI_ID, TABLE_FQN, BUSINESS_NAME, DEPARTMENT from {RS}.PI_KPI")
    return _CACHE["edges"], _CACHE["tables"], _CACHE["kpis"]


def downstream(node: str, max_hops: int = 4, data=None) -> dict:
    edges, tables, kpis = data or _load()
    node_u = node.upper() if node.upper() in set(tables.TABLE_FQN) else node.lower()
    tmeta = tables.set_index("TABLE_FQN")
    kmeta = kpis.set_index("KPI_ID")
    adj: dict[str, list[tuple[str, str, float | None, str]]] = {}
    order = {"process_chain": 0, "data_flow": 1, "kpi_link": 2, "foreign_key": 3}
    edges = edges.assign(_o=edges.KIND.map(order).fillna(9)).sort_values("_o")
    for e in edges.itertuples():
        if e.KIND == "data_flow" and e.CONFIDENCE == "low":
            continue
        if e.KIND == "foreign_key":
            prole = tmeta.TABLE_ROLE.get(e.FROM_NODE)
            if prole in ("reference",) or e.FROM_NODE.endswith(("REF_DATE",)):
                continue
        ev = json.loads(e.EVIDENCE) if isinstance(e.EVIDENCE, str) else {}
        why = ev.get("text") or {"data_flow": "loads into", "foreign_key": f"is referenced by ({e.TO_COLUMN})",
                                  "kpi_link": "moves with" if not ev.get("leads") else "moves ahead of"}.get(e.KIND, e.KIND)
        adj.setdefault(e.FROM_NODE, []).append((e.TO_NODE, e.KIND, e.LAG_DAYS, why))
    start_tables = [node_u] if node_u in tmeta.index else []
    start_kpis = [node_u] if node_u in kmeta.index else []
    if start_kpis:
        start_tables.append(kmeta.TABLE_FQN.get(node_u))
    seen = {}
    q = deque([(n, 0, 0.0, []) for n in start_tables + start_kpis])
    while q:
        n, h, lag, path = q.popleft()
        if n in seen and seen[n]["hops"] <= h:
            continue
        seen[n] = {"hops": h, "lag_days": lag, "path": path}
        if h >= max_hops:
            continue
        for (m, kind, l, why) in adj.get(n, []):
            if kind == "foreign_key" and h >= 1 and tmeta.TABLE_ROLE.get(n) in ("dimension",):
                continue                                   # dimension lookups: one hop only
            q.append((m, h + 1, lag + (float(l) if l and pd.notna(l) else 0.0), path + [{"from": n, "to": m, "kind": kind, "why": why}]))
    out_tables, out_kpis, deps = [], [], {}
    for n, v in seen.items():
        if v["hops"] == 0:
            continue
        if n in tmeta.index:
            dep = tmeta.DEPARTMENT.get(n)
            out_tables.append({"table": n, "business_name": tmeta.BUSINESS_NAME.get(n), "department": dep,
                               "hops": v["hops"], "typical_delay_days": round(v["lag_days"], 1), "path": v["path"]})
            deps.setdefault(dep, set()).add(n)
            for kid in kpis[kpis.TABLE_FQN == n].KPI_ID:
                out_kpis.append({"kpi_id": kid, "business_name": kmeta.BUSINESS_NAME.get(kid), "via_table": n,
                                 "department": kmeta.DEPARTMENT.get(kid), "hops": v["hops"],
                                 "typical_delay_days": round(v["lag_days"], 1)})
        elif n in kmeta.index:
            out_kpis.append({"kpi_id": n, "business_name": kmeta.BUSINESS_NAME.get(n), "via_table": None,
                             "department": kmeta.DEPARTMENT.get(n), "hops": v["hops"],
                             "typical_delay_days": round(v["lag_days"], 1), "linked": True, "path": v["path"]})
            deps.setdefault(kmeta.DEPARTMENT.get(n), set())
    return {"node": node_u, "tables": sorted(out_tables, key=lambda x: (x["hops"], x["typical_delay_days"])),
            "kpis": sorted(out_kpis, key=lambda x: (x["hops"], x["typical_delay_days"]))[:60],
            "departments": sorted(d for d in deps if d)}
