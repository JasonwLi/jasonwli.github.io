/**
 * Quality tier probe + frame-time monitor (F0, then C2a). Lives in the entry chunk,
 * so it stays tiny and imports nothing heavy.
 *
 * - ?tier=low|mid|high overrides everything (and disables the perf monitor unless
 *   ?perfmon=1 is also present: a debug aid for testing the downgrade path).
 * - Also sets globeState.isPhone (pointer:coarse && min(w,h) < 600).
 * - LOW when: no WebGL2, Save-Data, slow effective connection, prefers-reduced-data,
 *   MAX_CUBE_MAP_TEXTURE_SIZE < 2048, deviceMemory <= 2, or a software renderer.
 * - A downgrade recorded this session (sessionStorage 'globeTierDowngrade') caps the
 *   probe: the tier never steps back up after the monitor stepped it down.
 * Headless Chrome (SwiftShader) probes as LOW: automated checks pass tier= explicitly.
 */
import type { WebGLRenderer } from 'three'
import { globeState, type Tier } from './globeState'

export const TIER_DPR: Record<Tier, [number, number]> = { low: [1, 1.5], mid: [1, 1.75], high: [1, 2] }

export const TIER_RANK: Record<Tier, number> = { low: 0, mid: 1, high: 2 }
const BY_RANK: Tier[] = ['low', 'mid', 'high']

/** The next lower tier (low stays low). */
export function lowerTier(t: Tier): Tier {
  return BY_RANK[Math.max(0, TIER_RANK[t] - 1)]
}

/** min(a, b) in tier order. */
export function minTier(a: Tier, b: Tier): Tier {
  return TIER_RANK[a] <= TIER_RANK[b] ? a : b
}

const DOWNGRADE_KEY = 'globeTierDowngrade'

interface NavigatorExtras {
  connection?: { saveData?: boolean; effectiveType?: string }
  deviceMemory?: number
}

function mq(q: string): boolean {
  try {
    return window.matchMedia(q).matches
  } catch {
    return false
  }
}

function param(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name)
  } catch {
    return null
  }
}

export function tierOverride(): Tier | null {
  const q = param('tier')
  return q === 'low' || q === 'mid' || q === 'high' ? q : null
}

export function detectPhone(): boolean {
  return mq('(pointer: coarse)') && Math.min(window.innerWidth, window.innerHeight) < 600
}

/** The downgrade the perf monitor recorded this session, if any. */
export function persistedDowngrade(): Tier | null {
  try {
    const v = window.sessionStorage.getItem(DOWNGRADE_KEY)
    return v === 'low' || v === 'mid' || v === 'high' ? v : null
  } catch {
    return null
  }
}

function persistDowngrade(t: Tier): void {
  try {
    window.sessionStorage.setItem(DOWNGRADE_KEY, t)
  } catch {
    /* storage blocked: the downgrade still applies for this page view */
  }
}

/** Device probe without overrides or the session cap (exported for diagnostics). */
export function probeDeviceTier(gl: WebGLRenderer): Tier {
  const nav = navigator as Navigator & NavigatorExtras
  const ctx = gl.getContext()
  const webgl2 = typeof WebGL2RenderingContext !== 'undefined' && ctx instanceof WebGL2RenderingContext
  const maxCube = ctx.getParameter(ctx.MAX_CUBE_MAP_TEXTURE_SIZE) as number
  let renderer = ''
  const dbg = ctx.getExtension('WEBGL_debug_renderer_info')
  if (dbg) renderer = String(ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? '')
  const mem = nav.deviceMemory
  const conn = nav.connection
  const cores = navigator.hardwareConcurrency || 8

  if (
    !webgl2 ||
    conn?.saveData ||
    (conn?.effectiveType && /^(slow-2g|2g|3g)$/.test(conn.effectiveType)) ||
    mq('(prefers-reduced-data: reduce)') ||
    maxCube < 2048 ||
    (mem !== undefined && mem <= 2) ||
    /SwiftShader|llvmpipe|Software/i.test(renderer)
  ) {
    return 'low'
  }
  if (mq('(pointer: coarse)') || (mem !== undefined && mem <= 4) || cores <= 4 || maxCube < 4096) {
    return 'mid'
  }
  return 'high'
}

export function probeTier(gl: WebGLRenderer): Tier {
  globeState.isPhone = detectPhone()
  const forced = tierOverride()
  if (forced) return forced
  const probed = probeDeviceTier(gl)
  const capped = persistedDowngrade()
  return capped ? minTier(probed, capped) : probed
}

/** Frame-time thresholds (median ms over the sample window) that trigger a step down. */
export const PERF_DOWNGRADE_MS: Record<Tier, number> = { high: 22, mid: 30, low: Infinity }
const SAMPLE_FRAMES = 120
const SETTLE_FRAMES = 30 // skip shader-compile / upload hitches right after stage B

/** true when the monitor may run: no ?tier= override, unless ?perfmon=1 forces it (debug). */
export function perfMonitorEnabled(): boolean {
  return tierOverride() === null || param('perfmon') === '1'
}

/**
 * Frame-time monitor that may step the tier DOWN (never up). Call it once stage B
 * is on screen; it skips SETTLE_FRAMES, then samples SAMPLE_FRAMES visible frames
 * and, when the median dt exceeds PERF_DOWNGRADE_MS[globeState.tier], records the
 * downgrade in sessionStorage and calls onDowngrade(next lower tier). One-shot: the
 * remounted terrain (new tier) starts a fresh monitor. Returns a stop function.
 * Disabled (no-op) under ?tier= unless ?perfmon=1.
 */
export function startPerfMonitor(onDowngrade: (t: Tier) => void): () => void {
  if (typeof window === 'undefined' || !perfMonitorEnabled()) return () => {}
  let stopped = false
  let raf = 0
  let last = -1
  let seen = 0
  const dts: number[] = []

  const frame = (now: number) => {
    if (stopped) return
    if (document.hidden) {
      last = -1 // a hidden tab throttles rAF; never count those gaps
    } else {
      if (last >= 0) {
        const dt = now - last
        seen++
        if (seen > SETTLE_FRAMES && dt < 1000) dts.push(dt)
      }
      last = now
    }
    if (dts.length >= SAMPLE_FRAMES) {
      stopped = true
      dts.sort((a, b) => a - b)
      const median = dts[dts.length >> 1]
      const cur = globeState.tier
      const limit = PERF_DOWNGRADE_MS[cur]
      perfLog.push({ tier: cur, medianMs: Math.round(median * 10) / 10, limitMs: limit, frames: dts.length })
      if (median > limit && cur !== 'low') {
        const next = lowerTier(cur)
        persistDowngrade(next)
        onDowngrade(next)
      }
      return
    }
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
  return () => {
    stopped = true
    cancelAnimationFrame(raf)
  }
}

/** Results of completed monitor windows (read by debug tooling). */
export const perfLog: { tier: Tier; medianMs: number; limitMs: number; frames: number }[] = []
