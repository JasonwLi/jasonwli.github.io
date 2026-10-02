/**
 * The route legs RouteLine actually draws this frame (INT route restraint), shared with
 * the label declutter so region names only yield to visible legs.
 *
 * Kept outside RouteLine.tsx so the labels chunk can read it without importing the
 * lazy route chunk (Line2 shaders). RouteLine republishes the parts every frame;
 * `pos` holds 6 floats per segment (globe-local, lifted), `fade` 2 per segment
 * (the per-endpoint alpha factor, 0 = not drawn), and only the first `count`
 * segments are drawn (draw-on).
 */
export interface DrawnRoutePart {
  pos: Float32Array
  fade: Float32Array
  count: number
}

/**
 * Per leg (a great circle from locations[from] to locations[from + 1], first-visit order) the
 * restraint state RouteLine drew it with this frame: `w` the damped leg weight (0 = not drawn),
 * `stubMix` 0..1 how far a long leg has shrunk to a stub at each end, `active` whether it touches
 * the active place (then it is also drawn full-strength as the overlay, stubbed at stubActiveKm).
 * The ships (ships/Ships.tsx) sail only where routeFadeAt() says the course line is drawn.
 */
export interface DrawnLeg {
  from: number
  km: number
  w: number
  stubMix: number
  active: boolean
}

/** emphasis[i]: part i is the active place's legs (full strength) rather than the faint base course */
export const drawnRoute: {
  parts: DrawnRoutePart[]
  emphasis: boolean[]
  mounted: boolean
  /** per leg restraint state (RouteLine order: zero-length legs skipped) */
  legs: DrawnLeg[]
  /** the route's opacity this frame (anchors.routeOpacity, 0 while hidden) */
  opacity: number
  /** the hero draw-on has finished */
  drawn: boolean
  stubKm: number
  stubActiveKm: number
} = { parts: [], emphasis: [], mounted: false, legs: [], opacity: 0, drawn: false, stubKm: 1200, stubActiveKm: 2400 }

function smooth01(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** The stub factor at leg parameter t (0..1): 1 near the ends, 0 past stubKm from both (RouteLine's rule). */
export function stubFade(t: number, km: number, stubMix: number, stubKm: number): number {
  if (stubMix <= 0) return 1
  const fromEnd = Math.min(t, 1 - t) * km
  const stub = 1 - smooth01(0.5 * stubKm, stubKm, fromEnd)
  return 1 + (stub - 1) * stubMix
}

/** How strongly the course line is drawn at parameter t of a leg (0..1, before the route opacity). */
export function routeFadeAt(leg: DrawnLeg, t: number): number {
  let f = leg.w * stubFade(t, leg.km, leg.stubMix, drawnRoute.stubKm)
  if (leg.active) f = Math.max(f, stubFade(t, leg.km, leg.stubMix, drawnRoute.stubActiveKm))
  return f
}

/**
 * Landmark glyph boxes placed by LandmarkGlyphs' last declutter pass (C5 request:
 * glyphs as declutter obstacles in the 1600–2500 km overlap): packed [cx, cy] centres in
 * CSS px, each a GLYPH_BOX_PX square. Empty while the glyphs are hidden.
 */
export const GLYPH_BOX_PX = 26
export const glyphBoxes: number[] = []
/**
 * Per glyph box (same order as glyphBoxes, one entry per [cx, cy] pair): the landmark's own
 * place (landmarks.ts near_place as a locations index, -1 none). The active place's town wins
 * over its own landmark's glyph (towns/Towns.tsx, One Active Place).
 */
export const glyphPlaces: number[] = []

/**
 * The 3D monuments drawn this frame (Monuments, wide-view miniatures and close zoom):
 * packed [x0, y0, x1, y1] CSS px per drawn form (a landmark's extra parts get their own
 * box), from the projected base and top widened by half the form's width. Region and
 * place names and the 2D glyphs keep off them. A monument dimmed under its hovered or
 * active pin is left out (the active place's name wins).
 */
export const monumentBoxes: number[] = []

/**
 * Every 3D monument drawn this frame, the ones dimmed under their hovered / active pin
 * included: packed [x0, y0, x1, y1, place] (CSS px, then the landmark's own place as a
 * locations index, -1 none). The town miniatures yield to all of them (towns/Towns.tsx:
 * the monument wins), except that the ACTIVE place's own town wins over its own (dimmed)
 * monument (One Active Place).
 */
export const monumentFootprints: number[] = []

/**
 * The town miniatures drawn this frame (towns/Towns.tsx): packed [x0, y0, x1, y1] CSS px
 * per town. Region and place names keep off them; the ships too.
 */
export const townBoxes: number[] = []

/**
 * Per place (locations order), how far its drawn town reaches right of / left of the pin
 * in CSS px: [right, left] pairs, 0 without a town. The place's name sets beside its own
 * town rather than on it.
 */
export const townLabelReach: number[] = []

/**
 * The ships drawn this frame (ships/Ships.tsx): packed [cx, cy, r] CSS px per ship (the hull's
 * waterline point and a radius covering hull and sails). The portolan rhumb lines yield
 * under them (portolan/Portolan.tsx).
 */
export const shipMarks: number[] = []

/**
 * The portolan wind roses drawn this frame (portolan/Portolan.tsx): packed [cx, cy, r] CSS px
 * per rose on the near side (r covers the ring and the north mark). The cloud wisps keep off
 * them (life/Life.tsx).
 */
export const roseMarks: number[] = []

/**
 * The region / sea names MapLabels placed in its last declutter pass: packed [x0, y0, x1, y1]
 * CSS px (padded rects). Empty while the names are hidden. The painted cloud wisps keep off
 * them (life/Life.tsx); the place names' rects are labels/declutter placeRects.
 */
export const mapLabelRects: number[] = []

/**
 * The instrument readout's box (T1c overlay, CSS px) while it is shown: region and
 * place names yield to it (at deep zoom it hangs over the paint from the top edge).
 */
export const readoutBox = { on: false, x0: 0, y0: 0, x1: 0, y1: 0 }

/**
 * The deep-zoom neatline (T1c overlay, CSS px) while it is drawn (finish review: names
 * clipped at the plate edge and sat on the scale numerals). `x0..y1` is the paint the
 * names may use: inside the inner frame hairline and clear of the hanging major ticks;
 * `boxes` packs [x0, y0, x1, y1] for every drawn scale numeral (obstacles).
 */
export const neatGuard = { on: false, x0: 0, y0: 0, x1: 0, y1: 0, boxes: [] as number[] }
