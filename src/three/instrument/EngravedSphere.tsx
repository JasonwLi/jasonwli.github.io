/**
 * 'The plate before painting' (I1; theme ENGRAVEDSPHERE, critique 'F0 bug #5
 * placeholder vs theme loading state'). The Suspense fallback of the globe surface:
 *   - a flat --steel-field sphere (r 0.999, writes depth so the route's far side is occluded);
 *   - a 10° graticule in --gilt-worn at ~1 px screen width (fwidth AA, seam-safe at
 *     the antimeridian, meridians stop at ±80° so they do not pile up at the poles);
 *   - the coastline as a ~1 px --silver-3 edge at the zero of the stage-A preview
 *     coast SDF (manifest preview.data .r, encodings.coastSdf.zero) once it arrives;
 *     it never blocks: until then the plate shows the graticule alone.
 * Synchronous: mounting it marks globeState.surfaceReady, so pins, route and limb
 * are live from the first frame (bug #5: no floating pins).
 */
import { useEffect, useLayoutEffect, useMemo } from 'react'
import * as THREE from 'three'
import { tokens } from '../../theme/tokens'
import { globeState } from '../globeState'
import { onTerrainTextures, terrainTextures, type TerrainTextures } from '../terrain/textures'

const vertexShader = /* glsl */ `
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  // GLSL3 ShaderMaterial: three declares no fragment output, so declare it here
  layout(location = 0) out highp vec4 pc_fragColor;
  #define gl_FragColor pc_fragColor
  uniform vec3 cField;
  uniform vec3 cGrat;
  uniform vec3 cCoast;
  uniform sampler2D uCoast;
  uniform float uHasCoast;
  uniform float uCoastZero;
  varying vec3 vLocal;
  const float PI = 3.14159265359;
  const float STEP = 10.0;
  // ~1 px line coverage from a distance measured in pixels
  float line1(float dpx) { return 1.0 - smoothstep(0.0, 1.0, dpx); }
  void main() {
    vec3 n = normalize(vLocal);
    float lat = degrees(asin(clamp(n.y, -1.0, 1.0)));
    float lon = degrees(atan(-n.z, n.x));
    // seam-safe longitude derivative: the same field rotated by 180°
    float lonB = degrees(atan(n.z, -n.x));
    float dLon = min(fwidth(lon), fwidth(lonB));
    float dLat = fwidth(lat);

    float gLat = abs(fract(lat / STEP + 0.5) - 0.5) * STEP / max(dLat, 1e-5);
    float gLon = abs(fract(lon / STEP + 0.5) - 0.5) * STEP / max(dLon, 1e-5);
    float grat = max(line1(gLat), line1(gLon) * (1.0 - smoothstep(78.0, 80.0, abs(lat))));

    vec3 col = mix(cField, cGrat, grat);

    if (uHasCoast > 0.5) {
      // equirect from the direction (R5): u = lon, v = 0.5 − lat/π, row 0 = north
      vec2 uv = vec2(lon / 360.0 + 0.5, 0.5 - lat / 180.0);
      float s = texture(uCoast, uv).r - uCoastZero;
      float dpx = abs(s) / max(fwidth(s), 1e-5);
      col = mix(col, cCoast, line1(dpx));
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export function EngravedSphere() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader,
        fragmentShader,
        uniforms: {
          cField: { value: new THREE.Color(tokens.steelField) },
          cGrat: { value: new THREE.Color(tokens.giltWorn) },
          cCoast: { value: new THREE.Color(tokens.silver3) },
          uCoast: { value: null as THREE.Texture | null },
          uHasCoast: { value: 0 },
          uCoastZero: { value: 0.5 },
        },
      }),
    [],
  )

  useLayoutEffect(() => {
    globeState.surfaceReady = true
  }, [])

  // optional coastline from the stage-A preview data (lossless, RGB, no colour space;
  // R3/R4). The loader's own copy (terrainTextures.preview.data): no second fetch of
  // the manifest or the 312 KB preview competing with stage A (C2a request). The
  // texture belongs to the loader: never dispose it here.
  useEffect(() => {
    const apply = (t: TerrainTextures) => {
      const data = t.preview?.data
      material.uniforms.uCoast.value = data ?? material.uniforms.uCoast.value
      material.uniforms.uHasCoast.value = data ? 1 : 0
    }
    apply(terrainTextures)
    const off = onTerrainTextures(apply)
    return () => {
      off()
      material.dispose()
    }
  }, [material])

  return (
    <mesh renderOrder={-2} material={material} raycast={() => null}>
      <sphereGeometry args={[0.999, 96, 64]} />
    </mesh>
  )
}
export default EngravedSphere
