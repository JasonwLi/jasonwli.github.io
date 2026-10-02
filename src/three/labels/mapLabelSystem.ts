/**
 * MapLabelSystem — the region-name engine behind MapLabels.tsx (troika lives in this
 * chunk, imported only once the globe reaches stage B or travel).
 *
 * EU4-style region names painted on the globe (C4; theme REGION NAMES + critique
 * "C4 MapLabels / PlaceLabels vs theme REGION NAMES").
 *
 * - Land (range, desert, plateau, plain, basin, region, peninsula, island, peak):
 *   Castoro Titling capitals, letter-spacing from the data (+0.35 em for areas),
 *   tokens.labelLand lerping to tokens.labelClimate (alpha labelClimateAlpha) by
 *   globeState.modeMix, over a soft pale land-tone halo (1.3 px + 1.1 px blur at 62 %; finish
 *   review round 2: the old 0.6 px / 40 % edge let umber ink sink into brown and green relief).
 * - Water (ocean, sea, bay, strait, lake, river): Castoro italic (+0.2 em),
 *   tokens.labelSea, no outline on open water; rivers at 0.8× size and 70 %.
 *   Lakes and rivers sit on the paint, so they get a 0.6 px incise edge at 40 %.
 * - Screen cap height clamped to [11, 18] px by rank (rivers [10, 13]); shown when the
 *   natural cap height s·pxPerKm (measured at the label, not lod.pxPerKm) lies in [9, 1200] px and r ≤ rankMax[lod.labelTier].
 * - Curved: the in-plane arc 'a' and the sphere itself (exponential map), see globeText.
 * - Horizon: culled on the CPU by the centre's facing cosine, faded per vertex on the
 *   GPU (smoothstep(0.02, 0.18)), so nothing draws on the far side.
 * - Declutter at ≤ 5 Hz when the view moves: lower rank first, 24 px exclusion around
 *   pins, the route and the alidade, place-label rects pre-placed; a colliding label
 *   tries nudges (±1.6 / ±3.2 cap heights up/down, ±30 % of its width sideways) before
 *   it yields. Route obstacles are only the legs RouteLine draws (screenObstacles.ts).
 * - 200 ms crossfades; hidden while travelIn < 0.35 (the hero stays clean); × (1 − dim).
 * - Names must sit wholly inside labelBounds(): the free rect, and inside the neatline frame
 *   clear of its ticks and numerals in deep zoom (never under the column / nav / plate edge).
 * - Only placed (or fading) labels are batch members, so the glyph count stays small.
 * Two BatchedText draws (+ their outline passes), depthTest off, renderOrder 19
 * (paint → … → region names → route (20–23) → pins (30)).
 */
import * as THREE from 'three'
import type { Text } from 'troika-three-text'
import { globeState } from '../globeState'
import { sceneRefs } from '../sceneRefs'
import { EARTH_KM, LIFT } from '../geo/radii'
import { heightGridReady, sampleHeightM } from '../geo/heightGrid'
import type { LabelsFile } from '../terrain/manifest'
import { labelClimateAlpha, tokens } from '../../theme/tokens'
import {
  CAP_HEIGHT_EM,
  FONT_ITALIC,
  FONT_TITLING,
  GlobeBatchedText,
  frameAt,
  globePoint,
  makeMember,
  sanitize,
  smoothstep,
  writeMember,
} from './globeText'
import { Occupancy, addInstrumentObstacles, labelBounds, placeRects, projectLocal, type Clearance, type Rect } from './declutter'
import { mapLabelRects } from '../instrument/screenObstacles'

type Kind = LabelsFile['labels'][number]['k']
const WATER = new Set<Kind>(['ocean', 'sea', 'bay', 'strait', 'lake', 'river'])
const INLAND_WATER = new Set<Kind>(['lake', 'river'])

