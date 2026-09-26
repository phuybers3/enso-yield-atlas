# Yield, temperature and precipitation atlas

## Purpose and preservation

We will add temperature and precipitation to the agricultural atlas while retaining its map-first layout, Simple and Advanced modes, country navigation and regional overlays. The existing yield atlas remains at `/global/`, preserved at tag `yield-atlas-2026-09-26-v1` and commit `8f595a586377f06b037e8520ff3a8a058368f982`. The combined atlas will be published at `/climate/`. We will not overwrite the yield release, its analysis results or its interface files.

The user has authorized implementation when the weather data are ready. The scheduled follow-up attached to this conversation will check readiness and then carry out the stages below. It should continue implementation after readiness, not merely announce that files exist.

## What the ongoing work provides

We inspected `2_data/build/20_weather_crosswalk.py`, `21_weather_units.py`, `22_weather_seasons.py`, their logs and output metadata, and `4_ag/food_security_2026_27/notes/weather.md` in the ENSO project on 26 September. The daily build is complete. At inspection the monthly and crop-season export was still running. Station, ERA5-Land and GMFD comparisons described in the producer's original plan have not yet been run.

The daily files cover 14,750 subnational reporting units. Twenty-two additional agricultural units lack usable polygons. Berkeley Earth temperature spans 1 January 1981 through 31 October 2024; precipitation spans 1981–2025. CHIRPS v2 supplies most precipitation, with ERA5 for 97 units that lack adequate CHIRPS coverage. The files also retain an ERA5 daily precipitation series for comparison. These dates must appear separately in the atlas; a common release date does not imply identical observation periods.

The producer completed during this inspection: 2,760,975 crop-season records for 61,355 series and 7,950,250 monthly records. The import gate passed. `scripts/climate/audit_weather_import.py` found 45,651 exact matches to the preserved atlas, with no changed identifiers or calendars among matched series, and seven representative season recomputations passed. The remaining 15,704 source series are outside the atlas's six staple families. The detailed report is `results/climate_atlas/import-audit.json` in the ENSO project; the stable join is saved beside it as `series_crosswalk.csv`. A copy of the pilot report is in `provenance/climate/import-audit.json` in this repository. One checked Indian unit, the Andamans, has precipitation but no temperature coverage; this is an explicit missing layer rather than zero temperature.

The pilot also found a monthly export defect: 649,000 December rows have month 0 and the following year, and December 2025 is absent. The daily coordinates are continuous and include that month. We will rebuild monthly summaries from the daily coordinates in the atlas adapter; relabelling month 0 alone cannot restore the missing final month. The crop-season dates are independent of this monthly conversion and passed the pilot. Do not use the monthly export directly or mistake passing file-readiness checks for passing this date audit.

The spatial weights use the summed SPAM 2010 harvested area of six staples, with an area-weighted fallback where no cropped area exists. They are not crop-specific weights. Crop selection changes the season and agricultural series, but not this spatial weighting. Temperature has a 1° source grid; 6,104 units lie inside one source cell. A district boundary must not imply district-scale independent temperature information.

The current build supplies regional weather, not a national weather series for every country in the yield atlas. The first release will show available reporting regions and explicitly mark unavailable country aggregates. We will not construct a country statistic by averaging overlapping provinces, districts, seasons and source tiers. Direct national polygon aggregation can extend coverage later without blocking the regional release.

## Initial layers and definitions

The primary selector will choose Yield, Temperature or Precipitation. A second selector will choose Average, 95th percentile, Trend or ENSO response where that measure exists. Each choice sets the legend, units, tooltip and regional chart together. We will display one colored quantity at a time, with the same country outlines and selected-region highlight, to keep the map interpretable.

| Layer | Input and calculation | Display |
|---|---|---|
| Yield | Existing preserved observations and fits | Current paddy-equivalent and other crop units |
| Average temperature | `tavg_mean` within the crop season; verify the daily TAVG half-sum definition in the source metadata | °C |
| Hot-day temperature | `tmax_p95_season`, the season's 95th percentile of the region's daily mean Tmax | °C |
| Average precipitation | Daily precipitation summed and divided by the exact number of valid days in the season | mm/day |
| Heavy-rain intensity | `precip_wetday_p95_season`, the season's 95th percentile of regional daily rainfall on days with at least 1 mm | mm/day; explicitly labelled wet-day 95th percentile |

