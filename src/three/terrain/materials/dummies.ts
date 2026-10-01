/**
 * 1x1 stand-ins bound to every optional sampler until its texture lands (C2b), so an
 * unloaded sampler is never read unbound (each is also guarded by its uHas flag).
 * Shared and never disposed (a few bytes).
 */
import {
  ClampToEdgeWrapping,
  CubeTexture,
  DataArrayTexture,
  DataTexture,
  LinearFilter,
  NoColorSpace,
  RGBAFormat,
  UnsignedByteType,
} from 'three'

function px(rgba: [number, number, number, number]): Uint8Array {
  return new Uint8Array(rgba)
}

let tex2d: DataTexture | null = null
let cube: CubeTexture | null = null
let cubeSea: CubeTexture | null = null
let arr: DataArrayTexture | null = null

function face(rgba: [number, number, number, number]): DataTexture {
  const t = new DataTexture(px(rgba), 1, 1, RGBAFormat, UnsignedByteType)
  t.colorSpace = NoColorSpace
  t.needsUpdate = true
  return t
}

function cubeOf(rgba: [number, number, number, number]): CubeTexture {
  const faces = Array.from({ length: 6 }, () => face(rgba))
  const c = new CubeTexture(faces as unknown as HTMLImageElement[])
  c.format = RGBAFormat
  c.type = UnsignedByteType
  c.colorSpace = NoColorSpace
  c.generateMipmaps = false
  c.minFilter = LinearFilter
  c.magFilter = LinearFilter
  c.needsUpdate = true
  return c
}

/** neutral 2D texture (mid grey, no colour space) */
export function dummy2D(): DataTexture {
  if (!tex2d) {
    tex2d = face([128, 128, 128, 255])
    tex2d.wrapS = ClampToEdgeWrapping
    tex2d.wrapT = ClampToEdgeWrapping
  }
  return tex2d
}

/** neutral cube: grey (detail-neutral weights / data never read behind uHas flags) */
export function dummyCube(): CubeTexture {
  if (!cube) cube = cubeOf([0, 0, 128, 255])
  return cube
}

/** sea cube: terrain-like data that decodes to 'open sea, 3 km deep' */
export function dummySeaCube(): CubeTexture {
  if (!cubeSea) cubeSea = cubeOf([0, 133, 0, 255])
  return cubeSea
}

/** 1x1x1 detail array at 0.5 (neutral) */
export function dummyArray(): DataArrayTexture {
  if (!arr) {
    arr = new DataArrayTexture(px([128, 128, 128, 255]), 1, 1, 1)
    arr.format = RGBAFormat
    arr.type = UnsignedByteType
    arr.colorSpace = NoColorSpace
    arr.needsUpdate = true
  }
  return arr
}
