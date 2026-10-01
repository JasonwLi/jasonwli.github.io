/**
 * PlaceLabelSystem — the engine behind PlaceLabels.tsx (troika chunk).
 *
 * Visited-place names (C4; replaces F0's always-on drei <Html> labels and hover tooltip).
 *
 * Theme + critique: place names exist only in deep zoom (viewKm < VIEW_GATES.placeLabelsKm,
 * the theme's 'zoom 4'), front-facing, greedily culled by photo count, never for the
 * active place (the DOM readout owns it) or the hovered one (T1c's hover label owns it).
 * Castoro italic 13 px, tokens.silver, incise halo (1.5 px outline at 70 %), set 10 px
 * right of / 4 px above the pin (flipped to the left when the right side is taken).
 * Billboarded (screen-aligned) in one BatchedText, depthTest off, renderOrder 24 (over
 * the route, under the pins at 30). Their rects are published to `placeRects` so the
 * region names yield to them.
 */
import * as THREE from 'three'
import type { Text } from 'troika-three-text'
import { globeState } from '../globeState'
import { sceneRefs } from '../sceneRefs'
import { VIEW_GATES } from '../lod'
import { pinLocal } from '../instrument/pinsPx'
import { locations } from '../../data/travel'
import { tokens } from '../../theme/tokens'
import { CAP_HEIGHT_EM, FONT_ITALIC, GlobeBatchedText, makeMember, sanitize, smoothstep, writeMember } from './globeText'
import { Occupancy, addInstrumentObstacles, labelBounds, placeRects, projectLocal, type Clearance, type Rect } from './declutter'

const FONT_PX = 13
const OFF_X = 10
const OFF_Y = 4
const HALO_PX = 1.5
/** [pin, route, alidade] px: other pins (7 < OFF_X − 1, so never its own pin), the route may pass under, the alidade not */
const CLEAR: Clearance = [7, -1, 6, -1]
const FADE_MS = 200
const PASS_MS = 200
const MIN_VIS = 0.5

interface Entry {
  idx: number // locations index
  photos: number
  text: Text
  widthEm: number
  side: 1 | -1 // 1 = right of the pin
  target: number
  op: number
  inBatch: boolean
}

const _n = new THREE.Vector3()
const _u = new THREE.Vector3()
const _v = new THREE.Vector3()
const _p = new THREE.Vector3()
const _q = new THREE.Vector3()
const _inv = new THREE.Matrix4()
const _a = [0, 0, 0]
const _b = [0, 0, 0]
const _bounds: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 }

export class PlaceLabelSystem {
  readonly batch = new GlobeBatchedText(24)
  private entries: Entry[]
  private occ = new Occupancy()
  private lastPass = -1e9
  private lastSig = ''
  private placed = 0

  constructor() {
    this.batch.name = 'PlaceLabels'
    this.entries = locations
      .map((l, idx) => {
        const txt = sanitize(l.name, 'italic')
        const text = makeMember(txt, FONT_ITALIC, 0, 'left')
        text.color = tokens.silver
        text.outlineColor = tokens.incise
        text.outlineWidth = HALO_PX / FONT_PX
        const e: Entry = { idx, photos: l.photos.length, text, widthEm: txt.length * 0.5, side: 1, target: 0, op: 0, inBatch: false }
        text.sync(() => {
          const bb = text.textRenderInfo?.blockBounds
          if (bb) e.widthEm = bb[2] - bb[0]
        })
        return e
      })
      .sort((a, b) => b.photos - a.photos)
  }

  debugInfo() {
    return { placed: this.placed, visible: this.entries.filter((e) => e.target > 0).map((e) => locations[e.idx].name) }
  }

  dispose(): void {
    for (const e of this.entries) e.text.dispose()
    this.batch.dispose()
    placeRects.length = 0
  }