For a multi-year selection, the map reports the average of the eligible season statistics, including the average of the annual 95th percentiles. It does not call this the percentile of all pooled days. Rainfall totals remain available in Advanced mode, in mm per season. Wet-day frequency and historical-threshold exceedances can be added there from the existing daily fields after their denominators and coverage have been checked.

The two percentile levels above are calculated after spatial averaging and therefore smooth local extremes. The cell-first `tmax_p95_frac`, `precip_p95_frac` and `precip_p95_amt` answer different questions: how much of the cropped area exceeds a historical threshold, and how much rain falls there. We will retain their definitions and will not substitute these counts or fractions for percentile levels. ERA5 fallback thresholds are calculated from ERA5 itself, not borrowed from CHIRPS.

## Import and readiness

The authoritative inputs are the daily NetCDF files and unit metadata under `2_data/derived/weather/`, and `weather_monthly.parquet`, `weather_season.parquet`, `weather_season.csv.gz` and the `weather_season` table under `2_data/derived/merged_panel/`. We will inspect the producer's final notes and QA results again after it finishes. We will not alter or restart its running processes.

Run `scripts/climate/check_weather_ready.py` with the ENSO Python environment and `--enso-root` pointing to the project. The check is read-only except for an optional report file. It requires closed producer processes, complete readable exports, a successful final log line, a short settling interval, matching NetCDF unit coordinates, and agreement between the season export and database row counts. Passing means ready to import; it does not certify the scientific validation of every metric.

We will join `weather_season.series_id` to the source database's `series` table and then match `series_key` to the preserved atlas. The atlas `sid` is the first 20 hex characters of SHA256 of `series_key`. Database integer IDs alone are not stable across rebuilds. The import will verify the unit key, crop, source, calendar and season as well as the identifier. Unmatched or changed calendars receive an audit entry, not a guessed match. Missing weather must not remove otherwise valid yield records.

The climate data contract will retain `sid`, `series_key`, `unit_key`, crop and source, harvest year, exact window dates, expected and valid day counts, spatial coverage, source grid, nearest-cell share, precipitation source, weighting method and QC flags. Metric definitions will specify units, wet threshold, percentile method and order of spatial/temporal aggregation. Source hashes and producer versions go in a release manifest. Source databases and raw daily arrays stay outside the public repository; the site receives compact, versioned country/crop shards and downloads of the derived observations and results.

There are three concrete adapter checks. First, the current season export rounds coverage and does not store exact valid-day counts, so mean daily precipitation must use counts recovered from the daily cache rather than infer a denominator from rounded coverage. Second, some monthly sums and dry-spell calculations convert missing values to zero; we will preserve missingness and recompute affected public statistics rather than call those days dry. Third, monthly percentile levels are not in the current export. The initial percentile layer will use crop seasons; other windows appear only after corresponding daily calculations exist. By default the new climate release will require a complete temporal window for both means and extremes, retaining incomplete rows with an exclusion reason. Advanced coverage thresholds, if offered, must be explicit and identical in map and panel.

## Interface

The first screen keeps the map and a short explanation of the selected layer near the top. Simple mode exposes crop, weather quantity, period and an interpretable ENSO scenario. Advanced mode holds source, season/window, coverage, index, model and inference options. Availability controls should explain unsupported combinations, and a grey region should distinguish no weather from an estimated zero response.

Clicking a country keeps the map context; clicking a reporting unit opens the existing style of overlay. Its first chart shows the actual selected weather series with the ENSO index on the right-hand axis, with both units labelled. Yield is a linked chart below it using the same years, not a third incompatible vertical scale. The observed years and the years included in a fit are distinguished. An optional common-years comparison aligns weather and yield; weather alone can extend beyond the yield record.

