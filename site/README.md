# ENSO yield atlas: the site

One MapLibre application with three views over the same reporting units and the same release. The page reads
`site/data/<release>/`, written by `scripts/export_release.py` from the analysis layer's results folder and the
release database, and draws what it reads. It does not aggregate, pool, convert units or decide significance;
the original numerical fields remain unchanged and `tests/numerics.py` compares them to their source. A separately hashed `display/<release>/` supplement provides coverage counts, exact-series ENSO exposures, names, crop-family shards and documented common-footprint means, independently checked by `tests/display.py`.

## The three views

The views are routed as `#/<view>/<ISO3>/<unit>?crop=&season=&release=R&index=`. Without an ISO3 the view is the
world; with one it is the country; with a unit key (`USA:17:57`) it is the reporting unit. `crop` is a crop code of
the catalog (`maize`, `rice_milled`, `wheat_winter`), `season` a season label of that crop in that country (`main`,
`Kharif`), `release` a release in `data/releases.json` (the default is the latest), and `index` `rel` or `std` for
the response view. The nav keeps the selection when switching views.

**Yield history** (`record`) shows the observed yields of every unit and series as the database stores them: at world level local reporting-unit counts, at country level a map of the same selected harvest year and a table of record
lengths, trend slopes and latest anomalies (the map can colour the latest anomaly from the trend instead), at unit
level the series' yields by harvest year with the analysis layer's log-linear trend drawn over them
(`trend_series`, `trend_anomaly`) and the fitted value and anomaly in the table. Where a unit carries several
series of one crop and season (two sources, two area bases), the country map first applies source priority and then shows the longest record and the unit
page lists the others.

**El Niño relationships** (`response`) shows the fitted yield response to the growing-season index: at world level a ranked list of the
countries (`response_country`, season window, with the 95% interval, p and the false-discovery q), at country
level the country's rows for every window, the regions ranked by their own unpooled slope
(`response_region`) and a map of the units' best estimates (`response_unit.pct_best`, brown to green), and at unit
level the unit's own fit beside its best estimate and the level the best estimate comes from (`response_level`:
the unit's own fit where it has twenty years, else the state's, else the country's).

