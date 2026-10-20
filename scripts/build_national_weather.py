"""Add national crop-season weather histories from local, licensed gridded archives.

This display supplement leaves the release database and all forecast/model results untouched.
It supplies observations only: no new response fit, current-season estimate or forecast.
Run with the ENSO Python environment: python scripts/build_national_weather.py --release 2026-10-10
"""
from __future__ import annotations

# Locate the checkout independently of the working directory or machine.
from pathlib import Path as _ProjectPath
import sys as _project_sys
_ENSO_ROOT = next(p for p in _ProjectPath(__file__).resolve().parents if (p / "project.toml").is_file())
if str(_ENSO_ROOT) not in _project_sys.path:
    _project_sys.path.append(str(_ENSO_ROOT))
from enso_project import path as _project_path, resolve_path as _resolve_path
from enso_project import load_record as _load_record, loads_record as _loads_record

import argparse
import hashlib
import importlib.util
import json
import sqlite3
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from netCDF4 import Dataset, num2date
from scipy.sparse import csr_matrix
from shapely.geometry import shape

ATLAS = Path(__file__).resolve().parents[1]
ENSO = next((p for p in ATLAS.parents if (p / "project.toml").is_file()), ATLAS.parent)
BUILD = ENSO / 'data/pipelines'
DERIVED = ENSO / 'data/processed'
PRODUCTS = {
    'best': ('best_tavg_mm.nc', 'best_tavg_mm', 1., -180., 90., 360, 'Berkeley Earth', 'CC BY 4.0'),
    'chirps': ('chirps_precip.nc', 'chirps_precip', .25, -180., 90., 1440, 'CHIRPS v2.0', 'public domain (CHC)'),
    'era5': ('era5_precip.nc', 'era5_precip', .25, -180.125, 90.125, 1440, 'ERA5', 'Copernicus licence'),
}


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(8 * 1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, allow_nan=False, separators=(',', ':')) + '\n')


def weighted_daily(values, weights, min_coverage=.9):
    """Renormalize observed cells; retain days covering at least 90% of the country's crop weight."""
    valid = np.isfinite(values)
    coverage = weights @ valid.T.astype('float32')
    total = weights @ np.where(valid, values, 0).T
    return np.divide(total, coverage, out=np.full_like(total, np.nan), where=coverage >= min_coverage).T


def season_value(daily, dates, start, end, mean):
    start, end = np.datetime64(start, 'D'), np.datetime64(end, 'D')
    a, b = np.searchsorted(dates, [start, end])
    if a >= len(dates) or b >= len(dates) or dates[a] != start or dates[b] != end or b < a:
        return None
    values = daily[a:b + 1]
    if len(values) != int((end - start).astype(int)) + 1 or not np.isfinite(values).all():
        return None
    return float(values.mean() if mean else values.sum())


def detrended(rows):
    if len(rows) < 10:
        return {}
    a = np.array(rows, dtype=float)
    x = np.c_[np.ones(len(a)), a[:, 0] - a[:, 0].mean()]
    residual = a[:, 1] - x @ np.linalg.lstsq(x, a[:, 1], rcond=None)[0]
    return {int(y): round(float(v), 4) for y, v in zip(a[:, 0], residual)}


