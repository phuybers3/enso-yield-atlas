"""Export the frozen agricultural ENSO index and its existing crop windows.

Run with Python's standard library; --check verifies the committed export.
We retain the agricultural analysis's NOAA PSL ERSSTv6, 1981–2010 series.
"""
from pathlib import Path
import argparse
import gzip
import hashlib
import json
import math

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'provenance/nino34_20260924.txt'
PAYLOAD = ROOT / 'source/atlas_payload.json.gz'
OUTPUT = ROOT / 'global/data/enso/2026-09-26/nino34.json'


def month_key(year, relative_month):
    year, month = divmod(year * 12 + relative_month - 1, 12)
    return f'{year:04d}-{month + 1:02d}'


def month_label(relative_month):
    offset, month = divmod(relative_month - 1, 12)
    name = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month]
    return name + {-1: ' (previous year)', 0: '', 1: ' (following year)'}.get(offset, f' (year {offset:+d})')


def build():
    monthly = {}
    for line in RAW.read_text().splitlines()[1:]:
        fields = line.split()
        if len(fields) != 13 or not fields[0].isdigit():
            continue
        for month, item in enumerate(fields[1:], 1):
            value = float(item)
            monthly[f'{int(fields[0]):04d}-{month:02d}'] = value if math.isfinite(value) and value > -90 else None
    payload = json.loads(gzip.decompress(PAYLOAD.read_bytes()))
    catalog = json.loads((ROOT / 'global/data/2026-09-26/catalog.json').read_text())
    panels = {(p['country'], p['crop'], p['season']): p for p in payload['panels']}
    windows = {}
    for country, meta in catalog['countries'].items():
        for crop, seasons in meta['crops'].items():
            for season in seasons:
                panel = panels[country, catalog['products'][crop], season]
                a, b = panel['start_relative_month'], panel['end_relative_month']
                assert isinstance(a, int) and isinstance(b, int) and a <= b
                windows['|'.join([country, crop, season])] = dict(
                    start_relative_month=a, end_relative_month=b,
                    label=month_label(a) + '–' + month_label(b),
                    type=panel['window_type'], note=panel['window_note'])
    # Confirm that every fitted observation reproduces its frozen ENSO exposure.
    by_id = {p['panel']: p for p in payload['panels']}
    checked, error = 0, 0.
    for key, rows in payload['observations'].items():
        p = by_id[key.split('|')[0]]
        for year, expected, _ in rows:
            values = [monthly.get(month_key(year, m)) for m in range(p['start_relative_month'], p['end_relative_month'] + 1)]
            assert all(v is not None for v in values), (key, year)
            error = max(error, abs(sum(values) / len(values) - expected))
            checked += 1
    assert error < 1e-10, error
    return dict(index='nino34', label='Niño 3.4', units='°C', product='NOAA PSL ERSSTv6',
                baseline='1981–2010', source_url='https://psl.noaa.gov/data/correlation/nina34.anom.data',
                frozen_source='provenance/nino34_20260924.txt',
                source_sha256=hashlib.sha256(RAW.read_bytes()).hexdigest(),
                calendar_source='source/atlas_payload.json.gz',
                calendar_source_sha256=hashlib.sha256(PAYLOAD.read_bytes()).hexdigest(),
                averaging='Unweighted mean of all months in the crop window; any missing month makes the seasonal value missing.',
                fitted_observations_verified=checked, monthly=monthly, windows=windows)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    text = json.dumps(build(), ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n'
    if args.check:
        assert OUTPUT.read_text() == text, 'ENSO export differs; run build_global_enso.py'
    else:
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(text)
    data = json.loads(text)
    print(f"{'Checked' if args.check else 'Wrote'} {len(data['windows'])} crop windows; reproduced {data['fitted_observations_verified']:,} fitted ENSO exposures.")
