import { forwardRef, useRef } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import { globeState } from './globeState'

const TEX = (name: string) => `${import.meta.env.BASE_URL}textures/${name}`

interface GlobeStyle {
  ocean: string
  oceanDeep: string
  shallow: string
  land: string
  landShade: string
  pole: string
  poleMix: number
  coast: string
  coastMix: number
  border: string
  borderMix: number
  rim: string
}

const STYLES: Record<string, GlobeStyle> = {
  // refined gilded atlas: sand land, ink ocean, luminous coasts, sand borders
  sand: {
    ocean: '#16233c', oceanDeep: '#0e1729', shallow: '#2e4d72',
    land: '#d3b67f', landShade: '#a98f5c', pole: '#e8dcc0', poleMix: 0.4,
    coast: '#f6e5b4', coastMix: 0.5, border: '#8f7a4e', borderMix: 0.5,
    rim: '#5c86bd',
  },
  // night chart: near-invisible land fill, everything drawn in glowing lines
  night: {
    ocean: '#0d1526', oceanDeep: '#0a101d', shallow: '#1d3050',
    land: '#1c2942', landShade: '#141e33', pole: '#243453', poleMix: 0.3,
    coast: '#ffd98f', coastMix: 0.85, border: '#5b6f96', borderMix: 0.55,
    rim: '#4a76b0',
  },
  // paper globe: cream land, deep teal sea, dark ink linework
  paper: {
    ocean: '#1c3d4a', oceanDeep: '#142d38', shallow: '#2b5666',
    land: '#e9ddc0', landShade: '#cbbc96', pole: '#f4ecd9', poleMix: 0.5,
    coast: '#3a3428', coastMix: 0.55, border: '#57503f', borderMix: 0.5,
    rim: '#4f7f95',
  },
  // naturalist: moss-to-tan land by latitude, snowy poles, deep blue sea
  moss: {
    ocean: '#14263e', oceanDeep: '#0d1a2c', shallow: '#2b4d6e',
    land: '#7d8f5e', landShade: '#c8b078', pole: '#e6ebe8', poleMix: 0.85,
    coast: '#d9e3b8', coastMix: 0.35, border: '#4e5a3c', borderMix: 0.45,
    rim: '#5c86bd',
  },
}

function activeStyle(): GlobeStyle {
  const key = new URLSearchParams(window.location.search).get('gstyle') ?? 'night'
  return STYLES[key] ?? STYLES.night
}

/**
 * Our own Earth: geographically accurate landmasses from a rasterized
 * world-atlas mask, everything else drawn in the site's own ink —
 * atlas-blue ocean, shallow-water coastal glow, sand continents with
 * paper grain, a faint etched graticule, soft sun shading.
 */
