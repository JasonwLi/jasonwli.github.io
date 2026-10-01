"""D3: 9-class splat weights (cube faces) + the shared raw class-weight caches.

Class order (binding): 0 forest, 1 jungle, 2 grass, 3 farm, 4 steppe, 5 desert, 6 rock, 7 marsh, 8 ice.
splatA = classes 0-2, splatB = 3-5, splatC = 6-8 (RGB triplets of weight*255).

Outputs (scripts/data/bake/paint/, or .../paint/quick/ with --quick):
  cube/splat{A,B,C}_{512,1024}_{face}.png  lossless RGB, sum exactly 255 on painted land, 0 on water
  cache/raw_{face}.npy   padded 2048 face: 9 raw weights, land cov, NE2 linear RGB, elev mean (float16)
  cache/raw_eq.npy       padded 4096x2048 equirect: same + tree densities (for LOW albedo and trees)
  fill/igbp_filled.u8.npy, fill/slope_deg.u8.npy   (full masters only)
Quicklook: scripts/.cache/quicklook/paint_argmax.png (equirect reprojection of the 1024 argmax).

Model: plan D3 IGBP x Köppen table + modifiers (ET tundra, EF/glacier/ice shelf -> ice, playas ->
desert, rock from slope > 18° (smoothstep 15-21°) or elevation above treeline 4200 - 55|lat| m
(smoothstep over 300 m)). Categorical inputs (IGBP, Köppen, playas) are sampled through a domain
warp (2-octave fBm, 6 km amplitude, 60 km wavelength); land, glaciers, slope and elevation are
not (coasts and mountains stay where they are). Sub-sample weights are averaged over LAND
sub-samples only, then sharpened per output size (cube^3, 3x3 mode on argmax, 1-texel re-soften).
Painted = any land in the texel (coverage > 0), so the albedo/splats never bleed ocean at coasts;
the runtime coast SDF decides water.

Run: ~/dev/dw3-lock scripts/terrain/.venv/bin/python scripts/terrain/bake_splats.py --all --check
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.cube import FACES  # noqa: E402
from lib.equirect import sample  # noqa: E402
from lib.faces import box_reduce, cube_to_equirect, fill_nearest_equirect, seam_report  # noqa: E402
from lib.io import load_master, load_rgb, save_png_rgb  # noqa: E402
from lib.paint import (  # noqa: E402
    NC, EqGrid, FaceGrid, area_grid, class_weights, quantize_weights, sharpen_weights, srgb_to_linear,
    tree_density, warp_dirs,
)
from lib.cube import dirs_to_latlon  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
QL_DIR = ROOT / "scripts" / ".cache" / "quicklook"

# raw cache channel layout
CH_W = slice(0, 9)
CH_LAND = 9
CH_NE2 = slice(10, 13)
CH_ELEV = 13
CH_TREES = slice(14, 17)  # eq only


class Cfg:
    def __init__(self, quick: bool):
        self.quick = quick
        base = ROOT / "scripts" / "data" / "bake" / "paint"
        self.out = base / "quick" if quick else base
        self.phys = ROOT / "scripts" / "data" / "bake" / "physical" / ("quick" if quick else "")
        self.NA = 256 if quick else 2048  # albedo master face size
        self.NS = (64, 128) if quick else (512, 1024)  # splats
        self.PAD = 16  # at NA (-> 8 at NA/2, 4 at NA/4)
        self.SS = 2
        self.EQ = (1024, 512) if quick else (4096, 2048)
        self.EQ_SS = 2 if quick else 3
        self.EQ_PAD = 16

    def ql(self, name):
        return QL_DIR / (f"paint_quick_{name}.png" if self.quick else f"paint_{name}.png")


class Masters:
    def __init__(self, cfg: Cfg):
        q = cfg.quick
        self.cfg = cfg
        self.elev = load_master("elev_m.i16", q)
        self.land = load_master("land.u8", q)
        self.lakes = load_master("lakes.u8", q)
        self.glacier = load_master("glacier.u8", q)
        self.iceshelf = load_master("iceshelf.u8", q)
        self.playas = load_master("playas.u8", q)
        self.ne2 = load_master("ne2_rgb.u8", q)
        kp = cfg.phys / "fill" / "koppen_filled.u8.npy"
        if not kp.exists():
            raise SystemExit(f"missing {kp}: run bake_physical.py first (D2)")
        self.koppen = np.load(kp, mmap_mode="r")
        self.igbp = self._igbp_filled()
        self.slope = self._slope()

    def _igbp_filled(self):
        p = self.cfg.out / "fill" / "igbp_filled.u8.npy"
        if p.exists():
            return np.load(p, mmap_mode="r")
        t = time.time()
        g = load_master("igbp.u8", self.cfg.quick)
        h = g.shape[0]
        bad = np.empty(g.shape, bool)
        tgt = np.empty(g.shape, bool)
        for r0 in range(0, h, 1350):
            r1 = min(h, r0 + 1350)
            gg = np.asarray(g[r0:r1])
            bad[r0:r1] = (gg == 0) | (gg == 17)
            lwl = np.maximum(np.asarray(self.land[r0:r1]), np.asarray(self.lakes[r0:r1])) >= 1
            tgt[r0:r1] = bad[r0:r1] & lwl
        n = int(tgt.sum())
        near = fill_nearest_equirect(g, bad, band=1350 if not self.cfg.quick else 338,
                                     margin=200 if not self.cfg.quick else 50)
        out = np.array(g, copy=True)
        out[tgt] = near[tgt]
        print(f"  igbp fill: {n} land px were 0/17 -> {int((tgt & ((out == 0) | (out == 17))).sum())} left "
              f"({time.time() - t:.0f}s)")
        p.parent.mkdir(parents=True, exist_ok=True)
        np.save(p, out)
        del near, bad, tgt, out
        return np.load(p, mmap_mode="r")

    def _slope(self):
        p = self.cfg.out / "fill" / "slope_deg.u8.npy"
        if p.exists():
            return np.load(p, mmap_mode="r")
        e = self.elev
        h, w = e.shape
        dy = np.pi * 6371000.0 / h
        out = np.empty((h, w), np.uint8)
        for r0 in range(0, h, 1000):
            r1 = min(h, r0 + 1000)
            a0, a1 = max(0, r0 - 1), min(h, r1 + 1)
            blk = np.asarray(e[a0:a1], np.float32)
            gx = (np.roll(blk, -1, 1) - np.roll(blk, 1, 1))
            gy = np.zeros_like(blk)
            gy[1:-1] = blk[2:] - blk[:-2]
            lat = 90.0 - (np.arange(a0, a1) + 0.5) * 180.0 / h
            dx = 2 * np.pi * 6371000.0 / w * np.maximum(np.cos(np.radians(lat)), 1e-3)
            s = np.degrees(np.arctan(np.hypot(gx / (2 * dx[:, None]), gy / (2 * dy))))
            out[r0:r1] = np.clip(np.rint(s), 0, 90)[r0 - a0 : r0 - a0 + (r1 - r0)].astype(np.uint8)
        p.parent.mkdir(parents=True, exist_ok=True)
        np.save(p, out)
        return np.load(p, mmap_mode="r")


def sample_fn(M: Masters, trees: bool):
    """fn(dirs, lat, lon) -> per-sub-sample channels (see CH_* layout)."""

    def fn(d, lat, lon):
        wd = warp_dirs(d)
        wlat, wlon = dirs_to_latlon(wd)
        ig = sample(M.igbp, wlat, wlon, "nearest")
        kp = sample(M.koppen, wlat, wlon, "nearest")
        pl = sample(M.playas, wlat, wlon, "bilinear") / 255.0
        la = sample(M.land, lat, lon, "bilinear") / 255.0
        landm = (la >= 0.5).astype(np.float32)
        gl = sample(M.glacier, lat, lon, "bilinear") / 255.0
        sh = sample(M.iceshelf, lat, lon, "bilinear") / 255.0
        sl = sample(M.slope, lat, lon, "bilinear")
        el = sample(M.elev, lat, lon, "bilinear")
        w = class_weights(ig, kp, gl, sh, pl, sl, np.maximum(el, 0), lat)
        ne = srgb_to_linear(sample(M.ne2, lat, lon, "bilinear") / 255.0)
        ch = [w * landm[..., None], la[..., None], ne, el[..., None]]
        if trees:
            td = tree_density(ig, kp)
            rock = w[..., 6:7]
            ice = w[..., 8:9]
            ch.append(td * (1 - rock) * (1 - ice) * landm[..., None])
        return np.concatenate([c.astype(np.float32) for c in ch], -1)

    return fn


def raw_face(cfg: Cfg, M: Masters, face: int) -> np.ndarray:
    p = cfg.out / "cache" / f"raw_{FACES[face]}.npy"
    if p.exists():
        return np.load(p).astype(np.float32)
    t = time.time()
    g = FaceGrid(face, cfg.NA, cfg.PAD)
    A = area_grid(sample_fn(M, False), g, cfg.SS)
    p.parent.mkdir(parents=True, exist_ok=True)
    np.save(p, A.astype(np.float16))
    print(f"  raw face {FACES[face]}: {time.time() - t:.0f}s")
    return A


def raw_eq(cfg: Cfg, M: Masters) -> np.ndarray:
    p = cfg.out / "cache" / "raw_eq.npy"
    if p.exists():
        return np.load(p).astype(np.float32)
    t = time.time()
    g = EqGrid(*cfg.EQ, cfg.EQ_PAD)
    A = area_grid(sample_fn(M, True), g, cfg.EQ_SS)
    p.parent.mkdir(parents=True, exist_ok=True)
    np.save(p, A.astype(np.float16))
    print(f"  raw eq {cfg.EQ}: {time.time() - t:.0f}s")
    return A


def weights_from_raw(A: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(normalised raw weights over land sub-samples, land coverage)."""
    land = A[..., CH_LAND]
    wl = A[..., CH_W]
    s = wl.sum(-1, keepdims=True)
    w = np.where(s > 1e-6, wl / np.maximum(s, 1e-6), 0)
    return w.astype(np.float32), land


