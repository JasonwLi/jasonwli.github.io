/**
 * C5 scratch specimen (dev only, never bundled): every archetype form rendered with the
 * real monument material.
 *   /src/three/monuments/dev/specimen.html               large (150 px cells)
 *   /src/three/monuments/dev/specimen.html?mode=small    each form at 40 / 20 / 14 px (the app
 *     hides 3D forms under 30 px and shows the engraved glyph instead; the small cells
 *     show what would have been drawn)
 * Cells sit on painted-land swatches (forest, steppe, desert) at the terrain's L range,
 * viewed from 35 deg above the monument's ground plane (the lean Monuments.tsx applies).
 */
import * as THREE from 'three'
import { ARCHETYPES } from '../../../data/landmarks.ts'
import { buildArchetype } from '../archetypes.ts'
import { attachInstanceAttributes, makeMonumentMaterial } from '../material.ts'

const small = new URLSearchParams(location.search).get('mode') === 'small'
const canvas = document.getElementById('c') as HTMLCanvasElement
const labels = document.getElementById('labels') as HTMLDivElement

const items: { arch: (typeof ARCHETYPES)[number]; form: string; v: number; size: number; box: number[]; tris: number }[] = []
for (const arch of ARCHETYPES) {
  const kit = buildArchetype(arch)
  kit.forms.forEach((f, v) => items.push({ arch, form: f.name, v, size: f.size, box: f.box, tris: f.tris }))
}

const COLS = small ? 6 : 10
const CELL = small ? [230, 64] : [150, 170]
const W = COLS * CELL[0]
const H = Math.ceil(items.length / COLS) * CELL[1]
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(W, H)
renderer.setScissorTest(true)
const swatches = ['#4f6a3c', '#8a8a55', '#a8875a', '#3f5f45'] // painted land, L 0.45-0.62

const material = makeMonumentMaterial()
material.uniforms.uPxRatio.value = window.devicePixelRatio
const meshes = new Map<string, THREE.InstancedMesh>()
for (const arch of ARCHETYPES) {
  const src = buildArchetype(arch).geometry
  const g = new THREE.BufferGeometry()
  for (const [n, a] of Object.entries(src.attributes)) g.setAttribute(n, a)
  g.setIndex(src.index)
  const attrs = attachInstanceAttributes(g, 1)
  attrs.iUp.setXYZ(0, 0, Math.sin((35 * Math.PI) / 180), Math.cos((35 * Math.PI) / 180))
  const m = new THREE.InstancedMesh(g, material, 1)
  m.frustumCulled = false
  m.userData.attrs = attrs
  meshes.set(arch, m)
}

const camera = new THREE.PerspectiveCamera(20, 1, 0.01, 100)
const D = 10
const elev = (35 * Math.PI) / 180
camera.position.set(0, Math.sin(elev) * D, Math.cos(elev) * D)
camera.lookAt(0, 0, 0)

function draw(item: (typeof items)[number], x: number, y: number, w: number, h: number, px: number, bg: string) {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(bg)
  const mesh = meshes.get(item.arch)!
  const { iVar } = mesh.userData.attrs as ReturnType<typeof attachInstanceAttributes>
  iVar.setX(0, item.v)
  iVar.needsUpdate = true
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  const ppu = (h / 2) * camera.projectionMatrix.elements[5] / D
  const k = px / ppu / item.size
  const cx = (item.box[0] + item.box[3]) / 2, cz = (item.box[2] + item.box[5]) / 2
  // centre the form, base a little below the cell centre
  const m = new THREE.Matrix4().compose(new THREE.Vector3(-cx * k, (-item.box[4] * k) / 2, -cz * k), new THREE.Quaternion(), new THREE.Vector3(k, k, k))
  mesh.setMatrixAt(0, m)
  mesh.instanceMatrix.needsUpdate = true
  scene.add(mesh)
  material.uniforms.uViewport.value.set(w, h)
  const yy = H - y - h
  renderer.setViewport(x, yy, w, h)
  renderer.setScissor(x, yy, w, h)
  renderer.render(scene, camera)
  scene.remove(mesh)
}

function label(text: string, x: number, y: number) {
  const d = document.createElement('div')
  d.textContent = text
  d.style.left = `${x}px`
  d.style.top = `${y}px`
  labels.appendChild(d)
}

items.forEach((it, i) => {
  const cx = (i % COLS) * CELL[0], cy = Math.floor(i / COLS) * CELL[1]
  if (!small) {
    draw(it, cx + 2, cy + 2, CELL[0] - 4, CELL[1] - 22, 110, swatches[i % swatches.length])
    label(`${it.form} · ${it.tris}`, cx + 6, cy + CELL[1] - 18)
  } else {
    const sizes = [40, 20, 14]
    sizes.forEach((px, j) => draw(it, cx + 2 + j * 56, cy + 2, 54, 58, px, swatches[(i + j) % swatches.length]))
    label(it.form, cx + 172, cy + 18)
    // the app draws no 3D form under 30 px (Monuments SHOW_AT_PX); the glyph holds the place
    label('20/14: glyph in app', cx + 172, cy + 34)
  }
})
;(window as unknown as { __specimenDone: boolean }).__specimenDone = true
