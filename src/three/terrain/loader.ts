/**
 * Terrain loader (C2a). Lives in the lazy terrain chunk (imported by TerrainGlobe and
 * the lazy label/river/tree layers only — never by the entry).
 *
 * startTerrainLoading(gl, tier) loads the manifest's stages for the tier, fills the
 * frozen `terrainTextures` registry (textures.ts) and publishes the stage through
 * store.setTerrainStage (which also writes globeState.stage):
 *   A  preview equirects (identical for every tier)          -> stage 'A'
 *   B  the tier core (+ labels.json), fetched concurrently with A -> stage 'B'
 *   C  first of: idle after B, lod.zoom01 > 0.1, travelIn > 0.3 (polled every 250 ms)
 *      -> splats, detail, height grid, rivers, tree density (not on phones), HIGH heightHi
 *   on demand: Köppen colour + index, on the first switch to climate (no idle prefetch)
 *   D  deferred (never set)
 * Plain imperative promises: nothing here suspends. C2b may suspend on whenStage('A').
 *
 * Fetching: one priority queue, at most 4 fetches in flight, priority = stage then
 * list order; 3 retries with backoff (not for 4xx); AbortController per session.
 * globeState.loadProgress = bytes received (fetch streams) / manifest bytes of the
 * unique A+B payloads (+ the Basis transcoder on cube tiers); monotonic, reaches 1
 * when B is published, never decreases (also across tier changes).
 *
 * Textures are uploaded (renderer.initTexture) when published, so the upload hitch
 * happens at a known time. Loader textures are immutable after publish: consumers
 * must not change filters or set needsUpdate. Replaced textures are disposed once no
 * terrainTextures field references them. The tier only ever steps down (tier.ts).
 */
import {
  CompressedArrayTexture,
  CompressedCubeTexture,
  CubeTexture,
  DataTexture,
  FloatType,
  GLSL3,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NearestFilter,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  UnsignedByteType,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three'
import { globeState, type TerrainStage, type Tier } from '../globeState'
import { useSite } from '../../state/store'
import { setHeightGrid } from '../geo/heightGrid'
import { TIER_RANK, perfMonitorEnabled, startPerfMonitor } from '../tier'
import { debugEnabled, registerDebug } from '../debugHooks'
import { loadManifest, terrainUrl, type JsonAsset, type TerrainManifest, type TreeDensityAsset } from './manifest'
import { emitTerrainTextures, terrainTextures, type TerrainTextures } from './textures'
import {
  STAGE_RANK,
  declaredBytes,
  estimateTierVram,
  refId,
  stagePlan,
  uniqueRefs,
  type LayerRef,
  type StagePlan,
  type TextureField,
} from './stages'
import { acquireKtx2, ktx2Support, parseKtx2, releaseKtx2, warmKtx2 } from './ktx2'
import { dataCubeFromBlobs, decodeRGBA, disposeTexture, equirectFromBlob, r8CubeFromBlobs } from './dataTextures'

// ---------------------------------------------------------------- public types

export interface TerrainLoadingHandle {
  readonly tier: Tier
  /** resolves when this loader has published the stage (stays pending if it fails) */
  whenStage(s: 'A' | 'B' | 'C'): Promise<void>
  /** start stage C now (no-op before B or once started) */
  requestStageC(): void
  /** load the Köppen layers now */
  requestKoppen(): Promise<void>
  /** drop terrainTextures.preview (call after the A->B crossfade); disposed unless another field shares it */
  releasePreview(): void
  /** release this user; the loader tears down 200 ms after the last release unless restarted (StrictMode-safe) */
  dispose(): void
}

export interface TreeDensity {
  w: number
  h: number
  /** RGBA (r conifer, g broadleaf, b palm, a 255); a fresh copy per call, safe to transfer */
  data: Uint8Array
}

// ---------------------------------------------------------------- diagnostics

interface LogEntry {
  t: number // ms since the first startTerrainLoading
  ev: string
  [k: string]: unknown
}
const T0 = performance.now()
const log: LogEntry[] = []
function note(ev: string, extra: Record<string, unknown> = {}): void {
  log.push({ t: Math.round(performance.now() - T0), ev, ...extra })
  if (log.length > 400) log.shift()
}

function reportError(where: string, e: unknown): void {
  const msg = `terrain ${where}: ${e instanceof Error ? e.message : String(e)}`
  console.error(`[terrain] ${msg}`)
  try {
    window.__errs?.push(msg)
  } catch {
    /* no error sink */
  }
  note('error', { where, msg })
}

function isAbort(e: unknown, signal?: AbortSignal): boolean {
  return (signal?.aborted ?? false) || (e instanceof DOMException && e.name === 'AbortError')
}

// ---------------------------------------------------------------- fetch queue (<= 4 in flight)

const MAX_FETCHES = 4
const RETRY_DELAYS = [500, 1500, 4000]

interface Waiter {
  prio: number
  seq: number
  go: () => void
}
const waiting: Waiter[] = []
let inFlight = 0
let seqN = 0

function acquireSlot(prio: number, signal?: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    let done = false
    const release = () => {
      if (done) return
      done = true
      inFlight--
      pump()
    }
    const w: Waiter = {
      prio,
      seq: seqN++,
      go: () => {
        signal?.removeEventListener('abort', onAbort)
        inFlight++
        resolve(release)
      },
    }
    const onAbort = () => {
      const i = waiting.indexOf(w)
      if (i >= 0) waiting.splice(i, 1)
      reject(new DOMException('aborted', 'AbortError'))
    }
    if (signal?.aborted) return onAbort()
    signal?.addEventListener('abort', onAbort, { once: true })
    waiting.push(w)
    pump()
  })
}

