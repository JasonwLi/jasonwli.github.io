/**
 * The boot shell (index.html #boot-globe): a static engraved plate painted from the HTML
 * alone, so a throttled first visit sees the steel page and the loading sphere before the
 * entry chunk arrives. GlobeScene calls this on the canvas's first rendered frame.
 */
export function dismissBootShell(): void {
  const el = document.getElementById('boot-globe') as (HTMLElement & { _obs?: MutationObserver }) | null
  if (!el) return
  el._obs?.disconnect()
  el.classList.add('is-out')
  window.setTimeout(() => el.remove(), 400)
}
