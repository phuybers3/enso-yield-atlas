# Atlas repair and refresh log — 30 October 2026

## Historical regional coverage

China's county records were present, but the current-outlook selection rejected
subnational source tiers ending before 2010 when a newer national series existed.
The response export inherited that selection. The historical supplement registry
also lacked the 19 October release. The world map used only the largest current
country prediction panel. These three choices hid historical local relationships.

The repair adds a separately identified historical supplement to the existing
19 October release. It restores **5,511 local relative-index yield regressions**,
including 1,812 maize, 1,414 rice and 1,786 wheat series in China, and six Australian
wheat series. Smaller groups are restored in Colombia, Cameroon, several European
countries, Myanmar, South Korea and Nigeria. Counts by country and crop, input
checksums and limitations are in
`site/data/historical-responses/2026-10-19/audit.json`.

The supplement uses the approved quarter-pooled yield estimator and the eligible
historical records. It does not replace existing regressions, alter current
outlooks, combine overlapping production totals, or invent skill scores. These
additional relationships have no same-build withheld-year skill attached.
Their intervals retain the research-candidate status. Some records still have
no estimate because of insufficient eligible years, exposure, source selection,
or QC; a missing response does not establish zero sensitivity.

## Display changes and reasons

* Added **Historical ENSO response** to the world map, with local regressions and
  national fits elsewhere. The selector and world breadcrumbs preserve this layer.
* Made older local units visible as transparent outlines on the outlook map.
  The underlying color remains the national estimate, with an explicit tooltip;
  older local coefficients are not presented as current local forecasts.
* Restored local crop/season selection where a national annual panel differs
  from a local main-season record. Selecting a unit opens its own record.
* Fitted supplemental temperature, rainfall and NDVI relationships from the
  complete available environmental years, independent of the last census year.
  China therefore retains environmental records after its yield series end.
* Matched historical map colors to their ±10% per degree legend. Previously
  the fill used ±30 while the legend showed ±10.
* Load historical outlines after the initial outlook map, so the new payload
  does not delay the first map.
* Cached an absent legacy world-unit export rather than requesting it repeatedly.
* Updated script version identifiers to prevent mixing an old regional renderer
  with the current application.
* Corrected help text that still described the old outlook colors and removed
  hatching. Effect intervals remain available in tooltips and local charts.

## Verification

The release-wide visibility audit inspects 193 countries, 53,183 crop series,
15,994 reporting units and 159,549 map cells, with 52 complete detail renders.
There are 26 reporting units without a mapped geometry; the repair does not
fabricate their boundaries. Regression tests cover navigation, calendars,
dateline geometry, US selection and extent, China season selection, NDVI,
watchlist values, color scales, historical overlays and interval classification.
The historical supplement test checks source display permissions, dates,
coefficients and separation from forecasts. Real-browser checks verify China
maps, local environmental regressions and the world layer selector.

## October 30 data release

We rebuilt the agricultural database separately and retained the published
October 19 release. The candidate adds five verified 2025 maize observations
for North Rhine-Westphalia. All 75 earlier observations from the same agency
match the source exactly. The five additions preserve the source's cultivation
area definition. We recalibrate the complete maize/main pool with each target
harvest year withheld across every pooled location. A changed rice calendar
for Iberia, Louisiana also required recalibration of the rice/main pool.

| Input | Latest available input or check | Treatment in the candidate |
| --- | --- | --- |
| CPC temperature | Daily observations through 29 October 2026 | The existing Berkeley Earth record continues with overlap-adjusted CPC observations. Temperature/rainfall comparisons share the rainfall cutoff of 25 October. |
| CHIRPS v2 rainfall | Final through 30 September; preliminary through 25 October | The existing product is retained under its moved provider directory. |
| CPC precipitation | Daily observations through 29 October | Retained as a separately named comparison product. |
| NOAA STAR VHP NDVI | Week 43, ending 28 October | Weeks 38–43 refreshed; all other unit-weeks unchanged. |
| ERSSTv5 monthly ENSO | September 2026 | Fresh download matches the stored record. |
| Weekly OISST Niño 3.4 | Week centred on 21 October, ending 24 October | Retained separately as a conventional-index observation. |
| CPC RONI outlook | Issued 8 October; checked 30 October | Issued quantiles are unchanged. Monthly trajectories still use an assumed 2015–16 shape. |
| FAOSTAT | Fresh file matches the stored file | No agricultural observations changed. |
| HarvestStat Africa / Asia | Africa v1.2; supplied Asia v0.1/v0.2 | Preserve source priority and stable Indian reporting groups. |
| USDA NASS | 154,991 held yield records checked against the fresh bulk file | No revisions or positive-yield extensions. Thirty-six additional historical zero-yield reports remain in the source extract. |
| Eurostat maize | 10,426 statistics checked in six countries | No changes on the held geography; future cereal area-basis changes need separate treatment. |
| IT.NRW maize | Five additional regional observations for 2025 | Included after reproducing the 75 earlier agency observations. |

