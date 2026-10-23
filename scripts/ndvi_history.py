"""Historical NDVI for display, with explicit input and calendar compatibility checks."""
from pathlib import Path
import hashlib
import sqlite3

import numpy as np
import pandas as pd


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def read_seasons(source, served=None):
    """Read the original snapshot; never silently replace a missing table by no data.

    A second database may supply revised attribution, but each historical NDVI
    row must still match its series definition and the dated growing window.
    """
    source = Path(source).resolve()
    with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as con:
        if not con.execute("SELECT 1 FROM sqlite_master WHERE name='ndvi_season'").fetchone():
            raise ValueError(f'Historical NDVI table missing from {source.name}')
        seasons = pd.read_sql_query(
            "SELECT n.*,s.unit_key,s.iso3,s.crop_code,s.crop_family,s.season_std,s.area_basis,s.source "
            "FROM ndvi_season n JOIN series s USING(series_id) WHERE s.staple=1 AND n.product='vhp' "
            "AND n.harvest_year BETWEEN 1981 AND 2025", con)
    audit = dict(input_rows=len(seasons), input_series=int(seasons.series_id.nunique()),
                 calendar_mismatch_rows=0, series_mismatch_rows=0)
    if served and Path(served).resolve() != source:
        with sqlite3.connect(Path(served).resolve().as_uri() + '?mode=ro', uri=True) as con:
            definitions = pd.read_sql_query(
                'SELECT series_id,unit_key,crop_code,crop_family,season_std,area_basis,source FROM series WHERE staple=1', con)
            windows = pd.read_sql_query(
                'SELECT series_id,harvest_year,start_date,end_date FROM season_windows WHERE harvest_year BETWEEN 1981 AND 2025', con)
        keys = ['series_id','unit_key','crop_code','crop_family','season_std','area_basis','source']
        compatible = seasons.merge(definitions, on=keys, how='inner', validate='many_to_one')
        audit['series_mismatch_rows'] = len(seasons) - len(compatible)
        compatible = compatible.merge(windows, on=['series_id','harvest_year'], how='left', validate='one_to_one')
        keep = compatible.window_start.eq(compatible.start_date) & compatible.window_end.eq(compatible.end_date)
        audit['calendar_mismatch_rows'] = int((~keep).sum())
        audit['calendar_mismatch_series'] = [str(x) for x in sorted(compatible.loc[~keep, 'series_id'].unique())]
        seasons = compatible[keep].copy()
    eligible = seasons[(seasons.frac_elapsed >= .999) & (seasons.coverage >= .8) & seasons.ndvi_mean.notna()].copy()
    audit['eligible_rows_before_reference'] = len(eligible)
    return eligible, audit


def anomalies(seasons):
    """Reproduce the export's 2001+ reference trend; pre-2001 values stay provisional."""
    ref = seasons[seasons.harvest_year >= 2001].copy()
    grouped = ref.groupby('series_id')
    mt, my, n = grouped.harvest_year.mean(), grouped.ndvi_mean.mean(), grouped.size()
    t = ref.harvest_year - ref.series_id.map(mt)
    y = ref.ndvi_mean - ref.series_id.map(my)
    slope = ((t*y).groupby(ref.series_id).sum() / (t*t).groupby(ref.series_id).sum().replace(0, np.nan)).fillna(0.)
    out = seasons[seasons.series_id.isin(n[n >= 10].index)].copy()
    out['ndvi_anom'] = out.ndvi_mean - (out.series_id.map(my) + out.series_id.map(slope) * (out.harvest_year - out.series_id.map(mt)))
    return out
