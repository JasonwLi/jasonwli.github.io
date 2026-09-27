"""Cluster geo-tagged photos into visited locations (city scale) and reverse geocode."""
import json
import os
import math
from collections import defaultdict

import reverse_geocoder as rg

BASE = os.environ.get("PIPELINE_BASE", os.path.expanduser("~/dev/personal-website/.pipeline"))

with open(f"{BASE}/photos_meta.json") as f:
    photos = json.load(f)

print(f"geo-tagged photos: {len(photos)}")

def haversine_km(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))

# greedy clustering, ~60 km radius (city scale)
clusters = []  # each: {"center": (lat, lon), "photos": [...]}
for p in sorted(photos, key=lambda x: x["ts"] or 0):
    placed = False
    for c in clusters:
        if haversine_km(c["center"], (p["lat"], p["lon"])) < 60:
            c["photos"].append(p)
            n = len(c["photos"])
            c["center"] = (
                c["center"][0] + (p["lat"] - c["center"][0]) / n,
                c["center"][1] + (p["lon"] - c["center"][1]) / n,
            )
            placed = True
            break
    if not placed:
        clusters.append({"center": (p["lat"], p["lon"]), "photos": [p]})

clusters.sort(key=lambda c: -len(c["photos"]))
coords = [c["center"] for c in clusters]
geo = rg.search(coords, mode=1)  # offline, city-level, single-process

out = []
for c, g in zip(clusters, geo):
    ts = [p["ts"] for p in c["photos"] if p["ts"]]
    out.append({
        "city": g["name"],
        "admin": g["admin1"],
        "cc": g["cc"],
        "lat": round(c["center"][0], 4),
        "lon": round(c["center"][1], 4),
        "count": len(c["photos"]),
        "first": min(ts) if ts else None,
        "last": max(ts) if ts else None,
        "photos": c["photos"],
    })

with open(f"{BASE}/clusters.json", "w") as f:
    json.dump(out, f)

from datetime import datetime, timezone
def fmt(ts):
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m") if ts else "?"

print(f"\nclusters: {len(out)}")
for c in out:
    print(f"{c['count']:5d}  {c['city']}, {c['admin']}, {c['cc']}  ({fmt(c['first'])} → {fmt(c['last'])})  [{c['lat']},{c['lon']}]")
