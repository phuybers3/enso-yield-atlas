#!/usr/bin/env python3
"""Export complete crop-season weather with exact daily coverage, without changing source files."""
import os
os.environ.setdefault('OPENBLAS_NUM_THREADS','1')
import sys, json, gzip, hashlib, time, warnings
from pathlib import Path
from collections import defaultdict
import numpy as np
import pandas as pd
import netCDF4
import pyarrow as pa
import pyarrow.parquet as pq

ROOT=Path(__file__).resolve().parents[2]
ENSO=ROOT.parents[1]
BASE=ROOT/'global/data/2026-09-26-merged-v1'
RELEASE='2026-09-26-climate-v1'
OUT=ROOT/'climate/data'/RELEASE
METRICS={'tmean':{'label':'Average temperature','units':'°C','source':'Berkeley Earth','definition':'Crop-season mean of daily (Tmax + Tmin)/2, spatially averaged over the reporting unit.'},
 't95':{'label':'Hot-day temperature · 95th percentile','units':'°C','source':'Berkeley Earth','definition':'Within-season 95th percentile of regional daily Tmax. Spatial averaging precedes the percentile.'},
 'pmean':{'label':'Average precipitation','units':'mm/day','source':'CHIRPS / ERA5 fallback','definition':'Crop-season rainfall divided by the exact number of valid days. Includes dry days.'},
 'p95':{'label':'Heavy rain · wet-day 95th percentile','units':'mm/day','source':'CHIRPS / ERA5 fallback','definition':'Within-season 95th percentile of regional daily rain on days with at least 1 mm. Requires five wet days. Spatial averaging precedes the percentile.'}}
PERIODS={'1981-2024':[1981,2024],'1991-2020':[1991,2020],'available':None}
COLUMNS=['year','tmean','t95','pmean','p95','valid_tmean_days','valid_tmax_days','valid_precip_days','expected_days','start','end']

def clean(x):
 if isinstance(x,dict):return {str(k):clean(v) for k,v in x.items()}
 if isinstance(x,(list,tuple,np.ndarray)):return [clean(v) for v in x]
 if isinstance(x,np.integer):return int(x)
 if isinstance(x,(float,np.floating)):return float(x) if np.isfinite(x) else None
 return x
