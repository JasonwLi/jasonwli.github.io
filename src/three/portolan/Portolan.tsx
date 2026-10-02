/**
 * Portolan ocean marks: engraved wind roses with faint rhumb lines painted on the open
 * ocean, as on a 14th-16th-century portolan chart. Kept sparse: one rose per great ocean
 * (five on the whole globe; the Mediterranean, the portolan's home, is left out by
 * restraint: it is full of route legs, places and names). Static (no animation).
 *
 * Positions (chosen offline: >= 1550 km from any coast in the ETOPO land mask, >= 1250 km
 * from every route leg, >= 1780 km from every ocean / sea name; then checked on the globe):
 *   North Atlantic 16N 40W, South Atlantic 10S 19W, Indian 12S 80E, North Pacific 27N 180,
 *   South Pacific 8S 128W.
 *
 * Each rose is 600 km in radius, lying on the sea (it curves with the globe and is hidden
 * past the horizon); its 32 rhumbs reach ~3000 km and fade with distance. Drawn
 * analytically (portolan/material.ts) on one instanced spherical cap per rose: one draw
 * call, no texture beyond a small CSS-px obstacle grid the CPU stamps each frame (map and
 * place names, pins, the active pin, towns, monuments, glyphs, ships, the readout and the
 * drawn route legs near a rose) under which the rhumbs fade (the rose itself fades by 65%).
 * The roses publish their screen discs (screenObstacles.roseMarks): the cloud wisps keep off.
 *
 * Visibility: the travel section only (travelIn 0.35 -> 0.5; none in the hero, work or
 * contact: faded with the section dim), from the wide view down to ~1500 km (out over
 * 2300 -> 1500 km), gone in climate mode (modeMix 0 -> 0.5). Mid / high tiers only (null on
 * low). renderOrder 2: over the terrain (-1), under the rivers (5), route (20+), glyphs,
 * towns, ships, names and pins.
 *
 * Debug (?debug=1): __globe.portolan() → roses on screen (centre px, radius px), alpha and
 * mask stats; __globe.portolanMask(on) tints the obstacle grid red; __globe.portolanBench(n) → ms/frame with and without the layer; ?portolan=0
 * disables.
 */
import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { Tier } from '../globeState'
import { globeState } from '../globeState'
import { sceneRefs } from '../sceneRefs'
import { registerDebug } from '../debugHooks'
import { EARTH_KM } from '../geo/radii'
import { terrainTextures, onTerrainTextures } from '../terrain/textures'
import {
  GLYPH_BOX_PX, drawnRoute, glyphBoxes, mapLabelRects, monumentBoxes, readoutBox, roseMarks, shipMarks, townBoxes,
} from '../instrument/screenObstacles'
import { placeRects } from '../labels/declutter'
import { CAP_RAD, makePortolanGeometry, makePortolanMaterial } from './material'

const DEG = Math.PI / 180

/** [lat, lon, name] */
const ROSES: [number, number, string][] = [
  [16, -40, 'north-atlantic'],
  [-10, -19, 'south-atlantic'],
  [-12, 80, 'indian'],
  [27, 180, 'north-pacific'],
  [-8, -128, 'south-pacific'],
]
const ROSE_KM = 600
const ZOOM_OUT: [number, number] = [1500, 2300] // none below 1500 km, full above 2300
const ROSE_ALPHA = 0.5
const RHUMB_ALPHA = 0.36

// the obstacle grid
const CELL = 4
const PAD_PX = 6
const PIN_R_PX = 11
const ACTIVE_R_PX = 18
const ROUTE_R_PX = 5

const disabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('portolan') === '0'
const smooth = THREE.MathUtils.smoothstep

function dirOf(lat: number, lon: number, out: THREE.Vector3): THREE.Vector3 {
  const la = lat * DEG, lo = lon * DEG
  return out.set(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo))
}

/** the obstacle grid texture (a new one per size: texture storage is immutable) */
function makeMask(data: Uint8Array, w: number, h: number): THREE.DataTexture {
  const t = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.UnsignedByteType)
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearFilter
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  t.unpackAlignment = 1
  t.generateMipmaps = false
  t.needsUpdate = true
  return t
}

