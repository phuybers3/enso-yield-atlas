"""Trend, episode omission and partial pooling on the frozen atlas sample.

The release inherits the immutable merged-v1 data. We refit both members of
every comparison on the same observations and withhold years across the whole
pooling group. The borrowing fraction is fixed before examining validation.
"""
import argparse
from collections import Counter, defaultdict
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import sqlite3
import time

import numpy as np
from dataset import ROOT, OUT as BASE, read, write
from fit import MODELS, draws
from indices import mean

OUT = BASE.parent / '2026-09-26-robust-v1'
PERIOD = '1981-2024'
BORROW = 0.5
MIN_GROUP = 3
DB = ROOT.parent.parent / '2_data/derived/merged_panel/enso_ag.sqlite'


def snapshot_regions():
    """Use only the upstream geographic crosswalk, never its fitted values."""
    dest = OUT / 'regions.json'
    if dest.exists():
        return read(dest)
    db = DB
    with sqlite3.connect(f'file:{db}?mode=ro', uri=True) as conn:
        rows = conn.execute('SELECT unit_key,iso3,region_key,region_name,region_source FROM unit_regions').fetchall()
        old = conn.execute('SELECT series_id,beta_raw,beta_best,years,first_year,last_year FROM enso_response_unit_best').fetchall()
    assert len({r[0] for r in rows}) == len(rows)
    result = {r[0]:dict(country=r[1],id=r[2],name=r[3],source=r[4]) for r in rows}
    write(dest, result)
    write(OUT/'upstream-comparison-input.json.gz', {str(r[0]):dict(raw=r[1],pooled=r[2],n=r[3],first=r[4],last=r[5]) for r in old})
    return result


def episodes(index):
    """Major episodes from trailing three-month means in the frozen index.

    Five consecutive means beyond +/-0.5 C and a mean peak of at least 1.5 C.
    Bounds include every month contributing to those means. These are this
    dataset's episodes, not an official ONI classification.
    """
    vals={int(k[:4])*12+int(k[5:])-1:v for k,v in index['values'].items()}
    months=sorted(vals)
    avg={m:sum(vals[t] for t in range(m-2,m+1))/3 for m in months if all(t in vals for t in range(m-2,m+1))}
    found=[]
    for sign in (1,-1):
        runs=[];run=[]
        for m,v in sorted(avg.items()):
            if sign*v>=.5:
                if run and m!=run[-1]+1:runs.append(run);run=[]
                run.append(m)
            elif run:runs.append(run);run=[]
        if run:runs.append(run)
        for run in runs:
            peak=max(sign*avg[m] for m in run)
            if len(run)<5 or peak<1.5 or run[-1]<1981*12 or run[0]>=2025*12:continue
            a,b=run[0]-2,run[-1]
            label=f'{a//12}–{b//12}' if a//12!=b//12 else str(a//12)
            found.append(dict(id=f'{a}-{b}',label=('El Niño ' if sign>0 else 'La Niña ')+label,start=a,end=b,peak=sign*peak))
    return sorted(found,key=lambda e:e['start'])


def event_keep(year,window,event):
    a=year*12+window['start_relative_month']-1
    b=year*12+window['end_relative_month']-1
    return (b<event['start']) | (a>event['end'])


def basis(year,x,model,quadratic_time=False):
    t=(np.asarray(year)-2000)/10
    z=np.column_stack([np.ones(len(t)),t]+([t*t] if quadratic_time else []))
    f=np.asarray(x)[:,None]
    if model=='quadratic':f=np.column_stack([x,np.asarray(x)**2])
    if model=='hinge':f=np.column_stack([x,np.maximum(x,0)])
    return z,f


