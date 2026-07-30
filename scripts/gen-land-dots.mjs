// Generates src/data/land-dots.json: [lat, lon] pairs sampling Earth's landmass
// on a fibonacci-sphere lattice, tested against world-atlas land polygons.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import * as topojson from 'topojson-client'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

const world = JSON.parse(readFileSync(require.resolve('world-atlas/land-110m.json'), 'utf8'))
const land = topojson.feature(world, world.objects.land)

// point-in-polygon on [lon, lat]
function inRing(pt, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function inPolygon(pt, coords) {
  if (!inRing(pt, coords[0])) return false
  for (let h = 1; h < coords.length; h++) if (inRing(pt, coords[h])) return false
  return true
}

function onLand(lon, lat) {
  for (const geom of land.features ? land.features.map(f => f.geometry) : [land.geometry]) {
    if (geom.type === 'Polygon') {
      if (inPolygon([lon, lat], geom.coordinates)) return true
    } else {
      for (const poly of geom.coordinates) if (inPolygon([lon, lat], poly)) return true
    }
  }
  return false
}

// fibonacci sphere: even density, no pole clustering
const N = 42000
const dots = []
const GA = Math.PI * (3 - Math.sqrt(5))
for (let i = 0; i < N; i++) {
  const y = 1 - (i / (N - 1)) * 2
  const lat = (Math.asin(y) * 180) / Math.PI
  const lon = (((GA * i) % (2 * Math.PI)) * 180) / Math.PI - 180
  if (onLand(lon, lat)) dots.push([+lat.toFixed(2), +lon.toFixed(2)])
}

mkdirSync(join(__dirname, '../src/data'), { recursive: true })
// flat Float32-friendly array [lat0, lon0, lat1, lon1, ...]
writeFileSync(join(__dirname, '../src/data/land-dots.json'), JSON.stringify(dots.flat()))
console.log(`wrote ${dots.length} land dots`)
