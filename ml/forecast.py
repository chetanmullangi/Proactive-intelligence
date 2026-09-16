"""
forecast.py - forecast a KPI time series with LightGBM, using train.py's trainer.

    python forecast.py <series_id> data/<series_id>_series.csv --grain week --horizon 4

Input CSV: two columns, `bucket` (date) and `value`, covering the FULL history
of the series (not just a recent window) and excluding any partial last bucket.

Direct multi-horizon strategy: for each step h = 1..H a separate model learns
"value h buckets from now" from features known today (recent lags, rolling
stats, calendar position, trend index). Each model is trained through
train.py's own prepare/split/train path, so leakage protection, time-ordered
splits and saved bundles all behave exactly like the risk models.

Honesty checks built in:
  - Refuses to run on too little history (use a simple trend estimate instead).
  - Compares every horizon against a naive "same as last value" forecast on the
    same held-out slice, and reports whether the model actually beats it.
  - The band comes from real held-out errors (10th/90th percentile residuals),
    not an assumed spread.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import train as T  # noqa: E402

MIN_TRAIN_ROWS = 60
FREQ = {
    "day": lambda d, h: d + pd.Timedelta(days=h),
    "week": lambda d, h: d + pd.Timedelta(weeks=h),
    "month": lambda d, h: d + pd.DateOffset(months=h),
}


def build_features(s: pd.DataFrame, grain: str) -> pd.DataFrame:
    # Every feature is relative to the latest value, never the raw level: tree
    # models cannot extrapolate past the highest level seen in training, so a
    # trending series forecast on levels gets silently capped. Learning the
    # *change* from today avoids that.
    df = s.copy()
    v = df["value"]
    n_lags = 8 if grain != "month" else 12
    for k in range(1, n_lags + 1):
        df[f"diff_lag_{k}"] = v - v.shift(k)
    df["vs_roll_mean_4"] = v - v.rolling(4).mean()
    df["vs_roll_mean_12"] = v - v.rolling(12).mean()
    df["roll_std_4"] = v.rolling(4).std()
    df["month"] = df["bucket"].dt.month
    if grain == "week":
        df["week_of_year"] = df["bucket"].dt.isocalendar().week.astype(int)
    if grain == "day":
        df["day_of_week"] = df["bucket"].dt.dayofweek
    return df


def run_horizon(series_id, feats, h, grain, workdir):
    df = feats.copy()
    df["target"] = df["value"].shift(-h) - df["value"]
    latest = df.iloc[[-1]].drop(columns=["target"])
    train_df = df.dropna().drop(columns=["value"])
    if len(train_df) < MIN_TRAIN_ROWS:
        raise ValueError(
            f"Only {len(train_df)} usable rows for horizon {h} (need {MIN_TRAIN_ROWS}). "
            "Not enough history for an ML forecast - fall back to a simple trend estimate."
        )

    target_id = f"{series_id}_h{h}"
    data_path = workdir / "data" / f"{target_id}_training.csv"
    train_df.to_csv(data_path, index=False)
    cfg = {
        "target_id": target_id,
        "data_path": str(data_path),
        "target": "target",
        "task": "regression",
        "id_cols": [],
        "time_col": "bucket",
        "leakage_cols": [],
        "test_fraction": 0.2,
        "random_seed": 42,
        "model_dir": str(workdir / "models"),
    }

    raw, X, y, feature_cols, cats = T.prepare(cfg, pd.read_csv(data_path))
    X_tr, y_tr, X_val, y_val, X_te, y_te = T.split(cfg, raw, X, y)
    model = T.train(cfg, X_tr, y_tr, X_val, y_val)
    metrics = T.evaluate(cfg, model, X_te, y_te)
    T.save(cfg, model, feature_cols, cats, metrics)

    # Target is a change from today, so the naive "same as last value"
    # forecast is a predicted change of zero.
    pred_te = model.predict(X_te)
    resid = y_te.to_numpy() - pred_te
    naive_mae = float(np.mean(np.abs(y_te.to_numpy())))
    model_mae = float(np.mean(np.abs(resid)))

    X_latest = latest[feature_cols].copy()
    point = float(latest["value"].iloc[0]) + float(model.predict(X_latest)[0])
    last_bucket = pd.to_datetime(latest["bucket"].iloc[0])
    return {
        "horizon": h,
        "bucket": FREQ[grain](last_bucket, h).date().isoformat(),
        "point": point,
        "lower": point + float(np.quantile(resid, 0.1)),
        "upper": point + float(np.quantile(resid, 0.9)),
        "holdout_mae": model_mae,
        "naive_mae": naive_mae,
        "beats_naive": model_mae < naive_mae,
        "holdout_r2": metrics.get("r2"),
        "train_rows": int(len(train_df)),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("series_id")
    ap.add_argument("input", help="CSV with columns bucket,value (full history)")
    ap.add_argument("--grain", choices=list(FREQ), default="week")
    ap.add_argument("--horizon", type=int, default=4)
    ap.add_argument("--workdir", default=str(Path(__file__).resolve().parent))
    args = ap.parse_args()

    workdir = Path(args.workdir)
    for sub in ("data", "models", "scores"):
        (workdir / sub).mkdir(parents=True, exist_ok=True)

    s = pd.read_csv(args.input)
    s.columns = [c.lower() for c in s.columns]
    s["bucket"] = pd.to_datetime(s["bucket"])
    s = s.sort_values("bucket").reset_index(drop=True)
    print(f"Series '{args.series_id}': {len(s):,} {args.grain} buckets, "
          f"{s['bucket'].min().date()} to {s['bucket'].max().date()}")

    feats = build_features(s, args.grain)
    rows = [run_horizon(args.series_id, feats, h, args.grain, workdir)
            for h in range(1, args.horizon + 1)]

    out = {
        "series_id": args.series_id,
        "grain": args.grain,
        "method": "ml_lightgbm",
        "last_observed_bucket": s["bucket"].max().date().isoformat(),
        "last_observed_value": float(s["value"].iloc[-1]),
        "beats_naive_all_horizons": all(r["beats_naive"] for r in rows),
        "forecast": rows,
    }
    path = workdir / "scores" / f"{args.series_id}_forecast.json"
    path.write_text(json.dumps(out, indent=2))
    print("\n--- Forecast ---")
    for r in rows:
        flag = "" if r["beats_naive"] else "  (does NOT beat naive last-value)"
        print(f"h={r['horizon']} {r['bucket']}: {r['point']:.2f} "
              f"[{r['lower']:.2f}, {r['upper']:.2f}]{flag}")
    print(f"Wrote {path}")


if __name__ == "__main__":
    main()
