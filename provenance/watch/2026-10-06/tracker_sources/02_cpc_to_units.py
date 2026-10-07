"""Near-real-time daily weather for the yield units: CPC temperature adjusted to Berkeley Earth, and CHIRPS 2026.

Temperature. CPC Global Unified daily TMAX and TMIN (0.5 degree, gauge-based) from 2015 are mapped to the units with a
new crosswalk built by the same supersampled rasterization as the platform's grids (2_data/build/20). Before
aggregation each 0.5 degree cell is adjusted to Berkeley Earth: for every calendar month, the mean difference over
January 2015 to October 2024 between the BEST 1 degree cell that contains it and the CPC cell is added to the CPC
value, so the near-real-time series sit on the platform's climatology. Degree days, TMAX above the BEST cell's 95th
percentile for the calendar day (the platform's threshold file) and the half-sum TAVG are then computed cell first and
crop-weighted, as in 2_data/build/21. A validation against the BEST unit series over the overlap is written to
tables/cpc_vs_best_validation.csv; the plan says the tracker falls back to country aggregates if the unit-level
disagreement exceeds the El Nino anomaly we look for.

Precipitation. CHIRPS v2.0 for 2026, the final file where it exists and the preliminary monthly files after it, on the
platform's CHIRPS crosswalk and wet-day thresholds, giving the same four daily products as the archive.

Outputs (season_tracker/data): crosswalk_cpc.parquet, unit_daily_cpc.nc (2015-01-01 to the last CPC day),
unit_daily_chirps_2026.nc, cpc_unit_validation.csv; tables/cpc_vs_best_validation.csv.

    python 4_ag/food_security_2026_27/season_tracker/scripts/02_cpc_to_units.py [--crosswalk-only]
"""
from __future__ import annotations

import glob
import importlib.util
import os
import sqlite3
import sys
import time

import numpy as np
import pandas as pd
import xarray as xr
from netCDF4 import Dataset

HERE = os.path.dirname(os.path.abspath(__file__)); S = os.path.dirname(HERE); D = os.path.join(S, "data"); TAB = os.path.join(S, "tables")
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(S)))
sys.path.insert(0, os.path.join(ROOT, "1_daily_variability", "lib"))
from enso import DERIVED  # noqa: E402

W = os.path.join(DERIVED, "weather"); DB = os.path.join(DERIVED, "merged_panel", "enso_ag.sqlite")
CPC_GRID = (0.5, -180.0, 90.0, 720, 360, 10)  # resolution, lon of left edge, lat of top edge, nx, ny, supersample
OVERLAP = (np.datetime64("2015-01-01"), np.datetime64("2024-10-31"))
Y0_CPC = 2015; WET = 1.0


def load_module(path: str, name: str):
    spec = importlib.util.spec_from_file_location(name, path); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m


m20 = load_module(os.path.join(ROOT, "2_data", "build", "20_weather_crosswalk.py"), "m20")
m21 = load_module(os.path.join(ROOT, "2_data", "build", "21_weather_units.py"), "m21")


def build_crosswalk() -> pd.DataFrame:
    p = os.path.join(D, "crosswalk_cpc.parquet")
    if os.path.exists(p):
        return pd.read_parquet(p)
    t0 = time.time(); con = sqlite3.connect(DB); poly = m20.polygons(con); con.close()
    res, lon0, lat0, nx, ny, ss = CPC_GRID
    cw = m20.crosswalk(poly, res, lon0, lat0, nx, ny, ss); crop = m20.cropland_on_grid(res, lon0, lat0, nx, ny)
    cw["cropland_ha"] = crop[cw.cell.to_numpy()]
    tot_area = cw.groupby("unit_key").frac.transform("sum"); cw["w_area"] = cw.frac / tot_area
    cw["wc"] = cw.frac * cw.cropland_ha; tot_crop = cw.groupby("unit_key").wc.transform("sum")
    cw["crop_weighted"] = (tot_crop > 0).astype(int); cw["w_crop"] = np.where(tot_crop > 0, cw.wc / tot_crop.replace(0, np.nan), cw.w_area)
    cw = cw.drop(columns=["wc"])[["unit_key", "cell", "row", "col", "lat", "lon", "frac", "cropland_ha", "w_area", "w_crop", "crop_weighted", "fallback"]]
    cw.to_parquet(p, index=False); print(f"CPC crosswalk: {len(cw):,} cell-unit pairs, {cw.unit_key.nunique():,} units; {time.time()-t0:.0f}s")
    return cw


