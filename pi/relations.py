"""Layer 4b - how KPIs move together, and which lead others.

For every pair of KPIs on different tables, on de-trended weekly (or monthly) changes, test lags of 0..N weeks.
A link is kept only if it is
  - statistically significant after allowing for the number of lags tried,
  - stable: same sign and a meaningful size in both halves of the history,
  - backed by a business pathway: the two tables are connected by a load, a fact-to-fact key or a learned process
    within a few hops. Correlation without a pathway is treated as coincidence and never shown as a cause."""
from __future__ import annotations

import json
from collections import deque
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from scipy import stats

from .config import CONFIG, RS, as_of
from .db import query_df, replace_rows, session

R = CONFIG["relations"]


def pathway_graph(tables: pd.DataFrame, edges: pd.DataFrame) -> dict[str, set[str]]:
    facts = set(tables[tables.TABLE_ROLE.isin(["fact", "span", "mart"])].TABLE_FQN)
    g: dict[str, set[str]] = {}
    use = edges[(edges.KIND.isin(["data_flow", "process_chain"]) & (edges.CONFIDENCE != "low")) |
                ((edges.KIND == "foreign_key") & edges.FROM_NODE.isin(facts) & edges.TO_NODE.isin(facts))]
    for e in use.itertuples():
        g.setdefault(e.FROM_NODE, set()).add(e.TO_NODE)
        g.setdefault(e.TO_NODE, set()).add(e.FROM_NODE)
    return g


def hops(g, a, b, limit) -> list[str] | None:
    if a == b:
        return [a]
    q, seen = deque([[a]]), {a}
    while q:
        path = q.popleft()
        if len(path) - 1 >= limit:
            continue
        for n in g.get(path[-1], ()):
            if n in seen:
                continue
            if n == b:
                return path + [n]
            seen.add(n)
            q.append(path + [n])
    return None


def series(state: dict, grain: str) -> dict[str, pd.Series]:
    out = {}
    for k in state["kpis"]:
        if k.get("GRAIN") != grain or not k.get("SERIES"):
            continue
        s = pd.Series({pd.Timestamp(x["p"]): x["v"] for x in k["SERIES"] if x["v"] is not None}, dtype=float)
        if len(s) >= 20 and s.std() > 0:
            out[k["KPI_ID"]] = s
    return out


def transform(s: pd.Series, unit: str) -> pd.Series:
    if unit in ("share", "days", "number") or (s <= 0).any():
        return s.diff()
    return np.log(s).diff()


def run() -> dict:
    today = as_of()
    from .config import OUT
    state = json.loads((OUT / "kpi_state.json").read_text())
    meta = {k["KPI_ID"]: k for k in state["kpis"]}
    with session() as conn:
        tables = query_df(conn, f"select * from {RS}.PI_TABLE")
        edges = query_df(conn, f"select * from {RS}.PI_EDGE where KIND <> 'kpi_link'")
    g = pathway_graph(tables, edges)
    links = []
    for grain, min_n, max_lag, step in (("week", R["min_overlap"], R["max_lag_weeks"], 7), ("month", 24, 3, 30)):
        ser = {k: transform(v, meta[k]["UNIT"]).dropna() for k, v in series(state, grain).items()}
        ids = sorted(ser)
        for i, a in enumerate(ids):
            for b in ids:
                if a == b or meta[a]["TABLE_FQN"] == meta[b]["TABLE_FQN"]:
                    continue                        # same table: mechanical, not a business link
                path = hops(g, meta[a]["TABLE_FQN"], meta[b]["TABLE_FQN"], R["max_path_hops"])
                if path is None:
                    continue
                best = None
                for lag in range(0, max_lag + 1):
                    if lag == 0 and a > b:
                        continue                    # contemporaneous pairs once
                    x = ser[a].shift(lag, freq={"week": "7D", "month": "MS"}[grain]) if grain == "week" else \
                        ser[a].copy().set_axis(ser[a].index + pd.DateOffset(months=lag))
                    j = pd.concat([x, ser[b]], axis=1, join="inner").dropna()
                    if len(j) < min_n:
                        continue
                    r, p = stats.pearsonr(j.iloc[:, 0], j.iloc[:, 1])
                    p_adj = min(1.0, p * (max_lag + 1))
                    h = len(j) // 2
                    r1 = np.corrcoef(j.iloc[:h, 0], j.iloc[:h, 1])[0, 1]
                    r2 = np.corrcoef(j.iloc[h:, 0], j.iloc[h:, 1])[0, 1]
                    stable = np.sign(r1) == np.sign(r2) == np.sign(r) and min(abs(r1), abs(r2)) >= 0.15
                    if abs(r) >= R["min_abs_r"] and p_adj < 0.01 and stable and (best is None or abs(r) > abs(best["r"])):
                        best = {"r": float(r), "p_adj": float(p_adj), "lag": lag, "n": int(len(j)),
                                "r_halves": [round(float(r1), 3), round(float(r2), 3)]}
                if best:
                    links.append({"EDGE_ID": f"kpi:{a}>{b}", "KIND": "kpi_link", "FROM_NODE": a, "TO_NODE": b,
                                  "FROM_COLUMN": None, "TO_COLUMN": None, "SOURCE": "learned",
                                  "CONFIDENCE": "high" if abs(best["r"]) >= 0.5 else "medium",
                                  "STRENGTH": round(best["r"], 4), "LAG_DAYS": best["lag"] * step,
                                  "EVIDENCE": json.dumps({**best, "grain": grain, "pathway": path,
                                                          "leads": best["lag"] > 0,
                                                          # the same numbers recorded twice (header vs lines, table vs
                                                          # mart): real dependency, not a business insight
                                                          "mechanical": best["lag"] == 0 and abs(best["r"]) >= 0.9
                                                          and len(path) <= 2}),
                                  "UPDATED_TS": datetime.utcnow()})
    df = pd.DataFrame(links)
    with session() as conn:
        replace_rows(conn, f"{RS}.PI_EDGE", df, where="KIND = 'kpi_link'")
    lead = int(sum(1 for l in links if json.loads(l["EVIDENCE"])["lag"] > 0))
    return {"kpi_links": len(links), "leading": lead, "contemporaneous": len(links) - lead}
