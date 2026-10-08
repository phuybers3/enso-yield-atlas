"""Export local ENSO responses as a versioned alternative to the pooled Watch.

Reads the database and frozen exposure table without modifying either. Local
fits require 20 years, as in the existing script 13. We retain the stored
script 15 OLS coefficients, historical samples and classical standard errors.
State fallbacks use the unpooled state coefficient
and its existing harvest-year-clustered error. Existing country/national fits
are the last fallback. No minimum heterogeneity is imposed on pooled models.

Run with the ENSO environment, from any directory. A published model version
must be replaced by a new version identifier if methods or inputs change.
"""
from pathlib import Path
import csv
import gzip
import hashlib
import json
import sqlite3
import numpy as np
import pandas as pd
from scipy.stats import t

ATLAS = Path(__file__).resolve().parents[2]
ENSO = ATLAS.parents[1]
ISSUE = '2026-10-06'
MODEL = 'regional-v1'
MIN_LOCAL_YEARS = 20
OUT = ATLAS / 'watch/regional' / f'{ISSUE}-v1'
BASE = ATLAS / 'watch/data' / ISSUE
SEASONS = ATLAS / 'watch/season-data' / ISSUE
CONTEXT = ATLAS / 'watch/context/2026-10-07.json'
EXPOSURE = ENSO / '4_ag/food_security_2026_27/paper/tables/exposure_series.parquet'
DB = ENSO / '2_data/derived/merged_panel/enso_ag.sqlite'


def read(p):
    return json.loads(p.read_text())


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def write(p, value):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')) + '\n')


def num(x, digits=8):
    return round(float(x), digits) if pd.notna(x) and np.isfinite(x) else None


