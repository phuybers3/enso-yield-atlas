"""Check exported joint regions against the fitted effects and paired draw registry."""
from pathlib import Path
import argparse
import hashlib
import json
import numpy as np
import pandas as pd

ROOT=next(p for p in Path(__file__).resolve().parents if (p/'project.toml').exists())


def run(release,out):
    result=ROOT/'analysis/releases/crops'/release
    site=ROOT/'atlas/site/data'/release
    source=pd.read_parquet(result/'joint_regions.parquet')
    registry=pd.read_parquet(result/'replicate_registry.parquet')
    assert registry.block.eq(1).all()
    for rep,g in registry[registry.rep.gt(0)].groupby('rep'):
        assert g.years_json.nunique()==1,rep
        assert g.forecast_member.nunique()==1,rep
        years=json.loads(g.years_json.iloc[0])
        assert len(years)==45 and set(years)<=set(range(1981,2026)),rep
    pred=pd.read_parquet(result/'prediction_series.parquet')
    pred=pred[pred.method.eq('index_outlook')&pred.scenario.eq('medium')].set_index('series_id')
    aggregate=pd.read_parquet(result/'aggregate.parquet')
    aggregate=aggregate[aggregate.method.eq('index_outlook')&aggregate.scenario.eq('medium')]
    agmap={(r.level,r.iso3,r.key if r.level=='region' else '',r.crop_code,r.season,r.target_year):r.pct_mean
           for r in aggregate.itertuples(index=False) if r.level in ['region','country']}
    region_keys={(r.iso3,r.key.replace(':','_'),r.crop_code,r.season):r.key
                 for r in source[source.level.eq('region')].itertuples(index=False)}
    by_key={};by_record={}
    for row in source.itertuples(index=False):
        j=json.loads(row.region_json)
        key=(row.level,row.key,row.crop_code,row.season,row.target_year,row.variable)
        assert key not in by_key,key
        by_key[key]=j
        by_record.setdefault(key[:4],[]).append(j)
        assert j['index']=='rel' and j['year_block']==1
        if j['status']!='available':continue
        assert j['n_draws']==4000 and j['n_shape']==2000 and j['n_calibration']==1000 and j['n_check']==1000
        assert 0<=j['q80']<=j['q95']
        xx,xy,yy=j['shape'];cx,cy=j['center'];lo,hi,bot,top=j['bounds95']
        assert xx>=0 and yy>=0 and xy*xy<=xx*yy*(1+1e-10)+1e-30
        np.testing.assert_allclose([lo,hi,bot,top],
            [cx-np.sqrt(j['q95']*xx),cx+np.sqrt(j['q95']*xx),
             cy-np.sqrt(j['q95']*yy),cy+np.sqrt(j['q95']*yy)],rtol=1e-12,atol=1e-12)
        if row.variable!='ly':continue
        if row.level=='unit':
            expected=pred.loc[int(row.key)]
            assert expected.harvest_year==row.target_year
            np.testing.assert_allclose(cy,expected.pct,rtol=1e-10,atol=1e-10)
        else:
            expected=agmap[(row.level,row.iso3,row.key if row.level=='region' else '',row.crop_code,row.season,row.target_year)]
            np.testing.assert_allclose(cy,expected,rtol=1e-10,atol=1e-10)
    exported=0;records=0
    for path in (site/'records').glob('*/*.json'):
        shard=json.loads(path.read_text())
        for sid,rec in shard.get('series',{}).items():
            assert 'joint_regions' in rec,(path,sid)
            records+=1
            if rec.get('level')=='state':
                level='region';key=shard.get('region_key') or shard.get('unit_key')
            else:level='unit';key=sid
            if key is None:
                key=region_keys.get((path.parent.name,path.stem,rec['crop_code'],rec['season']))
            expected=by_record.get((level,str(key),rec['crop_code'],rec['season']),[])
            assert len(rec['joint_regions'])==len(expected),(path,sid,'missing or extra joint regions')
            for j in rec['joint_regions']:
                reference=by_key[(level,str(key),rec['crop_code'],rec['season'],j['target_year'],j['variable'])]
                assert j==reference,(path,sid,j['variable'])
                exported+=1
    report=dict(passed=True,release=release,registry_replicates=int(registry.rep.max()),
        source_regions=len(source),exported_regions=exported,records=records,
        script_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
    Path(out).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--release',required=True);p.add_argument('--out',required=True)
    a=p.parse_args();run(a.release,a.out)
