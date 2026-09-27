# Climate and crop atlas · 2026-09-26

[Open the combined atlas](https://phuybers3.github.io/enso-yield-atlas/climate/) · [Preserved yield atlas](https://phuybers3.github.io/enso-yield-atlas/global/) · [Data definitions and input hashes](climate/data/2026-09-26-climate-v1/catalog.json) · [Release file manifest](climate/data/2026-09-26-climate-v1/manifest.json)

We add four weather layers to the agricultural reporting regions: average temperature, the 95th percentile of daily maximum temperature, average daily precipitation, and the 95th percentile of wet-day precipitation. Each layer supports observed levels, trends and ENSO responses. The yield observations and analyses remain those of the preserved atlas; no agricultural record or `/global/` asset was changed.

## Scope and definitions

The release contains 2,054,295 crop-season rows across 45,651 exact matches to the agricultural atlas's stable series keys. A series includes its crop, source, reporting unit, area basis and calendar. We preserve overlapping source series but choose one source tier for a country when mapping; we do not average overlapping regions into a national value. The six crop families are wheat, maize, rice, soybean, sorghum and cassava.

| Layer | Annual observation | Unit | Eligible seasons |
|---|---|---|---:|
| Average temperature | Mean of regional daily `(Tmax + Tmin)/2` | °C | 1,945,397 |
| Hot-day temperature | 95th percentile of regional daily Tmax | °C | 1,947,263 |
| Average precipitation | Regional rainfall total divided by exact valid days, including dry days | mm/day | 2,028,308 |
| Heavy-rain intensity | 95th percentile of regional daily precipitation on days with at least 1 mm | mm/day | 2,012,341 |

Weather is first averaged within a reporting region, using the source crosswalk's summed SPAM 2010 harvested area of six staples, with area fallback where cropland is absent. These spatial weights are shared across crops; their calendars differ. Percentiles are then taken over the regional daily series, using NumPy's linear percentile convention. A multi-year map averages those annual crop-season statistics. It is neither a percentile of pooled days nor a percentile of all individual grid cells. Historical cell-first threshold exceedances remain separate upstream quantities and are not relabelled as these percentile levels.

Temperature comes from Berkeley Earth at 1° and runs through 31 October 2024. The precipitation series uses CHIRPS at 0.25°, with ERA5 fallback where CHIRPS coverage is inadequate, through 31 December 2025. Each regional panel reports its precipitation source, grid-cell count, spatial coverage and nearest-cell fill. Small reporting units can share source grid cells. Weather is available for subnational reporting units; countries represented only by national agricultural records may have no weather layer. Their yield records remain accessible.

Every displayed weather observation requires its entire daily window to be present for that variable. Valid-day counts are reconstructed from the daily NetCDF arrays, not inferred from rounded coverage. Missing and incomplete weather stays null; valid zero rainfall stays zero. Wet-day percentiles additionally require five wet days. Annual rows retain exact start/end dates and expected/valid day counts in downloads. Rainfall totals in mm per season are available in the Advanced observation table and CSV, calculated from the complete-window mean and day count; they are not a separately fitted map layer.

## Using the atlas

Simple mode exposes layer, crop, statistic, period, and response scenario. Maps come first. A country opens its reporting regions and zooms to its boundary; selecting a region opens a panel over the map. Other countries retain their weather shading when panning outside that boundary. “Show whole world” resets the map and returns to the country list. Back or Escape closes the panel. The legend, regional values and CSV export use the same calculation and scale; gray denotes an unavailable value, not a zero. Response and trend colors are centered on zero and use a global scale that stays fixed when zooming. Color limits are rounded to readable numbers and exclude isolated extremes from setting the range: response and trend limits use the 95th percentile of absolute eligible mapped values, rounded up to 1, 2 or 5 times a power of ten. Observed-level limits span the 5th–95th percentiles, rounded outward to regular steps. These are percentiles across reporting units, not land-area-weighted percentiles. Values outside the range use the end colors; ≤/≥ legend labels and counts identify saturation. Tooltips, panels and downloads retain the exact estimates. Missing values remain gray.

Observed weather is plotted with the chosen ENSO index on the right axis. One standard deviation of the index is scaled to one standard deviation of the observed variable over paired displayed years. Yield appears below on the same year axis. The common-years checkbox restricts those two charts to their overlapping observations without silently changing the fitted weather sample. Gaps are not connected. A trend-adjusted scatter shows the actual fitted years and one selected ENSO curve, with its pointwise uncertainty band.

Advanced mode adds source, season, area basis, resolution, index, model, evidence, scenario support, event timing and a native-unit precipitation display option. Shared URLs retain the release and full selection. CSV downloads include exact coverage, series key and the selected numerical result; a JSON download contains the fit and settings. Country CSV exports contain that country's selected records; the world view exports the global selection.

## Precipitation display units

Precipitation ENSO responses default to `100 × fitted change / observed period average`, in percent. Trends use `100 × native trend / observed period average`, in percent per decade. Each reporting series supplies its own denominator over the selected years and crop season. For average rainfall, this is the mean of annual crop-season mean rainfall (including dry days); for the heavy-rain layer, it is the mean of annual wet-day 95th-percentile levels. It is not a pooled daily percentile, a national average, or the fitted neutral-ENSO level.

The baseline is treated as a fixed descriptive normalizer: estimates, standard errors and interval endpoints are multiplied by the same positive factor. This changes neither the fitted models nor interval exclusion of zero. Baseline uncertainty is not propagated into a ratio estimator. A missing or nonpositive baseline makes the percentage unavailable; zero observed rainfall remains a valid observation. Physical checks for negative fitted rainfall still use native mm/day.

Observed time series and tables stay in mm/day. The trend-adjusted scatter, response curve, map, regional result and result download use the chosen display units consistently. Advanced settings can restore native mm/day responses or mm/day per decade trends; `rainUnits=percent|native` is retained in shared links. CSVs distinguish observation units from estimate units and include the normalization baseline, its statistic and the native estimate. Model coefficients and covariance in fit JSON remain native.

## Models and inference

For an annual crop-season statistic `M` and exposure `I`, we jointly fit

`M(y) = a + g (y − 2000)/10 + b I(y) + d I(y)² + error`.

The linear model omits `d`; the hinge model replaces `d I²` with `h max(I, 0)`, giving separate warm/cold slopes. Weather is fitted in native °C or mm/day units; precipitation contrasts are normalized for display as described above. Negative temperatures and zero rainfall are retained. The response is the fitted difference from neutral ENSO at the same time trend; for the quadratic it is `b I + d I²`. This is an ordinary regression of annual weather statistics, including annual percentile levels, rather than a daily conditional quantile regression. The map's observed trend is a separate native-unit linear regression on time.

We use the preserved registry for Niño 3.4, relative Niño 3.4 and MEI.v2. Daily weather follows the exact planting/harvest dates, while index exposure averages the full monthly crop-calendar window. MEI averages the overlapping two-month values ending in those months. The paired sample is common across indices for each metric and period. Fits require at least 20 complete paired years, five positive exposures, five negative exposures, a full-rank design and observed variation. Otherwise the observation remains available and the response is marked unavailable.

Uncertainty uses 400 shared, three-year calendar-block resamples, anchored in 1980, with seed 20260926. A covariance estimate requires at least 360 usable replicates. For a response contrast `v`, its standard error is `sqrt(vᵀ Cov v)`; the displayed interval is the point estimate plus or minus 1.96 standard errors. Two held-out five-year-block layouts, anchored in 1980 and 1982, leave a one-year embargo on either side. The validation filter requires the selected ENSO model to improve mean squared prediction error over a trend-only model in both layouts. Model selection and inspection of many regions can still overstate apparent skill; these are pointwise intervals, not a climate-map multiplicity correction.

Scenarios distinguish a direct crop-window mean from an illustrative event that peaks at +3°C. For the latter, the preserved monthly event profile is first averaged over each unit's calendar. MEI uses index units and does not inherit a 3°C peak option. Responses outside the observed exposure range are flagged, and can be hidden with the support filter. Negative fitted precipitation levels, evaluated at the mean fitted year, are labelled unsupported and are not colored. These associations are neither forecasts nor causal estimates. Weather does not inherit yield pooling or yield field-significance flags.

Coefficients and covariances are stored to nine significant digits for delivery; rounding is relative, so small nonzero covariances remain nonzero. Observations are stored to six decimal places after exact counting and source calculations. Full-precision calculations occur before either storage step.

## Import correction and verification

The upstream monthly export has 649,000 December rows labelled month zero in the following year and omits December 2025. We did not change that file or its producer. The adapter rebuilt all 7,965,000 unit-month records from actual daily dates, including the final December, retaining missingness. The corrected local Parquet is recorded by hash in the catalog. The first public atlas uses crop seasons; additional monthly/calendar windows will require corresponding public summaries and fits.

[Numerical validation](provenance/climate/validation.json) checks all exported rows for unique years, exact window lengths, valid counts, missingness, rainfall bounds and agreement with map period means. Seven daily-data cases cover missing temperature, rice, the Southern Hemisphere, ERA5 fallback, nearest-cell fill, a cross-year crop and incomplete late-2024 temperature. We independently recompute their four metrics and the recovered December 2025 monthly mean. Synthetic native-unit tests compare all three models and their bootstrap covariance against direct weighted least squares. Persisted fits are also compared with independent least squares. [Fit validation](provenance/climate/fit-validation.json) checks every published fit shard for completeness, finite coefficients, sample rules and covariance validity.

Interface checks cover world and country coverage (including Brazil and the United States), deep-link camera positioning, regional overlay navigation, percentage calculations against observed values, fixed-baseline interval scaling, shared URLs, Simple/Advanced preservation, displayed versus exported values, zero versus missing colors, aligned charts, MEI, event exposure, negative-rainfall screening, and national weather absence without loss of yields. The existing yield regression tests remain unchanged. The complete `/global/` tree is compared byte-for-byte through Git with tag `yield-atlas-2026-09-26-v1` at commit `8f595a586377f06b037e8520ff3a8a058368f982`.

## Rebuilding and extending

With the original ENSO source tree and its Python environment available:

1. Run `scripts/climate/check_weather_ready.py --enso-root <ENSO root>` and `scripts/climate/audit_weather_import.py --enso-root <ENSO root>`.
2. Run `scripts/climate/build_weather.py` to rebuild exact coverage, corrected monthly records and observed shards.
3. Run `scripts/climate/fit_weather.py --crop <crop>` for each of the six crops. `--limit` writes a separate pilot directory. Limit parallelism to the available memory; this release used three crop workers.
4. Run `scripts/climate/finalize_release.py`, `tests/climate_numerics.py`, `npm test`, and `npm run test:climate`. Inspect desktop/mobile UI and check `git diff yield-atlas-2026-09-26-v1 -- global` is empty before publication.

The static site loads the preserved yield catalog, boundaries, index registry and vendor files by relative path. Changed interface and all weather shards reside under `/climate/`; the original dependencies remain frozen. The release manifest records each weather asset's size and SHA256.

Future extensions include national weather aggregation with explicit weights, crop-specific spatial weights, additional weather windows, precipitation occurrence and cell-first threshold counts, and independent station validation. Current source resolution and temporal coverage remain visible rather than being filled by statistical inference.

Agricultural, boundary and index attributions remain in [the preserved provenance](provenance/merged/README.md). Weather derives from [Berkeley Earth](https://berkeleyearth.org/data/), [CHIRPS](https://www.chc.ucsb.edu/data/chirps), and [ERA5](https://www.ecmwf.int/en/forecasts/dataset/ecmwf-reanalysis-v5), using the upstream regional crosswalk and crop calendars. Source data retain their respective terms; this repository does not apply a blanket license to them.
