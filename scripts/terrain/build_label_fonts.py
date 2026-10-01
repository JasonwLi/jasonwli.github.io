"""C4: self-hosted label fonts for troika-three-text (WOFF, never WOFF2).

troika parses .woff/.ttf/.otf but throws on WOFF2, and it needs ONE file that covers
every glyph a label uses (otherwise it asks its unicode-font-resolver CDN for a
fallback). So we merge the @fontsource latin + latin-ext subsets of each cut and
subset the result to exactly the characters the globe can show:

  ASCII printable  +  D2 charset.txt (labels.json)  +  every char in travel-data.json
  names  +  their upper-case forms (land labels are set in capitals)

Outputs
  public/fonts/castoro-italic-labels.woff    Castoro 400 italic   (sea / water / place names)
  public/fonts/castoro-titling-labels.woff   Castoro Titling 400   (land names, capitals)
  src/three/labels/fontCoverage.ts           the covered code points + cap-height ratio,
                                             so the client can sanitise text and never
                                             trigger troika's fallback lookup.

U+02BB (modifier letter turned comma, 'Oʻahu') is in neither cut: the client maps it to
U+2018 (FONT_SUBSTITUTES in fontCoverage.ts), and the coverage check applies the same map.

Run:    ~/dev/dw3-lock scripts/terrain/.venv/bin/python scripts/terrain/build_label_fonts.py
Check:  scripts/terrain/.venv/bin/python scripts/terrain/build_label_fonts.py --check
        (rebuilds in memory, asserts 0 missing code points, each file <= 60 KB, and that the
        committed outputs match the inputs' code point set; exit 1 otherwise)
"""
from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

from fontTools import subset
from fontTools.merge import Merger
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
FS = ROOT / "node_modules" / "@fontsource"
SOURCES = {
    "italic": [
        FS / "castoro" / "files" / "castoro-latin-400-italic.woff",
        FS / "castoro" / "files" / "castoro-latin-ext-400-italic.woff",
    ],
    "titling": [
        FS / "castoro-titling" / "files" / "castoro-titling-latin-400-normal.woff",
        FS / "castoro-titling" / "files" / "castoro-titling-latin-ext-400-normal.woff",
    ],
}
OUT = {
    "italic": ROOT / "public" / "fonts" / "castoro-italic-labels.woff",
    "titling": ROOT / "public" / "fonts" / "castoro-titling-labels.woff",
}
COVERAGE_TS = ROOT / "src" / "three" / "labels" / "fontCoverage.ts"
CHARSET_CANDIDATES = [
    ROOT / "scripts" / "data" / "bake" / "physical" / "charset.txt",
    ROOT / "public" / "textures" / "terrain" / "charset.txt",
]
LABELS_CANDIDATES = [
    ROOT / "scripts" / "data" / "bake" / "physical" / "labels.json",
    ROOT / "public" / "textures" / "terrain" / "placeholder" / "labels.json",
]
TRAVEL = ROOT / "public" / "travel-data.json"
MAX_BYTES = 60 * 1024
# characters neither cut has, mapped client-side to a covered look-alike
SUBSTITUTES = {0x02BB: 0x2018, 0x02BC: 0x2019}


def needed_chars() -> set[int]:
    chars = {c for c in range(0x20, 0x7F)}
    found = False
    for p in CHARSET_CANDIDATES:
        if p.exists():
            chars |= {ord(c) for c in p.read_text(encoding="utf-8") if c not in "\r\n"}
            found = True
    # the label texts themselves (charset.txt can lag behind a re-bake)
    for p in LABELS_CANDIDATES:
        if p.exists():
            for lab in json.loads(p.read_text(encoding="utf-8"))["labels"]:
                chars |= {ord(c) for c in lab["t"]}
            found = True
    if not found:
        raise SystemExit("no charset.txt / labels.json found (run D2 bake_labels.py)")
    if TRAVEL.exists():
        for loc in json.loads(TRAVEL.read_text(encoding="utf-8"))["locations"]:
            chars |= {ord(c) for c in loc["name"]}
    # land labels are upper-cased client-side
    chars |= {ord(u) for c in list(chars) for u in chr(c).upper() if len(chr(c).upper()) == 1}
    return {SUBSTITUTES.get(c, c) for c in chars if c >= 0x20}


def load_ttf(path: Path) -> TTFont:
    f = TTFont(path)
    f.flavor = None
    buf = io.BytesIO()
    f.save(buf)
    buf.seek(0)
    return TTFont(buf)


