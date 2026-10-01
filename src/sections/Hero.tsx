import { useEffect, useState } from 'react'
import { Engraved } from '../art'
import { Crest } from '../art/Crest'
import { RuleLine } from './HeadingRule'
import { useInlineSize } from './hooks'

const NAME = 'Jason Li'
const PHONE = '(max-width: 860px)'

/** the scroll cue: a static 40 px gilt-worn hairline with five 4 px ticks (no text, no loop) */
const CUE_TICKS = [4, 12, 20, 28, 36].map((y) => `M5.5,${y}h4`).join('')

/**
 * The throne (theme spec, hero): the one filigree, the engraved name on its
 * double rule, the silver tagline. Arrival, about 1.4 s: the crest cuts
 * (150-850 ms), the name is revealed by one clip-path wipe (350-850 ms), the
 * tagline fades in with a 6 px rise (700-1200 ms). Reduced motion: all cut at
 * t = 0. The globe and its limb (right two-thirds) are the canvas behind.
 */
export function Hero({ reducedMotion }: { reducedMotion: boolean }) {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE).matches)
  useEffect(() => {
    const mq = window.matchMedia(PHONE)
    const cb = () => setPhone(mq.matches)
    mq.addEventListener('change', cb)
    return () => mq.removeEventListener('change', cb)
  }, [])
  const [nameRef, nameW] = useInlineSize<HTMLHeadingElement>()
  // the rule is exactly the name's width: drop the trailing tracking after the last capital
  const [track, setTrack] = useState(0)
  useEffect(() => {
    const el = nameRef.current
    if (!el) return
    setTrack(parseFloat(getComputedStyle(el).letterSpacing) || 0)
  }, [nameRef, nameW])
  const ruleW = Math.max(0, nameW - track)
  const draw = !reducedMotion

  return (
    <section id="hero" className={`hero${draw ? ' hero--arrive' : ''}`}>
      <div className="throne">
        <div className="throne-crest" style={ruleW ? { width: ruleW } : undefined}>
          <Crest width={phone ? 200 : 300} draw={draw} />
        </div>
        <h1 className="hero-name" ref={nameRef}>
          {NAME}
        </h1>
        <RuleLine className="hero-rule" width={ruleW} variant="double" draw={draw} drawDelay={350} />
        <p className="hero-sub">
          Payments, FX and stablecoin infrastructure by day. A globe of every place photographed in
          person.
        </p>
      </div>
      <svg className="art scroll-cue" width="11" height="40" viewBox="0 0 11 40" aria-hidden="true" focusable="false">
        <Engraved d="M5.5,0V40" w={1} tone="gilt-worn" groove={1.5} linecap="butt" />
        <Engraved d={CUE_TICKS} w={1} tone="gilt-worn" groove={1.5} linecap="butt" />
      </svg>
    </section>
  )
}
