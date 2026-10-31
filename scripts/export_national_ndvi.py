"""Export national VHP histories and matched-window observations, without forecasts."""
from pathlib import Path
import argparse
import hashlib
import json
import sys
import sqlite3

import numpy as np
import pandas as pd

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'project.toml').exists())
sys.path.insert(0, str(ROOT / 'analysis/crops'))
from lib.ndvi import Weekly
from lib.todate import MIN_ELAPSED, matched_cut_dates, reference_fit
from ndvi_history import anomalies


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(8 << 20), b''):
            h.update(block)
    return h.hexdigest()


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n')
    tmp.replace(path)


def number(value, digits=4):
    return round(float(value), digits) if pd.notna(value) and np.isfinite(value) else None


def histories(W, windows, series):
    req = windows[windows.harvest_year.between(1981, 2025)].merge(series[['series_id','key']], on='series_id', validate='many_to_one')
    req['unit_key'] = req.key
    req['cut_date'] = req.end_date
    values = W.elapsed(req[['unit_key','start_date','end_date','cut_date']])
    result = pd.concat([req[['series_id','harvest_year']].reset_index(drop=True), values], axis=1)
    result = result[(result.frac_elapsed >= .999) & result.ndvi_mean.notna()].copy()
    result['provisional'] = (result.harvest_year < 2001).astype(int)
    return anomalies(result)


