"""Harvest anomaly by year (18 October 2026): site/data/<release>/anomalies/<family>.json and anomalies/index.json.

The layer colours every reporting unit by the departure of its reported yield from the series' own log-linear trend in
a chosen harvest year: anomaly_pct of trend_anomaly.parquet (100 * reported / trend - 100), the quantity the unit page
plots. One file per crop family holds every staple series of the family from YEAR_FIRST on, keyed by series id, so the
world map (the local series of world_units.json and the national series of each world panel) and the country map (any
season a unit reports) read one file per family.

    <family>.json   {release, contract, layer, family, columns, decimals, encoding, year_first, years: [first, last],
                     national: {ISO3: [series_id, crop_code, season]}, counts: {year: n}, counts_world: {year: n}, default_year,
                     series: {series_id: [first_year, anomaly_pct[], yield_t_ha[], exposure[]]}}
                    The three arrays run over consecutive harvest years from first_year to the series' last year, null
                    where the year has no reported yield. exposure is n34rel_season of enso_windows, the growing-season
                    relative Nino 3.4 the record page plots against, null where the series has no window for the year.
                    national names, per country, the national series of the panel the world map colours by (the
                    family's largest-production panel): the series of the national unit for that crop and season,
                    first tier, then the longest; where that panel has no national series (a local HarvestStat panel
                    beside a FAOSTAT annual record) the country's national series of the family, the panel's crop
                    first, with its crop and season named. counts_world counts the series the world map draws (the local
                    series of world_units.json and the national series) with a value in the year; default_year is the
                    latest year whose world count is at least half the family's peak.
    index.json      the families, the year ranges, the counts per family and year, the default years, the
                    December-February relative Nino 3.4 ending in each harvest year from monthly_indices.csv, the
                    rules in words and the file hashes.

Called by scripts/export_release.py after the world_units block (the database supplies the series catalog, the
publication rule and the exposures), or standalone against an exported site folder:

    python scripts/anomaly_layer.py --release 2026-10-15 --update-manifest

Standalone, the series catalog (crop, season, family, unit, tier, display_points) is read from units/<ISO>.json, and
for a country without a units file from the release tables (trend_series, weights, response_leaf) and its national
record shard records/<ISO>/<ISO>.json; the values from analysis/releases/crops/<release>/trend_anomaly.parquet; the
exposures from enso_relationship_points.parquet (variable ly, index rel, which equal n34rel_season). --update-manifest
adds the files to manifest.json so tests/schema.py accepts the folder. A series whose source withholds its observation
rows (display_points false) is left out, as the record shards leave out its rows.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import time
from pathlib import Path

import numpy as np
import pandas as pd

ATLAS = Path(__file__).resolve().parents[1]
SITE_DATA = ATLAS / "site" / "data"
YEAR_FIRST = 1961                                   # the first FAOSTAT year
COLUMNS = ["anomaly_pct", "yield_t_ha", "exposure"]
DECIMALS = {"anomaly_pct": 2, "yield_t_ha": 3, "exposure": 2, "djf": 3}
INDEX_COLUMN = "local_relative"                     # relative Nino 3.4 in monthly_indices.csv (ERSSTv5 Nino 3.4 less the tropical mean)
ENCODING = ("series[id] = [first_year, anomaly_pct[], yield_t_ha[], exposure[]]: the arrays run over consecutive harvest years "
            "from first_year, null where the year has no reported yield; the trend yield is yield_t_ha / (1 + anomaly_pct / 100)")
SELECTION = ("the world map colours a country by the national series of the panel it colours by on the outlook layer (the family's "
             "largest-production panel), or where that panel has no national series by the country's national series of the family, "
             "and draws over it the local series of world_units.json; the country map takes each unit's series for the chosen crop "
             "and season (first tier, then the longest), as the outlook layer does")
TREND = ("anomaly_pct of trend_anomaly: the departure of the reported yield from the series' own log-linear trend fitted over all its "
         "years (trend_series: growth per year and the intercept at 2000), the value the unit page plots; it is an observation, "
         "containing ENSO and everything else, and no model enters it")


def _missing(x) -> bool:
    return x is None or x is pd.NA or (isinstance(x, float) and math.isnan(x))


def _num(x, d=None):
    if _missing(x):
        return None
    if isinstance(x, (bool, np.bool_)):
        return bool(x)
    if isinstance(x, (int, np.integer)):
        return int(x)
    v = float(x)
    if not math.isfinite(v):
        return None
    return v if d is None else round(v, d)


def _write(path: Path, data) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False, allow_nan=False) + "\n")
    tmp.replace(path)
    return path.stat().st_size


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def djf_relative(monthly: pd.DataFrame, years, column=INDEX_COLUMN) -> dict:
    """The mean of the monthly relative index over December of the previous year to February of the harvest year; None if a month is missing."""
    m = monthly.copy()
    m["date"] = pd.to_datetime(m["date"])
    by = {(d.year, d.month): v for d, v in zip(m["date"], m[column])}
    out = {}
    for y in years:
        vals = [by.get((y - 1, 12)), by.get((y, 1)), by.get((y, 2))]
        out[int(y)] = None if any(_missing(v) for v in vals) else round(float(np.mean(vals)), DECIMALS["djf"])
    return out


def default_year(counts: dict) -> int | None:
    """The latest year whose count is at least half the peak count."""
    if not counts:
        return None
    peak = max(counts.values())
    good = [y for y, n in counts.items() if n >= 0.5 * peak]
    return max(good) if good else max(counts)


def national_series(series: pd.DataFrame, best_panel: dict) -> dict:
    """{family: {iso3: [series_id, crop_code, season]}}: the national unit's series of the panel the world map colours by (first tier,
    then the longest); where that panel has no national series (a local HarvestStat panel of season `main` beside a FAOSTAT annual
    record), the country's national series of the family, the panel's crop first."""
    nat = series[series.national & series.display_points].sort_values(["tier", "n_obs"], ascending=[True, False])
    by, by_fam = {}, {}
    for r in nat.itertuples(index=False):
        by.setdefault((r.iso3, r.crop_code, r.season), r)
        by_fam.setdefault((r.iso3, r.crop_family), []).append(r)
    out = {}
    for (fam, iso), key in best_panel.items():
        parts = key.split("|")
        assert len(parts) == 3 and parts[0] == iso, key
        r = by.get((iso, parts[1], parts[2]))
        if r is None:
            cands = sorted(by_fam.get((iso, fam), []), key=lambda x: (x.crop_code != parts[1], x.tier, -x.n_obs))
            r = cands[0] if cands else None
        if r is not None:
            out.setdefault(fam, {})[iso] = [str(int(r.series_id)), r.crop_code, r.season]       # ids exceed 2^53: strings, as everywhere on the site
    return out


def build(out: Path, release: str, contract: str, families, series: pd.DataFrame, ta: pd.DataFrame, exposures: pd.DataFrame,
          best_panel: dict, world_units: dict, monthly: pd.DataFrame, monthly_path: Path | None = None, write=_write, num=_num,
          year_first: int = YEAR_FIRST) -> dict:
    """Write anomalies/<family>.json and anomalies/index.json under `out` and return the manifest entry.

    series:     one row per staple series: series_id, iso3, crop_code, season, crop_family, unit_key, tier, n_obs, display_points, national
    ta:         trend_anomaly rows: series_id, harvest_year, yield_t_ha, fitted_yield, anomaly_pct
    exposures:  series_id, harvest_year, exposure (n34rel_season of enso_windows)
    best_panel: {(family, iso3): panel key} of the panel the world map colours each country by
    world_units: the content of world_units.json (units[family][unit_key][4] is the series id)
    monthly:    the monthly index table with a date column and INDEX_COLUMN
    """
    started = time.monotonic()
    folder = out / "anomalies"
    folder.mkdir(parents=True, exist_ok=True)
    s = series.copy()
    s["series_id"] = s.series_id.astype("int64")
    s = s[s.crop_family.isin(list(families)) & s.display_points.astype(bool)]
    assert not s.series_id.duplicated().any(), "a series id appears twice in the series catalog"
    fam_of = s.set_index("series_id").crop_family.to_dict()
    t = ta[["series_id", "harvest_year", "yield_t_ha", "fitted_yield", "anomaly_pct"]].copy()
    t["series_id"] = t.series_id.astype("int64")
    t = t[t.series_id.isin(fam_of) & (t.harvest_year >= year_first) & t.anomaly_pct.notna() & t.yield_t_ha.notna()]
    dup = t.duplicated(["series_id", "harvest_year"], keep=False)
    assert not dup.any(), f"trend_anomaly holds more than one row per series and year: {t.loc[dup].head(3).to_dict('records')}"
    t["fam"] = t.series_id.map(fam_of)
    e = exposures[["series_id", "harvest_year", "exposure"]].copy()
    e["series_id"] = e.series_id.astype("int64")
    e = e[e.series_id.isin(fam_of)].drop_duplicates(["series_id", "harvest_year"])
    t = t.merge(e, on=["series_id", "harvest_year"], how="left")
    nat = national_series(s, best_panel)
    d_a, d_y, d_e = DECIMALS["anomaly_pct"], DECIMALS["yield_t_ha"], DECIMALS["exposure"]
    files, counts_all, counts_world, defaults, years_of = {}, {}, {}, {}, {}
    for fam in families:
        tf = t[t.fam.eq(fam)].sort_values(["series_id", "harvest_year"])
        world_ids = {int(v[4]) for v in (world_units.get("units", {}).get(fam, {}) or {}).values()} | {int(v[0]) for v in nat.get(fam, {}).values()}
        ser, n_values = {}, 0
        for sid, g in tf.groupby("series_id", sort=False):
            y = g.harvest_year.to_numpy(dtype=int)
            first, last = int(y.min()), int(y.max())
            n = last - first + 1
            A, Y, E = [None] * n, [None] * n, [None] * n
            for yr, a, v, x in zip(y, g.anomaly_pct.to_numpy(), g.yield_t_ha.to_numpy(), g.exposure.to_numpy()):
                i = int(yr) - first
                A[i], Y[i], E[i] = num(a, d_a), num(v, d_y), num(x, d_e)
            ser[str(int(sid))] = [first, A, Y, E]
            n_values += len(y)
        c_all = tf.groupby("harvest_year").size()
        c_world = tf[tf.series_id.isin(world_ids)].groupby("harvest_year").size()
        counts_all[fam] = {int(k): int(v) for k, v in c_all.items()}
        counts_world[fam] = {int(k): int(v) for k, v in c_world.items()}
        defaults[fam] = default_year(counts_world[fam])
        years_of[fam] = [int(tf.harvest_year.min()), int(tf.harvest_year.max())] if len(tf) else [year_first, year_first]
        path = folder / f"{fam}.json"
        size = write(path, dict(release=release, contract=contract, layer="anomaly", family=fam, columns=COLUMNS, decimals={k: DECIMALS[k] for k in COLUMNS},
                                encoding=ENCODING, year_first=year_first, years=years_of[fam], default_year=defaults[fam], n_series=len(ser), n_values=n_values,
                                national=nat.get(fam, {}), counts=counts_all[fam], counts_world=counts_world[fam], series=ser))
        files[fam] = dict(path=f"anomalies/{fam}.json", bytes=size, sha256=sha(path), n_series=len(ser), n_values=n_values, n_national=len(nat.get(fam, {})))
    last = max(v[1] for v in years_of.values())
    djf = djf_relative(monthly, range(year_first, last + 1))
    mp = Path(monthly_path) if monthly_path else None
    source = (str(mp.resolve().relative_to(ATLAS)) if mp and mp.resolve().is_relative_to(ATLAS) else mp.name) if mp else "monthly_indices.csv"
    index_meta = dict(source=source, column=INDEX_COLUMN,
                      definition="mean of the monthly relative Nino 3.4 over December of the previous year, January and February of the harvest year; null where a month is missing",
                      sha256=sha(monthly_path) if monthly_path and Path(monthly_path).exists() else None, decimals=DECIMALS["djf"])
    index = dict(release=release, contract=contract, layer="anomaly", families=list(families), columns=COLUMNS, decimals=DECIMALS, encoding=ENCODING,
                 year_first=year_first, years={f: years_of[f] for f in families}, default_year=defaults, counts=counts_all, counts_world=counts_world,
                 djf_relative_n34=djf, index=index_meta, selection=SELECTION, trend=TREND, files=files)
    size = write(folder / "index.json", index)
    info = dict(files=dict(files, index=dict(path="anomalies/index.json", bytes=size, sha256=sha(folder / "index.json"))), year_first=year_first,
                series=int(sum(f["n_series"] for f in files.values())), values=int(sum(f["n_values"] for f in files.values())),
                national=int(sum(f["n_national"] for f in files.values())), index=index_meta, wall_seconds=round(time.monotonic() - started, 1))
    return info


# ---- standalone: the inputs from an exported site folder and the release tables ---------------------------------------
def best_panels(world: dict) -> dict:
    cols = world["columns"]["panels"]
    best = {}
    for row in world["panels"]:
        r = dict(zip(cols, row))
        fam, iso, prod = r["crop_family"], r["iso3"], r["baseline_production_mt"] or 0
        if fam and ((fam, iso) not in best or prod > best[(fam, iso)][1]):
            best[(fam, iso)] = (r["key"], prod)
    return {k: v[0] for k, v in best.items()}


def series_from_site(base: Path, results: Path, cat: dict) -> pd.DataFrame:
    """The series catalog from units/<ISO>.json; for a country without a units file, from the release tables and its national shard."""
    rows, covered = [], set()
    for p in sorted((base / "units").glob("*.json")):
        u = json.loads(p.read_text())
        covered.add(u["iso3"])
        for ukey, unit in u["units"].items():
            for s in unit["series"]:
                rows.append(dict(series_id=int(s["id"]), iso3=u["iso3"], crop_code=s["crop_code"], season=s["season"], crop_family=s["crop_family"], unit_key=ukey,
                                 tier=int(s["tier"]), n_obs=int(s.get("n") or 0), display_points=bool(s["display_points"]), national=unit["level"] == "national"))
    fam_of = {code: c["family"] for code, c in cat["crops"].items()}
    ts = pd.read_parquet(results / "trend_series.parquet", columns=["series_id", "iso3", "crop_code", "season", "n_years"])
    ts = ts[~ts.iso3.isin(covered) & ts.crop_code.isin(fam_of)]
    if len(ts):
        keys = []
        for name, cols in (("weights", ["series_id", "unit_key", "tier"]), ("response_leaf", ["series_id", "unit_key"])):
            p = results / f"{name}.parquet"
            if p.exists():
                keys.append(pd.read_parquet(p, columns=cols).drop_duplicates("series_id"))
        uk = pd.concat(keys).drop_duplicates("series_id").set_index("series_id") if keys else pd.DataFrame(columns=["unit_key", "tier"])
        shards = {}
        for p in sorted((base / "records").glob("*/")):
            f = p / f"{p.name}.json"
            if f.exists():
                for sid, rec in json.loads(f.read_text())["series"].items():
                    shards[int(sid)] = (p.name, rec)
        sources = {k: v for k, v in cat["sources"].items() if v.get("role") == "yield"}
        all_public = all(v.get("permission", {}).get("display_points") for v in sources.values())
        for r in ts.itertuples(index=False):
            sid = int(r.series_id)
            unit_key = uk.unit_key.get(sid) if sid in uk.index else None
            tier = int(uk.tier.get(sid)) if sid in uk.index and "tier" in uk and not _missing(uk.tier.get(sid)) else 3
            national = sid in shards and shards[sid][0] == r.iso3 or (isinstance(unit_key, str) and unit_key == r.iso3)
            public = bool(shards[sid][1]["display_points"]) if sid in shards else all_public
            if sid not in shards and not all_public:
                continue                                   # the publication rule cannot be resolved without the units file or the database
            rows.append(dict(series_id=sid, iso3=r.iso3, crop_code=r.crop_code, season=r.season, crop_family=fam_of[r.crop_code],
                             unit_key=unit_key if isinstance(unit_key, str) else (r.iso3 if national else f"?{r.iso3}:{sid}"),
                             tier=tier, n_obs=int(r.n_years), display_points=public, national=bool(national)))
    return pd.DataFrame(rows).drop_duplicates("series_id")


def update_manifest(base: Path, info: dict) -> None:
    mp = base / "manifest.json"
    manifest = json.loads(mp.read_text())
    for p in sorted((base / "anomalies").glob("*.json")):
        manifest["files"][f"anomalies/{p.name}"] = dict(sha256=sha(p), bytes=p.stat().st_size)
    manifest["anomalies"] = info
    manifest.setdefault("counts", {})["anomaly_series"] = info["series"]
    manifest["counts"]["anomaly_values"] = info["values"]
    _write(mp, manifest)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--release", default=None, help="site release (default: releases.json default)")
    ap.add_argument("--site", type=Path, default=SITE_DATA, help="site/data folder")
    ap.add_argument("--results", type=Path, default=None, help="release tables folder (default: the manifest's results path, resolved against the project root)")
    ap.add_argument("--monthly-index", type=Path, default=ATLAS / "monthly_indices.csv")
    ap.add_argument("--exposures", type=Path, default=None, help="a parquet table with series_id, harvest_year, exposure (default: enso_relationship_points ly/rel)")
    ap.add_argument("--update-manifest", action="store_true", help="add the files to manifest.json")
    a = ap.parse_args()
    releases = json.loads((a.site / "releases.json").read_text())
    release = a.release or releases["default"]
    base = a.site / release
    manifest = json.loads((base / "manifest.json").read_text())
    cat = json.loads((base / "catalog.json").read_text())
    world = json.loads((base / "world.json").read_text())
    wu = json.loads((base / "world_units.json").read_text())
    if a.results is None:
        enso_root = next((p for p in ATLAS.parents if (p / "project.toml").is_file()), ATLAS.parent)
        a.results = enso_root / manifest["results"]["path"]
    series = series_from_site(base, a.results, cat)
    ta = pd.read_parquet(a.results / "trend_anomaly.parquet")
    if a.exposures:
        ex = pd.read_parquet(a.exposures)
    else:
        rp = pd.read_parquet(a.results / "enso_relationship_points.parquet", columns=["series_id", "harvest_year", "variable", "index", "exposure"])
        ex = rp[rp.variable.eq("ly") & rp["index"].eq("rel")][["series_id", "harvest_year", "exposure"]]
    monthly = pd.read_csv(a.monthly_index)
    info = build(base, release, manifest["contract"], cat["families"], series, ta, ex, best_panels(world), wu, monthly, a.monthly_index)
    if a.update_manifest:
        update_manifest(base, info)
    print(json.dumps({k: v for k, v in info.items() if k != "files"}), flush=True)
    for fam, f in info["files"].items():
        print(f"  {f['path']}: {f['bytes']/1e6:.1f} MB" + (f", {f['n_series']} series, {f['n_values']} values, {f['n_national']} national" if "n_series" in f else ""))


if __name__ == "__main__":
    main()
