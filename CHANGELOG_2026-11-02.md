# 2 November 2026: the random-effects weight and the growing-region gate

We build `2026-11-02-inclusive` as the candidate atlas release and set it as
the local default. The data inputs are those of 1 November: the 31 October
production database, the 1 November local database with the Australian wheat
observations, the September 2026 observed index and the October CPC outlook.
Two things change: the displayed yield response now carries the full
random-effects weight, and the skill gate moves from the country panel to the
weather-coherent growing region. The owner decided both on 1 November
(`analysis/review/regional_targets_2026-11-01/DECISION_pooling_weight_and_gate.md`).
The build is staged under `analysis/review/random_effects_release_2026-11-02/`
in the ENSO project and published on 2 November as the atlas's default release.

## The displayed estimator

Every displayed unit slope is now the hierarchy's empirical-Bayes slope. A
series' own slope carries the weight tau² / (tau² + se²), where tau² is the
Paule–Mandel spread of true slopes among the state's units and se² the series'
calibrated sampling variance, and the state's centre carries the remainder.
Since 19 October the atlas had displayed a slope only a quarter of the way
from the own slope to that posterior (pooling fraction 0.25). The historical
publication pipeline had fitted with the full weight throughout, so the change
also removes a difference between the two pipelines. The release manifest and
the catalog record `pooling_weight random_effects` and `pooling_fraction 1.0`;
`response_leaf.pooling_fraction` is 1.0 on every row.

The weight changes a well-observed series little and a noisy one a lot. Across
the 24,341 series with a current estimate, the medium outlook moves by 3.7
points at the median and 6.3 on average, and the mean width of the 80 percent
effect range falls from 32.2 to 23.9 points. The country panels move far less,
because 229 of the 387 panels rest on a single national series whose slope has
no state centre to move towards. Among the other panels the production-weighted
mean change is 0.5 points. The largest panel changes fall on small producers:
Ecuadorian spring wheat moves from +68 to +16 percent on a baseline below
10,000 tonnes.

| World medium outlook, percent | 1 November | 2 November |
| --- | ---: | ---: |
| Maize | +4.1 (+2.0 to +10.1) | +3.2 (+1.2 to +7.7) |
| Rice | −1.5 (−2.5 to +1.6) | −1.8 (−3.0 to +1.1) |
| Wheat | −0.2 (−1.7 to +2.7) | −0.3 (−1.8 to +2.4) |
| Soybean | +1.2 (−0.7 to +4.6) | +0.7 (−1.2 to +4.0) |
| Sorghum | −2.5 (−3.9 to +5.3) | −2.9 (−4.7 to +2.3) |
| Cassava | −1.4 (−2.9 to +5.7) | −0.4 (−2.2 to +5.5) |

## The gate

A unit's estimate is shown as usable where the lower 80 percent bound of the
aggregate skill of its growing region exceeds zero. The regions are the 296
weather-coherent clusters of `lib/clusters.py`, built on 31 October from the
correlation of detrended season rainfall and temperature anomalies within each
country and crop family. The aggregate skill scores the production-weighted
mean of the leave-one-year-out unit predictions against the mean observed
departure over the years in which the scored series hold at least 70 percent
of the region's baseline production, with 1,000 year resamples. Where a region
has no score the country panel's bound applies, as before. In the forward
release 24,277 of the 24,341 covered series take a cluster bound and 64 fall
back to the country panel. The 1 November comparison that motivated the change
showed the country aggregate cancelling opposing responses within Brazil.

The gate now scores the estimator the atlas displays. We reran the outer
leave-one-year-out stage of the 18 October expansion at the full weight
(566 crop-season pools, 6.7 million withheld-year predictions, 54,442 series)
and rebuilt the skill tables from it as `analysis/releases/crops/loyo_2026-11-02`.
The 31 October tables had combined the expansion with three re-scorings at the
quarter weight (the rice pool, the maize pool and Brazil); those re-scorings
are not reproduced, and for the large panels both tables cover the same years.
At the full weight the country panels have median skill −2.0 percent against
the trend, 22 percent of them positive and 3.8 percent with a positive lower
bound; the 31 October tables had −3.1, 18 and 2.5 percent.

| Aggregate skill at the full weight | Rows | Median skill | Positive lower bound |
| --- | ---: | ---: | ---: |
| Growing region | 437 | −2.7% | 5.7% |
| State or region | 1,961 | −1.6% | 6.9% |
| Country | 342 | −2.8% | 4.7% |

The usable share of covered production rises from 4.9 to 10.4 percent; 1,885
series enter and 1,559 leave. Argentine maize and soybean enter, 61 and 50
million tonnes, because their single growing regions carry positive bounds
although the country panels did not: Argentine maize, +23.5 percent with a
range of +11.8 to +38.7, is now the atlas's largest usable gain. Brazilian
rice enters at 78 percent of its production, and Ethiopian Meher wheat and
Malawian maize enter whole. United States winter wheat, 35 million tonnes,
leaves: its country panel's bound is positive (+0.8 percent) but none of its
five growing regions has one. Cameroonian cassava leaves for the same reason.

## Local yield effects

We refit the historical-local cohort at the same weight: 5,512 series in 18
pools with 1,000 draws, scored over 439 pooled harvest-year folds, and 5,815
new conditional forecasts (5,820 on 1 November). Western Australia's wheat
estimate for the December 2026 harvest is −11.4 percent with a range of −19.5
to −3.3, close to the 1 November value. Zhongxiang's winter wheat estimate for
June 2027 moves from +24.1 to +8.7 percent, with a range of −5.1 to +27.4,
because the full weight draws a 23-year series towards its provincial centre.
Its records still end in 2003 and the page still says so.

| Series status | 1 November | 2 November |
| --- | ---: | ---: |
| Supported next-harvest effect | 30,192 | 30,153 |
| Season extends beyond issued ENSO coverage | 16,676 | 16,718 |
| Fewer than ten eligible years | 5,622 | 5,619 |
| Local response unavailable | 651 | 651 |
| Calendar unavailable | 42 | 42 |

## Site files

`countries/<ISO>.json` carries two new blocks, `clusters` with the growing
regions' aggregate rows and `aggregate_skill` with the country's rows at every
level; the catalog's `model.skill_gates` and `model.display_specification`
state the gate level and the pooling weight, and the regional page reads its
gate wording from them. The methods route reads the same two fields, so it
describes the random-effects weight and the growing-region gate on this release
and the quarter weight and the country gate on the earlier releases, each with
its own pooling fraction. Units name their growing region, region records sit
beside the state records, and `geometry/clusters_<ISO>.json` holds the polygons
of 58 countries. The export writes 17,549 files, 1.03 GB. The contract document
(`analysis/contracts/SCHEMA.md`) gains an amendment of 2 November and
`tests/schema.py` accepts the two blocks where present.

## Checks

The release validation hashes all 17,549 files, confirms the 1,000 draws and
the fold design, and checks every required ENSO month. The schema test passes.
The acceptance test reproduces all 387 panel rows and 24 world rows from the
country and world exports, with the first screen at 2.70 MB. The regional,
calendar and inclusive site tests pass. The numerics test fails on the
local-only forecasts, which carry one prediction row in the unit file and none
in `prediction_series`; it fails the same way on 2026-11-01-inclusive, so the
test predates the local cohort rather than the build. Six site tests (ui,
calendar page, map regressions, uncertainty, historical, forecast targets)
fail against the committed front-end files as well, on retired release folders
and the mask selector. The first pass of the build failed validation because
the manifest was hashed before the display-contract repair rewrote three
files; the repair now runs first.
