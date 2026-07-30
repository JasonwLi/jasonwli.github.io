// Dumps world-atlas land polygons as plain JSON rings for the mask rasterizer.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import * as topojson from 'topojson-client'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

const world = JSON.parse(readFileSync(require.resolve('world-atlas/land-110m.json'), 'utf8'))
const land = topojson.feature(world, world.objects.land)

// each polygon: [exteriorRing, ...holeRings]; ring = [[lon, lat], ...]
const polys = []
const geoms = land.type === 'FeatureCollection' ? land.features.map((f) => f.geometry) : [land.geometry]
for (const g of geoms) {
  if (g.type === 'Polygon') polys.push(g.coordinates)
  else for (const p of g.coordinates) polys.push(p)
}

writeFileSync(join(__dirname, 'land-polys.json'), JSON.stringify(polys))
console.log(`wrote ${polys.length} polygons`)
