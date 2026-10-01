/**
 * Low-poly geometry kit for the monument archetypes (C5).
 *
 * Model space: unit height (ground y = 0, the form's top near y = 1), x = right,
 * z = toward the viewer (the 'front' of every form), y = up. Primitives carry one flat
 * vertex colour each (sRGB hex -> linear at build time, R1) and an outward direction
 * per vertex used only by the inverted-hull outline (screen-space, so winding does not
 * matter: shading is flat from screen derivatives and the material is double-sided).
 *
 * Every primitive drops its bottom face (monuments stand on the ground). The kit
 * builds ONE BufferGeometry per archetype: each form (sub-mesh) is tagged with
 * aVar = its index, and the model triangles are duplicated as hull triangles (aHull 1).
 */
import * as THREE from 'three'

export type V3 = [number, number, number]

const tmpV = new THREE.Vector3()
const colorCache = new Map<string, V3>()
function linear(hex: string): V3 {
  let c = colorCache.get(hex)
  if (!c) {
    const col = new THREE.Color(hex) // sRGB hex -> linear working space
    c = [col.r, col.g, col.b]
    colorCache.set(hex, c)
  }
  return c
}

export interface FormStats {
  name: string
  tris: number
  /** triangles that carry an inverted-hull outline (<= tris; hairlines have none) */
  hullTris: number
  /** bbox in model units: [minX, minY, minZ, maxX, maxY, maxZ] */
  box: [number, number, number, number, number, number]
}

export class Kit {
  private pos: number[] = []
  private col: number[] = []
  private out: number[] = []
  private vari: number[] = []
  private idx: number[] = []
  /** triangles that also get an inverted-hull outline (all of them unless `hull` is off) */
  private hidx: number[] = []
  /**
   * Outline switch for the primitives that follow (hero models): hairline members such as
   * suspenders, lattice diagonals or railings set it false so they draw as fine lines,
   * not as 2 px ink bars. Reset to true by begin().
   */
  hull = true
  private m = new THREE.Matrix4()
  private stack: THREE.Matrix4[] = []
  private formStart = 0
  private hullStart = 0
  readonly forms: FormStats[] = []
  private variant = -1

