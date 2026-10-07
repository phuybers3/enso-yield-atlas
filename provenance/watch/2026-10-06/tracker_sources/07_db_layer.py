"""The season-to-date layer of the shared database: temperature and rainfall anomalies to date.

Three tables and a view are written to enso_ag.sqlite and exported beside the other layers, replacing the previous
issue's rows each time the tracker runs:

  weather_todate           one row per series and year 1981-<current>: the season metrics over the part of the
                           series' current window that has run by the data end, and the same partial window in every
                           earlier year (03_season_todate.py). Columns follow weather_season.
  weather_todate_anomaly   one row per series for the current issue: the current-year values, the series' reference
                           (its own mean and linear trend over 1981-<current-1> for the same partial window), the
                           anomaly, the anomaly in units of the series' detrended spread (z) and its percentile rank in
                           the series' history; rainfall also as percent of reference. The panel verdict and the panel
                           rainfall and TMAX percentiles of 04_analysis.py are attached where the series' panel was scored.
  weather_monthly_anomaly  one row per unit and month from November 2024 (where the archive temperature ends) to the
                           last month with data: monthly temperature (adjusted CPC), rainfall (archive CHIRPS to 2025,
                           CHIRPS 2026 after) and their anomalies against the unit's 1991-2020 monthly climatology
                           from weather_monthly.parquet; a crop-independent layer for maps by month.
  v_weather_todate         weather_todate_anomaly joined to v_series (country, unit, crop, season, calendar).

Sources rows for the CPC and CHIRPS preliminary products, and meta rows for the issue and data end, are added.
Exports: merged_panel/export/weather_todate.parquet, weather_todate_anomaly.parquet (+ .csv), weather_monthly_anomaly.parquet
(+ .csv); the manifest is refreshed by 2_data/build/refresh_manifest.py.

    python 4_ag/food_security_2026_27/season_tracker/scripts/07_db_layer.py [--issue 2026-09]
"""
from __future__ import annotations

import importlib.util
import os
import sqlite3
import subprocess
import sys
import time

import numpy as np
import pandas as pd
from netCDF4 import Dataset

HERE = os.path.dirname(os.path.abspath(__file__)); S = os.path.dirname(HERE); D = os.path.join(S, "data"); TAB = os.path.join(S, "tables")
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(S)))
sys.path.insert(0, os.path.join(ROOT, "1_daily_variability", "lib"))
from enso import DERIVED  # noqa: E402

MP = os.path.join(DERIVED, "merged_panel"); DB = os.path.join(MP, "enso_ag.sqlite"); EXPORT = os.path.join(MP, "export"); W = os.path.join(DERIVED, "weather")
ISSUE = sys.argv[sys.argv.index("--issue") + 1] if "--issue" in sys.argv else "2026-09"
CUR = int(ISSUE[:4])
spec = importlib.util.spec_from_file_location("a04", os.path.join(HERE, "04_analysis.py")); a04 = importlib.util.module_from_spec(spec); spec.loader.exec_module(a04)
LEVEL = ["tavg_mean", "tmax_mean", "tmin_mean", "gdd", "edd30", "tmax_p95_days", "wet_days", "precip_p95_days", "cdd", "rx5day"]
CLIM = (1991, 2020)


