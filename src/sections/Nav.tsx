import { useEffect, useRef, useState } from 'react'
import { IndexTriangle, ScaleRule } from '../art'
import { globeState, subscribeFrame } from '../three/globeState'

/**
 * The nav as engraved scale ticks (theme spec, nav): a ScaleRule with three
 * major stations under WORK, TRAVEL, CONTACT, and the index triangle as a
 * fiducial that physically measures where you are on the page. In the hero it
 * rests at the scale's zero; between sections it lerps across the majors by
 * scroll progress, critically damped (lerp 0.105), never vermilion.
 *
 * Labels are HTML anchors (Titling), 88x44 targets (72x44 phone); the current
 * section (IntersectionObserver) and the hovered label lift their major
 * 11 -> 15 px. Over the paint in deep zoom the labels take an incise halo.
 */
const PHONE = '(max-width: 860px)'
const ITEMS = [
  { id: 'work', label: 'Work' },
  { id: 'travel', label: 'Travel' },
  { id: 'contact', label: 'Contact' },
] as const
type Id = (typeof ITEMS)[number]['id']

const GEOM = {
  desk: { width: 264, majors: [36, 132, 228] },
  phone: { width: 216, majors: [28, 108, 188] },
}

function useMedia(q: string) {
  const [m, setM] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const cb = () => setM(mq.matches)
    mq.addEventListener('change', cb)
    return () => mq.removeEventListener('change', cb)
  }, [q])
  return m
}

export function Nav({ reducedMotion }: { reducedMotion: boolean }) {
  const phone = useMedia(PHONE)
  const g = phone ? GEOM.phone : GEOM.desk
  const [current, setCurrent] = useState<Id | null>(null)
  const [hover, setHover] = useState<Id | null>(null)
  const navRef = useRef<HTMLElement>(null)
  const fidRef = useRef<HTMLSpanElement>(null)

  // current section: the one holding the viewport's middle band
  useEffect(() => {
    const ids = ['hero', ...ITEMS.map((i) => i.id)]
    const els = ids.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e)
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) {
          if (!e.isIntersecting) continue
          const id = e.target.id
          setCurrent(id === 'hero' ? null : (id as Id))
        }
      },
      { rootMargin: '-45% 0px -54% 0px' },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  // fiducial: x = piecewise lerp over [0, majors...] by progress between section tops
  useEffect(() => {
    const stops = [0, ...g.majors]
    const tops = () =>
      ['hero', 'work', 'travel', 'contact'].map((id) => {
        const el = document.getElementById(id)
        return el ? el.getBoundingClientRect().top + window.scrollY : 0
      })
    let sectionTops = tops()
    const target = () => {
      const y = window.scrollY
      const maxY = document.documentElement.scrollHeight - window.innerHeight
      // the footer's top may never reach the viewport top: the end of the page counts as arrived
      const t = sectionTops.map((v, i) => (i === sectionTops.length - 1 ? Math.min(v, maxY) : v))
      if (y <= t[0]) return stops[0]
      for (let i = 0; i < t.length - 1; i++) {
        if (y < t[i + 1]) {
          const f = (y - t[i]) / Math.max(1, t[i + 1] - t[i])
          return stops[i] + (stops[i + 1] - stops[i]) * f
        }
      }
      return stops[stops.length - 1]
    }
    let x = target()
    let raf = 0
    const apply = () => {
      if (fidRef.current) fidRef.current.style.transform = `translateX(${x.toFixed(2)}px)`
    }
    const tick = () => {
      const tx = target()
      x = reducedMotion ? tx : x + (tx - x) * 0.105
      if (Math.abs(tx - x) < 0.05) x = tx
      apply()
      raf = x === tx ? 0 : requestAnimationFrame(tick)
    }
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(tick)
    }
    const onResize = () => {
      sectionTops = tops()
      kick()
    }
    apply()
    window.addEventListener('scroll', kick, { passive: true })
    window.addEventListener('resize', onResize)
    // layout settles after fonts and data: re-measure once things land
    const ro = new ResizeObserver(onResize)
    ro.observe(document.body)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', kick)
      window.removeEventListener('resize', onResize)
      ro.disconnect()
    }
  }, [g, reducedMotion])

  // over the paint (deep zoom, or the disc under the nav) the labels take an incise halo
  useEffect(() => {
    let on = false
    return subscribeFrame(() => {
      const nav = navRef.current
      if (!nav) return
      const a = globeState.anchors
      const next = globeState.travelIn > 0.5 && (a.limbStage !== 'full' || globeState.lod.zoom01 > 0.05)
      if (next !== on) {
        on = next
        nav.toggleAttribute('data-over-paint', on)
      }
    })
  }, [])

  const stations = g.majors.map((x, i) => ({ x, current: current === ITEMS[i].id || hover === ITEMS[i].id }))

  return (
    <nav ref={navRef} className="site-nav" aria-label="Site" style={{ width: g.width }}>
      {ITEMS.map((it, i) => (
        <a
          key={it.id}
          href={`#${it.id}`}
          className={`nav-link${current === it.id ? ' is-current' : ''}`}
          style={{ left: g.majors[i] }}
          aria-current={current === it.id ? 'location' : undefined}
          onPointerEnter={() => setHover(it.id)}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(it.id)}
          onBlur={() => setHover(null)}
        >
          {it.label}
        </a>
      ))}
      <ScaleRule className="nav-rule" width={g.width} stations={stations} draw={!reducedMotion} />
      <span className="nav-fiducial" ref={fidRef}>
        <IndexTriangle />
      </span>
    </nav>
  )
}
