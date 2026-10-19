"""Export one release of the site data from the analysis results and the release database.

The atlas layer of analysis/contracts/SCHEMA.md (contract of 9 October 2026: hierarchical responses, additive aggregates,
calendar status, the publication rule). Read `analysis/releases/crops/<R>/` (the Parquet tables of the analysis layer), the
release database the results manifest names (units, series catalog, observations, ENSO exposures, QC flags, the
sources table) and `data/pipelines/permissions.toml` (what each yield source lets us publish), and write
`site/data/<R>/`. Every number written here is a copy of a results row or a database value; this script does no
aggregation, pooling, unit conversion or significance decision. The one rule it applies is the publication rule:
a series whose source permits no display of points gets its trend, responses and aggregates exported and its
observation rows withheld. Where a field is rounded, the manifest states the decimals, and `tests/numerics.py`
checks every value against its source row at that precision.

    python scripts/export_release.py --release 2026-10-09-candidate --candidate --geometry-from 2026-10-08

Outputs (site/data/<R>/):
    catalog.json          countries, crops, vocabularies, the model and calendar summary, the source credits
    world.json            the first screen: one compact outlook row per panel, the world rows, the index path
    calendar_world.json   one national calendar row per panel and harvest year, for the world calendar layers
    countries/<ISO>.json  the country's panels with every prediction_panel and aggregate row, the state aggregates
    units/<ISO>.json      every unit and series, the country-map payload: yield responses (response_leaf, variable
                          ly), predictions, calendar status, the target-year weight
    records/<ISO>/<unit>.json  one shard per unit, the unit-page payload: observations, trend, anomalies, ENSO
                          exposures, QC flags, the weather-variable responses and the season-to-date weather of its
                          series; records/<ISO>/index.json lists the shards
    skill.json            the country-level hindcast skill rows
    geometry/<ISO>.json, geometry/world.json, anomalies/<family>.json and anomalies/index.json (the harvest anomaly by year,
    18 October 2026, scripts/anomaly_layer.py), manifest.json; and an entry in site/data/releases.json.

Tables the candidate results folder lacks (calendar_status, the season-to-date weather tables) are read from the
source release's results folder when the results manifest names one; the manifest records every table's path and
hash under `tables`.
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
import datetime as dt
import hashlib
import json
import math
import shutil
import sqlite3
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
import tomli

ATLAS = Path(__file__).resolve().parents[1]
ENSO = next((p for p in ATLAS.parents if (p / "project.toml").is_file()), ATLAS.parent)
HULTGREN = _project_path("hultgren")
SITE_DATA = ATLAS / "site" / "data"
PERMISSIONS = ENSO / "data/registry/permissions.toml"
CONTRACT = "2026-10-09"
WORLD_UNITS_TOLERANCE = 0.05                 # degrees; the world map's copy of the unit polygons (geometry/world_units.json)
WORLD_UNITS_MIN_PART = 0.01                  # square degrees; island parts below the world map's pixel size are dropped from that copy (10 October 2026)
STAPLES = ["maize", "rice", "wheat", "soybean", "sorghum", "cassava"]
METHODS = ["trend", "index_perfect", "index_todate", "index_outlook", "weather_todate", "index_hier"]
SCENARIOS = ["low", "medium", "high", "observed"]
STATUS = ["not planted", "in the ground", "complete"]
CONFIDENCE = ["dated", "monthly", "approximate", "missing"]
# Decimals kept per file family. None means the float is written at full double precision (repr round trip). The
# unit responses are unrounded so that tests/schema.py can tell a leaf's own estimate from its pooling center.
PRECISION = {"world.json": None, "world.json.panels": 6, "countries": None, "calendar_world.json": None, "skill.json": 6, "units": 6, "units.responses": None,
             "records": 4, "records.enso": 6, "records.responses": None}
# Tables the exporter reads from the source release's results when the release's own folder lacks them.
FALLBACK_TABLES = ["calendar_status", "weather_todate_anomaly", "weather_todate_anomaly_panel", "prediction_weather_panel", "evaluation_skill"]
WEATHER_METRICS = ["tavg_mean", "tmax_mean", "tmin_mean", "gdd", "edd30", "kdd31", "tmax_p95_days", "txx", "precip", "wet_days", "precip_p95_days", "rx1day", "rx5day", "cdd"]
WEATHER_FIELDS = ["value", "reference", "anom", "z", "pct_rank", "n_years"]
PANEL_WEATHER_FIELDS = ["value", "anom", "product", "expected", "percentile", "z", "slope_per_degC", "slope_p", "resid_sd", "hist_sd", "signal", "beyond_range"]
WA_HEAD = ["product", "issue", "data_end", "harvest_year", "frac_elapsed", "elapsed_days", "t_coverage", "p_coverage"]
WAP_HEAD = ["issue", "harvest_year", "data_end", "frac_elapsed", "n_series", "n_years", "production_t", "coverage_share", "idx_todate", "metrics_with_signal", "metrics_concordant", "verdict"]
# Column lists of the site files; tests/schema.py and tests/numerics.py carry the same lists.
PP_COLS = ["method", "scenario", "harvest_year", "issue", "lead", "pct", "lo", "hi", "se", "production_mt", "n_series", "local_share", "usable_share", "status"]
AG_COLS = ["method", "scenario", "target_year", "issue", "dprod_mt_mean", "pct_mean", "dprod_lo", "dprod_hi", "pct_lo", "pct_hi", "dprod_lo_resp", "dprod_hi_resp",
           "pct_lo_resp", "pct_hi_resp", "dprod_mt_point", "pct_point", "pct_sd", "pct_sd_resp", "dprod_mt_mean_pred", "baseline_production_mt", "covered_share",
           "n_leaves", "n_rep", "footprint_id"]
AG_TEXT = ("method", "scenario", "issue", "footprint_id"); AG_INT = ("target_year", "n_leaves", "n_rep")
WP_COLS = ["key", "iso3", "crop_code", "crop_family", "season", "harvest_year", "lead", "status", "n_series", "local_share", "baseline_production_mt",
           "pct", "lo", "hi", "se", "lo_resp", "hi_resp", "dprod_mt", "dprod_lo", "dprod_hi", "n_leaves"]
WW_COLS = ["crop_family", "issue", "method", "scenario", "target_year", "dprod_mt", "pct", "lo", "hi", "production_mt", "coverage_share", "lo_resp", "hi_resp",
           "dprod_lo", "dprod_hi", "dprod_lo_resp", "dprod_hi_resp", "dprod_mt_point", "pct_point", "covered_share", "n_leaves", "footprint_id"]
RL_COLS = ["variable", "index", "n_years", "year_first", "year_last", "slope_own", "se_own", "se_source", "slope_eb", "se_eb", "own_data_weight", "pct_eb", "lo_eb", "hi_eb", "note"]
RL_TEXT = ("variable", "index", "se_source", "note"); RL_INT = ("n_years", "year_first", "year_last")
RL_WITHHELD = ["slope_eb", "se_eb", "pct_eb", "lo_eb", "hi_eb"]            # nulled where note == no_own_slope
PS_COLS = ["method", "scenario", "harvest_year", "issue", "lead", "pct", "lo", "hi", "se", "frac_elapsed", "usable", "skill_vs_trend", "production_t", "beyond_fit"]
CS_COLS = ["harvest_year", "cycle", "plant_date", "harvest_date", "calendar_source", "calendar_rank", "confidence", "window_source", "rule", "cycle_unresolved"]
CS_TEXT = ("cycle", "plant_date", "harvest_date", "calendar_source", "confidence", "window_source", "rule")
CW_COLS = ["harvest_year", "series_id", "unit_key", "series_crop", "series_season", "match"] + CS_COLS[1:]
W_COLS = ["target_year", "issue", "lead", "frac_elapsed", "area_ha", "area_vintage", "area_source", "trend_yield", "trend_yield_fit", "trend_source", "last_yield",
          "last_yield_year", "baseline_production_t", "status", "covered"]
W_TEXT = ("issue", "area_source", "trend_source", "status"); W_INT = ("target_year", "lead", "area_vintage", "last_yield_year")
SK_COLS = ["method", "lead", "n_years", "rmse", "mae", "skill_vs_trend", "corr", "coverage_80", "note", "n_series", "train_years", "info_cutoff", "method_version"]
SK_TEXT = ("method", "note", "train_years", "info_cutoff", "method_version"); SK_INT = ("lead", "n_years", "n_series")
TS_COLS = ["year_first", "year_last", "n_years", "trend_pct_per_year", "intercept"]
NAME_OVERRIDES = {"USA": "United States", "GBR": "United Kingdom", "KOR": "South Korea", "PRK": "North Korea", "IRN": "Iran",
                  "SYR": "Syria", "VNM": "Vietnam", "RUS": "Russia", "TZA": "Tanzania", "COD": "DR Congo", "CIV": "Côte d'Ivoire",
                  "LAO": "Laos", "BOL": "Bolivia", "VEN": "Venezuela", "TUR": "Türkiye", "CZE": "Czechia", "ARE": "United Arab Emirates",
                  "TWN": "Taiwan", "MDA": "Moldova", "BRN": "Brunei", "FSM": "Micronesia", "SWZ": "Eswatini"}
CROP_LABELS = {"rice_paddy": "rice (paddy)", "rice_milled": "rice (milled)", "rice_brown": "rice (brown)",
               "wheat_spring": "spring wheat", "wheat_winter": "winter wheat"}
SOURCE_ROLES = {"hvstat": "yield", "hvstat_africa": "yield", "hultgren": "yield", "cropgrids": "weights", "faostat": "yield", "nino34": "index", "best_daily": "weather", "chirps_v2": "weather",
                "era5_precip": "weather", "cpc_global_temp": "weather", "chirps_prelim": "weather", "spam2010": "weights"}


# ---- helpers ----------------------------------------------------------------------------------------------------------
def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def missing(x) -> bool:
    return x is None or x is pd.NA or x is pd.NaT or (isinstance(x, float) and math.isnan(x))


def num(x, d=None):
    """A results value as JSON: None for a missing value, otherwise the float rounded to d decimals (None: unrounded)."""
    if missing(x):
        return None
    if isinstance(x, (bool, np.bool_)):
        return bool(x)
    if isinstance(x, (int, np.integer)):
        return int(x)
    if isinstance(x, str):
        return x
    v = float(x)
    if not math.isfinite(v):
        return None
    return v if d is None else round(v, d)


def text(x):
    return None if missing(x) else str(x)


def write(path: Path, data) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False, allow_nan=False) + "\n")
    tmp.replace(path)
    return path.stat().st_size


def country_name(iso3: str, raw: str | None) -> str:
    if iso3 in NAME_OVERRIDES:
        return NAME_OVERRIDES[iso3]
    return (raw or iso3).replace("_", " ").title()


def crop_label(code: str) -> str:
    return CROP_LABELS.get(code, code.replace("_", " "))


def panel_key(iso3, crop_code, season) -> str:
    return f"{iso3}|{crop_code}|{season}"


def panel_label(name: str, crop_code: str, season: str) -> str:
    return f"{name} {crop_label(crop_code)}" + ("" if season in ("main", "annual", "Annual") else f", {season}")


def shard_name(unit_key: str) -> str:
    """The file name of a unit's record shard: the key with ':' replaced, so the name is safe on every file system."""
    return unit_key.replace(":", "_") + ".json"


def rows(frame: pd.DataFrame, cols, d=None, text_cols=(), int_cols=(), bool_cols=(), id_cols=(), as_list=False):
    """Copy the listed columns of every row into dicts (or, as_list, into arrays in column order), missing values as null."""
    out = []
    for r in frame[list(cols)].itertuples(index=False):
        rec = {}
        for c, v in zip(cols, r):
            if c in id_cols:
                rec[c] = None if missing(v) else str(int(v))
            elif c in text_cols:
                rec[c] = text(v)
            elif c in bool_cols:
                rec[c] = None if missing(v) else bool(v)
            elif c in int_cols:
                rec[c] = None if missing(v) else int(v)
            else:
                rec[c] = num(v, d)
        out.append([rec[c] for c in cols] if as_list else rec)
    return out


