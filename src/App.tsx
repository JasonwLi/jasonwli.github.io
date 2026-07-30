import { useEffect, useState } from 'react'
import { GlobeScene } from './three/GlobeScene'
import { Hero } from './sections/Hero'
import { Work } from './sections/Work'
import { Travel } from './sections/Travel'
import { Footer } from './sections/Footer'
import { Lightbox } from './sections/Lightbox'
import { useLenis } from './hooks/useLenis'
import './styles/site.css'

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

  return (
    <>
      <GlobeScene reducedMotion={reducedMotion} />
      <nav className="site-nav" aria-label="Site">
        <a className="mono" href="#work">
          work
        </a>
        <a className="mono" href="#travel">
          travel
        </a>
        <a className="mono" href="#contact">
          contact
        </a>
      </nav>
      <main>
        <Hero reducedMotion={reducedMotion} />
        <Work />
        <Travel />
        <Footer />
      </main>
      <Lightbox />
    </>
  )
}
