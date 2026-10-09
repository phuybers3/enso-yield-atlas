"""Build a separately versioned display supplement; never rewrite the frozen results.

The supplement copies both indices, crop-specific coverage, source place names,
crop-family shards, historical season exposures and QC. Common-footprint means
use identical positive production weights and matched series/harvest years. They
are descriptive means of unit estimates, with no invented aggregate interval.
"""
from __future__ import annotations
import argparse, collections, datetime, hashlib, json, sqlite3, unicodedata
from pathlib import Path
import pandas as pd
import numpy as np
from shapely.geometry import shape, mapping
from shapely import union_all, make_valid

ROOT = Path(__file__).resolve().parents[1]
ENSO = ROOT.parents[1]
HULT = ENSO.parent / 'Adaptation/Hultgren'

def write(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(',', ':'), allow_nan=False)+'\n')

def normalize(s):
    return ''.join(c for c in unicodedata.normalize('NFKD', str(s)).lower() if c.isalnum())

def clean(x):
    return json.loads(pd.DataFrame(x).to_json(orient='records'))

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--release',default='2026-10-08'); args=ap.parse_args()
    release=args.release; src=ROOT/'site/data'/release; out=ROOT/'site/display'/release
    result=ENSO/'4_ag/results'/release
    db=ENSO/'2_data/derived/db'/f'enso_ag_{release}.sqlite'
    con=sqlite3.connect(f'file:{db}?mode=ro',uri=True)
    catalog=json.loads((src/'catalog.json').read_text())
    names={}; candidates=collections.defaultdict(set)
    ibge=HULT/'3_data/raw/ibge_soy/brazil_maize_2025_ibge_raw.parquet'
    for name in pd.read_parquet(ibge,columns=['mun']).mun.unique():
        name=name.rsplit(' - ',1)[0]; candidates[normalize(name)].add(name)
    name_source={}
    for row in con.execute('select unit_key,unit_name,geometry_source from units'):
        key,name,geom=row
        variants=candidates.get(normalize(name),set()) if key.startswith('BRA:') else set()
        if len(variants)==1:
            names[key]=next(iter(variants)); name_source[key]='IBGE municipality spelling, unique normalized-name match'
        else:
            # Keep mixed-case source spelling; replace separators in legacy keys.
            names[key]=name.replace('_',' ').title() if name and (name.islower() or '_' in name) else name
            name_source[key]='Source name; capitalization and separators normalized' if names[key]!=name else 'Source name'
    enso=pd.read_sql('select series_id,harvest_year,n34_season,n34rel_season from enso_windows',con)
    enso_by={str(k): [[int(y), None if pd.isna(a) else round(a,6), None if pd.isna(b) else round(b,6)] for _,y,a,b in g.itertuples(index=False,name=None)] for k,g in enso.groupby('series_id')}
    flags=collections.defaultdict(list)
    for sid,year,check,severity,note in con.execute('select series_id,year_label,check_name,severity,note from qc_flags'):
        flags[str(sid)].append([year,check,severity,note])
    prediction=pd.read_parquet(result/'prediction_series.parquet')
    rc=pd.read_parquet(result/'response_country.parquet'); rc=rc[rc.window.eq('season')]
    rc['country']=rc.iso3.map(lambda i:catalog['countries'].get(i,{}).get('name',i))
    rc['crop_family']=rc.crop_code.map(lambda c:catalog['crops'].get(c,{}).get('family'))
    rc['key']=rc.iso3+'|'+rc.crop_code+'|'+rc.season
    monthly=pd.read_sql('select * from enso_monthly order by year,month',con)
    coverage={}; family_coverage={}; names_count=0
    for path in sorted((src/'units').glob('*.json')):
        iso=path.stem; data=json.loads(path.read_text()); rec=json.loads((src/'records'/path.name).read_text())
        families=collections.defaultdict(dict)
        for key,u in data['units'].items():
            u['name']=names.get(key,u['name']); u['name_source']=name_source.get(key,'Source name')
            if name_source.get(key,'').startswith('IBGE'): names_count+=1
            for family in {s['crop_family'] for s in u['series']}:
                us={**u,'series':[s for s in u['series'] if s['crop_family']==family]}
                families[family][key]=us
            for s in u['series']:
                k=f"{iso}|{s['crop_code']}|{s['season']}"
                cv=coverage.setdefault(k,{'units':set(),'local':set(),'series':0,'first':9999,'last':0,'response':set(),'current':set()})
                cv['units'].add(key); cv['series']+=1
                if u['level']!='national': cv['local'].add(key)
                if s['responses']: cv['response'].add(key)
                if s['predictions']: cv['current'].add(key)
                cv['first']=min(cv['first'],s['first'] or 9999);cv['last']=max(cv['last'],s['last'] or 0)
                for season in [s['season'],'all']:
                    fc=family_coverage.setdefault(f"{iso}|{s['crop_family']}|{season}",{'units':set(),'local':set(),'series':0})
                    fc['units'].add(key);fc['series']+=1
                    if u['level']!='national':fc['local'].add(key)
        for family, units in families.items():
            ids={s['id'] for u in units.values() for s in u['series']}
            records={sid:{**rec['series'][sid],'enso':enso_by.get(sid,[]),'qc':flags.get(sid,[])} for sid in ids}
            write(out/'units'/f'{iso}-{family}.json',{**data,'units':units})
            write(out/'records'/f'{iso}-{family}.json',{**rec,'series':records})
        geo_path=src/'geometry'/path.name
        if geo_path.exists():
            regions=collections.defaultdict(list);region_names={}
            for feature in json.loads(geo_path.read_text())['features']:
                u=data['units'].get(feature['id'],{});key=u.get('region_key')
                if key and u.get('level')!='national':
                    regions[key].append(make_valid(shape(feature['geometry'])))
                    region_names[key]=u.get('region_name',key)
            features=[]
            for key,geoms in regions.items():
                geom=union_all(geoms);center=geom.representative_point()
                features.append({'type':'Feature','id':key,'properties':{'name':region_names[key],'center':[center.x,center.y]},'geometry':mapping(geom)})
            write(out/'regions'/path.name,{'type':'FeatureCollection','features':features})
        print(iso,flush=True)
    for cv in coverage.values():
        for k in ['units','local','response','current']:cv[k]=len(cv[k])
    for cv in family_coverage.values():
        for k in ['units','local']:cv[k]=len(cv[k])
    common={}; timing={}; reliability={}
    for (iso,crop,season),g in prediction.groupby(['iso3','crop_code','season']):
        key=f'{iso}|{crop}|{season}'
        a=g[g.method.eq('index_outlook') & g.scenario.eq('medium')]
        w=g[g.method.eq('weather_todate')]
        match=a.merge(w,on=['series_id','harvest_year'],suffixes=('_index','_weather'))
        match=match[np.isfinite(match.pct_index)&np.isfinite(match.pct_weather)&(match.production_t_weather>0)]
        if len(match):
            weights=match.production_t_weather
            common[key]={'n_series':len(match),'production_mt':float(weights.sum()/1e6),
                         'index_pct':float(np.average(match.pct_index,weights=weights)),
                         'weather_pct':float(np.average(match.pct_weather,weights=weights)),
                         'weather_usable':bool(match.usable_weather.all())}
        if len(a):
            valid=a[a.production_t>0];den=valid.production_t.sum()
            shares={label:float(valid.loc[mask,'production_t'].sum()/den) if den else None for label,mask in {
                'skill_missing':~np.isfinite(valid.skill_vs_trend),
                'skill_nonpositive':np.isfinite(valid.skill_vs_trend)&(valid.skill_vs_trend<=0),
                'usable':valid.usable.astype(bool),'beyond_fit':valid.beyond_fit.astype(bool)}.items()}
            reliability[key]=shares
    windows=pd.read_sql('select series_id,harvest_year,start_date,end_date,source,cycle from season_windows where harvest_year>=2026',con)
    med=prediction[prediction.method.eq('index_outlook') & prediction.scenario.eq('medium')]
    for keys,g in med.merge(windows,on=['series_id','harvest_year']).groupby(['iso3','crop_code','season']):
        timing['|'.join(keys)]={'start_min':g.start_date.min(),'start_max':g.start_date.max(),'end_min':g.end_date.min(),'end_max':g.end_date.max(),
            'sources':sorted(g.source.unique()),'frac_elapsed':float(np.average(g.frac_elapsed,weights=g.production_t)) if g.production_t.sum()>0 else None}
    con.close()
    write(out/'summary.json',{'release':release,'coverage':coverage,'family_coverage':family_coverage,'responses':clean(rc),'common':common,'timing':timing,'reliability':reliability,
        'monthly':clean(monthly),'changes':json.loads((result/'changes.json').read_text()),
        'methods':{'common':'Arithmetic production-weighted means of matched unit estimates for the same series and harvest year, using the weather rows’ weights for both methods. No aggregate uncertainty interval is estimated. These descriptive means can differ from the fitted country weather estimate.',
                   'history':'Season-average Niño 3.4 exposure copied from enso_windows, joined on exact series_id and harvest_year. Shading at ±0.5 °C describes warm/cool crop-season exposure; it is not an official ENSO episode classification.',
                   'names':f'{names_count} Brazilian names recovered from local IBGE spelling with unambiguous normalized-name matches. Other names preserve source spelling or normalize case and separators.'}})
    manifest={'release':release,'built':datetime.datetime.now(datetime.timezone.utc).isoformat(),'original_manifest_sha256':hashlib.sha256((src/'manifest.json').read_bytes()).hexdigest(),
              'exporter_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'files':{}}
    for p in sorted(out.rglob('*.json')):
        if p.name!='manifest.json':manifest['files'][str(p.relative_to(out))]={'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
    write(out/'manifest.json',manifest)
    print('Display supplement complete',len(manifest['files']),flush=True)

if __name__=='__main__':main()
