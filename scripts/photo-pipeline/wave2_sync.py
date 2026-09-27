"""Second wave for thin NEW locations: export up to 30 candidates (minus wave 1)
from every photo within 60 km of the cluster centre, then clear them for re-filtering."""
import json
import math
import os
import subprocess
import sys

BASE = os.environ.get("PIPELINE_BASE", os.path.expanduser("~/dev/personal-website/.pipeline"))
EXPORTS = f"{BASE}/exports"
THIN, WAVE2_N = 5, 30
slugs = sys.argv[1:]


def haversine_km(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def pick_candidates(photos, n):
    photos = [p for p in photos if p["w"] and p["h"] and max(p["w"], p["h"]) >= 1500]
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
todo = []
for slug in slugs:
    entry = by_slug[slug]
    if len(manifest.get(slug, [])) >= THIN:
        continue
    c = entry["cluster"]
    near = [p for p in cur if haversine_km((c["lat"], c["lon"]), (p["lat"], p["lon"])) < 60]
    prior = {x["id"] for x in entry["candidates"]}
    extra = [x for x in pick_candidates(near, WAVE2_N) if x["id"] not in prior]
    if extra:
        entry["candidates"].extend(extra)
        todo.append((slug, [x["id"] for x in extra]))
        print(f"{slug}: {len(near)} photos nearby, exporting {len(extra)} more candidates")

for i, (slug, ids) in enumerate(todo):
    outdir = f"{EXPORTS}/{slug}"
    r = subprocess.run(["osascript", f"{BASE}/export_batch.applescript", outdir] + ids, capture_output=True, text=True, timeout=900)
    print(f"[{i+1}/{len(todo)}] {slug}: now {len(os.listdir(outdir))} files ({'ok' if r.returncode == 0 else 'ERR ' + r.stderr[:100]})", flush=True)
    manifest.pop(slug, None)

json.dump(plan, open(f"{BASE}/export_plan.json", "w"))
json.dump(manifest, open(f"{BASE}/photos_manifest.json", "w"))
print("WAVE2_COMPLETE")
