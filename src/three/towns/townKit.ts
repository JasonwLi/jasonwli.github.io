/**
 * Town miniatures (EU4 province-city style) at the visited places: procedural low-poly
 * models built with the monument kit (flat linear vertex colours, duplicated hull
 * triangles for the ink outline), painted by the monument material.
 *
 * Model space: x right, y up, z toward the viewer (+z = the front, the side the camera
 * looks from), ground y = 0. ONE unit = a walled city's full width, shared by every class
 * so a hamlet is smaller than a city at the same zoom. The origin is the town's SQUARE:
 * the place's pin is drawn on it, so the buildings ring it and the tall signature buildings
 * (tower, keep, cathedral, minaret, pagoda) stand behind it (-z, up the screen), where the
 * pin never covers them.
 *
 * SIZE CLASSES (by photo count): 0 hamlet (1 photo: 3-4 houses and a chapel), 1 village
 * (2-3: houses and a church with a tower), 2 walled town (4: wall ring, gate, keep, a church),
 * 3 walled city (5: taller wall with round towers, gate, cathedral, a paved market square).
 * REGIONAL VARIANTS: euro (stone / whitewash walls, terracotta and slate roofs), timber
 * (Scandinavia, Canada, the US north, Australia: falu-red and clapboard houses, steep dark
 * roofs, a white wooden church with a needle spire, a palisade), medina (Middle East / North
 * Africa / India: flat-roofed mud-brick cubes, a domed mosque and minarets, a kasbah),
 * pagoda (East Asia: hipped eave roofs, a tiered pagoda, a castle keep), stilt (Southeast
 * Asia: houses raised on posts under steep thatch, a wat hall and a bell chedi), adobe (the
 * Andes and Latin America, the US southwest: adobe walls under terracotta, a twin-towered
 * colonial church on a plaza).
 *
 * Each variant is ONE geometry with its four classes as forms (aVar = class), drawn by one
 * InstancedMesh (Towns.tsx: iVar selects the class), so draw calls = variants on screen.
 * Small houses carry no outline (at 20-36 px an ink rim on every cottage read as noise);
 * walls, towers, the signature buildings and the ground pad do.
 * Colours: OKLab L <= 0.70, no gilt (brass hue at chroma >= 0.075), no vermilion; the
 * theme guard (material.guardThemeColours) is applied again at mount.
 */
import type * as THREE from 'three'
import { Kit, type FormStats } from '../monuments/kit'

export const TOWN_VARIANTS = ['euro', 'timber', 'medina', 'pagoda', 'stilt', 'adobe'] as const
export type TownVariant = (typeof TOWN_VARIANTS)[number]
export const TOWN_CLASSES = ['hamlet', 'village', 'town', 'city'] as const
export type TownClass = 0 | 1 | 2 | 3

/** sRGB hex from OKLCH (L <= 0.70; no brass-hue chroma >= 0.075; no vermilion) */
export const T = {
  terracotta: '#9d5b41', //  oklch(0.54 0.095 42)
  terracottaLt: '#a77253', // oklch(0.60 0.080 52)
  slate: '#434e5b', //       oklch(0.42 0.025 250)
  slateLt: '#59656f', //     oklch(0.50 0.022 245)
  ochreRoof: '#a17745', //   oklch(0.60 0.085 70)
  stone: '#9a9181', //       oklch(0.66 0.025 80)
  whitewash: '#a09e98', //   oklch(0.70 0.010 95)
  plaster: '#a3937a', //     oklch(0.67 0.040 78)
  mud: '#9f805f', //         oklch(0.62 0.060 68)
  mudDark: '#83654b', //     oklch(0.53 0.055 62)
  adobe: '#a0755c', //       oklch(0.60 0.065 52)
  timber: '#5c4132', //      oklch(0.40 0.045 50)
  falu: '#843d33', //        oklch(0.45 0.100 30)  falu red, brick-dull (not vermilion)
  clap: '#8a949b', //        oklch(0.66 0.015 240) painted clapboard
  thatch: '#83724f', //      oklch(0.56 0.055 85)
  thatchDk: '#6b5b40', //    oklch(0.48 0.045 80)
  tile: '#39444c', //        oklch(0.38 0.020 240) East Asian roof tile
  lacquer: '#874033', //     oklch(0.46 0.100 32)
  earth: '#a69987', //       oklch(0.69 0.030 78)  the town's beaten-earth pad (an up-facing facet: drawn in the half tone, ~L 0.52)
  plaza: '#8d8579', //       oklch(0.62 0.020 80)  paved square
  wall: '#887f72', //        oklch(0.60 0.022 75)
  wallDk: '#6b6257', //      oklch(0.50 0.020 72)
  lead: '#6c7378', //        oklch(0.55 0.012 240)
  domeGreen: '#527b70', //   oklch(0.55 0.050 175)
  brick: '#805846', //       oklch(0.50 0.060 45)
  stupa: '#a19e96', //       oklch(0.70 0.012 90)
  bark: '#443429', //        oklch(0.34 0.030 55)
  tin: '#6d7277', //         oklch(0.55 0.010 240)
} as const

