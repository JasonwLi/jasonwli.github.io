/**
 * Painted water (C2b). Steel-family ramp shelf -> deep -> abyss on the bathymetry,
 * painterly bands every uBandStepM near the shelves, a painted light line just
 * offshore at every zoom, and at close zoom a STATIC surf band + wave pattern (a pure
 * spatial pattern: no uTime, critique). No glint, no specular.
 */
export const waterGLSL = /* glsl */ `
uniform vec3 cShelf;
uniform vec3 cDeep;
uniform vec3 cAbyss;
uniform vec3 cCoastLine;
uniform vec3 cFoam;
uniform float uBandStepM;
uniform float uBandAmount;
uniform float uCoastLineKm;
uniform float uCoastLinePx;
uniform float uCoastLineAlpha;
uniform float uFoamWidthKm;
uniform float uFoamAlpha;
uniform float uWaveAmount;
uniform float uWaveFade;

// g: bathy channel (sqrt(depth/11000)); seaKm: distance offshore (km, > 0 at sea)
vec3 seaColor(float g, float seaKm, float coastPx, float kmPerPx, vec3 d) {
  float depth = g * g * 11000.0;
  // painterly bands near the shelf: quantise, then soften the step
  float q = depth / uBandStepM;
  float fq = fract(q);
  float banded = (floor(q) + smoothstep(0.65, 1.0, fq)) * uBandStepM;
  float bandW = uBandAmount * (1.0 - smoothstep(300.0, 1500.0, depth));
  float dB = mix(depth, banded, bandW);
  float x = sqrt(dB / 11000.0);
  vec3 col = mix(cShelf, cDeep, smoothstep(0.08, 0.40, x));
  col = mix(col, cAbyss, smoothstep(0.55, 0.80, x));

  // static waves (close zoom): a fixed sum-of-sines along noise-rotated directions
  if (uWaveFade > 0.001) {
    // three fixed world directions (a phase that depends on a varying angle would
    // shimmer at p ~ 6371 km), weighted by a slow noise so crests turn region to region
    vec3 p = d * EARTH_KM; // km; dot(p, v) is a planar wave in the local tangent plane
    float m = vnoise(p * (1.0 / 60.0));
    float w = sin(dot(p, vec3(0.80, 0.36, 0.48)) * 2.1) * (1.0 - m)
            + sin(dot(p, vec3(-0.42, 0.55, 0.72)) * 1.6 + 1.7) * m
            + sin(dot(p, vec3(0.30, -0.88, 0.37)) * 3.3 + 0.4) * 0.35;
    col *= 1.0 + uWaveAmount * uWaveFade * w * (1.0 - smoothstep(0.0, 1.0, kmPerPx));
  }

  // painted offshore line (every zoom: at least uCoastLinePx px wide)
  float lw = max(uCoastLineKm, uCoastLinePx * coastPx);
  float cl = (1.0 - smoothstep(0.35 * lw, lw, seaKm)) * uCoastLineAlpha;
  col = mix(col, cCoastLine, cl);

  // static surf band, broken by a fixed noise (close zoom only)
  if (uWaveFade > 0.001) {
    float band = 1.0 - smoothstep(0.2 * uFoamWidthKm, uFoamWidthKm, seaKm);
    float n = vnoise(d * (EARTH_KM / 2.0)) * 0.65 + vnoise(d * (EARTH_KM / 0.7)) * 0.35;
    float stripes = smoothstep(0.35, 0.85, sin(seaKm * 1.6 - n * 5.0) * 0.5 + 0.5);
    float foam = band * stripes * smoothstep(0.35, 0.7, n) * uFoamAlpha * uWaveFade;
    col = mix(col, cFoam, foam);
  }
  return col;
}
`
