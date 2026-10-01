"""Vector -> equirect rasterisation for the master grid (row 0 = north, cell-centre convention).

Grid convention (shared with every master):  a W x H equirect grid; cell (i, j) covers
lon [-180 + 360 i/W, -180 + 360 (i+1)/W] and lat [90 - 180 (j+1)/H, 90 - 180 j/H];
its centre is lon = -180 + (i+.5) 360/W, lat = 90 - (j+.5) 180/H.

POLYGONS -> coverage 0..255
  * The grid is supersampled ss x ss (default 2) and each sub-pixel is sampled at its
    CENTRE with an exact numpy scanline (edge/scanline crossings, toggled into a
    difference array, prefix-summed along the row).  This replaces "PIL ImageDraw at 2x"
    from the spec: PIL's polygon fill also paints the outline (a +0.5 px outward bias) and
    has no hole/overlap semantics across polygons, whereas this is exact and unbiased.
  * Fill rule = NON-ZERO WINDING using the shapefile ring orientation (outer rings CW,
    holes CCW, y up): an upward (lat-increasing) edge adds +1, a downward edge -1, summed
    left to right; inside = winding > 0.  Holes therefore cut (fill 0), islands inside
    holes fill again, and overlapping features union correctly.
  * Antimeridian: each ring is longitude-unwrapped (as in scripts/gen_land_mask.py) and
    copies shifted by +/-360 are added when the unwrapped ring leaves [-180, 180].
    Pole-enclosing rings (net 360 deg of longitude, e.g. Antarctica if not already closed
    through the pole) are closed with a cap along lat = +/-90.
  * Rows are processed in strips (bounded memory: ~strip_rows x W*ss x 8 bytes), then box
    reduced ss x ss to an 8-bit coverage.

POLYLINES -> PIL ImageDraw.line per strip, unwrapped the same way, PIL pixel centres at
integer coordinates (x_pil = x_cont - 0.5).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable, Iterable, Sequence

import numpy as np
from PIL import Image, ImageDraw


# ----------------------------------------------------------------------------- rings
def unwrap_lon(lon: np.ndarray) -> np.ndarray:
    """Remove +/-360 jumps so consecutive vertices are continuous."""
    d = np.diff(lon)
    shift = np.concatenate([[0.0], np.cumsum(-360.0 * np.round(d / 360.0))])
    return lon + shift


def prepare_ring(ring: np.ndarray) -> list[np.ndarray]:
    """Unwrapped, closed ring(s) in lon/lat including +/-360 copies when needed."""
    lon = unwrap_lon(ring[:, 0].astype(np.float64))
    lat = ring[:, 1].astype(np.float64)
    net = lon[-1] - lon[0]
    if abs(net) > 180:  # pole-enclosing: close over the pole along lat=cap
        cap = -90.0 if lat.mean() < 0 else 90.0
        lon = np.concatenate([lon, [lon[-1], lon[0]]])
        lat = np.concatenate([lat, [cap, cap]])
    r = np.stack([lon, lat], 1)
    if not np.array_equal(r[0], r[-1]):
        r = np.vstack([r, r[:1]])
    out = [r]
    lo, hi = r[:, 0].min(), r[:, 0].max()
    k = 1
    while lo + 360 * (k - 1) < -180 or hi - 360 * (k - 1) > 180:
        if lo + 360 * (k - 1) < -180:
            out.append(r + [360.0 * k, 0])
        if hi - 360 * (k - 1) > 180:
            out.append(r - [360.0 * k, 0])
        k += 1
        if k > 3:
            break
    return out


@dataclass
class EdgeSet:
    """All polygon edges of a layer in continuous lon/lat (vectorised)."""
    lon0: np.ndarray
    lat0: np.ndarray
    lon1: np.ndarray
    lat1: np.ndarray
    n_rings: int

    @classmethod
    def from_rings(cls, rings: Iterable[np.ndarray]) -> "EdgeSet":
        a0, b0, a1, b1 = [], [], [], []
        n = 0
        for ring in rings:
            if len(ring) < 3:
                continue
            for r in prepare_ring(ring):
                a0.append(r[:-1, 0]); b0.append(r[:-1, 1])
                a1.append(r[1:, 0]); b1.append(r[1:, 1])
                n += 1
        if not a0:
            z = np.zeros(0)
            return cls(z, z, z, z, 0)
        return cls(np.concatenate(a0), np.concatenate(b0), np.concatenate(a1),
                   np.concatenate(b1), n)

    @classmethod
    def from_features(cls, feats: Iterable[tuple[list[np.ndarray], dict]],
                      keep: Callable[[dict], bool] | None = None) -> "EdgeSet":
        def gen():
            for parts, attrs in feats:
                if keep is None or keep(attrs):
                    yield from parts
        return cls.from_rings(gen())


class _PxEdges:
    """EdgeSet projected into supersampled pixel space, sorted by ymin."""

    def __init__(self, es: EdgeSet, Wss: int, Hss: int):
        x0 = (es.lon0 + 180.0) * (Wss / 360.0)
        x1 = (es.lon1 + 180.0) * (Wss / 360.0)
        y0 = (90.0 - es.lat0) * (Hss / 180.0)
        y1 = (90.0 - es.lat1) * (Hss / 180.0)
        keep = y0 != y1
        x0, x1, y0, y1 = x0[keep], x1[keep], y0[keep], y1[keep]
        # +1 for an upward edge in lat (y decreasing), -1 for downward
        self.dir = np.where(y1 < y0, 1, -1).astype(np.int32)
        self.ymin = np.minimum(y0, y1)
        self.ymax = np.maximum(y0, y1)
        self.x0, self.y0 = x0, y0
        self.slope = (x1 - x0) / (y1 - y0)
        o = np.argsort(self.ymin, kind="stable")
        for k in ("dir", "ymin", "ymax", "x0", "y0", "slope"):
            setattr(self, k, getattr(self, k)[o])
        self.Wss = Wss

    def winding_strip(self, r0: int, r1: int) -> np.ndarray:
        """int32 winding numbers for ss-rows [r0, r1) (sampled at pixel centres)."""
        W = self.Wss
        rows = r1 - r0
        n = np.searchsorted(self.ymin, r1 - 0.5, side="right")  # ymin <= last row centre
        sel = self.ymax[:n] > r0 + 0.5 - 1e-12
        idx = np.nonzero(sel)[0]
        diff = np.zeros(rows * (W + 1), dtype=np.int32)
        if idx.size:
            lo = np.maximum(np.ceil(self.ymin[idx] - 0.5), r0).astype(np.int64)
            hi = np.minimum(np.ceil(self.ymax[idx] - 0.5), r1).astype(np.int64)
            cnt = np.maximum(hi - lo, 0)
            m = cnt > 0
            idx, lo, cnt = idx[m], lo[m], cnt[m]
            total = int(cnt.sum())
            # process in chunks to bound the temporary arrays
            CH = 20_000_000
            starts = np.concatenate([[0], np.cumsum(cnt)])
            e0 = 0
            while e0 < idx.size:
                e1 = int(np.searchsorted(starts, starts[e0] + CH, side="right")) - 1
                e1 = max(e1, e0 + 1)
                c = cnt[e0:e1]
                rep = np.repeat(np.arange(e0, e1), c)
                off = np.arange(rep.size) - np.repeat(starts[e0:e1] - starts[e0], c)
                row = lo[rep] + off
                ei = idx[rep]
                yc = row + 0.5
                x = self.x0[ei] + (yc - self.y0[ei]) * self.slope[ei]
                col = np.clip(np.ceil(x - 0.5), 0, W).astype(np.int64)
                flat = (row - r0) * (W + 1) + col
                diff += np.bincount(flat, weights=self.dir[ei], minlength=diff.size).astype(np.int32)
                e0 = e1
            del total
        diff = diff.reshape(rows, W + 1)
        np.cumsum(diff, axis=1, out=diff)
        return diff[:, :W]


def _box_reduce(mask: np.ndarray, ss: int) -> np.ndarray:
    h, w = mask.shape
    s = mask.reshape(h // ss, ss, w // ss, ss).sum(axis=(1, 3), dtype=np.uint16)
    return ((s.astype(np.uint32) * 255 + (ss * ss) // 2) // (ss * ss)).astype(np.uint8)


def rasterize_coverage(layers: dict[str, EdgeSet], W: int, H: int, *, ss: int = 2,
                       combine: Callable[[dict[str, np.ndarray]], np.ndarray] | None = None,
                       out: np.ndarray | None = None, strip_rows: int = 512,
                       progress: Callable[[str], None] | None = None) -> np.ndarray:
    """Rasterise one or more polygon layers into an H x W uint8 coverage (0..255).

    `combine(masks)` receives {name: bool (rows, W*ss)} per strip and returns the bool mask
    to reduce (default: the single layer).  `out` may be a memmap."""
    Wss, Hss = W * ss, H * ss
    px = {k: _PxEdges(v, Wss, Hss) for k, v in layers.items()}
    if out is None:
        out = np.zeros((H, W), np.uint8)
    step = max(ss, (strip_rows // ss) * ss)
    for r0 in range(0, Hss, step):
        r1 = min(Hss, r0 + step)
        masks = {k: p.winding_strip(r0, r1) > 0 for k, p in px.items()}
        m = combine(masks) if combine else next(iter(masks.values()))
        out[r0 // ss:r1 // ss] = _box_reduce(m, ss)
        if progress and (r0 // step) % 8 == 0:
            progress(f"rows {r0}/{Hss}")
    return out


# ----------------------------------------------------------------------------- lines
def prepare_line(line: np.ndarray) -> list[np.ndarray]:
    lon = unwrap_lon(line[:, 0].astype(np.float64))
    r = np.stack([lon, line[:, 1]], 1)
    out = [r]
    if lon.min() < -180:
        out.append(r + [360.0, 0])
    if lon.max() > 180:
        out.append(r - [360.0, 0])
    return out


def draw_lines(lines: Sequence[tuple[np.ndarray, int, int]], W: int, H: int, *,
               out: np.ndarray | None = None, strip_rows: int = 1350) -> np.ndarray:
    """Draw (lonlat (N,2), width_px, value) polylines onto an H x W uint8 raster.
    Later items overwrite earlier ones, so pass them in increasing priority."""
    if out is None:
        out = np.zeros((H, W), np.uint8)
    prepped = []
    for ln, width, val in lines:
        for r in prepare_line(ln):
            x = (r[:, 0] + 180.0) * (W / 360.0) - 0.5
            y = (90.0 - r[:, 1]) * (H / 180.0) - 0.5
            prepped.append((x, y, int(width), int(val), y.min(), y.max()))
    for r0 in range(0, H, strip_rows):
        r1 = min(H, r0 + strip_rows)
        pad = 8
        img = Image.new("L", (W, r1 - r0 + 2 * pad), 0)
        d = ImageDraw.Draw(img)
        for x, y, w, v, ymn, ymx in prepped:
            if ymx < r0 - pad or ymn > r1 + pad:
                continue
            pts = list(zip(x.tolist(), (y - r0 + pad).tolist()))
            if len(pts) >= 2:
                d.line(pts, fill=v, width=w, joint="curve" if w > 2 else None)
        a = np.asarray(img)[pad:pad + (r1 - r0)]
        np.maximum(out[r0:r1], a, out=out[r0:r1])
    return out


def cell_centres(W: int, H: int) -> tuple[np.ndarray, np.ndarray]:
    lon = -180.0 + (np.arange(W) + 0.5) * (360.0 / W)
    lat = 90.0 - (np.arange(H) + 0.5) * (180.0 / H)
    return lon, lat


def lonlat_to_ij(lon: float, lat: float, W: int, H: int) -> tuple[int, int]:
    i = int(math.floor((lon + 180.0) / 360.0 * W)) % W
    j = min(H - 1, max(0, int(math.floor((90.0 - lat) / 180.0 * H))))
    return i, j