type P = [number, number] // polar placement: [r, angle deg] (0 = front +z, +90 = right +x)

/** house placements per class (polar about the square), rotations derived from the angle */
const HOUSES: P[][] = [
  [[0.17, -100], [0.165, 95], [0.2, 160], [0.19, 40]],
  [[0.22, -95], [0.215, 92], [0.23, 140], [0.23, -140], [0.25, 40], [0.25, -42], [0.27, 0]],
  [[0.22, -100], [0.22, 96], [0.24, 140], [0.27, 40], [0.27, -40], [0.3, 70], [0.3, -72], [0.24, -150]],
  [[0.25, -98], [0.25, 98], [0.27, 136], [0.27, -136], [0.31, 40], [0.31, -40], [0.36, 70], [0.36, -70], [0.36, 112]],
]

const POS = (p: P, cz = 0): [number, number, number] => {
  const a = (p[1] * Math.PI) / 180
  // houses turn their long side toward the square
  return [p[0] * Math.sin(a), cz + p[0] * Math.cos(a), -a + (p[1] % 2 ? 0.14 : -0.1)]
}

interface Style {
  /** one house at its place (k already pushed to it), index for variety */
  house(k: Kit, i: number): void
  /** the hamlet's chapel / the village church / the town's church (scale s) */
  church(k: Kit, s: number): void
  /** the walled town's keep */
  keep(k: Kit): void
  /** the city's great building (cathedral / great mosque / pagoda + castle / wat / colonial church) */
  great(k: Kit): void
  /** wall ring (centre cz, radius r, height h, sides n) */
  wall(k: Kit, cz: number, r: number, h: number, n: number): void
  /** one wall tower at (x, z), height h */
  tower(k: Kit, x: number, z: number, h: number): void
  /** gatehouse across the wall at (x, z) */
  gate(k: Kit, x: number, z: number): void
  pad: string
  square: string
}

// ——— shared pieces ———

const H = { w: 0.12, d: 0.09, h: 0.06, rh: 0.05 }

function gabled(k: Kit, w: number, d: number, h: number, rh: number, wall: string, roof: string) {
  k.box(0, 0, 0, w, h, d, wall)
  k.gable(0, h, 0, w * 1.1, rh, d * 1.18, roof)
}

function stoneWall(k: Kit, cz: number, r: number, h: number, n: number, hex: string, t = 0.035) {
  k.lathe(0, 0, cz, [[r, 0], [r, h], [r - t, h], [r - t, 0]], n, hex, Math.PI / n, false)
}

function pad(k: Kit, cz: number, r: number, hex: string, n = 10, sz = 0.86) {
  k.lathe(0, 0, cz, [[r, 0], [r * 0.94, 0.008]], n, hex, 0, true, 1, sz)
}

function roundTower(k: Kit, x: number, z: number, h: number, wall: string, roof: string) {
  k.prism(x, 0, z, 0.038, 0.036, h, 6, wall, 0, false)
  k.prism(x, h, z, 0.05, 0, 0.065, 6, roof)
}

function dome(k: Kit, x: number, y: number, z: number, r: number, hex: string, n = 8) {
  k.lathe(x, y, z, [[r, 0], [r * 0.86, r * 0.5], [r * 0.5, r * 0.87], [0, r * 1.08]], n, hex)
}

function pyramid(k: Kit, x: number, y: number, z: number, w: number, d: number, h: number, hex: string) {
  k.frustum4(x, y, z, w, d, 0, 0, h, hex)
}

// ——— the six styles ———