**This season** (`season`) shows the horizon. At world level the headline of the release (the weather-implied and index-implied
change over the panels whose weather estimate passes its gates), the world rows of `prediction_world` by crop
family and method, and the panels of the selected family ranked by production. At country level the panel card:
status and harvest year, the index outlook's lower, central and higher paths with their intervals
(`prediction_panel`), the index observed to date, the weather-to-date estimate with its standard error, lead and
the four gates the analysis layer applied (`prediction_weather_panel`), the season-to-date weather of the panel (`weather_todate_anomaly_panel`: each
metric's production-weighted anomaly beside the anomaly the panel's index regression expects, the percentile, the
signal flag and the tracker's verdict), the scenario index paths with the observed months marked
(`scenario_index_path`), and the hindcast skill of every method by lead (`evaluation_skill`) as a chart and a
table. The map has three layers: the central scenario per unit (`prediction_series`, brown to green), the
season-to-date rainfall anomaly in millimetres (`weather_todate_anomaly`, chirps row, brown to green) and the daily-maximum
temperature anomaly (best row, blue to red). At unit level the series' prediction rows, its weather rows by metric
and its season windows.

## The data contract

`scripts/export_release.py --release R` writes `site/data/R/`:

| File | Contents | Source |
|---|---|---|
| `catalog.json` | release, scope, crops and families, countries with their crops, seasons, panel keys and geometry flag, the last 36 months of the index, the views, the precision | database `series`, `units`, `enso_monthly`; results manifest |
| `world.json` | the headline and index block of the results manifest, every row of `prediction_world` and of `scenario_index_path`, every season-window relative-index row of `response_country` | results |
| `panels.json` | one record per panel (`iso3|crop_code|season`): every `prediction_panel` row, the `prediction_weather_panel` row, the `weather_todate_anomaly_panel` row (metrics nested), the season-window relative-index `response_country` row | results |
| `skill.json` | every panel-level `evaluation_skill` row, by panel key | results |
| `countries/<ISO3>.json` | every `response_country` and `response_region` row of the country | results |
| `units/<ISO3>.json` | every unit of the country with its series: `response_unit` rows, `prediction_series` rows, horizon `season_windows` rows, as arrays in the column order the file declares, and the `weather_todate_anomaly` rows (one per product, the product's metrics as `[value, reference, anom, z, pct_rank, n_years]`) | results; database `season_windows` |
| `records/<ISO3>.json` | per series: observations `[harvest_year, yield_t_ha]`, the `trend_series` row and the `trend_anomaly` rows `[harvest_year, yield_t_ha, fitted_yield, anomaly_pct]`; loaded by the record view only | database `observations`; results |
| `geometry/<ISO3>.json`, `geometry/world.json` | unit boundaries resolved from each unit's `geometry_source` (HarvestStat packages, the Hultgren replication shapefile, Natural Earth), simplified at 700 m in a local equal-area projection and rounded to 1e-5 degrees, one file per country; Natural Earth 50m outlines for the world | database `units`; source files |
| `manifest.json` | sha256 and bytes of every file, the results and database hashes, the exporter hash, counts, the geometry audit, the precision | |

`site/data/releases.json` lists the releases the site can show and names the default. The precision is stated per
file family in the manifest (`precision.decimals`): `panels.json`, `world.json` and `countries/` carry the results
floats unrounded, `units/` and `skill.json` keep six decimals, `records/` four. Series ids are decimal strings,
because they exceed 2^53. The scope is the six staple crop families of the analysis layer. The `records/` file
kind is an addition to the file list of `4_ag/platform/SCHEMA.md`: it keeps the record view's 1.5 million
observations and 1.4 million fitted values out of the file the response and season views load.

Six rows of `weather_todate_anomaly_panel` belong to panels that have no `prediction_panel` rows (Ecuador and
Tanzania spring wheat, Japanese and Lao rice, Nicaraguan maize `planted_m8`, Vietnamese soybean) and so have no
page; `tests/numerics.py` counts them.

## Export a release and run the tests

    cd 4_ag/enso-yield-atlas
    ~/.venvs/enso/bin/python scripts/export_release.py --release 2026-10-08        # about four minutes; --skip-geometry reuses the geometry files
    ~/.venvs/enso/bin/python scripts/export_display.py --release 2026-10-08
    npm test                                                                       # site tests, then the archived applications' tests
    npm run test:site                                                              # the site alone

`npm run test:site` runs `tests/site_ui.cjs` (the three views at world, country and unit level for the United
States maize, Indian kharif rice, Brazilian maize and Argentine maize panels, against the data files, with a DOM
implementation and a MapLibre stub), `tests/schema.py` (every file against the contract and the manifest hashes),
`tests/numerics.py` (every value against its results row or database value at the stated precision; about 14
million comparisons in about a minute) and `tests/acceptance.py` (the panel medium rows, the weather rows, the
world rows and the headline equal the results exactly). The Python tests run with `$PYTHON`, else
`~/.venvs/enso/bin/python`, else `python3`. To view the site, serve the repository root
(`python3 -m http.server 8765`) and open `http://127.0.0.1:8765/site/`.

## Archive

The three earlier applications, `global/`, `climate/` and `watch/`, stay on disk unchanged with their frozen data
and their tests (`npm run test:archive`), and the site links to them; they are not maintained. See
`SITE_RELEASE.md`.

## Display supplement and reader tools, 9 October 2026

The public navigation opens on This season. Six crop families lead to explicit source crop types; country links
preserve those types and their seasons. China maize opens on its available Annual national outlook and links
back to the 1,986 historical local records. The world maps mark countries with local detail; coverage counts
refer to the chosen crop and season, not every series in the database. Every displayed table has search, sort
and CSV export. Country unit tables add a region filter and sort by the release's production weight.

`display/<release>/summary.json` holds unique-unit coverage by crop and family, both standard and relative-index
country responses, the historical monthly indices, the analysis change record, reliability shares, timing and
common-footprint means. `units/<ISO3>-<family>.json` and `records/<ISO3>-<family>.json` retain the original series
fields and precision. Records add exact-series, harvest-year ENSO exposure (six decimals) and stored QC flags.
Response and monthly summary values use pandas' ten-decimal JSON precision. Regional boundaries are unions of
available reporting polygons; source gaps remain visible. Brazilian spellings use unambiguous local IBGE name
matches; other names preserve source spelling or normalize case and separators. The manifest hashes every
supplement file and the frozen original manifest. `tests/display.py` independently checks 46,466 unchanged
series, all supplement hashes, coverage counts, historical exposures, both indices and matched means.

The matched comparison is an arithmetic mean of paired unit estimates over identical series/harvest years and
positive weather-row weights. It is descriptive and does not replace the separate country weather regression.
No new aggregate interval is estimated. Hultgren production weights allocate national output by the package's
cropped-area shares; they are proxies, not measured local production. HarvestStat weights use reported
production shares. Optional map circles show these weights. Country/world scenario bounds average local
coefficient limits; they are not calibrated national 95% forecast intervals. Index-outlook skill checks assume
the future ENSO index is known and therefore do not establish operational ENSO forecast skill.

Map PNGs and SVG charts retain legends and provenance. Copy-link pins release and selection. The country-season
print view retains its map, estimates, checks, timing and source citation, omitting long unit tables. The dated
bulletin and reporter walkthrough are built by `scripts/build_release_brief.py`; `scripts/build_release_pdf.py`
uses ReportLab, BeautifulSoup and pypdf to produce the two-page bulletin plus a one-page appendix. No invitations
or messages are sent by this application.

The GitHub Pages deployment is assembled by `scripts/build_pages.py` and `.github/workflows/pages.yml`.
It preserves existing archive files and URLs. New atlas data remain in the repository and are fetched from
`raw.githubusercontent.com` at the exact deployment commit, recorded in `site/hosting.json`; download links
use that same commit. This avoids duplicating the new release within the nearly full Pages archive. Local
previews continue reading local files. The build checks the static payload size before publication.
