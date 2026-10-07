"""Check that winter crops use weather from their actual target harvest year."""
import importlib.util
from pathlib import Path
import unittest

import numpy as np
import pandas as pd

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
def module(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f'{name}.py')
    out = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(out)
    return out

windows = module('03_season_todate')
anomalies = module('07_db_layer')

class CurrentSeason(unittest.TestCase):
    def test_index_cache_respects_dataset(self):
        a = pd.DataFrame(dict(year=[2026, 2026], month=[8, 9], nino34_rel=[1., 2.])).set_index(['year', 'month'])
        b = a.copy(); b['nino34_rel'] = [3., 4.]
        self.assertAlmostEqual(anomalies.a04.index_todate(a, '2026-08-01', 61), 1.5)
        self.assertAlmostEqual(anomalies.a04.index_todate(a, '2026-08-01', 61), 1.5)
        self.assertAlmostEqual(anomalies.a04.index_todate(b, '2026-08-01', 61), 3.5)

    def test_winter_window(self):
        start, end = windows.window(2027, 10, 3, -1, False, None, None)
        self.assertEqual(str(start), '2026-10-01')
        self.assertEqual(str(end), '2027-03-31')

    def test_current_anomaly_uses_target_year(self):
        years = list(range(2000, 2026)) + [2027]
        rows = []
        for year in years:
            vals = {c: 10. + (5. if year == 2027 else 0.) for c in anomalies.LEVEL}
            rows.append(dict(series_id=1, year=year, precip=100.,
                             window_start=f'{year-1}-10-01', **vals))
        z = pd.DataFrame(rows)
        ws = pd.DataFrame([dict(series_id=1, harvest_year=2027,
              target_start='2026-10-01', target_end='2027-03-31', n_days=182,
              elapsed_days=30, frac_elapsed=30/182, status='under way', data_end='2026-10-30')])
        a = anomalies.series_anomalies(z, ws).iloc[0]
        self.assertEqual(a.year, 2027)
        self.assertEqual(a.target_year, 2027)
        self.assertAlmostEqual(a.tmax_mean_value, 15.)
        self.assertAlmostEqual(a.tmax_mean_anom, 5.)

    def test_old_current_year_cannot_pass(self):
        years = list(range(2000, 2026)) + [2027]
        z = pd.DataFrame([dict(series_id=1, year=y, precip=100.,
             window_start=f'{y-1}-10-01', **{c: 10. for c in anomalies.LEVEL}) for y in years])
        z.loc[z.year.eq(2027), 'window_start'] = '2025-10-01'
        ws = pd.DataFrame([dict(series_id=1, harvest_year=2027, target_start='2026-10-01')])
        with self.assertRaises(AssertionError):
            anomalies.series_anomalies(z, ws)

if __name__ == '__main__':
    unittest.main()
