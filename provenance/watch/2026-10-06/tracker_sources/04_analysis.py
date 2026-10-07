"""The season against the El Nino expectation, and what the weather so far implies for yields.

For every country-crop-season panel of the paper (primary staple series, tiers 1 and 2), on the season-to-date
metrics of 03_season_todate.py:

Expectation. Each series' metric is residualized on its own mean and linear trend over 1981-2025 (the paper's
within transformation), the residuals are averaged over the panel with production weights to one number per year,
and that panel anomaly is regressed on the relative Nino 3.4 index averaged over the elapsed months of the window.
The slope times the 2026 index gives the expected anomaly; the residual spread gives its interval; the 2026 observed
anomaly's percentile in that conditional distribution is the concordance score. The mean anomaly of the strong
El Nino years the archive covers (1982, 1997, 2015, or the following harvest year for windows that cross the new year)
is the composite check.

Nowcast. Detrended log yield on the six season-to-date metrics, within unit and clustered by harvest year, over
1981-2025; the coefficients applied to the 2026 anomalies give the weather-implied yield anomaly, aggregated by
production. Beside it: the paper's index-implied medium change for the same series (exposure_series.parquet) and
the panel's direct slope times the index observed so far.

Outputs (season_tracker/tables): panel_tracker_<issue>.csv (one row per panel), panel_metrics_<issue>.csv (one row
per panel and metric), series_anomalies_<issue>.parquet (2026 anomalies per series, for the maps).

    python 4_ag/food_security_2026_27/season_tracker/scripts/04_analysis.py [--issue 2026-09]
"""
from __future__ import annotations

import importlib.util
import os
import sqlite3
import sys
import time

import numpy as np
import pandas as pd
from scipy import stats

HERE = os.path.dirname(os.path.abspath(__file__)); S = os.path.dirname(HERE); D = os.path.join(S, "data"); TAB = os.path.join(S, "tables")
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(S)))
sys.path.insert(0, os.path.join(ROOT, "1_daily_variability", "lib"))
from enso import DERIVED  # noqa: E402

DB = os.path.join(DERIVED, "merged_panel", "enso_ag.sqlite"); PAPER = os.path.join(ROOT, "4_ag", "food_security_2026_27", "paper")
ISSUE = sys.argv[sys.argv.index("--issue") + 1] if "--issue" in sys.argv else "2026-09"
spec = importlib.util.spec_from_file_location("r13", os.path.join(ROOT, "4_ag", "food_security_2026_27", "scripts", "13_enso_response.py"))
r13 = importlib.util.module_from_spec(spec); spec.loader.exec_module(r13)
METRICS = {"lprecip": ("log season rainfall", "%"), "wet_days": ("wet days", "d"), "cdd": ("longest dry spell", "d"), "tmax_mean": ("mean TMAX", "°C"), "tmax_p95_days": ("hot days", "d"), "edd30": ("degree days above 30 °C", "°C d")}
ANALOG = [1982, 1997, 2015]
MIN_SERIES, MIN_YEARS, MIN_FRAC = 5, 20, 0.30
_INDEX_SOURCE = None
_INDEX_WINDOWS = {}


def within_anom(g: pd.DataFrame, cols: list[str], key: str, tcol: str = "year") -> pd.DataFrame:
    """Residuals from each series' own mean and linear trend, fitted on the years before 2026 and applied to all years.

    The 2026 anomaly is measured from the series' fitted mean and trend extrapolated to 2026."""
    fit = g[g[tcol] < 2026]; t = fit[tcol].astype(float); tm = t.groupby(fit[key]).transform("mean"); tmean = t.groupby(fit[key]).mean()
    out = {}
    for c in cols:
        y = fit[c].astype(float); ym = y.groupby(fit[key]).transform("mean"); ymean = y.groupby(fit[key]).mean()
        sxy = ((t - tm) * (y - ym)).groupby(fit[key]).sum(); sxx = ((t - tm) ** 2).groupby(fit[key]).sum()
        slope = (sxy / sxx.replace(0, np.nan)).fillna(0.0)
        ref = ymean.reindex(g[key]).to_numpy() + slope.reindex(g[key]).to_numpy() * (g[tcol].astype(float).to_numpy() - tmean.reindex(g[key]).to_numpy())
        out[c] = g[c].astype(float).to_numpy() - ref
    return pd.DataFrame(out, index=g.index)


