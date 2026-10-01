/**
 * Lossless image -> texture builders (C2a). Pure builders: the loader fetches the
 * bytes (queue, retries, progress) and hands Blobs in.
 *
 * Binding rules (ENG_PLAN R1-R8):
 * - Decode with createImageBitmap(blob, {premultiplyAlpha:'none', colorSpaceConversion:'none',
 *   imageOrientation:'from-image'}): data files carry no colour chunks and no alpha.
 * - Data cubes are `new THREE.CubeTexture(bitmaps)` with NoColorSpace — NEVER
 *   CubeTextureLoader (it forces sRGB). Faces are row 0 = top per the GL table:
 *   flipY = false (the CubeTexture default; ImageBitmap ignores flipY anyway).
 * - R8 cubes (heightHi) are DataTexture faces (RedFormat, UnsignedByteType) inside a
 *   CubeTexture; unpackAlignment 1.
 * - Equirects: row 0 = north, shaders derive uv from the direction -> flipY = false.
 * - premultiplyAlpha = false everywhere. Köppen index: NearestFilter, no mips (R8).
 */
import {
  ClampToEdgeWrapping,
  CubeTexture,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NearestFilter,
  NoColorSpace,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
} from 'three'

export const BITMAP_OPTS: ImageBitmapOptions = {
  premultiplyAlpha: 'none',
  colorSpaceConversion: 'none',
  imageOrientation: 'from-image',
}

export function decodeBitmap(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, BITMAP_OPTS)
}

/** Raw RGBA bytes of a bitmap (2D canvas, willReadFrequently; no alpha in the source so values are exact). */
export function bitmapRGBA(bmp: ImageBitmap): { w: number; h: number; data: Uint8Array } {
  const w = bmp.width
  const h = bmp.height
  let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null
  if (typeof OffscreenCanvas !== 'undefined') {
    ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })
  } else {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    ctx = c.getContext('2d', { willReadFrequently: true })
  }
  if (!ctx) throw new Error('dataTextures: no 2D context for getImageData')
  ctx.drawImage(bmp, 0, 0)
  const id = ctx.getImageData(0, 0, w, h, { colorSpace: 'srgb' })
  return { w, h, data: new Uint8Array(id.data.buffer, id.data.byteOffset, id.data.byteLength) }
}

export async function decodeRGBA(blob: Blob): Promise<{ w: number; h: number; data: Uint8Array }> {
  const bmp = await decodeBitmap(blob)
  try {
    return bitmapRGBA(bmp)
  } finally {
    bmp.close()
  }
}

export type CubeFilter = 'linear' | 'nearest'

function checkFaces(bitmaps: { width: number; height: number }[], expect: number, what: string): void {
  if (bitmaps.length !== 6) throw new Error(`${what}: ${bitmaps.length} faces, expected 6`)
  for (const b of bitmaps) {
    if (b.width !== b.height) throw new Error(`${what}: face ${b.width}x${b.height} is not square`)
    if (expect > 0 && b.width !== expect) {
      console.warn(`[terrain] ${what}: face is ${b.width}px but the manifest says ${expect}px (using the file size)`)
    }
  }
}

/** RGBA8 data cube from 6 face blobs (px nx py ny pz nz). */
export async function dataCubeFromBlobs(
  blobs: Blob[],
  opts: { filter: CubeFilter; mips: boolean; faceSize?: number; name?: string },
): Promise<CubeTexture> {
  const bitmaps = await Promise.all(blobs.map(decodeBitmap))
  checkFaces(bitmaps, opts.faceSize ?? 0, opts.name ?? 'data cube')
  const tex = new CubeTexture(bitmaps)
  tex.format = RGBAFormat
  tex.type = UnsignedByteType
  tex.colorSpace = NoColorSpace
  tex.flipY = false
  tex.premultiplyAlpha = false
  tex.wrapS = ClampToEdgeWrapping
  tex.wrapT = ClampToEdgeWrapping
  if (opts.filter === 'nearest') {
    tex.minFilter = NearestFilter
    tex.magFilter = NearestFilter
    tex.generateMipmaps = false
  } else {
    tex.minFilter = opts.mips ? LinearMipmapLinearFilter : LinearFilter
    tex.magFilter = LinearFilter
    tex.generateMipmaps = opts.mips
  }
  tex.name = opts.name ?? ''
  tex.needsUpdate = true
  return tex
}

