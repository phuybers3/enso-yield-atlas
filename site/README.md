# ENSO crop atlas: the site

One page, one path: a world map, a country map and a detail page per reporting unit, over the data that
`scripts/export_release.py` writes to `site/data/<release>/`. The browser draws what it reads. It does not
aggregate, pool or refit models. The display checks whether the published 80% ENSO-effect interval includes zero
and uses the calendar arithmetic of `calendar.js` (a selected date minus a published planting or harvest date). `tests/numerics.py` and
`tests/display.py` compare the data files to their sources; `tests/site_ui.cjs` drives the application and
compares what it shows to the files.

This is the pilot interface of 9 October 2026 (4_ag/planning/atlas_development_plan_2026-10-09.md, amended by
4_ag/platform/ATLAS_FEEDBACK_2026-10-09.md). It reads two release contracts. The frozen release 2026-10-08
(contract 2026-10-08) publishes `panels.json`, `display/<release>/` unit and record shards and the pilot's world
calendar fixture; the candidate 2026-10-09-candidate (contract 2026-10-09, 4_ag/platform/SCHEMA.md, "Site files as
exported for the candidate") publishes the compact panel rows in `world.json`, `calendar_world.json`, the aggregate
rows in `countries/<ISO>.json`, the response_leaf rows in `units/<ISO>.json` and one record shard per unit under
`records/<ISO>/`. `app.js` dispatches on `catalog.contract` in a data-access section of adapters that put both
into one shape; the render code reads that shape only. It replaces the three views of the 8 October application
(record, response, season); the old links `#/season/...`, `#/response/...`, `#/record/...` and `#/about` resolve to
the corresponding new places.

## Routes and state

    #/                                 the world map
    #/<ISO3>                           the country map; a country whose panel has one series opens its page directly
    #/<ISO3>/<unit key>                the unit page (`USA:19:1`), or a state page for a region key (`USA:19`)

The query carries the selection and it survives every move: `crop` (a family, `maize`, or an exact crop code,
`rice_milled`), `season` (a season label of the panel, `Kharif`), `layer` (`outlook`, the default, `anomaly`,
`progress`, `planting`, `harvest`), `date` (an ISO date for the calendar layers; today when absent), `harvest` (the target
harvest year; the panel's when absent), `year` (the harvest year of the anomaly layer; the family's default when absent
or outside its range), `axis` (`enso`, the default, or `year`), `index` (`rel`, the default, or
`std`) and `release` (a release of `data/releases.json`; the default when absent). The browser's back button
restores the previous place with its selection.

## The first screen

The title, the crop selector, the one map dropdown and the map, then the legend in words, a credit line, a place
box and the explanation, methods and credits. The date control appears only with a calendar layer. Countries are
coloured by their national aggregate: the central ENSO-outlook row for the largest panel of the selected crop
family (or the panel of the selected season), with the 80% prediction interval in the tooltip. Under contract
2026-10-09 the row comes from `world.json` (`columns.panels`: pct, lo, hi, lo_resp, hi_resp, baseline_production_mt,
n_series, status); under 2026-10-08 from the central `index_outlook` row of `panels.json`. Subnational tiling at
world level is deferred to the tiled-geometry milestone; a country with local records has a dotted outline and its
map shows its units.

The first-screen transfer on the outlook layer for the candidate is `world.json` (0.16 MB) and `catalog.json`
(0.07 MB) beside MapLibre (1.05 MB) and the world outlines (1.46 MB); `panels.json` (1.46 MB) is no longer read, and `calendar_world.json` (0.40 MB) loads with the calendar layers only.

## The maps

The harvest-anomaly layer (18 October 2026) colours every reporting unit, for a chosen harvest year, by the departure
of its reported yield from the series' own log-linear trend, `anomaly_pct` of `trend_anomaly`, the value the unit page
plots; the colours saturate at ±30 percent and nothing is hatched, the values being observations. The world map
colours a country by its national series (the national unit's series of the panel the outlook map colours it by, or
the family's national series where that panel has none, named in the tooltip) and draws the local units of
`world_units.json` over it; a unit without a reported yield that year is not drawn, so the national colour shows
through. The country and place maps take each unit's series for the chosen crop and season and show grey where the
year has no yield. The year control (a slider, step buttons and a timeline of the December–February relative Niño 3.4
with the number of series per year) changes `year` through the router, so every year is a history entry. The data are
`data/<release>/anomalies/<family>.json` (every public series of the family from 1961 on, keyed by series id, fetched
once per family; maize 9.4 MB) and `anomalies/index.json`, written by `scripts/anomaly_layer.py` from
`scripts/export_release.py`; a release without the folder does not offer the layer. `tests/site_anomaly.cjs` checks
the layer, `tests/schema.py` and `tests/numerics.py` the files.

Outlook maps hatch reporting units whose published central 80% ENSO-effect range includes zero (`lo <= 0 <= hi`).
The endpoints come from the selected central outlook and harvest year, including response and outlook uncertainty.
This applies to national fills, world-level local overlays, country maps and the units visible on regional maps.
The hatching sits above the response color and beneath the crop mask and boundaries. Selected units retain their
data color and violet outline. The key and tooltip say “80% interval includes zero”; this is distinct from
predictive skill. Missing or malformed intervals do not receive a zero-response classification. Calendar and
historical-response layers do not use this hatching. The legacy 2026-10-08 contract publishes 95% intervals;
those are not relabelled or treated as 80% intervals. The modern 2026-10-09 contract (including the 10 October
release) supplies the required 80% ranges. Run `node tests/site_uncertainty.cjs` to check all map levels.

The outlook layer uses one scale on every map: brown for a yield below the fitted trend of the harvest year,
green above, saturating at 10 percent. "Not estimated" (grey) is a unit or country with records but no outlook
row; "No <crop> records" (near white) is one without the series. A value of exactly zero takes the pale centre of
the scale.

The crop-calendar map shows typical harvest dates on a diverging rose-to-blue scale: past dates are rose,
today is the pale center, and future dates are blue. Its key is above the map and spans six calendar months
before and after today, with today exactly at the midpoint. Each half is linear in elapsed days; this allows
the two six-month periods to differ in day count. The fixed scale is shared across maps and retained when
panning. Dates retain their actual calendar year; dates outside the window saturate at the end colors and
retain their full dates in tooltips. Missing calendars and unresolved crop cycles remain separate states.
The legacy `progress`, `planting` and `harvest` links all open this calendar view; a legacy `date` parameter
does not override today's scale. `calendar.js` supplies the shared rolling-window arithmetic. The stage
calendar below the map uses the same window, showing only published seasons that overlap it, including
adjacent harvest years when available. It does not invent annual recurrences. That bar retains sage for an
undifferentiated growing season and distinct stage colors. These are typical calendar dates, not observations
of field operations this year.

The world calendar comes from `data/<release>/calendar_world.json` (contract 2026-10-09: per panel the
calendar_status rows of the country's national series for harvest years 2024 to 2027, with `published_range`; the
row of the target harvest year is drawn) or from `fixtures/world_calendar_<release>.json` (contract 2026-10-08: one
row per panel). The country map takes each unit's dates from its series' `calendar` rows (`plant_date`,
`harvest_date`, `calendar_source`, `confidence`, `cycle`, `cycle_unresolved`) or, under 2026-10-08, from its
`windows` rows. "Crop cycle unresolved" follows the published `cycle_unresolved` flag under 2026-10-09 (cycle
`both` or confidence `missing`); under 2026-10-08 it follows the pilot's rule for Brazilian annual maize, whose
first- or second-crop window from the month rule is shown as unresolved (`cycleUnresolved` in `app.js`).

State outlines and label centres come from `display/<release>/regions/<ISO>.json`; the candidate has no display
folder, so the site falls back to the source release's file (`catalog.source_release`; the candidate copies its
geometry from that release), and failing both, places the state labels at the mean position of the state's units.
Country maps fit the units that carry the series between the 2nd and 98th percentiles of their centres, so the
Aleutians or Hawaii do not shrink the rest; the zoom control reaches them. Brazil's 5,391 polygons (8.5 MB) take
about 25 s to tile in the browser with the present country files; the tiled-geometry milestone addresses that.

## The unit page

A context map (the unit within its state, a state within its country, a national unit alone), then the rows
temperature, rainfall and yield, sharing one horizontal axis with a toggle between growing-season ENSO
exposure (the `enso` rows of the record, relative Niño 3.4 by default) and harvest year. Beside each chart a
narrow column of at most three numbers, "From ENSO", "So far" and "At harvest", each with one interval or one
sentence saying why there is no number; under each row one "Details" disclosure with everything else. On a screen
under 800 px the numbers sit under each chart. A row renders only when it carries a value in one of its slots or
a mark on its chart; a row whose every slot would read "not yet available" (greenness until NDVI is extracted, a
weather row with neither a fitted response nor season-to-date observations, every weather row of a state page) is
left out, and the Methods section lists what is deferred in one paragraph. The yield row always renders.

What each row draws under contract 2026-10-09 (the record shard `records/<ISO>/<unit>.json` is read for every
unit; it carries the ENSO exposures, the season-to-date weather and the weather-variable responses whether or not
the observations are published):

| Row | Chart | From ENSO | So far | At harvest | Details |
|---|---|---|---|---|---|
| Temperature | the fitted response of the season mean temperature (`responses`, variable `tavg_mean`, `slope_eb`) as a line through the origin; the season-to-date anomaly as an open "so far" circle; no points, since no seasonal history is published per unit | the slope per +1 °C of the relative index with its standard error and own-data weight | `weather`, product `best`, metric `tavg_mean`: the anomaly, its direction, percentile and seasons | pending | product, cutoff, elapsed days, coverage, every metric of the product, the `tavg_mean` and `tmax_p95_days` responses with their unpooled slopes, the country panel's expected anomaly where published, the growing window |
| Rainfall | the same with CHIRPS `precip` in mm and the `precip` response | the slope in mm per +1 °C | the anomaly in mm with percentile | pending | as above, with the percentage departure and the `wet_days` response |
| Yield | filled points: the departure of each year from the series' fitted trend (`trend_anomaly`, null where withheld); one curve with one band from the response_leaf row (`pct_eb`, `lo_eb`, `hi_eb`, drawn as 100(exp(βx)−1)); an open diamond with its 80% prediction interval for the central `index_outlook` row of `prediction_series` | the central `index_outlook` row with `lo` to `hi` | "Available after harvest" | the `weather_todate` row where `usable`, else "Updated forecast not yet available" | series, source and permission, basis, level, years, trend, window with its source and confidence, other harvest years, the fit with `own_data_weight`, `se_source` and the unpooled slope, the state and country aggregate rows with both intervals, every prediction row, the weight row (area, trend yield, baseline production, status), the panel's hindcast skill from `skill.json` (loaded when the disclosure opens: index_hier, index_todate and weather_todate at the nearest evaluated lead, the `_blocked` benchmarks behind a nested disclosure), QC flags, file links |

The intervals beside the outlook numbers and through the forecast diamond are the central 80% prediction
interval of the replicate draws; the band around the yield curve is the 95% confidence band of the fitted
response; the methods text says so once. A response row noted `no_own_slope` withholds the curve and the page says
the own estimate would equal the pooling center. Under contract 2026-10-08 the page draws what the 8 October
tables carry: the `response_unit` curve (`pct_best`, 95% coefficient interval, fit level and shrink weight), no
weather responses (marked pending), and the methods text names the coefficient intervals.

A state page shows the state's three-scenario outlook from the `regions` aggregate rows of the country file
(`pct_mean` with `pct_lo`/`pct_hi` and the response-only `pct_lo_resp`/`pct_hi_resp`), the central row as the
headline number and the forecast diamond, with no curve and no points, since a state aggregate is a production-
weighted sum of its units and never a pooling center. Under 2026-10-08 it shows the `response_region` curve.

Observations are drawn as points only where the series' `display_points` is true (contract 2026-10-09, from
`permissions.toml` through `catalog.sources[<permission>]`); for a restricted series the shard carries null
observations, anomalies and QC flags with a `withheld` reason, and the page draws the fitted relationship, names
the reason from the source's permission note, and says "withheld" beside the chart and in the credit line. Under
2026-10-08 the list `PUBLIC_SOURCES` in `app.js` stands in for the permissions table and the records file of a
restricted source is never requested. Credits on the first screen come from `catalog.sources` (citation, licence,
display rule) where the catalog carries them.

