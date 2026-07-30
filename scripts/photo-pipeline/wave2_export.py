"""Second wave: for locations with <3 usable photos, export up to 18 more candidates."""
import json
import os
import subprocess

BASE = "/private/tmp/claude-501/-Users-jasonli-dev/609d9fd3-c32a-476f-9147-b3fa5a85aced/scratchpad"
EXPORTS = f"{BASE}/exports"
THIN = 3
WAVE2_N = 30  # total candidates incl. wave 1's 12

def pick_candidates(photos, n):
    """Spread across time, prefer favorites and higher resolution (same as wave 1)."""
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

with open(f"{BASE}/photos_manifest.json") as f:
    manifest = json.load(f)
with open(f"{BASE}/export_plan.json") as f:
    plan = json.load(f)
with open(f"{BASE}/clusters.json") as f:
    clusters = json.load(f)

# map plan slug -> its cluster's photos (match on center coords)
cl_by_key = {(c["lat"], c["lon"]): c for c in clusters}

thin = [p for p in plan if len(manifest.get(p["slug"], [])) < THIN]
print(f"{len(thin)} thin locations")

EXPORT_SCRIPT = f"{BASE}/export_batch.applescript"
todo = []
for p in thin:
    c = cl_by_key.get((p["cluster"]["lat"], p["cluster"]["lon"]))
    if not c:
        continue
    prior = {cand["id"] for cand in p["candidates"]}
    extra = [x for x in pick_candidates(c["photos"], WAVE2_N) if x["id"] not in prior]
    if extra:
        todo.append((p["slug"], [x["id"] for x in extra]))

total = sum(len(ids) for _, ids in todo)
print(f"exporting {total} extra photos across {len(todo)} locations")

for i, (slug, ids) in enumerate(todo):
    outdir = f"{EXPORTS}/{slug}"
    os.makedirs(outdir, exist_ok=True)
    r = subprocess.run(["osascript", EXPORT_SCRIPT, outdir] + ids, capture_output=True, text=True, timeout=900)
    status = "ok" if r.returncode == 0 else f"ERR {r.stderr.strip()[:100]}"
    print(f"[{i+1}/{len(todo)}] {slug}: +{len(ids)} ({status})", flush=True)
    # force the filter to reprocess this slug from scratch
    manifest.pop(slug, None)

with open(f"{BASE}/photos_manifest.json", "w") as f:
    json.dump(manifest, f)
print("WAVE2_EXPORT_COMPLETE")
