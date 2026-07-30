"""Rasterize world-atlas geography into an RGB mask PNG: R = land fill,
G = internal country borders, drawn at 2x and downscaled for antialiasing."""
import json
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 4096, 2048
SS = 2  # supersample

with open(os.path.join(HERE, "land-polys.json")) as f:
    polys = json.load(f)
with open(os.path.join(HERE, "border-polys.json")) as f:
    borders = json.load(f)


def unwrap(coords):
    """Make longitudes continuous across the antimeridian (no ±360 jumps) so
    shapes like Fiji and Chukotka don't rasterize as lines across the map."""
    out = []
    prev = None
    shift = 0.0
    for lon, lat in coords:
        if prev is not None:
            if lon - prev > 180:
                shift -= 360
            elif lon - prev < -180:
                shift += 360
        prev = lon
        out.append((lon + shift, lat))
    return out


def to_px(lon, lat, dx=0.0):
    return ((lon + 180 + dx) / 360 * W * SS, (90 - lat) / 180 * H * SS)


land = Image.new("L", (W * SS, H * SS), 0)
draw = ImageDraw.Draw(land)
for rings in polys:
    ext = unwrap(rings[0])
    holes = [unwrap(h) for h in rings[1:]]
    # pole-enclosing rings (Antarctica) span ~360° of longitude; close the fill
    # down over the pole so the interior rasterizes correctly
    lons = [lon for lon, _ in ext]
    if max(lons) - min(lons) > 350:
        south = min(lat for _, lat in ext) < 0
        cap = -90.0 if south else 90.0
        ext = ext + [(max(lons), cap), (min(lons), cap)]
    # draw at all three wrap positions; PIL clips whatever falls outside
    for dx in (-360.0, 0.0, 360.0):
        draw.polygon([to_px(lon, lat, dx) for lon, lat in ext], fill=255)
        for hole in holes:
            draw.polygon([to_px(lon, lat, dx) for lon, lat in hole], fill=0)
land = land.resize((W, H), Image.LANCZOS)

bord = Image.new("L", (W * SS, H * SS), 0)
draw = ImageDraw.Draw(bord)
for line in borders:
    pts = unwrap(line)
    if len(pts) < 2:
        continue
    for dx in (-360.0, 0.0, 360.0):
        draw.line([to_px(lon, lat, dx) for lon, lat in pts], fill=255, width=3)
bord = bord.resize((W, H), Image.LANCZOS)

img = Image.merge("RGB", (land, bord, Image.new("L", (W, H), 0)))
out = os.path.join(HERE, "../public/textures/land_mask_4096.png")
img.save(out, "PNG", optimize=True)
print(f"wrote {out} ({os.path.getsize(out)//1024} KB)")
