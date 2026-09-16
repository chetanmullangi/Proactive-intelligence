# ml/

The project's only machine-learning toolchain. Every trained prediction goes through here — this project does not use `SNOWFLAKE.ML.FORECAST`/`ANOMALY_DETECTION`.

- **Row-level risk models** (`snowflake-risk-predictor`): `train.py` + `predict.py`, one JSON config per discovered prediction target.
- **KPI forecasts** (`snowflake-kpi-anomaly-detector`, `snowflake-kpi-analyst`): `forecast.py`, which reuses `train.py` to fit one LightGBM model per forecast step on change-from-latest features, and reports whether each step beats a naive "same as last value" forecast on held-out data.

```
ml/
  train.py        generic trainer, config-driven (python train.py configs/<target_id>.json)
  predict.py      generic scorer (python predict.py <target_id> <input.csv>)
  forecast.py     KPI forecaster (python forecast.py <series_id> data/<series_id>_series.csv --grain week --horizon 4)
  configs/         one JSON file per discovered prediction target (see configs/example.json)
  data/            training extracts pulled from Snowflake (CSV), one per target
  models/          trained bundles (<target_id>.joblib) + human-readable *_card.json sidecars
  scores/          scored output per prediction run (<target_id>_scored.csv)
```

Python environment: `py -3.12` on this machine (bare `python` is the Microsoft Store stub; bare `py` defaults to 3.14, which doesn't have these packages), with `lightgbm`, `scikit-learn`, `pandas`, `joblib`, `numpy` installed. Re-install with:
```
py -3.12 -m pip install lightgbm scikit-learn pandas joblib numpy
```

Nothing in this directory talks to Snowflake directly — `snowflake-risk-predictor` runs the extraction SQL itself and writes the CSV into `data/` before invoking `train.py`, then writes fresh rows into a CSV before invoking `predict.py`. See that skill's spec for the full pipeline (target discovery → feature/label extraction → train → predict → pattern aggregation → plain-language brief).