def cpc_grid_mapping():
    """CPC lat/lon arrays and the flat data index of every crosswalk grid cell (row*720+col); lon in the files runs 0.25..359.75."""
    f = sorted(glob.glob(os.path.join(D, "cpc", "tmax.*.nc")))[0]
    with xr.open_dataset(f) as ds:
        lat = ds.lat.values.astype(float); lon = ds.lon.values.astype(float)
    res, lon0, lat0, nx, ny, _ = CPC_GRID
    rows = np.floor((lat0 - lat) / res + 1e-6).astype(int); cols = np.floor((((lon - lon0) % 360.0)) / res + 1e-6).astype(int)
    grid_key = (rows[:, None] * nx + cols[None, :]).ravel()
    return lat, lon, pd.Series(np.arange(len(grid_key)), index=grid_key)


def cpc_year(var: str, year: int, sel: np.ndarray | None = None):
    with xr.open_dataset(os.path.join(D, "cpc", f"{var}.{year}.nc")) as ds:
        tt = ds.time.values.astype("datetime64[D]"); X = ds[var].values.reshape(ds.sizes["time"], -1).astype("float32")
    X[np.abs(X) > 1e5] = np.nan
    return tt, (X[:, sel] if sel is not None else X)


def monthly_means(times: np.ndarray, X: np.ndarray):
    dt = pd.DatetimeIndex(times); ym = (dt.year * 12 + dt.month - 1).to_numpy(); starts = np.r_[0, np.nonzero(np.diff(ym))[0] + 1]
    ok = ~np.isnan(X); n = np.add.reduceat(ok.astype("float32"), starts, axis=0); s = np.add.reduceat(np.nan_to_num(X), starts, axis=0)
    with np.errstate(invalid="ignore", divide="ignore"):
        m = s / n
    cnt = np.diff(np.r_[starts, len(times)])[:, None]; m[n < 0.8 * cnt] = np.nan
    return ym[starts], m


