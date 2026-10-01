import { lazy, Suspense, useEffect, useState } from 'react'
import { LazyMotion, domAnimation } from 'motion/react'
import { GlobeScene } from './three/GlobeScene'
import { Nav } from './sections/Nav'
import { Hero } from './sections/Hero'
import { Work } from './sections/Work'
import { Travel } from './sections/Travel'
import { Footer } from './sections/Footer'
import { useSite } from './state/store'
import { useLenis } from './hooks/useLenis'
import './styles/site.css'

// The static SVG globe (no WebGL2, ?gstyle=svg, or after a second WebGL context
// loss): a lazy chunk, so the 128 KB coastline JSON never rides in the entry bundle.
const FallbackGlobe = lazy(() => import('./art/FallbackGlobe'))
// The lightbox is needed only once a photograph is opened: its own chunk, fetched
// when a gallery opens (so the first open never waits) and mounted from then on.
const loadLightbox = () => import('./sections/Lightbox')
const Lightbox = lazy(() => loadLightbox().then((m) => ({ default: m.Lightbox })))

function LightboxMount() {
  const active = useSite((s) => s.active)
  const open = useSite((s) => s.lightbox) !== null
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    if (active) void loadLightbox()
  }, [active])
  if (open && !mounted) setMounted(true)
  return mounted ? (
    <Suspense fallback={null}>
      <Lightbox />
    </Suspense>
  ) : null
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas')
    // three r185's WebGLRenderer needs WebGL2: WebGL1-only browsers get the SVG globe
    const gl = c.getContext('webgl2')
    // hand the probe context straight back so the real canvas never competes with it
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    return !!gl
  } catch {
    return false
  }
}
const svgGlobe =
  typeof window !== 'undefined' &&
  (new URLSearchParams(window.location.search).get('gstyle') === 'svg' || !webglAvailable())

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const cb = () => setReduced(mq.matches)
    mq.addEventListener('change', cb)
    return () => mq.removeEventListener('change', cb)
  }, [])
  return reduced
}

export default function App() {
  const reducedMotion = usePrefersReducedMotion()
  useLenis(!reducedMotion)
  const [fallback, setFallback] = useState(svgGlobe)

  // m.* components + the domAnimation feature set (opacity/transform, exit, inView):
  // the full motion component's ~40 KB of features never ship
  return (
    <LazyMotion features={domAnimation} strict>
      {fallback ? (
        <Suspense fallback={null}>
          <FallbackGlobe />
        </Suspense>
      ) : (
        <GlobeScene reducedMotion={reducedMotion} onContextFailed={() => setFallback(true)} />
      )}
      <Nav reducedMotion={reducedMotion} />
      <main>
        <Hero reducedMotion={reducedMotion} />
        <Work />
        <Travel />
        <Footer />
      </main>
      <LightboxMount />
    </LazyMotion>
  )
}
