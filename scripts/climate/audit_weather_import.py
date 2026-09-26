#!/usr/bin/env python3
"""Audit stable atlas joins and recompute representative weather seasons.

No upstream file is modified. Outputs go to ENSO/results/climate_atlas by
default. This is a pilot validation, not the full weather-shard exporter.
"""
import argparse
import csv
import gzip
import hashlib
import json
from pathlib import Path
import sqlite3
import time

import netCDF4
import numpy as np
import pandas as pd
import pyarrow.parquet as pq


ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / "global/data/2026-09-26-merged-v1"


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(4 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def run(enso, output):
    started = time.monotonic()
    source = enso / "2_data/derived/merged_panel"
    weather = enso / "2_data/derived/weather"
    atlas = {}
    for crop in ("maize", "wheat", "rice", "soybean", "sorghum", "cassava"):
        with gzip.open(BASE / (crop + ".json.gz"), "rt") as f:
            for row in json.load(f):
                if row["series_key"] in atlas:
                    raise ValueError("Duplicate series_key in preserved atlas")
                atlas[row["series_key"]] = row
    con = sqlite3.connect((source / "enso_ag.sqlite").as_uri() + "?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    series = [dict(r) for r in con.execute("SELECT s.* FROM series s WHERE EXISTS (SELECT 1 FROM weather_season w WHERE w.series_id=s.series_id)")]
    meta = pd.read_csv(weather / "weather_units.csv").set_index("unit_key")
    crosswalk, changed, unmatched = [], [], []
    for s in series:
        a = atlas.get(s["series_key"])
        if a is None:
            unmatched.append(s["series_id"])
            continue
        sid = hashlib.sha256(s["series_key"].encode()).hexdigest()[:20]
        checks = {"sid": (sid, a["sid"]), "unit": (s["unit_key"], a["id"]),
                  "crop": (s["crop_code"], a["source_crop"]),
                  "season": (s["season_std"], a["season_std"]),
                  "source": (s["source"], a["source"])}
        cal = dict(con.execute("SELECT * FROM calendar WHERE series_id=?", (s["series_id"],)).fetchone())
        for key in ("plant_month", "harvest_month", "season_start_offset", "plant_doy", "harvest_doy", "calendar_source"):
            checks["calendar:" + key] = (cal.get(key), a["calendar"].get(key))
        differences = [key for key, (x, y) in checks.items() if x != y]
        if differences:
            changed.append({"series_key": s["series_key"], "fields": differences})
            continue
        crosswalk.append({"database_series_id": s["series_id"], "sid": sid,
                          "series_key": s["series_key"], "unit_key": s["unit_key"],
                          "country": s["iso3"], "crop": a["crop"],
                          "season": s["season_std"], "source": s["source"]})
    if not crosswalk:
        raise ValueError("No exact weather-to-atlas series matches")
    output.mkdir(parents=True, exist_ok=True)
    with (output / "series_crosswalk.csv").open("w") as f:
        writer = csv.DictWriter(f, fieldnames=list(crosswalk[0]))
        writer.writeheader(); writer.writerows(crosswalk)

    report = {"checked_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
              "atlas_release": BASE.name, "weather_series": len(series),
              "exact_atlas_matches": len(crosswalk), "changed": changed,
              "weather_series_not_in_atlas": len(unmatched), "samples": [],
              "monthly_issues": [], "errors": []}
    # Include source fallback, nearest-cell fill, different countries, a
    # cross-year window and a temperature-truncated season.
    candidates = []
    def choose(label, predicate, year=2020):
        row = next((r for r in crosswalk if predicate(r)), None)
        if row:
            candidates.append((label, row, year))
    choose("Indian maize, including missing temperature", lambda r: r["country"] == "IND" and r["crop"] == "maize")
    choose("rice", lambda r: r["country"] == "CHN" and r["crop"] == "rice")
    choose("southern hemisphere", lambda r: r["country"] == "BRA" and r["crop"] == "maize")
    choose("ERA5 fallback", lambda r: meta.loc[r["unit_key"], "precip_source"] == "era5")
    choose("nearest-cell fill", lambda r: meta.loc[r["unit_key"], "best_nearest_share"] > 0)
    byid = {r["database_series_id"]: r for r in crosswalk}
    for label, query in (
        ("cross-year", "SELECT series_id FROM weather_season WHERE harvest_year=2020 AND substr(window_start,1,4)='2019' AND t_coverage=1 AND p_coverage=1 LIMIT 200"),
        ("partial temperature", "SELECT series_id FROM weather_season WHERE harvest_year=2024 AND t_coverage>0 AND t_coverage<1 LIMIT 200"),
    ):
        match = next((r[0] for r in con.execute(query) if r[0] in byid), None)
        if match is not None:
            candidates.append((label, byid[match], 2024 if label.startswith("partial") else 2020))
    with netCDF4.Dataset(weather / "unit_daily_temperature.nc") as t, netCDF4.Dataset(weather / "unit_daily_precip.nc") as p:
        keys = t["unit_key"][:].tolist(); positions = {k: j for j, k in enumerate(keys)}
        def dates(ds):
            v = ds["time"]
            return np.array([str(d)[:10] for d in netCDF4.num2date(v[:], v.units)], dtype="datetime64[D]")
        td, pdays = dates(t), dates(p)
        for label, item, year in candidates:
            row = dict(con.execute("SELECT * FROM weather_season WHERE series_id=? AND harvest_year=?", (item["database_series_id"], year)).fetchone())
            start, end = np.datetime64(row["window_start"]), np.datetime64(row["window_end"])
            j = positions[item["unit_key"]]
            def values(ds, dsdates, name):
                lo = np.searchsorted(dsdates, start, side="left")
                hi = np.searchsorted(dsdates, end, side="right")
                return np.ma.filled(ds[name][lo:hi, j], np.nan).astype(float)
            tx = values(t, td, "tmax"); ta = values(t, td, "tavg"); pr = values(p, pdays, "precip")
            nd = int((end - start) / np.timedelta64(1, "D")) + 1
            nt, npday = int(np.isfinite(tx).sum()), int(np.isfinite(pr).sum())
            wet = pr[np.isfinite(pr) & (pr >= 1)]
            expected = {
                "tavg_mean": float(np.nanmean(ta)) if nt / nd >= .9 else None,
                "tmax_p95_season": float(np.nanpercentile(tx, 95)) if nt / nd >= .9 else None,
                "precip": float(np.nansum(pr)) if npday / nd >= .9 else None,
                "precip_wetday_p95_season": float(np.percentile(wet, 95)) if npday / nd >= .9 and len(wet) >= 5 else None,
            }
            failures = []
            for key, value in expected.items():
                actual = row[key]
                if value is None:
                    good = actual is None
                else:
                    good = actual is not None and bool(np.isclose(value, actual, atol=1e-4, rtol=2e-6))
                if not good:
                    failures.append({"metric": key, "export": actual, "daily_recomputation": value})
            if row["n_days"] != nd or row["t_coverage"] != round(nt/nd, 3) or row["p_coverage"] != round(npday/nd, 3):
                failures.append({"metric": "date or coverage mismatch"})
            sample = {"case": label, "sid": item["sid"], "unit_key": item["unit_key"], "crop": item["crop"], "season": item["season"], "year": year,
                      "window_start": str(start), "window_end": str(end), "expected_days": nd,
                      "valid_tmax_days": nt, "valid_tavg_days": int(np.isfinite(ta).sum()),
                      "valid_precip_days": npday, "wet_days": len(wet),
                      "mean_precip_mm_day": float(np.nanmean(pr)) if npday else None,
                      "complete_for_temperature": nt == nd, "complete_for_precipitation": npday == nd,
                      "source_metrics": expected, "failures": failures}
            report["samples"].append(sample)
            if failures:
                report["errors"].append(label)
    con.close()

    monthly = pq.ParquetFile(source / "export/weather_monthly.parquet")
    invalid_months, december_2025 = 0, 0
    for batch in monthly.iter_batches(columns=["year", "month"], batch_size=262144):
        a = batch.to_pandas()
        invalid_months += int((~a.month.between(1, 12)).sum())
        december_2025 += int(((a.year == 2025) & (a.month == 12)).sum())
    if invalid_months:
        report["monthly_issues"].append({"invalid_month_rows": invalid_months,
            "action": "Do not import monthly dates as written. Rebuild monthly metrics from daily dates; check for December encoded as month 0 of the following year."})
    if december_2025 != len(meta):
        report["monthly_issues"].append({"december_2025_rows": december_2025, "expected_units": len(meta),
            "action": "Recover the final month from the daily file; relabelling existing rows alone is insufficient."})
    report["season_pilot_passed"] = not report["errors"] and not changed
    report["monthly_export_safe_to_import"] = not report["monthly_issues"]
    report["source_sha256"] = {str(p.relative_to(enso)): digest(p) for p in (
        source / "export/weather_season.parquet", source / "export/weather_monthly.parquet",
        weather / "weather_units.csv", enso / "2_data/build/22_weather_seasons.py")}
    report["wall_seconds"] = round(time.monotonic() - started, 1)
    (output / "import-audit.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    print(json.dumps({k: v for k, v in report.items() if k not in ("samples", "source_sha256", "changed")}, indent=2))
    return 0 if report["season_pilot_passed"] else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--enso-root", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    a = parser.parse_args(); enso = a.enso_root.resolve()
    raise SystemExit(run(enso, a.output or enso / "results/climate_atlas"))
