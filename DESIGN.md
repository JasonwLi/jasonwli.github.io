---
name: jasonli.world
description: One working Renaissance astrolabe; the painted globe is its sphere, every section a plate of it.
colors:
  steel: "oklch(0.225 0.088 260)"
  steel-deep: "oklch(0.185 0.072 262)"
  steel-field: "oklch(0.26 0.088 258)"
  steel-raised: "oklch(0.288 0.082 257)"
  incise: "oklch(0.125 0.04 264)"
  gilt: "oklch(0.8 0.115 84)"
  gilt-2: "oklch(0.66 0.095 80)"
  gilt-worn: "oklch(0.45 0.06 75)"
  silver: "oklch(0.92 0.008 250)"
  silver-2: "oklch(0.78 0.014 252)"
  silver-3: "oklch(0.66 0.018 255)"
  vermilion: "oklch(0.64 0.205 33)"
  vermilion-hi: "oklch(0.7 0.18 36)"
  line: "oklch(0.38 0.058 257)"
  rule: "oklch(0.46 0.048 256)"
  focus: "oklch(0.86 0.13 86)"
  selection-bg: "oklch(0.4 0.075 256)"
  label-land: "oklch(0.26 0.04 60)"
  label-sea: "oklch(0.85 0.03 230)"
typography:
  display:
    fontFamily: "'Castoro Titling', 'Castoro Titling Fallback', Georgia, serif"
    fontSize: "clamp(2.875rem, 5.9vw, 5.25rem)"
    fontWeight: 400
    lineHeight: 0.95
    letterSpacing: "0.06em"
  headline:
    fontFamily: "'Castoro Titling', 'Castoro Titling Fallback', Georgia, serif"
    fontSize: "30px"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "0.14em"
  title:
    fontFamily: "'Castoro', 'Castoro Fallback', 'Iowan Old Style', Georgia, serif"
    fontSize: "30px"
    fontWeight: 400
    lineHeight: 1.1
  body:
    fontFamily: "'Castoro', 'Castoro Fallback', 'Iowan Old Style', Georgia, serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.62
    fontFeature: "'onum' 1, 'pnum' 1"
  data:
    fontFamily: "'Castoro', 'Castoro Fallback', 'Iowan Old Style', Georgia, serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.02em"
    fontFeature: "'lnum' 1"
  label:
    fontFamily: "'Castoro Titling', 'Castoro Titling Fallback', Georgia, serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "0.18em"
rounded:
  none: "0px"
  hairline: "1px"
spacing:
  cut: "1px"
  tick-minor: "4px"
  tick-mid: "7px"
  tick-major: "11px"
  tick-pitch: "6px"
  sm: "8px"
  md: "16px"
  lg: "32px"
  xl: "48px"
  target: "44px"
  gutter: "clamp(24px, 6.667vw, 96px)"
components:
  nav-link:
    textColor: "{colors.silver-2}"
    typography: "{typography.label}"
    height: "44px"
    width: "88px"
  nav-link-current:
    textColor: "{colors.silver}"
  contact-button:
    textColor: "{colors.silver-2}"
    typography: "{typography.label}"
    height: "44px"
  contact-button-hover:
    textColor: "{colors.silver}"
  icon-button:
    textColor: "{colors.silver-2}"
    size: "44px"
  icon-button-hover:
    textColor: "{colors.silver}"
  text-button:
    textColor: "{colors.silver-2}"
    height: "44px"
  place-row:
    textColor: "{colors.silver}"
    height: "36px"
    padding: "0 8px 0 0"
  place-row-hover:
    backgroundColor: "{colors.steel-raised}"
  map-mode-option:
    textColor: "{colors.silver-3}"
    typography: "{typography.label}"
    height: "44px"
  map-mode-option-selected:
    textColor: "{colors.silver}"
  photo-frame:
    backgroundColor: "{colors.steel-deep}"
    rounded: "{rounded.hairline}"
    padding: "3px"
  gallery-sheet:
    backgroundColor: "{colors.steel-field}"
    padding: "0 16px"
  footer-plate-phone:
    backgroundColor: "{colors.steel-deep}"
    padding: "24px 16px 48px"
---

# Design System: jasonli.world

## Overview

**Creative North Star: "The Astrolabe"**

The page is one working Renaissance instrument. A heat-blued steel field owns every pixel of ground; the painted terrain globe is the instrument's sphere, held inside an engraved degree limb that turns with it; each section (the name crest, the work gazetteer, the globe with its place index, the contact plate) is a plate of the same instrument. Fire-gilt brass appears only where a craftsman would cut it: hairlines, degree scales, tick marks, one crest filigree and the engraved capitals of the name. Every word a person reads is silver. Vermilion is reserved for the one active place: the alidade blade that swings to it, the star-pointer in the index, the active pin core.