def temperature(cw: pd.DataFrame, units: np.ndarray, last_cpc_year: int):
    t0 = time.time(); lat, lon, cell_index = cpc_grid_mapping(); nlat, nlon = len(lat), len(lon)
    # data cells that are missing on most days are ocean or unobserved; the crosswalk drops them and takes the nearest land cell within 0.75 degree
    _, X24 = cpc_year("tmax", min(2024, last_cpc_year)); static_nan = np.isnan(X24).mean(axis=0) > 0.5; del X24
    valid_cells = np.where(~static_nan)[0]
    lat_flat = np.repeat(lat, nlon); lon_flat = np.tile(lon, nlat); lon180 = ((lon_flat + 180.0) % 360.0) - 180.0
    ci = cell_index[~static_nan[cell_index.to_numpy()]]
    Wm, cov, near = m21.sparse_weights(cw, units, ci, data_latlon=pd.DataFrame({"lat": lat_flat[valid_cells], "lon": lon180[valid_cells]}, index=valid_cells), max_deg=0.75)
    used = np.unique(Wm.nonzero()[1]); Wu = Wm[:, used].tocsr(); print(f"CPC: {len(used):,} data cells used; coverage<0.5 for {(cov<0.5).sum()} units; nearest-served {(near>0.5).sum()}; {time.time()-t0:.0f}s")
    # containing BEST cell
    with xr.open_dataset(os.path.join(DERIVED, "best_tmax.nc")) as b:
        blat, blon = b.lat.values, b.lon.values
    # the containing 1 degree cell by its edges (top edge 90 N, left edge 180 W): floor(90 - lat), floor(lon + 180) for cell centres and subcells alike
    bkey = pd.Series(np.arange(len(blat)), index=(np.floor(90.0 - blat + 1e-6).astype(int) * 360 + np.floor(blon + 180.0 + 1e-6).astype(int)))
    ukey = np.floor(90.0 - lat_flat[used] + 1e-6).astype(int) * 360 + np.floor(lon180[used] + 180.0 + 1e-6).astype(int)
    bcol = bkey.reindex(ukey).to_numpy(); has_best = np.isfinite(bcol); bcol_i = np.where(has_best, bcol, 0).astype(int)
    print(f"  {has_best.sum():,} of {len(used):,} used cells lie in a BEST land cell")
    # BEST monthly means over the overlap, for the containing cells
    ovl = {}
    for v in ["tmax", "tmin"]:
        with xr.open_dataset(os.path.join(DERIVED, f"best_{v}.nc")) as b:
            tt = b.time.values.astype("datetime64[D]"); sel = (tt >= OVERLAP[0]) & (tt <= OVERLAP[1])
            Xb = b[f"best_{v}"].isel(time=np.where(sel)[0]).values[:, bcol_i].astype("float32")
        ym_b, mb = monthly_means(tt[sel], Xb); mb[:, ~has_best] = np.nan; ovl[v] = (ym_b, mb); del Xb
    # 1 degree parents of the used subcells, for the threshold metrics (see below)
    parents, pidx = np.unique(np.where(has_best, bcol_i, -1), return_inverse=True)
    import scipy.sparse as sp
    Mb = sp.csr_matrix((np.ones(len(used)), (pidx, np.arange(len(used)))), shape=(len(parents), len(used)))
    Mb = sp.diags(1.0 / np.maximum(np.asarray(Mb.sum(axis=1)).ravel(), 1)) @ Mb
    def to_parent_mean(F):  # (time x used) -> (time x parents), nan-aware
        ok = ~np.isnan(F); num = (Mb @ np.where(ok, F, 0.0).T).T; den = (Mb @ ok.T.astype("float32")).T
        with np.errstate(invalid="ignore", divide="ignore"):
            out = num / den
        out[den < 0.25] = np.nan; return out.astype("float32")
    def month_stats(times, X):  # per calendar month: climatological mean and sd of daily anomalies from the month's mean
        dt = pd.DatetimeIndex(times); ym = (dt.year * 12 + dt.month - 1).to_numpy(); mth = dt.month.to_numpy() - 1
        df = pd.DataFrame(X); mm = df.groupby(ym).transform("mean").to_numpy(); an = X - mm
        mu = np.full((12, X.shape[1]), np.nan, "float32"); sd = np.full((12, X.shape[1]), np.nan, "float32")
        for k in range(12):
            mu[k] = np.nanmean(X[mth == k], axis=0); sd[k] = np.nanstd(an[mth == k], axis=0)
        return mu, sd
    # BEST daily TMAX at the parents over the overlap: climatology and anomaly sd
    with xr.open_dataset(os.path.join(DERIVED, "best_tmax.nc")) as b:
        tt = b.time.values.astype("datetime64[D]"); sel = (tt >= OVERLAP[0]) & (tt <= OVERLAP[1])
        XbP = b["best_tmax"].isel(time=np.where(sel)[0]).values[:, np.maximum(parents, 0)].astype("float32"); XbP[:, parents < 0] = np.nan
    muB, sdB = month_stats(tt[sel], XbP); del XbP
    # pass A: CPC monthly means over the overlap and the per-month offsets
    offsets = {}
    cpc1_parts = []
    for v in ["tmax", "tmin"]:
        parts_t, parts_m = [], []
        for y in range(Y0_CPC, min(2024, last_cpc_year) + 1):
            tt, X = cpc_year(v, y, used); ym, m = monthly_means(tt, X); parts_t.append(ym); parts_m.append(m)
            if v == "tmax":
                cpc1_parts.append((tt[tt <= OVERLAP[1]], to_parent_mean(X[tt <= OVERLAP[1]])))
        ym_c = np.concatenate(parts_t); mc = np.concatenate(parts_m)
        ym_b, mb = ovl[v]; common = np.intersect1d(ym_b, ym_c); ib = pd.Series(np.arange(len(ym_b)), index=ym_b)[common].to_numpy(); ic = pd.Series(np.arange(len(ym_c)), index=ym_c)[common].to_numpy()
        diff = mb[ib] - mc[ic]; month = common % 12
        off = np.full((12, len(used)), np.nan, dtype="float32"); nyr = np.zeros((12, len(used)), dtype="int16")
        for mth in range(12):
            d = diff[month == mth]; off[mth] = np.nanmean(d, axis=0); nyr[mth] = np.isfinite(d).sum(axis=0)
        off[nyr < 5] = np.nan; offsets[v] = off
        print(f"  {v}: median offset {np.nanmedian(off):+.2f} C, IQR {np.nanpercentile(off, 25):+.2f}..{np.nanpercentile(off, 75):+.2f}; cells without offset {np.isnan(off).all(axis=0).sum():,}; {time.time()-t0:.0f}s")
    # Threshold and degree-day metrics are computed on the 1 degree aggregate of the CPC subcells, as BEST's own
    # resolution defines them, and that aggregate is adjusted in mean and in day-to-day spread: CPC's station
    # interpolation carries more daily variance than BEST's kriged field, so a mean offset alone leaves too many hot days.
    muC, sdC = month_stats(np.concatenate([t for t, _ in cpc1_parts]), np.concatenate([x for _, x in cpc1_parts])); del cpc1_parts
    with np.errstate(invalid="ignore", divide="ignore"):
        scale = np.where(sdC > 0.2, sdB / sdC, np.nan).astype("float32")
    print(f"  1-degree TMAX anomaly sd ratio BEST/CPC: median {np.nanmedian(scale):.3f}, IQR {np.nanpercentile(scale, 25):.3f}..{np.nanpercentile(scale, 75):.3f}")
    with xr.open_dataset(os.path.join(W, "threshold_best_tmax_p95.nc")) as th:
        thr1 = th.tmax_p95.values[:, np.maximum(parents, 0)].astype("float32"); thr1[:, parents < 0] = np.nan
    # pass B: adjusted daily fields, cell metrics, unit aggregation
    def agg(field):
        ok = ~np.isnan(field); F = np.where(ok, field, 0.0)
        num = (Wu @ F.T).T; den = (Wu @ ok.T.astype("float32")).T
        with np.errstate(invalid="ignore", divide="ignore"):
            out = num / den
        out[den < 0.5] = np.nan
        return out.astype("float32")
    out = {k: [] for k in ["tavg", "tmax", "tmin", "gdd", "edd30", "tmax_p95_frac"]}; times = []
    for y in range(Y0_CPC, last_cpc_year + 1):
        tt, TX = cpc_year("tmax", y, used); _, TN = cpc_year("tmin", y, used)
        mth = pd.DatetimeIndex(tt).month.to_numpy() - 1; doy = pd.DatetimeIndex(tt).dayofyear.to_numpy() - 1
        TX = TX + offsets["tmax"][mth]; TN = TN + offsets["tmin"][mth]; TA = 0.5 * (TX + TN)
        out["tavg"].append(agg(TA)); out["tmax"].append(agg(TX)); out["tmin"].append(agg(TN))
        TX1 = muB[mth] + (to_parent_mean(TX - offsets["tmax"][mth]) - muC[mth]) * scale[mth]  # raw 1-degree CPC, adjusted in mean and spread
        TA1 = to_parent_mean(TA) + (TX1 - to_parent_mean(TX)) * 0.5  # carry half the TMAX correction into the half-sum
        out["gdd"].append(agg(np.clip(TA1 - 8.0, 0.0, 22.0)[:, pidx])); out["edd30"].append(agg(np.clip(TX1 - 30.0, 0.0, None)[:, pidx]))
        ex1 = (TX1 > thr1[doy]).astype("float32"); ex1[np.isnan(TX1) | np.isnan(thr1[doy])] = np.nan; out["tmax_p95_frac"].append(agg(ex1[:, pidx]))
        times.append(tt); print(f"  cpc {y}: {len(tt)} days, {time.time()-t0:.0f}s", flush=True)
    times = np.concatenate(times); out = {k: np.concatenate(v) for k, v in out.items()}
    m21.write_nc(os.path.join(D, "unit_daily_cpc.nc.tmp"), times, units,
                 {"tavg": (out["tavg"], {"units": "degC", "long_name": "crop-weighted half-sum of adjusted CPC TMAX and TMIN"}), "tmax": (out["tmax"], {"units": "degC"}), "tmin": (out["tmin"], {"units": "degC"}),
                  "gdd": (out["gdd"], {"units": "degC day"}), "edd30": (out["edd30"], {"units": "degC day"}),
                  "tmax_p95_frac": (out["tmax_p95_frac"], {"units": "fraction", "long_name": "fraction of the unit with adjusted CPC TMAX above the containing BEST cell's 1991-2020 95th percentile for the calendar day"})},
                 {"source": "CPC Global Unified Temperature 0.5 deg (NOAA PSL), adjusted per cell and calendar month to Berkeley Earth over 2015-01 to 2024-10", "weighting": "SPAM 2010 crop area from crosswalk_cpc.parquet", "built": time.strftime("%Y-%m-%d")},
                 {"cpc_coverage": cov})
    os.replace(os.path.join(D, "unit_daily_cpc.nc.tmp"), os.path.join(D, "unit_daily_cpc.nc"))
    return times, out, cov


