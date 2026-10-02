/**
 * Ship specimen (dev only, never bundled): /src/three/ships/dev/specimen.html
 * Row 1: the carrack large (240 px long) at four headings (broadside right, 3/4 toward,
 * bow-on-ish, 3/4 away), on the painted sea (deep / shelf). Rows 2-3: the same headings at
 * the app's sizes, 26 / 20 / 16 px long, on deep and shelf water. Viewed from 32 deg above,
 * the wide-view stance Ships.tsx gives a ship. Real ship material (alpha 1).
 */
import * as THREE from 'three'
import { buildCaravel } from '../caravel.ts'
import { attachShipAttributes, makeShipMaterial } from '../material.ts'
import { guardThemeColours } from '../../monuments/material.ts'

const canvas = document.getElementById('c') as HTMLCanvasElement
const labels = document.getElementById('labels') as HTMLDivElement
const ship = buildCaravel()
const W = 1040
const H = 640
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(W, H)
renderer.setScissorTest(true)
const material = makeShipMaterial()
material.uniforms.uPxRatio.value = window.devicePixelRatio
const g = new THREE.BufferGeometry()
for (const [n, a] of Object.entries(ship.geometry.attributes)) g.setAttribute(n, a)
g.setAttribute('aCol', guardThemeColours(ship.geometry.getAttribute('aCol') as THREE.BufferAttribute).attr)
g.setIndex(ship.geometry.index)
const attrs = attachShipAttributes(g, 1)
attrs.iAlpha.setX(0, 1)
attrs.iUp.setXYZ(0, 0, Math.sin((32 * Math.PI) / 180), Math.cos((32 * Math.PI) / 180))
const mesh = new THREE.InstancedMesh(g, material, 1)
mesh.frustumCulled = false
const camera = new THREE.PerspectiveCamera(20, 1, 0.01, 100)
const D = 10
const elev = (32 * Math.PI) / 180
camera.position.set(0, Math.sin(elev) * D, Math.cos(elev) * D)
camera.lookAt(0, 0, 0)
const DEEP = '#1d3b53'
const SHELF = '#284c64'
const headings: [string, number][] = [
  ['broadside', 0],
  ['3/4 toward', -0.75],
  ['bow-on', -1.35],
  ['3/4 away', 2.4],
]

function draw(yaw: number, x: number, y: number, w: number, h: number, px: number, bg: string) {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(bg)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  const ppu = ((h / 2) * camera.projectionMatrix.elements[5]) / D
  const k = px / ppu
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
  const c = new THREE.Vector3(-0.05 * k, -0.45 * k, 0).applyQuaternion(q)
  mesh.setMatrixAt(0, new THREE.Matrix4().compose(c, q, new THREE.Vector3(k, k, k)))
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
headings.forEach(([name, yaw], i) => {
  draw(yaw, i * 260 + 2, 2, 256, 300, 240, i % 2 ? SHELF : DEEP)
  label(`${name}${i === 0 ? ` · ${ship.tris} tris` : ''}`, i * 260 + 8, 286)
})
const sizes = [26, 20, 16]
for (let r = 0; r < 2; r++) {
  headings.forEach(([, yaw], i) => {
    sizes.forEach((px, j) => draw(yaw, i * 260 + 2 + j * 86, 320 + r * 150, 82, 120, px, r ? SHELF : DEEP))
  })
  label(`${sizes.join(' / ')} px long on ${r ? 'shelf' : 'deep'} sea`, 8, 444 + r * 150)
}
;(window as unknown as { __specimenDone: boolean }).__specimenDone = true
