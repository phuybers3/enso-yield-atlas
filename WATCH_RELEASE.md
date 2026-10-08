# El Niño Crop Watch

[Open the Watch](https://phuybers3.github.io/enso-yield-atlas/watch/) · [Yield atlas](https://phuybers3.github.io/enso-yield-atlas/global/) · [Climate and crop atlas](https://phuybers3.github.io/enso-yield-atlas/climate/)

The Watch has two views for each country, crop and growing season. **Yield
outlook** pairs estimates from the ENSO outlook with estimates from weather
observed so far. Both use historical relationships; the estimates remain
separate and retain their uncertainty and availability checks. **Season
weather** compares observed rain and temperature with ENSO-expected anomalies
and links to historical weather relationships in the climate atlas.

Each numerical issue keeps its data under `watch/data/<issue>/` with a manifest
of file hashes. An earlier issue opens with its `?issue=` identifier. Updates
require new data and validation; the dashboard does not refresh its numerical
results automatically.

### Weather map colors, 8 October

Seasonal weather maps use blue for wetter or cooler conditions, white at
zero anomaly, and red for drier or warmer conditions. Both legends run from
blue to red, with the rainfall endpoints labelled wetter (+30% or more) and
drier (−30% or less). Temperature endpoints remain −1.5°C and +1.5°C. Gray
marks unavailable observations. The county tooltip labels conditional yield
as an ENSO scenario. We retain the yield-map colors and all numerical values.

### Local and regional responses, 7 October

The current default uses `regional-v1`. We retain each reporting unit's own
stored ENSO coefficient when the fit has at least 20 valid years, the minimum
used for independent unit fits in analysis script 13. Shorter records use the
unpooled state or province fit, then the existing country or national fit.
We preserve the historical samples and coefficients from analysis script 15;
we do not refit the live observations view, whose available ENSO history has
since changed. The archived source-fit tables identify those samples.

Across 42,942 crop-season records, 30,989 use local fits, covering 66.5% of
production. For U.S. maize, 2,489 of 2,733 counties use local fits, covering
92.9% of production. The county map retains 2,505 distinct coefficients.
The central conditional aggregate changes from +5.0% to +7.7%. The observed
weather estimate remains −6.1% ± 0.6 percentage points. Country summaries,
the world map and the compound-exposure ledger aggregate the same regional
responses used on the country maps.

Local 95% intervals use the stored classical OLS errors with a t critical
value and n−3 degrees of freedom. Their independence and constant-variance
assumptions may understate uncertainty. State intervals retain harvest-year
clustered errors. These pointwise coefficient intervals hold ENSO exposure
fixed; they exclude residual yield variation and forecast uncertainty.
For U.S. maize, intervals span zero for 88% of covered production. We show
record length, fit geography and intervals when a user selects a region.
The map measure can switch between the central scenario and sensitivity
per +1°C of growing-season relative Niño 3.4. Colors saturate at the labelled
limits; numerical estimates remain unclipped. Fitted changes exceed 50% in
361 records, representing 0.52% of production, and carry an additional label.

Regional predictive skill has not been established. The displayed historical
tests describe the unchanged weather model; the earlier pooled ENSO skill
columns are omitted for this model. Exposure flags retain the earlier panel
maximum and do not certify that a scenario lies inside every local sample's
range. National aggregate coefficient intervals are omitted because shared
errors cannot be treated as independent. Calendar warnings remain in place.

We export the model separately under `watch/regional/2026-10-06-v1/`, with
source fits, unit coefficients and intervals, country files, scenario totals,
changes from the pooled release, methods and SHA-256 hashes. The generator is
`scripts/watch/build_regional_responses.py`. Earlier files stay unchanged.
Links with `?issue=2026-10-06` alone retain pooled results; newly copied links
also include `response=regional-v1`. A comparison link opens `response=pooled`.
The existing bulletin is explicitly labelled as the earlier pooled model.

Validation includes `npm run test:watch` and
`/Users/phuybers/.venvs/enso/bin/python tests/watch_regional_numerics.py`.
The checks cover unchanged source coefficients, local eligibility, intervals,
all unit-to-panel-to-country aggregates, frozen weather and calendars, file
hashes, model-preserving links, and the interactive sensitivity selector. Browser checks
confirm distinct county colors, sensitivity-layer tooltips, selected-region
intervals and sample years, and navigation between the regional and pooled models.

### Navigation update, 7 October

The header now has Explore, Food-security context, and About & data. Season
tables, compound exposure, downloads, and historical atlases are linked from
the relevant sections. Country yield estimates appear side by side; historical
test details expand in place. Weather tables pair observed and ENSO-expected
anomalies. Copying a link preserves the issue, crop, growing season and view.
Existing `view=patterns` and `view=yields` bookmarks open the combined yield
view; new links use `view=yield`. The numerical release and bulletin are unchanged.

Validation: `npm run test:watch`, JavaScript syntax, and whitespace checks pass.
Browser checks cover both views, mobile width without page overflow, preserved
crop and season, and the India/rice link to the historical weather atlas.

### Country map sizing and interpretation, 7 October

Country yield and weather maps use the full card width. Initial zoom fits the
selected reporting units while retaining the national outline for context.
For U.S. maize this avoids fitting the Alaska/Aleutian outline across the date
line: the 2,733 mapped counties occupy the contiguous United States.

The U.S. maize annotation records a common pooled coefficient across 41 state
fits. The regional variance estimate is zero, so the pooling model assigns
all states the same coefficient, 0.03485704 in log yield per degree of relative
Niño 3.4 (about +3.5% per degree). Eleven growing-season calendar windows produce
the displayed differences. This does not establish identical true responses
across counties. The annotation and source hash are in
`watch/context/map-notes-2026-10-06.json`; numerical estimates are unchanged.

Regression checks cover the U.S. extent, retained counties and national
context, and matching yield/weather framing. Browser checks confirm the larger
desktop map and both mobile views without page overflow.

## Issue 2026-10-06 (published 7 October)

We extend the matched rainfall and temperature record through 30 September.
The temperature source extends through 5 October; rainfall sets the common
cutoff. September remains the latest complete ENSO month. We retain the
10 September CPC outlook, with its next update scheduled for 8 October.

We correct current-season weather for crops harvested in 2027. The previous
tracker selected rows labelled 2026 for every crop. Some of those rows
described the preceding growing season. We now select each series' actual
target harvest year and verify that its weather starts on the target
planting date. Historical rows retain their own harvest years for yield
matching. We rerun the historical skill checks at the updated season length.

We also calculate the standard error of the production-weighted panel
estimate using the full coefficient covariance, including cross terms,
and propagate that error through the exponential percent-change function.
The standard error excludes unexplained yield variation. Unit map weather
and ENSO estimates now refer to the same selected crop-season series.

Production denominators now select the preferred source for each country and crop, then retain series with fitted responses. This removes duplicate national totals carried by overlapping sources and avoids treating missing fits as zero effects. Percentages refer to covered production.

The release contains 643 fitted crop-season panels in 175 countries. Weather is scored for 67 panels, and 38 pass the weather-estimate skill gate.

The release carries the status "Scientific review". The data directory
includes `changes.json` with differences from the September archive.
Source hashes, the numerical tracker source and validation records are
in `provenance/watch/2026-10-06/`. The prior data files remain intact for
comparison; their page displays a correction notice.

### Map display update, 7 October

Maps use brown for negative values, cream at zero and green for positive
values; missing estimates have a separate gray swatch. The world yield
scale is now ±10 percent. Country yield scales use a rounded 75th percentile
of absolute responses, capped at ±10 percent. Rainfall uses ±30 percent and
mean TMAX uses ±1.5°C. End labels mark saturation; tooltips retain the full
numerical values. Yield bars and table highlights use matching colors.

We also corrected map drawing order. The shared geometry contains national
and alternative-source polygons, which had covered the local colors with a
gray fill. National context now sits below the crop's selected reporting
units; overlapping alternative-source polygons are omitted. Map tests check
India, Indonesia and the United States, including serialized tooltip values.

## Issue 2026-09 (archived; superseded by the 6 October correction)

Data to 25 September 2026 (CPC temperature adjusted to Berkeley Earth, CHIRPS
preliminary rainfall) and the relative Niño 3.4 index through September
(+1.97 °C). 184 countries and 771 crop seasons carry the expected response;
94 seasons are scored against the El Niño expectation (a season is scored
only where the series with weather and yields carry at least a quarter of
the panel's production, so a sliver on an early calendar cannot speak for a
crop not yet planted); 59 have a season-to-date yield model tested in the
hindcast, and 35 pass the skill gate and show a weather-implied estimate.
Headline, computed by the exporter from those 35 seasons (1,238 Mt in 18
countries, production-weighted, the index-implied figure over the same
seasons and weights): the season's weather so far implies −2.5 percent of
trend where the index alone implied +1.2, with maize −2.9 against +2.2,
soybean −5.7 against +2.2, rice +1.2 against +0.4 and wheat −5.8 against
−6.3. Panel status is production-weighted: "not planted" until a tenth of a
crop's output has started its window, "harvested" once nine tenths have
completed it. Rainfall is arriving as the fitted responses predict in about
seven cases of ten; heat is running above expectation almost everywhere. A
production-weighted mixture of crops, not a global food-supply estimate.

## Earlier pooled interface and numerical issue

Screen 1 is the yield response to the relative Niño 3.4 index fitted on
1981–2025 within reporting units (unit intercepts and trends removed,
standard errors clustered by harvest year; unit slopes shrunk toward the
state), applied to the index path that joins the observed index to the
2015–16 event's monthly shape scaled to the outlook's 5th, 50th and 95th
percentiles (1.48, 2.27, 3.06 RONI, divided by 1.18 to the relative index).
The range shown with the median is the ENSO scenario range, the same fit on
the 5th and 95th percentile paths; it carries neither the regression
uncertainty nor the yield variation the index does not explain, and it is
labelled as not a yield prediction interval. The letter A to D is an
evidence checklist, not a calibrated reliability score; it counts four
conditions: at least 25 years of record, a slope distinguishable from zero
at 10 percent, at least 10 reporting units (or 40 years of a national
series), and a forecast inside the fitted range for at least half of
production.

Screen 2 summarizes daily temperature and rainfall over the part of each
season's window that has run, and over the same calendar days in every year
since 1981. The anomaly is the departure from the unit's own mean and trend
for those days. The expectation is the panel's regression of that anomaly on
the index, applied to the index observed so far; the percentile places this
year in the spread that regression leaves. A season is "as expected" when
every measure with a visible El Niño signal lies between the 10th and 90th
percentiles, "against" when none does, "mixed" otherwise, and "no expected
signal" when the regression predicts no anomaly as large as half the
year-to-year spread.

Screen 3 regresses detrended yield on the six season-to-date measures over
1981–2025 and applies the coefficients to this year's, for seasons at least
half run. The ± printed with each estimate is one standard error of the
regression estimate from the coefficient covariance; it excludes unexplained
yield variation and is not a prediction interval. Before an estimate is
shown it is tested in a leave-one-year-out hindcast at the same fraction of
the season (`season_tracker/scripts/08_hindcast.py`): each past year is
predicted from the others with the detrending, the within-unit
transformation and the coefficients refitted without it, and compared with a
trend-only baseline and with the index-only estimate; estimates appear only
where the skill against the trend-only baseline is positive, and the skill
table is printed with each season. Extrapolations beyond the fitted range
are marked. The headline aggregate on the front page is computed by the
exporter from exactly the panels shown, production-weighted, with the
index-implied figure over the same panels and weights; `summary.json`
carries the population behind it, and `tests/watch_data.cjs` recomputes it.
The compound-exposure page is the working paper's ledger: El Niño change,
Gulf nitrogen as a share of use, Black Sea grain as a share of supply, trade
through Panama or Hormuz, and undernourishment.

## Data release

`scripts/watch/build_watch_data.py --issue YYYY-MM` reads the ENSO database
(`enso_ag.sqlite`: series, units, `enso_monthly`, `enso_response_panel`,
`weather_todate_anomaly`), the working paper's tables (`exposure_series`,
`scenario_paths`, `ledger`) and the season tracker's tables, and writes
`watch/data/<issue>/`: `summary.json`, `countries.json`, `panels.json`,
`units/<ISO3>.json`, `ledger.json`, `index_path.json`, `manifest.json`.
Geometry is not duplicated; the pages read the merged release's
`global/data/2026-09-26-merged-v1/geometry/<ISO3>.json.gz` and `world.json`.
The pages are `watch/index.html`, `watch/app.js` and `watch/style.css`, with
MapLibre from `global/vendor/`. `npm run test:watch` (also part of `npm test`)
checks the release: summary counts against the files, no non-finite values,
season and year assignments, scenario ranges bracketing the median, country
aggregates as sums over panels without duplicate crop-seasons, the headline
recomputed from the panels, unit files, and every file's hash against the
manifest. The dataset deposit (`food_security_2026_27/release/`) archives the
geometry with the release so the Watch can be rebuilt without the live site.

## What it is not

Not a yield forecast: associations fitted to past seasons and scenarios on
the outlook. Not a food-security assessment: the FAO–WFP hotspots, FEWS NET
and the JRC's ASAP do that, and the Watch links to them. Not a farm-level
product: a reporting unit is a district or a state. The temperature
extension after October 2024 is a gauge product adjusted to Berkeley Earth
with a monthly error of half a degree at the median unit, so unit-level
temperature verdicts are provisional and the panel aggregates are the ones
to quote. Licences: our derived files are CC BY 4.0; the sources' own terms
continue to apply (the HarvestStat package and its Geolocet boundaries with
attribution, the Hultgren et al. replication package, FAOSTAT under CC BY 4.0
IGO with dataset-specific exceptions, Berkeley Earth and CHIRPS under CC BY,
ERA5 under the Copernicus licence, NOAA products in the public domain).
