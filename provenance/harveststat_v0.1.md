# HarvestStat Asia v0.1 — India, Thailand, Vietnam, Bangladesh

Crop area, production and yield on **stable administrative boundaries**: unit
groups whose totals stay additive and comparable across every boundary change in
the window. One statistics table and one boundary file per country, joined on
`stable_id`.

| country | rows | products | groups | years | base year | level |
|---|---:|---:|---:|---|---:|---|
| India | 268,702 | 50 | 474 | 1997–2022 | 1997 | district |
| Thailand | 27,374 | 26 | 72 | 1980–2024 | 1980 | province |
| Vietnam | 11,561 | 9 | 37 | 1976–2023 | 1976 | province |
| Bangladesh | 18,450 | 74 | 21 | 1983–2024 | 1983 | district |

All four share an identical 24-column schema.

## Reading it

One mesh per country, for the whole series. The base-year mesh is the coarsest
grouping and therefore the only one valid across every boundary change.

```python
import pandas as pd, geopandas as gpd

stats = pd.read_csv("TH/hvstat_asia_TH_v0.1.csv")
geo   = gpd.read_file("TH/hvstat_asia_TH_boundary_v0.1.gpkg")   # EPSG:4326
gdf   = geo.merge(stats, on="stable_id")
```

Every `stable_id` in the statistics is present in that country's boundary file.

## Files, per country

| file | what it is |
|---|---|
| `hvstat_asia_<ISO>_v0.1.csv` | **the product.** One row per (`stable_id`, `year`, `season_name`, `product`) |
| `hvstat_asia_<ISO>_boundary_v0.1.gpkg` | the base-year mesh, EPSG:4326. Join on `stable_id` |
| `hvstat_asia_<ISO>_long_v0.1.csv` | the unfiltered long-form source, with the audit columns. **Not shipped for India** - it would be a copy of the published `crop_stats_stabilized.csv` (103 MB), which is citable at doi.org/10.5281/zenodo.21653283 |
| `MANIFEST.json` | sha256 and byte count of each file |

`season_calendar_asia_v0.1.csv` covers all four countries.

## Columns

| column | meaning |
|---|---|
| `stable_id` | the stable group. **The join key.** |
| `unit_name` | the group's name at the base year |
| `unit_members` | present-day units in the group, semicolon-separated |
| `n_members` | how many |
| `country`, `country_code`, `admin_level`, `base_year` | constants per country |
| `year` | the source's reporting year **as published** — see "What `year` means" |
| `season_name` | the local season label; joins to the season calendar |
| `product` | standardized English crop name |
| `crop_code` | CPCv2. **India only**; blank for the others for now |
| `product_source_name` | the source's own crop label, for traceability |
| `area_planted_ha` | planted area. Populated for all four countries |
| `area_harvested_ha` | harvested area. **Thailand only** |
| `production_mt` | tonnes |
| `yield_mt_ha` | recomputed from the summed numerator and denominator |
| `yield_basis` | `harvested` or `planted` — which denominator built the yield |
| `<measure>_n_reporting` | constituent units that reported that measure |
| `<measure>_complete` | whether all of them did |

## Three things that will otherwise mislead you

**1. `complete = False` means the number is a lower bound.** Some constituent
units did not report that year, so the group sum covers only part of the group —
and that looks exactly like a decline. Condition on it or filter it.

This matters very differently by country:

| | rows in multi-member groups | `area_planted_complete = False` |
|---|---:|---:|
| Thailand | 8% | **2%** |
| India | 37% | **8%** |
| Vietnam | 62% | **8%** |
| **Bangladesh** | **91%** | **47%** |

Bangladesh is the one to be careful with. Its 64 reporting districts collapse
into 21 stable groups, so nearly every row is a multi-district sum and on almost
half of them only *one* district reported. An unfiltered Bangladeshi series is a
series of partial sums with varying coverage, and a regression on it will partly
be fitting reporting coverage.

**2. Never average yields, and never sum across season tiers.** `yield_mt_ha` is
already recomputed from summed production over summed area; averaging it across
groups or years reintroduces the error. And a crop reporting both an annual total
and sub-seasons in the same year will double-count if you sum the seasons.

**3. `late_reporting` rows are already removed** from these tables — series filed
against a unit in years before that unit existed. They remain in the `_long_`
files if you want them.

## What `year` means

`year` is the source's reporting year, as published. It is the **harvest** year
for every country and season here **except India's `Whole Year`**, which carries a
sowing-year label.

Use the calendar rather than assuming:
`harvest_year = year + harvest_year_offset`, joined on
(`country_code`, `season_name`). The calendar also gives planting and harvest
months, and a `confidence` column saying where each number came from — only 3 of
its 26 rows are derived from the source's own dates; Thailand has no date fields
at all.

## Known incomparabilities — read before pooling countries

**Rice is not one product across these four.** India reports **milled** rice;
Thailand, Vietnam and Bangladesh report **paddy**. They are roughly 1.5x apart.
India's own CPCv2 code says so: `P23161AA`, the only P-prefixed (processed) code
among its 50 crops. Do not pool them. CPCv2 codes for the other three will
disambiguate this properly in a later version.

**Area means planted area everywhere.** Thailand alone additionally reports
harvested area. `yield_basis` records which denominator each yield used, so a
Thai yield on a harvested basis is not directly comparable with an Indian one on
a planted basis.

**The four countries share almost no crops.** After standardizing the names,
exactly **one product is present in all four — Soybean.** Eight are in at least
three: Cassava, Garlic, Maize, Potato, Rice (paddy), Soybean, Sugarcane, Sweet
potato. India and Bangladesh overlap on 29; every other pair shares 4 to 7. A
pooled four-country regression is therefore available for very few crops. That is
a property of what these countries grow and report, not of this schema.

**Bangladesh is coarse.** 21 groups from 64 reporting districts — see hazard 1.

## Boundaries and attribution

Boundaries are derived from **FAO GAUL** (2025 for Thailand and Bangladesh, 2024
for Vietnam), licensed **CC BY 4.0**. Required citation:

> FAO. 2025. Global Administrative Unit Layers (GAUL). [Accessed on 21 September
> 2026]. https://data.apps.fao.org/?lang=en. Licence: CC-BY-4.0

India's boundaries derive from **Geolocet** district boundaries
(https://geolocet.com), redistributed with permission; **attribution to Geolocet
is required in onward use.**

India's statistics and boundaries are the published dataset of Foley et al.,
*StableBound: Stabilizing Administrative Statistics Across Changing Boundaries,
with a District Crop Record and Administrative Lineage for India*, Earth System
Science Data (in review); dataset https://doi.org/10.5281/zenodo.21653283.

## Status

**v0.1, internal draft.** The India component is published and peer-reviewed in
process. The Thailand, Vietnam and Bangladesh components are built from
administrative lineages whose **structure** has been validated but whose
**historical accuracy has not been independently audited**. Treat those three as
provisional.