const EURO: Style = {
  house(k, i) {
    const roof = i % 3 === 2 ? T.slate : i % 3 === 1 ? T.terracottaLt : T.terracotta
    const wall = i % 2 ? T.whitewash : T.plaster
    gabled(k, H.w * (i % 4 === 3 ? 1.15 : 1), H.d, H.h * (i % 5 === 1 ? 1.25 : 1), H.rh, wall, roof)
  },
  church(k, s) {
    k.push(0, 0, 0, 0, s)
    gabled(k, 0.17, 0.085, 0.075, 0.055, T.stone, T.terracotta)
    k.box(-0.1, 0, 0, 0.06, 0.2, 0.06, T.stone)
    pyramid(k, -0.1, 0.2, 0, 0.068, 0.068, 0.12, T.slate)
    k.pop()
  },
  keep(k) {
    k.box(0, 0, 0, 0.12, 0.2, 0.11, T.stone)
    k.box(0, 0.2, 0, 0.135, 0.03, 0.125, T.wall)
    pyramid(k, 0, 0.23, 0, 0.1, 0.09, 0.07, T.slate)
  },
  great(k) {
    // cathedral: a nave along x, a transept, a crossing tower and twin west towers with spires
    k.box(0.03, 0, 0, 0.26, 0.11, 0.1, T.stone)
    k.gable(0.03, 0.11, 0, 0.27, 0.07, 0.115, T.slate)
    k.push(0.07, 0, 0, Math.PI / 2)
    k.box(0, 0, 0, 0.2, 0.1, 0.08, T.stone)
    k.gable(0, 0.1, 0, 0.21, 0.065, 0.095, T.slate)
    k.pop()
    for (const z of [-0.035, 0.035]) {
      k.box(-0.13, 0, z, 0.055, 0.25, 0.055, T.stone)
      pyramid(k, -0.13, 0.25, z, 0.06, 0.06, 0.12, T.slate)
    }
  },
  wall: (k, cz, r, h, n) => stoneWall(k, cz, r, h, n, T.wall),
  tower: (k, x, z, h) => roundTower(k, x, z, h, T.wall, T.slate),
  gate(k, x, z) {
    k.box(x, 0, z, 0.11, 0.13, 0.07, T.stone)
    pyramid(k, x, 0.13, z, 0.115, 0.075, 0.05, T.terracotta)
  },
  pad: T.earth,
  square: T.plaza,
}

const TIMBER: Style = {
  house(k, i) {
    const wall = i % 3 === 0 ? T.falu : i % 3 === 1 ? T.clap : T.timber
    const roof = i % 2 ? T.slate : T.tin
    k.box(0, 0, 0, H.w, H.h, H.d, wall)
    k.gable(0, H.h, 0, H.w * 1.1, H.rh * 1.4, H.d * 1.18, roof)
  },
  church(k, s) {
    // white wooden church, steep roof, a needle spire on a square tower
    k.push(0, 0, 0, 0, s)
    k.box(0.02, 0, 0, 0.15, 0.08, 0.085, T.whitewash)
    k.gable(0.02, 0.08, 0, 0.16, 0.08, 0.1, T.slate)
    k.box(-0.08, 0, 0, 0.055, 0.2, 0.055, T.whitewash)
    pyramid(k, -0.08, 0.2, 0, 0.06, 0.06, 0.17, T.slate)
    k.pop()
  },
  keep(k) {
    // a timber blockhouse with an overhanging upper storey
    k.box(0, 0, 0, 0.11, 0.14, 0.1, T.timber)
    k.box(0, 0.14, 0, 0.135, 0.06, 0.125, T.falu)
    pyramid(k, 0, 0.2, 0, 0.15, 0.14, 0.08, T.slate)
  },
  great(k) {
    // the town church grown large, a town hall with a clock tower beside it
    k.box(0.05, 0, 0, 0.22, 0.11, 0.11, T.whitewash)
    k.gable(0.05, 0.11, 0, 0.23, 0.1, 0.125, T.slate)
    k.box(-0.1, 0, 0, 0.07, 0.25, 0.07, T.whitewash)
    pyramid(k, -0.1, 0.25, 0, 0.075, 0.075, 0.22, T.slate)
    k.box(0.15, 0, 0.1, 0.1, 0.09, 0.08, T.falu)
    k.gable(0.15, 0.09, 0.1, 0.11, 0.06, 0.095, T.tin)
  },
  wall: (k, cz, r, h, n) => stoneWall(k, cz, r, h * 0.85, n, T.timber, 0.025),
  tower(k, x, z, h) {
    k.box(x, 0, z, 0.06, h * 0.95, 0.06, T.timber)
    pyramid(k, x, h * 0.95, z, 0.075, 0.075, 0.05, T.slate)
  },
  gate(k, x, z) {
    k.box(x - 0.045, 0, z, 0.04, 0.13, 0.05, T.timber)
    k.box(x + 0.045, 0, z, 0.04, 0.13, 0.05, T.timber)
    k.box(x, 0.13, z, 0.13, 0.035, 0.055, T.falu)
  },
  pad: T.earth,
  square: T.plaza,
}

