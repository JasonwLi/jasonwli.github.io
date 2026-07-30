// first import in main.tsx: captures early errors so automated checks can read them
declare global {
  interface Window {
    __errs: string[]
  }
}

window.__errs = []
window.addEventListener('error', (e) =>
  window.__errs.push(`${e.message} @ ${String(e.filename).split('/').pop()}:${e.lineno}`),
)
window.addEventListener('unhandledrejection', (e) =>
  window.__errs.push(`REJ: ${String((e.reason as Error)?.message ?? e.reason)}`),
)

// ?rafshim=1: drive animation frames from timers, for automated checks in
// hidden/headless windows where real rAF never fires
if (new URLSearchParams(location.search).has('rafshim')) {
  window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    window.setTimeout(() => cb(performance.now()), 16)) as typeof requestAnimationFrame
  window.cancelAnimationFrame = (id: number) => clearTimeout(id)
}

export {}

