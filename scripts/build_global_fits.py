"""Fit the global atlas's exact crop/season/area-basis/period series.

Requires numpy. Rebuild: python scripts/build_global_fits.py
OLS models log yield with a linear time trend and one ENSO response form.
Uncertainty uses 400 shared resamples of three-calendar-year blocks. We export
the covariance of the ENSO coefficients, allowing responses at arbitrary N.
The displayed intervals are normal intervals in log response, then transformed
to percent. They are pointwise association intervals, not yield predictions.
"""
import argparse
import hashlib
import json
from pathlib import Path
import time
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'global/data/2026-09-26'
OUT = ROOT / 'global/data/fits/2026-09-26'
CLIMATE = ROOT / 'global/data/enso/2026-09-26/nino34.json'
PERIODS = {'available': None, '1991-2020': [1991, 2020], '2001-2020': [2001, 2020],
           '2011-2020': [2011, 2020], '2015-2024': [2015, 2024]}
MODELS = ['linear', 'quadratic', 'hinge']
N_BOOT = 400
SEED = 20260926


def design(year, x, model):
    cols = [np.ones(len(x)), (year - 2000) / 10]
    if model != 'trend':
        cols.append(x)
    if model == 'quadratic':
        cols.append(x*x)
    if model == 'hinge':
        cols.append(np.maximum(x, 0))
    return np.column_stack(cols)


def exposure(year, window, monthly):
    values = []
    for m in range(window['start_relative_month'], window['end_relative_month'] + 1):
        y, month = divmod(year*12 + m - 1, 12)
        value = monthly.get(f'{y:04d}-{month+1:02d}')
        if value is None:
            return None
        values.append(value)
    return sum(values)/len(values)


def regress(X, y):
    if np.linalg.matrix_rank(X) < X.shape[1]:
        return None
    return np.linalg.lstsq(X, y, rcond=None)[0]


def validation(year, x, y):
    """Two five-year block layouts; withhold adjacent years from training."""
    designs = {m: design(year, x, m) for m in ['trend'] + MODELS}
    scores = {m: [] for m in MODELS}
    counts = []
    for offset in [0, 2]:
        blocks = (year - (1980 + offset)) // 5
        errors = {m: [] for m in designs}
        folds = 0
        for b in np.unique(blocks):
            lo = 1980 + offset + 5*b
            test = blocks == b
            train = (year < lo - 1) | (year > lo + 5)
            if train.sum() < 12 or (x[train] > 0).sum() < 3 or (x[train] < 0).sum() < 3:
                continue
            coefficients = {m: regress(X[train], y[train]) for m, X in designs.items()}
            if any(c is None for c in coefficients.values()):
                continue
            for m, X in designs.items():
                errors[m].extend((y[test] - X[test] @ coefficients[m])**2)
            folds += 1
        n = len(errors['trend'])
        counts.append([folds, n])
        for m in MODELS:
            baseline = np.mean(errors['trend']) if n else 0
            scores[m].append(float(1 - np.mean(errors[m])/baseline)
                             if folds >= 3 and n >= 15 and baseline > 0 else None)
    return scores, counts


