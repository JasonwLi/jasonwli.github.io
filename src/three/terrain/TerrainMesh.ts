/**
 * Cube-sphere patch mesh (C2b): ONE instanced draw. Geometry = a 33x33-vertex patch
 * (u, v in [0,1], skirt 0) plus a skirt ring (border vertices again with skirt 1) that
 * hides cracks between levels; per-instance aNode = (face, level, ix, iy).
 * update() runs the quadtree in the globe-local frame and rewrites the instance buffer.
 */
import {
  BufferAttribute,
  DynamicDrawUsage,
  Frustum,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix4,
  Mesh,
  Vector3,
  type Camera,
  type Object3D,
  type ShaderMaterial,
} from 'three'
import { selectNodes } from './quadtree'

export const PATCH_N = 33

function buildPatchGeometry(maxInstances: number): InstancedBufferGeometry {
  const N = PATCH_N
  const Q = N - 1
  // border loop (counter-clockwise in u,v), 4*Q vertices
  const border: [number, number][] = []
  for (let i = 0; i < Q; i++) border.push([i, 0])
  for (let j = 0; j < Q; j++) border.push([Q, j])
  for (let i = Q; i > 0; i--) border.push([i, Q])
  for (let j = Q; j > 0; j--) border.push([0, j])
  const nGrid = N * N
  const nVerts = nGrid + border.length
  const pos = new Float32Array(nVerts * 3)
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = (j * N + i) * 3
      pos[k] = i / Q
      pos[k + 1] = j / Q
      pos[k + 2] = 0
    }
  }
  border.forEach(([i, j], b) => {
    const k = (nGrid + b) * 3
    pos[k] = i / Q
    pos[k + 1] = j / Q
    pos[k + 2] = 1
  })
  const idx: number[] = []
  for (let j = 0; j < Q; j++) {
    for (let i = 0; i < Q; i++) {
      const a = j * N + i
      const b = a + 1
      const c = a + N
      const d = c + 1
      // alternate the diagonal so slopes do not all lean one way
      if ((i + j) & 1) idx.push(a, b, d, a, d, c)
      else idx.push(a, b, c, b, d, c)
    }
  }
  for (let b = 0; b < border.length; b++) {
    const b2 = (b + 1) % border.length
    const [i0, j0] = border[b]
    const [i1, j1] = border[b2]
    const t0 = j0 * N + i0
    const t1 = j1 * N + i1
    const s0 = nGrid + b
    const s1 = nGrid + b2
    idx.push(t0, s0, t1, t1, s0, s1)
  }
  const g = new InstancedBufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setIndex(idx)
  const node = new InstancedBufferAttribute(new Float32Array(maxInstances * 4), 4)
  node.setUsage(DynamicDrawUsage)
  g.setAttribute('aNode', node)
  g.instanceCount = 0
  return g
}

const invInner = new Matrix4()
const m4 = new Matrix4()
const camLocal = new Vector3()
const frustum = new Frustum()

export class TerrainMesh {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>
  readonly maxInstances: number
  count = 0

  constructor(material: ShaderMaterial, maxInstances: number) {
    this.maxInstances = maxInstances
    const g = buildPatchGeometry(maxInstances)
    this.mesh = new Mesh(g, material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -1
    this.mesh.raycast = () => {}
    this.mesh.name = 'terrain-cube'
  }

  /**
   * Select nodes for this camera. `parent` is the globe-local frame (the inner group);
   * heightPx: drawing-buffer-independent viewport height in CSS px.
   */
  update(camera: Camera, parent: Object3D, heightPx: number, opts: { patchPx: number; maxLevel: number; maxLift: number }): number {
    camera.updateMatrixWorld()
    parent.updateWorldMatrix(true, false)
    invInner.copy(parent.matrixWorld).invert()
    camLocal.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(invInner)
    // frustum in the local frame: P * V * innerWorld
    m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(parent.matrixWorld)
    frustum.setFromProjectionMatrix(m4)
    const focalPx = (camera.projectionMatrix.elements[5] * heightPx) / 2
    // the camera may sit inside a scaled outer group: local distances are in globe radii
    const attr = this.mesh.geometry.getAttribute('aNode') as InstancedBufferAttribute
    const arr = attr.array as Float32Array
    this.count = selectNodes(
      { cam: camLocal, frustum, focalPx, patchPx: opts.patchPx, maxLevel: opts.maxLevel, maxNodes: this.maxInstances, maxLift: opts.maxLift },
      arr,
    )
    attr.clearUpdateRanges()
    attr.addUpdateRange(0, this.count * 4)
    attr.needsUpdate = true
    this.mesh.geometry.instanceCount = this.count
    return this.count
  }

  dispose(): void {
    this.mesh.geometry.dispose()
  }
}
