#!/usr/bin/env python3
"""Native-unit weather trends and ENSO regressions with shared three-year blocks."""
import os
os.environ['OPENBLAS_NUM_THREADS']='1'
os.environ['OMP_NUM_THREADS']='1'
import sys,time,argparse
from functools import lru_cache
from pathlib import Path
import numpy as np
from build_weather import ROOT,BASE,OUT,METRICS,PERIODS,read,write
sys.path.insert(0,str(ROOT/'scripts/merged'))
from fit import kernel,allowed_folds,trends,NBOOT
from indices import mean

def compact(value):
 """Nine significant digits retain small covariances while bounding downloads."""
 if isinstance(value,dict):return {k:compact(v) for k,v in value.items()}
 if isinstance(value,list):return [compact(v) for v in value]
 if isinstance(value,float):return float(format(value,'.9g'))
 return value

@lru_cache(maxsize=4096)
def native_fit(years,values,exposures,all_exposures,lo,hi):
 year=np.array(years);y=np.array(values);x=np.array(exposures);n=len(year)
 result={'n':n}
 if n<20:return dict(result,reason=f'Needs 20 complete paired seasons; {n} available')
 result.update(first=int(year.min()),last=int(year.max()),years=year.tolist(),warm=int((x>0).sum()),cold=int((x<0).sum()),x_min=float(x.min()),x_max=float(x.max()),x_mean=float(x.mean()),x_sd=float(x.std(ddof=1)),reference_year=float(year.mean()))
 if min(result['warm'],result['cold'])<5:return dict(result,reason='Needs five positive and five negative exposures')
 if y.std()<1e-10:return dict(result,reason='No observed variation in this weather statistic')
 folds=allowed_folds(year,np.array(all_exposures));K=kernel(years,exposures,lo,hi,folds)
 baseline=[None if p is None else float(np.mean((p@y)**2)) for p in K['trend']['cv']]
 models={}
 for name in ('linear','quadratic','hinge'):
  if name not in K:models[name]={'reason':'Rank-deficient design'};continue
  k=K[name];coef=k['point']@y;rep=np.einsum('bpn,n->bp',k['boot'],y,optimize=True)
  cov=np.atleast_2d(np.cov(rep,rowvar=False)) if len(rep)>=.9*NBOOT else None
  cv=[float(1-np.mean((p@y)**2)/b) if p is not None and b is not None and b>1e-16 else None for p,b in zip(k['cv'],baseline)]
  models[name]={'coef':coef.tolist(),'cov':cov.tolist() if cov is not None else None,'boot_n':len(rep),'cv':cv,'neutral':float(coef[0]+coef[1]*(year.mean()-2000)/10)}
 result['models']=models
 return result

def run(crop,limit=0):
 start=time.monotonic();registry=read(BASE/'indices.json');meta={r['sid']:r for r in read(BASE/f'{crop}.json.gz')}
 data={}
 for p in sorted((OUT/'observations').glob(f'*-{crop}.json.gz')):data.update(read(p)['series'])
 if limit:data=dict(list(data.items())[:limit])
 results={k:{m:{} for m in METRICS} for k in registry};trend={m:{} for m in METRICS}
 @lru_cache(maxsize=5000)
 def exposure(year,start,end):return tuple(mean(year,{'start_relative_month':start,'end_relative_month':end},registry[k]) for k in registry)
 for j,(sid,obs) in enumerate(data.items()):
  r=meta[sid];window=r['windows'].get('season')
  if not window:continue
  years=np.array([int(o[0]) for o in obs]);allx=np.array([exposure(y,window['start_relative_month'],window['end_relative_month']) for y in years],dtype=float).T
  for col,metric in enumerate(METRICS,1):
   y=np.array([o[col] for o in obs],dtype=float);trend[metric][sid]={}
   for k in registry:results[k][metric][sid]={}
   for period,limits in PERIODS.items():
    mask=np.isfinite(y)&np.isfinite(allx).all(axis=0)
    if limits:mask&=(years>=limits[0])&(years<=limits[1])
    yr=years[mask];ys=y[mask];xs=allx[:,mask];lo,hi=limits or [1981,2025]
    native_obs=[[int(o[0]),float(o[col])] for o in obs if o[col] is not None]
    trend[metric][sid][period]=trends(native_obs,limits)
    for ki,k in enumerate(registry):results[k][metric][sid][period]=native_fit(tuple(yr),tuple(ys),tuple(xs[ki]),tuple(tuple(z) for z in xs),lo,hi)
  if (j+1)%500==0:print(f'{crop}: {j+1}/{len(data)}, {time.monotonic()-start:.0f}s',flush=True)
 dest=OUT/('pilot' if limit else 'fits')
 for k in registry:
  for m in METRICS:write(dest/k/m/f'{crop}.json.gz',compact(results[k][m]))
 for m in METRICS:write(dest/'trends'/m/f'{crop}.json.gz',compact(trend[m]))
 write(dest/f'{crop}-complete.json',{'crop':crop,'series':len(data),'periods':list(PERIODS),'indices':list(registry),'metrics':list(METRICS),'bootstrap_replicates':NBOOT,'seconds':time.monotonic()-start})
 print(f'{crop} complete: {len(data)} series, {time.monotonic()-start:.0f}s',flush=True)

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--crop',required=True);p.add_argument('--limit',type=int,default=0);a=p.parse_args();run(a.crop,a.limit)
