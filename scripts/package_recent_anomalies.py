"""Keep monthly page downloads small by packaging at most 200 unit/crop keys per shard."""
from pathlib import Path
import argparse
import hashlib
import json

def write(p,value):
    p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(value,ensure_ascii=False,allow_nan=False,separators=(',',':'))+'\n')

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    ap=argparse.ArgumentParser();ap.add_argument('source',type=Path);ap.add_argument('out',type=Path);a=ap.parse_args()
    assert not a.out.exists(),'Package into a fresh directory'
    m=json.loads((a.source/'manifest.json').read_text());audit=json.loads((a.source/'audit.json').read_text());assert audit['status']=='pass'
    countries={};files={};total=0
    for iso,entry in sorted(m['files'].items()):
        data=json.loads((a.source/entry['file']).read_text());keys=sorted(data['records']);mapping={}
        for i in range(0,len(keys),200):
            name=f'{iso}/{i//200:03d}.json';group=keys[i:i+200]
            write(a.out/name,dict(records={k:data['records'][k] for k in group}))
            files[name]=dict(sha256=sha(a.out/name),bytes=(a.out/name).stat().st_size)
            mapping.update({k:name for k in group});total+=len(group)
        index={k:v for k,v in data.items() if k!='records'};index['record_files']=mapping
        name=iso+'/index.json';write(a.out/name,index)
        countries[iso]=name;files[name]=dict(sha256=sha(a.out/name),bytes=(a.out/name).stat().st_size)
    assert total==audit['counts']['keys']
    write(a.out/'manifest.json',dict(release=m['release'],kind=m['kind'],reference=m['reference'],limitations=m['limitations'],products=m['products'],sources=m['sources'],builder_sha256=sha(Path(__file__)),
        source_manifest_sha256=sha(a.source/'manifest.json'),source_audit=audit,files=files,countries=countries,keys=total))
    print(f'{total} unit/crop keys in {len(countries)} countries; largest download {max(f["bytes"] for f in files.values()):,} bytes')

if __name__=='__main__':main()
