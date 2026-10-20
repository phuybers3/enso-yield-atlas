"""Raster masks of cropped land per crop family for the atlas's "Cropped land only" box (11 October 2026).

From the 0.05 degree harvested-area maps of CROPGRIDS v1.08 (Tang et al. 2024; ENSO/data/raw/cropgrids, read through
data/pipelines/cropgrids.py) this script writes, per crop family, under site/data/static/cropgrids:

  mask/<family>/{z}/{x}/{y}.png   XYZ tiles in Web Mercator for zoom levels 0 to 6: a pixel is opaque paper (#fbfaf7)
                                  where the land under it has a harvested share of THRESHOLD or less, and transparent
                                  where the share is above THRESHOLD or the pixel is sea. The share at a zoom level is
                                  harvested area over land area aggregated to about the pixel's size (blocks of 2^k
                                  fine cells, k by zoom), so a coarse pixel on a zoomed-out map counts as cropped when
                                  its aggregate passes the threshold. Tiles with no opaque pixel are not written.
  world/<family>.png              one RGBA image in the world map's Equal Earth plane (the box between 130 W and
                                  180 E, 57 S and 65 N of the atlas), the inverse projection applied pixel by pixel,
                                  which the site pins to the corners of the box.

The site draws the mask above the unit fills and below the outlines when the box is ticked, so the colours of any
layer show only where the crop is grown. CROPGRIDS marks the sea as -1, which is the land mask here. manifest.json
records the threshold, the counts and the sha256 of the source maps. The tile set is static and shared by every
release. The share-ramp tiles of the "Cropped area" layer of 11 October (morning) are removed.

    python scripts/build_crop_tiles.py [--max-zoom 6] [--families maize,rice] [--threshold 0.05]
"""
from __future__ import annotations

# Locate the checkout independently of the working directory or machine.
from pathlib import Path as _ProjectPath
import sys as _project_sys
_ENSO_ROOT = next(p for p in _ProjectPath(__file__).resolve().parents if (p / "project.toml").is_file())
if str(_ENSO_ROOT) not in _project_sys.path:
    _project_sys.path.append(str(_ENSO_ROOT))
from enso_project import path as _project_path, resolve_path as _resolve_path
from enso_project import load_record as _load_record, loads_record as _loads_record


import argparse
import hashlib
import json
import math
import shutil
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

ATLAS = Path(__file__).resolve().parents[1]
ENSO = next((p for p in ATLAS.parents if (p / "project.toml").is_file()), ATLAS.parent)
sys.path.insert(0, str(ENSO / "data/pipelines"))
import cropgrids as cg  # noqa: E402

OUT = ATLAS / "site" / "data" / "static" / "cropgrids"
TILE = 256
PAPER = (251, 250, 247)                       # the page's --paper
ZOOM_FACTOR = {0: 16, 1: 16, 2: 8, 3: 4, 4: 2, 5: 1, 6: 1}   # fine cells per side aggregated at each zoom
WORLD_LON, WORLD_LAT = (-130.0, 180.0), (-57.0, 65.0)         # the atlas's world box (site/app.js)
WORLD_W = 2400                                               # pixels across the world image; the height follows the box
EE = dict(A1=1.340264, A2=-0.081106, A3=0.000893, A4=0.003796, M=math.sqrt(3) / 2)


def tile_latlon(z, x, y):
    """Latitude and longitude of the pixel centres of tile (z, x, y) in the XYZ scheme."""
    n = 2 ** z
    px = (np.arange(TILE) + 0.5) / TILE
    lon = (x + px) / n * 360.0 - 180.0
    yv = (y + px) / n
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * yv))))
    return lat, lon


def equal_earth_y(lat_deg):
    t = math.asin(EE["M"] * math.sin(math.radians(lat_deg))); t2 = t * t; t6 = t2 ** 3
    return t * (EE["A1"] + EE["A2"] * t2 + t6 * (EE["A3"] + EE["A4"] * t2))


def equal_earth_xmax():
    return (2 * math.sqrt(3) / 3) * math.pi / EE["A1"]   # x of (180 E, 0 N): cos(0) = 1, theta = 0


