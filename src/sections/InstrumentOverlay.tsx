/**
 * DOM instrument overlay mount (T1c): a shell, so the instrument itself
 * (src/instrument-ui/Overlay.tsx: limb, alidade, readouts, neatline, hover label,
 * view controls) is a lazy chunk fetched once the page has painted. It drives
 * itself from the frame bus (subscribeFrame) and never re-renders per frame.
 * (vite.config.ts keeps every entry module in the one entry chunk, so the lazy
 * chunk imports react-dom and the icons directly.)
 */
import { useEffect, useState, type ComponentType } from 'react'

export function InstrumentOverlay() {
  const [Overlay, setOverlay] = useState<ComponentType>()
  // passive effects run after the first paint: only then fetch the chunk
  useEffect(() => {
    import('../instrument-ui/Overlay').then((m) => setOverlay(() => m.default))
  }, [])
  return Overlay ? <Overlay /> : null
}
export default InstrumentOverlay
