"""Sync round without the original photos_meta_prev diff: assign every geo-tagged
photo to an existing location (<60 km) or a new cluster; new clusters and thin
existing locations that gained recent photos get candidates exported from Photos."""
import json
import math
import os
import re
import subprocess
import sys
import unicodedata

import reverse_geocoder as rg

BASE = os.environ.get("PIPELINE_BASE", os.path.expanduser("~/dev/personal-website/.pipeline"))
EXPORTS = f"{BASE}/exports"
CURATED = {"daly-city-us"}
SINCE = int(os.environ.get("SINCE_TS", "1785974400"))  # 2026-08-01: photos newer than the last build
DRY = "--dry" in sys.argv


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
            picked.append(min(chunk, key=lambda p: (not p["fav"], -(p["w"] * p["h"]))))
    return picked


cur = json.load(open(f"{BASE}/photos_meta.json"))
plan = json.load(open(f"{BASE}/export_plan.json"))
manifest = json.load(open(f"{BASE}/photos_manifest.json"))
by_slug = {p["slug"]: p for p in plan}

recent_by_slug = {}
new_clusters = []
for p in sorted(cur, key=lambda x: x["ts"] or 0):
    placed = False
    for entry in plan:
        c = entry["cluster"]
        if haversine_km((c["lat"], c["lon"]), (p["lat"], p["lon"])) < 60:
            c["count"] = c.get("count", 0) + 1
            if p["ts"]:
                c["first"] = min(c["first"] or p["ts"], p["ts"])
                c["last"] = max(c["last"] or p["ts"], p["ts"])
            if p["ts"] and p["ts"] > SINCE:
                recent_by_slug.setdefault(entry["slug"], []).append(p)
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

print(f"{len(cur)} geo-tagged photos → {len(new_clusters)} new clusters; "
      f"{len(recent_by_slug)} existing locations have photos since {SINCE}")

todo = []
if new_clusters:
    geo = rg.search([c["center"] for c in new_clusters], mode=1)
    for nc, g in zip(new_clusters, geo):
        ts = [p["ts"] for p in nc["photos"] if p["ts"]]
        if not any(t > SINCE for t in ts):
            # old photos that only look new because the greedy clustering split
            # them off — they were merged into a neighbour by an earlier build
            print(f"skip stale cluster near {g['name']}, {g['cc']} ({len(nc['photos'])} old photos)")
            continue
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
        print(f"NEW: {slug} ({g['name']}, {g['admin1']}, {g['cc']}) — {len(nc['photos'])} photos, {len(cands)} candidates")
        if cands:
            todo.append((slug, [c["id"] for c in cands]))

# thin existing locations that gained recent photos: top them up from the new shots
for slug, photos in recent_by_slug.items():
    if slug in CURATED:
        continue
    kept = len(manifest.get(slug, []))
    if kept >= 5:
        continue
    extra = pick_candidates(photos, 12)
    if extra:
        # filtered as a side entry, then merged into the base slug by merge_topups.py
        # (the base's already-published photos must survive; their exports are gone)
        tslug = f"{slug}--topup"
        entry = {"slug": tslug, "cluster": dict(by_slug[slug]["cluster"]), "candidates": extra}
        plan.append(entry)
        by_slug[tslug] = entry
        todo.append((tslug, [c["id"] for c in extra]))
        print(f"TOP-UP: {slug} has {kept} photos, exporting {len(extra)} recent candidates")

if DRY:
    print("dry run, nothing exported")
    sys.exit(0)

EXPORT_SCRIPT = f"{BASE}/export_batch.applescript"
with open(EXPORT_SCRIPT, "w") as f:
    f.write('''on run argv
  set outDir to item 1 of argv
  tell application "Photos"
    set mediaList to {}
    repeat with i from 2 to count of argv
      try
        set end of mediaList to media item id (item i of argv)
      end try
    end repeat
    with timeout of 600 seconds
      export mediaList to POSIX file outDir
    end timeout
  end tell
end run
''')

for i, (slug, ids) in enumerate(todo):
    outdir = f"{EXPORTS}/{slug}"
    os.makedirs(outdir, exist_ok=True)
    r = subprocess.run(["osascript", EXPORT_SCRIPT, outdir] + ids, capture_output=True, text=True, timeout=900)
    got = len(os.listdir(outdir))
    status = "ok" if r.returncode == 0 else f"ERR {r.stderr.strip()[:120]}"
    print(f"[{i+1}/{len(todo)}] {slug}: {got}/{len(ids)} files ({status})", flush=True)

json.dump(plan, open(f"{BASE}/export_plan.json", "w"))
json.dump(manifest, open(f"{BASE}/photos_manifest.json", "w"))
print("SYNC_EXPORT_COMPLETE")
