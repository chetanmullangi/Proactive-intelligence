"""
train.py - train a model on tabular data and save a portable bundle.

    python train.py configs/<target_id>.json

Config-driven version of the original template (same logic throughout -
LightGBM, time-ordered split, leakage protection, robust metrics) so one
script serves every prediction target `snowflake-risk-predictor` discovers,
instead of a different hand-edited copy per target. See configs/example.json
for the shape of a config file.
"""

from __future__ import annotations

import json
import sys
import warnings
from datetime import datetime, timezone
from pathlib import Path

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    mean_absolute_error,
    r2_score,
    roc_auc_score,
)

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", message=".*eval_set.*")


def load_config(path: str) -> dict:
    cfg_path = Path(path)
    if not cfg_path.exists():
        raise FileNotFoundError(f"Config file not found: {cfg_path}")
    cfg = json.loads(cfg_path.read_text())
    cfg.setdefault("id_cols", [])
    cfg.setdefault("time_col", None)
    cfg.setdefault("leakage_cols", [])
    cfg.setdefault("test_fraction", 0.2)
    cfg.setdefault("random_seed", 42)
    cfg.setdefault("model_dir", "models")
    cfg.setdefault("target_id", cfg_path.stem)
    if cfg.get("task") not in ("binary", "regression"):
        raise ValueError(f"config.task must be 'binary' or 'regression', got {cfg.get('task')!r}")
    return cfg


def load_data(cfg: dict) -> pd.DataFrame:
    path = Path(cfg["data_path"])
    if not path.exists():
        raise FileNotFoundError(
            f"{path} not found. Export the training table (from Snowflake) to CSV/Parquet first."
        )
    df = pd.read_parquet(path) if path.suffix == ".parquet" else pd.read_csv(path)
    print(f"Loaded {len(df):,} rows x {len(df.columns)} columns from {path}")
    return df


def prepare(cfg: dict, df: pd.DataFrame):
    """Split off the target, drop non-features, type the categoricals."""
    target = cfg["target"]
    if target not in df.columns:
        raise KeyError(f"Target column '{target}' is not in the data.")

    df = df.dropna(subset=[target]).copy()

    drop = set(cfg["id_cols"]) | set(cfg["leakage_cols"]) | {target}
    if cfg["time_col"]:
        drop.add(cfg["time_col"])
    feature_cols = [c for c in df.columns if c not in drop]

    X = df[feature_cols].copy()
    y = df[target]

    # LightGBM handles categoricals natively via the pandas category dtype.
    # The exact category list must be saved so prediction encodes identically.
    cat_categories: dict[str, list] = {}
    for col in X.columns:
        dtype = X[col].dtype
        if pd.api.types.is_numeric_dtype(dtype) or pd.api.types.is_bool_dtype(dtype):
            continue
        X[col] = X[col].astype("category")
        cat_categories[col] = [str(c) for c in X[col].cat.categories]

    print(
        f"{len(feature_cols)} features "
        f"({len(cat_categories)} categorical, "
        f"{len(feature_cols) - len(cat_categories)} numeric)"
    )
    if cfg["task"] == "binary":
        rate = y.mean()
        print(f"Positive rate: {rate:.2%} ({int(y.sum()):,} of {len(y):,})")
        if rate < 0.01:
            print("  ! Very rare outcome - trust PR-AUC over ROC-AUC below.")

    return df, X, y, feature_cols, cat_categories


def split(cfg: dict, df: pd.DataFrame, X: pd.DataFrame, y: pd.Series):
    """Hold out the most recent slice, so the test set is genuinely unseen."""
    time_col = cfg["time_col"]
    if time_col:
        order = pd.to_datetime(df[time_col]).sort_values().index
        X, y = X.loc[order], y.loc[order]
        cut = int(len(X) * (1 - cfg["test_fraction"]))
        print(f"Time split on '{time_col}': train up to row {cut:,}, test after")
    else:
        rng = np.random.default_rng(cfg["random_seed"])
        perm = rng.permutation(len(X))
        X, y = X.iloc[perm], y.iloc[perm]
        cut = int(len(X) * (1 - cfg["test_fraction"]))
        print("Random split (no time_col set)")

    X_train, X_test = X.iloc[:cut], X.iloc[cut:]
    y_train, y_test = y.iloc[:cut], y.iloc[cut:]

    vcut = int(len(X_train) * 0.85)
    return (
        X_train.iloc[:vcut], y_train.iloc[:vcut],
        X_train.iloc[vcut:], y_train.iloc[vcut:],
        X_test, y_test,
    )


