"""D2: lossless physical data layers (cube faces + equirects) and the CPU height grid.

Outputs (scripts/data/bake/physical/, or .../physical/quick/ with --quick):
  cube/terrain_1024_{face}.png   R height sqrt/9000 (land), G bathy sqrt/11000 (ocean), B coast SDF (+land, +-128 km)
  cube/hydro_1024_{face}.png     R river band 1-d/24 km, G lake SDF (+water, +-64 km), B snow potential
  cube/heightHi_2048_{face}.png  height (R encoding) gray-in-RGB
  cube/koppenIdx_{512,1024}_{face}.png  class*8 gray-in-RGB (mode resample, 0 = ocean)
  eq/lowdata_{2048x1024,1024x512}.png   R coast SDF, G bathy, B snow
  eq/height_2048x1024.u16 (+ .png quicklook)  uint16 LE metres, land >= 0, ocean 0
  fill/koppen_filled.u8.npy      Köppen with 0-on-land nearest-filled (full masters only)
Quicklooks: scripts/.cache/quicklook/phys_<layer>.png (equirect reprojections of the cubes).

Rules: GL cube table (lib/cube.py), faces row 0 = top; equirect row 0 = north, cell centres;
lossless 8-bit RGB PNG, no alpha / colour chunks (lib/io.save_png_rgb).

Snow (hydro.B): the plan's Köppen/elevation potential for the SEASONAL range, capped at 0.90,
and max()'d with the PERMANENT term from BRIEF §2: max(glacier/ice shelf, snowline(lat)
smoothstep +-400 m). So hydro.B >= 0.95 means exactly "permanent snow per the brief".

Usage (always through the machine lock):
  ~/dev/dw3-lock scripts/terrain/.venv/bin/python scripts/terrain/bake_physical.py --quick
  ~/dev/dw3-lock scripts/terrain/.venv/bin/python scripts/terrain/bake_physical.py --all --check
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.cube import FACES, dirs_to_latlon as dirs_to_latlon_, dirs_to_face_uv, face_uv_to_texel, latlon_to_dirs, st_to_dirs, texel_st  # noqa: E402
from lib.equirect import equirect_latlon, sample  # noqa: E402
from lib.faces import (  # noqa: E402
    area_face, box_reduce, crop, cube_to_equirect, equirect_signed_distance_km, face_band_dirs,
    face_distance_km, face_signed_distance_km, face_texel_arc_km, fill_nearest_equirect, mode_reduce,
    sample_face, seam_report, R_KM,
)
from lib.io import gray_to_rgb, load_master, load_rgb, save_png_rgb, to_u8  # noqa: E402
from lib.sdf import (  # noqa: E402
    COAST_HALF_KM, LAKE_HALF_KM, RIVER_BAND_KM, dec_bathy, dec_height, dec_sdf, enc_bathy, enc_height, enc_sdf,
)

ROOT = Path(__file__).resolve().parents[2]
NE_DIR = ROOT / "scripts" / ".cache" / "ne"
QL_DIR = ROOT / "scripts" / ".cache" / "quicklook"

# ----------------------------------------------------------------------------- config


class Cfg:
    def __init__(self, quick: bool):
        self.quick = quick
        base = ROOT / "scripts" / "data" / "bake" / "physical"
        self.out = base / "quick" if quick else base
        self.N = 256 if quick else 1024  # terrain / hydro
        self.NHI = 256 if quick else 2048  # heightHi
        self.NK = (64, 128) if quick else (512, 1024)  # koppenIdx (small, large)
        self.SS = 4
        self.PAD4 = 96  # SDF padding in 4N sub-texels (>= 128 km at the face corners)
        self.EQ_FINE = (2048, 1024) if quick else (8192, 4096)
        self.EQ_OUT = ((512, 256), (256, 128)) if quick else ((2048, 1024), (1024, 512))
        self.HGRID = (512, 256) if quick else (2048, 1024)
        self.QL = (1024, 512) if quick else (2048, 1024)

    def ql(self, name: str) -> Path:
        return QL_DIR / (f"phys_quick_{name}.png" if self.quick else f"phys_{name}.png")


# ----------------------------------------------------------------------------- masters


class Masters:
    def __init__(self, cfg: Cfg):
        q = cfg.quick
        self.elev = load_master("elev_m.i16", q)
        self.land = load_master("land.u8", q)
        self.lakes = load_master("lakes.u8", q)
        self.glacier = load_master("glacier.u8", q)
        self.iceshelf = load_master("iceshelf.u8", q)
        self.koppen = self._koppen_filled(cfg)

    def _koppen_filled(self, cfg: Cfg) -> np.ndarray:
        """Köppen with 0 on land (incl. lakes) replaced by the nearest valid class (HANDOFF D1)."""
        path = cfg.out / "fill" / "koppen_filled.u8.npy"
        if path.exists():
            return np.load(path, mmap_mode="r")
        k = load_master("koppen.u8", cfg.quick)
        t = time.time()
        # land-with-lakes in bands to keep memory small
        h = k.shape[0]
        inv = np.empty(k.shape, bool)
        for r0 in range(0, h, 1350):
            r1 = min(h, r0 + 1350)
            lwl = np.maximum(np.asarray(self.land[r0:r1]), np.asarray(self.lakes[r0:r1])) >= 128
            inv[r0:r1] = lwl & (np.asarray(k[r0:r1]) == 0)
        n_inv = int(inv.sum())
        # sources = any non-zero Köppen; EDT input "invalid" = Köppen == 0 (ocean or gap)
        zero = np.empty(k.shape, bool)
        for r0 in range(0, h, 1350):
            r1 = min(h, r0 + 1350)
            zero[r0:r1] = np.asarray(k[r0:r1]) == 0
        filled = np.array(k, copy=True)
        # fill only the land gaps: run the nearest-valid search over the zero mask, keep land gaps
        near = fill_nearest_equirect(k, zero, band=1350 if not cfg.quick else 338, margin=160 if not cfg.quick else 40)
        filled[inv] = near[inv]
        del near, zero
        left = int((inv & (filled == 0)).sum())
        print(f"  koppen fill: {n_inv} land px had class 0 -> {left} left ({time.time() - t:.0f}s)")
        path.parent.mkdir(parents=True, exist_ok=True)
        np.save(path, filled)
        del inv
        return np.load(path, mmap_mode="r")


# ----------------------------------------------------------------------------- snow


def snowline_m(abs_lat: np.ndarray) -> np.ndarray:
    """Permanent snowline. BRIEF §2 (5.0 km at 0-25°, 5.2 at 30°, 3.0 at 45°, 1.5 at 60°, 0.4 at 70°,
    0 from 75°) with the dry-subtropical hump raised to the observed ~5.8 km at 30° (Tibet/Andes
    puna): with 5.2 km the whole ~5 km Tibetan plateau baked as permanent ice (D3 review)."""
    return np.interp(abs_lat, [0, 20, 30, 36, 45, 60, 70, 75, 90], [5000, 5300, 5800, 5400, 3000, 1500, 400, 0, 0])


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# Köppen base snow potential (plan D2 hydro.B), index 0..30 (Beck 2023 class order)
KOPPEN_SNOW = np.zeros(32, np.float32)
_K = {
    "EF": (30, 1.0), "ET": (29, 0.85), "Dfd": (28, 0.8), "Dwd": (24, 0.8),
    "Dfc": (27, 0.7), "Dwc": (23, 0.7), "Dsc": (19, 0.7), "Dsd": (20, 0.7),
    "Dfb": (26, 0.55), "Dwb": (22, 0.55), "Dsb": (18, 0.55),
    "Dfa": (25, 0.45), "Dwa": (21, 0.45), "Dsa": (17, 0.45),
    "Cfc": (16, 0.35), "Csc": (10, 0.35), "Cwc": (13, 0.35),
}
for _c, (_i, _v) in _K.items():
    KOPPEN_SNOW[_i] = _v
for _i in (8, 9, 11, 12, 14, 15):  # other C
    KOPPEN_SNOW[_i] = 0.15
for _i in (4, 5, 6, 7):  # B
    KOPPEN_SNOW[_i] = 0.05
SEASONAL_CAP = 0.90


def snow_potential(kop, h, glac, shelf, lat, wet):
    """Per-sample snow potential 0..1. kop int class, h metres (>=0), glac/shelf coverage 0..1,
    lat degrees, wet = land-with-lakes coverage 0..1."""
    base = KOPPEN_SNOW[np.clip(kop.astype(np.int64), 0, 31)]
    s = base + np.clip((h - 2500.0) / 3000.0, 0, 0.6)
    s = s - 0.25 * np.clip((1500.0 - h) / 1500.0, 0, 1) * (np.abs(lat) < 35)
    ice = np.maximum(glac, shelf) >= 0.5
    s = np.where(ice, 1.0, s)
    seasonal = np.minimum(np.clip(s, 0, 1), SEASONAL_CAP)
    line = snowline_m(np.abs(lat))
    perm = np.maximum(ice.astype(np.float32), smoothstep(line - 400.0, line + 400.0, h))
    out = np.maximum(seasonal, perm)
    return np.where(wet >= 0.5, out, 0.0).astype(np.float32)


# ----------------------------------------------------------------------------- rivers


def read_shp(name: str):
    import io
    import zipfile

    import shapefile

    z = zipfile.ZipFile(NE_DIR / f"ne_10m_{name}.zip")
    base = [n for n in z.namelist() if n.endswith(".shp")][0][:-4]
    return shapefile.Reader(shp=io.BytesIO(z.read(base + ".shp")), dbf=io.BytesIO(z.read(base + ".dbf")),
                            shx=io.BytesIO(z.read(base + ".shx")), encoding="utf-8")


RIVER_WIDTH_KM = {0: 6, 1: 6, 2: 4.5, 3: 4.5, 4: 3, 5: 3, 6: 2, 7: 2, 8: 1.2, 9: 1.2}


def load_river_lines(max_rank: int = 9):
    """[(rank, (k,2) lon/lat array)] for NE river centrelines (lake centrelines excluded)."""
    r = read_shp("rivers_lake_centerlines_scale_rank")
    out = []
    for sr in r.iterShapeRecords():
        rec = sr.record
        rank = int(rec["scalerank"])
        if rank > max_rank or rec["featurecla"] == "Lake Centerline":
            continue
        pts = np.asarray(sr.shape.points, np.float64)
        parts = list(sr.shape.parts) + [len(pts)]
        for a, b in zip(parts[:-1], parts[1:]):
            if b - a >= 2:
                out.append((rank, pts[a:b]))
    return out


# face axis: (component index, sign) of the face's own axis
FACE_AXIS = {0: (0, 1), 1: (0, -1), 2: (1, 1), 3: (1, -1), 4: (2, 1), 5: (2, -1)}


def dirs_to_st_on_face(face: int, d: np.ndarray):
    """Gnomonic (s, t) of directions on a GIVEN face (inverse of the GL table), any distance."""
    x, y, z = d[..., 0], d[..., 1], d[..., 2]
    if face == 0:
        return -z / x, -y / x
    if face == 1:
        return z / -x, -y / -x
    if face == 2:
        return x / y, z / y
    if face == 3:
        return x / -y, -z / -y
    if face == 4:
        return x / z, -y / z
    return -x / -z, -y / -z


def rasterize_rivers(lines, face: int, nf: int, pf: int) -> np.ndarray:
    """Bool river mask on the padded fine face grid (nf + 2 pf)^2, widths in km by rank."""
    m = nf + 2 * pf
    img = Image.new("L", (m, m), 0)
    dr = ImageDraw.Draw(img)
    ax, sg = FACE_AXIS[face]
    lim = 1.0 + 2.0 * pf / nf + 0.05
    for rank, ll in lines:
        d = latlon_to_dirs(ll[:, 1], ll[:, 0])
        ok = d[:, ax] * sg > 0.25
        if not ok.any():
            continue
        s, t = dirs_to_st_on_face(face, d)
        inside = ok & (np.abs(s) <= lim) & (np.abs(t) <= lim)
        if inside.sum() < 1:
            continue
        col = (s + 1.0) * nf / 2.0 - 0.5 + pf
        row = (t + 1.0) * nf / 2.0 - 0.5 + pf
        seg_ok = ok[:-1] & ok[1:] & (inside[:-1] | inside[1:])
        # runs of consecutive drawable segments, chunked to <= 24 points for a local width
        i = 0
        n = len(seg_ok)
        while i < n:
            if not seg_ok[i]:
                i += 1
                continue
            j = i
            while j < n and seg_ok[j] and j - i < 24:
                j += 1
            pts = list(zip(col[i : j + 1].tolist(), row[i : j + 1].tolist()))
            sm, tm = float(np.mean(s[i : j + 1])), float(np.mean(t[i : j + 1]))
            arc = (2.0 / nf) / (1 + sm * sm + tm * tm) ** 0.75 * R_KM
            w = max(1, int(round(RIVER_WIDTH_KM.get(rank, 1.2) / arc)))
            dr.line(pts, fill=255, width=w, joint="curve" if w > 2 else None)
            i = j if j > i else i + 1
    return np.asarray(img) > 127


# ----------------------------------------------------------------------------- face bake


def bake_face(cfg: Cfg, M: Masters, face: int, rivers) -> dict:
    t0 = time.time()
    N, SS, P4 = cfg.N, cfg.SS, cfg.PAD4
    nf = N * SS
    pad = P4 // SS
    fname = FACES[face]

    # A. padded fine masks -> coast SDF, lake SDF, river distance (geodesic km)
    land_f = sample_face(M.land, face, nf, P4, "bilinear") / 255.0
    lake_f = sample_face(M.lakes, face, nf, P4, "bilinear") / 255.0
    lwl = np.maximum(land_f, lake_f) >= 0.5
    lakem = lake_f >= 0.5
    del land_f, lake_f
    coast_sd = face_signed_distance_km(lwl, face, nf, P4)
    lake_sd = face_signed_distance_km(lakem, face, nf, P4) if lakem.any() else np.full(lwl.shape, -1e3, np.float32)
    riv = rasterize_rivers(rivers, face, nf, P4)
    riv_d = face_distance_km(riv, face, nf, P4, steps=(8, 4, 2, 1))
    band = np.clip(1.0 - riv_d / RIVER_BAND_KM, 0, 1)
    del riv, riv_d
    coast_n = crop(box_reduce(coast_sd, SS), pad)
    lake_n = crop(box_reduce(lake_sd, SS), pad)
    river_n = crop(box_reduce(band, SS), pad)
    lwl_fine = lwl[P4:-P4, P4:-P4]
    del coast_sd, lake_sd, band, lwl, lakem

    # B. Köppen index (mode of nearest-sampled filled classes, ocean 0)
    kop_f = sample_face(M.koppen, face, nf, 0, "nearest", dtype=np.uint8)
    kop_f = np.where(lwl_fine, kop_f, 0).astype(np.uint8)
    k_hi = mode_reduce(kop_f, nf // cfg.NK[1], 32)
    k_lo = mode_reduce(kop_f, nf // cfg.NK[0], 32)
    del kop_f, lwl_fine

    # C. area means at N: land cov, wet cov, h+, h-, snow
    def fn(d, lat, lon):
        e = sample(M.elev, lat, lon, "bilinear")
        la = sample(M.land, lat, lon, "bilinear") / 255.0
        lk = sample(M.lakes, lat, lon, "bilinear") / 255.0
        wet = np.maximum(la, lk)
        hpos = np.maximum(e, 0.0)
        kop = sample(M.koppen, lat, lon, "nearest")
        gl = sample(M.glacier, lat, lon, "bilinear") / 255.0
        sh = sample(M.iceshelf, lat, lon, "bilinear") / 255.0
        sn = snow_potential(kop, hpos, gl, sh, lat, wet)
        return np.stack([la, wet, hpos, np.maximum(-e, 0.0), sn], axis=-1)

    A = area_face(fn, face, N, SS)
    land_cov, wet_cov, hpos, hneg, snow = (A[..., i] for i in range(5))
    is_land = land_cov >= 0.5
    is_wet = wet_cov >= 0.5
    R = np.where(is_land, enc_height(hpos), 0).astype(np.uint8)
    G = np.where(~is_wet, enc_bathy(hneg), 0).astype(np.uint8)
    B = enc_sdf(coast_n, COAST_HALF_KM)
    terrain = np.stack([R, G, B], axis=-1)
    hydro = np.stack([to_u8(river_n), enc_sdf(lake_n, LAKE_HALF_KM), to_u8(snow)], axis=-1)
    o = cfg.out / "cube"
    save_png_rgb(terrain, o / f"terrain_{N}_{fname}.png")
    save_png_rgb(hydro, o / f"hydro_{N}_{fname}.png")
    save_png_rgb(gray_to_rgb((k_hi * 8).astype(np.uint8)), o / f"koppenIdx_{cfg.NK[1]}_{fname}.png")
    save_png_rgb(gray_to_rgb((k_lo * 8).astype(np.uint8)), o / f"koppenIdx_{cfg.NK[0]}_{fname}.png")
    del A

    # D. heightHi (area mean at NHI, same R encoding, land only)
    def fn_hi(d, lat, lon):
        e = sample(M.elev, lat, lon, "bilinear")
        la = sample(M.land, lat, lon, "bilinear") / 255.0
        return np.stack([la, np.maximum(e, 0.0)], axis=-1)

    H = area_face(fn_hi, face, cfg.NHI, SS, band_px=4_000_000)
    hh = np.where(H[..., 0] >= 0.5, enc_height(H[..., 1]), 0).astype(np.uint8)
    save_png_rgb(gray_to_rgb(hh), o / f"heightHi_{cfg.NHI}_{fname}.png")
    print(f"  face {fname}: {time.time() - t0:.0f}s")
    return {}


# ----------------------------------------------------------------------------- equirect bake


def bake_equirect(cfg: Cfg, M: Masters):
    t0 = time.time()
    W, H = cfg.EQ_FINE
    lat_c = 90.0 - (np.arange(H) + 0.5) * 180.0 / H
    lon_c = -180.0 + (np.arange(W) + 0.5) * 360.0 / W
    wet = np.empty((H, W), np.float32)
    land = np.empty((H, W), np.float32)
    hpos = np.empty((H, W), np.float32)
    hneg = np.empty((H, W), np.float32)
    snow = np.empty((H, W), np.float32)
    rows = max(1, 4_000_000 // W)
    for r0 in range(0, H, rows):
        r1 = min(H, r0 + rows)
        lat, lon = np.meshgrid(lat_c[r0:r1], lon_c, indexing="ij")
        e = sample(M.elev, lat, lon, "bilinear")
        la = sample(M.land, lat, lon, "bilinear") / 255.0
        lk = sample(M.lakes, lat, lon, "bilinear") / 255.0
        wt = np.maximum(la, lk)
        hp = np.maximum(e, 0.0)
        kop = sample(M.koppen, lat, lon, "nearest")
        gl = sample(M.glacier, lat, lon, "bilinear") / 255.0
        sh = sample(M.iceshelf, lat, lon, "bilinear") / 255.0
        wet[r0:r1], land[r0:r1], hpos[r0:r1], hneg[r0:r1] = wt, la, hp, np.maximum(-e, 0.0)
        snow[r0:r1] = snow_potential(kop, hp, gl, sh, lat, wt)
    print(f"  eq sample {W}x{H}: {time.time() - t0:.0f}s")
    sd = equirect_signed_distance_km(wet >= 0.5, band=64, max_km=COAST_HALF_KM + 16)
    print(f"  eq coast SDF: {time.time() - t0:.0f}s")
    o = cfg.out / "eq"
    for (w, h) in cfg.EQ_OUT:
        k = W // w
        sdk = box_reduce(sd, k)
        wk = box_reduce(wet, k) >= 0.5
        r = enc_sdf(sdk, COAST_HALF_KM)
        g = np.where(~wk, enc_bathy(box_reduce(hneg, k)), 0).astype(np.uint8)
        b = to_u8(box_reduce(snow, k))
        save_png_rgb(np.stack([r, g, b], -1), o / f"lowdata_{w}x{h}.png")
    gw, gh = cfg.HGRID
    k = W // gw
    hg = box_reduce(hpos, k)
    lg = box_reduce(land, k) >= 0.5
    grid = np.where(lg, np.rint(hg), 0).astype("<u2")
    p = o / f"height_{gw}x{gh}.u16"
    p.parent.mkdir(parents=True, exist_ok=True)
    grid.tofile(p)
    save_png_rgb(gray_to_rgb(to_u8(np.sqrt(grid / 9000.0))), o / f"height_{gw}x{gh}_quicklook.png")
    print(f"  equirect done: {time.time() - t0:.0f}s")


# ----------------------------------------------------------------------------- quicklooks + checks


def load_faces(cfg: Cfg, layer: str, n: int) -> list[np.ndarray]:
    return [load_rgb(cfg.out / "cube" / f"{layer}_{n}_{f}.png") for f in FACES]


def cube_lookup(faces, lat, lon, ch=None):
    """Nearest-texel lookup of the cube at a lat/lon (degrees)."""
    d = latlon_to_dirs(np.float64(lat), np.float64(lon))
    f, s, t = dirs_to_face_uv(d[None])
    n = faces[0].shape[0]
    c, r = face_uv_to_texel(s, t, n)
    ci, ri = int(np.clip(round(float(c[0])), 0, n - 1)), int(np.clip(round(float(r[0])), 0, n - 1))
    v = faces[int(f[0])][ri, ci]
    return v if ch is None else int(v[ch])


def cube_bilinear(faces, lat, lon, ch):
    d = latlon_to_dirs(np.asarray(lat, np.float64), np.asarray(lon, np.float64))
    f, s, t = dirs_to_face_uv(d)
    n = faces[0].shape[0]
    c, r = face_uv_to_texel(s, t, n)
    out = np.empty(np.shape(lat))
    for k in np.unique(f):
        m = f == k
        a = faces[int(k)][..., ch].astype(np.float64)
        cc, rr = np.clip(c[m], 0, n - 1.001), np.clip(r[m], 0, n - 1.001)
        c0, r0 = np.floor(cc).astype(int), np.floor(rr).astype(int)
        tc, tr = cc - c0, rr - r0
        out[m] = (a[r0, c0] * (1 - tc) + a[r0, c0 + 1] * tc) * (1 - tr) + (a[r0 + 1, c0] * (1 - tc) + a[r0 + 1, c0 + 1] * tc) * tr
    return out


def quicklooks(cfg: Cfg):
    w, h = cfg.QL
    for layer, n in (("terrain", cfg.N), ("hydro", cfg.N), ("heightHi", cfg.NHI), ("koppenIdx", cfg.NK[1])):
        faces = load_faces(cfg, layer, n)
        eq = cube_to_equirect(faces, w, h, "nearest" if layer == "koppenIdx" else "bilinear")
        if layer == "koppenIdx":
            pal = json.loads((ROOT / "src" / "data" / "koppen-palette.json").read_text())
            lut = np.zeros((32, 3), np.uint8)
            lut[0] = (20, 30, 50)
            for e in pal:
                hx = e["hex"].lstrip("#")
                lut[e["idx"]] = [int(hx[i : i + 2], 16) for i in (0, 2, 4)]
            eq = lut[np.clip(np.rint(eq[..., 0] / 8).astype(int), 0, 31)]
        save_png_rgb(np.clip(np.rint(eq), 0, 255).astype(np.uint8), cfg.ql(layer))
    print(f"  quicklooks -> {cfg.ql('*')}")


def png_clean(path: Path) -> tuple[bool, str]:
    with Image.open(path) as im:
        bad = [k for k in ("icc_profile", "gamma", "srgb", "chromaticity", "transparency", "exif") if k in im.info]
        ok = im.mode == "RGB" and im.format == "PNG" and not bad and im.getbands() == ("R", "G", "B")
        return ok, f"{im.mode} {im.format} {bad}"


def checks(cfg: Cfg) -> bool:
    ok_all = True

    def report(name, ok, detail):
        nonlocal ok_all
        ok_all &= bool(ok)
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}: {detail}")

    o = cfg.out
    expect = []
    for f in FACES:
        expect += [f"cube/terrain_{cfg.N}_{f}.png", f"cube/hydro_{cfg.N}_{f}.png", f"cube/heightHi_{cfg.NHI}_{f}.png",
                   f"cube/koppenIdx_{cfg.NK[0]}_{f}.png", f"cube/koppenIdx_{cfg.NK[1]}_{f}.png"]
    expect += [f"eq/lowdata_{w}x{h}.png" for w, h in cfg.EQ_OUT]
    expect += [f"eq/height_{cfg.HGRID[0]}x{cfg.HGRID[1]}.u16"]
    missing = [e for e in expect if not (o / e).exists()]
    report("face/eq set complete", not missing, f"{len(expect) - len(missing)}/{len(expect)} present {missing[:4]}")

    pngs = sorted((o / "cube").glob("*.png")) + sorted((o / "eq").glob("*.png"))
    bad = [(p.name, d) for p in pngs for ok, d in [png_clean(p)] if not ok]
    report("PNG 8-bit RGB, no alpha/ICC/gamma", not bad, f"{len(pngs)} files, bad={bad[:3]}")

    terrain = load_faces(cfg, "terrain", cfg.N)
    hydro = load_faces(cfg, "hydro", cfg.N)
    hhi = load_faces(cfg, "heightHi", cfg.NHI)
    kidx = load_faces(cfg, "koppenIdx", cfg.NK[1])
    kidx_lo = load_faces(cfg, "koppenIdx", cfg.NK[0])

    # seams: jump across each cube edge beyond the local gradient, vs the same statistic on a
    # fake seam 6 texels inside the faces (the field's own curvature at this resolution).
    # PASS when, over all 12 edges, max(seam) <= max(baseline) + 2 LSB and
    # mean(seam) <= mean(baseline) + 0.5 LSB: i.e. the seams are indistinguishable from interior.
    seam_lines = []
    sdf_ok = True
    for name, faces, ch, gate in (("terrain.B coastSdf", terrain, 2, True), ("hydro.G lakeSdf", hydro, 1, True),
                                  ("hydro.R river", hydro, 0, False), ("hydro.B snow", hydro, 2, False),
                                  ("terrain.R height", terrain, 0, False), ("terrain.G bathy", terrain, 1, False)):
        rep = seam_report([f[..., ch] for f in faces], strip=1)
        smax, bmax = max(r[1] for r in rep), max(r[2] for r in rep)
        smean, bmean = float(np.mean([r[3] for r in rep])), float(np.mean([r[4] for r in rep]))
        ok = smax <= bmax + 2 and smean <= bmean + 0.5
        if gate:
            sdf_ok &= ok
        seam_lines.append(f"{name}: seam max {smax:.1f} / mean {smean:.2f} vs interior max {bmax:.1f} / mean {bmean:.2f}"
                          f" {'ok' if ok else 'SEAM'}")
    report("SDF seams indistinguishable from interior (<= +2 LSB max, +0.5 mean)", sdf_ok, "\n      " + "\n      ".join(seam_lines))

    # spot checks
    # Everest: textures are AREA MEANS (heightHi texel ~6 km), so the 1.85 km summit cell (8157 m)
    # cannot survive. Checks: (a) master >= 8100 m (D1 note), (b) the decoded heightHi texel equals an
    # independent 4x4 area mean of the master over that texel within 1 code (decode is correct).
    m = load_master("elev_m.i16", cfg.quick)
    emax = float(sample(m, np.array([27.988]), np.array([86.925]), "nearest")[0])
    d = latlon_to_dirs(np.float64(27.988), np.float64(86.925))[None]
    f, s_, t_ = dirs_to_face_uv(d)
    col, row = face_uv_to_texel(s_, t_, cfg.NHI)
    ci, ri = int(round(float(col[0]))), int(round(float(row[0])))
    sub = (np.arange(4) + 0.5) / 4
    ss_ = 2 * (ci + sub[None, :]) / cfg.NHI - 1 + 0 * sub[:, None]
    tt_ = 2 * (ri + sub[:, None]) / cfg.NHI - 1 + 0 * sub[None, :]
    la_, lo_ = dirs_to_latlon_(st_to_dirs(int(f[0]), ss_, tt_))
    ref = float(np.maximum(sample(m, la_, lo_, "bilinear"), 0).mean())
    code = int(hhi[int(f[0])][ri, ci, 0])
    hT = dec_height(cube_lookup(terrain, 27.988, 86.925, 0))
    report("Everest (master >= 8100 m; heightHi texel == area mean within 1 code)",
           emax >= (5000 if cfg.quick else 8100) and abs(code - int(enc_height(np.array([ref]))[0])) <= 1,
           f"master summit cell {emax:.0f} m; heightHi_{cfg.NHI} texel {dec_height(code):.0f} m vs area mean {ref:.0f} m; "
           f"terrain_{cfg.N} texel {hT:.0f} m")
    dM = dec_bathy(cube_lookup(terrain, 11.373, 142.591, 1))
    ringM = [(11.373 + dy, 142.591 + dx) for dy in np.linspace(-0.15, 0.15, 7) for dx in np.linspace(-0.15, 0.15, 7)]
    dMmax = max(dec_bathy(cube_lookup(terrain, a, b, 1)) for a, b in ringM)
    report("Mariana bathy >= 10000 m", dMmax >= (9000 if cfg.quick else 10000),
           f"texel {dM:.0f} m, max within 15 km {dMmax:.0f} m")

    # Gibraltar: SDF 0.5 crossing within 1 texel of every master coast crossing on lon -5.60
    lats = np.linspace(36.40, 35.60, 801)
    lons = np.full_like(lats, -5.60)
    lw = np.maximum(sample(load_master("land.u8", cfg.quick), lats, lons, "bilinear"),
                    sample(load_master("lakes.u8", cfg.quick), lats, lons, "bilinear")) >= 127.5
    sdfv = cube_bilinear(terrain, lats, lons, 2) - 127.5
    texel_deg = math.degrees((2.0 / cfg.N) / 2 ** 0.75)  # conservative texel arc near (s,t)~(.7,.7)
    mc = np.nonzero(np.diff(lw.astype(int)))[0]
    sc = np.nonzero(np.diff(np.sign(sdfv)))[0]
    errs = [float(np.min(np.abs(lats[sc] - lats[i]))) if len(sc) else 9 for i in mc]
    report("Gibraltar coast SDF crosses 0.5 within 1 texel", len(mc) > 0 and max(errs) <= texel_deg,
           f"master crossings at {[round(float(lats[i]), 3) for i in mc]}, SDF crossings at "
           f"{[round(float(lats[i]), 3) for i in sc]}, max err {max(errs) if errs else -1:.3f}° vs texel {texel_deg:.3f}°")

    nile = cube_lookup(hydro, 25.0, 32.9, 0) / 255.0
    nile_n = max(cube_lookup(hydro, 25.0, 32.9 + dx, 0) for dx in (-0.06, 0, 0.06)) / 255.0
    report("Nile river band > 0.9 at 25N 32.9E", nile > 0.9 or nile_n > 0.9, f"{nile:.3f} (best of ±0.06° {nile_n:.3f})")
    gl = cube_lookup(hydro, 72.0, -40.0, 2)
    report("Greenland interior snow 1.0", gl >= 254, f"{gl}")
    sah = [cube_lookup(hydro, a, b, 2) / 255.0 for a, b in ((25, 15), (27, 0), (20, 25), (24, 30), (29, 5))]
    report("Sahara snow < 0.1", max(sah) < 0.1, f"{[round(v, 3) for v in sah]}")
    for city, a, b, want in (("Cairo", 30.044, 31.236, 4), ("Paris", 48.857, 2.352, 15), ("Singapore", 1.352, 103.82, 1)):
        k1 = cube_lookup(kidx, a, b, 0) // 8
        k0 = cube_lookup(kidx_lo, a, b, 0) // 8
        report(f"Köppen {city} == {want}", k1 == want and k0 == want, f"{cfg.NK[1]}: {k1}, {cfg.NK[0]}: {k0}")

    # equirect lowdata vs the cube (sanity) + u16 grid
    gw, gh = cfg.HGRID
    grid = np.fromfile(o / "eq" / f"height_{gw}x{gh}.u16", "<u2").reshape(gh, gw)
    j = int((90 - 27.988) / 180 * gh)
    i = int((86.925 + 180) / 360 * gw)
    report("height grid Everest area", grid[j - 2 : j + 3, i - 2 : i + 3].max() > 5000,
           f"max near Everest {grid[j - 2:j + 3, i - 2:i + 3].max()} m; ocean zeros {float((grid == 0).mean()):.3f}")
    ld = load_rgb(o / "eq" / f"lowdata_{cfg.EQ_OUT[0][0]}x{cfg.EQ_OUT[0][1]}.png")
    jj = int((90 - 72.0) / 180 * ld.shape[0])
    ii = int((-40 + 180) / 360 * ld.shape[1])
    report("lowdata Greenland snow / Pacific bathy", ld[jj, ii, 2] >= 254 and ld[ld.shape[0] // 2, ld.shape[1] // 8, 1] > 150,
           f"snow {ld[jj, ii, 2]}, bathy {ld[ld.shape[0] // 2, ld.shape[1] // 8, 1]}")
    return ok_all


# ----------------------------------------------------------------------------- main


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true", help="quick masters, small sizes, outputs under physical/quick/")
    ap.add_argument("--all", action="store_true", help="full bake (default when not --quick)")
    ap.add_argument("--check", action="store_true", help="run acceptance checks after (or without) baking")
    ap.add_argument("--only", choices=["faces", "eq", "ql", "none"], default=None)
    ap.add_argument("--faces", default="0,1,2,3,4,5")
    a = ap.parse_args()
    cfg = Cfg(a.quick)
    if not a.quick and not (ROOT / "scripts" / "data" / "master" / "READY").exists():
        raise SystemExit("full masters not READY")
    t0 = time.time()
    do = a.only or ("none" if (a.check and not a.all and not a.quick) else "all")
    if do != "none":
        M = Masters(cfg)
        if do in ("all", "faces"):
            rivers = load_river_lines(9)
            print(f"  {len(rivers)} river polylines (rank <= 9)")
            for f in [int(x) for x in a.faces.split(",")]:
                bake_face(cfg, M, f, rivers)
        if do in ("all", "eq"):
            bake_equirect(cfg, M)
        if do in ("all", "ql", "faces"):
            quicklooks(cfg)
    ok = True
    if a.check or a.quick:
        ok = checks(cfg)
    print(f"bake_physical {'quick' if a.quick else 'full'}: {time.time() - t0:.0f}s {'OK' if ok else 'CHECKS FAILED'}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
