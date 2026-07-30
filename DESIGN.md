# DESIGN.md

## Scene sentence

A visitor opens this at night: a hand-made Earth hangs sunlit in a dark room — geographically true continents cast in burnished sand over ink-blue ocean, shallow water glowing at the coasts, a faint etched graticule — and every place Jason has stood burns as a small coral ember with its name written beside it like an atlas plate.

## Aesthetic lane (named)

**Gilded atlas × field journal.** A bespoke globe: world-atlas landmass mask rendered by our own shader (sand land + paper grain, ink ocean + coastal shelf glow, etched graticule, soft sun + cool rim). References: antique gilt globes, National Geographic plates. Anti-references: photoreal NASA textures (too generic), cyan-SaaS-globe, dot-matrix globes.

## Color — Committed strategy (deep-space room, the planet carries the color)

OKLCH only. The Earth texture supplies blue/green/sand; UI stays a quiet night-blue with sunlit-sand accents.

```css
--bg:      oklch(0.14 0.02 255);   /* deep-space night blue */
--surface: oklch(0.18 0.018 250);  /* panels, cards */
--line:    oklch(0.30 0.02 250);   /* hairlines, rules */
--ink:     oklch(0.94 0.008 85);   /* warm paper white, ≥7:1 */
--muted:   oklch(0.70 0.015 250);  /* secondary text */
--brass:   oklch(0.80 0.09 85);    /* sunlit sand — accents, hovers */
--brass-text: oklch(0.76 0.08 85); /* sand for running text */
--ember:   oklch(0.66 0.19 35);    /* coral — travel pings */
```

The token names keep their planetarium-era spelling (--brass) so the cascade stays stable; the values are the atlas palette.

## Typography

- **Display / structure:** Bricolage Grotesque (variable). Headings 700–800, tight but ≥ -0.03em. Hero clamp max 6rem.
- **Cartographic voice:** EB Garamond *italic* — place names, geographic labels only (the atlas-label convention: rivers and regions set in italic serif). Never body copy.
- **Instrument readouts:** Fragment Mono — coordinates, dates, counts. Small doses.
- Body: Bricolage Grotesque 400 at 1rem/1.65, measure ≤ 70ch. `text-wrap: balance` on headings.

## Motion

- Hero moment (the ONE): on load, the planet settles into place — a slow damped yaw/pitch arrival, once. Clouds drift continuously.
- Scroll: Lenis; globe camera/position driven by scroll progress between sections.
- Ping click: quaternion slerp fly-to ~900ms ease-out-quint; gallery panel slides in, photos stagger 60ms.
- Micro: 120–250ms, ease-out-quart. No bounce, no elastic.
- `prefers-reduced-motion`: no assembly (dots start placed), no auto-rotate, crossfades only, instant fly-to.

## Bans in force (project-specific)

- No tiny uppercase tracked eyebrow above sections; section voice = Garamond italic geographic labels instead.
- No identical card grids in the work log — it's a flight-log table rhythm.
- No gradient text, no glassmorphism-by-default, no side-stripe borders.
