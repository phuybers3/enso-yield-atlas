"""Embed fitted observations and recover model baselines without repeating validation."""
import csv, gzip, json
from collections import defaultdict
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent

def enrich(payload):
    observations=defaultdict(list)
    with gzip.open(HERE/'observations.csv.gz','rt') as f:
        for r in csv.DictReader(f):
            observations[r['panel']+'|'+r['stable_id']].append([int(r['year']),float(r['n34']),float(r['log_yield'])])
    coverage=defaultdict(list)
    with open(HERE/'series_inventory.csv') as f:
        for r in csv.DictReader(f):
            coverage[(r['country_name'],r['crop'],r['season'])].append(r)
    payload['coverage']=[]
    for (country,crop,season),rows in coverage.items():
        payload['coverage'].append(dict(country=country,crop=crop,season=season,source=len(rows),
            fitted=sum(r['status']=='included' for r in rows),
            short=sum(r['status']=='fewer_than_20_complete_positive_years' for r in rows),
            sign=sum(r['status']=='fewer_than_5_years_of_either_ENSO_sign' for r in rows),
            rank=sum(r['status']=='rank_deficient_design' for r in rows),
            minYears=min(int(r['valid_years']) for r in rows),maxYears=max(int(r['valid_years']) for r in rows)))
    fits={}; lookup={r[0]+'|'+r[1]:dict(zip(payload['columns'],r)) for r in payload['rows']}
    error=0.
    for key,rows in observations.items():
        a=np.asarray(rows); t=(a[:,0]-2000)/10; x=a[:,1]; y=a[:,2]
        base=np.column_stack([np.ones(len(x)),t,x])
        designs=[base,np.column_stack([base,x*x]),np.column_stack([base,np.maximum(x,0)])]
        coefs=[np.linalg.lstsq(z,y,rcond=None)[0] for z in designs]
        r=lookup[key]
        expected=[r['beta'],r['quadratic_beta'],r['curvature'],r['cold_beta'],r['warm_beta']]
        actual=[coefs[0][2],coefs[1][2],coefs[1][3],coefs[2][2],coefs[2][2]+coefs[2][3]]
        error=max(error,float(np.max(np.abs(np.asarray(expected)-actual))))
        fits[key]=[v.tolist() for v in coefs]
    assert error<1e-6,error
    payload['observations']=dict(observations);payload['fits']=fits
    with open(HERE.parent/'results/monthly_indices.csv') as f:
        profile={r['date'][:7]:float(r['n34']) for r in csv.DictReader(f) if r['date'][:4] in ['1996','1997','1998','1999'] and r['n34']}
    peak=max((k for k in profile if k[:4]=='1997'),key=lambda k:profile[k])
    payload['eventProfile']={'values':profile,'peakMonth':int(peak[-2:]),'peak':profile[peak]}
    print('Verified all model coefficients against saved results; maximum difference',error)
    return payload

if __name__=='__main__':
    path=HERE/'ENSO_unit_atlas.html'
    old=path.read_text();payload=json.loads(old.split('const D=',1)[1].split(';\nconst $=',1)[0])
    payload=enrich(payload)
    text=(HERE/'atlas_template.html').read_text().replace('__PAYLOAD__',json.dumps(payload,separators=(',',':')).replace('</','<\\/'))
    text=text.replace('__EXPLORER_SCRIPT__',(HERE/'atlas_explorer.js').read_text())
    path.write_text(text)
