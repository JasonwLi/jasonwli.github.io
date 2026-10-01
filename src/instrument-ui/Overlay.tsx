/**
 * THE INSTRUMENT (T1c): the DOM overlay that turns the painted globe into an
 * astrolabe. One SVG plus a thin HTML layer for the words, mounted over the
 * canvas (lazy chunk, after first paint), driven by ONE frame-bus subscription:
 * the Instrument frame (−2) writes globeState.anchors, then emitFrame() calls us
 * before the canvas renders, so overlay and canvas move in the same frame. No
 * React state per frame: every per-frame write is an attribute or style, gated
 * on deltas.
 *
 *   limb       disc seat (R, R+3), fillets (R+12, R+14), ticks 1°/5°/10° hanging
 *              from R+44, numerals at R+24, rim at R+48 (I1's LIMB table; compact
 *              28 px limb on phones), turning by −λc. Cut clockwise from the
 *              fiducial as the textures load (bound to anchors.loadProgress).
 *   fiducial   fixed index triangle outside the rim at 12 o'clock (mid visible
 *              arc in the 'arc' stage) with the meridian readout above it.
 *   alidade    vermilion blade + sighting hairline swinging with the pin bearing
 *              (anchors.alidadeAngle, copied each frame, never referenced).
 *   timeline   on the settle edge after a new place: set tick 160 ms → ±5° ticks
 *              re-cut 500 ms → leader 220 ms → readout 180 ms. Pre-cut under
 *              reduced motion.
 *   neatline   deep zoom: double hairline frame cut from the top-left clockwise,
 *              graticule ticks at true edge crossings, vermilion place marks.
 *   hover      italic place name + country by the hovered pin.
 *
 * Colour law: gilt only on the scales and hairlines, vermilion only on the
 * alidade / set tick / active marks, silver for words, engraving as an --incise
 * groove offset toward the light, never a gradient.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { globeState, subscribeFrame } from '../three/globeState'
import { instrumentLayout, type LimbGeometry } from '../three/instrument/anchors'
import { registerDebug } from '../three/debugHooks'
import { limbFullAt, limbOpacityAt } from '../theme/choreography'
import { useSite } from '../state/store'
import { countryName } from '../data/travel'
import {
  buildRecut,
  buildTicks,
  circlePath,
  numeralStep,
  numeralTransform,
  sweepWedge,
  wrap180,
} from './limbGeometry'
import { alidadeShape, hairlinePath } from './alidade'
import { placeEdge, placeRim, type BlockSize, type EdgeSide, type FreeRect, type Placement } from './readoutFit'
import { NEAT_INSET, activeMarks, buildNeatTicks, frameRects, rectPath } from './neatlineDraw'
import { placeHover } from './hoverLabel'
import { dateRange, deg, meridian } from './format'
import { ViewControls } from './ViewControls'
import { neatGuard, readoutBox } from '../three/instrument/screenObstacles'
import css from './instrument.css?inline'

const DEG = Math.PI / 180
const NUMERALS = 36
const NEAT_LABELS = 48
/** gap between the nav ruler's box and the neatline's free top (the steel head margin) */
const NAV_GAP = 4
/** names stay this far inside the neatline's inner hairline (11 px majors + 4 px of steel) */
const NEAT_TICK_CLEAR = 15
const BURIN = 'cubic-bezier(0.45, 0, 0.2, 1)'
const EASE_OUT = 'cubic-bezier(0.25, 1, 0.5, 1)'

/** delta gate that also fires on the first frame (NaN last value) */
const moved = (v: number, last: number, eps: number) => !(Math.abs(v - last) <= eps)

const FIDUCIAL_FILL = 'M-3.5,0 L3.5,0 L0,-6Z'
const FIDUCIAL_EDGE = 'M-3.5,0 L0,-6 L3.5,0'

type Els = {
  svg: SVGSVGElement
  clipRect: SVGRectElement
  sweepPath: SVGPathElement
  limbLayer: SVGGElement
  limbFixed: SVGGElement
  sweepG: SVGGElement
  seat: SVGCircleElement
  seat2: SVGCircleElement
  fillet: SVGCircleElement
  fillet2: SVGCircleElement
  rimGroove: SVGPathElement
  rim: SVGPathElement
  rotGroove: SVGGElement
  rotG: SVGGElement
  majorGroove: SVGPathElement
  minor: SVGPathElement
  mid: SVGPathElement
  major: SVGPathElement
  recutL: SVGPathElement
  recutR: SVGPathElement
  fiducial: SVGGElement
  fidGroove: SVGPathElement
  fidFill: SVGPathElement
  numeralsG: SVGGElement
  aliLayer: SVGGElement
  aliG: SVGGElement
  hairUnder: SVGPathElement
  hair: SVGPathElement
  blade: SVGPathElement
  pinnule: SVGPathElement
  stub: SVGPathElement
  setTickGroove: SVGPathElement
  setTick: SVGPathElement
  cutG: SVGGElement
  leaderLayer: SVGGElement
  leader: SVGPathElement
  leaderDot: SVGCircleElement
  neatLayer: SVGGElement
  neatHead: SVGPathElement
  neatHeadRule: SVGPathElement
  neatOuterGroove: SVGPathElement
  neatOuter: SVGPathElement
  neatInner: SVGPathElement
  neatTicks: SVGGElement
  neatMajorGroove: SVGPathElement
  neatMajor: SVGPathElement
  neatMinor: SVGPathElement
  neatNotch: SVGPathElement
  neatMarks: SVGPathElement
  hoverLeader: SVGPathElement
  html: HTMLDivElement
  meridian: HTMLDivElement
  readout: HTMLDivElement
  readoutBlock: HTMLDivElement
  readoutLine: HTMLDivElement
  hover: HTMLDivElement
}

