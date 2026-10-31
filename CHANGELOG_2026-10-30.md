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

## Separate data refresh in progress

The historical repair leaves the existing release's observations, outlooks and
published cutoff dates unchanged. A separate database is being built with:

| Input | Latest verified observations | Status |
| --- | --- | --- |
| CPC temperature | 29 October 2026 | Downloaded and aggregated |
| CHIRPS v2 rainfall | Final 30 September; preliminary 25 October | Downloaded and aggregated |
| NOAA STAR VHP NDVI | Week 43, ending 28 October | Six recent weeks refreshed; other unit-weeks verified unchanged |
| ERSSTv5 | September 2026 | Downloaded; index reconciliation pending |
| FAOSTAT | Existing file unchanged | Fresh download has identical checksum |
| HarvestStat Africa | v1.2 | Latest provider release already held |
| HarvestStat Asia and agency extensions | Source-specific | Remaining freshness checks pending |

Source terms are recorded before downloads. CHIRPS keeps the existing v2 product
despite a moved provider directory. The weekly conventional NOAA index is not
spliced into the relative ERSST index. The CPC RONI outlook remains the issued
8 October outlook; assumed future monthly paths are still identified as scenarios.
The refreshed database, analytical export and final deployment require their
own checks and are not implied by this historical repair.
