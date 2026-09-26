"""Point sensitivity to ±1 harvest-year labels for upstream alignment warnings.

This diagnostic never chooses or changes a calendar. The upstream warning
compares regional and national yields; it is not evidence for maximizing an
ENSO association. We keep the same observations across all three label tests.
"""
from collections import Counter
from functools import lru_cache
import csv
import numpy as np
from dataset import ENSO, OUT, read, write, sha
from indices import mean
from fit import design


def main():
    source=ENSO/'2_data/derived/merged_panel/export/qc_alignment.csv'
    manifest=read(OUT/'import-audit.json')['source_manifest']
    assert sha(source)==manifest['files']['qc_alignment.csv']
    flags=[]
    for row in csv.DictReader(source.open()):
        if row['misaligned'].lower() not in ('1','true'):continue
        row['misaligned']=1
        for key in ('tier','n_years','best_lag'):row[key]=int(row[key])
        for key in ('r_lag_m1','r_lag_0','r_lag_p1'):row[key]=float(row[key]) if row[key] else None
        flags.append(row)
    assert len(flags)==7, 'Alignment warning groups differ from the frozen release'
    ix=read(OUT/'indices.json')['nino34'];reports=[]
    @lru_cache(maxsize=None)
    def exposure(year,start,end):
        return mean(year,dict(start_relative_month=start,end_relative_month=end),ix)
    for flag in flags:
        crop=flag['crop_family'];data=read(OUT/'observations'/f"{flag['iso3']}-{crop}.json.gz")['series']
        rows=[r for r in data if r['tier']==flag['tier'] and r['season_std']==flag['season_std']]
        values={};counts=Counter()
        for r in rows:
            w=r['windows'].get('season')
            if not w:
                values[r['sid']]={'reason':'No assigned crop season'};continue
            # Keep each shifted harvest year inside the fixed 1981–2024 span.
            obs=[a for a in r['observations'] if a[1]>0 and 1982<=a[0]<=2023]
            years=np.array([a[0] for a in obs]);y=np.array([a[1] for a in obs])
            xs=np.array([[exposure(int(a[0])+shift,w['start_relative_month'],w['end_relative_month']) for a in obs] for shift in (-1,0,1)],dtype=float)
            ok=np.isfinite(xs).all(axis=0);years=years[ok];y=y[ok];xs=xs[:,ok]
            entry={'n':len(years),'shifts':{}}
            if len(years)<20:
                entry['reason']='Fewer than 20 common positive-yield years'
            else:
                for shift,x in zip((-1,0,1),xs):
                    X=design(years+shift,x,'linear')
                    if min((x>0).sum(),(x<0).sum())<5 or np.linalg.matrix_rank(X)<3:
                        entry['shifts'][str(shift)]={'reason':'Insufficient sign support or design rank'};continue
                    b=np.linalg.lstsq(X,np.log(y),rcond=None)[0]
                    entry['shifts'][str(shift)]={'beta':float(b[2]),'rmse_log_yield':float(np.sqrt(np.mean((np.log(y)-X@b)**2)))}
                counts['three_shifts_estimable']+=int(all('beta' in entry['shifts'].get(str(s),{}) for s in (-1,0,1)))
            values[r['sid']]=entry
        filename=f"alignment/{flag['iso3']}-{crop}-{flag['tier']}-{flag['season_std']}.json.gz"
        write(OUT/filename,dict(upstream_warning=flag,index='nino34',index_version=ix['version'],window='season',period=[1981,2024],series=values,
            method='Linear log-yield fit with time trend, same positive-yield observations and complete exposures for harvest-year shifts −1/0/+1. Point sensitivity only; no calendar selection, confidence intervals, or validation claim.'))
        changes={}
        for shift in (-1,1):
            diffs=[v['shifts'][str(shift)]['beta']-v['shifts']['0']['beta'] for v in values.values() if all('beta' in v.get('shifts',{}).get(str(s),{}) for s in (0,shift))]
            changes[str(shift)]={'n':len(diffs),'median_abs_delta_beta':float(np.median(np.abs(diffs))) if diffs else None}
        reports.append(dict(warning=flag,series=len(rows),**counts,changes=changes,file=filename))
    write(OUT/'alignment-summary.json',dict(source_database_sha256=read(OUT/'catalog.json')['source_database_sha256'],warning_export_sha256=sha(source),default_calendar_changed=False,reports=reports))
    print([(r['warning']['iso3'],r['warning']['crop_family'],r['series'],r.get('three_shifts_estimable',0)) for r in reports])


if __name__=='__main__':main()