def series_anomalies(Z: pd.DataFrame, WS: pd.DataFrame) -> pd.DataFrame:
    """Current-year value, reference, anomaly, z and percentile rank per series and metric."""
    Z = Z.sort_values(["series_id", "year"]).copy(); Z["lprecip"] = np.log(Z.precip.clip(lower=1.0)); Z.loc[Z.precip.isna(), "lprecip"] = np.nan
    cols = LEVEL + ["lprecip"]
    A = a04.within_anom(Z, cols, "series_id"); A["series_id"] = Z.series_id.to_numpy(); A["year"] = Z.year.to_numpy()
    targets = WS.set_index("series_id").harvest_year
    hist = A[A.year < CUR]; cur = A[A.year.eq(A.series_id.map(targets))].set_index("series_id")
    sd = hist.groupby("series_id")[cols].std(ddof=2); n = hist.groupby("series_id")[cols].count()
    # percentile rank of the current year's raw value among the series' earlier raw values (no trend removal)
    Zc = Z[Z.year.eq(Z.series_id.map(targets))].set_index("series_id"); Zh = Z[Z.year < CUR]
    out = pd.DataFrame(index=cur.index); out["issue"] = ISSUE; out["year"] = cur.year
    assert Zc.window_start.eq(WS.set_index("series_id").target_start.reindex(Zc.index)).all()
    for c in cols:
        lab = "precip" if c == "lprecip" else c
        out[f"{lab}_{CUR}" if False else f"{lab}_value"] = Zc[c].reindex(out.index) if c != "lprecip" else Zc["precip"].reindex(out.index)
        anom = cur[c].reindex(out.index)
        if c == "lprecip":
            out["precip_reference"] = (Zc["lprecip"].reindex(out.index) - anom).pipe(np.exp)
            out["precip_anom_pct"] = 100 * (np.exp(anom) - 1); out["precip_z"] = anom / sd[c].reindex(out.index)
        else:
            out[f"{lab}_reference"] = Zc[c].reindex(out.index) - anom; out[f"{lab}_anom"] = anom; out[f"{lab}_z"] = anom / sd[c].reindex(out.index)
        # empirical percentile rank of the current raw value in the series' history
        h = Zh[["series_id", c]].dropna(); v = Zc[c].reindex(h.series_id.unique())
        rank = h.groupby("series_id")[c].apply(lambda s: float((s < v[s.name]).mean() + 0.5 * (s == v[s.name]).mean()) if np.isfinite(v[s.name]) else np.nan)
        out[f"{lab}_pct_rank"] = rank.reindex(out.index); out[f"{lab}_n_years"] = n[c].reindex(out.index)
    out = out.reset_index().merge(WS[["series_id", "target_start", "target_end", "n_days", "elapsed_days", "frac_elapsed", "status", "data_end", "harvest_year"]].rename(columns={"harvest_year": "target_year"}), on="series_id", how="left")
    return out