const MEDINA: Style = {
  house(k, i) {
    const wall = i % 3 === 1 ? T.mudDark : i % 3 === 2 ? T.whitewash : T.mud
    const h = H.h * (i % 4 === 0 ? 1.35 : 1.05)
    k.box(0, 0, 0, H.w * 0.95, h, H.d * 1.05, wall)
    if (i % 2 === 0) k.box(H.w * 0.18, h, -H.d * 0.15, H.w * 0.45, H.h * 0.5, H.d * 0.5, wall)
  },
  church(k, s) {
    // a small domed mosque with a slender minaret
    k.push(0, 0, 0, 0, s)
    k.box(0.02, 0, 0, 0.13, 0.08, 0.11, T.whitewash)
    dome(k, 0.02, 0.08, 0, 0.05, T.lead)
    k.prism(-0.08, 0, 0, 0.022, 0.018, 0.26, 6, T.mud, 0, false)
    k.prism(-0.08, 0.26, 0, 0.026, 0, 0.05, 6, T.lead)
    k.pop()
  },
  keep(k) {
    // a kasbah: a tall tapering mud tower with a crenellated crown
    k.frustum4(0, 0, 0, 0.13, 0.12, 0.105, 0.095, 0.22, T.mudDark)
    k.box(0, 0.22, 0, 0.115, 0.025, 0.105, T.mud)
  },
  great(k) {
    // the great mosque: prayer hall, a big dome on a drum, two minarets
    k.box(0.02, 0, 0, 0.28, 0.09, 0.15, T.whitewash)
    k.prism(0.02, 0.09, 0, 0.07, 0.07, 0.03, 8, T.whitewash, Math.PI / 8, false)
    dome(k, 0.02, 0.12, 0, 0.075, T.domeGreen)
    for (const x of [-0.15, 0.19]) {
      k.prism(x, 0, -0.04, 0.025, 0.02, 0.32, 6, T.mud, 0, false)
      k.prism(x, 0.32, -0.04, 0.03, 0, 0.06, 6, T.lead)
    }
  },
  wall: (k, cz, r, h, n) => stoneWall(k, cz, r, h, n, T.mudDark),
  tower(k, x, z, h) {
    k.frustum4(x, 0, z, 0.065, 0.065, 0.055, 0.055, h, T.mudDark)
  },
  gate(k, x, z) {
    k.box(x, 0, z, 0.12, 0.14, 0.07, T.mud)
    k.box(x, 0.14, z, 0.13, 0.02, 0.08, T.mudDark)
  },
  pad: T.earth,
  square: T.plaza,
}

function eaveHouse(k: Kit, w: number, d: number, h: number, wall: string, roof: string) {
  k.box(0, 0, 0, w, h, d, wall)
  k.eave(0, h, 0, w, d, h * 0.75, w * 0.18, w * 0.08, roof)
}

function pagoda(k: Kit, x: number, z: number, tiers: number, w0: number, wall: string, roof: string) {
  let y = 0
  for (let t = 0; t < tiers; t++) {
    const w = w0 * (1 - t * 0.16)
    const h = t === 0 ? 0.07 : 0.05
    k.box(x, y, z, w * 0.7, h, w * 0.7, wall)
    k.eave(x, y + h, z, w * 0.7, w * 0.7, 0.03, w * 0.22, w * 0.1, roof, 0.1)
    y += h + 0.03
  }
  k.prism(x, y, z, 0.008, 0.004, 0.07, 4, T.tin, 0, false)
}

