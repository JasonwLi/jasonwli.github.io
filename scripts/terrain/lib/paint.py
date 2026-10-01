"""D3 painting helpers: colour (sRGB/linear/OKLab/OKLCH), seam-free 3D noise, Worley cells,
the 9-class splat-weight model, the crisp-edge sharpening, and grid abstractions shared by the
cube faces and the LOW equirect.

All colour maths runs in LINEAR light (OKLab is computed from linear sRGB); sRGB encoding only
happens when an image is written. Noise is a function of the unit direction (3D lattice on the
sphere scaled to km), so it is continuous across cube seams and the antimeridian.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from .cube import st_to_dirs, texel_st

ROOT = Path(__file__).resolve().parents[3]
R_KM = 6371.0
CLASSES = ("forest", "jungle", "grass", "farm", "steppe", "desert", "rock", "marsh", "ice")
NC = 9
FOREST, JUNGLE, GRASS, FARM, STEPPE, DESERT, ROCK, MARSH, ICE = range(9)

# ----------------------------------------------------------------------------- colour


def srgb_to_linear(c):
    c = np.asarray(c, np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(np.asarray(c, np.float64), 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


_M1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929],
                [0.2119034982, 0.6806995451, 0.1073969566],
                [0.0883024619, 0.2817188376, 0.6299787005]])
_M2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468],
                [1.9779984951, -2.4285922050, 0.4505937099],
                [0.0259040371, 0.7827717662, -0.8086757660]])
_M2i = np.linalg.inv(_M2)
_M1i = np.linalg.inv(_M1)


def linear_to_oklab(rgb):
    lms = np.asarray(rgb, np.float64) @ _M1.T
    lms = np.cbrt(lms)
    return lms @ _M2.T


def oklab_to_linear(lab):
    lms = np.asarray(lab, np.float64) @ _M2i.T
    return (lms ** 3) @ _M1i.T


def oklch_to_oklab(L, C, h_deg):
    h = math.radians(h_deg)
    return np.array([L, C * math.cos(h), C * math.sin(h)])


def oklch_to_linear(lch) -> np.ndarray:
    return oklab_to_linear(oklch_to_oklab(*lch)[None])[0]


def linear_to_hex(lin) -> str:
    s = np.clip(np.rint(linear_to_srgb(np.clip(lin, 0, 1)) * 255), 0, 255).astype(int)
    return "#%02x%02x%02x" % tuple(s)


def hex_to_linear(hx: str) -> np.ndarray:
    hx = hx.lstrip("#")
    return srgb_to_linear(np.array([int(hx[i : i + 2], 16) for i in (0, 2, 4)]) / 255.0)


def gamut_clip_linear(rgb):
    """Bring out-of-gamut linear colours back by reducing chroma toward the same-L grey (in OKLab)."""
    rgb = np.asarray(rgb, np.float64)
    bad = (rgb < 0).any(-1) | (rgb > 1).any(-1)
    if not bad.any():
        return rgb
    out = rgb.copy()
    sub = rgb[bad]
    # OKLab of the possibly-out-of-gamut colour (cbrt handles negatives)
    lab = linear_to_oklab(sub)
    lo, hi = np.zeros(len(sub)), np.ones(len(sub))
    for _ in range(14):
        mid = 0.5 * (lo + hi)
        t = lab.copy()
        t[:, 1:] *= mid[:, None]
        c = oklab_to_linear(t)
        ok = (c >= -1e-6).all(-1) & (c <= 1 + 1e-6).all(-1)
        lo = np.where(ok, mid, lo)
        hi = np.where(ok, hi, mid)
    t = lab.copy()
    t[:, 1:] *= lo[:, None]
    out[bad] = np.clip(oklab_to_linear(t), 0, 1)
    return out


def soft_cap_L(L, cap, knee):
    """Soft-knee luminance cap: identity below cap-knee, asymptotic to cap above (keeps variation)."""
    k0 = cap - knee
    over = np.maximum(L - k0, 0.0)
    return np.where(L > k0, k0 + knee * np.tanh(over / knee), L)


def apply_luma_cap(lin_rgb, cap_map, knee):
    """Cap OKLab L per pixel (cap_map broadcastable), keep a/b (chroma), clip to gamut. Linear in/out."""
    shp = lin_rgb.shape
    lab = linear_to_oklab(lin_rgb.reshape(-1, 3))
    cap = np.broadcast_to(cap_map, shp[:-1]).reshape(-1)
    lab[:, 0] = soft_cap_L(lab[:, 0], cap, knee)
    out = gamut_clip_linear(oklab_to_linear(lab))
    return out.reshape(shp)


def to_srgb8(lin):
    return np.clip(np.rint(linear_to_srgb(lin) * 255.0), 0, 255).astype(np.uint8)


# ----------------------------------------------------------------------------- palette


def load_palette() -> dict:
    p = json.loads((ROOT / "scripts" / "terrain" / "palette.json").read_text())
    light = np.stack([oklch_to_linear(p["classes"][c]["light"]) for c in CLASSES])
    dark = np.stack([oklch_to_linear(p["classes"][c]["dark"]) for c in CLASSES])
    jit = np.array([p["classes"][c]["jitter"] for c in CLASSES])
    sea = {k: oklch_to_linear(v) for k, v in p["sea"].items()}
    return {"raw": p, "light": light, "dark": dark, "jitter": jit, "sea": sea,
            "oceanFill": oklch_to_linear(p["oceanFill"]), "lumaCap": p["lumaCap"], "iceCap": p["iceCap"],
            "knee": p["capKnee"], "koppenOcean": hex_to_linear(p["koppenOcean"]), "relief": p["relief"]}


def palette_hex_block(pal: dict) -> dict:
    return {c: {"light": linear_to_hex(pal["light"][i]), "dark": linear_to_hex(pal["dark"][i])} for i, c in enumerate(CLASSES)}


# ----------------------------------------------------------------------------- noise


def _hash3(ix, iy, iz, seed: int):
    """uint32 hash of integer lattice coords -> float in [0, 1)."""
    x = (ix.astype(np.int64) * 73856093) ^ (iy.astype(np.int64) * 19349663) ^ (iz.astype(np.int64) * 83492791) ^ (seed * 2654435761)
    x = x & 0xFFFFFFFF
    x = (x ^ (x >> 16)) * 0x45D9F3B & 0xFFFFFFFF
    x = (x ^ (x >> 16)) * 0x45D9F3B & 0xFFFFFFFF
    x = x ^ (x >> 16)
    return (x & 0xFFFFFF).astype(np.float32) / np.float32(0x1000000)


def value_noise3(p, seed: int = 0):
    """Smooth 3D value noise in [0, 1] at points p (..., 3) (lattice spacing 1)."""
    p = np.asarray(p, np.float64)
    i0 = np.floor(p).astype(np.int64)
    f = (p - i0).astype(np.float32)
    u = f * f * (3 - 2 * f)
    out = np.zeros(p.shape[:-1], np.float32)
    for dz in (0, 1):
        wz = u[..., 2] if dz else 1 - u[..., 2]
        for dy in (0, 1):
            wy = u[..., 1] if dy else 1 - u[..., 1]
            for dx in (0, 1):
                wx = u[..., 0] if dx else 1 - u[..., 0]
                out += wx * wy * wz * _hash3(i0[..., 0] + dx, i0[..., 1] + dy, i0[..., 2] + dz, seed)
    return out


def fbm_dirs(dirs, wavelength_km: float, octaves: int = 2, seed: int = 0, gain: float = 0.5):
    """fBm in [-1, 1] (roughly) of unit directions at a base wavelength in km."""
    p = np.asarray(dirs, np.float64) * (R_KM / wavelength_km)
    tot, amp, acc = 0.0, 1.0, np.zeros(p.shape[:-1], np.float32)
    for o in range(octaves):
        acc += amp * (value_noise3(p * (2 ** o), seed + 101 * o) * 2 - 1)
        tot += amp
        amp *= gain
    return acc / tot


def warp_dirs(dirs, amp_km=6.0, wavelength_km=60.0, seed=11):
    """Domain warp: displace unit directions by a 2-octave fBm vector field (amp km), renormalise."""
    d = np.asarray(dirs, np.float64)
    off = np.stack([fbm_dirs(d, wavelength_km, 2, seed + k) for k in range(3)], -1).astype(np.float64)
    d2 = d + off * (amp_km / R_KM) * 1.7  # fbm std ~0.35 -> rms displacement ~amp
    return d2 / np.linalg.norm(d2, axis=-1, keepdims=True)


def worley_cells(dirs, cell_km: float, seed: int = 5):
    """3D Worley (nearest jittered feature per lattice cell, 27 neighbours): returns a per-cell
    hash in [0, 1) and a second independent hash, both constant within a cell."""
    p = np.asarray(dirs, np.float64) * (R_KM / cell_km)
    b = np.floor(p).astype(np.int64)
    best = np.full(p.shape[:-1], np.inf, np.float32)
    bid = [np.zeros(p.shape[:-1], np.int64) for _ in range(3)]
    for dz in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                cx, cy, cz = b[..., 0] + dx, b[..., 1] + dy, b[..., 2] + dz
                fx = cx + _hash3(cx, cy, cz, seed)
                fy = cy + _hash3(cx, cy, cz, seed + 1)
                fz = cz + _hash3(cx, cy, cz, seed + 2)
                d = ((p[..., 0] - fx) ** 2 + (p[..., 1] - fy) ** 2 + (p[..., 2] - fz) ** 2).astype(np.float32)
                m = d < best
                best = np.where(m, d, best)
                for k, c in enumerate((cx, cy, cz)):
                    bid[k] = np.where(m, c, bid[k])
    return _hash3(bid[0], bid[1], bid[2], seed + 7), _hash3(bid[0], bid[1], bid[2], seed + 9)


# ----------------------------------------------------------------------------- class model


def smoothstep(e0, e1, x):
    t = np.clip((np.asarray(x, np.float32) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def igbp_base_weights(igbp, kop):
    """(..., 9) base weights from IGBP 1..16 (filled) and Köppen 1..30 (plan D3 table)."""
    g = np.asarray(igbp).astype(np.int64)
    k = np.asarray(kop).astype(np.int64)
    w = np.zeros(g.shape + (NC,), np.float32)
    A = (k >= 1) & (k <= 3)
    B = (k >= 4) & (k <= 7)
    BW = (k == 4) | (k == 5)
    BS = (k == 6) | (k == 7)

    def put(mask, cls, val):
        w[..., cls] += np.where(mask, val, 0).astype(np.float32)

    put((g == 1) | (g == 3) | (g == 4) | (g == 5), FOREST, 1)
    put((g == 2) & A, JUNGLE, 1)
    put((g == 2) & ~A, FOREST, 1)
    put(g == 6, STEPPE, .6)
    put(g == 6, GRASS, .4)
    put((g == 7) & B, STEPPE, .6)
    put((g == 7) & B, DESERT, .4)
    put((g == 7) & ~B, STEPPE, .7)
    put((g == 7) & ~B, GRASS, .3)
    # IGBP 8 in boreal climates (Köppen Ds/Dw/Df) is open larch/spruce taiga, not savanna: paint it
    # as forest (D3 deviation: the plan's grass .5 / forest .3 / steppe .2 turned Siberia yellow-green)
    BOREAL = (k >= 17) & (k <= 28)
    put((g == 8) & ~BOREAL, GRASS, .5)
    put((g == 8) & ~BOREAL, FOREST, .3)
    put((g == 8) & ~BOREAL, STEPPE, .2)
    put((g == 8) & BOREAL, FOREST, .65)
    put((g == 8) & BOREAL, GRASS, .35)
    put(g == 9, GRASS, .5)
    put(g == 9, STEPPE, .5)
    put((g == 10) & (BS | BW), STEPPE, 1)
    put((g == 10) & ~(BS | BW), GRASS, 1)
    put(g == 11, MARSH, 1)
    put(g == 12, FARM, 1)
    put(g == 13, FARM, .5)
    put(g == 13, GRASS, .5)
    put(g == 14, FARM, .6)
    put(g == 14, GRASS, .4)
    put(g == 15, ICE, 1)
    put((g == 16) & BW, DESERT, 1)
    put((g == 16) & ~BW, ROCK, .7)
    put((g == 16) & ~BW, DESERT, .3)
    # anything left (should not happen after the fill): grass
    s = w.sum(-1)
    w[..., GRASS] += np.where(s <= 0, 1, 0).astype(np.float32)
    return w


def class_weights(igbp, kop, glac, shelf, playa, slope_deg, elev_m, lat):
    """Per-sample 9-class weights with the plan modifiers (ET tundra, EF, glaciers, playas, rock)."""
    w = igbp_base_weights(igbp, kop)
    k = np.asarray(kop).astype(np.int64)
    et = k == 29
    ef = k == 30
    tundra = np.zeros_like(w)
    tundra[..., ICE], tundra[..., ROCK], tundra[..., GRASS] = .3, .3, .4
    w = np.where(et[..., None], tundra, w)
    ice1 = np.zeros_like(w)
    ice1[..., ICE] = 1
    ice = ef | (np.maximum(glac, shelf) >= 0.5)
    w = np.where(ice[..., None], ice1, w)
    des = np.zeros_like(w)
    des[..., DESERT] = 1
    w = np.where(((playa >= 0.5) & ~ice)[..., None], des, w)
    tl = 4200.0 - 55.0 * np.abs(lat)
    rock = np.maximum(smoothstep(15.0, 21.0, slope_deg), smoothstep(tl, tl + 300.0, elev_m))
    rock = np.where(ice, 0, rock).astype(np.float32)[..., None]
    rk = np.zeros_like(w)
    rk[..., ROCK] = 1
    return w * (1 - rock) + rk * rock


def tree_density(igbp, kop):
    """(..., 3) conifer, broadleaf, palm densities from IGBP/Köppen (plan D3 trees)."""
    g = np.asarray(igbp).astype(np.int64)
    k = np.asarray(kop).astype(np.int64)
    A = (k >= 1) & (k <= 3)
    t = np.zeros(g.shape + (3,), np.float32)
    boreal = (k >= 17) & (k <= 28)
    t[..., 0] = np.where((g == 1) | (g == 3), 1, 0) + np.where(g == 5, .5, 0) + np.where((g == 8) & boreal, .5, 0)
    t[..., 1] = (np.where((g == 2) & ~A, 1, 0) + np.where(g == 4, 1, 0) + np.where(g == 5, .5, 0)
                 + np.where((g == 8) & ~boreal, .35, 0) + np.where(g == 9, .15, 0))
    t[..., 2] = np.where((g == 2) & A, 1, 0)
    return t


# ----------------------------------------------------------------------------- sharpening


def _blur1(a):
    """3x3 binomial blur (edge-replicated)."""
    import cv2

    k = np.array([1, 2, 1], np.float32) / 4
    return cv2.sepFilter2D(a.astype(np.float32), -1, k, k, borderType=cv2.BORDER_REPLICATE)


def mode3(labels: np.ndarray, nclass: int) -> np.ndarray:
    """3x3 majority filter of an int label image (edge replicated); ties keep the centre."""
    h, w = labels.shape
    P = np.pad(labels, 1, mode="edge")
    counts = np.zeros((nclass, h, w), np.int16)
    for dy in range(3):
        for dx in range(3):
            v = P[dy : dy + h, dx : dx + w]
            for c in range(nclass):
                counts[c] += (v == c)
    best = counts.argmax(0)
    centre_count = np.take_along_axis(counts, labels[None].astype(np.int64), 0)[0]
    return np.where(centre_count >= counts.max(0), labels, best).astype(labels.dtype)


def sharpen_weights(raw: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Crisp painterly edges (plan D3): cube + renormalise, 3x3 mode filter on the argmax to kill
    speckle, re-soften with a 1-texel blur. final = norm(0.4 * cubed + 0.6 * blur(onehot(mode)))
    so genuine mixtures (tundra, savanna) survive while isolated speckle is suppressed."""
    w = np.clip(raw, 0, None) ** 3
    s = w.sum(-1, keepdims=True)
    w = np.where(s > 1e-12, w / np.maximum(s, 1e-12), 0)
    am = np.where(valid, w.argmax(-1), 0).astype(np.int16)
    am = mode3(am, NC)
    oh = np.zeros_like(w)
    for c in range(NC):
        oh[..., c] = _blur1((am == c).astype(np.float32))
    f = 0.4 * w + 0.6 * oh
    s = f.sum(-1, keepdims=True)
    return np.where(valid[..., None], f / np.maximum(s, 1e-12), 0).astype(np.float32)


