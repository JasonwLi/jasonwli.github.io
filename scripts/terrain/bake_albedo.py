"""D3: EU4-painterly albedo cube, Köppen colour, LOW/preview equirect albedo, quicklooks.

Outputs (scripts/data/bake/paint/, or .../paint/quick/ with --quick):
  cube/albedo_{2048,1024}_{face}.png       sRGB 8-bit (appearance; D5 -> KTX2 ETC1S -srgb)
  cube/koppencolor_{512,1024}_{face}.png   sRGB 8-bit
  eq/koppencolor_2048x1024.png             sRGB 8-bit (LOW climate mode)
  eq/low_albedo_4096x2048.png              sRGB, relief + water + rivers + permanent snow baked in
  eq/preview_albedo_2048x1024.png          box-downsampled (linear light) from the LOW albedo
Quicklooks: scripts/.cache/quicklook/paint_albedo.png (cube reprojection), paint_low.png,
  paint_region_<name>.png (globe-region crops: cube albedo x runtime-like relief + water; and LOW).

Look (plan D3 + critique amendment): base = sum_i w_i * mix(dark_i, light_i, n1) in linear light,
n1 = 40 km fBm (x0.95, INT-B); per-class jitter (15 km fBm); farmland Voronoi patchwork (9 km cells, +-3.5% L,
+-0.008 turn hue); NE2 within-class variation (OKLab offset from the class mean in a ~30 km window,
x0.35, |dE| <= 0.06, its L half-weighted so NE2's baked hillshade does not double the runtime
relief); brush strokes = oriented line-integral convolution of fine noise along contours (11 taps,
~10 px at 2048, +-6% L). Soft-knee OKLab L cap: land 0.66, ice 0.86. No relief in the cube albedo.
LOW: hillshade of sqrt-exaggerated height (az 315, alt 45) in [0.62, 1.15]; steel-family water
ramp (shelf L0.40 / deep L0.34 / abyss L0.28, hue 240-250) from D2's bathy, thin light coast
line from D2's coast SDF; rivers rank <= 5; permanent snow = D2 snow >= 0.95 (BRIEF §2 snowline).

Run: ~/dev/dw3-lock scripts/terrain/.venv/bin/python scripts/terrain/bake_albedo.py --all --check
Windowed (keeps each process < 6 GB; the one-process --all peaked at 7.3 GB), one face per process:
  for f in 0 1 2 3 4 5; do ~/dev/dw3-lock .venv/bin/python bake_albedo.py --only faces --faces $f --no-ql; done
  then --only koppen --no-ql, --only low --no-ql, and finally --only ql --check
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bake_splats import CH_ELEV, CH_LAND, CH_NE2, CH_W, Cfg, Masters, painted_mask, raw_eq, raw_face, weights_from_raw  # noqa: E402
from lib.cube import FACES, dirs_to_face_uv, dirs_to_latlon, face_uv_to_texel, latlon_to_dirs  # noqa: E402
from lib.equirect import sample  # noqa: E402
from lib.faces import box_reduce, cube_to_equirect, mode_reduce, seam_report  # noqa: E402
from lib.io import load_master, load_rgb, save_png_rgb  # noqa: E402
from lib.paint import (  # noqa: E402
    FARM, ICE, NC, EqGrid, FaceGrid, apply_luma_cap, fbm_dirs, hex_to_linear, linear_to_oklab, linear_to_srgb,
    load_palette, oklab_to_linear, palette_hex_block, sharpen_weights, smoothstep, srgb_to_linear, to_srgb8,
    value_noise3, worley_cells, R_KM,
)

ROOT = Path(__file__).resolve().parents[2]
QL = ROOT / "scripts" / ".cache" / "quicklook"


# ----------------------------------------------------------------------------- painterly core


def lic(noise: np.ndarray, vx: np.ndarray, vy: np.ndarray, length_px: float = 10.0, taps: int = 11) -> np.ndarray:
    """Straight-segment line-integral convolution: mean of `noise` sampled along +-length/2 in the
    local (vx, vy) direction (triangle weights). Equivalent to LIC for fields that are locally
    straight at the 10 px scale; one cv2.remap per tap."""
    h, w = noise.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    acc = np.zeros_like(noise, np.float32)
    tot = 0.0
    for k in range(taps):
        s = (k - (taps - 1) / 2) * (length_px / (taps - 1))
        wt = 1.0 - abs(s) / (length_px / 2 + 1)
        mx = xx + s * vx
        my = yy + s * vy
        acc += wt * cv2.remap(noise, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        tot += wt
    return acc / tot


def paint(sw: np.ndarray, valid: np.ndarray, ne2_lin: np.ndarray, elev: np.ndarray, dirs: np.ndarray,
          texel_km: np.ndarray, pal: dict, ne2_window: int, lic_px: float,
          tk: float | None = None, lic_stats: tuple[float, float] | None = None,
          stats_rows: tuple[int, int] | None = None, stats_out: list | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Painted linear albedo (h, w, 3) on a padded grid + the cap map. sw: sharpened weights.
    Windowed callers (LOW equirect in row bands) pass the global median texel size `tk` and the
    global LIC mean/std `lic_stats` so bands match; `stats_out` collects (sum, sumsq, n) of the raw
    LIC over rows `stats_rows` for the first (statistics) pass."""
    h, w = valid.shape
    n1 = np.clip(0.5 + 0.95 * fbm_dirs(dirs, 40.0, 3, seed=21), 0, 1)[..., None]
    # sum_i w_i * mix(dark_i, light_i, n1) == w @ dark + n1 * (w @ (light - dark))  (linear in w)
    base = sw @ pal["dark"].astype(np.float32) + n1 * (sw @ (pal["light"] - pal["dark"]).astype(np.float32))
    lab = linear_to_oklab(np.clip(base, 1e-6, 1).reshape(-1, 3)).reshape(h, w, 3)
    # per-class jitter (15 km)
    jit = (sw * pal["jitter"][None, None]).sum(-1)
    lab[..., 0] *= 1 + 2.0 * jit * fbm_dirs(dirs, 15.0, 2, seed=31)
    # farmland patchwork
    farm = sw[..., FARM]
    if farm.max() > 0:
        h1, h2 = worley_cells(dirs, 9.0, seed=41)
        lab[..., 0] *= 1 + 0.035 * (2 * h1 - 1) * farm  # INT-B: 0.08 read mottled at <= 900 km
        ang = 2 * math.pi * 0.008 * (2 * h2 - 1) * farm
        a, b = lab[..., 1].copy(), lab[..., 2].copy()
        lab[..., 1] = a * np.cos(ang) - b * np.sin(ang)
        lab[..., 2] = a * np.sin(ang) + b * np.cos(ang)
    # NE2 within-class variation
    ne_lab = linear_to_oklab(np.clip(ne2_lin, 1e-6, 1).reshape(-1, 3)).reshape(h, w, 3).astype(np.float32)
    am = sw.argmax(-1)
    off = np.zeros_like(ne_lab)
    k = (ne2_window, ne2_window)
    for c in range(NC):
        m = ((am == c) & valid).astype(np.float32)
        if m.sum() == 0:
            continue
        cnt = cv2.boxFilter(m, -1, k, normalize=True, borderType=cv2.BORDER_REFLECT)
        mean = np.stack([cv2.boxFilter(ne_lab[..., j] * m, -1, k, normalize=True, borderType=cv2.BORDER_REFLECT)
                         for j in range(3)], -1) / np.maximum(cnt, 1e-6)[..., None]
        sel = m > 0
        off[sel] = (ne_lab - mean)[sel]
    off *= 0.35
    off[..., 0] *= 0.5
    mag = np.linalg.norm(off, axis=-1, keepdims=True)
    off *= np.minimum(1.0, 0.06 / np.maximum(mag, 1e-9))
    lab += off
    # brush strokes: LIC along contours
    el = cv2.GaussianBlur(elev.astype(np.float32), (0, 0), 1.5)
    gy, gx = np.gradient(el)
    gx /= texel_km
    gy /= texel_km  # m per km
    gm = np.hypot(gx, gy)
    cx, cy = -gy / np.maximum(gm, 1e-6), gx / np.maximum(gm, 1e-6)
    th = math.pi * fbm_dirs(dirs, 300.0, 2, seed=51)
    fx, fy = np.cos(th), np.sin(th)
    bl = smoothstep(2.0, 12.0, gm)
    vx, vy = bl * cx + (1 - bl) * fx, bl * cy + (1 - bl) * fy
    vn = np.maximum(np.hypot(vx, vy), 1e-6)
    vx, vy = (vx / vn).astype(np.float32), (vy / vn).astype(np.float32)
    tk = float(np.median(texel_km)) if tk is None else tk
    noise = value_noise3(np.asarray(dirs) * (R_KM / (1.1 * tk)), seed=61).astype(np.float32)
    L = lic(noise, vx, vy, lic_px)
    if stats_out is not None:
        core = L[stats_rows[0]:stats_rows[1]].astype(np.float64)
        stats_out.append((float(core.sum()), float((core * core).sum()), core.size))
    mu, sd = (float(L.mean()), float(L.std())) if lic_stats is None else lic_stats
    L = (L - mu) / max(sd, 1e-6)
    lab[..., 0] *= 1 + 0.03 * np.clip(L, -2, 2)
    lin = oklab_to_linear(lab.reshape(-1, 3)).reshape(h, w, 3)
    cap = np.where(sw[..., ICE] > 0.5, pal["iceCap"], pal["lumaCap"]).astype(np.float32)
    lin = apply_luma_cap(lin, cap, pal["knee"])
    lin = np.where(valid[..., None], lin, pal["oceanFill"][None, None])
    return lin.astype(np.float32), cap


