"""Export existing calendar windows without changing the release's analysis."""

# Locate the checkout independently of the working directory or machine.
from pathlib import Path as _ProjectPath
import sys as _project_sys
_ENSO_ROOT = next(p for p in _ProjectPath(__file__).resolve().parents if (p / "project.toml").is_file())
if str(_ENSO_ROOT) not in _project_sys.path:
    _project_sys.path.append(str(_ENSO_ROOT))
from enso_project import path as _project_path, resolve_path as _resolve_path
from enso_project import load_record as _load_record, loads_record as _loads_record

from pathlib import Path
from datetime import date, timedelta, datetime, timezone
import argparse
import hashlib
import json
import math
import sqlite3

ATLAS = Path(__file__).resolve().parents[1]
ENSO = next((p for p in ATLAS.parents if (p / "project.toml").is_file()), ATLAS.parent)
COLUMNS = ["harvest_year", "plant_date", "harvest_date", "plant_start_date",
           "plant_end_date", "fill_start_date", "fill_end_date",
           "harvest_start_date", "harvest_end_date"]


def sha(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def month_day(doy):
    if doy is None or not math.isfinite(doy) or doy < 1 or doy > 732:
        return None
    d = math.floor(doy + 0.5)
    if d > 366:
        d -= 365
    ref = date(2001, 1, 1) + timedelta(days=min(d, 365) - 1)
    return ref.month, ref.day


def dated_window(first, last, anchor):
    """Place a source window around its dated peak, including New Year."""
    a, b = month_day(first), month_day(last)
    if not a or not b or not anchor:
        return None, None
    peak = date.fromisoformat(anchor[:10])
    choices = []
    for y in range(peak.year - 1, peak.year + 2):
        start = date(y, *a)
        for end_year in (y, y + 1):
            end = date(end_year, *b)
            if start <= peak <= end and (end - start).days <= 366:
                choices.append((end - start, start, end))
    if not choices:
        return None, None
    _, start, end = min(choices)
    return start.isoformat(), end.isoformat()


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False))


def export_details(db_path, out, release, years, unit_keys=None):
    out = Path(out)
    years = sorted(set(map(int, years)))
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    query = """SELECT s.iso3, s.unit_key, s.tier, c.*, w.harvest_year,
        w.start_date, w.end_date, w.fill_start_date, w.fill_end_date
        FROM calendar c JOIN series s USING(series_id)
        JOIN season_windows w USING(series_id)
        WHERE s.staple=1 AND w.harvest_year BETWEEN ? AND ?"""
    params = [min(years), max(years)]
    if unit_keys:
        query += " AND s.unit_key IN (" + ",".join("?" for _ in unit_keys) + ")"
        params.extend(unit_keys)
    query += " ORDER BY s.iso3,c.series_id,w.harvest_year"
    countries, world = {}, {}
    counts = dict(rows=0, planting_windows=0, harvest_windows=0, filling_windows=0)
    for row in con.execute(query, params):
        if row["harvest_year"] not in years or row["plant_month"] is None or row["harvest_month"] is None:
            continue
        sid = str(row["series_id"])
        entries = countries.setdefault(row["iso3"], {})
        entry = entries.setdefault(sid, dict(source=row["calendar_source"], rows=[]))
        ps, pe = dated_window(row["plant_doy_start"], row["plant_doy_end"], row["start_date"])
        hs, he = dated_window(row["harvest_doy_start"], row["harvest_doy_end"], row["end_date"])
        fs, fe = row["fill_start_date"], row["fill_end_date"]
        # Existing season-window repairs are authoritative. Do not revive a dropped stage.
        if not fs or not fe or fs > fe:
            fs = fe = None
        if fs:
            entry["fill_source"] = "Hultgren local grain-filling calendar"
        values = [row["harvest_year"], row["start_date"], row["end_date"], ps, pe, fs, fe, hs, he]
        entry["rows"].append(values)
        if row["tier"] == 3:
            world[sid] = entry
        counts["rows"] += 1
        counts["planting_windows"] += ps is not None
        counts["harvest_windows"] += hs is not None
        counts["filling_windows"] += fs is not None
    con.close()
    dest = out / "calendar_details"
    for iso, entries in countries.items():
        write(dest / f"{iso}.json", dict(release=release, columns=COLUMNS, series=entries))
    write(dest / "world.json", dict(release=release, columns=COLUMNS, series=world))
    audit = dict(release=release, built_utc=datetime.now(timezone.utc).isoformat(),
                 database=dict(path=str(db_path), sha256=sha(db_path)),
                 exporter_sha256=sha(__file__), years=years, counts=counts,
                 interpretation="Typical calendars, not observed current-year planting or crop development.",
                 dates="Stage endpoints are existing season_windows dates. Planting and harvest ranges use the calendar table's source start/end days, placed around the selected peak with the same 365-day reference convention. No stage duration is inferred.",
                 alignment="The browser uses details only when their planting date, harvest date and source match the published calendar row.")
    write(dest / "manifest.json", audit)
    return audit


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--release", required=True)
    ap.add_argument("--out", required=True, type=Path, help="Staging directory outside the atlas checkout; output is reviewed before installation.")
    ap.add_argument("--unit", action="append")
    args = ap.parse_args()
    release_dir = ATLAS / "site/data" / args.release
    out = args.out.resolve()
    assert not out.is_relative_to(ATLAS), "Stage the calendar export outside the atlas checkout."
    manifest = _loads_record((release_dir / "manifest.json").read_text())
    db = Path(manifest["database"]["path"])
    if not db.is_absolute():
        db = ENSO / db
    assert sha(db) == manifest["database"]["sha256"], "Release database changed; rebuild the release before attaching calendars."
    wc = release_dir / "calendar_world.json"
    years = _loads_record(wc.read_text()).get("harvest_years", [2024, 2025, 2026, 2027]) if wc.exists() else [2024, 2025, 2026, 2027]
    audit = export_details(db, out, args.release, years, args.unit)
    print(args.release, audit["counts"])


if __name__ == "__main__":
    main()
