import { motion, useReducedMotion } from 'motion/react'
import { roles } from '../data/work'

export function Work() {
  const reduce = useReducedMotion()
  const rise = {
    initial: reduce ? false : { opacity: 0, y: 16 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: '-60px' },
  } as const
  return (
    <section id="work" className="work">
      <header className="work-head">
        <h2>The work</h2>
      </header>

      <ol className="log" aria-label="Roles">
        {roles.map((r, i) => (
          <motion.li
            className="log-row prose"
            key={r.company}
            {...rise}
            transition={{ duration: 0.7, delay: i * 0.06, ease: [0.25, 1, 0.5, 1] }}
          >
            <div className="log-when">
              <span className="mono">{r.period}</span>
              <span className="mono log-where">{r.location}</span>
            </div>
            <div className="log-what">
              <h3>
                {r.company}
                <span className="log-role"> — {r.role}</span>
              </h3>
              <p className="log-summary">{r.summary}</p>
            </div>
          </motion.li>
        ))}
      </ol>

    </section>
  )
}
