"""Audit every monthly export cell and freeze the local input fingerprints."""
from pathlib import Path
import argparse
from collections import Counter
import hashlib
import json

ROOT=next(p for p in Path(__file__).resolve().parents if (p/'project.toml').exists())

def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(8<<20),b''):h.update(block)
    return h.hexdigest()

def main():
    ap=argparse.ArgumentParser();ap.add_argument('folder',type=Path);a=ap.parse_args()
    m=json.loads((a.folder/'manifest.json').read_text());counts=Counter()
    for iso,f in m['files'].items():
        p=a.folder/f['file'];assert sha(p)==f['sha256']
        d=json.loads(p.read_text());assert d['iso3']==iso and d['release']==m['release']
        for key,rec in d['records'].items():
            assert key.startswith(iso);counts['keys']+=1
            for product,rows in rec.items():
                assert [r[0] for r in rows]==m['months']
                good=0
                for month,through,obs,ref,anom,cov,n in rows:
                    assert 0<=cov<=1.000001 and n>=0
                    if through:assert through<=d['products'][product]['cutoff']
                    if anom is not None:
                        assert obs is not None and ref is not None and n>=10
                        assert abs(obs-ref-anom)<.00003
                        assert cov>=d['products'][product]['coverage']-.00001
                        assert through.startswith(month)
                        good+=1
                counts[product+'_keys']+=bool(good);counts[product+'_points']+=good
    sources={}
    for k,s in m['sources'].items():
        p=ROOT/s['path'];assert p.stat().st_size==s['size'] and p.stat().st_mtime_ns==s['modified_ns']
        sources[k]=dict(path=s['path'],sha256=sha(p),size=s['size'])
        assert p.stat().st_mtime_ns==s['modified_ns'],'Source changed while hashing'
    audit=dict(status='pass',release=m['release'],counts=dict(counts),countries=len(m['files']),
               input_fingerprints=sources,manifest_sha256=sha(a.folder/'manifest.json'))
    (a.folder/'audit.json').write_text(json.dumps(audit,indent=2)+'\n')
    print(json.dumps(audit['counts']),flush=True)

if __name__=='__main__':main()