def quantize_weights(w: np.ndarray, land: np.ndarray) -> np.ndarray:
    """(…, 9) float weights -> uint8 summing to exactly 255 on land (largest remainder), 0 on water."""
    x = np.clip(w, 0, None) * 255.0
    s = x.sum(-1, keepdims=True)
    x = np.where(s > 0, x * (255.0 / np.maximum(s, 1e-9)), 0)
    fl = np.floor(x)
    rem = x - fl
    need = (255 - fl.sum(-1)).astype(np.int64)
    order = np.argsort(-rem, axis=-1)
    q = fl.astype(np.int64)
    ranks = np.argsort(order, axis=-1)
    q += (ranks < need[..., None]).astype(np.int64)
    # land texels whose weights were all zero: should not happen; give grass
    zero = land & (q.sum(-1) == 0)
    q[zero, GRASS] = 255
    q[~land] = 0
    return q.astype(np.uint8)


# ----------------------------------------------------------------------------- grids


class FaceGrid:
    """Padded cube-face grid (n + 2 pad)^2; sub-sample directions at ss x ss per texel."""

    kind = "face"

    def __init__(self, face: int, n: int, pad: int):
        self.face, self.n, self.pad = face, n, pad
        self.m = n + 2 * pad
        self.shape = (self.m, self.m)

    def sub_dirs(self, r0: int, r1: int, ss: int) -> np.ndarray:
        nf, pf = self.n * ss, self.pad * ss
        s1, t1 = texel_st(nf, pf)
        s, t = np.meshgrid(s1, t1[r0 * ss : r1 * ss])
        return st_to_dirs(self.face, s, t)

    def dirs(self) -> np.ndarray:
        return self.sub_dirs(0, self.m, 1)

    def texel_km(self) -> np.ndarray:
        s1, t1 = texel_st(self.n, self.pad)
        s, t = np.meshgrid(s1, t1)
        return ((2.0 / self.n) / (1 + s * s + t * t) ** 0.75 * R_KM).astype(np.float32)

    def crop(self, a):
        p = self.pad
        return a[p:-p, p:-p] if p else a


