#!/usr/bin/env python3
"""Read-only readiness check for the combined atlas's upstream weather exports.

Run with the ENSO Python environment (pandas, pyarrow, netCDF4). Exit 0 means
ready to import, 2 means pending, and 1 means an invalid completed export.
This is an import gate, not scientific validation of every weather metric.
"""
import argparse
import json
from pathlib import Path
import re
import sqlite3
import subprocess
import time


REQUIRED = (
    "2_data/derived/weather/unit_daily_temperature.nc",
    "2_data/derived/weather/unit_daily_precip.nc",
    "2_data/derived/weather/weather_units.csv",
    "2_data/derived/merged_panel/export/weather_monthly.parquet",
    "2_data/derived/merged_panel/export/weather_season.parquet",
    "2_data/derived/merged_panel/export/weather_season.csv.gz",
    "2_data/derived/merged_panel/enso_ag.sqlite",
    "results/22_weather_seasons.csv",
)
SEASON_COLUMNS = {
    "series_id", "harvest_year", "window_start", "window_end", "n_days",
    "t_coverage", "p_coverage", "tavg_mean", "tmax_p95_season", "precip",
    "precip_wetday_p95_season",
}


def inspect(root, settle_seconds=120):
    report = {"checked_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
              "status": "pending", "ready_for_import": False,
              "pending": [], "errors": [], "files": {}}
    for rel in REQUIRED:
        path = root / rel
        if not path.is_file():
            report["pending"].append(f"Missing {rel}")
            continue
        stat = path.stat()
        report["files"][rel] = {"bytes": stat.st_size, "mtime_ns": stat.st_mtime_ns}
        if not stat.st_size:
            report["pending"].append(f"Empty {rel}")
        if time.time() - stat.st_mtime < settle_seconds:
            report["pending"].append(f"Still settling: {rel}")

    processes = subprocess.run(["ps", "-axo", "pid=,comm=,args="],
                               capture_output=True, text=True, check=True).stdout
    active = []
    for line in processes.splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) != 3 or "python" not in parts[1].lower():
            continue
        if re.search(r"(?:^|[/\s])(?:20_weather_crosswalk|21_weather_units|22_weather_seasons)\.py(?:\s|$)", parts[2]):
            active.append(int(parts[0]))
    report["producer_pids"] = active
    if active:
        report["pending"].append("Weather producer still running")

    log = root / "results/logs/22_weather_seasons.log"
    text = log.read_text(errors="replace") if log.exists() else ""
    # The producer prints its final line only after saving exports and Recorder.
    if not re.search(r"monthly .*rows; season .*rows.*observations joined", text):
        report["pending"].append("No successful final season-export log line")
    if report["pending"]:
        return report

    try:
        import netCDF4
        import pandas as pd
        import pyarrow.parquet as pq

        meta = pd.read_csv(root / REQUIRED[2])
        if meta.unit_key.isna().any() or meta.unit_key.duplicated().any():
            raise ValueError("Weather unit metadata has missing or duplicate keys")
        keys = meta.unit_key.astype(str).tolist()
        report["units"] = len(keys)
        report["precipitation_sources"] = meta.precip_source.value_counts().to_dict()
        report["daily"] = {}
        for rel in REQUIRED[:2]:
            with netCDF4.Dataset(root / rel) as ds:
                if ds.variables["unit_key"][:].tolist() != keys:
                    raise ValueError(f"Unit ordering differs from metadata: {rel}")
                t = ds.variables["time"]
                dates = netCDF4.num2date(t[[0, -1]], t.units)
                report["daily"][Path(rel).name] = {
                    "days": len(t), "first": str(dates[0]), "last": str(dates[1])}
        season = pq.ParquetFile(root / REQUIRED[4])
        missing = SEASON_COLUMNS - set(season.schema_arrow.names)
        if missing:
            raise ValueError(f"Missing season columns: {sorted(missing)}")
        monthly = pq.ParquetFile(root / REQUIRED[3])
        report["season_rows"] = season.metadata.num_rows
        report["monthly_rows"] = monthly.metadata.num_rows
        if min(report["season_rows"], report["monthly_rows"]) == 0:
            raise ValueError("An export has no rows")
        # Read every key column to check that the body, not just the footer, opens.
        n = sum(b.num_rows for b in season.iter_batches(columns=["series_id", "harvest_year"]))
        if n != report["season_rows"]:
            raise ValueError("Season parquet body and metadata counts differ")
        db = root / REQUIRED[6]
        with sqlite3.connect(db.as_uri() + "?mode=ro", uri=True, timeout=2) as con:
            db_rows = con.execute("SELECT COUNT(*) FROM weather_season").fetchone()[0]
            report["database_rows"] = db_rows
            if db_rows != n:
                raise ValueError("Database and season-export row counts differ")
            duplicate = con.execute("SELECT series_id,harvest_year FROM weather_season GROUP BY series_id,harvest_year HAVING COUNT(*)>1 LIMIT 1").fetchone()
            if duplicate:
                raise ValueError(f"Duplicate season key: {duplicate}")
            orphan = con.execute("SELECT w.series_id FROM weather_season w LEFT JOIN series s USING(series_id) WHERE s.series_id IS NULL LIMIT 1").fetchone()
            if orphan:
                raise ValueError(f"Weather series missing from source registry: {orphan}")
        for rel, before in report["files"].items():
            stat = (root / rel).stat()
            if stat.st_size != before["bytes"] or stat.st_mtime_ns != before["mtime_ns"]:
                report["pending"].append(f"Changed during readiness check: {rel}")
        if not report["pending"]:
            report.update(status="ready_for_import", ready_for_import=True)
            report["next"] = "Run the import validation in CLIMATE_ATLAS_PLAN.md before publishing weather values."
    except (ImportError, OSError, ValueError, KeyError, sqlite3.Error) as error:
        report["status"] = "invalid"
        report["errors"].append(str(error))
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--enso-root", type=Path, required=True)
    parser.add_argument("--settle-seconds", type=int, default=120)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = inspect(args.enso_root.expanduser().resolve(), args.settle_seconds)
    text = json.dumps(report, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        tmp = args.output.with_name(args.output.name + ".tmp")
        tmp.write_text(text)
        tmp.replace(args.output)
    print(text, end="")
    return 0 if report["ready_for_import"] else 1 if report["errors"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
