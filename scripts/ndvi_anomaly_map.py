"""A world map of the greenness anomaly so far (14 October 2026, the user's request): one point per reporting unit,
the season-to-date NDVI anomaly of the unit's largest started staple series (ndvi_todate_anomaly of the release's
results, product vhp), from brown (below the unit's own expectation for the same days of the season) to green, with
the units of a country where no season has started left out. Also a second panel of the same anomaly as a z score.

    python scripts/ndvi_anomaly_map.py --release 2026-10-10 [--out site/figures/ndvi_anomaly_<issue>.png]
"""

# Locate the checkout independently of the working directory or machine.
from pathlib import Path as _ProjectPath
import sys as _project_sys
_ENSO_ROOT = next(p for p in _ProjectPath(__file__).resolve().parents if (p / "project.toml").is_file())
if str(_ENSO_ROOT) not in _project_sys.path:
    _project_sys.path.append(str(_ENSO_ROOT))
from enso_project import path as _project_path, resolve_path as _resolve_path
from enso_project import load_record as _load_record, loads_record as _loads_record

from pathlib import Path
import argparse, sqlite3
import numpy as np, pandas as pd
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt

ENSO = Path(str(_ENSO_ROOT))


def main(release, out):
    res = ENSO / 'analysis/releases/crops' / release; na = pd.read_parquet(res / 'ndvi_todate_anomaly.parquet')
    con = sqlite3.connect(f"file:{ENSO / f'data/releases/enso_ag_{release}.sqlite'}?mode=ro", uri=True)
    s = pd.read_sql('SELECT series_id, unit_key, crop_family, staple FROM series', con); u = pd.read_sql('SELECT unit_key, admin_level, lon, lat FROM units', con); con.close()
    d = na.merge(s, on='series_id', how='left', suffixes=('', '_s')).merge(u, on='unit_key', how='left')
    d = d[d.ndvi_mean_anom.notna() & (d.elapsed_days >= 30) & d.staple.astype(float).eq(1.0)]
    d = d.sort_values('prod_series', ascending=False).drop_duplicates('unit_key')   # the unit's largest started staple series
    issue = str(na.issue.iloc[0]); data_end = str(na.data_end.iloc[0])
    fig, axes = plt.subplots(2, 1, figsize=(11, 10.5), dpi=150)
    for ax, col, lim, lab in [(axes[0], 'ndvi_mean_anom', 0.06, 'NDVI anomaly so far (vs the unit\'s own expectation, 2001 on)'), (axes[1], 'ndvi_mean_z', 2.0, 'the same as a z score')]:
        v = d[col].clip(-lim, lim)
        sc = ax.scatter(d.lon, d.lat, c=v, s=np.where(d.admin_level.astype(str).eq('national'), 30, 4), cmap='BrBG', vmin=-lim, vmax=lim, linewidths=0, alpha=.9, rasterized=True)
        ax.set_xlim(-130, 180); ax.set_ylim(-57, 72); ax.set_aspect('equal'); ax.grid(alpha=.2); ax.set_title(lab, fontsize=11, loc='left')
        cb = fig.colorbar(sc, ax=ax, shrink=.75, pad=.02); cb.set_label('NDVI' if col == 'ndvi_mean_anom' else 'z')
    fig.suptitle(f'Greenness of the growing seasons under way: crop-weighted NOAA STAR VHP NDVI to {data_end}, {len(d):,} units (release {release}, issue {issue})', fontsize=10)
    fig.tight_layout(); out = Path(out or (ENSO / f'atlas/site/figures/ndvi_anomaly_{issue}.png')); out.parent.mkdir(parents=True, exist_ok=True); fig.savefig(out); print('written', out, len(d), 'units')
    print('share of units greener than expected:', round(float((d.ndvi_mean_anom > 0).mean()), 3), '| median z', round(float(d.ndvi_mean_z.median()), 2))
    print(d.groupby('iso3').ndvi_mean_z.median().sort_values().round(2).to_string()[:1500])


if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--release', default='2026-10-10'); p.add_argument('--out'); a = p.parse_args(); main(a.release, a.out)
