/**
 * Cube-sphere patch vertex shader (C2b). One 33x33 patch + skirt ring, instanced per
 * quadtree node: aNode = (face, level, ix, iy); position = (u, v, skirt) in [0,1].
 * s,t follow the GL face table with t = face-image down (the bake's convention).
 * Displacement only when uHeightScale > 0 (lod.heightScale, below ~1500 km): the
 * height mip matches the patch's vertex spacing so neighbours agree up to the skirt.
 */
import { commonGLSL } from './common.glsl'

export const terrainVert = /* glsl */ `
${commonGLSL}
in vec4 aNode;
uniform samplerCube uTerrain;
uniform samplerCube uHeightHi;
uniform float uHasHeightHi;
uniform float uTerrainSize;
uniform float uHeightHiSize;
uniform float uHeightScale; // radius units per metre (lod.heightScale)
uniform float uSkirtDepth;  // radius units per unit node span
out vec3 vDir;

void main() {
  float n = exp2(aNode.y);
  float s = -1.0 + 2.0 * (aNode.z + position.x) / n;
  float t = -1.0 + 2.0 * (aNode.w + position.y) / n;
  vec3 d = normalize(faceDir(int(aNode.x + 0.5), s, t));
  float h = 0.0;
  if (uHeightScale > 0.0) {
    float verts = 32.0 * n; // vertices per face edge at this level
    if (uHasHeightHi > 0.5) {
      h = sq(textureLod(uHeightHi, d, max(0.0, log2(uHeightHiSize / verts))).r);
    } else {
      h = sq(textureLod(uTerrain, d, max(0.0, log2(uTerrainSize / verts))).r);
    }
    h *= 9000.0;
  }
  float r = 1.0 + h * uHeightScale - position.z * (uSkirtDepth * 2.0 / n + uHeightScale * 900.0);
  vDir = d;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(d * r, 1.0);
}
`
