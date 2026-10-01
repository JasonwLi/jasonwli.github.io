# jasonli — personal website

"The Astrolabe": a heat-blued steel page with work history and a painted terrain
globe (EU4-style land cover, a Köppen climate map mode, region names, 3D monuments,
rivers and trees, deep zoom with a slight tilt) carrying a pin at every place
photographed, each opening a gallery of up to five scenery photos exported from the
iPhone library (people-free, EXIF-stripped).

## Stack

Vite · React 19 · TypeScript · three.js via react-three-fiber · troika-three-text ·
motion · Lenis. Terrain textures are KTX2 (Basis Universal, transcoder self-hosted in
`public/basis/`) plus lossless WebP/PNG data layers under `public/textures/terrain/`.

## Develop

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # production build to dist/ (CI builds from a clean checkout; it needs
                # nothing under scripts/.cache or scripts/data, only the committed
                # public/textures/terrain assets)
```

Useful query flags: `?tier=low|mid|high` (force a quality tier), `?gstyle=night`
(legacy night globe) or `?gstyle=svg` (static SVG fallback globe), `?debug=1`
(`window.__globe` hooks: `setView({lat,lon,km,tilt})`, `setMode`, `vram`, `terrain()`),
`?rafshim=1` (headless screenshots: hidden Chrome freezes rAF).

Checks:

```bash
pnpm typecheck && pnpm lint
pnpm check:bundle dist   # entry ≤ 365 KB gz, lazy chunks ≤ 160 KB gz
pnpm check:tokens        # tokens.css ↔ tokens.ts parity
pnpm check:contrast      # theme contrast pairs
pnpm check:landmarks     # 72-landmark dataset
pnpm check:cube          # cube-face table parity (Python ↔ GLSL ↔ TS)
pnpm verify:basis        # self-hosted Basis transcoder matches three's
```

### Machine lock

Builds, typechecks, dev-server screenshot runs, Python bakes and `basisu` are heavy.
On this laptop run them one at a time behind the machine-wide lock, e.g.
`~/dev/dw3-lock pnpm build`, and keep a bake's Python process under ~6 GB (the albedo
bake works in windows for that reason). Screenshots:
`~/dev/dw3-lock bash -c 'scripts/serve.sh start 5199 && node scripts/shot.mjs --params "debug=1&tier=high" --scroll travel; scripts/serve.sh stop 5199'`.

## Terrain bake (regenerating public/textures/terrain)

Only needed to change the globe's look or data; the shipped assets are committed.
Everything lives in `scripts/terrain/` (Python 3.12 venv at `scripts/terrain/.venv`).
Downloads and intermediates are git-ignored:

```
scripts/.cache/            downloads + quicklooks (never committed)
  ETOPO_2022_v1_60s_N90W180_surface.tif   NOAA NCEI ETOPO 2022 60 s surface GeoTIFF
  ne/ne_10m_*.zip, ne/NE2_HR_LC.zip       Natural Earth 10 m vectors + NE2 raster
  gibs/6/{row}_{col}.png                  MODIS IGBP land cover tiles (fetch_gibs.py)
  koppen/koppen_geiger_0p00833333.tif     Beck 2023 Köppen 1991-2020 (fetch_koppen.py)
  detail/                                 CC0 detail photo sources (bake_detail.py)
  quicklook/, shots/                      reprojected previews, screenshots
  venv -> ../terrain/.venv
