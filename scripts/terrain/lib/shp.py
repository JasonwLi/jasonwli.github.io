"""Read Natural Earth shapefiles straight out of their zips with pyshp (no GDAL).

    for parts, attrs in read_zip("scripts/.cache/ne/ne_10m_land.zip"):
        # parts: list of float64 (N, 2) arrays of (lon, lat); attrs: dict of the dbf record

Polygon parts are rings in shapefile order: outer rings clockwise, holes counter-clockwise
(the shapefile spec; y up).  lib/rasterize.py relies on that orientation (non-zero winding).
Polyline parts are line strings.
"""
from __future__ import annotations

import io
import zipfile
from pathlib import Path
from typing import Iterator

import numpy as np
import shapefile  # pyshp

ROOT = Path(__file__).resolve().parents[3]
NE_DIR = ROOT / "scripts/.cache/ne"


def ne_zip(name: str) -> Path:
    """'land' or 'ne_10m_land' -> scripts/.cache/ne/ne_10m_land.zip"""
    stem = name if name.startswith("ne_") else f"ne_10m_{name}"
    return NE_DIR / f"{stem}.zip"


def _open(zpath: Path) -> shapefile.Reader:
    zf = zipfile.ZipFile(zpath)
    names = zf.namelist()

    def member(ext: str) -> io.BytesIO | None:
        m = next((n for n in names if n.lower().endswith(ext)), None)
        return io.BytesIO(zf.read(m)) if m else None

    enc = "utf-8"
    cpg = next((n for n in names if n.lower().endswith(".cpg")), None)
    if cpg:
        enc = zf.read(cpg).decode("ascii", "ignore").strip() or "utf-8"
        if enc.upper() in ("UTF-8", "UTF8"):
            enc = "utf-8"
    return shapefile.Reader(shp=member(".shp"), shx=member(".shx"), dbf=member(".dbf"),
                            encoding=enc, encodingErrors="replace")


def read_zip(zpath: str | Path) -> Iterator[tuple[list[np.ndarray], dict]]:
    """Yield (parts, attrs) per record.  Null shapes are skipped."""
    zpath = Path(zpath)
    if not zpath.exists():
        zpath = ne_zip(str(zpath))
    r = _open(zpath)
    fields = [f[0] for f in r.fields[1:]]
    for sr in r.iterShapeRecords():
        shp = sr.shape
        if shp.shapeType == shapefile.NULL or not shp.points:
            continue
        pts = np.asarray(shp.points, dtype=np.float64)[:, :2]
        idx = list(shp.parts) + [len(pts)]
        parts = [pts[idx[k]:idx[k + 1]] for k in range(len(idx) - 1) if idx[k + 1] - idx[k] >= 2]
        yield parts, dict(zip(fields, sr.record))


def shape_type(zpath: str | Path) -> str:
    r = _open(Path(zpath))
    return r.shapeTypeName


def signed_area(ring: np.ndarray) -> float:
    """Shoelace area in lon/lat units; > 0 = counter-clockwise (y up)."""
    x, y = ring[:, 0], ring[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(np.roll(x, -1), y))