def validate(times: np.ndarray, out: dict, units: np.ndarray) -> None:
    """Monthly means of the adjusted CPC unit series against the BEST unit series over the overlap."""
    with xr.open_dataset(os.path.join(W, "unit_daily_temperature.nc")) as b:
        tb = b.time.values.astype("datetime64[D]"); sel = (tb >= OVERLAP[0]) & (tb <= OVERLAP[1]); ub = b.unit_key.values
        B = {v: b[v].isel(time=np.where(sel)[0]).values for v in ["tmax", "tmin", "tavg", "tmax_p95_frac"]}
    assert (ub == units).all()
    selc = (times >= OVERLAP[0]) & (times <= OVERLAP[1]); rows = []; per_unit = {}
    for v in ["tmax", "tmin", "tavg", "tmax_p95_frac"]:
        ymb, mb = monthly_means(tb[sel], B[v]); ymc, mc = monthly_means(times[selc], out[v][selc])
        common = np.intersect1d(ymb, ymc); ib = pd.Series(np.arange(len(ymb)), index=ymb)[common].to_numpy(); ic = pd.Series(np.arange(len(ymc)), index=ymc)[common].to_numpy()
        if v == "tmax_p95_frac":  # compare monthly hot-day counts
            ndays = pd.Series(pd.DatetimeIndex(tb[sel])).groupby((pd.DatetimeIndex(tb[sel]).year * 12 + pd.DatetimeIndex(tb[sel]).month - 1)).size().reindex(common).to_numpy()[:, None]
            mb_, mc_ = mb[ib] * ndays, mc[ic] * ndays
        else:
            mb_, mc_ = mb[ib], mc[ic]
        d = mc_ - mb_; ok = np.isfinite(d)
        # anomaly correlation: remove each unit's calendar-month mean
        month = common % 12
        def anom(M):
            A = M.copy()
            for mth in range(12):
                A[month == mth] -= np.nanmean(M[month == mth], axis=0)
            return A
        ab, ac = anom(mb_), anom(mc_); okc = np.isfinite(ab) & np.isfinite(ac)
        r_unit = np.array([np.corrcoef(ab[okc[:, j], j], ac[okc[:, j], j])[0, 1] if okc[:, j].sum() > 24 else np.nan for j in range(mb_.shape[1])])
        rmse_unit = np.sqrt(np.nanmean(d ** 2, axis=0)); bias_unit = np.nanmean(d, axis=0)
        per_unit[f"rmse_{v}"] = rmse_unit; per_unit[f"bias_{v}"] = bias_unit; per_unit[f"r_anom_{v}"] = r_unit
        rows.append(dict(variable=v, unit_months=int(ok.sum()), bias=float(np.nanmean(d)), rmse=float(np.sqrt(np.nanmean(d ** 2))),
                         rmse_unit_median=float(np.nanmedian(rmse_unit)), rmse_unit_p90=float(np.nanpercentile(rmse_unit, 90)),
                         anomaly_r_median=float(np.nanmedian(r_unit)), anomaly_r_p10=float(np.nanpercentile(r_unit, 10)),
                         units_rmse_above_0p5=int((rmse_unit > 0.5).sum()) if v != "tmax_p95_frac" else int((rmse_unit > 3).sum())))
    V = pd.DataFrame(rows); os.makedirs(TAB, exist_ok=True); V.to_csv(os.path.join(TAB, "cpc_vs_best_validation.csv"), index=False, float_format="%.4g")
    pd.DataFrame({"unit_key": units, **per_unit}).to_csv(os.path.join(D, "cpc_unit_validation.csv"), index=False, float_format="%.4g")
    print(V.round(3).to_string(index=False))