def monthly_anomalies() -> pd.DataFrame:
    t0 = time.time(); wm = pd.read_parquet(os.path.join(EXPORT, "weather_monthly.parquet"))
    base = wm[wm.year.between(*CLIM)]
    tv = ["tavg", "tmax", "tmin", "tmax_p95_days", "edd30"]; pv = ["precip", "wet_days", "precip_p95_days"]
    clim = base.groupby(["unit_key", "month"])[tv + pv].mean(); csd = base.groupby(["unit_key", "month"])[["tavg", "tmax", "precip"]].std(ddof=1)
    clim.columns = [f"{c}_clim" for c in clim.columns]; csd.columns = [f"{c}_clim_sd" for c in csd.columns]
    # near-real-time temperature months from the adjusted CPC unit series, after the archive's last month (October 2024)
    with Dataset(os.path.join(D, "unit_daily_cpc.nc")) as ds:
        t = pd.DatetimeIndex(np.datetime64("1970-01-01") + ds["time"][:].astype("timedelta64[D]")); units = np.array(ds["unit_key"][:], dtype=str)
        sel = np.where(t >= pd.Timestamp("2024-11-01"))[0]; tt = t[sel]
        T = {v: ds[v][sel, :].filled(np.nan) for v in ["tavg", "tmax", "tmin", "tmax_p95_frac", "edd30"]}
    ym = (tt.year * 12 + tt.month - 1).to_numpy(); starts = np.r_[0, np.nonzero(np.diff(ym))[0] + 1]; cnt = np.diff(np.r_[starts, len(tt)])
    def mmean(X):
        ok = ~np.isnan(X); s = np.add.reduceat(np.nan_to_num(X), starts, axis=0); k = np.add.reduceat(ok.astype("float32"), starts, axis=0)
        with np.errstate(invalid="ignore", divide="ignore"):
            m = s / k
        m[k < 0.8 * cnt[:, None]] = np.nan; return m
    def msum(X):
        ok = ~np.isnan(X); s = np.add.reduceat(np.nan_to_num(X), starts, axis=0); k = np.add.reduceat(ok.astype("float32"), starts, axis=0)
        s[k < 0.8 * cnt[:, None]] = np.nan; return s
    months = ym[starts]; nm = len(months)
    rows = {"unit_key": np.repeat(units, nm), "year": np.tile(months // 12, len(units)), "month": np.tile(months % 12 + 1, len(units)),
            "tavg": mmean(T["tavg"]).T.ravel(), "tmax": mmean(T["tmax"]).T.ravel(), "tmin": mmean(T["tmin"]).T.ravel(),
            "tmax_p95_days": msum(T["tmax_p95_frac"]).T.ravel(), "edd30": msum(T["edd30"]).T.ravel(), "n_days": np.tile(cnt, len(units))}
    M = pd.DataFrame(rows); M["temperature_source"] = "cpc_adjusted"
    # rainfall: the archive monthly file through 2025, CHIRPS 2026 after
    arch = wm[(wm.year * 12 + wm.month - 1) >= 2024 * 12 + 10][["unit_key", "year", "month"] + pv]
    with Dataset(os.path.join(D, "unit_daily_chirps_2026.nc")) as ds:
        tp = pd.DatetimeIndex(np.datetime64("1970-01-01") + ds["time"][:].astype("timedelta64[D]")); up = np.array(ds["unit_key"][:], dtype=str)
        P = {v: ds[v][:, :].filled(np.nan) for v in ["precip", "wet_frac", "precip_p95_frac"]}
    ymp = (tp.year * 12 + tp.month - 1).to_numpy(); sp_ = np.r_[0, np.nonzero(np.diff(ymp))[0] + 1]; cntp = np.diff(np.r_[sp_, len(tp)])
    def psum(X):
        ok = ~np.isnan(X); s = np.add.reduceat(np.nan_to_num(X), sp_, axis=0); k = np.add.reduceat(ok.astype("float32"), sp_, axis=0); s[k < 0.8 * cntp[:, None]] = np.nan; return s
    mp = ymp[sp_]
    R26 = pd.DataFrame({"unit_key": np.repeat(up, len(mp)), "year": np.tile(mp // 12, len(up)), "month": np.tile(mp % 12 + 1, len(up)),
                        "precip": psum(P["precip"]).T.ravel(), "wet_days": psum(P["wet_frac"]).T.ravel(), "precip_p95_days": psum(P["precip_p95_frac"]).T.ravel(), "p_days": np.tile(cntp, len(up))})
    rain = pd.concat([arch.assign(rain_source="archive"), R26.assign(rain_source="chirps_2026")], ignore_index=True)
    M = M.merge(rain, on=["unit_key", "year", "month"], how="left")
    M = M.merge(clim.reset_index(), on=["unit_key", "month"], how="left").merge(csd.reset_index(), on=["unit_key", "month"], how="left")
    for v in ["tavg", "tmax", "tmin"]:
        M[f"{v}_anom"] = M[v] - M[f"{v}_clim"]
    M["tavg_z"] = M.tavg_anom / M.tavg_clim_sd; M["tmax_z"] = M.tmax_anom / M.tmax_clim_sd
    M["tmax_p95_days_anom"] = M.tmax_p95_days - M.tmax_p95_days_clim; M["edd30_anom"] = M.edd30 - M.edd30_clim
    with np.errstate(invalid="ignore", divide="ignore"):
        M["precip_pct_of_normal"] = 100 * M.precip / M.precip_clim.where(M.precip_clim > 1.0)
    M["precip_z"] = (M.precip - M.precip_clim) / M.precip_clim_sd; M["wet_days_anom"] = M.wet_days - M.wet_days_clim; M["precip_p95_days_anom"] = M.precip_p95_days - M.precip_p95_days_clim
    M["partial_month"] = (M.n_days < 28).astype(int); M["issue"] = ISSUE
    keep = ["issue", "unit_key", "year", "month", "n_days", "partial_month", "temperature_source", "rain_source", "tavg", "tmax", "tmin", "tmax_p95_days", "edd30", "precip", "wet_days", "precip_p95_days",
            "tavg_clim", "tmax_clim", "tmin_clim", "precip_clim", "wet_days_clim", "tmax_p95_days_clim", "tavg_anom", "tmax_anom", "tmin_anom", "tavg_z", "tmax_z", "tmax_p95_days_anom", "edd30_anom",
            "precip_pct_of_normal", "precip_z", "wet_days_anom", "precip_p95_days_anom"]
    M = M[keep].sort_values(["unit_key", "year", "month"]).reset_index(drop=True)
    print(f"monthly anomalies: {len(M):,} unit-months, {M.year.min()}-{M.month[M.year.eq(M.year.min())].min():02d} to {M.year.max()}-{M.month[M.year.eq(M.year.max())].max():02d}; {time.time()-t0:.0f}s")
    return M


def main() -> None:
    t0 = time.time()
    Z = pd.read_parquet(os.path.join(D, f"season_todate_{ISSUE}.parquet")); WS = pd.read_csv(os.path.join(D, f"season_windows_{ISSUE}.csv"))
    # ---- weather_todate --------------------------------------------------------------------------------------------
    T = Z.merge(WS[["series_id", "harvest_year", "frac_elapsed", "data_end"]].rename(columns={"harvest_year": "target_year"}), on="series_id", how="left")
    T.insert(0, "issue", ISSUE)
    T = T[["issue", "series_id", "target_year", "year", "window_start", "elapsed_days", "frac_elapsed", "data_end", "t_coverage", "p_coverage",
           "tavg_mean", "tmax_mean", "tmin_mean", "gdd", "edd30", "tmax_p95_days", "precip", "wet_days", "precip_p95_days", "rx5day", "cdd"]]
    # ---- weather_todate_anomaly ------------------------------------------------------------------------------------
    A = series_anomalies(Z, WS)
    PT = pd.read_csv(os.path.join(TAB, f"panel_tracker_{ISSUE}.csv")); con = sqlite3.connect(DB)
    ser = pd.read_sql("SELECT series_id, iso3, crop_code, season_std FROM series", con)
    A = A.merge(ser, on="series_id", how="left").merge(PT[["iso3", "crop_code", "season_std", "verdict", "rain_pct", "tmax_pct", "nowcast_pct", "index_medium_pct"]]
                                                        .rename(columns={"verdict": "panel_verdict", "rain_pct": "panel_rain_percentile", "tmax_pct": "panel_tmax_percentile", "nowcast_pct": "panel_nowcast_pct", "index_medium_pct": "panel_index_medium_pct"}),
                on=["iso3", "crop_code", "season_std"], how="left").drop(columns=["iso3", "crop_code", "season_std"])
    # ---- weather_monthly_anomaly -----------------------------------------------------------------------------------
    M = monthly_anomalies()
    # ---- write -----------------------------------------------------------------------------------------------------
    T.to_sql("weather_todate", con, if_exists="replace", index=False); con.execute("CREATE INDEX IF NOT EXISTS ix_weather_todate ON weather_todate(series_id, year)")
    A.to_sql("weather_todate_anomaly", con, if_exists="replace", index=False); con.execute("CREATE INDEX IF NOT EXISTS ix_weather_todate_anomaly ON weather_todate_anomaly(series_id)")
    M.to_sql("weather_monthly_anomaly", con, if_exists="replace", index=False); con.execute("CREATE INDEX IF NOT EXISTS ix_weather_monthly_anomaly ON weather_monthly_anomaly(unit_key, year, month)")
    con.execute("DROP VIEW IF EXISTS v_weather_todate")
    con.execute("""CREATE VIEW v_weather_todate AS SELECT s.iso3, s.country, s.unit_key, s.unit_name, s.admin_level, s.lon, s.lat, s.crop_code, s.crop_family, s.season_std, s.tier, s.staple,
                   s.plant_month, s.harvest_month, a.* FROM weather_todate_anomaly a JOIN v_series s USING(series_id)""")
    for sid, name, cit, loc in [("cpc_global_temp", "CPC Global Unified daily TMAX and TMIN, 0.5 degree, gauge-based (NOAA PSL); adjusted per cell and calendar month to Berkeley Earth over 2015-01 to 2024-10, with the day-to-day spread scaled at 1 degree; the temperature source after October 2024",
                                 "NOAA Climate Prediction Center, CPC Global Unified Temperature; https://psl.noaa.gov/data/gridded/data.cpc.globaltemp.html", "4_ag/food_security_2026_27/season_tracker/data/cpc"),
                                ("chirps_prelim", "CHIRPS v2.0 daily precipitation for the current year: final file where released, preliminary monthly files after it",
                                 "Funk et al. (2015), Scientific Data 2, 150066; https://data.chc.ucsb.edu/products/CHIRPS-2.0/", "4_ag/food_security_2026_27/season_tracker/data/chirps")]:
        con.execute("DELETE FROM sources WHERE source_id=?", (sid,))
        con.execute("INSERT INTO sources(source_id, tier, name, citation, license, retrieved, location) VALUES (?,?,?,?,?,?,?)", (sid, None, name, cit, "public domain (NOAA)" if sid.startswith("cpc") else "CC BY 4.0 (CHC)", time.strftime("%Y-%m-%d"), loc))
    data_end = str(WS.data_end.iloc[0])
    for k, v in [("todate_issue", ISSUE), ("todate_data_end", data_end), ("todate_built_utc", time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())),
                 ("todate_series", str(A.series_id.nunique())), ("todate_rows", str(len(T))), ("monthly_anomaly_rows", str(len(M)))]:
        con.execute("DELETE FROM meta WHERE key=?", (k,)); con.execute("INSERT INTO meta(key, value) VALUES (?,?)", (k, v))
    con.commit()
    # ---- exports ---------------------------------------------------------------------------------------------------
    T.to_parquet(os.path.join(EXPORT, "weather_todate.parquet"), index=False)
    A.to_parquet(os.path.join(EXPORT, "weather_todate_anomaly.parquet"), index=False); A.to_csv(os.path.join(EXPORT, "weather_todate_anomaly.csv"), index=False, float_format="%.4g")
    M.to_parquet(os.path.join(EXPORT, "weather_monthly_anomaly.parquet"), index=False); M.to_csv(os.path.join(EXPORT, "weather_monthly_anomaly.csv.gz"), index=False, float_format="%.4g", compression="gzip")
    pd.read_sql("SELECT * FROM meta", con).to_csv(os.path.join(EXPORT, "meta.csv"), index=False); pd.read_sql("SELECT * FROM meta", con).to_parquet(os.path.join(EXPORT, "meta.parquet"), index=False)
    pd.read_sql("SELECT * FROM sources", con).to_csv(os.path.join(EXPORT, "sources.csv"), index=False); pd.read_sql("SELECT * FROM sources", con).to_parquet(os.path.join(EXPORT, "sources.parquet"), index=False)
    con.close()
    subprocess.run([sys.executable, os.path.join(ROOT, "2_data", "build", "refresh_manifest.py")], check=False)
    print(f"weather_todate {len(T):,} rows; weather_todate_anomaly {len(A):,} series; weather_monthly_anomaly {len(M):,} rows; data end {data_end}; {time.time()-t0:.0f}s")
    sample = A[A.frac_elapsed >= 0.5].merge(ser, on="series_id")
    print(sample.groupby("iso3").apply(lambda d: pd.Series({"series": len(d), "precip_anom_pct_med": d.precip_anom_pct.median(), "tmax_anom_med": d.tmax_mean_anom.median(), "tmax_pct_rank_med": d.tmax_mean_pct_rank.median()}), include_groups=False)
          .sort_values("series", ascending=False).head(15).round(2).to_string())


if __name__ == "__main__":
    main()
