"""Export the El Nino Crop Watch data release from the ENSO database, the working paper's tables and the season tracker.

The Watch answers three questions per country, crop and season, in order: what usually happens here in an El Nino of
the forecast strength (the fitted response at the outlook's quantiles), what has happened this season so far (the
season-to-date weather against the El Nino expectation), and what that implies for the harvest (the weather-implied
yield anomaly beside the index-implied one). Every number carries an interval or a percentile and an evidence grade,
and every screen a verdict sentence generated here so that text and numbers cannot drift apart.

Inputs (read only):
  ENSO/2_data/derived/merged_panel/enso_ag.sqlite  series, units, enso_monthly, enso_response_panel (relative index), weather_todate_anomaly
  ENSO/4_ag/food_security_2026_27/paper/tables     exposure_series.parquet, scenario_paths.csv, ledger.csv, dependence.csv
  ENSO/4_ag/food_security_2026_27/season_tracker   tables/panel_tracker_<issue>.csv, series_anomalies_<issue>.parquet, data/season_windows_<issue>.csv

Outputs (watch/data/<issue>/): summary.json, countries.json, panels.json, units/<ISO3>.json, ledger.json, index_path.json,
methods.json, manifest.json. Geometry is not duplicated: the Watch reads the merged release's geometry files.

    python scripts/watch/build_watch_data.py --issue 2026-09 [--geometry-release 2026-09-26-merged-v1]
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import hashlib
import json
import os
import sqlite3

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__)); ATLAS = os.path.dirname(os.path.dirname(HERE))
ENSO = os.path.dirname(os.path.dirname(ATLAS))
DB = os.path.join(ENSO, "2_data", "derived", "merged_panel", "enso_ag.sqlite")
PAPER = os.path.join(ENSO, "4_ag", "food_security_2026_27", "paper", "tables")
TRACK = os.path.join(ENSO, "4_ag", "food_security_2026_27", "season_tracker")
STAPLES = ["maize", "rice", "wheat", "soybean", "sorghum", "cassava"]
HOTSPOTS = {"SDN", "SSD", "YEM", "PSE", "NGA", "SOM", "AFG", "COD", "HTI", "MMR", "MLI", "LBN", "MDG"}
VERDICT_PHRASE = {"as expected": "is running as a strong El Niño's fitted response predicts", "mixed": "matches the El Niño expectation on some measures and not on others",
                  "against expectation": "is running against the El Niño expectation", "no expected signal": "carries no El Niño expectation large enough to test"}
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def nz(x, nd=2):
    """JSON-safe rounding: NaN to None."""
    if x is None or (isinstance(x, float) and not np.isfinite(x)):
        return None
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (float, np.floating)):
        return round(float(x), nd)
    return x


def sha(path):
    h = hashlib.sha256(); h.update(open(path, "rb").read()); return h.hexdigest()


def grade(years, units, p, beyond_share):
    """Evidence grade A to D: years of record, significance, breadth, and whether the forecast lies inside the fitted range."""
    pts = int(years >= 25) + int(np.isfinite(p) and p < 0.10) + int(units >= 10 or units == 1 and years >= 40) + int(beyond_share < 0.5)
    g = {4: "A", 3: "B", 2: "C"}.get(pts, "D")
    notes = []
    if years < 25:
        notes.append(f"{int(years)} years of record")
    if not (np.isfinite(p) and p < 0.10):
        notes.append("slope not distinguishable from zero at 10 percent")
    if units < 10 and not (units == 1 and years >= 40):
        notes.append(f"{int(units)} reporting units")
    if beyond_share >= 0.5:
        notes.append(f"forecast beyond the fitted range for {100*beyond_share:.0f} percent of production")
    return g, ("checklist " + str(pts) + " of 4: " + "; ".join(notes)) if notes else "checklist 4 of 4: long record, slope distinguishable from zero, many units, forecast inside the fitted range"


def season_label(season):
    return "" if season in ("main", "Annual", "annual") else f", {season.lower()}"


def crop_label(crop_code):
    return crop_code.replace("_", " ").replace("rice paddy", "rice (paddy)").replace("rice milled", "rice (milled)").replace("wheat spring", "spring wheat").replace("wheat winter", "winter wheat")


def status_of(frac, target_year, harvest_month, started_share=None, complete_share=None):
    """Status of a panel from the production shares of its series whose windows have started or completed.

    A panel whose seasons are mixed (a sliver of production on an early calendar, the rest not yet planted) is
    'not planted' until a tenth of production has started, and 'harvested' once nine tenths have completed."""
    ss = started_share if started_share is not None and np.isfinite(started_share) else (1.0 if (frac is not None and np.isfinite(frac) and frac > 0) else 0.0)
    cs = complete_share if complete_share is not None and np.isfinite(complete_share) else (1.0 if (frac is not None and np.isfinite(frac) and frac >= 0.999) else 0.0)
    when = f"harvest {MONTHS[int(harvest_month)-1]} {int(target_year)}"
    if ss < 0.10:
        return "not planted", (f"planting ahead for {100*(1-ss):.0f} percent of production; {when}" if ss > 0 else f"planting ahead; {when}")
    if cs >= 0.90:
        return "harvested", f"window complete for {100*cs:.0f} percent of production; {when}"
    f = frac if (frac is not None and np.isfinite(frac) and frac > 0) else np.nan
    part = f"{100*ss:.0f} percent of production in the ground" + (f", {100*f:.0f} percent of its window run" if np.isfinite(f) else "")
    return "in the ground", f"{part}; {when}"


def main() -> None:
    ap = argparse.ArgumentParser(); ap.add_argument("--issue", default="2026-09"); ap.add_argument("--geometry-release", default="2026-09-26-merged-v1")
    a = ap.parse_args(); issue = a.issue
    out = os.path.join(ATLAS, "watch", "data", issue); os.makedirs(os.path.join(out, "units"), exist_ok=True)
    con = sqlite3.connect(DB)
    series = pd.read_sql("SELECT series_id, unit_key, iso3, crop_code, crop_family, season_std, tier, staple FROM series", con)
    units = pd.read_sql("SELECT unit_key, iso3, country, unit_name, admin_level FROM units", con)
    names = pd.read_sql("SELECT iso3, country FROM units GROUP BY iso3", con).set_index("iso3").country.str.replace("_", " ").str.title().to_dict()
    for k, v in {"USA": "United States", "GBR": "United Kingdom", "KOR": "South Korea", "PRK": "North Korea", "IRN": "Iran", "SYR": "Syria", "VNM": "Vietnam", "RUS": "Russia", "TZA": "Tanzania",
                 "COD": "DR Congo", "CIV": "Côte d'Ivoire", "LAO": "Laos", "BOL": "Bolivia", "VEN": "Venezuela", "TUR": "Türkiye", "CZE": "Czechia", "ARE": "United Arab Emirates", "TWN": "Taiwan"}.items():
        names[k] = v
    enso = pd.read_sql("SELECT year, month, nino34, nino34_rel FROM enso_monthly WHERE year >= 2024 ORDER BY year, month", con)
    fits = pd.read_sql("SELECT iso3, crop_code, season_std, pct_per_degC, lo, hi, p, q, units, years, x_min, x_max FROM enso_response_panel WHERE window='n34rel_season'", con)
    A = pd.read_sql("SELECT * FROM weather_todate_anomaly", con)
    meta = pd.read_sql("SELECT key, value FROM meta", con).set_index("key").value.to_dict(); con.close()
    E = pd.read_parquet(os.path.join(PAPER, "exposure_series.parquet"))
    E = E[E.crop_family.isin(STAPLES)].copy()
    WS = pd.read_csv(os.path.join(TRACK, "data", f"season_windows_{issue}.csv")); PT = pd.read_csv(os.path.join(TRACK, "tables", f"panel_tracker_{issue}.csv"))
    skp = os.path.join(TRACK, "tables", f"hindcast_skill_{issue}.csv")
    if os.path.exists(skp):
        SK = pd.read_csv(skp)[["iso3", "crop_code", "season_std", "skill_weather_vs_trend", "skill_enso_vs_trend", "skill_weather_vs_enso", "skill_block", "corr_weather", "rmse_weather_pct", "rmse_trend_pct", "years"]].rename(columns={"years": "hindcast_years"})
        PT = PT.merge(SK, on=["iso3", "crop_code", "season_std"], how="left")
    else:
        for c in ["skill_weather_vs_trend", "skill_enso_vs_trend", "skill_weather_vs_enso", "skill_block", "corr_weather", "rmse_weather_pct", "rmse_trend_pct", "hindcast_years"]:
            PT[c] = np.nan
    SR = pd.read_parquet(os.path.join(TRACK, "tables", f"series_anomalies_{issue}.parquet"))
    paths = pd.read_csv(os.path.join(PAPER, "scenario_paths.csv")); ledger = pd.read_csv(os.path.join(PAPER, "ledger.csv"))
    data_end = str(WS.data_end.iloc[0]); last = enso.dropna(subset=["nino34_rel"]).iloc[-1]
    # ---- panels: country x crop_code x season ----------------------------------------------------------------------
    E = E.merge(WS[["series_id", "frac_elapsed", "status"]], on="series_id", how="left")
    E["beyond_w"] = E.beyond_fit * E.prod_series
    E["started_w"] = (E.frac_elapsed.fillna(0) > 0) * E.prod_series; E["complete_w"] = (E.frac_elapsed.fillna(0) >= 0.999) * E.prod_series
    g = E.groupby(["iso3", "crop_code", "crop_family", "season_std"], dropna=False)
    P = g.agg(production_t=("prod_series", "sum"), d_low=("dprod_low", "sum"), d_medium=("dprod_medium", "sum"), d_high=("dprod_high", "sum"),
              d_low_bound=("dprod_low_bound", "sum"), d_high_bound=("dprod_high_bound", "sum"), beyond_w=("beyond_w", "sum"), series=("series_id", "nunique"),
              target_year=("harvest_year", lambda s: int(s.mode().iloc[0])), plant_month=("plant_month", lambda s: s.mode().iloc[0]), harvest_month=("harvest_month", lambda s: s.mode().iloc[0]),
              frac=("frac_elapsed", "median"), tier=("tier", "min"), exposure_medium=("medium", "mean"), started_w=("started_w", "sum"), complete_w=("complete_w", "sum")).reset_index()
    P = P[P.production_t > 0].copy(); P["beyond_share"] = P.beyond_w / P.production_t
    P["started_share"] = P.started_w / P.production_t; P["complete_share"] = P.complete_w / P.production_t
    # the elapsed fraction of the part that has started, production-weighted
    fw = E[E.frac_elapsed.fillna(0) > 0].assign(fw=lambda d: d.frac_elapsed * d.prod_series).groupby(["iso3", "crop_code", "crop_family", "season_std"], dropna=False).agg(fw=("fw", "sum"), pw=("prod_series", "sum")).reset_index()
    fw["frac_started"] = fw.fw / fw.pw; P = P.merge(fw[["iso3", "crop_code", "crop_family", "season_std", "frac_started"]], on=["iso3", "crop_code", "crop_family", "season_std"], how="left")
    for k in ["low", "medium", "high"]:
        P[f"pct_{k}"] = 100 * P[f"d_{k}"] / P.production_t
    P = P.merge(fits, on=["iso3", "crop_code", "season_std"], how="left")
    P = P.merge(PT.drop(columns=[c for c in ["crop_family", "tier", "target_year", "series", "production_t", "frac_elapsed", "window_start", "elapsed_days"] if c in PT.columns]),
                on=["iso3", "crop_code", "season_std"], how="left", suffixes=("", "_pt"))
    panels = []
    for r in P.itertuples():
        yrs = r.years if np.isfinite(r.years) else 0; un = r.units if np.isfinite(r.units) else r.series; pval = r.p if np.isfinite(r.p) else np.nan
        gr, gnote = grade(yrs, un, pval, r.beyond_share)
        st, stnote = status_of(getattr(r, "frac_started", np.nan), r.target_year, r.harvest_month, r.started_share, r.complete_share)
        cname = names.get(r.iso3, r.iso3); lab = f"{cname} {crop_label(r.crop_code)}{season_label(r.season_std)}"
        mt = r.d_medium / 1e6; prod_mt = r.production_t / 1e6
        exp_sent = (f"The fitted response implies {r.pct_medium:+.0f} percent for the {int(r.target_year)} harvest on the outlook's median path; the ENSO scenario range is {r.pct_low:+.0f} to {r.pct_high:+.0f} percent "
                    f"(the outlook's 5th to 95th percentile paths, not a yield prediction interval), {mt:+.2f} million tonnes on {prod_mt:.1f}. Evidence {gr}, {gnote}.") if np.isfinite(r.pct_medium) else "No fitted response is available for this season."
        has_track = np.isfinite(getattr(r, "idx_2026", np.nan)) and isinstance(getattr(r, "verdict", None), str) and st != "not planted"
        frac_run = getattr(r, "frac_started", np.nan)
        if st == "not planted":
            sea_sent = f"The season has not started ({stnote}); the expectation stands on the index alone."
        elif has_track:
            parts = []
            if np.isfinite(getattr(r, "rain_obs_pct", np.nan)):
                parts.append(f"rainfall {r.rain_obs_pct:+.0f} percent against an El Niño expectation of {r.rain_exp_pct:+.0f} (percentile {100*r.rain_pct:.0f})")
            if np.isfinite(getattr(r, "tmax_obs", np.nan)):
                parts.append(f"mean TMAX {r.tmax_obs:+.1f} °C against {r.tmax_exp:+.1f} (percentile {100*r.tmax_pct:.0f})")
            cov = getattr(r, "coverage_share", np.nan)
            sea_sent = f"Season to date ({stnote}): " + "; ".join(parts) + f". The weather {VERDICT_PHRASE.get(r.verdict, r.verdict)}." + (f" The scored series carry {100*cov:.0f} percent of the crop's production." if np.isfinite(cov) and cov < 0.9 else "")
            if np.isfinite(getattr(r, "metrics_beyond_range", np.nan)) and r.metrics_beyond_range > 0:
                sea_sent += f" {int(r.metrics_beyond_range)} of the measures lie outside the 1981–2025 range for these days."
        else:
            sea_sent = f"Season to date ({stnote}): too few reporting units with weather and yields to score this season against the expectation."
        skill = getattr(r, "skill_weather_vs_trend", np.nan)
        now_ok = has_track and np.isfinite(getattr(r, "nowcast_pct", np.nan)) and r.nowcast_se_pct < 40 and np.isfinite(frac_run) and frac_run >= 0.5 and np.isfinite(skill) and skill > 0
        if st == "not planted":
            imp_sent = f"Not yet planted: the index alone implies {r.pct_medium:+.0f} percent." if np.isfinite(r.pct_medium) else "Not yet planted."
        elif now_ok:
            imp_sent = (f"The weather so far implies {r.nowcast_pct:+.1f} percent of trend (± {r.nowcast_se_pct:.1f}, one standard error of the regression estimate; unexplained yield variation is not included), against {r.index_medium_pct:+.1f} from the index alone"
                        + (f" and {r.index_observed_pct:+.1f} from the direct slope on the index observed so far." if np.isfinite(getattr(r, "index_observed_pct", np.nan)) else "."))
            if np.isfinite(getattr(r, "skill_weather_vs_trend", np.nan)):
                imp_sent += f" In a leave-one-year-out hindcast at this fraction of the season the weather estimate {'beat' if r.skill_weather_vs_trend > 0 else 'did not beat'} the trend-only baseline (skill {r.skill_weather_vs_trend:+.2f}) and {'beat' if r.skill_weather_vs_enso > 0 else 'did not beat'} the index-only estimate."
            if np.isfinite(getattr(r, "metrics_beyond_range", np.nan)) and r.metrics_beyond_range > 0:
                imp_sent += " A measure outside the fitted range makes this an extrapolation."
        else:
            why = ("the season has not run halfway" if not (np.isfinite(frac_run) and frac_run >= 0.5) else "the hindcast shows no skill over the trend-only baseline at this fraction of the season" if np.isfinite(skill) and skill <= 0
                   else "no hindcast is available" if has_track and np.isfinite(getattr(r, "nowcast_pct", np.nan)) else "the fit is too weak or too few units carry weather and yields")
            imp_sent = f"No weather-implied estimate is shown because {why}; the index alone implies {r.pct_medium:+.0f} percent on the median path." if np.isfinite(r.pct_medium) else "No estimate."
        panels.append(dict(iso3=r.iso3, country=cname, crop_code=r.crop_code, crop_family=r.crop_family, season=r.season_std, label=lab, tier=int(r.tier), series=int(r.series),
                           production_mt=nz(prod_mt, 3), target_year=int(r.target_year), plant_month=nz(r.plant_month, 0), harvest_month=nz(r.harvest_month, 0), status=st, status_note=stnote,
                           frac_elapsed=nz(frac_run, 3), started_share=nz(r.started_share, 3), complete_share=nz(r.complete_share, 3), coverage_share=nz(getattr(r, "coverage_share", np.nan), 3),
                           expected=dict(pct_low=nz(r.pct_low, 1), pct_medium=nz(r.pct_medium, 1), pct_high=nz(r.pct_high, 1), mt_low=nz(r.d_low / 1e6, 3), mt_medium=nz(mt, 3), mt_high=nz(r.d_high / 1e6, 3),
                                         mt_low_bound=nz(r.d_low_bound / 1e6, 3), mt_high_bound=nz(r.d_high_bound / 1e6, 3), exposure_medium=nz(r.exposure_medium, 2), beyond_share=nz(r.beyond_share, 3),
                                         slope_pct_per_degC=nz(r.pct_per_degC, 2), slope_lo=nz(r.lo, 2), slope_hi=nz(r.hi, 2), p=nz(pval, 4), years=nz(yrs, 0), units=nz(un, 0), x_max=nz(r.x_max, 2), grade=gr, grade_note=gnote),
                           season_so_far=(dict(idx_todate=nz(r.idx_2026), rain_obs_pct=nz(getattr(r, "rain_obs_pct", np.nan), 1), rain_exp_pct=nz(getattr(r, "rain_exp_pct", np.nan), 1), rain_percentile=nz(getattr(r, "rain_pct", np.nan), 3),
                                               rain_composite=nz(getattr(r, "rain_comp", np.nan), 3), tmax_obs=nz(getattr(r, "tmax_obs", np.nan)), tmax_exp=nz(getattr(r, "tmax_exp", np.nan)), tmax_percentile=nz(getattr(r, "tmax_pct", np.nan), 3),
                                               hot_obs=nz(getattr(r, "hot_obs", np.nan), 1), hot_exp=nz(getattr(r, "hot_exp", np.nan), 1), hot_percentile=nz(getattr(r, "hot_pct", np.nan), 3),
                                               verdict=r.verdict, metrics_with_signal=nz(getattr(r, "metrics_with_signal", np.nan), 0), metrics_concordant=nz(getattr(r, "metrics_concordant", np.nan), 0),
                                               metrics_beyond_range=nz(getattr(r, "metrics_beyond_range", np.nan), 0)) if has_track else None),
                           hindcast=(dict(skill_vs_trend=nz(skill, 3), skill_vs_enso=nz(getattr(r, "skill_weather_vs_enso", np.nan), 3), skill_enso_vs_trend=nz(getattr(r, "skill_enso_vs_trend", np.nan), 3), skill_block=nz(getattr(r, "skill_block", np.nan), 3),
                                          corr=nz(getattr(r, "corr_weather", np.nan), 2), rmse_weather_pct=nz(getattr(r, "rmse_weather_pct", np.nan), 1), rmse_trend_pct=nz(getattr(r, "rmse_trend_pct", np.nan), 1), years=nz(getattr(r, "hindcast_years", np.nan), 0)) if np.isfinite(skill) else None),
                           implied=dict(nowcast_pct=nz(getattr(r, "nowcast_pct", np.nan), 1) if now_ok else None, nowcast_se_pct=nz(getattr(r, "nowcast_se_pct", np.nan), 1) if now_ok else None,
                                        nowcast_r2=nz(getattr(r, "nowcast_r2", np.nan), 2) if now_ok else None, index_observed_pct=nz(getattr(r, "index_observed_pct", np.nan), 1) if has_track else None,
                                        index_medium_pct=nz(r.pct_medium, 1), usable=bool(now_ok)),
                           sentences=dict(expected=exp_sent, season=sea_sent, implied=imp_sent)))
    json.dump(panels, open(os.path.join(out, "panels.json"), "w"), separators=(",", ":"))
    # ---- countries ---------------------------------------------------------------------------------------------------
    Pdf = pd.DataFrame([dict(iso3=p["iso3"], crop_family=p["crop_family"], production_mt=p["production_mt"] or 0, mt_low=p["expected"]["mt_low"] or 0, mt_medium=p["expected"]["mt_medium"] or 0,
                             mt_high=p["expected"]["mt_high"] or 0, status=p["status"], verdict=(p["season_so_far"] or {}).get("verdict")) for p in panels])
    L = ledger.set_index("iso3") if "iso3" in ledger else ledger.set_index(ledger.columns[0])
    countries = []
    for iso, d in Pdf.groupby("iso3"):
        prod = d.production_mt.sum(); med = d.mt_medium.sum(); lo = d.mt_low.sum(); hi = d.mt_high.sum()
        st = d.status.value_counts().to_dict(); vc = d.verdict.dropna().value_counts().to_dict()
        row = L.loc[iso] if iso in L.index else None
        bycrop = {c: dict(production_mt=nz(x.production_mt.sum(), 3), mt_medium=nz(x.mt_medium.sum(), 3), pct_medium=nz(100 * x.mt_medium.sum() / x.production_mt.sum(), 1) if x.production_mt.sum() > 0 else None) for c, x in d.groupby("crop_family")}
        valid = {k: v for k, v in bycrop.items() if v["pct_medium"] is not None}
        worst = min(valid.items(), key=lambda kv: kv[1]["pct_medium"]) if valid else None
        head = (f"{names.get(iso, iso)}: the fitted responses imply {100*med/prod:+.1f} percent of staple output for the 2026–27 harvests ({100*lo/prod:+.1f} to {100*hi/prod:+.1f}), "
                f"{med:+.2f} million tonnes on {prod:.1f}" + (f"; the largest expected change is {worst[0]} at {worst[1]['pct_medium']:+.1f} percent." if worst else ".")) if prod > 0 else names.get(iso, iso)
        countries.append(dict(iso3=iso, name=names.get(iso, iso), hotspot=iso in HOTSPOTS, production_mt=nz(prod, 3), expected=dict(mt_low=nz(lo, 3), mt_medium=nz(med, 3), mt_high=nz(hi, 3), pct_medium=nz(100 * med / prod, 1) if prod > 0 else None),
                              by_crop=bycrop, panels=int(len(d)), status_counts=st, verdict_counts=vc,
                              ledger=(dict(enso=nz(row.get("enso")), fert=nz(row.get("fert"), 1), bsea=nz(row.get("bsea"), 1), ships=nz(row.get("ships"), 1), people=nz(row.get("people"), 1), count=nz(row.get("count"), 0),
                                           enso_partial=bool(row.get("enso_partial")) if row is not None else None) if row is not None else None), headline=head))
    countries.sort(key=lambda c: (c["expected"]["mt_medium"] if c["expected"]["mt_medium"] is not None else 0))
    json.dump(countries, open(os.path.join(out, "countries.json"), "w"), separators=(",", ":"))
    # ---- units per country -----------------------------------------------------------------------------------------
    E2 = E.merge(units[["unit_key", "unit_name"]], on="unit_key", how="left")
    SR2 = SR.merge(A[["series_id", "precip_anom_pct", "tmax_mean_anom", "precip_pct_rank", "tmax_mean_pct_rank", "frac_elapsed"]], on="series_id", how="left", suffixes=("", "_a"))
    SR2 = SR2.merge(E[["series_id", "prod_series"]], on="series_id", how="left")
    n_units = 0
    for iso, d in E2.groupby("iso3"):
        crops = {}
        for cf, x in d.groupby("crop_family"):
            # one record per unit: the series with the most production
            x = x.sort_values("prod_series", ascending=False).drop_duplicates("unit_key")
            rec = {}
            for r in x.itertuples():
                pct = 100 * r.dprod_medium / r.prod_series if r.prod_series and r.prod_series > 0 else np.nan
                lo = 100 * r.dprod_low / r.prod_series if r.prod_series and r.prod_series > 0 else np.nan; hi = 100 * r.dprod_high / r.prod_series if r.prod_series and r.prod_series > 0 else np.nan
                rec[r.unit_key] = dict(n=r.unit_name if isinstance(r.unit_name, str) else None, e=nz(pct, 1), lo=nz(lo, 1), hi=nz(hi, 1), b=int(r.beyond_fit) if np.isfinite(r.beyond_fit) else 0, f=nz(r.frac_elapsed, 2), s=r.series_id)
            w = SR2[SR2.iso3.eq(iso) & SR2.crop_family.eq(cf)].sort_values("prod_series", ascending=False).drop_duplicates("unit_key")
            for r in w.itertuples():
                if r.unit_key in rec:
                    rec[r.unit_key].update(r=nz(r.precip_anom_pct, 1), t=nz(r.tmax_mean_anom, 2), rr=nz(r.precip_pct_rank, 2), tr=nz(r.tmax_mean_pct_rank, 2))
            crops[cf] = rec
        n_units += len(set(k for v in crops.values() for k in v))
        json.dump(dict(iso3=iso, crops=crops, keys={"n": "unit name", "e": "expected change, medium scenario, percent", "lo": "low scenario", "hi": "high scenario", "b": "1 if the forecast exposure lies beyond the fitted range",
                                                   "f": "fraction of the current window elapsed", "r": "season-to-date rainfall anomaly, percent of the unit's reference", "t": "season-to-date mean TMAX anomaly, degC",
                                                   "rr": "percentile rank of the rainfall in the unit's 1981-2025 history", "tr": "percentile rank of TMAX", "s": "series id in the database"}),
                  open(os.path.join(out, "units", f"{iso}.json"), "w"), separators=(",", ":"))
    # ---- ledger, index path, summary, methods, manifest ------------------------------------------------------------
    led = ledger.copy(); led.columns = [c if c != "nm" else "name" for c in led.columns]
    json.dump(json.loads(led.where(pd.notna(led), None).to_json(orient="records")), open(os.path.join(out, "ledger.json"), "w"), separators=(",", ":"))
    ip = paths.merge(enso[["year", "month", "nino34_rel", "nino34"]], on=["year", "month"], how="left", suffixes=("", "_db"))
    json.dump(dict(months=[f"{int(y)}-{int(m):02d}" for y, m in zip(ip.year, ip.month)], observed_rel=[nz(v, 3) for v in ip.nino34_rel], observed_std=[nz(v, 3) for v in ip.nino34],
                   low=[nz(v, 3) for v in ip.low], medium=[nz(v, 3) for v in ip.medium], high=[nz(v, 3) for v in ip.high], last_observed=f"{int(last.year)}-{int(last.month):02d}"),
              open(os.path.join(out, "index_path.json"), "w"), separators=(",", ":"))
    W = Pdf.groupby("crop_family").agg(production_mt=("production_mt", "sum"), mt_low=("mt_low", "sum"), mt_medium=("mt_medium", "sum"), mt_high=("mt_high", "sum"))
    world = {c: dict(production_mt=nz(r.production_mt, 1), mt_low=nz(r.mt_low, 2), mt_medium=nz(r.mt_medium, 2), mt_high=nz(r.mt_high, 2), pct_medium=nz(100 * r.mt_medium / r.production_mt, 2)) for c, r in W.iterrows()}
    use = [p for p in panels if p["implied"]["usable"]]
    wsum = sum(p["production_mt"] for p in use) or np.nan
    head = dict(panels=len(use), production_mt=nz(wsum, 1), countries=len(set(p["iso3"] for p in use)), crop_families=sorted(set(p["crop_family"] for p in use)),
                weather_implied_pct=nz(sum(p["implied"]["nowcast_pct"] * p["production_mt"] for p in use) / wsum, 3) if use else None,
                index_implied_pct=nz(sum(p["implied"]["index_medium_pct"] * p["production_mt"] for p in use if p["implied"]["index_medium_pct"] is not None) / wsum, 3) if use else None,
                weather_implied_mt=nz(sum(p["implied"]["nowcast_pct"] / 100 * p["production_mt"] for p in use), 2) if use else None,
                index_implied_mt=nz(sum((p["implied"]["index_medium_pct"] or 0) / 100 * p["production_mt"] for p in use), 2) if use else None,
                by_crop={cf: dict(panels=sum(1 for p in use if p["crop_family"] == cf), production_mt=nz(sum(p["production_mt"] for p in use if p["crop_family"] == cf), 1),
                                  weather_implied_pct=nz(sum(p["implied"]["nowcast_pct"] * p["production_mt"] for p in use if p["crop_family"] == cf) / sum(p["production_mt"] for p in use if p["crop_family"] == cf), 2),
                                  index_implied_pct=nz(sum((p["implied"]["index_medium_pct"] or 0) * p["production_mt"] for p in use if p["crop_family"] == cf) / sum(p["production_mt"] for p in use if p["crop_family"] == cf), 2)) for cf in sorted(set(p["crop_family"] for p in use))},
                definition="Production-weighted mean of the panel yield anomalies over the crop seasons with a usable weather-implied estimate (at least half the window run, standard error under 40 points, positive leave-one-year-out skill over the trend-only baseline). "
                           "The index-implied figure is the paper's medium-scenario change aggregated over exactly the same seasons with the same weights. A mixture of crops weighted by tonnes, not a global food-supply estimate.")
    summary = dict(issue=issue, generated_utc=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), data_end=data_end, index_last_month=f"{int(last.year)}-{int(last.month):02d}", headline=head,
                   index_last_rel=nz(last.nino34_rel, 2), index_last_std=nz(last.nino34, 2), database_release=meta.get("release"), database_nino34_last_month=meta.get("nino34_last_month"),
                   tracker_issue=meta.get("todate_issue"), counts=dict(countries=len(countries), panels=len(panels), units=n_units, panels_scored=int(sum(1 for p in panels if p["season_so_far"])),
                                                                     panels_with_nowcast=int(sum(1 for p in panels if p["implied"]["usable"]))),
                   world=world, geometry_release=a.geometry_release, scenario=dict(low_djf_roni=1.48, medium_djf_roni=2.27, high_djf_roni=3.06, note="CPC September 2026 outlook quantiles, divided by 1.178 to the relative index; 2015-16 monthly shape"))
    json.dump(summary, open(os.path.join(out, "summary.json"), "w"), indent=1)
    files = sorted(os.path.relpath(os.path.join(dp, f), out) for dp, _, fs in os.walk(out) for f in fs if f != "manifest.json")
    json.dump(dict(issue=issue, files={f: dict(sha256=sha(os.path.join(out, f)), bytes=os.path.getsize(os.path.join(out, f))) for f in files}), open(os.path.join(out, "manifest.json"), "w"), indent=1)
    print(f"watch/data/{issue}: {len(countries)} countries, {len(panels)} panels ({summary['counts']['panels_scored']} scored, {summary['counts']['panels_with_nowcast']} with nowcast), {n_units:,} units, {len(files)} files")
    print(json.dumps(world, indent=1))


if __name__ == "__main__":
    main()
