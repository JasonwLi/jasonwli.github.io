"""Reject photos with people (Vision faces + humans + 'people' label), score scenery,
keep top 5 per location, resize to web (EXIF-stripped), emit photos manifest."""
import base64
import io
import json
import os
import sys

import Quartz  # noqa: F401  (loads CoreGraphics for Vision)
import Vision
from Foundation import NSURL
import pillow_heif
from PIL import Image, ImageOps

pillow_heif.register_heif_opener()

BASE = "/private/tmp/claude-501/-Users-jasonli-dev/609d9fd3-c32a-476f-9147-b3fa5a85aced/scratchpad"
EXPORTS = f"{BASE}/exports"
OUT = "/Users/jasonli/dev/personal-website/public/photos"
KEEP = 5
MAX_DIM = 1600

SCENERY = {
    "outdoor", "sky", "mountain", "water", "sea", "beach", "landscape", "cliff",
    "desert", "canyon", "valley", "river", "lake", "waterfall", "forest", "tree",
    "snow", "sunset", "sunrise", "cloud", "island", "coast", "structure",
    "building", "monument", "temple", "castle", "ruins", "bridge", "cityscape",
    "skyline", "street", "sand", "rock", "night_sky", "aurora", "horizon",
}
PENALTY = {
    "food", "drink", "dish", "meal", "document", "text", "menu", "receipt",
    "screenshot", "indoor", "room", "furniture", "animal", "pet", "cat", "dog",
    "vehicle", "car", "bus", "truck", "road", "parking_lot", "airplane",
}
VEHICLE = {"vehicle", "car", "bus", "truck", "motorcycle", "automobile", "land_vehicle", "van", "taxi"}

with open(f"{BASE}/export_plan.json") as f:
    plan = json.load(f)

meta_by_stem = {}
for p in plan:
    for c in p["candidates"]:
        stem = os.path.splitext(c["name"])[0].lower()
        meta_by_stem.setdefault(p["slug"], {})[stem] = c


_yolo = None


def yolo_people(path):
    """Person boxes [(cx, cy, w, h)] normalized, top-left origin, plus total area."""
    global _yolo
    if _yolo is None:
        from ultralytics import YOLO
        _yolo = YOLO("yolov8n.pt")
    res = _yolo.predict(path, imgsz=1280, conf=0.2, classes=[0], verbose=False)
    boxes = []
    total = 0.0
    for r in res:
        if r.boxes is None or len(r.boxes) == 0:
            continue
        for cx, cy, w, h in ((float(b[0]), float(b[1]), float(b[2]), float(b[3])) for b in r.boxes.xywhn):
            boxes.append((cx, cy, w, h))
            total += w * h
    return boxes, total


_TMP_CROP = "/tmp/face_crop_check.jpg"


