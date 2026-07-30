import { useEffect, useRef } from 'react'
import Lenis from 'lenis'
import { globeState } from '../three/globeState'

export function useLenis(enabled: boolean) {
  const lenisRef = useRef<Lenis | null>(null)

  useEffect(() => {
    if (!enabled) return
    const lenis = new Lenis({
      lerp: 0.105,
      // let overlaid scrollables own their wheel events; the globe owns the
      // wheel while the pointer is on its disc in the travel section (zoom)
      prevent: (node) =>
        !!(node as HTMLElement).closest?.('.gallery, .lightbox, .loc-strip') ||
        (globeState.pointerInGlobe && globeState.travelIn > 0.55),
    })
    lenisRef.current = lenis
    let raf = 0
    const loop = (t: number) => {
      lenis.raf(t)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      lenis.destroy()
      lenisRef.current = null
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
      if (lenisRef.current) lenisRef.current.scrollTo(el, { duration: 1.4 })
      else el.scrollIntoView()
      // keep keyboard users' focus in sync with the visual jump
      el.tabIndex = -1
      el.focus({ preventScroll: true })
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])
}
