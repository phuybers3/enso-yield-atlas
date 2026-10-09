"""Acceptance check of the migration: the site's panel headlines and world rows equal the results exactly.

    python tests/acceptance.py [--release 2026-10-08]

For every panel, the medium index_outlook row of panels.json (pct, lo, hi, production_mt, n_series, status) must equal
prediction_panel.parquet without rounding; every row of world.json must equal prediction_world.parquet without
rounding; and the weather-implied headline must equal the results manifest. The four panels the review named are
printed.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

ATLAS = Path(__file__).resolve().parents[1]
ENSO = ATLAS.parents[1]
NAMED = ["USA|maize|main", "IND|rice_milled|Kharif", "BRA|maize|main", "ARG|maize|main"]


def eq(site, source) -> bool:
    """Exact equality, with null on the site standing for a missing results value."""
    source = float(source)
    return site is None if source != source else site == source


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--release", default="2026-10-08")
    a = ap.parse_args()
    base = ATLAS / "site" / "data" / a.release
    results = ENSO / "4_ag/results" / a.release
    pp = pd.read_parquet(results / "prediction_panel.parquet")
    pw = pd.read_parquet(results / "prediction_world.parquet")
    rman = json.loads((results / "manifest.json").read_text())
    panels = {p["key"]: p for p in json.loads((base / "panels.json").read_text())}
    world = json.loads((base / "world.json").read_text())
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
    print(f"PASS acceptance {a.release}: {n} panel medium rows, {len(weather)} weather rows and {len(pw)} world rows equal the results exactly; "
          f"headline {rman['headline']['weather_implied_pct']}% weather-implied against {rman['headline']['index_implied_pct']}% index-implied over {rman['headline']['panels']} panels, {rman['headline']['production_mt']} Mt")
    for key in NAMED:
        p = panels[key]
        m = next(x for x in p["predictions"] if x["method"] == "index_outlook" and x["scenario"] == "medium")
        w = p["weather"]
        print(f"  {p['label']}: {p['status']}, harvest {p['harvest_year']}, medium {m['pct']:+.3f}% ({m['lo']:+.2f} to {m['hi']:+.2f}), "
              + (f"weather {w['pct_panel']:+.3f} ± {w['se_panel']:.3f} at lead {w['lead']}, {'usable' if w['usable_panel'] else 'not usable'}" if w else "no weather row"))


if __name__ == "__main__":
    main()
