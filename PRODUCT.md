# PRODUCT.md — jasonli.world

## What this is

Jason Li's personal website. Two focuses: **work** (software engineer — Coinbase → Coherent → Immutable → Codex founding eng/Head of Product → Tempo; payments, FX and stablecoin infrastructure; AI side projects) and **travel** (an interactive 3D globe with a ping at every place he's photographed — 100-some locations across ~36 countries, regenerated from his own iPhone library; no photos that are clearly of a person; exact counts live in `public/travel-data.json`).

## Audience

Recruiters, collaborators, internet friends. They should leave thinking: this person builds serious systems *and* has genuinely seen the world.

## Register

`brand` — a portfolio. Design IS the product.

## Platform

`web` — Vite + React + TypeScript, react-three-fiber for the 3D globe, motion (Framer Motion) for UI transitions, Lenis for smooth scroll. Static build, no backend.

## Voice

Precise, expeditionary, quietly confident. Never braggy; the globe does the talking.

## Structure

Single scrolling page over one fixed 3D scene, themed as a Renaissance astrolabe (heat-blued steel, gilt engraved scales, silver text, vermilion for the active place):

1. **Hero** — engraved name crest and tagline upper-left; the globe sits in an engraved degree limb that turns with it.
2. **The work** — an engraved gazetteer table of roles (dates and places, company, role, one-line summary).
3. **The globe (travel)** — an EU4-painterly terrain globe with Terrain / Climate (Köppen) map modes, lettered region and sea names, 3D monuments, rivers and trees; drag to spin, deep zoom with a slight tilt (the limb gives way to a map neatline). A left place index (grouped by country) swaps in place to the gallery of up to 5 scenery photos with place name, country, coordinates and dates; choosing a place swings a vermilion alidade to it. On phones the globe holds the top band and the gallery is a peek sheet that expands to full screen. Photos open in a lightbox.
4. **Footer** — contact plate (email, GitHub, LinkedIn) and data/type credits.

## Data

- `public/travel-data.json` — generated from Photos library export, fetched at runtime (do not hand-edit).
- `public/photos/<slug>/…` — web-optimized (1600px JPEG, EXIF-stripped) scenery photos, ≤5 per location.
- Work content lives in `src/data/work.ts` — sourced from resume (May 2026).

## Hard constraints

- No photos that are clearly *of* a person — big faces, posed groups, subject-sized figures (enforced by Vision face sizes + YOLO person-box sizes during export). Incidental distant people in scenery are allowed.
- Photos are EXIF-stripped before publishing (no GPS leakage beyond the deliberate city-level pings).