def build(release):
    base = ATLAS / 'site/data' / release
    release_manifest = _loads_record((base / 'manifest.json').read_text())
    db = Path(release_manifest['database']['path'])
    out = ATLAS / 'site/data/national-weather' / release
    cache = ENSO / 'analysis/planning/national_weather_2026-10-11' / release
    cache.mkdir(parents=True, exist_ok=True)
    targets, geometries, excluded = [], {}, []
    for p in sorted((base / 'units').glob('*.json')):
        u = _loads_record(p.read_text())
        for key, unit in u['units'].items():
            if unit['level'] != 'national':
                continue
            idx = _loads_record((base / 'records' / p.stem / 'index.json').read_text())
            entry = idx.get('units', {}).get(key)
            if not entry:
                continue
            records = _loads_record((base / 'records' / p.stem / entry[0]).read_text())['series']
            if not (base / 'geometry' / p.name).exists():
                excluded.append(dict(iso3=p.stem, reason='No national boundary in the release'))
                continue
            geo = _loads_record((base / 'geometry' / p.name).read_text())
            polygon = next((f for f in geo['features'] if f['id'] == key and f['geometry']), None)
            if not polygon:
                continue
            for s in unit['series']:
                rec = records.get(s['id'], {})
                if all(any(len(row)>c and row[c] is not None and np.isfinite(row[c]) for row in rec.get('weather_history', [])) for c in [1,2]):
                    continue
                targets.append(dict(series_id=int(s['id']), iso3=p.stem, unit_key=key, family=s['crop_family']))
                geometries[key] = shape(polygon['geometry'])
    target = pd.DataFrame(targets, columns=['series_id','iso3','unit_key','family'])
    con = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
    windows = pd.read_sql("SELECT w.series_id,w.harvest_year,w.start_date,w.end_date,w.source FROM season_windows w JOIN series s USING(series_id) WHERE s.tier=3 AND s.staple=1 AND w.harvest_year>=1981 AND w.source!='calendar_year'", con)
    con.close()
    windows = windows[windows.series_id.isin(target.series_id)]
    excluded.extend(dict(iso3=r.iso3, series_id=str(r.series_id), reason='No crop-season calendar') for r in target[~target.series_id.isin(windows.series_id)].itertuples())
    target = target[target.series_id.isin(windows.series_id)].copy()
    if target.empty:
        manifest=dict(release=release,kind='national historical weather display supplement',
            series=0,countries=0,excluded=excluded,files={},
            identity=dict(release_manifest=sha(base/'manifest.json'),builder=sha(Path(__file__))),
            note='No national crop-calendar series needs an additional temperature or rainfall history.')
        dump(out/'manifest.json',manifest)
        index_path=out.parent/'index.json'
        index=_loads_record(index_path.read_text()) if index_path.exists() else {'releases':{}}
        index['releases'][release]={};dump(index_path,index)
        print(manifest['note'],flush=True)
        return
    keys = sorted(set(target.unit_key + '|' + target.family))
    key_index = {k: i for i, k in enumerate(keys)}
    print(f'{len(target)} national crop series, {target.iso3.nunique()} countries, {len(keys)} crop-weight keys', flush=True)

    # Reuse the existing 0.025-degree supersampling procedure, on the release's national boundaries.
    sys.path.insert(0, str(BUILD))
    spec = importlib.util.spec_from_file_location('national_crosswalk', BUILD / '20_weather_crosswalk.py')
    crosswalk = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(crosswalk)
    import cropgrids as cg
    poly = gpd.GeoDataFrame({'unit_key': sorted(set(target.unit_key)), 'group': 'national'},
                           geometry=[geometries[k] for k in sorted(set(target.unit_key))], crs=4326)
    identity = dict(release_manifest=sha(base / 'manifest.json'), builder=sha(Path(__file__)),
                    crosswalk=sha(BUILD / '20_weather_crosswalk.py'), cropgrids=sha(BUILD / 'cropgrids.py'),
                    inputs={k: [str(DERIVED / v[0]), (DERIVED / v[0]).stat().st_size, (DERIVED / v[0]).stat().st_mtime_ns] for k, v in PRODUCTS.items()},
                    crops={f: sha(Path(cg.FILE[f])) for f in sorted(set(target.family))},
                    geometry={k: sha(base / 'geometry' / f'{k}.json') for k in sorted(geometries)})
    guard = cache / 'identity.json'
    if guard.exists() and _loads_record(guard.read_text()) != identity:
        raise RuntimeError('Cached inputs changed; choose a fresh cache directory before rebuilding.')
    dump(guard, identity)
    fine_path = cache / 'national_crosswalk.parquet'
    if fine_path.exists():
        fine = pd.read_parquet(fine_path)
    else:
        fine = crosswalk.fine_crosswalk(poly)
        fine.to_parquet(fine_path, index=False)
    lat, lon = cg.fine_centres(fine.cell.to_numpy())
    ids = fine.unit_key.to_numpy()
    products, metadata = {}, {}
    for product, (filename, variable, res, lon0, lat0, nx, title, license_) in PRODUCTS.items():
        print(f'{product}: country crop weights', flush=True)
        with Dataset(DERIVED / filename) as ds:
            data_cell = (np.floor((lat0 - np.asarray(ds['lat'][:])) / res + 1e-6).astype(int) * nx
                         + np.mod(np.floor((np.asarray(ds['lon'][:]) - lon0) / res + 1e-6).astype(int), nx))
            assert len(np.unique(data_cell)) == len(data_cell)
            lookup = pd.Index(data_cell)
            grid_cell = np.floor((lat0 - lat) / res).astype(int) * nx + np.mod(np.floor((lon - lon0) / res).astype(int), nx)
            rows, cols, weights = [], [], []
            for family in sorted(set(target.family)):
                area = cg.harvested_area(family)[fine.cell.to_numpy()] * fine.frac.to_numpy()
                want = {k.split('|')[0] for k in keys if k.endswith('|' + family)}
                take = (area > 0) & np.isin(ids, list(want))
                frame = pd.DataFrame({'unit': ids[take], 'cell': grid_cell[take], 'area': area[take]}).groupby(['unit', 'cell'], as_index=False).area.sum()
                totals = frame.groupby('unit').area.transform('sum')
                indices = lookup.get_indexer(frame.cell)
                ok = indices >= 0
                rows.extend([key_index[k + '|' + family] for k in frame.loc[ok, 'unit']])
                cols.extend(indices[ok])
                weights.extend((frame.area / totals)[ok])
            matrix = csr_matrix((np.asarray(weights, 'float32'), (rows, cols)), shape=(len(keys), len(data_cell)))
            spatial = np.asarray(matrix.sum(axis=1)).ravel()
            # Fix one rainfall product per crop/country. CHIRPS serves >=90% of crop area; otherwise use ERA5.
            if product == 'era5':
                need = np.asarray(metadata['chirps']['coverage']) < .9
                matrix = matrix.multiply(need[:, None]).tocsr()
            time = ds['time']
            dates = np.array([str(x)[:10] for x in num2date(time[:], time.units, only_use_cftime_datetimes=False)], dtype='datetime64[D]')
            cached = cache / f'{product}_daily.npz'
            if cached.exists():
                daily = np.load(cached)['daily']
            else:
                daily = np.full((len(dates), len(keys)), np.nan, dtype='float32')
                for i in range(0, len(dates), 366):
                    values = np.ma.filled(ds[variable][i:i + 366, :], np.nan).astype('float32')
                    daily[i:i + len(values)] = weighted_daily(values, matrix)
                    if i % (366 * 10) == 0:
                        print(f'{product}: {dates[i]}', flush=True)
                np.savez_compressed(cached, daily=daily)
            products[product] = (daily, dates)
            metadata[product] = dict(name=title, license=license_, file=str(DERIVED / filename), first=str(dates[0]), last=str(dates[-1]), coverage=spatial.tolist())

    by_country, audit = {}, []
    window_groups = {k: v for k, v in windows.groupby('series_id')}
    for rec in target.itertuples(index=False):
        key = rec.unit_key + '|' + rec.family
        j = key_index[key]
        rain_product = 'chirps' if metadata['chirps']['coverage'][j] >= .9 else 'era5'
        values, anomalies = {}, {}
        for metric, product, mean in [('temperature', 'best', True), ('rainfall', rain_product, False)]:
            daily, dates = products[product]
            rows_ = []
            for w in window_groups[rec.series_id].itertuples(index=False):
                value = season_value(daily[:, j], dates, w.start_date, w.end_date, mean)
                if value is not None:
                    rows_.append([int(w.harvest_year), value])
            values[metric] = rows_
            anomalies[metric] = detrended(rows_)
        years = sorted(set(anomalies['temperature']) | set(anomalies['rainfall']))
        history = [[y, anomalies['temperature'].get(y), anomalies['rainfall'].get(y)] for y in years]
        context = dict(weighting=f'CROPGRIDS v1.08 {rec.family} harvested area (2020)',
                       temperature_source='Berkeley Earth (daily mean of Tmax and Tmin)', rainfall_source=metadata[rain_product]['name'],
                       temperature_last_year=max(anomalies['temperature'], default=None), rainfall_last_year=max(anomalies['rainfall'], default=None),
                       temperature_crop_coverage=metadata['best']['coverage'][j], rainfall_crop_coverage=metadata[rain_product]['coverage'][j],
                       method='Crop-weighted complete growing seasons; a separate linear time trend is removed from each metric. At least 90% spatial crop coverage and every day of the season are required. At least 10 complete seasons are required for a trend. Historical context only; no additional response fit or current-season forecast.')
        by_country.setdefault(rec.iso3, {})[str(rec.series_id)] = dict(weather_history=history, context=context)
        audit.append(dict(series_id=str(rec.series_id), iso3=rec.iso3, family=rec.family, rainfall_product=rain_product, temperature_years=len(anomalies['temperature']), rainfall_years=len(anomalies['rainfall']), raw_season_values=values))
    for iso, series in by_country.items():
        dump(out / f'{iso}.json', dict(release=release, columns=['harvest_year', 'tavg_anom', 'precip_anom'], series=series))
    pd.DataFrame([{k: v for k, v in a.items() if k != 'raw_season_values'} for a in audit]).to_csv(cache / 'coverage.csv', index=False)
    dump(cache / 'season_values.json', audit)
    manifest = dict(release=release, kind='national historical weather display supplement', identity=identity,
                    sources={k: {a: b for a, b in v.items() if a != 'coverage'} for k, v in metadata.items()},
                    source_register=str(BUILD / 'sources.toml'), source_register_sha256=sha(BUILD / 'sources.toml'),
                    crop_provenance=_loads_record((Path(cg.DIR) / 'PROVENANCE.json').read_text()),
                    series=len(audit), countries=len(by_country), excluded=excluded, files={f'{iso}.json': sha(out / f'{iso}.json') for iso in by_country})
    dump(out / 'manifest.json', manifest)
    index_path = out.parent / 'index.json'
    index = _loads_record(index_path.read_text()) if index_path.exists() else {'releases': {}}
    index['releases'][release] = {iso: f'{release}/{iso}.json' for iso in by_country}
    dump(index_path, index)
    print(f'DONE: {len(audit)} series, {len(by_country)} countries; {out}', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', required=True)
    build(parser.parse_args().release)
