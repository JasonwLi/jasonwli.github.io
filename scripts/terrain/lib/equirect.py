"""Equirect sampling on the shared grid convention.

Cell centres: lon = -180 + (i + .5) * 360 / w, lat = 90 - (j + .5) * 180 / h; row 0 = north,
column 0 = lon -180. Longitude wraps; latitude clamps.
"""
from __future__ import annotations

from typing import Callable

import numpy as np

from .cube import dirs_to_latlon


def _frac_ij(lat, lon, w: int, h: int):
    lon = np.asarray(lon, dtype=np.float64)
    lat = np.asarray(lat, dtype=np.float64)
    fi = (lon + 180.0) * w / 360.0 - 0.5
    fj = (90.0 - lat) * h / 180.0 - 0.5
    return fi, fj


def sample(master: np.ndarray, lat, lon, mode: str = "bilinear") -> np.ndarray:
    """Sample an (h, w) or (h, w, c) equirect at lat/lon (degrees, any shape)."""
    h, w = master.shape[:2]
    fi, fj = _frac_ij(lat, lon, w, h)
    if mode == "nearest":
        i = np.floor(fi + 0.5).astype(np.int64) % w
        j = np.clip(np.floor(fj + 0.5).astype(np.int64), 0, h - 1)
        return np.asarray(master[j, i])
    if mode != "bilinear":
        raise ValueError(mode)
    i0 = np.floor(fi).astype(np.int64)
    j0 = np.floor(fj).astype(np.int64)
    ti = fi - i0
    tj = fj - j0
    i1 = (i0 + 1) % w
    i0 = i0 % w
    j1 = np.clip(j0 + 1, 0, h - 1)
    j0 = np.clip(j0, 0, h - 1)
    m = master
    a = m[j0, i0].astype(np.float64)
    b = m[j0, i1].astype(np.float64)
    c = m[j1, i0].astype(np.float64)
    d = m[j1, i1].astype(np.float64)
    if m.ndim == 3:
        ti = ti[..., None]
        tj = tj[..., None]
    return (a * (1 - ti) + b * ti) * (1 - tj) + (c * (1 - ti) + d * ti) * tj


def area_sample(master: np.ndarray, dirs_fn: Callable[[int, int], np.ndarray], n: int, ss: int = 4) -> np.ndarray:
    """Supersampled average over an n x n target whose texel directions come from dirs_fn.

    dirs_fn(n_fine, pad) -> (n_fine, n_fine, 3) directions (e.g. functools.partial(face_dirs, face)).
    Samples bilinearly at ss x ss sub-texels and box-averages back to n x n.
    """
    fine = dirs_fn(n * ss, 0)
    lat, lon = dirs_to_latlon(fine)
    v = sample(master, lat, lon, "bilinear")
    if v.ndim == 2:
        return v.reshape(n, ss, n, ss).mean(axis=(1, 3))
    return v.reshape(n, ss, n, ss, v.shape[-1]).mean(axis=(1, 3))


def mode_sample(master: np.ndarray, dirs_fn: Callable[[int, int], np.ndarray], n: int, ss: int = 3) -> np.ndarray:
    """Categorical (majority) sampling for class rasters (e.g. Köppen index): never averages labels."""
    fine = dirs_fn(n * ss, 0)
    lat, lon = dirs_to_latlon(fine)
    v = np.asarray(sample(master, lat, lon, "nearest"))
    blocks = v.reshape(n, ss, n, ss).transpose(0, 2, 1, 3).reshape(n, n, ss * ss)
    out = np.empty((n, n), dtype=v.dtype)
    for r in range(n):
        row = blocks[r]
        for c in range(n):
            vals, counts = np.unique(row[c], return_counts=True)
            out[r, c] = vals[np.argmax(counts)]
    return out


def equirect_latlon(w: int, h: int) -> tuple[np.ndarray, np.ndarray]:
    """(lat, lon) grids (h, w) at cell centres."""
    lon = -180.0 + (np.arange(w) + 0.5) * 360.0 / w
    lat = 90.0 - (np.arange(h) + 0.5) * 180.0 / h
    return np.meshgrid(lat, lon, indexing="ij")
