"""Verify package identities, all monthly values, and the absence of duplicate keys."""
from pathlib import Path
from collections import Counter
import argparse,hashlib,json

p=argparse.ArgumentParser();p.add_argument('--release',required=True);a=p.parse_args()
root=Path(__file__).parents[1]/'site/data/recent-anomalies'/a.release
m=json.loads((root/'manifest.json').read_text());counts=Counter();seen=set()
for name,info in m['files'].items():
    data=(root/name).read_bytes();assert len(data)==info['bytes'];assert hashlib.sha256(data).hexdigest()==info['sha256']
    assert len(data)<1_000_000
for iso,name in m['countries'].items():
    index=json.loads((root/name).read_text());assert index['release']==a.release
    shards={s:json.loads((root/s).read_text())['records'] for s in set(index['record_files'].values())}
    for key,file in index['record_files'].items():
        assert key not in seen and key.startswith(iso);seen.add(key);counts['keys']+=1
        rec=shards[file][key]
        for prod,rows in rec.items():
            assert [r[0] for r in rows]==index['months'];good=0
            for month,through,obs,ref,anom,cov,n in rows:
                assert 0<=cov<=1.00001
                if through:assert through<=index['products'][prod]['cutoff'] and through.startswith(month)
                if anom is not None:
                    assert obs is not None and ref is not None and n>=10
                    assert abs(obs-ref-anom)<.00003
                    assert cov>=index['products'][prod]['coverage']-.00001
                    good+=1
            counts[prod+'_keys']+=bool(good);counts[prod+'_points']+=good
    assert set(index['record_files'])=={k for shard in shards.values() for k in shard}
assert dict(counts)==m['source_audit']['counts']
print('PASS monthly package:',dict(counts))
