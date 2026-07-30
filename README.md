# jasonli — personal website

Dark-planetarium personal site: work history plus an interactive 3D globe with a
ping at every place photographed, each opening a gallery of up to five scenery
photos exported from the iPhone library (people-free, EXIF-stripped).

## Stack

Vite · React 19 · TypeScript · three.js via react-three-fiber · motion · Lenis.

## Develop

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # production build to dist/
```

## Data pipeline (regenerating travel data)

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

`scripts/gen-land-dots.mjs` regenerates the globe's land-dot lattice from
world-atlas (committed as `src/data/land-dots.json`).

## Design

See `DESIGN.md` (planetarium/expedition-atlas direction) and `PRODUCT.md`.
Work content: `src/data/work.ts`.
