/**
 * Climate legend (C3, theme 'CLIMATE LEGEND' + critique amendment): five Köppen
 * groups as aria-pressed buttons. Hover or focus isolates a group on the globe
 * (store.isolateGroup -> uIsolate: the others drop to 35% chroma over 200 ms);
 * a click pins the isolation, a second click releases it. Under the rows, one
 * data line of the group's sub-class codes. Swatches are flat fills from
 * koppen-palette.json, the constant the shader draws with. No hatching.
 *
 * Height animates 0 -> 150 px (grid rows 0fr -> 1fr, 280 ms); closed it is inert.
 * While Köppen is loading the swatches sit dim over a gilt progress hairline.
 */
import { useEffect, useState, type CSSProperties, type PointerEvent } from 'react'
import { IndexTriangle } from '../art'
import { KOPPEN_GROUPS } from '../data/koppen'
import { useSite } from '../state/store'
import { onTerrainTextures, terrainTextures, type TerrainTextures } from '../three/terrain/textures'

const hasKoppen = (t: TerrainTextures) => !!(t.koppenIdx || t.koppenColor || t.koppenColorEq)

export function ClimateLegend({ open, phone }: { open: boolean; phone: boolean }) {
  const [pinned, setPinned] = useState(-1)
  const [hover, setHover] = useState(-1)
  const [ready, setReady] = useState(() => hasKoppen(terrainTextures))

  useEffect(() => onTerrainTextures((t) => setReady(hasKoppen(t))), [])

  // closing the legend (Terrain) releases any isolation
  useEffect(() => {
    if (!open) {
      setPinned(-1)
      setHover(-1)
    }
  }, [open])

  const shown = hover >= 0 ? hover : pinned
  useEffect(() => {
    useSite.getState().setIsolateGroup(open ? shown : -1)
  }, [open, shown])

  const enter = (i: number) => (e: PointerEvent) => {
    if (e.pointerType === 'mouse') setHover(i)
  }
  const leave = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') setHover(-1)
  }

  const group = shown >= 0 ? KOPPEN_GROUPS[shown] : null

  return (
    <div className={`climate-legend-wrap${open ? ' is-open' : ''}`} inert={!open} aria-hidden={!open}>
      <div className="climate-legend-clip">
        <div
          className={`climate-legend${ready ? '' : ' is-loading'}${phone ? ' is-phone' : ''}`}
          role="group"
          aria-label="Climate groups"
          aria-busy={!ready}
        >
          <span className="climate-progress" aria-hidden="true" />
          <ul className="climate-rows">
            {KOPPEN_GROUPS.map((g, i) => (
              <li key={g.key} style={{ '--row-i': i } as CSSProperties}>
                <button
                  type="button"
                  className="climate-row"
                  aria-label={`${g.key}, ${g.name}`}
                  aria-pressed={pinned === i}
                  onClick={() => setPinned((p) => (p === i ? -1 : i))}
                  onPointerEnter={enter(i)}
                  onPointerLeave={leave}
                  onFocus={(e) => {
                    // keyboard focus isolates like hover; a tap's focus must not (it would outlive the release)
                    if (e.currentTarget.matches(':focus-visible')) setHover(i)
                  }}
                  onBlur={() => setHover(-1)}
                >
                  <IndexTriangle rotate={90} className="climate-mark" />
                  <svg className="climate-swatch" width="16" height="12" viewBox="0 0 16 12" aria-hidden="true" focusable="false">
                    <rect x="0.5" y="0.5" width="15" height="11" fill="none" className="swatch-hairline" />
                    <rect x="1" y="1" width="14" height="10" fill={g.hex} />
                    <rect x="1.5" y="1.5" width="13" height="9" fill="none" className="swatch-incise" />
                  </svg>
                  <span className="climate-key">{g.key}</span>
                  <span className="climate-name">{g.name}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="climate-codes" aria-live="polite">
            {group &&
              group.classes.map((c) => (
                <abbr key={c.code} title={c.name}>
                  {c.code}
                </abbr>
              ))}
          </p>
        </div>
      </div>
    </div>
  )
}
export default ClimateLegend
