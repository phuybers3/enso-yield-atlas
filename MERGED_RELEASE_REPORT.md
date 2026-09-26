# Merged atlas release — 26 September 2026

We imported the authoritative merged agricultural snapshot and rebuilt the atlas analyses. The release contains 1,403,642 accepted annual observations from 46,466 source series across 193 countries and territories. We retain all 1,429,996 original rows, including exclusions and source flags. The previous atlas remains available through its original release links and `global/archive.html`.

| Crop | Source series | Accepted annual observations | Countries with records | Countries with regional records |
|---|---:|---:|---:|---:|
| Wheat | 8,885 | 248,664 | 125 | 43 |
| Maize | 14,388 | 483,001 | 170 | 38 |
| Rice | 7,938 | 205,331 | 124 | 30 |
| Soybean | 5,601 | 200,007 | 111 | 27 |
| Sorghum | 3,915 | 86,987 | 114 | 9 |
| Cassava | 5,739 | 179,652 | 102 | 10 |

These counts include the separate source alternatives. The map chooses one reporting layer per country and crop; national and regional records are not added together. Counts do not imply contemporary coverage in every country. Actual years, source, denominator and reporting resolution accompany each selection.

## Analyses and interface

We prepared 90 crop/index/window bundles, containing 3,381,240 fitted model specifications across the available periods. Niño 3.4, the relative Niño 3.4 index and MEI.v2 use a shared exposure interface and matched yield years. The models are linear, quadratic and separate warm/cold slopes. Uncertainty uses 400 shared three-year block draws; validation compares against a trend-only prediction using two five-year holdout layouts.

For the 1981–2024 crop-season Niño 3.4 analysis, the eligible linear source-series fits number 4,922 for wheat, 9,622 for maize, 5,581 for rice, 3,506 for soybean, 1,264 for sorghum and 4,444 for cassava. These are counts before the map's source-layer selection. Short records remain visible. Unassigned grain-filling windows, including wheat and cassava in this snapshot, retain explicit unavailable states.

The map offers mean yield, observed yield trend, ENSO response, record length, latest harvest and reporting resolution. Regional panels show the original observations and QC decisions, the selected model against its actual index values, and yield alongside the index on a right-hand axis. A +3°C SST peak uses the selected index's own rescaled 1997–98 event profile. MEI supports native or standard-deviation scenarios without an assumed SST conversion.

## Verification

We checked every exported source row against the database, including 1,276,514 accepted GMFD yield-only rows and 2,284 quarantined duplicate-year rows. We checked 2,030 exposure values or missing states against the independent merged-database view. Independent weighted least-squares calculations reproduced bootstrap covariance, coefficients and the invariance of percentage responses to rice conversion.

The final release validator checked series membership, periods, common fitted years across indices, support counts, finite coefficients, covariance symmetry and positive semidefiniteness for all prepared bundles. Every eligible model retained a usable covariance estimate. We verified all 1,127 artifact checksums and sizes, plus the analysis and application code hashes. The compressed release occupies approximately 393 MB; its largest file is 8.2 MB.

The application and archived-release test suites passed. Browser review covered national fallback, US regional records, Indian rice and wheat, Brazil's excluded and unmapped records, MEI time alignment, peak scenarios, legends, and overlays. The migration audit matches 2,382 old and new source series: matched yield values agree after conversion, while calendar and index changes are separately reported. The seven upstream harvest-year alignment warnings have a ±1-year sensitivity audit; the default years remain unchanged.

## Limits retained in the release

We leave 26 units without safe polygon matches in the searchable records. Unknown rice weight conventions remain outside comparable absolute-yield maps but can support percentage-response analysis. Regional coverage is often historical, and source priorities can select an older regional series over a newer national series. The intervals describe fitted associations, with no field multiplicity correction or forecast uncertainty.

National pooled regressions, production-risk aggregation, forecast distributions, unrestricted index uploads, and trade or fertilizer overlays remain follow-on analyses. [Methods and reproduction](MERGED_RELEASE.md), [source attribution](provenance/merged/README.md), and the [machine-readable release summary](global/data/2026-09-26-merged-v1/release-summary.json) accompany this release.
