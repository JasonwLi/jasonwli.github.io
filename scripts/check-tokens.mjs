#!/usr/bin/env node
// CSS <-> TS token parity (T1a; critique "tokens.ts ... tokens.css ... within 1 LSB").
//
//   node scripts/check-tokens.mjs
//
// Reads every literal colour custom property in src/styles/tokens.css (oklch(),
// with optional / alpha, or #hex), converts it to 8-bit sRGB, and asserts the
// twin in src/theme/tokens.ts (kebab -> camel: --gilt-2 -> gilt2) agrees within
// 1 LSB per channel. Also: no colour is out of the sRGB gamut (so no browser
// gamut mapping can drift from three.js), the TS-only aliases equal their
// targets, labelClimateAlpha / landCapL / seaL match --label-climate's alpha,
// --land-cap-L and --sea-L, and every TS colour has a CSS twin. Exit 1 on any miss.
//
// The OKLCH maths is exported for scripts/check-contrast.mjs.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const TOKENS_CSS = resolve(ROOT, 'src/styles/tokens.css')
export const TOKENS_TS = resolve(ROOT, 'src/theme/tokens.ts')

/** OKLCH -> linear sRGB (Björn Ottosson's matrices, as CSS Color 4) */
export function oklchToLinear(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}
export const encode = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)
export const decode = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
export const to8 = (lin) => lin.map((x) => Math.round(Math.min(1, Math.max(0, encode(x))) * 255))
export const hex = (rgb8) => '#' + rgb8.map((v) => v.toString(16).padStart(2, '0')).join('')
export const hexTo8 = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))

/** parse one CSS colour literal -> { rgb8, linear, alpha, oog } or null */
export function parseColour(value) {
  const v = value.trim()
  let m = v.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/i)
  if (m) {
    const L = Number(m[1]) / (m[2] ? 100 : 1)
    const lin = oklchToLinear(L, Number(m[3]), Number(m[4]))
    const alpha = m[5] == null ? 1 : Number(m[5]) / (m[6] ? 100 : 1)
    const oog = lin.some((x) => x < -1e-3 || x > 1 + 1e-3)
    return { rgb8: to8(lin), linear: lin.map((x) => Math.min(1, Math.max(0, x))), alpha, oog }
  }
  m = v.match(/^#([0-9a-f]{6})$/i)
  if (m) {
    const rgb8 = hexTo8(v)
    return { rgb8, linear: rgb8.map((c) => decode(c / 255)), alpha: 1, oog: false }
  }
  return null
}

/** every custom property in the :root block(s) of tokens.css -> raw value */
export function readCssTokens(file = TOKENS_CSS) {
  const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const out = new Map()
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim())
  return out
}

/** resolve var() chains to a colour literal */
export function resolveColour(tokens, name, depth = 0) {
  const raw = tokens.get(name)
  if (raw == null || depth > 8) return null
  const vm = raw.match(/^var\(\s*(--[\w-]+)\s*\)$/)
  if (vm) return resolveColour(tokens, vm[1], depth + 1)
  return parseColour(raw)
}

export function readTsTokens(file = TOKENS_TS) {
  const ts = readFileSync(file, 'utf8')
  const colours = new Map()
  const block = ts.match(/export const tokens = \{([\s\S]*?)\}\s*as const/)
  if (!block) throw new Error('tokens.ts: `export const tokens = { ... } as const` not found')
  for (const m of block[1].matchAll(/^\s*(\w+)\s*:\s*'(#[0-9a-fA-F]{6})'/gm)) colours.set(m[1], m[2])
  const nums = new Map()
  for (const m of ts.matchAll(/export const (\w+)\s*=\s*([\d.]+)/g)) nums.set(m[1], Number(m[2]))
  return { colours, nums }
}

const camel = (cssName) => cssName.replace(/^--/, '').replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())

/** TS-only F0 contract aliases -> the CSS token they mirror */
const TS_ALIASES = { giltDim: '--gilt-2', silverDim: '--silver-3', inkOnLand: '--label-land', seaLabel: '--label-sea' }

function main() {
  const css = readCssTokens()
  const { colours: ts, nums } = readTsTokens()
  const fails = []
  const rows = []
  const seenTs = new Set()

  for (const [name, raw] of css) {
    if (/^var\(/.test(raw)) continue // aliases resolve to a checked literal
    const c = parseColour(raw)
    if (!c) continue // non-colour (lengths, fonts, easing)
    if (c.oog) fails.push(`${name}: ${raw} is outside sRGB (browser gamut-maps it, three.js clips it)`)
    const key = camel(name)
    const tsHex = ts.get(key)
    if (!tsHex) {
      fails.push(`${name}: no twin "${key}" in tokens.ts`)
      continue
    }
    seenTs.add(key)
    const t8 = hexTo8(tsHex)
    const d = Math.max(...c.rgb8.map((v, i) => Math.abs(v - t8[i])))
    rows.push([name, raw, hex(c.rgb8), tsHex, d])
    if (d > 1) fails.push(`${name}: css ${hex(c.rgb8)} vs ts ${key} ${tsHex} (Δ ${d} LSB)`)
    if (name === '--label-climate') {
      const a = nums.get('labelClimateAlpha')
      if (a == null || Math.abs(a - c.alpha) > 1 / 255) fails.push(`--label-climate alpha ${c.alpha} vs labelClimateAlpha ${a}`)
    }
  }

  for (const [alias, target] of Object.entries(TS_ALIASES)) {
    const tsHex = ts.get(alias)
    if (!tsHex) continue
    seenTs.add(alias)
    const c = resolveColour(css, target)
    const d = c ? Math.max(...c.rgb8.map((v, i) => Math.abs(v - hexTo8(tsHex)[i]))) : Infinity
    if (d > 1) fails.push(`tokens.ts alias ${alias} ${tsHex} != ${target}`)
  }
  for (const key of ts.keys()) if (!seenTs.has(key)) fails.push(`tokens.ts ${key}: no twin in tokens.css`)

  for (const [cssName, tsName] of [
    ['--land-cap-L', 'landCapL'],
    ['--sea-L', 'seaL'],
  ]) {
    const v = Number(css.get(cssName))
    if (!(Math.abs(v - nums.get(tsName)) < 1e-9)) fails.push(`${cssName} ${css.get(cssName)} vs ${tsName} ${nums.get(tsName)}`)
  }

  for (const r of rows) console.log(`${r[0].padEnd(16)} ${r[2]}  ts ${r[3]}  Δ${r[4]}`)
  if (fails.length) {
    console.error(`\ncheck-tokens: ${fails.length} problem(s)\n  ` + fails.join('\n  '))
    process.exit(1)
  }
  console.log(`\ncheck-tokens: OK (${rows.length} colours + ${Object.keys(TS_ALIASES).length} aliases + 3 numbers, all within 1 LSB, all in sRGB)`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
