# ENSO response checks and partial pooling

Release `2026-09-26-robust-v1` adds checks for 29,339 agricultural source series across wheat, maize, rice, soybean, sorghum and cassava. We use crop-season Niño 3.4 and harvest years within 1981–2024. The original source records, eligibility rules, calendars and individual fits come from the frozen [merged release](MERGED_RELEASE.md). The requested period is a selection window; each panel reports the actual years used.

The [atlas](https://phuybers3.github.io/enso-yield-atlas/global/) offers individual and partially pooled estimates, trend and event checks, a field-significance filter and a stability filter. Other indices, exposure windows and periods retain their individual fits. Additional trend/event checks and pooling are explicitly unavailable for those selections. Field testing is available wherever a fit has usable uncertainty.

## Regression and trend checks

For each source series we fit

\[
\log Y_{it}=a_i+g_i(t-2000)/10+f_i(N_{it})+\epsilon_{it}.
\]

We estimate the time and ENSO terms jointly. The choices for \(f_i(N)\) are \(\beta_iN\), \(\beta_iN+\delta_iN^2\), and \(\beta_iN+\delta_i\max(N,0)\). The neutral-relative response at exposure \(x\) is \(100[\exp(f_i(x))-1]\). A constant conversion of rice yields changes the intercept but leaves the relative ENSO response unchanged.

For every functional form we refit with an additional quadratic time term on exactly the same observations. The regional panel shows the response under that alternative trend at the selected scenario. The main curve retains the linear time trend. The check measures sensitivity to trend specification; neither specification identifies a causal effect by itself.

## Major-event omissions

We identify episodes from the frozen monthly Niño 3.4 record. An episode requires at least five consecutive trailing three-month means beyond +0.5°C or −0.5°C and a peak magnitude of at least 1.5°C. The bounds include all months contributing to those means. These rules define ten episodes for this dataset; they are separate from the official ONI classification. The dates and peaks are in [methods.json](global/data/2026-09-26-robust-v1/methods.json).

For each episode we remove every harvest whose assigned crop-season window overlaps the episode months. The years removed can differ across crop calendars. We refit the full model after each omission. Pooled fits also remove overlapping harvests from every member of the group. A refit requires 12 remaining observations, three positive and three negative exposures, and full design rank. A failed check stays unavailable. An episode outside the observed sample has no individual omission entry.

The panel lists the omitted harvest years, the response after omission and whether the scenario remains inside the observed exposure range. The omission fits are point-estimate diagnostics. We do not attach new confidence intervals to each omitted-event fit.

The **stable checks** filter requires every relevant omission and the quadratic-trend check to be estimable, no response-sign reversal, and a maximum change no larger than the greater of 5 percentage points and 50% of the selected response magnitude. This prespecified descriptive rule is separate from statistical significance and predictive skill. The filter can be applied to either estimator. A stable response can still be an extrapolation; the observed-range filter remains separate.

## Partial pooling

Within a state or province we first estimate a common ENSO coefficient vector using stacked observations and separate intercepts and time trends for every unit. We then use the fixed blend

\[
\theta_i^{pool}=0.5\hat\theta_i+0.5\hat\theta_{group}.
\]

The group includes the selected unit. The common vector is weighted by the information in the stacked regression. It is not a simple average of unit slopes. Each unit's intercept and trend are refit conditional on its blended ENSO coefficients.

We require at least three eligible units with the same source, source crop product, season and area basis. We retain the original requirement of 20 fitted years with at least five positive and five negative ENSO exposures. National records and units without an eligible geographic group remain unpooled. We never borrow across states, provinces or countries, or combine different source products. The panel names the group and its number of eligible units.

The 50% borrowing fraction is fixed before validation. We do not tune the fraction, select a winning model, or automatically replace an individual estimate. This release provides a transparent partial-pooling comparison. The upstream database also contains empirical-Bayes estimates; those estimates use different eligible samples and uncertainty calculations. We use only the upstream geographic crosswalk for grouping and refit on the exact frozen atlas observations. [Reconciliation files](global/data/2026-09-26-robust-v1/reconciliation/) record the differences in sample counts and endpoints. Matching endpoints alone does not prove that interior years match.

## Validation and uncertainty

We use two five-year holdout layouts, starting in 1980 and 1982, with a one-year embargo on each side. Every unit in a pooling group loses the held-out years and their neighboring years before we refit individual and common curves. Each comparison uses the same eligible test observations. We require at least three folds and 15 test observations per layout. Skill is one minus model squared error divided by the training-fitted trend-only model's squared error, in log-yield units. Positive skill means improvement over that trend-only prediction.

The comparison table reports these matched folds for both estimators. The original individual-fit diagnostics retain the original release's validation scores. The matched comparison may use fewer folds when a pooled training fit is unavailable. Better performance than the individual fit does not imply positive skill against the trend-only model.

We refit individual and common ENSO vectors in each of 400 shared three-calendar-year pairs-bootstrap draws, using the original release's fixed seed and block definition. Sharing the draws preserves common year shocks across regions. Uncertainty in the group curve enters the pooled coefficient covariance. At least 360 usable draws are required. Pointwise 95% normal intervals are formed in log response and transformed to percent. These intervals describe the fitted association; future-yield prediction would also require residual and scenario uncertainty.

## Field significance

For the selected scenario we form a two-sided normal p-value from the fitted log response divided by its bootstrap standard error. We apply Benjamini–Yekutieli adjustment at FDR 0.10, including its harmonic-number factor for dependence among tests.

The family includes every mapped, source-selected reporting unit worldwide with a finite response and p-value for the selected crop, source, season, area basis, resolution, period, index, exposure window, functional form, estimator and scenario. The family is formed before country zoom, coverage, evidence or observed-range filtering. Moving around the map therefore leaves the family and adjusted q values unchanged. National and regional records can coexist in the worldwide family according to the selected reporting layer. Adjustment does not cover searching across many scenarios or model specifications. Normal bootstrap p-values remain an approximation; the dependence adjustment does not repair a poorly calibrated marginal test.

The regional panel shows the pointwise p, adjusted q and family size. The field-significance filter colors only selected units. Confidence bands remain pointwise. The holdout-skill and stability filters answer separate questions.

## Validation results

The table uses linear ENSO fits and counts source series. Some units have more than one source series or season, so the counts are not independent geographic outcomes.

| Crop | Series checked | Pooled series with matched validation | Pooling improves both layouts | Positive skill in both: individual | Positive skill in both: pooled |
|---|---:|---:|---:|---:|---:|
| Wheat | 4,922 | 4,693 | 66.1% | 18.4% | 22.9% |
| Maize | 9,622 | 9,182 | 72.3% | 18.1% | 24.6% |
| Rice | 5,581 | 4,715 | 72.1% | 16.7% | 22.8% |
| Soybean | 3,506 | 3,222 | 72.9% | 19.8% | 24.8% |
| Sorghum | 1,264 | 1,150 | 70.4% | 19.1% | 25.0% |
| Cassava | 4,444 | 4,130 | 77.0% | 14.0% | 21.1% |

All percentages use the matched-validation column as denominator. Median skill remains negative for all six crops in both estimators and both layouts. Partial pooling reduces validation error in many series, while the trend-only prediction still performs better in most series. Quadratic and separate warm/cold fits are included in the [complete summary](global/data/2026-09-26-robust-v1/summary.json). We retain individual estimates as the default.

## Files and reproduction

The new release contains 88,017 checked individual model specifications and 81,276 pooled specifications. Compact crop bundles serve the map; country detail files contain trend fits, event omissions, group definitions and matched validation. Regional downloads include the full checks. The map CSV includes estimator, p, q, test-family size, stability and support. The [manifest](global/data/2026-09-26-robust-v1/manifest.json) hashes the new artifacts and records the inherited data manifest hash.

The frozen [merged-v1 page](https://phuybers3.github.io/enso-yield-atlas/global/merged-v1.html) keeps the preceding controls and estimates. Existing links that name `release=2026-09-26-merged-v1` redirect there. The earlier nine-country atlas remains at `archive.html`.

From the repository root, with Python, NumPy and pandas installed:

```sh
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1 python3 scripts/merged/robustness.py
OPENBLAS_NUM_THREADS=1 python3 scripts/merged/finalize_robustness.py
OPENBLAS_NUM_THREADS=1 python3 tests/robustness_numerics.py
npm test
```

The saved geographic crosswalk and upstream comparison snapshot make this rebuild independent of subsequent database changes. Rebuilding the original observations requires the inputs described in the merged-release methods. Each new individual point estimate and bootstrap covariance was checked against the original fit. Independent weighted least-squares tests verify the pooled calculations, shared uncertainty, exclusion of held-out years, cross-year harvest omissions and invariance to rice conversion. Release validation checks all records, finite coefficients, covariance matrices, compact/detail agreement and omitted-year membership.
