"""Read the authoritative SQLite snapshot and export static, versioned shards."""
import argparse
from collections import Counter, defaultdict
import gzip
import hashlib
import json
import math
from pathlib import Path
import sqlite3
import sys
import time
import numpy as np
import pandas as pd

from indices import registry, WINDOWS, window
ROOT=Path(__file__).resolve().parents[2]
ENSO=ROOT.parents[1]
RELEASE='2026-09-26-merged-v1'
OUT=ROOT/'global/data'/RELEASE
PERIODS={'1981-2024':[1981,2024], 'available':None,'1991-2020':[1991,2020],
         '2001-2020':[2001,2020],'2011-2020':[2011,2020],'2015-2024':[2015,2024]}
PRODUCTS={'wheat':'Wheat','maize':'Maize','rice':'Rice (paddy equivalent)',
          'soybean':'Soybean','sorghum':'Sorghum','cassava':'Cassava (fresh weight)'}
OBS_COLUMNS=['harvest_year','yield_t_ha','area_ha','production_t','corrected','year_label','complete','yield_source','qc','included','exclusion_reasons','primary','flag_area','flag_production','flag_yield']


def clean(x):
    if isinstance(x,dict):return {str(k):clean(v) for k,v in x.items()}
    if isinstance(x,(list,tuple)):return [clean(v) for v in x]
    if isinstance(x,np.ndarray):return clean(x.tolist())
    if isinstance(x,np.integer):return int(x)
    if isinstance(x,(float,np.floating)):return float(x) if math.isfinite(x) else None
    return x


