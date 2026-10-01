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

/** emphasis[i]: part i is the active place's legs (full strength) rather than the faint base course */
export const drawnRoute: { parts: DrawnRoutePart[]; emphasis: boolean[]; mounted: boolean } = { parts: [], emphasis: [], mounted: false }

/**
 * Landmark glyph boxes placed by LandmarkGlyphs' last declutter pass (C5 request:
 * glyphs as declutter obstacles in the 1600–2500 km overlap): packed [cx, cy] centres in
 * CSS px, each a GLYPH_BOX_PX square. Empty while the glyphs are hidden.
 */
export const GLYPH_BOX_PX = 26
export const glyphBoxes: number[] = []

/**
 * The 3D monuments drawn this frame (Monuments, wide-view miniatures and close zoom):
 * packed [x0, y0, x1, y1] CSS px per drawn form (a landmark's extra parts get their own
 * box), from the projected base and top widened by half the form's width. Region and
 * place names and the 2D glyphs keep off them. A monument dimmed under its hovered or
 * active pin is left out (the active place's name wins).
 */
export const monumentBoxes: number[] = []

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
