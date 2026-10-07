"""Season-to-date weather for every series in the paper's 2026-27 horizon, for 2026 and for the same partial window in
every year since 1981.

The paper's exposure table (paper/tables/exposure_series.parquet) names the harvest year, 2026 or 2027, of each series'
season in the horizon. For that season we take the calendar window as 2_data/build/22 does (planting to harvest day
where the calendar carries days, whole months otherwise), cut it at the last day with data, and compute the season
metrics over the elapsed part. For every earlier harvest year the window starts on the same calendar day and runs the
same number of days, so each series has a season-to-date value for 1981-2026 with a common definition, and the 2026
value can be placed in its own history. Temperature is Berkeley Earth to 31 October 2024 and the adjusted CPC series
after; precipitation is the archive to 2025 and CHIRPS 2026 after. The 97 units whose archive precipitation is ERA5
have no 2026 rainfall and get NaN there.

Outputs (season_tracker/data): season_windows_<issue>.csv (one row per series: window, elapsed days, fraction) and
season_todate_<issue>.parquet (one row per series and year).

    python 4_ag/food_security_2026_27/season_tracker/scripts/03_season_todate.py [--issue 2026-09]
"""
from __future__ import annotations

import os
import sqlite3
import sys
import time

import numpy as np
import pandas as pd
from netCDF4 import Dataset

HERE = os.path.dirname(os.path.abspath(__file__)); S = os.path.dirname(HERE); D = os.path.join(S, "data")
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(S)))
sys.path.insert(0, os.path.join(ROOT, "1_daily_variability", "lib"))
from enso import DERIVED  # noqa: E402

W = os.path.join(DERIVED, "weather"); DB = os.path.join(DERIVED, "merged_panel", "enso_ag.sqlite")
PAPER = os.path.join(ROOT, "4_ag", "food_security_2026_27", "paper")
ISSUE = sys.argv[sys.argv.index("--issue") + 1] if "--issue" in sys.argv else "2026-09"
Y0, YN = 1981, 2026; BLOCK = 1024; MIN_COVER = 0.9
TV = ["tavg", "tmax", "tmin", "gdd", "edd30", "tmax_p95_frac"]; PV = ["precip", "wet_frac", "precip_p95_frac"]


def read_block(path: str, names: list[str], u0: int, u1: int, t_sel: slice | None = None):
    with Dataset(path) as ds:
        t = np.datetime64("1970-01-01") + ds["time"][:].astype("timedelta64[D]")
        if t_sel is not None:
            t = t[t_sel]
        A = {}
        for v in names:
            if ds[v].ndim == 1:  # per-unit variables such as precip_source
                A[v] = ds[v][u0:u1].filled(np.nan).astype("float32")
            else:
                A[v] = (ds[v][t_sel, u0:u1] if t_sel is not None else ds[v][:, u0:u1]).filled(np.nan).astype("float32")
    return t, A


def window(Y: int, pm, hm, off, use_doy, pdoy, hdoy):
    if use_doy:
        start = np.datetime64(f"{int(Y + off)}-01-01") + np.timedelta64(int(pdoy) - 1, "D"); end = np.datetime64(f"{Y}-01-01") + np.timedelta64(int(hdoy) - 1, "D")
        if start > end:
            start -= np.timedelta64(365, "D")
    else:
        ys = int(Y + off); start = np.datetime64(f"{ys}-{int(pm):02d}-01")
        end = (np.datetime64(f"{Y}-{int(hm):02d}-01") + np.timedelta64(32, "D")).astype("datetime64[M]").astype("datetime64[D]") - np.timedelta64(1, "D")
    return start, end


def longest_dry(p: np.ndarray, thr: float = 1.0) -> int:
    dry = p < thr; best = run = 0
    for d in dry:
        run = run + 1 if d else 0; best = max(best, run)
    return best