export function Portolan({ tier }: { tier: Tier }) {
  const size = useThree((s) => s.size)
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  const parts = useMemo(() => {
    const geo = makePortolanGeometry(ROSES.length)
    const centres: THREE.Vector3[] = []
    const E = new THREE.Vector3(), N = new THREE.Vector3()
    ROSES.forEach(([lat, lon], i) => {
      const c = dirOf(lat, lon, new THREE.Vector3())
      centres.push(c)
      // east = Y x c, north = c x east (terrain tangentFrame)
      E.set(c.z, 0, -c.x).normalize()
      N.crossVectors(c, E).normalize()
      geo.iC.setXYZ(i, c.x, c.y, c.z)
      geo.iE.setXYZ(i, E.x, E.y, E.z)
      geo.iN.setXYZ(i, N.x, N.y, N.z)
      geo.iR.setX(i, ROSE_KM / EARTH_KM)
    })
    const maskData = new Uint8Array(1)
    const mask = makeMask(maskData, 1, 1)
    const material = makePortolanMaterial(mask)
    material.uniforms.uRoseAlpha.value = ROSE_ALPHA
    material.uniforms.uRhumbAlpha.value = RHUMB_ALPHA
    const mesh = new THREE.Mesh(geo.geometry, material)
    mesh.frustumCulled = false
    mesh.raycast = () => {}
    mesh.renderOrder = 2
    mesh.visible = false
    mesh.name = 'portolan'
    return {
      geo, material, mesh, centres, mask, maskData, mw: 1, mh: 1, alpha: 0, ready: 0,
      cosNear: Math.cos(CAP_RAD + 0.05),
      stats: { alpha: 0, stamped: 0, routeSegs: 0, cpuMs: 0, roses: [] as { name: string; x: number; y: number; rPx: number; facing: number }[] },
    }
  }, [])

  // the coast SDF lives in the terrain cube (stage B on)
  useEffect(() => {
    const bind = () => {
      const t = terrainTextures.terrain
      parts.material.uniforms.uTerrain.value = t ?? null
      parts.material.uniforms.uHasTerrain.value = t ? 1 : 0
    }
    bind()
    return onTerrainTextures(bind)
  }, [parts])

  useEffect(
    () => () => {
      parts.geo.geometry.dispose()
      parts.material.dispose()
      parts.mask.dispose()
    },
    [parts],
  )

  const tmp = useMemo(
    () => ({ m: new THREE.Matrix4(), v: new THREE.Vector4(), cam: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3() }),
    [],
  )

  useEffect(() => {
    registerDebug('portolan', () => {
      const { stats } = parts
      return { tier, ...stats, alpha: +stats.alpha.toFixed(3), cpuMs: +stats.cpuMs.toFixed(3), mask: [parts.mw, parts.mh] }
    })
    registerDebug('portolanMask', (on: boolean) => {
      parts.material.uniforms.uDebugMask.value = on ? 1 : 0
      return on
    })
    registerDebug('portolanBench', (n = 60) => {
      const ctx = gl.getContext()
      const px = new Uint8Array(4)
      const run = () => {
        gl.render(scene, camera)
        ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px)
      }
      const was = parts.mesh.visible
      const time = (on: boolean, k: number) => {
        parts.mesh.visible = on && was
        run()
        const t = performance.now()
        for (let i = 0; i < k; i++) run()
        return (performance.now() - t) / k
      }
      for (let i = 0; i < 10; i++) run()
      const rounds = 7
      const k = Math.max(4, Math.round(n / rounds))
      const on: number[] = []
      const off: number[] = []
      for (let r = 0; r < rounds; r++) {
        on.push(time(true, k))
        off.push(time(false, k))
      }
      parts.mesh.visible = was
      const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1]
      return {
        visible: was, msWith: +med(on).toFixed(3), msWithout: +med(off).toFixed(3),
        portolanMs: +med(on.map((v, i) => v - off[i])).toFixed(3), cpuMs: +parts.stats.cpuMs.toFixed(3),
      }
    })
  }, [parts, gl, scene, camera, tier])

  useFrame((_, rawDt) => {
    const g = globeState
    const p = parts
    const { mesh, material, stats } = p
    const inner = sceneRefs.inner
    const dt = Math.max(0, Math.min(rawDt, 0.1))
    const surface = g.surfaceReady && (g.stage === 'B' || g.stage === 'C' || g.stage === 'D') && !!terrainTextures.terrain
    const readyT = !disabled && tier !== 'low' && surface ? 1 : 0
    p.ready = readyT > p.ready ? Math.min(readyT, p.ready + dt / 0.6) : Math.max(readyT, p.ready - dt / 0.6)
    const section = p.ready * smooth(g.travelIn, 0.35, 0.5) * (1 - smooth(g.dim, 0.12, 0.35))
    const zoom = smooth(g.lod.viewKm, ZOOM_OUT[0], ZOOM_OUT[1])
    const mode = 1 - smooth(g.modeMix, 0, 0.5)
    const alpha = section * zoom * mode
    stats.alpha = alpha
    if (!inner || alpha < 0.003) {
      mesh.visible = false
      stats.roses.length = 0
      roseMarks.length = 0
      return
    }
    const t0 = performance.now()
    mesh.visible = true
    const W = size.width, H = size.height
    const u = material.uniforms
    u.uAlpha.value = alpha
    u.uViewport.value.set(W, H)
    u.uPxRatio.value = gl.getPixelRatio()

    // globe-local camera and the local -> clip transform
    inner.updateWorldMatrix(true, false)
    camera.updateMatrixWorld()
    const cam = tmp.cam.setFromMatrixPosition(camera.matrixWorld)
    inner.worldToLocal(cam)
    u.uCamLocal.value.copy(cam)
    const M = tmp.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(inner.matrixWorld)
    const me = M.elements
    const proj = (x: number, y: number, z: number, out: number[]): boolean => {
      const cw = me[3] * x + me[7] * y + me[11] * z + me[15]
      if (cw <= 1e-6) return false
      out[0] = ((me[0] * x + me[4] * y + me[8] * z + me[12]) / cw * 0.5 + 0.5) * W
      out[1] = (0.5 - (me[1] * x + me[5] * y + me[9] * z + me[13]) / cw * 0.5) * H
      return true
    }

    // ——— the obstacle grid ———
    const mw = Math.max(1, Math.ceil(W / CELL)), mh = Math.max(1, Math.ceil(H / CELL))
    if (mw !== p.mw || mh !== p.mh) {
      p.mw = mw
      p.mh = mh
      p.maskData = new Uint8Array(mw * mh)
      p.mask.dispose()
      p.mask = makeMask(p.maskData, mw, mh)
      u.uMask.value = p.mask
      u.uMaskSize.value.set(mw, mh)
      u.uMaskCell.value = CELL
    }
    const data = p.maskData
    data.fill(0)
    let stamped = 0
    const rect = (x0: number, y0: number, x1: number, y1: number, pad: number) => {
      const i0 = Math.max(0, Math.floor((x0 - pad) / CELL)), i1 = Math.min(mw - 1, Math.floor((x1 + pad) / CELL))
      const j0 = Math.max(0, Math.floor((y0 - pad) / CELL)), j1 = Math.min(mh - 1, Math.floor((y1 + pad) / CELL))
      if (i1 < i0 || j1 < j0) return
      stamped++
      for (let j = j0; j <= j1; j++) data.fill(255, j * mw + i0, j * mw + i1 + 1)
    }
    const disc = (x: number, y: number, r: number) => {
      const i0 = Math.max(0, Math.floor((x - r) / CELL)), i1 = Math.min(mw - 1, Math.floor((x + r) / CELL))
      const j0 = Math.max(0, Math.floor((y - r) / CELL)), j1 = Math.min(mh - 1, Math.floor((y + r) / CELL))
      if (i1 < i0 || j1 < j0) return
      stamped++
      const r2 = (r + CELL * 0.5) * (r + CELL * 0.5)
      for (let j = j0; j <= j1; j++) {
        const cy = (j + 0.5) * CELL - y
        for (let i = i0; i <= i1; i++) {
          const cx = (i + 0.5) * CELL - x
          if (cx * cx + cy * cy <= r2) data[j * mw + i] = 255
        }
      }
    }
    for (let j = 0; j + 3 < mapLabelRects.length; j += 4) rect(mapLabelRects[j], mapLabelRects[j + 1], mapLabelRects[j + 2], mapLabelRects[j + 3], PAD_PX)
    for (const r of placeRects) rect(r.x0, r.y0, r.x1, r.y1, PAD_PX)
    for (let j = 0; j + 3 < townBoxes.length; j += 4) rect(townBoxes[j], townBoxes[j + 1], townBoxes[j + 2], townBoxes[j + 3], PAD_PX)
    for (let j = 0; j + 3 < monumentBoxes.length; j += 4) rect(monumentBoxes[j], monumentBoxes[j + 1], monumentBoxes[j + 2], monumentBoxes[j + 3], PAD_PX)
    const gh = GLYPH_BOX_PX / 2
    for (let j = 0; j + 1 < glyphBoxes.length; j += 2) rect(glyphBoxes[j] - gh, glyphBoxes[j + 1] - gh, glyphBoxes[j] + gh, glyphBoxes[j + 1] + gh, PAD_PX)
    for (let j = 0; j + 2 < shipMarks.length; j += 3) disc(shipMarks[j], shipMarks[j + 1], shipMarks[j + 2] + PAD_PX)
    const pins = g.pinsPx
    for (let j = 0; j + 3 < pins.length; j += 4) if (pins[j + 2] > 0.2) disc(pins[j], pins[j + 1], PIN_R_PX)
    if (g.anchors.activeIndex >= 0 && g.anchors.activePx) disc(g.anchors.activePx[0], g.anchors.activePx[1], ACTIVE_R_PX)
    if (readoutBox.on) rect(readoutBox.x0, readoutBox.y0, readoutBox.x1, readoutBox.y1, PAD_PX)
    // the drawn route legs, only the segments near a rose
    let routeSegs = 0
    if (drawnRoute.opacity > 0.02) {
      const sa = [0, 0], sb = [0, 0]
      const cs = p.centres, cn = p.cosNear
      for (const part of drawnRoute.parts) {
        const pos = part.pos, fade = part.fade
        for (let s = 0; s < part.count; s++) {
          if (fade[2 * s] < 0.05 && fade[2 * s + 1] < 0.05) continue
          const o = 6 * s
          const ax = pos[o], ay = pos[o + 1], az = pos[o + 2]
          let near = false
          for (const c of cs) {
            if ((ax * c.x + ay * c.y + az * c.z) > cn) {
              near = true
              break
            }
          }
          // the near side only
          if (!near || ax * cam.x + ay * cam.y + az * cam.z < 1) continue
          if (!proj(ax, ay, az, sa) || !proj(pos[o + 3], pos[o + 4], pos[o + 5], sb)) continue
          routeSegs++
          const len = Math.hypot(sb[0] - sa[0], sb[1] - sa[1])
          const steps = Math.min(400, Math.max(1, Math.ceil(len / CELL)))
          for (let k = 0; k <= steps; k++) {
            const t = k / steps
            disc(sa[0] + (sb[0] - sa[0]) * t, sa[1] + (sb[1] - sa[1]) * t, ROUTE_R_PX)
          }
        }
      }
    }
    p.mask.needsUpdate = true
    stats.stamped = stamped
    stats.routeSegs = routeSegs

    // where the roses are (the cloud wisps keep off them; debug)
    stats.roses.length = 0
    roseMarks.length = 0
    const sc = [0, 0]
    for (let i = 0; i < p.centres.length; i++) {
      const c = p.centres[i]
      tmp.a.copy(cam).sub(c).normalize()
      const facing = tmp.a.dot(c)
      if (facing < 0 || !proj(c.x, c.y, c.z, sc)) continue
      // radius: project a point ROSE_KM north of the centre
      const e = ROSE_KM / EARTH_KM
      tmp.b.set(-c.x * c.y, 1 - c.y * c.y, -c.z * c.y).normalize().multiplyScalar(Math.sin(e)).addScaledVector(c, Math.cos(e))
      const sb = [0, 0]
      proj(tmp.b.x, tmp.b.y, tmp.b.z, sb)
      const rPx = Math.hypot(sb[0] - sc[0], sb[1] - sc[1])
      if (facing > 0.15 && alpha > 0.05) roseMarks.push(sc[0], sc[1], rPx * 1.3)
      stats.roses.push({ name: ROSES[i][2], x: Math.round(sc[0]), y: Math.round(sc[1]), rPx: +rPx.toFixed(1), facing: +facing.toFixed(2) })
    }
    stats.cpuMs = stats.cpuMs * 0.9 + (performance.now() - t0) * 0.1
  })

  if (tier === 'low' || disabled) return null
  return <primitive object={parts.mesh} />
}

export default Portolan
