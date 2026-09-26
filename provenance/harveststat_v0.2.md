# HarvestStat Asia v0.2 — an increment to v0.1

| country | rows | products | groups | years | base year | level |
|---|---:|---:|---:|---|---:|---|
| Indonesia | 63,180 | 54 | 26 | 1980–2024 | 1980 | province |
| Japan | 27,704 | 78 | 47 | 1980–2016 | 1980 | prefecture |
| South Korea | 27,403 | 81 | 10 | 1980–2025 | 1980 | province |
| Sri Lanka | 10,909 | 59 | 8 | 1980–2024 | 1980 | province |
| Malaysia | 1,575 | 10 | 13 | 1993–2022 | 1970 | state |


## What is specific to these five - Claude generated

**South Korea reports the same rice harvest three times.** `Rice, paddy` is rough
(unmilled) rice; `Rice, brown` and `Rice, milled` are the *same fields* at hulled
and milled weight — the planted area is identical in 99.9% of cells. **Never sum
their area.** Barley, malting barley and naked barley have the same rough/polished
pair. This turns out to be useful: Korea is the only country in the package that
reports both rough and milled rice, so it gives a measured paddy-to-milled factor —
0.726 in 1990, 0.739 in 2010, 0.756 in 2023. Use `Rice, paddy` to compare with the
other Asian countries and `Rice, milled` to compare with India. National milled rice
in 2023 is 3.70 Mt, matching Statistics Korea's published figure.

**South Korea is 10 groups from 17 provinces and cities.** Its lineage records the
territory transfers between provinces and cities (Gijang to Busan, Dalseong to Daegu,
Ganghwa-Ongjin to Incheon in 1995; Gunwi to Daegu in 2023), so each metropolitan
city except Seoul is grouped with the province it grew out of:
Busan + Ulsan + Gyeongsangnam-do; Daegu + Gyeongsangbuk-do; Incheon + Gyeonggi-do;
Gwangju + Jeollanam-do; Daejeon + Sejong + Chungcheongnam-do. That is correct but
coarse. The cities grow little, so 11.1% of Korean rows are incomplete sums — more
than most countries here.

**Korean 2024 and 2025 are partial source releases** — 197 and 40 rows, against about
675 a year before that. Many crops simply have no 2024–25 value yet.

**Other Korean corrections, all recorded in `countries/KR/crop_names.csv`:**
`Wheat (Polished)` and `Rye (Polished)` are exact copies of the rough series — wheat
and rye aren't polished — and are left out. `Persimmon` is the total, and equals
astringent + sweet exactly. The fall white-radish series changed its label in 2001
and is joined back into one series. Field and greenhouse vegetables are separate
products that sum to the crop's total. 204 rows reporting area but zero production
are set to missing.

**Korea's boundary record needed two repairs**, both recorded in `scripts/config.py`.
Each transfer ran through a temporary unit created and absorbed in the same year,
which the boundary software rejects because it would count that land twice
thereafter; five were collapsed into direct transfers. And a 2026
Jeollanam-do + Gwangju merger in the record, never enacted, is excluded. GAUL has no
separate Sejong polygon — it draws Sejong inside Chungcheongnam-do — which is
harmless because the two are one group either way.


**Indonesia's area is harvested area, and it arrives with CPCv2 codes.** The
source's planted-area column is the string `NC` on every row, so yields are on a
harvested basis — like Sri Lanka's, unlike the other five. Its `crop_code` column
is populated from the source's own CPCv2 codes, the second country after India to
have them. They agree with India's wherever the crops overlap, and they confirm the
rice caveat independently: Indonesia's rice is `R01132AA`, raw paddy; India's is
`P23161AA`, processed.

**Indonesia's rice comes in three rows, and only one is the total.** `Rice, paddy`
is the published total. `Rice, paddy, wetland` and `Rice, paddy, dryland` are its
components, kept because they are real information, but **do not sum them with the
total**. They also do not always add up to it: exactly on 81.4% of cells, and the
worst cell is out by 10.8 million ha, which is a source error.

**Five corrections were made to Indonesia's source, all recorded in
`scripts/standardize_fdw.py`:**

- **Zero-filled template rows removed.** The source lists all 38 modern provinces
  in every year from 1970, including the 12 created since 1999. Every row dated
  before one of those provinces existed — 14,740 of them — carries area 0 and
  production 0. These are not data (Banten's crops were inside Jawa Barat's figures
  until 2000), so they are dropped.