def write(path,data):
 path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
 raw=json.dumps(clean(data),separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()
 if path.suffix=='.gz':raw=gzip.compress(raw,compresslevel=6,mtime=0)
 temp=path.with_name(path.name+'.tmp');temp.write_bytes(raw);temp.replace(path)
def read(path):
 path=Path(path);return json.loads(gzip.decompress(path.read_bytes()) if path.suffix=='.gz' else path.read_bytes())
def sha(path):
 h=hashlib.sha256()
 with Path(path).open('rb') as f:
  for b in iter(lambda:f.read(4194304),b''):h.update(b)
 return h.hexdigest()
def summaries(obs,col):
 out={}
 for period,limits in PERIODS.items():
  vals=[r for r in obs if r[col] is not None and (limits is None or limits[0]<=r[0]<=limits[1])]
  n=len(vals);span=(limits[1]-limits[0]+1) if limits else (vals[-1][0]-vals[0][0]+1 if n else 0)
  out[period]={'n':n,'mean':sum(r[col] for r in vals)/n if n else None,'first':vals[0][0] if n else None,'last':vals[-1][0] if n else None,'completeness':n/span if span else 0}
 return out
def prefix(a):return np.vstack([np.zeros((1,a.shape[1])),np.cumsum(a,axis=0,dtype=np.float64)])

def build():
 start=time.monotonic();w=ENSO/'2_data/derived/weather';s=ENSO/'2_data/derived/merged_panel/export/weather_season.parquet'
 cross=pd.read_csv(ENSO/'results/climate_atlas/series_crosswalk.csv')
 cols=['series_id','harvest_year','window_start','window_end','n_days','tavg_mean','tmax_p95_season','precip_wetday_p95_season']
 rows=pd.read_parquet(s,columns=cols).merge(cross,left_on='series_id',right_on='database_series_id',validate='many_to_one')
 assert not rows.duplicated(['sid','harvest_year']).any()
 meta=pd.read_csv(w/'weather_units.csv');positions={k:j for j,k in enumerate(meta.unit_key)}
 rows['position']=rows.unit_key.map(positions);rows['start_day']=pd.to_datetime(rows.window_start).values.astype('datetime64[D]').astype('int64');rows['end_day']=pd.to_datetime(rows.window_end).values.astype('datetime64[D]').astype('int64')+1
 for c in ['nt','ntx','np']:rows[c]=0
 rows['pmean']=np.nan
 monthly_path=ENSO/'results/climate_atlas/weather_monthly_corrected.parquet';monthly_writer=None
 with netCDF4.Dataset(w/'unit_daily_temperature.nc') as T,netCDF4.Dataset(w/'unit_daily_precip.nc') as P:
  assert list(T['unit_key'][:])==list(P['unit_key'][:])==list(meta.unit_key)
  td=np.asarray(T['time'][:],dtype=int);pd_=np.asarray(P['time'][:],dtype=int)
  assert np.all(np.diff(td)==1) and np.all(np.diff(pd_)==1)
  months=pd.date_range('1981-01-01','2026-01-01',freq='MS').values.astype('datetime64[D]').astype('int64')
  for lo in range(0,len(meta),1024):
   hi=min(lo+1024,len(meta));sel=rows.position.between(lo,hi-1);part=rows.loc[sel];j=part.position.to_numpy()-lo
   ta=np.ma.filled(T['tavg'][:,lo:hi],np.nan);tx=np.ma.filled(T['tmax'][:,lo:hi],np.nan);pr=np.ma.filled(P['precip'][:,lo:hi],np.nan)
   cta,ctx,cp=prefix(np.isfinite(ta)),prefix(np.isfinite(tx)),prefix(np.isfinite(pr));sp=prefix(np.nan_to_num(pr,nan=0));st=prefix(np.nan_to_num(ta,nan=0))
   a=np.clip(part.start_day.to_numpy()-td[0],0,len(td));b=np.clip(part.end_day.to_numpy()-td[0],0,len(td));c=np.clip(part.start_day.to_numpy()-pd_[0],0,len(pd_));d=np.clip(part.end_day.to_numpy()-pd_[0],0,len(pd_))
   nt=cta[b,j]-cta[a,j];ntx=ctx[b,j]-ctx[a,j];np_=cp[d,j]-cp[c,j]
   rows.loc[sel,'nt']=nt;rows.loc[sel,'ntx']=ntx;rows.loc[sel,'np']=np_
   rows.loc[sel,'pmean']=np.divide(sp[d,j]-sp[c,j],np_,out=np.full(len(part),np.nan),where=np_>0)
   # Rebuild monthly means using actual dates; preserve missingness and exact counts.
   aa=np.clip(months[:-1]-td[0],0,len(td));bb=np.clip(months[1:]-td[0],0,len(td));cc=np.clip(months[:-1]-pd_[0],0,len(pd_));dd=np.clip(months[1:]-pd_[0],0,len(pd_));nd=np.diff(months)[:,None]
   mt=cta[bb]-cta[aa];mp=cp[dd]-cp[cc];ts=st[bb]-st[aa];ps=sp[dd]-sp[cc]
   tmean=np.divide(ts,mt,out=np.full_like(ts,np.nan),where=mt==nd);pmean=np.divide(ps,mp,out=np.full_like(ps,np.nan),where=mp==nd)
   date=pd.DatetimeIndex(months[:-1].astype('datetime64[D]'));n=hi-lo
   monthly=pd.DataFrame({'unit_key':np.repeat(meta.unit_key.iloc[lo:hi].to_numpy(),540),'year':np.tile(date.year,n),'month':np.tile(date.month,n),'tmean':tmean.T.ravel(),'pmean':pmean.T.ravel(),'valid_temperature_days':mt.T.ravel().astype('int16'),'valid_precip_days':mp.T.ravel().astype('int16'),'expected_days':np.tile(nd.ravel(),n)})
   table=pa.Table.from_pandas(monthly,preserve_index=False)
   if monthly_writer is None:monthly_writer=pq.ParquetWriter(monthly_path,table.schema,compression='zstd')
   monthly_writer.write_table(table)
   print(f'daily coverage and corrected months: units {lo}-{hi}; {time.monotonic()-start:.0f}s',flush=True)
 monthly_writer.close()
 # Complete-window eligibility differs by field; no rounded-coverage shortcut.
 rows.loc[rows.nt!=rows.n_days,'tavg_mean']=np.nan
 rows.loc[rows.ntx!=rows.n_days,'tmax_p95_season']=np.nan
 rows.loc[rows.np!=rows.n_days,['pmean','precip_wetday_p95_season']]=np.nan
 observations=defaultdict(dict);summary=defaultdict(dict);counts=defaultdict(int)
 names=['harvest_year','tavg_mean','tmax_p95_season','pmean','precip_wetday_p95_season','nt','ntx','np','n_days','window_start','window_end']
 for sid,part in rows.groupby('sid',sort=False):
  part=part.sort_values('harvest_year');first=part.iloc[0];a=clean(part[names].to_numpy().tolist())
  # Round display/storage precision only after exact counting and source calculations.
  a=[[round(v,6) if isinstance(v,float) else v for v in r] for r in a]
  observations[(first.country,first.crop)][sid]=a
  summary[first.crop][sid]={m:summaries(a,i+1) for i,m in enumerate(METRICS)}
  for i,m in enumerate(METRICS):counts[m]+=sum(r[i+1] is not None for r in a)
 for (country,crop),data in observations.items():write(OUT/'observations'/f'{country}-{crop}.json.gz',{'columns':COLUMNS,'series':data})
 for crop,data in summary.items():write(OUT/'summaries'/f'{crop}.json.gz',data)
 write(OUT/'units.json.gz',{r['unit_key']:{k:v for k,v in r.items() if k!='unit_key'} for r in meta.to_dict('records')})
 catalog={'release':RELEASE,'metrics':METRICS,'periods':PERIODS,'columns':COLUMNS,'counts':dict(counts),'series':len(rows.sid.unique()),'units':len(meta),'countries':sorted(rows.country.unique()),'complete_windows_required':True,'wet_threshold_mm':1,'min_wet_days':5,'percentile_method':'numpy linear, spatial averaging first','temperature_end':'2024-10-31','precipitation_end':'2025-12-31','weighting':'SPAM 2010 summed harvested area of six staples, area fallback; same spatial weights for all crops','fit_periods':list(PERIODS),'fit_window':'season','source_files':{str(p.relative_to(ENSO)):sha(p) for p in [s,w/'unit_daily_temperature.nc',w/'unit_daily_precip.nc',w/'weather_units.csv']},'monthly_rebuild':{'rows':14750*540,'first':'1981-01','last':'2025-12','sha256':sha(monthly_path)},'notes':['No national weather aggregation; unmapped or uncovered units remain unavailable.','Multi-year p95 maps show the mean of annual crop-season percentiles, not a pooled percentile.','Threshold exceedance counts are separate from percentile levels.','Daily TAVG is (Tmax+Tmin)/2.','Weather source provenance and external station-validation limitations remain visible.']}
 write(OUT/'catalog.json',catalog)
 print(f'weather export complete: {len(rows):,} rows, {catalog["series"]} series, {dict(counts)}; {time.monotonic()-start:.0f}s',flush=True)

if __name__=='__main__':build()
