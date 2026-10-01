/**
 * The index triangle, 7x6, apex up, filled --gilt, with an --incise edge on its
 * two upper sides only (offset toward the light). One glyph for the nav
 * fiducial, the map-mode index and (rotated, apex inward) the limb fiducial.
 *
 * IndexTriangleMark is the <g> for use inside an SVG: its origin is the centre
 * of the base, so `translate(x, baselineY + 6)` hangs it under a baseline with
 * the apex touching. IndexTriangle is a standalone inline <svg>.
 */
import { INDEX_TRIANGLE } from './geometry'

const FILL = 'M-3.5,0 L3.5,0 L0,-6Z'
const EDGE = 'M-3.5,0 L0,-6 L3.5,0'

export interface IndexTriangleMarkProps {
  x?: number
  y?: number
  /** degrees, clockwise; 180 points the apex down, 90 points it right */
  rotate?: number
  className?: string
}

export function IndexTriangleMark({ x = 0, y = 0, rotate = 0, className }: IndexTriangleMarkProps) {
  // the groove stays offset toward the light (upper-left) in screen space,
  // whatever the rotation: translate outside, rotate inside
  const rot = rotate ? `rotate(${rotate})` : undefined
  return (
    <g className={['index-triangle', className ?? ''].filter(Boolean).join(' ')} transform={`translate(${x} ${y})`}>
      <g transform="translate(-0.5 -0.5)">
        <path className="incise" d={EDGE} fill="none" strokeWidth={0.75} strokeLinejoin="round" transform={rot} />
      </g>
      <path className="art-fill fill-gilt" d={FILL} transform={rot} />
    </g>
  )
}

export interface IndexTriangleProps {
  rotate?: number
  className?: string
}

/** Inline 7x6 svg (aria-hidden): a mark, never content. */
export function IndexTriangle({ rotate = 0, className }: IndexTriangleProps) {
  return (
    <svg
      className={['art index-triangle-svg', className ?? ''].filter(Boolean).join(' ')}
      width={INDEX_TRIANGLE.w}
      height={INDEX_TRIANGLE.h}
      viewBox="-3.5 -6 7 6"
      overflow="visible"
      aria-hidden="true"
      focusable="false"
    >
      <IndexTriangleMark rotate={rotate} />
    </svg>
  )
}
