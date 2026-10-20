"""Match state display curves to saved aggregate membership, with explicit pooling flags."""

# Locate the checkout independently of the working directory or machine.
from pathlib import Path as _ProjectPath
import sys as _project_sys
_ENSO_ROOT = next(p for p in _ProjectPath(__file__).resolve().parents if (p / "project.toml").is_file())
if str(_ENSO_ROOT) not in _project_sys.path:
    _project_sys.path.append(str(_ENSO_ROOT))
from enso_project import path as _project_path, resolve_path as _resolve_path
from enso_project import load_record as _load_record, loads_record as _loads_record

from pathlib import Path
import argparse,datetime as dt,hashlib,json,shutil
import pandas as pd

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,d):p.write_text(json.dumps(d,separators=(',',':'),ensure_ascii=False,allow_nan=False)+'\n')

def run(release,audit):
    atlas=Path(__file__).resolve().parents[1];base=atlas/'site/data'/release;result=next(p for p in atlas.parents if (p/"project.toml").is_file())/"analysis/releases/crops"/release
    weights=pd.read_parquet(result/'weights.parquet');weights=weights[weights.covered]
    groups={k:g.set_index('series_id') for k,g in weights.groupby(['region_key','crop_code','season'])}
    leaf=pd.read_parquet(result/'response_leaf.parquet');leaf=leaf[leaf.variable.eq('ly')]
    fits={k:g.set_index('series_id') for k,g in leaf.groupby('index')}
    audit.mkdir(parents=True,exist_ok=True);changed=[];indexes=set();before={}
    def backup(p):
        rel=p.relative_to(base);dest=audit/'before'/rel
        if dest.exists():raise RuntimeError('Existing repair backup; inspect before repeating')
        dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,dest);before[str(rel)]=sha(p)
    for p in sorted((base/'records').glob('*/state_*.json')):
        d=_loads_record(p.read_text());dirty=False
        for key,s in d['series'].items():
            g=groups.get((d['unit_key'],s['crop_code'],s['season']))
            if g is None:continue
            required=set(map(str,g.index));present=set(s.get('yield_response_series',[]))
            if required==present:continue
            assert present<=required,(p,key,'unexpected extra member')
            components={};ids={};pooled={}
            for index,f in fits.items():
                if index not in ['rel','std']:continue
                chosen=[sid for sid in sorted(g.index) if sid in f.index and pd.notna(f.loc[sid,'slope_eb'])]
                ids[index]=list(map(str,chosen))
                components[index]=[[float(f.loc[sid,'slope_eb']),float(g.loc[sid,'baseline_production_t'])] for sid in chosen]
                pooled[index]=[str(sid) for sid in chosen if pd.isna(f.loc[sid,'slope_own'])]
            changed.append(dict(file=str(p.relative_to(base)),series=key,added=sorted(required-present),pool_only=pooled))
            if not dirty:backup(p);dirty=True
            s.update(yield_response_components=components['rel'],yield_response_series=ids['rel'],
                yield_response_components_by_index=components,yield_response_series_by_index=ids,
                yield_response_pool_only_series_by_index=pooled)
        if dirty:write(p,d);indexes.add(p.parent/'index.json')
    for p in indexes:
        backup(p);d=_loads_record(p.read_text())
        for entry in d['states'].values():entry[3]=(p.parent/entry[0]).stat().st_size
        write(p,d)
    if not changed:print('All state curves already match the saved aggregates');return
    mp=base/'manifest.json';backup(mp);manifest=_loads_record(mp.read_text())
    for rel in before:
        if rel=='manifest.json':continue
        p=base/rel;manifest['files'][rel]=dict(sha256=sha(p),bytes=p.stat().st_size)
    record=dict(release=release,updated_utc=dt.datetime.now(dt.timezone.utc).isoformat(),changes=changed,
        script_sha256=sha(Path(__file__)),inputs={str(result/f):sha(result/f) for f in ['weights.parquet','response_leaf.parquet']},before=before,
        scope='Only state response components and explicit pooling flags changed. Saved outlooks, observations, intervals and model fits remain unchanged.')
    manifest['post_export_state_support_repair']=record;write(mp,manifest)
    record['after']={rel:sha(base/rel) for rel in before}
    (audit/'repair.json').write_text(json.dumps(record,indent=2)+'\n')
    print(len(changed),'state crop records reconciled')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--release',required=True);p.add_argument('--audit-dir',type=Path,required=True)
    a=p.parse_args();run(a.release,a.audit_dir)
