"""Validate every prepared fit and freeze the release manifest after completion."""
from collections import Counter
from pathlib import Path
import hashlib, json, platform
import numpy as np
from dataset import OUT, ROOT, PRODUCTS, PERIODS, read, write, sha
from indices import WINDOWS

def main():
    ix=read(OUT/'indices.json');expected=[OUT/'fits'/k/w/(c+'.json.gz') for k in ix for w in WINDOWS for c in PRODUCTS]
    missing=[str(p.relative_to(OUT)) for p in expected if not p.exists()]
    if missing:raise RuntimeError(f'{len(missing)} fit bundles remain: '+', '.join(missing[:8]))
    counts=[];diag=Counter();products={}
    for crop in PRODUCTS:
        rows=read(OUT/(crop+'.json.gz'));ids={r['sid'] for r in rows}
        products[crop]=dict(series=len(rows),observations=sum(r['periods']['available']['n'] for r in rows),countries=len({r['country'] for r in rows if r['periods']['available']['n']}),regional_countries=len({r['country'] for r in rows if r['periods']['available']['n'] and r['level']!='ADM0'}))
        tr=read(OUT/'trends'/(crop+'.json.gz'));assert set(tr)==ids
        for w in WINDOWS:
            fits={k:read(OUT/'fits'/k/w/(crop+'.json.gz')) for k in ix}
            for k,v in fits.items():assert set(v)==ids,(crop,w,k)
            for period in PERIODS:
                for k in ix:
                    summary=Counter()
                    for sid in ids:
                        f=fits[k][sid][period]
                        assert f['n']==fits['nino34'][sid][period]['n']
                        if 'years' in f:assert f['years']==fits['nino34'][sid][period]['years']
                        if 'models' not in f:summary['ineligible']+=1;continue
                        assert f['n']>=20 and f['warm']>=5 and f['cold']>=5
                        assert len(set(f['years']))==f['n']
                        for m,data in f['models'].items():
                            if 'coef' not in data:summary['rank_failure_'+m]+=1;continue
                            assert np.isfinite(data['coef']).all()
                            assert data['boot_n']<=400
                            if data['cov'] is not None:
                                C=np.array(data['cov']);assert np.isfinite(C).all();assert np.allclose(C,C.T)
                                assert np.linalg.eigvalsh(C).min()>-1e-9
                            else:diag['intervals_unavailable']+=1
                            summary['fit_'+m]+=1
                            summary['validated_'+m]+=int(all(v is not None and v>0 for v in data['cv']))
                    counts.append(dict(crop=crop,index=k,window=w,period=period,**summary))
            del fits
        print(f'Validated {crop}: {len(rows)} series, all indices/windows/periods',flush=True)
    methods=read(OUT/'methods.json')
    methods['source_database_sha256']=read(OUT/'catalog.json')['source_database_sha256']
    methods['index_versions']={k:v['version'] for k,v in ix.items()}
    methods['fit_identity']='Release + stable series key + index version + calendar version + exposure window + period + model + QC policy. Native fits also serve exact SD reparameterizations.'
    methods['numerical_verification']='2,030 merged-view exposure comparisons; exact original rows, QC decisions, rice conversions and source flags; independent weighted-lstsq bootstrap covariance and rice scale invariance.'
    write(OUT/'methods.json',methods)
    write(OUT/'release-summary.json',dict(release=OUT.name,products=products,fit_bundles=len(expected),fits=counts,diagnostics=dict(diag)))
    paths=sorted(p for p in OUT.rglob('*') if p.is_file() and p.name!='manifest.json' and not p.name.endswith('.tmp'))
    files={str(p.relative_to(OUT)):dict(sha256=sha(p),bytes=p.stat().st_size) for p in paths}
    code=[*sorted((ROOT/'scripts/merged').glob('*.py')),*sorted((ROOT/'global').glob('merged-*.js')),ROOT/'global/index.html',ROOT/'global/style.css']
    write(OUT/'manifest.json',dict(release=OUT.name,files=files,total_bytes=sum(p['bytes'] for p in files.values()),code_sha256={str(p.relative_to(ROOT)):sha(p) for p in code},source_database_sha256=methods['source_database_sha256'],reference_area_sha256=sha(ROOT.parents[1]/'2_data/derived/merged_panel/yield_panel.parquet'),runtime=dict(python=platform.python_version(),numpy=np.__version__)))
    print(json.dumps(dict(products=products,bundles=len(expected),megabytes=sum(p['bytes'] for p in files.values())/1e6,diagnostics=dict(diag)),indent=2))
if __name__=='__main__':main()
