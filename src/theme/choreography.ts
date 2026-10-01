/**
 * Scroll choreography table (T1a; critique 13). C1's CameraRig reads
 * `choreography` automatically and damps toward each entry (λ 8), lerping
 * hero -> work by workIn, -> travel by travelIn and dimming by footIn.
 *
 * Each entry is the zoom-0 silhouette the theme wants on screen, in CSS px:
 * centre, radius R, dim (0..1), pin scale (1 = 10 px photo pin) and the limb's
 * resting opacity in that section. The scroll-coupled limb fades between
 * sections are pure functions in `limbOpacityAt` (T1c's overlay calls it).
 *
 * Authored at 1440x900 and 390x844 from .plan/theme_spec.json, then fitted to
 * any viewport by rules rather than plain scaling, so the limb never runs into
 * the throne column, off screen, or (phone travel) under the heading:
 *
 *   DESKTOP  hero   (960, 470)  R 300  limb R+48 clears the name by >= 72 px
 *            work   (1150, 470) R 200  dim .87, pins 7 px, limb at rest (0.3, ticks only)
 *            travel (924, 474)  R 320  centred in the free area right of the
 *                                      column (- 12 px), limb inside it
 *            footer = travel, dim .5, limb at rest (0.3, ticks only)
 *   PHONE    hero   (195, 566)  R 146  centred in the band under the tagline
 *            work   (195, 766)  R 132  parked low, dim .87
 *            travel (195, 250)  R 140  the top-52% globe band (y 56..0.52h);
 *                                      the travel column starts at 52svh
 *                                      (site.css), so the heading is clear
 *            footer = travel, dim .5, limb at rest
 */
import type { ChoreoEntry, ChoreoSection, ChoreographyFn } from '../three/camera'

/** limb reach beyond the silhouette, px (I1's LIMB: full rim 48, compact 28) */
const LIMB_FULL = 48
const LIMB_COMPACT = 28
/** the theme's compact limb applies below this R (LIMB.compactBelowR) */
const COMPACT_BELOW_R = 220

/** phone: nav baseline ~32 px, the globe band starts under it */
const PHONE_BAND_TOP = 56
/** phone: the globe band is the top 52% of the viewport (I1 instrumentLayout) */
const PHONE_BAND_FRAC = 0.52
/** phone hero: bottom of the crest + name + 3-line tagline at 390 wide */
const PHONE_HERO_TEXT_BOTTOM = 304

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

const entry = (cx: number, cy: number, R: number, dim: number, pinScale: number, limbOpacity: number): ChoreoEntry => ({
  centerPx: [Math.round(cx * 2) / 2, Math.round(cy * 2) / 2],
  Rpx: Math.max(24, Math.round(R * 2) / 2),
  dim,
  pinScale,
  limbOpacity,
})

/** limb reach for a given R (full limb, or compact below 220 px) */
export const limbReach = (R: number) => (R < COMPACT_BELOW_R ? LIMB_COMPACT : LIMB_FULL)

/** desktop page gutter (96 px at 1440), the hero throne column's left edge */
const gutter = (w: number) => clamp(w * (96 / 1440), 24, 96)
/** right edge of the hero throne column: name (Titling clamp(46px, 5.9vw, 84px), 436 px at 84) or the 32ch tagline */
const throneRight = (w: number) => {
  const nameSize = clamp(0.059 * w, 46, 84)
  return gutter(w) + Math.max(436 * (nameSize / 84), 360)
}

