/**
 * Shared, ref-counted KTX2Loader (C2a). One instance per renderer: the Basis
 * transcoder is self-hosted at `${BASE_URL}basis/` (R10, byte-identical to three's
 * copy; `pnpm verify:basis`), never a CDN. Workers: 2 on phones, 4 elsewhere.
 *
 * acquireKtx2(gl) -> loader (detectSupport done); releaseKtx2() disposes the workers
 * when the last user lets go. parseKtx2(buffer) transcodes bytes the terrain loader
 * already fetched (its own queue handles concurrency, retries and progress).
 */
import type { CompressedTexture, WebGLRenderer } from 'three'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { globeState } from '../globeState'

export const BASIS_PATH = `${import.meta.env.BASE_URL}basis/`

let loader: KTX2Loader | null = null
/**
 * ETC1S-only twin with BC7 disabled (INT-B). three's KTX2Loader sends ETC1S to BC7 (1 B/texel)
 * when ETC2 is missing (Windows / desktop ANGLE). ETC1S carries no more detail than BC1 holds, so
 * the twin targets BC1 (0.5 B/texel) and the mid tier's 2048 albedo stays inside the 70 MB budget.
 * Created lazily, only on such GPUs, only when an ETC1S file arrives; 1 worker.
 */
let etc1sLoader: KTX2Loader | null = null
let boundGl: WebGLRenderer | null = null
let refs = 0
let warm: Promise<void> | null = null

export function acquireKtx2(gl: WebGLRenderer): KTX2Loader {
  if (loader && boundGl !== gl) {
    // a new renderer (Canvas remount): the old instance's support flags are stale
    loader.dispose()
    loader = null
    etc1sLoader?.dispose()
    etc1sLoader = null
    warm = null
  }
  if (!loader) {
    loader = new KTX2Loader()
    loader.setTranscoderPath(BASIS_PATH)
    loader.setWorkerLimit(globeState.isPhone ? 2 : 4)
    loader.detectSupport(gl)
    boundGl = gl
  }
  refs++
  return loader
}

export function releaseKtx2(): void {
  refs = Math.max(0, refs - 1)
  if (refs === 0 && loader) {
    loader.dispose()
    loader = null
    etc1sLoader?.dispose()
    etc1sLoader = null
    boundGl = null
    warm = null
  }
}

/** Start fetching the transcoder (js + wasm) now, so it overlaps stage A. */
export function warmKtx2(): Promise<void> {
  if (!loader) return Promise.reject(new Error('ktx2: not acquired'))
  if (!warm) warm = (loader.init() as Promise<unknown>).then(() => undefined)
  return warm
}

type WorkerCfg = Record<string, boolean>

function loaderFor(codec: 'etc1s' | 'uastc' | undefined): KTX2Loader | null {
  const l = loader
  if (!l || codec !== 'etc1s' || !boundGl) return l
  const cfg = (l as unknown as { workerConfig?: WorkerCfg | null }).workerConfig
  if (!cfg || cfg.etc2Supported || cfg.etc1Supported || !cfg.bptcSupported || !cfg.dxtSupported) return l
  if (!etc1sLoader) {
    etc1sLoader = new KTX2Loader()
    etc1sLoader.setTranscoderPath(BASIS_PATH)
    etc1sLoader.setWorkerLimit(1)
    etc1sLoader.detectSupport(boundGl)
    const c2 = (etc1sLoader as unknown as { workerConfig: WorkerCfg }).workerConfig
    c2.bptcSupported = false
  }
  return etc1sLoader
}

/** Transcode a KTX2 file (the buffer is transferred to a worker and detached). */
export function parseKtx2(buffer: ArrayBuffer, codec?: 'etc1s' | 'uastc'): Promise<CompressedTexture> {
  const l = loaderFor(codec)
  if (!l) return Promise.reject(new Error('ktx2: not acquired'))
  return new Promise<CompressedTexture>((resolve, reject) => {
    l.parse(buffer, (t) => resolve(t as CompressedTexture), (e) => reject(e instanceof Error ? e : new Error(String(e))))
  })
}

/** Which GPU formats the transcoder may target (diagnostics). */
export function ktx2Support(): Record<string, boolean> | null {
  const cfg = (loader as unknown as { workerConfig?: Record<string, boolean> } | null)?.workerConfig
  return cfg ? { ...cfg } : null
}
