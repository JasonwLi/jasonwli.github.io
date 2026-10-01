import { useEffect, useRef, useState } from 'react'
import { locations, type TravelLocation } from '../data/travel'
import { useSite } from '../state/store'
import { choreography, limbReach, limbOpacityAt } from '../theme/choreography'
import { Engraved } from './Engraved'

/**
 * The static globe for when WebGL is unavailable or lost (theme spec, loading,
 * empty and error states): a DOM SVG orthographic globe. Coastlines
 * (src/data/coastlines.json, loaded lazily so the 128 KB JSON never rides in the
 * entry chunk) at 0.75 px --silver-3, a 15° --gilt-worn graticule, a flat
 * --steel-field disc, pins in the ring language (dashed for photo-less places,
 * vermilion core for the active one), inside the same engraved limb. It sits
 * where the choreography table puts the globe for the current scroll position,
 * and drag rotates it by re-projecting.
 *
 * The SVG is aria-hidden like the canvas it replaces: the place index is the
 * accessible path. Pins are pointer targets that open the gallery.
 */
const D2R = Math.PI / 180
const MOBILE = '(max-width: 860px)'
const PIN_R = 5

type Segs = number[]

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** 15° graticule as [lat, lon, lat, lon] segments, 3° steps */
function graticule(): Segs {
  const s: Segs = []
  for (let lon = -180; lon < 180; lon += 15) for (let lat = -90; lat < 90; lat += 3) s.push(lat, lon, lat + 3, lon)
  for (let lat = -75; lat <= 75; lat += 15) for (let lon = -180; lon < 180; lon += 3) s.push(lat, lon, lat, lon + 3)
  return s
}
const GRATICULE = graticule()

/** orthographic projection on the unit disc (screen y down); null on the far side */
function makeProjector(lat0: number, lon0: number) {
  const sp0 = Math.sin(lat0 * D2R)
  const cp0 = Math.cos(lat0 * D2R)
  return (lat: number, lon: number, out: [number, number]) => {
    const p = lat * D2R
    const dl = (lon - lon0) * D2R
    const cp = Math.cos(p)
    const sp = Math.sin(p)
    const cdl = Math.cos(dl)
    if (sp0 * sp + cp0 * cp * cdl < 0) return false
    out[0] = cp * Math.sin(dl)
    out[1] = -(cp0 * sp - sp0 * cp * cdl)
    return true
  }
}

function pathOf(segs: Segs, proj: ReturnType<typeof makeProjector>) {
  const a: [number, number] = [0, 0]
  const b: [number, number] = [0, 0]
  let d = ''
  for (let i = 0; i < segs.length; i += 4) {
    if (!proj(segs[i], segs[i + 1], a) || !proj(segs[i + 2], segs[i + 3], b)) continue
    d += `M${a[0].toFixed(4)},${a[1].toFixed(4)}L${b[0].toFixed(4)},${b[1].toFixed(4)}`
  }
  return d
}

/** the limb in miniature: ticks every 10° between the tick radii, majors every 30° */
function limbTicks(rIn: number, rOut: number) {
  let d = ''
  for (let a = 0; a < 360; a += 10) {
    const t = a * D2R
    const r0 = a % 30 === 0 ? rIn - 3 : rIn
    d += `M${(Math.cos(t) * r0).toFixed(2)},${(Math.sin(t) * r0).toFixed(2)}L${(Math.cos(t) * rOut).toFixed(2)},${(Math.sin(t) * rOut).toFixed(2)}`
  }
  return d
}
const ringD = (r: number) => `M${r},0A${r},${r} 0 1 1 ${-r},0A${r},${r} 0 1 1 ${r},0`

