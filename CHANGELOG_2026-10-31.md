# Brazil records and monthly observations — 31 October 2026

Release 2026-10-31 updates Brazilian municipal crop records and adds monthly
Recent anomalies. The release passed numerical and interface checks before
promotion. Crop switching was published separately in commit
`4c3a6a29b92ac0c19b4b3e7a76718b7bff0bc01c`.

## Brazilian crop records

We retrieved IBGE PAM table 1612 for 2010–2025, six crops and all 27 states.
The candidate database adds 89,038 municipal observations and refreshes 47,046
later agency records. The update covers 14,848 existing crop series. Original
panel records and records outside Brazil are preserved. Source request URLs,
retrieval dates, open-data terms and file checksums accompany the local source
archive. The municipal records end in 2025.

We preserved the planted-area denominator of the original Hultgren series.
Production divided by planted area reproduces 82,097 overlapping original yields
within 0.000004 tonnes per hectare. We corrected 3,527 later agency yields whose
previously used denominator differed from that basis. Reported harvested area
and IBGE yield per harvested hectare remain separate source fields. Missing
observations remain missing. The database retains 1,382 reported zero-yield crop
failures; the log-yield model requires positive yields.

We excluded 7,600 pooled annual maize rows where the same municipality and year
already have separate first- and second-crop records. The source update does not
count those overlapping annual records twice. Independent checks compared
408,252 values and reproduced the update through the database-building code.

The source contains 222 municipalities without verified matches to the atlas
boundaries. Those records remain staged for geographic review. The unmatched
municipalities account for 9.3% of source 2025 maize production and 8.1% of soybean
production. Atlas production totals describe the covered reporting units.

We also retained 196 IBGE LSPA estimates in a separate provisional table. Their
reference month is September 2026; we retrieved them on 31 October. The precise
publication day is unconfirmed. These national and state estimates appear in a
closed disclosure on Brazil pages and do not enter municipal histories or model
training. Displayed yield is missing for 43 entries with zero harvested area.

## Recalibration and uncertainty

We completed 561 full-record leave-one-year-out fits for the affected pools,
covering 28,889 series, 1,191,273 eligible observations and 1,188,458 predictions.
Each target harvest year is withheld across every pooled location. The response
model retains quarter pooling. Evaluation uses the observed full-season index;
the scores do not establish skill with an ENSO forecast issued before harvest.

The main uncertainty ensembles each completed 1,000 draws, reduced from 4,000
at the user's request to expedite publication. The completed leave-one-year-out
fits are retained. The estimator and interval levels are unchanged; fewer draws
increase simulation noise in interval endpoints. The manifest records requested
and achieved counts. Conditional-effect interval calibration remains under review.

We regenerated the separate historical-response supplement with 400 draws. The
supplement retains 1,812 Chinese maize, 1,414 rice and 1,786 wheat relationships,
and six Australian wheat state relationships. These older records are shown as
historical associations with current-harvest applicability unassessed.

## Monthly Recent anomalies

We added a third tab beside ENSO relationship and History. Recent anomalies
shows monthly temperature, rainfall and NDVI observations before planting and
through the growing season. The same time axis shows ENSO observations and the
saved seasonal scenarios. Shading marks the typical crop window; open markers
identify partial months. A separate closed summary retains season-to-date
values. Monthly weather expectations and a combined yield-updating model have
not been fitted.

The monthly supplement uses existing local observations for November 2025
through October 2026. We compare each product with its own earlier-year record,
using a linear trend for the same calendar days and at least ten reference
years. Adjusted CPC temperature references begin in 2015; CHIRPS rainfall and
VHP NDVI references begin in 2001. Required temporal coverage is 90% for
temperature, 100% for rainfall and 80% for NDVI. Partial-month NDVI excludes
weekly composites ending after the comparison cutoff. Missing rainfall is never
treated as zero.

The supplement covers 49,225 unit/crop keys in 186 countries, including all-crop
keys. These are not counts of distinct reporting units. Valid monthly anomalies
exist for 47,310 temperature keys, 48,281 rainfall keys and 49,136 NDVI keys.
National NDVI is included. National monthly temperature and rainfall, and state
aggregates, have explicit missing-data messages. Country data are split into
200-key files; the largest page request is 637,555 bytes.

| Input | Last included observation or issue |
|---|---|
| Brazilian municipal PAM records | Harvest year 2025 |
| Provisional national/state LSPA estimates | September 2026 reference month |
| Matched temperature and rainfall | 25 October 2026 |
| VHP NDVI | 28 October 2026 |
| Monthly ERSSTv5 ENSO observations | September 2026 |
| Issued CPC outlook quantiles | 8 October 2026 |

The release date does not advance these input cutoffs. ENSO scenarios retain
their documented assumed monthly shape.

## Interface and verification

The Crop selector is available at world, country, state and local levels. Crop
changes preserve the place, map camera, chart view, mask and release. A compatible
season is selected automatically. Missing crop records are explicitly identified.
Browser Back restores the previous selection. The monthly view is preserved when
switching crops or selecting another local map unit.

Monthly checks cover reference calculations, incomplete months, missing rainfall,
weekly availability, all exported cells and file hashes. Independent October
calculations for Currais, Custer and Yuanyang reproduce temperature and NDVI
anomalies. Page tests cover tab changes, crop changes, pre-plant observations and
national gaps. All 31 release checks passed, including 47,578,069 comparisons between exported
values and analysis outputs. Browser review covered the actual October 31
world, country, state and local pages; all six crop switches; Chinese county
regressions; Australian state maps; United States selection and dragging;
year controls and Back; and the monthly view at 390 pixels. GitHub Pages
publication is verified separately against its deployed commit.

The preceding releases and manuscript are preserved. GitHub Pages serves data
from the exact deployed commit. The stable atlas URL is
[phuybers3.github.io/enso-yield-atlas/site/](https://phuybers3.github.io/enso-yield-atlas/site/).

## Forecast ellipses in historical map views

Selecting the historical map layer also suppressed forecast diamonds and joint
uncertainty regions in the adjacent charts. We separated the map quantity from
the chart outlook. Records with a current outlook now retain their forecast
markers, 80% and 95% covariance regions, harvest year and matching headline when
the map layer changes. Older records without a current outlook retain their
historical label and do not acquire a forecast.

The regression test reproduces the missing Montana ellipses before the repair.
The corrected state, county and national pages preserve identical forecast
coordinates across all four map layers. History retains its year-axis marker;
conventional-index charts do not import relative-index ellipses. Chinese
historical-only records, crop switching and Recent anomalies also pass their
checks. The numerical estimates and source cutoffs are unchanged.
