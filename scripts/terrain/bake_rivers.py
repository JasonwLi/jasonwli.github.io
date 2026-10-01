"""D2: rivers.json for the desktop river ribbons (C6) and river labels (bake_labels.py).

Schema (src/three/terrain/manifest.ts RiversFile):
  {"v": 1, "rivers": [{"n": name or "", "r": scalerank, "p": [lon, lat, lon, lat, ...]}]}

- Source: NE 10m rivers_lake_centerlines_scale_rank, scalerank <= 9, rivers/canals only
  (lake centrelines are dropped: they would draw ribbons across lake water).
- Contiguous segments with the same name AND the same scalerank are merged end to end (NE
  splits rivers by rank along their course; merging across ranks would lose the width cue).
  Unnamed lines merge by NE's `dissolve` key under the same rule.
- Douglas-Peucker simplification, tolerance 0.8 km, in a local tangent plane (equirectangular
  km about the line's mean point; the line is longitude-unwrapped first).
- Longitudes are UNWRAPPED along each line so a line crossing the antimeridian stays continuous
  (values may leave [-180, 180]); clients convert with cos/sin so this is harmless.
- Coordinates rounded to 4 decimals (~11 m). Raw size target <= 1.2 MB.

Run: ~/dev/dw3-lock scripts/terrain/.venv/bin/python scripts/terrain/bake_rivers.py
"""
from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from shapely.geometry import LineString

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bake_physical import read_shp  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "scripts" / "data" / "bake" / "physical" / "rivers.json"
MAX_RANK = 9
TOL_KM = 0.8  # plan tolerance (rank <= 5)
TOL_KM_MINOR = 1.4  # rank 6-9: only drawn below ~1,500 km; keeps the file <= 1.2 MB
KM_DEG = 111.195


def unwrap(pts: np.ndarray) -> np.ndarray:
    p = pts.copy()
    p[:, 0] = np.degrees(np.unwrap(np.radians(p[:, 0])))
    return p


def merge_lines(lines: list[np.ndarray]) -> list[np.ndarray]:
    """Greedy end-to-end merge of polylines whose endpoints coincide (1e-6 deg), either direction."""
    def key(p):
        return (round(float(p[0]), 6), round(float(p[1]), 6))

    pool = [np.asarray(l, np.float64) for l in lines]
    changed = True
    while changed and len(pool) > 1:
        changed = False
        ends = defaultdict(list)
        for i, l in enumerate(pool):
            ends[key(l[0])].append((i, 0))
            ends[key(l[-1])].append((i, 1))
        used = set()
        out = []
        for i, l in enumerate(pool):
            if i in used:
                continue
            used.add(i)
            cur = l
            grew = True
            while grew:
                grew = False
                for side in (1, 0):
                    k = key(cur[-1] if side == 1 else cur[0])
                    for j, e in ends.get(k, []):
                        if j in used:
                            continue
                        o = pool[j]
                        if side == 1:
                            nxt = o if e == 0 else o[::-1]
                            cur = np.vstack([cur, nxt[1:]])
                        else:
                            prv = o if e == 1 else o[::-1]
                            cur = np.vstack([prv[:-1], cur])
                        used.add(j)
                        grew = changed = True
                        break
                    if grew:
                        break
            out.append(cur)
        pool = out
    return pool


def simplify(pts: np.ndarray, tol: float = TOL_KM) -> np.ndarray:
    p = unwrap(pts)
    lon0, lat0 = p[:, 0].mean(), p[:, 1].mean()
    c = math.cos(math.radians(lat0))
    xy = np.column_stack([(p[:, 0] - lon0) * KM_DEG * c, (p[:, 1] - lat0) * KM_DEG])
    s = np.asarray(LineString(xy).simplify(tol, preserve_topology=False).coords)
    if len(s) < 2:
        s = xy[[0, -1]]
    return np.column_stack([s[:, 0] / (KM_DEG * c) + lon0, s[:, 1] / KM_DEG + lat0])


def build() -> dict:
    r = read_shp("rivers_lake_centerlines_scale_rank")
    groups: dict[tuple, list] = defaultdict(list)
    names = {}
    for sr in r.iterShapeRecords():
        rec = sr.record
        rank = int(rec["scalerank"])
        if rank > MAX_RANK or rec["featurecla"] == "Lake Centerline":
            continue
        name = (rec["name"] or "").strip()
        key = (name or "#" + str(rec["dissolve"]), rank)
        names[key] = name
        pts = np.asarray(sr.shape.points, np.float64)
        parts = list(sr.shape.parts) + [len(pts)]
        for a, b in zip(parts[:-1], parts[1:]):
            if b - a >= 2:
                groups[key].append(pts[a:b])
    rivers = []
    n_in = sum(len(v) for v in groups.values())
    for key, lines in groups.items():
        for m in merge_lines(lines):
            s = simplify(m, TOL_KM if key[1] <= 5 else TOL_KM_MINOR)
            flat = np.round(s, 4).ravel().tolist()
            rivers.append({"n": names[key], "r": key[1], "p": flat})
    rivers.sort(key=lambda x: (x["r"], x["n"]))
    print(f"  rivers: {n_in} NE parts -> {len(rivers)} merged lines, "
          f"{sum(len(x['p']) // 2 for x in rivers)} vertices")
    return {"v": 1, "rivers": rivers}


def main():
    data = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    txt = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    OUT.write_text(txt, encoding="utf-8")
    size = len(txt.encode("utf-8"))
    ok = size <= 1_200_000
    print(f"  [{'PASS' if ok else 'FAIL'}] rivers.json {size / 1e6:.3f} MB (<= 1.2 MB) -> {OUT}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
