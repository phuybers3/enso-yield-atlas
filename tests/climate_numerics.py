"""Verify published weather against daily data and independent native-unit fits."""
import os
os.environ['OPENBLAS_NUM_THREADS']='1'
import sys,json
from pathlib import Path
from collections import Counter
import numpy as np
import pandas as pd
import pyarrow.parquet as pq
import netCDF4
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts/climate'))
from build_weather import OUT,BASE,ENSO,read,write,METRICS
from fit_weather import native_fit
from fit import design,draws
from indices import mean

counts=Counter();nrows=0;series=0;zeros=0;summary_checks=0
for cropfile in sorted((OUT/'summaries').glob('*.gz')):
 crop=cropfile.name.split('.')[0];summary=read(cropfile)
 for file in sorted((OUT/'observations').glob(f'*-{crop}.json.gz')):
  for sid,rows in read(file)['series'].items():
   series+=1;nrows+=len(rows)
   assert len({r[0] for r in rows})==len(rows)
   for row in rows:
    assert row[8]==int((np.datetime64(row[10])-np.datetime64(row[9]))/np.timedelta64(1,'D'))+1
    for c in (5,6,7):assert 0<=row[c]<=row[8]
    for c,metric in enumerate(METRICS,1):
     value=row[c]
     if value is not None:
      assert np.isfinite(value);assert row[{1:5,2:6,3:7,4:7}[c]]==row[8]
      if c>=3:assert value>=0
      if c==4:assert value>=1
      counts[metric]+=1
    zeros+=row[3]==0
   for c,metric in enumerate(METRICS,1):
    vals=[r[c] for r in rows if r[c] is not None and 1981<=r[0]<=2024]
    s=summary[sid][metric]['1981-2024'];assert s['n']==len(vals)
    if vals:assert abs(s['mean']-np.mean(vals))<1e-9
    else:assert s['mean'] is None
    summary_checks+=1
catalog=read(OUT/'catalog.json');assert dict(counts)==catalog['counts'];assert series==catalog['series']==45651;assert zeros>0
print('PASS all public rows: exact windows, counts, missingness, dry zeros and period means',nrows,flush=True)

# A frozen audit names seven independently selected edge cases, including
# ERA5 fallback, a cross-year crop, a missing unit and incomplete late 2024.
audit=read(ROOT/'provenance/climate/import-audit.json');daily_checks=0
w=ENSO/'2_data/derived/weather'
with netCDF4.Dataset(w/'unit_daily_temperature.nc') as T,netCDF4.Dataset(w/'unit_daily_precip.nc') as P:
 positions={v:i for i,v in enumerate(T['unit_key'][:])}
 def dates(ds):
  v=ds['time'];return np.array([str(d)[:10] for d in netCDF4.num2date(v[:],v.units)],dtype='datetime64[D]')
 td,pd_=dates(T),dates(P)
 for case in audit['samples']:
  crop=case['crop'];sid=case['sid'];cc=case['unit_key'].split(':')[0]
  row=next(r for r in read(OUT/'observations'/f'{cc}-{crop}.json.gz')['series'][sid] if r[0]==case['year'])
  start,end=np.datetime64(row[9]),np.datetime64(row[10]);j=positions[case['unit_key']]
  def values(ds,dt,var):return np.ma.filled(ds[var][np.searchsorted(dt,start):np.searchsorted(dt,end,side='right'),j],np.nan).astype(float)
  ta,tx,pr=values(T,td,'tavg'),values(T,td,'tmax'),values(P,pd_,'precip');wet=pr[pr>=1]
  nums=[np.isfinite(a).sum() for a in (ta,tx,pr)];assert nums==row[5:8]
  expected=[float(np.mean(ta)) if nums[0]==row[8] else None,float(np.percentile(tx,95)) if nums[1]==row[8] else None,float(np.mean(pr)) if nums[2]==row[8] else None,float(np.percentile(wet,95)) if nums[2]==row[8] and len(wet)>=5 else None]
  for actual,want in zip(row[1:5],expected):
   if want is None:assert actual is None
   else:np.testing.assert_allclose(actual,want,atol=2e-5,rtol=1e-6)
   daily_checks+=1
 # Independently check the recovered final December, absent upstream.
 case=audit['samples'][4];j=positions[case['unit_key']]
 dates_dec=(pd_>=np.datetime64('2025-12-01'))&(pd_<=np.datetime64('2025-12-31'))
 pr=np.ma.filled(P['precip'][np.flatnonzero(dates_dec),j],np.nan).astype(float)
 monthly=ENSO/'results/climate_atlas/weather_monthly_corrected.parquet'
 rec=pd.read_parquet(monthly,filters=[('unit_key','=',case['unit_key']),('year','=',2025),('month','=',12)]).iloc[0]
 assert rec.valid_precip_days==31 and rec.valid_temperature_days==0 and np.isnan(rec.tmean)
 np.testing.assert_allclose(rec.pmean,np.mean(pr),rtol=1e-10)
