/**
 * View controls (T1c): Zoom in, Zoom out, Reset view. The canvas is aria-hidden,
 * so these buttons are the keyboard path to deep zoom (C1's globeActions).
 *
 * Placement: inside the travel column, on its bottom line (where the gesture hint
 * sits; the hint steps aside while the controls show). The column is the one
 * place the globe's disc never reaches, so the buttons never float over the
 * paint (at <= 860 px the column starts under the globe band, so the same
 * bottom line holds them). Every width: they are the keyboard path to zoom.
 *
 * Visibility (written by the overlay's frame loop, never React state):
 *   data-on     travelIn > 0.55: rendered and focusable (else visibility hidden,
 *               so they leave the tab order)
 *   data-shown  fine pointer and zoom01 > 0.05: visible; at the choreographed
 *               framing, and always on touch devices (which pinch), they stay
 *               quiet (transparent, no pointer) until one takes keyboard focus,
 *               so a keyboard or switch user can still zoom
 *
 * Focus never jumps the page: tabbing from the place index onto Zoom in made the browser
 * scroll the button into view, centred, whenever the travel section sat a few px below
 * the top (the column is 100svh tall, so the bottom line was just under the fold): the
 * page lurched half a screen toward the footer. The scroll position at the Tab keydown
 * is noted; when focus lands in the group the page is put back before the next paint,
 * and if the button really is outside the viewport it is revealed by the smallest scroll
 * that shows it (plus the focus ring), never centred.
 */
import { useEffect, useState, type FocusEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from '../ui/IconButton'
import { Icon } from '../art/icons'
import { globeActions } from '../three/controls'
import { getLenis } from '../hooks/useLenis'

// INT: ×1.4 (theme ×1.6) so the travel framing passes through the limb's 'arc' stage
// for two presses before the neatline (×1.6 jumped R 320 → 458 → 638, one arc stop)
const STEP = 1.4

function useColumn(): HTMLElement | null {
  const [col, setCol] = useState<HTMLElement | null>(() => document.querySelector<HTMLElement>('#travel .travel-col'))
  useEffect(() => {
    if (col) return
    // the travel section mounts with the page; poll briefly in case it is late
    let n = 0
    const id = window.setInterval(() => {
      const el = document.querySelector<HTMLElement>('#travel .travel-col')
      if (el || ++n > 40) {
        window.clearInterval(id)
        if (el) setCol(el)
      }
    }, 250)
    return () => window.clearInterval(id)
  }, [col])
  return col
}

/** the focus ring (1.5 px at a 3 px offset) and a hair of steel around the 44 px target */
const RING_PX = 8

function scrollPageTo(y: number) {
  // native first (synchronous, before the next paint), then Lenis adopts it (its own
  // scrollTo applies on its next frame)
  window.scrollTo({ top: y, behavior: 'instant' })
  getLenis()?.scrollTo(y, { immediate: true, force: true })
}

/** the page's scroll position when Tab (or Shift+Tab) went down, and when */
const tabKey = { x: 0, y: 0, t: -1e9 }
let tabListeners = 0
function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Tab') return
  tabKey.x = window.scrollX
  tabKey.y = window.scrollY
  tabKey.t = performance.now()
}

/**
 * Undo the browser's focus scroll (see the header) and reveal the button minimally.
 * Chrome scrolls the target into view before it dispatches focusin, so the position to
 * keep is the one noted at the Tab keydown.
 */
function holdScroll(e: FocusEvent<HTMLDivElement>) {
  if (performance.now() - tabKey.t > 500) return
  const target = e.target as HTMLElement
  const y0 = tabKey.y
  const restore = () => {
    if (window.scrollY !== y0 || window.scrollX !== tabKey.x) scrollPageTo(y0)
    const r = target.getBoundingClientRect()
    const vh = window.innerHeight
    if (r.bottom + RING_PX > vh) scrollPageTo(y0 + (r.bottom + RING_PX - vh))
    else if (r.top - RING_PX < 0) scrollPageTo(y0 + (r.top - RING_PX))
  }
  restore()
  // ...and once more after any focus scroll a browser applies after the event
  requestAnimationFrame(restore)
}

export function ViewControls({ rootRef }: { rootRef: RefObject<HTMLDivElement | null> }) {
  const col = useColumn()
  useEffect(() => {
    if (tabListeners++ === 0) document.addEventListener('keydown', onKeyDown, true)
    return () => {
      if (--tabListeners === 0) document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [])
  if (!col) return null
  return createPortal(
    <div ref={rootRef} className="view-controls" role="group" aria-label="Globe view" onFocus={holdScroll}>
      <IconButton label="Zoom in" onClick={() => globeActions.zoomBy(STEP)}>
        <Icon glyph="zoomIn" />
      </IconButton>
      <IconButton label="Zoom out" onClick={() => globeActions.zoomBy(1 / STEP)}>
        <Icon glyph="zoomOut" />
      </IconButton>
      <IconButton label="Reset view" onClick={() => globeActions.resetView()}>
        <Icon glyph="resetView" />
      </IconButton>
    </div>,
    col,
  )
}
