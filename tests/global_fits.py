"""Scientific checks for the exact-series model export (requires numpy)."""
import importlib.util
import json
import hashlib
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fits', ROOT/'scripts/build_global_fits.py')
fits = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fits)

# Known quadratic and hinge responses, including their sign convention.
year = np.arange(1980, 2025)
x = np.random.default_rng(9).normal(size=len(year))
for model, beta in [('linear', [1, .1, -.2]), ('quadratic', [1, .1, -.2, .08]), ('hinge', [1, .1, -.2, .35])]:
    X = fits.design(year, x, model)
    y = X @ beta
    np.testing.assert_allclose(fits.regress(X, y), beta, atol=1e-12)
    weights = np.random.default_rng(4).integers(0, 4, size=(15, len(year)))
    reps = fits.bootstrap(X, y, weights)
    # Explicitly duplicate observations; this does not use the weighted normal solve.
    expected = np.array([np.linalg.lstsq(np.repeat(X, w, axis=0), np.repeat(y, w), rcond=None)[0][2:] for w in weights])
    np.testing.assert_allclose(reps, expected, atol=1e-10)
    noisy = y + np.random.default_rng(31).normal(0, .2, len(y))
    reps = fits.bootstrap(X, noisy, weights)
    expected = np.array([np.linalg.lstsq(np.repeat(X, w, axis=0), np.repeat(noisy, w), rcond=None)[0][2:] for w in weights])
    np.testing.assert_allclose(np.cov(reps, rowvar=False), np.cov(expected, rowvar=False), atol=1e-10)

blocks = np.arange(-2, 16)
draws = np.random.default_rng(21).integers(0, 4, (400, len(blocks)))
a = fits.block_weights(np.array([1980, 1981, 1982, 1983]), blocks, draws)
b = fits.block_weights(np.array([1981, 1983]), blocks, draws)
np.testing.assert_equal(a[:, 0], a[:, 2])
np.testing.assert_equal(a[:, [1, 3]], b)

climate = json.loads(fits.CLIMATE.read_text())
methods = json.loads((fits.OUT/'methods.json').read_text())
assert hashlib.sha256(fits.CLIMATE.read_bytes()).hexdigest() == methods['climate_sha256']
for name, digest in methods['observation_sha256'].items():
    assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest() == digest
exports = {crop: json.loads((fits.OUT/f'{crop}.json').read_text()) for crop in ['wheat', 'maize', 'rice-paddy', 'rice-milled']}
checked = 0
for file in (fits.DATA/'observations').glob('*.json'):
    for s in json.loads(file.read_text())['series']:
        key = '|'.join([s['country'], s['id'], s['season'], s['basis']])
        window = climate['windows']['|'.join([s['country'], s['crop'], s['season']])]
        for period, limits in fits.PERIODS.items():
            f = exports[s['crop']][key][period]
            rows = [r for r in s['observations'] if (limits is None or limits[0] <= r[0] <= limits[1]) and r[1] > 0]
            rows = [(r, fits.exposure(r[0], window, climate['monthly'])) for r in rows]
            rows = [(r, n) for r, n in rows if n is not None]
            assert f['n'] == len(rows)
            if 'models' not in f:
                assert 'reason' in f
                continue
            assert f['years'] == [r[0] for r, n in rows]
            assert f['n'] >= 20 and f['warm'] >= 5 and f['cold'] >= 5
            yy = np.log([r[1] for r, n in rows]); nino = np.array([n for r, n in rows])
            assert nino.min() == f['x_min'] and nino.max() == f['x_max']
            for model, fit in f['models'].items():
                if 'coef' not in fit:
                    continue
                # Residual orthogonality independently checks the exported OLS coefficients.
                X = np.column_stack([np.ones(len(rows)), (np.array(f['years'])-2000)/10, nino] +
                                    ([nino**2] if model == 'quadratic' else [np.maximum(nino, 0)] if model == 'hinge' else []))
                np.testing.assert_allclose(X.T @ (yy-X @ fit['coef']), 0, atol=2e-8)
                assert 0 <= fit['boot_n'] <= 400
                if fit['cov'] is not None:
                    assert fit['boot_n'] >= 360
                    assert np.linalg.eigvalsh(fit['cov']).min() > -1e-9
                assert len(fit['cv']) == 2
                checked += 1
print(f'PASS: {checked} fitted designs match exact observations, basis, season, and period; input hashes, rank/eligibility, bootstrap covariance, shared year blocks, nonlinear signs.')
