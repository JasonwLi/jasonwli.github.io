"""Cube-face sampling helpers shared by the D2/D3 bakes.

Everything here follows the GL table in lib/cube.py (faces px nx py ny pz nz, row 0 = top,
s = 2*(col+.5)/N - 1, t = 2*(row+.5)/N - 1). Grids may be PADDED: a padded face of size N
with pad p has (N+2p)^2 texels whose s, t run beyond [-1, 1] (the gnomonic plane extended),
so filters and distance transforms see the neighbouring geography and never seam.

Memory: every sampler works in row bands so a 4N supersampled face never materialises
more than ~`band_px` directions at once.
"""
from __future__ import annotations

import math
from typing import Callable

import numpy as np
from scipy.ndimage import distance_transform_edt

from .cube import FACES, dirs_to_face_uv, dirs_to_latlon, face_uv_to_texel, st_to_dirs, texel_st
from .equirect import sample

R_KM = 6371.0


# ----------------------------------------------------------------------------- grids


def face_band_dirs(face: int, n: int, pad: int, r0: int, r1: int) -> np.ndarray:
    """Directions for padded-grid rows r0..r1 (0-based in the padded grid), all padded columns."""
    s1, t1 = texel_st(n, pad)
    s, t = np.meshgrid(s1, t1[r0:r1])
    return st_to_dirs(face, s, t)


def face_texel_arc_km(n: int, pad: int = 0) -> np.ndarray:
    """Isotropic arc length (km) of one texel at each padded-grid texel centre.

    Gnomonic face (s, t, 1)/r with r = sqrt(1 + s^2 + t^2). The arc length per unit s is
    |d(p/r)/ds| = sqrt(1 + t^2) / r^2 and per unit t is sqrt(1 + s^2) / r^2 (exact Jacobian
    columns of the central projection). One texel spans ds = dt = 2/N, so the axial arcs are
    (2/N) sqrt(1+t^2)/r^2 and (2/N) sqrt(1+s^2)/r^2; we return their geometric mean (the
    square root of the texel's solid angle, (2/N)^2 / r^3, times R).
    """
    s1, t1 = texel_st(n, pad)
    s, t = np.meshgrid(s1, t1)
    r2 = 1.0 + s * s + t * t
    return (2.0 / n) / r2 ** 0.75 * R_KM


