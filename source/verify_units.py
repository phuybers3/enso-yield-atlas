"""Check saved estimates, source integrity, and validation against independent fits."""
from pathlib import Path
import hashlib,json
import numpy as np
import pandas as pd
import statsmodels.api as sm

HERE=Path(__file__).resolve().parent
r=pd.read_csv(HERE/'unit_results.csv')
o=pd.read_csv(HERE/'observations.csv.gz')
p=pd.read_csv(HERE/'heldout_predictions.csv.gz')
inv=pd.read_csv(HERE/'series_inventory.csv')
assert not r.duplicated(['panel','stable_id']).any()
assert len(r)==inv.status.eq('included').sum()
assert r.n.ge(20).all() and r.warm_years.ge(5).all() and r.cold_years.ge(5).all()
assert np.isfinite(r.select_dtypes('number')).all().all()
assert r.partial_r2.between(-1e-8,1+1e-8).all()
assert (r.quadratic_partial_r2+1e-10>=r.partial_r2).all()
assert (r.hinge_partial_r2+1e-10>=r.partial_r2).all()
og={k:g for k,g in o.groupby(['panel','stable_id'])}
pg={k:g for k,g in p.groupby(['panel','stable_id'])}
maxerr=0.
for row in r.sample(60,random_state=20260924).itertuples():
    g=og[row.panel,row.stable_id];x=g.n34.to_numpy();t=g.year.to_numpy();y=g.log_yield.to_numpy()
    z=np.column_stack([np.ones(len(t)),(t-2000)/10,x])
    m=sm.OLS(y,z).fit()
    assert np.allclose(m.params[-1],row.beta,atol=1e-10)
    assert np.allclose(100*np.expm1(m.params[-1]),row.sensitivity_pct)
    base=sm.OLS(y,z[:,:2]).fit()
    assert np.allclose(1-m.ssr/base.ssr,row.partial_r2,atol=1e-10)
    for offset in [0,2]:
        pp=pg[row.panel,row.stable_id];pp=pp[pp.offset==offset].sort_values('year')
        assert np.array_equal(pp.year,t)
        for b in np.unique((t-(1980+offset))//5):
            lo=1980+offset+5*b;test=(t>=lo)&(t<lo+5);train=(t<lo-1)|(t>lo+5)
            expected=sm.OLS(y[train],z[train]).fit().predict(z[test])
            actual=pp.linear_prediction.to_numpy()[test]
            if np.isfinite(actual).all():maxerr=max(maxerr,float(np.max(np.abs(expected-actual))));assert np.allclose(expected,actual,atol=1e-9)
        mse=((pp[['trend_prediction','linear_prediction','quadratic_prediction','hinge_prediction']].to_numpy()-y[:,None])**2).mean(axis=0)
        assert np.allclose(1-mse[1]/mse[0],getattr(row,f'linear_skill_{offset}'))
        assert np.allclose(1-mse[2]/mse[1],getattr(row,f'quadratic_gain_{offset}'))
        assert np.allclose(1-mse[3]/mse[1],getattr(row,f'hinge_gain_{offset}'))
for h in json.loads((HERE/'source_hashes.json').read_text()):
    assert hashlib.sha256((HERE.parent.parent/h['path']).read_bytes()).hexdigest()==h['sha256']
summary={'series':len(r),'panels':r.panel.nunique(),'units':r.stable_id.nunique(),'inventory_series':len(inv),'excluded_series':int(inv.status.ne('included').sum()),'observations':len(o),'independently_checked_series':60,'max_saved_prediction_difference':maxerr,'source_statistics_unchanged':True,'no_uncertainty_estimates_computed':True}
(HERE/'verification.json').write_text(json.dumps(summary,indent=2))
print(json.dumps(summary,indent=2))
