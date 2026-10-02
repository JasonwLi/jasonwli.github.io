/**
 * Screen-space declutter shared by MapLabels and PlaceLabels (C4).
 *
 * A 48 px bucket grid holds axis-aligned rects (placed labels) and line segments
 * (route legs, the alidade). Region names treat a 24 px exclusion around every visible
 * pin, the route polyline and the alidade hairline as pre-placed (theme: "labels yield
 * within 24 px of any pin, the route or the alidade"); place labels claim their rects
 * first and MapLabels reads them through `placeRects`.
 *
 * Route obstacles are the segments RouteLine actually draws this frame
 * (instrument/screenObstacles.ts: lifted positions, per-endpoint restraint fades and the
 * draw-on count), so names only yield to visible legs.
 */
import * as THREE from 'three'
import { globeState } from '../globeState'
import { GLYPH_BOX_PX, drawnRoute, glyphBoxes, monumentBoxes, neatGuard, readoutBox, townBoxes } from '../instrument/screenObstacles'
import { instrumentLayout } from '../instrument/anchors'

/** route segments fainter than this at both ends are not obstacles */
const ROUTE_MIN_FADE = 0.25

export const CELL = 48
/** Labels keep clear of the fixed nav ruler band at the top (theme: globe region starts at y 72). */
export const TOP_INSET = 72
/** Largest clearance any query may ask for (bucket inflation). */
export const MAX_CLEAR = 24
export type ObstacleKind = 0 | 1 | 2 | 3
/**
 * Clearance in px per obstacle kind [pin, route (the active place's legs), alidade,
 * faint route (the quiet base course)]; negative = ignore that kind.
 */
export type Clearance = readonly [number, number, number, number]

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * The screen rect every name must sit wholly inside: the instrument's free rect below the
 * nav band, and inside the neatline's inner frame (clear of its hanging ticks) while the
 * deep-zoom frame is drawn, so nothing clips at the plate edge (finish review).
 */
export function labelBounds(out: Rect): Rect {
  const f = instrumentLayout.free
  out.x0 = f.x0
  out.y0 = Math.max(f.y0, TOP_INSET)
  out.x1 = f.x1
  out.y1 = f.y1
  if (neatGuard.on) {
    out.x0 = Math.max(out.x0, neatGuard.x0)
    out.y0 = Math.max(out.y0, neatGuard.y0)
    out.x1 = Math.min(out.x1, neatGuard.x1)
    out.y1 = Math.min(out.y1, neatGuard.y1)
  }
  return out
}

/** Rects placed by PlaceLabels in the last pass (MapLabels avoids them). */
export const placeRects: Rect[] = []

// ---------------------------------------------------------------- projection

const _w = new THREE.Vector3()
const _c = new THREE.Vector3()
const _cam = new THREE.Vector3()

/**
 * Project a globe-local point to CSS px (canvas-relative, lens shift included).
 * Returns the facing cosine of the point (normal · to-camera) in `out[2]`.
 */
export function projectLocal(
  p: THREE.Vector3,
  inner: THREE.Object3D,
  camera: THREE.Camera,
  out: Float32Array | number[],
): void {
  _w.copy(p).applyMatrix4(inner.matrixWorld)
  _c.setFromMatrixPosition(inner.matrixWorld)
  _cam.setFromMatrixPosition(camera.matrixWorld)
  const nx = _w.x - _c.x
  const ny = _w.y - _c.y
  const nz = _w.z - _c.z
  const nl = Math.hypot(nx, ny, nz) || 1
  const tx = _cam.x - _w.x
  const ty = _cam.y - _w.y
  const tz = _cam.z - _w.z
  const tl = Math.hypot(tx, ty, tz) || 1
  out[2] = (nx * tx + ny * ty + nz * tz) / (nl * tl)
  _w.project(camera)
  const vp = globeState.viewport
  out[0] = ((_w.x + 1) / 2) * vp.w
  out[1] = ((1 - _w.y) / 2) * vp.h
}

