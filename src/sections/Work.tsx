import { Dot } from '../art'
import { roles } from '../data/work'
import { SectionHeading } from './HeadingRule'

/**
 * The work plate (theme spec, work) as the instrument's engraved gazetteer: silver
 * text on flat steel, the table framed by a fine double rule, each entry ruled off by
 * a gilt fillet with scale ticks at the date column (site.css, the one tick module).
 * No icons, no hover, no ornament beyond that structure and the drawn separator dots.
 * Copy is verbatim from src/data/work.ts. The limb rests dimmed (ticks only) here.
 */
export function Work() {
  return (
    <section id="work" className="work" aria-labelledby="work-h">
      <SectionHeading id="work-h">The work</SectionHeading>

      <ol className="log" aria-label="Roles">
        {roles.map((r) => (
          // rows are visible from the first paint (craft floor: motion never starts
          // from hidden); the engraving rules carry the section's motion in CSS
          <li className="log-row prose" key={r.company}>
            <p className="log-when data">
              <span className="log-period">{r.period}</span>
              <Dot className="log-dot" />
              <span className="log-where">{r.location}</span>
            </p>
            <div className="log-what">
              <h3>
                <span className="log-company">{r.company}</span>
                {' '}
                <span className="log-role">{r.role}</span>
              </h3>
              <p className="log-summary">{r.summary}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
