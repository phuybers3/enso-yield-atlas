# ENSO yield atlas

[Open the global yield atlas](https://phuybers3.github.io/enso-yield-atlas/global/) · [Open the ENSO explorer](https://phuybers3.github.io/enso-yield-atlas/) · [Download a complete copy](https://github.com/phuybers3/enso-yield-atlas/archive/refs/heads/main.zip)

We fit 8,738 unit–crop–season series across 677 administrative units and 288 eligible panels. Choose a country, crop, and season to see mapped yield responses and the observations behind each fit. The HTML contains the data and works offline after downloading `index.html`.

## Global yield and coverage prototype

The [global atlas](https://phuybers3.github.io/enso-yield-atlas/global/) adds world and country maps with reporting-region panels for wheat, maize, paddy rice, and milled rice. It includes 64,234 eligible observed yields from the current nine Asian country packages, including short records excluded from the ENSO regressions. Choose the period, season, area basis, and coverage requirement. Each regional panel shows the annual observations, actual dates, mean yield, and a CSV download. Regional details open over the map, keeping its position and zoom. Switch units on the map or inside the panel; Back or Escape closes it. Crop, period, and map settings stay in shareable URLs. Countries outside the current packages are selectable with an explicit coverage message.

The global application loads prepared summaries by crop and observed series by country and crop. The ENSO explorer above remains available. [Data contract, source rules, and reproduction instructions](GLOBAL_ATLAS.md) describe the first release and its limits.

## +3°C scenarios

The default scenario assumes the monthly shape of the 1997–98 Niño 3.4 event, scaled to peak at +3°C in November of the selected year. We average that path over each crop's recorded climate window. Users can choose the crop reporting year or evaluate a direct +3°C crop-season average. The assumed event shape is not a forecast.

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

## Why wheat coverage is limited

Wheat has 347 fitted series: 326 Indian Rabi units, 16 Bangladeshi units, and 5 Korean units. Each fit requires at least 20 complete positive-yield years and five exposures on each side of neutral ENSO. Japan's 38 wheat source series have at most 18 qualifying years. India's other reported wheat seasons also fail the 20-year threshold. The atlas preserves the crop selection when switching to a country where that crop has eligible data. The coverage drawer includes excluded panels.

## Interpretation

We estimate the time trend and ENSO terms jointly for each unit. Nonlinear candidates must improve on both linear-ENSO and trend-only predictions in two five-year blocked-validation layouts with adjacent-year embargoes. The atlas reports no uncertainty intervals, p-values, or multiplicity adjustments. A candidate screen is descriptive and does not establish the predictive performance of a model selected after screening. Large extrapolated nonlinear responses require particular care.

Source statistics, calendars, and boundary histories have documented limitations. Crop totals and components overlap. Series counts are not counts of independent agricultural outcomes. Calendar notes appear for every selection. The East Java 2017 paddy correction is recorded in [verified_correction.json](verified_correction.json).

## Rebuilding the page

Run `python3 rebuild_atlas.py` using the Python standard library. The script combines the frozen embedded data, HTML template, and JavaScript into `index.html`; it does not refit the models. The original fitting and verification scripts are preserved under `source/`. Rerunning the full agricultural analysis requires the original HarvestStat Asia packages and directory layout described in [the analysis notes](provenance/unit_analysis.md). Those source packages and large weather datasets are not included here.

## Sources and attribution

Agricultural inputs come from the supplied HarvestStat Asia v0.1 and v0.2 packages. India: Foley et al., *StableBound: Stabilizing Administrative Statistics Across Changing Boundaries, with a District Crop Record and Administrative Lineage for India*, [dataset DOI](https://doi.org/10.5281/zenodo.21653283).

India boundaries derive from [Geolocet](https://geolocet.com), redistributed with permission in the supplied package; attribution is required in onward use. Other boundaries derive from FAO Global Administrative Unit Layers, [FAO GAUL](https://data.apps.fao.org/), under CC BY 4.0. The atlas simplifies boundaries by 800 m and projects them separately by country. Original package attributions and country limitations are preserved in [v0.1 notes](provenance/harveststat_v0.1.md) and [v0.2 notes](provenance/harveststat_v0.2.md).

Niño 3.4 comes from [NOAA PSL](https://psl.noaa.gov/data/correlation/nina34.anom.data). Frozen input hashes and numerical checks are included. Third-party data retain their source terms; this repository does not apply a blanket license to those data.