def sample_face(master, face: int, n: int, pad: int = 0, mode: str = "bilinear",
                band_px: int = 4_000_000, fn: Callable | None = None, dtype=np.float32) -> np.ndarray:
    """Point-sample an equirect master at padded face texel centres (no supersampling).

    fn(values, lat, lon) -> array lets callers transform samples band by band (e.g. a
    per-sample classifier); its output shape (h, w[, c]) defines the result.
    """
    m = n + 2 * pad
    rows = max(1, band_px // m)
    out = None
    for r0 in range(0, m, rows):
        r1 = min(m, r0 + rows)
        d = face_band_dirs(face, n, pad, r0, r1)
        lat, lon = dirs_to_latlon(d)
        v = sample(master, lat, lon, mode) if master is not None else None
        if fn is not None:
            v = fn(v, lat, lon)
        v = np.asarray(v)
        if out is None:
            out = np.empty((m, m) + v.shape[2:], dtype=dtype)
        out[r0:r1] = v
    return out


def area_face(fn: Callable[[np.ndarray, np.ndarray, np.ndarray], np.ndarray], face: int, n: int, ss: int,
              pad: int = 0, nch: int | None = None, band_px: int = 6_000_000) -> np.ndarray:
    """Supersampled box filter: evaluate fn(dirs, lat, lon) at ss x ss sub-texels, mean per texel.

    fn returns (h, w) or (h, w, c) float values for the sub-sample directions. Output (m, m[, c])
    for the padded face m = n + 2 pad. Sub-texel grid is the face at n*ss with pad*ss.
    """
    m = n + 2 * pad
    nf, pf = n * ss, pad * ss
    out_rows = max(1, band_px // (m * ss * ss))
    out = None
    for o0 in range(0, m, out_rows):
        o1 = min(m, o0 + out_rows)
        d = face_band_dirs(face, nf, pf, o0 * ss, o1 * ss)
        lat, lon = dirs_to_latlon(d)
        v = np.asarray(fn(d, lat, lon), dtype=np.float32)
        h = o1 - o0
        if v.ndim == 2:
            r = v.reshape(h, ss, m, ss).mean(axis=(1, 3))
        else:
            r = v.reshape(h, ss, m, ss, v.shape[-1]).mean(axis=(1, 3))
        if out is None:
            out = np.empty((m, m) + r.shape[2:], dtype=np.float32)
        out[o0:o1] = r
    return out


def mode_reduce(labels: np.ndarray, k: int, nclass: int) -> np.ndarray:
    """Majority of each k x k block of an integer label image (ties -> lowest label). Vectorised."""
    h, w = labels.shape
    hh, ww = h // k, w // k
    lab = labels[: hh * k, : ww * k].astype(np.int64)
    blk = lab.reshape(hh, k, ww, k).transpose(0, 2, 1, 3).reshape(hh * ww, k * k)
    idx = np.arange(hh * ww, dtype=np.int64)[:, None] * nclass + blk
    counts = np.bincount(idx.ravel(), minlength=hh * ww * nclass).reshape(hh * ww, nclass)
    return counts.argmax(axis=1).reshape(hh, ww).astype(labels.dtype)


def box_reduce(a: np.ndarray, k: int) -> np.ndarray:
    h, w = a.shape[:2]
    return a.reshape(h // k, k, w // k, k, *a.shape[2:]).mean(axis=(1, 3))


def crop(a: np.ndarray, pad: int) -> np.ndarray:
    return a[pad:-pad, pad:-pad] if pad else a


# ----------------------------------------------------------------------------- distances


def _geodesic_km(d0: np.ndarray, d1: np.ndarray) -> np.ndarray:
    """Great-circle distance (km) between unit direction arrays (..., 3)."""
    c = np.cross(d0, d1)
    return np.arctan2(np.linalg.norm(c, axis=-1), (d0 * d1).sum(-1)) * R_KM


def _shift(a: np.ndarray, dy: int, dx: int) -> np.ndarray:
    """out[r, c] = a[r + dy, c + dx] with edge replication."""
    m0, m1 = a.shape
    r = np.clip(np.arange(m0) + dy, 0, m0 - 1)
    c = np.clip(np.arange(m1) + dx, 0, m1 - 1)
    return a[r][:, c]


def face_distance_km(feature: np.ndarray, face: int, n: int, pad: int,
                     steps: tuple[int, ...] = (32, 16, 8, 4, 2, 1)) -> np.ndarray:
    """Geodesic distance (km) from every padded-face texel to the nearest `feature` texel centre.

    1. scipy's EDT in face-texel space gives a first nearest-feature guess per texel.
    2. The gnomonic texel metric is anisotropic (up to ~1.4:1 near edges, and different on the
       neighbouring face), so the guess can be geodesically wrong by tens of km - which shows as a
       seam. A jump-flood refinement (offsets `steps` x 8 neighbours) re-picks, per texel, the
       neighbour's feature whenever it is geodesically closer (largest dot product).
    3. The distance is the exact great circle between the texel and its picked feature.
    feature: bool (m, m) on the padded grid m = n + 2 pad. Feature texels get 0.
    """
    m = n + 2 * pad
    assert feature.shape == (m, m)
    if not feature.any():
        return np.full((m, m), np.float32(1e6))
    inds = distance_transform_edt(~feature, return_distances=False, return_indices=True).astype(np.int32)
    ir, ic = inds[0], inds[1]
    del inds
    s1, t1 = texel_st(n, pad)
    own = face_band_dirs(face, n, pad, 0, m).astype(np.float32)
    D = own  # D[r, c] = direction of texel (r, c)

    def dot_to(r_idx, c_idx):
        f = D[r_idx, c_idx]
        return (own * f).sum(-1)

    best = dot_to(ir, ic)
    for st in steps:
        for dy in (-st, 0, st):
            for dx in (-st, 0, st):
                if dy == 0 and dx == 0:
                    continue
                cr = _shift(ir, dy, dx)
                cc = _shift(ic, dy, dx)
                cand = dot_to(cr, cc)
                better = cand > best
                if better.any():
                    ir = np.where(better, cr, ir)
                    ic = np.where(better, cc, ic)
                    best = np.where(better, cand, best)
                del cr, cc, cand, better
    # exact distance in float64 by bands
    out = np.empty((m, m), np.float32)
    for r0 in range(0, m, 512):
        r1 = min(m, r0 + 512)
        d0 = face_band_dirs(face, n, pad, r0, r1)
        d1 = st_to_dirs(face, s1[ic[r0:r1]], t1[ir[r0:r1]])
        c = np.cross(d0, d1)
        out[r0:r1] = np.arctan2(np.linalg.norm(c, axis=-1), (d0 * d1).sum(-1)) * R_KM
    return out


def face_signed_distance_km(inside: np.ndarray, face: int, n: int, pad: int) -> np.ndarray:
    """Signed geodesic distance (km), positive inside. The zero sits half a texel from each
    boundary texel centre (subtract half the local texel arc on both sides)."""
    half = 0.5 * face_texel_arc_km(n, pad).astype(np.float32)
    d_in = face_distance_km(~inside, face, n, pad)  # inside texels: distance to the outside
    d_out = face_distance_km(inside, face, n, pad)  # outside texels: distance to the inside
    return np.where(inside, d_in - half, -(d_out - half)).astype(np.float32)


# ----------------------------------------------------------------------------- equirect


def equirect_signed_distance_km(inside: np.ndarray, band: int = 64, max_km: float = 160.0) -> np.ndarray:
    """Signed geodesic distance (km, + inside) on an equirect grid (row 0 = north, cell centres).

    Latitude-corrected EDT: the grid is processed in bands of `band` rows; each band (plus a
    margin covering max_km in y) runs scipy's EDT with sampling = (dy_km, dx_km * cos(lat_band))
    so the nearest feature it PICKS is (nearly) the true nearest on the sphere, and the column
    margin wraps across the antimeridian by np.take(mode='wrap'). The returned distance is the
    exact great circle to the picked feature cell, minus half a cell. Values beyond max_km are
    only lower bounds (they clamp in every encoding we use).
    """
    h, w = inside.shape
    dy_km = math.pi * R_KM / h
    lat_c = 90.0 - (np.arange(h) + 0.5) * 180.0 / h
    lon_c = -180.0 + (np.arange(w) + 0.5) * 360.0 / w
    out = np.empty((h, w), np.float32)
    my = int(math.ceil(max_km / dy_km)) + 2
    for r0 in range(0, h, band):
        r1 = min(h, r0 + band)
        a0, a1 = max(0, r0 - my), min(h, r1 + my)
        latm = float(np.abs(lat_c[r0:r1]).min())
        cosl = max(math.cos(math.radians(latm)), 1e-3)
        dx_km = 2 * math.pi * R_KM / w * cosl
        mx = min(w, int(math.ceil(max_km / max(dx_km, 1e-6))) + 2)
        cols = np.arange(-mx, w + mx)
        sub = np.take(inside[a0:a1], cols, axis=1, mode="wrap")
        res = {}
        for key, feat in (("in", ~sub), ("out", sub)):
            if not feat.any():
                res[key] = None
                continue
            inds = distance_transform_edt(~feat, sampling=(dy_km, dx_km), return_distances=False,
                                          return_indices=True)
            rr = inds[0][r0 - a0 : r1 - a0, mx : mx + w] + a0
            cc = cols[inds[1][r0 - a0 : r1 - a0, mx : mx + w]] % w
            la0 = np.radians(lat_c[r0:r1])[:, None]
            lo0 = np.radians(lon_c)[None, :]
            la1 = np.radians(lat_c[rr])
            lo1 = np.radians(lon_c[cc])
            # haversine
            sdl = np.sin((la1 - la0) / 2)
            sdo = np.sin((lo1 - lo0) / 2)
            hv = sdl * sdl + np.cos(la0) * np.cos(la1) * sdo * sdo
            res[key] = (2 * np.arcsin(np.sqrt(np.clip(hv, 0, 1))) * R_KM).astype(np.float32)
        ins = inside[r0:r1]
        # half a cell (isotropic: geometric mean of the cell's two arcs)
        cl = np.cos(np.radians(lat_c[r0:r1]))[:, None]
        half = 0.5 * np.sqrt(dy_km * 2 * math.pi * R_KM / w * np.maximum(cl, 1e-3)).astype(np.float32)
        d_in = res["in"] if res["in"] is not None else np.full(ins.shape, 1e6, np.float32)
        d_out = res["out"] if res["out"] is not None else np.full(ins.shape, 1e6, np.float32)
        out[r0:r1] = np.where(ins, d_in - half, -(d_out - half))
    return out


def fill_nearest_equirect(values: np.ndarray, invalid: np.ndarray, band: int = 1350, margin: int = 160) -> np.ndarray:
    """Replace invalid cells of a (big) equirect class raster by the nearest valid cell's value.

    Banded (rows) with a vertical margin, full width; wraps 1/16 of the width at the
    antimeridian. Nearest is in pixel space (fine for the few-km coastal gaps this fixes).
    """
    h, w = values.shape
    out = np.array(values, copy=True)
    wm = w // 16
    cols = np.arange(-wm, w + wm)
    for r0 in range(0, h, band):
        r1 = min(h, r0 + band)
        a0, a1 = max(0, r0 - margin), min(h, r1 + margin)
        inv = np.take(np.asarray(invalid[a0:a1]), cols, axis=1, mode="wrap")
        tgt = np.asarray(invalid[r0:r1])
        if not tgt.any():
            continue
        if inv.all():
            continue
        inds = distance_transform_edt(inv, return_distances=False, return_indices=True)
        rr = inds[0][r0 - a0 : r1 - a0, wm : wm + w] + a0
        cc = cols[inds[1][r0 - a0 : r1 - a0, wm : wm + w]] % w
        band_vals = np.asarray(values[rr, cc])
        out[r0:r1] = np.where(tgt, band_vals, out[r0:r1])
        del inds
    return out


# ----------------------------------------------------------------------------- reprojection / checks


def cube_to_equirect(faces: list[np.ndarray], w: int, h: int, mode: str = "bilinear") -> np.ndarray:
    """Reproject six (N, N[, c]) faces (px..nz order) to an equirect (h, w[, c]).

    Bilinear sampling clamps at face edges (no cross-face filtering), which makes face seams
    visible if the data disagrees across them - exactly what a quicklook should reveal.
    """
    from .equirect import equirect_latlon
    from .cube import latlon_to_dirs

    lat, lon = equirect_latlon(w, h)
    d = latlon_to_dirs(lat, lon)
    f, s, t = dirs_to_face_uv(d)
    n = faces[0].shape[0]
    col, row = face_uv_to_texel(s, t, n)
    shape = (h, w) + faces[0].shape[2:]
    out = np.zeros(shape, np.float32)
    for k in range(6):
        m = f == k
        if not m.any():
            continue
        c, r = col[m], row[m]
        a = faces[k].astype(np.float32)
        if mode == "nearest":
            ci = np.clip(np.rint(c).astype(int), 0, n - 1)
            ri = np.clip(np.rint(r).astype(int), 0, n - 1)
            out[m] = a[ri, ci]
            continue
        c = np.clip(c, 0, n - 1)
        r = np.clip(r, 0, n - 1)
        c0 = np.minimum(np.floor(c).astype(int), n - 2)
        r0 = np.minimum(np.floor(r).astype(int), n - 2)
        tc, tr = c - c0, r - r0
        if a.ndim == 3:
            tc, tr = tc[:, None], tr[:, None]
        v = (a[r0, c0] * (1 - tc) + a[r0, c0 + 1] * tc) * (1 - tr) + (a[r0 + 1, c0] * (1 - tc) + a[r0 + 1, c0 + 1] * tc) * tr
        out[m] = v
    return out


def _edge_strip(face_img: np.ndarray, side: str, depth: int) -> np.ndarray:
    """Strip of `depth` texels inward from an edge, ordered from the edge inward: (depth, N[, c])."""
    if side == "top":
        return face_img[:depth]
    if side == "bottom":
        return face_img[::-1][:depth]
    if side == "left":
        return np.swapaxes(face_img[:, :depth], 0, 1)
    if side == "right":
        return np.swapaxes(face_img[:, ::-1][:, :depth], 0, 1)
    raise ValueError(side)


def face_edges() -> list[tuple[int, str, int, str, bool]]:
    """Every shared cube edge as (faceA, sideA, faceB, sideB, reversed) derived numerically from
    the GL table: two edges match if their texel-centre directions coincide (maybe reversed)."""
    n = 8
    sides = {}
    for f in range(6):
        s1, _ = texel_st(n)
        e = {
            "top": st_to_dirs(f, s1, np.full(n, -1.0)),
            "bottom": st_to_dirs(f, s1, np.full(n, 1.0)),
            "left": st_to_dirs(f, np.full(n, -1.0), s1),
            "right": st_to_dirs(f, np.full(n, 1.0), s1),
        }
        for k, v in e.items():
            sides[(f, k)] = v
    out = []
    keys = list(sides)
    for i, a in enumerate(keys):
        for b in keys[i + 1 :]:
            if a[0] == b[0]:
                continue
            da, db = sides[a], sides[b]
            if np.allclose(da, db, atol=1e-9):
                out.append((a[0], a[1], b[0], b[1], False))
            elif np.allclose(da, db[::-1], atol=1e-9):
                out.append((a[0], a[1], b[0], b[1], True))
    assert len(out) == 12, f"expected 12 cube edges, found {len(out)}"
    return out


def _seam_stat(A: np.ndarray, B: np.ndarray, strip: int) -> np.ndarray:
    """A, B: (>=2, L[, c]) strips ordered from the shared line outward (A[0], B[0] adjacent).
    Second difference across the line: jump minus the mean of the steps on either side."""
    d = (B[0] - A[0]) - 0.5 * ((A[0] - A[1]) + (B[1] - B[0]))
    if strip > 1:
        L = (d.shape[0] // strip) * strip
        d = d[:L].reshape(L // strip, strip, *d.shape[1:]).mean(axis=1)
    return np.abs(d)


def seam_report(faces: list[np.ndarray], strip: int = 1, inset: int = 6) -> list[tuple]:
    """Per cube edge: (name, seam_max, base_max, seam_mean, base_mean).

    seam     = max over the edge of |jump across the seam - mean in-face step| (LSB), after
               averaging over `strip` texels along the edge (a smooth field gives ~0).
    baseline = the same statistic on a FAKE seam `inset` texels inside each of the two faces
               (rows inset-1 | inset), i.e. the field's own curvature (coast kinks, SDF medial
               axes, clamps) at that resolution. A real seam shows as seam >> baseline.
    """
    res = []
    for fa, sa, fb, sb, rev in face_edges():
        A = _edge_strip(faces[fa].astype(np.float64), sa, inset + 2)
        B = _edge_strip(faces[fb].astype(np.float64), sb, inset + 2)
        if rev:
            B = B[:, ::-1]
        seam = _seam_stat(A[:2], B[:2], strip)
        base_a = _seam_stat(A[inset - 1 :: -1][:2], A[inset:][:2], strip)
        base_b = _seam_stat(B[inset - 1 :: -1][:2], B[inset:][:2], strip)
        base = np.concatenate([base_a.ravel(), base_b.ravel()])
        res.append((f"{FACES[fa]}.{sa}|{FACES[fb]}.{sb}", float(seam.max()), float(base.max()),
                    float(seam.mean()), float(base.mean())))
    return res
