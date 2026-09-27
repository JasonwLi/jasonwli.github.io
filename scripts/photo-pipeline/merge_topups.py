"""Fold `<slug>--topup` filter results into their base slug: move files, renumber,
cap at 5 (existing photos first, then the new ones chronologically)."""
import json
import os
import shutil

BASE = os.environ.get("PIPELINE_BASE", os.path.expanduser("~/dev/personal-website/.pipeline"))
OUT = "/Users/jasonli/dev/personal-website/public/photos"
KEEP = 5

plan = json.load(open(f"{BASE}/export_plan.json"))
manifest = json.load(open(f"{BASE}/photos_manifest.json"))

for entry in [p for p in plan if p["slug"].endswith("--topup")]:
    tslug = entry["slug"]
    base = tslug[: -len("--topup")]
    new = manifest.pop(tslug, [])
    have = manifest.get(base, [])
    room = max(0, KEEP - len(have))
    take = sorted(new, key=lambda e: e["ts"] or 0)[:room]
    os.makedirs(f"{OUT}/{base}", exist_ok=True)
    for i, e in enumerate(take):
        n = len(have) + i + 1
        for suffix in ("", "-m"):
            src = f"{OUT}/{tslug}/{e['file'].replace('.jpg', suffix + '.jpg')}"
            if os.path.exists(src):
                shutil.move(src, f"{OUT}/{base}/{n}{suffix}.jpg")
        have.append({k: v for k, v in e.items() if k != "_dir"} | {"file": f"{n}.jpg"})
    manifest[base] = have
    shutil.rmtree(f"{OUT}/{tslug}", ignore_errors=True)
    print(f"{base}: +{len(take)} (now {len(have)}); {len(new) - len(take)} surplus discarded")

plan = [p for p in plan if not p["slug"].endswith("--topup")]
json.dump(plan, open(f"{BASE}/export_plan.json", "w"))
json.dump(manifest, open(f"{BASE}/photos_manifest.json", "w"))
print("MERGE_COMPLETE")