export default function FallbackGlobe() {
  const active = useSite((s) => s.active)
  const [coast, setCoast] = useState<Segs | null>(null)
  const [view, setView] = useState({ lat: 25, lon: 45 })
  const [frame, setFrame] = useState({ cx: 0, cy: 0, R: 1, dim: 0, limb: 1 })
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ x: number; y: number; lat: number; lon: number; id: number } | null>(null)

  useEffect(() => {
    let alive = true
    import('../data/coastlines.json')
      .then((m) => {
        if (alive) setCoast(m.default as Segs)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // the choreography table, lerped by scroll exactly as CameraRig does
  useEffect(() => {
    let raf = 0
    const update = () => {
      raf = 0
      const w = window.innerWidth
      const h = window.innerHeight
      const mobile = window.matchMedia(MOBILE).matches
      const col = document.querySelector<HTMLElement>('.travel-col')
      const ctx = { w, h, mobile, colRightPx: mobile ? 0 : (col?.getBoundingClientRect().right ?? 0) }
      const top = (id: string) => document.getElementById(id)?.getBoundingClientRect().top ?? h
      const workIn = easeInOut(clamp01((h * 0.85 - top('work')) / (h * 0.6)))
      const travelIn = easeInOut(clamp01((h * 0.9 - top('travel')) / (h * 0.65)))
      const footIn = easeInOut(clamp01((h * 0.75 - top('contact')) / (h * 0.55)))
      const hero = choreography('hero', ctx)
      const work = choreography('work', ctx)
      const travel = choreography('travel', ctx)
      const foot = choreography('footer', ctx)
      let cx = lerp(hero.centerPx[0], work.centerPx[0], workIn)
      let cy = lerp(hero.centerPx[1], work.centerPx[1], workIn)
      let R = lerp(hero.Rpx, work.Rpx, workIn)
      let dim = lerp(hero.dim, work.dim, workIn)
      cx = lerp(cx, travel.centerPx[0], travelIn)
      cy = lerp(cy, travel.centerPx[1], travelIn)
      R = lerp(R, travel.Rpx, travelIn)
      dim = lerp(lerp(dim, travel.dim, travelIn), foot.dim, footIn)
      setFrame({ cx, cy, R, dim, limb: limbOpacityAt({ workIn, travelIn, footIn }) })
    }
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', kick, { passive: true })
    window.addEventListener('resize', kick)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', kick)
      window.removeEventListener('resize', kick)
    }
  }, [])

  const proj = makeProjector(view.lat, view.lon)
  const coastD = coast ? pathOf(coast, proj) : ''
  const gratD = pathOf(GRATICULE, proj)
  const reach = limbReach(frame.R)
  const pt: [number, number] = [0, 0]

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const dx = e.clientX - frame.cx
    const dy = e.clientY - frame.cy
    if (dx * dx + dy * dy > (frame.R + reach) ** 2) return
    drag.current = { x: e.clientX, y: e.clientY, lat: view.lat, lon: view.lon, id: e.pointerId }
    svgRef.current?.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const degPerPx = 90 / frame.R
    const lon = d.lon - (e.clientX - d.x) * degPerPx
    const lat = e.pointerType === 'touch' ? d.lat : Math.max(-80, Math.min(80, d.lat + (e.clientY - d.y) * degPerPx))
    setView({ lat, lon: ((lon + 540) % 360) - 180 })
  }
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null
  }

  const pick = (loc: TravelLocation) => useSite.getState().setActive(loc)

  return (
    <div className="globe-canvas fallback-globe" style={{ opacity: 1 - frame.dim * 0.8 }}>
      <svg
        ref={svgRef}
        className="fallback-globe-svg"
        width="100%"
        height="100%"
        aria-hidden="true"
        focusable="false"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <g transform={`translate(${frame.cx.toFixed(2)} ${frame.cy.toFixed(2)})`}>
          {/* the limb: rim, ticks every 10°, turning with the planet (−λc) */}
          <g className="fallback-limb" style={{ opacity: frame.limb }}>
            <Engraved d={ringD(frame.R + 3)} w={1} tone="gilt-2" />
            <Engraved d={ringD(frame.R + reach)} w={1} tone="gilt" />
            <g transform={`rotate(${(-view.lon).toFixed(2)})`}>
              <Engraved d={limbTicks(frame.R + reach - 11, frame.R + reach - 4)} w={0.75} tone="gilt-2" linecap="butt" />
            </g>
          </g>
          <g transform={`scale(${frame.R.toFixed(3)})`}>
            <circle className="fallback-disc" r={1} />
            <path className="fallback-graticule" d={gratD} vectorEffect="non-scaling-stroke" />
            <path className="fallback-coast" d={coastD} vectorEffect="non-scaling-stroke" />
          </g>
          {locations.map((loc) => {
            if (!proj(loc.lat, loc.lon, pt)) return null
            const on = active?.slug === loc.slug
            const empty = loc.photos.length === 0
            return (
              <g
                key={loc.slug}
                className={`fallback-pin${on ? ' is-active' : ''}${empty ? ' is-empty' : ''}`}
                transform={`translate(${(pt[0] * frame.R).toFixed(1)} ${(pt[1] * frame.R).toFixed(1)})`}
                onClick={() => pick(loc)}
              >
                <circle className="fallback-pin-hit" r={11} />
                <circle className="fallback-pin-halo" r={PIN_R + 1} />
                <circle className="fallback-pin-ring" r={PIN_R} />
                <circle className={`fallback-pin-core${on ? ' is-active-mark' : ''}`} r={on ? 3 : 2.25} />
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}
