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

Single scrolling page, one continuous 3D scene:

1. **Hero** — planetarium: luminous dot-matrix globe with glowing pings, name + role overlaid.
2. **Flight log (work)** — expedition-log timeline of roles + selected projects. Globe recedes/dims behind it.
3. **The globe (travel)** — full-viewport interactive globe: drag to rotate, click a ping → camera flies there → gallery of up to 5 scenery photos + place name, country, dates. Location index for direct navigation.
4. **Footer** — email, GitHub, LinkedIn.

## Data

- `public/travel-data.json` — generated from Photos library export, fetched at runtime (do not hand-edit).
- `public/photos/<slug>/…` — web-optimized (1600px JPEG, EXIF-stripped) scenery photos, ≤5 per location.
- Work content lives in `src/data/work.ts` — sourced from resume (May 2026).

## Hard constraints

- No photos that are clearly *of* a person — big faces, posed groups, subject-sized figures (enforced by Vision face sizes + YOLO person-box sizes during export). Incidental distant people in scenery are allowed.
- Photos are EXIF-stripped before publishing (no GPS leakage beyond the deliberate city-level pings).