def by_key(frame: pd.DataFrame, key: str) -> dict:
    return {k: v for k, v in frame.groupby(key, sort=False)}


# ---- permissions --------------------------------------------------------------------------------------------------------
def load_permissions(path: Path) -> dict:
    perm = tomli.loads(path.read_text())
    perm.setdefault("default", {}); perm.setdefault("sources", {})
    for k in ("display_points", "redistribute"):
        perm["default"].setdefault(k, False)
    perm["default"].setdefault("derived_ok", True)
    return perm


def resolve_permission(perm: dict, source: str, iso3: str) -> tuple[str, dict]:
    """The permission entry a series takes: its source's entry, or the agency its country maps to, or the default."""
    entry = perm["sources"].get(source)
    if entry is not None and iso3 in entry.get("by_iso3", {}):
        source = entry["by_iso3"][iso3]; entry = perm["sources"].get(source)
    if entry is None:
        return source, dict(perm["default"], name=source, resolved="default")
    fields = {k: v for k, v in entry.items() if k != "by_iso3"}
    for k in ("display_points", "redistribute", "derived_ok"):
        fields.setdefault(k, perm["default"][k])
    fields["resolved"] = "entry"
    return source, fields


# ---- geometry ----------------------------------------------------------------------------------------------------------
def simplify_local(geom, cache):
    """Simplify a polygon at 700 m in a local equal-area projection, as scripts/build_global_data.py does, and round to 1e-5 degrees."""
    import shapely
    from shapely.ops import transform
    from pyproj import Transformer
    center = geom.representative_point()
    key = (round(center.y), round(center.x))
    if key not in cache:
        crs = f"+proj=laea +lat_0={key[0]} +lon_0={key[1]} +datum=WGS84 +units=m"
        cache[key] = (Transformer.from_crs("EPSG:4326", crs, always_xy=True).transform,
                      Transformer.from_crs(crs, "EPSG:4326", always_xy=True).transform)
    forward, inverse = cache[key]
    simplified = transform(inverse, transform(forward, geom).simplify(700, preserve_topology=True))
    simplified = shapely.make_valid(simplified)
    if simplified.geom_type == "GeometryCollection":
        pieces = [g for g in simplified.geoms if g.geom_type in ("Polygon", "MultiPolygon")]
        if not pieces:
            return None
        simplified = shapely.union_all(pieces)
    if simplified.geom_type not in ("Polygon", "MultiPolygon") or simplified.is_empty:
        return None
    return shapely.set_precision(simplified, 1e-5)


def build_geometry(units: pd.DataFrame, out: Path):
    """Resolve each unit's boundary from the source its `geometry_source` names, one file per country, plus the world outlines."""
    import geopandas as gpd
    import shapely
    from shapely.geometry import mapping
    lookup = {r.unit_key: r for r in units.itertuples(index=False)}
    frames, hashes = [], {}
    sources = units.geometry_source.dropna().unique()
    for src in sorted(s for s in sources if s.startswith("hvstat:")):
        rel = src.split(":", 1)[1]
        path = _resolve_path(rel)
        hashes[rel] = sha(path)
        g = gpd.read_file(path).to_crs(4326)
        iso = units.loc[units.geometry_source.eq(src), "iso3"].iloc[0]
        g["key"] = iso + ":" + g.stable_id.astype(str)
        frames.append(g[["key", "geometry"]])
    for src in sorted(s for s in sources if s.startswith("hvstat_africa:")):
        sys.path.insert(0, str(ENSO / "data/pipelines"))
        import hvstat_africa as hva
        rel = src.split(":", 1)[1]
        hashes[rel] = sha(_resolve_path(rel))
        g = hva.boundaries().rename(columns={"unit_key": "key"})
        frames.append(g[["key", "geometry"]])
    if any(s.startswith("hultgren:") for s in sources):
        sys.path.insert(0, str(HULTGREN / "3_data" / "lib"))
        from hultgren_repro import gridagg
        path = HULTGREN / "3_data/reference/cil-ag-replication-package/Fig1/Crop_Coverage/data/shapes/all_countries.shp"
        for p in path.parent.glob("all_countries.*"):
            hashes[str(p.relative_to(HULTGREN))] = sha(p)
        g = gridagg.normalize_keys(gpd.read_file(path), is_shapefile=True).to_crs(4326)
        g["key"] = g.iso + ":" + g.adm1_id.astype(str) + ":" + g.adm2_id.astype(str)
        g = g[g.key.isin(lookup)].copy()
        g.geometry = shapely.make_valid(g.geometry)
        g = g.dissolve(by="key", as_index=False)
        frames.append(g[["key", "geometry"]])
    path = ENSO / "data/raw/naturalearth/ne_50m_admin_0_countries.shp"
    for p in path.parent.glob("ne_50m_admin_0_countries.*"):
        hashes[str(p.relative_to(ENSO))] = sha(p)
    ne = gpd.read_file(path).to_crs(4326)
    aliases = {"PSX": "PSE", "SDS": "SSD"}
    ne["key"] = ne.ADM0_A3.map(lambda k: aliases.get(k, k))
    world = [dict(type="Feature", id=r.key, properties=dict(country=r.key, name=r.NAME_LONG),
                  geometry=mapping(shapely.set_precision(r.geometry.simplify(0.025, preserve_topology=True), 1e-5))) for r in ne.itertuples()]
    write(out / "geometry" / "world.json", dict(type="FeatureCollection", features=world))
    frames.append(ne[ne.key.isin(lookup)][["key", "geometry"]])
    allgeo = pd.concat(frames, ignore_index=True)
    bycountry, found, cache = defaultdict(list), set(), {}
    for r in allgeo.itertuples(index=False):
        if r.key not in lookup or r.key in found or r.geometry is None or r.geometry.is_empty:
            continue
        geom = simplify_local(shapely.make_valid(r.geometry), cache)
        if geom is None:
            continue
        u = lookup[r.key]
        found.add(r.key)
        bycountry[u.iso3].append(dict(type="Feature", id=r.key, properties=dict(
            id=r.key, country=u.iso3, name=u.unit_name, level=u.admin_level, tier=int(u.tier),
            members=num(u.n_members), base_year=num(u.base_year)), geometry=mapping(geom)))
    for iso, features in bycountry.items():
        write(out / "geometry" / f"{iso}.json", dict(type="FeatureCollection", features=features))
    audit = dict(matched=len(found), unmapped=sorted(set(lookup) - found), source_sha256=hashes,
                 simplification="700 m in a local azimuthal equal-area projection per polygon, topology preserved, coordinates to 1e-5 degrees (scripts/build_global_data.py); world outlines 0.025 degrees")
    return found, audit


def copy_geometry(src_release: str, out: Path):
    """Copy the geometry files of another release byte for byte (the same database, so the same boundaries) with its audit."""
    src = SITE_DATA / src_release
    sman = _loads_record((src / "manifest.json").read_text())
    (out / "geometry").mkdir(parents=True, exist_ok=True)
    for p in (out / "geometry").glob("*.json"):
        p.unlink()
    for p in sorted((src / "geometry").glob("*.json")):
        shutil.copyfile(p, out / "geometry" / p.name)
    found = {f["id"] for p in (out / "geometry").glob("*.json") if p.stem != "world" for f in _loads_record(p.read_text())["features"]}
    audit = dict(sman["geometry"], copied_from=dict(release=src_release, manifest_sha256=sha(src / "manifest.json")))
    return found, audit


