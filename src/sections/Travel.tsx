import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  countryName,
  fmtCoords,
  fmtDateRange,
  locations,
  photoMediumUrl,
  stats,
  type TravelLocation,
} from '../data/travel'
import { useSite } from '../state/store'

const MOBILE = '(max-width: 860px)'

function useMediaQuery(q: string) {
  const [m, setM] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const cb = () => setM(mq.matches)
    mq.addEventListener('change', cb)
    return () => mq.removeEventListener('change', cb)
  }, [q])
  return m
}

/** places grouped by country, countries in order of first visit */
const groups = (() => {
  const byCc = new Map<string, TravelLocation[]>()
  for (const loc of locations) {
    const list = byCc.get(loc.cc)
    if (list) list.push(loc)
    else byCc.set(loc.cc, [loc])
  }
  return [...byCc.entries()].map(([cc, locs]) => ({ cc, name: countryName(cc), locs }))
})()
/** the index order — what prev/next and arrow keys walk */
const ordered = groups.flatMap((g) => g.locs)

/** the place last opened, so "all places" lands you back where you were */
let lastSlug: string | null = null

function LocationIndex() {
  const active = useSite((s) => s.active)
  const setActive = useSite((s) => s.setActive)
  const listRef = useRef<HTMLDivElement>(null)
  // roving tabindex: the list is a single tab stop, arrows move within it
  const [focusIdx, setFocusIdx] = useState(() =>
    Math.max(0, ordered.findIndex((l) => l.slug === (active?.slug ?? lastSlug))),
  )

  // keep the current (or last-opened) place in view
  useEffect(() => {
    const slug = active?.slug ?? lastSlug
    if (!slug) return
    const row = listRef.current?.querySelector<HTMLElement>(`[data-slug="${slug}"]`)
    const panel = listRef.current?.closest<HTMLElement>('.travel-panel')
    // scroll the panel itself — scrollIntoView would also move the page
    if (row && panel) panel.scrollTop = row.offsetTop - panel.clientHeight / 2
  }, [active])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const next = (focusIdx + (e.key === 'ArrowDown' ? 1 : -1) + ordered.length) % ordered.length
    setFocusIdx(next)
    listRef.current
      ?.querySelector<HTMLElement>(`[data-slug="${ordered[next].slug}"]`)
      ?.focus()
  }

  return (
    <nav className="loc-index" aria-label="Visited places">
      <div className="loc-list" ref={listRef} onKeyDown={onKeyDown}>
        {groups.map((g) => (
          <section className="loc-group" key={g.cc} aria-label={g.name}>
            <h3 className="loc-country mono">
              {g.name}
              <span className="loc-country-n"> {g.locs.length}</span>
            </h3>
            <ul>
              {g.locs.map((loc) => {
                const i = ordered.indexOf(loc)
                const empty = loc.photos.length === 0
                return (
                  <li key={loc.slug}>
                    <button
                      data-slug={loc.slug}
                      tabIndex={i === focusIdx ? 0 : -1}
                      aria-pressed={active?.slug === loc.slug}
                      aria-label={`${loc.name}, ${g.name}${empty ? ', no photographs' : ''}`}
                      className={`loc-row${active?.slug === loc.slug ? ' is-active' : ''}${empty ? ' is-empty' : ''}`}
                      onClick={() => {
                        setFocusIdx(i)
                        lastSlug = loc.slug
                        setActive(loc)
                      }}
                    >
                      <span className="map-label">{loc.name}</span>
                      <span className="mono loc-row-n">
                        {empty ? '—' : loc.photos.length}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
    </nav>
  )
}

function GalleryPanel({ loc, sheet }: { loc: TravelLocation; sheet: boolean }) {
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

  const idx = ordered.indexOf(loc)
  const prev = ordered[(idx - 1 + ordered.length) % ordered.length]
  const next = ordered[(idx + 1) % ordered.length]

  const slide = sheet
    ? { initial: reduce ? false : { x: '104%' }, animate: { x: 0 }, exit: reduce ? undefined : { x: '104%' } }
    : { initial: reduce ? false : { opacity: 0, x: -12 }, animate: { opacity: 1, x: 0 }, exit: undefined }

  return (
    <motion.aside
      className={`gallery${sheet ? ' is-sheet' : ' in-column'}`}
      role={sheet ? 'dialog' : 'region'}
      aria-modal={sheet ? 'false' : undefined}
      aria-label={`Photos from ${loc.name}`}
      {...slide}
      transition={{ duration: sheet ? 0.55 : 0.35, ease: [0.22, 1, 0.36, 1] }}
      data-interactive
      data-lenis-prevent
    >
      <header className="gallery-head">
        <button
          ref={closeRef}
          className="gallery-close"
          onClick={() => setActive(null)}
          aria-label={sheet ? 'Close gallery' : 'Back to all places'}
        >
          {sheet ? '✕' : <><span aria-hidden="true">‹ </span>all places</>}
        </button>
        <div className="gallery-title">
          <h3 className="map-label gallery-name">{loc.name}</h3>
          <p className="gallery-meta">
            {countryName(loc.cc)}
            <span className="mono">
              {' '}
              · {fmtCoords(loc.lat, loc.lon)} · {fmtDateRange(loc)}
            </span>
          </p>
        </div>
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
            transition={{ duration: 0.6, delay: 0.12 + i * 0.07, ease: [0.25, 1, 0.5, 1] }}
            aria-label={`${loc.name}, ${countryName(loc.cc)} — open photograph ${i + 1} of ${loc.photos.length} full-screen`}
          >
            <img src={p.blur} aria-hidden="true" alt="" className="photo-blur" />
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
          {idx + 1} / {ordered.length}
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
  const mobile = useMediaQuery(MOBILE)

  return (
    <section id="travel" className="travel">
      <div className="travel-col" data-interactive>
        <header className="travel-head prose">
          <h2>The globe</h2>
          <p className="travel-stats mono">
            {stats.places} places · {stats.countries} countries · {stats.photos} photographs ·{' '}
            {stats.firstYear} — {stats.lastYear}
          </p>
        </header>

        {/* the column is the index, or the open place's gallery */}
        <div className="travel-panel" data-lenis-prevent>
          {mobile || !active ? (
            <LocationIndex />
          ) : (
            <AnimatePresence mode="wait">
              <GalleryPanel key={active.slug} loc={active} sheet={false} />
            </AnimatePresence>
          )}
        </div>

        <p className="travel-hint mono" aria-hidden="true">
          drag to spin · wheel or pinch to zoom · double-click to lean in
        </p>
      </div>

      {/* phones keep the full-screen sheet, portaled above the site nav */}
      {mobile &&
        createPortal(
          <AnimatePresence>
            {active && <GalleryPanel key="sheet" loc={active} sheet />}
          </AnimatePresence>,
          document.body,
        )}
    </section>
  )
}
