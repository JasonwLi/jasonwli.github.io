/**
 * Hero model specimen (dev only, never bundled): each hero model (hero/*) beside the
 * low-poly form it replaces, with the real monument material.
 *   /src/three/monuments/dev/hero.html                     old @150 | hero @300 | @120 | @56 | @40 px
 *   ?only=taj-hero,eiffel-hero   just these      ?big=600   one large cell per model
 *   ?yaw=0.4 (rad, the app turns each landmark +-0.32..0.52)  ?elev=35 (deg above the ground plane)
 * px = the form's size measure (formSize: max(height, 0.7 x width, 0.5 x depth)) on screen,
 * the same measure Monuments.tsx clamps to 40 px.
 */
import * as THREE from 'three'
import { ARCHETYPES } from '../../../data/landmarks.ts'
import { buildArchetype } from '../archetypes.ts'
import { HEROES } from '../hero/index.ts'
import { attachInstanceAttributes, makeMonumentMaterial } from '../material.ts'

const q = new URLSearchParams(location.search)
const only = q.get('only')?.split(',')
const big = Number(q.get('big') ?? 0)
const yaw = Number(q.get('yaw') ?? 0.4)
const elevDeg = Number(q.get('elev') ?? 35)
const canvas = document.getElementById('c') as HTMLCanvasElement
const labels = document.getElementById('labels') as HTMLDivElement

const heroes = HEROES.filter((h) => !only || only.includes(h.form) || only.includes(h.id))
const form = (arch: (typeof ARCHETYPES)[number], name: string) => {
  const kit = buildArchetype(arch)
  const v = kit.index.get(name)
  if (v === undefined) throw new Error(`no form ${arch}/${name}`)
  return { arch, v, ...kit.forms[v] }
}

const ROW = big ? big + 40 : 340
const COLW = big ? big + 20 : 960
const COLS = big ? Math.max(1, Math.min(3, Math.floor(1900 / COLW))) : 2
const W = COLS * COLW
const H = Math.ceil(heroes.length / COLS) * ROW
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(W, H)
renderer.setScissorTest(true)
const swatches = ['#4f6a3c', '#8a8a55', '#a8875a', '#3f5f45']

const material = makeMonumentMaterial()
material.uniforms.uPxRatio.value = window.devicePixelRatio
const meshes = new Map<string, THREE.InstancedMesh>()
const elev = (elevDeg * Math.PI) / 180
for (const arch of ARCHETYPES) {
  const src = buildArchetype(arch).geometry
  const g = new THREE.BufferGeometry()
  for (const [n, a] of Object.entries(src.attributes)) g.setAttribute(n, a)
  g.setIndex(src.index)
  const attrs = attachInstanceAttributes(g, 1)
  attrs.iUp.setXYZ(0, 0, Math.sin(elev), Math.cos(elev))
  const m = new THREE.InstancedMesh(g, material, 1)
  m.frustumCulled = false
  m.userData.attrs = attrs
  meshes.set(arch, m)
}

const camera = new THREE.PerspectiveCamera(20, 1, 0.01, 100)
const D = 10
camera.position.set(0, Math.sin(elev) * D, Math.cos(elev) * D)
camera.lookAt(0, 0, 0)

type F = ReturnType<typeof form>
function draw(item: F, x: number, y: number, w: number, h: number, px: number, bg: string) {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(bg)
  const mesh = meshes.get(item.arch)!
  const { iVar } = mesh.userData.attrs as ReturnType<typeof attachInstanceAttributes>
  iVar.setX(0, item.v)
  iVar.needsUpdate = true
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  const ppu = ((h / 2) * camera.projectionMatrix.elements[5]) / D
  const k = px / ppu / item.size
  const cx = (item.box[0] + item.box[3]) / 2, cz = (item.box[2] + item.box[5]) / 2
  const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
  const c = new THREE.Vector3(-cx * k, 0, -cz * k).applyQuaternion(rot)
  const m = new THREE.Matrix4().compose(new THREE.Vector3(c.x, (-item.box[4] * k) / 2, c.z), rot, new THREE.Vector3(k, k, k))
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

heroes.forEach((h, i) => {
  const ox = (i % COLS) * COLW, oy = Math.floor(i / COLS) * ROW
  const hero = form(h.arch, h.form)
  if (big) {
    draw(hero, ox + 2, oy + 2, COLW - 4, ROW - 24, big * 0.62, swatches[i % 4])
    label(`${h.form} · ${hero.tris} tris`, ox + 6, oy + ROW - 20)
    return
  }
  const old = form(h.arch, h.replaces)
  draw(old, ox + 2, oy + 2, 196, 300, 150, swatches[i % 4])
  label(`${h.replaces} · ${old.tris}`, ox + 6, oy + 306)
  draw(hero, ox + 200, oy + 2, 420, 300, 300 * 0.82, swatches[i % 4])
  label(`${h.form} · ${hero.tris} tris`, ox + 206, oy + 306)
  draw(hero, ox + 622, oy + 2, 170, 170, 120, swatches[(i + 1) % 4])
  draw(hero, ox + 794, oy + 2, 90, 90, 56, swatches[(i + 2) % 4])
  draw(hero, ox + 886, oy + 2, 70, 70, 40, swatches[(i + 3) % 4])
  draw(old, ox + 886, oy + 92, 70, 70, 40, swatches[(i + 3) % 4])
  label('120', ox + 626, oy + 174)
  label('56', ox + 798, oy + 94)
  label('40 hero / old', ox + 830, oy + 164)
})
;(window as unknown as { __specimenDone: boolean }).__specimenDone = true