def chirps_2026(units: np.ndarray) -> None:
    """CHIRPS v2.0 for 2026 on the platform's crosswalk and thresholds: final file first, preliminary months after it."""
    t0 = time.time(); cw_ch = pd.read_parquet(os.path.join(W, "crosswalk_chirps.parquet"))
    files = sorted(glob.glob(os.path.join(D, "chirps", "chirps-v2.0.2026.days_p25.nc"))) + sorted(glob.glob(os.path.join(D, "chirps", "prelim-2026.*.days_p25.nc")))
    if not files:
        print("CHIRPS 2026: no files yet"); return
    parts = []; have = None
    for f in files:
        with xr.open_dataset(f) as ds:
            tt = ds.time.values.astype("datetime64[D]")
            keep = np.ones(len(tt), bool) if have is None else ~np.isin(tt, have)
            if keep.sum() == 0:
                continue
            X = ds.precip.isel(time=np.where(keep)[0]).values.astype("float32"); lat_c, lon_c = ds.latitude.values, ds.longitude.values
        parts.append((tt[keep], X)); have = tt if have is None else np.union1d(have, tt[keep]); print(f"  {os.path.basename(f)}: {keep.sum()} new days to {str(tt[keep][-1])}")
    times = np.concatenate([p[0] for p in parts]); X = np.concatenate([p[1] for p in parts]); order = np.argsort(times); times = times[order]; X = X[order]
    nlat, nlon = len(lat_c), len(lon_c); X = X.reshape(len(times), -1)
    row_of_lat = np.floor((90.0 - lat_c) / 0.25).astype(int); inband = cw_ch[(cw_ch.row >= row_of_lat.min()) & (cw_ch.row <= row_of_lat.max())].copy()
    j_of_row = pd.Series(np.arange(nlat), index=row_of_lat); inband["data_cell"] = j_of_row[inband.row.to_numpy()].to_numpy() * nlon + inband.col.to_numpy()
    static_nan = np.isnan(X).mean(axis=0) > 0.5
    inband.loc[static_nan[inband.data_cell.to_numpy()], "data_cell"] = np.nan; valid = np.where(~static_nan)[0]
    inband = m21.nearest_fill(inband, pd.DataFrame({"lat": lat_c[valid // nlon], "lon": lon_c[valid % nlon]}, index=valid), max_deg=0.5); inband = inband[inband.data_cell.notna()]
    used = np.unique(inband.data_cell.to_numpy().astype(int)); pos = pd.Series(np.arange(len(used)), index=used)
    inband["k"] = pos[inband.data_cell.to_numpy().astype(int)].to_numpy(); cell_index = pd.Series(inband.k.to_numpy(), index=inband.cell.to_numpy()).groupby(level=0).first()
    Wc, cov_c, _ = m21.sparse_weights(inband, units, cell_index)
    with xr.open_dataset(os.path.join(W, "threshold_chirps_wetday_p95.nc")) as th:
        thr_map = pd.Series(th.wetday_p95.values, index=th.data_cell.values)
    thr_c = thr_map.reindex(used).to_numpy().astype("float32")
    Xu = np.where(np.isnan(X[:, used]), 0.0, X[:, used]); wet = (Xu >= WET).astype("float32"); ex = ((Xu > thr_c[None, :]) & (Xu >= WET)).astype("float32")
    P = {"precip": (Wc @ Xu.T).T, "wet_frac": (Wc @ wet.T).T, "precip_p95_frac": (Wc @ ex.T).T, "precip_p95_amt": (Wc @ (Xu * ex).T).T}
    poor = cov_c < 0.5
    for k in P:
        P[k] = P[k].astype("float32"); P[k][:, poor] = np.nan
    m21.write_nc(os.path.join(D, "unit_daily_chirps_2026.nc"), times, units,
                 {"precip": (P["precip"], {"units": "mm/day", "long_name": "crop-weighted mean daily precipitation, CHIRPS v2.0 final then preliminary"}),
                  "wet_frac": (P["wet_frac"], {"units": "fraction"}), "precip_p95_frac": (P["precip_p95_frac"], {"units": "fraction"}), "precip_p95_amt": (P["precip_p95_amt"], {"units": "mm/day"})},
                 {"source": "CHIRPS v2.0 2026: " + "; ".join(os.path.basename(f) for f in files), "built": time.strftime("%Y-%m-%d")}, {"chirps_coverage": cov_c})
    print(f"CHIRPS 2026: {len(times)} days to {str(times[-1])}, {len(used):,} cells, {poor.sum()} units without CHIRPS; {time.time()-t0:.0f}s")


def main() -> None:
    os.makedirs(TAB, exist_ok=True)
    cw = build_crosswalk()
    if "--crosswalk-only" in sys.argv:
        return
    with xr.open_dataset(os.path.join(W, "unit_daily_temperature.nc")) as b:
        units = b.unit_key.values.astype(str)
    years = sorted(int(os.path.basename(f).split(".")[1]) for f in glob.glob(os.path.join(D, "cpc", "tmax.*.nc")) if os.path.exists(os.path.join(D, "cpc", f"tmin.{os.path.basename(f).split('.')[1]}.nc")))
    times, out, cov = temperature(cw, units, max(years))
    validate(times, out, units)
    chirps_2026(units)


if __name__ == "__main__":
    main()
