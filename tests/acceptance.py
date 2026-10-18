"""Acceptance check of a release: the site's headline rows equal the results exactly, and the first screen is small.

    python tests/acceptance.py [--release R]        # every release of releases.json when none is named

For a release under the contract of 8 October 2026, the medium index_outlook row of panels.json and every row of
world.json must equal prediction_panel and prediction_world without rounding, and the weather-implied headline the
results manifest. For the contract of 9 October 2026 (the hierarchical candidate), every row of world.json's `world`
list must equal prediction_world and the aggregate world row without rounding; every panel's medium index_outlook
row in countries/<ISO>.json must equal prediction_panel without rounding, and its compact row in world.json the same
values at the manifest's precision; and the first-screen files (index.html, app.js, style.css, calendar.js, the
MapLibre script and stylesheet, releases.json, world.json, catalog.json and the world outlines) must total under
3 MB raw (3,000,000 bytes), the limit of the development plan of 9 October 2026. The four panels the review named
are printed.
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
import json
import math
from pathlib import Path

import pandas as pd

ATLAS = Path(__file__).resolve().parents[1]
ENSO = next((p for p in ATLAS.parents if (p / "project.toml").is_file()), ATLAS.parent)
SITE = ATLAS / "site"
NAMED = ["USA|maize|main", "IND|rice_milled|Kharif", "BRA|maize|main", "ARG|maize|main"]
CONTRACT_V2 = "2026-10-09"
FIRST_SCREEN = ["index.html", "app.js", "style.css", "regional-page.js", "regional-page.css", "calendar-bar.js", "calendar-bar.css", "calendar-page.js", "calendar.js", "vendor/maplibre-gl.js", "vendor/maplibre-gl.css", "data/releases.json",
                "data/{release}/world.json", "data/{release}/catalog.json", "data/{release}/geometry/world.json"]
PAYLOAD_LIMIT = 3_000_000


def eq(site, source) -> bool:
    """Exact equality, with null on the site standing for a missing results value."""
    source = float(source)
    return site is None if source != source else site == source


def eq_round(site, source, d) -> bool:
    source = float(source)
    return site is None if source != source else site == (source if d is None else round(source, d))


def check_legacy(release: str) -> None:
    base = SITE / "data" / release
    results = ENSO / "analysis/releases/crops" / release
    pp = pd.read_parquet(results / "prediction_panel.parquet")
    pw = pd.read_parquet(results / "prediction_world.parquet")
    rman = _loads_record((results / "manifest.json").read_text())
    panels = {p["key"]: p for p in _loads_record((base / "panels.json").read_text())}
    world = _loads_record((base / "world.json").read_text())
    med = pp[pp.method.eq("index_outlook") & pp.scenario.eq("medium")]
    assert len(med) == len(panels), f"{len(med)} medium rows in results, {len(panels)} panels on the site"
    n = 0
    for r in med.itertuples(index=False):
        key = f"{r.iso3}|{r.crop_code}|{r.season}"
        p = panels[key]
        row = next(x for x in p["predictions"] if x["method"] == "index_outlook" and x["scenario"] == "medium")
        for c in ("pct", "lo", "hi", "production_mt", "local_share", "usable_share"):
            assert eq(row[c], getattr(r, c)), f"{key}: {c} {row[c]!r} != {getattr(r, c)!r}"
        assert row["n_series"] == int(r.n_series) and row["status"] == r.status and row["harvest_year"] == int(r.harvest_year), key
        assert p["production_mt"] == float(r.production_mt) and p["status"] == r.status, key
        n += 1
    weather = pp[pp.method.eq("weather_todate")]
    for r in weather.itertuples(index=False):
        row = next(x for x in panels[f"{r.iso3}|{r.crop_code}|{r.season}"]["predictions"] if x["method"] == "weather_todate")
        assert all(eq(row[c], getattr(r, c)) for c in ("pct", "lo", "hi", "production_mt")), f"weather row {r.iso3} {r.crop_code} {r.season}"
    assert len(world["world"]) == len(pw)
    for r in pw.itertuples(index=False):
        row = next(x for x in world["world"] if (x["crop_family"], x["method"], x["scenario"]) == (r.crop_family, r.method, r.scenario))
        for c in ("dprod_mt", "pct", "lo", "hi", "production_mt", "coverage_share"):
            assert eq(row[c], getattr(r, c)), f"world {r.crop_family} {r.method} {r.scenario}: {c}"
    assert world["headline"] == rman["headline"], "headline differs from the results manifest"
    print(f"PASS acceptance {release}: {n} panel medium rows, {len(weather)} weather rows and {len(pw)} world rows equal the results exactly; "
          f"headline {rman['headline']['weather_implied_pct']}% weather-implied against {rman['headline']['index_implied_pct']}% index-implied over {rman['headline']['panels']} panels, {rman['headline']['production_mt']} Mt")
    for key in NAMED:
        p = panels[key]
        m = next(x for x in p["predictions"] if x["method"] == "index_outlook" and x["scenario"] == "medium")
        w = p["weather"]
        print(f"  {p['label']}: {p['status']}, harvest {p['harvest_year']}, medium {m['pct']:+.3f}% ({m['lo']:+.2f} to {m['hi']:+.2f}), "
              + (f"weather {w['pct_panel']:+.3f} ± {w['se_panel']:.3f} at lead {w['lead']}, {'usable' if w['usable_panel'] else 'not usable'}" if w else "no weather row"))


def check_v2(release: str) -> None:
    base = SITE / "data" / release
    manifest = _loads_record((base / "manifest.json").read_text())
    results = ENSO / manifest["results"]["path"]
    P = manifest["precision"]["decimals"]
    pp = pd.read_parquet(results / "prediction_panel.parquet")
    pw = pd.read_parquet(results / "prediction_world.parquet")
    ag = pd.read_parquet(results / "aggregate.parquet")
    world = _loads_record((base / "world.json").read_text())
    cat = _loads_record((base / "catalog.json").read_text())
    wp = {r[0]: dict(zip(world["columns"]["panels"], r)) for r in world["panels"]}
    pp = pp[pp.crop_code.isin(set(cat["crops"]))]
    med = pp[pp.method.eq("index_outlook") & pp.scenario.eq("medium")]
    assert len(med) == len(wp), f"{len(med)} medium rows in results, {len(wp)} panels in world.json"
    countries = {}
    n = 0
    for r in med.itertuples(index=False):
        key = f"{r.iso3}|{r.crop_code}|{r.season}"
        if r.iso3 not in countries:
            countries[r.iso3] = _loads_record((base / "countries" / f"{r.iso3}.json").read_text())
        cf = countries[r.iso3]
        p = next(x for x in cf["panels"] if x["key"] == key)
        cols = cf["columns"]["predictions"]
        row = next(dict(zip(cols, x)) for x in p["predictions"] if x[cols.index("method")] == "index_outlook" and x[cols.index("scenario")] == "medium")
        for c in ("pct", "lo", "hi", "se", "production_mt", "local_share", "usable_share"):
            assert eq(row[c], getattr(r, c)), f"{key}: {c} {row[c]!r} != {getattr(r, c)!r}"
        assert row["n_series"] == int(r.n_series) and row["status"] == r.status and row["harvest_year"] == int(r.harvest_year), key
        assert p["baseline_production_mt"] == float(r.production_mt) and p["status"] == r.status and p["harvest_year"] == int(r.harvest_year), key
        w = wp[key]
        d = P["world.json.panels"]
        for c in ("pct", "lo", "hi", "se", "local_share"):
            assert eq_round(w[c], getattr(r, c), d), f"world.json {key}: {c} {w[c]!r} against {getattr(r, c)!r} at {d} decimals"
        assert eq_round(w["baseline_production_mt"], r.production_mt, d) and w["status"] == r.status and w["harvest_year"] == int(r.harvest_year) and w["n_series"] == int(r.n_series), key
        n += 1
    agw = ag[ag.level.eq("world")]
    assert len(world["world"]) == len(pw) == len(agw)
    for r in pw.itertuples(index=False):
        row = next(x for x in world["world"] if (x["crop_family"], x["method"], x["scenario"]) == (r.crop_family, r.method, r.scenario))
        for c in ("dprod_mt", "pct", "lo", "hi", "production_mt", "coverage_share"):
            assert eq(row[c], getattr(r, c)), f"world {r.crop_family} {r.method} {r.scenario}: {c}"
        a = agw[agw.key.eq(r.crop_family) & agw.method.eq(r.method) & agw.scenario.eq(r.scenario)].iloc[0]
        for c, src in (("lo_resp", "pct_lo_resp"), ("hi_resp", "pct_hi_resp"), ("dprod_lo", "dprod_lo"), ("dprod_hi", "dprod_hi"), ("dprod_mt_point", "dprod_mt_point")):
            assert eq(row[c], a[src]), f"world {r.crop_family} {r.method} {r.scenario}: {c}"
        assert eq(row["dprod_mt"], a["dprod_mt_mean"]) and eq(row["pct"], a["pct_mean"]), f"world {r.crop_family}: prediction_world and aggregate disagree"
    # ---- the first screen -------------------------------------------------------------------------------------------
    sizes = {f.format(release=release): (SITE / f.format(release=release)).stat().st_size for f in FIRST_SCREEN}
    total = sum(sizes.values())
    assert total < PAYLOAD_LIMIT, f"first-screen payload {total:,} bytes is not under {PAYLOAD_LIMIT:,}"
    print(f"PASS acceptance {release} (contract {CONTRACT_V2}): {n} panel medium rows and {len(pw)} world rows equal prediction_panel, prediction_world and the aggregate "
          f"world rows exactly in countries/<ISO>.json and world.json; first screen {total:,} bytes ({total/1e6:.2f} MB raw) under {PAYLOAD_LIMIT/1e6:.0f} MB: "
          + ", ".join(f"{k.split('/')[-1]} {v/1e6:.2f}" for k, v in sizes.items() if v > 50_000))
    medium = {(x["crop_family"], x["scenario"]): x for x in world["world"] if x["method"] == "index_outlook"}
    print("  world medium outlook, Mt: " + "; ".join(f"{fam} {medium[(fam, 'medium')]['dprod_mt']:+.1f} [{medium[(fam, 'medium')]['dprod_lo']:+.1f}, {medium[(fam, 'medium')]['dprod_hi']:+.1f}], "
                                                      f"response only [{medium[(fam, 'medium')]['dprod_lo_resp']:+.1f}, {medium[(fam, 'medium')]['dprod_hi_resp']:+.1f}]" for fam in cat["families"] if (fam, "medium") in medium))
    for key in NAMED:
        w = wp.get(key)
        if w is None:
            print(f"  {key}: not a panel of this release"); continue
        print(f"  {key}: {w['status']}, harvest {w['harvest_year']}, medium {w['pct']:+.3f}% (prediction interval {w['lo']:+.2f} to {w['hi']:+.2f}; response alone {w['lo_resp']:+.2f} to {w['hi_resp']:+.2f}), "
              f"{w['n_series']} series, {w['baseline_production_mt']:.1f} Mt baseline, own-data share {w['local_share']:.2f}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--release", help="one release; every release of releases.json when absent")
    a = ap.parse_args()
    releases = _loads_record((SITE / "data" / "releases.json").read_text())
    targets = [a.release] if a.release else [r["release"] for r in releases["releases"]]
    for release in targets:
        contract = _loads_record((SITE / "data" / release / "manifest.json").read_text()).get("contract")
        (check_v2 if contract == CONTRACT_V2 else check_legacy)(release)


if __name__ == "__main__":
    main()
