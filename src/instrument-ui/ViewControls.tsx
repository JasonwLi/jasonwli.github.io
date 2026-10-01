/**
 * View controls (T1c): Zoom in, Zoom out, Reset view. The canvas is aria-hidden,
 * so these buttons are the keyboard path to deep zoom (C1's globeActions).
 *
 * Placement: inside the travel column, on its bottom line (where the gesture hint
 * sits; the hint steps aside while the controls show). The column is the one
 * place the globe's disc never reaches, so the buttons never float over the
 * paint. Desktop travel only (phones pinch).
 *
 * Visibility (written by the overlay's frame loop, never React state):
 *   data-on     travelIn > 0.55: rendered and focusable (else visibility hidden,
 *               so they leave the tab order)
 *   data-shown  zoom01 > 0.05: visible; at the choreographed framing they stay
 *               quiet (transparent) until one takes keyboard focus, so a
 *               keyboard user can still start zooming
 */
import { useEffect, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from '../ui/IconButton'
import { Icon } from '../art/icons'
import { globeActions } from '../three/controls'

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

export function ViewControls({ rootRef }: { rootRef: RefObject<HTMLDivElement | null> }) {
  const col = useColumn()
  if (!col) return null
  return createPortal(
    <div ref={rootRef} className="view-controls" role="group" aria-label="Globe view">
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
