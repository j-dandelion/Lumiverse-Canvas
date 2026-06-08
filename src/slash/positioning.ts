// Popup positioning and viewport listener management for the slash-command
// suggest panel. Extracted from suggest.ts to isolate pure coordinate math
// and scroll/resize repositioning from the rendering/selection logic.

export const VIEWPORT_MARGIN = 8  // keep the popup this many px from the viewport edge

/**
 * Position the popup element relative to the anchor (textarea).
 * Sits above the anchor when there's room, below otherwise.
 * Clamps left/right so the popup never clips off the viewport edges.
 */
export function position(el: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect()
  // Sit just above the textarea (the standard "autocomplete" position).
  // If there's not enough room above, sit below.
  const spaceAbove = rect.top
  const elHeight = el.offsetHeight
  const top = spaceAbove > elHeight + VIEWPORT_MARGIN ? rect.top - elHeight - 4 : rect.bottom + 4
  el.style.top = `${top}px`
  // Clamp the left edge so the popup never clips off the right side of the
  // viewport (or off the left, in case the textarea is near x=0). The popup
  // width is bounded by CSS `max-width: min(420px, calc(100vw - 16px))` so
  // `el.offsetWidth` is a safe upper bound for what we need to fit.
  const elWidth = el.offsetWidth
  const maxLeft = window.innerWidth - elWidth - VIEWPORT_MARGIN
  el.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft))}px`
  el.style.minWidth = `${rect.width}px`
}

/**
 * Attach viewport scroll/resize listeners that reposition the popup.
 * Uses getter functions to avoid duplicating the anchor/el state — the
 * callers (suggest.ts) own the canonical references.
 */
export function attachViewportListeners(
  getAnchor: () => HTMLElement | null,
  getEl: () => HTMLElement | null,
): void {
  if (!visualViewportListener) {
    visualViewportListener = () => {
      const anchor = getAnchor()
      const el = getEl()
      if (anchor && el) position(el, anchor)
    }
    window.visualViewport?.addEventListener('resize', visualViewportListener)
  }
  if (!scrollListener) {
    scrollListener = () => {
      const anchor = getAnchor()
      const el = getEl()
      if (anchor && el) position(el, anchor)
    }
    window.addEventListener('scroll', scrollListener, true)
  }
  if (!resizeListener) {
    resizeListener = () => {
      const anchor = getAnchor()
      const el = getEl()
      if (anchor && el) position(el, anchor)
    }
    window.addEventListener('resize', resizeListener)
  }
}

/** Detach all viewport scroll/resize listeners. */
export function detachViewportListeners(): void {
  if (visualViewportListener) {
    window.visualViewport?.removeEventListener('resize', visualViewportListener)
    visualViewportListener = null
  }
  if (scrollListener) {
    window.removeEventListener('scroll', scrollListener, true)
    scrollListener = null
  }
  if (resizeListener) {
    window.removeEventListener('resize', resizeListener)
    resizeListener = null
  }
}

// --- module state ---

let visualViewportListener: (() => void) | null = null
let scrollListener: (() => void) | null = null
let resizeListener: (() => void) | null = null
