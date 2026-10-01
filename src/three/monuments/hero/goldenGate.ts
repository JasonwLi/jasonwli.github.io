/**
 * Golden Gate Bridge in International Orange (a low-chroma brick red here): the two
 * art-deco towers, each leg stepping back at every portal, the stepped portal struts
 * above the deck and the X-bracing below it, on concrete piers; the two main cables in
 * their catenaries over the main span and down the side spans to the anchorages, the
 * vertical suspenders, and the stiffening-truss deck running on to the approach
 * viaducts. Laid on the diagonal so it recedes (the Marin headlands view); the span is
 * compressed relative to the towers so the towers read at 40 px.
 */
import type { Kit, V3 } from '../kit.ts'
import { M } from '../palette.ts'
import { chain, rod, sagPts } from './parts.ts'

const TX = 0.92 // tower x
const TOP = 0.86
const DECK = 0.24
const ZL = 0.052 // leg / cable z

function tower(k: Kit, x: number) {
  // pier and fender
  k.box(x, 0, 0, 0.16, 0.035, 0.2, M.stoneShade)
  k.box(x, 0.035, 0, 0.12, 0.02, 0.15, M.stoneShade)
  // legs: setbacks at each portal
  const st = [0.055, 0.42, 0.585, 0.73, TOP]
  const wx = [0.07, 0.06, 0.052, 0.045, 0.04]
  for (const s of [-1, 1]) {
    let y = st[0]
    k.box(x, y, s * ZL, wx[0], st[1] - y - 0.0, 0.034, M.rust)
    for (let i = 1; i < st.length - 1; i++) {
      y = st[i]
      k.box(x, y, s * ZL, wx[i], st[i + 1] - y, 0.03 - i * 0.002, M.rust)
    }
    // vertical recessed flutes on the outer face of each leg (art-deco ribbing)
    k.box(x, 0.06, s * (ZL + 0.0172), 0.012, TOP - 0.1, 0.002, M.brick)
  }
  // portal struts above the deck (stepped tops), the top one doubled
  for (const y of [0.385, 0.55, 0.7]) {
    k.box(x, y, 0, 0.034, 0.03, ZL * 2, M.rust)
    k.box(x, y + 0.03, 0, 0.028, 0.008, ZL * 1.4, M.rust)
  }
  k.box(x, TOP - 0.05, 0, 0.04, 0.035, ZL * 2, M.rust)
  k.box(x, TOP - 0.015, 0, 0.034, 0.015, ZL * 1.6, M.rust)
  // X-bracing under the deck
  k.beam([x, 0.06, -ZL], [x, DECK - 0.03, ZL], 0.016, 0.012, M.rust)
  k.beam([x, 0.06, ZL], [x, DECK - 0.03, -ZL], 0.016, 0.012, M.rust)
  // saddles on top
  for (const s of [-1, 1]) k.box(x, TOP, s * ZL, 0.045, 0.012, 0.022, M.rust)
}

export function goldenGate(k: Kit) {
  k.push(0, 0, 0, -0.5)
  tower(k, -TX)
  tower(k, TX)
  // deck: stiffening truss (a deep band) and the roadway
  const X = 1.62
  k.box(0, DECK - 0.03, 0, 2 * X, 0.03, ZL * 1.75, M.rust)
  k.box(0, DECK, 0, 2 * X, 0.006, ZL * 1.6, M.iron)
  // truss web hint: darker band on both faces
  for (const s of [-1, 1]) k.box(0, DECK - 0.024, s * ZL * 0.876, 2 * X - 0.02, 0.016, 0.002, M.brick)
  // anchorages and approach piers
  const AX = 1.42
  for (const s of [-1, 1]) {
    k.box(s * AX, 0, 0, 0.13, DECK + 0.02, 0.17, M.stoneShade)
    for (const dx of [0.1, 0.2]) k.box(s * (AX + dx), 0, 0, 0.03, DECK - 0.03, 0.08, M.stoneShade)
  }
  // main cables and side-span cables
  for (const s of [-1, 1]) {
    const z = s * ZL
    const main = sagPts([-TX, TOP + 0.01, z], [TX, TOP + 0.01, z], TOP - DECK - 0.02, 20)
    chain(k, main, 0.014, 0.014, M.rust)
    const left = sagPts([-AX, DECK + 0.03, z], [-TX, TOP + 0.01, z], 0.06, 6)
    const right = sagPts([TX, TOP + 0.01, z], [AX, DECK + 0.03, z], 0.06, 6)
    chain(k, left, 0.013, 0.013, M.rust)
    chain(k, right, 0.013, 0.013, M.rust)
    // suspenders: fine lines, no ink outline
    k.hull = false
    const hang = (pts: V3[], from: number, to: number) => {
      for (let i = from; i <= to; i++) {
        const p = pts[i]
        if (p[1] - DECK < 0.02) continue
        rod(k, [p[0], DECK + 0.004, z], [p[0], p[1] - 0.006, z], 0.0028, M.rust)
      }
    }
    const fine = sagPts([-TX, TOP + 0.01, z], [TX, TOP + 0.01, z], TOP - DECK - 0.02, 26)
    hang(fine, 1, 25)
    hang(sagPts([-AX, DECK + 0.03, z], [-TX, TOP + 0.01, z], 0.06, 8), 1, 7)
    hang(sagPts([TX, TOP + 0.01, z], [AX, DECK + 0.03, z], 0.06, 8), 1, 7)
    k.hull = true
  }
  k.pop()
}
