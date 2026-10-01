import { useEffect, useRef } from 'react'
import { Dot, Engraved, Icons } from '../art'
import { Credits } from './Credits'
import { useEnteredView } from './hooks'
import { globeState, subscribeFrame } from '../three/globeState'

// Contact is assembled at click time from encoded parts: nothing for
// address-harvesting crawlers to scrape out of the HTML or the bundle.
const ENC = {
  mail: 'anp3bDk2QGdtYWlsLmNvbQ==',
  github: 'aHR0cHM6Ly9naXRodWIuY29tL2phc29ud2xp',
  linkedin: 'aHR0cHM6Ly93d3cubGlua2VkaW4uY29tL2luL2phc29uendsaQ==',
} as const

function openContact(key: keyof typeof ENC) {
  const v = atob(ENC[key])
  if (key === 'mail') window.location.href = `mailto:${v}`
  else window.open(v, '_blank', 'noopener')
}

const ACTIONS = [
  { key: 'mail', label: 'Email', name: 'Send an email', Icon: Icons.Mail },
  {
    key: 'github',
    label: 'GitHub',
    name: 'Open GitHub profile',
    Icon: Icons.GitHub,
  },
  {
    key: 'linkedin',
    label: 'LinkedIn',
    name: 'Open LinkedIn profile',
    Icon: Icons.LinkedIn,
  },
] as const

const RULE_W = 720
/** the limb ring's reach beyond the silhouette (LIMB rim: full 48, compact 28 under R 220) */
const RING_FULL = 48
const RING_COMPACT = 28
/** clear steel between the rule's end and the ring (finish review round 2) */
const RING_GAP = 40
const RULE_MIN = 120

/**
 * The gilt rule ends short of the dimmed globe's limb ring: each frame while the rule is
 * on screen, where the rule's line crosses the ring's outer circle, the rule
 * is cut back to leave RING_GAP of steel before it (the ring rests where it did in travel).
 */
function useRuleClearOfRing(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let last = -1
    return subscribeFrame(() => {
      const g = globeState
      const plate = el.parentElement
      if (!plate) return
      const rr = el.getBoundingClientRect()
      if (rr.top > window.innerHeight || rr.bottom < 0) return
      const pr = plate.getBoundingClientRect()
      // the rule's full length: to the plate's content edge
      const full = pr.right - (parseFloat(getComputedStyle(plate).paddingRight) || 0) - rr.left
      const R = g.radiusPx + (g.radiusPx < 220 ? RING_COMPACT : RING_FULL)
      const dy = rr.top + 1 - g.centerPx[1]
      let w = full
      if (Math.abs(dy) < R && g.centerPx[0] > rr.left) {
        const ringLeft = g.centerPx[0] - Math.sqrt(R * R - dy * dy)
        w = Math.max(RULE_MIN, Math.min(full, ringLeft - RING_GAP - rr.left))
      }
      w = Math.round(w)
      if (w !== last) {
        last = w
        el.style.width = w >= Math.round(full) ? '' : `${w}px`
      }
    })
  }, [ref])
}

/**
 * The contact plate (theme spec, footer): one engraved hairline, three drawn
 * actions, the credits. No heading is added; the dimmed globe stays right.
 */
export function Footer() {
  const ruleRef = useRef<HTMLDivElement>(null)
  const seen = useEnteredView(ruleRef)
  useRuleClearOfRing(ruleRef)
  return (
    <footer id="contact" className="footer">
      <div className="footer-plate">
        <div className="footer-rule" ref={ruleRef} aria-hidden="true">
          {seen && (
            <svg
              className="art"
              width="100%"
              height="2"
              viewBox={`0 0 ${RULE_W} 2`}
              preserveAspectRatio="none"
              overflow="visible"
              focusable="false"
            >
              <Engraved
                d={`M0,1H${RULE_W}`}
                w={1}
                tone="gilt-worn"
                groove={1.5}
                draw
                drawDuration={700}
                linecap="butt"
              />
            </svg>
          )}
        </div>
        <ul className="contact-actions">
          {ACTIONS.map(({ key, label, name, Icon }) => (
            <li key={key}>
              <button type="button" className="contact-btn" onClick={() => openContact(key)} aria-label={name}>
                <Icon />
                <span className="contact-label">{label}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="footer-fine">
          <p>
            © 2026 Jason Li
            <Dot />
            all photographs mine
          </p>
          <Credits />
        </div>
      </div>
    </footer>
  )
}
