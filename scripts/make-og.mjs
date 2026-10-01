#!/usr/bin/env node
// Link preview card (1200x630) in the Astrolabe world, from the live site itself.
//
//   ~/dev/dw3-lock bash -c 'scripts/serve.sh start 5321 && node scripts/make-og.mjs --url http://localhost:5321; scripts/serve.sh stop 5321'
//   (or: ~/dev/dw3-lock scripts/terrain/.venv/bin/python scripts/make_og.py, which wraps all of it
//    and quantizes the result under the size budget)
//
// 1. Loads the hero at 1440x900 @2x (tier=high, reduced motion so every cut is drawn) and
//    captures the painted globe inside its gilt degree limb, pins and overlay included, with
//    the throne and the nav hidden: a real render, not a redraw.
// 2. In the same page (so the site's own tokens.css, art.css and self-hosted Castoro faces
//    are loaded), lays a 1200x630 card over everything: the heat-blued steel ground, the
//    hero's own throne (crest, "JASON LI" in Castoro Titling, double rule, silver tagline)
//    cloned from the DOM, the live counts line cloned from the travel column, and the
//    globe capture on the right. Screenshot at @1 -> --out (default scripts/.cache/og/og-raw.png).
//
// Flags: --url (default http://localhost:5321) --out <png> --globe-out <png> --wait-max <ms>
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const require = createRequire(import.meta.url)
const puppeteer = require('/opt/homebrew/lib/node_modules/chrome-local-mcp/node_modules/puppeteer/')

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') ? true : (all[i + 1] ?? true)] : null))
    .filter(Boolean),
)
const BASE = String(args.url ?? 'http://localhost:5321').replace(/\/$/, '')
const OUT = String(args.out ?? 'scripts/.cache/og/og-raw.png')
const GLOBE_OUT = String(args['globe-out'] ?? 'scripts/.cache/og/globe@2x.png')
const WAIT_MAX = Number(args['wait-max'] ?? 45000)
const W = 1200
const H = 630

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
})
let failed = false
try {
  const page = await browser.newPage()
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })
  await page.goto(`${BASE}/?rafshim=1&debug=1&tier=high`, { waitUntil: 'load', timeout: 60000 })

  // the painted surface (stage C: splats, detail, rivers), the monuments and the fonts, then a few settled frames
  const t0 = Date.now()
  for (;;) {
    const ok = await page.evaluate(() => {
      const s = window.__globe?.state
      return !!s && (s.stage === 'C' || s.stage === 'D') && s.surfaceReady && document.fonts.status === 'loaded'
    })
    if (ok) break
    if (Date.now() - t0 > WAIT_MAX) throw new Error('globe never reached stage C')
    await sleep(500)
  }
  await sleep(4000)

  // the globe alone: hide the throne, the scroll cue and the nav (the overlay stays)
  await page.addStyleTag({ content: '.throne, .scroll-cue, .site-nav { visibility: hidden !important; }' })
  await sleep(600)
  const geo = await page.evaluate(() => {
    const s = window.__globe.state
    return { cx: s.centerPx[0], cy: s.centerPx[1], r: s.radiusPx }
  })
  // the limb ring reaches R + 48 and its radial numerals sit just outside it
  const half = Math.ceil(geo.r + 84)
  const clip = { x: geo.cx - half, y: geo.cy - half, width: half * 2, height: half * 2 }
  if (clip.x < 0 || clip.y < 0 || clip.x + clip.width > 1440 || clip.y + clip.height > 900) {
    throw new Error(`globe + limb leave the viewport: ${JSON.stringify(geo)}`)
  }
  mkdirSync(dirname(GLOBE_OUT), { recursive: true })
  const globePng = await page.screenshot({ clip, type: 'png' })
  writeFileSync(GLOBE_OUT, globePng)

  // live counts (the travel column's own stats line) and the throne, cloned as they render
  const parts = await page.evaluate(() => {
    const throne = document.querySelector('.throne')
    const stats = document.querySelector('.travel-stats')
    return {
      throne: throne?.outerHTML ?? '',
      stats: stats?.outerHTML ?? '',
      statsText: stats?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    }
  })
  if (!parts.throne) throw new Error('no .throne in the page')

  // the card, laid over the live page so its stylesheets and faces apply
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
  const globeSrc = `data:image/png;base64,${Buffer.from(globePng).toString('base64')}`
  await page.evaluate(
    ({ throne, stats, globeSrc, W, H }) => {
      const card = document.createElement('div')
      card.id = 'og-card'
      card.innerHTML = `
        <style>
          #og-card { position: fixed; inset: 0; z-index: 2147483647; width: ${W}px; height: ${H}px;
            background: var(--steel); overflow: hidden; }
          #og-card .og-globe { position: absolute; width: 612px; height: 612px; left: 566px; top: 9px; }
          #og-card .og-left { position: absolute; left: 72px; top: 0; bottom: 0; width: 470px;
            display: flex; flex-direction: column; justify-content: center; }
          #og-card .throne { visibility: visible !important; zoom: 0.84; }
          #og-card .hero-name, #og-card .hero-sub { animation: none !important; clip-path: none !important;
            opacity: 1 !important; transform: none !important; }
          #og-card .hero-sub { max-width: 31ch; font-size: 23px; line-height: 1.45; margin-top: 26px; }
          #og-card .travel-stats { margin-top: 26px; font-size: 16px; color: var(--silver-2); }
        </style>
        <img class="og-globe" alt="" src="${globeSrc}">
        <div class="og-left">${throne}${stats}</div>`
      document.body.appendChild(card)
    },
    { throne: parts.throne, stats: parts.stats, globeSrc, W, H },
  )
  await page.evaluate(async () => {
    await document.fonts.ready
    const img = document.querySelector('#og-card .og-globe')
    await img.decode()
  })
  await sleep(300)
  mkdirSync(dirname(OUT), { recursive: true })
  await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: W, height: H } })
  console.log(`make-og: ${OUT} (${W}x${H}); globe ${GLOBE_OUT} (R ${geo.r.toFixed(1)} px @2x); counts "${parts.statsText}"`)
} catch (e) {
  failed = true
  console.error('make-og: failed:', e?.message ?? e)
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
