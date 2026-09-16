/**
 * Start-menu open/close motion (spec §4.4.3: short fade/scale-in ~120–150 ms).
 *
 * Windows-style: the menu surface scales about the invoking Start button's
 * CENTER — an external `transform-origin` — so it appears to grow out of the
 * button while fading in, and to collapse back into it while fading out.
 * A single scale property produces both the movement and the size change.
 *
 * Coordinate contract (do not break): the menu is a direct <body> child and
 * the host applies `body > * { zoom: var(--lumiverse-ui-scale, 1) }`
 * (Lumiverse theme/reset.css). getBoundingClientRect()/window.inner* are
 * RENDERED px; inline left/top and transform-origin are LAYOUT px
 * (layout × scale = rendered). Every rendered delta therefore divides by the
 * UI scale — same pattern as context-menu/index.ts clampMenuToViewport.
 *
 * Mechanism: Web Animations API. The requirement is an *interruptible*
 * animation (rapid toggle: close mid-open must continue from the current
 * visual state, not pop) with a dynamically computed origin; WAAPI gives
 * cancel/fill/computed-state natively. Everything is guarded so reduced-motion
 * users and DOM-less environments get the instant path.
 */

import { prefersReducedMotion } from '../dom/motion-prefs'

/** Re-exported for existing consumers/tests (shared `dom/motion-prefs` leaf). */
export { prefersReducedMotion }

/** Open duration — spec range is 120–150 ms. */
export const START_MENU_OPEN_MS = 150
/** Close duration — a touch faster than open (dismissals should feel snappy). */
export const START_MENU_CLOSE_MS = 120
/** Start/end scale — the repo's popup token (`contextMenuIn` uses 0.92). */
export const START_MENU_SCALE = 0.92
/** easeOutCubic — the same curve as `easeOutCubic()` in sidebar/animation.ts. */
export const START_MENU_EASE_OUT = 'cubic-bezier(0.215, 0.61, 0.355, 1)'
/** Accelerating close (darts back toward the button). */
export const START_MENU_EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)'
/** Belt-and-braces removal if `onfinish` is starved (background-tab rAF). */
const CLOSE_FALLBACK_MS = START_MENU_CLOSE_MS + 100

export interface RectLike {
  left: number
  top: number
  width: number
  height: number
}

/** Visual state captured from a possibly-mid-animation menu. */
export interface MenuVisualState {
  opacity: string
  transform: string
}

/**
 * Host UI zoom. Rendered px = layout px × scale. Returns 1 when the var,
 * `document` or `getComputedStyle` is unavailable/unparseable.
 */
export function getUiScale(): number {
  if (typeof document === 'undefined' || !document.documentElement) return 1
  if (typeof getComputedStyle !== 'function') return 1
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(
      '--lumiverse-ui-scale',
    )
    const n = parseFloat(raw)
    return Number.isFinite(n) && n > 0 ? n : 1
  } catch {
    return 1
  }
}

/**
 * Button-center growth anchor in the menu's LOCAL (layout) coordinates.
 * Intentionally allowed outside the menu box: scaling about an external point
 * moves + shrinks the surface toward the button (the Windows collapse look).
 */
export function computeGrowthOrigin(
  button: RectLike,
  menu: RectLike,
  uiScale = 1,
): { x: number; y: number } {
  const s = Number.isFinite(uiScale) && uiScale > 0 ? uiScale : 1
  return {
    x: (button.left + button.width / 2 - menu.left) / s,
    y: (button.top + button.height / 2 - menu.top) / s,
  }
}

/** True when the environment cannot run WAAPI (DOM-less / stubbed tests). */
export function canAnimateMenu(menu: HTMLElement): boolean {
  return typeof (menu as { animate?: unknown }).animate === 'function'
}



/**
 * Current visual state of a possibly-mid-animation menu. Call BEFORE
 * cancelling the open animation: getComputedStyle reflects the animated
 * values, while getBoundingClientRect() would fold the transform into the
 * element's rect. Falls back to the settled state when unavailable.
 */
export function captureMenuVisualState(menu: HTMLElement): MenuVisualState {
  const settled: MenuVisualState = { opacity: '1', transform: 'scale(1)' }
  if (typeof getComputedStyle !== 'function') return settled
  try {
    const cs = getComputedStyle(menu)
    return {
      opacity: cs.opacity || '1',
      transform: cs.transform && cs.transform !== 'none' ? cs.transform : 'scale(1)',
    }
  } catch {
    return settled
  }
}

/**
 * Grow the menu out of the button. Returns the in-flight Animation, or null
 * when motion is skipped (reduced-motion / no WAAPI) — in which case the menu
 * simply shows at its settled state.
 */
export function playMenuIn(
  menu: HTMLElement,
  origin: { x: number; y: number },
): Animation | null {
  if (!canAnimateMenu(menu) || prefersReducedMotion()) return null
  menu.style.transformOrigin = `${origin.x}px ${origin.y}px`
  return menu.animate(
    [
      { opacity: 0, transform: `scale(${START_MENU_SCALE})` },
      { opacity: 1, transform: 'scale(1)' },
    ],
    { duration: START_MENU_OPEN_MS, easing: START_MENU_EASE_OUT, fill: 'both' },
  )
}

/**
 * Collapse the menu toward the button. `from` is the state captured before
 * the open animation was cancelled (seamless interrupt). `onDone` fires
 * exactly once — synchronously when motion is skipped, on finish otherwise,
 * with a timeout fallback for starved rAF. Cancel never fires `onDone`
 * (immediate disposal owns the removal).
 */
export function playMenuOut(
  menu: HTMLElement,
  origin: { x: number; y: number },
  from: MenuVisualState,
  onDone: () => void,
): Animation | null {
  if (!canAnimateMenu(menu) || prefersReducedMotion()) {
    onDone()
    return null
  }
  menu.style.transformOrigin = `${origin.x}px ${origin.y}px`
  let finished = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let anim: Animation | null = null
  const finish = () => {
    if (finished) return
    finished = true
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    onDone()
  }
  timer = setTimeout(finish, CLOSE_FALLBACK_MS)
  anim = menu.animate(
    [
      { opacity: from.opacity, transform: from.transform },
      { opacity: 0, transform: `scale(${START_MENU_SCALE})` },
    ],
    { duration: START_MENU_CLOSE_MS, easing: START_MENU_EASE_IN, fill: 'both' },
  )
  anim.onfinish = () => {
    anim!.onfinish = null
    finish()
  }
  anim.oncancel = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }
  return anim
}
