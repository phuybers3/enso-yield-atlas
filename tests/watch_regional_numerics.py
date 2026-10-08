"""Check every released local/state coefficient against its archived source fit.

Run with the ENSO Python environment (numpy, pandas and scipy).
"""
from pathlib import Path
import json
import numpy as np
import pandas as pd
from scipy.stats import t

root = Path(__file__).resolve().parents[1] / 'watch/regional/2026-10-06-v1'
units = pd.read_csv(root / 'unit-responses.csv.gz')
source = pd.read_csv(root / 'local-source-fits.csv.gz').set_index('series_id')
state = pd.read_csv(root / 'state-source-fits.csv.gz').set_index(['region_key','crop_code','season_std'])
model = json.loads((root / 'model.json').read_text())
own = units[units.response_level.eq('local')].set_index('s')
original = source.loc[own.index]
assert len(own) == model['audit']['local_records'] == 30989
assert own.fit_n.ge(20).all()
for export, field in [('beta','beta_raw'),('se','se_raw'),('fit_n','years'),('fit_first','first_year'),('fit_last','last_year')]:
    np.testing.assert_allclose(own[export], original[field], rtol=0, atol=6e-12)
critical = t.ppf(.975, own.fit_n.to_numpy() - 3)
np.testing.assert_allclose(own.beta_lo, original.beta_raw-critical*original.se_raw, rtol=0, atol=6e-12)
np.testing.assert_allclose(own.beta_hi, original.beta_raw+critical*original.se_raw, rtol=0, atol=6e-12)
eligible = set(source[source.years.ge(20)].index)
assert set(own.index) == set(units.s) & eligible
fallback = units[units.response_level.eq('state')].set_index('s')
assert not (set(fallback.index) & eligible)
for sid, row in fallback.iterrows():
    key = (row.region_key,row.crop_code,row.season)
    original_state = state.loc[key]
    np.testing.assert_allclose([row.beta,row.se],[original_state.beta,original_state.se],rtol=0,atol=6e-12)
for scenario, field in [('low','lo'),('medium','e'),('high','hi')]:
    np.testing.assert_allclose(units[field],100*np.expm1(units.beta*units['exposure_'+scenario]),rtol=1e-10,atol=1e-7)
assert np.isfinite(units[['beta','se','e','ci_lo','ci_hi']]).all().all()
assert (units.ci_lo <= units.e).all() and (units.ci_hi >= units.e).all()
print(f'PASS: {len(units):,} scenario records; {len(own):,} unchanged local fits; t intervals, eligibility, and archived state fallbacks')
