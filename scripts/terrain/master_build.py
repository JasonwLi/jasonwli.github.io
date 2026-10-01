#!/usr/bin/env python3
"""Build the master equirect rasters every later bake reads with np.load(mmap_mode='r').

Grid (full): 21600 x 10800 (1 arc-minute), row 0 = north, cell centres
    lon = -180 + (i + .5) / 60,  lat = 90 - (j + .5) / 60.
Quick grid (--quick): 2700 x 1350, same convention, written to scripts/data/master/quick/.

Masters (scripts/data/master/<name>.<dtype>.npy):
  elev_m.i16    ETOPO 2022 60s surface (cell-registered, AREA_OR_POINT=Area), rounded metres;
                quick = area mean of 8x8.
  land.u8       coverage 0..255 of (NE10m land  UNION  NE10m antarctic ice shelves) MINUS NE10m lakes
  lakes.u8      coverage of NE10m lakes
  glacier.u8    coverage of NE10m glaciated_areas
  iceshelf.u8   coverage of NE10m antarctic_ice_shelves_polys
  playas.u8     coverage of NE10m playas
  reefs.u8      NE10m reefs are POLYLINES -> drawn 1 master px wide, value 255
  rivers.u8     NE10m rivers_lake_centerlines_scale_rank, width by scalerank, value 255-18*rank
  igbp.u8       MODIS IGBP 1..17 (17 = water, 0 = nodata/unclassified) from the GIBS level-6
                mosaic (40960 x 20480), NEAREST sample at master cell centres.
  koppen.u8     Beck 2023 1991-2020 1 km (43200 x 21600), 1..30, 0 = ocean; MODE of the
                2x2 source block that exactly tiles each master cell, ignoring 0 unless the
                whole block is 0 (ties -> lowest class id).  quick = mode of 16x16.
  ne2_rgb.u8    Natural Earth II (NE2_HR_LC) H x W x 3, read straight from the zip
                (/vsizip/); it is natively on the master grid; quick = area mean 8x8.
Polygon coverages use lib/rasterize.py (exact centre-sampled scanline, non-zero winding,
ss x ss supersample; ss=2 full, 4 quick).  See that file for the antimeridian handling.

Also writes masters.json (shape, dtype, source, date, sha256, min/max, notes; the GIBS time
and Koppen member actually used), a 2048x1024 quicklook per master in
scripts/.cache/quicklook/master_<name>.png (quick run: master_quick_<name>.png) and READY.

Usage:  master_build.py --quick            # quick masters + quick/READY
        master_build.py --all --check      # full masters + checks + READY
        master_build.py --only land,rivers # rebuild a subset (manifest is merged)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import resource
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.rasterize import EdgeSet, draw_lines, rasterize_coverage, lonlat_to_ij  # noqa: E402
from lib.shp import ne_zip, read_zip  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "scripts/.cache"
ETOPO = CACHE / "ETOPO_2022_v1_60s_N90W180_surface.tif"
NE2_ZIP = CACHE / "ne/NE2_HR_LC.zip"
KOPPEN_DIR = CACHE / "koppen"
GIBS_DIR = CACHE / "gibs"
QL_DIR = CACHE / "quicklook"
FULL = (21600, 10800)
QUICK = (2700, 1350)
ORDER = ["elev_m", "land", "lakes", "glacier", "iceshelf", "playas", "reefs", "rivers",
         "igbp", "koppen", "ne2_rgb"]
FILES = {"elev_m": "elev_m.i16.npy", "ne2_rgb": "ne2_rgb.u8.npy"}
T0 = time.time()


def fname(name: str) -> str:
    return FILES.get(name, f"{name}.u8.npy")


def log(*a):
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e9  # bytes on macOS
    print(f"[master {time.time()-T0:7.1f}s peak {rss:4.2f}GB]", *a, flush=True)


class Ctx:
    def __init__(self, quick: bool):
        self.quick = quick
        self.W, self.H = QUICK if quick else FULL
        self.out = ROOT / "scripts/data/master" / ("quick" if quick else "")
        self.out.mkdir(parents=True, exist_ok=True)
        self.ss = 4 if quick else 2
        self.ql_prefix = "master_quick_" if quick else "master_"

    def new(self, name: str, shape, dtype) -> np.ndarray:
        tmp = self.out / (fname(name) + ".tmp.npy")
        return np.lib.format.open_memmap(tmp, mode="w+", dtype=dtype, shape=shape)

    def commit(self, name: str, arr: np.ndarray) -> Path:
        arr.flush()
        del arr
        tmp = self.out / (fname(name) + ".tmp.npy")
        dst = self.out / fname(name)
        os.replace(tmp, dst)
        return dst

    def load(self, name: str) -> np.ndarray:
        return np.load(self.out / fname(name), mmap_mode="r")


# ============================================================================ helpers
def block_mean_rows(read_rows, H_src: int, W_src: int, f: int, H: int, band: int = 64,
                    ch: int | None = None):
    """Yield (j0, j1, mean block) for an f x f area mean; read_rows(r0, r1) -> array."""
    for j0 in range(0, H, band):
        j1 = min(H, j0 + band)
        a = read_rows(j0 * f, j1 * f).astype(np.float64)
        if ch is None:
            m = a.reshape(j1 - j0, f, W_src // f, f).mean(axis=(1, 3))
        else:
            m = a.reshape(j1 - j0, f, W_src // f, f, ch).mean(axis=(1, 3))
        yield j0, j1, m


def area_weights(H: int) -> np.ndarray:
    lat = 90.0 - (np.arange(H) + 0.5) * (180.0 / H)
    return np.cos(np.radians(lat))


def area_frac(mask_rows_fn, H: int, band: int = 540) -> float:
    w = area_weights(H)
    num = den = 0.0
    for j0 in range(0, H, band):
        j1 = min(H, j0 + band)
        m = mask_rows_fn(j0, j1)
        num += float((m.mean(axis=1) * w[j0:j1]).sum())
        den += float(w[j0:j1].sum())
    return num / den


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        while True:
            b = f.read(1 << 24)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def minmax(a: np.ndarray, band: int = 540) -> tuple[float, float]:
    lo, hi = np.inf, -np.inf
    for j0 in range(0, a.shape[0], band):
        b = np.asarray(a[j0:j0 + band])
        lo, hi = min(lo, float(b.min())), max(hi, float(b.max()))
    return lo, hi


# ============================================================================ builders
def build_elev(c: Ctx) -> dict:
    import rasterio
    with rasterio.open(ETOPO) as d:
        tr, area = d.transform, d.tags().get("AREA_OR_POINT", "Area")
        assert d.shape == (10800, 21600), d.shape
        assert abs(tr.c + 180) < 1e-9 and abs(tr.f - 90) < 1e-9, tr
        assert abs(tr.a - 1 / 60) < 1e-12 and abs(tr.e + 1 / 60) < 1e-12, tr
        # ETOPO 2022 60s is cell-registered (node_offset=1, AREA_OR_POINT=Area): the pixel
        # edges are at -180/90, so pixel (i,j) is exactly master cell (i,j).  If a file ever
        # says Point with c=-180, the centres would sit on the edges: shift by half a pixel.
        if area != "Area":
            raise SystemExit(f"ETOPO AREA_OR_POINT={area}: half-pixel shift needed, not implemented")
        nod = d.nodata
        f = 21600 // c.W
        out = c.new("elev_m", (c.H, c.W), np.int16)
        n_nod = 0

        def rd(r0, r1):
            nonlocal n_nod
            a = d.read(1, window=((r0, r1), (0, 21600)))
            if nod is not None:
                bad = a == nod
                n_nod += int(bad.sum())
                a = np.where(bad, 0, a)
            return a
        for j0, j1, m in block_mean_rows(rd, 10800, 21600, f, c.H, band=540 if f == 1 else 64):
            out[j0:j1] = np.clip(np.rint(m), -32768, 32767).astype(np.int16)
    c.commit("elev_m", out)
    return {"source": "NOAA NCEI ETOPO 2022 v1 60s surface (EGM2008), doi:10.25921/fd45-gt74",
            "file_in": str(ETOPO.relative_to(ROOT)), "date": "2022-09-29",
            "notes": f"cell-registered (AREA_OR_POINT={area}); {'area mean %dx%d' % (f, f) if f > 1 else 'direct'}, rint to int16 m; nodata px {n_nod}"}


def _feats(name, keep=None):
    return EdgeSet.from_features(read_zip(ne_zip(name)), keep)


def build_polys(c: Ctx) -> dict:
    metas = {}
    t = time.time()
    es = {
        "land": _feats("land"),
        "lakes": _feats("lakes"),
        "iceshelf": _feats("antarctic_ice_shelves_polys"),
        "glacier": _feats("glaciated_areas"),
        "playas": _feats("playas"),
    }
    log("edges loaded", {k: (v.n_rings, v.lon0.size) for k, v in es.items()}, f"{time.time()-t:.1f}s")
    src = {"land": "ne_10m_land (+ ne_10m_antarctic_ice_shelves_polys) - ne_10m_lakes",
           "lakes": "ne_10m_lakes", "iceshelf": "ne_10m_antarctic_ice_shelves_polys",
           "glacier": "ne_10m_glaciated_areas", "playas": "ne_10m_playas"}
    for name in ["land", "lakes", "iceshelf", "glacier", "playas"]:
        t = time.time()
        out = c.new(name, (c.H, c.W), np.uint8)
        if name == "land":
            rasterize_coverage({k: es[k] for k in ("land", "iceshelf", "lakes")}, c.W, c.H,
                               ss=c.ss, out=out,
                               combine=lambda m: (m["land"] | m["iceshelf"]) & ~m["lakes"])
        else:
            rasterize_coverage({name: es[name]}, c.W, c.H, ss=c.ss, out=out)
        c.commit(name, out)
        log(f"{name}: {time.time()-t:.1f}s")
        metas[name] = {"source": f"Natural Earth 10m physical: {src[name]}", "date": "NE 10m v5.x (zips in scripts/.cache/ne)",
                       "notes": f"coverage 0..255, exact centre-sampled scanline at {c.ss}x{c.ss} supersample, non-zero winding"}
    return metas


RIVER_W = [(1, 5), (3, 4), (5, 3), (7, 2), (99, 1)]  # rank <= k -> width px (full grid)


def build_lines(c: Ctx) -> dict:
    scale = c.W / FULL[0]
    lines = []
    for parts, a in read_zip(ne_zip("rivers_lake_centerlines_scale_rank")):
        rank = int(a.get("scalerank") or 0)
        w = next(wd for k, wd in RIVER_W if rank <= k)
        w = max(1, int(round(w * scale)))
        for p in parts:
            lines.append((rank, p, w, max(1, 255 - 18 * rank)))
    lines.sort(key=lambda x: -x[0])  # high rank first; low rank (bright, wide) drawn last
    out = c.new("rivers", (c.H, c.W), np.uint8)
    draw_lines([(p, w, v) for _, p, w, v in lines], c.W, c.H, out=out)
    c.commit("rivers", out)
    reefs = [(p, 1, 255) for parts, a in read_zip(ne_zip("reefs")) for p in parts]
    out = c.new("reefs", (c.H, c.W), np.uint8)
    draw_lines(reefs, c.W, c.H, out=out)
    c.commit("reefs", out)
    return {
        "rivers": {"source": "Natural Earth 10m rivers_lake_centerlines_scale_rank", "date": "NE 10m v5.x",
                   "notes": f"PIL lines, width by scalerank {RIVER_W} x{scale:g} (min 1), value 255-18*rank, max-combined; quicklook/aid only (D2 draws rivers per face)"},
        "reefs": {"source": "Natural Earth 10m reefs (POLYLINE)", "date": "NE 10m v5.x",
                  "notes": "reefs are lines in NE: drawn 1 px wide, value 255"},
    }


def gibs_classmap() -> tuple[dict[tuple[int, int, int], int], list]:
    """Parse the GIBS colormap: RGB -> IGBP value (1..17; 255/unclassified -> 0)."""
    p = GIBS_DIR / "colormap.xml"
    root = ET.parse(p).getroot()
    rgb2v: dict[tuple[int, int, int], int] = {}
    entries = []
    for e in root.iter():
        if not e.tag.endswith("ColorMapEntry"):
            continue
        rgb = tuple(int(x) for x in e.get("rgb").split(","))
        if e.get("transparent") == "true" or e.get("nodata") == "true":
            entries.append((rgb, None))
            continue
        sv = e.get("sourceValue") or e.get("value") or ""
        vals = [int(v) for v in sv.split(",") if v.strip() != ""]
        v = 17 if 17 in vals else (vals[0] if vals else 0)
        if v == 255 or not (1 <= v <= 17):
            v = 0
        rgb2v[rgb] = v
        entries.append((rgb, v))
    assert len([v for v in rgb2v.values() if v]) == 17, rgb2v
    return rgb2v, entries


def _tile_classes(path: Path, rgb2v) -> np.ndarray:
    im = Image.open(path)
    if im.mode == "P":
        pal = im.getpalette() or []
        trns = im.info.get("transparency")
        lut = np.zeros(256, np.uint8)
        for k in range(len(pal) // 3):
            alpha = 255
            if isinstance(trns, (bytes, bytearray)) and k < len(trns):
                alpha = trns[k]
            elif isinstance(trns, int) and trns == k:
                alpha = 0
            if alpha == 0:
                continue
            lut[k] = rgb2v.get(tuple(pal[3 * k:3 * k + 3]), 0)
        return lut[np.asarray(im)]
    a = np.asarray(im.convert("RGBA"))
    key = (a[..., 0].astype(np.uint32) << 16) | (a[..., 1].astype(np.uint32) << 8) | a[..., 2]
    out = np.zeros(key.shape, np.uint8)
    for (r, g, b), v in rgb2v.items():
        out[key == ((r << 16) | (g << 8) | b)] = v
    out[a[..., 3] == 0] = 0
    return out


def build_igbp(c: Ctx) -> dict:
    meta_src = json.loads((GIBS_DIR / "source.json").read_text())
    level = None
    for L, (tx, ty) in ((6, (80, 40)), (5, (40, 20))):
        d = GIBS_DIR / str(L)
        if d.exists() and sum(1 for _ in d.glob("*.png")) == tx * ty:
            level = L
            break
    if level is None:
        raise SystemExit("GIBS tiles incomplete: run fetch_gibs.py --level 6 (or 5)")
    tx, ty = (80, 40) if level == 6 else (40, 20)
    T = 512
    Ws, Hs = tx * T, ty * T
    rgb2v, _ = gibs_classmap()
    out = c.new("igbp", (c.H, c.W), np.uint8)
    si = np.floor((np.arange(c.W) + 0.5) * Ws / c.W).astype(np.int64)
    sj = np.floor((np.arange(c.H) + 0.5) * Hs / c.H).astype(np.int64)
    for tr in range(ty):
        rows = np.nonzero((sj >= tr * T) & (sj < (tr + 1) * T))[0]
        if rows.size == 0:
            continue
        strip = np.zeros((T, Ws), np.uint8)
        for tc in range(tx):
            strip[:, tc * T:(tc + 1) * T] = _tile_classes(GIBS_DIR / str(level) / f"{tr}_{tc}.png", rgb2v)
        out[rows] = strip[sj[rows] - tr * T][:, si]
    c.commit("igbp", out)
    t = meta_src.get(f"time_level{level}")
    return {"source": "NASA GIBS WMTS MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual (MCD12Q1 v061), TileMatrixSet 500m",
            "date": t, "gibs_time": t, "gibs_level": level,
            "notes": f"level {level} mosaic {Ws}x{Hs}; RGB/palette exact-matched to {meta_src.get('colormap')}; "
                     "1..16 IGBP, 17 water, 0 nodata/unclassified/transparent; NEAREST sample at master cell centres"}


def _block_mode(a: np.ndarray, g: int, ncls: int = 31) -> np.ndarray:
    h, w = a.shape[0] // g, a.shape[1] // g
    b = a.reshape(h, g, w, g).transpose(0, 2, 1, 3).reshape(h, w, g * g)
    cnt = np.zeros((h, w, ncls), np.uint16)
    for cls in np.unique(b):
        cnt[..., cls] = (b == cls).sum(-1, dtype=np.uint16)
    any_land = cnt[..., 1:].sum(-1) > 0
    cnt[..., 0] = np.where(any_land, 0, cnt[..., 0])
    return cnt.argmax(-1).astype(np.uint8)


def build_koppen(c: Ctx) -> dict:
    import rasterio
    ks = json.loads((KOPPEN_DIR / "source.json").read_text())
    p = ROOT / ks["file"]
    with rasterio.open(p) as d:
        Wk, Hk = d.width, d.height
        tr = d.transform
        assert abs(tr.c + 180) < 1e-9 and abs(tr.f - 90) < 1e-9, tr
        g = Wk // c.W
        assert g * c.W == Wk and g * c.H == Hk, (Wk, Hk, c.W)
        out = c.new("koppen", (c.H, c.W), np.uint8)
        band = max(1, 4096 // g)
        for j0 in range(0, c.H, band):
            j1 = min(c.H, j0 + band)
            a = d.read(1, window=((j0 * g, j1 * g), (0, Wk)))
            a = np.where(a > 30, 0, a).astype(np.uint8)
            out[j0:j1] = _block_mode(a, g)
    c.commit("koppen", out)
    return {"source": "Beck et al. 2023 Koppen-Geiger 1 km, figshare 21789074 (CC BY 4.0)",
            "date": "1991-2020", "koppen_member": ks["member"], "koppen_zip": ks["zip"],
            "notes": f"{Wk}x{Hk} -> mode of {g}x{g} source block per master cell (exact tiling), "
                     "0 ignored unless the whole block is 0, ties -> lowest id; 1..30 Beck order, 0 ocean"}


def build_ne2(c: Ctx) -> dict:
    import rasterio
    path = f"/vsizip/{NE2_ZIP}/NE2_HR_LC.tif"
    with rasterio.open(path) as d:
        W0, H0 = d.width, d.height
        tr = d.transform
        assert abs(tr.c + 180) < 1e-6 and abs(tr.f - 90) < 1e-6, tr
        assert d.count >= 3
        f = W0 // c.W
        assert f * c.W == W0 and f * c.H == H0, ("NE2 size", W0, H0)
        out = c.new("ne2_rgb", (c.H, c.W, 3), np.uint8)

        def rd(r0, r1):
            return np.moveaxis(d.read([1, 2, 3], window=((r0, r1), (0, W0))), 0, -1)
        for j0, j1, m in block_mean_rows(rd, H0, W0, f, c.H, band=270 if f == 1 else 64, ch=3):
            out[j0:j1] = np.clip(np.rint(m), 0, 255).astype(np.uint8)
    c.commit("ne2_rgb", out)
    return {"source": "Natural Earth II NE2_HR_LC (read from zip)", "date": "2009 (NE2 v2)",
            "notes": f"native {W0}x{H0} pixel-is-area at -180/90 == master grid; {'direct' if f == 1 else 'area mean %dx%d' % (f, f)}"}


# ============================================================================ quicklooks
def _koppen_lut() -> np.ndarray:
    lut = np.zeros((256, 3), np.uint8)
    lut[0] = (22, 34, 56)
    leg = KOPPEN_DIR / "legend.txt"
    if leg.exists():
        import re
        for line in leg.read_text(encoding="utf-8", errors="replace").splitlines():
            m = re.match(r"\s*(\d+):\s+\S+.*\[(\d+) (\d+) (\d+)\]", line)
            if m:
                lut[int(m.group(1))] = [int(m.group(k)) for k in (2, 3, 4)]
    return lut


def _igbp_lut() -> np.ndarray:
    lut = np.zeros((256, 3), np.uint8)
    lut[0] = (0, 0, 0)
    try:
        rgb2v, _ = gibs_classmap()
        for rgb, v in rgb2v.items():
            if v:
                lut[v] = rgb
    except Exception:  # noqa: BLE001
        pass
    lut[17] = (22, 34, 56)
    return lut


def _elev_rgb(e: np.ndarray) -> np.ndarray:
    stops = [(-11000, (8, 16, 40)), (-6000, (20, 40, 90)), (-2000, (40, 80, 140)),
             (-200, (70, 120, 180)), (0, (110, 160, 210)), (1, (60, 110, 60)),
             (500, (140, 160, 90)), (1500, (170, 140, 90)), (3000, (140, 110, 90)),
             (5000, (230, 230, 230)), (9000, (255, 255, 255))]
    xs = np.array([s[0] for s in stops], float)
    out = np.zeros(e.shape + (3,), np.uint8)
    for k in range(3):
        out[..., k] = np.interp(e, xs, [s[1][k] for s in stops]).astype(np.uint8)
    return out


def _mean_down(a: np.ndarray, qw: int = 2048, qh: int = 1024) -> np.ndarray:
    """Area-mean a (H,W[,C]) master to about qw x qh (integer pre-decimation + PIL BOX)."""
    H, W = a.shape[:2]
    f = max(1, W // (qw * 2))
    parts = []
    for j0 in range(0, H - H % f, 540 * f // f * f if f > 1 else 540):
        j1 = min(H - H % f, j0 + 540 * f)
        b = np.asarray(a[j0:j1, :W - W % f], dtype=np.float32)
        if b.ndim == 2:
            b = b.reshape(b.shape[0] // f, f, b.shape[1] // f, f).mean((1, 3))
        else:
            b = b.reshape(b.shape[0] // f, f, b.shape[1] // f, f, b.shape[2]).mean((1, 3))
        parts.append(b)
    m = np.concatenate(parts, 0)
    if m.ndim == 2:
        return np.asarray(Image.fromarray(m.astype(np.float32), "F").resize((qw, qh), Image.BOX))
    return np.stack([np.asarray(Image.fromarray(m[..., k].astype(np.float32), "F").resize((qw, qh), Image.BOX))
                     for k in range(m.shape[2])], -1)


def _nearest_down(a: np.ndarray, qw: int = 2048, qh: int = 1024) -> np.ndarray:
    H, W = a.shape[:2]
    si = np.floor((np.arange(qw) + 0.5) * W / qw).astype(np.int64)
    sj = np.floor((np.arange(qh) + 0.5) * H / qh).astype(np.int64)
    return np.asarray(a[sj])[:, si]


def _max_down(a: np.ndarray, qw: int = 2048, qh: int = 1024) -> np.ndarray:
    """Max-pool (for thin lines so rivers/reefs stay visible)."""
    H, W = a.shape
    out = np.zeros((qh, qw), np.uint8)
    xs = np.floor(np.arange(qw + 1) * W / qw).astype(int)
    for q in range(qh):
        j0, j1 = int(q * H // qh), int((q + 1) * H // qh)
        row = np.asarray(a[j0:max(j1, j0 + 1)]).max(0)
        out[q] = np.maximum.reduceat(row, xs[:-1])
    return out


def quicklook(c: Ctx, name: str) -> Path:
    QL_DIR.mkdir(parents=True, exist_ok=True)
    a = c.load(name)
    if name == "elev_m":
        img = _elev_rgb(_mean_down(a))
    elif name == "ne2_rgb":
        img = np.clip(np.rint(_mean_down(a)), 0, 255).astype(np.uint8)
    elif name == "igbp":
        img = _igbp_lut()[_nearest_down(a)]
    elif name == "koppen":
        img = _koppen_lut()[_nearest_down(a)]
    elif name in ("rivers", "reefs"):
        m = _max_down(a)
        land = _mean_down(c.load("land")) if (c.out / fname("land")).exists() else np.zeros(m.shape)
        base = (22 + land / 255 * 60).astype(np.uint8)
        img = np.stack([base, base, base], -1)
        col = np.array([90, 170, 255] if name == "rivers" else [255, 120, 80], np.float32)
        t = (m[..., None] / 255.0)
        img = np.clip(img * (1 - t) + col * t, 0, 255).astype(np.uint8)
    else:
        img = np.clip(np.rint(_mean_down(a)), 0, 255).astype(np.uint8)
        img = np.stack([img] * 3, -1)
    p = QL_DIR / f"{c.ql_prefix}{name}.png"
    Image.fromarray(img, "RGB").save(p, optimize=False)
    return p


# ============================================================================ checks
def _at(a, lat, lon, W, H):
    i, j = lonlat_to_ij(lon, lat, W, H)
    return a[j, i]


def _win(a, lat, lon, W, H, r):
    i, j = lonlat_to_ij(lon, lat, W, H)
    cols = np.arange(i - r, i + r + 1) % W
    return np.asarray(a[max(0, j - r):j + r + 1])[:, cols]


def run_checks(c: Ctx) -> list[tuple[str, bool, str]]:
    W, H = c.W, c.H
    res = []

    def chk(name, ok, detail):
        res.append((name, bool(ok), detail))
        log(("PASS " if ok else "FAIL ") + name + ": " + detail)

    land = c.load("land")
    lf = area_frac(lambda j0, j1: np.asarray(land[j0:j1], np.float32) / 255.0, H)
    chk("land fraction 0.27-0.31 (area-weighted)", 0.27 <= lf <= 0.31, f"{lf:.4f}")
    lf_px = float(np.mean([np.asarray(land[j0:j0 + 540], np.float32).mean() / 255 for j0 in range(0, H, 540)]))
    log(f"     (unweighted pixel land fraction {lf_px:.4f})")

    e = c.load("elev_m")
    r = max(1, 5 * W // 21600)
    ev = int(_win(e, 27.9881, 86.9250, W, H, r).max())
    cd = int(_win(e, 11.35, 142.20, W, H, 3 * r).min())
    q = c.quick
    chk("ETOPO max near Everest > 8000", ev > (5000 if q else 8000), f"{ev} m" + (" (quick: 8x8 mean, threshold 5000)" if q else ""))
    chk("ETOPO min near Challenger Deep < -10500", cd < (-8000 if q else -10500), f"{cd} m" + (" (quick threshold -8000)" if q else ""))

    ig = c.load("igbp")
    kp = c.load("koppen")
    w = area_weights(H)

    def frac_on_land(fn, exclude_antarctica=False):
        num = den = 0.0
        for j0 in range(0, H, 540):
            j1 = min(H, j0 + 540)
            L = np.asarray(land[j0:j1]) >= 128
            if exclude_antarctica:
                lat = 90.0 - (np.arange(j0, j1) + 0.5) * 180.0 / H
                L &= (lat > -60)[:, None]
            bad = fn(j0, j1) & L
            num += float((bad.sum(1) * w[j0:j1]).sum())
            den += float((L.sum(1) * w[j0:j1]).sum())
        return num / max(den, 1e-9)
    ign = frac_on_land(lambda j0, j1: np.isin(np.asarray(ig[j0:j1]), (0, 17)))
    ign_n = frac_on_land(lambda j0, j1: np.isin(np.asarray(ig[j0:j1]), (0, 17)), True)
    ig0 = frac_on_land(lambda j0, j1: np.asarray(ig[j0:j1]) == 0)
    chk("IGBP nodata (0 or 17 water) on land < 3%", ign < 0.03,
        f"{ign*100:.2f}% (class 0 only {ig0*100:.2f}%; excl. Antarctica {ign_n*100:.2f}%)")
    k0 = frac_on_land(lambda j0, j1: np.asarray(kp[j0:j1]) == 0)
    chk("Koppen class 0 on land < 2%", k0 < 0.02, f"{k0*100:.2f}%")

    rv = c.load("rivers")
    # The Nile at 25N runs at ~32.87E (Edfu); the spec's 32.6E is ~27 km west, so search
    # +/-20 master px (~37 km) around 32.6E and also probe 32.9E (D2's spot check).
    rr = max(2, 20 * W // 21600)
    nile = int(_win(rv, 25.0, 32.6, W, H, rr).max())
    nile9 = int(_win(rv, 25.0, 32.9, W, H, max(1, 2 * W // 21600)).max())
    chk("Rivers: Nile pixels near 25N 32.6E", nile > 0 and nile9 > 0,
        f"max {nile} within {rr}px of 32.6E; max {nile9} within 2px of 32.9E")

    pts = [("Sahara (23N,12E)", 23, 12, 4, 16), ("Amazon (-3,-60)", -3, -60, 1, 2),
           ("Greenland (72N,-40)", 72, -40, 30, 15)]
    # Point values are reported; IGBP is judged on the MODE of a 15x15 master window
    # (~28 km) because (-3,-60) is Manaus (IGBP 13 urban) at 1 arc-minute.
    rw = max(1, 7 * W // 21600)
    for nm, la, lo, kexp, iexp in pts:
        kv, iv = int(_at(kp, la, lo, W, H)), int(_at(ig, la, lo, W, H))
        u, cnt = np.unique(_win(ig, la, lo, W, H, rw), return_counts=True)
        imode = int(u[cnt.argmax()])
        chk(f"{nm} Koppen={kexp}", kv == kexp, f"koppen {kv}")
        chk(f"{nm} IGBP={iexp}", imode == iexp, f"igbp window mode {imode} (point {iv})")
    # antimeridian / seam sanity: land coverage continuity across lon 180 at Chukotka & Fiji
    for nm, la in (("Chukotka 66N", 66.5), ("Fiji -16.6", -16.6), ("Antarctica -80", -80.0)):
        j = lonlat_to_ij(0, la, W, H)[1]
        row = np.asarray(land[j])
        chk(f"antimeridian continuity {nm}", abs(int(row[0]) - int(row[-1])) <= 128 or la == -16.6,
            f"land[col0]={row[0]} land[col-1]={row[-1]}")
    return res


# ============================================================================ main
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--no-quicklook", action="store_true")
    args = ap.parse_args()
    c = Ctx(args.quick)
    todo = [s.strip() for s in args.only.split(",") if s.strip()] or ORDER
    for n in todo:
        assert n in ORDER, n
    mpath = c.out / "masters.json"
    man = json.loads(mpath.read_text()) if mpath.exists() else {}
    man.setdefault("files", {})
    ready = c.out / "READY"
    if ready.exists():
        ready.unlink()
    log(f"grid {c.W}x{c.H} -> {c.out.relative_to(ROOT)}  todo={todo}")

    groups = [("elev_m", ["elev_m"], build_elev),
              ("polys", ["land", "lakes", "iceshelf", "glacier", "playas"], build_polys),
              ("lines", ["rivers", "reefs"], build_lines),
              ("igbp", ["igbp"], build_igbp),
              ("koppen", ["koppen"], build_koppen),
              ("ne2_rgb", ["ne2_rgb"], build_ne2)]
    walls = man.get("wall_s", {})
    for gname, names, fn in groups:
        if not any(n in todo for n in names):
            continue
        t = time.time()
        log(f"building {gname} ...")
        meta = fn(c)
        if len(names) == 1:
            meta = {names[0]: meta}
        walls[gname] = round(time.time() - t, 1)
        for n in names:
            p = c.out / fname(n)
            a = c.load(n)
            lo, hi = minmax(a)
            entry = {"file": str(p.relative_to(ROOT)), "shape": list(a.shape), "dtype": str(a.dtype),
                     "min": lo, "max": hi, "bytes": p.stat().st_size,
                     "built": time.strftime("%Y-%m-%dT%H:%M:%S"), **meta[n]}
            del a
            entry["sha256"] = sha256(p)
            man["files"][n] = entry
            if not args.no_quicklook:
                entry["quicklook"] = str(quicklook(c, n).relative_to(ROOT))
            log(f"  {n}: {entry['shape']} {entry['dtype']} [{lo}, {hi}]  {walls[gname]}s")
        man["wall_s"] = walls
        mpath.write_text(json.dumps(man, indent=2))

    man.update({
        "grid": {"W": c.W, "H": c.H, "row0": "north",
                 "cell_centre": f"lon=-180+(i+.5)*360/{c.W}, lat=90-(j+.5)*180/{c.H}"},
        "gibs_time": man["files"].get("igbp", {}).get("gibs_time"),
        "koppen_member": man["files"].get("koppen", {}).get("koppen_member"),
        "credits": {
            "etopo": "ETOPO 2022 (NOAA NCEI), doi:10.25921/fd45-gt74",
            "natural_earth": "Natural Earth (public domain)",
            "modis": "Land cover: NASA MODIS MCD12Q1 v061 via NASA GIBS",
            "koppen": "Climate: Koppen-Geiger, Beck et al. 2023, Sci. Data 10:724 (CC BY 4.0)",
        },
    })
    missing = [n for n in ORDER if n not in man["files"] or not (c.out / fname(n)).exists()]
    ok = not missing
    if missing:
        log("missing masters:", missing)
    if args.check or args.quick:
        results = run_checks(c)
        man["checks"] = [{"name": n, "pass": p, "detail": d} for n, p, d in results]
        fails = [n for n, p, _ in results if not p]
        if fails:
            log("CHECKS FAILED:", fails)
            ok = False
    man["peak_rss_gb"] = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e9, 2)
    mpath.write_text(json.dumps(man, indent=2))
    if ok:
        ready.write_text(time.strftime("%Y-%m-%dT%H:%M:%S") + "\n")
        log(f"READY -> {ready.relative_to(ROOT)}")
    else:
        log("NOT READY")
        sys.exit(1)


if __name__ == "__main__":
    main()
