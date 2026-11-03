# 3 November 2026: the completed harvest stands in where the next one is beyond coverage

We build `2026-11-03-inclusive` from the fits, skill tables and inputs of
2 November and set it as the default. One rule changes. A series' target
harvest is still its next window ending after the as-of date, but where that
window ends after the issued ENSO coverage, 31 July 2027 for the October CPC
issue, the target is now the series' most recent completed window of the past
year, estimated at the observed index and the issued months after September.
The completed harvest keeps its estimate until the next harvest is covered,
and once its yield is reported the page shows the reported departure beside
the estimate. The owner asked for both values on 2 November after the 1 and 2
November releases had dropped every northern-hemisphere autumn harvest: the
2026 harvest date had passed, and the 2027 window could not be supported.

## What the rule restores

The rule applies to 27,317 of the 83,255 dated windows and gives 16,725 series
a supported target that had none. The country panels rise from 387 to 716,
because a country whose units complete their harvests on both sides of the
as-of date carries a panel for each year, as the 31 October release did, and
the production behind the panels doubles from 1,788 to 3,843 Mt. United
States maize returns to 2,056 series and 359 Mt at +7.8 percent, from 184
series and 21 Mt at +4.9. No completed target has a reported yield yet; the
database still ends with the 2025 harvests, so the pages say the yield is
pending. The usable share of covered production falls from 10.4 to 4.8
percent because the restored production is mostly unusable under the
growing-region gate, which did not change: the usable tonnage is 184 Mt in
both releases.

| World medium outlook, percent | 2 November | 3 November |
| --- | ---: | ---: |
| Maize | +3.2 (+1.2 to +7.7) | +3.5 (+1.0 to +7.4) |
| Rice | −1.8 (−3.0 to +1.1) | +0.4 (−1.7 to +3.6) |
| Wheat | −0.3 (−1.8 to +2.4) | +0.9 (−0.6 to +3.8) |
| Soybean | +0.7 (−1.2 to +4.0) | +1.6 (+0.2 to +4.0) |
| Sorghum | −2.9 (−4.7 to +2.3) | −0.7 (−2.1 to +3.5) |
| Cassava | −0.3 (−2.2 to +5.5) | −0.5 (−2.2 to +3.9) |

The world rows move because they now sum the completed 2026 harvests with the
covered 2027 ones, as the 31 October release did.

| Series status | 2 November | 3 November |
| --- | ---: | ---: |
| Supported | 30,153 | 43,210 |
| Season extends beyond issued ENSO coverage | 16,718 | 0 |
| Fewer than ten eligible years | 5,619 | 8,959 |
| Local response unavailable | 651 | 972 |
| Calendar unavailable | 42 | 42 |

The two lower rows grow because coverage had been the first reason recorded
for those series; with it gone, the next reason shows.

## Where the rule lives

`lib/forecast_eligibility.py` holds the rule twice, for the build's
season-window table (`horizon_targets`, used by `aggregate.horizon`) and for
one series' calendar rows (`assess`, used for the page metadata), and
`tests/model/test_forecast_targets.py` checks that the two agree. The target
records `completed`, `reported` and `next_harvest`, and the weights table
records `target_kind`, `next_target_year` and `next_end_date`. The release's
`index.target_policy` states the rule, and the site reads it there.

## Site text

A unit page with a completed target says when the harvest completed, which
index months the estimate uses, whether the yield is reported, and which
harvest lies beyond the coverage. Once a reported yield is in the record, a
line under the estimate gives the reported departure from the ENSO-neutral
baseline beside the estimate and its range. A state or growing-region page
without aggregate rows now gives its units' reason instead of the generic
sentence. The about and methods pages state the rule where the release's
index facts record it.

## Map colours, later on 3 November

A zero estimate is now white and the places without a value are grey. The
yield palette's centre moves from PuOr's near-white grey to white, and three
greys replace the paper colour that no-record countries and the crop mask had
shared with the page: records without a current estimate take the darkest,
the crop's missing records a lighter one, and the mask the lightest, rendered
from the unchanged paper-coloured tiles at 92 percent brightness. The owner
noticed the ambiguity on Chinese soybean, where the only record is the
national FAOSTAT series at −1.0 percent, so every province carried the same
near-white colour; China's Hultgren subnational records cover maize, rice and
winter wheat only, and none extends past 2003.

## Checks

The stage is `analysis/review/completed_harvests_2026-11-03/` (night.py from
the forward step, 41 minutes). The release validation passes with the
completed-target cases admitted; the schema and acceptance tests pass; the
numerics test fails on the local-only forecasts as on the two previous
releases. The regional, calendar and inclusive site tests pass; the six stale
site tests fail as before.
