"""Export descriptive crop yields, independent of regression eligibility.

Run with --inputs /path/to/4_ag and --world /path/to/ne_110m_admin_0_countries.geojson.
Dependencies: shapely==2.1.2 and pyproj==3.7.1. Source packages remain unchanged.
"""
from pathlib import Path
import argparse, collections, csv, hashlib, json, math, sqlite3
from shapely import wkb
from shapely.geometry import mapping
from shapely.ops import transform
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
RELEASE = '2026-09-26'
PRODUCTS = {'wheat': 'Wheat', 'maize': 'Maize', 'rice-paddy': 'Rice, paddy', 'rice-milled': 'Rice, milled'}
COUNTRIES = {'BD': 'Bangladesh', 'IN': 'India', 'TH': 'Thailand', 'VN': 'Vietnam', 'ID': 'Indonesia', 'JP': 'Japan', 'KR': 'South Korea', 'LK': 'Sri Lanka', 'MY': 'Malaysia'}
PERIODS = {'available': None, '1991-2020': (1991, 2020), '2001-2020': (2001, 2020), '2011-2020': (2011, 2020), '2015-2024': (2015, 2024)}

def number(value):
    try:
        n = float(value)
        return n if math.isfinite(n) else None
    except (ValueError, TypeError):
        return None

def eligible(row):
    basis = row['yield_basis']
    if basis not in ('planted', 'harvested'):
        return 'missing area basis'
    if row.get('area_' + basis + '_complete', '').lower() != 'true' or row.get('production_complete', '').lower() != 'true':
        return 'incomplete reporting'
    y, a, p = [number(row.get(k)) for k in ('yield_mt_ha', 'area_' + basis + '_ha', 'production_mt')]
    if y is None or a is None or p is None or y < 0 or a <= 0 or p < 0:
        return 'missing or invalid yield, area or production'
    if not math.isclose(y, p / a, rel_tol=1e-5, abs_tol=1e-7):
        return 'inconsistent yield and production/area'
    return None

def summarize(observations, period):
    rows = [r for r in observations if period is None or period[0] <= r[0] <= period[1]]
    if not rows:
        return {'n': 0, 'mean': None, 'first': None, 'last': None, 'completeness': 0}
    first, last = min(r[0] for r in rows), max(r[0] for r in rows)
    span = (period[1] - period[0] + 1) if period else last - first + 1
    return {'n': len(rows), 'mean': sum(r[1] for r in rows) / len(rows), 'first': first, 'last': last,
            'completeness': len(rows) / span}

def write(path, data):
    path.parent.mkdir(exist_ok=True, parents=True)
    path.write_text(json.dumps(data, separators=(',', ':'), allow_nan=False))