## What the present tables lack

The page marks pending until the results tables carry them: per-unit seasonal histories of the weather metrics
(the points of the temperature and rainfall rows and an interval on their responses); NDVI; tiled geometry and a
regions file in the candidate's own folder; a units file sharded by crop family (units/BRA.json is 28 MB, loaded
for the Brazilian country map).

## Tests and serving

    cd 4_ag/enso-yield-atlas
    npm run test:site        # tests/site_calendar.cjs, tests/site_ui.cjs for the default release and the candidate, then schema.py, numerics.py, acceptance.py, display.py
    npm test                 # the site tests, then the archived applications' tests
    python3 -m http.server 8765 && open http://127.0.0.1:8765/site/

`tests/site_ui.cjs [release]` runs the application with a DOM implementation and a MapLibre stub through the first
screen, the world and country maps on the five layers, the unit, state and national pages for US maize (Adair,
Iowa), Indian kharif rice (Kota, Rajasthan), Brazilian maize (Batatais, São Paulo), Argentine maize (Victoria,
Entre Ríos) and Kenya, checks which rows render, and compares every displayed number to the unit, country and record files of that release
with its own contract-aware readers, and the calendar status to the fixture. The Python tests run with `$PYTHON`,
else `~/.venvs/enso/bin/python`, else `python3`.

