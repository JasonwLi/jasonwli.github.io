/**
 * Hero monument models: detailed procedural models (400-3,000 model triangles each) of
 * the 18 most famous landmarks, so they read as THAT building rather than a low-poly
 * stand-in. Each is registered as an extra sub-mesh form in its landmark's archetype
 * (archetypes.ts appends HERO_FORMS), so the renderer draws it with no changes: a
 * landmark points at it through its `form` (src/data/landmarks.ts).
 *
 * Lives in the lazy monuments chunk (imported only by archetypes.ts <- Monuments.tsx).
 */
import type { Archetype } from '../../../data/landmarks'
import type { Build } from './parts.ts'
import { giza } from './giza.ts'
import { colosseum } from './colosseum.ts'
import { parthenon } from './parthenon.ts'
import { hagiaSophia } from './hagiaSophia.ts'
import { petra } from './petra.ts'
import { taj } from './taj.ts'
import { goldenGate } from './goldenGate.ts'
import { eiffel } from './eiffel.ts'
import { liberty } from './liberty.ts'
import { christ } from './christ.ts'
import { machuPicchu } from './machuPicchu.ts'
import { fuji } from './fuji.ts'
import { opera } from './opera.ts'
import { stPeters } from './stPeters.ts'
import { angkor } from './angkor.ts'
import { greatWall } from './greatWall.ts'
import { bigBen } from './bigBen.ts'
import { abuSimbel } from './abuSimbel.ts'

export interface HeroDef {
  /** landmark id (src/data/landmarks.ts) */
  id: string
  arch: Archetype
  /** the new form name registered in the archetype */
  form: string
  /** the low-poly form it replaces (kept registered) */
  replaces: string
  build: Build
}

export const HEROES: HeroDef[] = [
  { id: 'great-pyramid-of-giza', arch: 'pyramid', form: 'giza-hero', replaces: 'giza', build: giza },
  { id: 'colosseum', arch: 'arch', form: 'colosseum-hero', replaces: 'ring', build: colosseum },
  { id: 'parthenon', arch: 'temple-columns', form: 'parthenon-hero', replaces: 'peristyle', build: parthenon },
  { id: 'hagia-sophia', arch: 'dome', form: 'hagia-sophia-hero', replaces: 'byzantine', build: hagiaSophia },
  { id: 'petra-al-khazneh', arch: 'temple-columns', form: 'petra-hero', replaces: 'rockcut', build: petra },
  { id: 'taj-mahal', arch: 'dome', form: 'taj-hero', replaces: 'taj', build: taj },
  { id: 'golden-gate-bridge', arch: 'bridge', form: 'golden-gate-hero', replaces: 'suspension', build: goldenGate },
  { id: 'eiffel-tower', arch: 'tower', form: 'eiffel-hero', replaces: 'lattice', build: eiffel },
  { id: 'statue-of-liberty', arch: 'statue', form: 'liberty-hero', replaces: 'liberty', build: liberty },
  { id: 'christ-the-redeemer', arch: 'statue', form: 'christ-hero', replaces: 'christ', build: christ },
  { id: 'machu-picchu', arch: 'wall', form: 'machu-picchu-hero', replaces: 'terraces', build: machuPicchu },
  { id: 'mount-fuji', arch: 'mountain-peak', form: 'fuji-hero', replaces: 'snowcone', build: fuji },
  { id: 'sydney-opera-house', arch: 'dome', form: 'opera-hero', replaces: 'opera', build: opera },
  { id: 'st-peter-s-basilica', arch: 'dome', form: 'st-peters-hero', replaces: 'basilica', build: stPeters },
  { id: 'angkor-wat', arch: 'pagoda/torii', form: 'angkor-hero', replaces: 'angkor', build: angkor },
  { id: 'great-wall-of-china', arch: 'wall', form: 'great-wall-hero', replaces: 'greatwall', build: greatWall },
  { id: 'big-ben', arch: 'tower', form: 'big-ben-hero', replaces: 'clock', build: bigBen },
  { id: 'abu-simbel-temples', arch: 'temple-columns', form: 'abu-simbel-hero', replaces: 'colossi', build: abuSimbel },
]

/** Hero forms grouped by archetype, appended to ARCHETYPE_FORMS. */
export function heroForms(arch: Archetype): [string, Build][] {
  return HEROES.filter((h) => h.arch === arch).map((h) => [h.form, h.build])
}

export const HERO_FORM_NAMES = new Set(HEROES.map((h) => h.form))
