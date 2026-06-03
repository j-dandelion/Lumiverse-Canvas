// Background-event logs go through dlog()/dwarn(), which are no-ops when
// DEBUG is false. The flag is now driven by the user-facing settings panel
// (`CanvasSettings.debugMode`); the legacy `localStorage.sidebarUxDebug`
// shim is kept as a read-only fallback so an old tab without a hydrated
// settings state still respects the previous escape hatch.
let DEBUG: boolean = (() => {
  try {
    return localStorage.getItem('sidebarUxDebug') === '1'
  } catch {
    return false
  }
})()

export function getDebug(): boolean { return DEBUG }
export function setDebug(value: boolean): void { DEBUG = value }

export function dlog(...args: unknown[]): void {
  if (!DEBUG) return
  // eslint-disable-next-line no-console
  console.log('[Canvas]', ...args)
}

export function dwarn(...args: unknown[]): void {
  if (!DEBUG) return
  // eslint-disable-next-line no-console
  console.warn('[Canvas]', ...args)
}