const RANK_MAX = [1, 2, 4, 6, 9] as const
const NATURAL_PX: readonly [number, number] = [9, 1200]
const CAP_MIN_PX = 11
const CAP_MAX_BY_RANK = [17, 16, 14.5, 13, 12, 12, 11.5, 11, 11, 11]
const OCEAN_CAP_PX = 18
const RIVER_CAP: readonly [number, number] = [10, 13]
/** [pin, active legs, alidade, faint base course]: seas/oceans keep 24 px from the
 * emphasised legs but only 8 px from the faint course, so ocean names survive the
 * travel default view */
const CLEAR_LAND: Clearance = [24, 24, 24, 24]
const CLEAR_SEA: Clearance = [24, 24, 24, 8]
const CLEAR_OCEAN: Clearance = [24, 24, 24, 8]
const FADE_MS = 200
const PASS_MS = 200 // 5 Hz
/** [along u, fraction of the half width; along v, cap heights] */
const NUDGES: readonly (readonly [number, number])[] = [
  [0, 0], [0, 1.6], [0, -1.6], [0.3, 0], [-0.3, 0], [0, 3.2], [0, -3.2], [0.3, 1.6], [-0.3, 1.6], [0.3, -1.6], [-0.3, -1.6],
]
const LAND_TONE = '#d8c9a2' // pale ochre land-tone halo under the umber ink (a cartographer's knock-out, not a UI stroke)
const LAND_HALO_PX = 1.3
const LAND_HALO_BLUR_PX = 1.1
const LAND_HALO_ALPHA = 0.62
const ROW_SAMPLES = [-0.5, -0.25, 0, 0.25, 0.5]

interface Entry {
  id: string
  kind: Kind
  rank: number
  sKm: number
  aKm: number
  land: boolean
  n: THREE.Vector3
  u: THREE.Vector3
  v: THREE.Vector3
  hM: number
  hReady: boolean
  text: Text
  widthEm: number
  // per pass
  capPx: number
  pxPerKm: number // measured at the label centre along its baseline (CSS px per km)
  nudge: number // index into NUDGES
  target: number
  // per frame
  op: number
  inBatch: boolean
}

const _east = new THREE.Vector3()
const _north = new THREE.Vector3()
const _pt = new THREE.Vector3()
const _scr = [0, 0, 0]
const _col = new THREE.Color()
const _colA = new THREE.Color()
const _colB = new THREE.Color()

const _pa = [0, 0, 0]
const _pb = [0, 0, 0]
const _pu = new THREE.Vector3()
/**
 * CSS px per km at a label's centre, through the real projection (tilt, lens shift,
 * phone framing): the LARGER of the baseline and cap directions. Toward the limb the
 * baseline foreshortens while the cap direction does not; sizing by the baseline alone
 * blew rim names up (finish review: INDIA and Arabian Sea dwarfed SAHARA).
 */
function pxPerKmAt(e: Entry, inner: THREE.Object3D, camera: THREE.Camera): number {
  const eps = 0.002
  projectLocal(e.n, inner, camera, _pa)
  _pu.copy(e.n).addScaledVector(e.u, eps)
  projectLocal(_pu, inner, camera, _pb)
  const du = Math.hypot(_pb[0] - _pa[0], _pb[1] - _pa[1])
  _pu.copy(e.n).addScaledVector(e.v, eps)
  projectLocal(_pu, inner, camera, _pb)
  const dv = Math.hypot(_pb[0] - _pa[0], _pb[1] - _pa[1])
  return Math.max(1e-6, Math.max(du, dv) / (eps * EARTH_KM))
}
/** names whose box reaches a facing cosine under this are culled (no rim names, finish review) */
const HORIZON_MIN_FACE = 0.4
const _bounds: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 }

function capPxFor(e: Entry, natural: number): number {
  if (e.kind === 'river') return Math.min(RIVER_CAP[1], Math.max(RIVER_CAP[0], natural * 0.8))
  const max = e.kind === 'ocean' ? OCEAN_CAP_PX : CAP_MAX_BY_RANK[Math.min(9, Math.max(0, e.rank))]
  return Math.min(max, Math.max(CAP_MIN_PX, natural))
}

