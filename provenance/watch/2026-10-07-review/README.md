# Crop Watch interface and review update, 7 October 2026

We retain the frozen 6 October numerical release and its manifest. The new
`watch/season-data/2026-10-06/` extension includes 643 country-crop-season panels
and 42,942 unit-season records. The exporter reproduces every field in the
41,150 previously published representative map records. It checks panel series
counts, production totals, scenario percentages, and matching weather windows.
The season manifest records the input hashes and calendar findings.

We calculate the new country-crop summary percentages from the original
unrounded exposure table. The previous country summary calculated percentages
from rounded million-tonne values, distorting results for small crops. The
underlying unit estimates and model coefficients remain unchanged. Both the
website and revised bulletin use `watch/context/2026-10-07.json` for the summary
table. The map uses those same country-crop values. The archived JSON retains
its original values for reproducibility.

We found 29 panels with more than one local harvest year. Country pages and
summary tables now show those years; tooltips report the exact local window.
Three panels have tracker end dates after their assigned harvest year: Argentina
maize (345 records), Brazil maize (1,120), and Brazil soybean (1,693). These are
flagged for calendar review and their weather views are withheld. The date
constructor in `season_tracker/scripts/03_season_todate.py` adds extended
harvest day-of-year values directly to January 1 of the harvest year. For
example, series 31782 has harvest day 486 and assigned year 2027, producing
2028-04-30. Resolving extended-day conventions requires reconciliation with the
source calendars and the historical daily-weather pipeline; we have not silently
changed the calendar or refitted the models. ENSO scenarios use the released
monthly exposures and remain available with the warning.

## FEWS NET comparison

Source: https://fews.net/global/special-report/october-2026, dated 6 October,
read 7 October. We transcribe four averages from Table 1: South African maize
-27.7%, Australian wheat -15.3%, Indian rice -5.7%, Argentine maize +11.1%.

FEWS NET measures production relative to a local trend estimated using up to
seven years on either side, excluding the selected El Niño years. We estimate
log-yield relationships with unit trends and growing-season relative Niño 3.4,
then apply current conditional ENSO paths and fixed production weights. The
FEWS NET table averages historical events; our table uses the current event.
Area, crop-year assignment, rice basis, event selection, trend method, ENSO
index and dataset overlap must be reconciled before interpreting differences.
The comparison is a plausibility check, not an independent validation exercise.
No model coefficients or scenario strengths were tuned to FEWS NET.

## Validation and review status

`npm run test:watch` checks the frozen release, all extension hashes, every
season record, calendar flags, source selection, navigation, weather units,
copyable links, weak-skill labels, and FEWS NET/download pages. `npm test` and
`npm run test:climate` also pass. Browser checks cover the homepage, India rice
season changes, question controls and weather maps. The PDF has two bulletin
pages and one methods page, all rendered and inspected.

Independent scientific review and a harmonized FEWS NET comparison remain
pending. The pre-existing historical merged-numerics discrepancy recorded in
`provenance/watch/2026-10-06/validation.txt` is outside this interface update;
we have not claimed a new historical database validation.

The archived bulletin generator is a source snapshot from the local bulletin
folder. Its input paths are local project paths; it is not a standalone public
build command. The shared summary JSON, PDF and content snapshot accompany it.