Density is low and deliberate. The steel is flat (no gradient, noise, sheen, vignette, glass or glow anywhere in the DOM), and depth comes from engraving, not lighting: every cut is a flat line laid over a darker incise groove offset half a pixel toward the lower right, as if lit from the upper left. The globe follows the same single upper-left key light. The world refuses parchment-and-blackletter pastiche and gilt game-menu bevels; it is an instrument, not a costume.

The globe itself is EU4-painterly: a sea continuing the steel family (OKLab L about 0.34, hue 240-250), land painted from a fixed biome palette under a hard luminance cap, with region names lettered on the map, monuments, rivers and trees appearing with zoom, and a Terrain / Climate map mode switch.

**Key Characteristics:**
- Flat heat-blued steel ground; tonal steel steps, never shadows, separate surfaces.
- Gilt is line, never fill and never running text (the hero name's engraved capitals are the one text exception).
- Silver for all reading text in three steps; vermilion for the single active place only.
- One type family, Castoro, in two cuts (Titling capitals and text), regular weight only.
- Engraved draw-on motion: scales and cuts draw along their own path with a burin ease.
- Square corners; 44px touch targets; underlined text links, never colour-change links.

## Colors

A Restrained, steel-dominant palette: one cool field in five tonal steps, a brass line family, a three-step silver text family, and a single hot accent with a single job.

### Primary
- **Fire-Gilt Brass** (gilt): degree-scale numerals and majors, cut hairlines under headings, the crest filigree, the hero name's capitals, the index triangles on nav and map-mode scales, the focus-adjacent caret. Never body text.
- **Tempered Brass** (gilt-2): minor ticks, fillet ticks hanging from work rows, pin rings, control boundaries.
- **Worn Brass** (gilt-worn): long rules at rest, the work table's double rule and row fillets, the graticule, the phone sheet's top edge. Decorative only; never text.

### Secondary
- **Vermilion** (vermilion): the alidade blade and its cut, the index star-pointer, the active pin core. Nothing else on the page.
- **Hot Vermilion** (vermilion-hi): pressed or hovered state of the active row only.

### Neutral
- **Heat-Blued Steel** (steel): page ground, the astrolabe's mater face, theme-color, scrollbar track.
- **Deep Steel** (steel-deep): lightbox scrim (97%), photo plate behind loading images, pin cores, the phone contact plate.
- **Field Steel** (steel-field): the travel column plate (fades in only when the globe leaves its free area), the phone gallery sheet, the loading sphere.
- **Raised Steel** (steel-raised): flat hover fill for place-index rows and legend rows.
- **Incise** (incise): the groove wall under every cut, text halos over the painted globe. Never a surface.
- **Silver** (silver): body, names, headings, current nav item.
- **Silver Two** (silver-2): data lines, roles, meta, nav and controls at rest.
- **Silver Three** (silver-3): counts, hints, credits, dotted leaders, link underlines at rest.
- **Steel Line** (line): work and index separators, photo frames, gallery head and foot rules.
- **Steel Rule** (rule): dividers that bound UI regions.
- **Focus Gilt** (focus): the 1.5px keyboard focus ring.
- **Tempered Selection** (selection-bg): text selection, deliberately neither gilt nor vermilion.
- **Umber Ink / Sea Ink** (label-land, label-sea): map lettering on the globe; umber caps for ranges and deserts on land, pale italic for seas and oceans.

### Named Rules
**The One Active Place Rule.** Vermilion marks the single place currently chosen, and nothing else. No vermilion on hover, decoration, links or emphasis.

**The Brass Is Cut Rule.** Gilt appears only as a stroke (hairline, tick, numeral, filigree) or the engraved name. It never fills a surface and never sets a sentence.

**The Silver Reads Rule.** If a person reads it, it is silver, silver-2 or silver-3; every pair is checked against WCAG by `scripts/check-contrast.mjs`.

**The Twin Token Rule.** `src/styles/tokens.css` (OKLCH) is the DOM source and `src/theme/tokens.ts` (sRGB hex) is its three.js twin; they agree within 1 LSB (`scripts/check-tokens.mjs`). Globe-only paint (sea ramp, snow, monument tones) lives in `src/three/terrain/look.ts`, the land albedo in `scripts/terrain/palette.json`, the Köppen classes in `src/data/koppen-palette.json`.

**The Painted Land Cap Rule.** Painted land never exceeds OKLab L 0.66 after lighting in either map mode (snow and ice cap at 0.86), so silver lettering and gilt scales always outrank the paint.

## Typography

**Display Font:** Castoro Titling (with metric-matched Georgia fallback)
**Body Font:** Castoro (with metric-matched Georgia fallback, then Iowan Old Style)

**Character:** A single Renaissance-rooted family: Titling's spaced capitals do the engraving (name, section headings, nav, labels, scale numerals); the text cut, with its italic, carries everything read. Self-hosted via fontsource, preloaded, `font-display: swap`, with size-adjusted fallbacks so the swap does not shift layout.

### Hierarchy
- **Display** (400, clamp(2.875rem, 5.9vw, 5.25rem), 0.95, tracked 0.06em): the hero name only, in gilt, with a 0.75px incise groove above it.
- **Headline** (400, 30px, 1.1, tracked 0.14em; 24px / 0.12em on phones): section headings in silver capitals, each sitting on one engraved rule. Nothing above them.
- **Title** (400, 30px text cut, 1.1; 26px in the phone sheet): the open place name in the gallery. Work company names step down to 24px (21px phones) with the role beside them in italic silver-2.
- **Body** (400, 1.0625rem, 1.62, old-style proportional figures, max 68ch): running text, work summaries (60ch), the hero tagline at 20px / 1.5.
- **Data** (400, 0.875rem, 1.4, tracked 0.02em, lining figures): periods, coordinates, stats, counters in silver-2. Castoro has no tabular figures, so live readouts wrap each digit at a fixed 0.6em advance.
- **Label** (400, 12px Titling caps, tracked 0.16-0.18em): nav words, contact actions, map-mode options, place-index country groups. Tracking trails the last capital, so labels are re-centred by half the tracking.

### Named Rules
**The One Weight Rule.** Regular weight only, with `font-synthesis: none`. Hierarchy comes from cut (Titling vs text), size, tracking, italic and silver step; never bold.

**The Two Figures Rule.** Prose sets old-style figures; data sets lining figures.

## Layout

A single scrolling page over one fixed globe canvas. Content sits on a page gutter of clamp(24px, 6.667vw, 96px) (16px on phones). The hero places the crest, name and tagline upper-left and gives the globe, inside its degree limb, the right two-thirds. The work gazetteer is a 720px-max table with a 176px date column and a 32px gap. The travel section is a full-height two-column grid: a clamp(360px, 30vw, 432px) left column (heading, stats, map-mode scale, a scrolling place index that swaps in-place to the gallery) and the globe in the remaining field. The footer contact plate stays left of the dimmed globe at min(720px, 32vw).

Breakpoint at 860px: the globe takes the top 52% band and no text ever sits on it. The travel column, the gallery (as a peek sheet from 52svh that expands to full screen), and the contact plate (flat steel-deep) all start below that band. Work rows collapse to one column with the date line inline. Every interactive target is at least 44px (place rows grow from 36px to 44px on phones).

Spacing follows the instrument's scale module: 1px cuts; ticks of 4, 7 and 11px on a 6px pitch shared by the limb, nav ruler, map-mode scale and neatline; then 8 / 16 / 24 / 32 / 48px for padding and gaps, with generous vertical breathing (18vh before the work, 20vh before the footer).

## Elevation & Depth

Flat. There are no box shadows on any surface. Surfaces separate by tonal steel steps (steel, steel-field, steel-deep, steel-raised) and by hairline rules. Depth is engraved rather than lit: each cut line is drawn twice, a flat incise groove offset (-0.5px, -0.5px) under the flat brass or silver stroke, implying one upper-left light that the globe's shading also uses. Text over the painted globe is held by a paint-order incise halo (stroke under fill), not a blur. The keyboard focus ring adds a 1px incise outer ring so it holds over paint and photographs.

### Named Rules
**The Engraved Not Lit Rule.** A line gains depth only from its incise groove. No drop shadows, glows, bevels, gradients or blur under UI.

**The One Light Rule.** Light comes from the upper left everywhere: the incise offset, the globe's relief, the monument faces.

## Shapes

Square. Corners are 0px everywhere a surface exists; 1px appears only on photo frames and the focus ring to soften the hairline join. Containers are defined by 1px rules, never by filled cards or pills. The recurring forms are the instrument's own: the circular degree limb with radial Titling numerals, straight engraved rulers with tick ladders and a sliding triangular index, the work table's fine double rule with fillet ticks hanging from each row, and photographs mounted in a 3px passe-partout inside a 1px steel line. Icons are drawn on small grids (16, 22px) as 1.25px non-scaling strokes over the same groove.

## Components

### Navigation
- **Style:** an engraved ruler fixed top-right: a tick ladder with three Titling words (Work, Travel, Contact) hanging over major ticks, and a gilt triangular fiducial that slides to the current section.
- **States:** silver-2 at rest; silver for hover and current, whose major tick grows from 11px to 15px. Over the painted globe in deep zoom the words take an incise halo.
- **Phones:** same ruler, 72px stations, 11px labels.

### Buttons
- **Shape:** square, unfilled, no border (0px).
- **Icon buttons:** 44px square, silver-2 strokes over a groove; hover silver; press nudges 0.5px down for 80ms; disabled silver-3.
- **Contact actions:** icon plus 12px tracked Titling label, 44px tall, silver-2 to silver on hover. On phones they stack full width at 52px, separated by steel lines.
- **Text buttons and links:** underlined with a 1px silver-3 rule at a 3px offset; hover brightens the text and underline to silver. Links never turn gilt.

### Place Index
- **Rows:** 36px (44px phones), silver name, a dotted silver-3 leader that appears on hover, a silver-3 count right-aligned, an en-rule for places without photos (name dimmed to silver-2).
- **Hover / focus:** flat steel-raised fill; no border shift.
- **Active:** the vermilion star-pointer sets into the 16px gutter with a 120ms scale-in.
- **Groups:** 12px tracked Titling country label with a count, ruled off by a steel line.

### Map Mode Scale
- **Style:** two 44px Titling options (Terrain, Climate) standing over a short engraved ruler; the gilt index triangle slides to the selected option. Selected silver, rest silver-3, hover silver-2. Choosing Climate opens a 150px Köppen legend beneath it.

### Gallery and Photographs
- **Desktop:** opens in place inside the travel column: a back control, the place name (Title), italic country and data line, then a vertical stack of framed photographs with prev / next place controls at the foot.
- **Phones:** a peek sheet on steel-field with a worn-brass top edge and a 36px silver-3 handle rule; dragging or scrolling expands it to full screen (420ms quart ease).
- **Photo frame:** 3px passe-partout, 1px steel line (silver-3 on hover), steel-deep plate behind a blurred placeholder that cross-fades to the full image.
- **Lightbox:** 97% deep-steel scrim, the photo in a 4px mat and 1px line, caption bar below in silver-2 with the place in italic silver.

### The Instrument (signature)
The degree limb rings the globe and turns with it: gilt numerals radially set in Titling with an incise halo, a meridian readout above. When a place is chosen, a vermilion alidade swings to it and a silver readout (name, coordinates, dates) is set beside the blade. At deep zoom the limb gives way to a rectangular neatline with graticule numerals on its edges, framing the painted map. Scales and cuts engrave in along their own paths (900ms burin ease) on arrival; under reduced motion every piece is already cut.

## Do's and Don'ts

### Do:
- **Do** keep every surface flat steel and separate surfaces with a tonal step or a 1px line.
- **Do** draw brass as strokes over an incise groove offset (-0.5px, -0.5px), lit from the upper left.
- **Do** set every readable word in silver, silver-2 or silver-3, regular weight, from the Castoro family.
- **Do** reserve vermilion for the single active place (alidade, star-pointer, active pin).
- **Do** use the shared tick module (4 / 7 / 11px on a 6px pitch) for any new scale, ruler or control boundary.
- **Do** give every control a 44px target and use the shared 1.5px focus-gilt ring with a 3px offset.
- **Do** add a globe colour in both `tokens.css` and `tokens.ts` (or in `look.ts` / `palette.json` if it is paint only) and keep painted land under OKLab L 0.66.

### Don't:
- **Don't** fill a surface with gilt or set running text in gilt; the hero name is the one engraved-capitals exception.
- **Don't** use gradients, noise, sheen, vignettes, glass, glows, bevels or drop shadows anywhere in the DOM, and no atmosphere, rim glow or specular glint on the globe.
- **Don't** use pills, rounded cards or side-stripe accents; corners stay square.
- **Don't** put a kicker, eyebrow or section number above a heading; a section heading is one ruled line with nothing above it.
- **Don't** use bold or synthesized weights; Castoro ships regular and italic only.
- **Don't** turn links gilt or vermilion on hover; links change their underline and silver step only.
- **Don't** let text sit on the globe band on phones; content starts below the 52% band.
- **Don't** drift toward parchment, blackletter, beige or cream grounds, or gilt game-menu chrome.