# ---- main --------------------------------------------------------------------------------------------------------------
def main() -> None:
    global RL_COLS, RL_TEXT, RL_WITHHELD, AG_COLS
    ap = argparse.ArgumentParser()
    ap.add_argument("--release", default=(ENSO / "analysis/releases/crops/CURRENT").read_text().strip())
    ap.add_argument("--candidate", action="store_true", help="list the release as a candidate in releases.json and leave the default release unchanged")
    ap.add_argument("--skip-geometry", action="store_true", help="keep the geometry files already in site/data/<R>/geometry")
    ap.add_argument("--geometry-from", help="copy the geometry files of this earlier release instead of rebuilding them")
    ap.add_argument("--permissions", default=str(PERMISSIONS))
    ap.add_argument("--monthly-index", default=str(ATLAS / "monthly_indices.csv"), help="the monthly index table whose relative Nino 3.4 gives the anomaly layer's December-February value per harvest year")
    a = ap.parse_args()
    release = a.release
    started = time.monotonic()
    results = ENSO / "analysis/releases/crops" / release
    out = SITE_DATA / release
    rman = _loads_record((results / "manifest.json").read_text())
    assert rman["release"] == release, "results manifest names another release"
    corrected_intervals = rman.get('replicates',{}).get('method') == 'centered_year_blocks_plus_shrinkage_student_v1'
    if corrected_intervals:
        # Zero inclusion must not change when a small endpoint rounds to zero.
        # Formatting belongs in the UI; preserve the inference fields exactly.
        PRECISION['world.json.panels'] = None
        PRECISION['units.predictions'] = None
        PRECISION['world_units.json'] = None
        extra = ['slope_lo','slope_hi','slope_lo80','slope_hi80']
        RL_COLS = RL_COLS[:15] + extra + ['interval_method']
        RL_TEXT = ('variable','index','se_source','note','interval_method')
        RL_WITHHELD = RL_WITHHELD[:5] + extra
        AG_COLS = AG_COLS[:24] + ['pct_lo95','pct_hi95','dprod_lo95','dprod_hi95']
        if not a.candidate and not rman.get('uncertainty_calibration',{}).get('approved'):
            raise ValueError('Unconfirmed intervals may only be exported as an explicitly identified candidate.')
        if not a.candidate and not rman.get('monte_carlo_precision',{}).get('approved'):
            raise ValueError('Unresolved interval precision may only be exported as an explicitly identified candidate.')
    source_release = rman.get("source_release") or rman["database"].get("release", release)   # the database release the candidate reads
    source_results = ENSO / "analysis/releases/crops" / source_release
    # Relocate archived database paths before checking the current checkout.
    recorded_db = rman["database"]["path"]
    candidates = [_resolve_path(recorded_db)]
    if not Path(recorded_db).is_absolute():
        candidates += [_resolve_path(recorded_db, base=ENSO / "analysis/crops_baseline"),
                       ENSO / "data/releases" / Path(recorded_db).name]
    db_path = next((p for p in candidates if p.exists()), candidates[0])
    assert db_path.exists(), db_path
    db_sha = sha(db_path)
    assert db_sha == rman["database"]["sha256"], "the release database differs from the one the analysis read"
    perm_path = Path(a.permissions)
    perm = load_permissions(perm_path)

    # ---- results tables, with the fallback to the source release's folder ---------------------------------------
    tables = {}
    def table(name, required=True):
        for base, origin in ((results, "release"), (source_results, "source_release")):
            p = base / f"{name}.parquet"
            if p.exists() and (origin == "release" or name in FALLBACK_TABLES):
                tables[name] = dict(path=str(p.relative_to(ENSO)), sha256=sha(p), origin=origin, bytes=p.stat().st_size)
                return pd.read_parquet(p)
        if required:
            raise FileNotFoundError(f"{name}.parquet in {results} or {source_results}")
        tables[name] = dict(path=None, sha256=None, origin="absent", bytes=0)
        return None

    # ---- database: catalog, observations, exposures, QC, sources ----------------------------------------------------
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    series = pd.read_sql("SELECT series_id, unit_key, crop_code, season_std AS season, area_basis, source, tier, iso3, crop_family, "
                         "first_year, last_year, n_obs, series_key FROM series WHERE staple = 1", con)
    units = pd.read_sql("SELECT unit_key, tier, iso3, country, admin_level, unit_name, n_members, base_year, geometry_source, lon, lat FROM units", con)
    units = units[units.unit_key.isin(series.unit_key)].copy()
    regions = pd.read_sql("SELECT unit_key, region_key, region_name FROM unit_regions", con).drop_duplicates("unit_key").set_index("unit_key")
    region_names = regions.drop_duplicates("region_key").set_index("region_key").region_name.to_dict()
    obs = pd.read_sql("SELECT o.series_id, o.harvest_year, o.yield_t_ha FROM observations o JOIN series s USING (series_id) "
                      "WHERE s.staple = 1 AND o.yield_t_ha IS NOT NULL ORDER BY o.series_id, o.harvest_year", con)
    enso = pd.read_sql("SELECT e.series_id, e.harvest_year, e.n34_season, e.n34rel_season FROM enso_windows e JOIN series s USING (series_id) "
                       "WHERE s.staple = 1 ORDER BY e.series_id, e.harvest_year", con)
    qc = pd.read_sql("SELECT q.series_id, q.year_label, q.check_name, q.severity, q.note FROM qc_flags q JOIN series s USING (series_id) "
                     "WHERE s.staple = 1 ORDER BY q.series_id, q.year_label, q.check_name", con)
    db_sources = pd.read_sql("SELECT source_id, tier, name, citation, license, retrieved, location FROM sources", con)
    # Seasonal weather history per series: the complete seasons 1981-2025 of the two products the weather responses
    # were fitted on (best for temperature, chirps for rainfall; lib/responses.weather_sample), detrended below.
    ws = pd.read_sql("SELECT w.series_id, w.harvest_year, w.product, w.tavg_mean, w.precip FROM weather_season w JOIN series s USING (series_id) "
                     "WHERE s.staple = 1 AND w.frac_elapsed >= 0.999 AND w.product IN ('best', 'chirps') AND w.harvest_year BETWEEN 1981 AND 2025 "
                     "ORDER BY w.series_id, w.harvest_year", con)
    names = {r.iso3: country_name(r.iso3, r.country) for r in units.drop_duplicates("iso3").itertuples()}
    # Season greenness history (14 October 2026): the complete seasons of ndvi_season (NOAA STAR VHP, product vhp) with
    # coverage of at least 0.8; seasons before 2001 are provisional (AVHRR satellite steps) and drawn as open circles.
    has_ndvi = bool(pd.read_sql("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='ndvi_season'", con).n.iloc[0])
    ns = pd.read_sql("SELECT n.series_id, n.harvest_year, n.ndvi_mean, n.provisional FROM ndvi_season n JOIN series s USING (series_id) WHERE s.staple = 1 AND n.product = 'vhp' "
                     "AND n.frac_elapsed >= 0.999 AND n.coverage >= 0.8 AND n.ndvi_mean IS NOT NULL AND n.harvest_year BETWEEN 1981 AND 2025 ORDER BY n.series_id, n.harvest_year", con) if has_ndvi else None
    con.close()
    series["series_id"] = series.series_id.astype("int64")
    crop_family = series.drop_duplicates("crop_code").set_index("crop_code").crop_family.to_dict()
    staple_codes = set(crop_family)
    staple_ids = set(series.series_id)
    # The permission of every series: the entry id and whether its points may be shown.
    resolved = {(s, i): resolve_permission(perm, s, i) for s, i in series[["source", "iso3"]].drop_duplicates().itertuples(index=False)}
    series["permission"] = [resolved[(s, i)][0] for s, i in zip(series.source, series.iso3)]
    series["display_points"] = [bool(resolved[(s, i)][1]["display_points"]) for s, i in zip(series.source, series.iso3)]
    public_ids = set(series.loc[series.display_points, "series_id"])

    # ---- results ----------------------------------------------------------------------------------------------------
    rl = table("response_leaf"); rl = rl[rl.series_id.isin(staple_ids)]
    ag = table("aggregate"); ag = ag[ag.level.eq("world") | ag.crop_code.isin(staple_codes)]
    pp = table("prediction_panel"); pp = pp[pp.crop_code.isin(staple_codes)]
    pw = table("prediction_world")
    ps = table("prediction_series"); ps = ps[ps.series_id.isin(staple_ids)]
    wt = table("weights"); wt = wt[wt.series_id.isin(staple_ids)]
    ts = table("trend_series"); ts = ts[ts.series_id.isin(staple_ids)]
    ta = table("trend_anomaly"); ta = ta[ta.series_id.isin(staple_ids)]
    rp = table('enso_relationship_points', required=False)
    rp_cols = ['variable','index','harvest_year','exposure','anomaly']
    rp_by = {} if rp is None else {int(k):v[rp_cols].values.tolist() for k,v in rp[rp.series_id.isin(staple_ids)].groupby('series_id')}
    sp = table("scenario_index_path")
    pc = table("pooling_center", required=False)                    # the hierarchical state centers, for the state records
    cs = table("calendar_status"); cs = cs[cs.series_id.isin(staple_ids)].copy()
    cs["cycle_unresolved"] = cs.cycle.eq("both") | cs.confidence.eq("missing")
    sk = table("evaluation_skill", required=False)
    conditional = table('conditional_skill', required=False)
    joint = table('joint_regions', required=False)
    joint_by = {}
    if joint is not None:
        for row in joint.itertuples(index=False):
            key = (row.level, str(row.key), row.crop_code, row.season)
            joint_by.setdefault(key, []).append(json.loads(row.region_json))
    conditional_by={}
    if conditional is not None:
        for row in conditional.to_dict('records'):
            key=(row['level'],str(row['key']),row['crop_code'],row['season'])
            conditional_by.setdefault(key,[]).append({k:num(row[k]) for k in ['design','n','skill_eb','skill_local','skill_pooled']})
    wa = table("weather_todate_anomaly", required=False)
    na = table("ndvi_todate_anomaly", required=False)             # the greenness so far, product vhp (14 October 2026)
    wap = table("weather_todate_anomaly_panel", required=False)
    pwp = table("prediction_weather_panel", required=False)
    changes = _loads_record((results / "changes.json").read_text()) if (results / "changes.json").exists() else None
    key_of = lambda d: [panel_key(*k) for k in zip(d.iso3, d.crop_code, d.season)]

    # ---- seasonal weather history per series, detrended ---------------------------------------------------------------
    # The leaf fits regress each metric on a linear trend and the index (lib/responses.py), so the history a page draws
    # against the fitted line is the departure from the series' own linear trend over the same complete seasons.
    def detrend(frame, col):
        g = frame.dropna(subset=[col]).groupby("series_id")
        y = frame[col]; t = frame.harvest_year.astype(float)
        mt = g.harvest_year.transform("mean"); my = g[col].transform("mean")
        cov = ((t - mt) * (y - my)).groupby(frame.series_id).transform("sum"); var = ((t - mt) ** 2).groupby(frame.series_id).transform("sum")
        slope = (cov / var.where(var > 0)).fillna(0.0)
        return y - (my + slope * (t - mt))
    wsb = ws[ws["product"].eq("best")][["series_id", "harvest_year", "tavg_mean"]].copy(); wsb["tavg_anom"] = detrend(wsb, "tavg_mean")
    wsc = ws[ws["product"].eq("chirps")][["series_id", "harvest_year", "precip"]].copy(); wsc["precip_anom"] = detrend(wsc, "precip")
    wsh = wsb[["series_id", "harvest_year", "tavg_anom"]].merge(wsc[["series_id", "harvest_year", "precip_anom"]], on=["series_id", "harvest_year"], how="outer")
    if ns is not None and len(ns):
        # the greenness trend is fitted on the reference era (2001 on) and extrapolated to the provisional years
        ref = ns[ns.harvest_year >= 2001].copy(); ref["fit"] = ref.ndvi_mean - detrend(ref, "ndvi_mean")   # the fitted line on the reference years
        g = ref.groupby("series_id"); mt = g.harvest_year.mean(); my = g.ndvi_mean.mean()
        cov = ((ref.harvest_year - ref.series_id.map(mt)) * (ref.ndvi_mean - ref.series_id.map(my))).groupby(ref.series_id).sum(); var = ((ref.harvest_year - ref.series_id.map(mt)) ** 2).groupby(ref.series_id).sum()
        slope = (cov / var.where(var > 0)).fillna(0.0); n_ref = g.size()
        ns = ns[ns.series_id.isin(n_ref.index[n_ref >= 10])].copy()
        ns["ndvi_anom"] = ns.ndvi_mean - (ns.series_id.map(my) + ns.series_id.map(slope) * (ns.harvest_year - ns.series_id.map(mt)))
        wsh = wsh.merge(ns[["series_id", "harvest_year", "ndvi_anom", "provisional"]], on=["series_id", "harvest_year"], how="outer")
    else:
        wsh["ndvi_anom"] = np.nan; wsh["provisional"] = np.nan
    wsh = wsh.sort_values(["series_id", "harvest_year"])
    hist_by = {k: v[["harvest_year", "tavg_anom", "precip_anom", "ndvi_anom", "provisional"]].to_numpy() for k, v in wsh.groupby("series_id")}
    # ---- season-specific expectation of each weather metric: slope times the exposure of the series' window --------------
    # Exposure is the mean of the relative-index path over the months of the series' growing window for the harvest
    # year of its predictions: the central scenario for the season, and the observed months alone for the season to
    # date (scenario_index_path, calendar_status). The slope is the leaf's hierarchical estimate (response_leaf).
    path_med = {(int(r.year), int(r.month)): (float(r.value), int(r.observed)) for r in sp[sp["index"].eq("rel") & sp.scenario.eq("medium")].itertuples(index=False)}
    def window_months(plant, harvest):
        y0, m0 = int(plant[:4]), int(plant[5:7]); y1, m1 = int(harvest[:4]), int(harvest[5:7])
        out = []; y, m = y0, m0
        while (y, m) <= (y1, m1) and len(out) < 24:
            out.append((y, m)); m += 1
            if m > 12: y, m = y + 1, 1
        return out
    def exposures(plant, harvest):
        months = [path_med.get(k) for k in window_months(plant, harvest)]
        if not months or any(x is None for x in months):
            return None
        obs_ = [v for v, o in months if o == 1]
        return dict(exposure_central=float(np.mean([v for v, _ in months])), n_months=len(months),
                    exposure_todate=float(np.mean(obs_)) if obs_ else None, n_observed=len(obs_))
    pp = pp.assign(key=key_of(pp))
    agc = ag[ag.level.eq("country")].assign(key=key_of(ag[ag.level.eq("country")]))
    agc_rows = {(r["key"], r["method"], r["scenario"]): r for r in agc.to_dict("records")}
    agw = ag[ag.level.eq("world")]
    agw_rows = {(r["key"], r["method"], r["scenario"]): r for r in agw.to_dict("records")}
    panels = []
    for key, d in pp.groupby("key", sort=True):
        head = d[d.method.eq("index_outlook") & d.scenario.eq("medium")]
        assert len(head) == 1, f"{key}: {len(head)} medium index_outlook rows"
        h = head.iloc[0]
        c = agc_rows.get((key, "index_outlook", "medium"))
        assert c is not None, f"{key}: no aggregate country row for the medium outlook"
        dw = PRECISION["world.json.panels"]
        panels.append([key, h.iso3, h.crop_code, crop_family.get(h.crop_code), h.season, int(h.harvest_year), int(h.lead), text(h.status), int(h.n_series),
                       num(h.local_share, dw), num(h.production_mt, dw), num(h.pct, dw), num(h.lo, dw), num(h.hi, dw), num(h.se, dw), num(c["pct_lo_resp"], dw),
                       num(c["pct_hi_resp"], dw), num(c["dprod_mt_mean"], dw), num(c["dprod_lo"], dw), num(c["dprod_hi"], dw), int(c["n_leaves"])])
    panel_keys = {p[0] for p in panels}
    world_rows = []
    for r in pw.sort_values(["crop_family", "method", "scenario"]).to_dict("records"):
        w = agw_rows.get((r["crop_family"], r["method"], r["scenario"]))
        assert w is not None, f"world {r['crop_family']} {r['method']} {r['scenario']}: no aggregate world row"
        dw = PRECISION["world.json"]              # the world rows stay unrounded: tests/acceptance.py compares them exactly
        world_rows.append(dict(crop_family=r["crop_family"], issue=text(r["issue"]), method=r["method"], scenario=r["scenario"], target_year=int(w["target_year"]),
                               dprod_mt=num(r["dprod_mt"], dw), pct=num(r["pct"], dw), lo=num(r["lo"], dw), hi=num(r["hi"], dw), production_mt=num(r["production_mt"], dw),
                               coverage_share=num(r["coverage_share"], dw), lo_resp=num(w["pct_lo_resp"], dw), hi_resp=num(w["pct_hi_resp"], dw), dprod_lo=num(w["dprod_lo"], dw),
                               dprod_hi=num(w["dprod_hi"], dw), dprod_lo_resp=num(w["dprod_lo_resp"], dw), dprod_hi_resp=num(w["dprod_hi_resp"], dw), dprod_mt_point=num(w["dprod_mt_point"], dw),
                               pct_point=num(w["pct_point"], dw), covered_share=num(w["covered_share"], dw), n_leaves=int(w["n_leaves"]), footprint_id=text(w["footprint_id"])))
    world = dict(release=release, contract=CONTRACT, candidate=bool(a.candidate), source_release=source_release, headline=rman.get("headline"),
                 model_version=rman.get("model_version"), index=rman["index"], issue=rman["issue"], data_end=rman["data_end"], index_last_month=rman["index_last_month"],
                 columns=dict(panels=WP_COLS),
                 keys=dict(panels="one row per panel: the medium index_outlook row of prediction_panel (harvest_year, lead, status, n_series, local_share, "
                                  "baseline_production_mt = production_mt, pct, lo, hi as the 80 percent prediction interval, se) with the aggregate country row's "
                                  "response-only interval (lo_resp, hi_resp = pct_lo_resp, pct_hi_resp), production change (dprod_mt = dprod_mt_mean, dprod_lo, dprod_hi) "
                                  "and n_leaves; the exact values and the remaining fields are in countries/<ISO>.json",
                           world="prediction_world rows with the aggregate world row's response-only interval and production-change fields"),
                 panels=panels, world=world_rows,
                 index_path=rows(sp.sort_values(["index", "scenario", "year", "month"]), ["issue", "scenario", "index", "year", "month", "value", "observed"], PRECISION["world.json"],
                                 text_cols=("issue", "scenario", "index"), int_cols=("year", "month", "observed")),
                 changes=None if changes is None else dict(previous=changes.get("previous"), previous_kind=changes.get("previous_kind"),
                                                           counts=changes.get("summary", {}).get("counts"), causes=changes.get("summary", {}).get("causes")))
    if corrected_intervals:
        world['keys']['panels']='One medium ENSO-outlook row per country, crop and season. The fitted point contrast uses the ENSO-neutral baseline. lo/hi span the central 80% conditional ENSO-effect range; lo_resp/hi_resp vary response coefficients only. Full-harvest residual uncertainty is excluded. Detailed aggregate rows also carry the central 95% range.'
        world['keys']['world']='Production-weighted contrasts on covered reporting support. Ranges are computed after summing shared response fields; no addition of local interval endpoints.'
    write(out / "world.json", world)

    # ---- calendar_world.json: a national calendar per panel --------------------------------------------------------
    published_range = [str(cs.plant_date.dropna().min()), str(cs.harvest_date.dropna().max())]
    harvest_years = sorted(int(y) for y in cs.harvest_year.unique())
    national = series[series.unit_key.eq(series.iso3)]
    nat_by_iso = by_key(national, "iso3")
    cs_by = by_key(cs, "series_id")
    cal_world, cal_match = {}, defaultdict(int)
    for key in sorted(panel_keys):
        iso, crop, season = key.split("|")
        cands = nat_by_iso.get(iso)
        if cands is None:
            continue
        fam = crop_family[crop]
        scored = [((s.crop_code == crop) + (s.crop_code == crop and s.season == season), int(s.n_obs), -int(s.series_id), s) for s in cands.itertuples(index=False)
                  if s.crop_family == fam]
        if not scored:
            continue
        score, _, _, s = max(scored, key=lambda x: x[:3])
        match = {2: "crop+season", 1: "crop", 0: "family"}[score]
        cal_match[match] += 1
        rows_cs = cs_by.get(int(s.series_id))
        if rows_cs is None:
            continue
        cal_world[key] = [[int(r.harvest_year), str(int(s.series_id)), s.unit_key, s.crop_code, s.season, match] + r_[1:]
                          for r, r_ in zip(rows_cs.sort_values("harvest_year").itertuples(index=False),
                                           rows(rows_cs.sort_values("harvest_year"), CS_COLS, None, text_cols=CS_TEXT, int_cols=("harvest_year",), bool_cols=("cycle_unresolved",), as_list=True))]
    write(out / "calendar_world.json", dict(
        release=release, contract=CONTRACT, published_range=published_range, harvest_years=harvest_years, columns=CW_COLS,
        keys=dict(panels="for every panel of world.json, the calendar_status rows (one per harvest year) of the country's national series of the panel's crop and "
                         "season, else of its crop, else of its crop family (`match` says which; the series with the most observations wins a tie); "
                         "cycle_unresolved is cycle == 'both' or confidence == 'missing'"),
        match_counts=dict(cal_match), panels=cal_world))

    # ---- skill.json: country-level hindcast skill ----------------------------------------------------------------
    skill, n_skill = {}, 0
    if sk is not None:
        skc = sk[sk.level.eq("country") & sk.crop_code.isin(staple_codes)].assign(key=lambda d: key_of(d))
        for c in SK_COLS:                      # columns the hindcast worker adds (train_years, info_cutoff, ...) are null until the table carries them
            if c not in skc.columns:
                skc[c] = None
        for key, d in skc.sort_values(["method", "lead"]).groupby("key", sort=True):
            skill[key] = rows(d, SK_COLS, PRECISION["skill.json"], text_cols=SK_TEXT, int_cols=SK_INT, as_list=True); n_skill += len(skill[key])
    write(out / "skill.json", dict(release=release, contract=CONTRACT, level="country", columns=SK_COLS, panels=skill))

    # ---- countries/<ISO>.json: panels with every prediction and aggregate row, state aggregates ---------------------
    agr = ag[ag.level.eq("region")]
    agr_by = by_key(agr, "iso3"); agc_by = by_key(agc, "key"); pp_by = by_key(pp, "key")
    if wap is not None:
        wap = wap.assign(key=key_of(wap)); wap = wap[wap.key.isin(panel_keys)].set_index("key")
    if pwp is not None:
        pwp = pwp.assign(key=key_of(pwp)); pwp = pwp[pwp.key.isin(panel_keys)].set_index("key")
    def panel_weather(row):
        rec = rows(row.to_frame().T, WAP_HEAD, None, text_cols=("issue", "data_end", "verdict"), int_cols=("harvest_year", "n_series", "n_years", "metrics_with_signal", "metrics_concordant"))[0]
        rec["metrics"] = {m: {f: (text(row[f"{m}_{f}"]) if f == "product" else num(row[f"{m}_{f}"])) for f in PANEL_WEATHER_FIELDS} for m in WEATHER_METRICS}
        return rec
    n_regions = n_country_rows = n_wap = n_pwp = 0
    for iso in sorted(set(series.iso3)):
        cpanels = []
        for key in sorted(k for k in panel_keys if k.startswith(iso + "|")):
            d = pp_by[key]; h = d[d.method.eq("index_outlook") & d.scenario.eq("medium")].iloc[0]
            crows = agc_by.get(key, agc.iloc[0:0])
            wrow = pwp.loc[key] if pwp is not None and key in pwp.index else None
            cpanels.append(dict(
                key=key, iso3=iso, crop_code=h.crop_code, crop_family=crop_family.get(h.crop_code), season=h.season, label=panel_label(names.get(iso, iso), h.crop_code, h.season),
                harvest_year=int(h.harvest_year), status=text(h.status), n_series=int(h.n_series), baseline_production_mt=num(h.production_mt),
                predictions=rows(d.sort_values(["method", "scenario"]), PP_COLS, None, text_cols=("method", "scenario", "issue", "status"), int_cols=("harvest_year", "n_series", "lead"), as_list=True),
                aggregate=rows(crows.sort_values(["method", "scenario"]), AG_COLS, None, text_cols=AG_TEXT, int_cols=AG_INT, as_list=True),
                season_weather=panel_weather(wap.loc[key]) if wap is not None and key in wap.index else None,
                weather=None if wrow is None else dict(lead=int(wrow.lead), pct_panel=num(wrow.pct_panel), se_panel=num(wrow.se_panel), usable_panel=bool(wrow.usable_panel),
                                                         coverage_share=num(wrow.coverage_share), frac_started=num(wrow.frac_started), skill_vs_trend=num(wrow.skill_vs_trend),
                                                         n_series=int(wrow.n_series), metrics=str(wrow.metrics).split(","))))
            n_country_rows += len(cpanels[-1]["aggregate"]); n_wap += cpanels[-1]["season_weather"] is not None; n_pwp += wrow is not None
        g = agr_by.get(iso, agr.iloc[0:0]).assign(region_name=lambda d: d.key.map(region_names))
        reg = rows(g.sort_values(["key", "crop_code", "season", "method", "scenario"]), ["key", "region_name", "crop_code", "season"] + AG_COLS, None,
                   text_cols=("key", "region_name", "crop_code", "season") + AG_TEXT, int_cols=AG_INT, as_list=True)
        n_regions += len(reg)
        write(out / "countries" / f"{iso}.json", dict(
            release=release, contract=CONTRACT, iso3=iso, name=names.get(iso, iso), panels=cpanels,
            columns=dict(predictions=PP_COLS, aggregate=AG_COLS, regions=["region_key", "region_name", "crop_code", "season"] + AG_COLS),
            keys=dict(predictions="rows of prediction_panel for the panel, in column order", aggregate="rows of aggregate at level country for the panel, in column order",
                      regions="rows of aggregate at level region for every state of the country, with the state's name from unit_regions; the displayed state value, "
                              "a production-weighted aggregate of its leaves, never a pooling center"),
            regions=reg))

    # ---- units/<ISO>.json and records/<ISO>/<unit>.json ------------------------------------------------------------
    d_units, d_rec = PRECISION["units"], PRECISION["records"]
    rl_ly = rl[rl.variable.eq("ly")]; rl_env = rl[rl.variable.ne("ly")]
    rl_by = by_key(rl_ly, "series_id"); env_by = by_key(rl_env, "series_id")
    ps_by = by_key(ps, "series_id"); wt_by = {int(r["series_id"]): r for r in wt.to_dict("records")}
    wa_by = by_key(wa, "series_id") if wa is not None else {}
    na_by = by_key(na, "series_id") if na is not None else {}
    ts_by = {int(r.series_id): r for r in ts.itertuples(index=False)}
    ta_by = {k: v[["harvest_year", "yield_t_ha", "fitted_yield", "anomaly_pct"]].to_numpy() for k, v in ta.groupby("series_id")}
    obs_by = {k: v[["harvest_year", "yield_t_ha"]].to_numpy() for k, v in obs.groupby("series_id")}
    enso_by = {k: v[["harvest_year", "n34_season", "n34rel_season"]].to_numpy() for k, v in enso.groupby("series_id")}
    qc_by = {k: v[["year_label", "check_name", "severity", "note"]].to_numpy() for k, v in qc.groupby("series_id")}
    def series_weather(frame):
        res = []
        for r in frame.sort_values("product").itertuples(index=False):
            rec = rows(frame[frame["product"].eq(r.product)], WA_HEAD, d_units, text_cols=("product", "issue", "data_end"), int_cols=("harvest_year", "elapsed_days"))[0]
            rec["ndvi_coverage"] = None
            rec["metrics"] = {m: [num(getattr(r, f"{m}_{f}"), d_units) for f in WEATHER_FIELDS] for m in WEATHER_METRICS
                              if any(num(getattr(r, f"{m}_{f}")) is not None for f in WEATHER_FIELDS)}
            res.append(rec)
        return res
    def series_ndvi(frame):
        """The greenness so far as a weather row of product vhp with the one metric ndvi_mean, four decimals."""
        res = []
        for r in frame.itertuples(index=False):
            rec = dict(product="vhp", issue=text(r.issue), data_end=text(r.data_end), harvest_year=int(r.harvest_year), frac_elapsed=num(r.frac_elapsed, d_units),
                       elapsed_days=None if missing(r.elapsed_days) else int(r.elapsed_days), t_coverage=None, p_coverage=None, ndvi_coverage=num(r.ndvi_coverage, d_units))
            vals = [num(getattr(r, f"ndvi_mean_{f}"), 4) for f in WEATHER_FIELDS]
            if any(v is not None for v in vals):
                rec["metrics"] = {"ndvi_mean": vals}; res.append(rec)
        return res
    def weather_expected(env, pred, cal):
        """Per weather variable with a hierarchical slope: the exposure of the series' window under the central path and
        over the observed months, and the slope times each (the season's expected departure, and the departure expected
        from the index so far); null where the series has no prediction harvest year, no calendar row or no slope."""
        if env is None or pred is None or cal is None:
            return {}
        hy = pred.harvest_year.max(); row = cal[cal.harvest_year.eq(hy)]
        if row.empty or missing(row.iloc[0].plant_date) or missing(row.iloc[0].harvest_date):
            return {}
        ex = exposures(str(row.iloc[0].plant_date), str(row.iloc[0].harvest_date))
        if ex is None:
            return {}
        out = {}
        for r in env[env["index"].eq("rel")].itertuples(index=False):
            if r.note == "no_own_slope" or missing(r.slope_eb):
                continue
            out[r.variable] = [int(hy), num(ex["exposure_central"], d_rec), num(r.slope_eb * ex["exposure_central"], d_rec), ex["n_months"],
                               num(ex["exposure_todate"], d_rec), None if ex["exposure_todate"] is None else num(r.slope_eb * ex["exposure_todate"], d_rec), ex["n_observed"]]
        return out
    def response_rows(frame, d):
        """response_leaf rows in column order; a row whose note is no_own_slope has its hierarchical fields withheld (the
        leaf has no own slope, so its estimate would be its pooling center, which is never displayed as a response)."""
        res = rows(frame.sort_values(["variable", "index"]), RL_COLS, d, text_cols=RL_TEXT, int_cols=RL_INT)
        for r in res:
            if r["note"] == "no_own_slope":
                for c in RL_WITHHELD:
                    r[c] = None
        return [[r[c] for c in RL_COLS] for r in res]
    counts = dict(series=0, series_public=0, series_restricted=0, observations=0, observations_withheld=0, trend_rows=0, trend_rows_withheld=0, enso_rows=0, qc_rows=0,
                  responses_ly=0, responses_env=0, responses_withheld=0, predictions=0, calendar_rows=0, weights=0, weather_rows=0, record_files=0,
                  state_records=0, state_record_files=0)
    wx_cache = {}
    rec_columns = dict(obs=["harvest_year", "yield_t_ha"], trend=TS_COLS, trend_anomaly=["harvest_year", "yield_t_ha", "fitted_yield", "anomaly_pct"],
                       enso=["harvest_year", "n34_season", "n34rel_season"], qc=["year_label", "check_name", "severity", "note"], responses=RL_COLS,
                       weather=WA_HEAD + ["ndvi_coverage"], weather_metrics=WEATHER_FIELDS, weather_history=["harvest_year", "tavg_anom", "precip_anom", "ndvi_anom", "ndvi_provisional"],
                       weather_expected=["harvest_year", "exposure_central", "expected_central", "n_months", "exposure_todate", "expected_todate", "n_observed"])
    if corrected_intervals:
        rec_columns['relationship_history']=['variable','index','harvest_year','exposure','anomaly']
    # ---- state records (10 October 2026) -------------------------------------------------------------------------------
    # A state page shows the three charts a unit page shows, so every state with two or more reporting units gets a
    # record in the shape of a unit's. The yield is the mean of the units' reported yields weighted by the harvested
    # area the weights table gives each unit's series (the units reporting that year, at least two and a quarter of the
    # state's units), with a log-linear trend fitted to that mean series as lib/aggregate.series_trends fits a unit's.
    # The season temperature and rainfall histories, the season so far and the expected departures from ENSO are the
    # same weighted means of the units' values, and the ENSO exposure the weighted mean of their window exposures. The
    # Reconciled releases display the sum of local production contrasts. Older releases
    # retain their state-center curve for exact reproduction. State records are derived
    # aggregates under the source publication rules.
    pc_by = {}
    if pc is not None:
        for r in pc[pc.level.eq("region") & pc.variable.eq("ly") & pc["index"].eq("rel")].itertuples(index=False):
            pc_by[(r.key, r.crop_code, r.season)] = r
    MIN_TREND_YEARS, T0 = 10, 2000.0
    ENV_VARS = ("tavg_mean", "tmax_p95_days", "precip", "wet_days", "ndvi_mean")
    # forbidden_pairs holds every (year, yield) a withheld series reports anywhere, at the four decimals the numerics
    # test scans the site files for, and a state-average year equal to one is left out: the districts of an Indian
    # state often carry one state figure, a unit's second series can repeat its first, and a mean can coincide with a
    # withheld value of another country at four decimals, which the scan would count as a leak all the same.
    forbidden_pairs = {(int(y), round(float(v), 4)) for s in series.itertuples(index=False) if not s.display_points
                       for y, v in obs_by.get(int(s.series_id), []) if v is not None and not (isinstance(v, float) and math.isnan(v))}
    def wmean_by_year(arrays, col, weights, min_n):
        """{year: (weighted mean, n)} over series arrays whose row 0 is the year; years with fewer than min_n values left out."""
        acc = defaultdict(lambda: [0.0, 0.0, 0])
        for sid, arr in arrays:
            w = weights[sid]
            for row in arr:
                v = row[col]
                if v is None or (isinstance(v, float) and math.isnan(v)):
                    continue
                a = acc[int(row[0])]; a[0] += w * float(v); a[1] += w; a[2] += 1
        return {y: (a[0] / a[1], a[2]) for y, a in acc.items() if a[2] >= min_n and a[1] > 0}
    def state_record(members, crop, season, rk):
        sids = [int(s.series_id) for s in members.values()]
        w0 = {sid: float(wt_by[sid]["area_ha"]) for sid in sids if sid in wt_by and not missing(wt_by[sid]["area_ha"]) and float(wt_by[sid]["area_ha"]) > 0}
        fill = float(np.median(list(w0.values()))) if w0 else 1.0
        w = {sid: w0.get(sid, fill) for sid in sids}
        n_units = len(sids); min_n = max(2, math.ceil(0.25 * n_units))
        # The mean yield per year over the units reporting it. A year whose mean equals a withheld member's reported
        # yield (the districts of an Indian state often carry one state figure) is left out, so the average never
        # restates an observation the publication rule withholds.
        acc = defaultdict(lambda: [0.0, 0.0, []])
        for sid in sids:
            for row in obs_by.get(sid, []):
                v = row[1]
                if v is None or (isinstance(v, float) and math.isnan(v)):
                    continue
                a = acc[int(row[0])]; a[0] += w[sid] * float(v); a[1] += w[sid]; a[2].append((sid, float(v)))
        ybar = {}
        for y, a in acc.items():
            if len(a[2]) < min_n or a[1] <= 0:
                continue
            m = a[0] / a[1]
            if (y, round(m, 4)) in forbidden_pairs:
                continue
            ybar[y] = (m, len(a[2]))
        years = sorted(ybar); obs_rows = [[y, num(ybar[y][0], d_rec)] for y in years]
        trend = None; anomaly = []; pos = [y for y in years if ybar[y][0] > 0]
        if len(pos) >= MIN_TREND_YEARS:
            t = np.array(pos, float) - T0; ly = np.log([ybar[y][0] for y in pos])
            slope = float(((t - t.mean()) * (ly - ly.mean())).sum() / ((t - t.mean()) ** 2).sum()); icpt = float(ly.mean() - slope * t.mean())
            trend = dict(year_first=pos[0], year_last=pos[-1], n_years=len(pos), trend_pct_per_year=num(100 * math.expm1(slope), d_rec), intercept=num(icpt, d_rec))
            for y in pos:
                f = math.exp(icpt + slope * (y - T0)); anomaly.append([y, num(ybar[y][0], d_rec), num(f, d_rec), num(100 * (ybar[y][0] / f - 1), d_rec)])
        ens = [(sid, enso_by[sid]) for sid in sids if sid in enso_by]
        ex, exr = wmean_by_year(ens, 1, w, 1), wmean_by_year(ens, 2, w, 1)
        enso_rows = [[y, num(ex[y][0], PRECISION["records.enso"]) if y in ex else None, num(exr[y][0], PRECISION["records.enso"]) if y in exr else None] for y in sorted(set(ex) | set(exr))]
        hs = [(sid, hist_by[sid]) for sid in sids if sid in hist_by]
        th, ph, nh = wmean_by_year(hs, 1, w, min_n), wmean_by_year(hs, 2, w, min_n), wmean_by_year(hs, 3, w, min_n)
        hist_rows = [[y, num(th[y][0], d_rec) if y in th else None, num(ph[y][0], d_rec) if y in ph else None, num(nh[y][0], 4) if y in nh else None, (1 if y < 2001 else 0) if y in nh else None]
                     for y in sorted(set(th) | set(ph) | set(nh))]
        resp_rows = []
        for v in ENV_VARS:
            rows_v = [(sid, r) for sid in sids if sid in env_by
                      for r in env_by[sid][env_by[sid].variable.eq(v) & env_by[sid]["index"].eq("rel") & env_by[sid].note.ne("no_own_slope")].itertuples(index=False) if not missing(r.slope_eb)]
            if not rows_v:
                continue
            W = sum(w[sid] for sid, _ in rows_v); slope = sum(w[sid] * float(r.slope_eb) for sid, r in rows_v) / W
            se = math.sqrt(sum((w[sid] * float(r.se_eb)) ** 2 for sid, r in rows_v if not missing(r.se_eb))) / W
            resp_rows.append(dict(variable=v, index="rel", n_years=int(np.median([r.n_years for _, r in rows_v])), year_first=int(min(r.year_first for _, r in rows_v)),
                                  year_last=int(max(r.year_last for _, r in rows_v)), slope_own=None, se_own=None, se_source="members_mean",
                                  slope_eb=num(slope, PRECISION["records.responses"]), se_eb=num(se, PRECISION["records.responses"]), own_data_weight=None,
                                  pct_eb=None, lo_eb=None, hi_eb=None, note=f"area-weighted mean of {len(rows_v)} units"))
        cen = None if corrected_intervals else pc_by.get((rk, crop, season))
        if cen is not None and not missing(cen.center):
            se = None if missing(cen.se_center) else float(cen.se_center); b = float(cen.center)
            resp_rows.append(dict(variable="ly", index="rel", n_years=None, year_first=None, year_last=None, slope_own=None, se_own=None, se_source="pooling_center",
                                  slope_eb=num(b, PRECISION["records.responses"]), se_eb=num(se, PRECISION["records.responses"]), own_data_weight=None,
                                  pct_eb=num(100 * math.expm1(b), d_rec), lo_eb=None if se is None else num(100 * math.expm1(b - 1.96 * se), d_rec),
                                  hi_eb=None if se is None else num(100 * math.expm1(b + 1.96 * se), d_rec),
                                  note=f"state center of {int(cen.n_members)} members" + (f"; {cen.note}" if isinstance(cen.note, str) and cen.note else "")))
        wrows = []
        for product in ("best", "chirps", "cpc"):
            mem = [(sid, wa_by[sid][wa_by[sid]["product"].eq(product)]) for sid in sids if sid in wa_by]; mem = [(sid, f.iloc[0]) for sid, f in mem if len(f)]
            if len(mem) < min_n:
                continue
            def wm(col):
                have = [(sid, float(r[col])) for sid, r in mem if not missing(r[col])]
                return sum(w[sid] * v for sid, v in have) / sum(w[sid] for sid, _ in have) if have else None
            rec = dict(product=product, issue=text(mem[0][1].issue), data_end=max(text(r.data_end) for _, r in mem), harvest_year=int(mem[0][1].harvest_year),
                       frac_elapsed=num(wm("frac_elapsed"), d_units), elapsed_days=None if wm("elapsed_days") is None else int(round(wm("elapsed_days"))),
                       t_coverage=num(wm("t_coverage"), d_units), p_coverage=num(wm("p_coverage"), d_units), ndvi_coverage=None)
            metrics = {}
            for m in WEATHER_METRICS:
                vals = [num(wm(f"{m}_{f}"), d_units) for f in ("value", "reference", "anom", "z")]
                if all(v is None for v in vals):
                    continue
                ny = [int(r[f"{m}_n_years"]) for _, r in mem if not missing(r[f"{m}_n_years"])]
                metrics[m] = vals + [None, min(ny) if ny else None]       # percentiles do not average
            rec["metrics"] = metrics; wrows.append(rec)
        mem = [(sid, na_by[sid]) for sid in sids if sid in na_by]; mem = [(sid, f.iloc[0]) for sid, f in mem if len(f)]
        if len(mem) >= min_n:
            def wm_n(col):
                have = [(sid, float(r[col])) for sid, r in mem if not missing(r[col])]
                return sum(w[sid] * v for sid, v in have) / sum(w[sid] for sid, _ in have) if have else None
            vals = [num(wm_n(f"ndvi_mean_{f}"), 4) for f in ("value", "reference", "anom", "z")]
            if not all(v is None for v in vals):
                ny = [int(r["ndvi_mean_n_years"]) for _, r in mem if not missing(r["ndvi_mean_n_years"])]
                wrows.append(dict(product="vhp", issue=text(mem[0][1].issue), data_end=max(text(r.data_end) for _, r in mem), harvest_year=int(mem[0][1].harvest_year),
                                  frac_elapsed=num(wm_n("frac_elapsed"), d_units), elapsed_days=None if wm_n("elapsed_days") is None else int(round(wm_n("elapsed_days"))),
                                  t_coverage=None, p_coverage=None, ndvi_coverage=num(wm_n("ndvi_coverage"), d_units), metrics={"ndvi_mean": vals + [None, min(ny) if ny else None]}))
        wx = {}
        for v in ENV_VARS:
            mem = [(sid, wx_cache[sid][v]) for sid in sids if sid in wx_cache and v in wx_cache[sid]]
            if not mem:
                continue
            def f(i):
                have = [(sid, a[i]) for sid, a in mem if a[i] is not None]
                return sum(w[sid] * x for sid, x in have) / sum(w[sid] for sid, _ in have) if have else None
            a0 = mem[0][1]
            wx[v] = [a0[0], num(f(1), d_rec), num(f(2), d_rec), a0[3], num(f(4), d_rec), num(f(5), d_rec), a0[6]]
        # A statistical pooling center is not a displayed production-weighted response.
        components=[]
        component_series=[]
        components_by_index={'rel':components,'std':[]}
        component_series_by_index={'rel':component_series,'std':[]}
        pool_only_by_index={'rel':[],'std':[]}
        relation=[]
        if corrected_intervals:
            production_weights={}
            for sid in sids:
                weight=wt_by.get(sid,{})
                base=weight.get('baseline_production_t')
                if not weight.get('covered') or missing(base) or base<=0 or sid not in rl_by:
                    continue
                for row in rl_by[sid].itertuples(index=False):
                    if row.index in components_by_index and not missing(row.slope_eb):
                        components_by_index[row.index].append([float(row.slope_eb),float(base)])
                        component_series_by_index[row.index].append(str(sid))
                        if row.note=='no_own_slope':pool_only_by_index[row.index].append(str(sid))
                        if row.index=='rel':production_weights[sid]=float(base)
            # Each point retains the available members for that year. Mean exposure is
            # descriptive; the curve evaluates all covered members at a common exposure.
            accum=defaultdict(lambda:[0.,0.,0.,0])
            for sid in sids:
                for variable,index,year,exposure,value in rp_by.get(sid,[]):
                    weight=production_weights.get(sid,0.) if variable=='ly' else w[sid]
                    if weight<=0 or missing(exposure) or missing(value):continue
                    vals=accum[(variable,index,int(year))]
                    vals[0]+=weight*float(exposure);vals[1]+=weight*float(value)
                    vals[2]+=weight;vals[3]+=1
            relation=[[v,i,y,num(a[0]/a[2],PRECISION['records.enso']),num(a[1]/a[2],d_rec)]
                      for (v,i,y),a in sorted(accum.items()) if a[3]>=min_n and a[2]>0]
            for row in resp_rows:
                # No independence assumption for the uncertainty of spatial means.
                row['se_eb']=None
                row['interval_method']='aggregate interval not estimated here; outlook uses shared fields'
        return dict(crop_code=crop, season=season, permission="derived", display_points=True, withheld=None, level="state", n_units=n_units, units=sorted(members),
                    weights="area_ha of the weights table; the median of the state's units where a unit's series has none", min_units_per_year=min_n,
                    obs=obs_rows, trend=trend, trend_anomaly=anomaly, enso=enso_rows, qc=None,
                    responses=[[r.get(c) for c in RL_COLS] for r in resp_rows], weather=wrows, weather_history=hist_rows, weather_expected=wx,
                    yield_response_components=components,
                    yield_response_series=component_series,
                    yield_response_components_by_index=components_by_index,
                    yield_response_series_by_index=component_series_by_index,
                    **({'yield_response_pool_only_series_by_index':pool_only_by_index} if any(pool_only_by_index.values()) else {}),
                    conditional_skill=conditional_by.get(('region',rk,crop,season),[]),
                    **({'joint_regions':joint_by.get(('region',rk,crop,season),[])} if joint is not None else {}),
                    **({'relationship_history':relation} if corrected_intervals else {}))
    # CROPGRIDS harvested area per unit and family (11 October 2026): from the crosswalk step's crop_area_units.csv,
    # [hectares, share of the unit's land] per family, for the notes of a place and the "Cropped area" tooltips.
    ca_path = ENSO / "data/processed/weather/crop_area_units.csv"; crop_area = {}
    if ca_path.exists():
        for r in pd.read_csv(ca_path).itertuples(index=False):
            if r.family in STAPLES and r.harvested_ha == r.harvested_ha:
                crop_area.setdefault(r.unit_key, {})[r.family] = [num(r.harvested_ha, 0), num(r.share, 4)]
    for iso, su in series.groupby("iso3", sort=True):
        urec = {}; shards = {}
        for u in units[units.iso3.eq(iso)].itertuples(index=False):
            reg = regions.loc[u.unit_key] if u.unit_key in regions.index else None
            urec[u.unit_key] = dict(name=u.unit_name, level=u.admin_level, tier=int(u.tier),
                                    region_key=None if reg is None else text(reg.region_key), region_name=None if reg is None else text(reg.region_name),
                                    lon=num(u.lon), lat=num(u.lat), crop_area=crop_area.get(u.unit_key), series=[])
            shards[u.unit_key] = {}
        for s in su.sort_values(["unit_key", "crop_code", "season", "area_basis", "source"]).itertuples(index=False):
            sid = int(s.series_id); public = bool(s.display_points)
            o = obs_by.get(sid); t = ts_by.get(sid); tfit = ta_by.get(sid); ex = enso_by.get(sid); q = qc_by.get(sid)
            resp = rl_by.get(sid); env = env_by.get(sid); pred = ps_by.get(sid); cal = cs_by.get(sid); w = wt_by.get(sid); wrow = wa_by.get(sid); nrow = na_by.get(sid)
            withheld = None if public else f"observations withheld under the publication rule: {s.permission} permits no display of points"
            wx_s = weather_expected(env, pred, cal); wx_cache[sid] = wx_s
            shards[s.unit_key][str(sid)] = dict(
                crop_code=s.crop_code, season=s.season, permission=s.permission, display_points=public, withheld=withheld,
                obs=None if not public else ([] if o is None else [[int(y), num(v, d_rec)] for y, v in o]),
                trend=None if t is None else dict(year_first=int(t.year_first), year_last=int(t.year_last), n_years=int(t.n_years),
                                                  trend_pct_per_year=num(t.trend_pct_per_year, d_rec), intercept=num(t.intercept, d_rec)),
                trend_anomaly=None if not public else ([] if tfit is None else [[int(y), num(v, d_rec), num(f, d_rec), num(a_, d_rec)] for y, v, f, a_ in tfit]),
                enso=[] if ex is None else [[int(y), num(a_, PRECISION["records.enso"]), num(b, PRECISION["records.enso"])] for y, a_, b in ex],
                qc=None if not public else ([] if q is None else [[num(y), text(c), text(sv), text(n)] for y, c, sv, n in q]),
                responses=[] if env is None else response_rows(env, PRECISION["records.responses"]),
                weather=([] if wrow is None else series_weather(wrow)) + ([] if nrow is None else series_ndvi(nrow)),
                weather_history=[] if hist_by.get(sid) is None else [[int(y), num(ta_, d_rec), num(pa_, d_rec), num(na_, 4), None if (pv is None or (isinstance(pv, float) and math.isnan(pv))) else int(pv)]
                                                                      for y, ta_, pa_, na_, pv in hist_by[sid]],
                weather_expected=wx_s)
            shards[s.unit_key][str(sid)]['conditional_skill']=conditional_by.get(('unit',str(sid),s.crop_code,s.season),[])
            if joint is not None:
                shards[s.unit_key][str(sid)]['joint_regions']=joint_by.get(('unit',str(sid),s.crop_code,s.season),[])
            if rp is not None:
                shards[s.unit_key][str(sid)]['relationship_history'] = [
                    [v,i,int(y),num(x,PRECISION['records.enso']),num(z,d_rec)]
                    for v,i,y,x,z in rp_by.get(sid,[]) if public or v!='ly']
            if public:
                counts["observations"] += 0 if o is None else len(o); counts["trend_rows"] += 0 if tfit is None else len(tfit); counts["qc_rows"] += 0 if q is None else len(q)
            else:
                counts["observations_withheld"] += 0 if o is None else len(o); counts["trend_rows_withheld"] += 0 if tfit is None else len(tfit)
            counts["enso_rows"] += 0 if ex is None else len(ex); counts["responses_env"] += 0 if env is None else len(env)
            rec = dict(id=str(sid), crop_code=s.crop_code, crop_family=s.crop_family, season=s.season, basis=s.area_basis, source=s.source, permission=s.permission,
                       display_points=public, tier=int(s.tier), first=num(s.first_year), last=num(s.last_year), n=num(s.n_obs),
                       responses=[] if resp is None else response_rows(resp, PRECISION["units.responses"]),
                       predictions=[] if pred is None else rows(pred.sort_values(["method", "scenario"]), PS_COLS, PRECISION.get('units.predictions',d_units), text_cols=("method", "scenario", "issue"),
                                                                 int_cols=("harvest_year", "lead", "beyond_fit"), bool_cols=("usable",), as_list=True),
                       calendar=[] if cal is None else rows(cal.sort_values("harvest_year"), CS_COLS, None, text_cols=CS_TEXT, int_cols=("harvest_year",), bool_cols=("cycle_unresolved",), as_list=True),
                       weight=None if w is None else rows(pd.DataFrame([w]), W_COLS, d_units, text_cols=W_TEXT, int_cols=W_INT, bool_cols=("covered",), as_list=True)[0])
            counts["series"] += 1; counts["series_public" if public else "series_restricted"] += 1
            counts["responses_ly"] += len(rec["responses"]); counts["responses_withheld"] += 0 if resp is None else int(resp.note.eq("no_own_slope").sum())
            counts["predictions"] += len(rec["predictions"]); counts["calendar_rows"] += len(rec["calendar"]); counts["weights"] += w is not None
            counts["weather_rows"] += 0 if wrow is None else len(wrow)
            urec[s.unit_key]["series"].append(rec)
        index = {}
        files = {shard_name(k) for k in shards}
        assert len(files) == len(shards), f"{iso}: shard names collide"
        for ukey, srec in shards.items():
            name = shard_name(ukey)
            size = write(out / "records" / iso / name, dict(
                release=release, contract=CONTRACT, iso3=iso, unit_key=ukey, name=urec[ukey]["name"],
                columns=rec_columns,
                keys=dict(obs=f"database observations of the series, yield to {d_rec} decimals; null where the source permits no display of points",
                          trend="the trend_series row of the series", trend_anomaly="rows of trend_anomaly for the series, in column order; null where withheld",
                          enso="rows of enso_windows for the series (season exposure under both indices)", qc="rows of qc_flags for the series; null where withheld",
                          responses="rows of response_leaf for the weather variables (tavg_mean, tmax_p95_days, precip, wet_days), in column order",
                          weather="rows of weather_todate_anomaly for the series (one per product), with the product's metrics as [value, reference, anom, z, pct_rank, n_years]",
                          weather_history="complete seasons 1981-2025 of weather_season: the season mean temperature (product best, tavg_mean) and the season rainfall "
                                          "(product chirps, precip) as departures from the series' own linear trend over those seasons, the detrending of the leaf fits",
                          weather_expected="per weather variable with a hierarchical slope: the harvest year of the series' predictions, the mean relative-index path "
                                           "(central scenario) over the months of the series' growing window and the slope times it (the expected departure this season), "
                                           "the months counted, and the same over the observed months alone (the departure the index so far implies)"),
                series=srec))
            counts["record_files"] += 1
            index[ukey] = [name, len(srec), sum(1 for r in srec.values() if r["display_points"]), size]
        # the state records: the series the site shows for each unit (first tier, then the longest), grouped by state
        state_series = defaultdict(dict)
        for s in su.itertuples(index=False):
            reg = regions.loc[s.unit_key] if s.unit_key in regions.index else None
            if reg is None or text(reg.region_key) in (None, s.unit_key) or urec[s.unit_key]["level"] == "national":
                continue
            k = (text(reg.region_key), s.crop_code, s.season); cur = state_series[k].get(s.unit_key)
            if cur is None or (int(s.tier), -int(s.n_obs or 0)) < (int(cur.tier), -int(cur.n_obs or 0)):
                state_series[k][s.unit_key] = s
        state_shards = defaultdict(dict)
        for (rk, crop, season), members in state_series.items():
            if len(members) >= 2:
                state_shards[rk][f"{crop}|{season}"] = state_record(members, crop, season, rk)
        state_index = {}
        for rk, srec in sorted(state_shards.items()):
            name = "state_" + shard_name(rk)
            assert name not in files, f"{iso}: state shard {name} collides with a unit shard"
            size = write(out / "records" / iso / name, dict(
                release=release, contract=CONTRACT, iso3=iso, unit_key=rk, name=region_names.get(rk, rk), level="state", columns=rec_columns,
                keys=dict(series="one entry per panel of the state, keyed crop_code|season: the area-weighted average of the state's reporting units in the "
                                 "shape of a unit record (obs the weighted mean yield per year over the units reporting it, trend and trend_anomaly fitted to "
                                 "that series, enso and weather_history the weighted means, weather the weighted season so far with percentiles null, "
                                 "weather_expected the weighted expectations); responses carry the weighted mean slope per weather variable and, as "
                                 + ("yield_response_components stores local slopes and covered baseline production; sum each member's exp(beta*x)-1 contrast. relationship_history averages the model-neutral member anomalies and exposures available each year. Aggregate historical confidence bands are not supplied; outlook ranges use shared fields."
                                    if corrected_intervals else "variable ly, the hierarchical state center with its 95% interval as pct_eb, lo_eb, hi_eb")),
                series=srec))
            counts["state_record_files"] += 1; counts["state_records"] += len(srec)
            state_index[rk] = [name, len(srec), max(x["n_units"] for x in srec.values()), size]
        write(out / "records" / iso / "index.json", dict(release=release, contract=CONTRACT, iso3=iso, columns=["file", "n_series", "n_public", "bytes"], units=index,
                                                         columns_states=["file", "n_series", "n_units", "bytes"], states=state_index))
        write(out / "units" / f"{iso}.json", dict(
            release=release, contract=CONTRACT, iso3=iso, name=names.get(iso, iso),
            columns=dict(responses=RL_COLS, predictions=PS_COLS, calendar=CS_COLS, weight=W_COLS),
            keys=dict(responses="rows of response_leaf for the yield (variable ly, one per index), in column order, unrounded; a row noted no_own_slope has slope_eb, "
                                "se_eb, pct_eb, lo_eb and hi_eb withheld",
                      predictions="rows of prediction_series for this series (one per method and scenario), in column order",
                      calendar="rows of calendar_status for this series (one per harvest year), in column order; cycle_unresolved is cycle == 'both' or confidence == 'missing'",
                      weight="the weights row of this series for the target year, in column order",
                      crop_area="per unit, per crop family: [hectares harvested in 2020, share of the unit's land] from CROPGRIDS v1.08 through the crosswalk; null where no figure",
                      records=f"records/{iso}/<unit file>.json per unit, listed in records/{iso}/index.json: observations, trend, anomalies, exposures, QC, "
                              "the weather-variable responses and the season-to-date weather"),
            units=urec))

    # ---- geometry ----------------------------------------------------------------------------------------------------
    if a.skip_geometry:
        audit = _loads_record((out / "manifest.json").read_text())["geometry"] if (out / "manifest.json").exists() else {}
        found = {f["id"] for p in (out / "geometry").glob("*.json") if p.stem != "world" for f in _loads_record(p.read_text())["features"]}
    elif a.geometry_from:
        found, audit = copy_geometry(a.geometry_from, out)
    else:
        found, audit = build_geometry(units, out)
    geometry_iso = {p.stem for p in (out / "geometry").glob("*.json") if p.stem not in ("world", "world_units")}

    # ---- world_units.json and geometry/world_units.json: the regional detail behind the world map ------------------------
    # For each crop family and country the panel the world map colours by (the largest baseline production, the rule of
    # the application), and for every series of that panel its central ENSO-outlook row; keyed by unit.
    wu_values = {f: {} for f in STAPLES}; wu_panel = {f: {} for f in STAPLES}
    pcols = dict(zip(WP_COLS, range(len(WP_COLS))))
    best_panel = {}
    for row in panels:
        fam, iso, prod = row[pcols["crop_family"]], row[pcols["iso3"]], row[pcols["baseline_production_mt"]] or 0
        if fam and ((fam, iso) not in best_panel or prod > best_panel[(fam, iso)][1]):
            best_panel[(fam, iso)] = (row[pcols["key"]], prod)
    med_rows = ps[ps.method.eq("index_outlook") & ps.scenario.eq("medium")].merge(series[["series_id", "unit_key", "crop_family"]], on="series_id")
    med_rows["key"] = key_of(med_rows)
    unit_level = units.set_index("unit_key").admin_level.to_dict()
    for r in med_rows.itertuples(index=False):
        bp = best_panel.get((r.crop_family, r.iso3))
        if bp is None or bp[0] != r.key or unit_level.get(r.unit_key) == "national":
            continue
        wu_panel[r.crop_family][r.iso3] = r.key
        wu_dec=PRECISION.get('world_units.json',3)
        wu_values[r.crop_family][r.unit_key] = [num(r.pct, wu_dec), num(r.lo, wu_dec), num(r.hi, wu_dec), int(r.harvest_year), str(int(r.series_id))]
    write(out / "world_units.json", dict(release=release, contract=CONTRACT, columns=["pct", "lo", "hi", "harvest_year", "series_id"],
                                         keys=dict(units="per crop family, for every local unit of the country's largest-production panel of that family, the medium index_outlook row of prediction_series: pct, lo, hi (full precision for reconciled intervals; otherwise 3 decimals), harvest_year, series_id",
                                                   panels="per crop family, the panel key each country's units are drawn from"),
                                         panels=wu_panel, units=wu_values))
    n_wu = sum(len(v) for v in wu_values.values())
    # ---- anomalies/<family>.json and anomalies/index.json: the harvest anomaly by year (18 October 2026) ----------------------
    # scripts/anomaly_layer.py writes, per family, every public series' departure from its own trend in every year from 1961
    # (trend_anomaly), the reported yield and the growing-season relative index (enso_windows), the national series the world
    # map colours each country by, the series it draws each reporting unit by (every unit with a public series of the family,
    # 19 October 2026), and the index with the coverage counts and the December-February relative index per year.
    import anomaly_layer
    an_series = series[["series_id", "iso3", "crop_code", "season", "crop_family", "unit_key", "tier", "n_obs", "display_points"]].copy()
    an_series["national"] = an_series.unit_key.map(lambda k: unit_level.get(k) == "national")
    an_info = anomaly_layer.build(out, release, CONTRACT, STAPLES, an_series, ta, enso.rename(columns={"n34rel_season": "exposure"})[["series_id", "harvest_year", "exposure"]],
                                  {k: v[0] for k, v in best_panel.items()}, pd.read_csv(a.monthly_index), Path(a.monthly_index), write=write, num=num)
    print(f"anomalies: {an_info['series']} series, {an_info['values']:,} values, {an_info['national']} national series, {an_info['units']} drawn units; {an_info['wall_seconds']} s", flush=True)
    # A coarse copy of every local unit polygon for the world map, simplified in degrees and written to three decimals;
    # the country files keep the 700 m detail for the country and state maps.
    import shapely
    from shapely.geometry import mapping, shape
    wu_feats = []
    wu_description = f"{WORLD_UNITS_TOLERANCE} degrees from the country files, topology preserved, coordinates to 1e-3 degrees; island parts under {WORLD_UNITS_MIN_PART} square degrees dropped, the largest part of a unit always kept"
    if a.geometry_from:
        previous = SITE_DATA / a.geometry_from
        previous_catalog = _loads_record((previous / "catalog.json").read_text())
        previous_manifest = _loads_record((previous / "manifest.json").read_text())
        previous_world = previous / "geometry" / "world_units.json"
        cached_world = _loads_record(previous_world.read_text())
        if (previous_catalog["results"]["database_sha256"] == rman["database"]["sha256"]
                and cached_world.get("simplification") == wu_description):
            # The country boundaries and simplification settings are identical.
            # Reuse the frozen world polygons; repeated coordinate snapping can
            # fail on narrow rings even after GEOS make_valid.
            assert sha(previous_world) == previous_manifest["files"]["geometry/world_units.json"]["sha256"]
            wu_feats = cached_world["features"]
            audit["world_units_reused"] = dict(release=a.geometry_from, sha256=sha(previous_world))
    for iso in ([] if wu_feats else sorted(geometry_iso)):
        for f in _loads_record((out / "geometry" / f"{iso}.json").read_text())["features"]:
            if f["properties"].get("level") == "national":
                continue
            g = shapely.simplify(shape(f["geometry"]), WORLD_UNITS_TOLERANCE, preserve_topology=True)
            g = shapely.set_precision(shapely.make_valid(g), 1e-3)
            if g.is_empty:
                continue
            if g.geom_type == "GeometryCollection":
                parts = [x for x in g.geoms if x.geom_type in ("Polygon", "MultiPolygon")]
                if not parts:
                    continue
                g = shapely.union_all(parts)
            if g.geom_type not in ("Polygon", "MultiPolygon"):
                continue
            # Island parts below the world map's pixel size (a pixel is about 0.3 degrees at world scale) only weigh the
            # file down: Indonesia's 52 units and Canada's 8 cost 1.7 MB of the 8.4 MB at 0.05 degrees. The largest part
            # of every unit is always kept, so no unit disappears.
            if g.geom_type == "MultiPolygon":
                parts = sorted(g.geoms, key=lambda x: x.area, reverse=True)
                kept = [parts[0]] + [x for x in parts[1:] if x.area >= WORLD_UNITS_MIN_PART]
                g = kept[0] if len(kept) == 1 else shapely.MultiPolygon(kept)
            wu_feats.append(dict(type="Feature", id=f["id"], properties=dict(id=f["id"], country=iso, name=f["properties"].get("name"), level=f["properties"].get("level")), geometry=mapping(g)))
    write(out / "geometry" / "world_units.json", dict(type="FeatureCollection", release=release, contract=CONTRACT,
                                                       simplification=wu_description,
                                                       features=wu_feats))

    # ---- catalog.json: countries, vocabularies, the model, the credits ---------------------------------------------
    countries = {}
    for iso, su in series.groupby("iso3", sort=True):
        crops = {c: sorted(set(x.season)) for c, x in su.groupby("crop_code")}
        countries[iso] = dict(name=names.get(iso, iso), n_units=int(su.unit_key.nunique()), n_series=int(len(su)), n_series_public=int(su.display_points.sum()),
                              crops=crops, panels=sorted(k for k in panel_keys if k.startswith(iso + "|")), geometry=iso in geometry_iso)
    sources = {}
    db_src = {r.source_id: r for r in db_sources.itertuples(index=False)}
    for r in db_sources.itertuples(index=False):
        role = SOURCE_ROLES.get(r.source_id, "calendar" if r.source_id.startswith("cal:") else "geometry" if r.source_id.startswith("geom:") else "other")
        sources[r.source_id] = dict(role=role, name=text(r.name), citation=text(r.citation), license=text(r.license), retrieved=text(r.retrieved), tier=num(r.tier))
    for (src, iso), (pid, fields) in resolved.items():
        n = int(((series.source == src) & (series.iso3 == iso)).sum())
        entry = sources.setdefault(pid, dict(role="yield", name=fields.get("name", pid), citation=None, license=None, retrieved=None, tier=None))
        entry['role'] = 'yield'  # Resolved agricultural series establish the role even when the provider already exists.
        entry.setdefault("permission", dict(display_points=bool(fields["display_points"]), redistribute=bool(fields["redistribute"]), derived_ok=bool(fields["derived_ok"]),
                                            license=fields.get("license", entry.get("license")), note=fields.get("note"), resolved=fields["resolved"]))
        if fields.get("citation"):
            entry["citation"] = fields["citation"]
        if fields.get("name"):
            entry["name"] = fields["name"]
        entry.setdefault("n_series", 0); entry["n_series"] += n
        entry.setdefault("countries", []); entry["countries"] = sorted(set(entry["countries"]) | {iso})
        if pid != src:
            entry["parent"] = src; entry.setdefault("parent_name", text(db_src[src].name) if src in db_src else src)
    if ca_path.exists():
        sources.pop("spam2010", None)    # the SPAM 2010 weights were replaced by CROPGRIDS on 11 October 2026
        sources.setdefault("cropgrids", dict(role="weights", name="CROPGRIDS v1.08 (2020 harvested area per crop, 0.05 degree)",
                                             citation="Tang, F.H.M., Nguyen, T.H., Conchedda, G., Casse, L., Tubiello, F.N. and Maggi, F. (2024) CROPGRIDS: a global geo-referenced dataset of 173 crops. Scientific Data 11, 413, doi:10.1038/s41597-024-03247-7; figshare 22491997 v9",
                                             license="CC BY 4.0", retrieved="2026-10-10", tier=None, used_for="the crop weighting of grid cells within units per crop family, the crop_area of every unit, and the cropped-land mask of the maps (colours shown where the harvested share of a cell exceeds 5 percent)",
                                             crop_area_sha256=sha(ca_path)))
    for pid, entry in sources.items():
        if entry["role"] == "yield" and "permission" not in entry:
            entry["permission"] = dict(display_points=False, redistribute=False, derived_ok=True, license=entry.get("license"), note="no series of this source in the release", resolved="none")
            entry["n_series"] = 0; entry["countries"] = []
    catalog = dict(
        release=release, contract=CONTRACT, candidate=bool(a.candidate), source_release=source_release,
        built_utc=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        results=dict(built_utc=rman["built_utc"], model_version=rman.get("model_version"), issue=rman["issue"], data_end=rman["data_end"],
                     index_last_month=rman["index_last_month"], database_sha256=rman["database"]["sha256"], methods=rman.get("methods")),
        model=dict(model_version=rman.get("model_version"), replicates={k: rman["replicates"][k] for k in ("method", "seed", "requested", "achieved", "block", "fits", "interval") if k in rman.get("replicates", {})},
                   uncertainty_calibration=rman.get('uncertainty_calibration'),
                   monte_carlo_precision=rman.get('monte_carlo_precision'),
                   forward_input_assumption=rman.get('forward_input_assumption'),
                   joint_regions=rman.get('joint_regions'),
                   validation_design=rman.get('validation_design'),
                   conditional_skill=rman.get('conditional_skill'),
                   central_estimand=rman.get('central_estimand'),
                   central_estimate='fitted response; Monte Carlo draws quantify uncertainty' if corrected_intervals else 'legacy release definition',
                   spec_sha256=sha(results / "model_spec.json") if (results / "model_spec.json").exists() else None),
        calendar=dict(published_range=published_range, harvest_years=harvest_years, table=tables["calendar_status"]),
        scope="The six staple crop families of the analysis layer (maize, rice, wheat, soybean, sorghum, cassava); every series of the release database in those families",
        families=STAPLES, crops={c: dict(family=crop_family[c], label=crop_label(c)) for c in sorted(staple_codes)},
        methods=METHODS, scenarios=SCENARIOS, status=STATUS, confidence=CONFIDENCE, countries=countries,
        weather_metrics=WEATHER_METRICS, greenness_metrics=["ndvi_mean"],   # the greenness metric of the vhp rows (14 October 2026), beside the fourteen weather metrics
        sources=sources, permissions=dict(path=str(perm_path.relative_to(ENSO)) if perm_path.is_relative_to(ENSO) else str(perm_path), sha256=sha(perm_path),
                                          rule="a series publishes its observation rows, trend anomalies and QC flags only where its source entry sets display_points; "
                                               "every series publishes its trend, responses, predictions, calendar and weight"),
        views=dict(world="world.json: the compact outlook per panel and the world rows; calendar_world.json for the calendar layers",
                   country="countries/<ISO>.json: the country's panels with every prediction_panel and aggregate row and the state aggregates; units/<ISO>.json for the map",
                   unit="units/<ISO>.json (responses, predictions, calendar, weight) and records/<ISO>/<unit>.json (observations, trend, anomalies, exposures, QC, weather-variable responses, season-to-date weather)"),
        precision=PRECISION, unmapped_units=len(audit.get("unmapped", [])))
    write(out / "catalog.json", catalog)

    # ---- manifest.json and releases.json --------------------------------------------------------------------------
    files = sorted(p for p in out.rglob("*.json") if p.name != "manifest.json")
    manifest = dict(release=release, contract=CONTRACT, candidate=bool(a.candidate), source_release=source_release, built_utc=catalog["built_utc"],
                    exporter=dict(path="scripts/export_release.py", sha256=sha(Path(__file__))),
                    results=dict(path=str(results.relative_to(ENSO)), manifest_sha256=sha(results / "manifest.json"),
                                 files={k: v["sha256"] for k, v in rman["files"].items()}),
                    tables=tables,
                    database=dict(path=str(db_path), sha256=db_sha),
                    permissions=dict(path=catalog["permissions"]["path"], sha256=catalog["permissions"]["sha256"],
                                     series_public=counts["series_public"], series_restricted=counts["series_restricted"],
                                     entries={pid: dict(display_points=e["permission"]["display_points"], n_series=e.get("n_series", 0)) for pid, e in sources.items() if e["role"] == "yield"}),
                    published_range=published_range, harvest_years=harvest_years,
                    precision=dict(decimals=PRECISION, note="decimals kept per file family; null means the value is the results float written at full double precision; "
                                                            "observations and calendar dates are database values copied as stored"),
                    counts=dict(countries=len(countries), units=int(len(units)), panels=len(panels), world_rows=len(world_rows), calendar_panels=len(cal_world),
                                skill_rows=n_skill, country_aggregate_rows=n_country_rows, region_aggregate_rows=n_regions, panel_weather_rows=n_wap, panel_weather_predictions=n_pwp,
                                geometry_units=len(found), geometry_countries=len(geometry_iso), world_units_values=n_wu, world_units_polygons=len(wu_feats),
                                anomaly_series=an_info["series"], anomaly_values=an_info["values"], **counts),
                    geometry=audit, anomalies=an_info, wall_seconds=round(time.monotonic() - started, 1),
                    files={str(p.relative_to(out)): dict(sha256=sha(p), bytes=p.stat().st_size) for p in files})
    write(out / "manifest.json", manifest)
    rel_path = SITE_DATA / "releases.json"
    releases = _loads_record(rel_path.read_text()) if rel_path.exists() else dict(default=None, releases=[])
    entry = dict(release=release, built_utc=catalog["built_utc"], issue=rman["issue"], data_end=rman["data_end"], index_last_month=rman["index_last_month"],
                 contract=CONTRACT, candidate=bool(a.candidate), source_release=source_release,
                 label=f"{'Candidate' if a.candidate else 'Release'} {release}: index to {rman['index_last_month']}, weather to {rman['data_end']}"
                       + (f", {rman['model_version']}" if rman.get("model_version") else ""))
    releases["releases"] = sorted([r for r in releases["releases"] if r["release"] != release] + [entry], key=lambda r: r["release"])
    if not a.candidate:
        releases["default"] = max(r["release"] for r in releases["releases"] if not r.get("candidate"))
    write(rel_path, releases)
    total = sum(v["bytes"] for v in manifest["files"].values())
    print(f"site/data/{release}: {len(files)} files, {total/1e6:.1f} MB; {manifest['counts']}; {manifest['wall_seconds']} s")


if __name__ == "__main__":
    main()