function desktop(section: ChoreoSection, w: number, h: number, colRightPx: number): ChoreoEntry {
  const sy = h / 900
  const vFit = (cy: number, R: number, reach: number) => Math.min(R, cy - reach - 8, h - cy - reach - 8)
  switch (section) {
    case 'hero': {
      const cy = 470 * sy
      const left = throneRight(w) + 72 // 72 px of open steel between the name and the limb
      const right = w - 48 // nav gutter
      let R = vFit(cy, 300 * sy, LIMB_FULL)
      R = Math.min(R, (right - left) / 2 - LIMB_FULL)
      if (R < COMPACT_BELOW_R) R = Math.min(vFit(cy, 300 * sy, LIMB_COMPACT), (right - left) / 2 - LIMB_COMPACT)
      const reach = limbReach(R)
      const cx = clamp((960 / 1440) * w, left + R + reach, right - R - reach)
      return entry(cx, cy, R, 0, 1, 1)
    }
    case 'work': {
      // parked right of the 720 px text plate, dimmed; the limb rests dimmed (ticks only)
      const cy = 470 * sy
      const R = Math.min(200 * sy, cy - 24, h - cy - 24, w * (200 / 1440) + 40)
      const cx = Math.min((1150 / 1440) * w, w - R - 24)
      return entry(cx, cy, R, 0.87, 0.7, LIMB_REST)
    }
    case 'travel':
    case 'footer': {
      const left = Math.max(0, colRightPx)
      const freeW = Math.max(1, w - left)
      const cx = left + freeW / 2 - 12
      const cy = 474 * sy
      // the limb stays inside the free area with 20 px to spare on each side
      let R = Math.min(vFit(cy, 320 * sy, LIMB_FULL), freeW / 2 - 12 - LIMB_FULL - 20)
      if (R < COMPACT_BELOW_R) R = Math.min(vFit(cy, 320 * sy, LIMB_COMPACT), freeW / 2 - 12 - LIMB_COMPACT - 20)
      const footer = section === 'footer'
      return entry(cx, cy, R, footer ? 0.5 : 0, 1, footer ? LIMB_REST : 1)
    }
  }
}

function phone(section: ChoreoSection, w: number, h: number): ChoreoEntry {
  const cx = w / 2
  const sideFit = (R: number) => Math.min(R, cx - LIMB_COMPACT - 4)
  switch (section) {
    case 'hero': {
      // centred in the band between the tagline and the bottom edge
      const top = PHONE_HERO_TEXT_BOTTOM
      const bottom = h - 16
      const R = Math.min(sideFit((146 / 390) * w), (bottom - top) / 2 - LIMB_COMPACT)
      const cy = (top + bottom) / 2
      return entry(cx, cy, R, 0, 1, 1)
    }
    case 'work':
      // parked low and dimmed behind the work log, as today
      return entry(cx, (766 / 844) * h, sideFit((132 / 390) * w), 0.87, 0.7, LIMB_REST)
    case 'travel':
    case 'footer': {
      const bandBottom = PHONE_BAND_FRAC * h
      const cy = (PHONE_BAND_TOP + bandBottom) / 2
      const R = Math.min(sideFit((140 / 390) * w), (bandBottom - PHONE_BAND_TOP) / 2 - LIMB_COMPACT - 8)
      const footer = section === 'footer'
      return entry(cx, cy, R, footer ? 0.5 : 0, 1, footer ? LIMB_REST : 1)
    }
  }
}

export const choreography: ChoreographyFn = (section, { w, h, mobile, colRightPx }) =>
  mobile ? phone(section, w, h) : desktop(section, w, h, colRightPx)

/**
 * The limb's resting opacity in work and contact (finish review): the globe is never a
 * bare unframed ball; the limb stays as a dimmed ring of ticks, numerals and fiducial off.
 */
export const LIMB_REST = 0.3

type SectionIn = { workIn: number; travelIn: number; footIn: number }

/**
 * The full-strength limb (numerals, fiducial, meridian readout), scroll-coupled:
 *   hero 1; work 1 − smoothstep(0, .6, workIn); travel smoothstep(.35, .8, travelIn)
 *   ; footer 0 (fades out with footIn).
 */
export function limbFullAt({ workIn, travelIn, footIn }: SectionIn) {
  const heroWork = 1 - smoothstep(0, 0.6, workIn)
  const travel = smoothstep(0.35, 0.8, travelIn)
  return Math.max(heroWork, travel) * (1 - smoothstep(0, 0.6, footIn))
}

/**
 * Scroll-coupled limb opacity (the ring, seat, fillets and ticks): the full-strength limb,
 * or LIMB_REST while the globe is parked behind work or contact.
 * The caller multiplies by lod.limbFade and the deep-zoom stage; numerals and the
 * fiducial use limbFullAt / limbOpacityAt inside the layer.
 */
export function limbOpacityAt(g: SectionIn) {
  const rest = LIMB_REST * Math.max(smoothstep(0, 0.6, g.workIn), smoothstep(0, 0.6, g.footIn))
  return Math.max(limbFullAt(g), rest)
}

/** pin scale between sections (1 = the 10 px photo pin; work shrinks pins to 7 px) */
export function pinScaleAt({ workIn, travelIn }: { workIn: number; travelIn: number }) {
  return 1 + (0.7 - 1) * workIn * (1 - travelIn)
}
