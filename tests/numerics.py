"""Check every value in site/data/<R> against its row in analysis/releases/crops/<R> (or the release database) at the stated precision.

    python tests/numerics.py [--release R]        # every release of releases.json when none is named

A release's manifest names its contract: none for the 8 October 2026 shape (`check_legacy`), "2026-10-09" for the
hierarchical candidate (`check_v2`), whose checks cover world.json (prediction_panel and the aggregate country rows),
calendar_world.json (calendar_status and the national-series rule), countries (prediction_panel, aggregate at country
and region level, the season-weather tables), units (response_leaf, prediction_series, calendar_status, weights,
weather_todate_anomaly), the record shards (observations, trend_series, trend_anomaly, enso_windows, qc_flags, the
weather-variable response_leaf rows) and skill.json (evaluation_skill at country level); the publication rule (a
restricted series has no observation, anomaly or QC rows, and a pass over every exported file finds none of its
yields); and the row counts, so every results row in scope reaches the site.

The manifest's `precision.decimals` names, per file family, the decimals the exporter kept (null: the results float
unrounded). A site value passes when it equals round(source, decimals), or the source itself where no rounding was
stated, with null for a missing source value. Strings and integers must be identical. Every results row of the site's
scope (the staple crop families) must appear in the site data, so the counts are compared as well.
"""
from __future__ import annotations

# Locate the checkout independently of the working directory or machine.
from pathlib import Path as _ProjectPath
import sys as _project_sys
_ENSO_ROOT = next(p for p in _ProjectPath(__file__).resolve().parents if (p / "project.toml").is_file())
if str(_ENSO_ROOT) not in _project_sys.path:
    _project_sys.path.append(str(_ENSO_ROOT))
from enso_project import path as _project_path, resolve_path as _resolve_path
from enso_project import load_record as _load_record, loads_record as _loads_record


import argparse
import hashlib
import json
import math
import re
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

ATLAS = Path(__file__).resolve().parents[1]
ENSO = next((p for p in ATLAS.parents if (p / "project.toml").is_file()), ATLAS.parent)
SITE = ATLAS / "site" / "data"
checked = 0
problems: list[str] = []


def fail(msg: str) -> None:
    problems.append(msg)
    if len(problems) > 30:
        raise SystemExit("FAIL numerics: too many problems; first:\n" + "\n".join(problems[:30]))


def expect(source, d):
    """The site value a source value must equal."""
    if source is None:
        return None
    if isinstance(source, (bool, np.bool_)):
        return bool(source)
    if isinstance(source, (int, np.integer)):
        return int(source)
    if isinstance(source, str):
        return source
    v = float(source)
    if not math.isfinite(v):
        return None
    return v if d is None else round(v, d)


def same(site, source, d) -> bool:
    e = expect(source, d)
    if e is None or site is None:
        return e is None and site is None
    if isinstance(e, bool) or isinstance(site, bool):
        return e == site
    if isinstance(e, str):
        return e == site
    return e == site


def compare(where: str, site_row, source_row, cols, d):
    global checked
    if isinstance(site_row, list):
        site_row = dict(zip(cols, site_row))
    for c in cols:
        checked += 1
        if not same(site_row[c], source_row[c], d):
            fail(f"{where}: {c} site={site_row[c]!r} source={source_row[c]!r}")


def index_rows(frame: pd.DataFrame, keys):
    """A dict from key tuple to the one row (as a dict) with that key; the key must be unique."""
    dup = frame.duplicated(keys, keep=False)
    assert not dup.any(), f"source key {keys} is not unique: {frame.loc[dup, keys].head(3).to_dict('records')}"
    recs = frame.to_dict("records")
    return {tuple(r[k] for k in keys): r for r in recs}


