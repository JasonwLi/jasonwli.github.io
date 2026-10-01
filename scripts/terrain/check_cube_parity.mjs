#!/usr/bin/env node
// Parity check between the two copies of the GL cube table:
//   src/three/geo/cubemap.ts  (TS, runtime)   and   scripts/terrain/lib/cube.py (numpy, bake)
// Run: node --experimental-strip-types scripts/terrain/check_cube_parity.mjs
// Exits 1 if any lat/lon, direction or face/s/t differs by more than 1e-9, or if the
// anchor checks fail (+X centre = lat 0 lon 0; +Y = north pole; lon 90E = -Z).
// Python: $TERRAIN_PY, else scripts/terrain/.venv, else scripts/.cache/venv.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { faceTexelToDir, dirToLatLon, dirToFaceUV, latLonToDir } from '../../src/three/geo/cubemap.ts'
import { Vector3 } from 'three'
import { latLonToVec3 } from '../../src/three/globeMath.ts'

const root = new URL('../..', import.meta.url).pathname
const pyCandidates = [
  process.env.TERRAIN_PY,
  join(root, 'scripts/terrain/.venv/bin/python'),
  join(root, 'scripts/.cache/venv/bin/python'),
].filter(Boolean)
const py = pyCandidates.find((p) => existsSync(p))
if (!py) {
  console.error('cube-parity: no venv python; run bash scripts/terrain/setup.sh')
  process.exit(1)
}

// deterministic random cases (mulberry32)
let seed = 0x5eed1234
const rnd = () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const SIZES = [1, 2, 7, 64, 256, 512, 1024, 2048]
const cases = []
for (let i = 0; i < 600; i++) {
  const n = SIZES[Math.floor(rnd() * SIZES.length)]
  cases.push([Math.floor(rnd() * 6), Math.floor(rnd() * n), Math.floor(rnd() * n), n])
}
// edges and corners explicitly
for (const f of [0, 1, 2, 3, 4, 5]) for (const [r, c] of [[0, 0], [0, 255], [255, 0], [255, 255], [128, 128]]) cases.push([f, r, c, 256])

const pyCode = `
import sys, json
sys.path.insert(0, ${JSON.stringify(join(root, 'scripts/terrain'))})
import numpy as np
from lib.cube import texel_dir, dirs_to_latlon, dirs_to_face_uv
cases = json.load(sys.stdin)
out = []
for f, r, c, n in cases:
    d = texel_dir(f, c, r, n)
    lat, lon = dirs_to_latlon(d)
    ff, s, t = dirs_to_face_uv(d)
    out.append([float(d[0]), float(d[1]), float(d[2]), float(lat), float(lon), int(ff), float(s), float(t)])
json.dump(out, sys.stdout)
`
const res = JSON.parse(execFileSync(py, ['-c', pyCode], { input: JSON.stringify(cases), maxBuffer: 1 << 26 }).toString())

const TOL = 1e-9
let worst = 0
let bad = 0
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180)
cases.forEach(([f, r, c, n], i) => {
  const d = faceTexelToDir(f, c, r, n)
  const ll = dirToLatLon(d)
  const uv = dirToFaceUV(d)
  const p = res[i]
  const diffs = [
    Math.abs(d.x - p[0]),
    Math.abs(d.y - p[1]),
    Math.abs(d.z - p[2]),
    Math.abs(ll.lat - p[3]),
    // longitude is undefined at the poles; compare on the circle elsewhere
    Math.abs(Math.cos((ll.lat * Math.PI) / 180)) < 1e-12 ? 0 : angDiff(ll.lon, p[4]),
    uv.face === p[5] ? 0 : Infinity,
    Math.abs(uv.s - p[6]),
    Math.abs(uv.t - p[7]),
  ]
  const m = Math.max(...diffs)
  worst = Math.max(worst, m)
  if (m > TOL) {
    bad++
    if (bad <= 10) console.error(`MISMATCH face ${f} row ${r} col ${c} N ${n}: ts`, [d.x, d.y, d.z, ll.lat, ll.lon, uv.face, uv.s, uv.t], 'py', p)
  }
  // TS self-consistency: face/s/t inverts the texel
  const sExp = (2 * (c + 0.5)) / n - 1
  const tExp = (2 * (r + 0.5)) / n - 1
  if (uv.face === f && (Math.abs(uv.s - sExp) > TOL || Math.abs(uv.t - tExp) > TOL)) {
    bad++
    console.error(`ROUNDTRIP face ${f} row ${r} col ${c} N ${n}: s,t`, uv.s, uv.t, 'expected', sExp, tExp)
  }
})

// anchor checks
const N = 512
const checks = []
const near = (a, b, tol = 1e-2) => Math.abs(a - b) < tol
{
  const d = faceTexelToDir(0, N / 2, N / 2, N)
  const ll = dirToLatLon(d)
  checks.push(['+X centre ≈ (1,0,0), lat 0, lon 0', near(d.x, 1) && near(d.y, 0) && near(d.z, 0) && near(ll.lat, 0, 0.5) && near(ll.lon, 0, 0.5)])
}
{
  const d = faceTexelToDir(2, N / 2, N / 2, N)
  checks.push(['+Y centre is the north pole', dirToLatLon(d).lat > 89.5 && near(d.y, 1)])
  const s = faceTexelToDir(3, N / 2, N / 2, N)
  checks.push(['-Y centre is the south pole', dirToLatLon(s).lat < -89.5])
}
{
  const d = latLonToDir(0, 90)
  checks.push(['lon 90E → −Z', near(d.z, -1, 1e-12) && dirToFaceUV(d).face === 5])
  const ll = dirToLatLon(latLonToDir(37.5, -122.25, new Vector3()))
  checks.push(['latLonToDir ∘ dirToLatLon = id', near(ll.lat, 37.5, 1e-12) && near(ll.lon, -122.25, 1e-12)])
  let worstG = 0
  for (let i = 0; i < 200; i++) {
    const la = rnd() * 180 - 90
    const lo = rnd() * 360 - 180
    worstG = Math.max(worstG, latLonToDir(la, lo).distanceTo(latLonToVec3(la, lo, 1)))
  }
  checks.push([`latLonToDir == globeMath.latLonToVec3 (worst ${worstG.toExponential(1)})`, worstG < 1e-12])
  // row 0 = top: on a side face, row 0 is north of the last row
  const top = dirToLatLon(faceTexelToDir(4, N / 2, 0, N)).lat
  const bottom = dirToLatLon(faceTexelToDir(4, N / 2, N - 1, N)).lat
  checks.push(['row 0 = top (north) on +Z', top > 40 && bottom < -40])
}
for (const [name, ok] of checks) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (!ok) bad++
}
console.log(`cube-parity: ${cases.length} cases, worst |diff| = ${worst.toExponential(2)} (tol ${TOL}), python ${py}`)
if (bad) {
  console.error(`cube-parity: ${bad} failure(s)`)
  process.exit(1)
}
console.log('cube-parity: OK')
