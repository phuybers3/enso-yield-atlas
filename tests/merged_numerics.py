"""Acceptance checks against the frozen database and independent least squares."""
import sys,sqlite3,json
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts/merged'))
from dataset import OUT,read,PRODUCTS
from indices import mean,window
from fit import fit,design,kernel,draws,allowed_folds,NBOOT
ix=read(OUT/'indices.json')
c=sqlite3.connect('file:'+str(ROOT.parents[1]/'2_data/derived/merged_panel/enso_ag.sqlite')+'?mode=ro',uri=True);c.row_factory=sqlite3.Row
# Read exposures from the independent merged view rather than restating our rule.
tested=0
for r in c.execute('SELECT * FROM v_observations WHERE series_id % 211=0 AND harvest_year=2000'):
 cal=dict(c.execute('select * from calendar where series_id=?',(r['series_id'],)).fetchone())
 for w,field in [('season','season'),('preseason','preseason'),('calyear','calyear'),('djf','djf_prior'),('fill','fill')]:
  for k,col in [('nino34','n34_'),('relative','n34rel_')]:
   a=mean(2000,window(cal,w),ix[k]);b=r[col+field]
   if a is None or b is None:assert a is None and b is None,(r['series_id'],w,a,b)
   else:assert abs(a-b)<1e-10,(r['series_id'],w,a,b)
   tested+=1
print('PASS database exposure equivalence',tested)
assert ix['mei']['observations'][0][0]=='1978-12-01'
w={'start_relative_month':0,'end_relative_month':2}
assert abs(mean(2000,w,ix['mei'])-np.mean([ix['mei']['values'][k] for k in ['1999-12','2000-01','2000-02']]))<1e-12
assert mean(1900,w,ix['mei']) is None
# Preserve source rows exactly, conversions only once, duplicate quarantine.
counts={};dups=0;gmfd_only=0;rice=0;excluded=0
for file in sorted((OUT/'observations').glob('*.gz')):
 for r in read(file)['series']:
  rows=c.execute('select * from observations where series_id=? order by harvest_year,year_label',(r['database_series_id'],)).fetchall()
  assert len(rows)==len(r['records'])
  kept=[a for a in r['records'] if a[9]]
  assert len(kept)==len(r['observations']);assert len({a[0] for a in kept})==len(kept)
  for src,out in zip(rows,r['records']):
   assert [src[k] for k in ['harvest_year','yield_t_ha','area_ha','production_t','corrected','year_label','complete']]==out[:7]
   assert src['primary']==out[11]
   if not out[9]:assert out[10];excluded+=1
   if 'duplicate harvest year' in out[10]:dups+=1
  for raw,obs in zip(kept,r['observations']):
   assert abs(raw[1]*r['conversion_factor']-obs[1])<1e-12
   if r['source']=='gmfd' and raw[2] is None and raw[3] is None:gmfd_only+=1
   if r['source_crop']=='rice_milled':assert abs(obs[1]*.67-raw[1])<1e-10;rice+=1
  counts[r['sid']]=len(kept)
assert len(counts)==46466 and sum(counts.values())==1403642
assert gmfd_only>1000000 and rice>1000 and dups>0
print('PASS exact raw rows, QC, duplicates, rice and yield-only data',dict(series=len(counts),accepted=sum(counts.values()),yield_only=gmfd_only,duplicates=dups,excluded=excluded))
# Compare the vectorized bootstrap projection with direct weighted lstsq.
years=np.arange(1981,2025);rng=np.random.default_rng(1);x=rng.normal(size=len(years));y=np.exp(1+.2*(years-2000)/10-.07*x+.03*x*x+rng.normal(0,.1,len(years)))
folds=allowed_folds(years,np.array([x,x*.9,x*1.3]));f=fit(years,y,x,1981,2024,folds)
for model in ['linear','quadratic','hinge']:
 X=design(years,x,model);coef=np.linalg.lstsq(X,np.log(y),rcond=None)[0]
 np.testing.assert_allclose(f['models'][model]['coef'],coef,atol=1e-12)
 blocks,counts=draws(1981,2024);W=counts[:,np.searchsorted(blocks,(years-1980)//3)]
 direct=np.array([np.linalg.lstsq(X*np.sqrt(w[:,None]),np.log(y)*np.sqrt(w),rcond=None)[0] for w in W])
 np.testing.assert_allclose(f['models'][model]['cov'],np.atleast_2d(np.cov(direct[:,2:],rowvar=False)),atol=1e-12)
 # Rice unit conversion changes only the intercept.
 f2=fit(years,y/.67,x,1981,2024,folds)
 np.testing.assert_allclose(np.array(f2['models'][model]['coef'])[1:],coef[1:],atol=1e-12)
 np.testing.assert_allclose(f2['models'][model]['cv'],f['models'][model]['cv'],atol=1e-12)
print('PASS independent coefficients, bootstrap covariance, rice invariance and holdout scores')