  /** Start a new form (sub-mesh). Returns its variant index. */
  begin(name: string): number {
    this.end()
    this.variant = this.forms.length
    this.forms.push({ name, tris: 0, hullTris: 0, box: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity] })
    this.formStart = this.idx.length
    this.hullStart = this.hidx.length
    this.m.identity()
    this.stack.length = 0
    this.hull = true
    return this.variant
  }

  private end() {
    if (this.variant < 0) return
    this.forms[this.variant].tris = (this.idx.length - this.formStart) / 3
    this.forms[this.variant].hullTris = (this.hidx.length - this.hullStart) / 3
  }

  /** Push a transform: translate (x,y,z), rotate about y (rad), scale (sx,sy,sz). Pair with pop(). */
  push(x = 0, y = 0, z = 0, rotY = 0, sx = 1, sy = sx, sz = sx, rotZ = 0, rotX = 0): this {
    this.stack.push(this.m.clone())
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'YXZ'))
    const t = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz))
    this.m.multiply(t)
    return this
  }

  pop(): this {
    const m = this.stack.pop()
    if (m) this.m.copy(m)
    return this
  }

  /** Raw primitive: local vertices, triangles (vertex index triples), one colour. */
  prim(verts: V3[], tris: number[][], hex: string): this {
    const base = this.pos.length / 3
    const c = linear(hex)
    const P = verts.map((v) => tmpV.set(v[0], v[1], v[2]).applyMatrix4(this.m).toArray() as V3)
    // centroid of the primitive (for orienting face normals outward)
    const cen: V3 = [0, 0, 0]
    for (const p of P) {
      cen[0] += p[0] / P.length
      cen[1] += p[1] / P.length
      cen[2] += p[2] / P.length
    }
    const acc = P.map(() => [0, 0, 0] as V3)
    for (const [a, b, d] of tris) {
      const A = P[a], B = P[b], C = P[d]
      const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]]
      const e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]]
      let n: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
      const l = Math.hypot(n[0], n[1], n[2])
      if (l < 1e-12) continue
      n = [n[0] / l, n[1] / l, n[2] / l]
      const fc = [(A[0] + B[0] + C[0]) / 3 - cen[0], (A[1] + B[1] + C[1]) / 3 - cen[1], (A[2] + B[2] + C[2]) / 3 - cen[2]]
      if (n[0] * fc[0] + n[1] * fc[1] + n[2] * fc[2] < 0) n = [-n[0], -n[1], -n[2]]
      for (const k of [a, b, d]) {
        acc[k][0] += n[0]
        acc[k][1] += n[1]
        acc[k][2] += n[2]
      }
      this.idx.push(base + a, base + b, base + d)
      if (this.hull) this.hidx.push(base + a, base + b, base + d)
    }
    const box = this.forms[this.variant].box
    P.forEach((p, k) => {
      const o = acc[k]
      const l = Math.hypot(o[0], o[1], o[2]) || 1
      this.pos.push(p[0], p[1], p[2])
      this.col.push(c[0], c[1], c[2])
      this.out.push(o[0] / l, o[1] / l, o[2] / l)
      this.vari.push(this.variant)
      box[0] = Math.min(box[0], p[0])
      box[1] = Math.min(box[1], p[1])
      box[2] = Math.min(box[2], p[2])
      box[3] = Math.max(box[3], p[0])
      box[4] = Math.max(box[4], p[1])
      box[5] = Math.max(box[5], p[2])
    })
    return this
  }

  /** Oriented box from a to b (centre line), cross-section w (horizontal) x d. 12 tris (8 without caps). */
  beam(a: V3, b: V3, w: number, d: number, hex: string, caps = true): this {
    const u = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize()
    let s = new THREE.Vector3().crossVectors(u, new THREE.Vector3(0, 1, 0))
    if (s.lengthSq() < 1e-6) s = new THREE.Vector3(1, 0, 0)
    s.normalize()
    const t = new THREE.Vector3().crossVectors(s, u).normalize()
    const V: V3[] = []
    for (const p of [a, b])
      for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]])
        V.push([p[0] + (s.x * w * i + t.x * d * j) / 2, p[1] + (s.y * w * i + t.y * d * j) / 2, p[2] + (s.z * w * i + t.z * d * j) / 2])
    const T: number[][] = []
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4
      T.push([i, j, 4 + j], [i, 4 + j, 4 + i])
    }
    if (caps) T.push([0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6])
    return this.prim(V, T, hex)
  }

  /** Axis box, base centre (x, y0, z), size w x h x d. No bottom: 10 tris. */
  box(x: number, y0: number, z: number, w: number, h: number, d: number, hex: string): this {
    return this.frustum4(x, y0, z, w, d, w, d, h, hex)
  }

  /** Rectangular frustum: bottom w0 x d0, top w1 x d1 (0,0 = apex). 10 tris (8 with apex). */
  frustum4(x: number, y0: number, z: number, w0: number, d0: number, w1: number, d1: number, h: number, hex: string, dx = 0, dz = 0): this {
    const a = w0 / 2, b = d0 / 2, c = w1 / 2, e = d1 / 2
    const y1 = y0 + h
    const tx = x + dx, tz = z + dz
    const V: V3[] = [
      [x - a, y0, z - b], [x + a, y0, z - b], [x + a, y0, z + b], [x - a, y0, z + b],
    ]
    if (w1 === 0 && d1 === 0) {
      V.push([tx, y1, tz])
      return this.prim(V, [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]], hex)
    }
    V.push([tx - c, y1, tz - e], [tx + c, y1, tz - e], [tx + c, y1, tz + e], [tx - c, y1, tz + e])
    const T: number[][] = []
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4
      T.push([i, j, 4 + j], [i, 4 + j, 4 + i])
    }
    T.push([4, 5, 6], [4, 6, 7])
    return this.prim(V, T, hex)
  }

  /** Round frustum / prism / cone: n sides, radii r0 -> r1 (0 = apex). rot = start angle. */
  prism(x: number, y0: number, z: number, r0: number, r1: number, h: number, n: number, hex: string, rot = 0, top = true): this {
    return this.lathe(x, y0, z, [[r0, 0], [r1, h]], n, hex, rot, top)
  }

  /**
   * Lathe a profile [[r, y], ...] (y relative to y0) around the vertical axis with n
   * sides. r = 0 at the ends collapses to a pole. Closes the top with a fan when the
   * last radius is > 0 and `top`.
   */
  lathe(x: number, y0: number, z: number, profile: [number, number][], n: number, hex: string, rot = 0, top = true, sx = 1, sz = 1): this {
    const V: V3[] = []
    const rings: number[][] = []
    for (const [r, y] of profile) {
      const ring: number[] = []
      if (r === 0) {
        ring.push(V.length)
        V.push([x, y0 + y, z])
      } else {
        for (let i = 0; i < n; i++) {
          const a = rot + (i / n) * Math.PI * 2
          ring.push(V.length)
          V.push([x + Math.sin(a) * r * sx, y0 + y, z + Math.cos(a) * r * sz])
        }
      }
      rings.push(ring)
    }
    const T: number[][] = []
    for (let k = 0; k + 1 < rings.length; k++) {
      const A = rings[k], B = rings[k + 1]
      if (A.length === 1 && B.length === 1) continue
      if (A.length === 1) {
        for (let i = 0; i < n; i++) T.push([A[0], B[(i + 1) % n], B[i]])
      } else if (B.length === 1) {
        for (let i = 0; i < n; i++) T.push([A[i], A[(i + 1) % n], B[0]])
      } else {
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n
          T.push([A[i], A[j], B[j]], [A[i], B[j], B[i]])
        }
      }
    }
    const last = rings[rings.length - 1]
    if (top && last.length > 2) for (let i = 1; i + 1 < last.length; i++) T.push([last[0], last[i], last[i + 1]])
    return this.prim(V, T, hex)
  }

  /**
   * Extrude a 2D outline (x, y in model units, CCW or CW) with optional holes along z,
   * centred on z (depth d). Front and back faces + side walls.
   */
  extrude(outline: [number, number][], d: number, hex: string, holes: [number, number][][] = [], z = 0): this {
    const contour = outline.map(([x, y]) => new THREE.Vector2(x, y))
    const hs = holes.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y)))
    const faces = THREE.ShapeUtils.triangulateShape(contour, hs)
    const all = [...outline, ...holes.flat()]
    const nAll = all.length
    const V: V3[] = []
    for (const [x, y] of all) V.push([x, y, z + d / 2])
    for (const [x, y] of all) V.push([x, y, z - d / 2])
    const T: number[][] = []
    for (const f of faces) {
      T.push([f[0], f[1], f[2]])
      T.push([f[0] + nAll, f[2] + nAll, f[1] + nAll])
    }
    const walls = (start: number, len: number) => {
      for (let i = 0; i < len; i++) {
        const a = start + i, b = start + ((i + 1) % len)
        T.push([a, b, b + nAll], [a, b + nAll, a + nAll])
      }
    }
    walls(0, outline.length)
    let s = outline.length
    for (const h of holes) {
      walls(s, h.length)
      s += h.length
    }
    return this.prim(V, T, hex)
  }

  /** Gable roof: base w x d at y0, ridge along x at height h. 6 tris. */
  gable(x: number, y0: number, z: number, w: number, h: number, d: number, hex: string): this {
    const a = w / 2, b = d / 2
    return this.prim(
      [[x - a, y0, z - b], [x + a, y0, z - b], [x + a, y0, z + b], [x - a, y0, z + b], [x - a, y0 + h, z], [x + a, y0 + h, z]],
      [[0, 1, 5], [0, 5, 4], [3, 2, 5], [3, 5, 4], [0, 4, 3], [1, 2, 5]],
      hex,
    )
  }

  /** Hipped/eaved roof with upturned corners (pagoda/hall): base w x d, overhang o, rise h, lift of the corners u. */
  eave(x: number, y0: number, z: number, w: number, d: number, h: number, o: number, u: number, hex: string, ridge = 0.35): this {
    const a = w / 2 + o, b = d / 2 + o
    const ra = (w / 2) * ridge, rb = Math.min((d / 2) * ridge, ra)
    const V: V3[] = [
      // eave corners lifted by u, edge mids at y0
      [x - a, y0 + u, z - b], [x, y0, z - b], [x + a, y0 + u, z - b],
      [x + a, y0, z], [x + a, y0 + u, z + b], [x, y0, z + b],
      [x - a, y0 + u, z + b], [x - a, y0, z],
      // ridge
      [x - ra, y0 + h, z - rb], [x + ra, y0 + h, z - rb], [x + ra, y0 + h, z + rb], [x - ra, y0 + h, z + rb],
    ]
    return this.prim(
      V,
      [
        [0, 1, 8], [1, 9, 8], [1, 2, 9],
        [2, 3, 9], [3, 10, 9], [3, 4, 10],
        [4, 5, 10], [5, 11, 10], [5, 6, 11],
        [6, 7, 11], [7, 8, 11], [7, 0, 8],
        [8, 9, 10], [8, 10, 11],
      ],
      hex,
    )
  }

  /** Arc of boxes along a circle (rings of arches, colonnades). */
  ringOf(n: number, r: number, from: number, to: number, fn: (x: number, z: number, ang: number, i: number) => void): this {
    for (let i = 0; i < n; i++) {
      const a = from + ((to - from) * (i + 0.5)) / n
      fn(Math.sin(a) * r, Math.cos(a) * r, a, i)
    }
    return this
  }

  /** Build the archetype geometry: model + duplicated hull triangles. */
  build(): THREE.BufferGeometry {
    this.end()
    const nV = this.pos.length / 3
    const pos = new Float32Array(nV * 2 * 3)
    const col = new Float32Array(nV * 2 * 3)
    const out = new Float32Array(nV * 2 * 3)
    const vari = new Float32Array(nV * 2)
    const hull = new Float32Array(nV * 2)
    pos.set(this.pos)
    pos.set(this.pos, nV * 3)
    col.set(this.col)
    col.set(this.col, nV * 3)
    out.set(this.out)
    out.set(this.out, nV * 3)
    vari.set(this.vari)
    vari.set(this.vari, nV)
    hull.fill(1, nV)
    const nI = this.idx.length
    const nH = this.hidx.length
    const IndexArr = nV * 2 > 65535 ? Uint32Array : Uint16Array
    const index = new IndexArr(nH + nI)
    // hull first: drawn before the model inside the one draw call
    for (let i = 0; i < nH; i++) index[i] = this.hidx[i] + nV
    for (let i = 0; i < nI; i++) index[nH + i] = this.idx[i]
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aCol', new THREE.BufferAttribute(col, 3))
    g.setAttribute('aOut', new THREE.BufferAttribute(out, 3))
    g.setAttribute('aVar', new THREE.BufferAttribute(vari, 1))
    g.setAttribute('aHull', new THREE.BufferAttribute(hull, 1))
    g.setIndex(new THREE.BufferAttribute(index, 1))
    g.computeBoundingSphere()
    return g
  }
}
