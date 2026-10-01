#!/usr/bin/env node
// Programmatic check of the instrument contract in a real page:
//  - window.__globe exists with setView / setMode / stage (?debug=1)
//  - globeState.pinsPx is non-empty and has visible pins
//  - anchors are written every frame and CHANGE after setView
//  - subscribeFrame fires exactly once per rendered frame
//  - the terrain manifest loads through the app's loadManifest() and every file it references is served
//
//   node scripts/probe-anchors.mjs --url http://localhost:5199 [--params 'tier=mid'] [--scroll travel] [--wait-server]
// Exit 1 on any failure. rafshim=1 and debug=1 are always added.
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const puppeteer = require('/opt/homebrew/lib/node_modules/chrome-local-mcp/node_modules/puppeteer/')

const args = {}
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue
  const k = argv[i].slice(2)
  const v = argv[i + 1]
  if (v === undefined || v.startsWith('--')) args[k] = true
  else {
    args[k] = v
    i++
  }
}
const base = String(args.url ?? 'http://localhost:5199').replace(/\/$/, '')
const params = new URLSearchParams(String(args.params ?? 'tier=mid'))
params.set('rafshim', '1')
params.set('debug', '1')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (args['wait-server']) {
  const t0 = Date.now()
  let up = false
  while (!up && Date.now() - t0 < 30000) {
    try {
      up = (await fetch(base + '/')).ok
    } catch {
      await sleep(300)
    }
  }
  if (!up) {
    console.error('probe-anchors: server not reachable')
    process.exit(1)
  }
}

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
})
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`)
}
try {
  const page = await browser.newPage()
  await page.setViewport({ width: Number(args.w ?? 1440), height: Number(args.h ?? 900) })
  const errs = []
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
  page.on('pageerror', (e) => errs.push(e.message))
  await page.goto(`${base}/?${params}`, { waitUntil: 'load', timeout: 60000 })
  await sleep(2500)
  if (args.scroll) {
    await page.evaluate((id) => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'instant' }), String(args.scroll))
    await sleep(2500)
  }

  const api = await page.evaluate(() => {
    const g = window.__globe
    return g ? { setView: typeof g.setView, setMode: typeof g.setMode, stage: typeof g.stage, sub: typeof g.subscribeFrame } : null
  })
  check('window.__globe has setView/setMode/stage/subscribeFrame', !!api && api.setView === 'function' && api.setMode === 'function' && api.stage === 'function' && api.sub === 'function', JSON.stringify(api))

  const frames = await page.evaluate(async () => {
    const g = window.__globe
    let emits = 0
    const un = g.subscribeFrame(() => emits++)
    const f0 = g.renderFrame()
    await new Promise((r) => setTimeout(r, 1500))
    const f1 = g.renderFrame()
    un()
    return { emits, renders: f1 - f0 }
  })
  check('subscribeFrame fires once per rendered frame', frames.renders > 5 && Math.abs(frames.emits - frames.renders) <= 1, JSON.stringify(frames))

  const pins = await page.evaluate(() => {
    const p = window.__globe.state.pinsPx
    let vis = 0
    for (let i = 2; i < p.length; i += 4) if (p[i] > 0.5) vis++
    return { n: p.length / 4, vis, stage: window.__globe.stage(), surface: window.__globe.state.surfaceReady }
  })
  check('pinsPx non-empty with visible pins', pins.n > 0 && pins.vis > 0, JSON.stringify(pins))

  const snap = () =>
    page.evaluate(() => {
      const a = window.__globe.state.anchors
      return { c: a.globeCenterPx.slice(), r: a.radiusPx, lambdaC: a.lambdaC, phiC: a.phiC, limbRotation: a.limbRotation, stage: a.limbStage }
    })
  const before = []
  for (let i = 0; i < 10; i++) {
    before.push(await snap())
    await sleep(16)
  }
  check('anchors populated over 10 frames', before.every((s) => s.r > 1 && Number.isFinite(s.lambdaC)), JSON.stringify(before.at(-1)))
  await page.evaluate(() => window.__globe.setView({ lat: -33.9, lon: 151.2, km: 9000 }))
  await sleep(3000)
  const after = await snap()
  const moved = Math.abs(after.lambdaC - before.at(-1).lambdaC) > 5 || Math.abs(after.phiC - before.at(-1).phiC) > 5
  check('anchors change after setView (lambdaC/phiC follow the view)', moved, `before ${before.at(-1).lambdaC.toFixed(1)},${before.at(-1).phiC.toFixed(1)} after ${after.lambdaC.toFixed(1)},${after.phiC.toFixed(1)}`)
  check('sub-camera point ≈ setView target (±20°: the lens offset tilts the view axis)', Math.abs(after.phiC + 33.9) < 20 && Math.abs((((after.lambdaC - 151.2 + 540) % 360) - 180)) < 20, `${after.phiC.toFixed(2)}, ${after.lambdaC.toFixed(2)}`)

  const man = await page.evaluate(async () => {
    const m = await window.__globe.loadManifest()
    const urls = []
    const walk = (o) => {
      if (Array.isArray(o)) o.forEach(walk)
      else if (o && typeof o === 'object')
        for (const [k, v] of Object.entries(o)) {
          if (k === 'url' && typeof v === 'string') urls.push(v)
          else if (k === 'faces') urls.push(...v)
          else walk(v)
        }
    }
    walk(m)
    const base = new URL('textures/terrain/', location.href).href
    const bad = []
    for (const u of new Set(urls)) {
      const r = await fetch(base + u)
      if (!r.ok) bad.push(`${u} ${r.status}`)
    }
    return { schema: m.schema, placeholder: m.placeholder, n: new Set(urls).size, bad }
  })
  check('manifest loads via loadManifest() and every referenced file is served', man.schema === 'terrain-manifest/1' && man.bad.length === 0, JSON.stringify(man))

  const pageErrs = await page.evaluate(() => window.__errs ?? [])
  check('no console / page errors', errs.length + pageErrs.length === 0, [...errs, ...pageErrs].join(' | '))
} catch (e) {
  check('probe ran', false, e?.message ?? String(e))
} finally {
  await browser.close()
}
process.exit(results.every(Boolean) ? 0 : 1)
