"""D5: validate public/textures/terrain/ against the frozen manifest schema and the data rules.

Checks
  1. schema: a structural checker mirroring src/three/terrain/manifest.ts (TerrainManifest)
  2. every url resolves under public/textures/terrain, ?v = sha256[:8] of the file, bytes match
  3. KTX2: `basisu -info` type / layer count / levels; `basisu -unpack` round trip: every mip-0
     face/layer vs its source PNG (PSNR >= 31.5 dB ETC1S [codec ceiling, see thr], >= 36 dB UASTC), and face order (each
     unpacked face best-matches its own source; face 2 = +Y = the north-polar face)
  4. lossless WebP/PNG: decode bit-exact vs the intermediate (encode.data_sources), mode RGB,
     no icc_profile / exif / xmp / gamma / transparency
  5. budgets: download per tier (A+B+C+onDemand, unique files) LOW <= 4 MB, MID <= 12 MB,
     HIGH <= 30 MB; stage A <= 450 KB; total bytes under public/textures/terrain (excl. placeholder/)
     <= 80 MB; VRAM by src/three/terrain/stages.ts estimateTierVram (run in node) low <= 48,
     mid <= 70, high <= 160 MB (1 MB = 1e6 B)
  6. prints a per-file byte table

Run: ~/dev/dw3-lock scripts/terrain/.venv/bin/python scripts/terrain/validate.py [--no-ktx]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import encode  # noqa: E402
from lib.cube import FACES  # noqa: E402
from lib.io import load_rgb  # noqa: E402

ROOT = encode.ROOT
PUB = encode.PUB
FAILS: list[str] = []


def report(name: str, ok: bool, detail: str = ""):
    if not ok:
        FAILS.append(name)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{': ' + detail if detail else ''}", flush=True)


# ---------------------------------------------------------------------------- 1. schema


class S:
    """Tiny structural schema: S.obj({...}), S.lit(v), S.one(*vals), S.num, S.str, S.bool, S.arr(x, n)."""

    def __init__(self, fn, desc):
        self.fn, self.desc = fn, desc

    def check(self, v, path, errs):
        self.fn(v, path, errs)


def _t(pred, desc):
    return S(lambda v, p, e: None if pred(v) else e.append(f"{p}: expected {desc}, got {json.dumps(v)[:60]}"), desc)


NUM = _t(lambda v: isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v), "number")
POS = _t(lambda v: isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0, "positive number")
STR = _t(lambda v: isinstance(v, str), "string")
BOOL = _t(lambda v: isinstance(v, bool), "boolean")


def lit(*vals):
    return _t(lambda v: v in vals and type(v) in {type(x) for x in vals}, "one of " + "|".join(map(str, vals)))


def arr(item, n=None):
    def fn(v, p, e):
        if not isinstance(v, list) or (n is not None and len(v) != n):
            e.append(f"{p}: expected array{'' if n is None else f'[{n}]'}")
            return
        for i, x in enumerate(v):
            item.check(x, f"{p}[{i}]", e)
    return S(fn, "array")


def tup(*items):
    def fn(v, p, e):
        if not isinstance(v, list) or len(v) != len(items):
            e.append(f"{p}: expected tuple of {len(items)}")
            return
        for i, (x, it) in enumerate(zip(v, items)):
            it.check(x, f"{p}[{i}]", e)
    return S(fn, "tuple")


def obj(req: dict, opt: dict | None = None, exact: bool = True):
    opt = opt or {}

    def fn(v, p, e):
        if not isinstance(v, dict):
            e.append(f"{p}: expected object")
            return
        for k, sch in req.items():
            if k not in v:
                e.append(f"{p}.{k}: missing")
            else:
                sch.check(v[k], f"{p}.{k}", e)
        for k, sch in opt.items():
            if k in v:
                sch.check(v[k], f"{p}.{k}", e)
        if exact:
            for k in v:
                if k not in req and k not in opt:
                    e.append(f"{p}.{k}: not in the schema")
    return S(fn, "object")


def rec(item):
    def fn(v, p, e):
        if not isinstance(v, dict):
            e.append(f"{p}: expected record")
            return
        for k, x in v.items():
            item.check(x, f"{p}.{k}", e)
    return S(fn, "record")


CS = lit("srgb", "none")
FACE_ORDER = tup(*[lit(f) for f in FACES])
SQRT = obj({"in": STR, "curve": lit("sqrt"), "maxM": NUM})
SDF = obj({"in": STR, "zero": NUM, "halfRangeKm": NUM, "positive": lit("land", "water")})
EQ = obj({"url": STR, "w": POS, "h": POS, "format": lit("webp", "png"), "lossless": BOOL, "colorSpace": CS, "bytes": POS},
         {"kind": lit("equirect"), "packs": lit("lowData")})
KCUBE = obj({"url": STR, "format": lit("ktx2"), "codec": lit("etc1s", "uastc"), "type": lit("cube"), "faceSize": POS,
             "mips": BOOL, "colorSpace": CS, "bytes": POS})
KARR = obj({"url": STR, "format": lit("ktx2"), "codec": lit("etc1s", "uastc"), "type": lit("2darray"), "layers": POS,
            "size": POS, "mips": BOOL, "colorSpace": CS, "bytes": POS})
FACESL = obj({"faces": arr(STR, 6), "format": lit("webp", "png"), "lossless": lit(True), "faceSize": POS, "colorSpace": CS,
              "bytes": POS},
             {"mips": _t(lambda v: v in ("runtime", False), "'runtime'|false"), "filter": lit("nearest", "linear"),
              "upload": lit("RGBA8", "R8")})
CUBE_LAYERS = obj({"albedo": KCUBE, "terrain": FACESL, "hydro": FACESL, "splatA": FACESL, "splatB": FACESL,
                   "splatC": FACESL, "detail": KARR, "koppenIdx": FACESL}, {"heightHi": FACESL, "koppenColor": KCUBE})
STAGES = obj({"A": arr(STR), "B": arr(STR), "C": arr(STR), "onDemand": arr(STR)})
MANIFEST = obj({
    "schema": lit("terrain-manifest/1"),
    "generated": STR,
    "placeholder": BOOL,
    "cube": obj({"faceOrder": FACE_ORDER, "convention": lit("gl"), "rows": STR, "table": STR, "latLon": STR}),
    "encodings": obj({
        "height": SQRT, "bathy": SQRT, "coastSdf": SDF,
        "river": obj({"in": STR, "curve": lit("1-d/band"), "bandKm": NUM}),
        "lakeSdf": SDF,
        "snow": obj({"in": STR, "curve": lit("linear"), "permanent": NUM}),
        "heightHi": SQRT,
        "koppenIdx": obj({"in": STR, "scale": NUM, "classes": NUM, "ocean": NUM, "filter": lit("nearest")}),
        "splat": obj({"order": tup(*[lit(c) for c in ("forest", "jungle", "grass", "farm", "steppe", "desert", "rock", "marsh", "ice")]),
                      "files": obj({"splatA": tup(NUM, NUM, NUM), "splatB": tup(NUM, NUM, NUM), "splatC": tup(NUM, NUM, NUM)}),
                      "sum": NUM}),
        "lowData": obj({"r": lit("coastSdf"), "g": lit("bathy"), "b": lit("snow")}),
        "treeDensity": obj({"r": lit("conifer"), "g": lit("broadleaf"), "b": lit("palm")}),
        "heightGrid": obj({"type": lit("uint16le"), "unit": lit("m"), "land": STR, "ocean": NUM, "rows": STR, "cellCentres": STR}),
    }),
    "preview": obj({"albedo": EQ, "data": EQ}),
    "tiers": obj({
        "low": obj({"kind": lit("equirect"), "minViewKm": NUM, "layers": obj({"albedo": EQ, "data": EQ, "koppenColor": EQ})}),
        "mid": obj({"kind": lit("cube"), "minViewKm": NUM, "layers": CUBE_LAYERS}),
        "high": obj({"kind": lit("cube"), "minViewKm": NUM, "layers": CUBE_LAYERS}),
    }),
    "shared": obj({
        "labels": obj({"url": STR, "bytes": POS}),
        "rivers": obj({"url": STR, "bytes": POS}),
        "heightGrid": obj({"url": STR, "w": POS, "h": POS, "bytes": POS}, {"format": lit("webp", "u16")}),
        "treeDensity": obj({"url": STR, "w": POS, "h": POS, "lossless": lit(True), "colorSpace": lit("none"), "bytes": POS}),
    }),
    "stages": obj({"low": STAGES, "mid": STAGES, "high": STAGES}),
    "credits": arr(obj({"id": STR, "text": STR})),
})


def urls_in(o) -> list[str]:
    out = []
    if isinstance(o, dict):
        for k, v in o.items():
            if k == "url" and isinstance(v, str):
                out.append(v)
            elif k == "faces" and isinstance(v, list):
                out.extend(v)
            else:
                out.extend(urls_in(v))
    elif isinstance(o, list):
        for v in o:
            out.extend(urls_in(v))
    return out


def file_of(url: str) -> Path:
    return PUB / url.split("?")[0]


# ---------------------------------------------------------------------------- stage resolution (mirror of stages.ts)


def resolve(m: dict, key: str):
    p = key.split(".")
    if p[0] == "preview":
        return m["preview"].get(p[1])
    if p[0] == "tiers":
        return m["tiers"][p[1]]["layers"].get(p[2])
    if p[0] == "shared":
        return m["shared"].get(p[1])
    return None


def tier_files(m: dict, tier: str, stages=("A", "B", "C", "onDemand")) -> set[str]:
    s = set()
    for st in stages:
        for k in m["stages"][tier][st]:
            L = resolve(m, k)
            if L is None:
                report(f"stage key resolves: {tier}.{st}.{k}", False)
                continue
            s.update(u.split("?")[0] for u in urls_in(L))
    return s


# ---------------------------------------------------------------------------- KTX2


def psnr(a: np.ndarray, b: np.ndarray) -> float:
    mse = float(((a.astype(np.float64) - b.astype(np.float64)) ** 2).mean())
    return 99.0 if mse == 0 else 10 * math.log10(255 ** 2 / mse)


def check_ktx(j: dict):
    out: Path = j["out"]
    name = str(out.relative_to(PUB))
    info = subprocess.run([encode.BASISU, "-info", str(out)], capture_output=True, text=True).stdout
    is_cube = "-cubemap" in j["args"]
    n_in = len(j["inputs"])
    levels = re.search(r"Mipmap Levels:\s*(\d+)", info)
    faces = re.search(r"Total Faces:\s*(\d+)", info)
    layers = re.search(r"Texture Array Size \(layers\):\s*(\d+)", info)
    fmt = "UASTC" if j["codec"] == "uastc" else "ETC1S"
    nfaces = int(faces.group(1)) if faces else 0
    nlayers = int(layers.group(1)) if layers else 0
    ok_type = nfaces == 6 if is_cube else (nfaces == 1 and nlayers == n_in)
    ok_mips = levels is not None and int(levels.group(1)) > 1
    ok_fmt = re.search(r"Supercompression Format:\s*" + ("UASTC" if fmt == "UASTC" else "(ETC1S|BasisLZ)"), info, re.I) is not None
    report(f"KTX2 info {name}", bool(ok_type and ok_mips and ok_fmt),
           f"faces {nfaces} layers {nlayers} levels {levels.group(1) if levels else '?'} {fmt if ok_fmt else 'codec?'}")
    with tempfile.TemporaryDirectory() as td:
        r = subprocess.run([encode.BASISU, "-max_threads", "4", "-unpack", "-no_ktx", str(out)], cwd=td, capture_output=True, text=True)
        got = {}
        for p in Path(td).glob("*_rgb_RGBA32_level_0_face_*.png"):
            mm = re.search(r"_rgb_RGBA32_level_0_face_(\d+)(?:_layer(\d+))?\.png$", p.name)
            if mm:
                got[int(mm.group(2)) if is_cube is False else int(mm.group(1))] = p
        if sorted(got) != list(range(n_in)):
            report(f"KTX2 unpack {name}", False, f"unpacked RGBA32 level-0 images {sorted(got)} (rc {r.returncode})")
            return
        src = [load_rgb(p) for p in j["inputs"]]
        dec = [np.asarray(Image.open(got[i]).convert("RGB")) for i in range(n_in)]
        ps = [psnr(dec[i], src[i]) for i in range(n_in)]
        # ETC1S: 31.5 dB on the worst face. basisu 2.50 ETC1S is at its ceiling here: -quality/-q/
        # -max_endpoints/-max_selectors/-effort all give byte-identical output (D5 A/B, see report);
        # the worst face is +Y (Arctic islands + brush strokes, 31.7 dB), every other face >= 33.5.
        thr = 31.5 if j["codec"] == "etc1s" else 36.0
        report(f"KTX2 round trip {name}", min(ps) >= thr, f"PSNR min {min(ps):.1f} dB (>= {thr}) per item {[round(x, 1) for x in ps]}")
        if is_cube:
            order_ok = True
            for i in range(6):
                errs = [float(((dec[i].astype(np.float64) - src[k]) ** 2).mean()) for k in range(6)]
                order_ok &= int(np.argmin(errs)) == i
            north = abs(float(dec[2].mean()) - float(src[2].mean())) < 2.0
            report(f"KTX2 face order {name}", order_ok and north,
                   f"each face best-matches its source; +Y mean {dec[2].mean():.1f} vs py.png {src[2].mean():.1f}")


# ---------------------------------------------------------------------------- lossless data


def check_lossless(m: dict):
    srcs = encode.data_sources()
    bad_meta, bad_exact, n = [], [], 0
    shipped = set()
    for u in urls_in(m):
        f = file_of(u)
        rel = str(f.relative_to(PUB))
        if rel in shipped or f.suffix not in (".webp", ".png"):
            continue
        shipped.add(rel)
        with Image.open(f) as im:
            meta = [k for k in im.info if k in ("icc_profile", "exif", "xmp", "gamma", "transparency", "srgb", "chromaticity")]
            lossy_ok = rel in srcs
            if not lossy_ok:
                if im.mode != "RGB" or meta:
                    bad_meta.append((rel, im.mode, meta))
                continue
            if im.mode != "RGB" or meta:
                bad_meta.append((rel, im.mode, meta))
            got = np.asarray(im.convert("RGB"))
        exp = srcs[rel]()
        n += 1
        if got.shape != exp.shape or not np.array_equal(got, exp):
            bad_exact.append(rel)
    missing = sorted(set(srcs) - shipped)
    report("lossless files decode bit-exact vs the intermediates", not bad_exact and not missing,
           f"{n} files; mismatched {bad_exact[:4]}; produced but unreferenced {missing[:4]}")
    report("every shipped image is RGB with no ICC/EXIF/XMP/gamma/alpha", not bad_meta, f"{bad_meta[:4]}")


# ---------------------------------------------------------------------------- VRAM via stages.ts


def vram_node() -> dict | None:
    js = (
        "import { readFileSync } from 'node:fs';"
        f"import {{ estimateTierVram }} from '{(ROOT / 'src/three/terrain/stages.ts').as_posix()}';"
        f"const m = JSON.parse(readFileSync('{(PUB / 'manifest.json').as_posix()}', 'utf8'));"
        "const o = {}; for (const t of ['low','mid','high']) o[t] = estimateTierVram(m, t);"
        "console.log(JSON.stringify(o));"
    )
    r = subprocess.run(["node", "--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", js],
                       capture_output=True, text=True, cwd=ROOT)
    if r.returncode != 0:
        print(r.stderr[-2000:])
        return None
    return json.loads(r.stdout.strip().splitlines()[-1])


# ---------------------------------------------------------------------------- main


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-ktx", action="store_true", help="skip the KTX2 unpack round trips (slow)")
    a = ap.parse_args()
    m = json.loads((PUB / "manifest.json").read_text(encoding="utf-8"))

    errs: list[str] = []
    MANIFEST.check(m, "manifest", errs)
    report("schema mirrors src/three/terrain/manifest.ts", not errs, "; ".join(errs[:6]))
    report("placeholder is false", m.get("placeholder") is False, str(m.get("placeholder")))

    # urls, hashes, bytes
    bad = []
    for u in sorted(set(urls_in(m))):
        f = file_of(u)
        if not f.is_file():
            bad.append(f"missing {u}")
            continue
        if "placeholder/" in u:
            bad.append(f"placeholder url {u}")
        h = hashlib.sha256(f.read_bytes()).hexdigest()[:8]
        if not u.endswith(f"?v={h}"):
            bad.append(f"hash {u} != {h}")

    def walk_bytes(o, path=""):
        if isinstance(o, dict):
            if "bytes" in o and ("url" in o or "faces" in o):
                fs = [file_of(u) for u in (o["faces"] if "faces" in o else [o["url"]])]
                if all(x.is_file() for x in fs) and sum(x.stat().st_size for x in fs) != o["bytes"]:
                    bad.append(f"bytes {path}")
            for k, v in o.items():
                walk_bytes(v, f"{path}.{k}")

    walk_bytes(m)
    report("every url resolves, ?v = sha256[:8], bytes = file sizes", not bad, "; ".join(bad[:6]))

    # stage keys resolve
    for t in ("low", "mid", "high"):
        tier_files(m, t)

    if not a.no_ktx:
        for j in encode.ktx_jobs():
            check_ktx(j)
    check_lossless(m)

    # budgets
    def size(paths):
        return sum((PUB / p).stat().st_size for p in paths)

    caps = {"low": 4e6, "mid": 12e6, "high": 30e6}
    for t, cap in caps.items():
        s = size(tier_files(m, t))
        report(f"download {t} (A+B+C+onDemand) <= {cap / 1e6:.0f} MB", s <= cap, f"{s / 1e6:.2f} MB")
    a_bytes = size(tier_files(m, "mid", ("A",)))
    report("stage A <= 450 KB", a_bytes <= 450_000, f"{a_bytes / 1e3:.0f} KB")
    shipped = [p for p in PUB.rglob("*") if p.is_file() and "placeholder" not in p.parts]
    tot = sum(p.stat().st_size for p in shipped)
    report("total bytes under public/textures/terrain (excl. placeholder/) <= 80 MB", tot <= 80e6, f"{tot / 1e6:.2f} MB, {len(shipped)} files")
    unref = sorted(str(p.relative_to(PUB)) for p in shipped if p.name != "manifest.json"
                   and str(p.relative_to(PUB)) not in {u.split("?")[0] for u in urls_in(m)})
    report("no unreferenced files shipped", not unref, f"{unref[:5]}")

    v = vram_node()
    if v is None:
        report("VRAM estimate (stages.ts)", False, "node failed")
    else:
        for t, cap in (("low", 48e6), ("mid", 70e6), ("high", 160e6)):
            report(f"VRAM {t} <= {cap / 1e6:.0f} MB (stages.ts estimateTierVram)", v[t]["total"] <= cap,
                   f"{v[t]['total'] / 1e6:.1f} MB: " + ", ".join(f"{k.split('.')[-1]} {b / 1e6:.1f}" for k, b in v[t]["byKey"].items()))

    # table
    print("\n  file table (bytes)")
    rows = sorted((str(p.relative_to(PUB)), p.stat().st_size) for p in shipped)
    groups: dict[str, int] = {}
    for r, n in rows:
        key = re.sub(r"_(px|nx|py|ny|pz|nz)\.", "_{face}.", r)
        groups[key] = groups.get(key, 0) + n
    for k, n in groups.items():
        print(f"    {k:52s} {n:>12,d}")
    print(f"    {'TOTAL':52s} {tot:>12,d}")
    print(f"\nvalidate: {'ALL GREEN' if not FAILS else 'FAILED: ' + ', '.join(FAILS)}")
    sys.exit(0 if not FAILS else 1)


if __name__ == "__main__":
    main()
