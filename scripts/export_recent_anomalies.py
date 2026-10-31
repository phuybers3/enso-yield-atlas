"""Monthly observations independent of the crop calendar, from existing local inputs.

Temperature compares adjusted CPC with its own 2015-onward record. Rainfall
uses CHIRPS only; ERA5-only units stay missing. VHP comparisons begin in 2001.
Each target month is compared with the same days in earlier years, removing a
linear calendar-year trend. No seasonal ENSO coefficient enters these files.
"""
from pathlib import Path
import argparse
import calendar
import hashlib
import json
import shutil

import numpy as np
from netCDF4 import Dataset

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'project.toml').exists())
EPOCH = np.datetime64('1970-01-01', 'D')
COLUMNS = ['month', 'through', 'observed', 'reference', 'anomaly', 'coverage', 'reference_years']


def write(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(obj, allow_nan=False, ensure_ascii=False, separators=(',', ':')) + '\n')
    tmp.replace(path)


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(8 << 20), b''):
            h.update(block)
    return h.hexdigest()


def finite(value):
    return round(float(value), 5) if np.isfinite(value) else None


def reference(years, values, target_year):
    """OLS reference using earlier eligible years only; ten are required."""
    ok = np.isfinite(values)
    n = ok.sum(axis=0)
    x = np.asarray(years, float)[:, None] - target_year
    sx = np.where(ok, x, 0).sum(axis=0)
    sy = np.where(ok, values, 0).sum(axis=0)
    sxx = np.where(ok, x*x, 0).sum(axis=0)
    sxy = np.where(ok, x*values, 0).sum(axis=0)
    den = n*sxx - sx*sx
    out = np.divide(sxx*sy - sx*sxy, den, out=np.full_like(sy, np.nan), where=(n >= 10) & (den > 0))
    return out, n


def window(year, month, days):
    days = min(days, calendar.monthrange(year, month)[1])
    start = np.datetime64(f'{year:04d}-{month:02d}-01', 'D')
    return start, start + np.timedelta64(days, 'D')


def aggregate(t, values, length, start, end, *, mean, coverage, available=None):
    """Integrate intervals by overlap days; missing rainfall is never zero-filled."""
    a, b = int((start-EPOCH).astype(int)), int((end-EPOCH).astype(int))
    overlap = np.maximum(0, np.minimum(t+length, b)-np.maximum(t, a)).astype(float)
    if available is not None:
        overlap = np.where(t+length <= int((available-EPOCH).astype(int)), overlap, 0)
    sel = overlap > 0
    v = values[sel]
    w = overlap[sel, None]
    valid = np.isfinite(v)
    den = (valid*w).sum(axis=0)
    cov = den / (b-a)
    total = (np.where(valid, v, 0)*w).sum(axis=0)
    result = total/np.maximum(den, 1) if mean else total
    return np.where(cov >= coverage, result, np.nan), cov


def monthly(t, values, length, months, cutoff, first_year, *, mean=True, coverage=.9, weekly=False):
    result = []
    for target in months:
        y, m = map(int, target.split('-'))
        a = np.datetime64(target+'-01', 'D')
        end = min((a.astype('datetime64[M]')+1).astype('datetime64[D]'), cutoff+np.timedelta64(1,'D'))
        if end <= a:
            result.append(None)
            continue
        days = int((end-a).astype(int))
        # A weekly composite is usable only after its ending date. Apply the
        # same information cutoff to historical partial-month comparisons.
        partial = end < (a.astype('datetime64[M]')+1).astype('datetime64[D]')
        observed, cov = aggregate(t, values, length, a, end, mean=mean, coverage=coverage,
                                  available=end if weekly and partial else None)
        years = list(range(first_year, y))
        hist = []
        for year in years:
            ha, hb = window(year, m, days)
            hv, _ = aggregate(t, values, length, ha, hb, mean=mean, coverage=coverage,
                              available=hb if weekly and partial else None)
            hist.append(hv)
        ref, n = reference(years, np.asarray(hist), y)
        result.append((str(end-np.timedelta64(1,'D')), observed, ref, observed-ref, cov, n))
    return result


