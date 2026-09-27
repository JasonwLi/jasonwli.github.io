"""Select up to N candidates per cluster and export them from Photos via AppleScript."""
import json
import os
import re
import subprocess
import sys
import unicodedata

BASE = os.environ.get("PIPELINE_BASE", os.path.expanduser("~/dev/personal-website/.pipeline"))
EXPORT_DIR = f"{BASE}/exports"
CANDIDATES_PER_CLUSTER = 12

with open(f"{BASE}/clusters.json") as f:
    clusters = json.load(f)

def slugify(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")

def pick_candidates(photos, n):
    """Spread across time, prefer favorites and higher resolution."""
    photos = [p for p in photos if p["w"] and p["h"] and max(p["w"], p["h"]) >= 1500]
    if not photos:
        return []
    photos.sort(key=lambda p: p["ts"] or 0)
    if len(photos) <= n:
        return photos
    picked = []
    buckets = n
    per = len(photos) / buckets
    for b in range(buckets):
        chunk = photos[int(b * per):int((b + 1) * per)]
        if not chunk:
            continue
        chunk.sort(key=lambda p: (not p["fav"], -(p["w"] * p["h"])))
        picked.append(chunk[0])
    return picked

plan = []
for c in clusters:
    slug = slugify(f"{c['city']}-{c['cc']}")
    cands = pick_candidates(c["photos"], CANDIDATES_PER_CLUSTER)
    if cands:
        plan.append({"slug": slug, "cluster": {k: c[k] for k in ("city", "admin", "cc", "lat", "lon", "count", "first", "last")}, "candidates": cands})

# dedupe slugs
seen = {}
for p in plan:
    if p["slug"] in seen:
        seen[p["slug"]] += 1
        p["slug"] = f"{p['slug']}-{seen[p['slug']]}"
    else:
        seen[p["slug"]] = 1

with open(f"{BASE}/export_plan.json", "w") as f:
    json.dump(plan, f)

total = sum(len(p["candidates"]) for p in plan)
print(f"{len(plan)} clusters, {total} photos to export")

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

for i, p in enumerate(plan):
    outdir = f"{EXPORT_DIR}/{p['slug']}"
    os.makedirs(outdir, exist_ok=True)
    existing = len(os.listdir(outdir))
    if existing >= len(p["candidates"]):
        print(f"[{i+1}/{len(plan)}] {p['slug']}: already exported ({existing})", flush=True)
        continue
    ids = [c["id"] for c in p["candidates"]]
    r = subprocess.run(
        ["osascript", EXPORT_SCRIPT, outdir] + ids,
        capture_output=True, text=True, timeout=900,
    )
    got = len(os.listdir(outdir))
    status = "ok" if r.returncode == 0 else f"ERR {r.stderr.strip()[:120]}"
    print(f"[{i+1}/{len(plan)}] {p['slug']}: {got}/{len(ids)} files ({status})", flush=True)

print("EXPORT_COMPLETE")