## Changelog

2026-10-09 (evening). `app.js` opens the candidate release (contract 2026-10-09) and keeps the default: a
data-access section dispatches on `catalog.contract`; the world map reads `world.json` rows and
`calendar_world.json`; the country map reads `units/<ISO>.json` calendar rows, `display_points` and the published
`cycle_unresolved`; the unit page reads the response_leaf rows (`pct_eb`, `own_data_weight`, `se_source`,
`no_own_slope`), the record shard for every unit (withheld rows named), the weather responses as lines, the
aggregate state and country rows, the weight row and `skill.json` with `index_hier`; the state page shows the
three-scenario aggregate; credits come from `catalog.sources`; the methods text names the 80% prediction interval
and the 95% confidence band. `tests/site_ui.cjs` takes a release argument and `npm run test:site` runs both.
Later the same evening: rows with nothing to show (greenness, weather rows without a response or observations)
are left out of the unit page and the deferred quantities are listed once under Methods.

## Archive

The earlier applications, `global/`, `climate/` and `watch/`, stay on disk unchanged with their frozen data and
their tests (`npm run test:archive`); they are not maintained. The 8 October three-view application is in the
repository history (commit a61ff1b); its bulletin (`bulletin-2026-10-08.html`) and reporter walkthrough
(`reporters.html`) still link into the atlas through the old routes. The GitHub Pages build (`scripts/build_pages.py`)
and `hosting.json` work as before: on `phuybers3.github.io` the data, display and fixtures folders are read from
the deployment commit.

