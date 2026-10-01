/**
 * Footer credits line. Renders only from src/data/credits.ts, so every source
 * carries its link (and licence where required: Beck et al. is CC BY 4.0).
 * Each source is a cut-underline link; separators are drawn dots.
 */
import { Fragment } from 'react'
import { Dot } from '../art'
import { credits } from '../data/credits'

export function Credits() {
  return (
    <p className="credits">
      {credits.map((c, i) => (
        <Fragment key={c.id}>
          {i > 0 && <Dot />}
          <a className="link" href={c.url} target="_blank" rel="noopener noreferrer">
            {c.text}
          </a>
          {c.licenceUrl && (
            <>
              {' '}
              <a
                className="link"
                href={c.licenceUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Licence for ${c.text}`}
              >
                licence
              </a>
            </>
          )}
        </Fragment>
      ))}
    </p>
  )
}
export default Credits
