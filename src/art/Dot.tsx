/**
 * The drawn separator: a 3 px --gilt-worn circle centred on the x-height with
 * 0.5em side margins. It replaces every typed middle-dot between data items.
 * The drawing is aria-hidden; assistive tech hears a comma pause instead.
 */
export function Dot({ className }: { className?: string }) {
  return (
    <>
      <svg
        className={['art dot', className ?? ''].filter(Boolean).join(' ')}
        width="3"
        height="3"
        viewBox="0 0 3 3"
        aria-hidden="true"
        focusable="false"
      >
        <circle className="art-fill fill-gilt-worn" cx="1.5" cy="1.5" r="1.5" />
      </svg>
      <span className="sr-only">, </span>
    </>
  )
}
