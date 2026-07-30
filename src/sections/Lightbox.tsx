import { useEffect, useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { countryName, photoUrl } from '../data/travel'
import { useSite } from '../state/store'

export function Lightbox() {
  const lightbox = useSite((s) => s.lightbox)
  const setLightbox = useSite((s) => s.setLightbox)
  const reduce = useReducedMotion()
  const dialogRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)

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
  useEffect(() => {
    if (open) {
      returnFocus.current = document.activeElement as HTMLElement
      dialogRef.current?.querySelector<HTMLElement>('.lightbox-close')?.focus()
    } else {
      returnFocus.current?.focus({ preventScroll: true })
    }
  }, [open])

  return (
    <AnimatePresence>
      {lightbox && (
        <motion.div
          ref={dialogRef}
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`${lightbox.location.name} photo viewer`}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduce ? undefined : { opacity: 0 }}
          transition={{ duration: 0.3 }}
          onClick={() => setLightbox(null)}
          data-lenis-prevent
        >
          <button
            className="lightbox-close"
            aria-label="Close photo viewer"
            onClick={(e) => {
              e.stopPropagation()
              setLightbox(null)
            }}
          >
            ✕
          </button>
          <motion.img
            key={lightbox.index}
            src={photoUrl(lightbox.location, lightbox.location.photos[lightbox.index])}
            alt={`${lightbox.location.name}, ${countryName(lightbox.location.cc)} — photograph ${lightbox.index + 1} of ${lightbox.location.photos.length}`}
            initial={reduce ? false : { opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
          />
          <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
            <button className="lightbox-nav" aria-label="Previous photo" onClick={() => step(-1)}>
              ‹
            </button>
            <p className="lightbox-caption">
              <span className="map-label">
                {lightbox.location.name}, {countryName(lightbox.location.cc)}
              </span>
              <span className="mono">
                {' '}
                · {lightbox.index + 1}/{lightbox.location.photos.length}
              </span>
            </p>
            <button className="lightbox-nav" aria-label="Next photo" onClick={() => step(1)}>
              ›
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
