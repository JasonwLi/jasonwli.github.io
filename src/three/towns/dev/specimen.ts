/**
 * Town specimen (dev only, never bundled): /src/three/towns/dev/specimen.html
 * Top: every regional variant (columns) x size class (rows) large (a city 170 px wide) on
 * its typical painted ground. Below: the same 24 forms at the app's sizes, a city 30 / 20 /
 * 14 px wide (the classes scale with it, as in the app). Seen from 32 deg above, turned
 * -0.3 rad (the wide-view stance and facing Towns.tsx gives a town); a vermilion pin dot
 * marks where the place's pin sits (the square). Real town material (alpha 1). ?class=n /
 * ?variant=name narrow the large grid; ?yaw= overrides the facing.
 */
import * as THREE from 'three'
import { TOWN_CLASSES, TOWN_VARIANTS, buildTown, type TownVariant } from '../townKit.ts'
import { attachTownAttributes, makeTownMaterial } from '../material.ts'
import { guardThemeColours } from '../../monuments/material.ts'

const canvas = document.getElementById('c') as HTMLCanvasElement
const labels = document.getElementById('labels') as HTMLDivElement
const q = new URLSearchParams(location.search)
const YAW = q.has('yaw') ? Number(q.get('yaw')) : -0.3
const W = 1240
const H = 900
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(W, H)
renderer.setScissorTest(true)
renderer.setClearColor('#011844')
renderer.clear()
const material = makeTownMaterial()
material.uniforms.uPxRatio.value = window.devicePixelRatio
const elev = (32 * Math.PI) / 180
const GROUND: Record<TownVariant, string> = {
  euro: '#67833a', // grass
  timber: '#34622a', // forest
  medina: '#a59062', // desert
  pagoda: '#67833a',
  stilt: '#34622a',
  adobe: '#8f8453', // steppe
}
const meshes = new Map<TownVariant, { mesh: THREE.InstancedMesh; attrs: ReturnType<typeof attachTownAttributes> }>()
let tris = ''
for (const v of TOWN_VARIANTS) {
  const t = buildTown(v)
  const g = new THREE.BufferGeometry()
  for (const [n, a] of Object.entries(t.geometry.attributes)) g.setAttribute(n, a)
  g.setAttribute('aCol', guardThemeColours(t.geometry.getAttribute('aCol') as THREE.BufferAttribute).attr)
  g.setIndex(t.geometry.index)
  const attrs = attachTownAttributes(g, 1)
  attrs.iAlpha.setX(0, 1)
  attrs.iUp.setXYZ(0, 0, Math.sin(elev), Math.cos(elev))
  const mesh = new THREE.InstancedMesh(g, material, 1)
  mesh.frustumCulled = false
  meshes.set(v, { mesh, attrs })
  tris += `${v}: ${t.forms.map((f) => f.tris).join('/')}  `
}
const camera = new THREE.PerspectiveCamera(20, 1, 0.01, 100)
const D = 10
camera.position.set(0, Math.sin(elev) * D, Math.cos(elev) * D)
camera.lookAt(0, 0, 0)
const pinGeo = new THREE.CircleGeometry(1, 20)
const pinMat = new THREE.MeshBasicMaterial({ color: '#d0402a', depthTest: false })
const pin = new THREE.Mesh(pinGeo, pinMat)
pin.renderOrder = 30

function draw(v: TownVariant, cls: number, x: number, y: number, w: number, h: number, px: number, bg: string, showPin: boolean) {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(bg)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  const ppu = ((h / 2) * camera.projectionMatrix.elements[5]) / D
  const k = px / ppu
  const { mesh, attrs } = meshes.get(v)!
  attrs.iVar.setX(0, cls)
  attrs.iVar.needsUpdate = true
  const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), YAW)
  // the square (origin) a little below the cell centre: the town rises behind it
  const c = new THREE.Vector3(0, -0.12 * k, 0.05 * k)
  mesh.setMatrixAt(0, new THREE.Matrix4().compose(c, rot, new THREE.Vector3(k, k, k)))
  mesh.instanceMatrix.needsUpdate = true
  scene.add(mesh)
  if (showPin) {
    // the pin: 3.25 px core (CSS), screen-facing at the square
    const r = 3.25 / ppu
    pin.position.copy(c).add(new THREE.Vector3(0, 0.0025, 0))
    pin.quaternion.copy(camera.quaternion)
    pin.scale.setScalar(r)
    scene.add(pin)
  }
  material.uniforms.uViewport.value.set(w, h)
  const yy = H - y - h
  renderer.setViewport(x, yy, w, h)
  renderer.setScissor(x, yy, w, h)
  renderer.render(scene, camera)
  scene.remove(mesh)
  scene.remove(pin)
}
function label(text: string, x: number, y: number) {
  const d = document.createElement('div')
  d.textContent = text
  d.style.left = `${x}px`
  d.style.top = `${y}px`
  labels.appendChild(d)
}
const onlyVar = q.get('variant') as TownVariant | null
const variants = onlyVar ? [onlyVar] : [...TOWN_VARIANTS]
const CW = 204
const CH = 150
variants.forEach((v, i) => {
  for (let c = 0; c < 4; c++) {
    draw(v, c, i * CW + 2, 18 + c * CH, CW - 4, CH - 4, 170, GROUND[v], c === 3)
    if (i === 0) label(TOWN_CLASSES[c], 4, 18 + c * CH + CH - 18)
  }
  label(v, i * CW + 8, 2)
})
const sizes = [30, 20, 14]
let y0 = 18 + 4 * CH + 6
sizes.forEach((px, r) => {
  variants.forEach((v, i) => {
    for (let c = 0; c < 4; c++) draw(v, c, i * CW + 2 + c * 50, y0, 48, 70, px, GROUND[v], r === 0 && c === 3)
  })
  label(`city ${px} px`, 4, y0 + 56)
  y0 += 74
})
label(`tris (hamlet/village/town/city) ${tris}`, 4, H - 16)
;(window as unknown as { __specimenDone: boolean }).__specimenDone = true
