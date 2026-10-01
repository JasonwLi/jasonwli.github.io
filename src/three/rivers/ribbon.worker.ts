/**
 * River ribbon worker (C6): builds the ribbon strip once, off the main thread, and
 * transfers the typed arrays back. Created by RiverRibbons with
 * new Worker(new URL('./ribbon.worker.ts', import.meta.url), { type: 'module' }).
 */
import { buildRibbons, type RibbonOptions, type RiverIn } from './buildRibbons'

export interface RibbonRequest {
  rivers: RiverIn[]
  opts: Partial<RibbonOptions>
}

interface WorkerScope {
  onmessage: ((e: MessageEvent<RibbonRequest>) => void) | null
  postMessage(msg: unknown, transfer: Transferable[]): void
}
const scope = self as unknown as WorkerScope

scope.onmessage = (e) => {
  try {
    const b = buildRibbons(e.data.rivers, e.data.opts)
    scope.postMessage({ ok: true, build: b }, [b.dir.buffer, b.off.buffer, b.meta.buffer, b.index.buffer])
  } catch (err) {
    scope.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) }, [])
  }
}
