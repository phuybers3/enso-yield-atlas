# Preserved yield atlas, 26 September 2026

We preserved the atlas before adding temperature and precipitation. The annotated tag is [`yield-atlas-2026-09-26-v1`](https://github.com/phuybers3/enso-yield-atlas/releases/tag/yield-atlas-2026-09-26-v1), at commit `8f595a586377f06b037e8520ff3a8a058368f982`.

[Open the preserved yield atlas](https://phuybers3.github.io/enso-yield-atlas/global/) · [Download its exact source and data](https://github.com/phuybers3/enso-yield-atlas/archive/refs/tags/yield-atlas-2026-09-26-v1.zip).

This release includes Simple and Advanced modes, the merged agricultural data, ENSO responses, validation and robustness results, maps, regional overlays and time series. Its data releases are `2026-09-26-merged-v1` and `2026-09-26-robust-v1`. The tagged `SHA256SUMS.json` records the file hashes. The site-root explorer and previous atlas versions are also retained in the tagged repository.

We will keep `/global/` and its assets unchanged while developing the combined atlas at `/climate/`. New climate data and interface code will have their own versioned files. Restoring the preserved version requires checking out the tag; it does not require rerunning the analysis. We will not move or replace the tag.

The view open when preservation was requested used maize, 1981–2024, MEI.v2 in native units, the crop-season exposure, a quadratic individual fit, and a +1 MEI scenario in Advanced mode. [Restore that view](https://phuybers3.github.io/enso-yield-atlas/global/?v=20260926-simple1#/?mode=advanced&crop=maize&season=default&period=1981-2024&metric=enso&minimum=1&basis=default&release=2026-09-26-robust-v1&view=country&index=mei&window=season&scale=native&resolution=best&source=auto&model=quadratic&exposure=season&amplitude=1&peak=3&peakYear=2026&peakMonth=11&harvest=0&evidence=all&support=all&estimator=individual).
