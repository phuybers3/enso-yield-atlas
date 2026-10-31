"""Restore historical fits independently of current-outlook/production eligibility.

Reads the frozen fitted database. Reuses the approved estimator and saved current
fits; supplements missing historical fits without changing predictions or totals.
Fit checkpoints make interruption safe. Run from any working directory.
"""
from pathlib import Path
import argparse, datetime as dt, json, sys, hashlib, os
import numpy as np
import pandas as pd

ROOT=next(p for p in Path(__file__).resolve().parents if (p/'project.toml').exists())
sys.path.insert(0,str(ROOT/'analysis/crops'))
from lib.io import Database, sha256
from lib import responses
from lib.baseline import fitting_sample
from lib.hierarchy import fit_standard, year_draws
from lib.validation_policy import DISPLAY_POOLING_FRACTION
from lib.effect_uncertainty import METHOD, transform_fields, interval_columns
from lib.shrinkage_uncertainty import draw_shrinkage_error


def clean(x):
    if isinstance(x,dict):return {str(k):clean(v) for k,v in x.items()}
    if isinstance(x,(list,tuple)):return [clean(v) for v in x]
    if isinstance(x,np.generic):x=x.item()
    if isinstance(x,float) and not np.isfinite(x):return None
    return x


def write(path,obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_suffix(path.suffix+'.tmp')
    temp.write_text(json.dumps(clean(obj),ensure_ascii=False,allow_nan=False,separators=(',',':')))
    temp.replace(path)


def complete_environmental_sample(db, leaves):
    """Use complete environmental years even after the crop census ends.

    The matching index uses the database's exact calendar windows. NDVI retains
    the existing VHP product, 2001 start and 80% coverage criterion.
    """
    keys=['series_id','harvest_year']
    w=pd.read_sql("SELECT series_id,harvest_year,product,tavg_mean,precip FROM weather_season WHERE frac_elapsed>=0.999 AND harvest_year BETWEEN 1981 AND 2025 AND product IN ('best','chirps')",db.con)
    w=w[w.series_id.isin(leaves.series_id)]
    t=w[w['product'].eq('best')][keys+['tavg_mean']]
    rain=w[w['product'].eq('chirps')][keys+['precip']]
    m=t.merge(rain,on=keys,how='outer',validate='one_to_one')
    from lib import ndvi
    if ndvi.available(db):m=m.merge(ndvi.season_sample(db,leaves),on=keys,how='outer',validate='one_to_one')
    else:m['ndvi_mean']=np.nan
    idx=pd.read_sql('SELECT series_id,harvest_year,n34rel_season,n34_season FROM enso_windows WHERE harvest_year BETWEEN 1981 AND 2025',db.con)
    m=m.merge(idx,on=keys,validate='one_to_one').merge(leaves.drop_duplicates('series_id')[responses.LEAF_META],on='series_id',validate='many_to_one')
    print(f'Independent complete environmental sample: {len(m):,} series-years',flush=True)
    return m[m.harvest_year<db.index_last_month[0]].reset_index(drop=True)


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--release',required=True);ap.add_argument('--db',type=Path,required=True)
    ap.add_argument('--work',type=Path,required=True);ap.add_argument('--replicates',type=int,default=400)
    ap.add_argument('--reuse-yield-from',type=Path)
    a=ap.parse_args();a.work.mkdir(parents=True,exist_ok=True)
    site=Path(__file__).resolve().parents[1]/'site';base=site/'data'/a.release
    catalogs={p.stem:json.loads(p.read_text()) for p in (base/'units').glob('*.json')}
    missing={int(s['id']) for d in catalogs.values() for u in d['units'].values() for s in u['series'] if not s.get('responses') and u['level']!='national'}
    db=Database(str(a.db)); fingerprint=dict(database_sha256=sha256(a.db),script_sha256=sha256(__file__),replicates=a.replicates,pooling_fraction=DISPLAY_POOLING_FRACTION)
    if a.reuse_yield_from:
        previous=json.loads((a.reuse_yield_from/'inputs.json').read_text())
        for k in ['database_sha256','replicates','pooling_fraction']:
            if previous[k]!=fingerprint[k]:raise RuntimeError('Yield checkpoint mismatch: '+k)
        fingerprint['reused_yield_inputs']=previous
        # Only environmental-year selection changed; yield fitting code is unchanged.
        for name in ['ly_rel.parquet','ly_rel_points.parquet','ly_std.parquet','ly_std_points.parquet']:
            dest=a.work/name
            if not dest.exists():os.link(a.reuse_yield_from/name,dest)
    old=a.work/'inputs.json'
    if old.exists() and json.loads(old.read_text())!=fingerprint:raise RuntimeError('Checkpoint inputs changed; use a fresh work directory')
    write(old,fingerprint)
    print('Reading historical sample',flush=True)
    sub,nat=responses.sample(db)
    leaves=responses.leaf_sample(sub,nat,historical=True)
    leaves=fitting_sample(leaves[(leaves.harvest_year<db.index_last_month[0]) & leaves.staple.eq(1)])
    wanted=missing.intersection(leaves.series_id)
    print(f'{len(missing)} exported series lack responses; {len(wanted)} pass historical source/length checks',flush=True)
    # Keep all preferred historical leaves in the hierarchy. Only absent exported
    # fits are supplemented, preserving the existing release's point estimates.
    weather=complete_environmental_sample(db,leaves)
    outputs=[];points=[]
    for variable,index in [('ly','rel'),('ly','std'),('tavg_mean','rel'),('precip','rel'),('ndvi_mean','rel')]:
        target=a.work/f'{variable}_{index}.parquet';pt=a.work/f'{variable}_{index}_points.parquet'
        if target.exists() and pt.exists():
            outputs.append(pd.read_parquet(target));points.append(pd.read_parquet(pt));continue
        source=leaves if variable=='ly' else weather
        col=responses.xcol(index,'season')
        d=fitting_sample(source.dropna(subset=[variable,col]))
        if d.empty:continue
        print(f'Fit {variable}/{index}: {d.series_id.nunique()} series, {len(d)} rows',flush=True)
        f=fit_standard(d,col,index=index,variable=variable,window='season',pooling_fraction=DISPLAY_POOLING_FRACTION if variable=='ly' else 1.)
        raw=[];errors=[];rng=np.random.default_rng(20261030)
        for j,draw in enumerate(year_draws(np.arange(f.distinct_years.min(),f.distinct_years.max()+1),a.replicates,20261030)):
            rep=f.replicate(draw);raw.append(rep.unit.slope_eb.to_numpy());errors.append(draw_shrinkage_error(rep,rng))
            if (j+1)%100==0:print(f'{variable}/{index} uncertainty {j+1}/{a.replicates}',flush=True)
        field=transform_fields(np.array(raw),np.array(errors),f,1,seed=20261031)
        for k,v in interval_columns(field).items():f.unit[k]=v
        f.spec['interval_method']=METHOD
        rows,_=responses.leaf_tables({'fit':f})
        years=d.groupby('series_id').harvest_year.agg(['min','max'])
        rows['year_first']=rows.series_id.map(years['min']);rows['year_last']=rows.series_id.map(years['max'])
        rows=rows[rows.series_id.isin(wanted)].copy()
        # A missing local slope must not be presented as an observed local fit.
        fields=['slope_eb','slope_lo','slope_hi','slope_lo80','slope_hi80','pct_eb','lo_eb','hi_eb']
        rows.loc[rows.slope_own.isna(),fields]=np.nan
        rows['historical_only']=True
        coords=responses.relationship_points({'fit':f});coords=coords[coords.series_id.isin(wanted)]
        rows.to_parquet(target,index=False);coords.to_parquet(pt,index=False)
        outputs.append(rows);points.append(coords)
    fits=pd.concat(outputs,ignore_index=True);coords=pd.concat(points,ignore_index=True)
    fits_by={str(s):g.to_dict('records') for s,g in fits.groupby('series_id')}
    pts_by={str(s):g[['variable','index','harvest_year','exposure','anomaly']].values.tolist() for s,g in coords.groupby('series_id')}
    registry_path=site/'data/historical-responses/index.json'
    registry=json.loads(registry_path.read_text());registry.setdefault('releases',{}).setdefault(a.release,{})
    world={f:{'units':{},'national':{}} for f in ['maize','rice','wheat','soybean','sorghum','cassava']}
    counts=[]
    for iso,d in catalogs.items():
        extras={}
        for key,u in d['units'].items():
            for s in u['series']:
                sid=s['id'];fam=s['crop_family']
                if int(sid) in missing:
                    rr=fits_by.get(sid,[])
                    extras.setdefault(fam,{})[sid]=dict(responses=rr,relationship_history=pts_by.get(sid,[]) if s['display_points'] else [],validation=[],current_status='historical_only',historical_reason=None if any(r['variable']=='ly' and np.isfinite(r['pct_eb']) for r in rr) else 'Fewer than ten eligible years, invalid exposure, or source/QC exclusion; see coverage audit.')
                current=[dict(zip(d['columns']['responses'],r)) for r in s.get('responses',[])]
                merged={(r['variable'],r['index']):r for r in fits_by.get(sid,[])}
                merged.update({(r['variable'],r['index']):r for r in current})
                rs={idx:r for (var,idx),r in merged.items() if var=='ly' and pd.notna(r.get('pct_eb'))}
                if not rs:continue
                dest=world[fam]['national' if u['level']=='national' else 'units']
                rank=(s['tier'],-s['n'],-s['last'],sid)
                if key in dest and tuple(dest[key]['rank'])<=rank:continue
                dest[key]=dict(first=s['first'],last=s['last'],series_id=sid,crop_code=s['crop_code'],season=s['season'],rank=rank,responses={idx:{k:r.get(k) for k in ['pct_eb','lo_eb','hi_eb','year_first','year_last','n_years']} for idx,r in rs.items()})
        for fam,series in extras.items():
            filename=f'{a.release}/{iso}-{fam}.json'
            write(site/'data/historical-responses'/filename,dict(release=a.release,country=iso,crop=fam,series=series,scope='Historical ENSO relationships. Current forecasts and production totals are unchanged.',model=dict(version='hier-eb-v3 (2026-10-19)',pooling_fraction=DISPLAY_POOLING_FRACTION,uncertainty=METHOD)))
            registry['releases'][a.release][f'{iso}-{fam}']=filename
            counts.append(dict(country=iso,crop=fam,records=len(series),fitted=sum(any(r['variable']=='ly' and r['index']=='rel' and pd.notna(r['pct_eb']) for r in v['responses']) for v in series.values())))
    for fam,obj in world.items():
        for dest in [obj['units'],obj['national']]:
            for r in dest.values():r.pop('rank')
        write(site/'data/historical-responses'/a.release/f'world-{fam}.json',dict(release=a.release,crop=fam,**obj))
    registry.setdefault('world',{})[a.release]={f:f'{a.release}/world-{f}.json' for f in world}
    write(registry_path,registry)
    write(a.work/'coverage_after.json',counts)
    write(site/'data/historical-responses'/a.release/'audit.json',dict(release=a.release,built_utc=dt.datetime.now(dt.timezone.utc).isoformat(),**fingerprint,counts=counts,scope='Historical regression restoration only; no new yield forecasts or new skill claims. The forecast tier and weights remain unchanged.',limitations=['Historical records ending before 2010 do not establish current applicability.','Supplemental fits have no same-build withheld-year skill attached yet.','Intervals use the existing candidate approximation; exact coverage is not established.']))
    print('COMPLETE',sum(r['fitted'] for r in counts),'restored relative-index fits',flush=True)

if __name__=='__main__':main()