def cluster_ols(X: np.ndarray, y: np.ndarray, groups: np.ndarray):
    XtX = X.T @ X; beta = np.linalg.solve(XtX, X.T @ y); e = y - X @ beta; Sm = np.zeros_like(XtX)
    for gval in np.unique(groups):
        m = groups == gval; s = X[m].T @ e[m]; Sm += np.outer(s, s)
    G = len(np.unique(groups)); V = np.linalg.solve(XtX, np.linalg.solve(XtX, Sm).T) * (G / max(G - 1, 1))
    return beta, V


def index_todate(enso: pd.DataFrame, start: str, elapsed: int) -> float:
    """Mean relative Nino 3.4 over the months the elapsed window touches, on the months the table has."""
    global _INDEX_SOURCE, _INDEX_WINDOWS
    if _INDEX_SOURCE is not enso:
        _INDEX_SOURCE = enso
        _INDEX_WINDOWS = {}
    key = (start, int(elapsed))
    if key in _INDEX_WINDOWS:
        return _INDEX_WINDOWS[key]
    s = pd.Timestamp(start); e = s + pd.Timedelta(days=int(elapsed) - 1)
    months = pd.period_range(s.to_period("M"), e.to_period("M"), freq="M")
    v = enso.reindex([(p.year, p.month) for p in months]).nino34_rel
    value = float(v.mean()) if v.notna().sum() >= max(1, len(months) // 2) else np.nan
    _INDEX_WINDOWS[key] = value
    return value


def main() -> None:
    t0 = time.time(); con = sqlite3.connect(DB); os.makedirs(TAB, exist_ok=True)
    Z = pd.read_parquet(os.path.join(D, f"season_todate_{ISSUE}.parquet")); WS = pd.read_csv(os.path.join(D, f"season_windows_{ISSUE}.csv"))
    E = pd.read_parquet(os.path.join(PAPER, "tables", "exposure_series.parquet"))
    meta = pd.read_sql("SELECT series_id, iso3, unit_key, crop_code, crop_family, season_std, tier, staple FROM series WHERE tier < 3", con)
    obs = pd.read_sql("""SELECT series_id, harvest_year AS year, yield_t_ha, production_t FROM v_observations WHERE "primary"=1 AND yield_t_ha > 0 AND tier < 3 AND harvest_year >= 1981""", con)
    err = pd.read_sql("SELECT DISTINCT series_id, harvest_year AS year FROM qc_flags f JOIN observations o USING(series_id, year_label) WHERE f.severity='error'", con)
    obs = obs.merge(err.assign(bad=1), on=["series_id", "year"], how="left"); obs = obs[obs.bad.isna()].drop(columns="bad")
    enso = pd.read_sql("SELECT year, month, nino34_rel FROM enso_monthly", con).set_index(["year", "month"]); con.close()
    last_idx = enso[enso.nino34_rel.notna()].index.max(); print(f"index through {last_idx[0]}-{last_idx[1]:02d}")
    Z = Z.merge(meta, on="series_id").merge(WS[["series_id", "frac_elapsed", "status", "target_start", "harvest_year"]].rename(columns={"harvest_year": "target_year"}), on="series_id")
    Z = Z[Z.staple.eq(1) & (Z.frac_elapsed >= MIN_FRAC)].copy()
    Z["lprecip"] = np.log(Z.precip.clip(lower=1.0)); Z.loc[Z.precip.isna(), "lprecip"] = np.nan
    # production weights: mean production 2010-2025 from the observations, falling back to the exposure table's series production
    pw = obs[obs.year.between(2010, 2025)].groupby("series_id").production_t.mean()
    pw = pw.combine_first(E.set_index("series_id").prod_series); Z["w"] = Z.series_id.map(pw).fillna(pw.median())
    # the index over the elapsed months of each series-year
    Z["idx"] = [index_todate(enso, ws, el) for ws, el in zip(Z.window_start, Z.elapsed_days)]
    mets = list(METRICS)
    panel_prod = E.groupby(["iso3", "crop_code", "season_std"]).prod_series.sum()  # the whole panel's production, started or not
    MIN_COVERAGE = 0.25  # the scored series must carry at least a quarter of the panel's production
    panel_rows, metric_rows, series_rows = [], [], []
    panels = Z.groupby(["iso3", "crop_code", "season_std"])
    for (iso, crop, season), g in panels:
        g = g.sort_values(["series_id", "year"]); current = g.year.eq(g.target_year)
        g26 = g[current]
        assert g26.window_start.eq(g26.target_start).all(), "Wrong year used for current weather"
        if g26.series_id.nunique() < MIN_SERIES or g[g.year < 2026].year.nunique() < MIN_YEARS:
            continue
        avail = [m for m in mets if g[m].notna().mean() > 0.6 and g26[m].notna().mean() > 0.5]
        if not avail:
            continue
        tot = float(panel_prod.get((iso, crop, season), np.nan)); scored = float(E[E.series_id.isin(g26.series_id)].prod_series.sum())
        coverage = scored / tot if np.isfinite(tot) and tot > 0 else np.nan
        if np.isfinite(coverage) and coverage < MIN_COVERAGE:
            continue  # a verdict on a sliver of the crop would mislead; the panel waits for its main season
        A = within_anom(g, avail, "series_id"); A["series_id"] = g.series_id.to_numpy(); A["year"] = g.year.to_numpy(); A["w"] = g.w.to_numpy(); A["idx"] = g.idx.to_numpy()
        A["is_current"] = current.to_numpy()
        # Group the current target seasons together while retaining the actual
        # harvest year for detrending and historical yield matching.
        A["comparison_year"] = np.where(current, 2026, g.year)
        frac = float(g26.frac_elapsed.median()); target_year = int(g26.target_year.iloc[0]); analog = [y + (1 if target_year == 2027 else 0) for y in ANALOG]
        # panel-year aggregate anomaly per metric, production-weighted over the series present
        def wmean(d, c):
            ok = d[c].notna(); return np.average(d.loc[ok, c], weights=d.loc[ok, "w"]) if ok.sum() >= max(3, 0.3 * len(d)) else np.nan
        P = A.groupby("comparison_year").apply(lambda d: pd.Series({**{m: wmean(d, m) for m in avail}, "idx": d.idx.mean(), "n": d.series_id.nunique()}), include_groups=False)
        hist = P[(P.index < 2026) & P.idx.notna()]; cur = P.loc[2026] if 2026 in P.index else None
        if cur is None or len(hist) < MIN_YEARS:
            continue
        rec = dict(iso3=iso, crop_code=crop, season_std=season, crop_family=g.crop_family.iloc[0], tier=int(g.tier.iloc[0]), target_year=target_year, series=int(g26.series_id.nunique()),
                   years=int(len(hist)), frac_elapsed=round(frac, 3), status=g26.status.mode().iloc[0], window_start=g26.window_start.mode().iloc[0], elapsed_days=int(g26.elapsed_days.median()),
                   idx_2026=float(cur.idx), production_t=float(g26.w.sum()), coverage_share=coverage, panel_production_t=tot)
        n_concord = 0; n_metrics = 0
        for m in avail:
            h = hist[[m, "idx"]].dropna()
            if len(h) < MIN_YEARS or not np.isfinite(cur[m]):
                continue
            res = stats.linregress(h.idx, h[m]); resid_sd = float(np.std(h[m] - (res.intercept + res.slope * h.idx), ddof=2))
            expected = res.intercept + res.slope * cur.idx; z = (cur[m] - expected) / resid_sd if resid_sd > 0 else np.nan
            pct = float(stats.norm.cdf(z)) if np.isfinite(z) else np.nan
            comp = float(h.loc[h.index.isin(analog), m].mean()) if h.index.isin(analog).any() else np.nan
            sd_hist = float(h[m].std()); signal = abs(res.slope * cur.idx) > 0.5 * sd_hist  # the El Nino expectation is a visible fraction of the year-to-year spread
            concordant = np.isfinite(pct) and 0.1 <= pct <= 0.9
            if signal:
                n_metrics += 1; n_concord += int(concordant)
            beyond = bool(cur[m] < h[m].min() or cur[m] > h[m].max())
            metric_rows.append(dict(iso3=iso, crop_code=crop, season_std=season, metric=m, observed_anom=float(cur[m]), expected_anom=float(expected), slope_per_degC=float(res.slope), beyond_range=int(beyond),
                                    slope_se=float(res.stderr), slope_p=float(res.pvalue), resid_sd=resid_sd, hist_sd=sd_hist, z=float(z) if np.isfinite(z) else np.nan, percentile=pct,
                                    composite_anom=comp, analog_years=",".join(str(y) for y in analog if y in h.index), signal=int(signal), obs_pct_of_hist_sd=float(cur[m] / sd_hist) if sd_hist > 0 else np.nan))
        # headline: rainfall and mean TMAX
        for m, key in [("lprecip", "rain"), ("tmax_mean", "tmax"), ("wet_days", "wet"), ("tmax_p95_days", "hot")]:
            mr = [r for r in metric_rows if r["iso3"] == iso and r["crop_code"] == crop and r["season_std"] == season and r["metric"] == m]
            if mr:
                r = mr[0]; rec[f"{key}_obs"] = r["observed_anom"]; rec[f"{key}_exp"] = r["expected_anom"]; rec[f"{key}_pct"] = r["percentile"]; rec[f"{key}_comp"] = r["composite_anom"]; rec[f"{key}_slope"] = r["slope_per_degC"]; rec[f"{key}_signal"] = r["signal"]
        rec["metrics_with_signal"] = n_metrics; rec["metrics_concordant"] = n_concord
        rec["metrics_beyond_range"] = int(sum(r["beyond_range"] for r in metric_rows if r["iso3"] == iso and r["crop_code"] == crop and r["season_std"] == season))
        for key in ["rain"]:
            if f"{key}_obs" in rec:
                rec[f"{key}_obs_pct"] = 100 * (np.exp(rec[f"{key}_obs"]) - 1); rec[f"{key}_exp_pct"] = 100 * (np.exp(rec[f"{key}_exp"]) - 1)
        rec["verdict"] = ("no expected signal" if n_metrics == 0 else "as expected" if n_concord == n_metrics else "against expectation" if n_concord == 0 else "mixed")
        # nowcast: detrended log yield on the season-to-date metrics
        gy = g[g.year < 2026].merge(obs, on=["series_id", "year"], how="inner").dropna(subset=avail + ["yield_t_ha"])
        gy = gy[gy.groupby("series_id").yield_t_ha.transform("size") >= 10]
        rec.update(nowcast_pct=np.nan, nowcast_se_pct=np.nan, nowcast_r2=np.nan, index_medium_pct=np.nan, index_observed_pct=np.nan, direct_slope_pct=np.nan)
        if gy.series_id.nunique() >= MIN_SERIES and gy.year.nunique() >= 15:
            gy = gy.assign(ly=np.log(gy.yield_t_ha)); r = r13.within(gy.assign(harvest_year=gy.year), ["ly", "idx"] + avail, "series_id")
            X = r[avail].to_numpy(); ok = np.isfinite(X).all(axis=1) & np.isfinite(r.ly.to_numpy())
            try:
                b, covariance = cluster_ols(X[ok], r.ly.to_numpy()[ok], gy.year.to_numpy()[ok])
                se = np.sqrt(np.maximum(np.diag(covariance), 0))
                pred = X[ok] @ b; r2 = 1 - np.var(r.ly.to_numpy()[ok] - pred) / np.var(r.ly.to_numpy()[ok])
                a26 = A[A.is_current].set_index("series_id"); Xn = a26[avail].to_numpy(); okn = np.isfinite(Xn).all(axis=1)
                dl = Xn[okn] @ b; wts = a26.w.to_numpy()[okn]
                mean_x = np.average(Xn[okn], axis=0, weights=wts)
                mean_dl = float(mean_x @ b)
                var_dl = max(float(mean_x @ covariance @ mean_x), 0.0)
                rec["nowcast_pct"] = 100 * np.expm1(mean_dl)
                rec["nowcast_se_pct"] = 100 * np.exp(mean_dl) * np.sqrt(var_dl)
                rec["nowcast_r2"] = float(r2)
                rec["nowcast_series"] = int(okn.sum())
                for i, m in enumerate(avail):
                    rec[f"b_{m}"] = float(b[i]); rec[f"bse_{m}"] = float(se[i])
                # contribution of each metric to the nowcast
                for i, m in enumerate(avail):
                    rec[f"contrib_{m}_pct"] = 100 * np.average(Xn[okn][:, i] * b[i], weights=wts)
                # the direct index slope on the same sample, and the index-implied numbers
                bd, sed = r13.cluster_slope(r.idx.to_numpy()[ok], r.ly.to_numpy()[ok], gy.year.to_numpy()[ok])
                rec["direct_slope_pct"] = 100 * bd; rec["index_observed_pct"] = 100 * (np.exp(bd * cur.idx) - 1)
                # unit-level nowcast for the maps
                for sid, d_ in zip(a26.index[okn], dl):
                    series_rows.append(dict(series_id=int(sid), nowcast_dlog=float(d_)))
            except np.linalg.LinAlgError:
                pass
        Es = E[E.series_id.isin(g26.series_id)]
        if Es.prod_series.sum() > 0:
            rec["index_medium_pct"] = 100 * Es.dprod_medium.sum() / Es.prod_series.sum(); rec["index_low_pct"] = 100 * Es.dprod_low.sum() / Es.prod_series.sum(); rec["index_high_pct"] = 100 * Es.dprod_high.sum() / Es.prod_series.sum()
        panel_rows.append(rec)
        # series anomalies for the maps
        a26 = A[A.is_current]
        for r_ in a26.itertuples():
            series_rows.append(dict(series_id=int(r_.series_id), **{f"anom_{m}": getattr(r_, m) for m in avail}))
    PT = pd.DataFrame(panel_rows); PM = pd.DataFrame(metric_rows)
    SR = pd.DataFrame(series_rows).groupby("series_id").first().reset_index().merge(meta, on="series_id").merge(WS[["series_id", "frac_elapsed", "status"]], on="series_id")
    PT.to_csv(os.path.join(TAB, f"panel_tracker_{ISSUE}.csv"), index=False, float_format="%.4g"); PM.to_csv(os.path.join(TAB, f"panel_metrics_{ISSUE}.csv"), index=False, float_format="%.4g")
    SR.to_parquet(os.path.join(TAB, f"series_anomalies_{ISSUE}.parquet"), index=False)
    print(f"{len(PT)} panels, {len(PM)} panel-metrics, {len(SR):,} series; {time.time()-t0:.0f}s")
    print(PT.verdict.value_counts().to_dict())
    show = PT.sort_values("production_t", ascending=False).head(40)
    print(show[["iso3", "crop_code", "season_std", "frac_elapsed", "idx_2026", "rain_obs_pct", "rain_exp_pct", "rain_pct", "tmax_obs", "tmax_exp", "tmax_pct", "verdict", "metrics_beyond_range", "nowcast_pct", "nowcast_se_pct", "index_medium_pct", "index_observed_pct"]].round(2).to_string(index=False))


if __name__ == "__main__":
    main()
