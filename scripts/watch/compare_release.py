"""Record release changes and the headline over a common set of crop seasons."""

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
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--previous', required=True)
    parser.add_argument('--current', required=True)
    args = parser.parse_args()
    folders = [ROOT / 'watch' / 'data' / x for x in [args.previous, args.current]]
    old, new = [_loads_record((p / 'panels.json').read_text()) for p in folders]
    key = lambda p: (p['iso3'], p['crop_code'], p['season'])
    old = {key(p): p for p in old}
    new = {key(p): p for p in new}
    rows = []
    for k in sorted(old.keys() | new.keys()):
        a, b = old.get(k), new.get(k)
        row = dict(country=k[0], crop=k[1], season=k[2])
        def values(p):
            if p is None:
                return None
            weather = p['season_so_far'] or {}
            return dict(status=p['status'], target_year=p['target_year'],
                        expected_pct=p['expected']['pct_medium'],
                        rain_anomaly_pct=weather.get('rain_obs_pct'),
                        tmax_anomaly_c=weather.get('tmax_obs'),
                        weather_implied_pct=p['implied']['nowcast_pct'],
                        estimate_se_pct=p['implied']['nowcast_se_pct'],
                        weather_estimate_shown=p['implied']['usable'])
        row.update(previous=values(a), current=values(b))
        if row['previous'] != row['current']:
            rows.append(row)
    common = [k for k in old.keys() & new.keys() if old[k]['implied']['usable'] and new[k]['implied']['usable']]
    denominator = sum(new[k]['production_mt'] for k in common)
    mean = lambda panels: sum(panels[k]['implied']['nowcast_pct'] * new[k]['production_mt'] for k in common) / denominator if denominator else None
    report = dict(previous_issue=args.previous, current_issue=args.current,
                  interpretation='Differences include five additional days of weather, corrected harvest-year alignment, corrected coefficient uncertainty, and production denominators restricted to the preferred source and fitted responses. Changes in eligibility also change the front-page population.',
                  changed_panels=len(rows), expected_changes=sum(old[k]['expected'] != new[k]['expected'] for k in old.keys() & new.keys()),
                  common_eligible_population=dict(panels=len(common), production_mt=round(denominator, 3),
                                                  previous_weather_pct=mean(old), current_weather_pct=mean(new)),
                  panels=rows)
    out = folders[1]
    (out / 'changes.json').write_text(json.dumps(report, indent=1, allow_nan=False) + '\n')
    files = sorted(p for p in out.rglob('*') if p.is_file() and p.name != 'manifest.json')
    manifest = dict(issue=args.current, files={p.relative_to(out).as_posix(): dict(sha256=hashlib.sha256(p.read_bytes()).hexdigest(), bytes=p.stat().st_size) for p in files})
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=1) + '\n')
    print(json.dumps({k:v for k,v in report.items() if k != 'panels'}, indent=2))

if __name__ == '__main__':
    main()
