// Generates src/data/coastlines.json: flat [latA, lonA, latB, lonB, ...] line
// segments tracing world coastlines (world-atlas 110m), for the globe's ink lines.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import * as topojson from 'topojson-client'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

const world = JSON.parse(readFileSync(require.resolve('world-atlas/land-110m.json'), 'utf8'))
const mesh = topojson.mesh(world, world.objects.land)

const segs = []
const lines = mesh.type === 'MultiLineString' ? mesh.coordinates : [mesh.coordinates]
for (const line of lines) {
  for (let i = 0; i < line.length - 1; i++) {
    const [lonA, latA] = line[i]
    const [lonB, latB] = line[i + 1]
    // skip antimeridian jumps
    if (Math.abs(lonA - lonB) > 180) continue
    segs.push(+latA.toFixed(2), +lonA.toFixed(2), +latB.toFixed(2), +lonB.toFixed(2))
  }
}

writeFileSync(join(__dirname, '../src/data/coastlines.json'), JSON.stringify(segs))
console.log(`wrote ${segs.length / 4} coastline segments`)
