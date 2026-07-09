/** Idempotent style injector: appends <style> to <head> if id not present. */
export function injectStyles(id: string, css: string): void {
  if (typeof document === 'undefined' || !document.head) return
  if (document.getElementById?.(id)) return
  const style = document.createElement('style')
  style.id = id
  style.textContent = css
  document.head.appendChild(style)
}