export class MapLabelSystem {
  readonly group = new THREE.Group()
  private land = new GlobeBatchedText(19)
  private sea = new GlobeBatchedText(19)
  private entries: Entry[] = []
  private occ = new Occupancy()
  private lastPass = -1e9
  private lastSig = ''
  private stats = { candidates: 0, placed: 0, members: 0, glyphs: 0, passMs: 0, outside: 0, collided: 0, free: [0, 0, 0, 0] }

  constructor(file: LabelsFile) {
    this.group.add(this.land, this.sea)
    this.group.name = 'MapLabels'
    for (const l of file.labels) {
      const land = !WATER.has(l.k)
      const raw = land ? l.t.toUpperCase() : l.t
      const txt = sanitize(raw, land ? 'titling' : 'italic')
      if (!txt.trim()) continue
      const n = new THREE.Vector3()
      frameAt(l.lat, l.lon, n, _east, _north)
      const b = (l.b * Math.PI) / 180 // clockwise from east
      const u = _east.clone().multiplyScalar(Math.cos(b)).addScaledVector(_north, -Math.sin(b))
      const v = _north.clone().multiplyScalar(Math.cos(b)).addScaledVector(_east, Math.sin(b))
      const text = makeMember(txt, land ? FONT_TITLING : FONT_ITALIC, l.ls, 'center')
      const e: Entry = {
        id: l.id, kind: l.k, rank: l.r, sKm: Math.max(1, l.s), aKm: l.a, land, n, u, v,
        hM: 0, hReady: false, text, widthEm: txt.length * (0.62 + l.ls),
        capPx: CAP_MIN_PX, pxPerKm: 1, nudge: 0, target: 0, op: 0, inBatch: false,
      }
      if (land) {
        text.outlineColor = LAND_TONE
      } else if (INLAND_WATER.has(l.k)) {
        text.outlineColor = tokens.incise
      }
      text.sync(() => {
        const bb = text.textRenderInfo?.blockBounds
        if (bb) e.widthEm = bb[2] - bb[0]
      })
      this.entries.push(e)
    }
  }

  debugInfo() {
    return { ...this.stats, visible: this.entries.filter((e) => e.target > 0).map((e) => e.id) }
  }

  dispose(): void {
    for (const e of this.entries) e.text.dispose()
    this.land.dispose()
    this.sea.dispose()
  }

  private batchOf(e: Entry) {
    return e.land ? this.land : this.sea
  }

