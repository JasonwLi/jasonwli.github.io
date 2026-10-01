import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, m, useReducedMotion } from 'motion/react'
import {
  countryName,
  locations,
  photoMediumUrl,
  stats,
  type TravelLocation,
  type TravelPhoto,
} from '../data/travel'
import { useSite } from '../state/store'
import { globeState, subscribeFrame } from '../three/globeState'
import { Dot, EmptyRule, Icons } from '../art'
import { TabularDigits } from '../ui/TabularDigits'
import { MapModePanel } from './MapModePanel'
import { SectionHeading } from './HeadingRule'

const MOBILE = '(max-width: 860px)'
const COARSE = '(pointer: coarse)'
/** the phone globe band: the top 52% of the viewport (choreography / instrumentLayout) */
const PHONE_BAND = 0.52

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
/** the index order: what prev/next and arrow keys walk */
const ordered = groups.flatMap((g) => g.locs)

/** the place last opened, so "All places" lands you back where you were */
let lastSlug: string | null = null
/** the row to take focus back when the gallery closes from inside (keyboard) */
let focusSlugOnIndex: string | null = null

// data voice (the theme's degree and date conventions)

const HAIR = ' '
const EN_DASH = '–'
const monthYear = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' })

/** '41.15° N' with a hair space before the hemisphere letter */
function deg(v: number, pos: string, neg: string) {
  return `${Math.abs(v).toFixed(2)}°${HAIR}${v >= 0 ? pos : neg}`
}
function dateRange(loc: TravelLocation) {
  const a = monthYear.format(new Date(loc.first * 1000))
  const b = monthYear.format(new Date(loc.last * 1000))
  return a === b ? a : `${a} ${EN_DASH} ${b}`
}

/** data items joined by drawn dots (the dot reads as a comma to screen readers) */
function Joined({ items }: { items: React.ReactNode[] }) {
  return (
    <>
      {items.map((it, i) => (
        <Fragment key={i}>
          <span className="joined-item">
            {it}
            {i < items.length - 1 && <Dot />}
          </span>
          {i < items.length - 1 && ' '}
        </Fragment>
      ))}
    </>
  )
}

/**
 * The rete star-pointer: the one vermilion glyph in the column, on the active
 * index row only. A leaning flame (10x14), tip down at the row's baseline,
 * pierced to show the openwork.
 */
function StarPointer() {
  return (
    <svg className="art star-pointer" width="10" height="14" viewBox="0 0 10 14" aria-hidden="true" focusable="false">
      <g transform="rotate(12 5 13.4)">
        <path
          className="is-active-mark star-pointer-flame"
          d="M5,0.6C8.6,4 9.2,8.4 6.2,11.2L5,13.4L3.8,11.2C0.8,8.4 1.4,4 5,0.6Z"
          strokeWidth={0.75}
        />
        <circle className="star-pointer-eye" cx="5" cy="6.2" r="1.3" />
      </g>
    </svg>
  )
}

// the place index

