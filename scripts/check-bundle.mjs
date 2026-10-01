#!/usr/bin/env node
// Gzip every JS/CSS file in <dist>/assets, find the entry chunk from index.html,
// and compare against scripts/bundle-budget.json. Exit 1 on any breach.
//   node scripts/check-bundle.mjs [distDir]   (default: dist)
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { gzipSync } from 'node:zlib'

const root = new URL('..', import.meta.url).pathname
const dist = process.argv[2] ?? 'dist'
const budget = JSON.parse(readFileSync(join(root, 'scripts/bundle-budget.json'), 'utf8'))
const assets = join(dist, 'assets')
if (!existsSync(assets)) {
  console.error(`check-bundle: ${assets} not found (build first)`)
  process.exit(1)
}
const html = readFileSync(join(dist, 'index.html'), 'utf8')
// the entry = the module <script> plus every chunk it statically imports (Vite emits
// those as <link rel="modulepreload">); everything else is a lazy chunk
const entryNames = new Set([
  ...[...html.matchAll(/<script[^>]+src="[^"]*\/assets\/([^"]+\.js)"/g)].map((m) => m[1]),
  ...[...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="[^"]*\/assets\/([^"]+\.js)"/g)].map((m) => m[1]),
])
const kb = (n) => n / 1024
const rows = readdirSync(assets)
  .filter((f) => /\.(js|css)$/.test(f))
  .map((f) => {
    const buf = readFileSync(join(assets, f))
    return { f, raw: buf.length, gz: gzipSync(buf, { level: 9 }).length, entry: entryNames.has(f) }
  })
  .sort((a, b) => b.gz - a.gz)

const js = rows.filter((r) => r.f.endsWith('.js'))
const entry = js.filter((r) => r.entry)
const lazy = js.filter((r) => !r.entry)
const entryGz = kb(entry.reduce((s, r) => s + r.gz, 0))
const totalGz = kb(js.reduce((s, r) => s + r.gz, 0))
const maxLazy = lazy.reduce((m, r) => (r.gz > m.gz ? r : m), { f: '-', gz: 0 })

console.log('file'.padEnd(52), 'raw KB'.padStart(9), 'gz KB'.padStart(8), ' kind')
for (const r of rows) {
  const kind = r.f.endsWith('.css') ? 'css' : r.entry ? 'ENTRY' : 'lazy'
  console.log(basename(r.f).padEnd(52), kb(r.raw).toFixed(1).padStart(9), kb(r.gz).toFixed(1).padStart(8), ' ' + kind)
}
const checks = [
  ['entry JS gz', entryGz, budget.entryGzKB],
  [`largest lazy chunk gz (${maxLazy.f})`, kb(maxLazy.gz), budget.maxLazyChunkGzKB],
  ['total JS gz', totalGz, budget.totalJsGzKB],
]
let bad = 0
console.log('')
for (const [name, v, cap] of checks) {
  const ok = v <= cap
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'OVER'} ${name}: ${v.toFixed(1)} KB (budget ${cap} KB)`)
}
if (!entry.length) {
  console.error('check-bundle: no entry <script> found in index.html')
  process.exit(1)
}
process.exit(bad ? 1 : 0)