  frame(dtMs: number, camera: THREE.Camera, reducedMotion: boolean): void {
    const g = globeState
    const inner = sceneRefs.inner
    const lod = g.lod
    const show = g.travelIn >= 0.35 && g.surfaceReady ? smoothstep(0.35, 0.5, g.travelIn) * (1 - g.dim) : 0
    const now = performance.now()

    if (!inner || show <= 0) {
      for (const e of this.entries) e.target = 0
      mapLabelRects.length = 0
    } else {
      // view signature: rerun at ≤ 5 Hz when the view moved > 2 % of viewKm or ~2 px
      const sig = [
        Math.round(Math.log(lod.viewKm) / 0.02),
        Math.round(g.anchors.lambdaC * 50),
        Math.round(g.anchors.phiC * 50),
        Math.round(g.anchors.globeCenterPx[0] / 2),
        Math.round(g.anchors.globeCenterPx[1] / 2),
        Math.round(lod.tilt * 100),
        g.anchors.activeIndex,
        lod.labelTier,
        g.viewport.w,
        g.viewport.h,
      ].join(',')
      if ((sig !== this.lastSig && now - this.lastPass >= PASS_MS) || now - this.lastPass > 1000) {
        this.lastSig = sig
        this.lastPass = now
        this.declutter(inner, camera)
      }
    }

    // fades, sizes, colours
    const step = reducedMotion ? 1 : dtMs / FADE_MS
    const mix = g.modeMix
    _colA.set(tokens.labelLand)
    _colB.set(tokens.labelClimate)
    const landColor = _col.copy(_colA).lerp(_colB, mix).getHex()
    const landAlpha = 1 + (labelClimateAlpha - 1) * mix
    const gridReady = heightGridReady()
    let members = 0
    let glyphs = 0
    for (const e of this.entries) {
      const t = e.target * show
      if (e.op < t) e.op = Math.min(t, e.op + step)
      else if (e.op > t) e.op = Math.max(t, e.op - step)
      const want = e.op > 0.001 || e.target > 0
      if (want !== e.inBatch) {
        if (want) this.batchOf(e).addText(e.text)
        else this.batchOf(e).removeText(e.text)
        e.inBatch = want
      }
      if (!e.inBatch) continue
      members++
      glyphs += e.text.textRenderInfo?.glyphAtlasIndices.length ?? 0
      if (gridReady && !e.hReady) {
        e.hM = Math.max(0, sampleHeightM(Math.asin(e.n.y) * (180 / Math.PI), Math.atan2(-e.n.z, e.n.x) * (180 / Math.PI)))
        e.hReady = true
      }
      if (inner) e.pxPerKm = pxPerKmAt(e, inner, camera)
      const capUnits = e.capPx / e.pxPerKm / EARTH_KM
      const arc = e.aKm !== 0 ? (e.aKm / e.sKm) * capUnits : 0
      const rLift = 1 + LIFT.label + e.hM * lod.heightScale
      const [nu, nv] = NUDGES[e.nudge]
      const scale = capUnits / CAP_HEIGHT_EM
      writeMember(e.text, e.n, rLift, e.u, arc, e.v, scale, 0, nu * (e.widthEm * scale) / 2, nv * capUnits, CAP_HEIGHT_EM / 2)
      const op = e.op
      if (e.land) {
        e.text.color = landColor
        e.text.fillOpacity = op * landAlpha
        e.text.outlineWidth = LAND_HALO_PX / (e.capPx / CAP_HEIGHT_EM)
        e.text.outlineBlur = LAND_HALO_BLUR_PX / (e.capPx / CAP_HEIGHT_EM)
        // the pale halo leaves with the section dim (on the dimmed globe it would glow)
        e.text.outlineOpacity = LAND_HALO_ALPHA * op * (1 - mix) * (1 - g.dim)
      } else {
        e.text.color = tokens.labelSea
        e.text.fillOpacity = op * (e.kind === 'river' ? 0.7 : 1)
        if (INLAND_WATER.has(e.kind)) {
          e.text.outlineWidth = 0.6 / (e.capPx / CAP_HEIGHT_EM)
          e.text.outlineOpacity = 0.4 * op
        }
      }
    }
    this.land.visible = this.hasMembers(this.land)
    this.sea.visible = this.hasMembers(this.sea)
    this.stats.members = members
    this.stats.glyphs = glyphs
  }

  private hasMembers(b: GlobeBatchedText): boolean {
    for (const e of this.entries) if (e.inBatch && this.batchOf(e) === b) return true
    return false
  }