const Earth = forwardRef<THREE.Mesh>(function Earth(_, ref) {
  const matRef = useRef<THREE.ShaderMaterial>(null)
  const mask = useLoader(THREE.TextureLoader, TEX('land_mask_4096.png'))
  mask.anisotropy = 8
  // no mipmaps: at the polar pinch they smear the Arctic into a half-land band
  // that the coast-stroke detector renders as giant rings
  mask.generateMipmaps = false
  mask.minFilter = THREE.LinearFilter

  useFrame(({ clock }) => {
    const m = matRef.current
    if (!m) return
    m.uniforms.uTime.value = clock.elapsedTime
    m.uniforms.uDim.value = globeState.dim
  })

  const style = activeStyle()

  return (
    <mesh ref={ref} renderOrder={-1}>
      <sphereGeometry args={[0.998, 96, 96]} />
      <shaderMaterial
        ref={matRef}
        uniforms={{
          uMask: { value: mask },
          uTime: { value: 0 },
          uDim: { value: 0 },
          uOcean: { value: new THREE.Color(style.ocean) },
          uOceanDeep: { value: new THREE.Color(style.oceanDeep) },
          uShallow: { value: new THREE.Color(style.shallow) },
          uLand: { value: new THREE.Color(style.land) },
          uLandShade: { value: new THREE.Color(style.landShade) },
          uPole: { value: new THREE.Color(style.pole) },
          uPoleMix: { value: style.poleMix },
          uCoast: { value: new THREE.Color(style.coast) },
          uCoastMix: { value: style.coastMix },
          uBorder: { value: new THREE.Color(style.border) },
          uBorderMix: { value: style.borderMix },
          uRim: { value: new THREE.Color(style.rim) },
          uLightDir: { value: new THREE.Vector3(-0.55, 0.4, 0.74).normalize() },
        }}
        vertexShader={/* glsl */ `
          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vView;
          void main() {
            vUv = uv;
            vNormal = normalize(normalMatrix * normal);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vView = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }
        `}
        fragmentShader={/* glsl */ `
          uniform sampler2D uMask;
          uniform float uTime;
          uniform float uDim;
          uniform vec3 uOcean;
          uniform vec3 uOceanDeep;
          uniform vec3 uShallow;
          uniform vec3 uLand;
          uniform vec3 uLandShade;
          uniform vec3 uPole;
          uniform float uPoleMix;
          uniform vec3 uCoast;
          uniform float uCoastMix;
          uniform vec3 uBorder;
          uniform float uBorderMix;
          uniform vec3 uRim;
          uniform vec3 uLightDir;
          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vView;

          float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
          }

          void main() {
            float m = texture2D(uMask, vUv).r;
            float land = smoothstep(0.42, 0.58, m);

            // shallow-water shelf: how close the ocean pixel is to any coast
            float d = 0.0016;
            float near = m;
            near = max(near, texture2D(uMask, vUv + vec2( d, 0.0)).r);
            near = max(near, texture2D(uMask, vUv + vec2(-d, 0.0)).r);
            near = max(near, texture2D(uMask, vUv + vec2(0.0,  d)).r);
            near = max(near, texture2D(uMask, vUv + vec2(0.0, -d)).r);
            near = max(near, texture2D(uMask, vUv + vec2( d,  d)).r);
            near = max(near, texture2D(uMask, vUv + vec2(-d, -d)).r);
            float shelf = clamp(near - m, 0.0, 1.0);

            // ocean: deep ink with a slow, very subtle current shimmer
            float swirl = sin(vUv.x * 40.0 + uTime * 0.12) * sin(vUv.y * 34.0 - uTime * 0.09);
            vec3 ocean = mix(uOceanDeep, uOcean, 0.62 + 0.38 * swirl * 0.14 + vUv.y * 0.12);
            ocean = mix(ocean, uShallow, shelf * 0.55 * (1.0 - smoothstep(0.9, 0.975, abs(vUv.y - 0.5) * 2.0)));

            // land: base tone with paper grain, latitude shading, polar caps
            float grain = hash(floor(vUv * 900.0)) * 0.5 + hash(floor(vUv * 220.0)) * 0.5;
            float lat = abs(vUv.y - 0.5) * 2.0;
            vec3 landCol = mix(uLand, uLandShade, 0.18 + grain * 0.14 + lat * lat * 0.25);
            landCol = mix(landCol, uPole, smoothstep(0.7, 0.94, lat) * uPoleMix);

            // coastline stroke where the antialiased mask transitions;
            // strokes fade beyond the polar circles where the projection
            // pinches coastlines into ring artifacts
            float edge = 1.0 - smoothstep(0.0, 0.42, abs(m - 0.5));
            float strokeFade = 1.0 - smoothstep(0.9, 0.975, lat);

            vec3 col = mix(ocean, landCol, land);
            col = mix(col, uCoast, edge * uCoastMix * strokeFade);

            // internal country borders, on land only
            float border = texture2D(uMask, vUv).g;
            col = mix(col, uBorder, border * uBorderMix * land * strokeFade);

            // etched graticule, every 15°, fainter over land, fading at the poles
            vec2 g = abs(fract(vUv * vec2(24.0, 12.0)) - 0.5);
            float gline = 1.0 - smoothstep(0.0, 0.02, min(g.x, g.y));
            float polar = sin(vUv.y * 3.14159);
            col += vec3(0.9, 0.95, 1.0) * gline * 0.022 * (1.0 - land * 0.6) * polar * polar;

            // soft sun + cool rim
            float lambert = dot(vNormal, normalize(uLightDir)) * 0.5 + 0.5;
            col *= mix(0.52, 1.12, lambert);
            float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 3.0);
            col += uRim * fres * 0.35;

            col *= 1.0 - uDim * 0.78;
            gl_FragColor = vec4(col, 1.0);
          }
        `}
      />
    </mesh>
  )
})

function Atmosphere() {
  const matRef = useRef<THREE.ShaderMaterial>(null)
  useFrame(() => {
    if (matRef.current) matRef.current.uniforms.uDim.value = globeState.dim
  })
  return (
    <mesh>
      <sphereGeometry args={[1.13, 48, 48]} />
      <shaderMaterial
        ref={matRef}
        transparent
        depthWrite={false}
        side={THREE.BackSide}
        blending={THREE.AdditiveBlending}
        uniforms={{
          uDim: { value: 0 },
          uColor: { value: new THREE.Color('#4a86c8').multiplyScalar(0.3) },
        }}
        vertexShader={/* glsl */ `
          varying vec3 vNormal;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={/* glsl */ `
          uniform vec3 uColor;
          uniform float uDim;
          varying vec3 vNormal;
          void main() {
            float glow = pow(0.68 - dot(vNormal, vec3(0.0, 0.0, -1.0)), 4.0);
            gl_FragColor = vec4(uColor * glow * (1.0 - uDim * 0.85), 1.0);
          }
        `}
      />
    </mesh>
  )
}

export const Globe = forwardRef<THREE.Mesh>(function Globe(_, earthRef) {
  return (
    <>
      <Earth ref={earthRef} />
      <Atmosphere />
    </>
  )
})