def main() -> None:
    t0 = time.time(); con = sqlite3.connect(DB)
    E = pd.read_parquet(os.path.join(PAPER, "tables", "exposure_series.parquet"))[["series_id", "iso3", "unit_key", "crop_code", "crop_family", "season_std", "harvest_year"]]
    cal = pd.read_sql("SELECT series_id, plant_month, harvest_month, season_start_offset, plant_doy, harvest_doy FROM calendar WHERE plant_month IS NOT NULL", con); con.close()
    cal["plant_doy"] = cal.plant_doy.round(); cal["harvest_doy"] = cal.harvest_doy.round(); cal["use_doy"] = cal.plant_doy.notna() & cal.harvest_doy.notna()
    E = E.merge(cal, on="series_id", how="inner")
    with Dataset(os.path.join(W, "unit_daily_temperature.nc")) as ds:
        units = np.array(ds["unit_key"][:], dtype=str)
    with Dataset(os.path.join(D, "unit_daily_cpc.nc")) as ds:
        t_cpc = np.datetime64("1970-01-01") + ds["time"][:].astype("timedelta64[D]")
    with Dataset(os.path.join(D, "unit_daily_chirps_2026.nc")) as ds:
        t_ch = np.datetime64("1970-01-01") + ds["time"][:].astype("timedelta64[D]")
    data_end = min(t_cpc[-1], t_ch[-1]); print(f"data end {data_end} (CPC {t_cpc[-1]}, CHIRPS {t_ch[-1]})")
    E = E[E.unit_key.isin(set(units))].copy(); uidx = pd.Series(np.arange(len(units)), index=units)
    # the target window of every series
    ws = []
    for r in E.itertuples():
        s, e = window(int(r.harvest_year), r.plant_month, r.harvest_month, r.season_start_offset, r.use_doy, r.plant_doy, r.harvest_doy)
        n = int((e - s).astype(int)) + 1; el = int((min(e, data_end) - s).astype(int)) + 1 if s <= data_end else 0
        ws.append(dict(series_id=r.series_id, target_start=str(s), target_end=str(e), n_days=n, elapsed_days=max(el, 0), frac_elapsed=max(el, 0) / n if n > 0 else np.nan))
    WS = pd.DataFrame(ws); WS["status"] = np.select([WS.elapsed_days.eq(0), WS.frac_elapsed >= 0.999, WS.frac_elapsed >= 0.5], ["not started", "complete", "past half"], "under way")
    WS = E[["series_id", "iso3", "unit_key", "crop_code", "crop_family", "season_std", "harvest_year"]].merge(WS, on="series_id"); WS["data_end"] = str(data_end)
    WS.to_csv(os.path.join(D, f"season_windows_{ISSUE}.csv"), index=False); print(WS.status.value_counts().to_dict())
    E = E.merge(WS[["series_id", "elapsed_days"]], on="series_id"); E = E[E.elapsed_days >= 20]
    # continuous unit daily arrays 1981 -> data_end: archive then near-real-time
    T0 = np.datetime64("1981-01-01"); n_days_total = int((data_end - T0).astype(int)) + 1
    rows = []
    specs_all = E.groupby(["unit_key", "plant_month", "harvest_month", "season_start_offset", "use_doy", "plant_doy", "harvest_doy", "elapsed_days"], dropna=False)
    for u0 in range(0, len(units), BLOCK):
        u1 = min(len(units), u0 + BLOCK); tb = time.time(); nu = u1 - u0
        sub = E[E.unit_key.isin(set(units[u0:u1]))]
        if len(sub) == 0:
            continue
        tA, A = read_block(os.path.join(W, "unit_daily_temperature.nc"), TV, u0, u1)
        tC, C = read_block(os.path.join(D, "unit_daily_cpc.nc"), TV, u0, u1)
        tP, P = read_block(os.path.join(W, "unit_daily_precip.nc"), PV + ["precip_source"], u0, u1)
        tH, H = read_block(os.path.join(D, "unit_daily_chirps_2026.nc"), PV, u0, u1)
        T = {v: np.full((n_days_total, nu), np.nan, dtype="float32") for v in TV}; Pd = {v: np.full((n_days_total, nu), np.nan, dtype="float32") for v in PV}
        ia = ((tA - T0).astype(int)); okA = (ia >= 0) & (ia < n_days_total)
        ic = ((tC - T0).astype(int)); okC = (ic >= 0) & (ic < n_days_total) & (tC > tA[-1])
        for v in TV:
            T[v][ia[okA]] = A[v][okA]; T[v][ic[okC]] = C[v][okC]
        ip = ((tP - T0).astype(int)); okP = (ip >= 0) & (ip < n_days_total); ih = ((tH - T0).astype(int)); okH = (ih >= 0) & (ih < n_days_total) & (tH > tP[-1])
        era5_units = P["precip_source"] > 0.5  # archive precipitation from ERA5: no 2026 rainfall for these
        for v in PV:
            Pd[v][ip[okP]] = P[v][okP]; Hv = H[v].copy(); Hv[:, era5_units] = np.nan; Pd[v][ih[okH]] = Hv[okH]
        del A, C, P, H
        for (uk, pm, hm, off, use_doy, pdoy, hdoy, el), grp in sub.groupby(["unit_key", "plant_month", "harvest_month", "season_start_offset", "use_doy", "plant_doy", "harvest_doy", "elapsed_days"], dropna=False):
            j = uidx[uk] - u0; sids = grp.series_id.to_numpy(); el = int(el)
            for Y in range(Y0, int(E.harvest_year.max()) + 1):
                s, _ = window(Y, pm, hm, off, use_doy, pdoy, hdoy); e = s + np.timedelta64(el - 1, "D")
                a0 = int((s - T0).astype(int)); a1 = a0 + el
                if a0 < 0 or a1 > n_days_total:
                    continue
                rec = dict(year=Y, window_start=str(s), elapsed_days=el)
                tx = T["tmax"][a0:a1, j]; okT = np.isfinite(tx); covT = okT.mean(); rec["t_coverage"] = round(float(covT), 3)
                if covT >= MIN_COVER:
                    rec.update(tavg_mean=float(np.nanmean(T["tavg"][a0:a1, j])), tmax_mean=float(np.nanmean(tx)), tmin_mean=float(np.nanmean(T["tmin"][a0:a1, j])),
                               gdd=float(np.nansum(T["gdd"][a0:a1, j])), edd30=float(np.nansum(T["edd30"][a0:a1, j])), tmax_p95_days=float(np.nansum(T["tmax_p95_frac"][a0:a1, j])))
                pr = Pd["precip"][a0:a1, j]; okP_ = np.isfinite(pr); covP = okP_.mean(); rec["p_coverage"] = round(float(covP), 3)
                if covP >= MIN_COVER:
                    p = np.nan_to_num(pr); r5 = np.convolve(p, np.ones(5), "valid") if len(p) >= 5 else p
                    rec.update(precip=float(p.sum()), wet_days=float(np.nansum(Pd["wet_frac"][a0:a1, j])), precip_p95_days=float(np.nansum(Pd["precip_p95_frac"][a0:a1, j])),
                               rx5day=float(r5.max()), cdd=longest_dry(p))
                for sid in sids:
                    rows.append(dict(series_id=int(sid), **rec))
        print(f"  units {u0}-{u1}: {len(sub):,} series, rows so far {len(rows):,}; {time.time()-tb:.0f}s", flush=True)
    out = pd.DataFrame(rows)
    # A crop planted in 2026 and harvested in 2027 needs its 2027-labelled
    # weather row. Keep historical harvest years and each series' actual target.
    targets = E.set_index("series_id").harvest_year
    out = out[(out.year < YN) | out.year.eq(out.series_id.map(targets))].copy()
    current = out[out.year.eq(out.series_id.map(targets))].merge(
        WS[["series_id", "target_start"]], on="series_id", validate="one_to_one")
    assert current.window_start.eq(current.target_start).all(), "Current weather must start in the target growing season"
    for c in ["tavg_mean", "tmax_mean", "tmin_mean", "gdd", "edd30", "tmax_p95_days", "precip", "wet_days", "precip_p95_days", "rx5day", "cdd"]:
        if c not in out:
            out[c] = np.nan
    out.to_parquet(os.path.join(D, f"season_todate_{ISSUE}.parquet"), index=False)
    print(f"{len(out):,} series-years for {out.series_id.nunique():,} series; 2026 rows with temperature {out[out.year.eq(2026)].tmax_mean.notna().sum():,}, with rain {out[out.year.eq(2026)].precip.notna().sum():,}; {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
