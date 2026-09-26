"""Validate the additive release and write its summary and content hashes."""
from collections import Counter
import hashlib
import json
from pathlib import Path
import numpy as np
from robustness import ROOT, BASE, OUT, read, write, publish_chunks, MODELS

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    summaries={};total=Counter()
    for crop in ('wheat','maize','rice','soybean','sorghum','cassava'):
        audit=read(OUT/'audit'/f'{crop}.json');assert audit['limit']==0
        publish_chunks(crop)
        data=read(OUT/'robustness'/f'{crop}.json.gz');base=read(BASE/'fits/nino34/season'/f'{crop}.json.gz')
        seen=set();stats={}
        for path in (OUT/'robustness/details'/crop).glob('*.json.gz'):
            for sid,r in read(path).items():
                assert sid not in seen;seen.add(sid)
                assert sid in data and sid in base
                for model,m in r['models'].items():
                    s=stats.setdefault(model,dict(series=0,pooled=0,matched_validation=0,pooling_better_both=0,pooled_positive_both=0,individual_positive_both=0,missing_pooled_cov=0,incomplete_omissions=0,raw_skill=[],pool_skill=[]))
                    s['series']+=1
                    raw=base[sid]['1981-2024']['models'][model]
                    for estimator in ('individual','pooled'):
                        f=m[estimator]
                        if estimator=='pooled' and not f.get('coef'):continue
                        if estimator=='pooled':
                            s['pooled']+=1
                            if f['cov'] is None:s['missing_pooled_cov']+=1
                            if f['cv'] and all(v is not None and v>0 for v in f['cv']):s['pooled_positive_both']+=1
                        candidates=[f.get('trend')]+([f] if estimator=='pooled' else [])
                        for test in candidates:
                            if not test or not test.get('coef'):continue
                            assert np.isfinite(test['coef']).all()
                            if test.get('cov') is not None:
                                a=np.array(test['cov']);assert np.isfinite(a).all();np.testing.assert_allclose(a,a.T,atol=1e-10)
                                assert np.linalg.eigvalsh(a).min()>-1e-10
                            assert 0<=test.get('boot_n',0)<=400
                        events=f.get('events',[])
                        if not events or any(e['fit'] is None for e in events):s['incomplete_omissions']+=1
                        for e in events:
                            assert set(e['removed_years']).issubset(base[sid]['1981-2024']['years'])
                            if e['fit']:assert np.isfinite(e['fit']['coef']).all()
                    c=m.get('comparison')
                    if c and all(v is not None for v in c['individual']+c['pooled']):
                        s['matched_validation']+=1
                        s['pooling_better_both']+=all(b>a for a,b in zip(c['individual'],c['pooled']))
                        s['individual_positive_both']+=all(v>0 for v in c['individual'])
                        s['raw_skill'].append(c['individual']);s['pool_skill'].append(c['pooled'])
                    # Compact map payloads preserve every curve and interval.
                    compact=data[sid]['models'][model]
                    for est in ('individual','pooled'):
                        assert len(compact[est]['events'])==len(m[est].get('events',[]))
                        if m[est].get('coef'):np.testing.assert_equal(compact[est]['coef'],m[est]['coef'])
        assert len(data)==len(seen)==audit['series']
        for s in stats.values():
            s['median_individual_skill']=np.median(s.pop('raw_skill'),axis=0).tolist() if s['matched_validation'] else None
            s['median_pooled_skill']=np.median(s.pop('pool_skill'),axis=0).tolist() if s['matched_validation'] else None
        comparison=read(OUT/'reconciliation'/f'{crop}.json.gz')
        same=[r for r in comparison if (r['atlas_n'],r['atlas_first'],r['atlas_last'])==(r['upstream']['n'],r['upstream']['first'],r['upstream']['last'])]
        reconciliation=dict(matched_source_ids=len(comparison),same_counts_and_endpoints=len(same),note='Same endpoints and counts do not establish identical interior years. Upstream estimates use different eligibility and uncertainty; only its geographic crosswalk enters the refits.')
        summaries[crop]=dict(audit=audit,models=stats,reconciliation=reconciliation)
        total.update(series=audit['series'],groups=audit['groups'],models=audit['counts']['individual_models'],pooled_models=audit['counts']['pooled_models'])
        print(crop,stats['linear'],flush=True)
    write(OUT/'summary.json',dict(release=OUT.name,inherits=BASE.name,totals=dict(total),crops=summaries))
    manifest=dict(release=OUT.name,inherits=dict(release=BASE.name,manifest_sha256=sha(BASE/'manifest.json')),files={},code={})
    for p in sorted(OUT.rglob('*')):
        if p.is_file() and p.name!='manifest.json':manifest['files'][str(p.relative_to(OUT))]=dict(bytes=p.stat().st_size,sha256=sha(p))
    for rel in ['scripts/merged/robustness.py','scripts/merged/finalize_robustness.py','global/merged-model.js','global/merged-app.js','global/merged-response.js','global/merged-reliability.js']:
        manifest['code'][rel]=sha(ROOT/rel)
    write(OUT/'manifest.json',manifest)
    print('PASS',dict(total),len(manifest['files']),'files',flush=True)

if __name__=='__main__':main()
