import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { locations } from '../data/travel'
import { useSite } from '../state/store'
import { latLonToVec3 } from './globeMath'
import { globeState } from './globeState'

export const PING_RADIUS = 1.018

export function Pings({ reducedMotion }: { reducedMotion: boolean }) {
  const visRef = useRef<THREE.InstancedMesh>(null)
  const matRef = useRef<THREE.ShaderMaterial>(null)

  const { phases, indices, scales, alphas } = useMemo(() => {
    const n = locations.length
    const phases = new Float32Array(n)
    const indices = new Float32Array(n)
    const scales = new Float32Array(n)
    const alphas = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      phases[i] = (i * 0.37) % 1
      indices[i] = i
      scales[i] = 0.023 + Math.min(locations[i].photos.length, 5) * 0.0016
      // photo-less places burn a little lower
      alphas[i] = locations[i].photos.length ? 1 : 0.5
    }
    return { phases, indices, scales, alphas }
  }, [])

  useEffect(() => {
    const dummy = new THREE.Object3D()
    const mesh = visRef.current
    if (!mesh) return
    locations.forEach((loc, i) => {
      dummy.position.copy(latLonToVec3(loc.lat, loc.lon, PING_RADIUS))
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  }, [])

  useFrame(({ clock }) => {
    const m = matRef.current
    if (!m) return
    if (!reducedMotion) m.uniforms.uTime.value = clock.elapsedTime
    m.uniforms.uMotion.value = reducedMotion ? 0 : 1
    m.uniforms.uDim.value = globeState.dim
    const { active, hovered } = useSite.getState()
    m.uniforms.uSelected.value = active ? locations.indexOf(active) : -1
    m.uniforms.uHovered.value = hovered ? locations.indexOf(hovered) : -1
  })

  if (locations.length === 0) return null

  return (
    <group>
      {/* visible billboarded pulse quads; picking happens in the Rig via screen-space projection */}
      <instancedMesh ref={visRef} args={[undefined, undefined, locations.length]} raycast={() => null}>
        <planeGeometry args={[1, 1]}>
          <instancedBufferAttribute attach="attributes-aPhase" args={[phases, 1]} />
          <instancedBufferAttribute attach="attributes-aIndex" args={[indices, 1]} />
          <instancedBufferAttribute attach="attributes-aScale" args={[scales, 1]} />
          <instancedBufferAttribute attach="attributes-aAlpha" args={[alphas, 1]} />
        </planeGeometry>
        <shaderMaterial
          ref={matRef}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          uniforms={{
            uTime: { value: 0 },
            uMotion: { value: 1 },
            uDim: { value: 0 },
            uSelected: { value: -1 },
            uHovered: { value: -1 },
            uEmber: { value: new THREE.Color('#ff5f3c') },
            uBrass: { value: new THREE.Color('#ffefdb') },
          }}
          vertexShader={/* glsl */ `
            attribute float aPhase;
            attribute float aIndex;
            attribute float aScale;
            attribute float aAlpha;
            uniform float uSelected;
            uniform float uHovered;
            varying vec2 vUv;
            varying float vPhase;
            varying float vSel;
            varying float vAlpha;
            void main() {
              vUv = uv;
              vPhase = aPhase;
              vAlpha = aAlpha;
              vSel = aIndex == uSelected ? 1.0 : (aIndex == uHovered ? 0.55 : 0.0);
              vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
              float size = aScale * (1.0 + vSel * 0.9);
              mv.xy += (position.xy) * size * 2.6;
              gl_Position = projectionMatrix * mv;
            }
          `}
          fragmentShader={/* glsl */ `
            uniform float uTime;
            uniform float uMotion;
            uniform float uDim;
            uniform vec3 uEmber;
            uniform vec3 uBrass;
            varying vec2 vUv;
            varying float vPhase;
            varying float vSel;
            varying float vAlpha;
            void main() {
              float r = length(vUv - 0.5) * 2.0;
              float core = smoothstep(0.26, 0.04, r);
              float ringT = fract(uTime * 0.42 + vPhase);
              float ring = smoothstep(0.07, 0.0, abs(r - ringT * 0.92)) * pow(1.0 - ringT, 1.8) * uMotion;
              vec3 col = mix(uEmber, uBrass, vSel);
              float a = (core + ring * 0.38) * (1.0 - uDim * 0.85) * vAlpha;
              if (a < 0.012) discard;
              gl_FragColor = vec4(col, a);
            }
          `}
        />
      </instancedMesh>
    </group>
  )
}