def geometry(path):
    conn = sqlite3.connect(path)
    table, column, srs, *_ = conn.execute('select table_name,column_name,srs_id,geometry_type_name from gpkg_geometry_columns').fetchone()
    assert srs == 4326
    cur = conn.execute(f'SELECT * FROM "{table}"')
    names = [r[0] for r in cur.description]
    features = []
    for values in cur:
        r = dict(zip(names, values)); blob = r[column]
        # An unmatched Indian boundary has no statistical unit or observations.
        if r['stable_id'].startswith('UNMATCHED_'):
            continue
        envelope = (blob[3] >> 1) & 7
        offset = 8 + {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[envelope]
        geom = wkb.loads(blob[offset:])
        # Simplify in a local metric projection; observations retain the stable reporting unit.
        center = geom.representative_point()
        crs = f'+proj=laea +lat_0={center.y} +lon_0={center.x} +datum=WGS84 +units=m'
        forward = Transformer.from_crs('EPSG:4326', crs, always_xy=True).transform
        inverse = Transformer.from_crs(crs, 'EPSG:4326', always_xy=True).transform
        simplified = transform(inverse, transform(forward, geom).simplify(700, preserve_topology=True))
        coords = json.loads(json.dumps(mapping(simplified)))
        def rounded(x):
            return [rounded(v) for v in x] if isinstance(x, list) else round(x, 5)
        coords['coordinates'] = rounded(coords['coordinates'])
        features.append({'type': 'Feature', 'id': r['stable_id'], 'properties': {
            'id': r['stable_id'], 'name': r['unit_name'], 'country': path.parent.name,
            'members': r['n_members'], 'base_year': r['base_year'], 'level': r['stable_id'].split('.')[1]},
            'geometry': coords})
    conn.close()
    return {'type': 'FeatureCollection', 'features': features}

def build(inputs, world):
    out = ROOT / 'global/data' / RELEASE
    source_hashes, countries, exclusions = {}, {}, collections.Counter()
    all_series = {c: [] for c in PRODUCTS}
    crop_for = {v: k for k, v in PRODUCTS.items()}
    correction = json.loads((ROOT / 'verified_correction.json').read_text())
    for path in sorted(inputs.glob('v0.*/??/hvstat_asia_??_v*.csv')):
        cc = path.parent.name
        if cc not in COUNTRIES:
            continue
        boundaries = next(path.parent.glob('*boundary*.gpkg'))
        for p in (path, boundaries):
            source_hashes[str(p.relative_to(inputs))] = hashlib.sha256(p.read_bytes()).hexdigest()
        geo = geometry(boundaries)
        write(out / 'geometry' / (cc + '.json'), geo)
        units = {f['id']: f['properties'] for f in geo['features']}
        series = {}
        for row in csv.DictReader(path.open()):
            if row['product'] not in crop_for:
                continue
            corrected = row['stable_id'] == correction['stable_id'] and row['product'] == correction['product'] and int(row['year']) == correction['year']
            if corrected:
                row['area_harvested_ha'] = str(correction['verified_area_ha'])
                row['yield_mt_ha'] = str(correction['verified_yield_t_ha'])
            # Join the documented Vietnamese label change without combining actual seasons.
            season = row['season_name'].replace('Summer Rice', 'Autumn Rice') if cc == 'VN' else row['season_name']
            crop = crop_for[row['product']]
            key = (crop, row['stable_id'], season, row['yield_basis'] or 'unknown')
            s = series.setdefault(key, {'id': row['stable_id'], 'name': row['unit_name'], 'country': cc,
                'crop': crop, 'season': season, 'observations': [], 'excluded': collections.Counter(),
                'raw_years': set(), 'basis': row['yield_basis'] or 'unknown', 'members': row['unit_members']})
            s['raw_years'].add(int(row['year']))
            reason = eligible(row)
            if reason:
                s['excluded'][reason] += 1; exclusions[reason] += 1
                continue
            basis = row['yield_basis']
            s['observations'].append([int(row['year']), float(row['yield_mt_ha']), float(row['area_' + basis + '_ha']), float(row['production_mt']), corrected])
        panels = collections.defaultdict(list)
        for (crop, uid, season, basis), s in sorted(series.items()):
            assert uid in units, uid
            s['observations'].sort()
            assert len({r[0] for r in s['observations']}) == len(s['observations']), (uid, season, 'duplicate year')
            s['source_years'] = sorted(s.pop('raw_years'))
            s['excluded'] = dict(s['excluded'])
            s['level'] = units[uid]['level']; s['base_year'] = units[uid]['base_year']
            s['source'] = str(path.relative_to(inputs))
            s['periods'] = {p: summarize(s['observations'], years) for p, years in PERIODS.items()}
            panels[crop].append(s)
            all_series[crop].append({k: v for k, v in s.items() if k not in ('observations', 'members', 'source_years')})
        for crop, rows in panels.items():
            write(out / 'observations' / (cc + '-' + crop + '.json'), {'columns': ['year', 'yield_t_ha', 'area_ha', 'production_t', 'corrected'], 'series': rows})
        countries[cc] = {'name': COUNTRIES[cc], 'units': len(units), 'level': next(iter(units.values()))['level'],
            'source': str(path.relative_to(inputs)), 'crops': {c: sorted({s['season'] for s in rows if s['observations']}) for c, rows in panels.items()}}
    for crop, rows in all_series.items():
        write(out / (crop + '.json'), rows)
    world_data = json.loads(world.read_text())
    for f in world_data['features']:
        p = f['properties']; code = p.get('ISO_A2_EH') or p['ISO_A2']
        if code == '-99':
            code = p.get('ADM0_A3', p['NAME'])
        f['id'] = code; f['properties'] = {'country': code, 'name': p.get('NAME_LONG', p['NAME'])}
    write(out / 'world.json', world_data)
    catalog = {'release': RELEASE, 'products': PRODUCTS, 'countries': countries, 'periods': PERIODS,
        'world_source': 'Natural Earth 1:110m admin 0, public domain',
        'scope': 'Four crop products from nine Asian country packages. Other countries await the expanding database.',
        'excluded_records': dict(exclusions), 'source_sha256': source_hashes}
    write(out / 'catalog.json', catalog)
    write(out / 'manifest.json', {'release': RELEASE, 'files': {str(p.relative_to(out)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(out.rglob('*.json')) if p.name != 'manifest.json'}})
    print(json.dumps({'series': {c: len(s) for c, s in all_series.items()}, 'exclusions': dict(exclusions), 'bytes': sum(p.stat().st_size for p in out.rglob('*') if p.is_file())}, indent=2))

if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--inputs', type=Path, required=True); p.add_argument('--world', type=Path, required=True)
    args = p.parse_args(); build(args.inputs, args.world)
