"""Validate fit completeness, compact delivery precision, and write release hashes."""
import json,time
from pathlib import Path
import numpy as np
from build_weather import BASE,OUT,ROOT,METRICS,PERIODS,read,write,sha
from fit_weather import compact

def run():
 registry=read(BASE/'indices.json');crops=list(read(BASE/'catalog.json')['products']);summary=[];started=time.monotonic()
 for crop in crops:
  completion=read(OUT/'fits'/f'{crop}-complete.json')
  expected=set(read(OUT/'summaries'/f'{crop}.json.gz'))
  assert completion['series']==len(expected)
  for index in registry:
   for metric in METRICS:
    file=OUT/'fits'/index/metric/f'{crop}.json.gz';fits=read(file);assert set(fits)==expected
    models=valid=intervals=0
    for sid,periods in fits.items():
     assert set(periods)==set(PERIODS)
     for period,f in periods.items():
      if not f.get('models'):assert f.get('reason');continue
      assert f['n']==len(f['years']) and f['n']>=20 and min(f['warm'],f['cold'])>=5
      for name,m in f['models'].items():
       if 'coef' not in m:assert m.get('reason');continue
       models+=1;p=3 if name=='linear' else 4;assert len(m['coef'])==p and np.isfinite(m['coef']).all()
       assert len(m['cv'])==2
       if all(x is not None and x>0 for x in m['cv']):valid+=1
       if m['cov'] is not None:
        cov=np.array(m['cov']);assert cov.shape==(p-2,p-2) and np.isfinite(cov).all()
        assert np.linalg.eigvalsh(cov).min()>-1e-9 and m['boot_n']>=360;intervals+=1
    write(file,compact(fits));summary.append(dict(crop=crop,index=index,metric=metric,series=len(fits),model_period_fits=models,with_uncertainty=intervals,positive_holdout_skill=valid))
  for metric in METRICS:
   file=OUT/'fits/trends'/metric/f'{crop}.json.gz';data=read(file);assert set(data)==expected;write(file,compact(data))
  print(crop,'fit files validated and compacted',round(time.monotonic()-started),'s',flush=True)
 methods=dict(response='annual crop-season metric in native units',time='(harvest year - 2000) / 10',models={'linear':'a + g*time + b*index','quadratic':'a + g*time + b*index + d*index^2','hinge':'a + g*time + b*index + h*max(index,0)'},minimum_years=20,minimum_exposures_each_sign=5,common_index_sample=True,bootstrap=dict(replicates=400,seed=20260926,calendar_block_years=3,anchor=1980,minimum_usable=360,interval='point estimate ± 1.96 bootstrap SD'),validation=dict(test_block_years=5,layouts=[1980,1982],adjacent_year_embargo=1,baseline='trend only',positive_skill_required_in_both_layouts=True),storage_significant_digits=9,inference='pointwise; no climate map multiplicity correction',precipitation='native mm/day; negative scenario levels flagged and not mapped',window='crop season; exact daily dates for weather, full calendar months for index')
 write(OUT/'methods.json',methods);write(ROOT/'provenance/climate/fit-validation.json',{'passed':True,'selections':summary})
 catalog=read(OUT/'catalog.json');catalog.update(fits_complete=True,fit_indices=list(registry),fit_models=list(methods['models']),fit_crops=crops,methods='methods.json');write(OUT/'catalog.json',catalog)
 files={str(p.relative_to(OUT)):{'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(OUT.rglob('*')) if p.is_file() and 'pilot' not in p.parts and p.name!='manifest.json'}
 write(OUT/'manifest.json',{'release':OUT.name,'files':files,'bytes':sum(v['bytes'] for v in files.values())})
 print('Finalized',len(files),'files;',sum(v['bytes'] for v in files.values()),'bytes',flush=True)

if __name__=='__main__':run()