@lru_cache(maxsize=512)
def operators(years,xs,model,quadratic_time,bootstrap):
    year=np.array(years);x=np.array(xs);z,f=basis(year,x,model,quadratic_time)
    if bootstrap:
        blocks,counts=draws(1981,2024)
        w=np.vstack([np.ones(len(year)),counts[:,np.searchsorted(blocks,(year-1980)//3)]])
    else:w=np.ones((1,len(year)))
    zz=np.einsum('bn,ni,nj->bij',w,z,z)
    zf=np.einsum('bn,ni,nj->bij',w,z,f)
    invz=np.linalg.pinv(zz,hermitian=True)
    zproj=np.einsum('bij,nj,bn->bin',invz,z,w)
    fproj=w[:,None,:]*f.T[None,:,:]-np.einsum('bji,bjn->bin',zf,zproj)
    a=np.einsum('bin,nj->bij',fproj,f)
    inva=np.linalg.pinv(a,hermitian=True)
    good=(np.linalg.matrix_rank(zz)==z.shape[1]) & (np.linalg.matrix_rank(a)==f.shape[1]) & (w.sum(axis=1)>=12)
    return z,f,a,inva,zproj,fproj,good


def sufficient(rec,model,quadratic_time=False,keep=None,bootstrap=False):
    keep=np.ones(len(rec['year']),bool) if keep is None else keep
    year,x,y=rec['year'][keep],rec['x'][keep],rec['y'][keep]
    if len(year)<12 or min((x>0).sum(),(x<0).sum())<3:return None
    z,f,a,inva,zproj,fproj,good=operators(tuple(year),tuple(x),model,quadratic_time,bootstrap)
    if not good[0]:return None
    rhs=np.einsum('bin,n->bi',fproj,y)
    beta=np.einsum('bij,bj->bi',inva,rhs)
    beta[~good]=np.nan
    return dict(a=a,b=rhs,beta=beta,good=good,z=z,f=f,zproj=zproj,y=y,year=year,x=x)


def group_fit(records,model,quadratic_time=False,keeps=None,bootstrap=False):
    stats=[sufficient(r,model,quadratic_time,None if keeps is None else keeps[i],bootstrap) for i,r in enumerate(records)]
    usable=[s for s in stats if s is not None]
    if not usable:return stats,[None]*len(stats)
    counts=sum(s['good'].astype(int) for s in usable)
    a=sum(np.where(s['good'][:,None,None],s['a'],0) for s in usable)
    b=sum(np.where(s['good'][:,None],s['b'],0) for s in usable)
    common=np.einsum('bij,bj->bi',np.linalg.pinv(a,hermitian=True),b)
    good=(counts>=MIN_GROUP)&(np.linalg.matrix_rank(a)==a.shape[-1])
    common[~good]=np.nan
    pooled=[None if s is None else (1-BORROW)*s['beta']+BORROW*common for s in stats]
    return stats,pooled


def coefficients(stat,beta):
    if stat is None or not np.isfinite(beta[0]).all():return None
    nuisance=stat['zproj'][0] @ (stat['y']-stat['f']@beta[0])
    # Preserve the browser's intercept, time, ENSO order; time^2 is separate.
    return dict(coef=np.r_[nuisance[:2],beta[0]].tolist(),time2=float(nuisance[2]) if len(nuisance)>2 else 0,
                n=len(stat['year']),x_min=float(stat['x'].min()),x_max=float(stat['x'].max()))


def packed(stat,beta,cv=None):
    result=coefficients(stat,beta)
    if result is None:return {'reason':'Needs three eligible peer units in this group'}
    reps=beta[1:];reps=reps[np.isfinite(reps).all(axis=1)]
    result.update(boot_n=len(reps),cov=np.atleast_2d(np.cov(reps,rowvar=False)).tolist() if len(reps)>=360 else None,cv=cv or [None,None])
    return result


def cross_validate(records,model):
    """Every peer loses the same five-year block and neighboring years."""
    n=len(records);out=[dict(individual=[],pooled=[],folds=[]) for _ in records]
    for offset in (0,2):
        sums=np.zeros((n,4));counts=np.zeros(n,int);folds=np.zeros(n,int)
        for edge in range(1980+offset,2025,5):
            train=[(r['year']<edge-1)|(r['year']>edge+5) for r in records]
            stats,pools=group_fit(records,model,keeps=train)
            for i,(r,s,b) in enumerate(zip(records,stats,pools)):
                test=(r['year']>=edge)&(r['year']<edge+5)
                if s is None or not test.any():continue
                z,f=basis(r['year'][test],r['x'][test],model);target=r['y'][test]
                base=np.linalg.lstsq(s['z'],s['y'],rcond=None)[0]
                raw=coefficients(s,s['beta']);pred=z@np.array(raw['coef'][:2])+f@s['beta'][0]
                baseline=float(np.sum((target-z@base)**2));error=float(np.sum((target-pred)**2))
                # Matching folds compare pooling only when it is estimable.
                if b is None or not np.isfinite(b[0]).all():continue
                pool=coefficients(s,b);pp=z@np.array(pool['coef'][:2])+f@b[0]
                sums[i]+=np.array([baseline,error,float(np.sum((target-pp)**2)),test.sum()])
                counts[i]+=test.sum();folds[i]+=1
        for i in range(n):
            valid=folds[i]>=3 and counts[i]>=15 and sums[i,0]>0
            out[i]['individual'].append(float(1-sums[i,1]/sums[i,0]) if valid else None)
            out[i]['pooled'].append(float(1-sums[i,2]/sums[i,0]) if valid else None)
            out[i]['folds'].append(dict(blocks=int(folds[i]),test_years=int(counts[i])))
    return out


def run(crop,limit=0):
    start=time.monotonic();regions=snapshot_regions();ix=read(BASE/'indices.json');ev=episodes(ix['nino34'])
    fits=read(BASE/'fits/nino34/season'/f'{crop}.json.gz');groups=defaultdict(list);output={};old=read(OUT/'upstream-comparison-input.json.gz');comparison=[]
    @lru_cache(maxsize=None)
    def exposure(year,a,b):return mean(year,dict(start_relative_month=a,end_relative_month=b),ix['nino34'])
    for path in sorted((BASE/'observations').glob(f'*-{crop}.json.gz')):
        for r in read(path)['series']:
            fit=fits[r['sid']][PERIOD]
            if not fit.get('models',{}).get('linear',{}).get('coef'):continue
            years=fit['years'];lookup={a[0]:a[1] for a in r['observations']};w=r['windows']['season']
            year=np.array(years);x=np.array([exposure(y,w['start_relative_month'],w['end_relative_month']) for y in years]);y=np.log([lookup[a] for a in years])
            region=regions.get(r['id']);valid_region=region and region['country']==r['country'] and region['source']!='unit'
            # Existing ADM1 records stand alone; no country-wide borrowing.
            key='|'.join([region['id'] if valid_region else r['id'],r['source'],r['source_crop'],r['season_std'],r['basis']])
            rec=dict(sid=r['sid'],year=year,x=x,y=y,window=w,unit=r['id'],baseline=fit)
            groups[key].append(rec)
            output[r['sid']]=dict(group=key,group_name=region['name'] if region else r['name'],models={},borrow=BORROW)
            upstream=old.get(str(r['database_series_id']))
            if upstream:comparison.append(dict(sid=r['sid'],atlas_n=fit['n'],atlas_first=fit['first'],atlas_last=fit['last'],atlas_beta=fit['models']['linear']['coef'][2],upstream=upstream))
    if limit:
        # Whole groups remain intact in benchmarks and tests.
        groups=dict(list(groups.items())[:limit]);ids={r['sid'] for g in groups.values() for r in g};output={k:v for k,v in output.items() if k in ids}
    counts=Counter()
    for j,(key,recs) in enumerate(groups.items()):
        assert len({r['unit'] for r in recs})==len(recs),key
        for r in recs:output[r['sid']]['group_units']=len(recs)
        for model in MODELS:
            full,pool=group_fit(recs,model,bootstrap=True)
            quad,qpool=group_fit(recs,model,quadratic_time=True,bootstrap=True)
            cv=cross_validate(recs,model) if len(recs)>=MIN_GROUP else [None]*len(recs)
            for i,r in enumerate(recs):
                s=full[i];o=output[r['sid']]['models']
                if s is None:continue
                raw=packed(s,s['beta']);original=r['baseline']['models'][model]
                np.testing.assert_allclose(raw['coef'],original['coef'],atol=2e-8,rtol=2e-8)
                np.testing.assert_allclose(raw['cov'],original['cov'],atol=2e-8,rtol=2e-8)
                o[model]=dict(individual=dict(trend=packed(quad[i],quad[i]['beta']) if quad[i] else None,events=[]),pooled=packed(s,pool[i]))
                if cv[i]:o[model]['comparison']=cv[i];o[model]['pooled']['cv']=cv[i]['pooled']
                if o[model]['pooled'].get('coef'):
                    o[model]['pooled'].update(trend=packed(quad[i],qpool[i]) if quad[i] else None,events=[])
                    counts['pooled_models']+=1
                counts['individual_models']+=1
            for event in ev:
                keeps=[event_keep(r['year'],r['window'],event) for r in recs]
                if all(k.all() for k in keeps):continue
                st,pl=group_fit(recs,model,keeps=keeps)
                for i,r in enumerate(recs):
                    target=output[r['sid']]['models'].get(model)
                    if not target:continue
                    n_removed=int((~keeps[i]).sum())
                    # Peer omissions can affect a pooled unit with no own harvest removed.
                    base=dict(event=event['id'],removed=n_removed,removed_years=r['year'][~keeps[i]].tolist())
                    if n_removed:
                        cf=coefficients(st[i],st[i]['beta']) if st[i] else None
                        target['individual']['events'].append(dict(base,fit=cf))
                    if target['pooled'].get('coef'):
                        cf=coefficients(st[i],pl[i]) if st[i] and pl[i] is not None else None
                        target['pooled']['events'].append(dict(base,fit=cf))
        if j%25==0:print(crop,j,len(groups),dict(counts),round(time.monotonic()-start,1),flush=True)
    report=dict(crop=crop,series=len(output),groups=len(groups),counts=dict(counts),seconds=time.monotonic()-start,limit=limit)
    if not limit:
        write(OUT/'robustness'/f'{crop}.json.gz',output)
        write(OUT/'audit'/f'{crop}.json',report)
        write(OUT/'reconciliation'/f'{crop}.json.gz',comparison)
    print(report,flush=True)
    return output,report


def publish_chunks(crop):
    """Country detail downloads keep worldwide checks small enough for a map."""
    path=OUT/'robustness'/f'{crop}.json.gz'
    records=read(path)
    if records and ('group' not in next(iter(records.values())) or next(iter(records.values())).get('compact')):
        if next(iter(records.values())).get('compact'):return
        # Upgrade an already split bundle without rerunning any regressions.
        for detail in (OUT/'robustness/details'/crop).glob('*.json.gz'):
            for sid,c in read(detail).items():
                records[sid].update({k:c[k] for k in ('group','group_name','group_units','borrow')})
                records[sid]['compact']=True
        write(path,records)
        return
    countries={r['sid']:r['country'] for r in read(BASE/f'{crop}.json.gz')}
    chunks=defaultdict(dict)
    def vector(f):
        if not f or not f.get('coef'):return None
        return dict(coef=[0,0]+f['coef'][2:],x_min=f['x_min'],x_max=f['x_max'])
    compact={}
    for sid,c in records.items():
        chunks[countries[sid]][sid]=c
        models={}
        for name,m in c['models'].items():
            models[name]={}
            for estimator in ('individual','pooled'):
                f=m[estimator]
                models[name][estimator]={k:f[k] for k in ('coef','cov','cv','boot_n','reason') if k in f}
                models[name][estimator].update(trend=vector(f.get('trend')),events=[dict(event=e['event'],fit=vector(e['fit'])) for e in f.get('events',[])])
        compact[sid]=dict(models=models,compact=True,**{k:c[k] for k in ('group','group_name','group_units','borrow')})
    for country,group in chunks.items():write(OUT/'robustness/details'/crop/f'{country}.json.gz',group)
    write(path,compact)
    write(OUT/'detail-index'/f'{crop}.json',dict(countries={k:len(v) for k,v in chunks.items()},series=len(records)))


def main():
    p=argparse.ArgumentParser();p.add_argument('--crop',action='append',choices=['wheat','maize','rice','soybean','sorghum','cassava']);p.add_argument('--limit',type=int,default=0)
    args=p.parse_args();snapshot_regions()
    write(OUT/'methods.json',dict(release=OUT.name,inherits=BASE.name,index='nino34',window='season',period=PERIOD,models=list(MODELS),bootstrap=400,borrow=BORROW,min_group_units=MIN_GROUP,
        events=episodes(read(BASE/'indices.json')['nino34']),
        pooling='Fixed 50% borrowing toward the state/province common slope, fitted with unit intercepts and trends. Exact source, product, season and area basis; at least three eligible units. No borrowing across states or countries.',
        validation='Two five-year holdout layouts with adjacent-year embargo across all peers. Entire pooled procedure refitted on training years. Comparisons use identical eligible test years.',
        uncertainty='400 shared three-year calendar-block draws; recompute individual slopes, group slope and nuisance trends in every draw. At least 360 usable draws.',
        episodes_definition='Trailing three-month Niño 3.4 means beyond +/-0.5 C for at least five consecutive months, peak magnitude >=1.5 C. Omit every harvest whose assigned exposure window overlaps the episode months. Dataset-defined; not official ONI.',
        scope='Trend and episode checks and pooling cover 1981–2024 crop-season Niño 3.4 for six crops. Other selections retain original fits with explicit unavailable checks.',
        fdr='Benjamini–Yekutieli q=0.10 across all mapped source-selected reporting units worldwide for the selected crop, period, index, exposure, model and estimator. Family formed before country zoom or evidence/support filtering. Arbitrary spatial dependence allowed; pointwise normal bootstrap p-values. No adjustment across browsing different specifications.'))
    for crop in args.crop or ['wheat','maize','rice','soybean','sorghum','cassava']:
        run(crop,args.limit)
        if not args.limit:publish_chunks(crop)


if __name__=='__main__':main()
