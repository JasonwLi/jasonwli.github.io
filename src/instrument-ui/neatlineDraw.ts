/**
 * Neatline rendering (T1c) from I1's registration data (anchors.neatline): the
 * deep-zoom frame that replaces the limb once the disc overflows the free area.
 *
 *   frame    two hairlines 4 px apart inset 8 px inside the free area (--gilt
 *            outer, --gilt-worn inner), each a path from the top-left corner
 *            clockwise so the draw-on runs the way the theme cuts it
 *   ticks    hang inward from the inner hairline where the true graticule
 *            crosses the edge: majors 11 px, minors 4 px
 *   notches  6 px --gilt-2 marks where the Earth's limb leaves an edge (sky
 *            spans stay ungraduated)
 *   numerals longitude on the top edge, latitude on the left edge (majors only)
 *
 * Pure builders; the overlay rewrites the DOM only on camChanged frames.
 */
import type { FreeRect } from './readoutFit'

export const NEAT_INSET = 8
export const NEAT_GAP = 4
const MAJOR = 11
const MINOR = 4
const NOTCH = 6

const r2 = (v: number) => Math.round(v * 100) / 100

export function frameRects(F: FreeRect) {
  const o = { x0: F.x0 + NEAT_INSET, y0: F.y0 + NEAT_INSET, x1: F.x1 - NEAT_INSET, y1: F.y1 - NEAT_INSET }
  const i = { x0: o.x0 + NEAT_GAP, y0: o.y0 + NEAT_GAP, x1: o.x1 - NEAT_GAP, y1: o.y1 - NEAT_GAP }
  return { outer: o, inner: i }
}

/** a rect as one path from the top-left corner, clockwise */
export function rectPath(r: FreeRect): string {
  return `M${r2(r.x0)},${r2(r.y0)}H${r2(r.x1)}V${r2(r.y1)}H${r2(r.x0)}Z`
}

export interface NeatLabel {
  x: number
  y: number
  /** the number, set in Titling */
  num: string
  /** the hemisphere letter, set in Castoro */
  hemi: string
  edge: 'top' | 'left'
}

export interface NeatTicks {
  major: string
  minor: string
  notch: string
  labels: NeatLabel[]
}

/** '46°', '46°30′', '46°10′' : degrees and arc-minutes, absolute value */
export function fmtAngle(v: number, interval: number): string {
  const a = Math.abs(v)
  if (interval >= 1) return `${Math.round(a)}°`
  let d = Math.floor(a + 1e-6)
  let m = Math.round((a - d) * 60)
  if (m === 60) {
    d += 1
    m = 0
  }
  return m ? `${d}°${m}′` : `${d}°`
}

/** a pin's drawn outer radius (5.5 px) plus a 4 px gap */
const PIN_CLEAR = 9.5

function isMajor(v: number, interval: number): boolean {
  const k = v / interval
  return Math.abs(k - Math.round(k)) < 1e-3
}

/**
 * Build the tick paths and the numeral list. `avoid` is a screen x span (the
 * deep-zoom readout hanging from the top edge) that top-edge numerals must not sit
 * under; the nav no longer overlaps (the frame insets below it). `pins` is
 * globeState.pinsPx (x, y, visible, pick radius per place): a numeral whose box would
 * touch a visible pin near the frame is dropped, so pins never sit on the scale
 * numerals (finish review round 2).
 */