pf=pq.ParquetFile(monthly);assert pf.metadata.num_rows==14750*540
for b in pf.iter_batches(columns=['year','month']):
 d=b.to_pandas();assert d.month.between(1,12).all() and d.year.between(1981,2025).all()
print('PASS daily recomputation and corrected monthly dates',daily_checks,flush=True)

# Independent weighted least squares, including negative temperatures and zero
# rainfall: covariance must use native values, not log weather or log yield.
years=np.arange(1981,2025);rng=np.random.default_rng(86);x=rng.normal(size=len(years));temp=-5+.3*(years-2000)/10+.6*x+.15*x*x+rng.normal(0,.7,len(years))
precip=np.maximum(0,.2-.2*x+rng.normal(0,.15,len(years)))
checks=0
for y in (temp,precip):
 f=native_fit(tuple(years),tuple(y),tuple(x),(tuple(x),tuple(.8*x),tuple(1.2*x)),1981,2024)
 blocks,counts_boot=draws(1981,2024);weights=counts_boot[:,np.searchsorted(blocks,(years-1980)//3)]
 for model in ('linear','quadratic','hinge'):
  X=design(years,x,model);coef=np.linalg.lstsq(X,y,rcond=None)[0]
  np.testing.assert_allclose(f['models'][model]['coef'],coef,atol=1e-11)
  reps=np.array([np.linalg.lstsq(X*np.sqrt(w[:,None]),y*np.sqrt(w),rcond=None)[0][2:] for w in weights])
  np.testing.assert_allclose(f['models'][model]['cov'],np.atleast_2d(np.cov(reps,rowvar=False)),atol=1e-11)
  checks+=1
# Check actual persisted fits rather than only the fitting helper.
registry=read(BASE/'indices.json');actual=0
for crop in ('wheat','rice','maize'):
 metadata={r['sid']:r for r in read(BASE/f'{crop}.json.gz')}
 for k in registry:
  for c,metric in enumerate(METRICS,1):
   file=OUT/'fits'/k/metric/f'{crop}.json.gz'
   if not file.exists():continue
   fits=read(file)
   sid=next(s for s in fits if fits[s]['1981-2024'].get('models'))
   meta=metadata[sid];obs=read(OUT/'observations'/f'{meta["country"]}-{crop}.json.gz')['series'][sid]
   f=fits[sid]['1981-2024'];by={r[0]:r[c] for r in obs};yr=np.array(f['years']);y=np.array([by[t] for t in yr]);x=np.array([mean(t,meta['windows']['season'],registry[k]) for t in yr])
   for model,fit in f['models'].items():
    if 'coef' not in fit:continue
    coef=np.linalg.lstsq(design(yr,x,model),y,rcond=None)[0]
    np.testing.assert_allclose(fit['coef'],coef,atol=1e-8);actual+=1
assert actual>=72,actual
report=dict(rows=nrows,series=series,metrics=dict(counts),summary_checks=summary_checks,daily_checks=daily_checks,monthly_rows=pf.metadata.num_rows,synthetic_fit_covariance_checks=checks,persisted_least_squares_checks=actual,passed=True)
write(ROOT/'provenance/climate/validation.json',report)
print('PASS native fits, direct bootstrap covariance, persisted coefficients',checks,actual,flush=True)