const PAGODA: Style = {
  house(k, i) {
    k.box(0, 0, 0, H.w, H.h * 0.95, H.d, i % 2 ? T.whitewash : T.timber)
    k.frustum4(0, H.h * 0.95, 0, H.w * 1.25, H.d * 1.3, H.w * 0.5, 0.012, H.rh, T.tile)
  },
  church(k, s) {
    k.push(0, 0, 0, 0, s)
    pagoda(k, -0.06, 0, 3, 0.1, T.lacquer, T.tile)
    k.push(0.06, 0, 0.01)
    eaveHouse(k, 0.13, 0.09, 0.07, T.lacquer, T.tile)
    k.pop()
    k.pop()
  },
  keep(k) {
    // a castle keep (tenshu): stone base, white storeys under dark eaves
    k.frustum4(0, 0, 0, 0.15, 0.14, 0.12, 0.11, 0.06, T.wallDk)
    k.box(0, 0.06, 0, 0.11, 0.06, 0.1, T.whitewash)
    k.eave(0, 0.12, 0, 0.11, 0.1, 0.03, 0.025, 0.012, T.tile, 0.2)
    k.box(0, 0.15, 0, 0.075, 0.05, 0.065, T.whitewash)
    k.eave(0, 0.2, 0, 0.075, 0.065, 0.045, 0.02, 0.01, T.tile, 0.25)
  },
  great(k) {
    pagoda(k, -0.12, -0.02, 4, 0.12, T.lacquer, T.tile)
    k.push(0.06, 0, 0)
    // great hall on a stone platform, double roof
    k.box(0, 0, 0, 0.22, 0.03, 0.15, T.wallDk)
    k.box(0, 0.03, 0, 0.18, 0.07, 0.11, T.lacquer)
    k.eave(0, 0.1, 0, 0.18, 0.11, 0.04, 0.03, 0.015, T.tile, 0.6)
    k.box(0, 0.14, 0, 0.12, 0.035, 0.07, T.lacquer)
    k.eave(0, 0.175, 0, 0.12, 0.07, 0.05, 0.025, 0.012, T.tile, 0.5)
    k.pop()
  },
  wall: (k, cz, r, h, n) => stoneWall(k, cz, r, h, n, T.wallDk),
  tower(k, x, z, h) {
    k.box(x, 0, z, 0.06, h * 0.85, 0.06, T.whitewash)
    pyramid(k, x, h * 0.85, z, 0.085, 0.085, 0.04, T.tile)
  },
  gate(k, x, z) {
    k.box(x, 0, z, 0.12, 0.1, 0.06, T.lacquer)
    k.eave(x, 0.1, z, 0.12, 0.06, 0.04, 0.025, 0.012, T.tile, 0.5)
  },
  pad: T.earth,
  square: T.plaza,
}

function stiltHouse(k: Kit, w: number, d: number, h: number, wall: string, roof: string) {
  // raised on posts: a dark under-floor mass, the room, a steep overhanging thatch
  k.box(0, 0, 0, w * 0.78, h * 0.45, d * 0.7, T.bark)
  k.box(0, h * 0.45, 0, w, h * 0.6, d, wall)
  k.gable(0, h * 1.05, 0, w * 1.2, h * 1.05, d * 1.35, roof)
}

function chedi(k: Kit, x: number, z: number, r: number, hex: string) {
  k.lathe(x, 0, z, [[r, 0], [r * 0.85, r * 0.75], [r * 0.32, r * 1.55], [0, r * 3.1]], 8, hex)
}

function wat(k: Kit, w: number, d: number, h: number) {
  // a temple hall with two stepped steep roofs
  k.box(0, 0, 0, w, h, d, T.whitewash)
  k.gable(0, h, 0, w * 1.08, h * 0.9, d * 1.3, T.lacquer)
  k.gable(w * 0.12, h * 1.35, 0, w * 0.7, h * 0.85, d * 0.8, T.tile)
}

const STILT: Style = {
  house(k, i) {
    stiltHouse(k, H.w * 0.95, H.d, H.h * 1.15, i % 2 ? T.timber : T.thatchDk, i % 3 === 2 ? T.tin : T.thatch)
  },
  church(k, s) {
    k.push(0, 0, 0, 0, s)
    k.push(0.04, 0, 0.01)
    wat(k, 0.15, 0.09, 0.065)
    k.pop()
    chedi(k, -0.1, -0.02, 0.045, T.stupa)
    k.pop()
  },
  keep(k) {
    chedi(k, 0, 0, 0.065, T.stupa)
  },
  great(k) {
    chedi(k, -0.15, -0.04, 0.075, T.stupa)
    k.push(0.06, 0, 0)
    wat(k, 0.24, 0.12, 0.09)
    k.pop()
  },
  wall: (k, cz, r, h, n) => stoneWall(k, cz, r, h * 0.8, n, T.brick),
  tower(k, x, z, h) {
    k.box(x, 0, z, 0.065, h * 0.75, 0.065, T.brick)
  },
  gate(k, x, z) {
    k.box(x, 0, z, 0.11, 0.1, 0.06, T.brick)
    k.gable(x, 0.1, z, 0.12, 0.06, 0.07, T.tile)
  },
  pad: T.earth,
  square: T.plaza,
}