export function buildNeatTicks(
  edges: Float32Array,
  interval: number,
  notches: Float32Array,
  F: FreeRect,
  avoid: FreeRect | null,
  pins: Float32Array | null = null,
): NeatTicks {
  const { inner } = frameRects(F)
  let major = ''
  let minor = ''
  let notch = ''
  const labels: NeatLabel[] = []
  // numerals never crowd: a top label needs its own width (≈6.4 px per character at
  // 10 px Titling) plus 16 px of steel; a left label 22 px of height
  const room = (lab: NeatLabel) => {
    for (const o of labels) {
      if (o.edge !== lab.edge) continue
      if (lab.edge === 'top') {
        const need = ((o.num.length + lab.num.length + 4) * 6.4) / 2 + 16
        if (Math.abs(o.x - lab.x) < need) return false
      } else if (Math.abs(o.y - lab.y) < 22) return false
    }
    return true
  }
  // the numeral's box (as Overlay publishes it to neatGuard) against each visible pin's
  // drawn disc plus a 4 px gap
  const clearOfPins = (lab: NeatLabel) => {
    if (!pins) return true
    const w = (lab.num.length + (lab.hemi ? 2 : 0)) * 6.6 + 6
    const x0 = lab.edge === 'top' ? lab.x - w / 2 : lab.x - 3
    const x1 = x0 + w
    const y0 = lab.y - 9
    const y1 = lab.y + 9
    for (let p = 0; p + 3 < pins.length; p += 4) {
      if (pins[p + 2] < 0.1) continue
      const px = pins[p]
      const py = pins[p + 1]
      const dx = Math.max(x0 - px, 0, px - x1)
      const dy = Math.max(y0 - py, 0, py - y1)
      if (dx * dx + dy * dy < PIN_CLEAR * PIN_CLEAR) return false
    }
    return true
  }
  for (let i = 0; i + 3 < edges.length; i += 4) {
    const edge = edges[i]
    const along = edges[i + 1]
    const lat = edges[i + 2]
    const lon = edges[i + 3]
    const isLon = Number.isNaN(lat)
    const v = isLon ? lon : lat
    if (!Number.isFinite(v) || !Number.isFinite(along)) continue
    const mj = isMajor(v, interval)
    const len = mj ? MAJOR : MINOR
    let d: string
    if (edge === 0) {
      if (along < inner.x0 || along > inner.x1) continue
      d = `M${r2(along)},${r2(inner.y0)}V${r2(inner.y0 + len)}`
    } else if (edge === 2) {
      if (along < inner.x0 || along > inner.x1) continue
      d = `M${r2(along)},${r2(inner.y1)}V${r2(inner.y1 - len)}`
    } else if (edge === 1) {
      if (along < inner.y0 || along > inner.y1) continue
      d = `M${r2(inner.x1)},${r2(along)}H${r2(inner.x1 - len)}`
    } else {
      if (along < inner.y0 || along > inner.y1) continue
      d = `M${r2(inner.x0)},${r2(along)}H${r2(inner.x0 + len)}`
    }
    if (mj) major += d
    else minor += d
    // numerals: longitude on the top edge, latitude on the left edge
    if (mj && edge === 0 && isLon) {
      const y = inner.y0 + MAJOR + 9
      const underNav = avoid && along > avoid.x0 - 24 && along < avoid.x1 + 24 && y < avoid.y1 + 6
      // the corners belong to the left-edge latitude numerals (≈60 px wide) and the frame fillet
      const inCorner = along < inner.x0 + 64 || along > inner.x1 - 28
      const lab: NeatLabel = { x: along, y, num: fmtAngle(v, interval), hemi: v > 0 ? 'E' : v < 0 ? 'W' : '', edge: 'top' }
      if (!underNav && !inCorner && room(lab) && clearOfPins(lab)) labels.push(lab)
    } else if (mj && edge === 3 && !isLon) {
      const lab: NeatLabel = { x: inner.x0 + MAJOR + 5, y: along, num: fmtAngle(v, interval), hemi: v > 0 ? 'N' : v < 0 ? 'S' : '', edge: 'left' }
      // below the top edge's longitude numerals
      if (along > inner.y0 + MAJOR + 22 && room(lab) && clearOfPins(lab)) labels.push(lab)
    }
  }
  for (let i = 0; i + 1 < notches.length; i += 2) {
    const edge = notches[i]
    const along = notches[i + 1]
    if (edge === 0) notch += `M${r2(along)},${r2(inner.y0 - NEAT_GAP)}V${r2(inner.y0 + NOTCH)}`
    else if (edge === 2) notch += `M${r2(along)},${r2(inner.y1 + NEAT_GAP)}V${r2(inner.y1 - NOTCH)}`
    else if (edge === 1) notch += `M${r2(inner.x1 + NEAT_GAP)},${r2(along)}H${r2(inner.x1 - NOTCH)}`
    else notch += `M${r2(inner.x0 - NEAT_GAP)},${r2(along)}H${r2(inner.x0 + NOTCH)}`
  }
  return { major: major || 'M0,0', minor: minor || 'M0,0', notch: notch || 'M0,0', labels }
}

/**
 * The active place in the neatline: vermilion ticks at its x on the top and
 * bottom edges and its y on the left and right edges (the meridian and parallel
 * through the place, which run square to the frame at this scale). Off frame the
 * marks clamp to the frame.
 */
export function activeMarks(px: number, py: number, F: FreeRect): string {
  const { inner } = frameRects(F)
  const x = Math.min(inner.x1, Math.max(inner.x0, px))
  const y = Math.min(inner.y1, Math.max(inner.y0, py))
  return (
    `M${r2(x)},${r2(inner.y0 - NEAT_GAP)}V${r2(inner.y0 + MAJOR)}` +
    `M${r2(x)},${r2(inner.y1 + NEAT_GAP)}V${r2(inner.y1 - MAJOR)}` +
    `M${r2(inner.x0 - NEAT_GAP)},${r2(y)}H${r2(inner.x0 + MAJOR)}` +
    `M${r2(inner.x1 + NEAT_GAP)},${r2(y)}H${r2(inner.x1 - MAJOR)}`
  )
}
