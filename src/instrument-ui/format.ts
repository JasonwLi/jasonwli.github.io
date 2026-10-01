/** The instrument's data voice (same conventions as the travel gallery: hair space, en dash). */
import type { TravelLocation } from '../data/travel'

const HAIR = ' '
const EN_DASH = '–'
const monthYear = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' })

/** '41.15° N' */
export function deg(v: number, pos: string, neg: string): string {
  return `${Math.abs(v).toFixed(2)}°${HAIR}${v >= 0 ? pos : neg}`
}

export function dateRange(loc: TravelLocation): string {
  const a = monthYear.format(new Date(loc.first * 1000))
  const b = monthYear.format(new Date(loc.last * 1000))
  return a === b ? a : `${a} ${EN_DASH} ${b}`
}

/** the meridian readout: '31° E', '0°', '180°' */
export function meridian(lambda: number): string {
  let d = Math.round(lambda)
  if (d > 180) d -= 360
  if (d <= -180) d += 360
  if (d === 0 || d === 180) return `${Math.abs(d)}°`
  return `${Math.abs(d)}°${HAIR}${d > 0 ? 'E' : 'W'}`
}
