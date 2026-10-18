"""Check every file of site/data/<R> against the atlas contract (analysis/contracts/SCHEMA.md, atlas layer).

    python tests/schema.py [--release R]        # every release of releases.json when none is named

A release's manifest names its contract: none for the 8 October 2026 shape (panels.json, response_unit,
records/<ISO>.json; `check_legacy`), "2026-10-09" for the hierarchical candidate (`check_v2`: world.json with one
compact row per panel, calendar_world.json, countries/<ISO>.json with the aggregate rows, units/<ISO>.json with
response_leaf, calendar status and weights, records/<ISO>/<unit>.json shards under the publication rule, skill.json
at country level). Values are finite numbers, strings, booleans or null; keys are iso3|crop_code|season; methods,
scenarios, statuses and confidence classes come from the analysis layer's vocabularies. The v2 check also asserts
that no pooling center stands as a unit or state response.
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
import sys
from pathlib import Path

ATLAS = Path(__file__).resolve().parents[1]
SITE = ATLAS / "site" / "data"
ENSO = next((p for p in ATLAS.parents if (p / "project.toml").is_file()), ATLAS.parent)
METHODS = {"trend", "index_perfect", "index_todate", "index_outlook", "weather_todate", "combined"}
SCENARIOS = {"low", "medium", "high", "observed"}
STATUS = {"not planted", "in the ground", "complete"}
WINDOWS = {"season", "fill", "preseason", "djf_prior"}
INDICES = {"rel", "std"}
LEVELS = {"unit", "region", "country"}
KEY_RE = re.compile(r"^[A-Z]{3}\|[a-z_]+\|[^|]+$")
RC_COLS = ["index", "window", "beta", "se", "pct_per_degC", "lo", "hi", "p", "q", "n_units", "n_years", "year_first", "year_last", "production_t", "method_version"]
RR_COLS = ["region_key", "region_name", "crop_code", "season", "index", "beta", "se", "pct_per_degC", "lo", "hi", "p", "q", "pct_shrunk", "lo_shrunk", "hi_shrunk", "tau", "n_units", "n_years", "production_t"]
PP_COLS = ["method", "scenario", "harvest_year", "issue", "lead", "pct", "lo", "hi", "se", "production_mt", "n_series", "local_share", "usable_share", "status"]
PW_COLS = ["crop_family", "issue", "method", "scenario", "dprod_mt", "pct", "lo", "hi", "production_mt", "coverage_share"]
SK_COLS = ["method", "lead", "n_years", "rmse", "mae", "skill_vs_trend", "corr", "coverage_80", "note"]
SP_COLS = ["issue", "scenario", "index", "year", "month", "value", "observed"]
WAP_HEAD = ["issue", "harvest_year", "data_end", "frac_elapsed", "n_series", "n_years", "production_t", "coverage_share", "idx_todate", "metrics_with_signal", "metrics_concordant", "verdict"]
WAP_FIELDS = ["value", "anom", "product", "expected", "percentile", "z", "slope_per_degC", "slope_p", "resid_sd", "hist_sd", "signal", "beyond_range"]
WA_HEAD = ["product", "issue", "data_end", "harvest_year", "frac_elapsed", "elapsed_days", "t_coverage", "p_coverage", "ndvi_coverage"]   # ndvi_coverage added 14 October 2026
WH_COLS = ["harvest_year", "tavg_anom", "precip_anom", "ndvi_anom", "ndvi_provisional"]   # greenness added 14 October 2026
WX_COLS = ["harvest_year", "exposure_central", "expected_central", "n_months", "exposure_todate", "expected_todate", "n_observed"]
WA_FIELDS = ["value", "reference", "anom", "z", "pct_rank", "n_years"]
TS_COLS = ["year_first", "year_last", "n_years", "trend_pct_per_year", "intercept"]
VERDICTS = {"as expected", "mixed", "against expectation", "no expected signal"}
RU_COLS = ["index", "n_years", "pct_raw", "lo_raw", "hi_raw", "p_raw", "pct_best", "lo_best", "hi_best", "p_best", "shrink_weight", "response_level"]
PS_COLS = ["method", "scenario", "harvest_year", "issue", "lead", "pct", "lo", "hi", "se", "frac_elapsed", "usable", "skill_vs_trend", "production_t", "beyond_fit"]
WIN_COLS = ["harvest_year", "start_date", "end_date", "source", "cycle"]
problems: list[str] = []


def fail(msg: str) -> None:
    problems.append(msg)
    if len(problems) > 40:
        raise SystemExit("FAIL schema: too many problems; first:\n" + "\n".join(problems[:40]))


def strict_constant(name):
    raise ValueError(f"non-finite constant {name} in JSON")


def read(path: Path):
    return _loads_record(path.read_text(), parse_constant=strict_constant)


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def check_row(where: str, row, cols, numeric=(), ints=(), texts=(), bools=(), allow_none=True):
    """A row is a dict with exactly cols, or a list in column order."""
    if isinstance(row, list):
        if len(row) != len(cols):
            fail(f"{where}: row has {len(row)} values for {len(cols)} columns"); return
        row = dict(zip(cols, row))
    elif set(row) != set(cols):
        fail(f"{where}: columns {sorted(set(row) ^ set(cols))} differ from the contract"); return
    for c in cols:
        v = row[c]
        if v is None and allow_none:
            continue
        if c in ints:
            if not (isinstance(v, int) and not isinstance(v, bool)):
                fail(f"{where}: {c} = {v!r} is not an integer")
        elif c in bools:
            if not isinstance(v, bool):
                fail(f"{where}: {c} = {v!r} is not a boolean")
        elif c in texts:
            if not isinstance(v, str):
                fail(f"{where}: {c} = {v!r} is not text")
        elif c in numeric or True:
            if not is_num(v):
                fail(f"{where}: {c} = {v!r} is not a finite number")
    return row


def check_legacy(release: str, releases: dict) -> None:
    """The contract of 8 October 2026 (panels.json, response_unit, records/<ISO>.json), kept for the releases exported under it."""
    for r in releases["releases"]:
        for k in ("release", "built_utc", "issue", "data_end", "index_last_month", "label"):
            assert k in r, f"releases.json entry lacks {k}"
    base = SITE / release
    # ---- manifest: every file hashed, every hash right, nothing unlisted ------------------------------------------
    manifest = read(base / "manifest.json")
    assert manifest["release"] == release
    listed = set(manifest["files"])
    on_disk = {str(p.relative_to(base)) for p in base.rglob("*.json") if p.name != "manifest.json"}
    if listed != on_disk:
        fail(f"manifest lists {sorted(listed - on_disk)[:5]} missing on disk and omits {sorted(on_disk - listed)[:5]}")
    for name, meta in manifest["files"].items():
        p = base / name
        if p.exists():
            if sha(p) != meta["sha256"] or p.stat().st_size != meta["bytes"]:
                fail(f"{name}: hash or size differs from the manifest")
    for k in ("exporter", "results", "database", "precision", "counts", "geometry"):
        assert k in manifest, f"manifest lacks {k}"
    precision = manifest["precision"]["decimals"]
    assert set(precision) >= {"panels.json", "world.json", "countries", "skill.json", "units", "records"}
    # ---- catalog -----------------------------------------------------------------------------------------------------
    cat = read(base / "catalog.json")
    for k in ("release", "built_utc", "results", "scope", "families", "crops", "methods", "scenarios", "status", "countries", "weather_metrics", "views", "precision"):
        assert k in cat, f"catalog lacks {k}"
    assert cat["release"] == release
    families = set(cat["families"])
    for code, c in cat["crops"].items():
        if c["family"] not in families:
            fail(f"catalog crop {code} has family {c['family']} outside the families list")
    for iso, c in cat["countries"].items():
        if not re.fullmatch(r"[A-Z]{3}", iso):
            fail(f"catalog country key {iso!r}")
        for k in ("name", "n_units", "n_series", "crops", "panels", "geometry"):
            if k not in c:
                fail(f"catalog {iso} lacks {k}")
        for code in c["crops"]:
            if code not in cat["crops"]:
                fail(f"catalog {iso} names crop {code} not in crops")
        for key in c["panels"]:
            if not key.startswith(iso + "|") or not KEY_RE.match(key):
                fail(f"catalog {iso} panel key {key}")
    metrics = cat["weather_metrics"]
    assert len(metrics) == 14 and {"precip", "tmax_mean"} <= set(metrics)
    # ---- world ---------------------------------------------------------------------------------------------------------
    world = read(base / "world.json")
    for k in ("release", "headline", "index", "issue", "data_end", "index_last_month", "world", "responses", "index_path"):
        assert k in world, f"world lacks {k}"
    for k in ("panels", "production_mt", "weather_implied_pct", "index_implied_pct"):
        assert is_num(world["headline"][k]), f"headline {k}"
    for i, row in enumerate(world["world"]):
        r = check_row(f"world.world[{i}]", row, PW_COLS, texts=("crop_family", "issue", "method", "scenario"))
        if r and (r["method"] not in METHODS or r["scenario"] not in SCENARIOS or r["crop_family"] not in families):
            fail(f"world.world[{i}]: vocabulary {r['method']} {r['scenario']} {r['crop_family']}")
    seen = set()
    for i, row in enumerate(world["index_path"]):
        r = check_row(f"world.index_path[{i}]", row, SP_COLS, texts=("issue", "scenario", "index"), ints=("year", "month", "observed"))
        if r:
            if r["scenario"] not in SCENARIOS or r["index"] not in INDICES or r["observed"] not in (0, 1) or not 1 <= r["month"] <= 12:
                fail(f"world.index_path[{i}]: vocabulary")
            if (r["scenario"], r["index"], r["year"], r["month"]) in seen:
                fail(f"world.index_path[{i}]: duplicate month")
            seen.add((r["scenario"], r["index"], r["year"], r["month"]))
    for i, row in enumerate(world["responses"]):
        r = check_row(f"world.responses[{i}]", row, ["key", "iso3", "country", "crop_code", "crop_family", "season"] + RC_COLS,
                      texts=("key", "iso3", "country", "crop_code", "crop_family", "season", "index", "window", "method_version"), ints=("n_units", "n_years", "year_first", "year_last"))
        if r and (r["key"] != f"{r['iso3']}|{r['crop_code']}|{r['season']}" or r["index"] != "rel" or r["window"] != "season"):
            fail(f"world.responses[{i}]: key or index/window")
    # ---- panels ----------------------------------------------------------------------------------------------------------
    panels = read(base / "panels.json")
    keys = set()
    for p in panels:
        w = f"panels[{p.get('key')}]"
        for k in ("key", "iso3", "country", "crop_code", "crop_family", "season", "label", "headline_row", "harvest_year", "status", "production_mt", "n_series", "local_share", "predictions", "weather", "season_weather", "response"):
            if k not in p:
                fail(f"{w} lacks {k}")
        if p["key"] in keys:
            fail(f"{w}: duplicate key")
        keys.add(p["key"])
        if p["key"] != f"{p['iso3']}|{p['crop_code']}|{p['season']}" or not KEY_RE.match(p["key"]):
            fail(f"{w}: key does not match its columns")
        if p["status"] not in STATUS:
            fail(f"{w}: status {p['status']}")
        if p["iso3"] not in cat["countries"] or p["key"] not in cat["countries"][p["iso3"]]["panels"]:
            fail(f"{w}: not in the catalog")
        if p["crop_code"] not in cat["crops"] or cat["crops"][p["crop_code"]]["family"] != p["crop_family"]:
            fail(f"{w}: crop code or family")
        seen = set()
        for i, row in enumerate(p["predictions"]):
            r = check_row(f"{w}.predictions[{i}]", row, PP_COLS, texts=("method", "scenario", "issue", "status"), ints=("harvest_year", "n_series", "lead"))
            if not r:
                continue
            if r["method"] not in METHODS or r["scenario"] not in SCENARIOS or r["status"] not in STATUS:
                fail(f"{w}.predictions[{i}]: vocabulary")
            if (r["method"], r["scenario"]) in seen:
                fail(f"{w}.predictions[{i}]: duplicate method and scenario")
            seen.add((r["method"], r["scenario"]))
        if ("index_outlook", "medium") not in seen:
            fail(f"{w}: no index_outlook/medium row")
        if p["weather"] is not None:
            check_row(f"{w}.weather", {k: v for k, v in p["weather"].items() if k != "metrics"}, ["lead", "pct_panel", "se_panel", "usable_panel", "coverage_share", "frac_started", "skill_vs_trend", "n_series"],
                      ints=("lead", "n_series"), bools=("usable_panel",))
            if not isinstance(p["weather"]["metrics"], list):
                fail(f"{w}.weather.metrics")
        if p["response"] is not None:
            check_row(f"{w}.response", p["response"], RC_COLS, texts=("index", "window", "method_version"), ints=("n_units", "n_years", "year_first", "year_last"))
        if p["season_weather"] is not None:
            sw = p["season_weather"]
            r = check_row(f"{w}.season_weather", {k: v for k, v in sw.items() if k != "metrics"}, WAP_HEAD, texts=("issue", "data_end", "verdict"), ints=("harvest_year", "n_series", "n_years", "metrics_with_signal", "metrics_concordant"))
            if r and r["verdict"] not in VERDICTS:
                fail(f"{w}.season_weather: verdict {r['verdict']}")
            if set(sw.get("metrics", {})) != set(metrics):
                fail(f"{w}.season_weather: metrics {sorted(sw.get('metrics', {}))}")
            for m, fields in sw.get("metrics", {}).items():
                check_row(f"{w}.season_weather.{m}", fields, WAP_FIELDS, texts=("product",))
    # ---- skill ----------------------------------------------------------------------------------------------------------
    skill = read(base / "skill.json")
    assert skill["release"] == release
    for key, rows in skill["panels"].items():
        if not KEY_RE.match(key):
            fail(f"skill key {key}")
        seen = set()
        for i, row in enumerate(rows):
            r = check_row(f"skill[{key}][{i}]", row, SK_COLS, texts=("method", "note"), ints=("lead", "n_years"))
            if r:
                if r["method"] not in METHODS:
                    fail(f"skill[{key}][{i}]: method {r['method']}")
                if (r["method"], r["lead"]) in seen:
                    fail(f"skill[{key}][{i}]: duplicate method and lead")
                seen.add((r["method"], r["lead"]))
    # ---- countries, units, geometry -------------------------------------------------------------------------------------
    n_series = n_obs = n_features = 0
    for iso, c in cat["countries"].items():
        cf = read(base / "countries" / f"{iso}.json")
        if cf["iso3"] != iso or cf["release"] != release or sorted(cf["panels"]) != sorted(c["panels"]):
            fail(f"countries/{iso}: header")
        for i, row in enumerate(cf["responses"]):
            r = check_row(f"countries/{iso}.responses[{i}]", row, ["crop_code", "season"] + RC_COLS, texts=("crop_code", "season", "index", "window", "method_version"), ints=("n_units", "n_years", "year_first", "year_last"))
            if r and (r["index"] not in INDICES or r["window"] not in WINDOWS):
                fail(f"countries/{iso}.responses[{i}]: index or window")
        for i, row in enumerate(cf["regions"]):
            r = check_row(f"countries/{iso}.regions[{i}]", row, RR_COLS, texts=("region_key", "region_name", "crop_code", "season", "index"), ints=("n_units", "n_years"))
            if r and r["index"] not in INDICES:
                fail(f"countries/{iso}.regions[{i}]: index")
        uf = read(base / "units" / f"{iso}.json")
        if uf["iso3"] != iso or uf["release"] != release:
            fail(f"units/{iso}: header")
        if uf["columns"] != dict(responses=RU_COLS, predictions=PS_COLS, windows=WIN_COLS, weather=WA_HEAD, weather_metrics=WA_FIELDS):
            fail(f"units/{iso}: columns differ from the contract")
        rf = read(base / "records" / f"{iso}.json")
        if rf["iso3"] != iso or rf["release"] != release or rf["columns"] != dict(obs=["harvest_year", "yield_t_ha"], trend=TS_COLS, trend_anomaly=["harvest_year", "yield_t_ha", "fitted_yield", "anomaly_pct"]):
            fail(f"records/{iso}: header or columns")
        if len(uf["units"]) != c["n_units"]:
            fail(f"units/{iso}: {len(uf['units'])} units against {c['n_units']} in the catalog")
        series_ids = set()
        for ukey, u in uf["units"].items():
            for k in ("name", "level", "tier", "region_key", "region_name", "lon", "lat", "series"):
                if k not in u:
                    fail(f"units/{iso}/{ukey} lacks {k}")
            for s in u["series"]:
                w = f"units/{iso}/{ukey}/{s.get('id')}"
                n_series += 1
                for k in ("id", "crop_code", "crop_family", "season", "basis", "source", "tier", "first", "last", "n", "weather", "responses", "predictions", "windows"):
                    if k not in s:
                        fail(f"{w} lacks {k}")
                rec = rf["series"].get(s["id"])
                if rec is None or set(rec) != {"obs", "trend", "trend_anomaly"}:
                    fail(f"records/{iso}: no record for series {s['id']}"); rec = dict(obs=[], trend=None, trend_anomaly=[])
                if rec["trend"] is not None:
                    check_row(f"{w}.trend", rec["trend"], TS_COLS, ints=("year_first", "year_last", "n_years"))
                for i, row in enumerate(rec["trend_anomaly"]):
                    if not (isinstance(row, list) and len(row) == 4 and isinstance(row[0], int) and all(is_num(v) for v in row[1:])):
                        fail(f"{w}.trend_anomaly[{i}]: {row!r}"); break
                if rec["trend_anomaly"] and rec["trend"] is None:
                    fail(f"{w}: fitted values without a trend row")
                products = set()
                for i, row in enumerate(s["weather"]):
                    r = check_row(f"{w}.weather[{i}]", {k: v for k, v in row.items() if k != "metrics"}, WA_HEAD, texts=("product", "issue", "data_end"), ints=("harvest_year", "elapsed_days")) if isinstance(row, dict) and "metrics" in row else None
                    if r is None or not isinstance(row["metrics"], dict):
                        fail(f"{w}.weather[{i}]: shape"); continue
                    if r["product"] in products or r["product"] not in ("best", "chirps", "era5", "cpc", "agera5", "vhp"):
                        fail(f"{w}.weather[{i}]: product {r['product']}")
                    products.add(r["product"])
                    for m, vals in row["metrics"].items():
                        if m not in set(metrics) | set(cat.get("greenness_metrics", [])) or not (isinstance(vals, list) and len(vals) == len(WA_FIELDS) and all(v is None or is_num(v) for v in vals)):
                            fail(f"{w}.weather[{i}].{m}: {vals!r}")
                if not (isinstance(s["id"], str) and s["id"].isdigit()):
                    fail(f"{w}: id must be a decimal string (series ids exceed 2^53)")
                if s["id"] in series_ids:
                    fail(f"{w}: duplicate series id")
                series_ids.add(s["id"])
                if s["crop_code"] not in cat["crops"] or s["season"] not in c["crops"].get(s["crop_code"], []):
                    fail(f"{w}: crop or season outside the catalog")
                # The database carries a few series with two rows for one harvest year (Brazilian panel units); they are
                # copied as stored, so the test asks only that the years be in order.
                last_year = None
                for o in rec["obs"]:
                    n_obs += 1
                    if not (isinstance(o, list) and len(o) == 2 and isinstance(o[0], int) and is_num(o[1]) and o[1] >= 0):
                        fail(f"{w}: observation {o!r}"); break
                    if last_year is not None and o[0] < last_year:
                        fail(f"{w}: harvest years out of order at {o[0]}"); break
                    last_year = o[0]
                for i, row in enumerate(s["responses"]):
                    r = check_row(f"{w}.responses[{i}]", row, RU_COLS, texts=("index", "response_level"), ints=("n_years",))
                    if r and (r["index"] not in INDICES or (r["response_level"] is not None and r["response_level"] not in LEVELS)):
                        fail(f"{w}.responses[{i}]: vocabulary")
                for i, row in enumerate(s["predictions"]):
                    r = check_row(f"{w}.predictions[{i}]", row, PS_COLS, texts=("method", "scenario", "issue"), ints=("harvest_year", "lead", "beyond_fit"), bools=("usable",))
                    if r and (r["method"] not in METHODS or r["scenario"] not in SCENARIOS):
                        fail(f"{w}.predictions[{i}]: vocabulary")
                for i, row in enumerate(s["windows"]):
                    r = check_row(f"{w}.windows[{i}]", row, WIN_COLS, texts=("start_date", "end_date", "source", "cycle"), ints=("harvest_year",))
                    if r and not (r["end_date"].startswith(str(r["harvest_year"])) and r["start_date"] < r["end_date"]):
                        fail(f"{w}.windows[{i}]: window {r['start_date']}..{r['end_date']} does not end in {r['harvest_year']}")
        if len(series_ids) != c["n_series"] or set(rf["series"]) != series_ids:
            fail(f"units/{iso}: {len(series_ids)} series against {c['n_series']} in the catalog and {len(rf['series'])} records")
        gpath = base / "geometry" / f"{iso}.json"
        if c["geometry"] != gpath.exists():
            fail(f"geometry/{iso}: catalog says {c['geometry']}")
        if gpath.exists():
            g = read(gpath)
            if g.get("type") != "FeatureCollection":
                fail(f"geometry/{iso}: not a FeatureCollection")
            ids = set()
            for f in g["features"]:
                n_features += 1
                if f.get("id") not in uf["units"] or f["id"] in ids:
                    fail(f"geometry/{iso}: feature {f.get('id')} is not a unit of the country or repeats")
                ids.add(f.get("id"))
                if f["geometry"]["type"] not in ("Polygon", "MultiPolygon"):
                    fail(f"geometry/{iso}/{f['id']}: {f['geometry']['type']}")
                for k in ("id", "country", "name", "level", "tier"):
                    if k not in f["properties"]:
                        fail(f"geometry/{iso}/{f['id']}: property {k}")
    wg = read(base / "geometry" / "world.json")
    assert wg["type"] == "FeatureCollection" and all(re.fullmatch(r"[A-Z0-9-]{3}", f["id"]) for f in wg["features"])
    if problems:
        raise SystemExit("FAIL schema:\n" + "\n".join(problems))
    print(f"PASS schema {release}: {len(manifest['files'])} files hashed, {len(cat['countries'])} countries, {len(panels)} panels, {len(skill['panels'])} skill panels, "
          f"{n_series} series, {n_obs} observations, {n_features} mapped units, releases.json default {releases['default']}")




# ---- the contract of 9 October 2026 ---------------------------------------------------------------------------------
CONTRACT_V2 = "2026-10-09"
METHODS_V2 = METHODS | {"index_hier"}
CONFIDENCE = {"dated", "monthly", "approximate", "missing"}
SE_SOURCES = {"replicate_unit", "replicate_region", "classical"}
AG_COLS = ["method", "scenario", "target_year", "issue", "dprod_mt_mean", "pct_mean", "dprod_lo", "dprod_hi", "pct_lo", "pct_hi", "dprod_lo_resp", "dprod_hi_resp",
           "pct_lo_resp", "pct_hi_resp", "dprod_mt_point", "pct_point", "pct_sd", "pct_sd_resp", "dprod_mt_mean_pred", "baseline_production_mt", "covered_share",
           "n_leaves", "n_rep", "footprint_id"]
AG_TEXT = ("method", "scenario", "issue", "footprint_id"); AG_INT = ("target_year", "n_leaves", "n_rep")
WP_COLS = ["key", "iso3", "crop_code", "crop_family", "season", "harvest_year", "lead", "status", "n_series", "local_share", "baseline_production_mt",
           "pct", "lo", "hi", "se", "lo_resp", "hi_resp", "dprod_mt", "dprod_lo", "dprod_hi", "n_leaves"]
WW_COLS = ["crop_family", "issue", "method", "scenario", "target_year", "dprod_mt", "pct", "lo", "hi", "production_mt", "coverage_share", "lo_resp", "hi_resp",
           "dprod_lo", "dprod_hi", "dprod_lo_resp", "dprod_hi_resp", "dprod_mt_point", "pct_point", "covered_share", "n_leaves", "footprint_id"]
RL_COLS = ["variable", "index", "n_years", "year_first", "year_last", "slope_own", "se_own", "se_source", "slope_eb", "se_eb", "own_data_weight", "pct_eb", "lo_eb", "hi_eb", "note"]
RL_WITHHELD = ["slope_eb", "se_eb", "pct_eb", "lo_eb", "hi_eb"]
ENV_VARIABLES = {"tavg_mean", "tmax_p95_days", "precip", "wet_days", "ndvi_mean"}
CS_COLS = ["harvest_year", "cycle", "plant_date", "harvest_date", "calendar_source", "calendar_rank", "confidence", "window_source", "rule", "cycle_unresolved"]
CS_TEXT = ("cycle", "plant_date", "harvest_date", "calendar_source", "confidence", "window_source", "rule")
CW_COLS = ["harvest_year", "series_id", "unit_key", "series_crop", "series_season", "match"] + CS_COLS[1:]
W_COLS = ["target_year", "issue", "lead", "frac_elapsed", "area_ha", "area_vintage", "area_source", "trend_yield", "trend_yield_fit", "trend_source", "last_yield",
          "last_yield_year", "baseline_production_t", "status", "covered"]
W_TEXT = ("issue", "area_source", "trend_source", "status"); W_INT = ("target_year", "lead", "area_vintage", "last_yield_year")
SK_COLS_V2 = SK_COLS + ["n_series", "train_years", "info_cutoff", "method_version"]
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
POOLING_FIELDS = {"center", "se_center", "tau2"}


def is_date(v) -> bool:
    return isinstance(v, str) and DATE_RE.match(v) is not None


def check_v2(release: str, releases: dict) -> None:
    global RL_COLS, RL_WITHHELD, AG_COLS
    import pandas as pd
    base = SITE / release
    rel_entry = next(r for r in releases["releases"] if r["release"] == release)
    for k in ("release", "built_utc", "issue", "data_end", "index_last_month", "label", "contract", "candidate", "source_release"):
        assert k in rel_entry, f"releases.json entry lacks {k}"
    assert rel_entry["contract"] == CONTRACT_V2
    # ---- manifest ------------------------------------------------------------------------------------------------
    manifest = read(base / "manifest.json")
    assert manifest["release"] == release and manifest["contract"] == CONTRACT_V2
    assert manifest["candidate"] == rel_entry["candidate"]
    listed = set(manifest["files"])
    on_disk = {str(p.relative_to(base)) for p in base.rglob("*.json") if p.name != "manifest.json"}
    if listed != on_disk:
        fail(f"manifest lists {sorted(listed - on_disk)[:5]} missing on disk and omits {sorted(on_disk - listed)[:5]}")
    for name, meta in manifest["files"].items():
        p = base / name
        if p.exists() and (sha(p) != meta["sha256"] or p.stat().st_size != meta["bytes"]):
            fail(f"{name}: hash or size differs from the manifest")
    for k in ("exporter", "results", "tables", "database", "permissions", "published_range", "harvest_years", "precision", "counts", "geometry"):
        assert k in manifest, f"manifest lacks {k}"
    for t in ("response_leaf", "aggregate", "prediction_panel", "prediction_world", "prediction_series", "weights", "trend_series", "trend_anomaly", "calendar_status"):
        assert manifest["tables"].get(t, {}).get("sha256"), f"manifest.tables lacks {t}"
        assert (ENSO / manifest["tables"][t]["path"]).exists(), f"table {t}: {manifest['tables'][t]['path']} is not on disk"
    assert len(manifest["published_range"]) == 2 and all(is_date(d) for d in manifest["published_range"]) and manifest["published_range"][0] < manifest["published_range"][1]
    harvest_years = manifest["harvest_years"]
    precision = manifest["precision"]["decimals"]
    assert set(precision) >= {"world.json", "world.json.panels", "countries", "calendar_world.json", "skill.json", "units", "units.responses", "records", "records.enso", "records.responses"}
    assert precision["units.responses"] is None, "unit responses must be unrounded so the pooling-center check is exact"
    assert (ENSO / manifest["permissions"]["path"]).exists() and sha(ENSO / manifest["permissions"]["path"]) == manifest["permissions"]["sha256"], "permissions.toml changed since the export"
    # ---- catalog ---------------------------------------------------------------------------------------------------
    cat = read(base / "catalog.json")
    RL_COLS = RL_COLS[:15]
    RL_WITHHELD = RL_WITHHELD[:5]
    AG_COLS = AG_COLS[:24]
    if cat.get('model',{}).get('replicates',{}).get('method') == 'centered_year_blocks_plus_shrinkage_student_v1':
        RL_COLS += ['slope_lo','slope_hi','slope_lo80','slope_hi80','interval_method']
        RL_WITHHELD += ['slope_lo','slope_hi','slope_lo80','slope_hi80']
        AG_COLS += ['pct_lo95','pct_hi95','dprod_lo95','dprod_hi95']

    for k in ("release", "contract", "candidate", "source_release", "built_utc", "results", "model", "calendar", "scope", "families", "crops", "methods", "scenarios", "status",
              "confidence", "countries", "weather_metrics", "sources", "permissions", "views", "precision"):
        assert k in cat, f"catalog lacks {k}"
    assert cat["release"] == release and cat["contract"] == CONTRACT_V2
    assert cat["calendar"]["published_range"] == manifest["published_range"] and cat["calendar"]["harvest_years"] == harvest_years
    families = set(cat["families"])
    for code, c in cat["crops"].items():
        if c["family"] not in families:
            fail(f"catalog crop {code} has family {c['family']} outside the families list")
    for iso, c in cat["countries"].items():
        if not re.fullmatch(r"[A-Z]{3}", iso):
            fail(f"catalog country key {iso!r}")
        for k in ("name", "n_units", "n_series", "n_series_public", "crops", "panels", "geometry"):
            if k not in c:
                fail(f"catalog {iso} lacks {k}")
        for code in c["crops"]:
            if code not in cat["crops"]:
                fail(f"catalog {iso} names crop {code} not in crops")
        for key in c["panels"]:
            if not key.startswith(iso + "|") or not KEY_RE.match(key):
                fail(f"catalog {iso} panel key {key}")
    yield_sources = {k for k, v in cat["sources"].items() if v["role"] == "yield"}
    for k, v in cat["sources"].items():
        for f in ("role", "name", "citation", "license"):
            if f not in v:
                fail(f"catalog source {k} lacks {f}")
        if v["role"] == "yield":
            if "permission" not in v or not isinstance(v["permission"].get("display_points"), bool):
                fail(f"catalog source {k}: no permission entry")
            if not v["citation"]:
                fail(f"catalog source {k}: no citation to print")
    # The user's rule of 11 October 2026: every yield source shows its observations as points; the sources whose terms
    # are not recorded (HarvestStat Asia, the Hultgren panels outside the agency countries) withhold redistribution only.
    for k, v in cat["sources"].items():
        if v["role"] == "yield" and v.get("n_series") and v["permission"].get("display_points") is not True:
            fail(f"catalog: {k} must show its observations (display_points true)")
    for k in ("hvstat", "hultgren"):
        if cat["sources"].get(k, {}).get("permission", {}).get("redistribute") is not False:
            fail(f"catalog: {k} must withhold bulk redistribution until its terms are recorded")
    metrics = cat["weather_metrics"]
    assert len(metrics) == 14 and {"precip", "tmax_mean"} <= set(metrics)
    # ---- world -----------------------------------------------------------------------------------------------------
    world = read(base / "world.json")
    for k in ("release", "contract", "candidate", "source_release", "index", "issue", "data_end", "index_last_month", "columns", "panels", "world", "index_path"):
        assert k in world, f"world lacks {k}"
    assert world["columns"]["panels"] == WP_COLS, "world.columns.panels differs from the contract"
    assert isinstance(world["index"].get("outlook", {}).get("source"), str), "world.index.outlook.source"
    panel_keys = set()
    for i, row in enumerate(world["panels"]):
        r = check_row(f"world.panels[{i}]", row, WP_COLS, texts=("key", "iso3", "crop_code", "crop_family", "season", "status"), ints=("harvest_year", "lead", "n_series", "n_leaves"))
        if not r:
            continue
        if r["key"] != f"{r['iso3']}|{r['crop_code']}|{r['season']}" or not KEY_RE.match(r["key"]) or r["key"] in panel_keys:
            fail(f"world.panels[{i}]: key {r['key']}")
        panel_keys.add(r["key"])
        if r["status"] not in STATUS or r["crop_family"] not in families or cat["crops"].get(r["crop_code"], {}).get("family") != r["crop_family"]:
            fail(f"world.panels[{i}]: vocabulary")
        if r["iso3"] not in cat["countries"] or r["key"] not in cat["countries"][r["iso3"]]["panels"]:
            fail(f"world.panels[{i}]: not in the catalog")
        if r["harvest_year"] not in harvest_years:
            fail(f"world.panels[{i}]: harvest year {r['harvest_year']} outside the published calendar years")
        if r["pct"] is not None and not (r["lo"] <= r["hi"] and r["lo_resp"] <= r["hi_resp"]):
            fail(f"world.panels[{i}]: interval ends out of order")
        for c in ("pct", "lo", "hi", "lo_resp", "hi_resp"):
            if r[c] is not None and r[c] < -100:                 # exp(x) - 1 cannot fall below -100 percent
                fail(f"world.panels[{i}]: {c} = {r[c]} is below -100 percent")
    if {k for c in cat["countries"].values() for k in c["panels"]} != panel_keys:
        fail("world.panels do not match the catalog's panels")
    seen = set()
    for i, row in enumerate(world["world"]):
        r = check_row(f"world.world[{i}]", row, WW_COLS, texts=("crop_family", "issue", "method", "scenario", "footprint_id"), ints=("target_year", "n_leaves"))
        if r:
            if r["method"] not in METHODS_V2 or r["scenario"] not in SCENARIOS or r["crop_family"] not in families:
                fail(f"world.world[{i}]: vocabulary")
            if (r["crop_family"], r["method"], r["scenario"]) in seen:
                fail(f"world.world[{i}]: duplicate row")
            seen.add((r["crop_family"], r["method"], r["scenario"]))
    for fam in families:
        if (fam, "index_outlook", "medium") not in seen:
            fail(f"world.world: no medium index_outlook row for {fam}")
    seen = set()
    for i, row in enumerate(world["index_path"]):
        r = check_row(f"world.index_path[{i}]", row, SP_COLS, texts=("issue", "scenario", "index"), ints=("year", "month", "observed"))
        if r:
            if r["scenario"] not in SCENARIOS or r["index"] not in INDICES or r["observed"] not in (0, 1) or not 1 <= r["month"] <= 12:
                fail(f"world.index_path[{i}]: vocabulary")
            if (r["scenario"], r["index"], r["year"], r["month"]) in seen:
                fail(f"world.index_path[{i}]: duplicate month")
            seen.add((r["scenario"], r["index"], r["year"], r["month"]))
    # ---- calendar_world --------------------------------------------------------------------------------------------
    cw = read(base / "calendar_world.json")
    assert cw["release"] == release and cw["columns"] == CW_COLS and cw["published_range"] == manifest["published_range"] and cw["harvest_years"] == harvest_years
    n_cw = 0
    for key, rws in cw["panels"].items():
        if key not in panel_keys:
            fail(f"calendar_world[{key}]: not a panel")
        years = set()
        for i, row in enumerate(rws):
            r = check_row(f"calendar_world[{key}][{i}]", row, CW_COLS, texts=("series_id", "unit_key", "series_crop", "series_season", "match") + CS_TEXT, ints=("harvest_year",), bools=("cycle_unresolved",))
            if not r:
                continue
            n_cw += 1
            if r["unit_key"] != key.split("|")[0] or r["match"] not in ("crop+season", "crop", "family"):
                fail(f"calendar_world[{key}][{i}]: a national series of the country with a named match")
            if r["harvest_year"] in years or r["harvest_year"] not in harvest_years:
                fail(f"calendar_world[{key}][{i}]: harvest year {r['harvest_year']}")
            years.add(r["harvest_year"])
            check_calendar_row(f"calendar_world[{key}][{i}]", r, manifest["published_range"])
    # ---- skill -----------------------------------------------------------------------------------------------------
    skill = read(base / "skill.json")
    assert skill["release"] == release and skill["level"] == "country" and skill["columns"] == SK_COLS_V2
    for key, rws in skill["panels"].items():
        if not KEY_RE.match(key):
            fail(f"skill key {key}")
        seen = set()
        for i, row in enumerate(rws):
            r = check_row(f"skill[{key}][{i}]", row, SK_COLS_V2, texts=("method", "note", "train_years", "info_cutoff", "method_version"), ints=("lead", "n_years", "n_series"))
            if r:
                if r["method"] not in METHODS_V2 and not (r["method"].endswith("_blocked") and r["method"][:-8] in METHODS_V2):
                    fail(f"skill[{key}][{i}]: method {r['method']}")
                if (r["method"], r["lead"]) in seen:
                    fail(f"skill[{key}][{i}]: duplicate method and lead")
                seen.add((r["method"], r["lead"]))
    # ---- pooling centers: never a displayed response -------------------------------------------------------------
    pc = pd.read_parquet(ENSO / manifest["tables"]["pooling_center"]["path"]) if manifest["tables"].get("pooling_center", {}).get("path") else \
        pd.read_parquet(ENSO / manifest["results"]["path"] / "pooling_center.parquet")
    centers = set(float(v) for v in pc.center.dropna().tolist())
    centers_pct = {100 * math.expm1(v) for v in centers}
    assert not (POOLING_FIELDS & set(RL_COLS)) and not (POOLING_FIELDS & set(AG_COLS)) and not (POOLING_FIELDS & set(WP_COLS)), "a pooling-center field is in a response column list"
    n_center_leaf = 0
    # ---- countries -------------------------------------------------------------------------------------------------
    n_series = n_obs = n_features = n_records = n_restricted = n_state_records = 0
    n_crop_area = [0]   # units carrying a CROPGRIDS crop_area (11 October 2026)
    rf_columns = dict(obs=["harvest_year", "yield_t_ha"], trend=TS_COLS, trend_anomaly=["harvest_year", "yield_t_ha", "fitted_yield", "anomaly_pct"],
                      enso=["harvest_year", "n34_season", "n34rel_season"], qc=["year_label", "check_name", "severity", "note"], responses=RL_COLS,
                      weather=WA_HEAD, weather_metrics=WA_FIELDS, weather_history=WH_COLS, weather_expected=WX_COLS)
    if cat.get('model',{}).get('replicates',{}).get('method') == 'centered_year_blocks_plus_shrinkage_student_v1':
        rf_columns['relationship_history'] = ['variable','index','harvest_year','exposure','anomaly']
    for iso, c in cat["countries"].items():
        cf = read(base / "countries" / f"{iso}.json")
        if cf["iso3"] != iso or cf["release"] != release or cf["contract"] != CONTRACT_V2 or sorted(p["key"] for p in cf["panels"]) != sorted(c["panels"]):
            fail(f"countries/{iso}: header or panel list")
        if cf["columns"] != dict(predictions=PP_COLS, aggregate=AG_COLS, regions=["region_key", "region_name", "crop_code", "season"] + AG_COLS):
            fail(f"countries/{iso}: columns differ from the contract")
        for p in cf["panels"]:
            w = f"countries/{iso}.panels[{p.get('key')}]"
            for k in ("key", "iso3", "crop_code", "crop_family", "season", "label", "harvest_year", "status", "n_series", "baseline_production_mt", "predictions", "aggregate", "season_weather", "weather"):
                if k not in p:
                    fail(f"{w} lacks {k}")
            if p["key"] != f"{iso}|{p['crop_code']}|{p['season']}" or p["status"] not in STATUS:
                fail(f"{w}: key or status")
            seen = set()
            for i, row in enumerate(p["predictions"]):
                r = check_row(f"{w}.predictions[{i}]", row, PP_COLS, texts=("method", "scenario", "issue", "status"), ints=("harvest_year", "n_series", "lead"))
                if r:
                    if r["method"] not in METHODS_V2 or r["scenario"] not in SCENARIOS or r["status"] not in STATUS or (r["method"], r["scenario"]) in seen:
                        fail(f"{w}.predictions[{i}]: vocabulary or duplicate")
                    seen.add((r["method"], r["scenario"]))
            if ("index_outlook", "medium") not in seen:
                fail(f"{w}: no index_outlook/medium row")
            seen = set()
            for i, row in enumerate(p["aggregate"]):
                r = check_row(f"{w}.aggregate[{i}]", row, AG_COLS, texts=AG_TEXT, ints=AG_INT)
                if r:
                    if r["method"] not in METHODS_V2 or r["scenario"] not in SCENARIOS or (r["method"], r["scenario"]) in seen or not r["footprint_id"].startswith("country:"):
                        fail(f"{w}.aggregate[{i}]: vocabulary, duplicate or footprint")
                    seen.add((r["method"], r["scenario"]))
                    if r["pct_mean"] in centers or r["pct_mean"] in centers_pct or r["pct_point"] in centers or r["pct_point"] in centers_pct:
                        fail(f"{w}.aggregate[{i}]: a pooling center stands as the country response")
            if ("index_outlook", "medium") not in seen:
                fail(f"{w}: no index_outlook/medium aggregate row")
            if p["season_weather"] is not None:
                sw = p["season_weather"]
                r = check_row(f"{w}.season_weather", {k: v for k, v in sw.items() if k != "metrics"}, WAP_HEAD, texts=("issue", "data_end", "verdict"), ints=("harvest_year", "n_series", "n_years", "metrics_with_signal", "metrics_concordant"))
                if r and r["verdict"] not in VERDICTS:
                    fail(f"{w}.season_weather: verdict {r['verdict']}")
                if set(sw.get("metrics", {})) != set(metrics):
                    fail(f"{w}.season_weather: metrics")
                for m, fields in sw.get("metrics", {}).items():
                    check_row(f"{w}.season_weather.{m}", fields, WAP_FIELDS, texts=("product",))
            if p["weather"] is not None:
                check_row(f"{w}.weather", {k: v for k, v in p["weather"].items() if k != "metrics"}, ["lead", "pct_panel", "se_panel", "usable_panel", "coverage_share", "frac_started", "skill_vs_trend", "n_series"],
                          ints=("lead", "n_series"), bools=("usable_panel",))
        seen = set()
        for i, row in enumerate(cf["regions"]):
            r = check_row(f"countries/{iso}.regions[{i}]", row, ["region_key", "region_name", "crop_code", "season"] + AG_COLS, texts=("region_key", "region_name", "crop_code", "season") + AG_TEXT, ints=AG_INT)
            if r:
                k = (r["region_key"], r["crop_code"], r["season"], r["method"], r["scenario"])
                if k in seen or not r["region_key"].startswith(iso) or not r["footprint_id"].startswith("region:") or r["crop_code"] not in cat["crops"]:
                    fail(f"countries/{iso}.regions[{i}]: key, footprint or crop")
                seen.add(k)
                if r["pct_mean"] in centers or r["pct_mean"] in centers_pct or r["pct_point"] in centers or r["pct_point"] in centers_pct:
                    fail(f"countries/{iso}.regions[{i}]: a pooling center stands as the state response")
        # ---- units and records -------------------------------------------------------------------------------------
        uf = read(base / "units" / f"{iso}.json")
        if uf["iso3"] != iso or uf["release"] != release or uf["contract"] != CONTRACT_V2:
            fail(f"units/{iso}: header")
        if uf["columns"] != dict(responses=RL_COLS, predictions=PS_COLS, calendar=CS_COLS, weight=W_COLS):
            fail(f"units/{iso}: columns differ from the contract")
        if len(uf["units"]) != c["n_units"]:
            fail(f"units/{iso}: {len(uf['units'])} units against {c['n_units']} in the catalog")
        idx = read(base / "records" / iso / "index.json")
        if idx["iso3"] != iso or idx["columns"] != ["file", "n_series", "n_public", "bytes"] or set(idx["units"]) != set(uf["units"]):
            fail(f"records/{iso}/index.json: header or unit set")
        # The state records of 10 October 2026: one shard per state with two or more reporting units, listed under `states`,
        # each entry keyed crop_code|season and shaped like a unit record, with the state center as its yield response.
        region_keys = {u["region_key"] for u in uf["units"].values() if u.get("region_key")}
        if idx.get("columns_states") != ["file", "n_series", "n_units", "bytes"] or not isinstance(idx.get("states"), dict) or not set(idx["states"]) <= region_keys:
            fail(f"records/{iso}/index.json: states header or keys")
        for rk, e in idx.get("states", {}).items():
            rp = base / "records" / iso / e[0]
            if not rp.exists() or rp.stat().st_size != e[3] or not e[0].startswith("state_"):
                fail(f"records/{iso}: state entry {rk} is wrong"); continue
            sf = read(rp); n_state_records += len(sf["series"])
            if sf["unit_key"] != rk or sf.get("level") != "state" or sf["columns"] != rf_columns or len(sf["series"]) != e[1]:
                fail(f"records/{iso}/{e[0]}: header"); continue
            for sid_, rec_ in sf["series"].items():
                if sid_ != f"{rec_['crop_code']}|{rec_['season']}" or rec_["permission"] != "derived" or rec_["display_points"] is not True or not isinstance(rec_["n_units"], int) or rec_["n_units"] < 2 or len(rec_["units"]) != rec_["n_units"] or rec_["n_units"] > e[2]:
                    fail(f"records/{iso}/{e[0]}/{sid_}: state record header")
                for k in ("obs", "trend_anomaly", "enso", "weather_history", "responses", "weather"):
                    if not isinstance(rec_[k], list):
                        fail(f"records/{iso}/{e[0]}/{sid_}: {k}")
                if rec_["trend"] is not None and (len(rec_["trend_anomaly"]) != rec_["trend"]["n_years"] or rec_["trend"]["n_years"] < 10):
                    fail(f"records/{iso}/{e[0]}/{sid_}: trend against anomalies")
                for r_ in rec_["responses"]:
                    if len(r_) != len(RL_COLS) or r_[1] != "rel" or r_[0] not in ("ly", "tavg_mean", "tmax_p95_days", "precip", "wet_days", "ndvi_mean"):
                        fail(f"records/{iso}/{e[0]}/{sid_}: response row")
        series_ids = set(); n_public = 0; all_series_ids = globals().setdefault('_all_series_ids', set())
        for ukey, u in uf["units"].items():
            for k in ("name", "level", "tier", "region_key", "region_name", "lon", "lat", "series"):
                if k not in u:
                    fail(f"units/{iso}/{ukey} lacks {k}")
            ca = u.get("crop_area")   # CROPGRIDS area per family (11 October 2026): optional, [hectares, share of the land] per family
            if ca is not None and (not isinstance(ca, dict) or any(f not in families or not (isinstance(v, list) and len(v) == 2 and all(x is None or is_num(x) for x in v)) for f, v in ca.items())):
                fail(f"units/{iso}/{ukey}: crop_area")
            n_crop_area[0] += ca is not None
            entry = idx["units"].get(ukey)
            rpath = base / "records" / iso / (entry[0] if entry else "")
            if not entry or not rpath.exists() or rpath.stat().st_size != entry[3] or entry[1] != len(u["series"]):
                fail(f"records/{iso}: index entry for {ukey} is wrong"); continue
            rf = read(rpath); n_records += 1
            if rf["unit_key"] != ukey or rf["iso3"] != iso or rf["release"] != release or set(rf["series"]) != {s["id"] for s in u["series"]}:
                fail(f"records/{iso}/{entry[0]}: header or series set")
            if rf["columns"] != rf_columns:
                fail(f"records/{iso}/{entry[0]}: columns")
            # The seasonal weather history and the season expectations added on 10 October 2026: integer years with
            # numeric or null departures, and per weather variable a seven-field row.
            for sid_, rec_ in rf["series"].items():
                wh = rec_.get("weather_history")
                if not isinstance(wh, list) or any(not (isinstance(h, list) and len(h) == 5 and isinstance(h[0], int) and all(v is None or is_num(v) for v in h[1:4]) and (h[4] is None or h[4] in (0, 1))) for h in wh):
                    fail(f"records/{iso}/{entry[0]}/{sid_}: weather_history rows"); continue
                if [h[0] for h in wh] != sorted(h[0] for h in wh) or any(h[0] < 1981 or h[0] > 2025 for h in wh):
                    fail(f"records/{iso}/{entry[0]}/{sid_}: weather_history years")
                wx = rec_.get("weather_expected")
                if not isinstance(wx, dict) or any(v not in ("tavg_mean", "tmax_p95_days", "precip", "wet_days", "ndvi_mean") or not (isinstance(a, list) and len(a) == 7 and isinstance(a[0], int) and isinstance(a[3], int) and isinstance(a[6], int)
                                                           and all(x is None or is_num(x) for x in (a[1], a[2], a[4], a[5]))) for v, a in wx.items()):
                    fail(f"records/{iso}/{entry[0]}/{sid_}: weather_expected rows")
            if entry[2] != sum(1 for s in u["series"] if s["display_points"]):
                fail(f"records/{iso}: index n_public for {ukey}")
            for s in u["series"]:
                w = f"units/{iso}/{ukey}/{s.get('id')}"
                n_series += 1
                for k in ("id", "crop_code", "crop_family", "season", "basis", "source", "permission", "display_points", "tier", "first", "last", "n", "responses", "predictions", "calendar", "weight"):
                    if k not in s:
                        fail(f"{w} lacks {k}")
                if not (isinstance(s["id"], str) and s["id"].isdigit()) or s["id"] in series_ids:
                    fail(f"{w}: id must be a unique decimal string")
                series_ids.add(s["id"])
                if not isinstance(s["display_points"], bool) or s["permission"] not in yield_sources:
                    fail(f"{w}: permission {s.get('permission')!r} or display_points")
                if s["display_points"] != cat["sources"][s["permission"]]["permission"]["display_points"]:
                    fail(f"{w}: display_points disagrees with the catalog's permission for {s['permission']}")
                n_public += s["display_points"]
                if s["crop_code"] not in cat["crops"] or s["season"] not in c["crops"].get(s["crop_code"], []):
                    fail(f"{w}: crop or season outside the catalog")
                seen = set()
                for i, row in enumerate(s["responses"]):
                    r = check_row(f"{w}.responses[{i}]", row, RL_COLS, texts=("variable", "index", "se_source", "note", "interval_method"), ints=("n_years", "year_first", "year_last"))
                    if not r:
                        continue
                    if r["variable"] != "ly" or r["index"] not in INDICES or (r["se_source"] is not None and r["se_source"] not in SE_SOURCES) or r["index"] in seen:
                        fail(f"{w}.responses[{i}]: vocabulary or duplicate index")
                    seen.add(r["index"])
                    if r["own_data_weight"] is not None and not 0 <= r["own_data_weight"] <= 1:
                        fail(f"{w}.responses[{i}]: own_data_weight {r['own_data_weight']} outside [0, 1]")
                    if r["note"] == "no_own_slope":
                        if any(r[c] is not None for c in RL_WITHHELD):
                            fail(f"{w}.responses[{i}]: a leaf with no own slope must have its hierarchical estimate withheld")
                    elif r["slope_eb"] in centers:
                        n_center_leaf += 1
                        if not (r["note"] == "single_leaf" and r["own_data_weight"] == 1 and r["slope_eb"] == r["slope_own"]):
                            fail(f"{w}.responses[{i}]: slope_eb equals a pooling center although the leaf is not a single leaf with its own slope retained in full")
                    if r["lo_eb"] is not None and r["hi_eb"] is not None and r["lo_eb"] > r["hi_eb"]:
                        fail(f"{w}.responses[{i}]: lo_eb > hi_eb")
                seen = set()
                for i, row in enumerate(s["predictions"]):
                    r = check_row(f"{w}.predictions[{i}]", row, PS_COLS, texts=("method", "scenario", "issue"), ints=("harvest_year", "lead", "beyond_fit"), bools=("usable",))
                    if r and (r["method"] not in METHODS_V2 or r["scenario"] not in SCENARIOS or (r["method"], r["scenario"]) in seen):
                        fail(f"{w}.predictions[{i}]: vocabulary or duplicate")
                    if r:
                        seen.add((r["method"], r["scenario"]))
                years = set()
                for i, row in enumerate(s["calendar"]):
                    r = check_row(f"{w}.calendar[{i}]", row, CS_COLS, texts=CS_TEXT, ints=("harvest_year",), bools=("cycle_unresolved",))
                    if not r:
                        continue
                    if r["harvest_year"] in years or r["harvest_year"] not in harvest_years:
                        fail(f"{w}.calendar[{i}]: harvest year {r['harvest_year']}")
                    years.add(r["harvest_year"])
                    check_calendar_row(f"{w}.calendar[{i}]", r, manifest["published_range"])
                if s["weight"] is not None:
                    r = check_row(f"{w}.weight", s["weight"], W_COLS, texts=W_TEXT, ints=W_INT, bools=("covered",))
                    if r and (r["status"] not in ("reported", "carry_forward", "stale", "no_area") or (r["covered"] and r["baseline_production_t"] is None)):
                        fail(f"{w}.weight: status {r['status']} or a covered leaf without a baseline")
                # the record shard of the series
                rec = rf["series"][s["id"]]
                for k in ("crop_code", "season", "permission", "display_points", "withheld", "obs", "trend", "trend_anomaly", "enso", "qc", "responses", "weather"):
                    if k not in rec:
                        fail(f"{w}: record lacks {k}")
                products = set()
                for i, row in enumerate(rec.get("weather", [])):
                    r = check_row(f"{w}.weather[{i}]", {k: v for k, v in row.items() if k != "metrics"}, WA_HEAD, texts=("product", "issue", "data_end"), ints=("harvest_year", "elapsed_days")) if isinstance(row, dict) and "metrics" in row else None
                    if r is None or not isinstance(row["metrics"], dict):
                        fail(f"{w}.weather[{i}]: shape"); continue
                    if r["product"] in products or r["product"] not in ("best", "chirps", "era5", "cpc", "agera5", "vhp"):
                        fail(f"{w}.weather[{i}]: product {r['product']}")
                    products.add(r["product"])
                    for m, vals in row["metrics"].items():
                        if m not in set(metrics) | set(cat.get("greenness_metrics", [])) or not (isinstance(vals, list) and len(vals) == len(WA_FIELDS) and all(v is None or is_num(v) for v in vals)):
                            fail(f"{w}.weather[{i}].{m}: {vals!r}")
                if rec["display_points"] != s["display_points"] or rec["permission"] != s["permission"]:
                    fail(f"{w}: record permission differs from the units file")
                if not s["display_points"]:
                    n_restricted += 1
                    if rec["obs"] is not None or rec["trend_anomaly"] is not None or rec["qc"] is not None or not rec["withheld"]:
                        fail(f"{w}: a restricted series must carry no observation rows, anomaly rows or QC flags and must say why")
                else:
                    if rec["withheld"] is not None or not isinstance(rec["obs"], list) or not isinstance(rec["trend_anomaly"], list) or not isinstance(rec["qc"], list):
                        fail(f"{w}: a public series carries lists of observations, anomalies and QC flags")
                    last_year = None
                    for o in rec["obs"]:
                        n_obs += 1
                        if not (isinstance(o, list) and len(o) == 2 and isinstance(o[0], int) and is_num(o[1]) and o[1] >= 0):
                            fail(f"{w}: observation {o!r}"); break
                        if last_year is not None and o[0] < last_year:
                            fail(f"{w}: harvest years out of order at {o[0]}"); break
                        last_year = o[0]
                    for i, row in enumerate(rec["trend_anomaly"]):
                        if not (isinstance(row, list) and len(row) == 4 and isinstance(row[0], int) and all(is_num(v) for v in row[1:])):
                            fail(f"{w}.trend_anomaly[{i}]: {row!r}"); break
                    if rec["trend_anomaly"] and rec["trend"] is None:
                        fail(f"{w}: fitted values without a trend row")
                    for i, row in enumerate(rec["qc"]):
                        if not (isinstance(row, list) and len(row) == 4 and (row[0] is None or is_num(row[0])) and all(v is None or isinstance(v, str) for v in row[1:])):
                            fail(f"{w}.qc[{i}]: {row!r}"); break
                if rec["trend"] is not None:
                    check_row(f"{w}.trend", rec["trend"], TS_COLS, ints=("year_first", "year_last", "n_years"))
                for i, row in enumerate(rec["enso"]):
                    if not (isinstance(row, list) and len(row) == 3 and isinstance(row[0], int) and all(v is None or is_num(v) for v in row[1:])):
                        fail(f"{w}.enso[{i}]: {row!r}"); break
                seen = set()
                for i, row in enumerate(rec["responses"]):
                    r = check_row(f"{w}.record.responses[{i}]", row, RL_COLS, texts=("variable", "index", "se_source", "note", "interval_method"), ints=("n_years", "year_first", "year_last"))
                    if r:
                        if r["variable"] not in ENV_VARIABLES or r["index"] not in INDICES or (r["variable"], r["index"]) in seen:
                            fail(f"{w}.record.responses[{i}]: variable, index or duplicate")
                        seen.add((r["variable"], r["index"]))
                        if r["own_data_weight"] is not None and not 0 <= r["own_data_weight"] <= 1:
                            fail(f"{w}.record.responses[{i}]: own_data_weight outside [0, 1]")
        all_series_ids |= series_ids
        if len(series_ids) != c["n_series"] or n_public != c["n_series_public"]:
            fail(f"units/{iso}: {len(series_ids)} series ({n_public} public) against {c['n_series']} ({c['n_series_public']}) in the catalog")
        gpath = base / "geometry" / f"{iso}.json"
        if c["geometry"] != gpath.exists():
            fail(f"geometry/{iso}: catalog says {c['geometry']}")
        if gpath.exists():
            g = read(gpath)
            if g.get("type") != "FeatureCollection":
                fail(f"geometry/{iso}: not a FeatureCollection")
            ids = set()
            for f in g["features"]:
                n_features += 1
                if f.get("id") not in uf["units"] or f["id"] in ids:
                    fail(f"geometry/{iso}: feature {f.get('id')} is not a unit of the country or repeats")
                ids.add(f.get("id"))
                if f["geometry"]["type"] not in ("Polygon", "MultiPolygon"):
                    fail(f"geometry/{iso}/{f['id']}: {f['geometry']['type']}")
                for k in ("id", "country", "name", "level", "tier"):
                    if k not in f["properties"]:
                        fail(f"geometry/{iso}/{f['id']}: property {k}")
    wg = read(base / "geometry" / "world.json")
    assert wg["type"] == "FeatureCollection" and all(re.fullmatch(r"[A-Z0-9-]{3}", f["id"]) for f in wg["features"])
    if n_restricted != manifest["counts"]["series_restricted"] or n_series != manifest["counts"]["series"]:
        fail(f"{n_series} series with {n_restricted} restricted against the manifest's {manifest['counts']['series']} and {manifest['counts']['series_restricted']}")
    # ---- world_units.json and geometry/world_units.json (10 October 2026) ---------------------------------------------
    wu = read(base / "world_units.json")
    if wu.get("release") != release or wu.get("columns") != ["pct", "lo", "hi", "harvest_year", "series_id"] or set(wu.get("units", {})) != set(cat["families"]):
        fail("world_units.json: header, columns or families")
    n_wu = 0
    for fam, d in wu.get("units", {}).items():
        for ukey, row in d.items():
            n_wu += 1
            if not (isinstance(row, list) and len(row) == 5 and all(v is None or is_num(v) for v in row[:3]) and isinstance(row[3], int) and isinstance(row[4], str) and row[4].isdigit()):
                fail(f"world_units.json/{fam}/{ukey}: row"); break
            if row[4] not in globals().get('_all_series_ids', set()):
                fail(f"world_units.json/{fam}/{ukey}: series {row[4]} is not in the units files"); break
        for iso, key in wu.get("panels", {}).get(fam, {}).items():
            if key not in panel_keys or not key.startswith(iso + "|"):
                fail(f"world_units.json/panels/{fam}/{iso}: {key}")
    wug = read(base / "geometry" / "world_units.json")
    if wug.get("type") != "FeatureCollection" or not isinstance(wug.get("features"), list):
        fail("geometry/world_units.json: not a FeatureCollection")
    else:
        ids = set()
        for f in wug["features"]:
            if f.get("id") in ids or f.get("id") != f.get("properties", {}).get("id") or f["properties"].get("level") == "national" or f["properties"].get("country") not in cat["countries"]:
                fail(f"geometry/world_units.json: feature {f.get('id')}"); break
            ids.add(f["id"])
            if f["geometry"]["type"] not in ("Polygon", "MultiPolygon"):
                fail(f"geometry/world_units.json/{f['id']}: {f['geometry']['type']}"); break
        if (base / "geometry" / "world_units.json").stat().st_size > 8e6:
            fail("geometry/world_units.json exceeds 8 MB")
    # ---- anomalies/<family>.json and anomalies/index.json (18 October 2026): required once the manifest records the layer --------
    an = check_anomalies(base, cat, manifest, globals().get('_all_series_ids')) if manifest.get("anomalies") or (base / "anomalies").is_dir() else {}
    if manifest.get("anomalies") and an and (manifest["anomalies"].get("series") != an["series"] or manifest["anomalies"].get("values") != an["values"]):
        fail(f"manifest.anomalies counts {manifest['anomalies'].get('series')}/{manifest['anomalies'].get('values')} against the files' {an['series']}/{an['values']}")
    if problems:
        raise SystemExit("FAIL schema:\n" + "\n".join(problems))
    print(f"PASS schema {release} (contract {CONTRACT_V2}): {len(manifest['files'])} files hashed, {n_wu} world unit values, "
          f"{an.get('series', 0)} anomaly series with {an.get('values', 0):,} values and {an.get('national', 0)} national series,  {len(wug.get('features', []))} world unit polygons, {len(cat['countries'])} countries, {len(panel_keys)} panels, {n_cw} national calendar rows, "
          f"{len(skill['panels'])} skill panels, {n_series} series ({n_restricted} restricted, observations withheld), {n_obs:,} observations in {n_records} record shards, {n_state_records} state records, {n_crop_area[0]} units with a CROPGRIDS crop_area, "
          f"{n_features} mapped units; {n_center_leaf} single-leaf responses equal their own center and no other response equals a pooling center; "
          f"releases.json default {releases['default']}, candidate {rel_entry['candidate']}")


def check_anomalies(base: Path, cat: dict, manifest: dict, all_series_ids) -> dict:
    """anomalies/index.json and anomalies/<family>.json (18 October 2026, scripts/anomaly_layer.py): the header, the encoding
    (series[id] = [first_year, anomaly[], yield[], exposure[]] over consecutive years, null where no yield), the year ranges,
    the national series per country, the counts against the values, the default years, the December-February index per year,
    and the file hashes the index and the manifest record. Returns the counts for the summary line."""
    folder = base / "anomalies"
    idx = read(folder / "index.json")
    families = list(cat["families"])
    cols = ["anomaly_pct", "yield_t_ha", "exposure"]
    for k in ("release", "contract", "layer", "families", "columns", "decimals", "encoding", "year_first", "years", "default_year", "counts", "counts_world", "djf_relative_n34", "index", "selection", "trend", "files"):
        if k not in idx:
            fail(f"anomalies/index.json lacks {k}"); return {}
    if idx["release"] != manifest["release"] or idx["contract"] != manifest["contract"] or idx["layer"] != "anomaly" or idx["families"] != families or idx["columns"] != cols:
        fail("anomalies/index.json: header, families or columns")
    if not (isinstance(idx["year_first"], int) and set(idx["decimals"]) >= set(cols) and all(isinstance(idx["decimals"][c], int) for c in cols)):
        fail("anomalies/index.json: year_first or decimals")
    year_first = idx["year_first"]
    for k in ("source", "column", "definition", "sha256", "decimals"):
        if k not in idx["index"]:
            fail(f"anomalies/index.json/index lacks {k}")
    src = ATLAS / str(idx["index"]["source"])
    if src.exists() and idx["index"]["sha256"] and sha(src) != idx["index"]["sha256"]:
        fail(f"anomalies/index.json: {idx['index']['source']} changed since the export")
    last = max(v[1] for v in idx["years"].values()) if idx["years"] else year_first
    djf = idx["djf_relative_n34"]
    if set(djf) != {str(y) for y in range(year_first, last + 1)} or not all(v is None or is_num(v) for v in djf.values()):
        fail("anomalies/index.json: djf_relative_n34 does not cover every year of the range with a number or null")
    n_series = n_values = n_national = 0
    for fam in families:
        where = f"anomalies/{fam}.json"
        if fam not in idx["files"] or fam not in idx["years"] or fam not in idx["counts"] or fam not in idx["counts_world"] or fam not in idx["default_year"]:
            fail(f"anomalies/index.json: no entry for {fam}"); continue
        p = folder / f"{fam}.json"
        if not p.exists():
            fail(f"{where}: missing"); continue
        entry = idx["files"][fam]
        if entry.get("path") != where or sha(p) != entry.get("sha256") or p.stat().st_size != entry.get("bytes"):
            fail(f"{where}: the index's path, hash or size differs")
        if manifest["files"].get(where, {}).get("sha256") != entry.get("sha256"):
            fail(f"{where}: the manifest's hash differs from the index's")
        f = read(p)
        for k in ("release", "contract", "layer", "family", "columns", "decimals", "encoding", "year_first", "years", "default_year", "n_series", "n_values", "national", "counts", "counts_world", "series"):
            if k not in f:
                fail(f"{where} lacks {k}"); break
        else:
            yrs = f["years"]
            if f["release"] != manifest["release"] or f["family"] != fam or f["layer"] != "anomaly" or f["columns"] != cols or f["encoding"] != idx["encoding"] or f["year_first"] != year_first or yrs != idx["years"][fam] or f["default_year"] != idx["default_year"][fam]:
                fail(f"{where}: header differs from the index")
            if not (isinstance(yrs, list) and len(yrs) == 2 and all(isinstance(y, int) for y in yrs) and year_first <= yrs[0] <= yrs[1]):
                fail(f"{where}: years {yrs}")
            if not (isinstance(f["default_year"], int) and yrs[0] <= f["default_year"] <= yrs[1]):
                fail(f"{where}: default_year {f['default_year']} outside {yrs}")
            counts: dict = {}
            ids_ok = True
            for sid, s in f["series"].items():
                if not (isinstance(sid, str) and sid.isdigit() and isinstance(s, list) and len(s) == 4 and isinstance(s[0], int) and all(isinstance(a, list) for a in s[1:]) and len(s[1]) == len(s[2]) == len(s[3]) and len(s[1]) > 0):
                    fail(f"{where}/{sid}: entry shape"); ids_ok = False; break
                if s[0] < yrs[0] or s[0] + len(s[1]) - 1 > yrs[1]:
                    fail(f"{where}/{sid}: years {s[0]}..{s[0] + len(s[1]) - 1} outside {yrs}"); ids_ok = False; break
                if all_series_ids is not None and sid not in all_series_ids:
                    fail(f"{where}/{sid}: series not in the units files"); ids_ok = False; break
                any_value = False
                for i, (a, y, e) in enumerate(zip(s[1], s[2], s[3])):
                    if (a is None) != (y is None) or not all(v is None or is_num(v) for v in (a, y, e)) or (a is not None and (a < -100 or y < 0)):   # a reported zero yield is -100
                        fail(f"{where}/{sid}: value at {s[0] + i}: {a!r} {y!r} {e!r}"); ids_ok = False; break
                    if a is not None:
                        any_value = True; counts[s[0] + i] = counts.get(s[0] + i, 0) + 1
                if not ids_ok:
                    break
                if not any_value:
                    fail(f"{where}/{sid}: no value"); ids_ok = False; break
            if not ids_ok:
                continue
            if f["n_series"] != len(f["series"]) or f["n_values"] != sum(counts.values()) or {int(k): v for k, v in f["counts"].items()} != counts or f["counts"] != idx["counts"][fam]:
                fail(f"{where}: n_series, n_values or counts do not match the values")
            cw = {int(k): v for k, v in f["counts_world"].items()}
            if f["counts_world"] != idx["counts_world"][fam] or any(y not in counts or n > counts[y] or not isinstance(n, int) or n < 1 for y, n in cw.items()):
                fail(f"{where}: counts_world exceed the counts or name a year without values")
            for iso, nat in f["national"].items():
                if iso not in cat["countries"] or not (isinstance(nat, list) and len(nat) == 3 and isinstance(nat[0], str) and nat[0] in f["series"] and nat[1] in cat["crops"] and cat["crops"][nat[1]]["family"] == fam and isinstance(nat[2], str)):
                    fail(f"{where}/national/{iso}: {nat}"); break
            n_series += len(f["series"]); n_values += sum(counts.values()); n_national += len(f["national"])
    return dict(series=n_series, values=n_values, national=n_national)


def check_calendar_row(where: str, r: dict, published_range) -> None:
    if r["confidence"] not in CONFIDENCE:
        fail(f"{where}: confidence {r['confidence']}")
    if r["cycle"] not in ("single", "first", "second", "both"):
        fail(f"{where}: cycle {r['cycle']}")
    if r["cycle_unresolved"] != (r["cycle"] == "both" or r["confidence"] == "missing"):
        fail(f"{where}: cycle_unresolved must be cycle == 'both' or confidence == 'missing'")
    if r["confidence"] == "missing":
        if r["plant_date"] is not None or r["harvest_date"] is not None:
            fail(f"{where}: a missing calendar carries dates")
    else:
        if not (is_date(r["plant_date"]) and is_date(r["harvest_date"]) and r["plant_date"] < r["harvest_date"]):
            fail(f"{where}: dates {r['plant_date']}..{r['harvest_date']}")
        elif not r["harvest_date"].startswith(str(r["harvest_year"])):
            fail(f"{where}: harvest {r['harvest_date']} is not in {r['harvest_year']}")
        elif not (published_range[0] <= r["plant_date"] and r["harvest_date"] <= published_range[1]):
            fail(f"{where}: dates outside the published range")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--release", help="one release; every release of releases.json when absent")
    a = ap.parse_args()
    releases = read(SITE / "releases.json")
    for r in releases["releases"]:
        for k in ("release", "built_utc", "issue", "data_end", "index_last_month", "label"):
            assert k in r, f"releases.json entry lacks {k}"
    assert releases["default"] == max(r["release"] for r in releases["releases"] if not r.get("candidate")), "default is not the latest non-candidate release"
    targets = [a.release] if a.release else [r["release"] for r in releases["releases"]]
    for release in targets:
        assert any(r["release"] == release for r in releases["releases"]), f"releases.json does not list {release}"
        problems.clear()
        contract = read(SITE / release / "manifest.json").get("contract")
        (check_v2 if contract == CONTRACT_V2 else check_legacy)(release, releases)


if __name__ == "__main__":
    main()
