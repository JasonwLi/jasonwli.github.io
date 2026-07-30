"""Sweep published photos with the crop-based frontal-face check; drop violators."""
import json
import os
import sys

sys.path.insert(0, "/private/tmp/claude-501/-Users-jasonli-dev/609d9fd3-c32a-476f-9147-b3fa5a85aced/scratchpad")
os.environ.setdefault("NO_MAIN", "1")

import Vision  # noqa: E402
from Foundation import NSURL  # noqa: E402
from PIL import Image, ImageOps  # noqa: E402
from ultralytics import YOLO  # noqa: E402

BASE = "/private/tmp/claude-501/-Users-jasonli-dev/609d9fd3-c32a-476f-9147-b3fa5a85aced/scratchpad"
PHOTOS = "/Users/jasonli/dev/personal-website/public/photos"
_TMP = "/tmp/face_crop_check2.jpg"

yolo = YOLO("yolov8n.pt")


def faces_full(path):
    handler = Vision.VNImageRequestHandler.alloc().initWithURL_options_(NSURL.fileURLWithPath_(path), {})
    face = Vision.VNDetectFaceRectanglesRequest.alloc().init()
    ok, _ = handler.performRequests_error_([face], None)
    out = []
    for o in (face.results() or []) if ok else []:
        bb = o.boundingBox()
        out.append((float(bb.origin.x + bb.size.width / 2), float(1.0 - (bb.origin.y + bb.size.height / 2))))
    return out


def frontal_in_crop(path, box):
    cx, cy, w, h = box
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        W, H = im.size
        x0 = int(max(0, (cx - w * 0.8) * W)); x1 = int(min(W, (cx + w * 0.8) * W))
        y0 = int(max(0, (cy - h * 0.62) * H)); y1 = int(min(H, (cy - h * 0.05) * H))
        if x1 - x0 < 8 or y1 - y0 < 8:
            return False
        crop = im.crop((x0, y0, x1, y1))
        scale = max(1, 560 // max(crop.width, crop.height))
        if scale > 1:
            crop = crop.resize((crop.width * scale, crop.height * scale), Image.LANCZOS)
        crop.save(_TMP, "JPEG", quality=92)
    handler = Vision.VNImageRequestHandler.alloc().initWithURL_options_(NSURL.fileURLWithPath_(_TMP), {})
    face = Vision.VNDetectFaceRectanglesRequest.alloc().init()
    ok, _ = handler.performRequests_error_([face], None)
    return bool(ok and (face.results() or []))


def violates(path):
    res = yolo.predict(path, imgsz=1280, conf=0.2, classes=[0], verbose=False)
    boxes = [
        (float(b[0]), float(b[1]), float(b[2]), float(b[3]))
        for r in res if r.boxes is not None for b in r.boxes.xywhn
    ]
    if not boxes:
        return False
    faces = faces_full(path)
    for cx, cy, w, h in boxes:
        prominent = h >= 0.45 or w * h >= 0.08 or (h >= 0.22 and 0.28 <= cx <= 0.72)
        if prominent:
            frontal = any(abs(fx - cx) <= w / 2 and abs(fy - cy) <= h / 2 for fx, fy in faces) or \
                frontal_in_crop(path, (cx, cy, w, h))
            if frontal:
                return True
        if h >= 0.6 or w * h >= 0.25:
            return True
    return False


with open(f"{BASE}/photos_manifest.json") as f:
    manifest = json.load(f)

dropped = 0
for slug, entries in manifest.items():
    keep = []
    for e in entries:
        p = f"{PHOTOS}/{slug}/{e['file']}"
        if not os.path.exists(p):
            continue
        if violates(p):
            print(f"DROP {slug}/{e['file']}", flush=True)
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
