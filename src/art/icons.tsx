import type { SVGProps } from 'react'
import { GLYPHS, type Glyph, type GlyphName } from './glyphs'

/**
 * Drawn icons. One stroke system for all of them: 1.25 px currentColor, round
 * caps and joins (mail and the plate: mitred), non-scaling, each path cut
 * twice: a 2 px --incise groove offset (-0.5, -0.5) under the stroke, the same
 * engraving as every gilt line. No icon font, no Unicode glyph, no fill-only
 * brand marks: GitHub and LinkedIn are re-drawn as outlines in the same hand.
 *
 * Icons are aria-hidden and never focusable; the 44x44 button around them
 * carries the accessible name (src/ui/IconButton.tsx). Geometry: ./glyphs.ts.
 */
export type IconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'viewBox'> & {
  /** rendered px of the grid's larger side (default: the grid, 1 unit = 1 px) */
  size?: number
}

export function Icon({ glyph, size, className, ...rest }: IconProps & { glyph: GlyphName }) {
  const g: Glyph = GLYPHS[glyph]
  const k = size ? size / Math.max(g.w, g.h) : 1
  const join = g.join ?? 'round'
  return (
    <svg
      className={['icon', `icon-${glyph}`, className ?? ''].filter(Boolean).join(' ')}
      width={g.w * k}
      height={g.h * k}
      viewBox={`0 0 ${g.w} ${g.h}`}
      overflow="visible"
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <g className="incise" transform="translate(-0.5 -0.5)">
        <path d={g.d} strokeWidth={2} strokeLinecap="round" strokeLinejoin={join} vectorEffect="non-scaling-stroke" />
        {g.dots?.map((c, i) => <circle key={i} className="incise-dot" cx={c.cx} cy={c.cy} r={c.r} />)}
      </g>
      <g className="icon-cut">
        <path
          d={g.d}
          stroke="currentColor"
          strokeWidth={1.25}
          strokeLinecap="round"
          strokeLinejoin={join}
          vectorEffect="non-scaling-stroke"
        />
        {g.dots?.map((c, i) => <circle key={i} className="icon-dot" cx={c.cx} cy={c.cy} r={c.r} />)}
      </g>
    </svg>
  )
}

export function Close(p: IconProps) {
  return <Icon glyph="close" {...p} />
}
export function ChevronLeft(p: IconProps) {
  return <Icon glyph="chevronLeft" {...p} />
}
export function ChevronRight(p: IconProps) {
  return <Icon glyph="chevronRight" {...p} />
}
/** previous photo / place */
export function Prev(p: IconProps) {
  return <Icon glyph="chevronLeft" {...p} />
}
/** next photo / place */
export function Next(p: IconProps) {
  return <Icon glyph="chevronRight" {...p} />
}
/** back to "All places" */
export function Back(p: IconProps) {
  return <Icon glyph="back" {...p} />
}
export function ZoomIn(p: IconProps) {
  return <Icon glyph="zoomIn" {...p} />
}
export function ZoomOut(p: IconProps) {
  return <Icon glyph="zoomOut" {...p} />
}
export function ResetView(p: IconProps) {
  return <Icon glyph="resetView" {...p} />
}
export function BrokenPlate(p: IconProps) {
  return <Icon glyph="brokenPlate" {...p} />
}
export function Mail(p: IconProps) {
  return <Icon glyph="mail" {...p} />
}
export function GitHub(p: IconProps) {
  return <Icon glyph="github" {...p} />
}
export function LinkedIn(p: IconProps) {
  return <Icon glyph="linkedin" {...p} />
}
