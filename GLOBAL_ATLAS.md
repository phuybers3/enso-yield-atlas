# Global agricultural atlas: observed yields

The first release is available at https://phuybers3.github.io/enso-yield-atlas/global/. We provide a world map, dedicated country pages, and regional observation panels. We retain the existing ENSO explorer at the site root. This prototype covers observed average yields and reporting coverage. Trend and ENSO layers will follow through the same data interface.

## Release 2026-09-26

We export wheat, maize, paddy rice, and milled rice from the supplied HarvestStat Asia v0.1 and v0.2 packages. The current inputs cover Bangladesh, India, Indonesia, Japan, South Korea, Malaysia, Sri Lanka, Thailand, and Vietnam. Other countries remain selectable on the world map and have an explicit missing-coverage page. We do not create national observations or assign national values to subnational polygons. The current packages contain stable subnational groups; testing a real national-only input awaits the expanded database.

| Product | Eligible crop–season–basis series | Regions with at least one record | Eligible annual observations |
|---|---:|---:|---:|
| Wheat | 560 | 478 | 9,971 |
| Maize | 1,282 | 561 | 20,423 |
| Rice, paddy | 422 | 231 | 14,962 |
| Rice, milled | 1,147 | 467 | 18,878 |

Counts span all reported seasons and both area bases. One map selection chooses one season and one denominator per country. Series are not independent outcomes, and several seasons or rice forms can describe overlapping agricultural activity.

## Calculation and selection rules

An eligible observation has complete area and production reporting, positive area, finite nonnegative yield and production, and yield consistent with production divided by the recorded area to relative tolerance 1e-5. We preserve a zero yield when the standardized source supplies zero production with complete positive area. Source-coded missing values remain missing. The source packages already removed several known zero placeholders. We exclude 4,130 incompletely reported rows and 319 rows without a usable area basis across these four products.

We apply the documented East Java 2017 paddy correction from `verified_correction.json`. We join the Vietnamese Summer Rice label to Autumn Rice, preserving the Northern and Southern qualifiers. All other product and season labels are preserved. Japanese production is derived from planted area and published yield, as documented in the supplied package. Malaysian rice includes changes between planted and harvested denominators; we split those records into separate series.

The displayed mean is the arithmetic mean of eligible annual yields in the requested period. We never average crop components, seasons, or area bases together. Prepared periods are 1991–2020, 2001–2020, 2011–2020, 2015–2024, and available record. For a fixed period, completeness is the observation count divided by the full requested number of years. For available record, completeness uses the inclusive span from the first to the last valid observation. A selectable 80% rule filters map values without hiding the underlying series. The default requires one valid year. Actual dates and counts accompany every value.

Country-specific season defaults prefer Annual, Calendar Year, and All (Season), then Rabi for wheat. Otherwise the default is the season with the most eligible observations. Defaults are calculated from the full record and remain fixed when users change period. A country’s default area basis is the basis with the most observations in its selected season. An explicit season or area-basis choice restricts the map. Missing selections remain missing when moving between countries. Changing crop resets season to the documented default; period, area basis, measure, and coverage requirement are retained.

We show full-range color scales across countries for a given selection. Values are never clipped. Gray denotes no mapped value under the current selection. The location list distinguishes unavailable country coverage, an unavailable crop or season, no eligible observations in the period, and insufficient temporal completeness. No data category asserts that a crop is absent.

## Yield and ENSO through time

The regional chart overlays observed yield in green (left axis, t/ha) and crop-season Niño 3.4 in orange (right axis, °C). We use the frozen NOAA PSL ERSSTv6 monthly anomalies from the agricultural analysis, relative to 1981–2010. We average all months in the existing country–crop–season window and align the average to the crop reporting year. For example, Indian Rabi uses November of the preceding year through April; Whole Year retains the existing following-year assumption. Every window and its calendar caveats accompany the index export. Annual windows whose crop-specific timing is unresolved are identified in the source note.

We scale the right axis so the two series have equal vertical standard deviations and align their means, using years with both values over the full displayed record. Raw values retain their original units. Both axes expand to include every value and ENSO zero without clipping. A dotted line marks zero Niño 3.4. Constant or single-year records use an automatic scale, identified below the chart. Changing the selected period changes emphasis and downloaded rows while retaining the full record and its axis scale. Yield gaps interrupt the yield line; an ENSO value requires every month of its window, so missing climate months also create gaps. ENSO can remain visible in years with missing yields.

