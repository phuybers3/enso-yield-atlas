"""Export one release of the site data from the analysis results and the release database.

The atlas layer of 4_ag/ATLAS_PLAN_v2.md: read `4_ag/results/<R>/` (the Parquet tables of the analysis layer) and
`2_data/derived/db/enso_ag_<R>.sqlite` (units, series catalog, observations, season windows, the monthly index,
geometry sources), and write `site/data/<R>/` for the three views of the site. Every number written here is a
copy of a results row or a database value; this script does no aggregation, pooling, unit conversion or
significance decision. Where a field is rounded, the manifest states the decimals, and `tests/numerics.py`
checks every value against its source row at that precision.

    python scripts/export_release.py --release 2026-10-08 [--skip-geometry]

Outputs (site/data/<R>/): catalog.json, world.json, panels.json, skill.json, countries/<ISO3>.json,
units/<ISO3>.json (responses, predictions, windows and season-to-date weather per series), records/<ISO3>.json
(observations and the fitted trend per series), geometry/<ISO3>.json, geometry/world.json, manifest.json; and
site/data/releases.json.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import sqlite3
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

ATLAS = Path(__file__).resolve().parents[1]
ENSO = ATLAS.parents[1]
HULTGREN = ENSO.parent / "Adaptation" / "Hultgren"
SITE_DATA = ATLAS / "site" / "data"
STAPLES = ["maize", "rice", "wheat", "soybean", "sorghum", "cassava"]
METHODS = ["trend", "index_perfect", "index_todate", "index_outlook", "weather_todate"]
SCENARIOS = ["low", "medium", "high", "observed"]
STATUS = ["not planted", "in the ground", "complete"]
# Decimals kept per file family. None means the float is written at full double precision (repr round trip).
PRECISION = {"panels.json": None, "world.json": None, "countries": None, "skill.json": 6, "units": 6, "records": 4}
WEATHER_METRICS = ["tavg_mean", "tmax_mean", "tmin_mean", "gdd", "edd30", "kdd31", "tmax_p95_days", "txx", "precip", "wet_days", "precip_p95_days", "rx1day", "rx5day", "cdd"]
WEATHER_FIELDS = ["value", "reference", "anom", "z", "pct_rank", "n_years"]
PANEL_WEATHER_FIELDS = ["value", "anom", "product", "expected", "percentile", "z", "slope_per_degC", "slope_p", "resid_sd", "hist_sd", "signal", "beyond_range"]
NAME_OVERRIDES = {"USA": "United States", "GBR": "United Kingdom", "KOR": "South Korea", "PRK": "North Korea", "IRN": "Iran",
                  "SYR": "Syria", "VNM": "Vietnam", "RUS": "Russia", "TZA": "Tanzania", "COD": "DR Congo", "CIV": "Côte d'Ivoire",
                  "LAO": "Laos", "BOL": "Bolivia", "VEN": "Venezuela", "TUR": "Türkiye", "CZE": "Czechia", "ARE": "United Arab Emirates",
                  "TWN": "Taiwan", "MDA": "Moldova", "BRN": "Brunei", "FSM": "Micronesia", "SWZ": "Eswatini"}
CROP_LABELS = {"rice_paddy": "rice (paddy)", "rice_milled": "rice (milled)", "rice_brown": "rice (brown)",
               "wheat_spring": "spring wheat", "wheat_winter": "winter wheat"}


# ---- helpers ----------------------------------------------------------------------------------------------------------
def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def num(x, d=None):
    """A results value as JSON: None for a missing value, otherwise the float rounded to d decimals (None: unrounded)."""
    if x is None:
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
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else str(x)


def write(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False, allow_nan=False) + "\n")
    tmp.replace(path)


def country_name(iso3: str, raw: str | None) -> str:
    if iso3 in NAME_OVERRIDES:
        return NAME_OVERRIDES[iso3]
    return (raw or iso3).replace("_", " ").title()


def crop_label(code: str) -> str:
    return CROP_LABELS.get(code, code.replace("_", " "))


def panel_key(iso3, crop_code, season) -> str:
    return f"{iso3}|{crop_code}|{season}"


def rows(frame: pd.DataFrame, cols, d=None, text_cols=(), int_cols=(), bool_cols=(), id_cols=(), as_list=False):
    """Copy the listed columns of every row into dicts (or, as_list, into arrays in column order), missing values as null."""
    out = []
    for r in frame[list(cols)].itertuples(index=False):
        rec = {}
        for c, v in zip(cols, r):
            if c in id_cols:
                rec[c] = None if v is None or (isinstance(v, float) and math.isnan(v)) else str(int(v))
            elif c in text_cols:
                rec[c] = text(v)
            elif c in bool_cols:
                rec[c] = None if v is None or (isinstance(v, float) and math.isnan(v)) else bool(v)
            elif c in int_cols:
                rec[c] = None if v is None or (isinstance(v, float) and math.isnan(v)) else int(v)
            else:
                rec[c] = num(v, d)
        out.append([rec[c] for c in cols] if as_list else rec)
    return out


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
        path = ENSO / rel
        hashes[rel] = sha(path)
        g = gpd.read_file(path).to_crs(4326)
        iso = units.loc[units.geometry_source.eq(src), "iso3"].iloc[0]
        g["key"] = iso + ":" + g.stable_id.astype(str)
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
    path = ENSO / "2_data/raw/naturalearth/ne_50m_admin_0_countries.shp"
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


# ---- main --------------------------------------------------------------------------------------------------------------
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--release", default=(ENSO / "4_ag/results/CURRENT").read_text().strip())
    ap.add_argument("--skip-geometry", action="store_true", help="keep the geometry files already in site/data/<R>/geometry")
    a = ap.parse_args()
    release = a.release
    started = time.monotonic()
    results = ENSO / "4_ag/results" / release
    db_path = ENSO / "2_data/derived/db" / f"enso_ag_{release}.sqlite"
    out = SITE_DATA / release
    rman = json.loads((results / "manifest.json").read_text())
    assert rman["release"] == release, "results manifest names another release"
    assert db_path.exists(), db_path
    db_sha = sha(db_path)
    assert db_sha == rman["database"]["sha256"], "the release database differs from the one the analysis read"

    # ---- database: catalog, observations, windows, index ------------------------------------------------------------
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    series = pd.read_sql("SELECT series_id, unit_key, crop_code, season_std AS season, area_basis, source, tier, iso3, crop_family, "
                         "first_year, last_year, n_obs, series_key FROM series WHERE staple = 1", con)
    units = pd.read_sql("SELECT unit_key, tier, iso3, country, admin_level, unit_name, n_members, base_year, geometry_source, lon, lat FROM units", con)
    units = units[units.unit_key.isin(series.unit_key)].copy()
    regions = pd.read_sql("SELECT unit_key, region_key, region_name FROM unit_regions", con).drop_duplicates("unit_key").set_index("unit_key")
    obs = pd.read_sql("SELECT o.series_id, o.harvest_year, o.yield_t_ha FROM observations o JOIN series s USING (series_id) "
                      "WHERE s.staple = 1 AND o.yield_t_ha IS NOT NULL ORDER BY o.series_id, o.harvest_year", con)
    horizon = pd.read_sql("SELECT series_id, harvest_year, start_date, end_date, source, cycle FROM season_windows "
                          "WHERE harvest_year >= (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'horizon') - 1", con)
    names = {r.iso3: country_name(r.iso3, r.country) for r in units.drop_duplicates("iso3").itertuples()}
    con.close()
    series["series_id"] = series.series_id.astype("int64")
    crop_family = series.drop_duplicates("crop_code").set_index("crop_code").crop_family.to_dict()
    staple_codes = set(crop_family)

    # ---- results ----------------------------------------------------------------------------------------------------
    R = lambda name: pd.read_parquet(results / f"{name}.parquet")
    rc = R("response_country"); rc = rc[rc.crop_code.isin(staple_codes)]
    rr = R("response_region"); rr = rr[rr.crop_code.isin(staple_codes)]
    ru = R("response_unit"); ru = ru[ru.crop_code.isin(staple_codes)]
    pp = R("prediction_panel"); pw = R("prediction_world"); pwp = R("prediction_weather_panel"); ps = R("prediction_series")
    sk = R("evaluation_skill"); sk = sk[sk.level.eq("panel") & sk.crop_code.isin(staple_codes)]
    changes = json.loads((results / "changes.json").read_text())
    staple_ids = set(series.series_id)
    ts = R("trend_series"); ts = ts[ts.series_id.isin(staple_ids)]
    ta = R("trend_anomaly"); ta = ta[ta.series_id.isin(staple_ids)]
    wa = R("weather_todate_anomaly"); wa = wa[wa.series_id.isin(staple_ids)]
    wap = R("weather_todate_anomaly_panel")
    sp = R("scenario_index_path")

    # ---- panels.json ------------------------------------------------------------------------------------------------
    pp = pp.assign(key=[panel_key(*k) for k in zip(pp.iso3, pp.crop_code, pp.season)])
    pwp = pwp.assign(key=[panel_key(*k) for k in zip(pwp.iso3, pwp.crop_code, pwp.season)]).set_index("key")
    rc_season = rc[rc.window.eq("season") & rc["index"].eq("rel")].assign(key=lambda d: [panel_key(*k) for k in zip(d.iso3, d.crop_code, d.season)]).set_index("key")
    rc_cols = ["index", "window", "beta", "se", "pct_per_degC", "lo", "hi", "p", "q", "n_units", "n_years", "year_first", "year_last", "production_t", "method_version"]
    pp_cols = ["method", "scenario", "harvest_year", "issue", "lead", "pct", "lo", "hi", "se", "production_mt", "n_series", "local_share", "usable_share", "status"]
    wap = wap.assign(key=[panel_key(*k) for k in zip(wap.iso3, wap.crop_code, wap.season)]).set_index("key")
    wap_head = ["issue", "harvest_year", "data_end", "frac_elapsed", "n_series", "n_years", "production_t", "coverage_share", "idx_todate", "metrics_with_signal", "metrics_concordant", "verdict"]
    def panel_weather(row):
        rec = rows(row.to_frame().T, wap_head, None, text_cols=("issue", "data_end", "verdict"), int_cols=("harvest_year", "n_series", "n_years", "metrics_with_signal", "metrics_concordant"))[0]
        rec["metrics"] = {m: {f: (text(row[f"{m}_{f}"]) if f == "product" else num(row[f"{m}_{f}"])) for f in PANEL_WEATHER_FIELDS} for m in WEATHER_METRICS}
        return rec
    panels = []
    for key, d in pp.groupby("key", sort=True):
        head = d[d.method.eq("index_outlook") & d.scenario.eq("medium")]
        head = head.iloc[0] if len(head) else d.iloc[0]
        wrow = pwp.loc[key] if key in pwp.index else None
        crow = rc_season.loc[key] if key in rc_season.index else None
        panels.append(dict(
            key=key, iso3=head.iso3, country=names.get(head.iso3, head.iso3), crop_code=head.crop_code,
            crop_family=crop_family.get(head.crop_code), season=head.season,
            label=f"{names.get(head.iso3, head.iso3)} {crop_label(head.crop_code)}" + ("" if head.season in ("main", "annual", "Annual") else f", {head.season}"),
            headline_row="index_outlook/medium", harvest_year=int(head.harvest_year), status=head.status,
            production_mt=num(head.production_mt), n_series=int(head.n_series), local_share=num(head.local_share),
            predictions=rows(d, pp_cols, None, text_cols=("method", "scenario", "issue", "status"), int_cols=("harvest_year", "n_series", "lead")),
            season_weather=panel_weather(wap.loc[key]) if key in wap.index else None,
            weather=None if wrow is None else dict(lead=int(wrow.lead), pct_panel=num(wrow.pct_panel), se_panel=num(wrow.se_panel),
                                                     usable_panel=bool(wrow.usable_panel), coverage_share=num(wrow.coverage_share),
                                                     frac_started=num(wrow.frac_started), skill_vs_trend=num(wrow.skill_vs_trend),
                                                     n_series=int(wrow.n_series), metrics=str(wrow.metrics).split(",")),
            response=None if crow is None else rows(crow.to_frame().T, rc_cols, None, text_cols=("index", "window", "method_version"),
                                                      int_cols=("n_units", "n_years", "year_first", "year_last"))[0]))
    write(out / "panels.json", panels)
    panel_keys = {p["key"] for p in panels}

    # ---- world.json -------------------------------------------------------------------------------------------------
    resp_world = rc_season.reset_index()
    resp_world = resp_world.assign(country=resp_world.iso3.map(lambda i: names.get(i, i)), crop_family=resp_world.crop_code.map(crop_family))
    world = dict(release=release, headline=rman["headline"], index=rman["index"], issue=rman["issue"], data_end=rman["data_end"],
                 index_last_month=rman["index_last_month"],
                 world=rows(pw, ["crop_family", "issue", "method", "scenario", "dprod_mt", "pct", "lo", "hi", "production_mt", "coverage_share"],
                            None, text_cols=("crop_family", "issue", "method", "scenario")),
                 responses=rows(resp_world, ["key", "iso3", "country", "crop_code", "crop_family", "season"] + rc_cols, None,
                                text_cols=("key", "iso3", "country", "crop_code", "crop_family", "season", "index", "window", "method_version"),
                                int_cols=("n_units", "n_years", "year_first", "year_last")),
                 index_path=rows(sp.sort_values(["index", "scenario", "year", "month"]), ["issue", "scenario", "index", "year", "month", "value", "observed"], None,
                                 text_cols=("issue", "scenario", "index"), int_cols=("year", "month", "observed")),
                 changes=dict(previous=changes.get("previous"), previous_kind=changes.get("previous_kind"), counts=changes.get("summary", {}).get("counts"),
                              causes=changes.get("summary", {}).get("causes")))
    write(out / "world.json", world)

    # ---- skill.json -------------------------------------------------------------------------------------------------
    sk = sk.assign(key=[panel_key(*k) for k in zip(sk.iso3, sk.crop_code, sk.season)])
    skill = {}
    for key, d in sk.sort_values(["method", "lead"]).groupby("key", sort=True):
        skill[key] = rows(d, ["method", "lead", "n_years", "rmse", "mae", "skill_vs_trend", "corr", "coverage_80", "note"], PRECISION["skill.json"],
                          text_cols=("method", "note"), int_cols=("lead", "n_years"))
    write(out / "skill.json", dict(release=release, panels=skill))

    # ---- countries/<ISO>.json ----------------------------------------------------------------------------------------
    rr_cols = ["region_key", "region_name", "crop_code", "season", "index", "beta", "se", "pct_per_degC", "lo", "hi", "p", "q",
               "pct_shrunk", "lo_shrunk", "hi_shrunk", "tau", "n_units", "n_years", "production_t"]
    rc_by, rr_by = dict(tuple(rc.groupby("iso3"))), dict(tuple(rr.groupby("iso3")))
    for iso in sorted(set(series.iso3)):
        c = rc_by.get(iso, rc.iloc[0:0]); g = rr_by.get(iso, rr.iloc[0:0])
        write(out / "countries" / f"{iso}.json", dict(
            release=release, iso3=iso, name=names.get(iso, iso),
            panels=sorted(k for k in panel_keys if k.startswith(iso + "|")),
            responses=rows(c, ["crop_code", "season"] + rc_cols, None, text_cols=("crop_code", "season", "index", "window", "method_version"),
                           int_cols=("n_units", "n_years", "year_first", "year_last")),
            regions=rows(g, rr_cols, None, text_cols=("region_key", "region_name", "crop_code", "season", "index"), int_cols=("n_units", "n_years"))))

    # ---- units/<ISO>.json ------------------------------------------------------------------------------------------
    d_units, d_rec = PRECISION["units"], PRECISION["records"]
    wa_head = ["product", "issue", "data_end", "harvest_year", "frac_elapsed", "elapsed_days", "t_coverage", "p_coverage"]
    wa_by = {k: v for k, v in wa.groupby("series_id")}
    ts_by = {int(r.series_id): r for r in ts.itertuples(index=False)}
    ta_by = {k: v[["harvest_year", "yield_t_ha", "fitted_yield", "anomaly_pct"]].to_numpy() for k, v in ta.groupby("series_id")}
    ts_cols = ["year_first", "year_last", "n_years", "trend_pct_per_year", "intercept"]
    def series_weather(frame):
        out = []
        for r in frame.sort_values("product").itertuples(index=False):
            rec = rows(frame[frame["product"].eq(r.product)], wa_head, d_units, text_cols=("product", "issue", "data_end"), int_cols=("harvest_year", "elapsed_days"))[0]
            # only the metrics the product supplies (best: temperature, chirps: rain); a metric is kept when any field is finite
            rec["metrics"] = {m: [num(getattr(r, f"{m}_{f}"), d_units) for f in WEATHER_FIELDS] for m in WEATHER_METRICS
                              if any(num(getattr(r, f"{m}_{f}")) is not None for f in WEATHER_FIELDS)}
            out.append(rec)
        return out
    ru_cols = ["index", "n_years", "pct_raw", "lo_raw", "hi_raw", "p_raw", "pct_best", "lo_best", "hi_best", "p_best", "shrink_weight", "response_level"]
    ps_cols = ["method", "scenario", "harvest_year", "issue", "lead", "pct", "lo", "hi", "se", "frac_elapsed", "usable", "skill_vs_trend", "production_t", "beyond_fit"]
    win_cols = ["harvest_year", "start_date", "end_date", "source", "cycle"]
    ru_by = {k: v for k, v in ru.groupby("series_id")}
    ps_by = {k: v for k, v in ps.groupby("series_id")}
    obs_by = {k: v[["harvest_year", "yield_t_ha"]].to_numpy() for k, v in obs.groupby("series_id")}
    win_by = {k: v for k, v in horizon.groupby("series_id")}
    n_series_out, n_obs_out, n_trend_out = 0, 0, 0
    for iso, su in series.groupby("iso3", sort=True):
        urec = {}; records = {}
        for u in units[units.iso3.eq(iso)].itertuples(index=False):
            reg = regions.loc[u.unit_key] if u.unit_key in regions.index else None
            urec[u.unit_key] = dict(name=u.unit_name, level=u.admin_level, tier=int(u.tier),
                                    region_key=None if reg is None else text(reg.region_key), region_name=None if reg is None else text(reg.region_name),
                                    lon=num(u.lon), lat=num(u.lat), series=[])
        for s in su.sort_values(["unit_key", "crop_code", "season", "area_basis", "source"]).itertuples(index=False):
            sid = int(s.series_id)
            o = obs_by.get(sid); t = ts_by.get(sid); tfit = ta_by.get(sid); w = wa_by.get(sid)
            resp = ru_by.get(sid); pred = ps_by.get(sid); win = win_by.get(sid)
            records[str(sid)] = dict(
                obs=[] if o is None else [[int(y), num(v, d_rec)] for y, v in o],
                trend=None if t is None else dict(year_first=int(t.year_first), year_last=int(t.year_last), n_years=int(t.n_years),
                                                  trend_pct_per_year=num(t.trend_pct_per_year, d_rec), intercept=num(t.intercept, d_rec)),
                trend_anomaly=[] if tfit is None else [[int(y), num(v, d_rec), num(f, d_rec), num(a, d_rec)] for y, v, f, a in tfit])
            n_obs_out += len(records[str(sid)]["obs"]); n_trend_out += len(records[str(sid)]["trend_anomaly"])
            rec = dict(id=str(sid), crop_code=s.crop_code, crop_family=s.crop_family, season=s.season, basis=s.area_basis, source=s.source,
                       tier=int(s.tier), first=num(s.first_year), last=num(s.last_year), n=num(s.n_obs),
                       weather=[] if w is None else series_weather(w),
                       responses=[] if resp is None else rows(resp, ru_cols, d_units, text_cols=("index", "response_level"), int_cols=("n_years",), as_list=True),
                       predictions=[] if pred is None else rows(pred.sort_values(["method", "scenario"]), ps_cols, d_units, text_cols=("method", "scenario", "issue"),
                                                                 int_cols=("harvest_year", "lead", "beyond_fit"), bool_cols=("usable",), as_list=True),
                       windows=[] if win is None else rows(win.sort_values("harvest_year"), win_cols, None, text_cols=("start_date", "end_date", "source", "cycle"),
                                                           int_cols=("harvest_year",), as_list=True))
            n_series_out += 1
            urec[s.unit_key]["series"].append(rec)
        write(out / "records" / f"{iso}.json", dict(
            release=release, iso3=iso, columns=dict(obs=["harvest_year", "yield_t_ha"], trend=ts_cols, trend_anomaly=["harvest_year", "yield_t_ha", "fitted_yield", "anomaly_pct"]),
            keys=dict(obs=f"database observations of the series, yield to {d_rec} decimals", trend="the trend_series row of the series",
                      trend_anomaly="rows of trend_anomaly for the series, in column order"), series=records))
        write(out / "units" / f"{iso}.json", dict(
            release=release, iso3=iso, name=names.get(iso, iso),
            columns=dict(responses=ru_cols, predictions=ps_cols, windows=win_cols, weather=wa_head, weather_metrics=WEATHER_FIELDS),
            keys=dict(responses="rows of response_unit for this series (one per index), in column order",
                      predictions="rows of prediction_series for this series (one per method and scenario), in column order",
                      windows="rows of season_windows for the horizon harvest years, in column order",
                      weather="rows of weather_todate_anomaly for this series (one per product), with the product's metrics as [value, reference, anom, z, pct_rank, n_years]"),
            units=urec))

    # ---- geometry ----------------------------------------------------------------------------------------------------
    if a.skip_geometry:
        audit = json.loads((out / "manifest.json").read_text())["geometry"] if (out / "manifest.json").exists() else {}
        found = {f["id"] for p in (out / "geometry").glob("*.json") if p.stem != "world" for f in json.loads(p.read_text())["features"]}
    else:
        found, audit = build_geometry(units, out)
    geometry_iso = {p.stem for p in (out / "geometry").glob("*.json") if p.stem != "world"}

    # ---- catalog.json ------------------------------------------------------------------------------------------------
    countries = {}
    for iso, su in series.groupby("iso3", sort=True):
        crops = {c: sorted(set(x.season)) for c, x in su.groupby("crop_code")}
        countries[iso] = dict(name=names.get(iso, iso), n_units=int(su.unit_key.nunique()), n_series=int(len(su)),
                              crops=crops, panels=sorted(k for k in panel_keys if k.startswith(iso + "|")), geometry=iso in geometry_iso)
    catalog = dict(
        release=release, built_utc=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        results=dict(built_utc=rman["built_utc"], method_version=rman["method_version"], issue=rman["issue"], data_end=rman["data_end"],
                     index_last_month=rman["index_last_month"], database_sha256=rman["database"]["sha256"], methods=rman["methods"]),
        scope="The six staple crop families of the analysis layer (maize, rice, wheat, soybean, sorghum, cassava); every series of the release database in those families",
        families=STAPLES, crops={c: dict(family=crop_family[c], label=crop_label(c)) for c in sorted(staple_codes)},
        methods=METHODS, scenarios=SCENARIOS, status=STATUS, countries=countries,
        weather_metrics=WEATHER_METRICS,
        views=dict(record="observed yields of every unit and series with the fitted trend and anomalies (database observations; trend_series, trend_anomaly)",
                   response="the ENSO response at unit, state and country level (response_unit, response_region, response_country)",
                   season="the current season: scenario index paths, index outlook scenarios, the weather-to-date estimate with its gates, the season-to-date weather anomalies against the index-expected ones, panel status, and the hindcast skill by lead (prediction_*, scenario_index_path, weather_todate_anomaly*, evaluation_skill)"),
        precision=PRECISION, unmapped_units=len(audit.get("unmapped", [])))
    write(out / "catalog.json", catalog)

    # ---- manifest.json and releases.json --------------------------------------------------------------------------
    files = sorted(p for p in out.rglob("*.json") if p.name != "manifest.json")
    manifest = dict(release=release, built_utc=catalog["built_utc"], exporter=dict(path="scripts/export_release.py", sha256=sha(Path(__file__))),
                    results=dict(path=str(results.relative_to(ENSO)), manifest_sha256=sha(results / "manifest.json"),
                                 files={k: v["sha256"] for k, v in rman["files"].items()}),
                    database=dict(path=str(db_path.relative_to(ENSO)), sha256=db_sha),
                    precision=dict(decimals=PRECISION, note="decimals kept per file family; null means the value is the results float written at full double precision; "
                                                            "observations and window dates are database values copied as stored"),
                    counts=dict(countries=len(countries), units=int(len(units)), series=n_series_out, observations=n_obs_out, trend_rows=n_trend_out, panels=len(panels),
                                skill_panels=len(skill), geometry_units=len(found), geometry_countries=len(geometry_iso)),
                    geometry=audit, wall_seconds=round(time.monotonic() - started, 1),
                    files={str(p.relative_to(out)): dict(sha256=sha(p), bytes=p.stat().st_size) for p in files})
    write(out / "manifest.json", manifest)
    rel_path = SITE_DATA / "releases.json"
    releases = json.loads(rel_path.read_text()) if rel_path.exists() else dict(default=None, releases=[])
    entry = dict(release=release, built_utc=catalog["built_utc"], issue=rman["issue"], data_end=rman["data_end"], index_last_month=rman["index_last_month"],
                 label=f"Release {release}: index to {rman['index_last_month']}, weather to {rman['data_end']}")
    releases["releases"] = sorted([r for r in releases["releases"] if r["release"] != release] + [entry], key=lambda r: r["release"])
    releases["default"] = releases["releases"][-1]["release"]
    write(rel_path, releases)
    total = sum(v["bytes"] for v in manifest["files"].values())
    print(f"site/data/{release}: {len(files)} files, {total/1e6:.1f} MB; {manifest['counts']}; {manifest['wall_seconds']} s")


if __name__ == "__main__":
    main()
