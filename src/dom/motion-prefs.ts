/**
 * Platform motion preferences (shared by the drawer motion and the Start menu).
 *
 * Leaf module: no imports, no import-time DOM access. The guarded
 * `matchMedia` read is verbatim from the original Start-menu implementation —
 * the source-pin tests assert the exact guard strings.
 */

/** `prefers-reduced-motion: reduce`; false when matchMedia is unavailable. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true
  } catch {
    return false
  }
}
