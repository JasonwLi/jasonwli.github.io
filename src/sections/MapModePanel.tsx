/**
 * Terrain / Climate map mode (C3): the MapModeScale switch (T1a's ScaleRule +
 * IndexTriangle, not an underline) and the climate legend, in the travel column.
 *
 * - role=radiogroup 'Map mode' of two role=radio buttons (44 px targets), roving
 *   tabindex, arrow keys move and select.
 * - store.setMapMode drives globeState.targetModeMix; CameraRig damps modeMix at
 *   lambda 9 (~420 ms). Under reduced motion the mix is set instantly here.
 * - Köppen loads on demand: requestKoppen() (C2a) on the first switch to Climate.
 * - mapMode persists to localStorage (try/catch) and ?map=climate (replaceState);
 *   on load the URL wins over storage.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ScaleRule } from '../art'
import { useSite } from '../state/store'
import { globeState, type MapMode } from '../three/globeState'
import { ClimateLegend } from './ClimateLegend'
import '../styles/map-mode.css'

const STORAGE_KEY = 'astrolabe:mapMode'
const MODES: { mode: MapMode; label: string }[] = [
  { mode: 'terrain', label: 'Terrain' },
  { mode: 'climate', label: 'Climate' },
]

function isMode(v: unknown): v is MapMode {
  return v === 'terrain' || v === 'climate'
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

function requestKoppen() {
  void import('../three/terrain/loader').then((m) => m.requestKoppen()).catch(() => {})
}

/** select a mode from the UI (or anything else that wants the same behaviour) */
function selectMapMode(m: MapMode) {
  useSite.getState().setMapMode(m)
  if (reducedMotion()) globeState.modeMix = globeState.targetModeMix
  if (m === 'climate') requestKoppen()
  else useSite.getState().setIsolateGroup(-1)
}

function persist(m: MapMode) {
  try {
    window.localStorage.setItem(STORAGE_KEY, m)
  } catch {
    /* storage blocked: the URL still carries it */
  }
  try {
    const u = new URL(window.location.href)
    if (m === 'climate') u.searchParams.set('map', 'climate')
    else u.searchParams.delete('map')
    const next = u.pathname + u.search + u.hash
    if (next !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.replaceState(window.history.state, '', next)
    }
  } catch {
    /* ignore */
  }
}

// restore before the first frame (URL wins), then mirror every change
function initMapMode() {
  if (typeof window === 'undefined') return
  let initial: MapMode | null = null
  try {
    const q = new URLSearchParams(window.location.search).get('map')
    if (isMode(q)) initial = q
  } catch {
    /* ignore */
  }
  if (!initial) {
    try {
      const s = window.localStorage.getItem(STORAGE_KEY)
      if (isMode(s)) initial = s
    } catch {
      /* ignore */
    }
  }
  if (initial && initial !== useSite.getState().mapMode) {
    useSite.getState().setMapMode(initial)
    globeState.modeMix = globeState.targetModeMix // a restored mode does not fade in
  }
  if (initial) persist(initial)
  useSite.subscribe((s, p) => {
    if (s.mapMode !== p.mapMode) persist(s.mapMode)
  })
}
initMapMode()

const MQ_PHONE = '(max-width: 860px)'
function usePhone(): boolean {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(MQ_PHONE).matches)
  useEffect(() => {
    const mq = window.matchMedia(MQ_PHONE)
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return m
}

export function MapModePanel() {
  const mode = useSite((s) => s.mapMode)
  const phone = usePhone()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const [hover, setHover] = useState<MapMode | null>(null)

  // a mode restored from URL/storage still needs its data
  useEffect(() => {
    if (useSite.getState().mapMode === 'climate') requestKoppen()
  }, [])

  const W = phone ? 200 : 216
  const xs = [W / 4, (3 * W) / 4] // TERRAIN 54 / CLIMATE 162 on desktop
  const sel = MODES.findIndex((o) => o.mode === mode)

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key
    let next = -1
    if (k === 'ArrowRight' || k === 'ArrowDown') next = (sel + 1) % MODES.length
    else if (k === 'ArrowLeft' || k === 'ArrowUp') next = (sel + MODES.length - 1) % MODES.length
    else if (k === 'Home') next = 0
    else if (k === 'End') next = MODES.length - 1
    if (next < 0) return
    e.preventDefault()
    selectMapMode(MODES[next].mode)
    refs.current[next]?.focus()
  }

  return (
    <div className="map-mode-panel">
      <div
        className="map-mode-scale"
        role="radiogroup"
        aria-label="Map mode"
        onKeyDown={onKey}
        style={{ width: W }}
      >
        {MODES.map((o, i) => (
          <button
            key={o.mode}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={i === sel}
            tabIndex={i === sel ? 0 : -1}
            className={`map-mode-option${i === sel ? ' is-selected' : ''}`}
            style={{ left: xs[i] - W / 4, width: W / 2 }}
            onClick={() => selectMapMode(o.mode)}
            onPointerEnter={() => setHover(o.mode)}
            onPointerLeave={() => setHover(null)}
          >
            <span className="map-mode-label">{o.label}</span>
          </button>
        ))}
        <ScaleRule
          className="map-mode-rule"
          width={W}
          stations={MODES.map((o, i) => ({ x: xs[i], current: i === sel || hover === o.mode }))}
          index={xs[sel]}
        />
      </div>
      <ClimateLegend open={mode === 'climate'} phone={phone} />
    </div>
  )
}
export default MapModePanel
