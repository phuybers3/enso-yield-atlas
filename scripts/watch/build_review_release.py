"""Add season maps and shared bulletin tables without changing the numerical issue.

Run with the ENSO Python environment. Existing release values are checked before
we export additional seasons from the matching tracker inputs.
"""
from pathlib import Path
import hashlib
import csv
import json
import sqlite3
import numpy as np
import pandas as pd

ATLAS = Path(__file__).resolve().parents[2]
ENSO = ATLAS.parents[1]
ISSUE = '2026-10-06'
RELEASE = ATLAS / 'watch/data' / ISSUE
OUT = ATLAS / 'watch/season-data' / ISSUE
CONTEXT = ATLAS / 'watch/context/2026-10-07.json'
PAPER = ENSO / '4_ag/food_security_2026_27/paper'
TRACK = PAPER.parent / 'season_tracker'


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def read(p):
    return json.loads(p.read_text())


def write(p, value):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')) + '\n')


def num(x, digits=2):
    return round(float(x), digits) if pd.notna(x) and np.isfinite(x) else None


def main():
    manifest = read(RELEASE / 'manifest.json')
    for f, meta in manifest['files'].items():
        assert sha(RELEASE / f) == meta['sha256'], f'Original release changed: {f}'
    panels = read(RELEASE / 'panels.json')
    countries = read(RELEASE / 'countries.json')
    exposure = PAPER / 'tables/exposure_series.parquet'
    windows = TRACK / f'data/season_windows_{ISSUE}.csv'
    anomalies = TRACK / f'tables/series_anomalies_{ISSUE}.parquet'
    e = pd.read_parquet(exposure)
    e = e[e.crop_family.isin(['maize', 'rice', 'wheat', 'soybean', 'sorghum', 'cassava'])]
    e = e[e.tier.eq(e.groupby(['iso3', 'crop_family']).tier.transform('min'))]
    e = e[e.beta_use.notna()].copy()
    w = pd.read_csv(windows).set_index('series_id')
    sr = set(pd.read_parquet(anomalies).series_id)
    con = sqlite3.connect(f'file:{ENSO}/2_data/derived/merged_panel/enso_ag.sqlite?mode=ro', uri=True)
    meta = dict(con.execute('SELECT key,value FROM meta'))
    assert meta['todate_issue'] == ISSUE and meta['todate_data_end'] == '2026-09-30'
    names = dict(con.execute('SELECT unit_key,unit_name FROM units'))
    weather = pd.read_sql('SELECT * FROM weather_todate_anomaly', con).set_index('series_id')
    con.close()
    assert e.series_id.is_unique and w.index.is_unique and weather.index.is_unique
    export = {}; mixed = []; checked = 0
    for p in panels:
        x = e[(e.iso3 == p['iso3']) & (e.crop_code == p['crop_code']) & (e.season_std == p['season'])]
        assert len(x) == p['series'] and x.unit_key.is_unique, p['label']
        assert abs(x.prod_series.sum()/1e6 - p['production_mt']) <= .00051
        for s in ['low', 'medium', 'high']:
            assert abs(100*x['dprod_'+s].sum()/x.prod_series.sum() - p['expected']['pct_'+s]) <= .05001
        rec = {}
        for r in x.itertuples():
            win = w.loc[r.series_id] if r.series_id in w.index else None
            if win is not None:
                assert win.harvest_year == r.harvest_year
                assert win.target_start <= win.target_end
            u = dict(n=names.get(r.unit_key), s=int(r.series_id), e=num(100*r.dprod_medium/r.prod_series, 1),
                     lo=num(100*r.dprod_low/r.prod_series, 1), hi=num(100*r.dprod_high/r.prod_series, 1),
                     calendar_issue=bool(win is not None and int(win.target_end[:4]) != r.harvest_year), b=int(r.beyond_fit), f=num(win.frac_elapsed) if win is not None else None, year=int(r.harvest_year),
                     start=win.target_start if win is not None else None, end=win.target_end if win is not None else None, response_level=r.response_level)
            if r.series_id in sr and r.series_id in weather.index:
                a = weather.loc[r.series_id]
                assert a.target_start == win.target_start and a.target_end == win.target_end
                assert a.year == r.harvest_year and a.target_start <= meta['todate_data_end']
                u.update(r=num(a.precip_anom_pct, 1), t=num(a.tmax_mean_anom), rr=num(a.precip_pct_rank),
                         tr=num(a.tmax_mean_pct_rank), weather_harvest_year=int(a.year),
                         weather_start=a.target_start, weather_end=a.target_end)
            rec[r.unit_key] = u
        key = p['crop_code'] + '|' + p['season']
        years = sorted(set(u['year'] for u in rec.values()))
        if len(years) > 1:
            mixed.append(dict(iso3=p['iso3'], season=key, years=years))
        export.setdefault(p['iso3'], {})[key] = dict(crop=p['crop_family'], years=years, calendar_issues=sum(u['calendar_issue'] for u in rec.values()),
            start=min((u['start'] for u in rec.values() if u['start']), default=None), end=max((u['end'] for u in rec.values() if u['end']), default=None), units=rec)
    # Every map record previously published must reproduce exactly, including weather.
    for iso, seasons in export.items():
        by_series = {u['s']: u for s in seasons.values() for u in s['units'].values()}
        for records in read(RELEASE / f'units/{iso}.json')['crops'].values():
            for old in records.values():
                new = by_series[old['s']]
                for k, value in old.items():
                    assert new.get(k) == value, (iso, old['s'], k, value, new.get(k))
                checked += 1
        write(OUT / f'{iso}.json', dict(issue=ISSUE, iso3=iso, seasons=seasons))
    rows = []
    for c in countries:
        for crop, aggregate in c['by_crop'].items():
            ps = [p for p in panels if p['iso3'] == c['iso3'] and p['crop_family'] == crop]
            x = e[e.iso3.eq(c['iso3']) & e.crop_family.eq(crop)]
            weight = x.prod_series.sum()/1e6
            values = {s: 100*x['dprod_'+s].sum()/x.prod_series.sum() for s in ['low', 'medium', 'high']}
            assert abs(values['medium'] - sum(p['expected']['pct_medium']*p['production_mt'] for p in ps)/sum(p['production_mt'] for p in ps)) < .2 if sum(p['production_mt'] for p in ps) else True
            rows.append(dict(iso3=c['iso3'], country=c['name'], crop=crop, years=sorted({y for p in ps for y in export[c['iso3']][p['crop_code']+'|'+p['season']]['years']}),
                seasons=[p['crop_code']+'|'+p['season'] for p in ps], production_mt=weight, values=values,
                beyond_share=sum(p['production_mt']*(p['expected']['beyond_share'] or 0) for p in ps)/weight if weight else None,
                calendar_issues=sum(export[c['iso3']][p['crop_code']+'|'+p['season']]['calendar_issues'] for p in ps),
                weak_evidence=any(p['expected']['p'] is None or p['expected']['p'] >= .1 for p in ps),
                national_only=all(p['tier'] == 3 for p in ps)))
    fews = dict(date='2026-10-06', url='https://fews.net/global/special-report/october-2026',
        title='FEWS NET: 2026–2027 El Niño food security impacts',
        summary='FEWS NET identifies high concern in Southern Africa and the parts of East Africa with one main rainy season. In the eastern Horn, wetter conditions may benefit crops while flooding causes local losses.',
        timing='Southern Africa: October 2026–March 2027 rainy season; 2027 harvest; greatest food-security concern during the November 2027–March 2028 lean season.',
        context='Food security also depends on stocks, trade, income, conflict and prior shocks.',
        regions=[dict(name='Southern Africa', countries=['AGO','LSO','MDG','MWI','MOZ','ZMB','ZWE','ZAF'], note='Rainfall and crop risk assessment and subsequent lean-season timing; see the dated regional discussion.'),
                 dict(name='East Africa', countries=['ETH','SSD','SDN','UGA','KEN','SOM'], note='Check the local rainfall regime and growing season before interpreting a national mean.')],
        comparison=[dict(iso3=i, crop=c, historical_production_pct=v) for i,c,v in [('ZAF','maize',-27.7),('AUS','wheat',-15.3),('IND','rice',-5.7),('ARG','maize',11.1)]])
    selection = [('AUS','wheat'),('IND','rice'),('IND','maize'),('IND','wheat'),('BRA','maize'),('ZAF','maize'),('ARG','maize'),('USA','maize')]
    write(CONTEXT, dict(updated='2026-10-07', issue=ISSUE, data_end=meta['todate_data_end'],
        season_qc={i:{k:dict(calendar_issues=s['calendar_issues'],years=s['years']) for k,s in ss.items()} for i,ss in export.items()},
        aggregate_note='Country-crop percentages are calculated before rounding tonnes. This corrects rounding distortion for small crops in the original country summaries; underlying model fits and unit values are unchanged.', rows=rows, bulletin_selection=[i+'|'+c for i,c in selection], fews=fews,
        bulletin='bulletins/enso_crop_bulletin_2026-10-07.pdf', source_sha256={f: sha(RELEASE/f) for f in ['countries.json','panels.json','summary.json']}))
    with (CONTEXT.parent/'scenario-summary-2026-10-07.csv').open('w', newline='') as f:
        writer = csv.writer(f, lineterminator='\n')
        writer.writerow(['issue','country','iso3','crop','harvest_years','lower_enso_yield_pct','central_enso_yield_pct','higher_enso_yield_pct','covered_production_mt','beyond_historical_exposure_share','calendar_review_units'])
        for r in rows:
            writer.writerow([ISSUE,r['country'],r['iso3'],r['crop'],' / '.join(map(str,r['years'])),*[r['values'][k] for k in ['low','medium','high']],r['production_mt'],r['beyond_share'],r['calendar_issues']])
    hashes = {p.name: sha(p) for p in OUT.glob('*.json') if p.name != 'manifest.json'}
    write(OUT/'manifest.json', dict(issue=ISSUE, files=hashes, source_sha256={str(p.relative_to(ENSO)):sha(p) for p in [exposure, windows, anomalies]},
        checks=dict(panels=len(panels), seasons=len(panels), previous_map_records_reproduced=checked, mixed_harvest_year_panels=mixed,
            panel_values_reproduced=True, actual_weather_windows_checked=True, calendar_review=[dict(iso3=i, season=k, units=s['calendar_issues']) for i,ss in export.items() for k,s in ss.items() if s['calendar_issues']]),
        note='Season-specific extension. Original numerical issue is unchanged. Mixed harvest years reflect unit-specific calendars and are shown explicitly.'))
    print(f'Exported {len(panels)} seasons; reproduced {checked} prior map records; {len(mixed)} panels span harvest years.')


if __name__ == '__main__':
    main()
