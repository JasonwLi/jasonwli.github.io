import { useId } from 'react'
import { Engraved } from './Engraved'

/**
 * THE ONE ORNAMENT: the astrolabe's throne (kursi) above the name (theme spec,
 * CREST.TSX; finish review redraw). Read top down it is the instrument's suspension:
 * the shackle ring, its bail and the apex lug, then the kursi itself, a cusped plate
 * flaring onto the mater (the base strap) with a fillet cut inside its edge, pierced
 * by a quatrefoil rosette on the axis and a symmetric pair of moresque C-scrolls ending
 * in volutes on each side, with one almond split-leaf piercing per side carrying the
 * site's only hatching. No upright on the axis (the old baluster read as a figure).
 * Never reused anywhere else (DESIGN.md ban: one filigree, hero only).
 *
 * viewBox 0 0 300 86, axis x = 150. The left half is authored once and drawn
 * twice (the second mirrored), so both halves cut together like a two-handed
 * burin. Every stroke goes through Engraved (non-scaling, so 1 px stays 1 px
 * at the phone's 200 px width). Draw-on: shackle and kursi edge first, then the
 * rosette and the scroll pairs at a 70 ms stagger, then the hatching fades in.
 * Reduced motion: already cut (art.css).
 */
const W = 300
const H = 86

/** circle as two arcs, so a ring cuts as one stroke */
const ring = (cx: number, cy: number, r: number) =>
  `M${cx},${cy - r}A${r},${r} 0 1 1 ${cx},${cy + r}A${r},${r} 0 1 1 ${cx},${cy - r}`

/** the kursi edge (left half): apex lug, two cusped lobes, the foot flaring onto the strap */
const KURSI =
  'M150,25C145.5,25 141.5,27.5 140,31.5C138.6,35.4 134.6,37.6 130.4,37' +
  'C129.6,43.6 124.2,48.6 117.4,48.8C115.8,56.4 109,61.6 101.2,61.4' +
  'C98.6,70.4 88,77.6 74,80.2C68,81.3 62,82 56,83'
/** the fillet: the second cut parallel to the edge */
const FILLET =
  'M150,30.5C147,30.6 144.6,32.6 143.6,35.4C142,39.8 137.4,42.6 133.2,42.4' +
  'C131.8,48.8 126.2,53.4 120,53.8C118,60.6 111.6,65.4 104.4,65.6' +
  'C101.4,72.6 93,77.4 82,79.4'
/** the pierced rosette on the axis: a quatrefoil of four r 5 lobes with a ring eye */
const ROSETTE = 'M145,54A5,5 0 1 1 155,54A5,5 0 1 1 155,64A5,5 0 1 1 145,64A5,5 0 1 1 145,54'
const SCROLLS = [
  'M140.6,62.2C134.6,63.4 127.6,61 124.8,55.8C122.8,52 125.4,48.6 128.8,49.4C131.6,50 131.8,53.6 129.4,54.2',
  'M147,83C145.6,77.8 139.4,75.6 128,75.8C116,76 106.4,73.6 103.4,69C101,65.2 103.6,61.6 107,62.4C109.6,63 109.6,66.6 107.2,66.8',
]
const LOBES: { d: string; box: [number, number, number, number] }[] = [
  { d: 'M128,69.6C130,65.6 135.6,64.6 138.6,67C136.2,70.2 131.8,71.2 128,69.6Z', box: [127, 64, 139, 72] },
]

/** 45° parallel hatch lines across a lobe's box, `pitch` user units apart */
function hatch([x0, y0, x1, y1]: [number, number, number, number], pitch: number) {
  const step = pitch * Math.SQRT2
  let d = ''
  for (let c = x0 + y0; c <= x1 + y1; c += step) {
    d += `M${x0.toFixed(2)},${(c - x0).toFixed(2)}L${x1.toFixed(2)},${(c - x1).toFixed(2)}`
  }
  return d
}

function Half({ uid, pitch, draw }: { uid: string; pitch: number; draw: boolean }) {
  // the kursi edge first (150 ms), then the scroll pairs at a 70 ms stagger
  const t0 = 150
  return (
    <g>
      <Engraved d={KURSI} w={1.25} draw={draw} drawDelay={t0} drawDuration={520} />
      <Engraved d={FILLET} w={0.75} tone="gilt-2" draw={draw} drawDelay={t0 + 120} drawDuration={480} />
      {SCROLLS.map((d, i) => (
        <Engraved key={d} d={d} w={1.25} draw={draw} drawDelay={t0 + 260 + i * 70} drawDuration={460} />
      ))}
      {LOBES.map((l, i) => (
        <g key={l.d}>
          <clipPath id={`${uid}-lobe${i}`}>
            <path d={l.d} />
          </clipPath>
          <path
            className="art-stroke tone-gilt-2 crest-hatch"
            d={hatch(l.box, pitch)}
            clipPath={`url(#${uid}-lobe${i})`}
            fill="none"
            strokeWidth={0.5}
            vectorEffect="non-scaling-stroke"
          />
          <Engraved d={l.d} w={1} draw={draw} drawDelay={t0 + 400 + i * 70} drawDuration={360} />
        </g>
      ))}
      <Engraved d="M0,83H150" w={1} draw={draw} drawDelay={t0 + 80} drawDuration={620} linecap="butt" />
      <circle className="art-fill fill-gilt" cx={1} cy={83} r={1.6} />
    </g>
  )
}

export interface CrestProps {
  /** rendered width, px (300 desktop, 200 phone); height follows 300:86 */
  width?: number
  /** cut the crest in on mount */
  draw?: boolean
  className?: string
}

export function Crest({ width = W, draw = true, className }: CrestProps) {
  const uid = useId().replace(/:/g, '')
  // hatch pitch 2 user units; on the 200 px phone crest that is 1.33 px, so widen to avoid moiré
  const pitch = width < 260 ? 2.5 : 2
  return (
    <svg
      className={['art crest', draw ? 'crest--draw' : '', className ?? ''].filter(Boolean).join(' ')}
      width={width}
      height={(width * H) / W}
      viewBox={`0 0 ${W} ${H}`}
      overflow="visible"
      aria-hidden="true"
      focusable="false"
    >
      {/* the shackle, its bail, the apex lug and the rosette sit on the axis: drawn once */}
      <Engraved d={ring(150, 9, 6.5)} w={1.25} draw={draw} drawDelay={150} drawDuration={420} />
      <Engraved d={ring(150, 9, 4)} w={0.75} tone="gilt-2" draw={draw} drawDelay={200} drawDuration={380} />
      <Engraved d={ring(150, 19.2, 2.6)} w={1} draw={draw} drawDelay={230} drawDuration={260} />
      <Engraved d="M150,21.8V25" w={1.25} draw={draw} drawDelay={150} drawDuration={160} linecap="butt" />
      <Engraved d={ROSETTE} w={1.25} draw={draw} drawDelay={330} drawDuration={460} />
      <Engraved d={ring(150, 59, 2.4)} w={0.75} tone="gilt-2" draw={draw} drawDelay={420} drawDuration={300} />
      <Half uid={`${uid}l`} pitch={pitch} draw={draw} />
      <g transform={`translate(${W} 0) scale(-1 1)`}>
        <Half uid={`${uid}r`} pitch={pitch} draw={draw} />
      </g>
    </svg>
  )
}
export default Crest
