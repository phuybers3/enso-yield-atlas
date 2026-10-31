"""Check national observation exports against independently integrated weekly values."""
from pathlib import Path
import argparse
import hashlib
import json
import calendar

import numpy as np
import pandas as pd
from netCDF4 import Dataset
import scipy.sparse as sp

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'project.toml').exists())


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def average(values, starts, lengths, start, end, cutoff):
    start = np.datetime64(start, 'D')
    end = min(np.datetime64(end, 'D'), np.datetime64(cutoff, 'D')) + np.timedelta64(1, 'D')
    elapsed = int((end - start).astype(int))
    if elapsed <= 0:
        return np.nan, 0
    overlap = np.maximum(0, (np.minimum(starts + lengths.astype('timedelta64[D]'), end) - np.maximum(starts, start)).astype(int))
    valid = np.isfinite(values)
    covered = float(overlap[valid].sum()) / elapsed
    return (float(np.average(values[valid], weights=overlap[valid])) if covered >= .8 and overlap[valid].sum() else np.nan), covered


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--release', default='2026-10-30'); a = ap.parse_args()
    source = ROOT / 'data/processed/ndvi' / ('national_' + a.release)
    base = ROOT / 'atlas/site/data/ndvi-history' / a.release
    manifest = json.loads((source / 'manifest.json').read_text())
    audit = json.loads((base / 'audit.json').read_text())
    series = pd.read_parquet(source / 'series.parquet')
    windows = pd.read_parquet(source / 'windows.parquet')
    with Dataset(source / 'unit_vhp.nc') as ds:
        keys = np.asarray(ds['unit_key'][:], str)
        values = np.ma.filled(ds['ndvi'][:], np.nan)
        times = np.asarray(ds['time'][:], int)
        weeks = np.asarray(ds['week'][:], int)
    starts = np.datetime64('1970-01-01') + times.astype('timedelta64[D]')
    lengths = np.diff(np.r_[times,times[-1]+7]); lengths[lengths>9] = 7
    cutoff = np.datetime64(manifest['data_end'])
    assert str(starts[-1]+np.timedelta64(int(lengths[-1])-1,'D')) == str(cutoff)
    finite = values[np.isfinite(values)]
    assert len(finite) and finite.min() >= -1 and finite.max() <= 1
    W = sp.load_npz(source / 'weights.npz').tocsr()
    sums = np.asarray(W.sum(axis=1)).ravel()
    assert np.allclose(sums[sums>0],1,atol=2e-5)
    # Test the saved aggregation against the raw pixels for three different regions.
    week = 2024025
    with Dataset(ROOT / 'data/processed/ndvi/vhp_star/smn/smn_cropland_2024.nc') as ds:
        ds.set_auto_maskandscale(False)
        raw = np.asarray(ds['SMN'][int(np.flatnonzero(np.asarray(ds['week'][:]) == week)[0])], 'int16')
    for key in ['RUS|maize','AUS|wheat','SRB|maize']:
        j = int(np.flatnonzero(keys == key)[0]); row = W.getrow(j)
        good = raw[row.indices] != -999
        direct = np.average(raw[row.indices][good].astype(float)*.001, weights=row.data[good])
        assert abs(direct-values[int(np.flatnonzero(weeks==week)[0]),j]) < 2e-6, key
    count = current_count = 0
    for filename, identity in audit['files'].items():
        assert sha(base / filename) == identity['sha256']
        payload = json.loads((base / filename).read_text())
        assert payload['release'] == a.release
        assert not {'predictions','responses','joint_regions'} & set(payload)
        assert all(sid in set(series.series_id.astype(str)) for sid in payload['series'])
    # Direct day-overlap sums and independent least squares for every crop in the
    # three countries, including cross-year Australian seasons.
    for row in series[series.iso3.isin(['RUS','AUS','SRB'])].itertuples(index=False):
        payload = json.loads((base / (row.iso3+'.json')).read_text())
        shown = payload['series'].get(str(row.series_id), [])
        if not shown:
            continue
        j = int(np.flatnonzero(keys == row.key)[0])
        raw_seasons = []
        selected = windows[windows.series_id.eq(row.series_id)]
        for w in selected[selected.harvest_year <= 2025].itertuples(index=False):
            value, cover = average(values[:,j], starts, lengths, w.start_date, w.end_date, w.end_date)
            if np.isfinite(value):
                raw_seasons.append((int(w.harvest_year),value))
        train = np.array([r for r in raw_seasons if r[0]>=2001])
        fit = np.linalg.lstsq(np.c_[np.ones(len(train)),train[:,0]-2000],train[:,1],rcond=None)[0]
        lookup = dict(raw_seasons)
        for year,value,provisional in shown:
            expected = lookup[year]-fit@[1,year-2000]
            assert abs(value-expected) <= 5.01e-5, (row.iso3,row.crop_family,year,value,expected)
            assert provisional == int(year<2001)
            count += 1
        for current in payload['weather'].get(str(row.series_id), []):
            hy = current['harvest_year']; historical = []
            for w in selected[selected.harvest_year.between(2001,hy)].itertuples(index=False):
                year = int(str(cutoff)[:4]) - (hy-w.harvest_year)
                month,day = int(str(cutoff)[5:7]),int(str(cutoff)[8:10])
                cut = f'{year:04d}-{month:02d}-{min(day,calendar.monthrange(year,month)[1]):02d}'
                value,_ = average(values[:,j],starts,lengths,w.start_date,w.end_date,cut)
                if np.isfinite(value): historical.append((w.harvest_year,value))
            train = np.array([r for r in historical if r[0]<hy])
            fit = np.linalg.lstsq(np.c_[np.ones(len(train)),train[:,0]-2000],train[:,1],rcond=None)[0]
            expected_value = dict(historical)[hy]; expected_reference = fit@[1,hy-2000]
            metric = current['metrics']['ndvi_mean']
            for actual,expected in zip(metric[:3],[expected_value,expected_reference,expected_value-expected_reference]):
                assert abs(actual-expected) <= 5.01e-5
            assert metric[5] == len(train)
            current_count += 1
    assert count > 200 and current_count > 0
    print(f'PASS national NDVI: all file hashes and source-series IDs; raw pixel means; {count} historical and {current_count} current-season checks; no forecast fields')


if __name__ == '__main__':
    main()
