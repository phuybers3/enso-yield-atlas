# Merged agricultural atlas

The current release is `2026-09-26-merged-v1`, served at [the global atlas](https://phuybers3.github.io/enso-yield-atlas/global/). The previous release remains at `global/archive.html`; URLs carrying `release=2026-09-26` redirect there. The site-root explorer keeps its archived September 24 inputs.

## Agricultural data

We read the frozen merged SQLite database without modification and verify all 26 checksums in its export manifest. We preserve 1,429,996 source rows for wheat, maize, rice, soybean, sorghum, and cassava in 46,466 source series. Of these rows, 1,403,642 enter descriptive summaries. The source database spans 193 country/territory codes. Other agricultural products remain outside this first merged release.

Each unit uses the upstream `unit_key`. Each series retains `series_key`; a SHA-256 prefix supplies the compact browser `sid`. The upstream numeric series ID is recorded for this snapshot only. Rows retain original yield, area, production, year label, harvest year, completeness, correction flag, primary-tier flag, source flags, QC flags and explicit exclusion reasons. Display conversions never overwrite original measurements.

HarvestStat completeness governs its sums. Valid GMFD/Hultgren yield-only records do not require annual production or area. FAOSTAT records retain their quality flags and upstream error checks. Warnings remain eligible; errors, invalid yields, suspect units and all rows of ambiguous duplicate harvest years are excluded. The 2,284 duplicate rows remain in the raw downloads. A point sensitivity fit restores statistical-outlier-only exclusions while leaving other errors excluded. Zero yields remain visible but cannot enter a log-yield model.

`area_weight_ha` is carried from the companion Parquet file as a reference crop-area weight. It is not annual harvested area. We do not infer annual production or national yield from these weights. National yields use the distinct FAOSTAT series. Country pooled regressions and production-risk aggregation remain separate follow-on analyses.

The map selects one whole reporting layer per country, crop, explicit season/basis and period: HarvestStat, then GMFD/Hultgren, then FAOSTAT. Selection does not join the year-by-year upstream primary tiers into a synthetic regional record. National and regional values are never colored on top of each other. Within the layer, the local default chooses a season per unit, preferring an annual series and otherwise the season with the most eligible observations. Spring and winter wheat remain separate. Explicit source, resolution, season and basis choices override defaults. Historical regional observations can take priority over newer national records; the record-age layer and actual dates make this visible.

Known rice forms use paddy equivalents: original milled yields and production are divided by 0.67, brown by 0.80; paddy and area remain unchanged. These are approximate fixed recovery assumptions. Unspecified rice forms remain searchable and eligible for relative-response analysis, but not comparable absolute yield/trend maps. The original form is present in every download. A constant conversion changes a log-model intercept without changing ENSO responses or validation.

## Geography

HarvestStat geometry uses its supplied stable groups; GMFD geography uses the Hultgren replication shapefile with normalized source identifiers. National boundaries come from Natural Earth. We dissolve exact unit keys, repair geometry, and simplify for display. Geometry source checksums and the unmatched-unit list are recorded. We match 14,939 of 14,965 database units. Twenty-two ambiguous Brazilian identifiers and four overseas territories have no safe polygon match; their observations remain searchable. We do not assign them a parent polygon as if it were their true reporting boundary.

## Index and exposure contract

`indices.json` is a versioned registry containing source URLs, product definitions, native units, baseline, cadence, reference value, sign convention, coverage, content hashes, and observations with explicit start/end dates. It is independent of the agricultural adapter. The first three entries are:

| Index | Product and baseline | Native periods | Scenarios |
|---|---|---|---|
| Niño 3.4 | Merged ERSSTv5, 1991–2020 anomalies | Monthly | Native °C, local SD, scaled historical peak |
| Relative Niño 3.4 | Niño 3.4 minus tropical mean; unscaled, not official RONI | Monthly | Native °C, local SD, its own scaled peak profile |
| MEI.v2 | NOAA PSL JRA3Q, 1980–2018 normalization | Overlapping two-month periods, 1979 onward | Native index units or local SD |

The five windows are the assigned crop season, the three months before planting, grain filling where assigned, DJF preceding harvest, and harvest calendar year. Relative months retain the upstream year offsets. We verified 2,030 exposure values or missing states against the merged database’s independent exposure view.

For MEI we average published two-month values whose end month lies inside the requested window. For example, the value assigned to January is the December–January period. The first contributing period includes one month preceding the crop window. We preserve this overlap and do not interpolate MEI into independent monthly SST observations or apply extra smoothing. A missing period makes the exposure missing.

The registry supports additional index products through the same exposure interface. A new release must specify their native periods, units, reference and eligibility rules before refitting; arbitrary file upload and simultaneous multi-index regressions are not browser features in this release. The present sign-support rule applies to these three zero-neutral ENSO indices. Adding an index changes the common comparison sample and therefore requires a new immutable release.

## Models and uncertainty

Each source series is fitted independently for the requested period, with no reuse of a coefficient from another period. The default is 1981–2024. Other prepared periods are available record, 1991–2020, 2001–2020, 2011–2020 and 2015–2024. Short periods retain descriptive observations even when they cannot support a fit.

For positive yield, we fit `log(yield) = intercept + trend × (harvest_year − 2000)/10 + f(index_exposure)`. The three forms of `f` are linear, quadratic, and a hinge at zero giving separate warm/cold slopes. A response is `100 × [exp(f(x) − f(0)) − 1]` at the same time trend. All registered indices and models use the same yield years with complete exposures. The model requires at least 20 paired years, five positive and five negative exposures, and a full-rank design. An index may fail its sign-support check on a sample that is still valid for another index; the years themselves do not change.

Available-record index comparisons begin no earlier than MEI’s 1979 coverage, even where raw yields reach back to the nineteenth century. All original years remain in the observed-data plot. Standard-deviation scenarios multiply the requested amplitude by the selected index’s SD over the fitted years; they measure a change from zero, not from the sample mean. The regression and its validation stay in native units, so no full-sample scaling is learned during holdout fitting.

The +3°C peak scenario shifts and rescales the selected SST index’s own 1997–98 trajectory, then averages it over the chosen window and harvest year. It differs from a +3°C window mean. It is a deterministic illustration, not a forecast. No SST-to-MEI conversion is offered. Scenarios outside the fitted exposure range are flagged separately from evidence filters.

Uncertainty uses 400 shared pairs-bootstrap draws of three-year calendar blocks, anchored at 1980, seed 20260926. Draws are shared across units for each requested period. Available-record comparisons use a common 1979–2025 drawing envelope. At least 360 usable draws are required for covariance. We form normal 95% intervals in log response and then transform them to percent. These are pointwise association intervals, not future-yield prediction intervals, and have no field multiplicity correction.

Validation withholds five-year blocks under two layouts anchored at 1980 and 1982, with an adjacent-year embargo. Eligible folds are shared across the registered indices. At least three blocks and fifteen test years are needed. The score is one minus squared log-yield prediction error divided by the trend-only error; the optional evidence filter requires a positive score in both layouts. We do not select a winning model and then claim that its validation is unbiased.

The separate yield-trend layer regresses observed yield in t/ha on time and reports t/ha per decade, with the same block-bootstrap construction and a minimum of twenty observations. It is distinct from the log-yield time term in an ENSO model. Regional fit details also report the linear ENSO slope with a quadratic time trend and the effect of restoring statistical-outlier-only rows.

## Files and reproduction

The browser loads gzip-compressed JSON summaries by crop, geography by country, observations by country–crop, and fits by index/window/crop. The 195 MB SQLite source is not required to open the site. Fits contain all prepared periods and all three forms. Original observations, fitted points and mapped scenarios have CSV download controls.

```
global/data/2026-09-26-merged-v1/
  catalog.json                 # coverage, source hash, aliases, periods
  sources.json                 # upstream sources, corrections and changes
  indices.json                 # native index records and metadata
  methods.json                 # fitting and uncertainty definitions
  import-audit.json             # source and geometry checks
  migration.json               # matched comparison with the archived atlas
  manifest.json                # hashes and sizes of released artifacts
  <crop>.json.gz               # series summaries
  observations/<ISO3>-<crop>.json.gz
  geometry/<ISO3>.json.gz
  trends/<crop>.json.gz
  fits/<index>/<window>/<crop>.json.gz
```

With Python, NumPy, pandas, pyarrow, GeoPandas and Shapely installed, and the local source tree available:

```sh
python scripts/merged/dataset.py
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1 python scripts/merged/fit.py --workers 4
python scripts/merged/migration.py
python tests/merged_numerics.py
npm test
python scripts/merged/finalize.py
python -m http.server 8123
```

The importer accepts `--database` and `--hultgren` paths and a `--skip-geometry` option for an existing geometry export. It requires a database matching the supplied export manifest and refuses a subsequently modified working file. Fitting can be reproduced directly from the frozen browser observation and index files without that database. The fit builder supports crop/index/window subsets, a non-publishing `--limit` benchmark and resumption from complete bundles. Inputs or analysis definitions must not be changed beneath an existing release: choose a new release ID and rebuild instead. Historical builders remain available for reproducing the archived atlas.

The migration report compares 2,382 matched source series and 59,673 source records. All matched yields agree within 0.0001 t/ha after conversion, and no matched harvest-year labels change. It separates the effect of sample/QC retention, yield values, harvest-year alignment, assigned calendar and the change from the archived ERSSTv6 1981–2010 index to merged ERSSTv5 1991–2020. This sequential decomposition depends on the stated order and is descriptive, not causal.

`python scripts/merged/alignment.py` checks the seven country/crop/season groups flagged by the upstream national–regional yield comparison. The audit fits the linear crop-season Niño 3.4 model under harvest labels shifted by −1, 0 and +1 year, on identical observations with all shifted years inside 1981–2024. It records coefficients and residual errors, without selecting a calendar or treating fit improvement as evidence for a label change. The resulting `alignment-summary.json` links to every flagged series, including records too short to estimate. The website identifies the warning in each affected regional panel.

Source attribution and verified redistribution terms are in [provenance/merged/README.md](provenance/merged/README.md). Every release preserves its source identifiers and corrections. Forecast ingestion, weighted production risks, trade/fertilizer overlays, unrestricted index uploads and national pooled-response products remain follow-on work.