def write(path,data):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    raw=json.dumps(clean(data),separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()
    if path.suffix=='.gz':raw=gzip.compress(raw,compresslevel=6,mtime=0)
    tmp=path.with_name(path.name+'.tmp');tmp.write_bytes(raw);tmp.replace(path)


def read(path):
    path=Path(path);raw=path.read_bytes()
    return json.loads(gzip.decompress(raw) if path.suffix=='.gz' else raw)


def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for b in iter(lambda:f.read(1048576),b''):h.update(b)
    return h.hexdigest()


def summary(obs,limits):
    r=[x for x in obs if limits is None or limits[0]<=x[0]<=limits[1]]
    if not r:return dict(n=0,mean=None,first=None,last=None,completeness=0)
    years=[x[0] for x in r];span=limits[1]-limits[0]+1 if limits else max(years)-min(years)+1
    return dict(n=len(r),mean=sum(x[1] for x in r)/len(r),first=min(years),last=max(years),completeness=len(r)/span)


def geometry(units,hultgren):
    import geopandas as gpd
    from shapely.geometry import mapping
    import shapely
    lookup={u['unit_key']:u for u in units}
    frames=[];hashes={}
    for rel in sorted({u['geometry_source'].split(':',1)[1] for u in units if (u['geometry_source'] or '').startswith('hvstat:')}):
        path=ENSO/rel;hashes[rel]=sha(path);g=gpd.read_file(path).to_crs(4326)
        iso=next(u['iso3'] for u in units if u['geometry_source']=='hvstat:'+rel)
        g['key']=iso+':'+g.stable_id.astype(str);frames.append(g[['key','geometry']])
    sys.path.insert(0,str(hultgren/'3_data/lib'))
    from hultgren_repro import gridagg
    path=hultgren/'3_data/reference/cil-ag-replication-package/Fig1/Crop_Coverage/data/shapes/all_countries.shp'
    for p in path.parent.glob('all_countries.*'):hashes[str(p.relative_to(hultgren))]=sha(p)
    g=gridagg.normalize_keys(gpd.read_file(path),is_shapefile=True).to_crs(4326)
    g['key']=g.iso+':'+g.adm1_id.astype(str)+':'+g.adm2_id.astype(str)
    g=g[g.key.isin(lookup)].copy();g.geometry=shapely.make_valid(g.geometry)
    g=g.dissolve(by='key',as_index=False);frames.append(g[['key','geometry']])
    path=ENSO/'2_data/raw/naturalearth/ne_50m_admin_0_countries.shp'
    for p in path.parent.glob('ne_50m_admin_0_countries.*'):hashes[str(p.relative_to(ENSO))]=sha(p)
    ne=gpd.read_file(path).to_crs(4326)
    # Natural Earth uses territorial identifiers rather than ISO3 for some units.
    aliases={'PSX':'PSE','SDS':'SSD'}
    ne['key']=ne.ADM0_A3.map(lambda k:aliases.get(k,k))
    world=[]
    for _,r in ne.iterrows():
        world.append(dict(type='Feature',id=r.key,properties=dict(country=r.key,name=r.NAME_LONG),geometry=mapping(r.geometry.simplify(.025,preserve_topology=True))))
    frames.append(ne[ne.key.isin(lookup)][['key','geometry']])
    allgeo=pd.concat(frames,ignore_index=True)
    bycountry=defaultdict(list);found=set()
    for _,r in allgeo.iterrows():
        if r.key not in lookup or r.key in found or r.geometry is None or r.geometry.is_empty:continue
        u=lookup[r.key];geom=shapely.make_valid(r.geometry).simplify(.008,preserve_topology=True)
        if geom.geom_type=='GeometryCollection':
            pieces=[x for x in geom.geoms if x.geom_type in ('Polygon','MultiPolygon')]
            if not pieces:continue
            geom=shapely.union_all(pieces)
        if geom.geom_type not in ('Polygon','MultiPolygon'):continue
        found.add(r.key)
        bycountry[u['iso3']].append(dict(type='Feature',id=r.key,properties=dict(id=r.key,country=u['iso3'],name=u['unit_name'],level=u['admin_level'],tier=u['tier'],members=u['n_members'],base_year=u['base_year']),geometry=mapping(geom)))
    for cc,features in bycountry.items():write(OUT/'geometry'/f'{cc}.json.gz',dict(type='FeatureCollection',features=features))
    write(OUT/'world.json',dict(type='FeatureCollection',features=world))
    write(OUT/'geometry-audit.json',dict(unmapped=[u for u in units if u['unit_key'] not in found],matched=len(found),source_sha256=hashes,
        simplification='0.008 degrees, topology preserved per reporting polygon; world outlines 0.025 degrees',
        caution='Territory geometries without verified boundaries remain unmapped; tables retain their observations.'))
    return found


def build(database,hultgren,skip_geometry=False):
    started=time.monotonic();manifest=read(database.parent/'export/MANIFEST.json')
    for n,h in manifest['files'].items():
        p=database if n=='enso_ag.sqlite' else database.parent/'export'/n
        assert sha(p)==h, f'Source checksum changed: {n}'
    con=sqlite3.connect('file:'+str(database.resolve())+'?mode=ro',uri=True);con.row_factory=sqlite3.Row
    units=[dict(r) for r in con.execute('SELECT * FROM units')]
    for u in units:
        if 'Ã' in u['unit_name']:
            try:u['unit_name']=u['unit_name'].encode('latin1').decode('utf8')
            except UnicodeError:pass
    unit_by={u['unit_key']:u for u in units}
    series=[dict(r) for r in con.execute('SELECT * FROM series WHERE staple=1')]
    cals={r['series_id']:dict(r) for r in con.execute('SELECT * FROM calendar')}
    flags=defaultdict(list)
    for r in con.execute('SELECT series_id,year_label,check_name,severity FROM qc_flags'):
        flags[(r['series_id'],r['year_label'])].append((r['check_name'],r['severity']))
    observations=defaultdict(list)
    for r in con.execute('SELECT o.* FROM observations o JOIN series s USING(series_id) WHERE s.staple=1 ORDER BY o.series_id,o.harvest_year,o.year_label'):
        observations[r['series_id']].append(dict(r))
    ix=registry(con,ROOT/'provenance/merged/meiv2-20260926.txt')
    write(OUT/'indices.json',ix)
    sources=[dict(r) for r in con.execute('SELECT * FROM sources')]
    write(OUT/'sources.json',dict(sources=sources,changes=[dict(r) for r in con.execute('SELECT * FROM source_changes')],corrections=[dict(r) for r in con.execute('SELECT * FROM source_corrections')]))
    found=set(unit_by) if skip_geometry else geometry(units,hultgren)
    if skip_geometry:
        found-=set(u['unit_key'] for u in read(OUT/'geometry-audit.json')['unmapped'])
    countries={}
    for u in units:
        countries.setdefault(u['iso3'],dict(name=u['country'],level='mixed',units=0,crops={},geometry=False))['units']+=1
        if u['unit_key'] in found:countries[u['iso3']]['geometry']=True
    # Carry reference weights with an explicit name; never use them as annual production.
    weights=pd.read_parquet(database.parent/'yield_panel.parquet',columns=['unit_key','crop_code','season_std','area_basis','source','area_weight_ha'])
    weights.area_basis=weights.area_basis.fillna('unknown')
    weights=weights.groupby(['unit_key','crop_code','season_std','area_basis','source'],dropna=False).area_weight_ha.median()
    summaries=defaultdict(list);shards=defaultdict(list);audit=Counter();aliases={}
    for s in series:
        uid=s['series_id'];u=unit_by[s['unit_key']];cal=cals[uid];native=s['crop_code'];crop=s['crop_family']
        factor=1/.67 if native=='rice_milled' else 1/.80 if native=='rice_brown' else 1.
        comparable=crop!='rice' or native!='rice'
        season=s['season_std']
        if native in ('wheat_spring','wheat_winter'):season+=' · '+native.replace('wheat_','').title()+' wheat'
        sid=hashlib.sha256(s['series_key'].encode()).hexdigest()[:20]
        r=dict(sid=sid,series_key=s['series_key'],database_series_id=uid,id=s['unit_key'],name=u['unit_name'],country=s['iso3'],crop=crop,source_crop=native,product=s['product'],season=season,season_std=s['season_std'],basis=s['area_basis'],source=s['source'],tier=s['tier'],level=u['admin_level'].upper().replace('NATIONAL','ADM0'),base_year=u['base_year'],members=u['n_members'],calendar=cal,
            conversion_factor=factor,weight_basis='paddy_equivalent' if crop=='rice' and comparable else 'unspecified' if crop=='rice' else 'source',comparable=comparable,mapped=s['unit_key'] in found,
            area_weight_ha=weights.get((s['unit_key'],native,s['season_std'],s['area_basis'],s['source'])),observations=[],records=[],outlier_observations=[])
        r['windows']={k:window(cal,k) for k in WINDOWS}
        excluded=Counter();seen=Counter(o['harvest_year'] for o in observations[uid])
        for o in observations[uid]:
            fs=flags[(uid,o['year_label'])]+flags[(uid,None)]
            errors={n for n,severity in fs if severity=='error'}
            reasons=set(errors)
            if seen[o['harvest_year']]>1:reasons.add('duplicate harvest year')
            y=o['yield_t_ha']
            if y is None or not math.isfinite(y) or y<0:reasons.add('missing/invalid yield')
            if s['tier']==1 and o['complete']!=1:reasons.add('incomplete/unknown reporting')
            if s['suspect_units']:reasons.add('suspect source units')
            raw=[o['harvest_year'],y,o['area_ha'],o['production_t'],o['corrected'],o['year_label'],o['complete'],o['yield_src'] or s['source'],[n+':'+severity for n,severity in fs],not reasons,sorted(reasons),o['primary'],o['flag_area'],o['flag_production'],o['flag_yield']]
            r['records'].append(raw)
            converted=[raw[0],y*factor if y is not None else None,raw[2],raw[3]*factor if raw[3] is not None else None,raw[4]]
            if not reasons:r['observations'].append(converted)
            elif reasons=={'yield_series_outlier'}:r['outlier_observations'].append(converted)
            for reason in reasons:excluded[reason]+=1
        r['excluded']=dict(excluded);r['periods']={p:summary(r['observations'],v) for p,v in PERIODS.items()}
        r['calendar_version']=hashlib.sha256(json.dumps(clean(cal),sort_keys=True).encode()).hexdigest()[:16]
        if u['stable_id']:aliases[u['stable_id']]=s['unit_key']
        cc=countries[s['iso3']];cc['crops'].setdefault(crop,set()).add(season)
        summaries[crop].append({k:v for k,v in r.items() if k not in ('observations','records','outlier_observations')})
        shards[(s['iso3'],crop)].append(r);audit['source_rows']+=len(r['records']);audit['included_rows']+=len(r['observations']);audit['series']+=1
    for crop,rs in summaries.items():write(OUT/f'{crop}.json.gz',rs)
    for (cc,crop),rs in shards.items():write(OUT/'observations'/f'{cc}-{crop}.json.gz',dict(columns=OBS_COLUMNS,series=rs))
    for c in countries.values():c['crops']={k:sorted(v) for k,v in c['crops'].items()}
    assert sha(database)==manifest['files']['enso_ag.sqlite'], 'Database changed during export'
    catalog=dict(release=RELEASE,schema=2,products=PRODUCTS,countries=countries,periods=PERIODS,windows=WINDOWS,indices={k:{a:b for a,b in v.items() if a not in ('values','observations','event_profile')} for k,v in ix.items()},aliases=aliases,
        source_database_sha256=sha(database),qc_run_utc=manifest['qc_run_utc'],audit=dict(audit),scope='Six staple families from the authoritative merged database; source series remain separate.',
        priority=['hvstat','gmfd','faostat'],reference_weight_note='area_weight_ha is a reference cropped-area weight, not annual harvested area',
        rice=dict(milled_per_paddy=.67,brown_per_paddy=.80,reference='https://www.fao.org/fileadmin/templates/mafap/documents/technical_notes/NIGERIA/NIGERIA_Technical_Note_RICE_EN_Jul2013.pdf',assumption='Fixed approximate recovery. Unspecified rice weights are excluded from comparable yield/trend maps.'))
    write(OUT/'catalog.json',catalog)
    write(OUT/'import-audit.json',dict(audit=dict(audit),source_manifest=manifest,geometry=read(OUT/'geometry-audit.json'),wall_seconds=time.monotonic()-started,
        policies=dict(qc='Exclude errors, ambiguous duplicates and incomplete HarvestStat sums. Retain warnings. Statistical-outlier-only exclusions are stored for sensitivity fits.',priority='Keep whole series separate; select a reporting layer per period, never splice primary tiers across years.'),unchanged_source=True))
    print(f'Exported {audit} in {time.monotonic()-started:.1f}s',flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--database',type=Path,default=ENSO/'2_data/derived/merged_panel/enso_ag.sqlite');p.add_argument('--hultgren',type=Path,default=ENSO.parent/'Adaptation/Hultgren');p.add_argument('--skip-geometry',action='store_true');a=p.parse_args();build(a.database,a.hultgren,a.skip_geometry)
