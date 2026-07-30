"""Fold newly synced geo-tagged photos into the dataset: extend clusters, form new
ones, export candidates for affected locations, and clear them for re-filtering."""
import json
import math
import os
import re
import subprocess
import unicodedata

import reverse_geocoder as rg

BASE = "/private/tmp/claude-501/-Users-jasonli-dev/609d9fd3-c32a-476f-9147-b3fa5a85aced/scratchpad"
EXPORTS = f"{BASE}/exports"
CURATED = {"daly-city-us"}  # hand-picked; never auto-cleared


def haversine_km(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def slugify(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def pick_candidates(photos, n):
    photos = [p for p in photos if p["w"] and p["h"] and max(p["w"], p["h"]) >= 1500]
    if not photos:
        return []
    photos.sort(key=lambda p: p["ts"] or 0)
    if len(photos) <= n:
        return photos
    picked = []
    per = len(photos) / n
    for b in range(n):
        chunk = photos[int(b * per):int((b + 1) * per)]
        if chunk:
            chunk = sorted(chunk, key=lambda p: (not p["fav"], -(p["w"] * p["h"])))
            picked.append(chunk[0])
    return picked


prev = {p["id"] for p in json.load(open(f"{BASE}/photos_meta_prev.json"))}
cur = json.load(open(f"{BASE}/photos_meta.json"))
new_photos = [p for p in cur if p["id"] not in prev]

plan = json.load(open(f"{BASE}/export_plan.json"))
manifest = json.load(open(f"{BASE}/photos_manifest.json"))
by_slug = {p["slug"]: p for p in plan}

# assign new photos to existing plan clusters or form new ones
new_clusters = []
affected = {}
for p in sorted(new_photos, key=lambda x: x["ts"] or 0):
    placed = False
    for entry in plan:
        c = entry["cluster"]
        if haversine_km((c["lat"], c["lon"]), (p["lat"], p["lon"])) < 60:
            c["count"] += 1
            c["first"] = min(c["first"], p["ts"] or c["first"])
            c["last"] = max(c["last"], p["ts"] or c["last"])
            affected.setdefault(entry["slug"], []).append(p)
            placed = True
            break
    if placed:
        continue
    for nc in new_clusters:
        if haversine_km(nc["center"], (p["lat"], p["lon"])) < 60:
            nc["photos"].append(p)
            n = len(nc["photos"])
            nc["center"] = (
                nc["center"][0] + (p["lat"] - nc["center"][0]) / n,
                nc["center"][1] + (p["lon"] - nc["center"][1]) / n,
            )
            placed = True
            break
    if not placed:
        new_clusters.append({"center": (p["lat"], p["lon"]), "photos": [p]})

print(f"new photos: {len(new_photos)} → {len(affected)} existing locations extended, {len(new_clusters)} new clusters")

# register new clusters in the plan
if new_clusters:
    geo = rg.search([c["center"] for c in new_clusters], mode=1)
    for nc, g in zip(new_clusters, geo):
        ts = [p["ts"] for p in nc["photos"] if p["ts"]]
        slug = slugify(f"{g['name']}-{g['cc']}")
        n = 2
        while slug in by_slug:
            slug = f"{slugify(g['name'] + '-' + g['cc'])}-{n}"
            n += 1
        cands = pick_candidates(nc["photos"], 12)
        entry = {
            "slug": slug,
            "cluster": {
                "city": g["name"], "admin": g["admin1"], "cc": g["cc"],
                "lat": round(nc["center"][0], 4), "lon": round(nc["center"][1], 4),
                "count": len(nc["photos"]),
                "first": min(ts) if ts else None, "last": max(ts) if ts else None,
            },
            "candidates": cands,
        }
        plan.append(entry)
        by_slug[slug] = entry
        print(f"NEW: {slug} ({g['name']}, {g['cc']}) — {len(nc['photos'])} photos, {len(cands)} candidates")

# decide what to export: new clusters + affected slugs still under 5 kept photos
EXPORT_SCRIPT = f"{BASE}/export_batch.applescript"
todo = []
for nc in new_clusters:
    pass  # handled via plan entries below
for entry in plan:
    slug = entry["slug"]
    kept = len(manifest.get(slug, []))
    is_new = slug not in {pl["slug"] for pl in plan[: len(plan) - len(new_clusters)]} if new_clusters else False
    if slug in CURATED:
        continue
    if slug in affected and kept < 5:
        extra = [c for c in pick_candidates(affected[slug], 12)]
        if extra:
            todo.append((slug, [c["id"] for c in extra]))
            manifest.pop(slug, None)
    elif slug not in {p2["slug"] for p2 in plan} or False:
        pass
for entry in plan[len(plan) - len(new_clusters):] if new_clusters else []:
    todo.append((entry["slug"], [c["id"] for c in entry["candidates"]]))

for i, (slug, ids) in enumerate(todo):
    outdir = f"{EXPORTS}/{slug}"
    os.makedirs(outdir, exist_ok=True)
    r = subprocess.run(["osascript", EXPORT_SCRIPT, outdir] + ids, capture_output=True, text=True, timeout=900)
    status = "ok" if r.returncode == 0 else f"ERR {r.stderr.strip()[:100]}"
    print(f"[{i+1}/{len(todo)}] {slug}: +{len(ids)} ({status})", flush=True)

with open(f"{BASE}/export_plan.json", "w") as f:
    json.dump(plan, f)
with open(f"{BASE}/photos_manifest.json", "w") as f:
    json.dump(manifest, f)
print("INCREMENTAL_EXPORT_COMPLETE")