def check_legacy(release: str) -> None:
    """The contract of 8 October 2026."""
    global checked
    base = SITE / release
    results = ENSO / "analysis/releases/crops" / release
    manifest = _loads_record((base / "manifest.json").read_text())
    rman = _loads_record((results / "manifest.json").read_text())
    P = manifest["precision"]["decimals"]
    assert manifest["results"]["manifest_sha256"] == __import__("hashlib").sha256((results / "manifest.json").read_bytes()).hexdigest(), "results manifest changed since the export"
    R = lambda n: pd.read_parquet(results / f"{n}.parquet")
    cat = _loads_record((base / "catalog.json").read_text())
    staples = set(cat["crops"])
    key_of = lambda d: [f"{i}|{c}|{s}" for i, c, s in zip(d.iso3, d.crop_code, d.season)]
    # ---- panels.json against prediction_panel, prediction_weather_panel, response_country ---------------------------
    pp = R("prediction_panel"); pp["key"] = key_of(pp)
    pwp = R("prediction_weather_panel"); pwp["key"] = key_of(pwp)
    rc = R("response_country"); rc = rc[rc.crop_code.isin(staples)].copy(); rc["key"] = key_of(rc)
    pp_rows = index_rows(pp, ["key", "method", "scenario"]); pwp_rows = index_rows(pwp, ["key"])
    rc_rows = index_rows(rc, ["key", "index", "window"])
    panels = _loads_record((base / "panels.json").read_text())
    d = P["panels.json"]
    PP_COLS = ["method", "scenario", "harvest_year", "issue", "lead", "pct", "lo", "hi", "se", "production_mt", "n_series", "local_share", "usable_share", "status"]
    wap = R("weather_todate_anomaly_panel"); wap["key"] = key_of(wap); wap_rows = index_rows(wap, ["key"])
    METRICS = cat["weather_metrics"]
    WAP_HEAD = ["issue", "harvest_year", "data_end", "frac_elapsed", "n_series", "n_years", "production_t", "coverage_share", "idx_todate", "metrics_with_signal", "metrics_concordant", "verdict"]
    WAP_FIELDS = ["value", "anom", "product", "expected", "percentile", "z", "slope_per_degC", "slope_p", "resid_sd", "hist_sd", "signal", "beyond_range"]
    n_wap = 0
    RC_COLS = ["index", "window", "beta", "se", "pct_per_degC", "lo", "hi", "p", "q", "n_units", "n_years", "year_first", "year_last", "production_t", "method_version"]
    n_pred = 0
    for p in panels:
        for row in p["predictions"]:
            src = pp_rows.get((p["key"], row["method"], row["scenario"]))
            if src is None:
                fail(f"panels[{p['key']}]: no prediction_panel row for {row['method']}/{row['scenario']}"); continue
            compare(f"panels[{p['key']}].{row['method']}/{row['scenario']}", row, src, PP_COLS, d); n_pred += 1
        head = pp_rows.get((p["key"], "index_outlook", "medium"))
        compare(f"panels[{p['key']}].head", dict(harvest_year=p["harvest_year"], status=p["status"], production_mt=p["production_mt"], n_series=p["n_series"], local_share=p["local_share"]),
                head, ["harvest_year", "status", "production_mt", "n_series", "local_share"], d)
        src = pwp_rows.get((p["key"],))
        if (src is None) != (p["weather"] is None):
            fail(f"panels[{p['key']}]: weather row presence")
        elif src is not None:
            w = dict(p["weather"]); w["metrics"] = ",".join(w["metrics"])
            compare(f"panels[{p['key']}].weather", w, src, ["lead", "pct_panel", "se_panel", "usable_panel", "coverage_share", "frac_started", "skill_vs_trend", "n_series", "metrics"], d)
        src = wap_rows.get((p["key"],))
        if (src is None) != (p["season_weather"] is None):
            fail(f"panels[{p['key']}]: season_weather presence")
        elif src is not None:
            sw = p["season_weather"]
            compare(f"panels[{p['key']}].season_weather", {k: v for k, v in sw.items() if k != "metrics"}, src, WAP_HEAD, d)
            for m in METRICS:
                compare(f"panels[{p['key']}].season_weather.{m}", sw["metrics"][m], {f: src[f"{m}_{f}"] for f in WAP_FIELDS}, WAP_FIELDS, d)
            n_wap += 1
        src = rc_rows.get((p["key"], "rel", "season"))
        if (src is None) != (p["response"] is None):
            fail(f"panels[{p['key']}]: response row presence")
        elif src is not None:
            compare(f"panels[{p['key']}].response", p["response"], src, RC_COLS, d)
    # a season-weather row whose panel has no prediction rows (its season label is not a prediction panel's) has no page to sit on
    n_wap_expected = int(wap.key.isin(pp.key).sum())
    if n_pred != len(pp) or n_wap != n_wap_expected:
        fail(f"panels.json carries {n_pred} prediction and {n_wap} season-weather rows; results have {len(pp)} and {n_wap_expected} on prediction panels ({len(wap)} in all)")
    # ---- world.json against prediction_world, the results manifest and response_country ------------------------------
    world = _loads_record((base / "world.json").read_text()); d = P["world.json"]
    pw_rows = index_rows(R("prediction_world"), ["crop_family", "method", "scenario"])
    for row in world["world"]:
        src = pw_rows.get((row["crop_family"], row["method"], row["scenario"]))
        if src is None:
            fail(f"world[{row['crop_family']}/{row['method']}/{row['scenario']}]: no prediction_world row"); continue
        compare(f"world[{row['crop_family']}/{row['method']}/{row['scenario']}]", row, src, ["crop_family", "issue", "method", "scenario", "dprod_mt", "pct", "lo", "hi", "production_mt", "coverage_share"], d)
    if len(world["world"]) != len(pw_rows):
        fail("world.json does not carry every prediction_world row")
    sp_rows = index_rows(R("scenario_index_path"), ["scenario", "index", "year", "month"])
    for row in world["index_path"]:
        src = sp_rows.get((row["scenario"], row["index"], row["year"], row["month"]))
        if src is None:
            fail(f"world.index_path: no scenario_index_path row for {row}"); continue
        compare(f"world.index_path[{row['scenario']}/{row['index']}/{row['year']}-{row['month']}]", row, src, ["issue", "scenario", "index", "year", "month", "value", "observed"], d)
    if len(world["index_path"]) != len(sp_rows):
        fail("world.index_path does not carry every scenario_index_path row")
    for k, v in rman["headline"].items():
        checked += 1
        if not same(world["headline"].get(k), v, None):
            fail(f"world.headline.{k}: {world['headline'].get(k)} against manifest {v}")
    checked += 1
    if world["index"] != rman["index"]:
        fail("world.index differs from the results manifest")
    n_resp = 0
    for row in world["responses"]:
        src = rc_rows.get((row["key"], "rel", "season"))
        if src is None:
            fail(f"world.responses[{row['key']}]: no response_country row"); continue
        compare(f"world.responses[{row['key']}]", row, src, ["iso3", "crop_code", "season"] + RC_COLS, d); n_resp += 1
    if n_resp != int((rc["index"].eq("rel") & rc.window.eq("season")).sum()):
        fail("world.responses does not carry every season/rel country row")
    # ---- skill.json against evaluation_skill (panel level) ------------------------------------------------------------
    sk = R("evaluation_skill"); sk = sk[sk.level.eq("panel") & sk.crop_code.isin(staples)].copy(); sk["key"] = key_of(sk)
    sk_rows = index_rows(sk.drop(columns=["series_id"]), ["key", "method", "lead"]); d = P["skill.json"]
    skill = _loads_record((base / "skill.json").read_text()); n_sk = 0
    for key, rows in skill["panels"].items():
        for row in rows:
            src = sk_rows.get((key, row["method"], row["lead"]))
            if src is None:
                fail(f"skill[{key}]: no evaluation_skill row for {row['method']} lead {row['lead']}"); continue
            compare(f"skill[{key}].{row['method']}/{row['lead']}", row, src, ["method", "lead", "n_years", "rmse", "mae", "skill_vs_trend", "corr", "coverage_80", "note"], d); n_sk += 1
    if n_sk != len(sk_rows):
        fail(f"skill.json carries {n_sk} rows; evaluation_skill has {len(sk_rows)} panel rows in scope")
    # ---- countries against response_country and response_region --------------------------------------------------------
    rr = R("response_region"); rr = rr[rr.crop_code.isin(staples)]
    rr_rows = index_rows(rr, ["region_key", "crop_code", "season", "index"]); d = P["countries"]
    RR_COLS = ["region_key", "region_name", "crop_code", "season", "index", "beta", "se", "pct_per_degC", "lo", "hi", "p", "q", "pct_shrunk", "lo_shrunk", "hi_shrunk", "tau", "n_units", "n_years", "production_t"]
    n_rc = n_rr = 0
    for iso in cat["countries"]:
        cf = _loads_record((base / "countries" / f"{iso}.json").read_text())
        for row in cf["responses"]:
            src = rc_rows.get((f"{iso}|{row['crop_code']}|{row['season']}", row["index"], row["window"]))
            if src is None:
                fail(f"countries/{iso}: no response_country row for {row['crop_code']} {row['season']} {row['index']} {row['window']}"); continue
            compare(f"countries/{iso}.responses[{row['crop_code']}|{row['season']}|{row['index']}|{row['window']}]", row, src, ["crop_code", "season"] + RC_COLS, d); n_rc += 1
        for row in cf["regions"]:
            src = rr_rows.get((row["region_key"], row["crop_code"], row["season"], row["index"]))
            if src is None:
                fail(f"countries/{iso}: no response_region row for {row['region_key']} {row['crop_code']} {row['season']} {row['index']}"); continue
            compare(f"countries/{iso}.regions[{row['region_key']}|{row['crop_code']}|{row['season']}|{row['index']}]", row, src, RR_COLS, d); n_rr += 1
    if n_rc != len(rc_rows) or n_rr != len(rr_rows):
        fail(f"countries carry {n_rc} country and {n_rr} region rows against {len(rc_rows)} and {len(rr_rows)} in results")
    # ---- units against response_unit, prediction_series, observations and season_windows ------------------------------
    ru = R("response_unit"); ru = ru[ru.crop_code.isin(staples)]
    ps = R("prediction_series")
    ru_by = {k: g for k, g in ru.groupby("series_id")}; ps_by = {k: g for k, g in ps.groupby("series_id")}
    con = sqlite3.connect(f"file:{manifest['database']['path'] if Path(manifest['database']['path']).is_absolute() else ENSO / manifest['database']['path']}?mode=ro", uri=True)
    obs = pd.read_sql("SELECT o.series_id, o.harvest_year, o.yield_t_ha FROM observations o JOIN series s USING (series_id) WHERE s.staple = 1 AND o.yield_t_ha IS NOT NULL ORDER BY o.series_id, o.harvest_year", con)
    win = pd.read_sql("SELECT series_id, harvest_year, start_date, end_date, source, cycle FROM season_windows WHERE harvest_year >= (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'horizon') - 1", con)
    con.close()
    obs_by = {k: g[["harvest_year", "yield_t_ha"]].to_numpy() for k, g in obs.groupby("series_id")}
    win_by = {k: g.sort_values("harvest_year") for k, g in win.groupby("series_id")}
    d_u, d_o = P["units"], P["records"]
    staple_ids = set(int(s["id"]) for iso in cat["countries"] for u in _loads_record((base / "units" / f"{iso}.json").read_text())["units"].values() for s in u["series"])
    ts = R("trend_series"); ts = ts[ts.series_id.isin(staple_ids)]; ts_by = {int(r["series_id"]): r for r in ts.to_dict("records")}
    ta = R("trend_anomaly"); ta = ta[ta.series_id.isin(staple_ids)]; ta_by = {k: g[["harvest_year", "yield_t_ha", "fitted_yield", "anomaly_pct"]].to_numpy() for k, g in ta.groupby("series_id")}
    wa = R("weather_todate_anomaly"); wa = wa[wa.series_id.isin(staple_ids)]; wa_by = {k: g for k, g in wa.groupby("series_id")}
    WA_HEAD = ["product", "issue", "data_end", "harvest_year", "frac_elapsed", "elapsed_days", "t_coverage", "p_coverage"]
    WA_FIELDS = ["value", "reference", "anom", "z", "pct_rank", "n_years"]
    TS_COLS = ["year_first", "year_last", "n_years", "trend_pct_per_year", "intercept"]
    n_ts = n_ta = n_wa = 0
    RU_COLS = ["index", "n_years", "pct_raw", "lo_raw", "hi_raw", "p_raw", "pct_best", "lo_best", "hi_best", "p_best", "shrink_weight", "response_level"]
    PS_COLS = ["method", "scenario", "harvest_year", "issue", "lead", "pct", "lo", "hi", "se", "frac_elapsed", "usable", "skill_vs_trend", "production_t", "beyond_fit"]
    WIN_COLS = ["harvest_year", "start_date", "end_date", "source", "cycle"]
    n_ru = n_ps = n_obs = n_win = 0; seen_series = set()
    for iso in cat["countries"]:
        uf = _loads_record((base / "units" / f"{iso}.json").read_text())
        rf = _loads_record((base / "records" / f"{iso}.json").read_text())
        assert uf["columns"]["responses"] == RU_COLS and uf["columns"]["predictions"] == PS_COLS and uf["columns"]["windows"] == WIN_COLS and uf["columns"]["weather"] == WA_HEAD
        for ukey, u in uf["units"].items():
            for s in u["series"]:
                sid = int(s["id"]); seen_series.add(sid); w = f"units/{iso}/{ukey}/{sid}"
                src = ru_by.get(sid)
                if (src is None and s["responses"]) or (src is not None and len(src) != len(s["responses"])):
                    fail(f"{w}: {len(s['responses'])} response rows against {0 if src is None else len(src)}")
                elif src is not None:
                    by_index = {r["index"]: r for r in src.to_dict("records")}
                    for row in s["responses"]:
                        compare(f"{w}.responses[{row[0]}]", row, by_index[row[0]], RU_COLS, d_u); n_ru += 1
                src = ps_by.get(sid)
                if (src is None and s["predictions"]) or (src is not None and len(src) != len(s["predictions"])):
                    fail(f"{w}: {len(s['predictions'])} prediction rows against {0 if src is None else len(src)}")
                elif src is not None:
                    by_ms = {(r["method"], r["scenario"]): r for r in src.to_dict("records")}
                    for row in s["predictions"]:
                        compare(f"{w}.predictions[{row[0]}/{row[1]}]", row, by_ms[(row[0], row[1])], PS_COLS, d_u); n_ps += 1
                rec = rf["series"][s["id"]]
                t = ts_by.get(sid)
                if (t is None) != (rec["trend"] is None):
                    fail(f"{w}: trend row presence")
                elif t is not None:
                    compare(f"{w}.trend", rec["trend"], t, TS_COLS, d_o); n_ts += 1
                fit = ta_by.get(sid); site_fit = np.array(rec["trend_anomaly"], dtype=float).reshape(-1, 4)
                if fit is None:
                    if len(site_fit):
                        fail(f"{w}: fitted values without trend_anomaly rows")
                else:
                    expected = np.array([[round(float(v), d_o) if d_o is not None else float(v) for v in row] for row in fit])
                    checked += 4 * len(fit)
                    if len(site_fit) != len(fit) or not np.array_equal(site_fit[:, 0], fit[:, 0]) or not np.array_equal(site_fit[:, 1:], expected[:, 1:]):
                        fail(f"{w}: trend_anomaly rows differ from the results")
                    n_ta += len(fit)
                wsrc = wa_by.get(sid)
                if (wsrc is None and s["weather"]) or (wsrc is not None and len(wsrc) != len(s["weather"])):
                    fail(f"{w}: {len(s['weather'])} weather rows against {0 if wsrc is None else len(wsrc)}")
                elif wsrc is not None:
                    by_prod = {r["product"]: r for r in wsrc.to_dict("records")}
                    for row in s["weather"]:
                        src = by_prod[row["product"]]
                        compare(f"{w}.weather[{row['product']}]", {k: v for k, v in row.items() if k != "metrics"}, src, WA_HEAD, d_u)
                        for m in METRICS:
                            src_m = {f: src[f"{m}_{f}"] for f in WA_FIELDS}
                            if m in row["metrics"]:
                                compare(f"{w}.weather[{row['product']}].{m}", row["metrics"][m], src_m, WA_FIELDS, d_u)
                            elif any(expect(v, None) is not None for v in src_m.values()):
                                fail(f"{w}.weather[{row['product']}]: metric {m} omitted although the results carry it")
                        n_wa += 1
                o = obs_by.get(sid)
                site = np.array(rec["obs"], dtype=float).reshape(-1, 2)
                if o is None:
                    if len(site):
                        fail(f"{w}: observations without database rows")
                else:
                    checked += 2 * len(o)
                    # the exporter rounds with Python's round(), so the expectation uses the same function
                    expected = np.array([round(float(v), d_o) if d_o is not None else float(v) for v in o[:, 1]])
                    if len(site) != len(o) or not np.array_equal(site[:, 0], o[:, 0]) or not np.array_equal(site[:, 1], expected):
                        fail(f"{w}: observations differ from the database")
                    n_obs += len(o)
                src = win_by.get(sid)
                if (src is None and s["windows"]) or (src is not None and len(src) != len(s["windows"])):
                    fail(f"{w}: {len(s['windows'])} window rows against {0 if src is None else len(src)}")
                elif src is not None:
                    for row, r in zip(s["windows"], src.to_dict("records")):
                        compare(f"{w}.windows[{row[0]}]", row, r, WIN_COLS, None); n_win += 1
    missing_ru = set(ru_by) - seen_series; missing_ps = set(ps_by) - seen_series
    if missing_ru or missing_ps:
        fail(f"{len(missing_ru)} response_unit and {len(missing_ps)} prediction_series series are absent from the site")
    if n_ru != len(ru) or n_ps != len(ps):
        fail(f"units carry {n_ru} response and {n_ps} prediction rows against {len(ru)} and {len(ps)} in results")
    if n_ts != len(ts) or n_ta != len(ta) or n_wa != len(wa):
        fail(f"records and units carry {n_ts} trend, {n_ta} fitted and {n_wa} weather rows against {len(ts)}, {len(ta)} and {len(wa)} in results")
    if problems:
        raise SystemExit("FAIL numerics:\n" + "\n".join(problems))
    print(f"PASS numerics {release}: {checked:,} values compared; {n_pred} panel predictions, {len(world['world'])} world rows, {n_resp} country responses, {n_sk} skill rows, "
          f"{n_rc} country and {n_rr} region rows, {n_ru} unit responses, {n_ps} series predictions, {n_wa} series weather rows, {n_wap} panel weather rows, "
          f"{len(world['index_path'])} index path months, {n_obs:,} observations, {n_ts} trends with {n_ta:,} fitted rows, {n_win} windows")




