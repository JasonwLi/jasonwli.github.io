import { useEffect, useRef } from 'react'
import { AnimatePresence, m, useReducedMotion } from 'motion/react'
import { countryName, photoUrl } from '../data/travel'
import { useSite } from '../state/store'
import { Dot, Icons } from '../art'
import { TabularDigits } from '../ui/TabularDigits'

/**
 * The lightbox (theme spec): flat --steel-deep at 97% (no glass), the
 * photograph in a 1 px --line frame, drawn icons (no typed glyphs), and no
 * gilt anywhere: the photograph owns the frame. Escape, arrows, the focus trap,
 * focus restore and wheel containment are kept; phones step by swipe.
 */
export function Lightbox() {
  const lightbox = useSite((s) => s.lightbox)
  const setLightbox = useSite((s) => s.setLightbox)
  const reduce = useReducedMotion()
  const dialogRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null)
  /** a swipe must not also count as the backdrop click that closes the viewer */
  const swiped = useRef(false)

  const step = (dir: 1 | -1) => {
    const lb = useSite.getState().lightbox
    if (!lb) return
    const n = lb.location.photos.length
    setLightbox({ location: lb.location, index: (lb.index + dir + n) % n })
  }

  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null)
      if (e.key === 'ArrowRight') step(1)
      if (e.key === 'ArrowLeft') step(-1)
      if (e.key === 'Tab') {
        // wrap focus inside the dialog
        const focusables = dialogRef.current?.querySelectorAll<HTMLElement>('button')
        if (!focusables?.length) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    // wheel over the lightbox must not scroll the page behind it
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.lightbox')) e.preventDefault()
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!lightbox])

  // focus in on open, restore on close
  const open = !!lightbox
  const lastIndex = useRef(0)
  if (lightbox) lastIndex.current = lightbox.index
  useEffect(() => {
    if (open) {
      // record the opener once (a re-run must not record the viewer's own close button)
      const act = document.activeElement as HTMLElement | null
      if (act && !act.closest('.lightbox')) returnFocus.current = act
      dialogRef.current?.querySelector<HTMLElement>('.lightbox-close')?.focus()
    } else {
      const back = returnFocus.current
      returnFocus.current = null
      if (back?.isConnected && !back.closest('.lightbox')) back.focus({ preventScroll: true })
      // the opener can be gone (the gallery followed the viewer to another photo):
      // land on the photograph now showing, never on <body>
      if (!back || document.activeElement !== back) {
        const photos = document.querySelectorAll<HTMLElement>('button.photo')
        ;(photos[lastIndex.current] ?? photos[0])?.focus({ preventScroll: true })
      }
    }
  }, [open])

  return (
    <AnimatePresence>
      {lightbox && (
        <m.div
          ref={dialogRef}
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`${lightbox.location.name} photo viewer`}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduce ? undefined : { opacity: 0 }}
          transition={{ duration: reduce ? 0.12 : 0.24 }}
          onClick={() => {
            if (swiped.current) swiped.current = false
            else setLightbox(null)
          }}
          onPointerDown={(e) => {
            if (e.pointerType !== 'mouse') swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
          }}
          onPointerUp={(e) => {
            const s0 = swipe.current
            swipe.current = null
            if (!s0 || s0.id !== e.pointerId) return
            const dx = e.clientX - s0.x
            if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(e.clientY - s0.y)) {
              swiped.current = true
              step(dx < 0 ? 1 : -1)
            }
          }}
          data-lenis-prevent
        >
          <button
            type="button"
            className="icon-btn lightbox-close"
            aria-label="Close photo viewer"
            onClick={(e) => {
              e.stopPropagation()
              setLightbox(null)
            }}
          >
            <Icons.Close />
          </button>
          <m.img
            key={lightbox.index}
            className="lightbox-photo"
            src={photoUrl(lightbox.location, lightbox.location.photos[lightbox.index])}
            alt={`${lightbox.location.name}, ${countryName(lightbox.location.cc)}: photograph ${lightbox.index + 1} of ${lightbox.location.photos.length}`}
            style={{ backgroundImage: `url(${lightbox.location.photos[lightbox.index].blur})` }}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: reduce ? 0.12 : 0.42, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
          />
          <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="icon-btn lightbox-nav" aria-label="Previous photo" onClick={() => step(-1)}>
              <Icons.Prev />
            </button>
            <p className="lightbox-caption">
              <span className="lightbox-place">{lightbox.location.name}</span>,{' '}
              <span className="lightbox-country">{countryName(lightbox.location.cc)}</span>
              <Dot />
              <span className="data lightbox-count">
                <TabularDigits>{`${lightbox.index + 1} / ${lightbox.location.photos.length}`}</TabularDigits>
              </span>
            </p>
            <button type="button" className="icon-btn lightbox-nav" aria-label="Next photo" onClick={() => step(1)}>
              <Icons.Next />
            </button>
          </div>
        </m.div>
      )}
    </AnimatePresence>
  )
}
