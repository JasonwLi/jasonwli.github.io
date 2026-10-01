import type { CSSProperties } from 'react'

/**
 * The one engraving primitive (theme spec, artwork inventory). Every gilt line
 * on the site goes through it: a cut is an --incise groove wall offset
 * (-0.5, -0.5) toward the light, under a flat line in the tone. Never a
 * gradient, never a glow.
 *
 * Renders an SVG <g>, so it lives inside an <svg>. Strokes are non-scaling, so
 * `w` is in screen px whatever the viewBox.
 *
 * Draw-on (`draw`): pathLength=1 and stroke-dashoffset 1 -> 0 with ease-burin;
 * groove and line cut together so the line reads as cut, not painted. Under
 * prefers-reduced-motion the line is simply already cut (art.css).
 */
export type EngravedTone = 'gilt' | 'gilt-2' | 'gilt-worn' | 'silver-2' | 'silver-3'

export interface EngravedProps {
  d: string
  /** line width, screen px */
  w?: number
  tone?: EngravedTone
  /** groove width, screen px (default w + 0.5) */
  groove?: number
  /** cut the line in on mount */
  draw?: boolean
  /** ms before the cut starts */
  drawDelay?: number
  /** ms the cut takes (default --t-engrave, 900) */
  drawDuration?: number
  linecap?: 'round' | 'square' | 'butt'
  className?: string
  style?: CSSProperties
}

export function Engraved({
  d,
  w = 1,
  tone = 'gilt',
  groove,
  draw = false,
  drawDelay,
  drawDuration,
  linecap = 'round',
  className,
  style,
}: EngravedProps) {
  const vars: Record<string, string> = {}
  if (drawDelay != null) vars['--draw-delay'] = `${drawDelay}ms`
  if (drawDuration != null) vars['--draw-dur'] = `${drawDuration}ms`
  const pl = draw ? 1 : undefined
  return (
    <g
      className={['engraved', draw ? 'engrave-draw' : '', className ?? ''].filter(Boolean).join(' ')}
      style={{ ...vars, ...style } as CSSProperties}
      fill="none"
      strokeLinecap={linecap}
      strokeLinejoin="round"
    >
      <path
        className="incise"
        d={d}
        strokeWidth={groove ?? w + 0.5}
        transform="translate(-0.5 -0.5)"
        vectorEffect="non-scaling-stroke"
        pathLength={pl}
      />
      <path className={`art-stroke tone-${tone}`} d={d} strokeWidth={w} vectorEffect="non-scaling-stroke" pathLength={pl} />
    </g>
  )
}
