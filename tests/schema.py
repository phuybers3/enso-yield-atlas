"""Check every file of site/data/<R> against the atlas contract (4_ag/platform/SCHEMA.md, atlas layer).

    python tests/schema.py [--release R]

The contract: catalog.json, world.json, panels.json, skill.json, countries/<ISO3>.json, units/<ISO3>.json,
geometry/<ISO3>.json (and geometry/world.json), manifest.json with the sha256 of every file, and
site/data/releases.json naming the release. Values are finite numbers, strings, booleans or null; keys are
iso3|crop_code|season; methods, scenarios and statuses come from the analysis layer's vocabularies.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from pathlib import Path

ATLAS = Path(__file__).resolve().parents[1]
SITE = ATLAS / "site" / "data"
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
WA_HEAD = ["product", "issue", "data_end", "harvest_year", "frac_elapsed", "elapsed_days", "t_coverage", "p_coverage"]
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
    return json.loads(path.read_text(), parse_constant=strict_constant)


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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--release")
    a = ap.parse_args()
    releases = read(SITE / "releases.json")
    release = a.release or releases["default"]
    assert any(r["release"] == release for r in releases["releases"]), f"releases.json does not list {release}"
    assert releases["default"] == max(r["release"] for r in releases["releases"]), "default is not the latest release"
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
                    if r["product"] in products or r["product"] not in ("best", "chirps", "era5", "cpc", "agera5"):
                        fail(f"{w}.weather[{i}]: product {r['product']}")
                    products.add(r["product"])
                    for m, vals in row["metrics"].items():
                        if m not in metrics or not (isinstance(vals, list) and len(vals) == len(WA_FIELDS) and all(v is None or is_num(v) for v in vals)):
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


if __name__ == "__main__":
    main()