def face_albedo(cfg: Cfg, M: Masters, face: int, pal: dict):
    t = time.time()
    A = raw_face(cfg, M, face)
    wsum = A[..., CH_W].sum(-1)
    w, land = weights_from_raw(A)
    valid = painted_mask(land, wsum)
    sw = sharpen_weights(w, valid)
    g = FaceGrid(face, cfg.NA, cfg.PAD)
    lin, _ = paint(sw, valid, A[..., CH_NE2], A[..., CH_ELEV], g.dirs(), g.texel_km(), pal,
                   ne2_window=max(3, int(round(9 * cfg.NA / 2048)) | 1), lic_px=10.0 * cfg.NA / 2048 if cfg.quick else 10.0)
    lin = g.crop(lin)
    n0 = cfg.NA
    save_png_rgb(to_srgb8(lin), cfg.out / "cube" / f"albedo_{n0}_{FACES[face]}.png")
    save_png_rgb(to_srgb8(box_reduce(lin, 2)), cfg.out / "cube" / f"albedo_{n0 // 2}_{FACES[face]}.png")
    print(f"  albedo {FACES[face]}: {time.time() - t:.0f}s")


# ----------------------------------------------------------------------------- Köppen colour


def koppen_lut() -> np.ndarray:
    pal = json.loads((ROOT / "src" / "data" / "koppen-palette.json").read_text())
    lut = np.zeros((32, 3))
    for e in pal:
        lut[e["idx"]] = hex_to_linear(e["hex"])
    return lut