/** shared between the content components (React, on change) and the frame loop */
interface Shared {
  block: BlockSize
  hoverW: number
}

/** the drawn data separator (src/art/Dot's drawing; the readout is aria-hidden, so no spoken comma) */
function Dot() {
  return (
    <svg className="art dot" width="3" height="3" viewBox="0 0 3 3" aria-hidden="true" focusable="false">
      <circle className="art-fill fill-gilt-worn" cx="1.5" cy="1.5" r="1.5" />
    </svg>
  )
}

function usePrefersReducedMotion() {
  const [r, setR] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const cb = () => setR(mq.matches)
    mq.addEventListener('change', cb)
    return () => mq.removeEventListener('change', cb)
  }, [])
  return r
}

/** the readout's words: React renders them on a place change only; the frame loop places them */
function ReadoutContent({ shared, blockRef, lineRef }: {
  shared: RefObject<Shared>
  blockRef: (n: HTMLDivElement | null) => void
  lineRef: (n: HTMLDivElement | null) => void
}) {
  const loc = useSite((s) => s.active)
  const b = useRef<HTMLDivElement | null>(null)
  const l = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const bl = b.current
    const li = l.current
    if (!bl || !li) return
    const name = bl.firstElementChild as HTMLElement | null
    shared.current.block = {
      w: bl.offsetWidth,
      h: bl.offsetHeight,
      nameMid: name ? name.offsetTop + name.offsetHeight / 2 : 10,
      lineW: li.offsetWidth,
      lineH: li.offsetHeight,
    }
  }, [loc, shared])
  const coords = loc ? (
    <>
      <span className="data">{deg(loc.lat, 'N', 'S')}</span>
      <Dot />
      <span className="data">{deg(loc.lon, 'E', 'W')}</span>
    </>
  ) : null
  return (
    <>
      <div
        className="ins-readout-block"
        ref={(n) => {
          b.current = n
          blockRef(n)
        }}
      >
        <p className="ins-readout-name">{loc?.name ?? ''}</p>
        <p className="ins-readout-coords">{coords}</p>
        <p className="ins-readout-dates data">{loc ? dateRange(loc) : ''}</p>
      </div>
      <div
        className="ins-readout-line"
        ref={(n) => {
          l.current = n
          lineRef(n)
        }}
      >
        <span className="ins-readout-name">{loc?.name ?? ''}</span>
        {loc && <Dot />}
        {coords}
      </div>
    </>
  )
}

function HoverContent({ shared }: { shared: RefObject<Shared> }) {
  const loc = useSite((s) => s.hovered)
  const nameRef = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    shared.current.hoverW = nameRef.current?.offsetWidth ?? 0
  }, [loc, shared])
  return (
    <>
      <span className="ins-hover-name" ref={nameRef}>
        {loc?.name ?? ''}
      </span>
      <span className="ins-hover-country">{loc ? countryName(loc.cc) : ''}</span>
    </>
  )
}

