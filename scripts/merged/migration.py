"""Attribute migration changes on matched source records, in a declared order."""
from pathlib import Path
import numpy as np
from dataset import ROOT,OUT,read,write
from indices import mean
oldbase=ROOT/'global/data/2026-09-26';oldix=read(ROOT/'global/data/enso/2026-09-26/nino34.json');ix=read(OUT/'indices.json')['nino34'];catalog=read(OUT/'catalog.json')
oldindex={'values':oldix['monthly']};report=[];cache={}
def beta(year,y,x):
 a=np.isfinite(x)&(np.array(y)>0)
 if sum(a)<10:return None
 X=np.column_stack([np.ones(sum(a)),(np.array(year)[a]-2000)/10,np.array(x)[a]])
 return float(np.linalg.lstsq(X,np.log(np.array(y)[a]),rcond=None)[0][2]) if np.linalg.matrix_rank(X)==3 else None
for file in sorted((oldbase/'observations').glob('*.json')):
 for old in read(file)['series']:
  key=catalog['aliases'].get(old['id']);family='rice' if old['crop'].startswith('rice') else old['crop']
  if not key:continue
  cc=key[:3];name=f'{cc}-{family}.json.gz'
  if name not in cache:cache[name]=read(OUT/'observations'/name)['series']
  match=[r for r in cache[name] if r['id']==key and r['source']=='hvstat' and r['season']==old['season'] and r['basis']==old['basis'] and r['source_crop']==old['crop'].replace('-','_')]
  if len(match)!=1:continue
  new=match[0];w0=oldix['windows'].get('|'.join([old['country'],old['crop'],old['season']]))
  raw={int(float(r[5])):r for r in new['records'] if r[9]};paired=[(o,raw[o[0]]) for o in old['observations'] if o[0] in raw and o[1]>0 and raw[o[0]][1]>0]
  if not paired or w0 is None:continue
  # Common finite index sample for all four exposure definitions.
  pairs=[]
  for o,n in paired:
   ex=[mean(o[0],w0,oldindex),mean(n[0],w0,oldindex),mean(n[0],new['windows']['season'],oldindex),mean(n[0],new['windows']['season'],ix)]
   if all(v is not None for v in ex):pairs.append((o,n,ex))
  if len(pairs)<10:continue
  oy=np.array([r[0][0] for r in pairs]);ny=np.array([r[1][0] for r in pairs]);y0=np.array([r[0][1]*new['conversion_factor'] for r in pairs]);y1=np.array([r[1][1]*new['conversion_factor'] for r in pairs]);x=np.array([r[2] for r in pairs]).T
  b0=beta(oy,y0,x[0]);b1=beta(oy,y1,x[0]);b2=beta(ny,y1,x[1]);b3=beta(ny,y1,x[2]);b4=beta(ny,y1,x[3])
  full=old['observations'];fullx=[mean(r[0],w0,oldindex) for r in full];fullbeta=beta([r[0] for r in full],[r[1] for r in full],np.array(fullx,dtype=float))
  report.append(dict(series_key=new['series_key'],sid=new['sid'],source_crop=new['source_crop'],old_n=len(old['observations']),new_n=len(new['observations']),matched_n=len(pairs),changed_yields=int(np.sum(abs(y1-y0)>1e-4)),changed_harvest_years=int(np.sum(oy!=ny)),max_abs_yield_change=float(max(abs(y1-y0))),old_full_beta=fullbeta,matched_old_beta=b0,new_yield_beta=b1,new_year_beta=b2,new_calendar_beta=b3,new_index_beta=b4))
write(OUT/'migration.json',dict(method='Sequential attribution: old full record → common eligible records → authoritative yield → harvest-year labels → assigned calendar → ERSSTv5 index. Contrasts depend on this order and are descriptive checks, not separate causal effects. Rice converted to a common basis before comparison; zero yields excluded only from log fits.',series=report,summary=dict(compared_series=len(report),matched_rows=sum(r['matched_n'] for r in report),unchanged_yield_rows=sum(r['matched_n']-r['changed_yields'] for r in report),changed_year_rows=sum(r['changed_harvest_years'] for r in report))))
print(read(OUT/'migration.json')['summary'])
