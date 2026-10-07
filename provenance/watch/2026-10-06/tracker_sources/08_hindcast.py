"""Does the season-to-date weather carry predictive skill for yield? A leave-one-year-out hindcast at today's fraction of the season.

For every country-crop-season panel of the tracker we repeat the third screen's estimate for each past harvest year
as if it were the current one: the season-to-date metrics over the same elapsed fraction of the window, the
detrending, the within-unit transformation and the regression coefficients all fitted on the other years only, then
applied to the held-out year. Three predictors are compared on the same held-out observations, production-weighted
to the panel level: trend only (predicted anomaly zero), the ENSO-only estimate (direct slope on the index observed
over the elapsed months), and the weather-implied estimate (the six season-to-date metrics). Skill is one minus the
ratio of mean squared errors against the trend-only baseline, so zero means no better than trend and negative means
worse; the correlation between predicted and observed panel anomalies is reported beside it.

Why leave-one-year-out and not blocks: the yield anomalies are detrended within unit and the metrics are weather,
whose year-to-year autocorrelation at these windows is small; a three-year block variant is run as a check and
reported as skill_block.

Outputs: tables/hindcast_skill_<issue>.csv (one row per panel), tables/hindcast_years_<issue>.csv (one row per panel
and held-out year with the three predictions and the observed anomaly).

    python 4_ag/food_security_2026_27/season_tracker/scripts/08_hindcast.py [--issue 2026-09]
"""
from __future__ import annotations

import importlib.util
import os
import sqlite3
import sys
import time

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__)); S = os.path.dirname(HERE); D = os.path.join(S, "data"); TAB = os.path.join(S, "tables")
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(S)))
sys.path.insert(0, os.path.join(ROOT, "1_daily_variability", "lib"))
from enso import DERIVED  # noqa: E402

DB = os.path.join(DERIVED, "merged_panel", "enso_ag.sqlite"); PAPER = os.path.join(ROOT, "4_ag", "food_security_2026_27", "paper")
ISSUE = sys.argv[sys.argv.index("--issue") + 1] if "--issue" in sys.argv else "2026-09"
spec = importlib.util.spec_from_file_location("a04", os.path.join(HERE, "04_analysis.py")); a04 = importlib.util.module_from_spec(spec); spec.loader.exec_module(a04)
METRICS = ["lprecip", "wet_days", "cdd", "tmax_mean", "tmax_p95_days", "edd30"]
MIN_SERIES, MIN_YEARS, MIN_FRAC = 5, 20, 0.30


def within_fit_apply(g: pd.DataFrame, cols: list[str], train: np.ndarray, key: str = "series_id", tcol: str = "year"):
    """Residuals from each series' mean and trend fitted on the training rows only, applied to all rows."""
    fit = g[train]; t = fit[tcol].astype(float); tm = t.groupby(fit[key]).transform("mean"); tmean = t.groupby(fit[key]).mean()
    out = {}
    for c in cols:
        y = fit[c].astype(float); ym = y.groupby(fit[key]).transform("mean"); ymean = y.groupby(fit[key]).mean()
        sxy = ((t - tm) * (y - ym)).groupby(fit[key]).sum(); sxx = ((t - tm) ** 2).groupby(fit[key]).sum()
        slope = (sxy / sxx.replace(0, np.nan)).fillna(0.0)
        ref = ymean.reindex(g[key]).to_numpy() + slope.reindex(g[key]).to_numpy() * (g[tcol].astype(float).to_numpy() - tmean.reindex(g[key]).to_numpy())
        out[c] = g[c].astype(float).to_numpy() - ref
    return pd.DataFrame(out, index=g.index)


def ols(X: np.ndarray, y: np.ndarray) -> np.ndarray:
    return np.linalg.lstsq(X, y, rcond=None)[0]


