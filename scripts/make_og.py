#!/usr/bin/env python3
"""Regenerate public/og.png (1200x630), the link preview card, from the live site.

    ~/dev/dw3-lock scripts/terrain/.venv/bin/python scripts/make_og.py [--port 5321]

Heavy (dev server + headless WebGL): always run it through the machine lock.
Steps:
  1. scripts/serve.sh start PORT (a Vite dev server of this checkout)
  2. node scripts/make-og.mjs: captures the hero's painted globe in its gilt degree limb
     (pins and overlay included) at 2x, and lays the card over the live page so the
     site's own tokens, art strokes and self-hosted Castoro faces render the throne
     (crest, "JASON LI", double rule, silver tagline) and the live counts line
     (places / countries / photographs / years, read from the travel column)
  3. scripts/serve.sh stop PORT
  4. writes public/og.png under BUDGET: lossless when it fits, else every channel rounded
     to a step of 2 or 3 (max error 1 level, invisible; the painted relief compresses
     ~20% better), never palette quantization (it flattens the relief)
  5. stamps provenance (impeccable embed-prompt.mjs) when that script is installed
Only PIL is needed (scripts/terrain/.venv has it).
"""
import argparse
import io
import os
import subprocess
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "og.png")
RAW = os.path.join(ROOT, "scripts", ".cache", "og", "og-raw.png")
GLOBE = os.path.join(ROOT, "scripts", ".cache", "og", "globe@2x.png")
BUDGET = 400 * 1024
EMBED = [
    p
    for p in (
        os.environ.get("EMBED_PROMPT_MJS", ""),
        os.path.expanduser("~/.claude/skills/impeccable/scripts/embed-prompt.mjs"),
    )
    if p
]
PROMPT = (
    "Link preview card for jasonli.world in the Astrolabe design system: heat-blued steel "
    "ground #011844; the gilt astrolabe-throne crest, 'JASON LI' in Castoro Titling gilt on its "
    "engraved double rule and the silver hero tagline at left, with the live counts line in "
    "silver-2; at right a real 2x render of the site's painted terrain globe inside its engraved "
    "gilt degree limb, pins and monuments included. Composited by scripts/make-og.mjs from the "
    "live page (no redraw)."
)


def encode(im: Image.Image) -> bytes:
    for step in (1, 2, 3):
        q = im if step == 1 else im.point([min(255, round(v / step) * step) for v in range(256)] * 3)
        buf = io.BytesIO()
        q.save(buf, "PNG", optimize=True)
        if len(buf.getvalue()) <= BUDGET or step == 3:
            print(f"make_og: channel step {step}: {len(buf.getvalue()) / 1024:.0f} KB")
            return buf.getvalue()
    raise AssertionError("unreachable")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default="5321")
    a = ap.parse_args()
    url = f"http://localhost:{a.port}"
    serve = os.path.join(ROOT, "scripts", "serve.sh")
    if subprocess.run([serve, "start", a.port], cwd=ROOT).returncode != 0:
        return 1
    try:
        r = subprocess.run(
            ["node", os.path.join(ROOT, "scripts", "make-og.mjs"), "--url", url, "--out", RAW, "--globe-out", GLOBE],
            cwd=ROOT,
        )
    finally:
        subprocess.run([serve, "stop", a.port], cwd=ROOT)
    if r.returncode != 0:
        return r.returncode

    im = Image.open(RAW).convert("RGB")
    if im.size != (1200, 630):
        print(f"make_og: unexpected size {im.size}", file=sys.stderr)
        return 1
    data = encode(im)
    with open(OUT, "wb") as f:
        f.write(data)
    print(f"make_og: wrote {OUT} ({len(data) / 1024:.0f} KB)")

    for script in EMBED:
        if os.path.exists(script):
            subprocess.run(["node", script, OUT, "--prompt", PROMPT], cwd=ROOT, check=False)
            break
    else:
        print("make_og: embed-prompt.mjs not installed; provenance not stamped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