def main():
    frozen = {BASE / f: m['sha256'] for f, m in read(BASE/'manifest.json')['files'].items()}
    frozen.update({SEASONS / f: h for f, h in read(SEASONS/'manifest.json')['files'].items()})
    assert all(sha(p) == h for p, h in frozen.items())
    e = pd.read_parquet(EXPOSURE)
    e = e[e.crop_family.isin(['maize','rice','wheat','soybean','sorghum','cassava'])]
    e = e[e.tier.eq(e.groupby(['iso3','crop_family']).tier.transform('min')) & e.beta_use.notna()].copy()
    assert e.series_id.is_unique
    con = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
    u = pd.read_sql('SELECT * FROM enso_response_unit_best_rel_season', con).set_index('series_id')
    g = pd.read_sql('SELECT * FROM enso_response_region_rel_season', con).set_index(['region_key','crop_code','season_std'])
    con.close()
    assert u.index.is_unique and g.index.is_unique
    assert set(u.window) == {'n34rel_season'} and set(g.window) == {'n34rel_season'}
    local = u[u.index.isin(e.series_id) & u.years.ge(MIN_LOCAL_YEARS)]
    # Archive the exact source fits. The live observations view now has a shorter
    # ENSO history; refitting that view would also change the historical sample.
    for name, frame in [('local-source-fits',u.loc[u.index.isin(e.series_id)]),('state-source-fits',g)]:
        payload=frame.reset_index().to_csv(index=False,lineterminator='\n').encode()
        OUT.mkdir(parents=True,exist_ok=True)
        with (OUT/(name+'.csv.gz')).open('wb') as f:
            with gzip.GzipFile(filename='',mode='wb',fileobj=f,mtime=0) as z:z.write(payload)
    print(f'Using {len(local)} existing local slopes',flush=True)
    panels = read(BASE/'panels.json'); context = read(CONTEXT)
    all_units = {}; panel_results = []; export_rows = []; before_after = []
    for p in panels:
        mask=e.iso3.eq(p['iso3']) & e.crop_code.eq(p['crop_code']) & e.season_std.eq(p['season'])
        d=e[mask]; assert len(d)==p['series']
        total=float(d.prod_series.sum()); sums={s:0. for s in ['low','medium','high']}
        shares={k:0. for k in ['local','state','country_panel','national','uncertain','beyond','large']}
        rec={}
        for r in d.itertuples():
            lk=(r.region_key,r.crop_code,r.season_std)
            xmin=None; xmax=float(r.x_max) if pd.notna(r.x_max) else None
            if r.series_id in local.index:
                fit=local.loc[r.series_id]; level='local'; beta=float(fit.beta_raw); se=float(fit.se_raw); n=int(fit.years)
                first,last=int(fit.first_year),int(fit.last_year)
                crit=float(t.ppf(.975,n-3)); uncertainty='classical OLS; independent, constant-variance errors'
            elif lk in g.index:
                row=g.loc[lk]; level='state'; beta=float(row.beta); se=float(row.se); n=int(row.years)
                first,last=int(row.first_year),int(row.last_year); xmin=None; xmax=float(r.x_max) if pd.notna(r.x_max) else None
                crit=1.96; uncertainty='clustered by harvest year'
            else:
                level=r.response_level; beta=float(r.beta_use); se=float(r.se_use); n=int(r.years) if pd.notna(r.years) else None
                first=last=xmin=None; xmax=float(r.x_max) if pd.notna(r.x_max) else None
                crit=1.96; uncertainty='existing country / national fit'
            assert level in shares and np.isfinite(beta) and np.isfinite(se) and se>=0
            blo,bhi=beta-crit*se,beta+crit*se
            values={s:float(100*np.expm1(beta*getattr(r,s))) for s in sums}
            ci=sorted([100*np.expm1(blo*r.medium),100*np.expm1(bhi*r.medium)])
            sensitive=[float(100*np.expm1(x)) for x in [beta,blo,bhi]]
            beyond=bool((xmax is not None and r.medium>xmax) or (xmin is not None and r.medium<xmin))
            uncertain=bool(blo<=0<=bhi); large=bool(abs(values['medium'])>50)
            for s in sums:sums[s]+=values[s]*r.prod_series/100
            for k,flag in [(level,True),('uncertain',uncertain),('beyond',beyond),('large',large)]:
                if flag:shares[k]+=r.prod_series
            unit=dict(s=int(r.series_id),response_level=level,region_key=str(r.region_key) if pd.notna(r.region_key) else None,
                region=str(r.region_name) if pd.notna(r.region_name) else None,
                beta=num(beta,12),se=num(se,12),beta_lo=num(blo,12),beta_hi=num(bhi,12),fit_n=n,fit_first=first,fit_last=last,
                uncertainty=uncertainty,e=num(values['medium']),lo=num(values['low']),hi=num(values['high']),
                ci_lo=num(ci[0]),ci_hi=num(ci[1]),sensitivity=num(sensitive[0]),sensitivity_lo=num(sensitive[1]),sensitivity_hi=num(sensitive[2]),
                uncertain=uncertain,large=large,b=int(beyond),production_mt=num(r.prod_series/1e6,10),
                exposure_low=num(r.low,12),exposure_medium=num(r.medium,12),exposure_high=num(r.high,12),
                pooled_e=num(100*np.expm1(r.beta_use*r.medium)))
            assert all(unit[k] is not None for k in ['e','lo','hi','ci_lo','ci_hi','sensitivity'])
            rec[r.unit_key]=unit
            export_rows.append(dict(iso3=r.iso3,crop_code=r.crop_code,season=r.season_std,unit_key=r.unit_key,**unit))
        shares={k:v/total for k,v in shares.items()}
        exp={**p['expected'],**{f'pct_{s}':100*sums[s]/total for s in sums},**{f'mt_{s}':sums[s]/1e6 for s in sums},
             'mt_low_bound':None,'mt_high_bound':None,'slope_pct_per_degC':None,'slope_lo':None,'slope_hi':None,'p':None,
             'grade':None,'grade_note':f"{100*shares['local']:.0f}% of production uses local fits; {100*shares['uncertain']:.0f}% has a slope interval spanning zero",
             'beyond_share':shares['beyond'],'response_model':MODEL,'shares':shares}
        panel_results.append(dict(iso3=p['iso3'],crop_code=p['crop_code'],season=p['season'],expected=exp))
        all_units.setdefault(p['iso3'],{})[p['crop_code']+'|'+p['season']]=rec
        before_after.append(dict(iso3=p['iso3'],crop_code=p['crop_code'],season=p['season'],production_mt=total/1e6,
            pooled_pct=p['expected']['pct_medium'],regional_pct=exp['pct_medium'],local_share=shares['local'],uncertain_share=shares['uncertain']))
    # Keep calendars and weather in the exact same records; replace only ENSO response fields.
    for iso, seasons in all_units.items():
        pack=read(SEASONS/f'{iso}.json');pack['response_model']=MODEL
        for key, records in seasons.items():
            assert set(records)==set(pack['seasons'][key]['units'])
            for key2,r in records.items():pack['seasons'][key]['units'][key2].update(r)
        write(OUT/'countries'/f'{iso}.json',pack)
    ef=pd.DataFrame(export_rows)
    rows=[]; countries=[]
    for old in context['rows']:
        d=ef[ef.iso3.eq(old['iso3']) & ef.crop_code.isin(e.loc[e.crop_family.eq(old['crop']),'crop_code'].unique())]
        weight=d.production_mt.sum(); assert abs(weight-old['production_mt'])<1e-5
        vals={s:float(np.average(d[c],weights=d.production_mt)) for s,c in [('low','lo'),('medium','e'),('high','hi')]}
        new={**old,'values':vals,'response_model':MODEL,'local_share':float(d.loc[d.response_level.eq('local'),'production_mt'].sum()/weight),
             'uncertain_share':float(d.loc[d.uncertain,'production_mt'].sum()/weight),'beyond_share':float(d.loc[d.b.eq(1),'production_mt'].sum()/weight),
             'large_share':float(d.loc[d.large,'production_mt'].sum()/weight),'weak_evidence':False}
        rows.append(new)
    for c in read(BASE/'countries.json'):
        d=ef[ef.iso3.eq(c['iso3'])];w=d.production_mt.sum()
        expected={**{f'mt_{s}':float((d[col]*d.production_mt/100).sum()) for s,col in [('low','lo'),('medium','e'),('high','hi')]},'pct_medium':float(np.average(d.e,weights=d.production_mt))}
        bycrop={r['crop']:dict(production_mt=r['production_mt'],mt_medium=r['values']['medium']*r['production_mt']/100,pct_medium=r['values']['medium']) for r in rows if r['iso3']==c['iso3']}
        countries.append(dict(iso3=c['iso3'],expected=expected,by_crop=bycrop))
    ledger=read(BASE/'ledger.json');byiso={c['iso3']:c for c in countries}
    for l in ledger:
        if l['iso3'] not in byiso:continue
        old_flag=int(l.get('x_enso') or 0);l['enso']=byiso[l['iso3']]['expected']['pct_medium']
        l['x_enso']=int(not l.get('enso_partial') and l['enso']<=-3)
        if l.get('count') is not None:l['count']+=l['x_enso']-old_flag
    method=dict(label='Local and regional fits',minimum_local_years=MIN_LOCAL_YEARS,
        description='We use each reporting unit’s own stored log-yield regression on its linear trend and growing-season relative Niño 3.4 when at least 20 valid years are available. Otherwise we use its unpooled state/province fit, then the existing country or national fit. No cross-region shrinkage is applied to local or state coefficients.',
        uncertainty='Local 95% coefficient intervals use the stored classical OLS standard error and a t critical value with n−3 degrees of freedom. These errors assume independent, constant-variance residuals and can understate uncertainty if those assumptions fail. State intervals use the existing harvest-year-clustered standard error and 1.96 multiplier. Intervals describe the fitted response at fixed ENSO exposure and exclude residual yield variation and ENSO forecast uncertainty. They are pointwise, without a multiple-testing correction.',
        aggregation='Apply each coefficient to the unchanged lower, central and higher ENSO paths with the original calendars; transform with 100[exp(beta × exposure)−1], then aggregate using the same fixed production weights. No clipping is applied to numerical estimates; map colors saturate at their labelled limits.',
        limitations='Local estimates can be noisy, especially for short records or exposures beyond the historical range. Retaining variation does not establish predictive skill. Weather estimates and their tests are unchanged. The earlier pooled issue remains available for comparison. Country aggregate coefficient intervals are not reported because shared errors cannot be treated as independent.',
        fit_period='We retain the historical samples used for the stored source fits, including records before 1950 where originally available. First and last years are exported for every local and state fit. We do not refit the live observations view, whose available ENSO history has since changed. Exposure-range flags retain the earlier issue’s panel-level historical maximum; they do not establish that an exposure is inside each local sample’s range.')
    usa=ef[ef.iso3.eq('USA')&ef.crop_code.eq('maize')]
    audit=dict(records=len(ef),local_records=int(ef.response_level.eq('local').sum()),levels=ef.response_level.value_counts().to_dict(),
        local_production_share=float(ef.loc[ef.response_level.eq('local'),'production_mt'].sum()/ef.production_mt.sum()),
        local_coefficients='Stored beta_raw and se_raw, unchanged; exact source tables archived with hashes',
        usa_maize=dict(units=len(usa),local_units=int(usa.response_level.eq('local').sum()),distinct_coefficients=int(usa.beta.nunique()),
          response_range=[float(usa.e.min()),float(usa.e.max())],local_share=float(usa.loc[usa.response_level.eq('local'),'production_mt'].sum()/usa.production_mt.sum()),
          central_pct=float(np.average(usa.e,weights=usa.production_mt)),uncertain_share=float(usa.loc[usa.uncertain,'production_mt'].sum()/usa.production_mt.sum())),
        large_response_records=int(ef.large.sum()),large_response_production_share=float(ef.loc[ef.large,'production_mt'].sum()/ef.production_mt.sum()))
    write(OUT/'model.json',dict(issue=ISSUE,response_model=MODEL,methods=method,panels=panel_results,countries=countries,rows=rows,ledger=ledger,audit=audit))
    write(OUT/'changes.json',before_after)
    with (OUT/'scenario-summary.csv').open('w',newline='') as f:
        w=csv.writer(f,lineterminator='\n');w.writerow(['issue','response_model','iso3','country','crop','lower_enso_pct','central_enso_pct','higher_enso_pct','production_mt','local_share','uncertain_share','calendar_review_units'])
        for r in rows:w.writerow([ISSUE,MODEL,r['iso3'],r['country'],r['crop'],*[r['values'][k] for k in ['low','medium','high']],r['production_mt'],r['local_share'],r['uncertain_share'],r['calendar_issues']])
    csv_bytes=ef.to_csv(index=False,lineterminator='\n').encode()
    with (OUT/'unit-responses.csv.gz').open('wb') as f:
        with gzip.GzipFile(filename='',mode='wb',fileobj=f,mtime=0) as z:z.write(csv_bytes)
    write(OUT/'manifest.json',dict(issue=ISSUE,response_model=MODEL,source_sha256={'generator':sha(Path(__file__)),
        'exposure_series.parquet':sha(EXPOSURE),
        'frozen_release_manifest':sha(BASE/'manifest.json'),'frozen_season_manifest':sha(SEASONS/'manifest.json')},
        files={str(p.relative_to(OUT)):sha(p) for p in sorted(OUT.rglob('*')) if p.is_file() and p.name!='manifest.json'},
        audit=audit,methods=method))
    assert all(sha(p)==h for p,h in frozen.items()),'Frozen inputs changed'
    print(json.dumps(audit,indent=2),flush=True)


if __name__=='__main__':
    main()
