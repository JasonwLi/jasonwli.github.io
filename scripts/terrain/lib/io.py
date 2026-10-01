"""Image I/O for the terrain bake (rules R2-R4).

Data images: 8-bit RGB, no alpha, no colour chunks (no ICC / gAMA / sRGB / cHRM),
lossless (PNG or WebP lossless+exact). Single-channel data is gray replicated to RGB.
"""
from __future__ import annotations

import os
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
MASTER_DIR = ROOT / "scripts" / "data" / "master"


def _check_rgb(arr: np.ndarray) -> None:
    assert isinstance(arr, np.ndarray), "expected a numpy array"
    assert arr.dtype == np.uint8, f"expected uint8, got {arr.dtype}"
    assert arr.ndim == 3 and arr.shape[2] == 3, f"expected HxWx3, got {arr.shape}"


def _img(arr: np.ndarray) -> Image.Image:
    _check_rgb(arr)
    im = Image.fromarray(np.ascontiguousarray(arr), "RGB")
    im.info.clear()  # never carry icc_profile / gamma / exif
    return im


def _mkdir(path) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)


def save_png_rgb(arr: np.ndarray, path) -> None:
    """Lossless 8-bit RGB PNG with no ICC, gAMA, sRGB or cHRM chunks."""
    _mkdir(path)
    _img(arr).save(path, format="PNG", optimize=True)


def save_webp_lossless(arr: np.ndarray, path) -> None:
    """Bit-exact lossless WebP (exact=True keeps RGB under any alpha; there is none)."""
    _mkdir(path)
    _img(arr).save(path, format="WEBP", lossless=True, exact=True, method=6, quality=100)


def save_webp_lossy(arr: np.ndarray, path, q: int = 85) -> None:
    """Lossy WebP: ONLY for albedo-like sRGB images (albedo, Köppen colour, previews)."""
    _mkdir(path)
    _img(arr).save(path, format="WEBP", lossless=False, quality=int(q), method=6)


def gray_to_rgb(a: np.ndarray) -> np.ndarray:
    """HxW uint8 -> HxWx3 gray replicated in RGB."""
    a = np.asarray(a)
    assert a.ndim == 2, f"expected HxW, got {a.shape}"
    if a.dtype != np.uint8:
        a = np.clip(np.rint(a), 0, 255).astype(np.uint8)
    return np.repeat(a[:, :, None], 3, axis=2)


def to_u8(x: np.ndarray) -> np.ndarray:
    """[0, 1] float -> uint8 with rounding and clamping."""
    return np.clip(np.rint(np.asarray(x, dtype=np.float64) * 255.0), 0, 255).astype(np.uint8)


def load_master(name: str, quick: bool = False) -> np.ndarray:
    """Memory-mapped master raster from scripts/data/master[/quick]/<name>.npy (e.g. 'land.u8')."""
    base = MASTER_DIR / "quick" if quick else MASTER_DIR
    p = base / (name if name.endswith(".npy") else name + ".npy")
    return np.load(p, mmap_mode="r")


def load_rgb(path) -> np.ndarray:
    """Decode an image as HxWx3 uint8 without colour management."""
    with Image.open(path) as im:
        return np.asarray(im.convert("RGB"))
