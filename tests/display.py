"""Independently verify display additions against database and frozen exports."""
import collections, hashlib, json, math, sqlite3
from pathlib import Path
import pandas as pd

ROOT=Path(__file__).resolve().parents[1]; RELEASE='2026-10-08'
BASE=ROOT/'site/data'/RELEASE; OUT=ROOT/'site/display'/RELEASE
J=lambda p:json.loads(p.read_text())
manifest=J(OUT/'manifest.json');summary=J(OUT/'summary.json')
assert manifest['original_manifest_sha256']==hashlib.sha256((BASE/'manifest.json').read_bytes()).hexdigest()
assert manifest['exporter_sha256']==hashlib.sha256((ROOT/'scripts/export_display.py').read_bytes()).hexdigest()
for f,m in manifest['files'].items():
    data=(OUT/f).read_bytes();assert len(data)==m['bytes'] and hashlib.sha256(data).hexdigest()==m['sha256'],f
coverage=collections.defaultdict(lambda:{'units':set(),'local':set(),'series':0})
count=0
for path in (BASE/'units').glob('*.json'):
    original=J(path);iso=path.stem;records=J(BASE/'records'/path.name);shards={}
    for key,u in original['units'].items():
        for s in u['series']:
            family=s['crop_family']
            if family not in shards:shards[family]=J(OUT/'units'/f'{iso}-{family}.json')
            actual=next(x for x in shards[family]['units'][key]['series'] if x['id']==s['id'])
            assert actual==s,(iso,key,s['id'])
            for season in [s['season'],'all']:
                cv=coverage[f'{iso}|{family}|{season}'];cv['units'].add(key);cv['series']+=1
                if u['level']!='national':cv['local'].add(key)
            count+=1
    for family in shards:
        rr=J(OUT/'records'/f'{iso}-{family}.json')
        for sid,rec in rr['series'].items():
            assert {k:v for k,v in rec.items() if k not in ['enso','qc']}==records['series'][sid],sid
for key,cv in coverage.items():
    assert summary['family_coverage'][key]=={k:len(v) if isinstance(v,set) else v for k,v in cv.items()},key
db=ROOT.parents[1]/'2_data/derived/db'/f'enso_ag_{RELEASE}.sqlite'
con=sqlite3.connect(f'file:{db}?mode=ro',uri=True)
for iso,family in [('USA','maize'),('IND','rice'),('BRA','maize'),('ARG','maize')]:
    rr=J(OUT/'records'/f'{iso}-{family}.json')
    # Check every historical exposure for representative countries, including cross-year crops.
    for sid,rec in rr['series'].items():
        expected={y:(a,b) for y,a,b in con.execute('select harvest_year,n34_season,n34rel_season from enso_windows where series_id=?',(int(sid),))}
        for year,a,b in rec['enso']:
            for actual,raw in zip((a,b),expected[year]):
                assert actual is None if raw is None else math.isclose(actual,raw,abs_tol=5.01e-7)
    print('Verified season exposure:',iso,flush=True)
con.close()
pred=pd.read_parquet(ROOT.parent/'results'/RELEASE/'prediction_series.parquet')
for key,actual in summary['common'].items():
    iso,crop,season=key.split('|');g=pred[(pred.iso3==iso)&(pred.crop_code==crop)&(pred.season==season)]
    index={(int(x.series_id),int(x.harvest_year)):x for x in g.itertuples() if x.method=='index_outlook' and x.scenario=='medium'}
    matched=[(index[(int(x.series_id),int(x.harvest_year))],x) for x in g.itertuples() if x.method=='weather_todate' and (int(x.series_id),int(x.harvest_year)) in index and x.production_t>0 and math.isfinite(x.pct) and math.isfinite(index[(int(x.series_id),int(x.harvest_year))].pct)]
    weight=math.fsum(w.production_t for a,w in matched)
    assert actual['n_series']==len(matched)
    assert math.isclose(actual['production_mt'],weight/1e6,rel_tol=1e-12)
    assert math.isclose(actual['index_pct'],math.fsum(a.pct*w.production_t for a,w in matched)/weight,abs_tol=1e-10)
    assert math.isclose(actual['weather_pct'],math.fsum(w.pct*w.production_t for a,w in matched)/weight,abs_tol=1e-10)
rc=pd.read_parquet(ROOT.parent/'results'/RELEASE/'response_country.parquet')
standard=rc[(rc['index']=='std')&(rc.window=='season')]
actual=[x for x in summary['responses'] if x['index']=='std']
assert len(actual)==len(standard)
for x in actual:
    row=standard[(standard.iso3==x['iso3'])&(standard.crop_code==x['crop_code'])&(standard.season==x['season'])].iloc[0]
    assert math.isclose(x['pct_per_degC'],row.pct_per_degC,abs_tol=5.1e-10)
print(f'PASS display: {count} series unchanged; all shard records and coverage counts match; both indices, exact seasonal exposure joins, matched-footprint arithmetic and {len(manifest["files"])} file hashes verified')
