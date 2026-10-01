/// <reference types="node" />
/**
 * C5 dataset + archetype check (node, no browser):
 *   node --experimental-strip-types src/three/monuments/dev/check-landmarks.ts
 * - LANDMARKS has exactly 72 entries and (when .plan/landmarks_72.json is present)
 *   matches the verified list field by field;
 * - ids unique, archetypes valid, every form/part form exists, all 15 archetypes used;
 * - every landmark within 60 km of a travel location carries a near_place, and every
 *   near_place is a travel slug; prints the visited count;
 * - every low-poly form is 30-300 model triangles, every hero model (monuments/hero/) 400-3,000
 *   (the hull outline roughly doubles it), and every hero is registered and used by its landmark.
 * Exit 1 on any failure.
 */
import { existsSync, readFileSync } from 'node:fs'
import { ARCHETYPES, LANDMARKS, VISITED_KM, landmarkVisited, nearestPlace } from '../../../data/landmarks.ts'
import { ARCHETYPE_FORMS, buildArchetype } from '../archetypes.ts'
import { HEROES, HERO_FORM_NAMES } from '../hero/index.ts'

const errs: string[] = []
const fail = (m: string) => errs.push(m)

if (LANDMARKS.length !== 72) fail(`LANDMARKS has ${LANDMARKS.length} entries, expected 72`)
const ids = new Set<string>()
for (const l of LANDMARKS) {
  if (ids.has(l.id)) fail(`duplicate id ${l.id}`)
  ids.add(l.id)
  if (!ARCHETYPES.includes(l.arch)) fail(`${l.id}: unknown archetype ${l.arch}`)
  const forms = ARCHETYPE_FORMS[l.arch]?.map((f) => f[0]) ?? []
  if (!forms.includes(l.form)) fail(`${l.id}: form ${l.form} not in ${l.arch}`)
  for (const p of l.parts ?? []) if (!ARCHETYPE_FORMS[p.arch]?.some((f) => f[0] === p.form)) fail(`${l.id}: part ${p.arch}/${p.form} missing`)
  if (Math.abs(l.lat) > 90 || Math.abs(l.lon) > 180) fail(`${l.id}: bad lat/lon`)
}

// verified source
const src = '.plan/landmarks_72.json'
if (existsSync(src)) {
  const ref = JSON.parse(readFileSync(src, 'utf8')) as Record<string, unknown>[]
  if (ref.length !== LANDMARKS.length) fail(`verified list has ${ref.length}, LANDMARKS ${LANDMARKS.length}`)
  ref.forEach((r, i) => {
    const l = LANDMARKS[i]
    if (!l) return
    const same =
      r.qid === l.qid && r.name === l.name && r.lat === l.lat && r.lon === l.lon && r.archetype === l.arch &&
      r.tier === l.tier && (r.near_place ?? null) === l.nearPlace && (r.variant ?? undefined) === l.variant
    if (!same) fail(`entry ${i} (${String(r.name)}) differs from ${src}`)
  })
  console.log(`verified list: ${src} matched field by field`)
} else console.log(`(${src} not present; skipped the verbatim comparison)`)

// visited
const travel = JSON.parse(readFileSync('public/travel-data.json', 'utf8')).locations as { slug: string; lat: number; lon: number }[]
const slugs = new Set(travel.map((t) => t.slug))
let visited = 0
let within = 0
for (const l of LANDMARKS) {
  if (l.nearPlace && !slugs.has(l.nearPlace)) fail(`${l.id}: near_place ${l.nearPlace} is not a travel slug`)
  const { km } = nearestPlace(l, travel)
  if (km <= VISITED_KM) {
    within++
    if (!l.nearPlace) fail(`${l.id}: within ${km.toFixed(1)} km of a travel location but no near_place`)
  }
  if (landmarkVisited(l, travel)) visited++
}
console.log(`landmarks: ${LANDMARKS.length}; visited: ${visited} (near_place set and a travel slug); within ${VISITED_KM} km of a travel location: ${within}`)

// archetype usage + triangle budget
const used = new Map<string, number>()
for (const l of LANDMARKS) {
  used.set(l.arch, (used.get(l.arch) ?? 0) + 1)
  for (const p of l.parts ?? []) used.set(p.arch, (used.get(p.arch) ?? 0) + 1)
}
let total = 0
for (const a of ARCHETYPES) {
  if (!used.get(a)) fail(`archetype ${a} has no instance`)
  const kit = buildArchetype(a)
  const rows = kit.forms.map((f) => `${f.name} ${f.tris}`)
  console.log(`  ${a.padEnd(16)} ${String(used.get(a) ?? 0).padStart(2)} inst | ${rows.join(', ')}`)
  for (const f of kit.forms) {
    const [lo, hi] = HERO_FORM_NAMES.has(f.name) ? [400, 3000] : [30, 300]
    if (f.tris < lo || f.tris > hi) fail(`${a}/${f.name}: ${f.tris} triangles (want ${lo}-${hi})`)
  }
  total += kit.forms.reduce((s, f) => s + f.tris, 0)
}
// worst-case drawn triangles: every landmark visible at once, model + hull (hairlines
// drawn without an outline are counted once)
let drawn = 0
for (const l of LANDMARKS) {
  const tri = (a: typeof l.arch, form: string) => {
    const f = buildArchetype(a).forms.find((q) => q.name === form)
    return f ? f.tris + f.hullTris : 0
  }
  drawn += tri(l.arch, l.form)
  for (const p of l.parts ?? []) drawn += tri(p.arch, p.form)
}
console.log(`forms: ${ARCHETYPES.reduce((s, a) => s + ARCHETYPE_FORMS[a].length, 0)}; model triangles over all forms: ${total}; worst case drawn (all 72 + hulls): ${drawn}`)
// hero models raise the all-at-once worst case; in practice only the few landmarks inside a
// <1600 km view are drawn at a time (MAX_PX 40 each)
if (drawn > 120000) fail(`drawn triangles ${drawn} > 120k`)
for (const h of HEROES) {
  const l = LANDMARKS.find((x) => x.id === h.id)
  if (!l) fail(`hero ${h.form}: no landmark ${h.id}`)
  else if (l.arch !== h.arch || l.form !== h.form) fail(`hero ${h.form}: landmark ${h.id} draws ${l.arch}/${l.form}`)
}
console.log(`hero models: ${HEROES.length} (${HEROES.map((h) => h.form).join(', ')})`)

if (errs.length) {
  console.error(`FAIL (${errs.length})`)
  for (const e of errs) console.error('  ' + e)
  process.exit(1)
}
console.log('PASS')