- **Zero production with positive area set to missing.** 513 rows (0.5%, mostly
  1996–2018) report harvested area and exactly 0 t — Jawa Barat rice in 2000 has
  2.19M ha and 0 t. Left in, that enters a regression as a yield of zero.
- **2024 zero placeholders dropped.** For rice and maize in 2023–24 the source has
  two rows per province, one of them all-zero. A naive read keeps whichever comes
  first; in an early build that put 2024 rice area at zero in 33 of 37 provinces.
- **Two definitions of 2023 maize production.** 33 province-cells carry the same
  area and two production figures in a constant ratio of exactly 1.788. The lower is
  kept: it gives a national yield of 5.97 t/ha against 5.89 in 2024, where the higher
  would give ~9.7. About 80% confident this is the standard definition.
- **Indonesian rice nesting separated**, as above.

**One Indonesian anomaly left alone:** national maize yield in 2022 is 7.22 t/ha,
out of line with both neighbouring years. It is not the 1.788 duplication. Treat
2022 maize with suspicion.

**Indonesia is 26 groups from 38 provinces**, all Splits, no merges: every modern
province traces to one of the 26 provinces of 1980. The largest group is Papua,
which holds six present-day provinces after the 2003 and 2022 splits. Three groups
are separated by sea — Sumatera Selatan with Bangka Belitung (10 km), Riau with the
Riau Islands (7 km), Maluku with North Maluku (29 km) — which is geography, not
error. Statistics start in 1970 but the boundary record starts in 1980, so the
1970s are not in the product. One source crop, `Palma` (2,340 rows), has no crop
code and no identifiable meaning, and is left out rather than guessed.

**Indonesia's boundary file is simplified.** Its ~17,000 islands make the raw GAUL
layer 106 MB. It was simplified with shared province borders held intact, at
~55 m: total area changes by −0.002%, the worst province by 0.09%.


**Japan's production is derived, not published.** Japan reports planted area and
yield but neither production nor harvested area — its harvested-area rows exist
and are null on all 43,206 of them. `production_mt` is therefore computed as
planted area x the published yield. That is exact for Japan and only for Japan:
its lineage has **zero** boundary events, so every stable group is a single
prefecture and no aggregation happens that could make a derived product
inconsistent. Japan's `yield_mt_ha` reproduces the published yield by
construction rather than being an independent estimate.

**Japan's stable boundary is the modern boundary.** 47 prefectures, unchanged
since 1980, so all 47 groups are singletons. 

**Sri Lanka reports only harvested area.** Its planted area is in the `part1`
source file that this one supersedes, so `area_planted_ha` is empty and
`yield_basis` is `harvested` throughout. Its yields are therefore **not** directly
comparable with the other six, which are on a planted basis.

**Sri Lanka is 8 groups from 9 provinces.** Northern and Eastern merged into North
Eastern in 1988 and de-merged in 2007, so they cannot be separated across
1988–2007 and form one group. The lineage's own report notes this is the
*conservative* reading: every source describes the 2007 de-merger as restoring the
1987 boundaries, so a user who accepts that may treat the two separately.

**Malaysia is thin.** 1,575 rows, and four of its ten products are aggregate
categories (`Cash crops`, `Fruit, mixed`, `Vegetables, major`, `Vegetables,
mixed`) rather than single crops; they may overlap one another and their notes say
so. Its base year of 1970 also predates its statistics, which start in 1993, so
Kuala Lumpur and Labuan are folded into Selangor and Sabah — 13 groups where 15
would be defensible.

## Status

Provisional, as for the other non-India countries: these three boundary lineages
are structurally validated but have **not** had an independent historical accuracy
review. Japan's construction report additionally flags one unencoded event — the
2005 transfer of Yamaguchi-mura from Nagano to Gifu, about 0.09% of either
prefecture — and that its build ran against v1 tooling with a required hazards
reference missing from the bundle.

## Attribution

Boundaries are FAO GAUL 2025, **CC BY 4.0**:

> FAO. 2025. Global Administrative Unit Layers (GAUL). [Accessed on 21 September
> 2026]. https://data.apps.fao.org/?lang=en. Licence: CC-BY-4.0
