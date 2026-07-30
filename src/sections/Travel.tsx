import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  countryName,
  fmtCoords,
  fmtDateRange,
  locations,
  photoMediumUrl,
  type TravelLocation,
} from '../data/travel'
import { useSite } from '../state/store'
import { globeState } from '../three/globeState'

function ZoomControls() {
  const bump = (d: number) => {
    globeState.targetZoom = Math.min(Math.max(globeState.targetZoom + d, 1), 2.8)
    globeState.lastInteraction = performance.now()
  }
  return (
    <div className="zoom-controls" data-interactive>
      <button aria-label="Zoom in" onClick={() => bump(0.35)}>
        +
      </button>
      <button aria-label="Zoom out" onClick={() => bump(-0.35)}>
        −
      </button>
      <button
        className="zoom-reset"
        aria-label="Reset zoom"
        onClick={() => {
          globeState.targetZoom = 1
        }}
      >
        1:1
      </button>
    </div>
  )
}

function LocationIndex() {
  const active = useSite((s) => s.active)
  const setActive = useSite((s) => s.setActive)
  const listRef = useRef<HTMLDivElement>(null)
  // roving tabindex: the chip strip is a single tab stop, arrows move within it
  const [focusIdx, setFocusIdx] = useState(0)

  // keep the active chip in view
  useEffect(() => {
    if (!active || !listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-slug="${active.slug}"]`,
    )
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [active])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next =
      (focusIdx + (e.key === 'ArrowRight' ? 1 : -1) + locations.length) %
      locations.length
    setFocusIdx(next)
    listRef.current
      ?.querySelector<HTMLElement>(`[data-slug="${locations[next].slug}"]`)
      ?.focus()
  }

  return (
    <nav className="loc-index" aria-label="Visited places">
      <div className="loc-strip" ref={listRef} data-interactive onKeyDown={onKeyDown}>
        {locations.map((loc, i) => (
          <button
            key={loc.slug}
            data-slug={loc.slug}
            tabIndex={i === focusIdx ? 0 : -1}
            aria-pressed={active?.slug === loc.slug}
            className={`loc-chip${active?.slug === loc.slug ? ' is-active' : ''}${loc.photos.length === 0 ? ' is-empty' : ''}`}
            onClick={() => {
              setFocusIdx(i)
              setActive(active?.slug === loc.slug ? null : loc)
            }}
          >
            <span className="map-label">{loc.name}</span>
            <span className="mono">{loc.cc}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}

function GalleryPanel({ loc }: { loc: TravelLocation }) {
  const setActive = useSite((s) => s.setActive)
  const setLightbox = useSite((s) => s.setLightbox)
  const reduce = useReducedMotion()
  const closeRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement
    closeRef.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !useSite.getState().lightbox) setActive(null)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      returnFocus.current?.focus({ preventScroll: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const idx = locations.indexOf(loc)
  const prev = locations[(idx - 1 + locations.length) % locations.length]
  const next = locations[(idx + 1) % locations.length]

  return (
    <motion.aside
      className="gallery"
      role="dialog"
      aria-modal="false"
      aria-label={`Photos from ${loc.name}`}
      initial={reduce ? false : { x: '104%' }}
      animate={{ x: 0 }}
      exit={reduce ? undefined : { x: '104%' }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      data-interactive
      data-lenis-prevent
    >
      <header className="gallery-head">
        <div>
          <h3 className="map-label gallery-name">{loc.name}</h3>
          <p className="gallery-meta">
            {countryName(loc.cc)}
            <span className="mono">
              {' '}
              · {fmtCoords(loc.lat, loc.lon)} · {fmtDateRange(loc)}
            </span>
          </p>
        </div>
        <button
          ref={closeRef}
          className="gallery-close"
          onClick={() => setActive(null)}
          aria-label="Close gallery"
        >
          ✕
        </button>
      </header>

      <div className="gallery-photos" key={loc.slug}>
        {loc.photos.length === 0 && (
          <p className="gallery-empty map-label">no photographs published from here</p>
        )}
        {loc.photos.map((p, i) => (
          <motion.button
            key={p.file}
            className="photo"
            style={{ aspectRatio: `${p.w} / ${p.h}` }}
            onClick={() => setLightbox({ location: loc, index: i })}
            initial={reduce ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.18 + i * 0.07, ease: [0.25, 1, 0.5, 1] }}
            aria-label={`${loc.name}, ${countryName(loc.cc)} — open photograph ${i + 1} of ${loc.photos.length} full-screen`}
          >
            <img
              src={p.blur}
              aria-hidden="true"
              alt=""
              className="photo-blur"
            />
            <img
              src={photoMediumUrl(loc, p)}
              alt=""
              loading={i < 3 ? 'eager' : 'lazy'}
              decoding="async"
              className="photo-full"
              onLoad={(e) => e.currentTarget.classList.add('is-loaded')}
              ref={(el) => {
                // cached images can complete before the load listener attaches
                if (el?.complete && el.naturalWidth > 0) el.classList.add('is-loaded')
              }}
            />
          </motion.button>
        ))}
      </div>

      <footer className="gallery-foot">
        <button className="gallery-nav" onClick={() => useSite.getState().setActive(prev)}>
          ‹ <span className="map-label">{prev.name}</span>
        </button>
        <span className="mono">
          {idx + 1} / {locations.length}
        </span>
        <button className="gallery-nav" onClick={() => useSite.getState().setActive(next)}>
          <span className="map-label">{next.name}</span> ›
        </button>
      </footer>
    </motion.aside>
  )
}

export function Travel() {
  const active = useSite((s) => s.active)

  return (
    <section id="travel" className="travel">
      <header className="travel-head prose">
        <h2>The globe</h2>
      </header>

      <ZoomControls />
      <LocationIndex />

      {/* portal: the sheet must stack above the site nav, outside main's context.
          keyed statically — prev/next swaps content without remounting the sheet */}
      {createPortal(
        <AnimatePresence>
          {active && <GalleryPanel key="gallery" loc={active} />}
        </AnimatePresence>,
        document.body,
      )}
    </section>
  )
}
