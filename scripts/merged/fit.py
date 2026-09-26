"""Shared-index crop response fits with calendar-block uncertainty and validation.

Outputs use a common observed sample across the registered indices for each
series/window/period. Native observations remain in the export. The kernel
caches design-dependent projection matrices; no yields or coefficients are
shared between units. Only calendar resampling draws are shared.
"""
import argparse
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path
import time
import numpy as np
from dataset import ROOT, OUT, PERIODS, PRODUCTS, clean, read, write
from indices import WINDOWS, mean
MODELS=('linear','quadratic','hinge')
NBOOT=400
SEED=20260926


def design(year,x,model):
    cols=[np.ones(len(year)),(np.array(year)-2000)/10]
    if model!='trend':cols.append(x)
    if model=='quadratic':cols.append(np.array(x)**2)
    if model=='hinge':cols.append(np.maximum(x,0))
    return np.column_stack(cols)


@lru_cache(maxsize=16)
def draws(lo,hi):
    blocks=np.arange((lo-1980)//3,(hi-1980)//3+1)
    rng=np.random.default_rng(SEED)
    picks=rng.integers(0,len(blocks),(NBOOT,len(blocks)))
    counts=np.array([np.bincount(p,minlength=len(blocks)) for p in picks])
    return blocks,counts


@lru_cache(maxsize=256)
def kernel(years,xs,lo,hi,fold_allowed):
    year=np.array(years);x=np.array(xs);blocks,counts=draws(lo,hi)
    weights=counts[:,np.searchsorted(blocks,(year-1980)//3)]
    D={m:design(year,x,m) for m in ('trend',)+MODELS}
    result={}
    for model,X in D.items():
        if np.linalg.matrix_rank(X)<X.shape[1]:continue
        if model=='trend':
            # Trend-only validation does not use bootstrap coefficients.
            B=None
        else:
            gram=np.einsum('bi,ij,ik->bjk',weights,X,X,optimize=True)
            good=(np.linalg.matrix_rank(gram)==X.shape[1])&(weights.sum(axis=1)>=12)
            inv=np.linalg.inv(gram[good])[:,2:,:]
            B=np.einsum('bpj,jn,bn->bpn',inv,X.T,weights[good],optimize=True)
        result[model]={'point':np.linalg.pinv(X),'boot':B,'cv':[]}
    for offset in (0,2):
        bs=(year-(1980+offset))//5
        allowed=set(fold_allowed[offset//2]);tests=[];operators={m:[] for m in D}
        for b in np.unique(bs):
            if int(b) not in allowed:continue
            edge=1980+offset+5*b;test=bs==b;train=(year<edge-1)|(year>edge+5)
            tests.extend(np.flatnonzero(test))
            for m,X in D.items():
                P=np.zeros((test.sum(),len(year)));P[:,train]=X[test]@np.linalg.pinv(X[train]);P[np.arange(test.sum()),np.flatnonzero(test)]-=1
                operators[m].append(P)
        for m in result:
            result[m]['cv'].append(np.concatenate(operators[m]) if len(operators[m])>=3 and len(tests)>=15 else None)
    return result


def allowed_folds(year,x_all):
    return _allowed_folds(tuple(year.tolist()),tuple(tuple(x.tolist()) for x in x_all))

@lru_cache(maxsize=512)
def _allowed_folds(year,x_all):
    year=np.array(year);x_all=np.array(x_all)
    # Linear columns are contained in both nonlinear designs. Construct once,
    # then test their training subsets rather than rebuilding every fold.
    designs=[design(year,x,m) for x in x_all for m in ('quadratic','hinge')]
    result=[]
    for offset in (0,2):
        valid=[]
        for b in np.unique((year-(1980+offset))//5):
            edge=1980+offset+5*b;train=(year<edge-1)|(year>edge+5)
            if train.sum()<12:continue
            if any((x[train]>0).sum()<3 or (x[train]<0).sum()<3 for x in x_all):continue
            if any(np.linalg.matrix_rank(X[train])<X.shape[1] for X in designs):continue
            valid.append(int(b))
        result.append(tuple(valid))
    return tuple(result)


def fit(year,y,x,lo,hi,folds):
    n=len(year);out=dict(n=n)
    if n<20:return dict(out,reason=f'Needs 20 paired positive-yield years; {n} available')
    out.update(first=int(year.min()),last=int(year.max()),years=year.tolist(),warm=int((x>0).sum()),cold=int((x<0).sum()),x_min=float(x.min()),x_max=float(x.max()),x_mean=float(x.mean()),x_sd=float(x.std(ddof=1)))
    if min(out['warm'],out['cold'])<5:return dict(out,reason='Needs five positive and five negative exposures')
    K=kernel(tuple(year.tolist()),tuple(x.tolist()),lo,hi,folds);logy=np.log(y);models={}
    baseline=[None if P is None else float(np.mean((P@logy)**2)) for P in K['trend']['cv']]
    for m in MODELS:
        if m not in K:models[m]={'reason':'Rank-deficient design'};continue
        k=K[m];coef=k['point']@logy;reps=np.einsum('bpn,n->bp',k['boot'],logy,optimize=True)
        cov=np.cov(reps,rowvar=False) if len(reps)>=.9*NBOOT else None
        scores=[float(1-np.mean((P@logy)**2)/b) if P is not None and b is not None and b>0 else None for P,b in zip(k['cv'],baseline)]
        models[m]=dict(coef=coef.tolist(),cov=np.atleast_2d(cov).tolist() if cov is not None else None,boot_n=len(reps),cv=scores)
    out['models']=models
    # A quadratic time trend is a sensitivity check, not a selected replacement.
    T=(year-2000)/10
    X=np.column_stack([np.ones(n),T,T*T,x]);b=np.linalg.lstsq(X,logy,rcond=None)[0]
    out['quadratic_time_beta']=float(b[-1]) if np.linalg.matrix_rank(X)==4 else None
    return out


def trends(obs,limits):
    a=[r for r in obs if limits is None or limits[0]<=r[0]<=limits[1]]
    if len(a)<20:return {'reason':f'Needs 20 observed years; {len(a)} available','n':len(a)}
    year=np.array([r[0] for r in a]);y=np.array([r[1] for r in a]);X=design(year,year*0,'trend')
    lo,hi=limits or [int(year.min()),int(year.max())];blocks,counts=draws(lo,hi);W=counts[:,np.searchsorted(blocks,(year-1980)//3)]
    gram=np.einsum('bi,ij,ik->bjk',W,X,X,optimize=True);good=(np.linalg.matrix_rank(gram)==2)&(W.sum(axis=1)>=12)
    rhs=np.einsum('bi,ij,i->bj',W,X,y,optimize=True);b=np.linalg.solve(gram[good],rhs[good,:,None])[:,:,0]
    slope=float(np.linalg.lstsq(X,y,rcond=None)[0][1]);se=float(b[:,1].std(ddof=1)) if len(b)>=360 else None
    return dict(n=len(a),first=int(year.min()),last=int(year.max()),value=slope,se=se,lo=slope-1.96*se if se is not None else None,hi=slope+1.96*se if se is not None else None,boot_n=len(b))


def run_crop(crop,indices,windows,limit=0,skip_trends=False):
    start=time.monotonic();ix=read(OUT/'indices.json')
    @lru_cache(maxsize=None)
    def exposure(year,start,end,k):
        return mean(year,{'start_relative_month':start,'end_relative_month':end},ix[k])
    def expose(year,w,k):
        return exposure(year,w['start_relative_month'],w['end_relative_month'],k) if w else None
    data=[]
    for path in sorted((OUT/'observations').glob(f'*-{crop}.json.gz')):data.extend(read(path)['series'])
    if limit:data=data[:limit]
    if not skip_trends and (limit or not (OUT/'trends'/f'{crop}.json.gz').exists()):
        trend={r['sid']:{p:trends(r['observations'],v) for p,v in PERIODS.items()} for r in data}
        if not limit:write(OUT/'trends'/f'{crop}.json.gz',trend)
    stats={}
    for win in windows:
        dest={k:OUT/'fits'/k/win/f'{crop}.json.gz' for k in indices}
        if not limit and all(p.exists() for p in dest.values()):continue
        records={k:{} for k in indices};count=Counter()
        for j,r in enumerate(data):
            w=r['windows'].get(win);byindex={k:{} for k in indices}
            # Same years across indices: missing values in any index remove
            # that year in all index comparisons, before sign-support checks.
            obs=r['observations'];exposures=[[expose(a[0],w,k) for a in obs] for k in ix]
            allx=np.array(exposures,dtype=float)
            years=np.array([a[0] for a in obs],dtype=int);ys=np.array([a[1] for a in obs])
            for period,limits in PERIODS.items():
                mask=(ys>0)&np.isfinite(allx).all(axis=0)
                if limits:mask&=(years>=limits[0])&(years<=limits[1])
                year,y,xall=years[mask],ys[mask],allx[:,mask]
                if not w:
                    for k in indices:byindex[k][period]={'reason':'No assigned calendar for this window','n':0}
                    continue
                lo,hi=limits or [1854,2025]
                # Shared draws on the full requested period; for available
                # records use 1979–2025, the common index coverage envelope.
                if limits is None:lo,hi=1979,2025
                folds=allowed_folds(year,xall) if len(year)>=20 else ((),())
                for k in indices:
                    x=xall[list(ix).index(k)]
                    f=fit(year,y,x,lo,hi,folds);f['sample']='Common available years across '+', '.join(i['label'] for i in ix.values())
                    if 'models' in f:
                        count[k]+=1
                        # Restore statistical-outlier-only records for a point
                        # sensitivity fit using the same index/window/period.
                        restored=r['outlier_observations']
                        rr=[a for a in restored if a[1]>0 and (limits is None or limits[0]<=a[0]<=limits[1]) and all(expose(a[0],w,k) is not None for k in ix)]
                        if rr:
                            yy=np.r_[year,[a[0] for a in rr]];yv=np.r_[y,[a[1] for a in rr]];xx=np.r_[x,[expose(a[0],w,k) for a in rr]]
                            B=np.linalg.lstsq(design(yy,xx,'linear'),np.log(yv),rcond=None)[0]
                            f['outlier_sensitivity']={'restored':len(rr),'beta':float(B[2]),'delta_beta':float(B[2]-f['models'].get('linear',{}).get('coef',[0,0,0])[2])}
                    byindex[k][period]=f
            for k in indices:records[k][r['sid']]=byindex[k]
            if j%2000==0:print(f'{crop} {win} {j}/{len(data)} {time.monotonic()-start:.1f}s',flush=True)
        for k in indices:
            if not limit:write(dest[k],records[k])
        stats[win]=dict(count)
        print(f'{crop} {win} finished {dict(count)} {time.monotonic()-start:.1f}s',flush=True)
    report={'crop':crop,'series':len(data),'fits':stats,'seconds':time.monotonic()-start,'limit':limit,'cache':str(kernel.cache_info())}
    if not limit and stats:write(OUT/'analysis-audit'/f'{crop}-{"-".join(windows)}.json',report)
    print(report,flush=True);return report


def main():
    p=argparse.ArgumentParser();p.add_argument('--crop',choices=list(PRODUCTS),action='append');p.add_argument('--index',choices=list(read(OUT/'indices.json')),action='append');p.add_argument('--window',choices=list(WINDOWS),action='append');p.add_argument('--limit',type=int,default=0);p.add_argument('--workers',type=int,default=2);a=p.parse_args()
    write(OUT/'methods.json',dict(release=OUT.name,models=list(MODELS),periods=PERIODS,bootstrap=dict(replicates=NBOOT,seed=SEED,block_years=3,anchor=1980,min_usable=360),
        uncertainty='95% normal intervals from shared pairs-bootstrap coefficient covariance, in log response then transformed to percent. Pointwise; no multiplicity correction or prediction uncertainty.',
        validation='Two five-year holdout layouts anchored 1980 and 1982; one-year training embargo; folds shared across registered indices; at least three folds and 15 test years.',
        sample='Positive yield, QC eligible, and complete exposures for all registered indices. No splicing of tiers. Minimum 20 years and five exposures on each side of zero.',
        long_record='Available-record comparisons start no earlier than MEI coverage (1979). All original observations remain visible.',
        trend='Observed yield on time, t/ha per decade; separate from the ENSO-adjusted log-yield trend. Same three-year block bootstrap.',
        outliers='Default excludes upstream errors; point sensitivity restores only statistical-outlier errors. Other QC exclusions remain.',index_comparison='Identical paired years and eligible validation folds per series/window/period across registered indices. Native coefficients and SD-scaled scenarios use the same fit.'))
    crops=a.crop or list(PRODUCTS);indices=a.index or list(read(OUT/'indices.json'));windows=a.window or list(WINDOWS)
    if a.limit or a.workers==1:
        for crop in crops:run_crop(crop,indices,windows,a.limit)
    else:
        with ProcessPoolExecutor(max_workers=a.workers) as pool:
            futures=[pool.submit(run_crop,c,indices,[w],0,w!=windows[0]) for c in crops for w in windows]
            for f in futures:f.result()


if __name__=='__main__':main()
