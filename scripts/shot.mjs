#!/usr/bin/env node
// Headless screenshot + console check for the site.
//
//   node scripts/shot.mjs --url http://localhost:5199 --params 'rafshim=1&debug=1&tier=mid' \
//     --scroll travel --view 'lat=46,lon=10,km=600,tilt=0.45' --mode climate \
//     --w 1440 --h 900 --dpr 1 --wait 5000 --probe 700,450 --out scripts/.cache/shots/x.png
//
// Flags
//   --url          base URL (default http://localhost:5199)
//   --params       query string; rafshim=1 is ALWAYS added (hidden/headless Chrome freezes rAF;
//                  src/dev-errors.ts installs a timer shim). Pass tier= explicitly: the tier probe
//                  classifies headless SwiftShader as LOW.
//   --wait-server  poll the URL for up to 30 s before loading (use after serve.sh start)
//   --scroll       hero|work|travel|contact (element.scrollIntoView, instant)
//   --view         'lat=..,lon=..,km=..,tilt=..' -> window.__globe.setView(...)
//   --mode         terrain|climate -> window.__globe.setMode(...)
//   --wait         ms to wait after load/scroll/view (default 5000)
//   --w --h --dpr  viewport (default 1440x900 @1)
//   --probe x,y    print the RGB of one CSS pixel of the screenshot (repeatable: 'x,y;x,y')
//   --ignore re    regex of console errors to ignore
//   --out          png path (default scripts/.cache/shots/shot.png)
// Exit 1 when window.__errs or console errors (after --ignore) are non-empty.
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const require = createRequire(import.meta.url)
const puppeteer = require('/opt/homebrew/lib/node_modules/chrome-local-mcp/node_modules/puppeteer/')

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else {
      out[key] = next
      i++
    }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const base = String(args.url ?? 'http://localhost:5199').replace(/\/$/, '')
const params = new URLSearchParams(String(args.params ?? 'rafshim=1&debug=1'))
params.set('rafshim', '1')
const W = Number(args.w ?? 1440)
const H = Number(args.h ?? 900)
const DPR = Number(args.dpr ?? 1)
const WAIT = Number(args.wait ?? 5000)
const OUT = String(args.out ?? 'scripts/.cache/shots/shot.png')
const ignore = args.ignore ? new RegExp(String(args.ignore)) : null
const url = `${base}/?${params.toString()}`

async function waitServer(u) {
  const t0 = Date.now()
  while (Date.now() - t0 < 30000) {
    try {
      const r = await fetch(u)
      if (r.ok) return true
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

if (args['wait-server'] && !(await waitServer(base + '/'))) {
  console.error(`shot: server ${base} not reachable after 30 s`)
  process.exit(1)
}

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
})
let failed = false
try {
  const page = await browser.newPage()
  await page.setViewport({ width: W, height: H, deviceScaleFactor: DPR })
  const consoleErrs = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrs.push(m.text())
  })
  page.on('pageerror', (e) => consoleErrs.push(`pageerror: ${e.message}`))
  page.on('requestfailed', (r) => {
    const f = r.failure()?.errorText ?? ''
    if (!f.includes('ERR_ABORTED')) consoleErrs.push(`requestfailed: ${r.url()} ${f}`)
  })

  await page.goto(url, { waitUntil: 'load', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1500))

  if (args.scroll) {
    const id = String(args.scroll)
    await page.evaluate((id) => {
      const el = document.getElementById(id)
      if (!el) throw new Error(`no #${id}`)
      el.scrollIntoView({ block: 'start', behavior: 'instant' })
    }, id)
  }
  if (args.view) {
    const v = Object.fromEntries(
      String(args.view)
        .split(',')
        .map((kv) => kv.split('='))
        .map(([k, val]) => [k.trim(), Number(val)]),
    )
    await page.evaluate((v) => {
      const g = window.__globe
      if (!g?.setView) throw new Error('window.__globe.setView missing (need ?debug=1 or dev)')
      g.setView(v)
    }, v)
  }
  if (args.mode) {
    await page.evaluate((m) => {
      const g = window.__globe
      if (!g?.setMode) throw new Error('window.__globe.setMode missing')
      g.setMode(m)
    }, String(args.mode))
  }

  await new Promise((r) => setTimeout(r, WAIT))

  mkdirSync(dirname(OUT), { recursive: true })
  await page.screenshot({ path: OUT })
  console.log(`shot: ${OUT} (${W}x${H}@${DPR}) ${url}`)

  if (args.probe) {
    const pts = String(args.probe)
      .split(';')
      .map((p) => p.split(',').map(Number))
    const rgb = await page.evaluate(
      async (pts, src) => {
        const img = new Image()
        img.src = src
        await img.decode()
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const ctx = c.getContext('2d')
        ctx.drawImage(img, 0, 0)
        const k = img.width / window.innerWidth
        return pts.map(([x, y]) => [x, y, ...ctx.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data.slice(0, 3)])
      },
      pts,
      'data:image/png;base64,' + (await page.screenshot({ encoding: 'base64' })),
    )
    for (const [x, y, r, g, b] of rgb) console.log(`probe ${x},${y}: rgb(${r}, ${g}, ${b})`)
  }

  const pageErrs = await page.evaluate(() => window.__errs ?? [])
  const errs = [...pageErrs, ...consoleErrs].filter((e) => !(ignore && ignore.test(e)))
  if (errs.length) {
    failed = true
    console.error(`shot: ${errs.length} error(s):`)
    for (const e of errs) console.error('  ' + e)
  } else {
    console.log('shot: no console errors')
  }
} catch (e) {
  failed = true
  console.error('shot: failed:', e?.message ?? e)
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