def koppen_paint(idx: np.ndarray, dirs: np.ndarray, pal: dict) -> np.ndarray:
    lut = koppen_lut()
    lin = lut[np.clip(idx, 0, 31)]
    lab = linear_to_oklab(np.clip(lin, 1e-6, 1).reshape(-1, 3)).reshape(lin.shape)
    lab[..., 0] *= 1 + 0.03 * np.clip(2.5 * fbm_dirs(dirs, 20.0, 2, seed=71), -1, 1)
    lin = oklab_to_linear(lab.reshape(-1, 3)).reshape(lin.shape)
    lin = apply_luma_cap(lin, np.float32(pal["lumaCap"]), pal["knee"])
    return np.where((idx > 0)[..., None], lin, pal["koppenOcean"][None, None])


def koppen_faces(cfg: Cfg, pal: dict):
    for n in cfg.NS:
        for f, fname in enumerate(FACES):
            idx = load_rgb(cfg.phys / "cube" / f"koppenIdx_{n}_{fname}.png")[..., 0].astype(np.int64) // 8
            g = FaceGrid(f, n, 0)
            save_png_rgb(to_srgb8(koppen_paint(idx, g.dirs(), pal)), cfg.out / "cube" / f"koppencolor_{n}_{fname}.png")


def koppen_equirect(cfg: Cfg, M: Masters, pal: dict):
    W, H = (512, 256) if cfg.quick else (2048, 1024)
    ss = 4
    lat_c = 90.0 - (np.arange(H * ss) + 0.5) * 180.0 / (H * ss)
    lon_c = -180.0 + (np.arange(W * ss) + 0.5) * 360.0 / (W * ss)
    idx = np.zeros((H, W), np.int64)
    rows = 64
    for r0 in range(0, H, rows):
        r1 = min(H, r0 + rows)
        lat, lon = np.meshgrid(lat_c[r0 * ss : r1 * ss], lon_c, indexing="ij")
        k = sample(M.koppen, lat, lon, "nearest").astype(np.int64)
        wet = np.maximum(sample(M.land, lat, lon, "bilinear"), sample(M.lakes, lat, lon, "bilinear")) >= 127.5
        idx[r0:r1] = mode_reduce(np.where(wet, k, 0), ss, 32)
    g = EqGrid(W, H, 0)
    save_png_rgb(to_srgb8(koppen_paint(idx, g.dirs(), pal)), cfg.out / "eq" / f"koppencolor_{W}x{H}.png")


# ----------------------------------------------------------------------------- LOW equirect