def build(kind: str, chars: set[int]) -> tuple[bytes, TTFont, list[int]]:
    """Merge latin + latin-ext (first wins on overlap), subset, return (woff bytes, font, missing)."""
    tmp = []
    for p in SOURCES[kind]:
        f = load_ttf(p)
        # pre-subset each part to what we need so the merger sees disjoint-ish inputs
        opts = subset.Options()
        opts.layout_features = ["kern", "liga", "calt", "ccmp", "locl", "mark", "mkmk"]
        opts.name_IDs = ["*"]
        opts.notdef_outline = True
        opts.ignore_missing_unicodes = True
        sub = subset.Subsetter(opts)
        sub.populate(unicodes=sorted(chars))
        sub.subset(f)
        b = io.BytesIO()
        f.save(b)
        b.seek(0)
        tmp.append(b)
    if len(tmp) > 1:
        merged = Merger().merge(tmp)
    else:
        merged = TTFont(tmp[0])
    cmap = merged.getBestCmap()
    missing = sorted(c for c in chars if c not in cmap)
    merged.flavor = "woff"
    out = io.BytesIO()
    merged.save(out)
    data = out.getvalue()
    return data, TTFont(io.BytesIO(data)), missing


def coverage_ts(covered: dict[str, list[int]], cap_ratio: float) -> str:
    def js(cps: list[int]) -> str:
        return json.dumps("".join(chr(c) for c in cps), ensure_ascii=True)

    subs = ", ".join(f"[0x{a:04x}, 0x{b:04x}]" for a, b in sorted(SUBSTITUTES.items()))
    return (
        "// GENERATED by scripts/terrain/build_label_fonts.py — do not edit.\n"
        "// Code points covered by the self-hosted label fonts; anything else is substituted\n"
        "// or dropped client-side so troika never asks its unicode-font-resolver CDN.\n"
        f"export const ITALIC_CHARS = {js(covered['italic'])}\n"
        f"export const TITLING_CHARS = {js(covered['titling'])}\n"
        f"export const FONT_SUBSTITUTES: ReadonlyArray<readonly [number, number]> = [{subs}]\n"
        "/** OS/2 sCapHeight / unitsPerEm (both cuts) */\n"
        f"export const CAP_HEIGHT_EM = {cap_ratio}\n"
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="verify only; do not write")
    args = ap.parse_args()

    chars = needed_chars()
    print(f"needed code points: {len(chars)}")
    ok = True
    covered: dict[str, list[int]] = {}
    cap_ratio = 0.0
    for kind in ("italic", "titling"):
        data, font, missing = build(kind, chars)
        cps = sorted(c for c in font.getBestCmap() if c >= 0x20)
        covered[kind] = cps
        cap_ratio = round(font["OS/2"].sCapHeight / font["head"].unitsPerEm, 4)
        size = len(data)
        print(f"{kind:8s} {size / 1024:6.1f} KB  glyphs {len(font.getGlyphOrder())}  "
              f"cmap {len(cps)}  missing {len(missing)}  capH {cap_ratio}")
        if missing:
            ok = False
            print("   MISSING: " + " ".join(f"U+{c:04X}({chr(c)})" for c in missing))
        if size > MAX_BYTES:
            ok = False
            print(f"   TOO BIG: {size} > {MAX_BYTES}")
        if args.check:
            dst = OUT[kind]
            if not dst.exists():
                ok = False
                print(f"   NOT BUILT: {dst.relative_to(ROOT)}")
                continue
            on_disk = TTFont(dst)
            if on_disk.flavor != "woff":
                ok = False
                print(f"   {dst.name}: flavor {on_disk.flavor!r}, expected woff")
            disk_cps = sorted(c for c in on_disk.getBestCmap() if c >= 0x20)
            lost = sorted(set(chars) - set(disk_cps))
            if lost:
                ok = False
                print(f"   {dst.name} lacks: " + " ".join(f"U+{c:04X}" for c in lost))
            if dst.stat().st_size > MAX_BYTES:
                ok = False
                print(f"   {dst.name} on disk is {dst.stat().st_size} B > {MAX_BYTES}")
            print(f"   on disk {dst.stat().st_size / 1024:.1f} KB, cmap {len(disk_cps)}, ok")
        else:
            OUT[kind].parent.mkdir(parents=True, exist_ok=True)
            OUT[kind].write_bytes(data)
    ts = coverage_ts(covered, cap_ratio)
    if args.check:
        if not COVERAGE_TS.exists() or COVERAGE_TS.read_text(encoding="utf-8") != ts:
            ok = False
            print(f"   {COVERAGE_TS.relative_to(ROOT)} is stale (re-run without --check)")
    else:
        COVERAGE_TS.write_text(ts, encoding="utf-8")
        print(f"wrote {OUT['italic'].relative_to(ROOT)}, {OUT['titling'].relative_to(ROOT)}, "
              f"{COVERAGE_TS.relative_to(ROOT)}")
    print("PASS: 0 missing code points, each font <= 60 KB" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