class EqGrid:
    """Padded equirect grid (h + 2 pad, w + 2 pad): columns wrap in longitude, rows extend past the
    poles by clamping latitude. Row 0 = north, cell centres."""

    kind = "eq"

    def __init__(self, w: int, h: int, pad: int):
        self.w, self.h, self.pad = w, h, pad
        self.shape = (h + 2 * pad, w + 2 * pad)
        self.m = self.shape[0]

    def latlon(self, r0: int, r1: int, ss: int):
        W, H, P = self.w * ss, self.h * ss, self.pad * ss
        j = np.arange(r0 * ss, r1 * ss) - P
        i = np.arange(0, (self.w + 2 * self.pad) * ss) - P
        lat = np.clip(90.0 - (j + 0.5) * 180.0 / H, -89.999, 89.999)
        lon = -180.0 + (i + 0.5) * 360.0 / W
        return np.meshgrid(lat, lon, indexing="ij")

    def sub_dirs(self, r0: int, r1: int, ss: int) -> np.ndarray:
        lat, lon = self.latlon(r0, r1, ss)
        la, lo = np.radians(lat), np.radians(lon)
        c = np.cos(la)
        return np.stack([c * np.cos(lo), np.sin(la), -c * np.sin(lo)], -1)

    def dirs(self) -> np.ndarray:
        return self.sub_dirs(0, self.shape[0], 1)

    def texel_km(self) -> np.ndarray:
        lat, _ = self.latlon(0, self.shape[0], 1)
        dy = math.pi * R_KM / self.h
        dx = 2 * math.pi * R_KM / self.w * np.cos(np.radians(lat))
        return np.sqrt(dy * np.maximum(dx, 1e-3)).astype(np.float32)

    def crop(self, a):
        p = self.pad
        return a[p:-p, p:-p] if p else a


def area_grid(fn, grid, ss: int, band_px: int = 3_000_000) -> np.ndarray:
    """Evaluate fn(dirs, lat, lon) at ss x ss sub-samples of every padded texel; box-mean."""
    from .cube import dirs_to_latlon

    rows_total = grid.shape[0]
    wsub = grid.shape[1] * ss
    out_rows = max(1, band_px // (wsub * ss))
    out = None
    for o0 in range(0, rows_total, out_rows):
        o1 = min(rows_total, o0 + out_rows)
        d = grid.sub_dirs(o0, o1, ss)
        lat, lon = dirs_to_latlon(d)
        v = np.asarray(fn(d, lat, lon), np.float32)
        h = o1 - o0
        r = v.reshape(h, ss, grid.shape[1], ss, *v.shape[2:]).mean(axis=(1, 3))
        if out is None:
            out = np.empty(grid.shape + r.shape[2:], np.float32)
        out[o0:o1] = r
    return out