def block_weights(year, master_blocks, draws):
    # Use identical calendar-block draws across units for each requested period.
    return draws[:, np.searchsorted(master_blocks, (year-1980)//3)]


def bootstrap(X, y, weights):
    gram = np.einsum('bi,ij,ik->bjk', weights, X, X, optimize=True)
    rhs = np.einsum('bi,ij,i->bj', weights, X, y, optimize=True)
    # Rank is checked before solving; singular draws are counted, never ridged.
    ok = (np.linalg.matrix_rank(gram) == X.shape[1]) & (weights.sum(axis=1) >= 12)
    coeff = np.linalg.solve(gram[ok], rhs[ok, :, None])[:, :, 0]
    return coeff[:, 2:]


def fit_series(s, period, climate, master_blocks, draws):
    window = climate['windows'].get('|'.join([s['country'], s['crop'], s['season']]))
    a = [r for r in s['observations'] if period is None or period[0] <= r[0] <= period[1]]
    paired = [(r[0], r[1], exposure(r[0], window, climate['monthly'])) for r in a] if window else []
    paired = [r for r in paired if r[1] > 0 and r[2] is not None]
    result = dict(n=len(paired), omitted_zero=sum(r[1] == 0 for r in a),
                  omitted_index=sum(r[1] > 0 for r in a) - len(paired))
    if not window:
        return dict(result, reason='No crop-window ENSO definition')
    if len(paired) < 20:
        return dict(result, reason=f'Needs 20 positive-yield years with ENSO; {len(paired)} available')
    year, yield_, x = np.array(paired).T
    year = year.astype(int)
    result.update(first=int(year.min()), last=int(year.max()), x_min=float(x.min()), x_max=float(x.max()),
                  warm=int((x > 0).sum()), cold=int((x < 0).sum()), years=year.tolist())
    if min(result['warm'], result['cold']) < 5:
        return dict(result, reason='Needs at least 5 warm and 5 cold crop seasons')
    y = np.log(yield_)
    cv, folds = validation(year, x, y)
    weights = block_weights(year, master_blocks, draws)
    fits = {}
    for model in MODELS:
        X = design(year, x, model)
        coef = regress(X, y)
        if coef is None:
            fits[model] = {'reason': 'Rank-deficient design'}
            continue
        reps = bootstrap(X, y, weights)
        cov = np.atleast_2d(np.cov(reps, rowvar=False)) if len(reps) >= .9*N_BOOT else None
        fits[model] = dict(coef=coef.tolist(), cov=cov.tolist() if cov is not None else None,
                           boot_n=len(reps), cv=cv[model])
    return dict(result, models=fits, cv_folds=folds)


def write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n')


def build(crops=None):
    started = time.monotonic()
    OUT.mkdir(parents=True, exist_ok=True)
    climate = json.loads(CLIMATE.read_text())
    catalog = json.loads((DATA/'catalog.json').read_text())
    files = sorted((DATA/'observations').glob('*.json'))
    sources = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    series = [s for p in files for s in json.loads(p.read_text())['series']]
    all_years = np.array([r[0] for s in series for r in s['observations']])
    resamples = {}
    for i, (period, limits) in enumerate(PERIODS.items()):
        years = all_years if limits is None else all_years[(all_years >= limits[0]) & (all_years <= limits[1])]
        blocks = np.arange((years.min()-1980)//3, (years.max()-1980)//3+1)
        rng = np.random.default_rng(SEED+i)
        picks = rng.integers(0, len(blocks), size=(N_BOOT, len(blocks)))
        counts = np.array([np.bincount(row, minlength=len(blocks)) for row in picks])
        resamples[period] = blocks, counts
    for crop in crops or catalog['products']:
        records = {}
        for s in series:
            if s['crop'] != crop:
                continue
            key = '|'.join([s['country'], s['id'], s['season'], s['basis']])
            records[key] = {p: fit_series(s, limits, climate, *resamples[p]) for p, limits in PERIODS.items()}
        write(OUT/f'{crop}.json', records)
        n = sum('models' in r['available'] for r in records.values())
        print(f'{crop}: {n}/{len(records)} available-record series fitted; {time.monotonic()-started:.1f}s', flush=True)
    profile = {k: v for k, v in climate['monthly'].items() if 1996 <= int(k[:4]) <= 1999}
    peak_key = max((k for k in profile if k.startswith('1997')), key=profile.get)
    write(OUT/'methods.json', dict(release='2026-09-26', index='nino34', models=MODELS, periods=PERIODS,
        response='Percent change in fitted geometric yield relative to ENSO=0, at fixed year; association, not causal attribution.',
        design='log(yield) = intercept + trend*(year-2000)/10 + beta*N [+ delta*N^2 or hinge*max(N,0)]',
        eligibility='At least 20 positive-yield paired years, at least 5 N>0 and 5 N<0; full-rank design. Exact season and area basis; no pooling.',
        uncertainty=dict(replicates=N_BOOT, seed=SEED, block_years=3, anchor=1980,
            method='Pairs bootstrap of non-overlapping three-calendar-year blocks, shared across units within period. Export coefficient covariance; 95% normal log-response intervals transformed to percent. At least 360 usable draws required. Pointwise, no multiplicity correction; not prediction intervals.'),
        validation='Five-year holdout blocks anchored at 1980 and 1982; omit adjacent year each side, require 12 training observations and 3 each ENSO sign; report 1-MSE_model/MSE_trend when >=3 folds and >=15 predictions.',
        climate_sha256=hashlib.sha256(CLIMATE.read_bytes()).hexdigest(), observation_sha256=sources,
        event_profile=dict(values=profile, peak_month=int(peak_key[-2:]), peak_year=1997, peak=profile[peak_key],
            description='Illustrative 1996–1999 monthly trajectory around the 1997–98 El Niño, shifted to the selected peak month/year and scaled to the selected positive peak. Not an ENSO forecast.')))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--crop', choices=['wheat', 'maize', 'rice-paddy', 'rice-milled'], action='append')
    build(parser.parse_args().crop)
