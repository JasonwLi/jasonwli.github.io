/**
 * The painted Earth (C2b; lazy chunk, default export). Renders inside CameraRig's
 * inner group (globe-local frame, R = 1).
 *
 * Lifecycle (never suspends; the Suspense fallback EngravedSphere covers the chunk load):
 *   mount       equirect sphere showing 'the plate before painting' (steel field, 10 deg
 *               graticule, silver coastline once the preview data lands), surfaceReady
 *   stage A     preview equirects bound; the paint floods in: uPaint 0 -> 1 / 600 ms
 *   LOW         stays on the equirect sphere for good; the LOW set crossfades in at B
 *   MID / HIGH  stage-B cube data bound -> compileAsync -> swap to the cube-sphere
 *               quadtree mesh, uStageMix 0 -> 1 / 350 ms from the preview, relief ramps
 *               0 -> 1 / 400 ms; then releasePreview()
 * Reduced motion: every crossfade is instant. No idle animation anywhere (critique).
 *
 * Per frame (useFrame priority 0, after CameraRig -3 and Instrument -2): uniforms from
 * globeState / globeState.lod, quadtree selection in the globe-local frame.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Matrix4, Mesh, SphereGeometry, Vector2, type Camera, type ShaderMaterial, type Texture } from 'three'
import { globeState, type Tier } from '../globeState'
import { registerDebug } from '../debugHooks'
import { startTerrainLoading, type TerrainLoadingHandle } from './loader'
import { onTerrainTextures, terrainTextures, type TerrainTextures } from './textures'
import { createTerrainEquirectMaterial } from './materials/terrainEquirectMaterial'
import { bindCubeTextures, createTerrainCubeMaterial } from './materials/terrainCubeMaterial'
import { dummy2D } from './materials/dummies'
import { TerrainMesh } from './TerrainMesh'
import { look } from './look'

type EqSet = 'none' | 'preview' | 'low'

interface SurfaceState {
  handle: TerrainLoadingHandle | null
  eqSet: EqSet
  paintOn: boolean
  paint: number
  eqMix: number
  cube: 'none' | 'compiling' | 'ready' | 'shown'
  cubeMix: number
  relief: number
  hasPreviewForCube: boolean
  previewReleased: boolean
  patches: number
}

const mv = new Matrix4()

function setNormalView(mat: ShaderMaterial, camera: Camera, obj: Mesh): void {
  mv.multiplyMatrices(camera.matrixWorldInverse, obj.matrixWorld)
  mat.uniforms.uNormalView.value.getNormalMatrix(mv)
}

function smooth01(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

export function TerrainGlobe({ reducedMotion, tier }: { reducedMotion: boolean; tier: Tier }) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)

  const eq = useMemo(() => {
    const mat = createTerrainEquirectMaterial()
    const mesh = new Mesh(new SphereGeometry(1, 128, 64), mat)
    mesh.renderOrder = -1
    mesh.raycast = () => {}
    mesh.name = 'terrain-equirect'
    mesh.onBeforeRender = (_r, _s, cam) => setNormalView(mat, cam, mesh)
    return { mesh, mat }
  }, [])

  const cube = useMemo(() => {
    const mat = createTerrainCubeMaterial()
    const tm = new TerrainMesh(mat, look.maxPatches)
    tm.mesh.visible = false
    tm.mesh.onBeforeRender = (_r, _s, cam) => setNormalView(mat, cam, tm.mesh)
    return { tm, mat }
  }, [])

  const st = useRef<SurfaceState>({
    handle: null,
    eqSet: 'none',
    paintOn: false,
    paint: 0,
    eqMix: 1,
    cube: 'none',
    cubeMix: 1,
    relief: 0,
    hasPreviewForCube: false,
    previewReleased: false,
    patches: 0,
  })
  const tierRef = useRef(tier)
  tierRef.current = tier
  const rmRef = useRef(reducedMotion)
  rmRef.current = reducedMotion

  // a surface is mounted: pins, route and limb render from the first frame (bug #5)
  useLayoutEffect(() => {
    globeState.surfaceReady = true
  }, [])

  // loader (C2a): one handle per gl + tier; the loader steps tiers down itself
  useEffect(() => {
    const s = st.current
    const h = startTerrainLoading(gl, tier)
    s.handle = h
    return () => {
      if (s.handle === h) s.handle = null
      h.dispose()
    }
  }, [gl, tier])

  // texture registry -> samplers
  useEffect(() => {
    const s = st.current
    const apply = (t: TerrainTextures) => {
      // ---- equirect sphere: preview (stage A, all tiers) then the LOW set
      const want: EqSet = t.albedoEq && t.dataEq ? 'low' : t.preview && !s.previewReleased ? 'preview' : 'none'
      const u = eq.mat.uniforms
      if (want !== s.eqSet) {
        if (s.eqSet !== 'none' && want !== 'none' && s.paint > 0) {
          u.uAlbedo0.value = u.uAlbedo.value
          u.uData0.value = u.uData.value
          s.eqMix = rmRef.current ? 1 : 0
        } else {
          s.eqMix = 1
        }
        const alb: Texture | undefined = want === 'low' ? t.albedoEq : want === 'preview' ? t.preview?.albedo : undefined
        const dat: Texture | undefined = want === 'low' ? t.dataEq : want === 'preview' ? t.preview?.data : undefined
        u.uAlbedo.value = alb ?? dummy2D()
        u.uData.value = dat ?? dummy2D()
        u.uHasTex.value = want === 'none' ? 0 : 1
        s.eqSet = want
        if (want !== 'none') s.paintOn = true
      }
      u.uHasKoppen.value = t.koppenColorEq ? 1 : 0

      // ---- cube path (MID/HIGH)
      const core = bindCubeTextures(cube.mat, t)
      if (core && s.cube === 'none' && tierRef.current !== 'low') {
        s.cube = 'compiling'
        s.hasPreviewForCube = !!t.preview
        const m = cube.tm.mesh
        const wasVisible = m.visible
        m.visible = true // compile() walks visible objects only
        const done = () => {
          if (s.cube === 'compiling') s.cube = 'ready'
        }
        gl.compileAsync(m, camera, scene).then(done, (e: unknown) => {
          console.warn('[terrain] compileAsync failed; swapping without prewarm', e)
          done()
        })
        m.visible = wasVisible
      }
    }
    apply(terrainTextures)
    return onTerrainTextures(apply)
  }, [eq, cube, gl, camera, scene])

  // dispose GPU objects on unmount (loader textures belong to the loader)
  useEffect(
    () => () => {
      eq.mesh.geometry.dispose()
      eq.mat.dispose()
      cube.tm.dispose()
      cube.mat.dispose()
    },
    [eq, cube],
  )

  // debug: frame timing and surface state (?debug=1)
  useEffect(() => {
    registerDebug('surface', () => {
      const s = st.current
      return {
        eqSet: s.eqSet, paint: s.paint, eqMix: s.eqMix, cube: s.cube, cubeMix: s.cubeMix, relief: s.relief,
        patches: s.patches, previewReleased: s.previewReleased, tier: tierRef.current,
        showing: cube.tm.mesh.visible ? 'cube' : 'equirect',
      }
    })
    registerDebug('surfaceBench', (n = 60) => {
      const ctx = gl.getContext()
      const px = new Uint8Array(4)
      const run = () => {
        gl.render(scene, camera)
        ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px)
      }
      for (let i = 0; i < 5; i++) run()
      const t0 = performance.now()
      for (let i = 0; i < n; i++) run()
      const all = (performance.now() - t0) / n
      const vis = [eq.mesh.visible, cube.tm.mesh.visible]
      eq.mesh.visible = false
      cube.tm.mesh.visible = false
      for (let i = 0; i < 3; i++) run()
      const t1 = performance.now()
      for (let i = 0; i < n; i++) run()
      const rest = (performance.now() - t1) / n
      eq.mesh.visible = vis[0]
      cube.tm.mesh.visible = vis[1]
      const db = gl.getDrawingBufferSize(new Vector2())
      return { msPerFrame: all, msWithoutSurface: rest, surfaceMs: all - rest, patches: st.current.patches, buffer: [db.x, db.y] }
    })
  }, [gl, scene, camera, eq, cube])

  useFrame((state, delta) => {
    const s = st.current
    const g = globeState
    const lod = g.lod
    const rm = rmRef.current
    const dtMs = Math.min(delta, 0.1) * 1000

    // ---- animations (event-driven crossfades only)
    if (s.paintOn && s.paint < 1) s.paint = rm ? 1 : Math.min(1, s.paint + dtMs / look.paintMs)
    if (s.eqMix < 1) {
      s.eqMix = rm ? 1 : Math.min(1, s.eqMix + dtMs / look.stageMs)
      if (s.eqMix >= 1) {
        eq.mat.uniforms.uAlbedo0.value = dummy2D()
        eq.mat.uniforms.uData0.value = dummy2D()
      }
    }
    if (s.cube === 'ready' && s.paint >= 1) {
      s.cube = 'shown'
      s.cubeMix = rm || !s.hasPreviewForCube ? 1 : 0
      s.relief = rm ? 1 : 0
    }
    if (s.cube === 'shown') {
      if (s.cubeMix < 1) s.cubeMix = Math.min(1, s.cubeMix + dtMs / look.stageMs)
      if (s.relief < 1) s.relief = rm ? 1 : Math.min(1, s.relief + dtMs / look.reliefRampMs)
      if (s.cubeMix >= 1 && !s.previewReleased) {
        s.previewReleased = true
        cube.mat.uniforms.uPrevAlbedo.value = dummy2D()
        if (s.eqSet === 'preview') {
          const u = eq.mat.uniforms
          u.uAlbedo.value = u.uData.value = u.uAlbedo0.value = u.uData0.value = dummy2D()
          u.uHasTex.value = 0
          s.eqSet = 'none'
        }
        s.handle?.releasePreview()
      }
    }

    // a downgrade to LOW hands the surface back to the equirect once its set is bound
    const showCube = s.cube === 'shown' && !(tierRef.current === 'low' && s.eqSet === 'low')
    cube.tm.mesh.visible = showCube
    eq.mesh.visible = !showCube

    // ---- shared uniforms
    const zoomT = smooth01(Math.log(900), Math.log(12000), Math.log(Math.max(lod.viewKm, 1)))
    if (showCube) {
      const u = cube.mat.uniforms
      u.uStageMix.value = s.cubeMix
      u.uReliefStrength.value = look.reliefStrength * s.relief
      u.uReliefExag.value = look.reliefExag.near + (look.reliefExag.far - look.reliefExag.near) * zoomT
      u.uHeightScale.value = lod.heightScale
      u.uDetailFade.value = lod.detailFade
      u.uWaveFade.value = lod.waveFade
      u.uRiverAlpha.value =
        look.riverAlpha * smooth01(look.riverFadeKm[0], look.riverFadeKm[1], lod.viewKm) * smooth01(look.riverOutKm[1], look.riverOutKm[0], lod.viewKm)
      u.uSeason.value = g.season
      u.uModeMix.value = g.modeMix
      u.uDim.value = g.dim
      const parent = cube.tm.mesh.parent
      if (parent) {
        const hi = tierRef.current === 'high'
        s.patches = cube.tm.update(state.camera, parent, state.size.height, {
          patchPx: hi ? look.patchPx.high : look.patchPx.mid,
          maxLevel: hi ? look.maxLevel.high : look.maxLevel.mid,
          maxLift: lod.heightScale * 9000,
        })
      }
    } else {
      const u = eq.mat.uniforms
      u.uPaint.value = s.paint
      u.uStageMix.value = s.eqMix
      u.uWaveFade.value = lod.waveFade
      u.uSeason.value = g.season
      u.uModeMix.value = g.modeMix
      u.uDim.value = g.dim
    }
  })

  return (
    <>
      <primitive object={eq.mesh} />
      <primitive object={cube.tm.mesh} />
    </>
  )
}

export default TerrainGlobe
