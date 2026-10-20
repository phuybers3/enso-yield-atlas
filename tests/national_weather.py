"""Check the national display supplement's missingness, dates and exported anomalies."""

# Locate the checkout independently of the working directory or machine.
from pathlib import Path as _ProjectPath
import sys as _project_sys
_ENSO_ROOT = next(p for p in _ProjectPath(__file__).resolve().parents if (p / "project.toml").is_file())
if str(_ENSO_ROOT) not in _project_sys.path:
    _project_sys.path.append(str(_ENSO_ROOT))
from enso_project import path as _project_path, resolve_path as _resolve_path
from enso_project import load_record as _load_record, loads_record as _loads_record

import hashlib
import importlib.util
import json
from pathlib import Path
import numpy as np
from scipy.sparse import csr_matrix

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('national_weather', ROOT / 'scripts/build_national_weather.py')
weather = importlib.util.module_from_spec(spec)
spec.loader.exec_module(weather)

weights = csr_matrix(np.array([[.4, .6], [1., 0.]], dtype='float32'))
values = np.array([[10, 20], [np.nan, 20], [10, np.nan]], dtype='float32')
daily = weather.weighted_daily(values, weights)
assert np.allclose(daily[0], [16, 10])
assert np.isnan(daily[1]).all()
assert np.isnan(daily[2, 0]) and daily[2, 1] == 10
dates = np.array(['2020-02-28', '2020-02-29', '2020-03-01'], dtype='datetime64[D]')
assert weather.season_value(np.array([1., 2., 3.]), dates, '2020-02-28', '2020-03-01', False) == 6
assert weather.season_value(np.array([1., 2., 3.]), dates, '2020-02-28', '2020-03-01', True) == 2
assert weather.season_value(np.array([1., 2., 3.]), dates, '2020-02-28', '2020-03-02', False) is None
assert weather.season_value(np.array([1., np.nan, 3.]), dates, '2020-02-28', '2020-03-01', False) is None
assert not weather.detrended([[2000 + i, 2 * i] for i in range(9)])
assert max(abs(v) for v in weather.detrended([[1981 + i, 10 + 2 * i] for i in range(20)]).values()) < 1e-8

base = ROOT / 'site/data/national-weather/2026-10-10'
manifest = _loads_record((base / 'manifest.json').read_text())
for name, digest in manifest['files'].items():
    assert hashlib.sha256((base / name).read_bytes()).hexdigest() == digest
raw = _loads_record((weather.ENSO / 'analysis/planning/national_weather_2026-10-11/2026-10-10/season_values.json').read_text())
count = 0
for r in raw:
    exported = _loads_record((base / f"{r['iso3']}.json").read_text())['series'][r['series_id']]
    assert not any(k in exported for k in ['responses', 'forecast', 'weather_expected', 'obs'])
    hist = {a[0]: a for a in exported['weather_history']}
    for col, metric in [(1, 'temperature'), (2, 'rainfall')]:
        observations = r['raw_season_values'][metric]
        if len(observations) < 10:
            assert all(a[col] is None for a in hist.values())
            continue
        a = np.array(observations)
        fit = np.polyval(np.polyfit(a[:, 0], a[:, 1], 1), a[:, 0])
        for year, residual in zip(a[:, 0], a[:, 1] - fit):
            assert abs(hist[int(year)][col] - residual) <= 5.01e-5
            count += 1
serbia = _loads_record((base / 'SRB.json').read_text())['series']['658416863739331986']
assert sum(a[1] is not None for a in serbia['weather_history']) >= 15
assert sum(a[2] is not None for a in serbia['weather_history']) >= 15
assert serbia['context']['rainfall_source'] == 'CHIRPS v2.0'
print(f'PASS national weather: weighting, missingness, leap-day windows; {count:,} exported anomalies, {len(manifest["files"])} file hashes; Serbia T/P histories present')
