"""D3: tree density equirect for C6 (instanced trees on tilted close views).

Output: scripts/data/bake/paint/eq/trees_4096x2048.png (lossless RGB, no alpha/colour chunks)
  R conifer, G broadleaf, B palm; 0..255 = density 0..1 (area mean over the pixel).
Model (plan D3): IGBP 1 and 3 -> conifer 1; IGBP 2 -> palm 1 in Köppen A, else broadleaf 1;
IGBP 4 -> broadleaf 1; IGBP 5 -> conifer .5 + broadleaf .5; IGBP 8 -> broadleaf .35;
IGBP 9 -> broadleaf .15; times (1 - rock weight) * (1 - ice weight) * land. Inputs are the
same warped samples as the splat model (bake_splats.py raw_eq cache).

Run: ~/dev/dw3-lock scripts/terrain/.venv/bin/python scripts/terrain/bake_trees.py --check
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bake_splats import CH_TREES, Cfg, Masters, raw_eq  # noqa: E402
from lib.io import load_rgb, save_png_rgb, to_u8  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    cfg = Cfg(a.quick)
    p = cfg.out / "cache" / "raw_eq.npy"
    A = np.load(p).astype(np.float32) if p.exists() else raw_eq(cfg, Masters(cfg))
    P = cfg.EQ_PAD
    T = A[P:-P, P:-P, CH_TREES]
    W, H = cfg.EQ
    out = cfg.out / "eq" / f"trees_{W}x{H}.png"
    save_png_rgb(to_u8(np.clip(T, 0, 1)), out)
    ok = True
    if a.check:
        img = load_rgb(out)
        with Image.open(out) as im:
            clean = im.mode == "RGB" and not any(k in im.info for k in ("icc_profile", "gamma", "srgb", "transparency"))

        def at(lat, lon):
            j = int((90 - lat) / 180 * H)
            i = int((lon + 180) / 360 * W)
            return img[max(0, j - 2) : j + 3, max(0, i - 2) : i + 3].reshape(-1, 3).mean(0).round(0).tolist()

        probes = {"Siberian taiga 62N 100E": (at(62, 100), 0, 60), "Amazon 3S 62W": (at(-3, -62), 2, 120),
                  "Germany 50N 10E (broadleaf/mixed)": (at(50.5, 10), 1, 20), "Sahara 24N 12E": (at(24, 12), None, 0)}
        print(f"  [{'PASS' if clean else 'FAIL'}] trees PNG RGB, no colour chunks: {img.shape}")
        ok &= clean
        for nm, (v, ch, thr) in probes.items():
            good = (sum(v) <= 3) if ch is None else v[ch] >= thr
            ok &= good
            print(f"  [{'PASS' if good else 'FAIL'}] {nm}: RGB {v}")
        print(f"  coverage: conifer {np.mean(img[..., 0]) / 255:.4f}, broadleaf {np.mean(img[..., 1]) / 255:.4f}, "
              f"palm {np.mean(img[..., 2]) / 255:.4f} (global means)")
    print(f"bake_trees: {'OK' if ok else 'CHECKS FAILED'} -> {out}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
