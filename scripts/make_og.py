"""Compose og.png (1200x630) deterministically with the site's own fonts."""
import io
import json
import os

from fontTools.ttLib.woff2 import decompress
from PIL import Image, ImageDraw, ImageFont

# night-hero.png: a 1440px-wide screenshot of the hero (globe on the right, text-free there)
BASE = os.environ.get("PIPELINE_BASE", os.path.expanduser("~/dev/personal-website/.pipeline"))
NM = "/Users/jasonli/dev/personal-website/node_modules"
OUT = "/Users/jasonli/dev/personal-website/public/og.png"

def load_woff2(path, size, variations=None):
    buf = io.BytesIO()
    with open(path, "rb") as f:
        decompress(f, buf)
    buf.seek(0)
    font = ImageFont.truetype(buf, size)
    if variations:
        font.set_variation_by_axes(variations)
    return font

bricolage = f"{NM}/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2"
garamond = f"{NM}/@fontsource/eb-garamond/files/eb-garamond-latin-400-italic.woff2"
mono = f"{NM}/@fontsource/fragment-mono/files/fragment-mono-latin-400-normal.woff2"

name_f = load_woff2(bricolage, 96, [780])
sub_f = load_woff2(bricolage, 30, [420])
map_f = load_woff2(garamond, 30)
mono_f = load_woff2(mono, 17)

# stats from live data
d = json.load(open("/Users/jasonli/dev/personal-website/public/travel-data.json"))
places = len(d["locations"])
countries = len({l["cc"] for l in d["locations"]})

img = Image.new("RGB", (1200, 630), (16, 20, 31))

# globe from an existing clean render (right side of the hero screenshot, text-free)
src = Image.open(f"{BASE}/night-hero.png").convert("RGB")
crop = src.crop((760, 60, 1440, 740))  # globe region only
crop = crop.resize((640, 640), Image.LANCZOS)
img.paste(crop, (620, -5))

draw = ImageDraw.Draw(img)
ink = (240, 238, 230)
muted = (168, 176, 191)
brass = (217, 189, 133)

x = 70
draw.text((x, 175), "Jason Li", font=name_f, fill=ink)
draw.text((x, 305), "Software engineer — payments, FX", font=sub_f, fill=ink)
draw.text((x, 345), "& stablecoin infrastructure.", font=sub_f, fill=ink)
draw.text((x, 420), f"{places} places under a different sky", font=map_f, fill=brass)
draw.text((x, 470), f"{countries} countries · engineer, traveler", font=mono_f, fill=muted)

img.save(OUT, "PNG", optimize=True)
print(f"og.png written: {places} places, {countries} countries")