function colonialChurch(k: Kit, s: number) {
  k.push(0, 0, 0, 0, s)
  k.box(0.04, 0, 0, 0.17, 0.09, 0.09, T.whitewash)
  k.gable(0.04, 0.09, 0, 0.18, 0.05, 0.1, T.terracotta)
  for (const z of [-0.035, 0.035]) {
    k.box(-0.07, 0, z, 0.05, 0.17, 0.05, T.whitewash)
    dome(k, -0.07, 0.17, z, 0.027, T.terracottaLt, 6)
  }
  k.pop()
}

const ADOBE: Style = {
  house(k, i) {
    const wall = i % 3 === 0 ? T.adobe : i % 3 === 1 ? T.whitewash : T.mud
    if (i % 4 === 3) {
      k.box(0, 0, 0, H.w, H.h, H.d, wall)
    } else {
      k.box(0, 0, 0, H.w, H.h, H.d, wall)
      k.gable(0, H.h, 0, H.w * 1.1, H.rh * 0.8, H.d * 1.18, i % 2 ? T.terracottaLt : T.terracotta)
    }
  },
  church: (k, s) => colonialChurch(k, s),
  keep(k) {
    // a cabildo: a long arcaded town hall
    k.box(0, 0, 0, 0.17, 0.1, 0.08, T.whitewash)
    k.gable(0, 0.1, 0, 0.18, 0.045, 0.09, T.terracotta)
    k.box(0.06, 0.1, 0, 0.045, 0.08, 0.045, T.whitewash)
    pyramid(k, 0.06, 0.18, 0, 0.05, 0.05, 0.05, T.terracottaLt)
  },
  great(k) {
    colonialChurch(k, 1.45)
  },
  wall: (k, cz, r, h, n) => stoneWall(k, cz, r, h * 0.85, n, T.adobe),
  tower(k, x, z, h) {
    k.box(x, 0, z, 0.06, h * 0.8, 0.06, T.adobe)
  },
  gate(k, x, z) {
    k.box(x, 0, z, 0.12, 0.12, 0.06, T.whitewash)
    k.gable(x, 0.12, z, 0.13, 0.04, 0.07, T.terracotta)
  },
  pad: T.earth,
  square: T.plaza,
}

const STYLES: Record<TownVariant, Style> = { euro: EURO, timber: TIMBER, medina: MEDINA, pagoda: PAGODA, stilt: STILT, adobe: ADOBE }

function houses(k: Kit, st: Style, cls: number, cz: number) {
  k.hull = false
  HOUSES[cls].forEach((p, i) => {
    const [x, z, rot] = POS(p, cz)
    k.push(x, 0, z, rot)
    st.house(k, i + cls * 3)
    k.pop()
  })
  k.hull = true
}

