"""Hand-curated includes: publish specific exported photos for a slug, bypassing
the automated filter (human judgment applied instead)."""
import base64
import io
import json
import os
import sys

import pillow_heif
from PIL import Image, ImageOps

pillow_heif.register_heif_opener()

BASE = os.environ.get("PIPELINE_BASE", os.path.expanduser("~/dev/personal-website/.pipeline"))
OUT = "/Users/jasonli/dev/personal-website/public/photos"
MAX_DIM = 1600

slug = sys.argv[1]
files = sys.argv[2:]

with open(f"{BASE}/export_plan.json") as f:
    plan = json.load(f)
meta_by_stem = {}
for p in plan:
    if p["slug"] == slug:
        for c in p["candidates"]:
            meta_by_stem[os.path.splitext(c["name"])[0].lower()] = c

with open(f"{BASE}/photos_manifest.json") as f:
    manifest = json.load(f)

entries = manifest.get(slug, [])
start = len(entries)
os.makedirs(f"{OUT}/{slug}", exist_ok=True)

# keep chronological order using export metadata
def ts_of(fn):
    stem = os.path.splitext(fn)[0].lower().split(" (")[0]
    return (meta_by_stem.get(stem) or {}).get("ts") or 0

for i, fn in enumerate(sorted(files, key=ts_of)):
    src = f"{BASE}/exports/{slug}/{fn}"
    im = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
    im.thumbnail((MAX_DIM, MAX_DIM), Image.LANCZOS)
    name = f"{start + i + 1}.jpg"
    im.save(f"{OUT}/{slug}/{name}", "JPEG", quality=82, optimize=True, progressive=True)
    tiny = im.copy()
    tiny.thumbnail((28, 28), Image.LANCZOS)
    buf = io.BytesIO()
    tiny.save(buf, "JPEG", quality=45)
    entries.append({
        "file": name,
        "w": im.width,
        "h": im.height,
        "ts": ts_of(fn) or None,
        "blur": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(),
    })
    print(f"included {slug}/{name} ← {fn}")

manifest[slug] = entries[:5]
with open(f"{BASE}/photos_manifest.json", "w") as f:
    json.dump(manifest, f)
print(f"{slug}: {len(manifest[slug])} photos")
