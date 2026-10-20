"""Check new display coordinates, aggregate curves and interval identities.

The broad numerics test verifies legacy export fields. This check covers the
reconciled release's exact fitted coordinates and nonlinear state curves.
"""

# Locate the checkout independently of the working directory or machine.
from pathlib import Path as _ProjectPath
import sys as _project_sys
_ENSO_ROOT = next(p for p in _ProjectPath(__file__).resolve().parents if (p / "project.toml").is_file())
if str(_ENSO_ROOT) not in _project_sys.path:
    _project_sys.path.append(str(_ENSO_ROOT))
from enso_project import path as _project_path, resolve_path as _resolve_path
from enso_project import load_record as _load_record, loads_record as _loads_record

from pathlib import Path
import argparse,hashlib,json
import numpy as np
import pandas as pd

ATLAS=Path(__file__).resolve().parents[1]
ROOT=next((p for p in ATLAS.parents if (p / "project.toml").is_file()), ATLAS.parent)


def run(release,output):
    site=ATLAS/'site/data'/release;res=ROOT/'analysis/releases/crops'/release
    cat=_loads_record((site/'catalog.json').read_text())
    assert cat['model']['replicates']['method']=='centered_year_blocks_plus_shrinkage_student_v1'
    points=pd.read_parquet(res/'enso_relationship_points.parquet')
    expected={str(k):g for k,g in points.groupby('series_id')}
    leaf=pd.read_parquet(res/'response_leaf.parquet')
    leaf_by={index:g.set_index('series_id') for index,g in leaf[leaf.variable.eq('ly')].groupby('index')}
    leaf=leaf_by['rel']
    weights=pd.read_parquet(res/'weights.parquet');covered=weights[weights.covered].copy()
    by_region={(str(k[0]),k[1],k[2]):g for k,g in covered.groupby(['region_key','crop_code','season'])}
    stats=dict(unit_records=0,relationship_points=0,state_curves=0,permissions_checked=0,intervals_checked=0,exact_outlook_intervals=0,world_outlook_intervals=0)
    predictions=pd.read_parquet(res/'prediction_series.parquet')
    predictions=predictions.set_index(['series_id','method','scenario','harvest_year'])
    def check_outlook(sid,p):
        source=predictions.loc[(int(sid),p['method'],p['scenario'],int(p['harvest_year']))]
        for c in ['pct','lo','hi']:
            assert p[c]==source[c] or (p[c] is None and pd.isna(source[c])),(sid,c,p[c],source[c])
    state_mismatches=[]
    precision=cat['precision'];point_dec=precision['records'];xdec=precision['records.enso']
    for path in sorted((site/'records').glob('*/*.json')):
        shard=_loads_record(path.read_text())
        for sid,record in shard.get('series',{}).items():
            if record.get('level')=='state':
                components=np.asarray(record.get('yield_response_components',[]),float).reshape(-1,2)
                ids=record.get('yield_response_series',[])
                assert len(ids)==len(components)
                if len(components):
                    rk=shard.get('region_key') or shard.get('unit_key')
                    if rk is None:
                        # State shard filenames encode the same region key.
                        candidates=[k for k in by_region if k[0].replace(':','_')==path.stem and k[1:]==(record['crop_code'],record['season'])]
                        assert len(candidates)==1,(path,sid,candidates)
                        rk=candidates[0][0]
                    g=by_region.get((str(rk),record['crop_code'],record['season']))
                    assert g is not None,(path,sid,rk)
                    if set(map(int,ids))!=set(g.series_id):
                        state_mismatches.append(dict(path=str(path),series=sid,missing=sorted(set(g.series_id)-set(map(int,ids))),extra=sorted(set(map(int,ids))-set(g.series_id))))
                        continue
                    order=pd.Index(g.series_id).get_indexer(list(map(int,ids)))
                    np.testing.assert_allclose(components[:,0],leaf.loc[list(map(int,ids))].slope_eb,rtol=1e-12)
                    np.testing.assert_allclose(components[:,1],g.iloc[order].baseline_production_t,rtol=1e-12)
                    for x in [-2.,0.,2.]:
                        calculated=np.average(np.expm1(components[:,0]*x),weights=components[:,1])
                        reference=np.sum(g.baseline_production_t.to_numpy()*np.expm1(leaf.loc[g.series_id].slope_eb.to_numpy()*x))/g.baseline_production_t.sum()
                        np.testing.assert_allclose(calculated,reference,rtol=1e-12,atol=1e-12)
                    stats['state_curves']+=1
                    for response_index in ['rel','std']:
                        own=leaf_by[response_index]
                        expected_ids=[sid for sid in g.series_id if sid in own.index and pd.notna(own.loc[sid,'slope_eb'])]
                        ix_ids=list(map(int,record['yield_response_series_by_index'][response_index]))
                        ix=np.asarray(record['yield_response_components_by_index'][response_index],float).reshape(-1,2)
                        assert set(ix_ids)==set(expected_ids),(path,response_index,'component support')
                        order=pd.Index(g.series_id).get_indexer(ix_ids)
                        np.testing.assert_allclose(ix[:,0],own.loc[ix_ids].slope_eb,rtol=1e-12)
                        np.testing.assert_allclose(ix[:,1],g.iloc[order].baseline_production_t,rtol=1e-12)
                        pool_only={sid for sid in expected_ids if pd.isna(own.loc[sid,'slope_own'])}
                        assert set(map(int,record.get('yield_response_pool_only_series_by_index',{}).get(response_index,[])))==pool_only
                continue
            if not sid.isdigit():continue
            stats['unit_records']+=1
            got=pd.DataFrame(record.get('relationship_history',[]),columns=['variable','index','harvest_year','exposure','anomaly'])
            want=expected.get(sid,pd.DataFrame(columns=points.columns)).copy()
            if not record['display_points']:
                assert not got.variable.eq('ly').any(),(path,sid,'restricted derived yield points')
                want=want[want.variable.ne('ly')]
            stats['permissions_checked']+=1
            cols=['variable','index','harvest_year']
            got=got.sort_values(cols).reset_index(drop=True);want=want.sort_values(cols).reset_index(drop=True)
            assert len(got)==len(want),(path,sid,len(got),len(want))
            if len(got):
                assert got[cols].values.tolist()==want[cols].values.tolist()
                # Compare with the source, avoiding a second rounding algorithm's
                # half-unit tie decision (NumPy and Python round can differ).
                np.testing.assert_allclose(got.exposure,want.exposure,atol=10**(-xdec)*.51,rtol=0,err_msg=f'{path}:{sid}:exposure')
                np.testing.assert_allclose(got.anomaly,want.anomaly,atol=10**(-point_dec)*.51,rtol=0,err_msg=f'{path}:{sid}:anomaly')
            stats['relationship_points']+=len(got)
    for path in sorted((site/'units').glob('*.json')):
        d=_loads_record(path.read_text());cols=d['columns']['responses']
        for u in d['units'].values():
            for s in u['series']:
                for values in s['predictions']:
                    p=dict(zip(d['columns']['predictions'],values));check_outlook(s['id'],p)
                    stats['exact_outlook_intervals']+=1
                for values in s['responses']:
                    r=dict(zip(cols,values))
                    if r['slope_lo'] is None:continue
                    assert r['slope_lo']<=r['slope_lo80']<=r['slope_hi80']<=r['slope_hi']
                    np.testing.assert_allclose([r['lo_eb'],r['hi_eb']],100*np.expm1([r['slope_lo'],r['slope_hi']]),rtol=1e-12,atol=1e-12)
                    stats['intervals_checked']+=1
    world=_loads_record((site/'world_units.json').read_text())
    for crop,units in world['units'].items():
        for key,values in units.items():
            p=dict(zip(world['columns'],values));p.update(method='index_outlook',scenario='medium')
            check_outlook(p['series_id'],p);stats['world_outlook_intervals']+=1
    result=dict(release=release,passed=not state_mismatches,counts=stats,state_membership_mismatches=state_mismatches,
        script_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        site_manifest_sha256=hashlib.sha256((site/'manifest.json').read_bytes()).hexdigest())
    output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(result,indent=2)+'\n')
    assert not state_mismatches,f'{len(state_mismatches)} state curves use different support from the release aggregate; see {output}'
    print(json.dumps(result,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--release',required=True);p.add_argument('--output',required=True,type=Path)
    a=p.parse_args();run(a.release,a.output)