export default function Overlay() {
  const reduced = usePrefersReducedMotion()
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced
  const els = useRef<Partial<Els>>({})
  const numerals = useRef<(SVGTextElement | null)[]>([])
  const neatLabels = useRef<(SVGTextElement | null)[]>([])
  const shared = useRef<Shared>({ block: { w: 190, h: 64, nameMid: 10, lineW: 220, lineH: 20 }, hoverW: 80 })
  const controlsRef = useRef<HTMLDivElement | null>(null)
  const ref =
    <K extends keyof Els>(k: K) =>
    (n: Els[K] | null) => {
      if (n) els.current[k] = n
    }

  // the stylesheet rides in this chunk (no extra file for the entry to preload)
  useEffect(() => {
    const style = document.createElement('style')
    style.dataset.instrument = ''
    style.textContent = css
    document.head.appendChild(style)
    return () => style.remove()
  }, [])

  useEffect(() => {
    const e = els.current as Els
    if (!e.svg) return
    const g = globeState
    const a = g.anchors

    // -- last-written values (delta gates) --
    let wCx = NaN
    let wCy = NaN
    let wR = NaN
    let wRot = NaN
    let builtR = NaN
    let builtGeom: LimbGeometry | null = null
    let numStep = 0
    const numFlip = new Int8Array(NUMERALS).fill(-1)
    const numDim = new Int8Array(NUMERALS).fill(-1)
    let wLimbAlpha = -1
    let wAliAlpha = -1
    let wNeatAlpha = -1
    let wReadAlpha = -1
    let wHoverAlpha = -1
    let wClip = ''
    let wFid = ''
    let wMer = ''
    let wMerPos = ''
    let wMerA = ''
    let wAli = ''
    let wHair = ''
    let wOcc = -1
    let wLeader = ''
    let wReadPos = ''
    let wKind = ''
    let wHoverPos = ''
    let wHoverIdx = -2
    let wHoverDir = 0
    let wMarks = ''
    let wNeatKey = ''
    let wWordsA = '1'
    let wCtrl = ''
    let recutDeg = NaN
    let recutR = NaN
    let aliShapeGeom: LimbGeometry | null = null

    // -- animated state --
    let stageLimb = a.limbStage === 'neatline' ? 0 : 1
    let stageNeat = a.limbStage === 'neatline' ? 1 : 0
    let limbFaded = false
    let lastStage = a.limbStage
    let aliVis = 0
    let sweep = reducedRef.current ? 1 : 0
    let sweepDone = reducedRef.current
    let sweepRate = 1 / 0.9
    let wSweep = -1
    let lastArmSeq = a.travelArmSeq
    let lastActive = -2
    let lastSettled = false
    let pendingCut = false
    let cut = false
    let anims: Animation[] = []
    let neatAnims: Animation[] = []
    let navRect: FreeRect | null = null
    let wHead = ''
    let edgeSide: EdgeSide = 'top'
    let headA = 0
    let wHeadA = -1
    let wRuleA = -1

    // -- cost meter (debug) --
    let costSum = 0
    let costN = 0
    let costMax = 0

    const readNav = () => {
      const n = document.querySelector('.site-nav')
      const r = n?.getBoundingClientRect()
      navRect = r ? { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom } : null
      wNeatKey = ''
    }
    readNav()
    window.addEventListener('resize', readNav)

    const show = (el: Element, on: boolean) => {
      ;(el as SVGElement | HTMLElement).style.display = on ? '' : 'none'
    }
    /** HTML words keep their layout box (they are measured on content change) */
    const showV = (el: HTMLElement, on: boolean) => {
      el.style.visibility = on ? '' : 'hidden'
    }

    const drawOn = (el: SVGElement, duration: number, delay: number) =>
      el.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
        duration,
        delay,
        easing: BURIN,
        fill: 'both',
      })
    const fadeIn = (el: Element, duration: number, delay: number) =>
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration, delay, easing: EASE_OUT, fill: 'both' })

    const cutParts = () => [e.setTick, e.setTickGroove, e.recutL, e.recutR, e.leader, e.leaderDot, e.readout]
    const resetCut = () => {
      for (const an of anims) an.cancel()
      anims = []
      for (const el of cutParts()) el.style.opacity = '0'
      cut = false
    }
    /** removal: a 120 ms fade, then the parts wait uncut for the next place */
    const fadeOutCut = () => {
      if (!cut) {
        resetCut()
        return
      }
      for (const an of anims) an.cancel()
      anims = []
      for (const el of cutParts()) {
        el.style.opacity = '1'
        anims.push(el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: EASE_OUT, fill: 'forwards' }))
      }
      cut = false
    }
    const runCut = () => {
      for (const an of anims) an.cancel()
      anims = []
      for (const el of cutParts()) el.style.opacity = '1'
      cut = true
      if (reducedRef.current) return
      anims.push(drawOn(e.setTickGroove, 160, 0), drawOn(e.setTick, 160, 0))
      anims.push(drawOn(e.recutL, 500, 160), drawOn(e.recutR, 500, 160))
      anims.push(drawOn(e.leader, 220, 660), fadeIn(e.leaderDot, 120, 820))
      anims.push(fadeIn(e.readout, 180, 880))
    }
    const runNeatCut = () => {
      for (const an of neatAnims) an.cancel()
      neatAnims = []
      if (reducedRef.current) return
      neatAnims.push(drawOn(e.neatOuterGroove, 600, 0), drawOn(e.neatOuter, 600, 0), drawOn(e.neatInner, 600, 60))
      neatAnims.push(fadeIn(e.neatTicks, 240, 520))
    }
    resetCut()

    const unsub = subscribeFrame((rawDt) => {
      const t0 = performance.now()
      const dt = Math.min(Math.max(rawDt, 0), 0.05)
      const reducedNow = reducedRef.current
      const L = instrumentLayout
      const F: FreeRect = { x0: L.free.x0, y0: L.free.y0, x1: L.free.x1, y1: L.free.y1 }
      // the neatline insets below the nav ruler; the band above it is a steel head
      // margin that backs the nav over the paint (review: frame/labels ran under the nav)
      const FN: FreeRect =
        navRect && navRect.x1 > F.x0 && navRect.x0 < F.x1 && navRect.y0 < F.y0 + 24
          ? { x0: F.x0, y0: Math.max(F.y0, navRect.y1 + NAV_GAP), x1: F.x1, y1: F.y1 }
          : F
      const W = g.viewport.w
      const H = g.viewport.h
      const cx = a.globeCenterPx[0]
      const cy = a.globeCenterPx[1]
      const R = a.radiusPx
      const geom = L.limb
      const stage = a.limbStage
      const mobile = L.mobile

      // -- free-area clip: nothing crosses the travel column --
      const clipX0 = F.x0 > 0 ? F.x0 + 6 : 0
      const clipY1 = stage !== 'full' ? F.y1 : H
      const clipKey = `${clipX0}|${clipY1}|${W}`
      if (clipKey !== wClip) {
        wClip = clipKey
        e.clipRect.setAttribute('x', String(clipX0))
        e.clipRect.setAttribute('y', '0')
        e.clipRect.setAttribute('width', String(Math.max(0, W - clipX0)))
        e.clipRect.setAttribute('height', String(Math.max(0, clipY1)))
        e.html.style.clipPath = `inset(0 0 ${Math.max(0, H - clipY1)}px ${clipX0}px)`
      }

      // -- section and stage fades --
      const sec = limbOpacityAt(g)
      // numerals, fiducial and meridian readout belong to the full limb only: in work and
      // contact the limb rests as a dimmed ring of ticks (finish review)
      const full = limbFullAt(g)
      const wordsK = sec > 0 ? Math.min(1, full / sec) : 0
      const fadeStep = dt / (reducedNow ? 0.12 : 0.24)
      const wantLimb = stage === 'neatline' ? 0 : 1
      stageLimb = stageLimb < wantLimb ? Math.min(wantLimb, stageLimb + fadeStep) : Math.max(wantLimb, stageLimb - fadeStep)
      stageNeat = stageNeat < 1 - wantLimb ? Math.min(1, stageNeat + fadeStep) : Math.max(1 - wantLimb, stageNeat - fadeStep)
      if (stage !== lastStage) {
        if (stage === 'neatline') {
          wNeatKey = ''
          runNeatCut()
        }
        lastStage = stage
      }
      if (stageLimb <= 0) limbFaded = true
      else if (limbFaded && stage !== 'neatline') {
        // zooming out: the limb re-cuts (600 ms) only if it had fully faded
        limbFaded = false
        if (!reducedNow) {
          sweep = 0
          sweepRate = 1 / 0.6
        }
      }

      // -- the load sweep: bound to real texture progress, a burin's pace at most --
      if (reducedNow) {
        sweep = 1
        sweepDone = true
      } else {
        const target = sweepDone ? 1 : a.loadProgress
        if (sweep < target) sweep = Math.min(target, sweep + dt * sweepRate)
        if (sweep >= 0.999) {
          sweep = 1
          if (!sweepDone) sweepDone = true
          sweepRate = 1 / 0.9
        }
      }
      if (a.travelArmSeq !== lastArmSeq) {
        lastArmSeq = a.travelArmSeq
        // the one-shot travel engrave (armed at travelIn 0.5, re-armed below 0.2)
        if (sweepDone && !reducedNow) {
          sweep = 0
          sweepRate = 1 / 0.9
        }
      }

      // -- LIMB --
      const limbAlpha = sec * stageLimb
      if (Math.abs(limbAlpha - wLimbAlpha) > 0.004 || (limbAlpha === 0) !== (wLimbAlpha === 0)) {
        if ((limbAlpha <= 0) !== (wLimbAlpha <= 0)) show(e.limbLayer, limbAlpha > 0)
        wLimbAlpha = limbAlpha
        e.limbLayer.setAttribute('opacity', limbAlpha.toFixed(3))
      }
      const wordsA = wordsK.toFixed(3)
      if (wordsA !== wWordsA) {
        if ((wordsK <= 0.001) !== (Number(wWordsA) <= 0.001)) {
          show(e.numeralsG, wordsK > 0.001)
          show(e.fiducial, wordsK > 0.001)
        }
        wWordsA = wordsA
        e.numeralsG.setAttribute('opacity', wordsA)
        e.fiducial.setAttribute('opacity', wordsA)
      }
      const rimR = R + geom.rim
      const rot = -a.lambdaC
      if (limbAlpha > 0) {
        if (moved(cx, wCx, 0.1) || moved(cy, wCy, 0.1)) {
          wCx = cx
          wCy = cy
          e.limbFixed.setAttribute('transform', `translate(${cx.toFixed(2)} ${cy.toFixed(2)})`)
        }
        if (moved(R, wR, 0.1) || builtGeom !== geom) {
          wR = R
          e.seat.setAttribute('r', R.toFixed(2))
          e.seat2.setAttribute('r', (R + geom.seat).toFixed(2))
          e.fillet.setAttribute('r', (R + geom.fillet).toFixed(2))
          e.fillet2.setAttribute('r', (R + geom.fillet2).toFixed(2))
          const rp = circlePath(rimR)
          e.rim.setAttribute('d', rp)
          e.rimGroove.setAttribute('d', rp)
        }
        // ticks + numerals: constant px lengths, rebuilt when R moves > 0.5 px
        if (moved(R, builtR, 0.5) || builtGeom !== geom) {
          builtR = R
          builtGeom = geom
          const t = buildTicks(R, geom)
          e.minor.setAttribute('d', t.minor)
          e.mid.setAttribute('d', t.mid)
          e.major.setAttribute('d', t.major)
          e.majorGroove.setAttribute('d', t.major)
          const step = numeralStep(R, geom)
          if (step !== numStep) {
            numStep = step
            for (let i = 0; i < NUMERALS; i++) {
              const n = numerals.current[i]
              if (n) show(n, (i * 10) % step === 0)
            }
          }
          numFlip.fill(-1)
          recutR = NaN
        }
        if (moved(rot, wRot, 0.05)) {
          wRot = rot
          const r = rot.toFixed(3)
          e.rotG.setAttribute('transform', `rotate(${r})`)
          e.rotGroove.setAttribute('transform', `translate(-0.5 -0.5) rotate(${r})`)
        }
        // numerals: read upright on screen, and step back (30%) within ±6° of the blade
        const bladeCw = a.activeIndex >= 0 && aliVis > 0 ? a.alidadeAngle / DEG + 90 : NaN
        for (let i = 0; i < NUMERALS; i += Math.max(1, numStep / 10)) {
          const n = numerals.current[i]
          if (!n) continue
          const scr = i * 10 + wRot
          const flip = Math.cos(scr * DEG) < 0 ? 1 : 0
          if (flip !== numFlip[i]) {
            numFlip[i] = flip
            n.setAttribute('transform', numeralTransform(i * 10, builtR, geom, flip === 1))
          }
          const dim = Number.isFinite(bladeCw) && Math.abs(wrap180(scr - bladeCw)) < 6 ? 1 : 0
          if (dim !== numDim[i]) {
            numDim[i] = dim
            n.setAttribute('opacity', dim ? '0.3' : '1')
          }
        }
        // the load sweep clips the whole limb (screen-fixed wedge from the fiducial)
        if (sweep < 1) {
          if (Math.abs(sweep - wSweep) > 0.001) {
            if (wSweep >= 1 || wSweep < 0) e.sweepG.setAttribute('clip-path', 'url(#ins-sweep)')
            wSweep = sweep
            e.sweepPath.setAttribute('d', sweepWedge(sweep, rimR + 40))
          }
        } else if (wSweep !== 1) {
          wSweep = 1
          e.sweepG.removeAttribute('clip-path')
        }
        // fiducial (12 o'clock, or the middle of the visible arc) and the meridian readout
        const fa = a.fiducialAngle
        const fr = R + geom.fiducial
        const fx = cx + Math.cos(fa) * fr
        const fy = cy + Math.sin(fa) * fr
        const fid = `${fx.toFixed(1)}|${fy.toFixed(1)}|${fa.toFixed(3)}`
        if (fid !== wFid) {
          wFid = fid
          e.fiducial.setAttribute('transform', `translate(${fx.toFixed(2)} ${fy.toFixed(2)})`)
          const rotT = `rotate(${(fa / DEG - 90).toFixed(2)})`
          e.fidGroove.setAttribute('transform', rotT)
          e.fidFill.setAttribute('transform', rotT)
          const mr = fr + 18
          const mx = cx + Math.cos(fa) * mr
          const my = cy + Math.sin(fa) * mr
          const pos = `translate3d(${mx.toFixed(1)}px, ${my.toFixed(1)}px, 0) translate(-50%, -50%)`
          if (pos !== wMerPos) {
            wMerPos = pos
            e.meridian.style.transform = pos
          }
        }
        const mer = meridian(a.lambdaC)
        if (mer !== wMer) {
          wMer = mer
          const kids: (Node | string)[] = []
          for (const ch of mer) {
            if (ch >= '0' && ch <= '9') {
              const s = document.createElement('span')
              s.className = 'tnum-d'
              s.textContent = ch
              kids.push(s)
            } else kids.push(ch)
          }
          e.meridian.replaceChildren(...kids)
        }
      }
      const merA = limbAlpha > 0 ? (limbAlpha * wordsK).toFixed(3) : '0'
      if (merA !== wMerA) {
        wMerA = merA
        e.meridian.style.opacity = merA
      }

      // -- ALIDADE --
      const ai = a.activeIndex
      if (ai !== lastActive) {
        if (lastActive >= 0) fadeOutCut()
        else resetCut()
        lastActive = ai
        pendingCut = ai >= 0
        lastSettled = false
      }
      const hasPin = ai >= 0 && a.activePx !== null
      const aliStep = reducedNow ? 1 : dt / 0.18
      aliVis = hasPin ? Math.min(1, aliVis + aliStep) : Math.max(0, aliVis - aliStep)
      let mx = 0
      let my = 0
      let pxA = 0
      let pyA = 0
      if (a.activePx) {
        pxA = a.activePx[0] // copy: the anchors arrays are reused every frame
        pyA = a.activePx[1]
      }
      const ang = a.alidadeAngle
      if (a.limbMarkPx) {
        mx = a.limbMarkPx[0]
        my = a.limbMarkPx[1]
      } else {
        mx = cx + Math.cos(ang) * rimR
        my = cy + Math.sin(ang) * rimR
      }
      const markIn =
        stage === 'full' ||
        (stage === 'arc' && mx >= FN.x0 + 12 && mx <= FN.x1 - 12 && my >= FN.y0 + 12 && my <= FN.y1 - 12)
      const aliAlpha = aliVis * sec * stageLimb * (markIn ? 1 : 0)
      if (Math.abs(aliAlpha - wAliAlpha) > 0.004 || (aliAlpha === 0) !== (wAliAlpha === 0)) {
        if ((aliAlpha <= 0) !== (wAliAlpha <= 0)) show(e.aliLayer, aliAlpha > 0)
        wAliAlpha = aliAlpha
        e.aliLayer.setAttribute('opacity', aliAlpha.toFixed(3))
      }
      if (aliAlpha > 0) {
        if (aliShapeGeom !== geom) {
          aliShapeGeom = geom
          const s = alidadeShape(geom)
          e.blade.setAttribute('d', s.blade)
          e.pinnule.setAttribute('d', s.pinnule)
          e.stub.setAttribute('d', s.stub)
          e.setTick.setAttribute('d', s.setTick)
          e.setTickGroove.setAttribute('d', s.setTick)
        }
        const angDeg = ang / DEG
        const t = `translate(${cx.toFixed(2)} ${cy.toFixed(2)}) rotate(${angDeg.toFixed(3)}) translate(${R.toFixed(2)} 0)`
        if (t !== wAli) {
          wAli = t
          e.aliG.setAttribute('transform', t)
        }
        const occ = a.activeOcculted ? 1 : 0
        if (occ !== wOcc) {
          wOcc = occ
          show(e.blade, !occ)
          show(e.pinnule, !occ)
          show(e.hair, !occ)
          show(e.hairUnder, !occ)
          show(e.stub, !!occ)
        }
        if (!occ) {
          const u = Math.hypot(pxA - cx, pyA - cy) - R
          const h = hairlinePath(u)
          if (h !== wHair) {
            wHair = h
            e.hair.setAttribute('d', h)
            e.hairUnder.setAttribute('d', h)
          }
        }
        // the ±5° re-cut lives in the limb frame (it marks the scale's own ticks)
        const localDeg = angDeg + 90 + a.lambdaC
        if (moved(wrap180(localDeg - recutDeg), 0, 0.25) || moved(builtR, recutR, 0.5)) {
          recutDeg = localDeg
          recutR = builtR
          const rc = buildRecut(((localDeg % 360) + 360) % 360, builtR, geom)
          e.recutL.setAttribute('d', rc.left)
          e.recutR.setAttribute('d', rc.right)
        }
      }

      // -- settle edge → the engrave timeline --
      const settled = a.activeSettled
      if (settled && !lastSettled && pendingCut && ai >= 0) {
        pendingCut = false
        runCut()
      }
      lastSettled = settled

      // -- LEADER + READOUT --
      const edgeMode = stage === 'neatline' || (stage === 'arc' && !markIn)
      let readAlpha = 0
      let pl: Placement | null = null
      if (hasPin && !mobile) {
        if (edgeMode) {
          const ep = placeEdge(pxA, pyA, frameRects(FN).inner, shared.current.block, FN, g.pinsPx, ai, edgeSide)
          edgeSide = ep.side
          pl = ep
          readAlpha = sec * (stage === 'neatline' ? stageNeat : 1) * pl.alpha
        } else {
          pl = placeRim(mx, my, ang, shared.current.block, stage === 'full' ? F : FN, a.readoutSide === 'below')
          readAlpha = aliAlpha
        }
      }
      if (Math.abs(readAlpha - wReadAlpha) > 0.004 || (readAlpha === 0) !== (wReadAlpha === 0)) {
        if ((readAlpha <= 0) !== (wReadAlpha <= 0)) {
          show(e.leaderLayer, readAlpha > 0)
          showV(e.readout, readAlpha > 0)
        }
        wReadAlpha = readAlpha
        e.leaderLayer.setAttribute('opacity', readAlpha.toFixed(3))
        e.readout.style.setProperty('--ins-read-a', readAlpha.toFixed(3))
      }
      // labels yield to the readout (published for C4's declutter)
      readoutBox.on = !!pl && readAlpha > 0.3
      if (pl && readoutBox.on) {
        const below = pl.kind === 'below'
        const bs = shared.current.block
        readoutBox.x0 = pl.x - 4
        readoutBox.y0 = Math.min(pl.y, pl.ey) - 4
        readoutBox.x1 = pl.x + (below ? bs.lineW : bs.w) + 4
        readoutBox.y1 = Math.max(pl.y + (below ? bs.lineH : bs.h), pl.ey) + 4
      }
      if (pl && readAlpha > 0) {
        if (pl.leader !== wLeader) {
          wLeader = pl.leader
          e.leader.setAttribute('d', pl.leader)
          e.leaderDot.setAttribute('cx', pl.ex.toFixed(2))
          e.leaderDot.setAttribute('cy', pl.ey.toFixed(2))
        }
        if (pl.kind !== wKind) {
          wKind = pl.kind
          showV(e.readoutBlock, pl.kind !== 'below')
          showV(e.readoutLine, pl.kind === 'below')
        }
        const pos = `translate3d(${pl.x.toFixed(1)}px, ${pl.y.toFixed(1)}px, 0)`
        if (pos !== wReadPos) {
          wReadPos = pos
          e.readout.style.transform = pos
        }
      }

      // -- STEEL HEAD under the nav: once the disc overflows the free area (arc / neatline)
      // neatline: a steel mat around the whole frame (no paint strip between the column
      // plate and the frame); arc: the head band only, closed by a worn-gilt edge rule
      const matOn = stage === 'neatline'
      const headY = (FN.y0 + NEAT_INSET).toFixed(1)
      let headKey = 'M0,0'
      if (matOn) {
        const o = frameRects(FN).outer
        headKey = `M${F.x0},${F.y0}H${F.x1}V${F.y1}H${F.x0}Z` + `M${o.x0},${o.y0}V${o.y1}H${o.x1}V${o.y0}Z`
      } else if (FN.y0 > F.y0) headKey = `M${F.x0},${F.y0}H${F.x1}V${headY}H${F.x0}Z`
      if (headKey !== wHead) {
        wHead = headKey
        e.neatHead.setAttribute('d', headKey)
        e.neatHeadRule.setAttribute('d', FN.y0 > F.y0 ? `M${F.x0},${(FN.y0 + NEAT_INSET - 0.5).toFixed(1)}H${F.x1}` : 'M0,0')
      }
      const wantHead = stage === 'full' || headKey === 'M0,0' ? 0 : sec
      headA = headA < wantHead ? Math.min(wantHead, headA + fadeStep) : Math.max(wantHead, headA - fadeStep)
      const ruleA = headA * (1 - stageNeat)
      if (Math.abs(headA - wHeadA) > 0.004 || (headA === 0) !== (wHeadA === 0) || Math.abs(ruleA - wRuleA) > 0.004) {
        if ((headA <= 0) !== (wHeadA <= 0)) show(e.neatHead, headA > 0)
        if ((ruleA <= 0) !== (wRuleA <= 0)) show(e.neatHeadRule, ruleA > 0)
        wHeadA = headA
        wRuleA = ruleA
        e.neatHead.setAttribute('opacity', headA.toFixed(3))
        e.neatHeadRule.setAttribute('opacity', ruleA.toFixed(3))
      }

      // -- NEATLINE --
      const neatAlpha = sec * stageNeat
      if (Math.abs(neatAlpha - wNeatAlpha) > 0.004 || (neatAlpha === 0) !== (wNeatAlpha === 0)) {
        if ((neatAlpha <= 0) !== (wNeatAlpha <= 0)) show(e.neatLayer, neatAlpha > 0)
        wNeatAlpha = neatAlpha
        e.neatLayer.setAttribute('opacity', neatAlpha.toFixed(3))
      }
      neatGuard.on = neatAlpha > 0.3
      if (neatAlpha > 0) {
        const nl = a.neatline
        // the readout's x span: top numerals under it are dropped (they collided)
        const readSpan: FreeRect | null =
          pl && readAlpha > 0 && pl.kind === 'edge' && edgeSide === 'top' ? { x0: pl.x, y0: 0, x1: pl.x + shared.current.block.w, y1: pl.y } : null
        const key = `${FN.x0}|${FN.y0}|${FN.x1}|${FN.y1}|${readSpan ? Math.round(readSpan.x0 / 4) : -1}`
        if (a.camChanged || key !== wNeatKey) {
          if (key !== wNeatKey) {
            const { outer, inner } = frameRects(FN)
            const op = rectPath(outer)
            e.neatOuter.setAttribute('d', op)
            e.neatOuterGroove.setAttribute('d', op)
            e.neatInner.setAttribute('d', rectPath(inner))
          }
          wNeatKey = key
          const t = buildNeatTicks(nl.edges, nl.interval, nl.horizonNotches, FN, readSpan, g.pinsPx)
          // names keep inside the inner hairline, clear of the hanging majors, and off
          // the numerals (published for C4's declutter; finish review)
          const { inner: fin } = frameRects(FN)
          neatGuard.x0 = fin.x0 + NEAT_TICK_CLEAR
          neatGuard.y0 = fin.y0 + NEAT_TICK_CLEAR
          neatGuard.x1 = fin.x1 - NEAT_TICK_CLEAR
          neatGuard.y1 = fin.y1 - NEAT_TICK_CLEAR
          const nb = neatGuard.boxes
          nb.length = 0
          for (const lab of t.labels) {
            const w = (lab.num.length + (lab.hemi ? 2 : 0)) * 6.6 + 6
            const x0 = lab.edge === 'top' ? lab.x - w / 2 : lab.x - 3
            nb.push(x0 - 4, lab.y - 9, x0 + w + 4, lab.y + 9)
          }
          e.neatMajor.setAttribute('d', t.major)
          e.neatMajorGroove.setAttribute('d', t.major)
          e.neatMinor.setAttribute('d', t.minor)
          e.neatNotch.setAttribute('d', t.notch)
          for (let i = 0; i < NEAT_LABELS; i++) {
            const n = neatLabels.current[i]
            if (!n) continue
            const lab = t.labels[i]
            if (!lab) {
              if (n.style.display !== 'none') n.style.display = 'none'
              continue
            }
            n.style.display = ''
            n.setAttribute('x', lab.x.toFixed(1))
            n.setAttribute('y', lab.y.toFixed(1))
            n.setAttribute('text-anchor', lab.edge === 'top' ? 'middle' : 'start')
            const [num, hemi] = n.children
            if (num.textContent !== lab.num) num.textContent = lab.num
            const h = lab.hemi ? ` ${lab.hemi}` : ''
            if (hemi.textContent !== h) hemi.textContent = h
          }
        }
        const marks = hasPin ? activeMarks(pxA, pyA, FN) : 'M0,0'
        if (marks !== wMarks) {
          wMarks = marks
          e.neatMarks.setAttribute('d', marks)
        }
      }

      // -- HOVER LABEL --
      const hi = a.hoverIndex
      const hoverOn = hi >= 0 && hi !== ai && a.hoverPx !== null
      const hoverAlpha = hoverOn ? a.hoverVisible * (1 - g.dim) : 0
      if (Math.abs(hoverAlpha - wHoverAlpha) > 0.01 || (hoverAlpha === 0) !== (wHoverAlpha === 0)) {
        if ((hoverAlpha <= 0) !== (wHoverAlpha <= 0)) {
          show(e.hoverLeader, hoverAlpha > 0)
          showV(e.hover, hoverAlpha > 0)
        }
        wHoverAlpha = hoverAlpha
        e.hoverLeader.setAttribute('opacity', hoverAlpha.toFixed(3))
        e.hover.style.opacity = hoverAlpha.toFixed(3)
      }
      if (hoverOn && hoverAlpha > 0 && a.hoverPx) {
        const hx = a.hoverPx[0]
        const hy = a.hoverPx[1]
        const hp = placeHover(hx, hy, shared.current.hoverW, F)
        if (hp.leader !== wHoverPos || hi !== wHoverIdx) {
          wHoverPos = hp.leader
          wHoverIdx = hi
          e.hoverLeader.setAttribute('d', hp.leader)
          e.hover.style.transform = `translate3d(${hp.x.toFixed(1)}px, ${hp.y.toFixed(1)}px, 0)`
          if (hp.dir !== wHoverDir) {
            wHoverDir = hp.dir
            e.hover.toggleAttribute('data-left', hp.dir < 0)
          }
        }
      }

      // -- VIEW CONTROLS (desktop travel) --
      const vc = controlsRef.current
      if (vc) {
        const on = g.travelIn > 0.55 && !mobile
        const shown = on && g.lod.zoom01 > 0.05
        const ck = `${on ? 1 : 0}${shown ? 1 : 0}`
        if (ck !== wCtrl) {
          wCtrl = ck
          vc.toggleAttribute('data-on', on)
          vc.toggleAttribute('data-shown', shown)
        }
      }

      const c = performance.now() - t0
      costSum += c
      costN++
      if (c > costMax) costMax = c
    })

    registerDebug('overlay', () => {
      const out = {
        frames: costN,
        avgMs: costN ? costSum / costN : 0,
        maxMs: costMax,
        sweep,
        stageLimb,
        stageNeat,
        cut,
        aliVis,
        limbAlpha: wLimbAlpha,
        seat: { cx: wCx, cy: wCy, r: wR },
      }
      costSum = 0
      costN = 0
      costMax = 0
      return out
    })

    return () => {
      unsub()
      readoutBox.on = false
      neatGuard.on = false
      window.removeEventListener('resize', readNav)
      for (const an of anims) an.cancel()
      for (const an of neatAnims) an.cancel()
    }
  }, [])

  return (
    <div className="instrument-overlay" data-reduced={reduced ? '' : undefined}>
      <svg ref={ref('svg')} className="instrument" width="100%" height="100%" aria-hidden="true" focusable="false">
        <defs>
          <clipPath id="ins-free" clipPathUnits="userSpaceOnUse">
            <rect ref={ref('clipRect')} x="0" y="0" width="0" height="0" />
          </clipPath>
          <clipPath id="ins-sweep" clipPathUnits="userSpaceOnUse">
            <path ref={ref('sweepPath')} d="M0,0Z" />
          </clipPath>
        </defs>
        <g clipPath="url(#ins-free)">
          {/* NEATLINE (deep zoom) */}
          <g ref={ref('neatLayer')} className="ins-neat" style={{ display: 'none' }}>
            <path ref={ref('neatOuterGroove')} className="incise ins-draw" strokeWidth={1.5} transform="translate(-0.5 -0.5)" pathLength={1} />
            <path ref={ref('neatOuter')} className="tone-gilt ins-draw" strokeWidth={1} pathLength={1} />
            <path ref={ref('neatInner')} className="tone-gilt-worn ins-draw" strokeWidth={1} pathLength={1} />
            <g ref={ref('neatTicks')}>
              <path ref={ref('neatMajorGroove')} className="incise" strokeWidth={1.75} transform="translate(-0.5 -0.5)" />
              <path ref={ref('neatMajor')} className="tone-gilt" strokeWidth={1.25} />
              <path ref={ref('neatMinor')} className="tone-gilt-2" strokeWidth={0.75} />
              <path ref={ref('neatNotch')} className="tone-gilt-2" strokeWidth={1} />
              <g className="ins-neat-labels">
                {Array.from({ length: NEAT_LABELS }, (_, i) => (
                  <text key={i} ref={(n) => void (neatLabels.current[i] = n)} style={{ display: 'none' }}>
                    <tspan className="ins-num" />
                    <tspan className="ins-hemi" />
                  </text>
                ))}
              </g>
            </g>
            <path ref={ref('neatMarks')} className="ins-vermilion-cut" strokeWidth={1.5} d="M0,0" />
          </g>

          {/* LIMB */}
          <g ref={ref('limbLayer')} className="ins-limb" style={{ display: 'none' }}>
            <g ref={ref('limbFixed')}>
              <g ref={ref('sweepG')}>
                <circle ref={ref('seat')} className="incise" strokeWidth={1} r="1" />
                <circle ref={ref('seat2')} className="tone-gilt-worn" strokeWidth={0.75} r="1" />
                <circle ref={ref('fillet')} className="tone-gilt-2" strokeWidth={0.75} r="1" />
                <circle ref={ref('fillet2')} className="tone-gilt-worn" strokeWidth={0.75} r="1" />
                <g ref={ref('rotGroove')}>
                  <path ref={ref('majorGroove')} className="incise" strokeWidth={1.75} />
                </g>
                <path ref={ref('rimGroove')} className="incise" strokeWidth={2} transform="translate(-0.5 -0.5)" />
                <path ref={ref('rim')} className="tone-gilt" strokeWidth={1.25} />
                <g ref={ref('rotG')}>
                  <path ref={ref('minor')} className="tone-gilt-2" strokeWidth={0.75} />
                  <path ref={ref('mid')} className="tone-gilt" strokeWidth={1} />
                  <path ref={ref('major')} className="tone-gilt" strokeWidth={1.25} />
                  <g ref={ref('numeralsG')} className="ins-numerals">
                    {Array.from({ length: NUMERALS }, (_, i) => (
                      <text key={i} ref={(n) => void (numerals.current[i] = n)}>
                        {i * 10}
                      </text>
                    ))}
                  </g>
                  {/* the ±5° re-cut on arrival (timeline) */}
                  <path ref={ref('recutL')} className="tone-gilt ins-draw" strokeWidth={1} pathLength={1} />
                  <path ref={ref('recutR')} className="tone-gilt ins-draw" strokeWidth={1} pathLength={1} />
                </g>
              </g>
            </g>
            <g ref={ref('fiducial')}>
              <g transform="translate(-0.5 -0.5)">
                <path ref={ref('fidGroove')} className="incise" d={FIDUCIAL_EDGE} fill="none" strokeWidth={0.75} />
              </g>
              <path ref={ref('fidFill')} className="fill-gilt" d={FIDUCIAL_FILL} stroke="none" />
            </g>
          </g>

        </g>
        {/* the steel head margin under the nav ruler (arc) / the steel mat around the
            neatline frame: unclipped, so it meets the column plate with no paint strip */}
        <path ref={ref('neatHead')} className="ins-neat-head" d="M0,0" fillRule="evenodd" style={{ display: 'none' }} />
        <path ref={ref('neatHeadRule')} className="tone-gilt-worn" d="M0,0" strokeWidth={1} style={{ display: 'none' }} />
        <g clipPath="url(#ins-free)">

          {/* ALIDADE */}
          <g ref={ref('aliLayer')} className="ins-alidade" style={{ display: 'none' }}>
            <g ref={ref('aliG')}>
              <path ref={ref('hairUnder')} className="incise" strokeWidth={1} strokeOpacity={0.6} />
              <path ref={ref('hair')} className="ins-vermilion-cut" strokeWidth={0.75} />
              <path ref={ref('stub')} className="ins-vermilion-cut" strokeWidth={1} strokeDasharray="2 3" style={{ display: 'none' }} />
              <path ref={ref('blade')} className="ins-blade" strokeWidth={0.75} />
              <path ref={ref('pinnule')} className="ins-blade" strokeWidth={0.75} />
              <g ref={ref('cutG')}>
                <path ref={ref('setTickGroove')} className="incise ins-draw" strokeWidth={2.5} pathLength={1} />
                <path ref={ref('setTick')} className="ins-vermilion-cut ins-draw" strokeWidth={1.5} pathLength={1} />
              </g>
            </g>
          </g>
          <g ref={ref('leaderLayer')} className="ins-leader" style={{ display: 'none' }}>
            <path ref={ref('leader')} className="tone-silver-3 ins-draw" strokeWidth={1} pathLength={1} />
            <circle ref={ref('leaderDot')} className="fill-silver-3" r="1" stroke="none" />
          </g>

          {/* HOVER */}
          <path ref={ref('hoverLeader')} className="tone-silver-3" strokeWidth={0.75} style={{ display: 'none' }} />
        </g>
      </svg>

      <div ref={ref('html')} className="ins-html">
        <div ref={ref('meridian')} className="ins-meridian data" />
        <div ref={ref('readout')} className="ins-readout" style={{ visibility: 'hidden' }}>
          <ReadoutContent shared={shared} blockRef={ref('readoutBlock')} lineRef={ref('readoutLine')} />
        </div>
        <div ref={ref('hover')} className="ins-hover" style={{ visibility: 'hidden' }}>
          <HoverContent shared={shared} />
        </div>
      </div>

      <ViewControls rootRef={controlsRef} />
    </div>
  )
}
