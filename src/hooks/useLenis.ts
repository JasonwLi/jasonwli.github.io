import { useEffect } from 'react'
import Lenis from 'lenis'
import { globeState } from '../three/globeState'

let current: Lenis | null = null

/** The live Lenis instance, or null when smooth scroll is off (reduced motion). */
export function getLenis(): Lenis | null {
  return current
}

export function useLenis(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const lenis = new Lenis({
      lerp: 0.105,
      // let overlaid scrollables own their wheel events; the globe owns the wheel
      // when controls.ts says so (globeState.wheelOwner: travel, pointer on the
      // canvas and not over UI, on the disc or zoomed in, escape hatch not open).
      // controls.ts listens in the capture phase, so the owner is already updated
      // for this very event when Lenis asks.
      prevent: (node) =>
        !!(node as HTMLElement).closest?.('.travel-panel, .gallery, .lightbox') ||
        globeState.wheelOwner === 'globe',
    })
    current = lenis
    let raf = 0
    const loop = (t: number) => {
      lenis.raf(t)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      lenis.destroy()
      if (current === lenis) current = null
    }
  }, [enabled])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a[href^="#"]')
      if (!a) return
      const id = a.getAttribute('href')!.slice(1)
      const el = document.getElementById(id)
      if (!el) return
      e.preventDefault()
      if (current) current.scrollTo(el, { duration: 1.4 })
      else el.scrollIntoView()
      // keep keyboard users' focus in sync with the visual jump
      el.tabIndex = -1
      el.focus({ preventScroll: true })
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])
}