function pump(): void {
  while (inFlight < MAX_FETCHES && waiting.length) {
    let bi = 0
    for (let i = 1; i < waiting.length; i++) {
      const a = waiting[i]
      const b = waiting[bi]
      if (a.prio < b.prio || (a.prio === b.prio && a.seq < b.seq)) bi = i
    }
    waiting.splice(bi, 1)[0].go()
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(id)
        reject(new DOMException('aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

class HttpError extends Error {
  status: number
  constructor(status: number, url: string) {
    super(`HTTP ${status} for ${url}`)
    this.status = status
  }
}

interface Fetched {
  buf: ArrayBuffer
  type: string
}

/** Fetch a manifest-relative URL through the queue, streaming byte counts to onBytes(total so far). */
async function fetchBytes(
  rel: string,
  opts: { prio: number; signal?: AbortSignal; onBytes?: (n: number) => void },
): Promise<Fetched> {
  const url = terrainUrl(rel)
  let last: unknown = null
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    const release = await acquireSlot(opts.prio, opts.signal)
    try {
      const t = performance.now()
      const res = await fetch(url, { signal: opts.signal })
      if (!res.ok) throw new HttpError(res.status, rel)
      const type = res.headers.get('content-type') ?? ''
      let buf: ArrayBuffer
      if (!res.body) {
        buf = await res.arrayBuffer()
        opts.onBytes?.(buf.byteLength)
      } else {
        const reader = res.body.getReader()
        const chunks: Uint8Array[] = []
        let n = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          n += value.byteLength
          opts.onBytes?.(n)
        }
        const out = new Uint8Array(n)
        let o = 0
        for (const c of chunks) {
          out.set(c, o)
          o += c.byteLength
        }
        buf = out.buffer
      }
      note('fetch', { url: rel.replace(/\?v=.*/, ''), bytes: buf.byteLength, ms: Math.round(performance.now() - t), attempt })
      return { buf, type }
    } catch (e) {
      if (isAbort(e, opts.signal)) throw e
      last = e
      const s = e instanceof HttpError ? e.status : 0
      if (s >= 400 && s < 500 && s !== 408 && s !== 429) break
      note('retry', { url: rel, attempt, err: e instanceof Error ? e.message : String(e) })
    } finally {
      release()
    }
    if (attempt < RETRY_DELAYS.length) await delay(RETRY_DELAYS[attempt], opts.signal)
  }
  throw last instanceof Error ? last : new Error(`fetch failed: ${rel}`)
}

// ---------------------------------------------------------------- manifest + shared CPU assets

let manifestP: Promise<TerrainManifest> | null = null

/** The manifest (cached; retried 3x with backoff; a failure clears the cache). */
export function getTerrainManifest(): Promise<TerrainManifest> {
  if (!manifestP) {
    manifestP = (async () => {
      let last: unknown
      for (let a = 0; a <= RETRY_DELAYS.length; a++) {
        try {
          const t = performance.now()
          const m = await loadManifest()
          note('manifest', { ms: Math.round(performance.now() - t), placeholder: m.placeholder })
          return m
        } catch (e) {
          last = e
          if (a < RETRY_DELAYS.length) await delay(RETRY_DELAYS[a])
        }
      }
      throw last
    })()
    manifestP.catch(() => {
      manifestP = null
    })
  }
  return manifestP
}

const jsonCache = new Map<string, Promise<unknown>>()
function fetchJson(asset: JsonAsset, prio: number, onBytes?: (n: number) => void): Promise<unknown> {
  let p = jsonCache.get(asset.url)
  if (!p) {
    p = fetchBytes(asset.url, { prio, onBytes }).then((f) => JSON.parse(new TextDecoder().decode(f.buf)) as unknown)
    jsonCache.set(asset.url, p)
    p.catch(() => jsonCache.delete(asset.url))
  }
  return p
}

/** labels.json / rivers.json (cached promise; works without a running loader). */
export function loadJson<T>(key: 'labels' | 'rivers'): Promise<T> {
  return getTerrainManifest().then((m) => fetchJson(m.shared[key], 150) as Promise<T>)
}

const treeCache = new Map<string, Promise<Blob>>()
function fetchTreeBlob(asset: TreeDensityAsset, prio: number, signal?: AbortSignal, onBytes?: (n: number) => void): Promise<Blob> {
  let p = treeCache.get(asset.url)
  if (!p) {
    p = fetchBytes(asset.url, { prio, signal, onBytes }).then((f) => new Blob([f.buf], { type: f.type || 'image/webp' }))
    treeCache.set(asset.url, p)
    p.catch(() => treeCache.delete(asset.url))
  }
  return p
}

/** Tree density (lossless RGB, decoded without colour conversion) as RGBA bytes for C6's worker. */
export async function loadTreeDensity(): Promise<TreeDensity> {
  const m = await getTerrainManifest()
  const a = m.shared.treeDensity
  const d = await decodeRGBA(await fetchTreeBlob(a, 300))
  if (d.w !== a.w || d.h !== a.h) console.warn(`[terrain] treeDensity is ${d.w}x${d.h}, manifest says ${a.w}x${a.h}`)
  return d
}

/**
 * Tree density as the still-encoded lossless image (C6 request: decode the 4096×2048
 * field in the scatter worker, not on the main thread). The worker decodes with
 * createImageBitmap(premultiplyAlpha 'none', colorSpaceConversion 'none') + an
 * OffscreenCanvas, exactly as loadTreeDensity does here.
 */
export async function loadTreeDensityBlob(): Promise<{ blob: Blob; w: number; h: number }> {
  const m = await getTerrainManifest()
  const a = m.shared.treeDensity
  return { blob: await fetchTreeBlob(a, 300), w: a.w, h: a.h }
}

let heightGridUrl: string | null = null

// ---------------------------------------------------------------- load progress (stages A+B)

const TRANSCODER_ID = 'basis-transcoder'
const TRANSCODER_BYTES = 585_000 // basis_transcoder.js + .wasm (uncompressed)

const progress = {
  value: 0,
  items: new Map<string, { declared: number; got: number }>(),
  trace: [] as [number, number][],

  configure(entries: [string, number][]): void {
    if (this.value >= 1) return // stays full across tier changes
    this.items = new Map(entries.map(([id, b]) => [id, { declared: b, got: 0 }]))
    this.update()
  },
  bytes(id: string, n: number): void {
    const it = this.items.get(id)
    if (!it) return
    it.got = Math.max(it.got, Math.min(n, it.declared))
    this.update()
  },
  done(id: string): void {
    const it = this.items.get(id)
    if (!it) return
    it.got = it.declared
    this.update()
  },
  finish(): void {
    this.set(1)
  },
  update(): void {
    let tot = 0
    let got = 0
    let n = 0
    let nd = 0
    for (const it of this.items.values()) {
      tot += it.declared
      got += it.got
      n++
      if (it.got >= it.declared) nd++
    }
    this.set(tot > 0 ? got / tot : n > 0 ? nd / n : 0)
  },
  set(v: number): void {
    const nv = Math.max(this.value, Math.min(1, v))
    if (nv === this.value) return
    this.value = nv
    globeState.loadProgress = nv
    const lastV = this.trace.length ? this.trace[this.trace.length - 1][1] : -1
    if (nv - lastV >= 0.005 || nv === 1) this.trace.push([Math.round(performance.now() - T0), Math.round(nv * 10000) / 10000])
  },
}

// ---------------------------------------------------------------- texture registry helpers

type TexKey = Exclude<keyof TerrainTextures, 'preview'>

function texOf(field: TextureField): Texture | undefined {
  if (field === 'preview.albedo') return terrainTextures.preview?.albedo
  if (field === 'preview.data') return terrainTextures.preview?.data
  return terrainTextures[field as TexKey] as Texture | undefined
}

/** every texture currently referenced by terrainTextures */
function referenced(): Set<Texture> {
  const s = new Set<Texture>()
  const t = terrainTextures
  if (t.preview) {
    s.add(t.preview.albedo)
    s.add(t.preview.data)
  }
  for (const k of Object.keys(t) as (keyof TerrainTextures)[]) {
    if (k === 'preview') continue
    const v = t[k] as Texture | undefined
    if (v) s.add(v)
  }
  return s
}

/** a published texture with the same payload identity (reuse instead of refetching) */
const idOfTex = new WeakMap<Texture, string>()
function findPublished(id: string): Texture | undefined {
  for (const tex of referenced()) if (idOfTex.get(tex) === id) return tex
  return undefined
}

function disposeUnreferenced(texs: Iterable<Texture>): void {
  const live = referenced()
  for (const t of texs) {
    if (live.has(t)) continue
    disposeTexture(t)
    note('dispose', { name: t.name })
  }
}

function setStage(s: TerrainStage): void {
  const cur = globeState.stage
  if (s === 'A' && cur !== 'none') return // a tier change never shows a stage regression to A
  if (s === cur) return
  useSite.getState().setTerrainStage(s)
  note('stage', { stage: s })
}

// ---------------------------------------------------------------- VRAM accounting

function texBytes(t: Texture): number {
  const MIP = 4 / 3
  if ((t as CompressedCubeTexture).isCompressedCubeTexture) {
    const faces = (t as unknown as { image: { mipmaps: { data: ArrayBufferView }[] }[] }).image
    return faces.reduce((s, f) => s + f.mipmaps.reduce((a, m) => a + m.data.byteLength, 0), 0)
  }
  if ((t as CompressedArrayTexture).isCompressedArrayTexture) {
    return (t.mipmaps as { data: ArrayBufferView }[]).reduce((a, m) => a + m.data.byteLength, 0)
  }
  const mips = t.generateMipmaps ? MIP : 1
  if ((t as CubeTexture).isCubeTexture) {
    const img = (t as CubeTexture).image as unknown as ({ width: number; height: number } | DataTexture)[]
    const f0 = img[0] as { width?: number; height?: number; image?: { width: number; height: number } }
    const w = f0.image?.width ?? f0.width ?? 0
    const h = f0.image?.height ?? f0.height ?? 0
    const bpp = t.format === RGBAFormat ? 4 : 1
    return w * h * 6 * bpp * mips
  }
  const img = t.image as { width: number; height: number }
  return img.width * img.height * 4 * mips
}

function vramReport(): { totalMB: number; byField: Record<string, number> } {
  const byField: Record<string, number> = {}
  let total = 0
  const seen = new Set<Texture>()
  const add = (name: string, t: Texture | undefined) => {
    if (!t) return
    const b = seen.has(t) ? 0 : texBytes(t)
    seen.add(t)
    byField[name] = Math.round(b)
    total += b
  }
  add('preview.albedo', terrainTextures.preview?.albedo)
  add('preview.data', terrainTextures.preview?.data)
  for (const k of Object.keys(terrainTextures) as (keyof TerrainTextures)[]) {
    if (k !== 'preview') add(k, terrainTextures[k] as Texture | undefined)
  }
  return { totalMB: Math.round((total / 1048576) * 100) / 100, byField }
}

function publishVram(): void {
  if (debugEnabled && window.__globe) window.__globe.vram = vramReport()
}

// ---------------------------------------------------------------- sessions

interface Loaded {
  ref: LayerRef
  tex?: Texture
}

const IDLE_OFF = debugEnabled && new URLSearchParams(window.location.search).get('terrainIdle') === 'off'

class Session {
  readonly gl: WebGLRenderer
  readonly tier: Tier
  readonly prevTier: Tier | null
  readonly ctrl = new AbortController()
  refs = 0
  closed = false
  plan: StagePlan | null = null
  private reached = 0
  private waiters: { rank: number; resolve: () => void }[] = []
  private inflight = new Map<string, Promise<Loaded>>()
  private cleanups: (() => void)[] = []
  private ktx = false
  private warm: Promise<void> | null = null
  private bReady = false
  private cStarted = false
  private koppenP: Promise<void> | null = null
  private previewParts: { albedo?: Texture; data?: Texture } = {}

  constructor(gl: WebGLRenderer, tier: Tier, prevTier: Tier | null) {
    this.gl = gl
    this.tier = tier
    this.prevTier = prevTier
    if (tier !== 'low') {
      acquireKtx2(gl)
      this.ktx = true
    }
  }

  whenStage(s: 'A' | 'B' | 'C'): Promise<void> {
    const rank = STAGE_RANK[s]
    if (this.reached >= rank) return Promise.resolve()
    return new Promise((resolve) => this.waiters.push({ rank, resolve }))
  }

  private reach(s: 'A' | 'B' | 'C'): void {
    this.reached = Math.max(this.reached, STAGE_RANK[s])
    setStage(s)
    this.waiters = this.waiters.filter((w) => {
      if (w.rank > this.reached) return true
      w.resolve()
      return false
    })
  }

  stop(): void {
    if (this.closed) return
    this.closed = true
    this.ctrl.abort()
    for (const c of this.cleanups.splice(0)) c()
    if (this.ktx) {
      releaseKtx2()
      this.ktx = false
    }
    note('session-stop', { tier: this.tier })
  }

  async run(): Promise<void> {
    note('session-start', { tier: this.tier, prevTier: this.prevTier })
    let m: TerrainManifest
    try {
      m = await getTerrainManifest()
    } catch (e) {
      reportError('manifest', e)
      return
    }
    if (this.closed) return
    const plan = stagePlan(m, this.tier)
    this.plan = plan
    if (plan.unknown.length) console.warn(`[terrain] skipping unknown stage keys: ${plan.unknown.join(', ')}`)

    // load progress: unique A+B payloads, plus the transcoder on cube tiers
    const ab = uniqueRefs([...plan.A, ...plan.B])
    const entries: [string, number][] = ab.map((r) => [refId(r), declaredBytes(r)])
    if (this.ktx) {
      entries.push([TRANSCODER_ID, TRANSCODER_BYTES])
      this.warm = warmKtx2()
      this.warm.then(
        () => {
          progress.done(TRANSCODER_ID)
          note('transcoder', { support: ktx2Support() })
        },
        () => {},
      )
    }
    progress.configure(entries)
    for (const r of ab) if (findPublished(refId(r))) progress.done(refId(r))

    this.watchKoppen()

    // A and B share the queue: A first by priority, B fills the remaining slots
    const aP = Promise.all(plan.A.map((r, i) => this.load(r, i)))
    const bP = Promise.all(plan.B.map((r, i) => this.load(r, 100 + i)))
    aP.catch(() => {})
    bP.catch(() => {})

    try {
      const a = await aP
      if (this.closed) return
      this.publish(a, 'A')
    } catch (e) {
      if (isAbort(e, this.ctrl.signal)) return
      reportError('stage A', e)
    }
    try {
      const b = await bP
      if (this.ktx && this.warm) await this.warm
      if (this.closed) return
      this.publish(b, 'B')
    } catch (e) {
      if (isAbort(e, this.ctrl.signal)) return
      reportError('stage B', e)
      return // keep the last good stage
    }
    progress.finish()
    this.bReady = true
    if (perfMonitorEnabled()) {
      const tier = this.tier
      this.cleanups.push(
        startPerfMonitor((t) => {
          note('downgrade', { from: tier, to: t })
          if (TIER_RANK[t] < TIER_RANK[useSite.getState().tier ?? tier]) useSite.getState().setTier(t)
        }),
      )
    }
    this.armStageC()
  }

  // -------------------------------------------------- stage C triggers

  private armStageC(): void {
    if (this.closed || this.cStarted) return
    const go = (why: string) => void this.startC(why)
    if (!IDLE_OFF) {
      if (typeof requestIdleCallback === 'function') {
        const id = requestIdleCallback(() => go('idle'), { timeout: 1500 })
        this.cleanups.push(() => cancelIdleCallback(id))
      } else {
        const id = setTimeout(() => go('idle'), 1500)
        this.cleanups.push(() => clearTimeout(id))
      }
    }
    const poll = setInterval(() => {
      if (globeState.lod.zoom01 > 0.1) go('zoom')
      else if (globeState.travelIn > 0.3) go('travel')
    }, 250)
    this.cleanups.push(() => clearInterval(poll))
  }

  requestStageC(): void {
    if (this.bReady) void this.startC('request')
  }

  private async startC(why: string): Promise<void> {
    if (this.closed || this.cStarted || !this.plan) return
    this.cStarted = true
    note('stageC-trigger', { why, zoom01: globeState.lod.zoom01, travelIn: globeState.travelIn })
    const refs = this.plan.C.filter((r) => !(r.kind === 'treeDensity' && globeState.isPhone))
    const res = await Promise.allSettled(refs.map((r, i) => this.load(r, 200 + i)))
    if (this.closed) return
    const ok: Loaded[] = []
    let failed = 0
    res.forEach((r, i) => {
      if (r.status === 'fulfilled') ok.push(r.value)
      else if (!isAbort(r.reason, this.ctrl.signal)) {
        failed++
        reportError(`stage C ${refs[i].key}`, r.reason)
      }
    })
    if (this.closed) return
    this.publish(ok, failed ? null : 'C')
    // Köppen stays on demand only (C3 spec; INT decision): no idle prefetch after C
  }

  // -------------------------------------------------- Köppen (on demand)

  private watchKoppen(): void {
    if (useSite.getState().mapMode === 'climate') void this.koppen('climate')
    const unsub = useSite.subscribe((s, p) => {
      if (s.mapMode === 'climate' && p.mapMode !== 'climate') void this.koppen('climate')
    })
    this.cleanups.push(unsub)
  }

  koppen(why: string): Promise<void> {
    if (!this.koppenP) {
      this.koppenP = (async () => {
        note('koppen-trigger', { why })
        let m: TerrainManifest
        try {
          m = await getTerrainManifest()
        } catch (e) {
          reportError('manifest', e)
          return
        }
        const plan = this.plan ?? stagePlan(m, this.tier)
        const base = 150
        try {
          const got = await Promise.all(plan.onDemand.map((r, i) => this.load(r, base + i)))
          if (this.closed) return
          this.publish(got, null)
          note('koppen-ready', {})
        } catch (e) {
          if (isAbort(e, this.ctrl.signal)) return
          this.koppenP = null // allow a later retry
          reportError('koppen', e)
        }
      })()
    }
    return this.koppenP
  }

  // -------------------------------------------------- loading one manifest entry

  /** load one entry; entries with the same payload (refId) share one fetch + texture */
  private load(r: LayerRef, prio: number): Promise<Loaded> {
    const id = refId(r)
    let p = this.inflight.get(id)
    if (!p) {
      p = this.build(r, prio, id)
      this.inflight.set(id, p)
      p.catch(() => this.inflight.delete(id))
    }
    return p.then((l) => (l.ref === r ? l : { ref: r, tex: l.tex }))
  }

  private async build(r: LayerRef, prio: number, id: string): Promise<Loaded> {
    const signal = this.ctrl.signal
    const onBytes = (n: number) => progress.bytes(id, n)
    const t0 = performance.now()
    const done = (extra: Record<string, unknown> = {}) => {
      progress.done(id)
      note('built', { key: r.key, ms: Math.round(performance.now() - t0), ...extra })
    }

    if (r.kind === 'json') {
      await fetchJson(r.asset, prio, onBytes)
      done()
      return { ref: r }
    }
    if (r.kind === 'heightGrid') {
      if (heightGridUrl !== r.asset.url) {
        const f = await fetchBytes(r.asset.url, { prio, signal, onBytes })
        if (r.asset.format === 'webp') {
          // INT-B: metres packed hi/lo in R/G of a lossless WebP (0.68 MB vs 4.2 MB raw u16)
          const { w, h, data } = await decodeRGBA(new Blob([f.buf], { type: 'image/webp' }))
          if (w !== r.asset.w || h !== r.asset.h) throw new Error(`heightGrid: ${w}x${h}, manifest says ${r.asset.w}x${r.asset.h}`)
          const out = new Uint8Array(w * h * 2)
          for (let i = 0, j = 0; i < w * h; i++, j += 4) {
            out[i * 2] = data[j + 1] // little-endian: low byte (G) first
            out[i * 2 + 1] = data[j]
          }
          setHeightGrid(w, h, out.buffer)
        } else {
          setHeightGrid(r.asset.w, r.asset.h, f.buf)
        }
        heightGridUrl = r.asset.url
      }
      done()
      return { ref: r }
    }
    if (r.kind === 'treeDensity') {
      await fetchTreeBlob(r.asset, prio, signal, onBytes)
      done()
      return { ref: r }
    }

    const reuse = findPublished(id)
    if (reuse) {
      done({ reused: true })
      return { ref: r, tex: reuse }
    }

    let tex: Texture
    const maxAniso = this.gl.capabilities.getMaxAnisotropy()
    if (r.kind === 'equirect') {
      const f = await fetchBytes(r.layer.url, { prio, signal, onBytes })
      const srgb = r.layer.colorSpace === 'srgb'
      tex = await equirectFromBlob(new Blob([f.buf], { type: f.type }), {
        srgb,
        name: r.key,
        anisotropy: srgb ? Math.min(8, maxAniso) : 1,
      })
    } else if (r.kind === 'faces') {
      const L = r.layer
      const got = new Array<number>(6).fill(0)
      const blobs = await Promise.all(
        L.faces.map((u, fi) =>
          fetchBytes(u, {
            prio: prio + fi * 0.01,
            signal,
            onBytes: (n) => {
              got[fi] = n
              progress.bytes(id, got[0] + got[1] + got[2] + got[3] + got[4] + got[5])
            },
          }).then((f) => new Blob([f.buf], { type: f.type })),
        ),
      )
      const filter = L.filter ?? 'linear'
      if (L.upload === 'R8') {
        tex = await r8CubeFromBlobs(blobs, { mips: filter !== 'nearest' && L.mips !== false, filter, faceSize: L.faceSize, name: r.key })
      } else {
        tex = await dataCubeFromBlobs(blobs, {
          filter,
          mips: filter !== 'nearest' && L.mips !== false,
          faceSize: L.faceSize,
          name: r.key,
        })
      }
      if (L.colorSpace === 'srgb') {
        console.warn(`[terrain] ${r.key}: a face cube declared srgb; uploading as sRGB per the manifest`)
        tex.colorSpace = SRGBColorSpace
      }
    } else {
      // KTX2 (ETC1S / UASTC): fetch here (queue, progress, retries), transcode in the shared loader's workers
      const f = await fetchBytes(r.layer.url, { prio, signal, onBytes })
      if (this.warm) await this.warm
      if (signal.aborted) throw new DOMException('aborted', 'AbortError')
      const k = await parseKtx2(f.buf, r.layer.codec)
      const want = r.kind === 'ktx2cube' ? 'isCompressedCubeTexture' : 'isCompressedArrayTexture'
      if (!(k as unknown as Record<string, boolean>)[want]) {
        k.dispose()
        throw new Error(`${r.key}: KTX2 is not a ${r.kind === 'ktx2cube' ? 'cube (faceCount 6)' : '2D array'}`)
      }
      const wantCs = r.layer.colorSpace === 'srgb' ? SRGBColorSpace : NoColorSpace
      const fileSrgb = k.colorSpace === SRGBColorSpace
      if (fileSrgb !== (wantCs === SRGBColorSpace)) {
        console.warn(`[terrain] ${r.key}: KTX2 DFD colour space is ${k.colorSpace || 'none'}, manifest says ${r.layer.colorSpace}; using the manifest`)
      }
      k.colorSpace = wantCs // linear KTX2 data (detail) reads as LinearSRGB from the DFD; data is NoColorSpace (R1)
      k.flipY = false
      k.premultiplyAlpha = false
      k.name = r.key
      if (r.kind === 'ktx2array') {
        k.wrapS = RepeatWrapping // detail tiles both axes
        k.wrapT = RepeatWrapping
        k.anisotropy = Math.min(4, maxAniso)
      } else if (wantCs === SRGBColorSpace) {
        k.anisotropy = Math.min(8, maxAniso)
      }
      const levels = (k as unknown as CompressedCubeTexture).isCompressedCubeTexture
        ? (k as unknown as { image: { mipmaps: unknown[] }[] }).image[0].mipmaps.length
        : (k.mipmaps?.length ?? 1)
      if (r.layer.mips && levels <= 1) console.warn(`[terrain] ${r.key}: manifest says mipmapped but the KTX2 has one level`)
      k.minFilter = levels > 1 ? LinearMipmapLinearFilter : LinearFilter
      k.magFilter = LinearFilter
      tex = k
    }
    if (signal.aborted) {
      disposeTexture(tex)
      throw new DOMException('aborted', 'AbortError')
    }
    idOfTex.set(tex, id)
    done({ kind: r.kind })
    return { ref: r, tex }
  }

  // -------------------------------------------------- publishing

  private publish(items: Loaded[], stage: 'A' | 'B' | 'C' | null): void {
    const replaced: Texture[] = []
    const t = terrainTextures as Record<string, unknown>
    let uploadMs = 0
    for (const it of items) {
      const tex = it.tex
      if (!tex || !('field' in it.ref)) continue
      const field = it.ref.field
      const old = texOf(field)
      if (old !== tex) {
        const u = performance.now()
        this.gl.initTexture(tex) // upload now (known hitch time) rather than on first draw
        uploadMs += performance.now() - u
      }
      if (field === 'preview.albedo') this.previewParts.albedo = tex
      else if (field === 'preview.data') this.previewParts.data = tex
      else t[field] = tex
      if (old && old !== tex) replaced.push(old)
    }
    if (stage === 'A' || (this.previewParts.albedo && this.previewParts.data && !terrainTextures.preview)) {
      const { albedo, data } = this.previewParts
      if (albedo && data) {
        const prev = terrainTextures.preview
        terrainTextures.preview = { albedo, data }
        if (prev) replaced.push(prev.albedo, prev.data)
      } else if (stage === 'A') {
        console.warn('[terrain] stage A did not provide both preview.albedo and preview.data')
      }
    }
    if (stage === 'B' && this.plan) {
      // fields this tier never fills (e.g. heightHi after HIGH -> MID, every cube after -> LOW) go now;
      // same-named fields from the old tier stay until this tier's own stage replaces them
      const allowed = new Set<string>(
        [...this.plan.B, ...this.plan.C, ...this.plan.onDemand].flatMap((r) => ('field' in r ? [r.field] : [])),
      )
      for (const k of Object.keys(t)) {
        if (k === 'preview' || allowed.has(k) || !t[k]) continue
        replaced.push(t[k] as Texture)
        delete t[k]
      }
    }
    emitTerrainTextures()
    disposeUnreferenced(replaced)
    note('publish', { stage: stage ?? 'extra', keys: items.map((i) => i.ref.key), uploadMs: Math.round(uploadMs) })
    if (stage) this.reach(stage)
    publishVram()
  }

  releasePreview(): void {
    const p = terrainTextures.preview
    if (!p) return
    delete terrainTextures.preview
    this.previewParts = {}
    emitTerrainTextures()
    disposeUnreferenced([p.albedo, p.data])
    note('release-preview', {})
    publishVram()
  }
}

// ---------------------------------------------------------------- lifecycle

let active: Session | null = null
let teardownTimer: ReturnType<typeof setTimeout> | null = null

function fullTeardown(): void {
  const all = referenced()
  for (const k of Object.keys(terrainTextures) as (keyof TerrainTextures)[]) delete terrainTextures[k]
  emitTerrainTextures()
  disposeUnreferenced(all)
  setStage('none')
  publishVram()
  note('teardown', {})
}

function handleFor(s: Session): TerrainLoadingHandle {
  let released = false
  return {
    tier: s.tier,
    whenStage: (st) => s.whenStage(st),
    requestStageC: () => s.requestStageC(),
    requestKoppen: () => s.koppen('request'),
    releasePreview: () => s.releasePreview(),
    dispose: () => {
      if (released) return
      released = true
      s.refs--
      if (s.refs > 0) return
      if (teardownTimer) clearTimeout(teardownTimer)
      teardownTimer = setTimeout(() => {
        teardownTimer = null
        if (active !== s || s.refs > 0) return
        s.stop()
        active = null
        fullTeardown()
      }, 200)
    },
  }
}

/**
 * Start (or join) loading for this renderer and tier. Same gl + tier joins the running
 * loader (ref-counted). A different tier replaces it: in-flight work is aborted, already
 * published textures stay on screen until the new tier's stage B replaces or drops them.
 */
export function startTerrainLoading(gl: WebGLRenderer, tier: Tier): TerrainLoadingHandle {
  if (teardownTimer) {
    clearTimeout(teardownTimer)
    teardownTimer = null
  }
  if (active && !active.closed && active.gl === gl && active.tier === tier) {
    active.refs++
    return handleFor(active)
  }
  const prev = active
  const s = new Session(gl, tier, prev?.tier ?? null) // acquires the KTX2 loader before prev releases it
  if (prev) prev.stop()
  if (prev && prev.gl !== gl) fullTeardown()
  active = s
  s.refs = 1
  void s.run()
  return handleFor(s)
}

/** Load the Köppen layers for the running loader (no-op without one). */
export function requestKoppen(): Promise<void> {
  return active && !active.closed ? active.koppen('request') : Promise.resolve()
}

// ---------------------------------------------------------------- debug (?debug=1 / DEV)

function texInfo(t: Texture | undefined): Record<string, unknown> | null {
  if (!t) return null
  const ctor =
    (t as CompressedCubeTexture).isCompressedCubeTexture ? 'CompressedCubeTexture'
    : (t as CompressedArrayTexture).isCompressedArrayTexture ? 'CompressedArrayTexture'
    : (t as CubeTexture).isCubeTexture ? 'CubeTexture'
    : 'Texture'
  let size: number[] = []
  let faceKind = ''
  if (ctor === 'CompressedCubeTexture') {
    const f = (t as unknown as { image: { width: number; height: number; mipmaps: unknown[] }[] }).image[0]
    size = [f.width, f.height]
    faceKind = `${f.mipmaps.length} mips`
  } else if (ctor === 'CompressedArrayTexture') {
    const img = t.image as { width: number; height: number; depth: number }
    size = [img.width, img.height, img.depth]
    faceKind = `${t.mipmaps?.length ?? 0} mips`
  } else if (ctor === 'CubeTexture') {
    const f = (t.image as unknown as { width?: number; height?: number; isDataTexture?: boolean; image?: { width: number; height: number } }[])[0]
    size = [f.image?.width ?? f.width ?? 0, f.image?.height ?? f.height ?? 0]
    faceKind = f.isDataTexture ? 'DataTexture faces' : f instanceof ImageBitmap ? 'ImageBitmap faces' : typeof f
  } else {
    const img = t.image as { width: number; height: number }
    size = [img.width, img.height]
    faceKind = t.image instanceof ImageBitmap ? 'ImageBitmap' : typeof t.image
  }
  return {
    ctor,
    name: t.name,
    size,
    faceKind,
    colorSpace: t.colorSpace || 'none',
    flipY: t.flipY,
    premultiplyAlpha: t.premultiplyAlpha,
    format: t.format,
    type: t.type,
    minFilter: t.minFilter,
    magFilter: t.magFilter,
    generateMipmaps: t.generateMipmaps,
    wrapS: t.wrapS,
    wrapT: t.wrapT,
    anisotropy: t.anisotropy,
    unpackAlignment: t.unpackAlignment,
    bytes: Math.round(texBytes(t)),
  }
}

function debugState(): Record<string, unknown> {
  const tex: Record<string, unknown> = {}
  tex['preview.albedo'] = texInfo(terrainTextures.preview?.albedo)
  tex['preview.data'] = texInfo(terrainTextures.preview?.data)
  for (const k of Object.keys(terrainTextures) as (keyof TerrainTextures)[]) {
    if (k !== 'preview') tex[k] = texInfo(terrainTextures[k] as Texture | undefined)
  }
  return {
    tier: active?.tier ?? null,
    stage: globeState.stage,
    loadProgress: globeState.loadProgress,
    progressTrace: progress.trace.slice(),
    log: log.slice(),
    textures: tex,
    vram: vramReport(),
    ktx2: ktx2Support(),
    queue: { inFlight, waiting: waiting.length },
  }
}

/**
 * GPU readback: sample a published texture at coords and return RGBA 0..255 rows.
 * Cube: [x, y, z, lod]; 2D: [u, v, 0, lod]; array: [u, v, layer, lod]. sRGB textures
 * come back LINEAR (hardware decode); data textures raw.
 */
function gpuSample(field: string, coords: number[][]): number[][] {
  const gl = active?.gl
  const tex = texOf(field as TextureField)
  if (!gl || !tex) throw new Error(`terrainSample: no renderer or no texture '${field}'`)
  const n = coords.length
  const dirs = new Float32Array(n * 4)
  coords.forEach((c, i) => dirs.set([c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, c[3] ?? 0], i * 4))
  const dirTex = new DataTexture(dirs, n, 1, RGBAFormat, FloatType)
  dirTex.minFilter = NearestFilter
  dirTex.magFilter = NearestFilter
  dirTex.needsUpdate = true
  const isCube = (tex as CubeTexture).isCubeTexture || (tex as CompressedCubeTexture).isCompressedCubeTexture
  const isArr = (tex as CompressedArrayTexture).isCompressedArrayTexture
  const sampler = isCube ? 'samplerCube' : isArr ? 'sampler2DArray' : 'sampler2D'
  const lookup = isCube || isArr ? 'textureLod(uTex, d.xyz, d.w)' : 'textureLod(uTex, d.xy, d.w)'
  const mat = new ShaderMaterial({
    glslVersion: GLSL3,
    uniforms: { uTex: { value: tex }, uDirs: { value: dirTex } },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `precision highp float;
precision highp sampler2DArray;
uniform ${sampler} uTex;
uniform highp sampler2D uDirs;
layout(location = 0) out highp vec4 pc_fragColor;
void main() {
  vec4 d = texelFetch(uDirs, ivec2(int(gl_FragCoord.x), 0), 0);
  pc_fragColor = ${lookup};
}`,
    depthTest: false,
    depthWrite: false,
  })
  const geo = new PlaneGeometry(2, 2)
  const mesh = new Mesh(geo, mat)
  mesh.frustumCulled = false
  const scene = new Scene()
  scene.add(mesh)
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const rt = new WebGLRenderTarget(n, 1, { type: UnsignedByteType, format: RGBAFormat, depthBuffer: false })
  const prevTarget = gl.getRenderTarget()
  const out = new Uint8Array(n * 4)
  try {
    gl.setRenderTarget(rt)
    gl.render(scene, cam)
    gl.readRenderTargetPixels(rt, 0, 0, n, 1, out)
  } finally {
    gl.setRenderTarget(prevTarget)
    rt.dispose()
    mat.dispose()
    geo.dispose()
    dirTex.dispose()
  }
  const rows: number[][] = []
  for (let i = 0; i < n; i++) rows.push(Array.from(out.subarray(i * 4, i * 4 + 4)))
  return rows
}

if (debugEnabled) {
  registerDebug('terrain', debugState)
  registerDebug('terrainSample', gpuSample)
  registerDebug('terrainVramEstimate', async (tier: Tier) => estimateTierVram(await getTerrainManifest(), tier))
  registerDebug('terrainRequestStageC', () => active?.requestStageC())
  registerDebug('terrainRequestKoppen', () => requestKoppen())
}