/** Single-channel cube (heightHi; any layer with upload 'R8', e.g. koppenIdx to save 3/4 of its VRAM): R of each face -> DataTexture(RedFormat) faces in a CubeTexture. */
export async function r8CubeFromBlobs(
  blobs: Blob[],
  opts: { mips: boolean; filter?: CubeFilter; faceSize?: number; name?: string },
): Promise<CubeTexture> {
  const faces: DataTexture[] = []
  for (const blob of blobs) {
    // sequential: one full-size RGBA scratch buffer alive at a time
    const { w, h, data } = await decodeRGBA(blob)
    const r = new Uint8Array(w * h)
    for (let i = 0, j = 0; i < r.length; i++, j += 4) r[i] = data[j]
    const f = new DataTexture(r, w, h, RedFormat, UnsignedByteType)
    f.colorSpace = NoColorSpace
    f.flipY = false
    f.unpackAlignment = 1
    faces.push(f)
  }
  checkFaces(faces.map((f) => ({ width: f.image.width, height: f.image.height })), opts.faceSize ?? 0, opts.name ?? 'R8 cube')
  const tex = new CubeTexture(faces as unknown as HTMLImageElement[])
  tex.format = RedFormat
  tex.type = UnsignedByteType
  tex.colorSpace = NoColorSpace
  tex.flipY = false
  tex.premultiplyAlpha = false
  tex.unpackAlignment = 1
  if (opts.filter === 'nearest') {
    tex.minFilter = NearestFilter
    tex.magFilter = NearestFilter
    tex.generateMipmaps = false
  } else {
    tex.minFilter = opts.mips ? LinearMipmapLinearFilter : LinearFilter
    tex.magFilter = LinearFilter
    tex.generateMipmaps = opts.mips
  }
  tex.name = opts.name ?? ''
  tex.needsUpdate = true
  return tex
}

/** 2:1 equirect (row 0 = north, column 0 = lon -180). srgb for albedo-like images, data otherwise. */
export async function equirectFromBlob(blob: Blob, opts: { srgb: boolean; name?: string; anisotropy?: number }): Promise<Texture> {
  const bmp = await decodeBitmap(blob)
  if (bmp.width !== bmp.height * 2) console.warn(`[terrain] ${opts.name ?? 'equirect'}: ${bmp.width}x${bmp.height} is not 2:1`)
  const tex = new Texture(bmp)
  tex.format = RGBAFormat
  tex.type = UnsignedByteType
  tex.colorSpace = opts.srgb ? SRGBColorSpace : NoColorSpace
  tex.flipY = false
  tex.premultiplyAlpha = false
  tex.wrapS = RepeatWrapping // u wraps across the antimeridian
  tex.wrapT = ClampToEdgeWrapping
  tex.minFilter = LinearMipmapLinearFilter
  tex.magFilter = LinearFilter
  tex.generateMipmaps = true
  tex.anisotropy = opts.anisotropy ?? 1
  tex.name = opts.name ?? ''
  tex.needsUpdate = true
  return tex
}

/** Release a texture built here: GPU memory plus the decoded bitmaps. */
export function disposeTexture(tex: Texture): void {
  tex.dispose()
  const img = (tex as Texture & { image: unknown }).image
  const list = Array.isArray(img) ? img : [img]
  for (const i of list) {
    if (typeof ImageBitmap !== 'undefined' && i instanceof ImageBitmap) i.close()
  }
}