function buildClass(k: Kit, st: Style, cls: TownClass) {
  if (cls === 0) {
    pad(k, -0.02, 0.29, st.pad, 9)
    houses(k, st, 0, -0.02)
    k.push(0.03, 0, -0.2, -0.15)
    st.church(k, 0.8)
    k.pop()
  } else if (cls === 1) {
    pad(k, -0.02, 0.36, st.pad, 10)
    houses(k, st, 1, -0.02)
    k.push(0.01, 0, -0.25, -0.12)
    st.church(k, 1)
    k.pop()
  } else if (cls === 2) {
    const cz = -0.04
    const r = 0.4
    pad(k, cz, r - 0.01, st.pad, 10, 1)
    st.wall(k, cz, r, 0.075, 10)
    st.gate(k, 0, cz + r - 0.01)
    for (const a of [-125, 125, 55, -55]) {
      const t = (a * Math.PI) / 180
      st.tower(k, r * Math.sin(t), cz + r * Math.cos(t), 0.115)
    }
    houses(k, st, 2, cz + 0.02)
    k.push(-0.15, 0, -0.27, -0.2)
    st.keep(k)
    k.pop()
    k.push(0.15, 0, -0.25, -0.1)
    st.church(k, 0.85)
    k.pop()
  } else {
    const cz = -0.03
    const r = 0.47
    pad(k, cz, r - 0.01, st.pad, 10, 1)
    k.lathe(0, 0.009, 0, [[0.17, 0]], 6, st.square, Math.PI / 6, true, 1, 0.85)
    st.wall(k, cz, r, 0.09, 10)
    st.gate(k, 0, cz + r - 0.01)
    for (const a of [-140, 140, 62, -62]) {
      const t = (a * Math.PI) / 180
      st.tower(k, r * Math.sin(t), cz + r * Math.cos(t), 0.14)
    }
    houses(k, st, 3, cz + 0.03)
    k.push(0.0, 0, -0.29, -0.06)
    st.great(k)
    k.pop()
  }
}

export interface TownGeometry {
  variant: TownVariant
  geometry: THREE.BufferGeometry
  /** per class: model triangles, outlined triangles, bbox */
  forms: FormStats[]
}

const cache = new Map<TownVariant, TownGeometry>()
const HEIGHT_K = 1.35

/** The variant's geometry: four forms (aVar 0..3 = hamlet, village, town, city). */
export function buildTown(variant: TownVariant): TownGeometry {
  let g = cache.get(variant)
  if (g) return g
  const k = new Kit()
  const st = STYLES[variant]
  for (let c = 0; c < 4; c++) {
    k.begin(`${variant}-${TOWN_CLASSES[c]}`)
    // heights exaggerated (EU4 chunkiness): at 20-36 px the walls and towers must stand up
    k.push(0, 0, 0, 0, 1, HEIGHT_K, 1)
    buildClass(k, st, c as TownClass)
    k.pop()
  }
  g = { variant, geometry: k.build(), forms: k.forms }
  cache.set(variant, g)
  return g
}

/** Size class by photo count: 1 hamlet, 2-3 village, 4 town, 5+ city; none without photos. */
export function townClassOf(photos: number): TownClass | -1 {
  if (photos <= 0) return -1
  if (photos === 1) return 0
  if (photos <= 3) return 1
  if (photos === 4) return 2
  return 3
}

const MEDINA_CC = new Set(['EG', 'JO', 'LB', 'QA', 'MA', 'TN', 'TR', 'DZ', 'LY', 'SY', 'IQ', 'IR', 'SA', 'AE', 'OM', 'YE', 'KW', 'BH', 'IL', 'PS', 'IN', 'PK', 'BD', 'NP', 'LK', 'UZ', 'AF'])
const PAGODA_CC = new Set(['JP', 'CN', 'KR', 'KP', 'TW', 'HK', 'MO', 'MN'])
const STILT_CC = new Set(['TH', 'MY', 'ID', 'VN', 'SG', 'PH', 'KH', 'LA', 'MM', 'BN', 'TL', 'PG', 'FJ'])
const TIMBER_CC = new Set(['SE', 'FI', 'NO', 'EE', 'IS', 'DK', 'LV', 'CA', 'AU', 'NZ'])
const ADOBE_CC = new Set(['PE', 'CO', 'MX', 'BR', 'BO', 'EC', 'CL', 'AR', 'GT', 'HN', 'NI', 'CR', 'PA', 'VE', 'UY', 'PY', 'CU', 'DO', 'SV'])

/**
 * Regional variant by country (and, in the US, by latitude / longitude): the southwest and
 * Florida build in adobe, Hawaii on stilts under thatch, the rest in timber.
 */
export function townVariantOf(cc: string, lat: number, lon: number): TownVariant {
  const c = cc.toUpperCase()
  if (c === 'US') {
    if (lon < -150) return 'stilt'
    if (lat < 37.5 && lon < -97) return 'adobe'
    if (lat < 31 && lon > -90) return 'adobe'
    return 'timber'
  }
  if (MEDINA_CC.has(c)) return 'medina'
  if (PAGODA_CC.has(c)) return 'pagoda'
  if (STILT_CC.has(c)) return 'stilt'
  if (TIMBER_CC.has(c)) return 'timber'
  if (ADOBE_CC.has(c)) return 'adobe'
  return 'euro'
}