  frame(dtMs: number, camera: THREE.Camera, reducedMotion: boolean): void {
    const g = globeState
    const inner = sceneRefs.inner
    const a = g.anchors
    const zoomGate = smoothstep(VIEW_GATES.placeLabelsKm, VIEW_GATES.placeLabelsKm * 0.85, g.lod.viewKm)
    const show =
      inner && g.travelIn >= 0.35 && g.surfaceReady ? zoomGate * smoothstep(0.35, 0.5, g.travelIn) * (1 - g.dim) : 0
    const now = performance.now()
    if (!inner || show <= 0) {
      for (const e of this.entries) e.target = 0
      if (placeRects.length) placeRects.length = 0
    } else {
      const sig = [
        Math.round(Math.log(g.lod.viewKm) / 0.02),
        Math.round(a.lambdaC * 50),
        Math.round(a.phiC * 50),
        Math.round(a.globeCenterPx[0] / 2),
        Math.round(a.globeCenterPx[1] / 2),
        Math.round(g.lod.tilt * 100),
        a.activeIndex,
        a.hoverIndex,
        g.viewport.w,
        g.viewport.h,
      ].join(',')
      if ((sig !== this.lastSig && now - this.lastPass >= PASS_MS) || now - this.lastPass > 1000) {
        this.lastSig = sig
        this.lastPass = now
        this.declutter(inner, camera)
      }
    }

    // never for the active / hovered place, immediately (not at the next pass)
    const step = reducedMotion ? 1 : dtMs / FADE_MS
    const px = g.pinsPx
    let any = false
    if (inner) {
      // screen right / up in globe-local space
      _inv.copy(inner.matrixWorld).invert()
      _u.setFromMatrixColumn(camera.matrixWorld, 0).transformDirection(_inv)
      _v.setFromMatrixColumn(camera.matrixWorld, 1).transformDirection(_inv)
    }
    for (const e of this.entries) {
      const excluded = e.idx === a.activeIndex || e.idx === a.hoverIndex
      const vis = px.length >= (e.idx + 1) * 4 ? px[e.idx * 4 + 2] : 0
      const t = excluded ? 0 : e.target * show * smoothstep(0.3, 0.8, vis)
      if (excluded) e.op = 0
      else if (e.op < t) e.op = Math.min(t, e.op + step)
      else if (e.op > t) e.op = Math.max(t, e.op - step)
      const want = e.op > 0.001 || (e.target > 0 && show > 0)
      if (want !== e.inBatch) {
        if (want) this.batch.addText(e.text)
        else this.batch.removeText(e.text)
        e.inBatch = want
      }
      if (!e.inBatch || !inner || pinLocal.length < (e.idx + 1) * 3) continue
      any = true
      _p.set(pinLocal[e.idx * 3], pinLocal[e.idx * 3 + 1], pinLocal[e.idx * 3 + 2])
      const r = _p.length()
      _n.copy(_p).divideScalar(r)
      // local units per CSS px at the pin, measured through the real projection
      projectLocal(_p, inner, camera, _a)
      _q.copy(_p).addScaledVector(_u, 0.001)
      projectLocal(_q, inner, camera, _b)
      const dpx = Math.hypot(_b[0] - _a[0], _b[1] - _a[1])
      const upp = dpx > 1e-6 ? 0.001 / dpx : 0
      const scale = FONT_PX * upp
      const widthPx = e.widthEm * FONT_PX
      const offU = e.side > 0 ? OFF_X * upp : -(OFF_X + widthPx) * upp
      writeMember(e.text, _n, r, _u, 0, _v, scale, 1, offU, OFF_Y * upp, CAP_HEIGHT_EM / 2)
      e.text.fillOpacity = e.op
      e.text.outlineOpacity = 0.7 * e.op
    }
    this.batch.visible = any
  }

  private declutter(inner: THREE.Object3D, camera: THREE.Camera): void {
    const g = globeState
    const a = g.anchors
    const vp = g.viewport
    const px = g.pinsPx
    this.occ.reset(vp.w, vp.h)
    // other pins and the alidade; the route may run under a place name (it is the place's own line)
    addInstrumentObstacles(this.occ, inner, camera)
    placeRects.length = 0
    let placed = 0
    const capPx = FONT_PX * CAP_HEIGHT_EM
    for (const e of this.entries) {
      const i = e.idx
      const excluded = i === a.activeIndex || i === a.hoverIndex
      if (excluded || px.length < (i + 1) * 4 || px[i * 4 + 2] < MIN_VIS) {
        e.target = 0
        continue
      }
      const x = px[i * 4]
      const y = px[i * 4 + 1]
      const w = e.widthEm * FONT_PX
      const cy = y - OFF_Y
      const sides: (1 | -1)[] = e.side > 0 ? [1, -1] : [-1, 1]
      let ok = false
      for (const side of sides) {
        const x0 = side > 0 ? x + OFF_X : x - OFF_X - w
        const r = { x0: x0 - 1, y0: cy - capPx / 2 - 3, x1: x0 + w + 1, y1: cy + capPx / 2 + 4 }
        const f = labelBounds(_bounds)
        if (r.x0 < f.x0 + 4 || r.y0 < f.y0 + 4 || r.x1 > f.x1 - 4 || r.y1 > f.y1 - 4) continue
        if (this.occ.hits(r, CLEAR)) continue
        this.occ.addRect(r)
        placeRects.push(r)
        e.side = side
        ok = true
        break
      }
      e.target = ok ? 1 : 0
      if (ok) placed++
    }
    this.placed = placed
  }
}