# ---- the contract of 9 October 2026 ---------------------------------------------------------------------------------
CONTRACT_V2 = "2026-10-09"
PP_COLS = ["method", "scenario", "harvest_year", "issue", "lead", "pct", "lo", "hi", "se", "production_mt", "n_series", "local_share", "usable_share", "status"]
AG_COLS = ["method", "scenario", "target_year", "issue", "dprod_mt_mean", "pct_mean", "dprod_lo", "dprod_hi", "pct_lo", "pct_hi", "dprod_lo_resp", "dprod_hi_resp",
           "pct_lo_resp", "pct_hi_resp", "dprod_mt_point", "pct_point", "pct_sd", "pct_sd_resp", "dprod_mt_mean_pred", "baseline_production_mt", "covered_share",
           "n_leaves", "n_rep", "footprint_id"]
WP_COLS = ["key", "iso3", "crop_code", "crop_family", "season", "harvest_year", "lead", "status", "n_series", "local_share", "baseline_production_mt",
           "pct", "lo", "hi", "se", "lo_resp", "hi_resp", "dprod_mt", "dprod_lo", "dprod_hi", "n_leaves"]
WP_FROM_PP = dict(iso3="iso3", crop_code="crop_code", season="season", harvest_year="harvest_year", lead="lead", status="status", n_series="n_series", local_share="local_share",
                  baseline_production_mt="production_mt", pct="pct", lo="lo", hi="hi", se="se")
WP_FROM_AG = dict(lo_resp="pct_lo_resp", hi_resp="pct_hi_resp", dprod_mt="dprod_mt_mean", dprod_lo="dprod_lo", dprod_hi="dprod_hi", n_leaves="n_leaves")
WW_FROM_PW = ["crop_family", "issue", "method", "scenario", "dprod_mt", "pct", "lo", "hi", "production_mt", "coverage_share"]
WW_FROM_AG = dict(target_year="target_year", lo_resp="pct_lo_resp", hi_resp="pct_hi_resp", dprod_lo="dprod_lo", dprod_hi="dprod_hi", dprod_lo_resp="dprod_lo_resp", dprod_hi_resp="dprod_hi_resp",
                  dprod_mt_point="dprod_mt_point", pct_point="pct_point", covered_share="covered_share", n_leaves="n_leaves", footprint_id="footprint_id")
RL_COLS = ["variable", "index", "n_years", "year_first", "year_last", "slope_own", "se_own", "se_source", "slope_eb", "se_eb", "own_data_weight", "pct_eb", "lo_eb", "hi_eb", "note"]
RL_WITHHELD = ["slope_eb", "se_eb", "pct_eb", "lo_eb", "hi_eb"]
PS_COLS = ["method", "scenario", "harvest_year", "issue", "lead", "pct", "lo", "hi", "se", "frac_elapsed", "usable", "skill_vs_trend", "production_t", "beyond_fit"]
CS_COLS = ["harvest_year", "cycle", "plant_date", "harvest_date", "calendar_source", "calendar_rank", "confidence", "window_source", "rule", "cycle_unresolved"]
CW_COLS = ["harvest_year", "series_id", "unit_key", "series_crop", "series_season", "match"] + CS_COLS[1:]
W_COLS = ["target_year", "issue", "lead", "frac_elapsed", "area_ha", "area_vintage", "area_source", "trend_yield", "trend_yield_fit", "trend_source", "last_yield",
          "last_yield_year", "baseline_production_t", "status", "covered"]
SK_COLS_V2 = ["method", "lead", "n_years", "rmse", "mae", "skill_vs_trend", "corr", "coverage_80", "note", "n_series", "train_years", "info_cutoff", "method_version"]
WA_HEAD = ["product", "issue", "data_end", "harvest_year", "frac_elapsed", "elapsed_days", "t_coverage", "p_coverage"]
WA_FIELDS = ["value", "reference", "anom", "z", "pct_rank", "n_years"]
WAP_HEAD = ["issue", "harvest_year", "data_end", "frac_elapsed", "n_series", "n_years", "production_t", "coverage_share", "idx_todate", "metrics_with_signal", "metrics_concordant", "verdict"]
WAP_FIELDS = ["value", "anom", "product", "expected", "percentile", "z", "slope_per_degC", "slope_p", "resid_sd", "hist_sd", "signal", "beyond_range"]
TS_COLS = ["year_first", "year_last", "n_years", "trend_pct_per_year", "intercept"]
# Any [year,number... pair as the exporter writes an observation or anomaly row: the pass that proves no restricted yield is exported.
PAIR_RE = re.compile(r"\[\s*((?:19|20)\d\d)\s*,\s*(-?\d+\.\d+)")


def resolve_permission(perm: dict, source: str, iso3: str) -> tuple[str, bool]:
    """A second reading of permissions.toml: the entry id and display_points a series takes (the exporter has its own)."""
    entry = perm.get("sources", {}).get(source)
    if entry is not None and iso3 in entry.get("by_iso3", {}):
        source = entry["by_iso3"][iso3]; entry = perm["sources"].get(source)
    if entry is None:
        return source, bool(perm.get("default", {}).get("display_points", False))
    return source, bool(entry.get("display_points", perm.get("default", {}).get("display_points", False)))


