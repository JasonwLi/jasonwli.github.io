/**
 * Footer credits line. Renders only from src/data/credits.ts, so every source
 * carries its link (and licence where required: Beck et al. is CC BY 4.0).
 * Each source is a cut-underline link; separators are drawn dots.
 *
 * A list that sets as one running line on desktop. At <= 860 px (touch) each source
 * takes its own row and every link is a 44 px tall inline block (13 px type
 * unchanged, the extra height is padding), so no two targets overlap.
 */
import { Dot } from '../art'
import { credits } from '../data/credits'

export function Credits() {
  return (
    <ul className="credits" aria-label="Data and type credits">
      {credits.map((c, i) => (
        <li key={c.id}>
          {i > 0 && <Dot className="credits-dot" />}
          <a className="link" href={c.url} target="_blank" rel="noopener noreferrer">
            {c.text}
          </a>
          {c.licenceUrl && (
            <>
              {' '}
              <a
                className="link credits-licence"
                href={c.licenceUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Licence for ${c.text}`}
              >
                licence
              </a>
            </>
          )}
        </li>
      ))}
    </ul>
  )
}
export default Credits
