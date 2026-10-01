import { useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { globeState } from '../globeState'

/**
 * True once the label engine is worth loading: the terrain reached stage B (labels.json
 * arrives with it) or the travel section is coming in. Keeps the troika chunk off the
 * hero's critical path (the hero never shows labels).
 */
export function useLabelGate(): boolean {
  const [open, setOpen] = useState(false)
  useFrame(() => {
    if (open) return
    const st = globeState.stage
    if (st === 'B' || st === 'C' || st === 'D' || globeState.travelIn > 0.05) setOpen(true)
  })
  return open
}
