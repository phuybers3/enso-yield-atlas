# The site: one application over the release data

## 2026-10-31: Brazilian records and monthly Recent anomalies

We extended Brazilian municipal histories through 2025 with 89,038 observations,
preserved original panel records, corrected later agency denominators and
excluded overlapping annual maize observations. September 2026 LSPA national
and state estimates appear separately as provisional values. We retained
quarter pooling and full-record leave-one-year-out evaluation. The main
uncertainty calculation completed 1,000 draws; the historical supplement uses
400 draws. Conditional-effect interval calibration remains under review.

Recent anomalies shows monthly temperature, rainfall and NDVI, including months
before planting, with the typical crop window shaded. ENSO observations and the
saved scenarios share the time axis. Weather updates end on 25 October and NDVI
on 28 October where available; monthly national temperature/rainfall and state
aggregates are explicitly unavailable. Monthly expected weather and combined
yield updating remain future work. Annual histories and seasonal summaries
retain their own definitions and cutoffs.

We checked the exported values, source hierarchy, crop cycles, intervals,
national companions and interface. The [full change log](CHANGELOG_2026-10-31.md)
records checks, input dates and remaining coverage limits, including 222
municipalities awaiting verified boundary matches. Previous releases remain
unchanged.

## 2026-10-30: regional coverage, refreshed observations and display audit

We retained the earlier releases and rebuilt the candidate from the identified
October 30 database. The database adds five verified North Rhine-Westphalia
maize observations for 2025. The affected maize/main pool was recalibrated with
118 full-record withheld-year folds and 440,595 predictions. The revised Iberia,
Louisiana rice calendar also required rice/main recalibration. Yield responses
retain quarter pooling. The forecast quantiles retain their October 8 issue.

The historical layer restores older local relationships omitted by current-outlook
recency rules, including Chinese counties and Australian wheat states. Current
national estimates remain labelled national. National crop-weighted VHP histories
and season-to-date observations use the existing pixel archive. Early NDVI years
now determine the history axis alongside yield, temperature and rainfall.

The refresh also corrects unequal partial-month comparison windows, source/date
labels, response-interval tooltips, release help and reused-geometry checks.
The [complete refresh log](CHANGELOG_2026-10-30.md) gives source cutoffs and
remaining source failures. Effect intervals retain their research-candidate
status; historical conditional skill is separate from issued-forecast skill.

The candidate passes its saved numerical, source-identity, map/interface and
browser checks before publication. Earlier notes below retain their original
paths, counts and scope as a historical record.

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

## 2026-10-18: the harvest-anomaly-by-year layer

The maps gain a layer that shows, for a chosen harvest year, how far each reported yield fell from the series' own
log-linear trend: `anomaly_pct` of `trend_anomaly.parquet`, the value the unit page plots, with no model behind it.
Each country is coloured by its national series and its reporting units are drawn over it from the same series as the
outlook overlay; the colours saturate at ±30 percent. A year control with a timeline of the December–February relative
Niño 3.4 selects the year. The exporter writes `anomalies/<family>.json` and `anomalies/index.json` through
`scripts/anomaly_layer.py` (release 2026-10-15: 43,190 public series of the six families from 1961 on, 1,417,906
series-years, 27 MB in six files, maize 9.4 MB), and `tests/schema.py`, `tests/numerics.py` and
`tests/site_anomaly.cjs` check them. Older releases carry no such folder and do not offer the layer.

On 19 October 2026 the world map on this layer draws every reporting unit with a public series of the family, by the
unit's series of the panel's crop and season or else its series of the family (`units` in `anomalies/<family>.json`;
39,902 unit-family pairs in release 2026-10-15), in place of the units of `world_units.json`, which carry a current
outlook only. Units whose records end before the outlook period, such as the Australian wheat states to 2008, now
appear; `counts_world` counts the drawn series.

## 2026-10-20: the preview for the first readers

Release 2026-10-19 is frozen (`analysis/contracts/RELEASE_FREEZE_2026-10-19.md`); the changes of 20 October are to
the interface, the text and the routing, after the reviewer's walk of the live site. The repository root page now
opens the atlas and lists the archived applications, with the September explorer moved to `explorer/` (its download
links and `rebuild_atlas.py` follow it). The site carries one name, ENSO crop atlas, in its title, the unit-page
header and the footer. The methods route opens on an "About this release" section: what the pages show, the
estimator, the leave-one-year-out gate, the known limitations, the 15 to 19 October change of the world maize outlook
from +22.8 to +46.5 Mt, and the comment route. The methods paragraph defines the relative index, the pooling fraction,
resolved harvests, shared uncertainty draws, the model version and validated against conditional, and no longer
promises a paper or a weather-based forecast; "Paper & data" on the unit pages is "Methods and sources". The credits
show reader-facing citations for the register entries that named scripts, revisions or pipeline products, and the
StableBound deposit is marked pending because its Zenodo record is not registered. The state outlines are read from
`display/2026-10-08/regions/`, the only exported display folder, which the later releases copy their geometry from,
so the country and unit pages no longer request folders that answer 404. On a unit page the crop-record select keeps
the place when the place reports the chosen record, so the three Brazilian maize seasons open on the municipality; a
place that lacks the record says so above its rows, and a record on CONAB's second-crop window says that too. The
"Explore historical" link appears only where `data/historical-responses/index.json` has an entry for the release and
country. The country test table lists one row per distinct result with the span of leads it covers. `npm test` runs
the interface tests for the two carried releases, 2026-10-19 and 2026-10-08.
