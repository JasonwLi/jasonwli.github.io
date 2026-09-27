"""Drop published photos whose Vision scenery score is below the floor."""
import json
import os

import Vision
from Foundation import NSURL

BASE = os.environ.get("PIPELINE_BASE", os.path.expanduser("~/dev/personal-website/.pipeline"))
PHOTOS = "/Users/jasonli/dev/personal-website/public/photos"
CURATED = {"daly-city-us"}

SCENERY = {
    "outdoor", "sky", "mountain", "water", "sea", "beach", "landscape", "cliff",
    "desert", "canyon", "valley", "river", "lake", "waterfall", "forest", "tree",
    "snow", "sunset", "sunrise", "cloud", "island", "coast", "structure",
    "building", "monument", "temple", "castle", "ruins", "bridge", "cityscape",
    "skyline", "sand", "rock", "night_sky", "aurora", "horizon",
}

def scen_of(path):
    handler = Vision.VNImageRequestHandler.alloc().initWithURL_options_(NSURL.fileURLWithPath_(path), {})
    req = Vision.VNClassifyImageRequest.alloc().init()
    ok, _ = handler.performRequests_error_([req], None)
    if not ok:
        return 99.0  # unknown: keep
    labels = {str(o.identifier()).lower(): float(o.confidence()) for o in req.results() or [] if o.confidence() >= 0.15}
    return sum(v for k, v in labels.items() if k in SCENERY)

with open(f"{BASE}/photos_manifest.json") as f:
    manifest = json.load(f)

dropped = 0
for slug, entries in manifest.items():
    if slug in CURATED:
        continue
    keep = []
    for e in entries:
        p = f"{PHOTOS}/{slug}/{e['file']}"
        if not os.path.exists(p):
            continue
        s = scen_of(p)
        if s < 0.5:
            print(f"DROP {slug}/{e['file']} scen={s:.2f}", flush=True)
            os.remove(p)
            dropped += 1
        else:
            keep.append(e)
    manifest[slug] = keep

for slug, entries in manifest.items():
    for i, e in enumerate(entries):
        old = f"{PHOTOS}/{slug}/{e['file']}"
        new_name = f"{i+1}.jpg"
        if e["file"] != new_name and os.path.exists(old):
            os.rename(old, f"{PHOTOS}/{slug}/{new_name}")
            e["file"] = new_name

with open(f"{BASE}/photos_manifest.json", "w") as f:
    json.dump(manifest, f)
print(f"dropped {dropped}")
