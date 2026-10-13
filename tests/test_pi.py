"""Unit tests for the engine's statistics (no database needed).   py -3.12 -m unittest tests.test_pi"""
import unittest
from datetime import date, timedelta

import numpy as np
import pandas as pd

from pi import analyze, process, project


class TestSurvival(unittest.TestCase):
    def test_km_handles_censoring(self):
        # 1000 parents; 30% convert at day 10. Half the parents are only 5 days old (censored before converting).
        rows = []
        for i in range(1000):
            old = i < 500
            converts = i % 10 < 3
            if old and converts:
                rows.append({"T": 10, "E": True})
            else:
                rows.append({"T": 60 if old else 5, "E": False})
        days, cdf, reliable = process.km(pd.DataFrame(rows))
        self.assertAlmostEqual(cdf[20], 0.30, places=2)       # naive share would say 15%
        self.assertGreaterEqual(reliable, 20)


class TestBaseline(unittest.TestCase):
    def test_expected_tracks_trend(self):
        y = np.arange(60, dtype=float) * 2 + 100
        e = analyze.expected_at(y, 59, None, False)
        self.assertAlmostEqual(e, y[59], delta=3)

    def test_outlier_detected_level_shift_not_baseline(self):
        rng = np.random.default_rng(1)
        y = 100 + rng.normal(0, 3, 80)
        y[79] = 130                                            # a real jump in the tested period
        back = [y[j] - analyze.expected_at(y, j, None, False) for j in range(12, 79)]
        z = (y[79] - analyze.expected_at(y, 79, None, False)) / analyze.robust_scale(np.array(back))
        self.assertGreater(z, 5)

    def test_robust_scale_ignores_spikes(self):
        x = np.r_[np.random.default_rng(2).normal(0, 1, 100), [50, 60, 70]]
        self.assertLess(analyze.robust_scale(x), 2)

    def test_seasonality_repeatable(self):
        t = np.arange(52 * 4)
        y = 100 + 20 * np.sin(2 * np.pi * t / 52) + np.random.default_rng(3).normal(0, 2, len(t))
        self.assertTrue(analyze.seasonality_repeatable(y, 52))
        flat = 100 + np.random.default_rng(4).normal(0, 2, len(t))
        self.assertFalse(analyze.seasonality_repeatable(flat, 52))


class TestForecast(unittest.TestCase):
    def test_backtest_picks_a_method_that_beats_naive_on_seasonal_data(self):
        t = np.arange(52 * 4)
        y = 100 + 30 * np.sin(2 * np.pi * t / 52) + np.random.default_rng(5).normal(0, 2, len(t))
        r = project.forecast_series(y, len(y) - 1, 13, 52)
        self.assertGreater(r["skill_vs_naive"], 0.2)
        self.assertEqual(len(r["point"]), 13)
        self.assertTrue((r["lower"] <= r["point"]).all() and (r["point"] <= r["upper"]).all())


class TestComparisons(unittest.TestCase):
    def test_window_comparison_and_completeness(self):
        today = date(2026, 10, 11)
        days = pd.date_range(today - timedelta(days=800), today)
        d = pd.DataFrame({"D": days, "NUM": 10.0, "DEN": 0.0, "COMP": 1.0})
        d.loc[d.D > pd.Timestamp(today - timedelta(days=7)), "NUM"] = 20.0
        c = analyze.comparisons(d, today, True, False)
        self.assertAlmostEqual(c["last_7_days_vs_prior"]["change_pct"], 100.0, delta=0.5)
        d["COMP"] = 0.3                                        # nothing judged when data has not arrived
        c2 = analyze.comparisons(d, today, True, False, 0.8)
        self.assertIsNone(c2["last_7_days_vs_prior"]["change_pct"])


if __name__ == "__main__":
    unittest.main()
