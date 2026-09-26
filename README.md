# ENSO yield atlas

[Open the global yield atlas](https://phuybers3.github.io/enso-yield-atlas/global/) · [Open the ENSO explorer](https://phuybers3.github.io/enso-yield-atlas/) · [Download a complete copy](https://github.com/phuybers3/enso-yield-atlas/archive/refs/heads/main.zip)

The current atlas uses the authoritative merged agricultural database: **1,403,642 eligible annual observations across six crop families**, with national and regional records in 193 countries and territories. Original source rows, quality flags, exclusions, and rice conversions remain available in the downloads.

The global map offers average yield, observed yield trend, ENSO response, record length, latest harvest year, and reporting resolution. Country pages retain the map while regional observations open in an overlay. Choose HarvestStat, GMFD/Hultgren, or FAOSTAT explicitly, or use merged source priority. A source series is never spliced with a different reporting tier.

Select **Niño 3.4, relative Niño 3.4, or MEI.v2**, five exposure windows, and linear, quadratic, or separate warm/cold models. The fitted sample is matched across indices. Scenarios use native index units or local standard deviations; SST indices also offer an event profile peaking at +3°C. Every regional panel shows the fitted observations, one response curve, block-bootstrap intervals, temporal validation, and raw yield alongside the selected index on a right-hand axis.

Wheat retains spring and winter source categories. Known rice forms share a paddy-equivalent scale: milled ÷ 0.67, brown ÷ 0.80. Rice with an unspecified weight basis is available for relative responses but not absolute-yield comparisons. Actual years and source resolution accompany each estimate; much regional coverage is historical.

[Current data contract, methods, and reproduction](MERGED_RELEASE.md) · [Release counts and verification](MERGED_RELEASE_REPORT.md) · [Source attribution](provenance/merged/README.md) · [Current release files](global/data/2026-09-26-merged-v1/) · [Earlier nine-country atlas](https://phuybers3.github.io/enso-yield-atlas/global/archive.html).

The site-root ENSO explorer and the downloads described below retain the earlier September 24 analysis. They remain available for reproducibility and are labeled **archived inputs**. Their methods and counts do not describe the merged release.

## +3°C scenarios

In the original ENSO explorer, the default scenario assumes the monthly shape of the 1997–98 Niño 3.4 event, scaled to peak at +3°C in November of the selected year. We average that path over each crop's recorded climate window. Users can choose the crop reporting year or evaluate a direct +3°C crop-season average. The assumed event shape is not a forecast.

The three models are linear, quadratic, and separate warm/cold slopes. Yield changes are relative to neutral ENSO at the same time trend. We flag scenarios outside each unit's observed exposure range. The maps share an adjustable color scale. The yield-versus-ENSO plot shows observations and one selected model, with raw or trend-adjusted yields. Aligned time series show observed and fitted yields and the crop-season ENSO index.

## Downloads

| File | Contents |
|---|---|
| [scenario_3C_results.csv](scenario_3C_results.csv) | 26,214 comparisons: scaled event in reporting years 2026 and 2027, plus a direct +3°C season mean |
| [unit_results.csv](unit_results.csv) | Coefficients, sensitivity, partial R², validation scores, and screening flags |
| [observations.csv.gz](observations.csv.gz) | The 240,768 fitted observations: year, Niño 3.4, log yield, and linear trend-adjusted log yield |
| [heldout_predictions.csv.gz](heldout_predictions.csv.gz) | Predictions from both blocked-validation layouts |
| [series_inventory.csv](series_inventory.csv) | Included and excluded series and reasons |
| [panel_inventory.csv](panel_inventory.csv) | All source panels and calendar assumptions |
| [monthly_indices.csv](monthly_indices.csv) | Frozen climate indices, including the monthly Niño 3.4 profile |
| [season_calendar_asia_v0.2.csv](season_calendar_asia_v0.2.csv) | Supplied crop calendar |
| [verification.json](verification.json) | Original independent numerical checks |
| [SHA256SUMS.json](SHA256SUMS.json) | File checksums |

On GitHub, use **Download raw file** to save a CSV. The atlas also has direct download links and a CSV export for the selected panel and scenario. Gzipped CSV files can be decompressed or read directly by pandas and other analysis tools.

## Wheat in the archived explorer

Wheat has 347 fitted series: 326 Indian Rabi units, 16 Bangladeshi units, and 5 Korean units. Each fit requires at least 20 complete positive-yield years and five exposures on each side of neutral ENSO. Japan's 38 wheat source series have at most 18 qualifying years. India's other reported wheat seasons also fail the 20-year threshold. The atlas preserves the crop selection when switching to a country where that crop has eligible data. The coverage drawer includes excluded panels.

## Interpretation

We estimate the time trend and ENSO terms jointly for each unit. Nonlinear candidates must improve on both linear-ENSO and trend-only predictions in two five-year blocked-validation layouts with adjacent-year embargoes. The original explorer reports no uncertainty intervals, p-values, or multiplicity adjustments. The global layer separately refits its exact observed series and supplies pointwise 95% normal intervals from 400 three-year block resamples, without multiplicity adjustment; its holdout filter compares each chosen form with the trend-only baseline. See [the global methods](GLOBAL_ATLAS.md#enso-response-layer) for definitions. A candidate screen is descriptive and does not establish the predictive performance of a model selected after screening. Large extrapolated nonlinear responses require particular care.

Source statistics, calendars, and boundary histories have documented limitations. Crop totals and components overlap. Series counts are not counts of independent agricultural outcomes. Calendar notes appear for every selection. The East Java 2017 paddy correction is recorded in [verified_correction.json](verified_correction.json).

## Rebuilding the page

Run `python3 rebuild_atlas.py` using the Python standard library. The script combines the frozen embedded data, HTML template, and JavaScript into `index.html`; it does not refit the models. The original fitting and verification scripts are preserved under `source/`. Rerunning the full agricultural analysis requires the original HarvestStat Asia packages and directory layout described in [the analysis notes](provenance/unit_analysis.md). Those source packages and large weather datasets are not included here.

## Sources and attribution

Agricultural inputs come from the supplied HarvestStat Asia v0.1 and v0.2 packages. India: Foley et al., *StableBound: Stabilizing Administrative Statistics Across Changing Boundaries, with a District Crop Record and Administrative Lineage for India*, [dataset DOI](https://doi.org/10.5281/zenodo.21653283).

India boundaries derive from [Geolocet](https://geolocet.com), redistributed with permission in the supplied package; attribution is required in onward use. Other boundaries derive from FAO Global Administrative Unit Layers, [FAO GAUL](https://data.apps.fao.org/), under CC BY 4.0. The atlas simplifies boundaries by 800 m and projects them separately by country. Original package attributions and country limitations are preserved in [v0.1 notes](provenance/harveststat_v0.1.md) and [v0.2 notes](provenance/harveststat_v0.2.md).

Niño 3.4 comes from [NOAA PSL](https://psl.noaa.gov/data/correlation/nina34.anom.data). Frozen input hashes and numerical checks are included. Third-party data retain their source terms; this repository does not apply a blanket license to those data.
