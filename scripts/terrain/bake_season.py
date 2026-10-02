"""Seasonal colour map (step 6): one small equirect the terrain + tree shaders read to
follow the visitor's date (src/three/terrain/season.ts, shaders/season.glsl.ts).

Output: public/textures/terrain/shared/season_1440x720.webp (lossless, RGB, no colour
chunks; R3/R4) + a PNG copy in scripts/data/bake/paint/eq/. Row 0 = north, column 0 = lon -180
(cell centres like the masters). Ocean texels within ~4 texels of land take their nearest land
value so bilinear sampling never fades at a coast; open ocean is neutral (0, 0.5, 0).

  R  deciduous SHARE of the tree cover (0..1), Köppen-gated: what fraction of the trees
     here drop their leaves in autumn. The tree shader colours broadleaf crowns by it.
  G  dry-season browning, signed: 0.5 + 0.5 * amp * phase, phase +1 = dry in local
     SUMMER (Mediterranean Cs*, Ds*, cold steppe, poleward hot steppe), -1 = dry in local
     WINTER (savanna Aw, monsoon Am, Cw*, the Sahel / monsoon-margin hot steppe).
     Tropical rainforest Af = 0; amp is halved under evergreen broadleaf forest.
  B  deciduous tree DENSITY on the ground (0..1) = Köppen gate x deciduous tree cover:
     how much of the painted ground turns russet / ochre / amber in autumn and goes
     bare brown-grey in winter.

Sources (masters, 1 arc-min): Köppen-Geiger 1991-2020 (Beck et al. 2023, land-filled:
bake/physical/fill/koppen_filled), MODIS IGBP land cover (bake/paint/fill/igbp_filled),
land coverage. Forest type comes from IGBP: 3 deciduous needleleaf (larch) and 4 deciduous
broadleaf = deciduous, 1 evergreen needleleaf and 2 evergreen broadleaf = evergreen,
5 mixed = 0.6 deciduous, 8/9 (woody) savanna and 14 crop mosaic partial. The Köppen gate
limits autumn colour to temperate and continental climates (Cf*, Cw*, Cs*, Df*, Dw*, Ds*).

Run: ~/dev/dw3-lock scripts/terrain/.venv/bin/python scripts/terrain/bake_season.py
Peak memory ~1.5 GB (bands of 1080 master rows). Optional arg: block factor (default 15).
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.io import load_master, save_png_rgb, save_webp_lossless  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
F = int(sys.argv[1]) if len(sys.argv) > 1 else 15  # 21600x10800 masters -> 1440x720
W, H = 21600 // F, 10800 // F
Q = 4  # quantise to 6 bits: the map is a soft wash, and lossless WebP halves

# Köppen index (koppen-palette.json idx) -> autumn gate, dry amplitude, dry phase (+1 summer-dry)
KD = np.zeros(32, np.float32)
KDRY = np.zeros(32, np.float32)
KPH = np.zeros(32, np.float32)
_tab = {
    # code: (deciduous gate, dry amp, phase)
    1: (0.0, 0.0, 0),  # Af
    2: (0.0, 0.35, -1),  # Am
    3: (0.0, 1.0, -1),  # Aw
    4: (0.0, 0.12, 1),  # BWh
    5: (0.0, 0.12, 1),  # BWk
    6: (0.0, 0.8, 0),  # BSh: phase by latitude below
    7: (0.15, 0.6, 1),  # BSk
    8: (0.45, 0.9, 1),  # Csa
    9: (0.55, 0.7, 1),  # Csb
    10: (0.55, 0.4, 1),  # Csc
    11: (0.65, 0.6, -1),  # Cwa
    12: (0.45, 0.55, -1),  # Cwb
    13: (0.5, 0.4, -1),  # Cwc
    14: (0.85, 0.0, 0),  # Cfa
    15: (1.0, 0.0, 0),  # Cfb
    16: (0.7, 0.0, 0),  # Cfc
    17: (0.85, 0.45, 1),  # Dsa
    18: (0.85, 0.4, 1),  # Dsb
    19: (0.75, 0.25, 1),  # Dsc
    20: (0.65, 0.2, 1),  # Dsd
    21: (1.0, 0.25, -1),  # Dwa
    22: (1.0, 0.2, -1),  # Dwb
    23: (0.85, 0.1, -1),  # Dwc
    24: (0.7, 0.0, 0),  # Dwd
    25: (1.0, 0.0, 0),  # Dfa
    26: (1.0, 0.0, 0),  # Dfb
    27: (0.85, 0.0, 0),  # Dfc
    28: (0.7, 0.0, 0),  # Dfd
    29: (0.0, 0.0, 0),  # ET
    30: (0.0, 0.0, 0),  # EF
}
for _k, (_d, _a, _p) in _tab.items():
    KD[_k], KDRY[_k], KPH[_k] = _d, _a, _p

# IGBP -> deciduous tree cover, all tree cover, evergreen-broadleaf flag
DEC = np.zeros(256, np.float32)
TREE = np.zeros(256, np.float32)
for _c, _dv, _tv in ((1, 0, 1), (2, 0, 1), (3, 1, 1), (4, 1, 1), (5, 0.6, 1), (6, 0.1, 0.15), (8, 0.45, 0.6),
                     (9, 0.2, 0.3), (11, 0.1, 0.15), (12, 0.05, 0.05), (14, 0.15, 0.2)):
    DEC[_c], TREE[_c] = _dv, _tv
EBF = np.zeros(256, np.float32)
EBF[2] = 1.0


def block(a: np.ndarray) -> np.ndarray:
    h, w = a.shape
    return a.reshape(h // F, F, w // F, F).mean(axis=(1, 3), dtype=np.float64).astype(np.float32)


def main():
    kop = np.load(ROOT / "scripts/data/bake/physical/fill/koppen_filled.u8.npy", mmap_mode="r")
    igbp = np.load(ROOT / "scripts/data/bake/paint/fill/igbp_filled.u8.npy", mmap_mode="r")
    land = load_master("land.u8")
    assert kop.shape == igbp.shape == land.shape == (H * F, W * F), (kop.shape, igbp.shape, land.shape)
    L = np.zeros((H, W), np.float32)
    S_dec = np.zeros((H, W), np.float32)  # sum kd * dec
    S_tree = np.zeros((H, W), np.float32)
    S_dry = np.zeros((H, W), np.float32)
    BAND = 1080
    for j0 in range(0, H * F, BAND):
        k = np.asarray(kop[j0 : j0 + BAND]).astype(np.int64)
        g = np.asarray(igbp[j0 : j0 + BAND]).astype(np.int64)
        lw = np.asarray(land[j0 : j0 + BAND]).astype(np.float32) / 255.0
        lat = 90.0 - (np.arange(j0, j0 + k.shape[0]) + 0.5) * 180.0 / (H * F)
        alat = np.abs(lat)[:, None]
        ph = KPH[k]
        # hot steppe: the monsoon margin (Sahel, NW India, N Australia) is winter-dry, the
        # poleward edge (Spain, the Levant, the Maghreb) summer-dry
        bsh = k == 6
        ph = np.where(bsh, np.clip((alat - 26.0) / 4.0, -1.0, 1.0), ph)
        dry = KDRY[k] * (1.0 - 0.5 * EBF[g]) * ph
        j = j0 // F
        n = k.shape[0] // F
        L[j : j + n] = block(lw)
        S_dec[j : j + n] = block(lw * KD[k] * DEC[g])
        S_tree[j : j + n] = block(lw * TREE[g])
        S_dry[j : j + n] = block(lw * dry)
        print(f"  rows {j0}..{j0 + BAND}", flush=True)
    eps = 1e-4
    inv = 1.0 / np.maximum(L, eps)
    share = np.clip(S_dec / np.maximum(S_tree, 0.02), 0, 1)  # R: deciduous share of the trees
    dens = np.clip(S_dec * inv, 0, 1)  # B: deciduous tree density on the land
    drys = np.clip(S_dry * inv, -1, 1)  # G: signed dry amplitude
    # ocean (and near-empty coast) texels take the nearest land value
    has = L > 0.02
    dist, (iy, ix) = ndimage.distance_transform_edt(~has, return_indices=True)
    near = dist <= 4.0  # ~110 km of shelf; open ocean stays neutral (it compresses to nothing)
    share = np.where(near, share[iy, ix], 0.0)
    dens = np.where(near, dens[iy, ix], 0.0)
    drys = np.where(near, drys[iy, ix], 0.0)
    # a light painterly soften (bilinear sampling does the rest)
    share = ndimage.gaussian_filter(share, 0.6, mode=("nearest", "wrap"))
    dens = ndimage.gaussian_filter(dens, 0.6, mode=("nearest", "wrap"))
    drys = ndimage.gaussian_filter(drys, 0.8, mode=("nearest", "wrap"))
    rgb = np.stack([share, 0.5 + 0.5 * drys, dens], -1)
    u8 = np.clip(np.rint(rgb * 255.0 / Q) * Q, 0, 255).astype(np.uint8)
    png = ROOT / f"scripts/data/bake/paint/eq/season_{W}x{H}.png"
    out = ROOT / f"public/textures/terrain/shared/season_{W}x{H}.webp"
    save_png_rgb(u8, png)
    save_webp_lossless(u8, out)
    digest = hashlib.sha256(out.read_bytes()).hexdigest()[:8]

    def at(la, lo):
        jj = int((90 - la) / 180 * H)
        ii = int((lo + 180) / 360 * W)
        v = u8[jj, ii].astype(int)
        return f"R{v[0]:3d} G{v[1]:3d} B{v[2]:3d}"

    for nm, la, lo in (("Vermont 44N 72.7W", 44, -72.7), ("Germany 50.5N 10E", 50.5, 10), ("Siberian taiga 62N 100E", 62, 100),
                       ("Amazon 3S 62W", -3, -62), ("Sahel 13N 2E", 13, 2), ("Deccan 18N 77E", 18, 77), ("Andalusia 37.5N 5W", 37.5, -5),
                       ("California 37N 120W", 37, -120), ("Patagonia forest 41S 71.5W", -41, -71.5), ("N Australia 15S 132E", -15, 132),
                       ("Pampas 34S 61W", -34, -61), ("Kyoto 35N 135.8E", 35, 135.8), ("Sahara 24N 12E", 24, 12)):
        print(f"  {nm:28s} {at(la, lo)}")
    print(f"bake_season: {out.relative_to(ROOT)} {out.stat().st_size} bytes, v={digest}")


if __name__ == "__main__":
    main()
