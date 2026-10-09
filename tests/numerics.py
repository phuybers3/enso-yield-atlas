"""Check every value in site/data/<R> against its row in 4_ag/results/<R> (or the release database) at the stated precision.

    python tests/numerics.py [--release R]

The manifest's `precision.decimals` names, per file family, the decimals the exporter kept (null: the results float
unrounded). A site value passes when it equals round(source, decimals), or the source itself where no rounding was
stated, with null for a missing source value. Strings and integers must be identical. Every results row of the site's
scope (the staple crop families) must appear in the site data, so the counts are compared as well.
"""
from __future__ import annotations

import argparse
import json
import math
import sqlite3
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ATLAS = Path(__file__).resolve().parents[1]
ENSO = ATLAS.parents[1]
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


def main() -> None:
    global checked
    ap = argparse.ArgumentParser()
    ap.add_argument("--release")
    a = ap.parse_args()
    releases = json.loads((SITE / "releases.json").read_text())
    release = a.release or releases["default"]
    base = SITE / release
    results = ENSO / "4_ag/results" / release
    manifest = json.loads((base / "manifest.json").read_text())
    rman = json.loads((results / "manifest.json").read_text())
    P = manifest["precision"]["decimals"]
    assert manifest["results"]["manifest_sha256"] == __import__("hashlib").sha256((results / "manifest.json").read_bytes()).hexdigest(), "results manifest changed since the export"
    R = lambda n: pd.read_parquet(results / f"{n}.parquet")
    cat = json.loads((base / "catalog.json").read_text())
    staples = set(cat["crops"])
    key_of = lambda d: [f"{i}|{c}|{s}" for i, c, s in zip(d.iso3, d.crop_code, d.season)]
    # ---- panels.json against prediction_panel, prediction_weather_panel, response_country ---------------------------
    pp = R("prediction_panel"); pp["key"] = key_of(pp)
    pwp = R("prediction_weather_panel"); pwp["key"] = key_of(pwp)
    rc = R("response_country"); rc = rc[rc.crop_code.isin(staples)].copy(); rc["key"] = key_of(rc)
    pp_rows = index_rows(pp, ["key", "method", "scenario"]); pwp_rows = index_rows(pwp, ["key"])
    rc_rows = index_rows(rc, ["key", "index", "window"])
    panels = json.loads((base / "panels.json").read_text())
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
    world = json.loads((base / "world.json").read_text()); d = P["world.json"]
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
    skill = json.loads((base / "skill.json").read_text()); n_sk = 0
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
        cf = json.loads((base / "countries" / f"{iso}.json").read_text())
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
    staple_ids = set(int(s["id"]) for iso in cat["countries"] for u in json.loads((base / "units" / f"{iso}.json").read_text())["units"].values() for s in u["series"])
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
        uf = json.loads((base / "units" / f"{iso}.json").read_text())
        rf = json.loads((base / "records" / f"{iso}.json").read_text())
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


if __name__ == "__main__":
    main()