Shared URLs will record the climate release, layer, metric, statistic, period, crop/season and analysis choices. The visible legend and tooltip use one common value function so they cannot diverge from the regional panel. Temperature levels use a sequential scale; departures, trends and ENSO responses use a centered diverging scale. The color scale stays visible on desktop and small screens.

## Climate trends and ENSO fits

We will fit each annual crop-season weather statistic jointly to time and the chosen ENSO index:

`M(year) = a + g (year - 2000)/10 + b I(year) + d I(year)^2 + error`.

Linear fits omit `d`; the existing separate warm/cold formulation is an Advanced option. `M` is the annual mean or annual 95th-percentile weather statistic. This is a regression of seasonal summaries, not a daily conditional quantile regression. Temperature fits use °C and precipitation fits initially use mm/day, so zero rainfall does not disappear through a logarithm. A precipitation response in percent is secondary and only shown when the neutral fitted baseline is positive and sufficiently supported. Invalid negative fitted precipitation levels and scenarios outside the observed index range are flagged, not silently clipped or presented as forecasts.

We will reuse the index registry, crop-window conventions and scenario definitions, not the yield coefficients or its mandatory log transform. A +3°C SST scenario is available for the SST indices; MEI remains in its own units. Event-peak scenarios must first average the assumed monthly event over the crop window. We will show changes from neutral ENSO at the same time trend and explain that a scenario is conditional, not a forecast.

Each statistic needs at least 20 paired complete years and five positive and five negative exposures before a response is shown. The first climate fit release uses the three existing indices, the crop-season window and the existing linear/quadratic/hinge choices. We will reuse shared calendar-block resampling and held-out-year checks with explicit sample alignment, carry uncertainty and extrapolation flags, and verify the native-unit adaptation independently. Yield pooling and its existing field-significance results do not transfer to weather. National or regional summaries must preserve spatial covariance and avoid duplicate source tiers.

## Implementation stages and acceptance

1. **Preservation and preparation.** Publish the immutable yield tag and release, this plan and the readiness check. Record progress in `CLIMATE_ATLAS_STATUS.json` so scheduled runs resume work rather than repeat it.
2. **Weather import.** Once the readiness check passes, snapshot and hash the completed inputs, build the stable identifier join, reconstruct exact daily coverage and mean rainfall, and export weather shards. Verify selected regions independently from daily data, including an ERA5 fallback, a cross-year crop season, a coastal fill and a partially covered 2024 season. Check uniqueness, units, missingness, bounds and source attribution. Preserve the upstream records and document any adapter correction.
3. **Observed combined atlas.** Create `/climate/` with all four mean/extreme weather layers and the preserved yield selection. Add maps, regional overlays, actual weather/yield/index time series, source/coverage notes and shareable URLs. Copy or version interface assets where changes are needed; do not modify `/global/` dependencies. Use only validated metrics. This is the first public combined deliverable and does not wait for a full refit sweep.
4. **Climate sensitivity.** Add trends and ENSO fits of the annual weather metrics, supported scenario controls, uncertainty and validation. Run a representative-country pilot before the full set, bound parallelism and checkpoint outputs. Expose only combinations with data and completed fits. Continue until the supported climate responses are published; an observed-only preview is an intermediate stage.
5. **Verification and publication.** Verify the same value and color in map, tooltip, panel and download; run the existing yield tests unchanged and the new climate checks. Inspect desktop and mobile layouts, country/region back navigation and saved URLs. Confirm the preserved `/global/` assets still match the tagged commit. Publish `/climate/` through the existing GitHub Pages workflow and verify the live release and sample downloads. Deliver its link and a release report that distinguishes completed work from further coverage extensions.

Each stage records counts, source hashes, checks and limitations. The follow-up remains quiet while source files are unchanged or healthy builds are running, and reports a usable release, a material data problem or a decision that requires the user. It pauses after the combined release and its supported sensitivity layers are verified and delivered. Station comparisons, crop-specific spatial weights, expanded national coverage and additional climate windows remain documented extensions rather than hidden prerequisites for the first release.
