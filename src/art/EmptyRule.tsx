/**
 * The drawn empty count: an 8x1 --silver-3 rule in place of a typed dash
 * (photo-less index rows, empty counters). aria-hidden; pass `label` when the
 * surrounding element does not already say "no photographs".
 */
export function EmptyRule({ label, className }: { label?: string; className?: string }) {
  return (
    <>
      <svg
        className={['art empty-rule', className ?? ''].filter(Boolean).join(' ')}
        width="8"
        height="1"
        viewBox="0 0 8 1"
        aria-hidden="true"
        focusable="false"
      >
        <rect className="art-fill fill-silver-3" x="0" y="0" width="8" height="1" />
      </svg>
      {label ? <span className="sr-only">{label}</span> : null}
    </>
  )
}
