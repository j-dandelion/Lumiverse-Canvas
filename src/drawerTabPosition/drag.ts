// Pointer-based vertical drag for drawer tabs.
//
// Each tab element gets pointerdown/pointermove/pointerup listeners that
// translate vertical mouse movement into a clamped vh offset applied as
// marginTop. On drag-end, the final vh value is committed to Canvas
// settings via the onCommit callback.
//
// The click-suppression listener is capture-phase so it fires before
// Lumiverse's React onClick handler on the main tab. It's installed
// only when a drag is in progress and removed on drag-end.
//
// Diagnostics: dlog() calls fire on every key event. Enable with
// `localStorage.setItem('sidebarUxDebug', '1')` then refresh.

import { dlog } from '../debug/log'
import { isPointerResizeActive } from '../resize/handles'

/**
 * Convert a vertical pixel delta to a clamped vh value relative to the
 * element's current position. Pure helper — exported for testing.
 *
 * @param deltaPx    Pointer delta from drag start (positive = downward)
 * @param viewportHeight  window.innerHeight in px
 * @param currentVh  The element's starting vh offset
 * @param min        Minimum allowed vh (default 0)
 * @param max        Maximum allowed vh (default 70)
 * @returns Clamped vh value
 */
export function pxToClampedVh(
  deltaPx: number,
  viewportHeight: number,
  currentVh: number,
  min = 0,
  max = 70,
): number {
  const deltaVh = (deltaPx / viewportHeight) * 100
  const newVh = currentVh + deltaVh
  return Math.round(Math.min(max, Math.max(min, newVh)) * 10) / 10
}

/**
 * Parse a CSS `marginTop` value string into a vh number.
 * Handles "12vh", "12.5vh", "12px", and bare numbers. Returns undefined
 * if the string is empty or unparseable. Pure helper — exported for testing.
 */
export function parseVhFromStyle(s: string): number | undefined {
  if (!s) return undefined
  const num = parseFloat(s)
  return isNaN(num) ? undefined : num
}

/**
 * Read the element's current vertical position in vh.
 *
 * - Inline style takes precedence (it's our own override, set in vh units).
 * - Falls back to computed style, which is always in px and needs conversion.
 *
 * This avoids the bug where parseFloat("15px") = 15 was treated as 15vh.
 */
function readCurrentVh(el: HTMLElement): number {
  const inline = el.style.marginTop
  if (inline) {
    if (inline.endsWith('vh')) return parseFloat(inline)
    if (inline.endsWith('px')) return (parseFloat(inline) / window.innerHeight) * 100
    return parseFloat(inline) // bare number — assume vh
  }
  const computed = getComputedStyle(el).marginTop
  const px = parseFloat(computed)
  if (isNaN(px)) return 0
  return (px / window.innerHeight) * 100
}

/**
 * Install vertical drag on a drawer tab element.
 *
 * @param el        The drawer tab HTMLElement
 * @param role      'main' or 'secondary' (for logging)
 * @param onCommit  Called with the final vh value on drag-end
 * @returns Teardown function that removes all listeners
 */
export function installDrawerTabDrag(
  el: HTMLElement,
  role: 'main' | 'secondary',
  onCommit: (vh: number) => void,
): () => void {
  el.setAttribute('aria-label', 'Drag to reposition')

  let startY = 0
  let currentVh = 0
  let isPointerDown = false
  let hasCrossedThreshold = false
  let dragInstalled = false

  /** Capture-phase click listener that suppresses Lumiverse's React onClick. */
  const captureClick = (e: Event) => {
    e.stopImmediatePropagation()
  }

  const onPointerDown = (e: PointerEvent) => {
    // Mobile gate: tap-only on coarse pointers — skip drag
    if (isPointerResizeActive()) {
      dlog(`[drawerTabDrag] ${role} pointerdown blocked: coarse pointer (mobile)`)
      return
    }

    e.preventDefault()
    isPointerDown = true
    hasCrossedThreshold = false
    startY = e.clientY
    currentVh = readCurrentVh(el)
    // Block text selection / native drag during the drag
    document.body.style.userSelect = 'none'
    dlog(`[drawerTabDrag] ${role} pointerdown startY=${startY} currentVh=${currentVh.toFixed(2)}vh`)
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!isPointerDown) return
    const delta = e.clientY - startY
    if (!hasCrossedThreshold) {
      if (Math.abs(delta) < 4) return
      hasCrossedThreshold = true
      // Install capture-phase click listener on first drag threshold
      if (!dragInstalled) {
        el.addEventListener('click', captureClick, true)
        dragInstalled = true
      }
      dlog(`[drawerTabDrag] ${role} drag started (delta=${delta}px)`)
    }
    const newVh = pxToClampedVh(delta, window.innerHeight, currentVh)
    el.style.marginTop = `${newVh}vh`
    el.setAttribute('aria-label', `Position: ${newVh}vh`)
    dlog(`[drawerTabDrag] ${role} move clientY=${e.clientY} delta=${delta}px newVh=${newVh}vh`)
  }

  const cleanup = () => {
    if (dragInstalled) {
      el.removeEventListener('click', captureClick, true)
      dragInstalled = false
    }
    isPointerDown = false
    hasCrossedThreshold = false
    el.setAttribute('aria-label', 'Drag to reposition')
    document.body.style.userSelect = ''
    startY = 0
  }

  const onPointerUp = () => {
    if (hasCrossedThreshold) {
      const finalVh = parseVhFromStyle(el.style.marginTop) ?? currentVh
      dlog(`[drawerTabDrag] ${role} pointerup finalVh=${finalVh}vh → onCommit`)
      onCommit(finalVh)
    } else {
      dlog(`[drawerTabDrag] ${role} pointerup (no drag, threshold not crossed)`)
    }
    cleanup()
  }

  const onPointerCancel = () => {
    dlog(`[drawerTabDrag] ${role} pointercancel`)
    cleanup()
  }

  el.addEventListener('pointerdown', onPointerDown)
  document.addEventListener('pointermove', onPointerMove)
  document.addEventListener('pointerup', onPointerUp)
  document.addEventListener('pointercancel', onPointerCancel)

  return () => {
    el.removeEventListener('pointerdown', onPointerDown)
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerup', onPointerUp)
    document.removeEventListener('pointercancel', onPointerCancel)
    cleanup()
  }
}