def current(W, windows, series, issue):
    outputs = []
    horizon = windows[windows.harvest_year >= 2026]
    for hy, target in horizon.groupby('harvest_year'):
        req = windows[windows.series_id.isin(target.series_id) & windows.harvest_year.between(2001, hy)].merge(
            series[['series_id','key']], on='series_id', validate='many_to_one')
        req['unit_key'] = req.key
        req['cut_date'] = matched_cut_dates(W.data_end, pd.Series(hy, index=req.index), req.harvest_year)
        values = W.elapsed(req[['unit_key','start_date','end_date','cut_date']])
        result = pd.concat([req[['series_id','harvest_year']].reset_index(drop=True), values], axis=1)
        result = result[(result.elapsed_days >= MIN_ELAPSED) & result.ndvi_mean.notna()]
        if result.empty:
            continue
        fitted, sd, count = reference_fit(result, ['ndvi_mean'], int(hy))
        # These identifiers exceed 2**53; iterrows would coerce them to floats
        # alongside the NDVI values and silently change the source-series key.
        for row in result[result.harvest_year.eq(hy)].itertuples():
            i = row.Index
            n = int(count.loc[row.series_id, 'ndvi_mean'])
            if n < 10:
                continue
            value = row.ndvi_mean
            reference = fitted.loc[i, 'ndvi_mean']
            deviation = value - reference
            spread = sd.loc[row.series_id, 'ndvi_mean']
            record = dict(product='vhp', issue=issue, data_end=str(W.data_end), harvest_year=int(hy),
                frac_elapsed=number(row.frac_elapsed), elapsed_days=int(row.elapsed_days),
                t_coverage=None,p_coverage=None,ndvi_coverage=number(row.ndvi_coverage),
                metrics={'ndvi_mean':[number(value),number(reference),number(deviation),
                    number(deviation/spread) if spread > 0 else None,None,n]})
            outputs.append((str(int(row.series_id)),record))
    return outputs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--release', required=True)
    ap.add_argument('--source-release', help='Reuse a national extraction only after its series and windows match the target database exactly')
    a = ap.parse_args()
    source = ROOT / 'data/processed/ndvi' / ('national_' + (a.source_release or a.release))
    manifest = json.loads((source / 'manifest.json').read_text())
    base = ROOT / 'atlas/site/data' / a.release
    saved = json.loads((base / 'manifest.json').read_text())
    reused = None
    if a.source_release and a.source_release != a.release:
        previous = ROOT / 'data/releases' / ('enso_ag_' + a.source_release + '.sqlite')
        target = ROOT / 'data/releases' / ('enso_ag_' + a.release + '.sqlite')
        assert sha(previous) == manifest['identity']['database_sha256']
        assert sha(target) == saved['database']['sha256']
        signatures = {}
        queries = dict(series='SELECT * FROM series WHERE tier=3 ORDER BY series_id',
            windows='SELECT w.* FROM season_windows w JOIN series s USING(series_id) WHERE s.tier=3 ORDER BY w.series_id,w.harvest_year')
        for name, query in queries.items():
            with sqlite3.connect(previous.as_uri()+'?mode=ro',uri=True) as con:
                old = pd.read_sql_query(query, con)
            with sqlite3.connect(target.as_uri()+'?mode=ro',uri=True) as con:
                new = pd.read_sql_query(query, con)
            pd.testing.assert_frame_equal(old,new,check_exact=True)
            signatures[name] = dict(rows=len(new), sha256=hashlib.sha256(pd.util.hash_pandas_object(new,index=False).values.tobytes()).hexdigest())
        reused = dict(source_release=a.source_release, reason='National series and dated windows are unchanged; reuse the frozen VHP observations with their original cutoff.', verified=signatures)
    else:
        assert manifest['identity']['database_sha256'] == saved['database']['sha256'], 'National observations use another database'
    assert manifest['output_sha256'] == sha(source / 'unit_vhp.nc')
    series = pd.read_parquet(source / 'series.parquet')
    windows = pd.read_parquet(source / 'windows.parquet')
    W = Weekly(str(source / 'unit_vhp.nc'))
    history = histories(W, windows, series)
    if not reused:
        history.to_parquet(source / 'season_histories.parquet', index=False)
    world = json.loads((base / 'world.json').read_text())
    now = current(W, windows, series, world['issue'])
    current_by = {}
    for sid, value in now:
        current_by.setdefault(sid, []).append(value)
    out = ROOT / 'atlas/site/data/ndvi-history' / a.release
    registry_path = out.parent / 'index.json'
    registry = json.loads(registry_path.read_text()) if registry_path.exists() else {'releases':{}}
    assert a.release not in registry['releases'], 'Preserve an existing supplement; review before replacement'
    files = {}
    counts = dict(series=0,points=0,current_seasons=len(now),countries=0)
    national_ids = {}
    for file in (base / 'units').glob('*.json'):
        units = json.loads(file.read_text())
        ids = [s['id'] for unit in units['units'].values() if unit['level']=='national' for s in unit['series']]
        if ids:
            national_ids[file.stem] = ids
    for iso in sorted(national_ids):
        group = series[series.iso3.eq(iso)]
        payload = dict(release=a.release,iso3=iso,series={},states={},weather={},unavailable={},
            context=dict(kind='national VHP observations',product='NOAA STAR Blended VHP SMN',data_end=str(W.data_end),
                reference='Complete seasons detrended over 2001–2025; pre-2001 sensor records are provisional. Current observations use the same elapsed window in previous seasons and need ten reference years.',
                weighting='CROPGRIDS v1.08 crop harvested area; at least 90% spatial crop coverage, 50% valid weight each week, and 80% elapsed-day coverage.',
                limitation='Observation supplement only. No additional ENSO response, expected NDVI anomaly or forecast skill is fitted.'))
        subset = history[history.series_id.isin(group.series_id)]
        for sid, rows in subset.groupby('series_id'):
            payload['series'][str(sid)] = [[int(r.harvest_year),number(r.ndvi_anom),int(r.provisional)] for r in rows.itertuples(index=False)]
            counts['series'] += 1; counts['points'] += len(rows)
        for row in group.itertuples(index=False):
            sid = str(row.series_id)
            if sid in current_by:
                payload['weather'][sid] = current_by[sid]
            if sid not in payload['series']:
                payload['unavailable'][sid] = manifest['unavailable'].get(sid,'fewer_than_ten_reference_seasons')
        for sid in national_ids[iso]:
            if sid not in payload['series']:
                payload['unavailable'].setdefault(sid,manifest['unavailable'].get(sid,'seasonal_ndvi_not_extracted'))
        write(out / (iso + '.json'), payload)
        files[iso] = a.release + '/' + iso + '.json'
    counts['countries'] = len(files)
    write(out / 'audit.json', dict(release=a.release,kind='national observation supplement',counts=counts,
        source=dict(path=str(source.relative_to(ROOT)),sha256=sha(source / 'manifest.json')),
        database_sha256=saved['database']['sha256'],code_sha256=sha(__file__),reuse=reused,
        omitted_before_extraction=manifest['unavailable'],
        files={iso+'.json':dict(sha256=sha(out/(iso+'.json'))) for iso in files}))
    registry['releases'][a.release] = files
    write(registry_path, registry)
    print('National NDVI:',counts,flush=True)


if __name__ == '__main__':
    main()
