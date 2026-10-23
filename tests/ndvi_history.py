"""Independent checks of the restored display histories and missing-table guard."""
from pathlib import Path
import json
import sqlite3
import sys
import tempfile
import unittest

import numpy as np

ATLAS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ATLAS/'scripts'))
from ndvi_history import read_seasons, sha256


class HistoryTest(unittest.TestCase):
    def test_missing_table_is_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp)/'missing.sqlite'
            sqlite3.connect(db).close()
            with self.assertRaisesRegex(ValueError, 'NDVI table missing'):
                read_seasons(db)

    def test_supplement_and_independent_fits(self):
        base = ATLAS/'site/data/ndvi-history/2026-10-19'
        audit = json.loads((base/'audit.json').read_text())
        con = sqlite3.connect((ATLAS.parent/audit['source']['path']).as_uri()+'?mode=ro',uri=True)
        series_count=point_count=state_count=0
        for filename, info in audit['files'].items():
            path=base/filename
            self.assertEqual(sha256(path),info['sha256'])
            payload=json.loads(path.read_text())
            series_count+=len(payload['series'])
            point_count+=sum(map(len,payload['series'].values()))
            state_count+=sum(map(len,payload['states'].values()))
            # One series per covered country, plus the user's exact maize example.
            ids=list(payload['series'])[:1]
            if payload['iso3']=='USA': ids.append('186572596871921081')
            for sid in ids:
                raw=con.execute("SELECT harvest_year,ndvi_mean,provisional FROM ndvi_season WHERE series_id=? "
                                "AND product='vhp' AND frac_elapsed>=.999 AND coverage>=.8 AND ndvi_mean IS NOT NULL "
                                "AND harvest_year BETWEEN 1981 AND 2025 ORDER BY harvest_year",(int(sid),)).fetchall()
                ref=np.array([r[:2] for r in raw if r[0]>=2001])
                b=np.linalg.lstsq(np.column_stack([np.ones(len(ref)),ref[:,0]-2000]),ref[:,1],rcond=None)[0]
                expected={y:(v-b[0]-b[1]*(y-2000),provisional) for y,v,provisional in raw}
                for year,value,provisional in payload['series'][sid]:
                    self.assertAlmostEqual(value,expected[year][0],delta=.00005001)
                    self.assertEqual(provisional,expected[year][1])
            for rows in payload['series'].values():
                self.assertEqual(len(rows),len({r[0] for r in rows}))
                self.assertTrue(all(1981<=r[0]<=2025 and np.isfinite(r[1]) for r in rows))
        self.assertEqual(series_count,audit['counts']['restored_series'])
        self.assertEqual(point_count,audit['counts']['restored_points'])
        self.assertEqual(state_count,audit['counts']['restored_state_records'])
        # The one incompatible calendar is explicitly excluded, not silently borrowed.
        usa=json.loads((base/'USA.json').read_text())
        self.assertEqual(usa['unavailable']['772007482699405584'],'calendar_mismatch')
        self.assertNotIn('772007482699405584',usa['series'])
        self.assertEqual(len(usa['series']['186572596871921081']),42)
        con.close()


if __name__=='__main__': unittest.main()