  /** Screen bbox of a label at a nudge (CSS px), or null when off-screen / behind. */
  private rectFor(e: Entry, capUnits: number, nudge: number, inner: THREE.Object3D, camera: THREE.Camera): Rect | null {
    const [nu, nv] = NUDGES[nudge]
    const arc = e.aKm !== 0 ? (e.aKm / e.sKm) * capUnits : 0
    const scale = capUnits / CAP_HEIGHT_EM
    const halfW = (e.widthEm * scale) / 2
    const halfH = capUnits / 2
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    let minFace = 1
    for (const fx of ROW_SAMPLES) {
      for (const fy of [-1, 1]) {
        globePoint(e.n, e.u, e.v, 1 + LIFT.label, arc, fx * 2 * halfW, fy * halfH, nu * halfW, nv * capUnits, _pt)
        projectLocal(_pt, inner, camera, _scr)
        minFace = Math.min(minFace, _scr[2])
        x0 = Math.min(x0, _scr[0])
        y0 = Math.min(y0, _scr[1])
        x1 = Math.max(x1, _scr[0])
        y1 = Math.max(y1, _scr[1])
      }
    }
    if (minFace < HORIZON_MIN_FACE) return null // no names running over the horizon
    // wholly inside the instrument's free rect (never under the travel column, the nav
    // or below the phone globe band) and inside the neatline frame in deep zoom
    const f = labelBounds(_bounds)
    const pad = 6
    if (x0 < f.x0 + pad || y0 < f.y0 + pad || x1 > f.x1 - pad || y1 > f.y1 - pad) return null
    return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad }
  }

  private declutter(inner: THREE.Object3D, camera: THREE.Camera): void {
    const t0 = performance.now()
    const g = globeState
    const lod = g.lod
    const vp = g.viewport
    this.occ.reset(vp.w, vp.h)
    addInstrumentObstacles(this.occ, inner, camera)
    for (const r of placeRects) this.occ.addRect(r)
    mapLabelRects.length = 0
    const rankMax = RANK_MAX[lod.labelTier]
    const f = labelBounds(_bounds)
    const cands: Entry[] = []
    for (const e of this.entries) {
      if (e.rank > rankMax) {
        e.target = 0
        continue
      }
      projectLocal(e.n, inner, camera, _scr)
      // centre behind the limb, or outside the free rect (then the whole name cannot fit)
      if (_scr[2] < 0.4 || _scr[0] < f.x0 || _scr[0] > f.x1 || _scr[1] < f.y0 || _scr[1] > f.y1) {
        e.target = 0
        continue
      }
      e.pxPerKm = pxPerKmAt(e, inner, camera)
      const natural = e.sKm * e.pxPerKm
      if (natural < NATURAL_PX[0] || natural > NATURAL_PX[1]) {
        e.target = 0
        continue
      }
      e.capPx = capPxFor(e, natural)
      cands.push(e)
    }
    // lower rank first; oceans before seas; bigger features first; incumbents win ties
    cands.sort((a, b) => a.rank - b.rank || b.sKm - a.sKm || b.op - a.op)
    let placed = 0
    let outside = 0
    let collided = 0
    // rank-relative size: a name is never set larger than any stronger-ranked name already
    // placed (finish review: INDIA and Arabian Sea dwarfed SAHARA); rivers do not set it
    let ceiling = Infinity
    for (const e of cands) {
      if (e.kind !== 'river') e.capPx = Math.max(CAP_MIN_PX, Math.min(e.capPx, ceiling))
      // try the current nudge first so names do not hop
      const order = NUDGES.map((_, i) => i)
      if (e.target > 0 && e.nudge > 0) order.unshift(order.splice(e.nudge, 1)[0])
      const clear = e.kind === 'ocean' ? CLEAR_OCEAN : e.kind === 'sea' ? CLEAR_SEA : CLEAR_LAND
      // size ladder: the rank's size, then 75 % (never below the 11 px floor)
      const full = e.capPx
      const sizes = full * 0.75 >= CAP_MIN_PX ? [full, full * 0.75] : full > CAP_MIN_PX ? [full, CAP_MIN_PX] : [full]
      let ok = false
      let sawRect = false
      for (const cap of sizes) {
        const capUnits = cap / e.pxPerKm / EARTH_KM
        for (const nudge of order) {
          const r = this.rectFor(e, capUnits, nudge, inner, camera)
          if (r) sawRect = true
          if (!r || this.occ.hits(r, clear)) continue
          this.occ.addRect(r)
          mapLabelRects.push(r.x0, r.y0, r.x1, r.y1)
          e.nudge = nudge
          e.capPx = cap
          ok = true
          break
        }
        if (ok) break
      }
      e.target = ok ? 1 : 0
      if (ok && e.kind !== 'river') ceiling = Math.min(ceiling, e.capPx)
      if (ok) placed++
      else if (sawRect) collided++
      else outside++
    }
    this.stats.outside = outside
    this.stats.collided = collided
    this.stats.free = [f.x0, f.y0, f.x1, f.y1].map(Math.round)
    this.stats.candidates = cands.length
    this.stats.placed = placed
    this.stats.passMs = +(performance.now() - t0).toFixed(2)
  }
}
