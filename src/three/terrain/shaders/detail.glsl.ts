/**
 * Detail splatting (C2b). Splat order (binding, D4/D5): 0 forest, 1 jungle, 2 grass,
 * 3 farm, 4 steppe, 5 desert, 6 rock, 7 marsh, 8 ice; uSplatA -> 0..2, uSplatB ->
 * 3..5, uSplatC -> 6..8. The detail array holds grey luminance (.r, 0.5 neutral).
 *
 * Top-2 layers, biplanar (the two dominant axes, blend power 8) at two scales
 * (uDetailScaleKm, km per tile): 2 layers x 2 planes x 2 octaves = 8 taps. Each octave
 * fades out when a tile spans fewer than uDetailMinTilePx screen px (the footprint
 * fade: no moire, no visible tiling at distance); the mips handle minification.
 * Result: albedo *= mix(1, 2*detail, uDetailFade * strength). The caller re-applies
 * the luminance cap after lighting.
 */
export const detailGLSL = /* glsl */ `
uniform samplerCube uSplatA;
uniform samplerCube uSplatB;
uniform samplerCube uSplatC;
uniform highp sampler2DArray uDetail;
uniform float uHasDetail;
uniform float uDetailFade;
uniform vec2 uDetailScaleKm;
uniform vec2 uDetailMinTilePx;
uniform float uDetailStrength[9];

float detailPlane(vec3 p, int axis, float layer) {
  vec2 uv = axis == 0 ? p.yz : (axis == 1 ? p.zx : p.xy);
  return texture(uDetail, vec3(uv, layer)).r;
}

float detailOctave(vec3 d, float scaleKm, float layer, int a0, int a1, float w0) {
  vec3 p = d * (EARTH_KM / scaleKm);
  return mix(detailPlane(p, a1, layer), detailPlane(p, a0, layer), w0);
}

// multiplier for the linear albedo (1.0 = untouched)
float detailFactor(vec3 d, float kmPerPx) {
  vec3 wa = texture(uSplatA, d).rgb;
  vec3 wb = texture(uSplatB, d).rgb;
  vec3 wc = texture(uSplatC, d).rgb;
  float w[9] = float[9](wa.r, wa.g, wa.b, wb.r, wb.g, wb.b, wc.r, wc.g, wc.b);
  int i1 = 0;
  for (int i = 1; i < 9; i++) if (w[i] > w[i1]) i1 = i;
  int i2 = i1 == 0 ? 1 : 0;
  for (int i = 0; i < 9; i++) if (i != i1 && w[i] > w[i2]) i2 = i;
  float w1 = w[i1], w2 = w[i2];
  float ws = w1 + w2;
  if (ws < 1e-3) return 1.0;

  // octave fades: tile size in screen px
  float fF = smoothstep(uDetailMinTilePx.x, uDetailMinTilePx.x * 2.5, uDetailScaleKm.x / max(kmPerPx, 1e-4));
  float fC = smoothstep(uDetailMinTilePx.y, uDetailMinTilePx.y * 2.5, uDetailScaleKm.y / max(kmPerPx, 1e-4));
  if (fF + fC < 1e-3) return 1.0;

  // biplanar: the two dominant axes
  vec3 an = abs(d);
  int a0 = an.x >= an.y && an.x >= an.z ? 0 : (an.y >= an.z ? 1 : 2);
  int a1 = a0 == 0 ? (an.y >= an.z ? 1 : 2) : (a0 == 1 ? (an.x >= an.z ? 0 : 2) : (an.x >= an.y ? 0 : 1));
  float p0 = pow(an[a0], 8.0), p1 = pow(an[a1], 8.0);
  float b0 = p0 / (p0 + p1);

  float l1 = float(i1), l2 = float(i2);
  float dF = 0.5, dC = 0.5;
  if (fF > 0.0) {
    dF = (w1 * detailOctave(d, uDetailScaleKm.x, l1, a0, a1, b0) + w2 * detailOctave(d, uDetailScaleKm.x, l2, a0, a1, b0)) / ws;
  }
  if (fC > 0.0) {
    dC = (w1 * detailOctave(d, uDetailScaleKm.y, l1, a0, a1, b0) + w2 * detailOctave(d, uDetailScaleKm.y, l2, a0, a1, b0)) / ws;
  }
  float det = 0.5 + (dF - 0.5) * fF * 0.6 + (dC - 0.5) * fC * 0.75;
  float strength = (w1 * uDetailStrength[i1] + w2 * uDetailStrength[i2]) / ws;
  return mix(1.0, 2.0 * det, uDetailFade * strength);
}
`
