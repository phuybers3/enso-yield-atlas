"""Carry historical weather observations forward only when their inputs agree."""
from pathlib import Path
import argparse
import hashlib
import json
import sys

ROOT=next(p for p in Path(__file__).resolve().parents if (p/'project.toml').exists())
sys.path.insert(0,str(ROOT))
from enso_project import resolve_path
SITE=ROOT/'atlas/site/data'


def sha(p):
    digest=hashlib.sha256()
    with Path(p).open('rb') as stream:
        for block in iter(lambda:stream.read(8*1024*1024),b''):digest.update(block)
    return digest.hexdigest()
def read(p):return json.loads(p.read_text())
def write(p,d):p.write_text(json.dumps(d,allow_nan=False,separators=(',',':'))+'\n')


def run(source,target):
    old=SITE/source;new=SITE/target
    a=read(old/'catalog.json');b=read(new/'catalog.json')
    assert a['results']['database_sha256']==b['results']['database_sha256'],'crop and calendar database differs'
    src=SITE/'national-weather'/source;out=SITE/'national-weather'/target
    man=read(src/'manifest.json')
    for iso,digest in man['identity']['geometry'].items():
        assert sha(new/'geometry'/f'{iso}.json')==digest,(iso,'geometry changed')
    timestamps={}
    for product,(path,size,mtime) in man['identity']['inputs'].items():
        stat=Path(resolve_path(path)).stat()
        precision=1_000_000_000 if mtime%1_000_000_000==0 else 1
        assert stat.st_size==size and stat.st_mtime_ns//precision==mtime//precision,(product,'weather archive changed')
        timestamps[product]=dict(recorded_ns=mtime,observed_ns=stat.st_mtime_ns,comparison_precision_ns=precision)
    sys.path.insert(0,str(ROOT/'data/pipelines'))
    import cropgrids
    for family,digest in man['identity']['crops'].items():
        assert sha(Path(cropgrids.FILE[family]))==digest,(family,'crop weights changed')
    for name,digest in man['files'].items():assert sha(src/name)==digest,name
    # The source and target releases contain the same crop/calendar database.
    # Check record membership too, so an export-scope change cannot add stale rows.
    for name in man['files']:
        d=read(src/name);units=read(new/'units'/name)
        ids={s['id'] for u in units['units'].values() if u['level']=='national' for s in u['series']}
        assert set(d['series'])<=ids,name
    out.mkdir(parents=True,exist_ok=True)
    for name in man['files']:
        d=read(src/name);d['release']=target;write(out/name,d)
    man['carried_from']=source;man['source_manifest_sha256']=sha(src/'manifest.json')
    man['release']=target;man['identity']['release_manifest']=sha(new/'manifest.json')
    man['reuse_script_sha256']=sha(Path(__file__))
    man['reuse_checks']='Identical crop/calendar database; national membership, geometry and crop-weight hashes verified. Weather archive sizes and timestamps match at the precision recorded in the source manifest.'
    man['reuse_timestamp_checks']=timestamps
    man['files']={name:sha(out/name) for name in man['files']};write(out/'manifest.json',man)
    path=SITE/'national-weather/index.json';index=read(path)
    index['releases'][target]={Path(name).stem:f'{target}/{name}' for name in man['files']};write(path,index)
    print(f"Retained {man['series']} national weather series across {man['countries']} countries.")


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--target',required=True)
    a=p.parse_args();run(a.source,a.target)
