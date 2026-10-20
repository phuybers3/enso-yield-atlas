import unittest
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from export_calendar_bar import dated_window

class CalendarDates(unittest.TestCase):
    def test_peak_within_source_window(self):
        self.assertEqual(dated_window(105,166,"2026-05-15"),("2026-04-15","2026-06-15"))
    def test_new_year(self):
        self.assertEqual(dated_window(340,20,"2027-01-05"),("2026-12-06","2027-01-20"))
    def test_leap_source_convention(self):
        self.assertEqual(dated_window(60,60,"2024-03-01"),("2024-03-01","2024-03-01"))
    def test_no_imputed_window(self):
        self.assertEqual(dated_window(None,166,"2026-05-15"),(None,None))

if __name__ == "__main__":
    unittest.main()
