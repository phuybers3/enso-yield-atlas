"""Repair provider classification in an existing export, preserving all data and permissions."""

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

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def run(release,audit):
    base=Path(__file__).resolve().parents[1]/'site/data'/release
    cp=base/'catalog.json';mp=base/'manifest.json'
    catalog=_loads_record(cp.read_text());manifest=_loads_record(mp.read_text())
    changes={k:v['role'] for k,v in catalog['sources'].items()
             if v.get('n_series',0)>0 and 'permission' in v and v['role']!='yield'}
    if not changes:
        print('No source role repair needed');return
    audit.mkdir(parents=True,exist_ok=True)
    for p in [cp,mp]:
        dst=audit/('before_'+p.name)
        assert not dst.exists(),'Repair already audited; inspect before repeating'
        shutil.copy2(p,dst)
    before={p.name:sha(p) for p in [cp,mp]}
    for k in changes:catalog['sources'][k]['role']='yield'
    cp.write_text(json.dumps(catalog,separators=(',',':'),ensure_ascii=False,allow_nan=False)+'\n')
    manifest['permissions']['entries']={k:dict(display_points=v['permission']['display_points'],n_series=v.get('n_series',0))
        for k,v in catalog['sources'].items() if v['role']=='yield'}
    manifest['files']['catalog.json']=dict(sha256=sha(cp),bytes=cp.stat().st_size)
    record=dict(release=release,updated_utc=dt.datetime.now(dt.timezone.utc).isoformat(),
        changes={k:dict(before=v,after='yield') for k,v in changes.items()},
        script=str(Path(__file__).resolve()),script_sha256=sha(Path(__file__)),before=before,
        interpretation='Only provider roles and their manifest index changed; numerical records and permission decisions are unchanged.')
    manifest['post_export_source_role_repair']=record
    mp.write_text(json.dumps(manifest,separators=(',',':'),ensure_ascii=False,allow_nan=False)+'\n')
    record['after']={p.name:sha(p) for p in [cp,mp]}
    (audit/'repair.json').write_text(json.dumps(record,indent=2)+'\n')
    print(json.dumps(record['changes']))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--release',required=True);p.add_argument('--audit-dir',type=Path,required=True)
    a=p.parse_args();run(a.release,a.audit_dir)