def dataset_info(path):
    with Dataset(path) as d:
        return dict(path=str(path.relative_to(ROOT)), size=path.stat().st_size,
                    modified_ns=path.stat().st_mtime_ns,
                    attributes={k:d.getncattr(k) for k in d.ncattrs()})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--release', required=True)
    ap.add_argument('--out', type=Path, required=True, help='Staging folder; publication registry is updated separately')
    ap.add_argument('--temperature-cutoff', default='2026-10-25')
    ap.add_argument('--rainfall-cutoff', default='2026-10-25')
    ap.add_argument('--ndvi-cutoff', default='2026-10-28')
    ap.add_argument('--national-ndvi-release', default='2026-10-30')
    ap.add_argument('--pilot-key', help='Export one unit|family for an independent check')
    args = ap.parse_args()
    if shutil.disk_usage(ROOT).free < 4*1024**3:
        raise RuntimeError('Need at least 4 GiB free; no inputs were changed')
    latest = max(args.temperature_cutoff, args.rainfall_cutoff, args.ndvi_cutoff)
    last = np.datetime64(latest[:7], 'M')
    months = [str(last-np.timedelta64(i,'M')) for i in reversed(range(12))]
    paths = dict(temperature=ROOT/'data/processed/season_tracker/unit_daily_cpc.nc',
                 rainfall=ROOT/'data/processed/weather/unit_daily_precip.nc',
                 rainfall_nrt=ROOT/'data/processed/season_tracker/unit_daily_chirps_2026.nc',
                 ndvi=ROOT/'data/processed/ndvi/unit_vhp.nc',
                 national_ndvi=ROOT/f'data/processed/ndvi/national_{args.national_ndvi_release}/unit_vhp.nc')
    sources = {k:dataset_info(p) for k,p in paths.items()}
    products = {
        'temperature':dict(name='CPC daily temperature, Berkeley-adjusted', cutoff=args.temperature_cutoff,
            units='°C', first_reference_year=2015, coverage=.9,
            note='Each month is compared with the same adjusted CPC product. The existing CPC extract records SPAM weights; no new weighting or product splice is applied.'),
        'rainfall':dict(name='CHIRPS v2.0, including preliminary 2026 days', cutoff=args.rainfall_cutoff,
            units='mm', first_reference_year=2001, coverage=1.,
            note='Monthly totals require all elapsed daily values. Units served only by ERA5 in the archive remain missing.'),
        'ndvi':dict(name='NOAA STAR Blended VHP smoothed NDVI', cutoff=args.ndvi_cutoff,
            units='NDVI', first_reference_year=2001, coverage=.8,
            note='Weekly composites are weighted by overlapping days. Partial-month references exclude composites ending after the matched cutoff.')}
    all_rows = {}
    for product, source_name in [('temperature','temperature'),('rainfall','rainfall'),('ndvi','ndvi'),('ndvi','national_ndvi')]:
        path = paths[source_name]
        meta = products[product]
        cutoff = np.datetime64(meta['cutoff'], 'D')
        print(source_name, 'start', flush=True)
        with Dataset(path) as d:
            keys = np.asarray(d['unit_key'][:], str)
            dates = np.asarray(d['time'][:],dtype='int64')
            variable = {'temperature':'tavg','rainfall':'precip','ndvi':'ndvi'}[product]
            # VHP chunks span every location. Reading it once avoids decoding
            # the same 48,455-key chunks for every geography block.
            if product == 'ndvi':
                first = np.searchsorted(dates,int((np.datetime64('2000-12-01')-EPOCH).astype(int)))
                buffer = np.ma.filled(d[variable][first:],np.nan).astype('float32')
                dates = dates[first:]
            length = np.diff(np.append(dates,dates[-1]+7)) if product == 'ndvi' else np.ones(len(dates),int)
            length = np.where(length>9,7,length)
            for u0 in range(0,len(keys),1024):
                u1 = min(u0+1024,len(keys))
                keep = [i for i in range(u0,u1) if (not args.pilot_key or keys[i]==args.pilot_key)]
                if not keep:
                    continue
                local = np.array(keep)-u0
                val = buffer[:,u0:u1][:,local] if product=='ndvi' else np.ma.filled(d[variable][:,u0:u1],np.nan).astype('float32')[:,local]
                t = dates
                ll = length
                if product == 'rainfall':
                    eligible = np.asarray(d['precip_source'][u0:u1])[local] < .5
                    val[:,~eligible] = np.nan
                    with Dataset(paths['rainfall_nrt']) as nrt:
                        assert np.array_equal(np.asarray(nrt['unit_key'][u0:u1],str),keys[u0:u1])
                        nt = np.asarray(nrt['time'][:],dtype='int64')
                        future = nt > dates[-1]
                        nv = np.ma.filled(nrt[variable][:,u0:u1],np.nan).astype('float32')[:,local]
                    nv[:,~eligible] = np.nan
                    val = np.vstack([val,nv[future]])
                    t = np.r_[dates,nt[future]]; ll=np.ones(len(t),int)
                # Source files may extend later than the frozen publication
                # cutoff; those values cannot enter this supplement.
                val = val.copy()
                val[t+ll-1 > int((cutoff-EPOCH).astype(int))] = np.nan
                results = monthly(t,val,ll,months,cutoff,meta['first_reference_year'],
                    mean=product!='rainfall',coverage=meta['coverage'],weekly=product=='ndvi')
                for j,i in enumerate(keep):
                    out = []
                    for month,result in zip(months,results):
                        if result is None:
                            out.append([month,None,None,None,None,0,0]);continue
                        end,obs,ref,anom,cov,n = result
                        out.append([month,end,finite(obs[j]),finite(ref[j]),finite(anom[j]),finite(cov[j]),int(n[j])])
                    all_rows.setdefault(keys[i],{})[product] = out
                print(source_name,u1,'/',len(keys),flush=True)
        if product=='ndvi': del buffer
    groups = {}
    for key,values in all_rows.items():
        iso = key[:3]
        groups.setdefault(iso,{})[key] = values
    files = {}
    for iso,records in sorted(groups.items()):
        name=iso+'.json'
        write(args.out/name,dict(release=args.release,iso3=iso,months=months,columns=COLUMNS,products=products,records=records))
        files[iso]=dict(file=name,sha256=sha(args.out/name),keys=len(records))
    for name,path in paths.items():
        assert path.stat().st_mtime_ns == sources[name]['modified_ns'], f'Source changed during export: {name}'
    write(args.out/'manifest.json',dict(release=args.release,kind='monthly observations only',months=months,
        columns=COLUMNS,products=products,sources=sources,files=files,code_sha256=sha(Path(__file__)),
        reference='Earlier calendar years only; matched days within each calendar month; OLS linear trend; minimum ten years.',
        limitations=['National temperature and rainfall extractions are not included.',
                    'State aggregates are not synthesized from incomplete local coverage.',
                    'No monthly ENSO-conditioned expectations or yield update are fitted.',
                    'Product cutoffs are capped at the frozen release inputs; composites are final-vintage observations.']))


if __name__ == '__main__':
    main()
