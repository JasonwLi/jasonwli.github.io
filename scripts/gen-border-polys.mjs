// Dumps internal country borders (countries-110m mesh, shared edges only)
// as polylines for the mask rasterizer's border channel.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import * as topojson from 'topojson-client'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

const world = JSON.parse(readFileSync(require.resolve('world-atlas/countries-110m.json'), 'utf8'))
const mesh = topojson.mesh(world, world.objects.countries, (a, b) => a !== b)

const lines = mesh.type === 'MultiLineString' ? mesh.coordinates : [mesh.coordinates]
writeFileSync(join(__dirname, 'border-polys.json'), JSON.stringify(lines))
console.log(`wrote ${lines.length} border polylines`)
