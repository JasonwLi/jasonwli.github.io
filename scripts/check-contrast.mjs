#!/usr/bin/env node
// WCAG 2.x contrast of THE ASTROLABE palette, read from src/styles/tokens.css
// (replaces scratchpad/plan/front_contrast.py; critique "Verify commands").
//
//   node scripts/check-contrast.mjs
//
// Each pair is [foreground, background, minimum, why]. Exit 1 if any pair is
// under its minimum. Minimums: running text 7 (AAA, T1 acceptance), data and
// meta 4.5 (AA), the smallest text tone 4.5, non-text marks 3 (1.4.11).
import { readCssTokens, resolveColour } from './check-tokens.mjs'

const css = readCssTokens()
const lum = (lin) => 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
function colour(name) {
  const c = resolveColour(css, name)
  if (!c) throw new Error(`check-contrast: ${name} is not a colour in tokens.css`)
  return c
}
function ratio(fg, bg) {
  const a = lum(colour(fg).linear)
  const b = lum(colour(bg).linear)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const TEXT_BODY = 7
const TEXT = 4.5
const NON_TEXT = 3

/** [fg, bg, min, role] */
const PAIRS = [
  // every word a person reads
  ['--silver', '--steel', TEXT_BODY, 'body text on the steel field'],
  ['--silver', '--steel-field', TEXT_BODY, 'body text on the travel column plate'],
  ['--silver', '--steel-deep', TEXT_BODY, 'body text on the lightbox / footer plate'],
  ['--silver', '--steel-raised', TEXT_BODY, 'index row name on hover'],
  ['--silver-2', '--steel', TEXT, 'data lines, roles, nav at rest'],
  ['--silver-2', '--steel-field', TEXT, 'data lines in the column'],
  ['--silver-2', '--steel-raised', TEXT, 'data on a hovered row'],
  ['--silver-3', '--steel', TEXT, 'counts, hints, credits'],
  ['--silver-3', '--steel-field', TEXT, 'counts in the index'],
  ['--silver-3', '--steel-raised', TEXT, 'count on a hovered row'],
  ['--silver-3', '--steel-deep', TEXT, 'lightbox counter'],
  // gilt text: the name crest and the scale numerals (Titling 10-11 px and up)
  ['--gilt', '--steel', TEXT, 'name crest, limb numerals'],
  ['--gilt', '--steel-field', TEXT, 'numerals over the column plate'],
  ['--gilt-2', '--steel', TEXT, 'numerals 11 px and up in gilt-2'],
  // browser surfaces
  ['--selection-fg', '--selection-bg', TEXT_BODY, 'selected text'],
  ['--focus', '--steel', NON_TEXT, 'focus ring on steel'],
  ['--focus', '--steel-field', NON_TEXT, 'focus ring on the column plate'],
  ['--focus', '--steel-raised', NON_TEXT, 'focus ring on a hovered row'],
  ['--scroll-thumb-hover', '--scroll-track', NON_TEXT, 'scrollbar thumb on hover'],
  // non-text marks
  ['--gilt-2', '--steel-field', NON_TEXT, 'control boundaries (map-mode ticks, pin rings)'],
  ['--vermilion', '--steel', NON_TEXT, 'the active place mark on steel'],
  ['--vermilion', '--steel-field', NON_TEXT, 'the star-pointer on the column plate'],
]

let fails = 0
console.log('fg               bg               ratio   min   role')
for (const [fg, bg, min, why] of PAIRS) {
  const r = ratio(fg, bg)
  const ok = r >= min
  if (!ok) fails++
  console.log(`${fg.padEnd(16)} ${bg.padEnd(16)} ${r.toFixed(2).padStart(6)}  ${String(min).padStart(4)}  ${ok ? 'ok  ' : 'FAIL'} ${why}`)
}
// informational: decorative tones that must never carry text
for (const [fg, bg] of [
  ['--gilt-worn', '--steel'],
  ['--rule', '--steel-field'],
  ['--line', '--steel'],
]) {
  console.log(`${fg.padEnd(16)} ${bg.padEnd(16)} ${ratio(fg, bg).toFixed(2).padStart(6)}     -  info (decorative only, never text)`)
}
if (fails) {
  console.error(`\ncheck-contrast: ${fails} pair(s) under minimum`)
  process.exit(1)
}
console.log(`\ncheck-contrast: OK (${PAIRS.length} pairs)`)
