/**
 * Tree scatter worker (C6). Receives the density field once (transferred), then answers
 * scatter requests with per-species instance buffers (transferred back). Created by
 * Trees with new Worker(new URL('./scatter.worker.ts', import.meta.url), { type: 'module' }).
 */
import { scatterTrees, type DensityField, type ScatterRequest } from './scatter'

export type ScatterMsg =
  | { kind: 'init'; field: DensityField; valueJitter: number }
  /** the encoded density image: decoded here, off the main thread */
  | { kind: 'initBlob'; blob: Blob; w: number; h: number; valueJitter: number }
  | ({ kind: 'scatter' } & ScatterRequest)

/** Lossless decode (no premultiply, no colour conversion; the source has no alpha). */
async function decodeField(blob: Blob): Promise<DensityField> {
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'from-image' })
  try {
    const ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('no OffscreenCanvas 2D context')
    ctx.drawImage(bmp, 0, 0)
    const id = ctx.getImageData(0, 0, bmp.width, bmp.height, { colorSpace: 'srgb' })
    return { w: bmp.width, h: bmp.height, data: new Uint8Array(id.data.buffer, id.data.byteOffset, id.data.byteLength) }
  } finally {
    bmp.close()
  }
}

interface WorkerScope {
  onmessage: ((e: MessageEvent<ScatterMsg>) => void) | null
  postMessage(msg: unknown, transfer: Transferable[]): void
}
const scope = self as unknown as WorkerScope

let field: DensityField | null = null
let jitter = 0.06

scope.onmessage = (e) => {
  const m = e.data
  if (m.kind === 'init') {
    field = m.field
    jitter = m.valueJitter
    return
  }
  if (m.kind === 'initBlob') {
    jitter = m.valueJitter
    decodeField(m.blob).then(
      (f) => {
        if (f.w !== m.w || f.h !== m.h) console.warn(`[trees] density is ${f.w}x${f.h}, manifest says ${m.w}x${m.h}`)
        field = f
        scope.postMessage({ ok: true, init: true }, [])
      },
      (err: unknown) => scope.postMessage({ ok: false, init: true, error: err instanceof Error ? err.message : String(err) }, []),
    )
    return
  }
  if (!field) {
    scope.postMessage({ ok: false, id: m.id, error: 'no density field' }, [])
    return
  }
  try {
    const r = scatterTrees(field, m, jitter)
    const tr: Transferable[] = []
    for (const s of r.species) tr.push(s.a.buffer, s.b.buffer)
    scope.postMessage({ ok: true, result: r }, tr)
  } catch (err) {
    scope.postMessage({ ok: false, id: m.id, error: err instanceof Error ? err.message : String(err) }, [])
  }
}