def main() -> None:
    t0 = time.time(); con = sqlite3.connect(DB)
    Z = pd.read_parquet(os.path.join(D, f"season_todate_{ISSUE}.parquet")); WS = pd.read_csv(os.path.join(D, f"season_windows_{ISSUE}.csv"))
    meta = pd.read_sql("SELECT series_id, iso3, crop_code, crop_family, season_std, tier, staple FROM series WHERE tier < 3", con)
    obs = pd.read_sql("""SELECT series_id, harvest_year AS year, yield_t_ha, production_t FROM v_observations WHERE "primary"=1 AND yield_t_ha > 0 AND tier < 3 AND harvest_year >= 1981""", con)
    err = pd.read_sql("SELECT DISTINCT series_id, harvest_year AS year FROM qc_flags f JOIN observations o USING(series_id, year_label) WHERE f.severity='error'", con)
    obs = obs.merge(err.assign(bad=1), on=["series_id", "year"], how="left"); obs = obs[obs.bad.isna()].drop(columns="bad")
    enso = pd.read_sql("SELECT year, month, nino34_rel FROM enso_monthly", con).set_index(["year", "month"]); con.close()
    Z = Z.merge(meta, on="series_id").merge(WS[["series_id", "frac_elapsed", "status"]], on="series_id")
    Z = Z[Z.staple.eq(1) & (Z.frac_elapsed >= MIN_FRAC) & (Z.year < 2026)].copy()
    Z["lprecip"] = np.log(Z.precip.clip(lower=1.0)); Z.loc[Z.precip.isna(), "lprecip"] = np.nan
    Z["idx"] = [a04.index_todate(enso, ws, el) for ws, el in zip(Z.window_start, Z.elapsed_days)]
    pw = obs[obs.year.between(2010, 2025)].groupby("series_id").production_t.mean(); Z["w"] = Z.series_id.map(pw).fillna(pw.median())
    Z = Z.merge(obs[["series_id", "year", "yield_t_ha"]], on=["series_id", "year"], how="inner"); Z["ly"] = np.log(Z.yield_t_ha)
    rows, yrows = [], []
    for (iso, crop, season), g in Z.groupby(["iso3", "crop_code", "season_std"]):
        avail = [m for m in METRICS if g[m].notna().mean() > 0.6]
        g = g.dropna(subset=avail + ["ly", "idx"]).copy(); g = g[g.groupby("series_id").ly.transform("size") >= 10].sort_values(["series_id", "year"])
        years = np.sort(g.year.unique())
        if g.series_id.nunique() < MIN_SERIES or len(years) < MIN_YEARS or not avail:
            continue
        preds = []
        for hold in years:
            test = g.year.eq(hold).to_numpy(); train = ~test
            A = within_fit_apply(g, ["ly", "idx"] + avail, train)
            Xtr = A.loc[train, avail].to_numpy(); ytr = A.loc[train, "ly"].to_numpy(); ok = np.isfinite(Xtr).all(axis=1) & np.isfinite(ytr)
            if ok.sum() < 30:
                continue
            b = ols(Xtr[ok], ytr[ok]); bd = float(np.sum(A.loc[train, "idx"].to_numpy()[ok] * ytr[ok]) / max(np.sum(A.loc[train, "idx"].to_numpy()[ok] ** 2), 1e-9))
            Xte = A.loc[test, avail].to_numpy(); okt = np.isfinite(Xte).all(axis=1); wts = g.loc[test, "w"].to_numpy()[okt]
            if okt.sum() < 3:
                continue
            obs_an = float(np.average(A.loc[test, "ly"].to_numpy()[okt], weights=wts)); p_w = float(np.average(Xte[okt] @ b, weights=wts)); p_e = float(np.average(bd * A.loc[test, "idx"].to_numpy()[okt], weights=wts))
            preds.append((hold, obs_an, p_w, p_e, int(okt.sum())))
        if len(preds) < 15:
            continue
        P = pd.DataFrame(preds, columns=["year", "observed", "weather", "enso", "series"]); P["iso3"], P["crop_code"], P["season_std"] = iso, crop, season
        mse_t = np.mean(P.observed ** 2); mse_w = np.mean((P.observed - P.weather) ** 2); mse_e = np.mean((P.observed - P.enso) ** 2)
        # three-year block variant: hold out the year and its neighbours when fitting
        pb = []
        for hold in years:
            test = g.year.eq(hold).to_numpy(); train = ~g.year.between(hold - 1, hold + 1).to_numpy()
            A = within_fit_apply(g, ["ly"] + avail, train); Xtr = A.loc[train, avail].to_numpy(); ytr = A.loc[train, "ly"].to_numpy(); ok = np.isfinite(Xtr).all(axis=1) & np.isfinite(ytr)
            Xte = A.loc[test, avail].to_numpy(); okt = np.isfinite(Xte).all(axis=1)
            if ok.sum() < 30 or okt.sum() < 3:
                continue
            b = ols(Xtr[ok], ytr[ok]); wts = g.loc[test, "w"].to_numpy()[okt]
            pb.append((float(np.average(A.loc[test, "ly"].to_numpy()[okt], weights=wts)), float(np.average(Xte[okt] @ b, weights=wts))))
        skill_block = 1 - np.mean([(o - p) ** 2 for o, p in pb]) / np.mean([o ** 2 for o, _ in pb]) if len(pb) >= 15 else np.nan
        rows.append(dict(iso3=iso, crop_code=crop, season_std=season, crop_family=g.crop_family.iloc[0], frac_elapsed=round(float(g.frac_elapsed.median()), 3), years=len(P), series=int(g.series_id.nunique()),
                         rmse_trend_pct=100 * np.sqrt(mse_t), rmse_enso_pct=100 * np.sqrt(mse_e), rmse_weather_pct=100 * np.sqrt(mse_w),
                         skill_weather_vs_trend=1 - mse_w / mse_t, skill_enso_vs_trend=1 - mse_e / mse_t, skill_weather_vs_enso=1 - mse_w / mse_e,
                         corr_weather=float(np.corrcoef(P.observed, P.weather)[0, 1]), corr_enso=float(np.corrcoef(P.observed, P.enso)[0, 1]) if P.enso.std() > 0 else np.nan,
                         skill_block=skill_block, metrics=",".join(avail)))
        yrows.append(P)
    SK = pd.DataFrame(rows).sort_values("skill_weather_vs_trend", ascending=False); YR = pd.concat(yrows, ignore_index=True)
    SK.to_csv(os.path.join(TAB, f"hindcast_skill_{ISSUE}.csv"), index=False, float_format="%.4g"); YR.to_csv(os.path.join(TAB, f"hindcast_years_{ISSUE}.csv"), index=False, float_format="%.5g")
    pd.set_option("display.width", 220)
    print(f"{len(SK)} panels hindcast; weather beats trend in {(SK.skill_weather_vs_trend > 0).sum()}, beats ENSO-only in {(SK.skill_weather_vs_enso > 0).sum()}; median skill vs trend {SK.skill_weather_vs_trend.median():.3f}; {time.time()-t0:.0f}s")
    print(SK[["iso3", "crop_code", "season_std", "frac_elapsed", "years", "rmse_trend_pct", "rmse_enso_pct", "rmse_weather_pct", "skill_weather_vs_trend", "skill_enso_vs_trend", "skill_block", "corr_weather"]].round(3).head(40).to_string(index=False))


if __name__ == "__main__":
    main()
