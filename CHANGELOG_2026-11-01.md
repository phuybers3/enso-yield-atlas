# 1 November 2026: local effects, Australian wheat and crop masks

We publish `2026-11-01-inclusive` as the selected atlas release. We retain the
October 31 production calibration and add a separate historical-local cohort.
Both cohorts use quarter pooling. We fit future effects to every eligible year
and evaluate skill by withholding one harvest year across every pooled location.
We retain the existing linear trend specification.

## Local yield effects

We add 5,820 conditional local yield estimates across 51 countries. Older yield
records can support a percentage effect without a current production weight.
Those effects carry no tonnes and do not enter country or world production sums.
The production aggregates retain their identified, nonoverlapping footprint.
The forward calculation advances the next-harvest reference date to 1 November.

We refit 5,512 additional series in 18 crop-season pools with 1,000 uncertainty
draws. Full-record withheld-year evaluation scores 5,429 series over 439 pooled
harvest-year folds. The remaining 83 series have too few eligible training years
after a year is removed. Their future fits remain available with unassessed skill.
Additional already-fitted, unweighted series retain their identified response
fields. Unchanged historical companions retain their original draw counts.

We require a local fitted response, at least ten eligible years, a resolved crop
window, acceptable source quality, and ENSO inputs covering every month of that
window. We retain finite zero effects, wide intervals and negative skill scores.
The site explains missing estimates with the applicable dates or record count.
Historical records and relationships remain visible when a forecast is absent.

| Series status | Count |
| --- | ---: |
| Supported next-harvest effect | 30,192 |
| Season extends beyond issued ENSO coverage | 16,676 |
| Fewer than ten eligible years | 5,622 |
| Local response unavailable | 651 |
| Calendar unavailable | 42 |

These counts cover crop-season series. Multiple series can describe one mapped
unit, and the map selects the applicable series using the recorded source and
crop-season priorities.

Western Australia's wheat estimate for the December 2026 harvest is −11.1%,
with a nominal 80% effect range of −18.7% to −3.7%. Zhongxiang's winter wheat
estimate for June 2027 is +24.1%, with a range of +5.1% to +48.5%. Their local
observed-index withheld-year improvements over the training trend are 2.7% and
7.0%, respectively. Zhongxiang's yield records end in 2003; the page states that
current applicability is unassessed. These examples are conditional estimates.
Issued-forecast skill and effect-interval calibration remain unassessed or under
review. The effect ranges exclude unexplained harvest variability.

## Australian observations

We add 83 wheat observations from the Australian Bureau of Statistics to seven
existing state/territory series. New South Wales, Victoria, Queensland, South
Australia and Western Australia gain 13 observations each through harvest 2021.
Tasmania gains 11 and the Australian Capital Territory seven, ending in 2016.
We retain every previous observation and its source identity.

The extension uses Table 4 of *Historical Selected Agricultural Commodities,
1860 to 2022*, available with [ABS Agricultural Commodities, Australia,
2021–22](https://www.abs.gov.au/statistics/industry/agriculture/agricultural-commodities-australia/2021-22).
We confirmed the CC BY 4.0 terms before acquisition. Overlapping records support
assigning the source financial-year end minus one to harvest year. The
denominator is area sown for grain. We checked the overlap and units before
insertion. An existing tenfold discrepancy in Western Australia's 2004 source
record was already flagged and excluded from fitting; we preserve that flag and
the original observation.

The [ABS 2024–25 broadacre release](https://www.abs.gov.au/statistics/industry/agriculture/australian-agriculture-broadacre-crops/2024-25)
reports production sold and total growing area. Sales can include stored grain,
and growing area can include crops retained on farm or grazed. We display those
figures separately where available. We do not form yield ratios or train on
those figures. The attempted ABARES source did not provide a verified compatible
extension, so no ABARES forecast enters the training record.

## ENSO coverage and source dates

| Input | Coverage or issue retained in this release |
| --- | --- |
| Monthly observed ENSO | September 2026 |
| Issued CPC outlook | 8 October 2026 |
| Issued seasonal outlook coverage | Through May–July 2027; final month July 2027 |
| Temperature and rainfall updates | 25 October 2026, where available |
| NDVI updates | 28 October 2026, where available |
| Brazilian municipal outcomes | Through 2025 |
| Added Australian wheat outcomes | Through 2021 for most states |

We preserve each product's actual cutoff and monthly gaps. The CPC path uses all
nine issued seasonal distributions. Monthly disaggregation and matched quantile
ranks across seasons remain explicit assumptions. No analogue extension supplies
an unsupported month. Fujin rice, Russian annual wheat and Occidental Mindoro
maize remain without next-harvest effects where their fitted windows extend past
July 2027.

The [GFDL October 2026 SPEAR description](https://www.gfdl.noaa.gov/prediction/october-2026-el-nino-predictions/)
describes a longer outlook. We could not obtain the current numerical members
and matching relative-index hindcasts through the checked public sources. We
retain the verified CPC horizon. This finding concerns accessibility through
the audited sources; it does not establish that longer numerical forecasts do
not exist.

## Display changes

We use a 1% CROPGRIDS harvested-area ratio by default. Country and unit pages
offer 1%, 5% and all-land choices, preserved in URLs. The original 5% assets
remain available. The mask changes only display; environmental averaging and
production weights retain their continuous crop fractions. Annual harvested
area counts repeated harvests and can exceed physical land area.

We show local conditional effects on world and country maps, retain the shared
orange–purple palette, and preserve uncertainty ellipses across map-layer
changes. Older records receive an age note. Local effects excluded from
production totals are labelled. Forecast status no longer falls back to an
unrelated NDVI message. Very small nonzero effects retain enough digits to
remain distinguishable from zero.

We rename the historical layer **Yield sensitivity to ENSO**. Its explanation
reads: “Yield change (%) per 1 °C change in the relative Niño 3.4 index, averaged
over the crop’s local growing season.” The conventional-index view identifies
the standard index instead. History now describes the full issued CPC path
when that path is selected. Broad units such as Western Australia open at an
extent that includes their whole boundary; subsequent map selections preserve
the user's pan and zoom.

## Checks and reproducibility

We check local effects against their fitted coefficients and seasonal exposures,
recalculate withheld-year skill from saved errors, verify the 1,000 draws and
holdout design, check future harvest dates and every required ENSO month, and
hash all 17,195 core payload files. Country and world exports reproduce all 388
panel central rows and 24 aggregate rows. New local effects leave the production
aggregation inputs unchanged. The export schema checks source permissions,
integer years, record shards, anomaly counts and mapped units. The initial page
payload remains below 3 MB before the on-demand supplements.

Interface checks cover all six crop selectors, three mask choices, future
ellipses, History markers, conventional-index separation, withheld forecasts,
and map-layer invariance. Browser checks include Western Australia and
Zhongxiang, along with the world layer wording and mask control. The Australian
export checks caught and corrected floating-point year serialization and stale
anomaly counters. We also removed a duplicate mask control and corrected the
initial framing of large reporting units.

Portable analysis scripts, source registries, acquisition terms, checksums,
cohort inputs, fold results and logs are retained under
`analysis/review/inclusive_forecasts_2026-11-01/` in the ENSO project. The local
database is separately identified as `data/releases/enso_ag_2026-11-01-local.sqlite`.
The published `local_outlook_audit.json` records that database's checksum and the
distinct production calibration release. The GitHub Pages build pins every
data request to the deployed commit through `site/hosting.json`.
