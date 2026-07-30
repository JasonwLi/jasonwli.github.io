"""Generate 800px medium variants (N-m.jpg) beside every published photo —
the gallery panel loads these; the lightbox keeps the 1600px originals."""
import os
import re

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PHOTOS = os.path.join(HERE, "../public/photos")

made = 0
for root, _, files in os.walk(PHOTOS):
    for fn in files:
        if not re.fullmatch(r"\d+\.jpg", fn):
            continue
        src = os.path.join(root, fn)
        dst = os.path.join(root, fn[:-4] + "-m.jpg")
        if os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
            continue
        with Image.open(src) as im:
            im = im.convert("RGB")
            im.thumbnail((800, 800), Image.LANCZOS)
            im.save(dst, "JPEG", quality=80, optimize=True, progressive=True)
        made += 1
print(f"made {made} medium variants")
