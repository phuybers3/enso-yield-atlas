"""Restore NDVI history as a versioned display supplement; frozen release files stay intact.

Run with --release 2026-10-19. Inputs are the two databases identified by the
existing export manifest. No ingest, yield fit, forecast or release rebuild runs.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import sqlite3

import numpy as np
import pandas as pd

from ndvi_history import anomalies, read_seasons, sha256

ATLAS = Path(__file__).resolve().parents[1]
ROOT = ATLAS.parent


def read(path):
    return json.loads(path.read_text())


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(value, separators=(',', ':'), ensure_ascii=False, allow_nan=False) + '\n')
    tmp.replace(path)


def aggregate(members, history, area, minimum):
    positive = [area[sid] for sid in members if area.get(sid, 0) > 0]
    fill = float(np.median(positive)) if positive else 1.
    totals = defaultdict(lambda: [0., 0., 0])
    for sid in members:
        weight = area.get(sid, fill)
        for year, value, provisional in history.get(sid, []):
            a = totals[year]
            a[0] += weight * value
            a[1] += weight
            a[2] += 1
    return [[y, round(a[0]/a[1], 4), int(y < 2001)]
            for y, a in sorted(totals.items()) if a[2] >= minimum and a[1] > 0]


def main(release):
    base = ATLAS/'site/data'/release
    manifest = read(base/'manifest.json')
    source_info = manifest['database'].get('fitted_on', manifest['database'])
    source = ROOT/source_info['path']
    served = ROOT/manifest['database']['path']
    # Refuse a changed input, including an updated live database under the same name.
    assert sha256(source) == source_info['sha256'], 'Original database checksum changed'
    assert sha256(served) == manifest['database']['sha256'], 'Served database checksum changed'
    seasons, audit = read_seasons(source, served)
    historical = anomalies(seasons)
    hist = {str(int(sid)): [[int(r.harvest_year), float(r.ndvi_anom), int(r.provisional)]
                            for r in g.sort_values('harvest_year').itertuples()]
            for sid, g in historical.groupby('series_id')}
    with sqlite3.connect(source.resolve().as_uri()+'?mode=ro', uri=True) as con:
        has_seasons = {str(r[0]) for r in con.execute('SELECT DISTINCT series_id FROM ndvi_season')}
    eligible = {str(x) for x in seasons.series_id.unique()}
    mismatched = set(audit.get('calendar_mismatch_series', []))
    out = ATLAS/'site/data/ndvi-history'/release
    countries = {}
    totals = Counter()
    for up in sorted((base/'units').glob('*.json')):
        iso = up.stem
        units = read(up)
        index = read(base/'records'/iso/'index.json')
        series, states, availability, area = {}, {}, {}, {}
        by_place = {}
        c = Counter()
        for key, unit in units['units'].items():
            chosen = {}
            for s in sorted(unit['series'], key=lambda s:(s['tier'], -(s['n'] or 0))):
                chosen.setdefault((s['crop_code'], s['season']), s['id'])
            by_place[key] = chosen
            shard = read(base/'records'/iso/index['units'][key][0])
            for s in unit['series']:
                sid = s['id']; record = shard['series'][sid]; c['series'] += 1
                c['published_ndvi_points_before'] += sum(r[3] is not None for r in record.get('weather_history', []))
                c['series_with_current_ndvi'] += any(w['product']=='vhp' for w in record.get('weather', []))
                weights = dict(zip(units['columns']['weight'], s['weight'] or []))
                a = weights.get('area_ha')
                if a is not None and a > 0:
                    area[sid] = a
                if sid in hist:
                    series[sid] = [[y, round(v,4), p] for y,v,p in hist[sid]]
                    c['restored_series'] += 1; c['restored_points'] += len(hist[sid])
                else:
                    reason = ('calendar_mismatch' if sid in mismatched else
                              'seasonal_ndvi_not_extracted' if sid not in has_seasons else
                              'insufficient_complete_seasons' if sid not in eligible else
                              'fewer_than_ten_reference_seasons')
                    availability[sid] = reason; c[reason] += 1
        for key, entry in index.get('states', {}).items():
            shard = read(base/'records'/iso/entry[0])
            for panel, r in shard['series'].items():
                members = [by_place[k][(r['crop_code'],r['season'])] for k in r['units']]
                rows = aggregate(members, hist, area, r['min_units_per_year'])
                c['state_records'] += 1
                if rows:
                    states.setdefault(key, {})[panel] = rows
                    c['restored_state_records'] += 1; c['restored_state_points'] += len(rows)
        write(out/f'{iso}.json', dict(release=release, iso3=iso, columns=['harvest_year','ndvi_anom','provisional'],
                                    series=series, states=states, unavailable=availability))
        countries[iso] = dict(c); totals.update(c)
        if iso in ['AUS','BRA','CHN','IND','USA','ZWE']:
            print(iso,dict(c),flush=True)
    audit.update(release=release, built_utc=datetime.now(timezone.utc).isoformat(),
                 source=source_info, served=manifest['database'], counts=dict(totals), countries=countries,
                 history_rule='Complete 1981–2025 seasons, coverage >= 0.8; linear reference trend over 2001–2025, >=10 years; pre-2001 provisional.',
                 scope='Historical NDVI only. Current observations, T/P histories, yields, response fits, forecasts, intervals and release selectors unchanged.',
                 source_script_sha256=sha256(Path(__file__)), helper_sha256=sha256(Path(__file__).with_name('ndvi_history.py')))
    audit['files'] = {p.name: dict(sha256=sha256(p), bytes=p.stat().st_size) for p in sorted(out.glob('*.json')) if p.name != 'audit.json'}
    write(out/'audit.json',audit)
    registry = out.parent/'index.json'
    reg = read(registry) if registry.exists() else {'releases': {}}
    reg['releases'][release] = {iso:f'{release}/{iso}.json' for iso in countries}
    write(registry,reg)
    print(json.dumps(audit['counts'],indent=2),flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--release',required=True)
    main(parser.parse_args().release)