def upsample_eq(img: np.ndarray, w: int, h: int) -> np.ndarray:
    """Bilinear upsample of an equirect (cell centres; wraps in longitude)."""
    pad = np.concatenate([img[:, -1:], img, img[:, :1]], axis=1).astype(np.float32)
    H0, W0 = img.shape[:2]
    x = (np.arange(w) + 0.5) * W0 / w - 0.5 + 1
    y = np.clip((np.arange(h) + 0.5) * H0 / h - 0.5, 0, H0 - 1)
    mx, my = np.meshgrid(x.astype(np.float32), y.astype(np.float32))
    return cv2.remap(pad, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def hillshade(z_m: np.ndarray, dx_m: np.ndarray, dy_m: float, az=315.0, alt=45.0) -> np.ndarray:
    """Lambert shade / flat shade (flat = 1). Image x = east, rows go south."""
    gy, gx = np.gradient(z_m.astype(np.float64))
    dzdx = gx / dx_m
    dzdy = -gy / dy_m  # north-positive
    n = np.stack([-dzdx, -dzdy, np.ones_like(dzdx)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    a, e = math.radians(az), math.radians(alt)
    l = np.array([math.cos(e) * math.sin(a), math.cos(e) * math.cos(a), math.sin(e)])
    return (n @ l) / l[2]


def draw_rivers_eq(w: int, h: int, max_rank: int = 5, ss: int = 2) -> np.ndarray:
    """Antialiased river coverage (0..1) on an equirect from rivers.json (rank <= max_rank)."""
    data = json.loads((ROOT / "scripts" / "data" / "bake" / "physical" / "rivers.json").read_text())
    W, H = w * ss, h * ss
    img = Image.new("L", (W, H), 0)
    dr = ImageDraw.Draw(img)
    width = {0: 3.0, 1: 3.0, 2: 2.4, 3: 2.4, 4: 1.8, 5: 1.5}
    for rv in data["rivers"]:
        if rv["r"] > max_rank:
            continue
        p = np.asarray(rv["p"]).reshape(-1, 2)
        wpx = max(1, int(round(width[rv["r"]] * ss * w / 4096)))
        for shift in (-360.0, 0.0, 360.0):
            x = (p[:, 0] + shift + 180.0) / 360.0 * W - 0.5
            if x.max() < -10 or x.min() > W + 10:
                continue
            y = (90.0 - p[:, 1]) / 180.0 * H - 0.5
            dr.line(list(zip(x.tolist(), y.tolist())), fill=255, width=wpx, joint="curve" if wpx > 2 else None)
    a = np.asarray(img, np.float32) / 255.0
    return box_reduce(a, ss)


def low_albedo(cfg: Cfg, M: Masters, pal: dict):
    t = time.time()
    W, H = cfg.EQ
    A = raw_eq(cfg, M)
    wsum = A[..., CH_W].sum(-1)
    w, land = weights_from_raw(A)
    valid = painted_mask(land, wsum)
    sw = sharpen_weights(w, valid)
    g = EqGrid(W, H, cfg.EQ_PAD)
    # windowed paint (INT-B): row bands with an overlap; global texel size + LIC statistics so the
    # bands are seamless. One-shot paint of the 4128x2080 padded grid peaked at 7.3 GB.
    tkm = g.texel_km()
    tk = float(np.median(tkm))
    kw = dict(ne2_window=max(3, int(round(5 * W / 4096)) | 1), lic_px=8.0 * W / 4096, tk=tk)
    rows, ov = g.shape[0], 48
    nb = 4
    edges = [round(rows * i / nb) for i in range(nb + 1)]

    def band(i, **extra):
        a0, b0 = max(0, edges[i] - ov), min(rows, edges[i + 1] + ov)
        return a0, b0, paint(sw[a0:b0], valid[a0:b0], A[a0:b0, :, CH_NE2], A[a0:b0, :, CH_ELEV], g.sub_dirs(a0, b0, 1),
                             tkm[a0:b0], pal, **kw, **extra)

    st: list = []
    for i in range(nb):
        s0 = max(0, edges[i] - ov)
        band(i, stats_rows=(edges[i] - s0, edges[i + 1] - s0), stats_out=st)
    n = sum(x[2] for x in st)
    mu = sum(x[0] for x in st) / n
    sd = math.sqrt(max(sum(x[1] for x in st) / n - mu * mu, 1e-12))
    lin = np.zeros(g.shape + (3,), np.float32)
    cap = np.zeros(g.shape, np.float32)
    for i in range(nb):
        a0, b0, (li, ca) = band(i, lic_stats=(mu, sd))
        c0, c1 = edges[i] - a0, edges[i + 1] - a0
        lin[edges[i]:edges[i + 1]] = li[c0:c1]
        cap[edges[i]:edges[i + 1]] = ca[c0:c1]
        del li, ca
    lin, cap, sw = g.crop(lin), g.crop(cap), g.crop(sw)
    land = g.crop(land)
    elev = g.crop(A[..., CH_ELEV])
    del A
    rel = pal["relief"]
    # D2 physical layers (lowdata 2048: R coast SDF, G bathy, B snow) upsampled
    ld = load_rgb(cfg.phys / "eq" / ("lowdata_512x256.png" if cfg.quick else "lowdata_2048x1024.png")).astype(np.float32)
    ldu = upsample_eq(ld, W, H)
    sd_km = (ldu[..., 0] / 255.0 - 0.5) * 256.0
    depth = (ldu[..., 1] / 255.0) ** 2 * 11000.0
    snow = ldu[..., 2] / 255.0
    lat = 90.0 - (np.arange(H) + 0.5) * 180.0 / H
    dy = math.pi * 6371000.0 / H
    dx = (2 * math.pi * 6371000.0 / W * np.maximum(np.cos(np.radians(lat)), 0.02))[:, None]
    # relief: z = exag * sqrt(h/1000 m) km on land; 0.35x that on the sea floor
    h_land = np.maximum(elev, 0.0)
    z = rel["exag"] * np.sqrt(h_land / 1000.0) * 1000.0
    z_sea = -rel["seaFloorScale"] * rel["exag"] * np.sqrt(np.maximum(depth, 0) / 1000.0) * 1000.0
    lw = np.clip(land, 0, 1)
    zz = lw * z + (1 - lw) * z_sea
    sh = hillshade(cv2.GaussianBlur(zz.astype(np.float32), (0, 0), 0.7), dx, dy, rel["lightAzDeg"], rel["lightAltDeg"])
    gain = 1.6
    shade_land = np.clip(1 + (sh - 1) * gain, rel["min"], rel["max"])
    shade_sea = np.clip(1 + (sh - 1) * 0.8, 0.86, 1.08)
    # water colour ramp (OKLab interpolation)
    sea = pal["sea"]
    lab_sh, lab_dp, lab_ab = (linear_to_oklab(sea[k][None])[0] for k in ("shelf", "deep", "abyss"))
    t1 = smoothstep(120.0, 1800.0, depth)[..., None]
    t2 = smoothstep(3500.0, 6500.0, depth)[..., None]
    wlab = lab_sh * (1 - t1) + lab_dp * t1
    wlab = wlab * (1 - t2) + lab_ab * t2
    water = oklab_to_linear(wlab.reshape(-1, 3)).reshape(H, W, 3) * shade_sea[..., None]
    # lakes: lake colour where water inside the coast mask
    lake_lin = sea["lake"]
    inland = smoothstep(-2.0, 2.0, sd_km)[..., None]  # inside land-with-lakes
    water = water * (1 - inland) + lake_lin[None, None] * inland
    # coast light line just offshore
    cl = (1 - smoothstep(0.0, 9.0, -sd_km)) * (sd_km < 1.0) * (1 - inland[..., 0]) * 0.55
    water = water * (1 - cl[..., None]) + sea["coastLine"][None, None] * cl[..., None]
    # land: albedo x relief, permanent snow, rivers
    landc = lin * shade_land[..., None]
    ice_lin = 0.5 * (pal["light"][ICE] + pal["dark"][ICE])
    perm = smoothstep(0.93, 0.97, snow)[..., None]
    landc = landc * (1 - perm) + (ice_lin[None, None] * shade_land[..., None]) * perm
    riv = draw_rivers_eq(W, H, 5)[..., None] * 0.9
    landc = landc * (1 - riv) + sea["river"][None, None] * riv
    capm = np.maximum(cap, np.where(perm[..., 0] > 0.5, pal["iceCap"], 0)).astype(np.float32)
    landc = apply_luma_cap(np.clip(landc, 0, 1), capm, pal["knee"])
    out = landc * lw[..., None] + water * (1 - lw[..., None])
    out = np.clip(out, 0, 1).astype(np.float32)
    save_png_rgb(to_srgb8(out), cfg.out / "eq" / f"low_albedo_{W}x{H}.png")
    save_png_rgb(to_srgb8(box_reduce(out, 2)), cfg.out / "eq" / f"preview_albedo_{W // 2}x{H // 2}.png")
    print(f"  LOW albedo {W}x{H}: {time.time() - t:.0f}s")


# ----------------------------------------------------------------------------- quicklooks


def load_cube(cfg: Cfg, layer: str, n: int, base: Path | None = None) -> list[np.ndarray]:
    b = base or cfg.out
    return [load_rgb(b / "cube" / f"{layer}_{n}_{f}.png") for f in FACES]


def cube_sample(faces, d, ch=None) -> np.ndarray:
    """Bilinear sample of six faces at directions d (..., 3)."""
    f, s, t = dirs_to_face_uv(d)
    n = faces[0].shape[0]
    c, r = face_uv_to_texel(s, t, n)
    shp = d.shape[:-1] + ((faces[0].shape[2],) if ch is None else ())
    out = np.zeros(shp, np.float32)
    for k in range(6):
        m = f == k
        if not m.any():
            continue
        a = faces[k].astype(np.float32) if ch is None else faces[k][..., ch].astype(np.float32)
        cc, rr = np.clip(c[m], 0, n - 1.001), np.clip(r[m], 0, n - 1.001)
        c0, r0 = np.floor(cc).astype(int), np.floor(rr).astype(int)
        tc, tr = cc - c0, rr - r0
        if a.ndim == 3:
            tc, tr = tc[:, None], tr[:, None]
        out[m] = (a[r0, c0] * (1 - tc) + a[r0, c0 + 1] * tc) * (1 - tr) + (a[r0 + 1, c0] * (1 - tc) + a[r0 + 1, c0 + 1] * tc) * tr
    return out


REGIONS = {
    "alps": (46.3, 9.5, 1300), "himalaya": (29.5, 85.0, 2600), "sahara": (22.0, 10.0, 5200),
    "amazon": (-5.0, -60.0, 4200), "nile_delta": (29.5, 31.5, 900), "greenland": (72.0, -42.0, 3600),
    "shelf_northsea": (55.0, 4.0, 2200), "europe": (47.0, 12.0, 6000), "aegean": (38.5, 24.5, 1200),
    "scandinavia": (63.0, 16.0, 2600), "australia": (-25.0, 134.0, 5200),
}


def view_dirs(lat0, lon0, span_km, size):
    """Orthographic-ish (gnomonic) view centred on lat0/lon0 spanning span_km horizontally."""
    c = latlon_to_dirs(np.float64(lat0), np.float64(lon0))
    east = np.array([-math.sin(math.radians(lon0)), 0.0, -math.cos(math.radians(lon0))])
    north = np.cross(c, east)
    half = math.tan(span_km / 2 / R_KM)
    u = np.linspace(-half, half, size)
    v = np.linspace(half, -half, size)
    U, V = np.meshgrid(u, v)
    d = c[None, None] + U[..., None] * east[None, None] + V[..., None] * north[None, None]
    return d / np.linalg.norm(d, axis=-1, keepdims=True)


def region_quicklooks(cfg: Cfg, pal: dict, size: int = 900):
    """Globe-region crops of what C2b will roughly draw: cube albedo x relief (from heightHi, NW light)
    x a day term, water from the terrain cube (coast SDF + bathy ramp), permanent snow; and the
    same crop of the LOW equirect for comparison."""
    n_al = cfg.NA
    alb = load_cube(cfg, "albedo", n_al)
    terr = load_cube(cfg, "terrain", 256 if cfg.quick else 1024, cfg.phys)
    hyd = load_cube(cfg, "hydro", 256 if cfg.quick else 1024, cfg.phys)
    hhi = load_cube(cfg, "heightHi", 256 if cfg.quick else 2048, cfg.phys)
    low = load_rgb(cfg.out / "eq" / f"low_albedo_{cfg.EQ[0]}x{cfg.EQ[1]}.png")
    sea = pal["sea"]
    labs = [linear_to_oklab(sea[k][None])[0] for k in ("shelf", "deep", "abyss")]
    for name, (la, lo, span) in REGIONS.items():
        d = view_dirs(la, lo, span, size)
        a = srgb_to_linear(cube_sample(alb, d) / 255.0)
        hraw = cube_sample(hhi, d, 0)
        h = (hraw / 255.0) ** 2 * 9000.0
        sd = (cube_sample(terr, d, 2) / 255.0 - 0.5) * 256.0
        depth = (cube_sample(terr, d, 1) / 255.0) ** 2 * 11000.0
        snow = cube_sample(hyd, d, 2) / 255.0
        lake = (cube_sample(hyd, d, 1) / 255.0 - 0.5) * 128.0
        river = cube_sample(hyd, d, 0) / 255.0
        px_km = span / size
        z = 3.0 * np.sqrt(h / 1000.0) * 1000.0
        sh = hillshade(z, px_km * 1000.0, px_km * 1000.0)
        shade = np.clip(1 + (sh - 1) * 1.6, 0.62, 1.15)
        perm = smoothstep(0.93, 0.97, snow)[..., None]
        ice_lin = 0.5 * (pal["light"][ICE] + pal["dark"][ICE])
        landc = a * (1 - perm) + ice_lin * perm
        rv = smoothstep(0.55, 0.9, river)[..., None] * 0.85
        landc = landc * (1 - rv) + sea["river"] * rv
        landc = landc * shade[..., None]
        t1 = smoothstep(120.0, 1800.0, depth)[..., None]
        t2 = smoothstep(3500.0, 6500.0, depth)[..., None]
        wl = labs[0] * (1 - t1) + labs[1] * t1
        wl = wl * (1 - t2) + labs[2] * t2
        water = oklab_to_linear(wl.reshape(-1, 3)).reshape(wl.shape)
        lk = smoothstep(-1.0, 1.0, lake)[..., None]
        water = water * (1 - lk) + sea["lake"] * lk
        aa = px_km * 0.75
        lw = smoothstep(-aa, aa, sd)[..., None] * (1 - lk)
        img = landc * lw + water * (1 - lw)
        cube_rgb = to_srgb8(np.clip(img, 0, 1))
        # LOW crop
        lat, lon = dirs_to_latlon(d)
        lowc = sample(low, lat, lon, "bilinear")
        both = np.concatenate([cube_rgb, np.clip(np.rint(lowc), 0, 255).astype(np.uint8)], axis=1)
        save_png_rgb(both, QL / (f"paint_quick_region_{name}.png" if cfg.quick else f"paint_region_{name}.png"))
    print(f"  region quicklooks -> {QL}/paint_region_*.png (left: cube path, right: LOW)")


def quicklooks(cfg: Cfg):
    w, h = (1024, 512) if cfg.quick else (2048, 1024)
    alb = load_cube(cfg, "albedo", cfg.NA // 2)
    eq = cube_to_equirect([a.astype(np.float32) for a in alb], w, h)
    save_png_rgb(np.clip(np.rint(eq), 0, 255).astype(np.uint8), cfg.ql("albedo"))
    kc = load_cube(cfg, "koppencolor", cfg.NS[1])
    eq = cube_to_equirect([a.astype(np.float32) for a in kc], w, h)
    save_png_rgb(np.clip(np.rint(eq), 0, 255).astype(np.uint8), cfg.ql("koppencolor"))
    low = load_rgb(cfg.out / "eq" / f"low_albedo_{cfg.EQ[0]}x{cfg.EQ[1]}.png")
    save_png_rgb(np.asarray(Image.fromarray(low).resize((w, h), Image.BOX)), cfg.ql("low"))


# ----------------------------------------------------------------------------- checks


def oklab_L_of_srgb8(img: np.ndarray) -> np.ndarray:
    return linear_to_oklab(srgb_to_linear(img.reshape(-1, 3) / 255.0))[:, 0].reshape(img.shape[:2])


def checks(cfg: Cfg) -> bool:
    ok_all = True

    def report(name, ok, detail):
        nonlocal ok_all
        ok_all &= bool(ok)
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}: {detail}")

    o = cfg.out
    need = [f"cube/albedo_{n}_{f}.png" for n in (cfg.NA, cfg.NA // 2) for f in FACES]
    need += [f"cube/koppencolor_{n}_{f}.png" for n in cfg.NS for f in FACES]
    eqn = (512, 256) if cfg.quick else (2048, 1024)
    need += [f"eq/koppencolor_{eqn[0]}x{eqn[1]}.png", f"eq/low_albedo_{cfg.EQ[0]}x{cfg.EQ[1]}.png",
             f"eq/preview_albedo_{cfg.EQ[0] // 2}x{cfg.EQ[1] // 2}.png", f"eq/trees_{cfg.EQ[0]}x{cfg.EQ[1]}.png"]
    miss = [x for x in need if not (o / x).exists()]
    report("outputs exist", not miss, f"{len(need) - len(miss)}/{len(need)} {miss[:4]}")

    # luminance: land p99 (non-ice) and ice p99, from the 1024 albedo + 1024 splats (ice weight)
    n = cfg.NA // 2
    Ls, Li, Lsah = [], [], []
    sah_dirs = []
    for fi, f in enumerate(FACES):
        img = load_rgb(o / "cube" / f"albedo_{n}_{f}.png")
        L = oklab_L_of_srgb8(img)
        C = load_rgb(o / "cube" / f"splatC_{cfg.NS[1]}_{f}.png")
        A = load_rgb(o / "cube" / f"splatA_{cfg.NS[1]}_{f}.png")
        B = load_rgb(o / "cube" / f"splatB_{cfg.NS[1]}_{f}.png")
        if C.shape[0] != n:
            k = n // C.shape[0]
            C, A, B = (np.repeat(np.repeat(x, k, 0), k, 1) if k > 1 else x[::-k, ::-k] for x in (C, A, B))
        land = (A.astype(int).sum(-1) + B.astype(int).sum(-1) + C.astype(int).sum(-1)) > 0
        ice = C[..., 2] > 127
        Ls.append(L[land & ~ice])
        Li.append(L[land & ice])
        g = FaceGrid(fi, n, 0)
        lat, lon = dirs_to_latlon(g.dirs())
        sah = land & ~ice & (((lat > 15) & (lat < 32) & (lon > -15) & (lon < 35)) | ((lat > 15) & (lat < 31) & (lon > 36) & (lon < 58)))
        Lsah.append(L[sah])
    Ls, Li, Lsah = np.concatenate(Ls), np.concatenate(Li), np.concatenate(Lsah)
    p99, p99i, p99s = float(np.percentile(Ls, 99)), float(np.percentile(Li, 99)) if Li.size else 0, float(np.percentile(Lsah, 99))
    report("OKLab L p99 land <= 0.665 (Sahara+Arabia <= 0.665), ice <= 0.87", p99 <= 0.665 and p99s <= 0.665 and p99i <= 0.87,
           f"land p99 {p99:.4f} (median {np.median(Ls):.3f}), Sahara/Arabia p99 {p99s:.4f} (median {np.median(Lsah):.3f}), ice p99 {p99i:.4f}")
    low = load_rgb(o / "eq" / f"low_albedo_{cfg.EQ[0]}x{cfg.EQ[1]}.png")
    Lw = oklab_L_of_srgb8(low)
    Hh, Ww = Lw.shape
    lat = 90 - (np.arange(Hh) + 0.5) * 180 / Hh
    ld = load_rgb(cfg.phys / "eq" / ("lowdata_512x256.png" if cfg.quick else "lowdata_2048x1024.png"))
    ldu = upsample_eq(ld.astype(np.float32), Ww, Hh)
    ocean = (ldu[..., 0] < 100) & (np.abs(lat)[:, None] < 70)
    shelf = ocean & (ldu[..., 1] < 255 * math.sqrt(200 / 11000))
    deep = ocean & (ldu[..., 1] > 255 * math.sqrt(3000 / 11000)) & (ldu[..., 1] < 255 * math.sqrt(5000 / 11000))
    lab = linear_to_oklab(srgb_to_linear(low[ocean].reshape(-1, 3) / 255.0))
    hue = (np.degrees(np.arctan2(lab[:, 2], lab[:, 1])) + 360) % 360
    report("LOW sea: mean OKLab L ~0.34, hue 240-250", abs(float(Lw[ocean].mean()) - 0.34) < 0.03 and 235 <= float(np.median(hue)) <= 255,
           f"sea mean L {Lw[ocean].mean():.3f}, shelf {Lw[shelf].mean():.3f}, 3-5 km {Lw[deep].mean():.3f}, median hue {np.median(hue):.1f}")
    landL = Lw[(ldu[..., 0] > 160) & (np.abs(lat)[:, None] < 60)]
    report("LOW land L p99 <= 0.665", float(np.percentile(landL, 99)) <= 0.665, f"p99 {np.percentile(landL, 99):.4f}")

    # seams: albedo 1024 (8-texel strips, per channel)
    alb = load_cube(cfg, "albedo", n)
    worst = []
    for ch in range(3):
        rep = seam_report([a[..., ch].astype(np.float32) for a in alb], strip=8)
        worst.append((max(r[1] for r in rep), max(r[2] for r in rep), float(np.mean([r[3] for r in rep])),
                      float(np.mean([r[4] for r in rep]))))
    ok = all(w[0] <= 3 or w[0] <= w[1] + 1 for w in worst)
    report("albedo seams (8-texel strips) <= 3 LSB or within interior", ok,
           "; ".join(f"ch{i}: seam max {w[0]:.1f} mean {w[2]:.2f} / interior max {w[1]:.1f} mean {w[3]:.2f}" for i, w in enumerate(worst)))
    for nm in ("albedo", "low", "koppencolor", "argmax"):
        print(f"    quicklook {cfg.ql(nm)}")
    return ok_all


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--faces", default="0,1,2,3,4,5")
    ap.add_argument("--only", choices=["faces", "koppen", "low", "ql", "none"], default=None)
    ap.add_argument("--no-ql", action="store_true", help="skip quicklooks (windowed per-face runs; run --only ql once at the end)")
    a = ap.parse_args()
    cfg = Cfg(a.quick)
    pal = load_palette()
    # publish the derived hex values for C6/INT (palette.json is D3-owned)
    pj = ROOT / "scripts" / "terrain" / "palette.json"
    raw = json.loads(pj.read_text())
    hx = palette_hex_block(pal)
    if raw.get("hex") != hx:
        raw["hex"] = hx
        raw["hexNote"] = "sRGB hex of each class's OKLCH light/dark (generated by bake_albedo.py)"
        pj.write_text(json.dumps(raw, indent=2, ensure_ascii=False) + "\n")
    t0 = time.time()
    do = a.only or ("all" if (a.all or a.quick) else "none")
    if do != "none":
        M = Masters(cfg)
        if do in ("all", "faces"):
            for f in [int(x) for x in a.faces.split(",")]:
                face_albedo(cfg, M, f, pal)
        if do in ("all", "koppen"):
            koppen_faces(cfg, pal)
            koppen_equirect(cfg, M, pal)
        if do in ("all", "low"):
            low_albedo(cfg, M, pal)
        if do in ("all", "ql", "low", "faces") and not a.no_ql:
            quicklooks(cfg)
            region_quicklooks(cfg, pal)
    ok = checks(cfg) if (a.check or a.quick) else True
    print(f"bake_albedo {'quick' if a.quick else 'full'}: {time.time() - t0:.0f}s {'OK' if ok else 'CHECKS FAILED'}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