## 10 October 2026: one map box, click-through levels, regional detail on the landing page, weather histories

The maps no longer zoom or pan: every map fills one box of fixed proportion at the top of the page, the world
map trimmed to 65°N–65°S, and the reader moves between levels by clicking. The world map draws every reporting
unit of the panel each country is coloured by (`world_units.json` for the values, `geometry/world_units.json` for
a coarse copy of the polygons, 0.05° simplification), over the national fill, once those files have loaded; a
click on a unit or a country opens the country. A country whose panel has 150 or more mapped units and more than
one state opens its states first (a unit click or a state label), and the state page shows the state's units; a
smaller country opens its units directly. The unit page shows the units of its state with the unit outlined. The
national polygon is drawn beneath the units and unfilled wherever local units exist. The place boxes and the
state lists are gone; the footer's Methods link and every internal link carry the release.

The temperature and rainfall rows now draw the complete seasons since 1981 as departures from the series' own
linear trend (`weather_history` in the record shard: `[harvest_year, tavg_anom, precip_anom]`, products best and
chirps, the detrending of the leaf fits) beside the fitted response line, with a diamond for the season's
expectation under the central path of the outlook. Their first number answers the same question as the yield
row's: the departure expected this season, the fitted slope times the mean relative-index path over the
series' growing window (`weather_expected` per variable: `[harvest_year, exposure_central, expected_central,
n_months, exposure_todate, expected_todate, n_observed]`); the sensitivity per degree moved to Details, and the
third number is the departure the index observed so far implies.

Wording: the range beside an ENSO-outlook number is named the 80% range of the ENSO effect, relative to a
neutral-ENSO season; the range beside a weather-to-date number is the 95% confidence interval of the fitted
mean; neither is called a prediction interval. An ENSO-outlook number whose method has no skill against the
trend at its lead is marked conditional and its line says it is a historical response, not a validated forecast.

Tests: `tests/schema.py` checks the two world files and the two record fields; `tests/numerics.py` rebuilds the
histories from the release database, the expectations from `response_leaf`, `scenario_index_path` and
`calendar_status`, and the world unit values from `prediction_series`; `tests/site_ui.cjs` delivers map clicks as
MapLibre does (integer ids, the national polygon first), asserts the drill-down rule, the outlined unit, the units
overlay, the disabled zoom and the interval wording.

## 10 October 2026, later: the Pacific trim, direct clicks, state averages, and the notes below the rows

The world map is cut at 130°W as well as at 65°N and 57°S, so the eastern Pacific west of the Americas no longer
takes a seventh of the box; `WORLD_LON` sets the cut, the sea frame follows the two bounding meridians, and two
mask polygons in the page colour cover the land the rectangular box would show outside the curved meridians
(Alaska and the Yukon). The box is 2.12:1 at every level. A click on a reporting unit of the world map opens its
country, whatever the country's size (the direct link to the unit of the afternoon was reverted the same evening at
the user's request): the country map shows the units, and only a country with 150 or more units puts the state
level between the country and the unit.

A state page draws the same three rows as a unit page from a state record the exporter writes beside the unit
shards (`records/<ISO>/state_<key>.json`, listed under `states` in the record index, keyed `crop_code|season`):
the mean yield of the state's reporting units weighted by harvested area, with a log-linear trend fitted to that
mean series, the weighted season temperature and rainfall histories, the weighted season so far and the weighted
expectations from ENSO; its yield response is the hierarchical state center (`pooling_center`), never an average
of the leaves. The record exists for every state with two or more reporting units, and a year enters the average
only when at least two units and a quarter of the state's units report it.

The rows carry a chart and three numbers and nothing else: no explanatory line under a number, no coverage line
on the chart, no Details disclosure. What those held is now a few sentences of notes below the rows (the record,
the growing window, the fitted sensitivities per degree, the ranges with their names, the validation verdict, the
season so far, the state and country outlooks, the outlook paths, the files). The Methods section of the landing
page is shortened to the same end; the paper that accompanies the atlas carries the method.

Tests: `tests/site_ui.cjs` reads the notes for the ranges, the sensitivities and the validation words, checks the
state page's rows and points against the state record, the world bounds, frame and masks, and the direct click
from the world map; its national-only case is now found in the catalog rather than named, since Kenya gains
units with HarvestStat Africa. `tests/schema.py` checks the `states` index and the shape of every state record.

## 10 October 2026, evening: the place page as a local map beside stacked charts

The unit and state pages no longer stack a state map over three full-width rows. The left column holds a local map:
a window of fixed ground size, 1,000 by 750 km (`LOCAL_WINDOW_KM`; the width is measured along the parallel through
the centre and the height follows the box's 4:3 proportion in Mercator units, so the scale is the same on every
page), centred on the unit or on the mean of a state's units, in a 4:3 box without zoom or pan. Every reporting
unit inside the window is drawn, from any country: the own country's units from the file already loaded, coloured
as on the country map; the neighbours' units from their country files as they arrive (`countriesInWindow` picks
the countries whose outline parts touch the window from `geometry/world.json`), coloured from `world_units.json`
by the medium outlook of each country's largest panel of the crop family, and a country that reports nationally
only as its national polygon coloured from the world panels. The place is outlined (a state by all its units). A
click on a neighbour opens its page with its country's panel of the same family, or its country page where the
family has no panel there. Units without a value for the panel are drawn beneath the coloured ones, since Zambia
carries both the Hultgren districts and the FEWS NET districts. A unit that is its own state is named once.

The right column holds the three rows stacked at a compact height, the horizontal axis drawn once under the last
chart, and the three numbers on one line under each chart. The notes and credits follow below both columns; on a
phone the columns stack. Tests: the window's width and centre against the unit's coordinates, the map beside the
charts, the single axis, the neighbours of Entre Ríos (Brazilian municipalities and Uruguay) and the cross-border
click into Brazil's maize panel; the MapLibre stub gained `setData`.

Later the same evening, at the user's request: the window is 1,000 by 800 km in a 5:4 box; each row's title is
drawn in its chart's corner (the label element stays, visually hidden, for readers of the structure); the three
numbers sit on one 12 px line under each chart with the harvest year dropped from the keys, since the title names
it; and the gaps between the charts are closed, so the chart column and the map column come out about even.

Later still (the Maharashtra review): a state is shown by fading everything outside it (`dim-fill`, the page colour at
0.6 over units that are not the state's) instead of outlining each of its units; the sea of the country and local
maps is blue-grey (#dfe6ec), so a unit without records (paper) and land without unit records (grey) both read as
land; the window is 1,000 by 1,000 km in a square box. The panels follow a paper's figure: a letter (a), (b), (c) at
the top left of each, the axis label turned along the vertical axis, no labels on the forecast and season-so-far
marks (they collided at the right), and a caption under the stack that names the panels, the axis, the line and
the two open marks; the panel is 150 px tall. `tests/site_ui.cjs` checks the letters, the rotated labels, the
absence of the mark labels, the caption, and the faded state.

And after the next review: nothing stands above or between the panels. The three numbers of each row sit in a block
under the caption (`.numbers`, one `.numrow` per panel keyed by its label), and the axis selector and the record line
follow them. The vertical axis labels read "temperature anomaly (°C)", "rainfall anomaly (mm)" and "yield anomaly
(t/ha)": the yield panel is in tonnes per hectare, the record's departure of the reported yield from its fitted trend,
with the fitted curve and the forecast scaled by the trend yield of the harvest year from the record's log-linear
trend (intercept at 2000, growth per year); it falls back to percent where a record has no trend. The 11 October percent-display update below supersedes this yield scale. Every fitted line
carries its 95% band from the empirical Bayes fit (slope_eb ± 1.96 se_eb for the weather responses, lo_eb and hi_eb
for the yield), the panels are 215 px tall with 13 px ticks and 14 px axis labels, and a zero line is drawn on every
panel whether or not a tick falls there.

## 11 October 2026: every source's observations are shown

The user's rule: all data are shown on the pages; what a source with unrecorded terms withholds is bulk
redistribution. `2_data/build/permissions.toml` sets `display_points = true` for every entry and the default, and
`redistribute = false` for HarvestStat Asia and the Hultgren panels outside the agency countries. The record shards
serve observations one place at a time and the export has no bulk file, so the restriction holds by construction.
`tests/schema.py` now requires every yield source to show its points and those two sources to withhold
redistribution; the credits table says "shown one place at a time; no bulk redistribution" for them.

## 11 October 2026, later: CROPGRIDS weights and the Cropped area layer

The weather of a unit is averaged over its grid cells by the harvested area of the crop family being shown, taken
from CROPGRIDS v1.08 (Tang et al. 2024, harvested area of 173 crops for 2020 at 0.05 degree), in place of the
SPAM 2010 weights of the crosswalk of 26 September. `2_data/build/20_weather_crosswalk.py` builds one crosswalk row per
unit and family (`unit|maize`, `unit|rice`, ... keyed by `weather_store.weather_key`), and a unit whose series are all
of non-staple crops keeps an all-crop weighting; `21_weather_units.py` writes the daily unit files per key, packed as
16-bit integers, and the season tables and the tracker read the key that matches each series. The crosswalk step also
writes `crop_area_units.csv` (unit, family, harvested hectares, land hectares, share), and the exporter carries it into
the units file as `crop_area`, per unit and family, as `[hectares, share of the unit's land]`. The share passes one
where fields are harvested more than once a year (An Giang's rice, 1.6), and the tooltip and the notes say so.

The map selector gains "Cropped area": raster tiles of the harvested share of every 0.05 degree cell for the family,
built by `scripts/build_crop_tiles.py` into `data/static/cropgrids/<family>/{z}/{x}/{y}.png` (zoom 0 to 6, 256 px,
2,933 tiles, 13 MB across the six families, palette PNGs; `manifest.json` carries the 16 stops from 1% to 90%, their
colours, the counts and the SHA-256 of the source maps). The tiles are served with the data (`dataURL`), so the
published site reads them from the deployment commit. On the country and place maps the tiles sit under the unit
outlines, whose fills turn transparent and whose lines turn grey; the tooltip gives the unit's hectares and share;
the legend is the tile palette with ticks at 1, 10, 28, 52 and 90 percent and a swatch for "below 1%, or no crop".
The world map is drawn in its own projection and keeps the outlook colours on this layer; its credit line says the
layer is drawn on the country and place maps. The notes of a place gain a line with the CROPGRIDS hectares and share
of the unit, or the sum over a state's units. `tests/site_ui.cjs` checks the option, the raster source and the
transparent fills on the country and place maps, the legend, the tiles on disk, and the notes line; `tests/schema.py`
checks the shape of `crop_area` and counts the units that carry it.

## 11 October 2026, afternoon: the cropped-land mask replaces the Cropped area layer

The user's rule: rather than a layer of its own, a box that, when ticked, shows the map colours only where the crop is
grown. The controls row has a checkbox, "Cropped land only (above 5% harvested)", off by default. Ticked, it sets
`mask=crop` in the query, which every link carries, so the setting made on the world map holds on the country map, the
state page and the place map, cross-border clicks included. The map then draws a paper-coloured raster above the unit
fills and below the outlines wherever the CROPGRIDS 2020 harvested share of the selected crop family is 5% or less of
the land, so the colours of whichever layer is shown (outlook or the three calendar layers) remain only on cropped land,
while the outlines keep the political units legible and tooltips and clicks keep working over the whole unit. The
legend gains a swatch for the masked land and the credit line names the threshold and source.

`scripts/build_crop_tiles.py` now builds the mask instead of the share ramp: per family, Mercator tiles for zoom 0 to 6
under `data/static/cropgrids/mask/<family>/{z}/{x}/{y}.png` (palette PNGs, opaque paper or transparent; the share at a
zoom is harvested area over land area aggregated to about the pixel's size, 2^k fine cells by zoom, so a coarse pixel
counts as cropped when its aggregate passes 5%; the sea, −1 in CROPGRIDS, is transparent; 1,888 tiles and about 1 MB per
family) and, for the world map, which is drawn in its own Equal Earth plane where Mercator tiles cannot align, one RGBA
image per family under `data/static/cropgrids/world/<family>.png`, 2,400 by 1,132 pixels rendered in that plane by the
inverse projection and pinned by the site to the corners of the box with an image source. `manifest.json` records the
threshold, the zoom factors, the world image's frame, the counts and the SHA-256 of the source maps; a different
threshold is a half-minute rebuild. The `crop_area` figures stay in the units files and the place notes.

`tests/site_ui.cjs` checks that the box is off by default and draws nothing, that ticking it adds the image source on
the world map and the raster tiles on the country and place maps between the fills and the outlines, that the legend
swatch and credit clause appear, that a calendar layer is masked too, that a world click and a unit click carry
`mask=crop`, that clearing the box removes the mask, and that the tiles and world image are on disk.

And after the Nebraska review: a state page no longer lays its paper wash over the units outside the state at all
(`dim-fill` and the `dim` property are gone). The user's rule: the political boundaries are enough; the wash had
turned the neighbours' cropped land into a pale third class once the mask was on. `tests/site_ui.cjs` checks that no
wash is drawn with or without the mask.

The map tooltip (11 October 2026, evening): it sits below and to the right of the pointer and flips to the left or above
when that side would run past the map's edge, so it no longer slides into a corner over the unit being pointed at.

## 11 October 2026: regional page composition

The regional page uses the approved compact layout for reporting units, state averages and national-only records. The heading gives the place, crop, season when needed, and harvest year. Native buttons switch between the ENSO relationship and history while preserving the release, crop and crop mask. The local map shares the top and bottom of the chart frames. Its colour scale sits above the map and the crop calendar below. At phone widths the columns stack.

The default view has one yield estimate, its ENSO-effect range, and the release's validation status. Untested skill, nonpositive skill and positive skill with incomplete validation checks have separate wording. A state aggregate does not inherit validation from its members. Missing estimates, withheld observations, unresolved crop cycles and extrapolation are stated when applicable. The 80% ENSO-effect range remains distinct from total harvest uncertainty.

Details contains the original numerical rows, plot interpretation, local source information, fitted responses, regional comparisons, calendar provenance and the crop-mask control. Paper & data describes the descriptor as in preparation and links the current methods, source register and repository. The regional page does not offer unchecked links to mixed-source bulk record files. Weather and ENSO cutoffs and the selected release remain visible. All values continue to come from the existing release adapters; no source priorities, stable districts, databases, model results or crop-mask layers were changed.

The presentation controller and styles are in regional-page.js and regional-page.css, loaded by index.html. renderDetail supplies its existing chart specifications to the controller, which redraws at the measured width and resizes the existing MapLibre map without rebuilding its layers. The calendar adapter respects the renderer's heading and moves source provenance into Details. The rolling calendar uses one row, marks January with its year and places Today at the exact center. Resize observers are disconnected when navigating between pages.

The site test command includes the regional validation-status cases, calendar component and integration checks, and interface checks for all three available releases. The interface tests compare displayed values with their frozen release files and check navigation, missing records, aggregate pages and closed disclosures. The first-screen payload calculation includes the calendar and regional presentation assets. The Pages builder includes these assets once they are tracked with the other site files.

The 11 October percent-display update labels the yield panel "Yield anomaly (%)" in both chart views. Each historical point uses the exported anomaly_pct: 100 times reported yield divided by that year's fitted trend yield, minus 100. The fitted response, forecast diamond and interval retain their published percentages, matching the map and headline. Hover text retains reported and trend yields in tonnes per hectare. Missing percentages are omitted. The interface checks recover plotted values from the SVG's labelled grid lines and compare the observed points, forecast and interval with the frozen release values.

Map borders use slate gray above the crop mask so boundaries remain visible outside cropped land. National outlines use a thicker charcoal line with a pale halo. The selected unit has a thick violet outline with a pale halo above the mask. Its fill remains on the selected quantity's color scale. The national outline layers also cover neighboring countries as their existing boundary files arrive.

## National weather display supplement (11 October 2026)

`build_national_weather.py --release 2026-10-10` builds historical temperature and rainfall observations
for national-only crop series from existing local weather archives. `site/data/national-weather/index.json`
links each release to the country files. The interface uses these files only where national weather history
is absent in the released record. Release database rows, fitted responses, and forecasts are unchanged.

Of 770 eligible crop series in 186 countries, 528 have temperature histories and 700 have rainfall histories
that pass coverage and record-length checks. Berkeley Earth supplies temperature; CHIRPS supplies rainfall
where it covers at least 90% of the crop weight, with ERA5 used elsewhere. The weights use CROPGRIDS v1.08
harvested area for the selected crop, on the published national boundaries. Each season must have every day
between the published planting and harvest dates, with at least 90% daily crop coverage. Separate linear time
trends are removed from temperature and rainfall after at least ten complete seasons are available.

These points provide historical context, not additional weather forecasts or fitted ENSO relationships. For
example, Serbia maize has temperature through 2023 and rainfall through 2025. Each page's footer and Details
name its endpoints and sources. The manifest records source terms, input identities, output hashes and excluded
calendars or boundaries; no data were downloaded. The build cache in `4_ag/planning/national_weather_2026-10-11/`
contains the daily aggregates, raw seasonal values and coverage audit. `tests/national_weather.py` independently
recomputes every exported anomaly from those seasonal values and tests missingness and inclusive date windows.

Local maps support dragging. Clicking another reporting unit preserves the camera center, zoom and page scroll
position while updating the selected outline, plots and calendar. Selection does not add a fill layer. Countries
entering the viewport load on drag completion, with duplicate polygon insertion prevented. New harvest dates
use the same scale centered on today. Scroll zoom remains disabled. A fresh direct place link still opens a
1000 km context window around that place; the panned camera is transient and is not encoded in the share link.

National fills are suppressed only when subnational records exist for the selected crop and season, not merely
because county geometries exist. Otherwise the counties supply outlines without fill or local-value events,
and the legend identifies the national estimate. For China maize, release 2026-10-10 contains 1,986 Hultgren
county series spanning 1980–2003 (main season), but the active outlook uses the national FAOSTAT Annual series,
1961–2024. The analysis's existing pre-2010 recency rule chooses that national fallback; this display fix does
not change the rule or manufacture county outlooks. The national conditional effect is +1.2%, with an 80%
ENSO-effect range of −5.1% to +6.1% and nonpositive historical skill. National temperature history extends
through 2023 and rainfall through 2025.

## 11 October 2026: display coverage audit

We checked all 52,233 source series, 15,994 reporting places and 1,702 state records in release 2026-10-10.
Navigation previously depended on the current prediction panels. That omitted 11,004 series in 518
country–crop–season combinations. The catalog now supplies additional record choices without manufacturing
forecast panels. Browse records, crop-record selection and place search provide access to historical seasons
and the 26 places without geometry. A local-series selector inside Details exposes published source and area
basis alternatives. The default tier and record-length ordering remains unchanged. India retains the released
HarvestStat districts and national FAOSTAT alternatives.

We show reported tonnes per hectare when an anomaly series is absent: 9,314 source series and 516 state records
have observations without exported anomalies. Where anomalies exist, the plot keeps percentages. The reported
yield table includes all permitted observations, including years absent from the anomaly series. History uses
the combined weather and yield year range. The harvest selection applies to map values, weather observations
and weather expectations. A completed harvest with a recorded yield is identified as reported.

We retain the compact default page. Details now includes published yield scenarios, additional weather
measures and relationships, data quality flags, and a separately labeled country-level historical-test table.
World-page disclosures provide covered-production crop summaries, monthly ENSO paths, release choices and the
change record. Source restrictions still apply, and these controls add no bulk-data download links.

Neighboring-country calendars load their published dates. World subnational overlays are shown only when their
exported panel matches the selected national panel. Release changes clear neighboring map caches, and pending
requests from a prior release cannot repopulate them. A missing selected-place boundary is explicitly labeled.

`npm run test:site:visibility` checks every modern-release source-series route, map outlook and calendar cell,
record shard, and withheld-observation rule. The audit also renders 52 detail cases across six crops, national
and local records, both axes and missing-forecast cases, plus state and harvest-year edge cases. The audit saves
JSON and HTML reports under `4_ag/planning/display_audit_2026-10-11/`. Existing interface tests cover all three
release adapters, navigation, masks, map selection and hosted data paths. These checks verify display coverage;
they do not establish forecast skill. This work changes neither release data nor the separate archived
`watch`, `global` and `climate` applications.

## 11 October 2026: map interaction follow-up

The display-coverage audit did not detect three browser interaction problems. An old
`USA/USA?crop=maize&season=main` link selected the national annual series, whose local
1000-km viewport hid most of the country. National fills made nonmatching county
polygons unclickable. A regional world overlay could miss the map's one-time `load`
event when the base source was still being tiled.

National links carrying a local-only crop season now resolve to the country overview.
US overview bounds cover the complete contiguous-country geometry. Other country
maps fit all matching local polygons when available; national detail pages fit country
geometry. Returning to the world clears place-specific source, season and harvest
choices. Countries with additional local records retain an overview instead of
redirecting automatically to their national record.

A transparent interaction layer permits selecting a historical county through the
national color. Selection resolves the county's actual crop and season; a polygon
with no record for the crop remains identified as unavailable. Calendar views without
an explicit season choose a local record where available. China therefore exposes
1,986 maize calendars and its 1980–2003 county yield histories. This release contains
no county yield outlooks for China; its current yield outlook remains national.

The world overlay now attaches when the base layer exists, including while workers
are still loading source tiles. `tests/site_map_regressions.cjs` reproduces the exact
US link, full US extent, state/county selection, selection through the national fill,
the local China calendar default, clean world links and the one-time load event.
Real browser checks also exercised these links, dragging and selection, and the
regional world overlay. Screenshots and validation notes are under
`4_ag/planning/map_regressions_2026-10-11/`.


11 October 2026: historical response trial

The country and regional maps now have a separate Historical ENSO response layer, measured as percentage yield change per +1 degree C of the selected growing-season index. Current outlooks remain separate. A release-keyed supplement under data/historical-responses supplies the China maize trial: 1,812 counties with at least ten usable years and 174 exclusions with an explicit reason. The release prediction arrays and source database are unchanged.

Reproduce from 4_ag/analysis with historical_trial.py. The trial output is results/historical_trial_2026-10-11_CHN_maize: inputs, fitted yield and weather responses, leave-one-year-out predictions, three-year and terminal-period checks, coverage, hashes and report.html. The observed seasonal ENSO index is supplied in these retrospective tests. Positive point skill is not a claim of issued-forecast skill or present-day applicability.

## 18 October 2026: the harvest-anomaly-by-year layer

A third map layer, Harvest anomaly by year, on the world, country and place maps: the departure of each reported
yield from the series' own trend in a chosen harvest year, with a year control and a timeline of the December–February
relative Niño 3.4 and the coverage per year. The files, `data/<release>/anomalies/<family>.json` and
`anomalies/index.json`, come from `scripts/anomaly_layer.py`, called by the exporter after `world_units.json` or run
standalone against an exported release with `--update-manifest`. The plan is
`analysis/planning/atlas_harvest_anomaly_layer_plan_2026-10-18.md` and the runbook
`analysis/planning/atlas_harvest_anomaly_layer_runbook_2026-10-18.md`. Deferred: the state pages, a marker on the
unit page's yield panel, a play button and the ENSO-neutral trend as a toggle.
