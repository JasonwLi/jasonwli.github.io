import type { ReactNode } from 'react'
import { useEnteredView, useInlineSize } from './hooks'
import { Engraved } from '../art'

/**
 * A heading on its one ruled line (theme spec, HEADINGRULE): the only heading
 * ornament. single: an engraved --gilt-worn hairline, heading width + 48 px,
 * 12 px under the cap baseline. double (the name): --gilt over --gilt-worn with
 * a 3 px gap, exactly the name's width (trailing tracking removed).
 *
 * The width follows the heading's inline size (ResizeObserver), so it holds
 * through font swaps and breakpoints. The rule cuts left to right on mount
 * (600 ms ease-burin); reduced motion shows it already cut (art.css).
 */
export function RuleLine({
  width,
  variant = 'single',
  draw = true,
  drawDelay = 0,
  className,
}: {
  width: number
  variant?: 'single' | 'double'
  draw?: boolean
  drawDelay?: number
  className?: string
}) {
  const w = Math.max(0, Math.round(width))
  if (!w) return <span className={['heading-rule', className ?? ''].filter(Boolean).join(' ')} aria-hidden="true" />
  const h = variant === 'double' ? 6 : 2
  return (
    <svg
      className={['art heading-rule', className ?? ''].filter(Boolean).join(' ')}
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      overflow="visible"
      aria-hidden="true"
      focusable="false"
    >
      {variant === 'double' ? (
        <>
          <Engraved d={`M0,1H${w}`} w={1} tone="gilt" groove={1.5} draw={draw} drawDelay={drawDelay} drawDuration={600} linecap="butt" />
          <Engraved d={`M0,5H${w}`} w={1} tone="gilt-worn" groove={1.5} draw={draw} drawDelay={drawDelay + 80} drawDuration={600} linecap="butt" />
        </>
      ) : (
        <Engraved d={`M0,1H${w}`} w={1} tone="gilt-worn" groove={1.5} draw={draw} drawDelay={drawDelay} drawDuration={600} linecap="butt" />
      )}
    </svg>
  )
}

/** A section heading (h2) on its single HeadingRule, cut when it enters the view. */
export function SectionHeading({ id, children }: { id?: string; children: ReactNode }) {
  const [ref, w] = useInlineSize<HTMLHeadingElement>()
  const seen = useEnteredView(ref)
  return (
    <div className="section-heading">
      <h2 id={id} ref={ref}>
        {children}
      </h2>
      {seen ? <RuleLine width={w ? w + 48 : 0} /> : <span className="heading-rule" aria-hidden="true" />}
    </div>
  )
}