scripts/data/              bake products (never committed)
  master/*.npy             21600×10800 master rasters (+ quick/ 2700×1350), READY marker
  bake/physical/           height/bathy/coast SDF/hydro cubes, Köppen index, height grid
  bake/paint/              splat weights, albedo + Köppen colour cubes, LOW equirects, trees
  bake/detail/             9-layer luminance detail tiles
```

Pipeline (each step through the lock, `py=scripts/terrain/.venv/bin/python`):

```bash
~/dev/dw3-lock bash scripts/terrain/setup.sh          # venv + requirements.txt
# downloads: ETOPO 2022 60 s surface GeoTIFF (ngdc.noaa.gov ETOPO2022/data/60s) and the
# Natural Earth 10 m zips listed above into scripts/.cache/, then:
~/dev/dw3-lock $py scripts/terrain/fetch_gibs.py      # resumable, ≤4 concurrent requests
~/dev/dw3-lock $py scripts/terrain/fetch_koppen.py
~/dev/dw3-lock $py scripts/terrain/master_build.py --all --check
~/dev/dw3-lock $py scripts/terrain/bake_physical.py --all --check
~/dev/dw3-lock $py scripts/terrain/bake_rivers.py
~/dev/dw3-lock $py scripts/terrain/bake_labels.py
~/dev/dw3-lock $py scripts/terrain/bake_splats.py --all --check
~/dev/dw3-lock $py scripts/terrain/bake_albedo.py --all --check   # windowed; --only faces|koppen|low, --faces N, --no-ql
~/dev/dw3-lock $py scripts/terrain/bake_trees.py --check
~/dev/dw3-lock $py scripts/terrain/bake_detail.py
~/dev/dw3-lock $py scripts/terrain/build_label_fonts.py           # public/fonts/*-labels.woff
~/dev/dw3-lock $py scripts/terrain/encode.py --all --final        # tiers + manifest.json
~/dev/dw3-lock $py scripts/terrain/validate.py                    # schema, bit-exact data, budgets
```

To change the look: edit `scripts/terrain/palette.json` (class colours in OKLCH, land
luminance cap 0.66, sea ramp) and/or `scripts/terrain/lib/paint.py`, re-run
`bake_albedo.py` (add `--only koppen` after editing `src/data/koppen-palette.json`), then
`encode.py --all --final` and `validate.py`. Runtime-only constants (water, relief, snow,
detail strength) are in `src/three/terrain/look.ts`. Budgets enforced by `validate.py`:
downloads LOW ≤ 4 / MID ≤ 12 / HIGH ≤ 30 MB, VRAM LOW ≤ 48 / MID ≤ 70 / HIGH ≤ 160 MB.
`index.html`'s `<!-- terrain-preload -->` block is filled at build/dev time from
`manifest.json` (vite.config.ts), so re-encoding never leaves stale preload hashes.
Re-encoded binaries stay in git history forever: commit a new asset set only once it is
signed off.

## Attribution

Terrain data and type (also credited in the site footer, `src/data/credits.ts`):

- Relief: ETOPO 2022, NOAA NCEI — doi:10.25921/fd45-gt74
- Natural Earth (public domain) — naturalearthdata.com
- Land cover: NASA MODIS MCD12Q1 v061 via NASA GIBS
- Climate: Beck et al. 2023, Köppen-Geiger 1991–2020, Sci. Data 10:724 — CC BY 4.0
- Detail textures: Poly Haven / ambientCG — CC0
- Castoro and Castoro Titling by Tiro Typeworks — SIL OFL
- Basis Universal transcoder (Binomial, Apache 2.0) via three.js

## Photo pipeline (regenerating travel data)

Photos never live in git raw — they are exported from the macOS Photos library
by a pipeline that:

1. dumps geo-tagged photo metadata via JXA (`osascript -l JavaScript`, needs
   Automation permission for Photos),
2. clusters shots into ~city-scale locations (60 km greedy haversine) and
   reverse-geocodes them offline,
3. exports up to 12 candidates per location from Photos,
4. **rejects photos that are clearly OF someone** — Apple Vision face sizes
   (big face or posed group) + YOLO person-box sizes (subject-sized figures);
   incidental distant people in scenery pass,
5. scores scenery-ness (Vision classification), keeps the top 5 per location
   spread across visits, resizes to 1600 px JPEG (EXIF stripped, blur-up thumb
   inlined), and
6. writes `public/photos/<slug>/…` + `public/travel-data.json` (fetched at runtime).

Pipeline scripts live in `scripts/photo-pipeline/` (Python; needs a venv with
`osxphotos pillow pillow-heif reverse_geocoder pyobjc-framework-Vision
pyobjc-framework-Quartz`).

`scripts/gen-land-polys.mjs`, `scripts/gen-border-polys.mjs` and
`scripts/gen_land_mask.py` regenerate the legacy night globe's land mask
(`public/textures/land_mask_4096.png`, used by `?gstyle=night`);
`scripts/gen-coastlines.mjs` builds `src/data/coastlines.json` for the SVG fallback globe.

## Design

See `DESIGN.md` and `PRODUCT.md`.
Work content: `src/data/work.ts`.
