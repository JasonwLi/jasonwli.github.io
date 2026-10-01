/**
 * Low-poly tree species (C6). Model units: ground at y = 0, crown top ~1, +y = up
 * (the ground normal), x/z in the tangent plane. Indexed; the material shades flat from
 * screen derivatives, so vertices are shared. Attributes:
 *   position, aShade (baked darker base band: 0.7 at the crown base -> 1 at the top),
 *   aTrunk (1 = trunk, takes the trunk colour).
 * The trunk starts below ground (y < 0) so slopes never show a gap.
 *  - conifer:   two stacked 7-sided cones (14 tris) + a 3-sided trunk (6 tris)
 *  - broadleaf: one squashed icosahedron lump (20 tris) + trunk (6 tris); also draws the
 *               jungle canopy trees (wider, flatter, jungle colour: per-instance flag)
 *  - palm:      5 drooping folded fronds (20 tris) + a leaning 2-segment trunk (12 tris)
 */
import * as THREE from 'three'

export type Species = 'conifer' | 'broadleaf' | 'palm'
export const SPECIES: Species[] = ['conifer', 'broadleaf', 'palm']

class Builder {
  pos: number[] = []
  shade: number[] = []
  trunk: number[] = []
  idx: number[] = []
  v(x: number, y: number, z: number, shade: number, trunk = 0): number {
    this.pos.push(x, y, z)
    this.shade.push(shade)
    this.trunk.push(trunk)
    return this.pos.length / 3 - 1
  }
  t(a: number, b: number, c: number) {
    this.idx.push(a, b, c)
  }
  /** n-sided prism between two centres (open ends) */
  prism(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r: number, n: number, rot = 0) {
    const base = this.pos.length / 3
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2
      const dx = Math.cos(a) * r
      const dz = Math.sin(a) * r
      this.v(x0 + dx, y0, z0 + dz, 0.8, 1)
      this.v(x1 + dx, y1, z1 + dz, 1, 1)
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const a0 = base + i * 2
      const a1 = a0 + 1
      const b0 = base + j * 2
      const b1 = b0 + 1
      this.t(a0, b0, a1)
      this.t(b0, b1, a1)
    }
  }
  /** open cone: ring at y0 radius r, apex at y1 */
  cone(y0: number, r: number, y1: number, n: number, ringShade: number, rot = 0) {
    const apex = this.v(0, y1, 0, 1)
    const base = this.pos.length / 3
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2
      this.v(Math.cos(a) * r, y0, Math.sin(a) * r, ringShade)
    }
    for (let i = 0; i < n; i++) this.t(base + i, base + ((i + 1) % n), apex)
  }
  geometry(): THREE.InstancedBufferGeometry {
    const g = new THREE.InstancedBufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('aShade', new THREE.Float32BufferAttribute(this.shade, 1))
    g.setAttribute('aTrunk', new THREE.Float32BufferAttribute(this.trunk, 1))
    g.setIndex(this.idx)
    return g
  }
}

function conifer(): Builder {
  const b = new Builder()
  b.prism(0, -0.15, 0, 0, 0.2, 0, 0.045, 3)
  b.cone(0.13, 0.33, 0.72, 7, 0.68)
  b.cone(0.42, 0.25, 1.0, 7, 0.84, Math.PI / 7)
  return b
}

/** squashed icosahedron lump (12 shared vertices, 20 tris) with a darker base band */
function lump(b: Builder, r: number, cy: number, sy: number, sx = 1) {
  const ico = new THREE.IcosahedronGeometry(r, 0)
  // IcosahedronGeometry is non-indexed: weld its 60 corners to the 12 vertices
  const p = ico.getAttribute('position')
  const map = new Map<string, number>()
  const tri: number[] = []
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) * sx
    const y = p.getY(i) * sy + cy
    const z = p.getZ(i) * sx
    const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`
    let k = map.get(key)
    if (k === undefined) {
      // darker base band: 0.7 at the bottom of the lump -> 1 at the top
      const t = (y - (cy - r * sy)) / (2 * r * sy)
      k = b.v(x, y, z, 0.7 + 0.3 * Math.min(1, Math.max(0, t)))
      map.set(key, k)
    }
    tri.push(k)
    if (tri.length === 3) {
      b.t(tri[0], tri[1], tri[2])
      tri.length = 0
    }
  }
  ico.dispose()
}

function broadleaf(): Builder {
  const b = new Builder()
  b.prism(0, -0.15, 0, 0, 0.36, 0, 0.05, 3)
  lump(b, 0.37, 0.6, 0.8)
  return b
}

function palm(): Builder {
  const b = new Builder()
  b.prism(0, -0.15, 0, 0.035, 0.42, 0, 0.035, 3)
  b.prism(0.035, 0.42, 0, 0.1, 0.84, 0, 0.03, 3)
  const tx = 0.1
  const ty = 0.86
  for (let f = 0; f < 5; f++) {
    const a = (f / 5) * Math.PI * 2 + 0.3
    const dx = Math.cos(a)
    const dz = Math.sin(a)
    const px = -dz
    const pz = dx
    const root = b.v(tx, ty, 0, 0.95)
    const mx = tx + dx * 0.2
    const mz = dz * 0.2
    const my = ty + 0.05
    const w = 0.075
    const L = b.v(mx + px * w, my - 0.03, mz + pz * w, 0.88)
    const C = b.v(mx, my, mz, 1)
    const R = b.v(mx - px * w, my - 0.03, mz - pz * w, 0.88)
    const tip = b.v(tx + dx * 0.42, ty - 0.2, dz * 0.42, 0.76)
    b.t(root, L, C)
    b.t(root, C, R)
    b.t(L, tip, C)
    b.t(C, tip, R)
  }
  return b
}

export function buildTreeGeometry(s: Species): THREE.InstancedBufferGeometry {
  const b = s === 'conifer' ? conifer() : s === 'broadleaf' ? broadleaf() : palm()
  return b.geometry()
}

/** triangles per tree (for stats) */
export function treeTris(s: Species): number {
  return s === 'conifer' ? 20 : s === 'broadleaf' ? 26 : 32
}
