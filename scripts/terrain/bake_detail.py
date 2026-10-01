#!/usr/bin/env python3
"""D4: bake the 9-layer LUMINANCE detail texture array (CC0 photo sources + procedural motifs).

Layer order == splat order (contracts: "The detail array layer order equals the splat order"):
    00 forest  01 jungle  02 grass  03 farm  04 steppe  05 desert  06 rock  07 marsh  08 ice
i.e. uSplatA=[forest,jungle,grass] uSplatB=[farm,steppe,desert] uSplatC=[rock,marsh,ice].

Pipeline per layer (working resolution WORK=1024, every filter is wrap-around so tiling holds):
  1. source  : CC0 photo (Poly Haven / ambientCG, cached in scripts/.cache/detail/raw/) or a
               procedural numpy texture (fBm / Worley / ridged / stripes) if the download fails.
               Some layers are HYBRID: the photo is mixed with a procedural motif that makes the
               class read at map scale (field patchwork for farm, ridged dunes for desert).
  2. decode  : sRGB -> linear, Rec.709 luminance Y = .2126 R + .7152 G + .0722 B.
  3. hipass  : Y / gaussian(Y, sigma = WORK/8)  (removes photo lighting gradients / vignetting).
  4. norm    : mean 0.5, std 0.11, clamp [0.2, 0.8].
  5. soften  : wrap-around bilateral filter (painterly, kills photographic speckle), then renorm.
  6. tile    : seam check; offset-and-blend repair if it fails.
  7. resize  : exact area average 1024 -> 512 (HIGH) and -> 256 (MID), each renormalised to
               mean 0.5 / std 0.11 / clamp [0.2, 0.8] so both tiers carry the same contrast.
  8. write   : gray-in-RGB 8-bit PNG, no alpha, no ICC/gAMA/sRGB/cHRM chunks (rules R3/R4):
               scripts/data/bake/detail/detail_{512,256}_{00..08}.png
               + contact sheet scripts/.cache/detail/contact_sheet.png
               + scripts/terrain/detail_sources.json (sources, licences, stats, D5/C2b notes).

Seam metric (documented because a raw neighbour difference is meaningless on textured noise):
    seam_excess = mean|I[:,0]-I[:,-1]| (and rows)  -  mean|I[:,x]-I[:,x+1]| (interior)
A seamless texture has seam_excess ~ 0 (the wrap pair behaves like any interior pair).
Acceptance: |seam_excess| < 0.02 on the 0..1 scale.  The raw wrap mean is reported too.

Usage:
    bake_detail.py            # fetch (cached) + bake + contact sheet + json + check
    bake_detail.py --check    # verify outputs only (exit 1 on failure)
    bake_detail.py --offline  # never touch the network (procedural for anything uncached)
    bake_detail.py --force-procedural forest,ice   # test the fallback path for some layers

Heavy step: run through ~/dev/dw3-lock (single-threaded numpy, ~1.5 GB peak, ~1 min).
Licences: every photo source is CC0 (Poly Haven, ambientCG); no attribution required, but
the credits entry "Poly Haven / ambientCG (CC0)" is kept in the manifest.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "scripts/.cache/detail"
RAW = CACHE / "raw"
OUT = ROOT / "scripts/data/bake/detail"
SOURCES_JSON = ROOT / "scripts/terrain/detail_sources.json"

WORK = 1024
SIZES = (512, 256)
MEAN, STD, LO, HI = 0.5, 0.11, 0.2, 0.8
SEAM_MAX = 0.02
SEED = 20261001
UA = ("jasonwli-personal-website-terrain-bake/1.0 "
      "(one-time CC0 detail texture fetch; https://jasonwli.github.io)")

LAYER_NAMES = ["forest", "jungle", "grass", "farm", "steppe", "desert", "rock", "marsh", "ice"]

PH_PAGE = "https://polyhaven.com/a/{id}"
ACG_PAGE = "https://ambientcg.com/view?id={id}"

# One source per layer. `mix` = weight of the procedural motif in a hybrid (0 = pure photo).
LAYERS: list[dict] = [
    dict(name="forest", provider="ambientcg", id="Moss002", author="ambientCG (Lennart Demes / Struffel Productions)",
         why="clumped moss grain over a procedural tree-crown stipple (brief P1 'canopy stipple')",
         motif="crowns", mix=0.5, smooth=1.6, fallback="crowns"),
    dict(name="jungle", provider="ambientcg", id="Moss004", author="ambientCG (Lennart Demes / Struffel Productions)",
         why="denser moss grain over smaller, merged procedural crowns = closed tropical canopy",
         motif="crowns_dense", mix=0.45, smooth=1.3, fallback="crowns_dense"),
    dict(name="grass", provider="polyhaven", id="grass_ground", author="Charlotte Baglioni",
         why="soft low-contrast meadow mottling",
         motif="fbm", mix=0.0, smooth=1.0, fallback="fbm"),
    dict(name="farm", provider="polyhaven", id="farm_furrows", author="Amal Kumar",
         why="ploughed-furrow grain, laid into a procedural field patchwork so it reads as fields",
         motif="fields", mix=0.75, smooth=0.8, fallback="fields"),
    dict(name="steppe", provider="polyhaven", id="rocky_terrain_02", author="Amal Kumar",
         why="aerial (drone) open grassland with scattered stone clusters",
         motif="fbm_streak", mix=0.0, smooth=0.8, fallback="fbm_streak"),
    dict(name="desert", provider="polyhaven", id="aerial_beach_01", author="Rob Tuytel",
         why="aerial wind ripples, overlaid on procedural ridged dunes for map-scale dune crests",
         motif="dunes", mix=0.7, smooth=0.8, fallback="dunes"),
    dict(name="rock", provider="polyhaven", id="marble_cliff_02", author="Amal Kumar",
         why="aerial cracked cliff: fractured crags",
         motif="worley", mix=0.0, smooth=0.7, fallback="worley"),
    dict(name="marsh", provider="polyhaven", id="brown_mud_03", author="Rob Tuytel",
         why="wet mud with pooled patches; pools emphasised as dark speckle",
         motif="pools", mix=0.35, smooth=0.9, fallback="pools"),
    dict(name="ice", provider="ambientcg", id="Snow010A", author="ambientCG (Lennart Demes / Struffel Productions)",
         why="wind-packed snow grain, laid over procedural wind-streak sastrugi (photo alone posterises into blotches)",
         motif="sastrugi", mix=0.55, smooth=1.0, fallback="sastrugi"),
]
assert [l["name"] for l in LAYERS] == LAYER_NAMES


# ----------------------------------------------------------------------------- fetching
def _http_get(url: str, timeout: float = 60.0) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def source_urls(layer: dict) -> tuple[str, str]:
    """(download url, page url). Poly Haven ids are resolved through the files API because the
    diffuse file name varies per asset (_diff_, _diffuse_, _col_)."""
    if layer["provider"] == "polyhaven":
        meta = CACHE / f"ph_files_{layer['id']}.json"
        if not meta.exists():
            meta.write_bytes(_http_get(f"https://api.polyhaven.com/files/{layer['id']}"))
        d = json.loads(meta.read_text())
        return d["Diffuse"]["1k"]["jpg"]["url"], PH_PAGE.format(id=layer["id"])
    return (f"https://ambientcg.com/get?file={layer['id']}_1K-JPG.zip",
            ACG_PAGE.format(id=layer["id"]))


def raw_path(layer: dict) -> Path:
    if layer["provider"] == "polyhaven":
        return RAW / f"ph_{layer['id']}_diff_1k.jpg"
    return RAW / f"acg_{layer['id']}_1K-JPG.zip"


def load_source(layer: dict, offline: bool) -> tuple[np.ndarray | None, str, str, str]:
    """Return (rgb uint8 HxWx3 or None, download url, page url, note)."""
    p = raw_path(layer)
    url = page = ""
    try:
        if not p.exists():
            if offline:
                return None, "", "", "offline and not cached"
            url, page = source_urls(layer)
            RAW.mkdir(parents=True, exist_ok=True)
            data = _http_get(url, timeout=120)
            p.write_bytes(data)
            time.sleep(1.0)  # polite: sequential, spaced
        else:
            try:
                url, page = source_urls(layer) if not offline else ("", "")
            except Exception:
                url, page = "", ""
        if p.suffix == ".zip":
            with zipfile.ZipFile(p) as z:
                name = next(n for n in z.namelist() if n.endswith("_Color.jpg"))
                img = Image.open(io.BytesIO(z.read(name)))
        else:
            img = Image.open(p)
        return np.asarray(img.convert("RGB")), url, page, "ok"
    except Exception as e:  # noqa: BLE001 - any failure -> procedural fallback
        return None, url, page, f"download/decode failed: {e!r}"


# ----------------------------------------------------------------------------- image maths
def srgb_to_linear(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def luminance(rgb8: np.ndarray) -> np.ndarray:
    lin = srgb_to_linear(rgb8.astype(np.float32) / 255.0)
    return (0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]).astype(np.float32)


def to_work(y: np.ndarray, n: int = WORK) -> np.ndarray:
    """Square-crop then resize to n x n (sources are already 1024 square: usually a no-op)."""
    h, w = y.shape
    s = min(h, w)
    y = y[(h - s) // 2:(h - s) // 2 + s, (w - s) // 2:(w - s) // 2 + s]
    if s != n:
        if s % n == 0:
            f = s // n
            y = y.reshape(n, f, n, f).mean(axis=(1, 3))
        else:  # not tile-exact; the seam check / repair below catches any resulting seam
            y = np.asarray(Image.fromarray(y.astype(np.float32), "F").resize((n, n), Image.LANCZOS))
    return y.astype(np.float32)


def hipass(y: np.ndarray) -> np.ndarray:
    low = ndimage.gaussian_filter(y, sigma=y.shape[0] / 8.0, mode="wrap")
    return y / np.maximum(low, 1e-4)


def normalise(x: np.ndarray, mean: float = MEAN, std: float = STD) -> np.ndarray:
    """Mean/std normalise then clamp; iterate twice so the clamp does not shift the mean."""
    x = x.astype(np.float64)
    for _ in range(3):
        s = x.std()
        x = (x - x.mean()) / (s if s > 1e-9 else 1.0) * std + mean
        x = np.clip(x, LO, HI)
    return x.astype(np.float32)


def bilateral_wrap(x: np.ndarray, radius: int = 3, sigma_s: float = 2.0,
                   sigma_r: float = 0.06) -> np.ndarray:
    """Edge-preserving smoothing with periodic boundaries (np.roll), O(r^2) full-image passes."""
    acc = np.zeros_like(x, dtype=np.float32)
    wsum = np.zeros_like(x, dtype=np.float32)
    inv_r = -0.5 / (sigma_r * sigma_r)
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            ws = np.exp(-(dx * dx + dy * dy) / (2 * sigma_s * sigma_s))
            if ws < 0.02:
                continue
            nb = np.roll(x, (dy, dx), axis=(0, 1))
            w = ws * np.exp((nb - x) ** 2 * inv_r)
            acc += w * nb
            wsum += w
    return (acc / wsum).astype(np.float32)


def seam_stats(img: np.ndarray) -> dict:
    """img in 0..1. Wrap differences vs interior neighbour differences, both axes."""
    wrap_x = np.abs(img[:, 0] - img[:, -1]).mean()
    wrap_y = np.abs(img[0, :] - img[-1, :]).mean()
    int_x = np.abs(np.diff(img, axis=1)).mean()
    int_y = np.abs(np.diff(img, axis=0)).mean()
    excess = max(wrap_x - int_x, wrap_y - int_y)
    return dict(wrap_mean=float((wrap_x + wrap_y) / 2), interior_mean=float((int_x + int_y) / 2),
                seam_excess=float(excess), ok=bool(abs(excess) < SEAM_MAX))


def offset_blend(x: np.ndarray) -> np.ndarray:
    """Classic tile repair: blend the image with itself rolled by half; the rolled copy is
    continuous across the wrap, so it fills the borders while the original fills the centre."""
    n = x.shape[0]
    r = np.roll(x, (n // 2, n // 2), axis=(0, 1))
    t = np.abs(np.linspace(-1, 1, n, dtype=np.float32))
    edge = np.maximum(t[None, :], t[:, None])           # 0 centre .. 1 border
    w = np.clip((edge - 0.55) / 0.4, 0, 1)
    w = w * w * (3 - 2 * w)                               # weight of the rolled copy
    return normalise(x * (1 - w) + r * w)


def area_down(x: np.ndarray, n: int) -> np.ndarray:
    f = x.shape[0] // n
    return x.reshape(n, f, n, f).mean(axis=(1, 3)).astype(np.float32)


# ----------------------------------------------------------------------------- procedural
class Proc:
    """Tileable procedural textures on an n x n torus (all periodic by construction)."""

    def __init__(self, n: int, seed: int):
        self.n = n
        self.rng = np.random.default_rng(seed)
        k = np.fft.fftfreq(n) * n
        self.kx, self.ky = np.meshgrid(k, k)
        self.kr = np.hypot(self.kx, self.ky)
        yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
        self.x, self.y = xx / n, yy / n

    def spectral(self, beta: float = 2.0, kmin: float = 1.0, kmax: float | None = None,
                 aniso: tuple[float, float] = (1.0, 1.0)) -> np.ndarray:
        """fBm via spectral synthesis: amplitude ~ k^(-beta/2); periodic. Zero-mean unit-std."""
        kr = np.hypot(self.kx * aniso[0], self.ky * aniso[1])
        amp = np.where(kr >= kmin, np.maximum(kr, 1e-6) ** (-beta / 2), 0.0)
        if kmax:
            amp *= np.exp(-(kr / kmax) ** 2)
        ph = self.rng.uniform(0, 2 * np.pi, kr.shape)
        f = np.real(np.fft.ifft2(amp * np.exp(1j * ph)))
        return ((f - f.mean()) / (f.std() + 1e-12)).astype(np.float32)

    def worley(self, cells: int, f2_minus_f1: bool = True) -> np.ndarray:
        """Periodic Worley (cellular) noise with `cells` x `cells` jittered feature points."""
        n = self.n
        pts = (np.stack(np.meshgrid(np.arange(cells), np.arange(cells)), -1).reshape(-1, 2)
               + self.rng.uniform(0, 1, (cells * cells, 2))) / cells
        d1 = np.full((n, n), 9.0, np.float32)
        d2 = np.full((n, n), 9.0, np.float32)
        for px, py in pts:
            dx = np.abs(self.x - px); dx = np.minimum(dx, 1 - dx)
            dy = np.abs(self.y - py); dy = np.minimum(dy, 1 - dy)
            d = np.sqrt(dx * dx + dy * dy)
            d2 = np.where(d < d1, d1, np.minimum(d2, d))
            d1 = np.minimum(d1, d)
        out = (d2 - d1) if f2_minus_f1 else d1
        return ((out - out.mean()) / (out.std() + 1e-12)).astype(np.float32)

    def voronoi_id(self, cells: int) -> np.ndarray:
        n = self.n
        m = cells * cells
        pts = (np.stack(np.meshgrid(np.arange(cells), np.arange(cells)), -1).reshape(-1, 2)
               + self.rng.uniform(0.1, 0.9, (m, 2))) / cells
        best = np.full((n, n), 9.0, np.float32)
        second = np.full((n, n), 9.0, np.float32)
        ids = np.zeros((n, n), np.int32)
        # domain-warp the distance field a little so field edges are not ruler-straight
        wx = 0.012 * self.spectral(2.5, 2, 12)
        wy = 0.012 * self.spectral(2.5, 2, 12)
        X, Y = self.x + wx, self.y + wy
        for i, (px, py) in enumerate(pts):
            dx = np.abs(X - px); dx = np.minimum(dx % 1.0, 1 - dx % 1.0)
            dy = np.abs(Y - py); dy = np.minimum(dy % 1.0, 1 - dy % 1.0)
            # Manhattan-ish metric gives straighter, more field-like borders
            d = np.maximum(dx, dy) * 0.6 + (dx + dy) * 0.4
            closer = d < best
            second = np.where(closer, best, np.minimum(second, d))
            ids = np.where(closer, i, ids)
            best = np.where(closer, d, best)
        return ids, (second - best)

    # ---- motifs (all zero-mean-ish, any scale; normalise() fixes stats later)
    def motif(self, kind: str) -> np.ndarray:
        n = self.n
        if kind == "fbm":
            return self.spectral(2.2, 2, None)
        if kind == "fbm_streak":
            return self.spectral(2.0, 2, None, aniso=(1.0, 3.0)) + 0.5 * self.spectral(2.4, 4)
        if kind in ("crowns", "crowns_dense"):
            cells = 26 if kind == "crowns" else 40
            # bumps = inverted F1 Worley -> rounded crowns with dark gaps, plus clumping fBm
            w = -self.worley(cells, f2_minus_f1=False)
            w = np.tanh(1.3 * w)
            clump = self.spectral(2.0, 2, 24)
            return w + (0.6 if kind == "crowns" else 0.3) * clump
        if kind == "worley":
            cr = self.worley(10)                       # cracks at cell borders (F2-F1 small)
            return np.tanh(1.5 * cr) + 0.5 * self.spectral(2.0, 3)
        if kind == "dunes":
            # ridged dunes: crests along integer wave vectors (periodic) warped by fBm
            warp = 0.9 * self.spectral(3.0, 1, 6)
            k1 = 2 * np.pi * (5 * self.x + 2 * self.y) + 2.2 * warp
            k2 = 2 * np.pi * (3 * self.x - 4 * self.y) + 1.7 * warp
            r1 = 1 - np.abs(np.sin(k1 / 2))            # sharp ridge
            r2 = 1 - np.abs(np.sin(k2 / 2))
            ridged = r1 ** 2.0 + 0.45 * r2 ** 2.0
            # lit windward / shaded lee: derivative across the main crest direction
            lee = np.roll(ridged, 2, axis=1) - ridged
            return (ridged - ridged.mean()) / ridged.std() + 0.8 * lee / (lee.std() + 1e-9)
        if kind == "fields":
            ids, border = self.voronoi_id(7)
            m = ids.max() + 1
            # per field: an integer wave vector (=> periodic stripes at varied angles), a tone
            vecs = [(a, b) for a in range(-3, 4) for b in range(-3, 4)
                    if 4 <= a * a + b * b <= 10]
            sel = self.rng.integers(0, len(vecs), m)
            tone = self.rng.normal(0, 0.55, m)
            stripe_amp = self.rng.choice([0.0, 0.6, 1.0, 1.0], m)  # some fallow fields plain
            out = np.zeros((n, n), np.float32)
            for i in range(m):
                a, b = vecs[sel[i]]
                f = int(self.rng.integers(14, 24))
                s = np.sin(2 * np.pi * f * (a * self.x + b * self.y))  # integer => periodic
                fld = tone[i] + stripe_amp[i] * 0.5 * s
                out = np.where(ids == i, fld, out)
            hedge = np.exp(-(border / 0.006) ** 2)        # dark hedgerow lines between fields
            return out - 1.6 * hedge + 0.25 * self.spectral(2.0, 8)
        if kind == "pools":
            p = self.spectral(2.6, 3, 40)
            pools = -np.clip((p - 0.7) * 3.0, 0, None)    # dark pooled water speckle
            return pools + 0.4 * self.spectral(2.0, 6)
        if kind == "sastrugi":
            return self.spectral(2.2, 4, None, aniso=(1.0, 2.2)) + 0.6 * self.spectral(2.4, 3)
        raise ValueError(kind)


def zstd(x: np.ndarray) -> np.ndarray:
    return ((x - x.mean()) / (x.std() + 1e-12)).astype(np.float32)


# ----------------------------------------------------------------------------- bake
def bake_layer(idx: int, layer: dict, offline: bool, force_proc: bool) -> tuple[np.ndarray, dict]:
    proc = Proc(WORK, SEED + 101 * idx)
    rgb, url, page, note = (None, "", "", "forced procedural") if force_proc else \
        load_source(layer, offline)
    rec = dict(index=idx, name=layer["name"], provider=layer["provider"], id=layer["id"],
               author=layer["author"], why=layer["why"])
    if rgb is not None:
        y = to_work(luminance(rgb))
        # painterly pre-soften: kill single-pixel photographic speckle before the high-pass
        y = ndimage.gaussian_filter(y, sigma=layer["smooth"], mode="wrap")
        hp = hipass(y)
        photo = zstd(hp)
        if layer["mix"] > 0:
            m = layer["mix"]
            # hybrid: procedural motif carries the map-scale structure, photo carries grain
            x = m * zstd(proc.motif(layer["motif"])) + (1 - m) * photo
            method = "hybrid"
        else:
            x = photo
            method = "photo"
        rec.update(method=method, url=url, page=page, licence="CC0",
                   licence_url="https://creativecommons.org/publicdomain/zero/1.0/",
                   source_sha256=hashlib.sha256(raw_path(layer).read_bytes()).hexdigest()[:16],
                   motif=layer["motif"] if method == "hybrid" else None,
                   motif_weight=layer["mix"] if method == "hybrid" else 0.0,
                   presmooth_sigma_px=layer["smooth"])
    else:
        x = zstd(proc.motif(layer["fallback"]))
        rec.update(method="procedural", url="procedural", page=None, licence="procedural (original)",
                   motif=layer["fallback"], motif_weight=1.0, fallback_reason=note)
    x = normalise(x)
    x = normalise(bilateral_wrap(x))
    st = seam_stats(x)
    repaired = False
    if not st["ok"]:
        x = offset_blend(x)
        st = seam_stats(x)
        repaired = True
    rec["seam_1024"] = st
    rec["seam_repaired"] = repaired
    return x, rec


def write_png(path: Path, v01: np.ndarray) -> None:
    g = np.clip(np.rint(v01 * 255.0), 0, 255).astype(np.uint8)
    rgb = np.repeat(g[..., None], 3, axis=2)
    im = Image.fromarray(rgb, "RGB")
    im.info = {}
    im.save(path, format="PNG", optimize=True)  # no icc_profile / gamma / srgb chunks


def contact_sheet(layers: list[np.ndarray], recs: list[dict], path: Path) -> None:
    """Row 1: each 512 layer tiled 2x2 at 50% (seams would show as a cross through the centre).
    Row 2: the same layer as a multiplier (2*d) over a flat mid-tone EU4-ish swatch."""
    swatch = [(52, 74, 40), (40, 70, 38), (98, 116, 60), (128, 118, 70), (140, 128, 84),
              (178, 152, 104), (112, 104, 96), (74, 84, 62), (210, 214, 222)]
    t = 256
    pad, lab = 8, 18
    W = len(layers) * (t + pad) + pad
    H = 2 * (t + lab) + 3 * pad
    S = Image.new("RGB", (W, H), (20, 22, 28))
    d = ImageDraw.Draw(S)
    for i, (x, r) in enumerate(zip(layers, recs)):
        tiled = np.tile(x, (2, 2))                      # 1024 -> view at 256
        small = area_down(tiled, t)
        g = np.clip(np.rint(small * 255), 0, 255).astype(np.uint8)
        X = pad + i * (t + pad)
        S.paste(Image.fromarray(g, "L").convert("RGB"), (X, pad))
        d.text((X + 2, pad + t + 2), f"{i:02d} {r['name']} [{r['method']}]", fill=(220, 220, 220))
        base = np.array(swatch[i], np.float32) / 255.0
        lin = srgb_to_linear(base)[None, None, :] * (2.0 * small[..., None])
        srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.clip(lin, 0, None) ** (1 / 2.4) - 0.055)
        c = np.clip(np.rint(srgb * 255), 0, 255).astype(np.uint8)
        Y = pad * 2 + t + lab
        S.paste(Image.fromarray(c, "RGB"), (X, Y))
        d.text((X + 2, Y + t + 2), f"{r['id'] if r['method'] != 'procedural' else 'procedural'}",
               fill=(170, 170, 170))
    S.save(path, format="PNG")


ENCODE_NOTE = {
    "owner": "D5",
    "intended_command_512": ("basisu -ktx2 -uastc -uastc_level 2 -uastc_rdo_l 1.0 -linear -mipmap "
                             "-tex_type 2darray -output_file detail_512.ktx2 "
                             + " ".join(f"detail_512_{i:02d}.png" for i in range(9))),
    "intended_command_256": ("basisu -ktx2 -uastc -uastc_level 2 -uastc_rdo_l 1.0 -linear -mipmap "
                             "-tex_type 2darray -output_file detail_256.ktx2 "
                             + " ".join(f"detail_256_{i:02d}.png" for i in range(9))),
    "notes": [
        "Verify flag names with `basisu -help` (basis_universal 2.50); keep -uastc (R10: never XUASTC/ASTC/HDR).",
        "Input file order == layer order 00..08 == splat order; the KTX2 layer index is the splat class index.",
        "-linear: the data is luminance in a linear 0..1 encoding, colorSpace 'none' in the manifest (NOT sRGB).",
        "-mipmap must use wrap addressing (basisu -mip_clamp NOT set) because the layers tile.",
        "Lossy is allowed (appearance data, ENG_PLAN R2). Gray-in-RGB: R=G=B, sample .r (or .g, best UASTC precision).",
    ],
}

SHADER_NOTE = {
    "owner": "C2b",
    "layer_order": LAYER_NAMES,
    "splat_mapping": "uSplatA=[forest,jungle,grass] -> layers 0,1,2; uSplatB=[farm,steppe,desert] -> 3,4,5; uSplatC=[rock,marsh,ice] -> 6,7,8",
    "value": "texel .r in 0..1, mean 0.5 (per layer and per size), std 0.11, clamped to [0.2,0.8]; 0.5 = no change",
    "suggested_apply": "albedo_lin *= mix(1.0, 2.0 * d, uDetailFade * strength) with d = weighted sum over the top-2 splat layers; "
                       "this keeps the macro albedo mean (EU4 'detail modulates paint'). Re-apply land luma cap afterwards.",
    "tiling": "seamless on both axes (wrap / RepeatWrapping). uDetailScaleKm (6, 36): one tile spans 6 km (fine octave) and 36 km (coarse octave); "
              "both octaves sample the same layer. The textures carry features from ~1/128 to ~1/4 of a tile (high-pass sigma = tile/8).",
    "mips": "Generated by basisu with wrap; at distance the layers converge to 0.5 (neutral), which is what uDetailFade relies on.",
    "orientation": "isotropic enough for biplanar/triplanar projection; farm stripes and desert dunes have mixed orientations per tile.",
}


def bake(args) -> int:
    CACHE.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    force = set(filter(None, (args.force_procedural or "").split(",")))
    hi_layers, recs = [], []
    for i, layer in enumerate(LAYERS):
        x, rec = bake_layer(i, layer, args.offline, layer["name"] in force)
        rec["sizes"] = {}
        for n in SIZES:
            y = normalise(area_down(x, n))
            st = seam_stats(y)
            if not st["ok"]:
                y = offset_blend(y)
                st = seam_stats(y)
            p = OUT / f"detail_{n}_{i:02d}.png"
            write_png(p, y)
            q = np.asarray(Image.open(p))[..., 0].astype(np.float32) / 255.0
            rec["sizes"][str(n)] = dict(file=str(p.relative_to(ROOT)), mean=round(float(q.mean()), 4),
                                        std=round(float(q.std()), 4), min=round(float(q.min()), 4),
                                        max=round(float(q.max()), 4), seam=st, bytes=p.stat().st_size)
            if n == 512:
                hi_layers.append(y)
        recs.append(rec)
        print(f"[{i:02d}] {rec['name']:7s} {rec['method']:10s} "
              f"512 mean={rec['sizes']['512']['mean']:.3f} std={rec['sizes']['512']['std']:.3f} "
              f"seam={rec['sizes']['512']['seam']['seam_excess']:+.4f} "
              f"256 seam={rec['sizes']['256']['seam']['seam_excess']:+.4f}", flush=True)
    sheet = CACHE / "contact_sheet.png"
    contact_sheet(hi_layers, recs, sheet)
    doc = {
        "package": "D4",
        "generated": time.strftime("%Y-%m-%d"),
        "generator": "scripts/terrain/bake_detail.py",
        "layer_order": LAYER_NAMES,
        "licence_summary": "All photo sources CC0 1.0 (Poly Haven, ambientCG). Procedural layers are original.",
        "credit": {"id": "detail", "text": "Poly Haven / ambientCG (CC0)"},
        "process": {
            "work_size": WORK, "luminance": "Rec.709 on linearised sRGB",
            "hipass": "Y / gaussian(Y, sigma=work/8, wrap)", "normalise": {"mean": MEAN, "std": STD, "clamp": [LO, HI]},
            "soften": "wrap bilateral radius 3, sigma_s 2, sigma_r 0.06 (at 1024), then renormalise",
            "resize": "exact area average 1024->512, 1024->256, each renormalised",
            "seam_metric": "seam_excess = mean|wrap pair diff| - mean|interior neighbour diff| (max over axes); pass if |x| < 0.02",
            "png": "8-bit gray-in-RGB, no alpha, no colour chunks",
        },
        "layers": recs,
        "contact_sheet": str(sheet.relative_to(ROOT)),
        "encoding": ENCODE_NOTE,
        "shader": SHADER_NOTE,
    }
    SOURCES_JSON.write_text(json.dumps(doc, indent=1) + "\n")
    print(f"wrote {SOURCES_JSON.relative_to(ROOT)} and {sheet.relative_to(ROOT)}")
    return check()


def check() -> int:
    errs: list[str] = []
    if not SOURCES_JSON.exists():
        errs.append("detail_sources.json missing")
        doc = {"layers": []}
    else:
        doc = json.loads(SOURCES_JSON.read_text())
    layers = doc.get("layers", [])
    if [l.get("name") for l in layers] != LAYER_NAMES:
        errs.append(f"json layer order {[l.get('name') for l in layers]} != {LAYER_NAMES}")
    for l in layers:
        if l.get("method") in ("photo", "hybrid"):
            if l.get("licence") != "CC0" or not str(l.get("url", "")).startswith("https://"):
                errs.append(f"{l.get('name')}: photo source lacks CC0 licence / https url")
        elif l.get("method") == "procedural":
            if l.get("url") != "procedural":
                errs.append(f"{l.get('name')}: procedural layer must have url 'procedural'")
        else:
            errs.append(f"{l.get('name')}: unknown method {l.get('method')}")
    n_ok = 0
    for n in SIZES:
        for i in range(9):
            p = OUT / f"detail_{n}_{i:02d}.png"
            if not p.exists():
                errs.append(f"missing {p.name}")
                continue
            im = Image.open(p)
            bad_chunks = [k for k in ("icc_profile", "gamma", "srgb", "chromaticity") if k in im.info]
            a = np.asarray(im)
            tag = p.name
            if im.mode != "RGB" or a.shape != (n, n, 3):
                errs.append(f"{tag}: mode {im.mode} shape {a.shape}, want RGB {n}x{n}x3")
                continue
            if bad_chunks:
                errs.append(f"{tag}: colour metadata chunks {bad_chunks}")
            if n % 4:
                errs.append(f"{tag}: size not a multiple of 4")
            if not (np.array_equal(a[..., 0], a[..., 1]) and np.array_equal(a[..., 0], a[..., 2])):
                errs.append(f"{tag}: not gray-in-RGB")
            v = a[..., 0].astype(np.float32) / 255.0
            if not (0.48 <= v.mean() <= 0.52):
                errs.append(f"{tag}: mean {v.mean():.4f} outside 0.48-0.52")
            if v.std() < 0.05:
                errs.append(f"{tag}: std {v.std():.4f} too flat")
            st = seam_stats(v)
            if not st["ok"]:
                errs.append(f"{tag}: seam_excess {st['seam_excess']:+.4f} (wrap {st['wrap_mean']:.4f})")
            n_ok += 1
    sheet = CACHE / "contact_sheet.png"
    if not sheet.exists():
        errs.append("contact sheet missing")
    print(f"check: {n_ok}/18 PNGs validated, {len(layers)} json layers, "
          f"methods={[l.get('method') for l in layers]}")
    for e in errs:
        print("FAIL:", e)
    print("CHECK", "PASS" if not errs else f"FAIL ({len(errs)})")
    return 0 if not errs else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="verify outputs only")
    ap.add_argument("--offline", action="store_true", help="no network; procedural for uncached")
    ap.add_argument("--force-procedural", default="", help="comma list of layer names")
    args = ap.parse_args()
    if args.check:
        return check()
    return bake(args)


if __name__ == "__main__":
    sys.exit(main())
