#!/usr/bin/env python3
"""Download the Beck et al. 2023 Koppen-Geiger 1 km map (CC BY 4.0) and extract the
1991-2020 member into scripts/.cache/koppen/.

Source: figshare article 21789074, file koppen_geiger_tif.zip
        https://ndownloader.figshare.com/files/61012822
The ndownloader redirect (to S3) expires in ~10 s, so every attempt re-resolves the URL
(urllib follows the redirect afresh each time).  Resumable via HTTP Range on the .part file.

Credit: "Climate: Koppen-Geiger, Beck et al. 2023, Sci. Data 10:724 (CC BY 4.0)".
Values: 1..30 in Beck order (1 Af ... 29 ET, 30 EF), 0 = ocean / nodata.

Writes scripts/.cache/koppen/source.json recording exactly which member was extracted.
Stdlib only (runs with any python3).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "scripts/.cache/koppen"
FILE_URL = "https://ndownloader.figshare.com/files/61012822"
API_URL = "https://api.figshare.com/v2/articles/21789074"
ZIP_NAME = "koppen_geiger_tif.zip"
PREFERRED = ["1991_2020/koppen_geiger_0p00833333.tif", "1991_2020/koppen_geiger_0p1.tif"]
UA = {"User-Agent": "personal-website-terrain-bake/1.0 (+https://jasonwli.github.io)"}


def log(*a):
    print("[fetch_koppen]", *a, flush=True)


def resolve_via_api() -> str | None:
    try:
        with urllib.request.urlopen(urllib.request.Request(API_URL, headers=UA), timeout=60) as r:
            art = json.load(r)
        for f in art.get("files", []):
            if f.get("name") == ZIP_NAME:
                return f.get("download_url")
    except Exception as e:  # noqa: BLE001
        log("figshare API lookup failed:", e)
    return None


def download(url: str, dest: Path, tries: int = 8) -> None:
    part = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(1, tries + 1):
        have = part.stat().st_size if part.exists() else 0
        hdr = dict(UA)
        if have:
            hdr["Range"] = f"bytes={have}-"
        try:
            req = urllib.request.Request(url, headers=hdr)
            with urllib.request.urlopen(req, timeout=120) as r:
                status = r.status
                total = r.headers.get("Content-Length")
                if have and status != 206:
                    log("server ignored Range; restarting from 0")
                    have = 0
                mode = "ab" if have else "wb"
                total_all = (int(total) + have) if total else None
                log(f"attempt {attempt}: HTTP {status}, resume at {have}, total {total_all}")
                got = have
                last = time.time()
                with open(part, mode) as fh:
                    while True:
                        buf = r.read(1 << 20)
                        if not buf:
                            break
                        fh.write(buf)
                        got += len(buf)
                        if time.time() - last > 10:
                            log(f"  {got/1e6:.1f} MB" + (f" / {total_all/1e6:.1f} MB" if total_all else ""))
                            last = time.time()
                if total_all and got != total_all:
                    raise IOError(f"short read {got} != {total_all}")
            part.rename(dest)
            return
        except urllib.error.HTTPError as e:
            if e.code == 416 and part.exists():  # already complete
                part.rename(dest)
                return
            if e.code == 404:
                api = resolve_via_api()
                if api and api != url:
                    log("file id 404; switching to API download_url", api)
                    url = api
                    continue
            log(f"attempt {attempt} HTTP error {e.code}")
        except Exception as e:  # noqa: BLE001
            log(f"attempt {attempt} failed: {e}")
        time.sleep(min(60, 2 ** attempt))
    raise SystemExit("koppen download failed after retries")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    zpath = CACHE / ZIP_NAME
    if args.force and zpath.exists():
        zpath.unlink()
    if zpath.exists():
        try:
            zipfile.ZipFile(zpath).namelist()
        except zipfile.BadZipFile:
            log("cached zip is corrupt; re-downloading")
            zpath.unlink()
    if not zpath.exists():
        download(FILE_URL, zpath)
    zf = zipfile.ZipFile(zpath)
    names = zf.namelist()
    log("zip members:", len(names))
    for n in names:
        if "1991_2020" in n:
            log("  ", n)
    member = next((p for p in PREFERRED if p in names), None)
    if member is None:  # tolerate a top-level folder prefix
        for p in PREFERRED:
            member = next((n for n in names if n.endswith(p)), None)
            if member:
                break
    if member is None:
        raise SystemExit("no 1991_2020 koppen tif found in zip")
    out = CACHE / Path(member).name
    info = zf.getinfo(member)
    if not out.exists() or out.stat().st_size != info.file_size:
        log("extracting", member, f"({info.file_size/1e6:.1f} MB)")
        with zf.open(member) as src, open(out.with_suffix(".tmp"), "wb") as dst:
            while True:
                b = src.read(1 << 22)
                if not b:
                    break
                dst.write(b)
        out.with_suffix(".tmp").rename(out)
    if "legend.txt" in names:
        (CACHE / "legend.txt").write_bytes(zf.read("legend.txt"))
    bad = zf.testzip()
    if bad:
        raise SystemExit(f"zip CRC failure in {bad}")
    meta = {
        "source_url": FILE_URL,
        "article": "https://doi.org/10.6084/m9.figshare.21789074",
        "zip": str(zpath.relative_to(ROOT)),
        "zip_bytes": zpath.stat().st_size,
        "member": member,
        "file": str(out.relative_to(ROOT)),
        "file_bytes": out.stat().st_size,
        "fetched": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "licence": "CC BY 4.0",
        "credit": "Climate: Koppen-Geiger, Beck et al. 2023, Sci. Data 10:724 (CC BY 4.0)",
    }
    (CACHE / "source.json").write_text(json.dumps(meta, indent=2))
    log("OK", json.dumps(meta))


if __name__ == "__main__":
    sys.exit(main())