def frontal_in_crop(path, box):
    """Small distant faces evade full-frame detection: crop the head region of a
    person box, upscale it, and re-run face detection on the crop."""
    cx, cy, w, h = box
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        W, H = im.size
        x0 = int(max(0, (cx - w * 0.8) * W))
        x1 = int(min(W, (cx + w * 0.8) * W))
        y0 = int(max(0, (cy - h * 0.62) * H))
        y1 = int(min(H, (cy - h * 0.05) * H))
        if x1 - x0 < 8 or y1 - y0 < 8:
            return False
        crop = im.crop((x0, y0, x1, y1))
        scale = max(1, 560 // max(crop.width, crop.height))
        if scale > 1:
            crop = crop.resize((crop.width * scale, crop.height * scale), Image.LANCZOS)
        crop.save(_TMP_CROP, "JPEG", quality=92)
    handler = Vision.VNImageRequestHandler.alloc().initWithURL_options_(
        NSURL.fileURLWithPath_(_TMP_CROP), {}
    )
    face = Vision.VNDetectFaceRectanglesRequest.alloc().init()
    ok, _ = handler.performRequests_error_([face], None)
    return bool(ok and (face.results() or []))


def people_verdict(path, person_boxes, faces):
    """True → reject. Frontal-facing people who are the subject are out;
    back-turned figures pass unless they dominate the frame."""
    for cx, cy, w, h in person_boxes:
        prominent = h >= 0.45 or w * h >= 0.08 or (h >= 0.22 and 0.28 <= cx <= 0.72)
        if not prominent:
            if h >= 0.6 or w * h >= 0.25:
                return True
            continue
        frontal = any(
            abs(fx - cx) <= w / 2 and abs(fy - cy) <= h / 2 for fx, fy, fh in faces
        ) or frontal_in_crop(path, (cx, cy, w, h))
        if frontal:
            return True
        if h >= 0.6 or w * h >= 0.25:  # towering even with their back turned
            return True
    return False


def too_blurry(path):
    """Laplacian-variance sharpness check on a downscaled grayscale copy."""
    import cv2
    import numpy as np
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert("L")
        im.thumbnail((512, 512))
        arr = np.asarray(im)
    return cv2.Laplacian(arr, cv2.CV_64F).var() < 25


def analyze(path):
    url = NSURL.fileURLWithPath_(path)
    handler = Vision.VNImageRequestHandler.alloc().initWithURL_options_(url, {})
    face = Vision.VNDetectFaceRectanglesRequest.alloc().init()
    classify = Vision.VNClassifyImageRequest.alloc().init()
    requests = [face, classify]
    aesthetics = None
    if hasattr(Vision, "VNCalculateImageAestheticsScoresRequest"):
        aesthetics = Vision.VNCalculateImageAestheticsScoresRequest.alloc().init()
        requests.append(aesthetics)
    ok, err = handler.performRequests_error_(requests, None)
    if not ok:
        return None
    # faces as (cx, cy, h) in top-left-origin normalized coords
    faces = []
    for o in face.results() or []:
        bb = o.boundingBox()
        faces.append((
            float(bb.origin.x + bb.size.width / 2),
            float(1.0 - (bb.origin.y + bb.size.height / 2)),
            float(bb.size.height),
        ))
    labels = {}
    for obs in classify.results() or []:
        if obs.confidence() >= 0.15:
            labels[str(obs.identifier()).lower()] = float(obs.confidence())
    aesthetic = 0.0
    utility = False
    if aesthetics is not None:
        res = aesthetics.results() or []
        if res:
            aesthetic = float(res[0].overallScore())
            utility = bool(res[0].isUtility())
    return faces, labels, aesthetic, utility


def score(labels):
    s = sum(v for k, v in labels.items() if k in SCENERY)
    s -= 1.5 * sum(v for k, v in labels.items() if k in PENALTY)
    return s


manifest = {}
if os.path.exists(f"{BASE}/photos_manifest.json"):
    with open(f"{BASE}/photos_manifest.json") as f:
        manifest = json.load(f)
    print(f"resuming: {len(manifest)} slugs already done")

# the most recently modified export dir may still be mid-write; skip unless export finished
skip_newest = "--partial" in sys.argv
newest = None
if skip_newest:
    dirs = [(os.path.getmtime(f"{EXPORTS}/{d}"), d) for d in os.listdir(EXPORTS)]
    newest = max(dirs)[1] if dirs else None
    print(f"partial run, skipping in-progress dir: {newest}")

rejected = kept = 0
for p in plan:
    slug = p["slug"]
    d = f"{EXPORTS}/{slug}"
    if not os.path.isdir(d):
        continue
    if slug in manifest or slug == newest:
        continue
    if not os.listdir(d):
        continue  # nothing exported (yet); leave unprocessed
    survivors = []
    for fn in sorted(os.listdir(d)):
        ext = os.path.splitext(fn)[1].lower()
        if ext not in (".heic", ".jpg", ".jpeg", ".png", ".tif", ".tiff"):
            continue
        path = f"{d}/{fn}"
        res = analyze(path)
        if res is None:
            continue
        faces, labels, aesthetic, utility = res
        # close frontal portrait or posed group of frontal faces → photo OF someone
        if any(fh >= 0.07 for _, _, fh in faces) or sum(1 for _, _, fh in faces if fh >= 0.04) >= 2:
            rejected += 1
            continue
        # frontal-facing subjects reject; back-turned figures pass unless dominant
        try:
            person_boxes, total_area = yolo_people(path)
        except Exception as e:
            print(f"  yolo fail {path}: {e}", file=sys.stderr)
            rejected += 1  # fail closed: no verdict, no publish
            continue
        if people_verdict(path, person_boxes, faces) or total_area >= 0.2:
            rejected += 1
            continue
        try:
            if too_blurry(path):
                continue
        except Exception:
            pass
        # not-scenery: food plates, documents, screenshots, vehicle close-ups
        food = max((v for k, v in labels.items() if k in ("food", "dish", "meal", "dessert", "drink", "snack")), default=0.0)
        flat = max((v for k, v in labels.items() if k in ("document", "screenshot", "text", "receipt", "menu")), default=0.0)
        veh = max((v for k, v in labels.items() if k in VEHICLE), default=0.0)
        scen = score(labels)
        if (food >= 0.5 or flat >= 0.5) and scen < 1.0:
            continue
        if veh >= 0.45 and scen < 1.5:
            continue
        if scen < 0.5:  # not recognizably scenery at all
            continue
        if utility and scen < 2.0:  # Apple's own "utility shot" verdict
            continue
        stem = os.path.splitext(fn)[0].lower()
        # strip Photos' " (1)" suffix when matching back to metadata
        base_stem = stem.split(" (")[0]
        meta = meta_by_stem.get(slug, {}).get(stem) or meta_by_stem.get(slug, {}).get(base_stem) or {}
        survivors.append({
            "path": path,
            # aesthetics-led ranking: Apple score dominates, scenery and favorites
            # nudge, people coverage penalizes
            "score": aesthetic * 4.0 + score(labels) * 0.5 + (2.0 if meta.get("fav") else 0.0) - 4.0 * total_area,
            "ts": meta.get("ts"),
        })
    if not survivors:
        continue
    # spread final picks across time
    survivors.sort(key=lambda s: s["ts"] or 0)
    picks = []
    if len(survivors) <= KEEP:
        picks = survivors
    else:
        per = len(survivors) / KEEP
        for b in range(KEEP):
            chunk = survivors[int(b * per):int((b + 1) * per)]
            if chunk:
                picks.append(max(chunk, key=lambda s: s["score"]))
    os.makedirs(f"{OUT}/{slug}", exist_ok=True)
    entries = []
    for i, s in enumerate(picks):
        try:
            im = Image.open(s["path"])
            im = ImageOps.exif_transpose(im)
            im = im.convert("RGB")
            im.thumbnail((MAX_DIM, MAX_DIM), Image.LANCZOS)
            out_name = f"{i+1}.jpg"
            im.save(f"{OUT}/{slug}/{out_name}", "JPEG", quality=82, optimize=True, progressive=True)
            med = im.copy()
            med.thumbnail((800, 800), Image.LANCZOS)
            med.save(f"{OUT}/{slug}/{i+1}-m.jpg", "JPEG", quality=80, optimize=True, progressive=True)
            tiny = im.copy()
            tiny.thumbnail((28, 28), Image.LANCZOS)
            buf = io.BytesIO()
            tiny.save(buf, "JPEG", quality=45)
            entries.append({
                "file": out_name,
                "w": im.width,
                "h": im.height,
                "ts": s["ts"],
                "blur": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(),
            })
            kept += 1
        except Exception as e:
            print(f"  resize fail {s['path']}: {e}", file=sys.stderr)
    manifest[slug] = entries  # empty list marks "processed, nothing usable"
    print(f"{slug}: {len(entries)} kept ({len(survivors)} survived filter)", flush=True)

with open(f"{BASE}/photos_manifest.json", "w") as f:
    json.dump(manifest, f)
print(f"\nTOTAL kept={kept} rejected_people={rejected} locations={len(manifest)}")
print("FILTER_COMPLETE")