function LocationIndex() {
  const active = useSite((s) => s.active)
  const setActive = useSite((s) => s.setActive)
  const listRef = useRef<HTMLDivElement>(null)
  // roving tabindex: the list is a single tab stop, arrows move within it
  const [focusIdx, setFocusIdx] = useState(() =>
    Math.max(0, ordered.findIndex((l) => l.slug === (active?.slug ?? lastSlug))),
  )

  // the roving tab stop follows `active` when it changes from the globe or
  // from gallery prev/next, so Tab lands on the active row
  useEffect(() => {
    if (!active) return
    const i = ordered.indexOf(active)
    if (i >= 0) setFocusIdx(i)
  }, [active])

  // keep the current (or last-opened) place in view; restore focus after "All places"
  useEffect(() => {
    const slug = active?.slug ?? lastSlug
    if (!slug) return
    const row = listRef.current?.querySelector<HTMLElement>(`[data-slug="${slug}"]`)
    const panel = listRef.current?.closest<HTMLElement>('.travel-panel')
    // scroll the panel itself: scrollIntoView would also move the page
    if (row && panel) panel.scrollTop = row.offsetTop - panel.clientHeight / 2
    if (row && focusSlugOnIndex === slug) {
      focusSlugOnIndex = null
      setFocusIdx(ordered.findIndex((l) => l.slug === slug))
      row.focus({ preventScroll: true })
    }
  }, [active])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const next = (focusIdx + (e.key === 'ArrowDown' ? 1 : -1) + ordered.length) % ordered.length
    setFocusIdx(next)
    listRef.current?.querySelector<HTMLElement>(`[data-slug="${ordered[next].slug}"]`)?.focus()
  }

  return (
    <nav className="loc-index" aria-label="Visited places">
      <div className="loc-list" ref={listRef} onKeyDown={onKeyDown}>
        {groups.map((g) => (
          <section className="loc-group" key={g.cc} aria-label={g.name}>
            <h3 className="loc-country">
              <span className="loc-country-name">{g.name}</span>
              <span className="loc-country-n data">{g.locs.length}</span>
            </h3>
            <ul>
              {g.locs.map((loc) => {
                const i = ordered.indexOf(loc)
                const empty = loc.photos.length === 0
                const on = active?.slug === loc.slug
                return (
                  <li key={loc.slug}>
                    <button
                      data-slug={loc.slug}
                      tabIndex={i === focusIdx ? 0 : -1}
                      aria-pressed={on}
                      aria-label={`${loc.name}, ${g.name}${empty ? ', no photographs' : ''}`}
                      className={`loc-row${on ? ' is-active' : ''}${empty ? ' is-empty' : ''}`}
                      onClick={() => {
                        setFocusIdx(i)
                        lastSlug = loc.slug
                        setActive(loc)
                      }}
                    >
                      <span className="loc-gutter">{on && <StarPointer />}</span>
                      <span className="loc-name">{loc.name}</span>
                      <svg className="loc-leader" height="2" aria-hidden="true" focusable="false">
                        <line x1="1" y1="1" x2="100%" y2="1" />
                      </svg>
                      <span className="loc-row-n data">{empty ? <EmptyRule /> : loc.photos.length}</span>
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

/** the gazetteer failed to load: say so, offer the one recovery */
function IndexFailed() {
  return (
    <div className="loc-failed" role="status">
      <p className="loc-failed-line">The gazetteer could not be loaded.</p>
      <button type="button" className="text-btn" onClick={() => window.location.reload()}>
        Try again
      </button>
    </div>
  )
}

// the gallery (in the column on desktop, a sheet on phones)

function Photo({ loc, photo, i, reduce }: { loc: TravelLocation; photo: TravelPhoto; i: number; reduce: boolean | null }) {
  const setLightbox = useSite((s) => s.setLightbox)
  const [failed, setFailed] = useState(false)
  return (
    <m.button
      className={`photo${failed ? ' is-failed' : ''}`}
      onClick={() => setLightbox({ location: loc, index: i })}
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.36, delay: 0.1 + i * 0.07, ease: [0.22, 1, 0.36, 1] }}
      aria-label={`${loc.name}, ${countryName(loc.cc)}: open photograph ${i + 1} of ${loc.photos.length} full-screen`}
    >
      <span className="photo-plate" style={{ aspectRatio: `${photo.w} / ${photo.h}` }}>
        {failed ? (
          <span className="photo-broken">
            <Icons.BrokenPlate />
          </span>
        ) : (
          <>
            <img src={photo.blur} aria-hidden="true" alt="" className="photo-blur" />
            <img
              src={photoMediumUrl(loc, photo)}
              alt=""
              loading={i < 3 ? 'eager' : 'lazy'}
              decoding="async"
              className="photo-full"
              onLoad={(e) => e.currentTarget.classList.add('is-loaded')}
              onError={() => setFailed(true)}
              ref={(el) => {
                // cached images can complete before the load listener attaches
                if (el?.complete && el.naturalWidth > 0) el.classList.add('is-loaded')
              }}
            />
          </>
        )}
      </span>
    </m.button>
  )
}

function GalleryPanel({ loc, sheet }: { loc: TravelLocation; sheet: boolean }) {
  const setActive = useSite((s) => s.setActive)
  const reduce = useReducedMotion()
  const closeRef = useRef<HTMLButtonElement>(null)
  const rootRef = useRef<HTMLElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  // phones: the sheet opens as a PEEK under the globe band so the alidade's swing to the
  // place stays in view; the handle (tap or drag) or scrolling the photos expands it to
  // the full-screen sheet, and back (finish review)
  const [expanded, setExpanded] = useState(false)
  const drag = useRef<{ y: number; id: number } | null>(null)
  const dragged = useRef(false)

  // a gallery opens at its top (the index left the shared panel scrolled to the row)
  useLayoutEffect(() => {
    const panel = rootRef.current?.closest<HTMLElement>('.travel-panel')
    if (panel) {
      panel.scrollTop = 0
      panel.removeAttribute('data-scrolled')
    }
  }, [])

  useEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement
    closeRef.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !useSite.getState().lightbox) setActive(null)
    }
    window.addEventListener('keydown', onKey)
    const root = rootRef.current
    return () => {
      window.removeEventListener('keydown', onKey)
      const inside = !!root && root.contains(document.activeElement)
      const ret = returnFocus.current
      if (ret?.isConnected) ret.focus({ preventScroll: true })
      else if (inside || document.activeElement === document.body) focusSlugOnIndex = lastSlug
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const idx = ordered.indexOf(loc)
  const prev = ordered[(idx - 1 + ordered.length) % ordered.length]
  const next = ordered[(idx + 1) % ordered.length]

  const motionProps = sheet
    ? { initial: reduce ? false : { y: '100%' }, animate: { y: 0 }, exit: reduce ? undefined : { y: '100%' } }
    : {
        initial: reduce ? false : { opacity: 0, x: 12 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, transition: { duration: reduce ? 0.06 : 0.14 } },
      }

  return (
    <m.aside
      ref={rootRef}
      className={`gallery${sheet ? ' is-sheet' : ' in-column'}`}
      data-expanded={sheet ? (expanded ? 'true' : 'false') : undefined}
      onScroll={
        sheet && !expanded
          ? (e) => {
              if (e.currentTarget.scrollTop > 48) setExpanded(true)
            }
          : undefined
      }
      role={sheet ? 'dialog' : 'region'}
      aria-modal={sheet ? 'false' : undefined}
      aria-label={`Photos from ${loc.name}`}
      {...motionProps}
      transition={{ duration: reduce ? 0.12 : sheet ? 0.55 : 0.36, ease: [0.22, 1, 0.36, 1] }}
      data-interactive
      data-lenis-prevent
    >
      {sheet && (
        <button
          type="button"
          className="sheet-handle"
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse gallery to show the globe' : 'Expand gallery to full screen'}
          onClick={() => {
            if (dragged.current) dragged.current = false
            else setExpanded((v) => !v)
          }}
          onPointerDown={(e) => {
            drag.current = { y: e.clientY, id: e.pointerId }
          }}
          onPointerUp={(e) => {
            const d = drag.current
            drag.current = null
            if (!d || d.id !== e.pointerId) return
            const dy = e.clientY - d.y
            if (Math.abs(dy) < 24) return // a tap: onClick toggles
            dragged.current = true
            if (dy < 0) setExpanded(true)
            else if (expanded) setExpanded(false)
            else setActive(null)
          }}
          onPointerCancel={() => {
            drag.current = null
          }}
        >
          <span className="sheet-handle-rule" aria-hidden="true" />
        </button>
      )}
      <header className="gallery-head">
        {sheet ? (
          <button ref={closeRef} type="button" className="icon-btn gallery-close" onClick={() => setActive(null)} aria-label="Close gallery">
            <Icons.Close />
          </button>
        ) : (
          <button ref={closeRef} type="button" className="gallery-back" onClick={() => setActive(null)} aria-label="Back to all places">
            <Icons.Back />
            <span>All places</span>
          </button>
        )}
        <div className="gallery-title">
          <h3 className="gallery-name">{loc.name}</h3>
          <p className="gallery-meta">
            <Joined
              items={[
                <span className="gallery-country" key="c">
                  {countryName(loc.cc)}
                </span>,
                <span className="data" key="la">
                  {deg(loc.lat, 'N', 'S')}
                </span>,
                <span className="data" key="lo">
                  {deg(loc.lon, 'E', 'W')}
                </span>,
                <time className="data" key="d">
                  {dateRange(loc)}
                </time>,
              ]}
            />
          </p>
        </div>
      </header>

      <div className="gallery-photos" key={loc.slug}>
        {loc.photos.length === 0 && <p className="gallery-empty">no photographs published from here</p>}
        {loc.photos.map((p, i) => (
          <Photo key={p.file} loc={loc} photo={p} i={i} reduce={reduce} />
        ))}
      </div>

      <footer className="gallery-foot">
        <button
          type="button"
          className="gallery-nav is-prev"
          onClick={() => useSite.getState().setActive(prev)}
          aria-label={`Previous place: ${prev.name}`}
        >
          <Icons.Prev />
          <span className="gallery-nav-name">{prev.name}</span>
        </button>
        <span className="gallery-count data">
          <TabularDigits>{`${idx + 1} / ${ordered.length}`}</TabularDigits>
        </span>
        <button
          type="button"
          className="gallery-nav is-next"
          onClick={() => useSite.getState().setActive(next)}
          aria-label={`Next place: ${next.name}`}
        >
          <span className="gallery-nav-name">{next.name}</span>
          <Icons.Next />
        </button>
      </footer>
    </m.aside>
  )
}

// the column

/**
 * The column plate: whenever the globe leaves its free area (deep zoom: the limb
 * stage drops below 'full', or the disc crosses the column / the phone band),
 * a flat --steel-field plate fades in behind the column so its text never sits
 * on the paint. Written from the frame bus, only on change (no React per frame).
 */
function usePlate(colRef: React.RefObject<HTMLDivElement | null>, mobile: boolean) {
  useEffect(() => {
    let on = false
    return subscribeFrame(() => {
      const col = colRef.current
      if (!col) return
      const g = globeState
      let next = false
      if (g.travelIn > 0.3) {
        const [cx, cy] = g.centerPx
        const R = g.radiusPx
        const rect = col.getBoundingClientRect()
        // phones: also when the column itself scrolls up into the globe band (leaving for the footer)
        const overflow = mobile
          ? cy + R > PHONE_BAND * g.viewport.h - 4 || rect.top < -4
          : cx - R < rect.right + 4
        next = overflow || g.anchors.limbStage !== 'full'
      }
      if (next !== on) {
        on = next
        col.toggleAttribute('data-plate', on)
      }
    })
  }, [colRef, mobile])
}

export function Travel() {
  const active = useSite((s) => s.active)
  const mobile = useMediaQuery(MOBILE)
  const coarse = useMediaQuery(COARSE)
  const reduce = useReducedMotion()
  const colRef = useRef<HTMLDivElement>(null)
  const failed = locations.length === 0
  usePlate(colRef, mobile)

  // remember the last place opened from anywhere (globe, index, prev/next) so the
  // index re-mounts with its tab stop on it
  useEffect(() => {
    if (active) lastSlug = active.slug
  }, [active])

  const hint = mobile || coarse ? ['drag to spin', 'pinch to zoom'] : ['drag to spin', 'wheel or pinch to zoom', 'double-click to lean in']

  return (
    <section id="travel" className="travel" aria-labelledby="travel-h">
      <div className="travel-col" ref={colRef} data-interactive>
        <header className="travel-head">
          <SectionHeading id="travel-h">The globe</SectionHeading>
          {!failed && (
            <p className="travel-stats data">
              <Joined items={[`${stats.places} places`, `${stats.countries} countries`, `${stats.photos} photographs`]} />
              <span className="sr-only">, </span>
              <span className="travel-years">{`${stats.firstYear}${EN_DASH}${stats.lastYear}`}</span>
            </p>
          )}
        </header>

        <MapModePanel />

        {/* the column is the index, or the open place's gallery */}
        <div
          className="travel-panel"
          data-lenis-prevent
          onScroll={(e) => e.currentTarget.toggleAttribute('data-scrolled', e.currentTarget.scrollTop > 2)}
        >
          {failed ? (
            <IndexFailed />
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              {mobile || !active ? (
                <m.div
                  key="index"
                  className="travel-index"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduce ? 0.06 : 0.14, ease: [0.25, 1, 0.5, 1] }}
                >
                  <LocationIndex />
                </m.div>
              ) : (
                <GalleryPanel key={active.slug} loc={active} sheet={false} />
              )}
            </AnimatePresence>
          )}
        </div>

        <p className="travel-hint" aria-hidden="true">
          <Joined items={hint} />
        </p>
      </div>

      {/* phones keep the full-screen sheet, portaled above the site nav */}
      {mobile &&
        createPortal(
          <AnimatePresence>{active && <GalleryPanel key="sheet" loc={active} sheet />}</AnimatePresence>,
          document.body,
        )}
    </section>
  )
}