def equal_earth_inverse(X, Y):
    """Longitude and latitude in degrees of Equal Earth plane coordinates (vectorized Newton on the parametric latitude)."""
    A1, A2, A3, A4, M = EE["A1"], EE["A2"], EE["A3"], EE["A4"], EE["M"]
    t = Y / A1
    for _ in range(12):
        t2 = t * t; t6 = t2 ** 3
        f = t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2)) - Y
        df = A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)
        t = t - f / df
    t2 = t * t; t6 = t2 ** 3
    lam = X * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)) / ((2 * math.sqrt(3) / 3) * np.cos(t))
    with np.errstate(invalid="ignore"):
        phi = np.arcsin(np.clip(np.sin(t) / M, -1, 1))
    return np.degrees(lam), np.degrees(phi), np.abs(lam) <= math.pi + 1e-9


def classes(harv, area, land, factor, threshold):
    """0 sea, 1 land at or below the threshold, 2 land above it, on the grid aggregated by factor cells per side."""
    ny, nx = harv.shape
    H = harv.reshape(ny // factor, factor, nx // factor, factor).sum(axis=(1, 3))
    A = (area * land).reshape(ny // factor, factor, nx // factor, factor).sum(axis=(1, 3))
    with np.errstate(invalid="ignore", divide="ignore"):
        share = np.where(A > 0, H / A, np.nan)
    cls = np.zeros(share.shape, dtype=np.uint8); cls[A > 0] = 1; cls[(A > 0) & (share > threshold)] = 2
    return cls


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-zoom", type=int, default=6); ap.add_argument("--families", default=",".join(cg.FAMILIES)); ap.add_argument("--threshold", type=float, default=0.05)
    a = ap.parse_args(); t0 = time.time()
    res, lon0, lat0, nx, ny, _ = cg.FINE
    lat_c = lat0 - (np.arange(ny) + 0.5) * res
    area = np.repeat(cg.cell_area_ha(lat_c)[:, None], nx, axis=1).astype("float64")
    palette = [0, 0, 0] + list(PAPER) + [0, 0, 0]; transparency = bytes([0, 255, 0])
    # the world image's plane: x linear in Equal Earth x, y linear in Equal Earth y, between the box's bounds
    xmax = equal_earth_xmax(); X0, X1 = WORLD_LON[0] / 180.0 * xmax, WORLD_LON[1] / 180.0 * xmax; Y0, Y1 = equal_earth_y(WORLD_LAT[0]), equal_earth_y(WORLD_LAT[1])
    world_h = int(round(WORLD_W * (Y1 - Y0) / (X1 - X0)))
    Xs = X0 + (np.arange(WORLD_W) + 0.5) / WORLD_W * (X1 - X0); Ys = Y1 - (np.arange(world_h) + 0.5) / world_h * (Y1 - Y0)
    lon_w, lat_w, inside = equal_earth_inverse(Xs[None, :].repeat(world_h, axis=0), Ys[:, None].repeat(WORLD_W, axis=1))
    manifest = dict(source="CROPGRIDS v1.08 harvested area (Tang et al. 2024, Scientific Data 11, 413; figshare 22491997 v9, CC BY 4.0)",
                    quantity=f"cropped-land mask: opaque paper where the harvested share of the land under a pixel (harvested area over land area, aggregated to about the pixel's size) is at or below {a.threshold:g}; transparent above it and over the sea (CROPGRIDS -1)",
                    threshold=a.threshold, paper="#fbfaf7", tile_size=TILE, zoom=[0, a.max_zoom], zoom_factor=ZOOM_FACTOR, world=dict(width=WORLD_W, height=world_h, lon=WORLD_LON, lat=WORLD_LAT, projection="Equal Earth plane of site/app.js"),
                    families={}, source_sha256={})
    for fam in a.families.split(","):
        tf = time.time()
        # cropgrids.harvested_area() returns zero at sea; the raw map carries -1 there, which is the land mask here
        import xarray as xr
        with xr.open_dataset(cg.FILE[fam]) as ds:
            raw = ds["harvarea"].values.astype("float64"); lat_file = ds.lat.values
        if lat_file[0] < lat_file[-1]:
            raw = raw[::-1]              # the file runs south to north; row 0 is the north here (found flipped, 11 October 2026)
        assert raw.shape == (ny, nx), raw.shape
        land = raw >= 0; harv = np.where(land, raw, 0.0); del raw
        if (OUT / fam).exists():
            shutil.rmtree(OUT / fam)            # the share-ramp tiles of the morning's layer
        if (OUT / "mask" / fam).exists():
            shutil.rmtree(OUT / "mask" / fam)
        cls = {f: classes(harv, area, land, f, a.threshold) for f in sorted(set(ZOOM_FACTOR.values()))}
        count = 0; bytes_total = 0
        for z in range(0, a.max_zoom + 1):
            f = ZOOM_FACTOR[z]; C = cls[f]; n = 2 ** z; r_ = res * f
            for x in range(n):
                for y in range(n):
                    lat, lon = tile_latlon(z, x, y)
                    r = np.clip(np.floor((lat0 - lat) / r_).astype(int), 0, C.shape[0] - 1); c = np.mod(np.floor((lon - lon0) / r_).astype(int), C.shape[1])
                    img = C[r[:, None], c[None, :]]
                    if not (img == 1).any():
                        continue
                    im = Image.fromarray(img, mode="P"); im.putpalette(palette)
                    p = OUT / "mask" / fam / str(z) / str(x); p.mkdir(parents=True, exist_ok=True)
                    fpath = p / f"{y}.png"; im.save(fpath, optimize=True, transparency=transparency); count += 1; bytes_total += fpath.stat().st_size
        # the world image at the 0.1 degree aggregation (a pixel of the 2,400-wide image spans about 0.13 degree)
        C = cls[2]; r = np.clip(np.floor((lat0 - lat_w) / (res * 2)).astype(int), 0, C.shape[0] - 1); c = np.mod(np.floor((lon_w - lon0) / (res * 2)).astype(int), C.shape[1])
        img = C[r, c]; rgba = np.zeros((world_h, WORLD_W, 4), dtype=np.uint8); opaque = (img == 1) & inside
        rgba[opaque, :3] = PAPER; rgba[opaque, 3] = 255
        (OUT / "world").mkdir(parents=True, exist_ok=True); wpath = OUT / "world" / f"{fam}.png"; Image.fromarray(rgba, mode="RGBA").save(wpath, optimize=True)
        if fam == "maize":
            def px(lon, lat):
                l, f = math.radians(lon), math.radians(lat); t = math.asin(EE["M"] * math.sin(f)); t2 = t * t; t6 = t2 ** 3
                X = (2 * math.sqrt(3) / 3) * l * math.cos(t) / (EE["A1"] + 3 * EE["A2"] * t2 + t6 * (7 * EE["A3"] + 9 * EE["A4"] * t2)); Y = t * (EE["A1"] + EE["A2"] * t2 + t6 * (EE["A3"] + EE["A4"] * t2))
                return rgba[int((Y1 - Y) / (Y1 - Y0) * world_h), int((X - X0) / (X1 - X0) * WORLD_W), 3]
            assert px(10, 25) == 255 and px(-60, -5) == 255 and px(-93, 42) == 0 and px(0, -50) == 0, "world image orientation: Sahara and Amazon opaque, Iowa and the Southern Ocean transparent"
            # tile 4/3/5 spans 112.5 W to 90 W and 41 N to 55.8 N: Iowa's maize is cropped, Montana's plains are not
            lat_t, lon_t = tile_latlon(4, 3, 5); rr = np.clip(np.floor((lat0 - lat_t) / (res * ZOOM_FACTOR[4])).astype(int), 0, cls[2].shape[0] - 1); cc = np.mod(np.floor((lon_t - lon0) / (res * ZOOM_FACTOR[4])).astype(int), cls[2].shape[1])
            t = cls[2][rr[:, None], cc[None, :]]; iowa = t[np.abs(lat_t - 42).argmin(), np.abs(lon_t + 93).argmin()]; montana = t[np.abs(lat_t - 47).argmin(), np.abs(lon_t + 109).argmin()]
            assert iowa == 2 and montana == 1 and (t == 2).mean() > 0.1 and (t == 1).mean() > 0.1, f"tile 4/3/5 orientation: Iowa {iowa}, Montana {montana}"
        h = hashlib.sha256(open(cg.FILE[fam], "rb").read()).hexdigest()
        manifest["families"][fam] = dict(tiles=count, bytes=bytes_total, world_bytes=wpath.stat().st_size, land_cells=int(land.sum()), cropped_cells=int((cls[1] == 2).sum())); manifest["source_sha256"][fam] = h
        print(f"{fam}: {count:,} tiles, {bytes_total/1e6:.1f} MB; world image {wpath.stat().st_size/1e3:.0f} kB; {int((cls[1] == 2).sum()):,} of {int(land.sum()):,} land cells above {a.threshold:g}; {time.time()-tf:.0f}s", flush=True)
    manifest["built"] = time.strftime("%Y-%m-%d")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")
    print(f"done in {time.time()-t0:.0f}s: {OUT}")


if __name__ == "__main__":
    main()
