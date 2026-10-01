"""D5: encode the bake intermediates into shipped tier files + write public/textures/terrain/manifest.json.

Schema: src/three/terrain/manifest.ts (frozen by F0) -- mirrored by validate.py.
Inputs:  scripts/data/bake/{physical,paint,detail}/  (D2, D3, D4)
Outputs: public/textures/terrain/{shared,low,mid,high}/ + manifest.json (placeholder:false only
         with --final, after the browser decode check).

Tier layout (binding VRAM budgets low <= 48, mid <= 70, high <= 160 MB with the stages.ts estimate:
RGBA8 data cubes x4/x(4/3) mips, R8 x1, KTX2 1 B/texel, equirects x4 x(4/3)):

  preview  albedo 1024x512 lossy WebP q80, data (lowData) 1024x512 lossless          (stage A)
  low      albedo 2048x1024 lossy WebP q88, data 2048x1024 lossless, Köppen colour 2048x1024 q85
  mid      albedo cube 1280 KTX2 UASTC sRGB (INT-B: area-resampled from 2048 in linear light; 1024
           ETC1S was blurry and blocky at 600-1500 km); terrain 768; hydro 512; splats 512; detail
           256 UASTC array; Köppen index 512 PNG (R8, nearest). No Köppen colour cube on mid/high
           (INT-B: climate reads koppenIdx + the palette LUT in the shader).
  high     albedo cube 2048 (codec per ALBEDO_HIGH_CODEC); terrain 1024; hydro 768; heightHi 2048 (R8);
           splats 512 (= mid files); detail 512 UASTC array; Köppen index 1024
  shared   labels.json, rivers.json (minified), height_2048x1024.webp (u16 packed R hi / G lo, lossless), trees_4096x2048 lossless WebP

Data rules (ENG_PLAN R2-R4): lossless WebP (PIL lossless, exact, method 6) or PNG; RGB only; no
ICC/EXIF/XMP. terrain/hydro at 768/512 are derived from D2's 1024 faces by an area resample of the
DECODED physical values (sqrt curves undone, then re-encoded), per face (faces stay seam-exact
because every face edge is a texel edge at every size).

KTX2 (R10): only -etc1s / -uastc; cube inputs px nx py ny pz nz with -cubemap; -mip_clamp on cubes
(the default wrap would bleed the opposite face edge into mips); detail -linear and wrap mips.
basisu runs with -max_threads 4 (machine rules).

Run: ~/dev/dw3-lock scripts/terrain/.venv/bin/python scripts/terrain/encode.py --all [--final]
     --only ktx|data|eq|shared|manifest   to redo one part (the manifest step always re-hashes)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.cube import FACES  # noqa: E402
from lib.io import load_rgb, save_png_rgb, save_webp_lossless, save_webp_lossy  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
BAKE = ROOT / "scripts" / "data" / "bake"
PHYS = BAKE / "physical"
PAINT = BAKE / "paint"
DETAIL = BAKE / "detail"
PUB = ROOT / "public" / "textures" / "terrain"
BASISU = shutil.which("basisu") or "/opt/homebrew/bin/basisu"

# ---------------------------------------------------------------------------- tier plan (sizes)
MID = {"albedo": 1280, "terrain": 768, "hydro": 512, "splat": 512, "detail": 256, "kidx": 512}
HIGH = {"albedo": 2048, "terrain": 1024, "hydro": 768, "heightHi": 2048, "splat": 512, "detail": 512,
        "kidx": 1024}
PREVIEW = (1024, 512)
LOW = (2048, 1024)

# MID albedo codec (INT-B): ETC1S's shared endpoint/selector codebooks turn the painted strokes into
# flat 4x4-texel colour blocks at 600-1500 km (worst at 1920-2048, where 1.5 M blocks share 16 k
# endpoints); UASTC 1280 (1 B/texel, 13 MB VRAM) is sharper than ETC1S 1920 and never blocky.
MID_ALBEDO_CODEC = "uastc"
# HIGH albedo codec. ETC1S at 2048 is visibly blocky at <= 600 km (C2b); see report for the A/B.
ALBEDO_HIGH_CODEC = "uastc"
UASTC_ALBEDO_ARGS = ["-uastc", "-uastc_level", "2", "-uastc_rdo_l", "2.0"]
ETC1S_ARGS = ["-etc1s", "-quality", "100", "-effort", "6", "-max_endpoints", "16128", "-max_selectors", "16128"]

# encodings (must equal the manifest encodings block)
H_MAX, B_MAX = 9000.0, 11000.0


def log(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------------------- helpers


def basisu(args: list[str], cwd: Path) -> str:
    cmd = [BASISU, "-max_threads", "4", *args]
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(r.stdout[-4000:] + r.stderr[-4000:])
        raise SystemExit(f"basisu failed: {' '.join(cmd)}")
    return r.stdout


def area_resize(a: np.ndarray, n: int) -> np.ndarray:
    """Area-weighted resample of an (N, N[, C]) float face to (n, n)."""
    return cv2.resize(a.astype(np.float32), (n, n), interpolation=cv2.INTER_AREA)


def terrain_resample(img: np.ndarray, n: int) -> np.ndarray:
    """terrain RGB (R sqrt height, G sqrt bathy, B linear coast SDF) -> n, through physical values."""
    v = img.astype(np.float64) / 255.0
    h = (v[..., 0] ** 2) * H_MAX
    b = (v[..., 1] ** 2) * B_MAX
    phys = np.stack([h, b, v[..., 2]], -1)
    r = area_resize(phys, n).astype(np.float64)
    out = np.stack([np.sqrt(np.clip(r[..., 0], 0, H_MAX) / H_MAX), np.sqrt(np.clip(r[..., 1], 0, B_MAX) / B_MAX),
                    np.clip(r[..., 2], 0, 1)], -1)
    return np.clip(np.rint(out * 255), 0, 255).astype(np.uint8)


def linear_resample(img: np.ndarray, n: int) -> np.ndarray:
    """hydro RGB (all channels linear: river band, lake SDF, snow) -> n."""
    r = area_resize(img.astype(np.float32) / 255.0, n)
    return np.clip(np.rint(r * 255), 0, 255).astype(np.uint8)


def lowdata_resample(img: np.ndarray, w: int, h: int) -> np.ndarray:
    """lowData equirect (R coast SDF linear, G sqrt bathy, B snow linear) -> w x h (area)."""
    v = img.astype(np.float64) / 255.0
    phys = np.stack([v[..., 0], (v[..., 1] ** 2) * B_MAX, v[..., 2]], -1).astype(np.float32)
    r = cv2.resize(phys, (w, h), interpolation=cv2.INTER_AREA).astype(np.float64)
    out = np.stack([np.clip(r[..., 0], 0, 1), np.sqrt(np.clip(r[..., 1], 0, B_MAX) / B_MAX), np.clip(r[..., 2], 0, 1)], -1)
    return np.clip(np.rint(out * 255), 0, 255).astype(np.uint8)


def srgb_box_down(img: np.ndarray, k: int) -> np.ndarray:
    """Box-downsample an sRGB image by k in linear light."""
    lin = np.where(img / 255.0 <= 0.04045, img / 255.0 / 12.92, ((img / 255.0 + 0.055) / 1.055) ** 2.4)
    h, w = lin.shape[:2]
    m = lin.reshape(h // k, k, w // k, k, 3).mean(axis=(1, 3))
    s = np.where(m <= 0.0031308, m * 12.92, 1.055 * np.power(m, 1 / 2.4) - 0.055)
    return np.clip(np.rint(s * 255), 0, 255).astype(np.uint8)


def faces_of(base: Path, stem: str) -> list[Path]:
    return [base / f"{stem}_{f}.png" for f in FACES]


def srgb_area_resize(img: np.ndarray, n: int) -> np.ndarray:
    """Area-resample an sRGB face to n x n in linear light."""
    x = img / 255.0
    lin = np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4).astype(np.float32)
    m = cv2.resize(lin, (n, n), interpolation=cv2.INTER_AREA).astype(np.float64)
    s = np.where(m <= 0.0031308, m * 12.92, 1.055 * np.power(np.clip(m, 0, 1), 1 / 2.4) - 0.055)
    return np.clip(np.rint(s * 255), 0, 255).astype(np.uint8)


def derived_albedo_faces(n: int) -> list[Path]:
    """Albedo faces at a size D3 does not bake (mid 1920, INT-B): area-resampled from the 2048 master
    faces in linear light, written next to them; re-derived whenever a 2048 face is newer."""
    pc = PAINT / "cube"
    out = faces_of(pc, f"albedo_{n}")
    if n in (2048, 1024):
        return out
    for src, dst in zip(faces_of(pc, "albedo_2048"), out):
        if not dst.exists() or dst.stat().st_mtime < src.stat().st_mtime:
            save_png_rgb(srgb_area_resize(load_rgb(src), n), dst)
    return out


# ---------------------------------------------------------------------------- data faces (lossless)


def data_jobs() -> list[tuple[Path, callable]]:
    """(output path, producer -> uint8 RGB array). Every lossless data file shipped."""
    J = []
    pc, dc = PHYS / "cube", PAINT / "cube"

    def from_png(p):
        return lambda: load_rgb(p)

    for f in FACES:
        # terrain: high 1024 = D2 as-is, mid 768 derived
        J.append((PUB / "high" / f"terrain_1024_{f}.webp", from_png(pc / f"terrain_1024_{f}.png")))
        J.append((PUB / "mid" / f"terrain_768_{f}.webp",
                  (lambda f=f: terrain_resample(load_rgb(pc / f"terrain_1024_{f}.png"), 768))))
        # hydro: high 768, mid 512 (both derived from D2's 1024)
        J.append((PUB / "high" / f"hydro_768_{f}.webp", (lambda f=f: linear_resample(load_rgb(pc / f"hydro_1024_{f}.png"), 768))))
        J.append((PUB / "mid" / f"hydro_512_{f}.webp", (lambda f=f: linear_resample(load_rgb(pc / f"hydro_1024_{f}.png"), 512))))
        J.append((PUB / "high" / f"heightHi_2048_{f}.webp", from_png(pc / f"heightHi_2048_{f}.png")))
        for s in "ABC":
            J.append((PUB / "mid" / f"splat{s}_512_{f}.webp", from_png(dc / f"splat{s}_512_{f}.png")))
        J.append((PUB / "mid" / f"koppen_idx_512_{f}.png", from_png(pc / f"koppenIdx_512_{f}.png")))
        J.append((PUB / "high" / f"koppen_idx_1024_{f}.png", from_png(pc / f"koppenIdx_1024_{f}.png")))
    J.append((PUB / "low" / f"data_{LOW[0]}x{LOW[1]}.webp", from_png(PHYS / "eq" / f"lowdata_{LOW[0]}x{LOW[1]}.png")))
    J.append((PUB / "shared" / f"preview_data_{PREVIEW[0]}x{PREVIEW[1]}.webp",
              from_png(PHYS / "eq" / f"lowdata_{PREVIEW[0]}x{PREVIEW[1]}.png")))
    J.append((PUB / "shared" / "trees_4096x2048.webp", from_png(PAINT / "eq" / "trees_4096x2048.png")))
    return J


def write_data():
    t = time.time()
    for out, fn in data_jobs():
        arr = fn()
        if out.suffix == ".png":
            save_png_rgb(arr, out)
        else:
            save_webp_lossless(arr, out)
    log(f"  data files: {len(data_jobs())} written ({time.time() - t:.0f}s)")


def data_sources() -> dict[str, np.ndarray]:
    """Expected decoded pixels per shipped lossless file (validate.py bit-exactness)."""
    d = {str(out.relative_to(PUB)): fn for out, fn in data_jobs()}
    d["shared/height_2048x1024.webp"] = height_packed
    return d


def height_packed() -> np.ndarray:
    """The CPU height grid (D2 uint16le metres) packed R = hi byte, G = lo byte, B = 0."""
    h = np.fromfile(PHYS / "eq" / "height_2048x1024.u16", "<u2").reshape(1024, 2048)
    return np.stack([h >> 8, h & 255, np.zeros_like(h)], -1).astype(np.uint8)


# ---------------------------------------------------------------------------- equirect appearance


def write_eq():
    prev = load_rgb(PAINT / "eq" / "preview_albedo_2048x1024.png")  # = LOW 4096 albedo box-down x2
    save_webp_lossy(prev, PUB / "low" / f"albedo_{LOW[0]}x{LOW[1]}.webp", q=88)
    save_webp_lossy(srgb_box_down(prev, 2), PUB / "shared" / f"preview_albedo_{PREVIEW[0]}x{PREVIEW[1]}.webp", q=80)
    kc = load_rgb(PAINT / "eq" / "koppencolor_2048x1024.png")
    save_webp_lossy(kc, PUB / "low" / "koppen_color_2048x1024.webp", q=85)
    log("  equirect appearance files written")


# ---------------------------------------------------------------------------- KTX2


def ktx_jobs() -> list[dict]:
    pc = PAINT / "cube"
    J = [
        {"out": PUB / "mid" / f"albedo_{MID['albedo']}.ktx2", "inputs": derived_albedo_faces(MID["albedo"]),
         "args": (UASTC_ALBEDO_ARGS if MID_ALBEDO_CODEC == "uastc" else ETC1S_ARGS) + ["-srgb", "-mipmap", "-mip_clamp", "-cubemap"],
         "codec": MID_ALBEDO_CODEC},
        {"out": PUB / "high" / f"albedo_{HIGH['albedo']}.ktx2", "inputs": faces_of(pc, f"albedo_{HIGH['albedo']}"),
         "args": (UASTC_ALBEDO_ARGS if ALBEDO_HIGH_CODEC == "uastc" else ETC1S_ARGS) + ["-srgb", "-mipmap", "-mip_clamp", "-cubemap"],
         "codec": ALBEDO_HIGH_CODEC},
    ]
    for n, tier in ((MID["detail"], "mid"), (HIGH["detail"], "high")):
        J.append({"out": PUB / tier / f"detail_{n}.ktx2", "inputs": [DETAIL / f"detail_{n}_{i:02d}.png" for i in range(9)],
                  "args": ["-uastc", "-uastc_level", "2", "-uastc_rdo_l", "1.0", "-linear", "-mipmap", "-tex_type", "2darray"],
                  "codec": "uastc"})
    return J


def write_ktx(only: str | None = None):
    for j in ktx_jobs():
        if only and only not in j["out"].name:
            continue
        t = time.time()
        j["out"].parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            names = []
            for i, p in enumerate(j["inputs"]):
                # re-save through lib.io so no colour chunk reaches basisu
                q = td / f"in_{i}.png"
                save_png_rgb(load_rgb(p), q)
                names.append(q.name)
            tmp_out = td / "out.ktx2"
            basisu(["-ktx2", *j["args"], "-no_stats", "-output_file", str(tmp_out), *names], td)
            shutil.copyfile(tmp_out, j["out"])
        log(f"  {j['out'].relative_to(PUB)}: {j['out'].stat().st_size / 1e6:.2f} MB ({time.time() - t:.0f}s)")


# ---------------------------------------------------------------------------- shared JSON / grid


def write_shared():
    sh = PUB / "shared"
    sh.mkdir(parents=True, exist_ok=True)
    for name in ("labels.json", "rivers.json"):
        obj = json.loads((PHYS / name).read_text(encoding="utf-8"))
        (sh / name).write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    # INT-B: the uint16le metre grid ships packed (hi byte R, lo byte G, B 0) as lossless WebP:
    # 0.68 MB instead of 4.2 MB on every tier; the loader unpacks it exactly
    save_webp_lossless(height_packed(), sh / "height_2048x1024.webp")
    (sh / "height_2048x1024.u16").unlink(missing_ok=True)
    log("  shared json + height grid written")


# ---------------------------------------------------------------------------- manifest


def vref(path: Path) -> tuple[str, int]:
    data = path.read_bytes()
    return f"{path.relative_to(PUB).as_posix()}?v={hashlib.sha256(data).hexdigest()[:8]}", len(data)


def eq_layer(path: Path, w: int, h: int, lossless: bool, cs: str, packs: str | None = None, kind: bool = False) -> dict:
    url, n = vref(path)
    d: dict = {"url": url}
    if kind:
        d["kind"] = "equirect"
    d.update({"w": w, "h": h, "format": path.suffix[1:], "lossless": lossless, "colorSpace": cs})
    if packs:
        d["packs"] = packs
    d["bytes"] = n
    return d


def ktx_cube(path: Path, codec: str, size: int, cs: str = "srgb") -> dict:
    url, n = vref(path)
    return {"url": url, "format": "ktx2", "codec": codec, "type": "cube", "faceSize": size, "mips": True,
            "colorSpace": cs, "bytes": n}


def ktx_array(path: Path, size: int) -> dict:
    url, n = vref(path)
    return {"url": url, "format": "ktx2", "codec": "uastc", "type": "2darray", "layers": 9, "size": size,
            "mips": True, "colorSpace": "none", "bytes": n}


def face_layer(tier: str, stem: str, size: int, ext: str = "webp", **extra) -> dict:
    urls, tot = [], 0
    for f in FACES:
        u, n = vref(PUB / tier / f"{stem}_{size}_{f}.{ext}")
        urls.append(u)
        tot += n
    d = {"faces": urls, "format": ext, "lossless": True, "faceSize": size, "colorSpace": "none"}
    d.update(extra)
    d["bytes"] = tot
    return d


def manifest(final: bool) -> dict:
    base = json.loads((PUB / "manifest.json").read_text())  # keep the frozen convention/encodings blocks
    cube_tier = lambda min_km, L: {"kind": "cube", "minViewKm": min_km, "layers": L}  # noqa: E731
    mid = {
        "albedo": ktx_cube(PUB / "mid" / f"albedo_{MID['albedo']}.ktx2", MID_ALBEDO_CODEC, MID["albedo"]),
        "terrain": face_layer("mid", "terrain", MID["terrain"], mips="runtime"),
        "hydro": face_layer("mid", "hydro", MID["hydro"]),
        "splatA": face_layer("mid", "splatA", MID["splat"]),
        "splatB": face_layer("mid", "splatB", MID["splat"]),
        "splatC": face_layer("mid", "splatC", MID["splat"]),
        "detail": ktx_array(PUB / "mid" / f"detail_{MID['detail']}.ktx2", MID["detail"]),
        "koppenIdx": face_layer("mid", "koppen_idx", MID["kidx"], ext="png", filter="nearest", upload="R8"),
    }
    high = {
        "albedo": ktx_cube(PUB / "high" / f"albedo_{HIGH['albedo']}.ktx2", ALBEDO_HIGH_CODEC, HIGH["albedo"]),
        "terrain": face_layer("high", "terrain", HIGH["terrain"], mips="runtime"),
        "hydro": face_layer("high", "hydro", HIGH["hydro"]),
        "heightHi": face_layer("high", "heightHi", HIGH["heightHi"], upload="R8"),
        "splatA": mid["splatA"],
        "splatB": mid["splatB"],
        "splatC": mid["splatC"],
        "detail": ktx_array(PUB / "high" / f"detail_{HIGH['detail']}.ktx2", HIGH["detail"]),
        "koppenIdx": face_layer("high", "koppen_idx", HIGH["kidx"], ext="png", filter="nearest", upload="R8"),
    }
    pw, ph = PREVIEW
    lw, lh = LOW
    m = {
        "schema": "terrain-manifest/1",
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "placeholder": not final,
        "cube": base["cube"],
        "encodings": base["encodings"],
        "preview": {
            "albedo": eq_layer(PUB / "shared" / f"preview_albedo_{pw}x{ph}.webp", pw, ph, False, "srgb", kind=True),
            "data": eq_layer(PUB / "shared" / f"preview_data_{pw}x{ph}.webp", pw, ph, True, "none", packs="lowData", kind=True),
        },
        "tiers": {
            "low": {"kind": "equirect", "minViewKm": base["tiers"]["low"]["minViewKm"], "layers": {
                "albedo": eq_layer(PUB / "low" / f"albedo_{lw}x{lh}.webp", lw, lh, False, "srgb"),
                "data": eq_layer(PUB / "low" / f"data_{lw}x{lh}.webp", lw, lh, True, "none", packs="lowData"),
                "koppenColor": eq_layer(PUB / "low" / "koppen_color_2048x1024.webp", 2048, 1024, False, "srgb"),
            }},
            "mid": cube_tier(base["tiers"]["mid"]["minViewKm"], mid),
            "high": cube_tier(base["tiers"]["high"]["minViewKm"], high),
        },
        "shared": {
            "labels": dict(zip(("url", "bytes"), vref(PUB / "shared" / "labels.json"))),
            "rivers": dict(zip(("url", "bytes"), vref(PUB / "shared" / "rivers.json"))),
            "heightGrid": (lambda u: {"url": u[0], "w": 2048, "h": 1024, "format": "webp", "bytes": u[1]})(
                vref(PUB / "shared" / "height_2048x1024.webp")),
            "treeDensity": (lambda u: {"url": u[0], "w": 4096, "h": 2048, "lossless": True, "colorSpace": "none", "bytes": u[1]})(
                vref(PUB / "shared" / "trees_4096x2048.webp")),
        },
        # no Köppen colour cube on mid/high (INT-B): drop its stage keys if an older manifest had them
        "stages": {t: {k: [x for x in v if x not in ("tiers.mid.koppenColor", "tiers.high.koppenColor")]
                       for k, v in st.items()} for t, st in base["stages"].items()},
        "credits": base["credits"],
    }
    return m


def write_manifest(final: bool):
    m = manifest(final)
    (PUB / "manifest.json").write_text(json.dumps(m, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    log(f"  manifest.json written (placeholder: {m['placeholder']})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--only", choices=["ktx", "data", "eq", "shared", "manifest"])
    ap.add_argument("--ktx", default=None, help="with --only ktx: substring of one output name")
    ap.add_argument("--final", action="store_true", help="write placeholder:false")
    a = ap.parse_args()
    t0 = time.time()
    do = {a.only} if a.only else ({"ktx", "data", "eq", "shared", "manifest"} if a.all else {"manifest"})
    if "shared" in do:
        write_shared()
    if "data" in do:
        write_data()
    if "eq" in do:
        write_eq()
    if "ktx" in do:
        write_ktx(a.ktx)
    write_manifest(a.final)
    log(f"encode: {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
