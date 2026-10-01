#!/usr/bin/env python3
"""Fetch the MODIS MCD12Q1 v061 IGBP land-cover tiles from NASA GIBS (WMTS, EPSG:4326).

Layer   MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual, TileMatrixSet 500m
Level 6 80 cols x 40 rows of 512 px PNG = 40960 x 20480 px, 0.5625/64 deg per px,
        origin (-180, 90), row 0 = north.   (--level 5: 40 x 20 tiles.)
Tiles are cached as scripts/.cache/gibs/{level}/{row}_{col}.png; existing files are skipped,
so the run is resumable.  At most 4 concurrent requests (machine rule), up to 6 retries
with exponential backoff.

The date defaults to 2023-01-01 (work-package spec); if a probe tile for that date fails,
the layer's <Default> time from GetCapabilities is used.  The date actually used and the
colormap are recorded in scripts/.cache/gibs/source.json.

Colormap https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_IGBP_Land_Cover_Type.xml is
cached as scripts/.cache/gibs/colormap.xml (master_build.py maps RGB -> IGBP 1..17 with it).

Credit: "Land cover: NASA MODIS MCD12Q1 v061 via NASA GIBS".  Stdlib only.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "scripts/.cache/gibs"
LAYER = "MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual"
TMPL = ("https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/" + LAYER +
        "/default/{time}/500m/{z}/{row}/{col}.png")
CAPS = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/WMTSCapabilities.xml"
CMAP = "https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_IGBP_Land_Cover_Type.xml"
UA = {"User-Agent": "personal-website-terrain-bake/1.0 (+https://jasonwli.github.io)"}
GRID = {6: (80, 40), 5: (40, 20)}
PNG_SIG = b"\x89PNG\r\n\x1a\n"


def log(*a):
    print("[fetch_gibs]", *a, flush=True)


def get(url: str, timeout: int = 60) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


def get_retry(url: str, tries: int = 6) -> bytes:
    err = None
    for i in range(tries):
        try:
            b = get(url)
            if not b.startswith(PNG_SIG):
                raise IOError(f"not a PNG ({b[:60]!r})")
            return b
        except urllib.error.HTTPError as e:
            err = e
            if e.code in (400, 404):
                raise
        except Exception as e:  # noqa: BLE001
            err = e
        time.sleep(min(60, 1.5 * 2 ** i))
    raise IOError(f"{url}: {err}")


def default_time() -> str:
    s = get(CAPS, timeout=180).decode("utf-8", "replace")
    i = s.find(f"<ows:Identifier>{LAYER}</ows:Identifier>")
    j, k = s.rfind("<Layer>", 0, i), s.find("</Layer>", i)
    m = re.search(r"<Default>([^<]+)</Default>", s[j:k])
    if not m:
        raise SystemExit("no default time in GetCapabilities")
    return m.group(1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--level", type=int, default=6, choices=sorted(GRID))
    ap.add_argument("--time", default="2023-01-01")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()
    workers = max(1, min(4, args.workers))  # machine rule: <= 4 concurrent requests
    cols, rows = GRID[args.level]
    out = CACHE / str(args.level)
    out.mkdir(parents=True, exist_ok=True)
    meta_path = CACHE / "source.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}

    if not (CACHE / "colormap.xml").exists():
        (CACHE / "colormap.xml").write_bytes(get(CMAP))

    t = meta.get(f"time_level{args.level}") or args.time
    probe = TMPL.format(time=t, z=args.level, row=rows // 4, col=cols // 2)
    try:
        get_retry(probe, tries=3)
    except Exception as e:  # noqa: BLE001
        log(f"time {t} failed ({e}); using GetCapabilities default")
        t = default_time()
    log(f"level {args.level}: {cols}x{rows} tiles, time {t}, {workers} workers")

    todo = [(r, c) for r in range(rows) for c in range(cols)
            if not (out / f"{r}_{c}.png").exists()]
    log(f"{cols*rows - len(todo)} cached, {len(todo)} to fetch")
    lock = threading.Lock()
    done = [0]
    failed: list[tuple[int, int, str]] = []
    t0 = time.time()

    def job(rc):
        r, c = rc
        b = get_retry(TMPL.format(time=t, z=args.level, row=r, col=c))
        tmp = out / f".{r}_{c}.tmp"
        tmp.write_bytes(b)
        tmp.rename(out / f"{r}_{c}.png")
        return len(b)

    with ThreadPoolExecutor(workers) as ex:
        futs = {ex.submit(job, rc): rc for rc in todo}
        for f in as_completed(futs):
            try:
                f.result()
            except Exception as e:  # noqa: BLE001
                failed.append((*futs[f], str(e)))
            with lock:
                done[0] += 1
                if done[0] % 100 == 0:
                    el = time.time() - t0
                    log(f"  {done[0]}/{len(todo)}  {el:.0f}s  eta {el/done[0]*(len(todo)-done[0]):.0f}s")

    n_have = sum(1 for r in range(rows) for c in range(cols) if (out / f"{r}_{c}.png").exists())
    meta.update({
        "layer": LAYER,
        "tile_matrix_set": "500m",
        f"time_level{args.level}": t,
        f"tiles_level{args.level}": f"{n_have}/{cols*rows}",
        "url_template": TMPL,
        "colormap": CMAP,
        "credit": "Land cover: NASA MODIS MCD12Q1 v061 via NASA GIBS",
        "fetched": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })
    meta_path.write_text(json.dumps(meta, indent=2))
    if failed:
        log(f"{len(failed)} tiles FAILED (rerun to resume):", failed[:5])
        sys.exit(1)
    log(f"OK {n_have}/{cols*rows} tiles, time {t}")


if __name__ == "__main__":
    main()