def check_v2(release: str) -> None:
    global RL_COLS, RL_WITHHELD, AG_COLS
    global checked
    import tomli
    base = SITE / release
    manifest = _loads_record((base / "manifest.json").read_text())
    results = ENSO / manifest["results"]["path"]
    rman = _loads_record((results / "manifest.json").read_text())
    assert manifest["results"]["manifest_sha256"] == hashlib.sha256((results / "manifest.json").read_bytes()).hexdigest(), "results manifest changed since the export"
    for name, t in manifest["tables"].items():
        if t["path"] is not None:
            assert hashlib.sha256((ENSO / t["path"]).read_bytes()).hexdigest() == t["sha256"], f"{name}.parquet changed since the export"
    T = lambda n: pd.read_parquet(ENSO / manifest["tables"][n]["path"]) if manifest["tables"].get(n, {}).get("path") else None
    P = manifest["precision"]["decimals"]
    cat = _loads_record((base / "catalog.json").read_text())
    RL_COLS = RL_COLS[:15]
    RL_WITHHELD = RL_WITHHELD[:5]
    AG_COLS = AG_COLS[:24]
    if cat.get('model',{}).get('replicates',{}).get('method') == 'centered_year_blocks_plus_shrinkage_student_v1':
        RL_COLS += ['slope_lo','slope_hi','slope_lo80','slope_hi80','interval_method']
        RL_WITHHELD += ['slope_lo','slope_hi','slope_lo80','slope_hi80']
        AG_COLS += ['pct_lo95','pct_hi95','dprod_lo95','dprod_hi95']

    staples = set(cat["crops"])
    key_of = lambda d: [f"{i}|{c}|{s}" for i, c, s in zip(d.iso3, d.crop_code, d.season)]
    harvest_years = manifest["harvest_years"]
    # ---- database -------------------------------------------------------------------------------------------------
    con = sqlite3.connect(f"file:{manifest['database']['path']}?mode=ro", uri=True)
    series = pd.read_sql("SELECT series_id, unit_key, iso3, crop_code, season_std AS season, crop_family, source, n_obs, tier FROM series WHERE staple = 1", con)
    obs = pd.read_sql("SELECT o.series_id, o.harvest_year, o.yield_t_ha FROM observations o JOIN series s USING (series_id) WHERE s.staple = 1 AND o.yield_t_ha IS NOT NULL ORDER BY o.series_id, o.harvest_year", con)
    enso = pd.read_sql("SELECT e.series_id, e.harvest_year, e.n34_season, e.n34rel_season FROM enso_windows e JOIN series s USING (series_id) WHERE s.staple = 1 ORDER BY e.series_id, e.harvest_year", con)
    qc = pd.read_sql("SELECT q.series_id, q.year_label, q.check_name, q.severity, q.note FROM qc_flags q JOIN series s USING (series_id) WHERE s.staple = 1 ORDER BY q.series_id, q.year_label, q.check_name", con)
    region_names = pd.read_sql("SELECT region_key, region_name FROM unit_regions", con).drop_duplicates("region_key").set_index("region_key").region_name.to_dict()
    ws = pd.read_sql("SELECT w.series_id, w.harvest_year, w.product, w.tavg_mean, w.precip FROM weather_season w JOIN series s USING (series_id) "
                     "WHERE s.staple = 1 AND w.frac_elapsed >= 0.999 AND w.product IN ('best', 'chirps') AND w.harvest_year BETWEEN 1981 AND 2025 ORDER BY w.series_id, w.harvest_year", con)
    # the greenness history (14 October 2026): read before the connection closes, merged after the weather history below
    has_ndvi = bool(pd.read_sql("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='ndvi_season'", con).n.iloc[0])
    ns = pd.read_sql("SELECT n.series_id, n.harvest_year, n.ndvi_mean, n.provisional FROM ndvi_season n JOIN series s USING (series_id) WHERE s.staple = 1 AND n.product = 'vhp' "
                     "AND n.frac_elapsed >= 0.999 AND n.coverage >= 0.8 AND n.ndvi_mean IS NOT NULL AND n.harvest_year BETWEEN 1981 AND 2025 ORDER BY n.series_id, n.harvest_year", con) if has_ndvi else None
    con.close()
    def detrend(frame, col):
        g = frame.dropna(subset=[col]).groupby("series_id"); y = frame[col]; t = frame.harvest_year.astype(float)
        mt = g.harvest_year.transform("mean"); my = g[col].transform("mean")
        cov = ((t - mt) * (y - my)).groupby(frame.series_id).transform("sum"); var = ((t - mt) ** 2).groupby(frame.series_id).transform("sum")
        return y - (my + (cov / var.where(var > 0)).fillna(0.0) * (t - mt))
    wsb = ws[ws["product"].eq("best")][["series_id", "harvest_year", "tavg_mean"]].copy(); wsb["tavg_anom"] = detrend(wsb, "tavg_mean")
    wsc = ws[ws["product"].eq("chirps")][["series_id", "harvest_year", "precip"]].copy(); wsc["precip_anom"] = detrend(wsc, "precip")
    wsh = wsb[["series_id", "harvest_year", "tavg_anom"]].merge(wsc[["series_id", "harvest_year", "precip_anom"]], on=["series_id", "harvest_year"], how="outer").sort_values(["series_id", "harvest_year"])
    if ns is not None and len(ns):
        ref = ns[ns.harvest_year >= 2001]; g = ref.groupby("series_id"); mt = g.harvest_year.mean(); my = g.ndvi_mean.mean()
        cov = ((ref.harvest_year - ref.series_id.map(mt)) * (ref.ndvi_mean - ref.series_id.map(my))).groupby(ref.series_id).sum(); var = ((ref.harvest_year - ref.series_id.map(mt)) ** 2).groupby(ref.series_id).sum()
        slope = (cov / var.where(var > 0)).fillna(0.0); n_ref = g.size(); ns = ns[ns.series_id.isin(n_ref.index[n_ref >= 10])].copy()
        ns["ndvi_anom"] = ns.ndvi_mean - (ns.series_id.map(my) + ns.series_id.map(slope) * (ns.harvest_year - ns.series_id.map(mt)))
        wsh = wsh.merge(ns[["series_id", "harvest_year", "ndvi_anom", "provisional"]], on=["series_id", "harvest_year"], how="outer").sort_values(["series_id", "harvest_year"])
    else:
        wsh["ndvi_anom"] = np.nan; wsh["provisional"] = np.nan
    hist_by = {k: v[["harvest_year", "tavg_anom", "precip_anom", "ndvi_anom", "provisional"]].to_numpy() for k, v in wsh.groupby("series_id")}
    series["series_id"] = series.series_id.astype("int64")
    staple_ids = set(series.series_id)
    perm = tomli.loads((ENSO / manifest["permissions"]["path"]).read_text())
    expected_perm = {int(r.series_id): resolve_permission(perm, r.source, r.iso3) for r in series.itertuples(index=False)}
    obs_by = {k: g[["harvest_year", "yield_t_ha"]].to_numpy() for k, g in obs.groupby("series_id")}
    enso_by = {k: g[["harvest_year", "n34_season", "n34rel_season"]].to_numpy() for k, g in enso.groupby("series_id")}
    qc_by = {k: g[["year_label", "check_name", "severity", "note"]].to_dict("records") for k, g in qc.groupby("series_id")}
    # ---- results tables -------------------------------------------------------------------------------------------
    pp = T("prediction_panel"); pp = pp[pp.crop_code.isin(staples)].copy(); pp["key"] = key_of(pp)
    ag = T("aggregate"); agc = ag[ag.level.eq("country") & ag.crop_code.isin(staples)].copy(); agc["key"] = key_of(agc)
    agr = ag[ag.level.eq("region") & ag.crop_code.isin(staples)]; agw = ag[ag.level.eq("world")]
    pw = T("prediction_world"); sp = T("scenario_index_path")
    rl = T("response_leaf"); rl = rl[rl.series_id.isin(staple_ids)]
    ps = T("prediction_series"); ps = ps[ps.series_id.isin(staple_ids)]
    wt = T("weights"); wt = wt[wt.series_id.isin(staple_ids)]
    cs = T("calendar_status"); cs = cs[cs.series_id.isin(staple_ids)].copy()
    cs["cycle_unresolved"] = cs.cycle.eq("both") | cs.confidence.eq("missing")
    ts = T("trend_series"); ts = ts[ts.series_id.isin(staple_ids)]
    ta = T("trend_anomaly"); ta = ta[ta.series_id.isin(staple_ids)]
    sk = T("evaluation_skill"); wa = T("weather_todate_anomaly"); wap = T("weather_todate_anomaly_panel"); pwp = T("prediction_weather_panel")
    pp_rows = index_rows(pp, ["key", "method", "scenario"]); agc_rows = index_rows(agc, ["key", "method", "scenario"])
    agw_rows = index_rows(agw, ["key", "method", "scenario"]); pw_rows = index_rows(pw, ["crop_family", "method", "scenario"])
    agr_rows = index_rows(agr, ["key", "crop_code", "season", "method", "scenario"])
    # ---- world.json ------------------------------------------------------------------------------------------------
    world = _loads_record((base / "world.json").read_text()); d = P["world.json.panels"]
    assert world["columns"]["panels"] == WP_COLS
    n_wp = 0
    for row in world["panels"]:
        r = dict(zip(WP_COLS, row)); key = r["key"]
        src = pp_rows.get((key, "index_outlook", "medium")); srca = agc_rows.get((key, "index_outlook", "medium"))
        if src is None or srca is None:
            fail(f"world.panels[{key}]: no medium index_outlook row in prediction_panel or aggregate"); continue
        compare(f"world.panels[{key}]", {k: r[k] for k in WP_FROM_PP}, {k: src[v] for k, v in WP_FROM_PP.items()}, list(WP_FROM_PP), d)
        compare(f"world.panels[{key}]", {k: r[k] for k in WP_FROM_AG}, {k: srca[v] for k, v in WP_FROM_AG.items()}, list(WP_FROM_AG), d)
        n_wp += 1
    n_medium = int((pp.method.eq("index_outlook") & pp.scenario.eq("medium")).sum())
    if n_wp != n_medium:
        fail(f"world.panels carries {n_wp} rows against {n_medium} medium index_outlook panels")
    d = P["world.json"]
    for row in world["world"]:
        k = (row["crop_family"], row["method"], row["scenario"])
        src = pw_rows.get(k); srca = agw_rows.get(k)
        if src is None or srca is None:
            fail(f"world.world[{k}]: no prediction_world or aggregate world row"); continue
        compare(f"world.world[{k}]", {c: row[c] for c in WW_FROM_PW}, src, WW_FROM_PW, d)
        compare(f"world.world[{k}]", {c: row[c] for c in WW_FROM_AG}, {c: srca[v] for c, v in WW_FROM_AG.items()}, list(WW_FROM_AG), d)
    if len(world["world"]) != len(pw_rows):
        fail("world.json does not carry every prediction_world row")
    sp_rows = index_rows(sp, ["scenario", "index", "year", "month"])
    for row in world["index_path"]:
        src = sp_rows.get((row["scenario"], row["index"], row["year"], row["month"]))
        if src is None:
            fail(f"world.index_path: no scenario_index_path row for {row}"); continue
        compare(f"world.index_path[{row['scenario']}/{row['index']}/{row['year']}-{row['month']}]", row, src, ["issue", "scenario", "index", "year", "month", "value", "observed"], d)
    if len(world["index_path"]) != len(sp_rows):
        fail("world.index_path does not carry every scenario_index_path row")
    checked += 1
    if world["index"] != rman["index"]:
        fail("world.index differs from the results manifest")
    # ---- calendar_world.json: the rows and the national-series rule --------------------------------------------------
    cw = _loads_record((base / "calendar_world.json").read_text()); d = P["calendar_world.json"]
    cs_rows = index_rows(cs, ["series_id", "harvest_year"])
    national = series[series.unit_key.eq(series.iso3)]
    nat_by = {k: g for k, g in national.groupby("iso3")}
    crop_family = cat["crops"]
    n_cw = 0; expected_panels = 0
    for key in {p[0] for p in world["panels"]}:
        iso, crop, season = key.split("|")
        cands = nat_by.get(iso)
        fam = crop_family[crop]["family"]
        scored = [((s.crop_code == crop) + (s.crop_code == crop and s.season == season), int(s.n_obs), -int(s.series_id), s) for s in (cands.itertuples(index=False) if cands is not None else [])
                  if s.crop_family == fam]
        best = max(scored, key=lambda x: x[:3]) if scored else None
        if best is None or (int(best[3].series_id), harvest_years[0]) not in cs_rows:
            if key in cw["panels"]:
                fail(f"calendar_world[{key}]: a calendar although the country has no national {fam} series with calendar rows")
            continue
        expected_panels += 1
        rws = cw["panels"].get(key)
        if rws is None:
            fail(f"calendar_world[{key}]: missing"); continue
        match = {2: "crop+season", 1: "crop", 0: "family"}[best[0]]
        for row in rws:
            r = dict(zip(CW_COLS, row))
            checked += 4
            if r["series_id"] != str(int(best[3].series_id)) or r["match"] != match or r["series_crop"] != best[3].crop_code or r["series_season"] != best[3].season:
                fail(f"calendar_world[{key}]: series {r['series_id']} ({r['match']}) is not the national series the rule names, {int(best[3].series_id)} ({match})"); break
            src = cs_rows.get((int(r["series_id"]), r["harvest_year"]))
            if src is None:
                fail(f"calendar_world[{key}]: no calendar_status row for harvest {r['harvest_year']}"); continue
            compare(f"calendar_world[{key}][{r['harvest_year']}]", r, src, CS_COLS, d); n_cw += 1
        if len(rws) != sum(1 for y in harvest_years if (int(best[3].series_id), y) in cs_rows):
            fail(f"calendar_world[{key}]: {len(rws)} rows against the calendar_status rows of its series")
    if len(cw["panels"]) != expected_panels:
        fail(f"calendar_world carries {len(cw['panels'])} panels against {expected_panels} with a national calendar")
    # ---- skill.json against evaluation_skill at country level -------------------------------------------------------
    skill = _loads_record((base / "skill.json").read_text()); d = P["skill.json"]; n_sk = 0
    if sk is not None:
        skc = sk[sk.level.eq("country") & sk.crop_code.isin(staples)].copy(); skc["key"] = key_of(skc)
        for c in SK_COLS_V2:
            if c not in skc.columns:
                skc[c] = None
        sk_rows = index_rows(skc[["key"] + SK_COLS_V2], ["key", "method", "lead"])
        for key, rws in skill["panels"].items():
            for row in rws:
                r = dict(zip(SK_COLS_V2, row))
                src = sk_rows.get((key, r["method"], r["lead"]))
                if src is None:
                    fail(f"skill[{key}]: no evaluation_skill row for {r['method']} lead {r['lead']}"); continue
                compare(f"skill[{key}].{r['method']}/{r['lead']}", r, src, SK_COLS_V2, d); n_sk += 1
        if n_sk != len(sk_rows):
            fail(f"skill.json carries {n_sk} rows; evaluation_skill has {len(sk_rows)} country rows in scope")
    elif skill["panels"]:
        fail("skill.json carries rows although no evaluation_skill table was read")
    # ---- countries ---------------------------------------------------------------------------------------------------
    d = P["countries"]; n_pp = n_agc = n_agr = n_wap = n_pwp = 0
    wap_rows = index_rows(wap.assign(key=key_of(wap)), ["key"]) if wap is not None else {}
    pwp_rows = index_rows(pwp.assign(key=key_of(pwp)), ["key"]) if pwp is not None else {}
    METRICS = cat["weather_metrics"]
    for iso in cat["countries"]:
        cf = _loads_record((base / "countries" / f"{iso}.json").read_text())
        for p in cf["panels"]:
            head = pp_rows.get((p["key"], "index_outlook", "medium"))
            compare(f"countries/{iso}.panels[{p['key']}].head", dict(harvest_year=p["harvest_year"], status=p["status"], n_series=p["n_series"], baseline_production_mt=p["baseline_production_mt"]),
                    dict(harvest_year=head["harvest_year"], status=head["status"], n_series=head["n_series"], baseline_production_mt=head["production_mt"]), ["harvest_year", "status", "n_series", "baseline_production_mt"], d)
            for row in p["predictions"]:
                r = dict(zip(PP_COLS, row)); src = pp_rows.get((p["key"], r["method"], r["scenario"]))
                if src is None:
                    fail(f"countries/{iso}.panels[{p['key']}]: no prediction_panel row for {r['method']}/{r['scenario']}"); continue
                compare(f"countries/{iso}.panels[{p['key']}].predictions[{r['method']}/{r['scenario']}]", r, src, PP_COLS, d); n_pp += 1
            for row in p["aggregate"]:
                r = dict(zip(AG_COLS, row)); src = agc_rows.get((p["key"], r["method"], r["scenario"]))
                if src is None:
                    fail(f"countries/{iso}.panels[{p['key']}]: no aggregate country row for {r['method']}/{r['scenario']}"); continue
                compare(f"countries/{iso}.panels[{p['key']}].aggregate[{r['method']}/{r['scenario']}]", r, src, AG_COLS, d); n_agc += 1
            src = wap_rows.get((p["key"],))
            if (src is None) != (p["season_weather"] is None):
                fail(f"countries/{iso}.panels[{p['key']}]: season_weather presence")
            elif src is not None:
                sw = p["season_weather"]
                compare(f"countries/{iso}.panels[{p['key']}].season_weather", {k: v for k, v in sw.items() if k != "metrics"}, src, WAP_HEAD, d)
                for m in METRICS:
                    compare(f"countries/{iso}.panels[{p['key']}].season_weather.{m}", sw["metrics"][m], {f: src[f"{m}_{f}"] for f in WAP_FIELDS}, WAP_FIELDS, d)
                n_wap += 1
            src = pwp_rows.get((p["key"],))
            if (src is None) != (p["weather"] is None):
                fail(f"countries/{iso}.panels[{p['key']}]: weather row presence")
            elif src is not None:
                w = dict(p["weather"]); w["metrics"] = ",".join(w["metrics"])
                compare(f"countries/{iso}.panels[{p['key']}].weather", w, src, ["lead", "pct_panel", "se_panel", "usable_panel", "coverage_share", "frac_started", "skill_vs_trend", "n_series", "metrics"], d); n_pwp += 1
        for row in cf["regions"]:
            r = dict(zip(["region_key", "region_name", "crop_code", "season"] + AG_COLS, row))
            src = agr_rows.get((r["region_key"], r["crop_code"], r["season"], r["method"], r["scenario"]))
            if src is None:
                fail(f"countries/{iso}.regions: no aggregate region row for {r['region_key']} {r['crop_code']} {r['season']} {r['method']}/{r['scenario']}"); continue
            compare(f"countries/{iso}.regions[{r['region_key']}|{r['crop_code']}|{r['season']}|{r['method']}/{r['scenario']}]", r, dict(src, region_name=region_names.get(r["region_key"])), ["region_name"] + AG_COLS, d); n_agr += 1
    if n_pp != len(pp) or n_agc != len(agc_rows) or n_agr != len(agr_rows):
        fail(f"countries carry {n_pp} prediction_panel, {n_agc} country and {n_agr} region aggregate rows against {len(pp)}, {len(agc_rows)} and {len(agr_rows)} in results")
    n_wap_expected = sum(1 for k in wap_rows if k[0] in set(pp.key)); n_pwp_expected = sum(1 for k in pwp_rows if k[0] in set(pp.key))
    if n_wap != n_wap_expected or n_pwp != n_pwp_expected:
        fail(f"countries carry {n_wap} season-weather and {n_pwp} weather-prediction rows against {n_wap_expected} and {n_pwp_expected} on panels")
    # ---- units and record shards ----------------------------------------------------------------------------------------
    d_u, d_ur, d_o, d_e, d_rr = P["units"], P["units.responses"], P["records"], P["records.enso"], P["records.responses"]
    rl_ly = {k: g for k, g in rl[rl.variable.eq("ly")].groupby("series_id")}; rl_env = {k: g for k, g in rl[rl.variable.ne("ly")].groupby("series_id")}
    ps_by = {k: g for k, g in ps.groupby("series_id")}; cs_by = {k: g.sort_values("harvest_year") for k, g in cs.groupby("series_id")}
    wt_by = {int(r["series_id"]): r for r in wt.to_dict("records")}; wa_by = {k: g for k, g in wa.groupby("series_id")} if wa is not None else {}
    na = T("ndvi_todate_anomaly")   # the greenness so far (14 October 2026), where the manifest lists it
    na_by = {k: g for k, g in na.groupby("series_id")} if na is not None else {}
    sp_ = T("scenario_index_path"); path_med = {(int(r.year), int(r.month)): (float(r.value), int(r.observed)) for r in sp_[sp_["index"].eq("rel") & sp_.scenario.eq("medium")].itertuples(index=False)}
    def window_months(plant, harvest):
        y0, m0 = int(plant[:4]), int(plant[5:7]); y1, m1 = int(harvest[:4]), int(harvest[5:7]); out = []; y, m = y0, m0
        while (y, m) <= (y1, m1) and len(out) < 24:
            out.append((y, m)); m += 1
            if m > 12: y, m = y + 1, 1
        return out
    n_hist = n_exp = 0
    ts_by = {int(r["series_id"]): r for r in ts.to_dict("records")}
    ta_by = {k: g[["harvest_year", "yield_t_ha", "fitted_yield", "anomaly_pct"]].to_numpy() for k, g in ta.groupby("series_id")}
    n = defaultdict(int); seen_series = set()
    def compare_responses(where, site_rows, src, d):
        by = {(r["variable"], r["index"]): r for r in src.to_dict("records")}
        if len(site_rows) != len(by):
            fail(f"{where}: {len(site_rows)} response rows against {len(by)}"); return
        for row in site_rows:
            r = dict(zip(RL_COLS, row)); s = by.get((r["variable"], r["index"]))
            if s is None:
                fail(f"{where}: no response_leaf row for {r['variable']}/{r['index']}"); continue
            if s["note"] == "no_own_slope":
                s = dict(s, **{c: None for c in RL_WITHHELD})               # withheld by the publication rule of the exporter
                n["responses_withheld"] += 1
            compare(f"{where}[{r['variable']}/{r['index']}]", r, s, RL_COLS, d); n["responses"] += 1
    for iso, c in cat["countries"].items():
        uf = _loads_record((base / "units" / f"{iso}.json").read_text())
        idx = _loads_record((base / "records" / iso / "index.json").read_text())
        for ukey, u in uf["units"].items():
            rf = _loads_record((base / "records" / iso / idx["units"][ukey][0]).read_text())
            for s in u["series"]:
                sid = int(s["id"]); seen_series.add(sid); w = f"units/{iso}/{ukey}/{sid}"
                pid, public = expected_perm[sid]; checked += 2
                if s["permission"] != pid or s["display_points"] != public:
                    fail(f"{w}: permission {s['permission']}/{s['display_points']} against {pid}/{public} from permissions.toml")
                src = rl_ly.get(sid)
                if src is None:
                    if s["responses"]:
                        fail(f"{w}: responses without response_leaf rows")
                else:
                    compare_responses(f"{w}.responses", s["responses"], src, d_ur)
                src = ps_by.get(sid)
                if (src is None and s["predictions"]) or (src is not None and len(src) != len(s["predictions"])):
                    fail(f"{w}: {len(s['predictions'])} prediction rows against {0 if src is None else len(src)}")
                elif src is not None:
                    by_ms = {(r["method"], r["scenario"]): r for r in src.to_dict("records")}
                    for row in s["predictions"]:
                        compare(f"{w}.predictions[{row[0]}/{row[1]}]", row, by_ms[(row[0], row[1])], PS_COLS, P.get('units.predictions',d_u)); n["predictions"] += 1
                src = cs_by.get(sid)
                if (src is None and s["calendar"]) or (src is not None and len(src) != len(s["calendar"])):
                    fail(f"{w}: {len(s['calendar'])} calendar rows against {0 if src is None else len(src)}")
                elif src is not None:
                    for row, r in zip(s["calendar"], src.to_dict("records")):
                        compare(f"{w}.calendar[{row[0]}]", row, r, CS_COLS, None); n["calendar"] += 1
                src = wt_by.get(sid)
                if (src is None) != (s["weight"] is None):
                    fail(f"{w}: weight row presence")
                elif src is not None:
                    compare(f"{w}.weight", s["weight"], src, W_COLS, d_u); n["weights"] += 1
                rec = rf["series"][s["id"]]
                wsrc = wa_by.get(sid); wrows = [r for r in rec["weather"] if r["product"] != "vhp"]; vrows = [r for r in rec["weather"] if r["product"] == "vhp"]
                nsrc = na_by.get(sid)
                if (nsrc is None and vrows) or (nsrc is not None and len(nsrc) != len(vrows)):
                    fail(f"{w}: {len(vrows)} greenness rows against {0 if nsrc is None else len(nsrc)}")
                elif nsrc is not None:
                    r0 = nsrc.to_dict("records")[0]; row = vrows[0]
                    compare(f"{w}.weather[vhp]", {k: v for k, v in row.items() if k not in ("metrics", "t_coverage", "p_coverage", "ndvi_coverage")}, r0, ["product", "issue", "data_end", "harvest_year", "frac_elapsed", "elapsed_days"], d_u)
                    compare(f"{w}.weather[vhp].ndvi_mean", row["metrics"]["ndvi_mean"], {f: r0[f"ndvi_mean_{f}"] for f in WA_FIELDS}, WA_FIELDS, 4); n["weather"] += 1
                if (wsrc is None and wrows) or (wsrc is not None and len(wsrc) != len(wrows)):
                    fail(f"{w}: {len(wrows)} weather rows against {0 if wsrc is None else len(wsrc)}")
                elif wsrc is not None:
                    by_prod = {r["product"]: r for r in wsrc.to_dict("records")}
                    for row in wrows:
                        src = by_prod[row["product"]]
                        compare(f"{w}.weather[{row['product']}]", {k: v for k, v in row.items() if k != "metrics"}, src, WA_HEAD, d_u)
                        for m in METRICS:
                            src_m = {f: src[f"{m}_{f}"] for f in WA_FIELDS}
                            if m in row["metrics"]:
                                compare(f"{w}.weather[{row['product']}].{m}", row["metrics"][m], src_m, WA_FIELDS, d_u)
                            elif any(expect(v, None) is not None for v in src_m.values()):
                                fail(f"{w}.weather[{row['product']}]: metric {m} omitted although the results carry it")
                        n["weather"] += 1
                # the seasonal history: the database's complete seasons detrended, at the records precision
                hsrc = hist_by.get(sid); hsite = rec.get("weather_history") or []
                if (hsrc is None and hsite) or (hsrc is not None and len(hsrc) != len(hsite)):
                    fail(f"{w}: {len(hsite)} history rows against {0 if hsrc is None else len(hsrc)}")
                elif hsrc is not None:
                    for (y, ta_, pa_, na_, pv), row in zip(hsrc, hsite):
                        if row[0] != int(y) or not same(row[1], None if pd.isna(ta_) else ta_, d_o) or not same(row[2], None if pd.isna(pa_) else pa_, d_o) \
                                or not same(row[3], None if pd.isna(na_) else na_, 4) or (row[4] != (None if pd.isna(pv) else int(pv))):
                            fail(f"{w}.weather_history[{int(y)}]: {row} against {[int(y), ta_, pa_, na_, pv]}"); break
                    checked += 5 * len(hsite); n_hist += len(hsite)
                # the season expectations: the leaf slope times the mean central path over the series' window months
                wx = rec.get("weather_expected") or {}
                env = rl_env.get(sid); pred = ps_by.get(sid); cal = cs_by.get(sid)
                exp_src = {}
                if env is not None and pred is not None and cal is not None:
                    hy = int(pred.harvest_year.max()); crow = cal[cal.harvest_year.eq(hy)]
                    if len(crow) and isinstance(crow.iloc[0].plant_date, str) and isinstance(crow.iloc[0].harvest_date, str):
                        months = [path_med.get(k) for k in window_months(crow.iloc[0].plant_date, crow.iloc[0].harvest_date)]
                        if months and all(x is not None for x in months):
                            exc = float(np.mean([v for v, _ in months])); obs_m = [v for v, o in months if o == 1]; ext = float(np.mean(obs_m)) if obs_m else None
                            for r in env[env["index"].eq("rel")].itertuples(index=False):
                                if r.note == "no_own_slope" or pd.isna(r.slope_eb):
                                    continue
                                exp_src[r.variable] = [hy, exc, r.slope_eb * exc, len(months), ext, None if ext is None else r.slope_eb * ext, len(obs_m)]
                if set(wx) != set(exp_src):
                    fail(f"{w}: weather_expected variables {sorted(wx)} against {sorted(exp_src)}")
                else:
                    for v, row in wx.items():
                        e = exp_src[v]
                        if row[0] != e[0] or row[3] != e[3] or row[6] != e[6] or any(not same(row[i], e[i], d_o) for i in (1, 2, 4, 5)):
                            fail(f"{w}.weather_expected[{v}]: {row} against {e}"); break
                        checked += 7; n_exp += 1
                # the rest of the record shard
                t = ts_by.get(sid)
                if (t is None) != (rec["trend"] is None):
                    fail(f"{w}: trend row presence")
                elif t is not None:
                    compare(f"{w}.trend", rec["trend"], t, TS_COLS, d_o); n["trends"] += 1
                o = obs_by.get(sid); fit = ta_by.get(sid)
                if not public:
                    if rec["obs"] is not None or rec["trend_anomaly"] is not None or rec["qc"] is not None:
                        fail(f"{w}: restricted series carries observation, anomaly or QC rows")
                    n["restricted"] += 1; n["observations_withheld"] += 0 if o is None else len(o)
                else:
                    site = np.array(rec["obs"], dtype=float).reshape(-1, 2)
                    if o is None:
                        if len(site):
                            fail(f"{w}: observations without database rows")
                    else:
                        checked += 2 * len(o)
                        expected = np.array([round(float(v), d_o) if d_o is not None else float(v) for v in o[:, 1]])
                        if len(site) != len(o) or not np.array_equal(site[:, 0], o[:, 0]) or not np.array_equal(site[:, 1], expected):
                            fail(f"{w}: observations differ from the database")
                        n["observations"] += len(o)
                    site_fit = np.array(rec["trend_anomaly"], dtype=float).reshape(-1, 4)
                    if fit is None:
                        if len(site_fit):
                            fail(f"{w}: fitted values without trend_anomaly rows")
                    else:
                        expected = np.array([[round(float(v), d_o) if d_o is not None else float(v) for v in row] for row in fit])
                        checked += 4 * len(fit)
                        if len(site_fit) != len(fit) or not np.array_equal(site_fit[:, 0], fit[:, 0]) or not np.array_equal(site_fit[:, 1:], expected[:, 1:]):
                            fail(f"{w}: trend_anomaly rows differ from the results")
                        n["trend_rows"] += len(fit)
                    q = qc_by.get(sid, [])
                    checked += 4 * len(q)
                    site_q = [[None if v is None else v for v in row] for row in rec["qc"]]
                    exp_q = [[expect(r["year_label"], None), r["check_name"], r["severity"], r["note"]] for r in q]
                    if site_q != exp_q:
                        fail(f"{w}: QC flags differ from the database")
                    n["qc"] += len(q)
                ex = enso_by.get(sid); site_e = rec["enso"]
                if ex is None:
                    if site_e:
                        fail(f"{w}: exposures without enso_windows rows")
                else:
                    checked += 3 * len(ex)
                    exp_e = [[int(y), expect(a_, d_e), expect(b, d_e)] for y, a_, b in ex]
                    if site_e != exp_e:
                        fail(f"{w}: ENSO exposures differ from the database")
                    n["enso"] += len(ex)
                src = rl_env.get(sid)
                if src is None:
                    if rec["responses"]:
                        fail(f"{w}: weather-variable responses without response_leaf rows")
                else:
                    compare_responses(f"{w}.record.responses", rec["responses"], src, d_rr)
    missing = set(rl_ly) - seen_series, set(ps_by) - seen_series, set(cs_by) - seen_series, set(wt_by) - seen_series
    if any(missing):
        fail(f"series absent from the site: {[len(m) for m in missing]} of response_leaf, prediction_series, calendar_status, weights")
    if n["responses"] != len(rl) or n["predictions"] != len(ps) or n["calendar"] != len(cs) or n["weights"] != len(wt) or (wa is not None and n["weather"] != (len(wa) + (0 if na is None else len(na)))):
        fail(f"units and records carry {n['responses']} response, {n['predictions']} prediction, {n['calendar']} calendar, {n['weights']} weight and {n['weather']} weather rows "
             f"against {len(rl)}, {len(ps)}, {len(cs)}, {len(wt)} and {0 if wa is None else (len(wa) + (0 if na is None else len(na)))} in results")
    if n["trends"] != len(ts):
        fail(f"records carry {n['trends']} trend rows against {len(ts)}")
    n_obs_public = int(obs.series_id.map(lambda s: expected_perm[s][1]).sum()); n_ta_public = int(ta.series_id.map(lambda s: expected_perm[s][1]).sum())
    if n["observations"] != n_obs_public or n["trend_rows"] != n_ta_public or n["enso"] != len(enso):
        fail(f"records carry {n['observations']} observations, {n['trend_rows']} anomaly rows and {n['enso']} exposures against {n_obs_public}, {n_ta_public} and {len(enso)} publishable in the sources")
    # ---- the publication rule, proved on the files: no restricted yield anywhere under site/data/<R> ---------------------
    # A restricted series is identified by its (harvest year, yield) pairs that no other series of the database, public or
    # restricted, shares: ratios of small integers (17/13, 10/7) recur across series, and a public national series can
    # carry the same numbers as a restricted panel of the same country (Cyprus, Kuwait), so neither is evidence of a
    # leak. A file leaks a series when it holds at least three of its identifying pairs and at least half of them.
    restricted = {sid for sid, (pid, public) in expected_perm.items() if not public}
    seen_pairs = defaultdict(set)
    for sid, y, v in obs[["series_id", "harvest_year", "yield_t_ha"]].itertuples(index=False):
        seen_pairs[(int(y), round(float(v), 4))].add(int(sid))
    forbidden = {pair: next(iter(sids)) for pair, sids in seen_pairs.items() if len(sids) == 1 and next(iter(sids)) in restricted}
    # ---- world_units.json: the medium outlook of every local unit of the largest panel per country and family ----------------
    wu = _loads_record((base / "world_units.json").read_text())
    best = {}
    for row in world["panels"]:
        r = dict(zip(world["columns"]["panels"], row))
        if r["crop_family"] and ((r["crop_family"], r["iso3"]) not in best or (r["baseline_production_mt"] or 0) > best[(r["crop_family"], r["iso3"])][1]):
            best[(r["crop_family"], r["iso3"])] = (r["key"], r["baseline_production_mt"] or 0)
    med = ps[ps.method.eq("index_outlook") & ps.scenario.eq("medium")].merge(series[["series_id", "unit_key", "crop_family"]], on="series_id")
    med["key"] = key_of(med)
    expected_wu = {f: {} for f in cat["families"]}
    for r in med.itertuples(index=False):
        bp = best.get((r.crop_family, r.iso3))
        if bp is None or bp[0] != r.key or r.unit_key == r.iso3:
            continue
        expected_wu[r.crop_family][r.unit_key] = [r.pct, r.lo, r.hi, int(r.harvest_year), str(int(r.series_id))]
    n_wu = 0
    for fam in cat["families"]:
        site_f, src_f = wu["units"].get(fam, {}), expected_wu[fam]
        if set(site_f) != set(src_f):
            fail(f"world_units.json/{fam}: {len(site_f)} units against {len(src_f)}"); continue
        for ukey, row in site_f.items():
            e = src_f[ukey]
            if row[3] != e[3] or row[4] != e[4] or any(not same(row[i], e[i], P.get('world_units.json',3)) for i in range(3)):
                fail(f"world_units.json/{fam}/{ukey}: {row} against {e}"); break
            checked += 5; n_wu += 1
    # ---- anomalies/<family>.json (18 October 2026): every value against trend_anomaly and enso_windows -----------------------
    n_an = {}
    if manifest.get("anomalies") or (base / "anomalies").is_dir():
        best_keys = {k: v[0] for k, v in best.items()}
        source = manifest.get("anomalies", {}).get("index", {}).get("source") or "monthly_indices.csv"
        n_an = check_anomalies(base, cat["families"], series.assign(display_points=~series.series_id.isin(restricted)), ta, enso, best_keys, ATLAS / source)
    n_unique = defaultdict(int)
    for sid in forbidden.values():
        n_unique[sid] += 1
    n_files = n_pairs = 0; leaks = []
    for p in sorted(base.rglob("*.json")):
        n_files += 1
        # Distinct pairs per withheld series (10 October 2026): one value repeated across a unit's crops or between obs and
        # trend_anomaly (Burundi reports one yield for several crops in a year, which met a Mexican municipality's 2005
        # value at four decimals) is a coincidence; a leak restates several of a series' pairs.
        hits = defaultdict(set)
        for y, v in PAIR_RE.findall(p.read_text()):
            n_pairs += 1
            pair = (int(y), round(float(v), 4)); sid = forbidden.get(pair)
            if sid is not None:
                hits[sid].add(pair)
        for sid, pairs in hits.items():
            k = len(pairs)
            if k >= 3 and k >= 0.5 * n_unique[sid]:
                leaks.append((str(p.relative_to(base)), sid, k, n_unique[sid]))
    if leaks:
        fail(f"restricted yields found in the site files: {leaks[:5]}")
    if problems:
        raise SystemExit("FAIL numerics:\n" + "\n".join(problems))
    print(f"PASS numerics {release} (contract {CONTRACT_V2}): {checked:,} values compared; {n_wp} world panels, {len(world['world'])} world rows, {len(world['index_path'])} index months, "
          f"{n_cw} national calendar rows, {n_sk} skill rows, {n_pp} panel predictions, {n_agc} country and {n_agr} region aggregates, {n_wap} season-weather and {n_pwp} weather-prediction rows, "
          f"{n['responses']} responses ({n['responses_withheld']} withheld, no own slope), {n['predictions']} series predictions, {n['calendar']} calendar rows, {n['weights']} weights, "
          f"{n['weather']} weather rows, {n_hist} history rows, {n_exp} season expectations, {n_wu} world unit values, {n['trends']} trends, {n['observations']:,} observations with {n['trend_rows']:,} anomaly rows and {n['qc']} QC flags for the public series, "
          f"{n['enso']:,} exposures; {n_an.get('series', 0)} anomaly-layer series with {n_an.get('values', 0):,} values, {n_an.get('exposures', 0):,} exposures, {n_an.get('national', 0)} national series and {n_an.get('units', 0)} drawn units; "
          f"{n['restricted']} restricted series with {n['observations_withheld']:,} observations withheld, and a pass over {n_files} files "
          f"({n_pairs:,} year-value pairs) found none of their {len(forbidden):,} identifying yields ({sum(1 for v in n_unique.values() if v >= 3):,} series with three or more)")


