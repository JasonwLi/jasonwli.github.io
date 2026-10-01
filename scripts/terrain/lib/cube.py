"""THE GL cube-face table (R6), numpy twin of src/three/geo/cubemap.ts.

Parity-tested by scripts/terrain/check_cube_parity.mjs (|diff| <= 1e-9).

Face order: 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z  (suffixes px nx py ny pz nz)
Texel centres: s = 2*(col+.5)/N - 1 (left->right), t = 2*(row+.5)/N - 1 (top->bottom)
  +X (1,-t,-s)   -X (-1,-t,s)   +Y (s,1,t)   -Y (s,-1,-t)   +Z (s,-t,1)   -Z (-s,-t,-1)
Globe frame: lat = asin(y), lon = atan2(-z, x)  (lon 0 -> +X, lon 90E -> -Z, north pole -> +Y)
Faces are written row 0 = top and uploaded with flipY = false (R5).
"""
from __future__ import annotations

import numpy as np

FACES = ("px", "nx", "py", "ny", "pz", "nz")


def st_to_dirs(face: int, s: np.ndarray, t: np.ndarray) -> np.ndarray:
    """Unit directions for face coordinates s, t (any shape, may extend beyond [-1, 1])."""
    s = np.asarray(s, dtype=np.float64)
    t = np.asarray(t, dtype=np.float64)
    one = np.ones_like(s)
    if face == 0:
        d = np.stack([one, -t, -s], axis=-1)
    elif face == 1:
        d = np.stack([-one, -t, s], axis=-1)
    elif face == 2:
        d = np.stack([s, one, t], axis=-1)
    elif face == 3:
        d = np.stack([s, -one, -t], axis=-1)
    elif face == 4:
        d = np.stack([s, -t, one], axis=-1)
    elif face == 5:
        d = np.stack([-s, -t, -one], axis=-1)
    else:
        raise ValueError(f"bad cube face {face}")
    return d / np.linalg.norm(d, axis=-1, keepdims=True)


def texel_st(n: int, pad: int = 0) -> tuple[np.ndarray, np.ndarray]:
    """s (per column) and t (per row) at texel centres for cols/rows -pad .. n+pad-1."""
    idx = np.arange(-pad, n + pad, dtype=np.float64)
    c = 2.0 * (idx + 0.5) / n - 1.0
    return c, c


def face_dirs(face: int, n: int, pad: int = 0) -> np.ndarray:
    """(n+2p, n+2p, 3) unit directions, [row, col]; pad extends beyond the face (for padded EDT)."""
    s1, t1 = texel_st(n, pad)
    s, t = np.meshgrid(s1, t1)  # s varies along columns, t along rows
    return st_to_dirs(face, s, t)


def texel_dir(face: int, col: float, row: float, n: int) -> np.ndarray:
    s = 2.0 * (col + 0.5) / n - 1.0
    t = 2.0 * (row + 0.5) / n - 1.0
    return st_to_dirs(face, np.float64(s), np.float64(t))


def dirs_to_latlon(d: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(lat, lon) in degrees; lat = asin(y), lon = atan2(-z, x). d need not be unit."""
    d = np.asarray(d, dtype=np.float64)
    n = np.linalg.norm(d, axis=-1)
    n = np.where(n == 0, 1.0, n)
    y = np.clip(d[..., 1] / n, -1.0, 1.0)
    lat = np.degrees(np.arcsin(y))
    lon = np.degrees(np.arctan2(-d[..., 2], d[..., 0]))
    return lat, lon


def latlon_to_dirs(lat, lon) -> np.ndarray:
    """Unit directions for lat/lon in degrees (x = cos lat cos lon, y = sin lat, z = -cos lat sin lon)."""
    la = np.radians(np.asarray(lat, dtype=np.float64))
    lo = np.radians(np.asarray(lon, dtype=np.float64))
    c = np.cos(la)
    return np.stack([c * np.cos(lo), np.sin(la), -c * np.sin(lo)], axis=-1)


def dirs_to_face_uv(d: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Vectorised (face, s, t) for directions; major axis picks the face, ties go X, then Y, then Z."""
    d = np.asarray(d, dtype=np.float64)
    x, y, z = d[..., 0], d[..., 1], d[..., 2]
    ax, ay, az = np.abs(x), np.abs(y), np.abs(z)
    is_x = (ax >= ay) & (ax >= az)
    is_y = ~is_x & (ay >= az)
    is_z = ~is_x & ~is_y
    face = np.zeros(x.shape, dtype=np.int64)
    s = np.zeros(x.shape)
    t = np.zeros(x.shape)
    with np.errstate(divide="ignore", invalid="ignore"):
        m = is_x & (x >= 0)
        face[m], s[m], t[m] = 0, -z[m] / ax[m], -y[m] / ax[m]
        m = is_x & (x < 0)
        face[m], s[m], t[m] = 1, z[m] / ax[m], -y[m] / ax[m]
        m = is_y & (y >= 0)
        face[m], s[m], t[m] = 2, x[m] / ay[m], z[m] / ay[m]
        m = is_y & (y < 0)
        face[m], s[m], t[m] = 3, x[m] / ay[m], -z[m] / ay[m]
        m = is_z & (z >= 0)
        face[m], s[m], t[m] = 4, x[m] / az[m], -y[m] / az[m]
        m = is_z & (z < 0)
        face[m], s[m], t[m] = 5, -x[m] / az[m], -y[m] / az[m]
    return face, s, t


def face_uv_to_texel(s: np.ndarray, t: np.ndarray, n: int) -> tuple[np.ndarray, np.ndarray]:
    """Continuous (col, row) for s, t (inverse of the texel-centre formula)."""
    return (np.asarray(s) + 1.0) * n / 2.0 - 0.5, (np.asarray(t) + 1.0) * n / 2.0 - 0.5
