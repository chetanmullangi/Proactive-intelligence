"""
predict.py - score new rows with a model saved by train.py.

    python predict.py <target_id> <input.csv> -o scores/<target_id>_scored.csv
    python predict.py <target_id> <input.csv> --threshold 0.3

Looks up models/<target_id>.joblib by default. The saved bundle carries its
own feature list and categorical encodings, so this runs on any fresh export
that has the same columns as training - no need to keep train.py's config or
the original training data around.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import joblib
import pandas as pd


def load_bundle(model_path: Path) -> dict:
    if not model_path.exists():
        raise FileNotFoundError(f"{model_path} not found. Run train.py for this target first.")
    bundle = joblib.load(model_path)
    print(
        f"Model: target='{bundle['target']}' task={bundle['task']} "
        f"trained {bundle['trained_at'][:10]}"
    )
    return bundle


def align(df: pd.DataFrame, bundle: dict) -> pd.DataFrame:
    """Force incoming data into exactly the shape the model was trained on."""
    feature_cols = bundle["feature_cols"]

    missing = [c for c in feature_cols if c not in df.columns]
    if missing:
        raise KeyError(
            f"Input is missing {len(missing)} required column(s): {missing}\n"
            "The scoring extract must produce the same columns as the training extract."
        )

    extra = [c for c in df.columns if c not in feature_cols]
    if extra:
        print(f"Ignoring {len(extra)} column(s) not used by the model: {extra[:8]}")

    X = df[feature_cols].copy()

    for col, cats in bundle["cat_categories"].items():
        values = X[col].astype("string")
        unseen = values.notna() & ~values.isin(cats)
        if unseen.any():
            print(
                f"  '{col}': {int(unseen.sum())} value(s) unseen in training -> null "
                f"(e.g. {values[unseen].iloc[0]!r})"
            )
        X[col] = pd.Categorical(values.where(~unseen), categories=cats)

    return X


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("target_id", help="Matches the config/model filename, e.g. 'denial_risk'")
    ap.add_argument("input", help="CSV or Parquet of rows to score")
    ap.add_argument("-o", "--output", default=None, help="Default: scores/<target_id>_scored.csv")
    ap.add_argument("-m", "--model-dir", default="models")
    ap.add_argument(
        "--threshold",
        type=float,
        default=0.5,
        help="Probability cutoff for the flag column (binary only). 0.5 is rarely the "
        "right business threshold - pick it from what a false positive costs versus "
        "a false negative (e.g. the cost of reviewing a claim that wasn't actually at "
        "risk, versus missing one that was).",
    )
    args = ap.parse_args()

    model_path = Path(args.model_dir) / f"{args.target_id}.joblib"
    bundle = load_bundle(model_path)

    path = Path(args.input)
    df = pd.read_parquet(path) if path.suffix == ".parquet" else pd.read_csv(path)
    print(f"Scoring {len(df):,} rows from {path}")

    X = align(df, bundle)
    model = bundle["model"]

    out = df.copy()
    if bundle["task"] == "binary":
        out["prediction_score"] = model.predict_proba(X)[:, 1]
        out["prediction_flag"] = (out["prediction_score"] >= args.threshold).astype(int)
        print(
            f"Flagged {out['prediction_flag'].sum():,} rows "
            f"({out['prediction_flag'].mean():.1%}) at threshold {args.threshold}"
        )
    else:
        out["prediction"] = model.predict(X)
        print(f"Predictions range {out['prediction'].min():.2f} to {out['prediction'].max():.2f}")

    output_path = Path(args.output) if args.output else Path("scores") / f"{args.target_id}_scored.csv"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(output_path, index=False)
    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
