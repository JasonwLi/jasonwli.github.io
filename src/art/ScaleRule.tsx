import type { CSSProperties } from 'react'
import { Engraved } from './Engraved'
import { IndexTriangleMark } from './IndexTriangle'
import { INDEX_TRIANGLE, SCALE_RULE } from './geometry'

/**
 * The tick module: the single source for every flat scale (nav ruler, map-mode
 * scale). One module everywhere: 1px cuts, 4 px minors at a 6 px pitch,
 * 11 px majors at the stations (15 px when current or hovered), an engraved
 * --gilt-worn baseline, and the index triangle hanging under the baseline.
 *
 * Ticks rise from the baseline toward the labels (labels are HTML, owned by the
 * consumer, so links and radios stay semantic). The SVG is aria-hidden.
 *
 *   <ScaleRule width={264} stations={[{x:36},{x:132,current:true},{x:228}]} index={132} />
 */
export interface ScaleStation {
  x: number
  /** the major grows 11 -> 15 px (current section, selected option, or the hovered label) */
  current?: boolean
}

export interface ScaleRuleProps {
  width: number
  stations: ScaleStation[]
  /** minor tick pitch, px (module default 6) */
  pitch?: number
  /** x of the index triangle (continuous, may sit between stations); null hides it */
  index?: number | null
  /** animate the index between positions (240 ms ease-out-quart); false when the caller damps it per frame */
  indexTransition?: boolean
  /** cut the baseline in on mount, then the ticks follow */
  draw?: boolean
  className?: string
  style?: CSSProperties
}

const { minor: MINOR, major: MAJOR, top: TOP, below: BELOW } = SCALE_RULE

/** crisp 1px lines: put verticals on the half pixel */
const px = (v: number) => Math.round(v) + 0.5

export function ScaleRule({
  width,
  stations,
  pitch = SCALE_RULE.pitch,
  index = null,
  indexTransition = true,
  draw = false,
  className,
  style,
}: ScaleRuleProps) {
  const by = TOP + 0.5 // baseline y (half pixel)
  const h = TOP + BELOW
  const majorsX = stations.map((s) => px(s.x))
  let minors = ''
  for (let x = 0; x <= width + 0.01; x += pitch) {
    const xx = px(x)
    if (majorsX.some((m) => Math.abs(m - xx) < pitch / 2)) continue
    minors += `M${xx},${by}v${-MINOR}`
  }
  return (
    <svg
      className={['art scale-rule', draw ? 'scale-rule--draw' : '', className ?? ''].filter(Boolean).join(' ')}
      width={width}
      height={h}
      viewBox={`0 0 ${width} ${h}`}
      overflow="visible"
      aria-hidden="true"
      focusable="false"
      style={style}
    >
      <Engraved d={`M0,${by}H${width}`} w={1} tone="gilt-worn" groove={1.5} draw={draw} drawDuration={650} linecap="butt" />
      <path
        className="art-stroke tone-gilt-2 scale-minors"
        d={minors}
        fill="none"
        strokeWidth={0.75}
        vectorEffect="non-scaling-stroke"
      />
      {stations.map((s, i) => (
        <Engraved
          key={i}
          d={`M${majorsX[i]},${by}v${-MAJOR}`}
          w={1.25}
          tone="gilt"
          linecap="butt"
          className={`scale-major${s.current ? ' is-current' : ''}`}
        />
      ))}
      {index != null && (
        <g
          className={`scale-index${indexTransition ? ' scale-index--ease' : ''}`}
          style={{ transform: `translate(${index}px, ${by + INDEX_TRIANGLE.h}px)` }}
        >
          <IndexTriangleMark />
        </g>
      )}
    </svg>
  )
}
