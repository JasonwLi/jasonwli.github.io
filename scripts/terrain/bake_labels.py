"""D2: labels.json (map labels for C4) + charset.txt (C4 font subset).

Schema (src/three/terrain/manifest.ts LabelsFile):
  {"v":1,"labels":[{"id","t","k","r","lat","lon","b","a","s","ls"}]}
  k  ocean|sea|bay|strait|range|desert|plateau|plain|basin|peninsula|island|lake|river|peak|region
  r  rank 0..9 (NE scalerank; lower = more important)
  b  baseline bearing, degrees clockwise from east in the local tangent plane, within (-90, 90]
  a  arc radius km; 0 = straight; a > 0 = the middle of the baseline bulges toward the text's
     "up" side (local north for an east-west label: an arch), a < 0 = sags (a bowl)
  s  cap height km;  ls letter spacing em

Sources: NE 10m geography_regions_polys, geography_marine_polys, geography_regions_points,
geography_regions_elevation_points, lakes (scalerank <= 4), and the merged rivers from
bake_rivers (named, scalerank <= 3, k=river; critique amendment for C4's P1 river labels).

Polygons: largest ring -> local azimuthal-equidistant plane about the area centroid (pole of
inaccessibility if the centroid falls outside); principal axis = PCA of ring vertices weighted
by segment length; L = 0.7 x extent along the axis; arc from the centroids of 5 slices along the
axis (circle through slices 1, 3, 5; kept when radius > 1.2 L); s = clamp(L / (0.62 len), 20, 900).
Points: b = a = 0, s by scalerank. Duplicates (same name within 150 km) dropped.
Letter spacing follows the theme (critique): water names 0.2 em, land areas 0.35 em, islands /
peaks / rivers 0.12 em. Text keeps NE's case (all-caps NE names are title-cased); C4 uppercases.

Run: ~/dev/dw3-lock scripts/terrain/.venv/bin/python scripts/terrain/bake_labels.py --check
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
import unicodedata
from pathlib import Path

import numpy as np
from shapely.geometry import Point, Polygon
from shapely.ops import polylabel

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bake_physical import read_shp  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "scripts" / "data" / "bake" / "physical"
R_KM = 6371.0

POLY_KIND = {
    "Island": "island", "Island group": "island", "Range/mtn": "range", "Foothills": "range",
    "Plateau": "plateau", "Desert": "desert", "Pen/cape": "peninsula", "Peninsula": "peninsula",
    "Isthmus": "peninsula", "Plain": "plain", "Lowland": "plain", "Basin": "basin", "Depression": "basin",
    "Lake": "lake", "Geoarea": "region", "Coast": "region", "Delta": "region", "Valley": "region",
    "Tundra": "region", "Wetlands": "region", "Gorge": "region",
}
MARINE_KIND = {
    "ocean": "ocean", "sea": "sea", "generic": "sea", "gulf": "bay", "bay": "bay", "sound": "bay",
    "fjord": "bay", "inlet": "bay", "lagoon": "bay", "strait": "strait", "channel": "strait",
}
POINT_KIND = {"island": "island", "island group": "island", "cape": "peninsula", "plain": "plain", "pole": "region"}
ELEV_KIND = {"mountain": "peak", "spot elevation": "peak", "plateau": "plateau", "depression": "basin"}
WATER = {"ocean", "sea", "bay", "strait", "lake"}
LAND_AREA = {"range", "desert", "plateau", "plain", "basin", "region", "peninsula"}
POINT_S = {0: 300, 1: 220, 2: 160, 3: 120, 4: 90, 5: 70, 6: 55, 7: 45, 8: 38, 9: 32}
RIVER_S = {0: 70, 1: 60, 2: 48, 3: 38}


def letter_spacing(k: str) -> float:
    if k in WATER:
        return 0.2
    if k in LAND_AREA:
        return 0.35
    return 0.12


def tidy(name: str) -> str:
    name = re.sub(r"\s+", " ", (name or "").strip())
    if name and name.upper() == name and any(c.isalpha() for c in name):
        name = " ".join(w.capitalize() if w.lower() not in ("of", "the", "de", "la") else w.lower() for w in name.split(" "))
    return name


def slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "x"


# ----------------------------------------------------------------------------- geometry


def to_vec(lon, lat):
    lo, la = np.radians(lon), np.radians(lat)
    return np.stack([np.cos(la) * np.cos(lo), np.sin(la), -np.cos(la) * np.sin(lo)], -1)


def to_lonlat(v):
    v = v / np.linalg.norm(v, axis=-1, keepdims=True)
    return np.degrees(np.arctan2(-v[..., 2], v[..., 0])), np.degrees(np.arcsin(np.clip(v[..., 1], -1, 1)))


def aeqd(lon, lat, lon0, lat0):
    """Azimuthal equidistant (km): x east, y north about (lon0, lat0)."""
    la0, lo0 = math.radians(lat0), math.radians(lon0)
    la, lo = np.radians(lat), np.radians(lon)
    dl = lo - lo0
    cosc = np.clip(math.sin(la0) * np.sin(la) + math.cos(la0) * np.cos(la) * np.cos(dl), -1, 1)
    c = np.arccos(cosc)
    k = np.where(c < 1e-12, 1.0, c / np.maximum(np.sin(c), 1e-12))
    x = k * np.cos(la) * np.sin(dl)
    y = k * (math.cos(la0) * np.sin(la) - math.sin(la0) * np.cos(la) * np.cos(dl))
    return x * R_KM, y * R_KM


def inv_aeqd(x, y, lon0, lat0):
    la0, lo0 = math.radians(lat0), math.radians(lon0)
    x, y = np.asarray(x) / R_KM, np.asarray(y) / R_KM
    c = np.hypot(x, y)
    if np.all(c < 1e-12):
        return np.full_like(x, lon0), np.full_like(x, lat0)
    sc, cc = np.sin(c), np.cos(c)
    with np.errstate(invalid="ignore", divide="ignore"):
        la = np.arcsin(np.clip(cc * math.sin(la0) + np.where(c > 0, y * sc * math.cos(la0) / c, 0), -1, 1))
        lo = lo0 + np.arctan2(x * sc, c * math.cos(la0) * cc - y * math.sin(la0) * sc)
    return (np.degrees(lo) + 540) % 360 - 180, np.degrees(la)


def rings_of(shape):
    pts = np.asarray(shape.points, np.float64)
    parts = list(shape.parts) + [len(pts)]
    return [pts[a:b] for a, b in zip(parts[:-1], parts[1:]) if b - a >= 4]


def ring_area_km2(ring):
    v = to_vec(ring[:, 0], ring[:, 1])
    c = v.mean(0)
    lon0, lat0 = to_lonlat(c)
    x, y = aeqd(ring[:, 0], ring[:, 1], float(lon0), float(lat0))
    return abs(0.5 * np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y))


def poly_label(rings, text: str):
    """(lat, lon, b, a, s_raw_L) for the largest ring of a polygon."""
    ring = max(rings, key=ring_area_km2)
    seg = np.linalg.norm(np.diff(to_vec(ring[:, 0], ring[:, 1]), axis=0), axis=1)
    w = np.concatenate([[0], seg]) + np.concatenate([seg, [0]])
    v = to_vec(ring[:, 0], ring[:, 1])
    c = (v * w[:, None]).sum(0)
    lon0, lat0 = (float(z) for z in to_lonlat(c))
    x, y = aeqd(ring[:, 0], ring[:, 1], lon0, lat0)
    P = Polygon(np.column_stack([x, y])).buffer(0)
    if P.is_empty:
        return None
    if not P.contains(Point(0.0, 0.0)):
        if P.geom_type == "MultiPolygon":
            P = max(P.geoms, key=lambda g: g.area)
        cx_, cy_ = P.centroid.x, P.centroid.y
        if not P.contains(P.centroid):
            p = polylabel(P, tolerance=max(1.0, math.sqrt(P.area) / 50))
            cx_, cy_ = p.x, p.y
        lo, la = inv_aeqd(np.array([cx_]), np.array([cy_]), lon0, lat0)
        lon0, lat0 = float(lo[0]), float(la[0])
        x, y = aeqd(ring[:, 0], ring[:, 1], lon0, lat0)
        P = Polygon(np.column_stack([x, y])).buffer(0)
        if P.geom_type == "MultiPolygon":
            P = max(P.geoms, key=lambda g: g.area)
    xy = np.column_stack([x, y])
    mu = (xy * w[:, None]).sum(0) / w.sum()
    d = xy - mu
    cov = (d * w[:, None]).T @ d / w.sum()
    evals, evecs = np.linalg.eigh(cov)
    ax = evecs[:, np.argmax(evals)]
    theta = math.degrees(math.atan2(ax[1], ax[0]))  # ccw from east
    b = -theta  # clockwise from east
    b = (b + 180) % 360 - 180
    if b > 90:
        b -= 180
    elif b <= -90:
        b += 180
    br = math.radians(-b)  # back to ccw for maths
    u = np.array([math.cos(br), math.sin(br)])  # reading direction
    nrm = np.array([-u[1], u[0]])  # text-up (left of reading direction)
    proj = xy @ u
    lo_, hi_ = float(proj.min()), float(proj.max())
    L = 0.7 * (hi_ - lo_)
    # arc: 5 slices along the axis
    a = 0.0
    try:
        cents = []
        for i in range(5):
            s0 = lo_ + (hi_ - lo_) * i / 5
            s1 = lo_ + (hi_ - lo_) * (i + 1) / 5
            corners = np.array([u * s0 + nrm * -1e5, u * s1 + nrm * -1e5, u * s1 + nrm * 1e5, u * s0 + nrm * 1e5])
            sl = P.intersection(Polygon(corners))
            if sl.is_empty:
                raise ValueError
            cents.append(np.array([sl.centroid.x, sl.centroid.y]))
        p1, p3, p5 = cents[0], cents[2], cents[4]
        A, B, C = p1, p3, p5
        dd = 2 * (A[0] * (B[1] - C[1]) + B[0] * (C[1] - A[1]) + C[0] * (A[1] - B[1]))
        if abs(dd) > 1e-9:
            ux = ((A @ A) * (B[1] - C[1]) + (B @ B) * (C[1] - A[1]) + (C @ C) * (A[1] - B[1])) / dd
            uy = ((A @ A) * (C[0] - B[0]) + (B @ B) * (A[0] - C[0]) + (C @ C) * (B[0] - A[0])) / dd
            rad = float(np.hypot(A[0] - ux, A[1] - uy))
            if rad > 1.2 * L:
                bulge = float((p3 - 0.5 * (p1 + p5)) @ nrm)
                a = rad if bulge > 0 else -rad
    except (ValueError, Exception):
        a = 0.0
    s = float(np.clip(L / (0.62 * max(1, len(text))), 20, 900))
    return lat0, lon0, b, a, s


# ----------------------------------------------------------------------------- sources


def from_polys(labels):
    r = read_shp("geography_regions_polys")
    for sr in r.iterShapeRecords():
        rec = sr.record
        cls, rank = rec["FEATURECLA"], int(rec["SCALERANK"])
        k = POLY_KIND.get(cls)
        if k is None or cls == "Continent" or rank > 9:
            continue
        keep = rank <= 4 if k != "island" else rank <= 3
        if not keep:
            continue
        t = tidy(rec["NAME"])
        if not t:
            continue
        g = poly_label(rings_of(sr.shape), t)
        if g:
            labels.append((t, k, rank, *g))


def from_marine(labels):
    r = read_shp("geography_marine_polys")
    for sr in r.iterShapeRecords():
        rec = sr.record
        k = MARINE_KIND.get(rec["featurecla"])
        rank = int(rec["scalerank"])
        if k is None or rank > 4:
            continue
        t = tidy(rec["name"])
        if not t:
            continue
        g = poly_label(rings_of(sr.shape), t)
        if g:
            labels.append((t, k, rank, *g))


def from_lakes(labels):
    r = read_shp("lakes")
    for sr in r.iterShapeRecords():
        rec = sr.record
        rank = int(rec["scalerank"])
        t = tidy(rec["name"])
        if rank > 4 or not t:
            continue
        g = poly_label(rings_of(sr.shape), t)
        if g:
            labels.append((t, "lake", rank, *g))


def from_points(labels):
    r = read_shp("geography_regions_points")
    for rec in r.records():
        k = POINT_KIND.get(rec["featurecla"])
        rank = int(rec["scalerank"])
        t = tidy(rec["name"])
        if k is None or rank > 4 or not t:
            continue
        labels.append((t, k, rank, float(rec["lat_y"]), float(rec["long_x"]), 0.0, 0.0, POINT_S[min(rank, 9)]))
    r = read_shp("geography_regions_elevation_points")
    for rec in r.records():
        k = ELEV_KIND.get(rec["featurecla"])
        rank = int(rec["scalerank"])
        t = tidy(rec["name"])
        if k is None or rank > 4 or not t:
            continue
        labels.append((t, k, rank, float(rec["lat_y"]), float(rec["long_x"]), 0.0, 0.0, POINT_S[min(rank, 9)] * 0.6))


# NE names one river differently per country/segment; label each river once, in English.
RIVER_ALIASES = {
    "Firat": "Euphrates", "Al Furat": "Euphrates", "Donau": "Danube", "Ertis": "Irtysh", "Ertix": "Irtysh",
    "Heilong Jiang": "Amur", "Chang Jiang": "Yangtze", "Amazonas": "Amazon",
}


def from_rivers(labels):
    p = OUT_DIR / "rivers.json"
    if not p.exists():
        raise SystemExit("rivers.json missing: run bake_rivers.py first")
    data = json.loads(p.read_text())
    best = {}
    for rv in data["rivers"]:
        if not rv["n"] or rv["r"] > 3:
            continue
        name = RIVER_ALIASES.get(rv["n"], rv["n"])
        pts = np.asarray(rv["p"], np.float64).reshape(-1, 2)
        v = to_vec(pts[:, 0], pts[:, 1])
        seg = np.linalg.norm(np.diff(v, axis=0), axis=1) * R_KM
        L = float(seg.sum())
        if name not in best or L > best[name][0]:
            best[name] = (L, min(rv["r"], best[name][1]) if name in best else rv["r"], pts, seg)
    for name, (L, rank, pts, seg) in best.items():
        if L < 150:
            continue
        cum = np.concatenate([[0], np.cumsum(seg)])
        mid = L / 2
        i = int(np.searchsorted(cum, mid))
        i = min(max(i, 1), len(pts) - 1)
        f = (mid - cum[i - 1]) / max(seg[i - 1], 1e-9)
        lon0 = pts[i - 1, 0] + f * (pts[i, 0] - pts[i - 1, 0])
        lat0 = pts[i - 1, 1] + f * (pts[i, 1] - pts[i - 1, 1])
        half = min(L / 4, 0.62 * len(name) * RIVER_S[rank] / 2 + 50)
        ja = int(np.searchsorted(cum, mid - half))
        jb = min(int(np.searchsorted(cum, mid + half)), len(pts) - 1)
        x, y = aeqd(pts[[ja, jb], 0], pts[[ja, jb], 1], float(lon0), float(lat0))
        b = -math.degrees(math.atan2(y[1] - y[0], x[1] - x[0]))
        b = (b + 180) % 360 - 180
        if b > 90:
            b -= 180
        elif b <= -90:
            b += 180
        labels.append((name, "river", rank, float(lat0), float((lon0 + 540) % 360 - 180), b, 0.0, RIVER_S[rank]))


# ----------------------------------------------------------------------------- main


def dedupe(labels):
    out = []
    for lab in sorted(labels, key=lambda l: (l[2], -l[7])):
        t, lat, lon = lab[0], lab[3], lab[4]
        v = to_vec(np.float64(lon), np.float64(lat))
        dup = False
        for o in out:
            if o[0].lower() == t.lower():
                d = math.acos(float(np.clip(v @ to_vec(np.float64(o[4]), np.float64(o[3])), -1, 1))) * R_KM
                if d < 150:
                    dup = True
                    break
        if not dup:
            out.append(lab)
    return out


def build():
    labels = []
    from_polys(labels)
    from_marine(labels)
    from_lakes(labels)
    from_points(labels)
    from_rivers(labels)
    n_raw = len(labels)
    labels = dedupe(labels)
    rows, ids = [], set()
    for t, k, r, lat, lon, b, a, s in labels:
        b = round(float(b), 1)
        if b <= -90:
            b += 180.0
        elif b > 90:
            b -= 180.0
        base = f"{k}-{slug(t)}"
        i, n = base, 2
        while i in ids:
            i, n = f"{base}-{n}", n + 1
        ids.add(i)
        rows.append({"id": i, "t": t, "k": k, "r": int(min(max(r, 0), 9)), "lat": round(float(lat), 4),
                     "lon": round(float(lon), 4), "b": round(float(b), 1), "a": round(float(a)), "s": round(float(s), 1),
                     "ls": letter_spacing(k)})
    rows.sort(key=lambda x: (x["r"], x["k"], x["t"]))
    print(f"  labels: {n_raw} raw -> {len(rows)} after 150 km same-name dedupe")
    return {"v": 1, "labels": rows}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    data = build()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    txt = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    (OUT_DIR / "labels.json").write_text(txt, encoding="utf-8")
    chars = set(" 0123456789.,-'’()&")
    for lab in data["labels"]:
        chars |= set(lab["t"]) | set(lab["t"].upper())
    (OUT_DIR / "charset.txt").write_text("".join(sorted(chars)), encoding="utf-8")
    from collections import Counter

    kinds = Counter(l["k"] for l in data["labels"])
    print(f"  kinds: {dict(sorted(kinds.items()))}; {len(chars)} chars; {len(txt.encode()) / 1e3:.1f} KB raw")
    ok = True
    if a.check:
        n = len(data["labels"])
        allowed = {"ocean", "sea", "bay", "strait", "range", "desert", "plateau", "plain", "basin", "peninsula",
                   "island", "lake", "river", "peak", "region"}
        checks = [
            ("300 <= labels <= 900", 300 <= n <= 900, n),
            ("kinds valid", set(kinds) <= allowed, sorted(kinds)),
            ("bearing within (-90, 90]", all(-90 < l["b"] <= 90 for l in data["labels"]), ""),
            ("cap height 20..900 km (polys) / >0", all(l["s"] > 0 for l in data["labels"]), ""),
            ("rivers labelled (rank <= 3)", kinds.get("river", 0) > 10, kinds.get("river", 0)),
            ("unique ids", len({l["id"] for l in data["labels"]}) == n, ""),
        ]
        for nm, ok1, d in checks:
            ok &= bool(ok1)
            print(f"  [{'PASS' if ok1 else 'FAIL'}] {nm} {d}")
        for probe in ("Sahara", "Alps", "Himalayas", "Mediterranean Sea", "North Atlantic Ocean", "Nile", "Amazon"):
            hit = [l for l in data["labels"] if l["t"] == probe]
            print(f"    {probe}: {hit[0] if hit else 'MISSING'}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
