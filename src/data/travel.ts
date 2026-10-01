export interface TravelPhoto {
  file: string
  w: number
  h: number
  ts: number | null
  blur: string
}

export interface TravelLocation {
  slug: string
  name: string
  region: string
  cc: string
  lat: number
  lon: number
  first: number
  last: number
  photos: TravelPhoto[]
}

interface TravelData {
  generated: string
  locations: TravelLocation[]
}

// kept out of the JS bundle (~370 KB of metadata + blur thumbs); top-level await
// means every consumer still just imports `locations` synchronously
const data: TravelData = await fetch(`${import.meta.env.BASE_URL}travel-data.json`)
  .then((r) => (r.ok ? r.json() : { generated: '', locations: [] }))
  .catch(() => ({ generated: '', locations: [] }))

/** ordered by first visit — the route */
export const locations: TravelLocation[] = [...data.locations].sort(
  (a, b) => a.first - b.first,
)

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })

export function countryName(cc: string): string {
  try {
    return regionNames.of(cc) ?? cc
  } catch {
    return cc
  }
}

/** full-resolution original — used by the lightbox */
export function photoUrl(_loc: TravelLocation, photo: TravelPhoto): string {
  return `${import.meta.env.BASE_URL}photos/${photo.file}`
}

/** 800px medium variant — what the gallery panel actually loads */
export function photoMediumUrl(_loc: TravelLocation, photo: TravelPhoto): string {
  return `${import.meta.env.BASE_URL}photos/${photo.file.replace(/\.jpg$/, '-m.jpg')}`
}

export const stats = {
  places: locations.length,
  countries: new Set(locations.map((l) => l.cc)).size,
  photos: locations.reduce((n, l) => n + l.photos.length, 0),
  firstYear: locations.length
    ? new Date(Math.min(...locations.map((l) => l.first)) * 1000).getFullYear()
    : new Date().getFullYear(),
  lastYear: locations.length
    ? new Date(Math.max(...locations.map((l) => l.last)) * 1000).getFullYear()
    : new Date().getFullYear(),
}
