/**
 * Style injector: creates <style id> on first call; on later calls with the
 * same id, refreshes textContent when the CSS string changed so soft reloads
 * pick up rule fixes (active !important, host-hide transform, etc.).
 */
export function injectStyles(id: string, css: string): void {
  if (typeof document === 'undefined' || !document.head) return
  const existing = document.getElementById?.(id) as HTMLStyleElement | null
  if (existing) {
    if (existing.textContent !== css) existing.textContent = css
    return
  }
  const style = document.createElement('style')
  style.id = id
  style.textContent = css
  document.head.appendChild(style)
}
