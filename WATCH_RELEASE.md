# El Niño Crop Watch

[Open the Watch](https://phuybers3.github.io/enso-yield-atlas/watch/) · [Yield atlas](https://phuybers3.github.io/enso-yield-atlas/global/) · [Climate and crop atlas](https://phuybers3.github.io/enso-yield-atlas/climate/)

The Watch answers three questions for every country, crop and season in the
2026–27 harvests, in order: what usually happens here in an El Niño of the
forecast strength, what has happened this season so far, and what that
implies for the harvest. Each screen carries one verdict sentence generated
from the tables, one number with its interval or percentile and an evidence
grade, and one chart or map. It is reissued on the Climate Prediction
Center's monthly update; each issue keeps its data under its own tag in
`watch/data/<issue>/` with a manifest of file hashes, and an earlier issue
opens with `?issue=YYYY-MM` in the address.

## Issue 2026-09 (candidate release, 4 October 2026; not yet published)

Data to 25 September 2026 (CPC temperature adjusted to Berkeley Earth, CHIRPS
preliminary rainfall) and the relative Niño 3.4 index through September
(+1.97 °C). 184 countries and 771 crop seasons carry the expected response;
99 seasons are scored against the El Niño expectation; 59 have a
season-to-date yield model tested in the hindcast, and 32 pass the skill
gate and show a weather-implied estimate. Headline, computed by the exporter
from those 32 seasons (951 Mt in 18 countries, production-weighted, the
index-implied figure over the same seasons and weights): the season's
weather so far implies −4.7 percent of trend where the index alone implied
+1.7, with maize −8.0 against +3.8, soybean −5.7 against +2.2, rice +1.2
against +0.4 and wheat −5.8 against −7.7. Rainfall is arriving as the fitted
responses predict in about seven cases of ten; heat is running above
expectation almost everywhere. A production-weighted mixture of crops, not a
global food-supply estimate.

## What the numbers are

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