def train(cfg: dict, X_tr, y_tr, X_val, y_val):
    common = dict(
        n_estimators=2000,
        learning_rate=0.05,
        num_leaves=31,
        min_child_samples=30,
        subsample=0.8,
        subsample_freq=1,
        colsample_bytree=0.8,
        random_state=cfg["random_seed"],
        verbose=-1,
    )
    if cfg["task"] == "binary":
        model = lgb.LGBMClassifier(**common)
        eval_metric = ["auc", "average_precision"]
    else:
        model = lgb.LGBMRegressor(**common)
        eval_metric = ["l1"]

    model.fit(
        X_tr, y_tr,
        eval_set=[(X_val, y_val)],
        eval_metric=eval_metric,
        callbacks=[lgb.early_stopping(100, first_metric_only=True, verbose=False)],
    )
    print(f"Trained. Best iteration: {model.best_iteration_}")
    return model


def evaluate(cfg: dict, model, X_test, y_test) -> dict:
    print("\n--- Held-out performance ---")
    if cfg["task"] == "binary":
        p = model.predict_proba(X_test)[:, 1]
        metrics = {
            "roc_auc": float(roc_auc_score(y_test, p)),
            "pr_auc": float(average_precision_score(y_test, p)),
            "brier": float(brier_score_loss(y_test, p)),
            "base_rate": float(y_test.mean()),
        }
        print(f"ROC-AUC : {metrics['roc_auc']:.3f}")
        print(f"PR-AUC  : {metrics['pr_auc']:.3f}  (baseline {metrics['base_rate']:.3f})")
        print(f"Brier   : {metrics['brier']:.4f}  (lower is better)")
        if metrics["roc_auc"] > 0.95:
            print("  ! AUC above 0.95 usually means leakage - a feature that encodes the outcome.")
            print("    Check the top features below against leakage_cols in the config.")
    else:
        pred = model.predict(X_test)
        metrics = {
            "mae": float(mean_absolute_error(y_test, pred)),
            "r2": float(r2_score(y_test, pred)),
        }
        print(f"MAE : {metrics['mae']:.3f}")
        print(f"R2  : {metrics['r2']:.3f}")

    imp = (
        pd.Series(model.feature_importances_, index=X_test.columns)
        .sort_values(ascending=False)
        .head(15)
    )
    print("\nTop features:")
    for name, val in imp.items():
        print(f"  {name:<32} {val:>8.0f}")
    metrics["feature_importance"] = {k: float(v) for k, v in imp.items()}
    return metrics


def save(cfg: dict, model, feature_cols, cat_categories, metrics) -> Path:
    out = Path(cfg["model_dir"])
    out.mkdir(parents=True, exist_ok=True)

    bundle = {
        "model": model,
        "feature_cols": feature_cols,
        "cat_categories": cat_categories,
        "target": cfg["target"],
        "target_id": cfg["target_id"],
        "task": cfg["task"],
        "metrics": {k: v for k, v in metrics.items() if k != "feature_importance"},
        "feature_importance": metrics.get("feature_importance", {}),
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "lightgbm_version": lgb.__version__,
    }
    path = out / f"{cfg['target_id']}.joblib"
    joblib.dump(bundle, path)

    (out / f"{cfg['target_id']}_card.json").write_text(
        json.dumps(
            {k: v for k, v in bundle.items() if k not in ("model", "cat_categories")},
            indent=2,
        )
    )
    print(f"\nSaved {path} ({path.stat().st_size / 1024:.0f} KB)")
    return path


def main():
    if len(sys.argv) != 2:
        print("Usage: python train.py <config.json>")
        sys.exit(1)
    cfg = load_config(sys.argv[1])
    df = load_data(cfg)
    df, X, y, feature_cols, cat_categories = prepare(cfg, df)
    X_tr, y_tr, X_val, y_val, X_test, y_test = split(cfg, df, X, y)
    model = train(cfg, X_tr, y_tr, X_val, y_val)
    metrics = evaluate(cfg, model, X_test, y_test)
    save(cfg, model, feature_cols, cat_categories, metrics)
    print(f"\nNext: python predict.py {cfg['target_id']} data/<fresh_rows>.csv")


if __name__ == "__main__":
    main()
