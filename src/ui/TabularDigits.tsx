/**
 * Castoro has `lnum` but no `tnum` (checked with fontTools on the fontsource
 * woff2, 2026-10-01), so counters ("12 / 187") and live readouts that change
 * per frame wrap each digit in a fixed 0.6em cell (widest figure 0.581 em) and
 * never jitter. Non-digits pass through. Screen readers get the plain string.
 */
export function TabularDigits({ children, className }: { children: string | number; className?: string }) {
  const s = String(children)
  return (
    <span className={['data-digits', className ?? ''].filter(Boolean).join(' ')}>
      <span className="sr-only">{s}</span>
      <span aria-hidden="true">
        {Array.from(s, (ch, i) =>
          ch >= '0' && ch <= '9' ? (
            <span key={i} className="tnum-d">
              {ch}
            </span>
          ) : (
            ch
          ),
        )}
      </span>
    </span>
  )
}