// ---------------------------------------------------------------- bucket grid

export class Occupancy {
  private cols = 1
  private rows = 1
  private rects: Rect[][] = []
  private segs: number[][] = [] // 4 floats per segment, per cell

  reset(w: number, h: number): void {
    this.cols = Math.max(1, Math.ceil(w / CELL))
    this.rows = Math.max(1, Math.ceil(h / CELL))
    const n = this.cols * this.rows
    if (this.rects.length !== n) {
      this.rects = Array.from({ length: n }, () => [])
      this.segs = Array.from({ length: n }, () => [])
    } else {
      for (let i = 0; i < n; i++) {
        this.rects[i].length = 0
        this.segs[i].length = 0
      }
    }
  }

  private range(x0: number, y0: number, x1: number, y1: number): [number, number, number, number] | null {
    const c0 = Math.max(0, Math.floor(x0 / CELL))
    const r0 = Math.max(0, Math.floor(y0 / CELL))
    const c1 = Math.min(this.cols - 1, Math.floor(x1 / CELL))
    const r1 = Math.min(this.rows - 1, Math.floor(y1 / CELL))
    if (c1 < c0 || r1 < r0) return null
    return [c0, r0, c1, r1]
  }

  addRect(r: Rect): void {
    const g = this.range(r.x0, r.y0, r.x1, r.y1)
    if (!g) return
    for (let y = g[1]; y <= g[3]; y++) for (let x = g[0]; x <= g[2]; x++) this.rects[y * this.cols + x].push(r)
  }

  /**
   * A line obstacle of a kind (0 pin point, 1 route, 2 alidade), bucketed by its bbox
   * inflated by MAX_CLEAR; the clearance is chosen per query (see hits()).
   */
  addSegment(ax: number, ay: number, bx: number, by: number, kind: ObstacleKind): void {
    const g = this.range(
      Math.min(ax, bx) - MAX_CLEAR,
      Math.min(ay, by) - MAX_CLEAR,
      Math.max(ax, bx) + MAX_CLEAR,
      Math.max(ay, by) + MAX_CLEAR,
    )
    if (!g) return
    for (let y = g[1]; y <= g[3]; y++)
      for (let x = g[0]; x <= g[2]; x++) this.segs[y * this.cols + x].push(ax, ay, bx, by, kind)
  }

  /** A pin (kind 0). */
  addPoint(x: number, y: number): void {
    this.addSegment(x, y, x, y, 0)
  }

  /** Does the rect overlap a placed rect, or come within clear[kind] px of an obstacle? */
  hits(r: Rect, clear: Clearance): boolean {
    const g = this.range(r.x0, r.y0, r.x1, r.y1)
    if (!g) return false
    for (let y = g[1]; y <= g[3]; y++)
      for (let x = g[0]; x <= g[2]; x++) {
        const cell = y * this.cols + x
        for (const o of this.rects[cell]) {
          if (o.x0 < r.x1 && o.x1 > r.x0 && o.y0 < r.y1 && o.y1 > r.y0) return true
        }
        const s = this.segs[cell]
        for (let i = 0; i < s.length; i += 5) {
          const c = Math.min(MAX_CLEAR, clear[s[i + 4]])
          if (c < 0) continue
          if (segHitsRect(s[i], s[i + 1], s[i + 2], s[i + 3], r.x0 - c, r.y0 - c, r.x1 + c, r.y1 + c)) return true
        }
      }
    return false
  }
}

/** Liang–Barsky: does segment AB touch the rect? */
function segHitsRect(ax: number, ay: number, bx: number, by: number, x0: number, y0: number, x1: number, y1: number): boolean {
  let t0 = 0
  let t1 = 1
  const dx = bx - ax
  const dy = by - ay
  const p = [-dx, dx, -dy, dy]
  const q = [ax - x0, x1 - ax, ay - y0, y1 - ay]
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false
    } else {
      const t = q[i] / p[i]
      if (p[i] < 0) {
        if (t > t1) return false
        if (t > t0) t0 = t
      } else {
        if (t < t0) return false
        if (t < t1) t1 = t
      }
    }
  }
  return true
}

