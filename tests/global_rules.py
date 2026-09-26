"""Exercise eligibility edge cases before publishing a release."""
import importlib.util, pathlib, unittest
spec = importlib.util.spec_from_file_location('exporter', pathlib.Path(__file__).parents[1] / 'scripts/build_global_data.py')
exporter = importlib.util.module_from_spec(spec); spec.loader.exec_module(exporter)

class Eligibility(unittest.TestCase):
    def setUp(self):
        self.row = {'yield_basis':'planted', 'area_planted_complete':'True', 'production_complete':'True',
                    'yield_mt_ha':'0', 'area_planted_ha':'100', 'production_mt':'0'}
    def test_observed_zero(self):
        self.assertIsNone(exporter.eligible(self.row))
    def test_incomplete(self):
        self.row['production_complete']='False'
        self.assertEqual(exporter.eligible(self.row),'incomplete reporting')
    def test_inconsistent(self):
        self.row['yield_mt_ha']='2'
        self.assertIn('inconsistent',exporter.eligible(self.row))
    def test_missing_zero_area(self):
        for v in ['0','','NaN']:
            self.row['area_planted_ha']=v;self.assertIsNotNone(exporter.eligible(self.row))
    def test_common_window_not_shortened(self):
        a=exporter.summarize([[2004,2],[2006,4]],(2000,2009))
        self.assertEqual(a['mean'],3);self.assertEqual(a['n'],2);self.assertEqual(a['completeness'],.2)

if __name__=='__main__': unittest.main()