def check_anomalies(base: Path, families, series: pd.DataFrame, ta: pd.DataFrame, enso: pd.DataFrame, best: dict, monthly_path: Path | None) -> dict:
    """anomalies/<family>.json against trend_anomaly (anomaly and yield at the stated decimals), enso_windows (the exposure,
    n34rel_season), the national series rule (the national unit's series of the world panel, first tier then the longest,
    else the family's), the unit rule (19 October 2026: every unit below the national level with a public series of the
    family, by its series of the panel's crop and season, else of the family with the panel's crop first, then tier, then
    length), counts_world as the drawn series with a value, and the December-February index against the monthly table. `series` carries
    series_id, unit_key, iso3, crop_code, season, crop_family, tier, n_obs, display_points; `best` maps (family, iso3) to
    the panel key; `enso` carries series_id, harvest_year, n34rel_season."""
    global checked
    idx = _loads_record((base / "anomalies" / "index.json").read_text())
    d = idx["decimals"]; year_first = idx["year_first"]
    s = series.copy(); s["series_id"] = s.series_id.astype("int64")
    s = s[s.display_points.astype(bool) & s.crop_family.isin(list(families))]
    fam_of = s.set_index("series_id").crop_family.to_dict()
    t = ta[ta.series_id.isin(fam_of) & (ta.harvest_year >= year_first) & ta.anomaly_pct.notna() & ta.yield_t_ha.notna()]
    s = s[s.series_id.isin(set(t.series_id))]          # the national and unit rules choose among the series the files carry
    ex = {(int(a), int(b)): c for a, b, c in enso[["series_id", "harvest_year", "n34rel_season"]].itertuples(index=False)}
    nat = s[s.unit_key.eq(s.iso3)].sort_values(["tier", "n_obs"], ascending=[True, False])
    by, by_fam = {}, {}
    for r in nat.itertuples(index=False):
        by.setdefault((r.iso3, r.crop_code, r.season), r); by_fam.setdefault((r.iso3, r.crop_family), []).append(r)
    loc = s[s.unit_key.ne(s.iso3)].sort_values(["tier", "n_obs"], ascending=[True, False])
    by_unit = {}
    for r in loc.itertuples(index=False):
        by_unit.setdefault((r.unit_key, r.crop_family), []).append(r)
    n = dict(series=0, values=0, national=0, exposures=0, units=0)
    for fam in families:
        f = _loads_record((base / "anomalies" / f"{fam}.json").read_text())
        tf = t[t.series_id.map(fam_of).eq(fam)]
        expected = {int(k): g for k, g in tf.groupby("series_id")}
        if set(f["series"]) != {str(k) for k in expected}:
            fail(f"anomalies/{fam}.json: {len(f['series'])} series against {len(expected)} in trend_anomaly"); continue
        for sid, entry in f["series"].items():
            g = expected[int(sid)]; first = entry[0]
            rows = {int(y): (a, v) for y, a, v in g[["harvest_year", "anomaly_pct", "yield_t_ha"]].itertuples(index=False)}
            if first != min(rows) or first + len(entry[1]) - 1 != max(rows):
                fail(f"anomalies/{fam}.json/{sid}: years {first}..{first + len(entry[1]) - 1} against {min(rows)}..{max(rows)}"); break
            bad = False
            for i, (a, v, e) in enumerate(zip(entry[1], entry[2], entry[3])):
                y = first + i; src = rows.get(y)
                if src is None:
                    if a is not None or v is not None:
                        fail(f"anomalies/{fam}.json/{sid}/{y}: value without a trend_anomaly row"); bad = True; break
                    continue
                checked += 3; n["values"] += 1
                if not same(a, src[0], d["anomaly_pct"]) or not same(v, src[1], d["yield_t_ha"]) or not same(e, ex.get((int(sid), y)), d["exposure"]):
                    fail(f"anomalies/{fam}.json/{sid}/{y}: site {a} {v} {e} against {src[0]} {src[1]} {ex.get((int(sid), y))}"); bad = True; break
                if e is not None:
                    n["exposures"] += 1
            if bad:
                break
        n["series"] += len(f["series"])
        want = {}
        for (fm, iso), key in best.items():
            if fm != fam:
                continue
            parts = key.split("|"); r = by.get((iso, parts[1], parts[2]))
            if r is None:
                cands = sorted(by_fam.get((iso, fam), []), key=lambda x: (x.crop_code != parts[1], x.tier, -x.n_obs)); r = cands[0] if cands else None
            if r is not None:
                want[iso] = [str(int(r.series_id)), r.crop_code, r.season]
        if f["national"] != want:
            diff = [k for k in set(want) | set(f["national"]) if want.get(k) != f["national"].get(k)]
            fail(f"anomalies/{fam}.json: national series differ for {sorted(diff)[:6]}")
        checked += len(want); n["national"] += len(want)
        want_u = {}
        for (ukey, fm), cands in by_unit.items():
            if fm != fam:
                continue
            key = best.get((fam, cands[0].iso3)); crop, season = key.split("|")[1:3] if key else (None, None)
            exact = [x for x in cands if x.crop_code == crop and x.season == season]
            r = exact[0] if exact else sorted(cands, key=lambda x: (x.crop_code != crop, x.tier, -x.n_obs))[0]
            want_u[ukey] = [str(int(r.series_id)), r.crop_code, r.season]
        if f["units"] != want_u:
            diff = [k for k in set(want_u) | set(f["units"]) if want_u.get(k) != f["units"].get(k)]
            fail(f"anomalies/{fam}.json: unit series differ for {sorted(diff)[:6]} ({len(f['units'])} against {len(want_u)})")
        checked += len(want_u); n["units"] += len(want_u)
        cw_want = {}
        for sid in {v[0] for v in want_u.values()} | {v[0] for v in want.values()}:
            for y in expected[int(sid)].harvest_year:
                cw_want[int(y)] = cw_want.get(int(y), 0) + 1
        if {int(k): v for k, v in f["counts_world"].items()} != cw_want:
            fail(f"anomalies/{fam}.json: counts_world differ from the drawn series with a value")
        checked += len(cw_want)
    if monthly_path and Path(monthly_path).exists():
        m = pd.read_csv(monthly_path); m["date"] = pd.to_datetime(m["date"]); col = idx["index"]["column"]
        by_month = {(dt.year, dt.month): v for dt, v in zip(m["date"], m[col])}
        for y, v in idx["djf_relative_n34"].items():
            y = int(y); vals = [by_month.get((y - 1, 12)), by_month.get((y, 1)), by_month.get((y, 2))]
            want_v = None if any(x is None or (isinstance(x, float) and math.isnan(x)) for x in vals) else round(float(np.mean(vals)), d["djf"])
            checked += 1
            if not same(v, want_v, d["djf"]):
                fail(f"anomalies/index.json: djf_relative_n34[{y}] = {v} against {want_v}"); break
    else:
        fail(f"anomalies/index.json: monthly table {monthly_path} not found")
    return n


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--release", help="one release; every release of releases.json when absent")
    a = ap.parse_args()
    releases = _loads_record((SITE / "releases.json").read_text())
    targets = [a.release] if a.release else [r["release"] for r in releases["releases"]]
    global checked
    for release in targets:
        checked = 0; problems.clear()
        contract = _loads_record((SITE / release / "manifest.json").read_text()).get("contract")
        (check_v2 if contract == CONTRACT_V2 else check_legacy)(release)


if __name__ == "__main__":
    main()