// ---------------------------------------------------------------- drawn route

const _p = new THREE.Vector3()
const _a = [0, 0, 0]
const _b = [0, 0, 0]

/**
 * Add the pins (kind 0), the drawn route (kind 1, front-facing segments), the placed
 * landmark glyphs and the drawn 3D monuments (rects), the neatline's scale numerals (rects), the readout and the
 * alidade hairline (kind 2) as obstacles. Clearances are chosen per query.
 */
export function addInstrumentObstacles(occ: Occupancy, inner: THREE.Object3D, camera: THREE.Camera): void {
  const g = globeState
  const px = g.pinsPx
  for (let i = 0; i * 4 < px.length; i++) {
    if (px[i * 4 + 2] < 0.05) continue
    occ.addPoint(px[i * 4], px[i * 4 + 1])
  }
  if (g.anchors.routeOpacity > 0.02 && drawnRoute.mounted) {
    // only the legs RouteLine actually draws (restraint weights, stubs, draw-on)
    for (let pi = 0; pi < drawnRoute.parts.length; pi++) {
      const part = drawnRoute.parts[pi]
      const kind: ObstacleKind = drawnRoute.emphasis[pi] ? 1 : 3
      const pos = part.pos
      const fade = part.fade
      for (let k = 0; k < part.count; k++) {
        if (fade[k * 2] < ROUTE_MIN_FADE && fade[k * 2 + 1] < ROUTE_MIN_FADE) continue
        _p.set(pos[k * 6], pos[k * 6 + 1], pos[k * 6 + 2])
        projectLocal(_p, inner, camera, _a)
        if (_a[2] <= -0.02) continue
        _p.set(pos[k * 6 + 3], pos[k * 6 + 4], pos[k * 6 + 5])
        projectLocal(_p, inner, camera, _b)
        if (_b[2] <= -0.02) continue
        occ.addSegment(_a[0], _a[1], _b[0], _b[1], kind)
      }
    }
  }
  // landmark glyphs (placed boxes, pre-placed like rects)
  const h = GLYPH_BOX_PX / 2
  for (let i = 0; i + 1 < glyphBoxes.length; i += 2) {
    occ.addRect({ x0: glyphBoxes[i] - h, y0: glyphBoxes[i + 1] - h, x1: glyphBoxes[i] + h, y1: glyphBoxes[i + 1] + h })
  }
  // the 3D monuments as drawn (wide-view miniatures and close zoom): names keep off them
  for (let i = 0; i + 3 < monumentBoxes.length; i += 4) {
    occ.addRect({ x0: monumentBoxes[i], y0: monumentBoxes[i + 1], x1: monumentBoxes[i + 2], y1: monumentBoxes[i + 3] })
  }
  // the town miniatures at the places (a place's own name sets beside its town: placeLabelSystem)
  for (let i = 0; i + 3 < townBoxes.length; i += 4) {
    occ.addRect({ x0: townBoxes[i], y0: townBoxes[i + 1], x1: townBoxes[i + 2], y1: townBoxes[i + 3] })
  }
  // the neatline's scale numerals (deep zoom)
  if (neatGuard.on) {
    const nb = neatGuard.boxes
    for (let i = 0; i + 3 < nb.length; i += 4) occ.addRect({ x0: nb[i], y0: nb[i + 1], x1: nb[i + 2], y1: nb[i + 3] })
  }
  // the instrument readout (deep zoom: hangs over the paint)
  if (readoutBox.on) occ.addRect({ x0: readoutBox.x0, y0: readoutBox.y0, x1: readoutBox.x1, y1: readoutBox.y1 })
  const an = g.anchors
  if (an.activeIndex >= 0 && an.limbMarkPx) {
    occ.addSegment(an.globeCenterPx[0], an.globeCenterPx[1], an.limbMarkPx[0], an.limbMarkPx[1], 2)
  }
}