def painted_mask(land_cov: np.ndarray, wsum: np.ndarray) -> np.ndarray:
    return (land_cov > 0.0) & (wsum > 1e-6)


def splats_from_raw(A: np.ndarray, k: int, pad: int) -> tuple[np.ndarray, np.ndarray]:
    """Box-reduce the padded raw cache by k, sharpen, crop: -> (uint8 (n,n,9), painted mask)."""
    Ak = box_reduce(A[..., :10], k) if k > 1 else A[..., :10]
    wsum = Ak[..., CH_W].sum(-1)
    w, land = weights_from_raw(Ak)
    valid = painted_mask(land, wsum)
    sw = sharpen_weights(w, valid)
    p = pad // k
    sw = sw[p:-p, p:-p]
    valid = valid[p:-p, p:-p]
    return quantize_weights(sw, valid), valid


def write_splats(cfg: Cfg, M: Masters, faces):
    for f in faces:
        A = raw_face(cfg, M, f)
        for n in cfg.NS:
            q, valid = splats_from_raw(A, cfg.NA // n, cfg.PAD)
            for j, nm in enumerate("ABC"):
                save_png_rgb(np.ascontiguousarray(q[..., 3 * j : 3 * j + 3]), cfg.out / "cube" / f"splat{nm}_{n}_{FACES[f]}.png")
        del A


def load_splats(cfg: Cfg, n: int) -> list[np.ndarray]:
    out = []
    for f in FACES:
        out.append(np.concatenate([load_rgb(cfg.out / "cube" / f"splat{nm}_{n}_{f}.png") for nm in "ABC"], -1))
    return out


ARGMAX_RGB = np.array([[52, 92, 38], [30, 88, 40], [150, 165, 70], [190, 175, 80], [176, 150, 90],
                       [214, 172, 100], [128, 116, 104], [80, 96, 70], [225, 230, 236]], np.uint8)


def quicklook(cfg: Cfg):
    S = load_splats(cfg, cfg.NS[1])
    eq = cube_to_equirect([s.astype(np.float32) for s in S], *((1024, 512) if cfg.quick else (2048, 1024)), mode="nearest")
    am = eq.argmax(-1)
    rgb = ARGMAX_RGB[am]
    rgb[eq.sum(-1) < 1] = (22, 34, 56)
    save_png_rgb(rgb, cfg.ql("argmax"))
    print(f"  quicklook -> {cfg.ql('argmax')}")


def checks(cfg: Cfg) -> bool:
    ok_all = True
    phys_terrain = ROOT / "scripts" / "data" / "bake" / "physical" / ("quick" if cfg.quick else "") / "cube"
    for n in cfg.NS:
        S = load_splats(cfg, n)
        sums = [s.astype(np.int64).sum(-1) for s in S]
        bad = sum(int(((x != 0) & (x != 255)).sum()) for x in sums)
        # land (>= 0.5 coverage) from D2's terrain R>0 or height 0 land... use the splat-independent land cov
        # from the raw cache reduced to n
        land_bad = 0
        ocean_bad = 0
        for fi, f in enumerate(FACES):
            A = np.load(cfg.out / "cache" / f"raw_{f}.npy", mmap_mode="r")
            k = cfg.NA // n
            land = box_reduce(np.asarray(A[..., CH_LAND], np.float32), k)
            p = cfg.PAD // k
            land = land[p:-p, p:-p]
            land_bad += int(((land >= 0.5) & (sums[fi] != 255)).sum())
            ocean_bad += int(((land <= 0.0) & (sums[fi] != 0)).sum())
        ok = bad == 0 and land_bad == 0 and ocean_bad == 0
        ok_all &= ok
        frac = float(np.mean([(x == 255).mean() for x in sums]))
        print(f"  [{'PASS' if ok else 'FAIL'}] splats {n}: sums in {{0,255}} (bad {bad}); land>=0.5 -> 255 (bad {land_bad}); "
              f"no-land -> 0 (bad {ocean_bad}); painted {frac:.3f}")
        rep = seam_report([s[..., :].astype(np.float32) for s in S], strip=8)
        smax, bmax = max(r[1] for r in rep), max(r[2] for r in rep)
        smean, bmean = float(np.mean([r[3] for r in rep])), float(np.mean([r[4] for r in rep]))
        ok = smean <= bmean + 0.5
        ok_all &= ok
        print(f"  [{'PASS' if ok else 'FAIL'}] splat {n} seams (8-strip): seam max {smax:.1f} mean {smean:.2f} vs interior "
              f"max {bmax:.1f} mean {bmean:.2f}")
    for p in sorted((cfg.out / "cube").glob("splat*.png"))[:1]:
        from PIL import Image

        with Image.open(p) as im:
            print(f"  png check {p.name}: {im.mode} {[k for k in im.info if k in ('icc_profile', 'gamma', 'srgb')]}")
    return ok_all


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--faces", default="0,1,2,3,4,5")
    ap.add_argument("--no-eq", action="store_true")
    a = ap.parse_args()
    cfg = Cfg(a.quick)
    t0 = time.time()
    if a.all or a.quick:
        M = Masters(cfg)
        write_splats(cfg, M, [int(x) for x in a.faces.split(",")])
        if not a.no_eq:
            raw_eq(cfg, M)
        quicklook(cfg)
    ok = checks(cfg) if (a.check or a.quick) else True
    print(f"bake_splats {'quick' if a.quick else 'full'}: {time.time() - t0:.0f}s {'OK' if ok else 'CHECKS FAILED'}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