The observation table and CSV include the seasonal index. The CSV also identifies the window, index product, and anomaly baseline. The separate climate supplement is `global/data/enso/2026-09-26/nino34.json`; the frozen agricultural files are unchanged. The NOAA source snapshot is `provenance/nino34_20260924.txt`, and the window definitions come from `source/atlas_payload.json.gz`. Both source hashes are stored in the supplement. Run `python3 scripts/build_global_enso.py` to regenerate it or add `--check` to verify it. The exporter reproduces all 240,768 ENSO exposures in the existing fits. The JavaScript tests independently compare the 51,882 fitted exposures for the crop windows in this atlas and verify the scaling, units, missing values, and reporting-year offsets.

## Navigation

Regional observations open in a side panel over the world or country map; on smaller screens the panel sits along the bottom. The map remains clickable. Choose another reporting unit on the map, from the panel selector, or with Previous/Next. The panel retains the observations, chart, source notes, and downloads. Closing it or pressing Escape restores focus to the region in the location list when available.

Opening a panel adds one browser-history entry. Switching regions or changing its selections replaces that entry, so one browser Back returns to the originating map and its selections; Forward reopens the last panel. Zoom, map position, page scroll, search text, and list scroll are retained within the session. Back to map on a directly opened regional link stays in the atlas, using its specified backdrop. Shareable URLs preserve the region and selectors; camera position and scroll remain local to the session.

## Data interface

Files under `global/data/2026-09-26/` form a frozen release. `catalog.json` lists products, countries, source seasons, reporting levels, prepared periods, source-file checksums, and exclusion counts. `<crop>.json` contains a summary per region, crop, season, and area basis, with mean, count, actual dates, and completeness for each period. `geometry/<country>.json` contains stable reporting boundaries and their lineage metadata. `observations/<country>-<crop>.json` contains source identifiers, excluded-record counts, and observations in the column order recorded inside each file. `manifest.json` hashes every release JSON file.

The compound series key is `(country, region_id, crop, season, yield_basis)`. Years must be unique within a series. Region IDs are stable source identifiers and must have a corresponding geometry. Missing means are JSON null. An observation array contains reporting year, yield in tonnes per hectare, area in hectares, production in tonnes, and a Boolean correction flag. The displayed region names do not define identifiers. Parent/child navigation is currently world → country → stable source unit; these units are the finest statistical geography in the current packages.

We simplify statistical boundaries at 700 m in a local equal-area projection. The original grouping remains the analytical geography. The one unmatched Indian boundary without a statistical unit is left uncolored. Natural Earth 1:110m country outlines supply global context; very small territories may be absent at that scale. National coverage supplied by the expanding database will require a national reporting unit with source observations and its own geometry. Mixed national and subnational inputs must define non-overlapping coverage before inclusion.

The application uses hash routes, such as `#/country/JP?crop=wheat&period=available&metric=yield&minimum=1&basis=default&season=default&release=2026-09-26`. Regional routes add the stable unit ID and `view=world` or `view=country` to identify the underlying map. Links without `view` retain a country backdrop. The release is part of the link. Unknown release IDs produce an explicit error. We load crop summaries and the relevant geometry for the world view, and load observations only when a regional panel opens. No API, credentials, external tiles, or runtime third-party scripts are required.

## Reproduction and checks

The frozen application runs on a static HTTP server or GitHub Pages. Run `npm ci` then `npm test` with Node.js 18 or later to validate all period summaries, release hashes, route round trips, selection uniqueness, and country/region interfaces. The interface tests use a DOM implementation and include the accessible no-WebGL fallback. Navigation checks additionally exercise browser history, camera and scroll preservation, direct links, regional switching, and keyboard close/focus behavior with a camera-aware map stub. Browser checks additionally verify the actual interactive map and layout.

To regenerate the release, install Python dependencies from `scripts/global-requirements.txt`. Obtain the original agricultural packages and Natural Earth’s `ne_110m_admin_0_countries.geojson`, then run:

```sh
python scripts/build_global_data.py --inputs /path/to/4_ag --world /path/to/ne_110m_admin_0_countries.geojson
python tests/global_rules.py
npm test
```

The original source packages are unchanged. Input hashes in the catalog identify the agricultural files used. The world outline source is https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson; the exported geometry is frozen and hashed in this release. The exporter is intentionally an adapter for the current packages. The larger database can populate the same release contract without changing the navigation.

MapLibre GL JS 5.20.0 and its stylesheet are vendored from the npm package. Its BSD-3-Clause license is in `global/vendor/maplibre-LICENSE.txt`. Natural Earth outlines are public domain. Statistical boundaries and agricultural observations retain the source terms described in the repository README and provenance notes. No new blanket data license is asserted.
