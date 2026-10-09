# The site: one application over the release data

## 2026-10-08: first export on the new pipeline

We replaced the three applications with one site, `site/`, that reads `site/data/<release>/` and renders three
views of the same reporting units: the yield record, the ENSO response and the current season. The exporter,
`scripts/export_release.py`, reads `4_ag/results/<release>/` (the analysis layer's Parquet tables) and the
release database `2_data/derived/db/enso_ag_<release>.sqlite`, and copies: it does no aggregation, pooling, unit
conversion or significance decision, and the two tests the plan asked for, `tests/schema.py` and
`tests/numerics.py`, check every file against the contract and every value against its source row. `npm test`
runs them with a browser-level test of the site and the archived applications' tests. `site/README.md` describes
the views, the data contract, the export and the tests.

Release 2026-10-08 exports 580 files and 108 MB: 193 countries, 14,964 units, 46,466 series of the six staple
families with 1,481,314 observations, 670 prediction panels, 805 skill panels and 14,938 mapped units (26 unmapped:
twenty-two Brazilian units whose Hultgren key has no polygon and four French overseas departments, as in the
merged release). The acceptance check reproduces the results exactly: every panel's medium index_outlook row, every
weather row and every world row equal `prediction_panel.parquet` and `prediction_world.parquet` without rounding,
and the headline is the results manifest's, −4.048 percent weather-implied against +3.312 index-implied over 25
panels and 607.6 Mt. The Argentine and Brazilian maize season views show their status, scenarios and weather rows
as the results carry them; nothing is withheld for calendar review, because the windows now come from the
database's `season_windows` table.

Two values the views would show are not in the results and are therefore absent from the site: a fitted trend per
series (the record view draws the observations alone) and the season-to-date rainfall and temperature anomalies
per unit that the Watch computed in its tracker. The unit files are large where the record is: Brazil 25 MB and the
United States 15 MB uncompressed, loaded once per country; splitting them by crop family is the obvious next step
if that proves slow. The database carries 505 series-years with two observation rows (Brazilian panel units), which
the exporter copies as stored.

## 2026-10-08, later: the rebuilt results and the three screens they allow

The analysis layer rebuilt `4_ag/results/2026-10-08/` on the rebuilt database (sha256 f3373b31…) with three tables
the site had reported as missing, and we re-exported and extended the site. The record view now draws the
analysis layer's log-linear trend over each series (`trend_series`, `trend_anomaly`; 39,987 trends with 1.43
million fitted rows in the staple scope) and can colour a country by the latest anomaly from it. The season view
gains the season-to-date weather screen: the panel's production-weighted anomalies beside the anomalies its index
regression expects, with percentiles, signal flags and the tracker's verdict (`weather_todate_anomaly_panel`, 49 of
its 55 rows on prediction panels), two unit map layers for the rainfall z-score and the daily-maximum temperature
anomaly (`weather_todate_anomaly`, 24,630 series rows), a weather table on each unit page, and the scenario index
paths with the observed months marked (`scenario_index_path`). `prediction_panel` now carries `lead` and `se`, and
the skill rows a `note` for the seven non-finite values; the season labels are normalized, so national panels are
keyed `Annual`. The export is 773 files and 171 MB, with the record view's data moved to `records/<ISO3>.json`
(63 MB; Brazil 26 MB) so that the response and season views load `units/<ISO3>.json` alone (53 MB; Brazil 22 MB).
`tests/numerics.py` compares 13.7 million values; the acceptance check, the schema test, the site test and the
archive tests pass, and the four reference panels were checked in the browser: United States maize shows the
verdict "mixed" with heat above and rain below expectation on 2,065 units, Indian kharif rice "mixed" on 301,
Brazilian maize its 25 early-planted units, and Argentine maize, not planted, says so without a banner.

## Archive

The global yield atlas (`global/`, releases 2026-09-26, 2026-09-26-merged-v1 and 2026-09-26-robust-v1), the
climate and crop atlas (`climate/`, 2026-09-26-climate-v1) and the El Niño Crop Watch (`watch/`, issues 2026-09,
2026-10-06 with `watch/regional/2026-10-06-v1` and `watch/season-data/2026-10-06`) stay on disk
unchanged, with their data, provenance and tests (`npm run test:archive`), and the site's footer and About page
link to them. They are not maintained; a correction to their numbers is a new release of the site.

## 2026-10-09: reader interface and display supplement

We implemented the approved Trilling/Fable5 review: one question-based navigation row, a plain introduction,
searchable country/crop/season summaries, local coverage badges and map outlines, correct local tooltips,
readable names, and China's available Annual outlook. Crop types and seasons stay explicit; standard-index
world results now use their own coefficients. Local responses remain distinct; regional charts default to
unpooled fits. Rainfall maps show millimetres, yield maps use tighter brown-to-green scales, and optional circles
show production weights with their proxy limitation stated.

Country estimates now sit beside their reliability checks and lead-specific skill chart. Matched-footprint
unit comparisons, observation cutoffs and calendar ranges are explicit. Histories use a common harvest year on
country maps and exact crop-season ENSO exposure on unit charts, with trend-anomaly bars and retained QC flags.
Links pin the selection; tables and figures download with provenance. A two-page release bulletin with a
one-page appendix, printable country briefs and a reporter walkthrough accompany the site.

The scientific release remains frozen: 773 original files, 193 countries, 46,466 series, 1,479,535 observations,
671 prediction panels, 796 skill panels and 14,938 mapped units. The separate display supplement contains 1,768
hashed files and crop-family shards. Original numerical tests compare 13,674,907 values; schema, acceptance,
archive, independent display and expanded UI regression tests pass. The supplement preserves the original
manifest hash bf3bb3c3272f08c4ed615f8fdeec1565f42dba0aefad88b9d221d34b432f948e.

The release retains the September outlook and weather through 30 September. The interface update does not
claim new October observations. Aggregate scenario bounds, production proxies and perfect-future-index tests
are now distinguished from calibrated national intervals, measured local production and operational forecast
skill. Browser verification covers the US, India, Brazil, China, yield histories, mobile layout and actual
CSV/SVG/PNG downloads; PDF layout is checked after rendering all three pages.

The GitHub Pages deployment is assembled by `scripts/build_pages.py` and `.github/workflows/pages.yml`.
It preserves existing archive files and URLs. New atlas data remain in the repository and are fetched from
`raw.githubusercontent.com` at the exact deployment commit, recorded in `site/hosting.json`; download links
use that same commit. This avoids duplicating the new release within the nearly full Pages archive. Local
previews continue reading local files. The build checks the static payload size before publication.

The native print dialog could not be inspected during overnight QA because the Mac was locked. The printable
country layout is implemented; the downloadable bulletin PDF was rendered and all three pages inspected.
