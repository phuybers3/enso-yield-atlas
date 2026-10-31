"""Check provisional IBGE values against their independently stored source cells."""
from pathlib import Path
import argparse
import json
import math
import sqlite3

ROOT = Path(__file__).resolve().parents[2]
PRODUCTS = {
    ('rice', 'annual'): '39432', ('maize', 'safra'): '39441',
    ('maize', 'safrinha'): '39442', ('soybean', 'annual'): '39443',
    ('sorghum', 'annual'): '39444', ('wheat', 'annual'): '39445',
    ('cassava', 'annual'): '39467',
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--release', default='2026-10-31')
    args = parser.parse_args()
    folder = ROOT / 'atlas/site/data/agency-estimates'
    register = json.loads((folder / 'index.json').read_text())
    export = json.loads((folder / register['releases'][args.release]['BRA']).read_text())
    database = ROOT / 'data/releases' / f'enso_ag_{args.release}.sqlite'
    with sqlite3.connect(f'file:{database}?mode=ro', uri=True) as conn:
        cells = {
            (geo, product, variable, month): value
            for geo, product, variable, month, value in conn.execute(
                'SELECT D1C,D4C,D2C,D3C,V FROM brazil_lspa_estimates'
            )
        }
    assert export['release'] == args.release
    assert export['publication_date'] is None
    assert len(export['rows']) == 196
    assert len({(r['geo_key'], r['crop_family'], r['season']) for r in export['rows']}) == 196
    assert len({r['geo_key'] for r in export['rows']}) == 28
    unavailable = zero_area = compared = 0
    for row in export['rows']:
        assert row['status'] == 'provisional'
        assert row['geography_level'] in ['state', 'national']
        assert row['geo_key'] == 'BRA' or row['geo_key'].count(':') == 1
        product = PRODUCTS[row['crop_family'], row['season']]
        month = row['reference_month'].replace('-', '')
        assert month == export['source_reference_month']
        for field, variable in [('planted_ha', '109'), ('harvested_ha', '216'),
                                ('production_t', '35'), ('yield_t_ha', '36')]:
            source = cells[row['ibge_geography'], product, variable, month]
            if field == 'yield_t_ha' and row['harvested_ha'] == 0:
                assert row[field] is None
                assert row['yield_status'] == 'not applicable: no harvested area'
                zero_area += 1
            elif source in ['..', '...', 'X']:
                assert row[field] is None
                unavailable += 1
            else:
                expected = 0 if source == '-' else float(source)
                expected /= 1000 if field == 'yield_t_ha' else 1
                assert math.isclose(row[field], expected, rel_tol=0, abs_tol=1e-12)
                compared += 1
        if row['harvested_ha'] and row['production_t'] is not None and row['yield_t_ha'] is not None:
            # Reported yield is rounded to whole kilograms per harvested hectare.
            assert abs(row['yield_t_ha'] - row['production_t']/row['harvested_ha']) <= .001
    national = [r for r in export['rows'] if r['geo_key'] == 'BRA']
    assert len(national) == 7
    assert {r['season'] for r in national if r['crop_family'] == 'maize'} == {'safra', 'safrinha'}
    rs = [r for r in export['rows'] if r['ibge_geography'] == '43']
    assert all(r['geo_key'] == 'BRA:21' for r in rs), 'IBGE and atlas state codes differ'
    print(json.dumps(dict(status='pass', release=args.release, source_values_compared=compared,
                          missing_cells=unavailable, zero_area_yields_withheld=zero_area,
                          maize_cycles_separate=True, geography_match_verified=True), indent=2))


if __name__ == '__main__':
    main()