MAGyP's latest bulk resource remains the March 2026 extract ending in 2025.
IBGE's held records extend through 2025; bounded API requests failed, so newer
revisions remain unverified. ABS's newer production-sold and satellite-area
series differ from the old census definitions and were not spliced into the
old records. Those limits remain explicit in the refresh report.

We corrected the reference window for partial seasons. An observation through
25 October is now compared with earlier seasons ending on the same calendar
day. Previously a partial-month observation could be compared with a historical
month ending on the 31st. The rule applies to temperature, rainfall and NDVI.

National NDVI extraction now uses the existing NOAA VHP pixels and CROPGRIDS
weights. We require at least 90% mapped crop-area coverage, 50% valid weight
within a weekly observation and 80% elapsed-day coverage within a season.
The extraction supplies histories and season-to-date observations for eligible
national records. It adds no fitted ENSO responses or forecast-skill claims.
National temperature and rainfall history retain their own older observation
cutoffs where no current national extraction is available.

The history axis now includes all available NDVI years. Its previous yield,
temperature and rainfall limits would omit early greenness observations in
18 national crop series. Response-band tooltips now identify the stored
80% or 95% interval correctly. Season-to-date anomaly labels name the
trend-adjusted reference for the same elapsed window.

We normalized duplicate database metadata keys and recorded the actual source
cutoffs before freezing the new database checksum. The export verifies country
geometry hashes directly, so a crop-data update can reuse unchanged boundaries.
The concise help sections now follow the selected model and release. References
identify a new candidate correctly and retain the assumed post-peak ENSO path
explanation. Positive observed-index skill is labelled conditional skill.

## Candidate checks and publication

The new candidate passed its file-hash, source-identity, numerical,
coverage, interface and browser checks before selection as the default release.
The test suite includes national NDVI pixel aggregation and seasonal averaging,
shared-year uncertainty draws and exported joint regions, local slopes for the
five added outcomes, state aggregation and source display permissions. Existing
October 19 and October 8 interface regressions pass after the help changes.
The initial source-geometry audit verifies 191 files and 15,779 world-map units.

Download terms were recorded before obtaining inputs. The refresh preserves
product identities, source priorities, the approved quarter-pooling estimator
and full-record leave-one-harvest-year-out evaluation. Effect intervals retain
the research-candidate qualification. The new release includes the regional
repair; the earlier releases remain available for comparison.

Browsers now revalidate the detailed-calendar release list and deployment metadata. A cached list previously hid new grain-filling dates despite their presence in the exported files. Brazil's cassava anomaly page now retains the annual national reference when the selected local main-season records end earlier. The link opens the national history with its crop, season and year preserved; local missing values remain missing.

The local footer lists NDVI and temperature/rainfall cutoffs separately. Fresh national greenness can coexist with older climate histories. The previous combined date could imply that NDVI's cutoff applied to all weather observations.

## Completed release checks

All 27 saved checks pass. The numerical audit compares 47,108,337 values with the saved analysis tables. The schema audit verifies 17,193 export files, and acceptance checks match all 716 country panels and 24 world summary rows. Independent checks cover national NDVI pixel weights and seasonal calculations, national weather histories, uncertainty-region exports, state aggregation, the five crop additions and unchanged inputs. Browser checks cover Chinese counties, Australian wheat states, Russia, US county/state histories, all six world crop controls, anomaly-year navigation and phone/tablet layouts. The hosted-mode interface test also passes.

These checks establish export and display fidelity. The intervals retain their research-candidate flag, and the recorded conditional skill continues to use observed seasonal ENSO. The existing interface contains ENSO relationship and History; a separate Recent anomalies tab remains a future feature.
