// JS-based animation for Canvas drawer wrappers (secondary + main mirror).
// Uses requestAnimationFrame + easeOutCubic (350ms) — no CSS transitions,
// no counter-translate. The wrapper translates, and both the drawerTab
// and drawer (its children) move as one unit.
//
// Per-wrapper state so main and secondary can animate independently.

import { prefersReducedMotion } from '../dom/motion-prefs'

const ANIM_DURATION_MS = 350

type AnimState = {
  raf: number | null
  start: number | null
  from: number
  to: number
  onComplete: (() => void) | null
}

const _anims = new WeakMap<HTMLElement, AnimState>()

/** Test / cancel-all fallback when a single global cancel is needed. */
let _lastWrapper: HTMLElement | null = null

/** Wrappers with a live translate tween (cancel-all support). */
const _liveTranslateWrappers = new Set<HTMLElement>()

/** Wrappers with a live horizontal-strip panel bloom (see the bottom section). */
const _panelAnims = new WeakMap<HTMLElement, PanelAnimState>()
const _livePanelWrappers = new Set<HTMLElement>()

/** Parse translateX px from an inline transform (0 if absent / none). */
export function parseTranslateX(transform: string | null | undefined): number {
  if (!transform || transform === 'none') return 0
  const m = transform.match(/translateX\(\s*(-?[\d.]+)\s*px\s*\)/)
  if (m) return parseFloat(m[1]) || 0
  // Fallback: first signed number (legacy `translateX(N)` without units in tests).
  const n = transform.match(/-?[\d.]+/)
  return n ? parseFloat(n[0]) || 0 : 0
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function animFrame(wrapper: HTMLElement, state: AnimState, now: number) {
  if (state.start === null) state.start = now
  const elapsed = now - state.start
  const progress = Math.min(elapsed / ANIM_DURATION_MS, 1)
  const eased = easeOutCubic(progress)

  const val = state.from + (state.to - state.from) * eased
  wrapper.style.transform = `translateX(${val}px)`

  if (progress < 1) {
    state.raf = requestAnimationFrame((t) => animFrame(wrapper, state, t))
  } else {
    state.raf = null
    state.start = null
    _liveTranslateWrappers.delete(wrapper)
    const done = state.onComplete
    state.onComplete = null
    if (done) {
      try {
        done()
      } catch {
        /* caller errors must not break animation bookkeeping */
      }
    }
  }
}

/** Stop an in-flight translate tween without touching inline styles. */
function cancelTranslateTween(wrapper: HTMLElement): void {
  const state = _anims.get(wrapper)
  if (state?.raf != null) {
    cancelAnimationFrame(state.raf)
    state.raf = null
    state.start = null
    state.onComplete = null
  }
  _liveTranslateWrappers.delete(wrapper)
}

/** Cancel in-flight motion for a specific wrapper (or the last animated one).
 *  Cancels BOTH the translate tween and the panel bloom; the bloom reset
 *  restores the drawer's inline styles and `pointer-events: auto`. */
export function cancelWrapperAnimation(wrapper?: HTMLElement | null): void {
  const target = wrapper ?? _lastWrapper
  if (!target) return
  cancelTranslateTween(target)
  cancelPanelToggle(target)
}

/** Cancel every in-flight wrapper tween (translate + bloom). Used when the
 *  geometry the animation was targeting changes underneath it (location
 *  flips, side swaps, teardown). */
export function cancelAllWrapperAnimations(): void {
  for (const wrapper of Array.from(_liveTranslateWrappers)) cancelTranslateTween(wrapper)
  for (const wrapper of Array.from(_livePanelWrappers)) cancelPanelToggle(wrapper)
}

/** Test helper: inspect last wrapper's anim state (or a specific wrapper). */
export function __getAnimState(wrapper?: HTMLElement | null) {
  const target = wrapper ?? _lastWrapper
  if (!target) return { animRaf: null as number | null, animStart: null as number | null }
  const state = _anims.get(target)
  return {
    animRaf: state?.raf ?? null,
    animStart: state?.start ?? null,
  }
}

/**
 * Animate wrapper translateX to targetPx over ANIM_DURATION_MS.
 * Optional onComplete fires once when the animation settles (not on cancel).
 */
export function animateWrapper(
  wrapper: HTMLElement,
  targetPx: number,
  onComplete?: () => void,
): void {
  _lastWrapper = wrapper
  // The bloom (horizontal-strip mode) owns the drawer's inline styles; a
  // translate tween on the same wrapper must never race it (side/location
  // flips mid-bloom).
  cancelPanelToggle(wrapper)
  let state = _anims.get(wrapper)
  if (!state) {
    state = { raf: null, start: null, from: 0, to: 0, onComplete: null }
    _anims.set(wrapper, state)
  }
  const current = parseTranslateX(wrapper.style.transform)
  state.from = current
  state.to = targetPx
  state.start = null
  state.onComplete = onComplete ?? null
  if (state.raf !== null) cancelAnimationFrame(state.raf)
  // Already at target — settle immediately so onComplete still runs.
  if (current === targetPx) {
    wrapper.style.transform = `translateX(${targetPx}px)`
    state.raf = null
    _liveTranslateWrappers.delete(wrapper)
    const done = state.onComplete
    state.onComplete = null
    if (done) {
      try {
        done()
      } catch {
        /* ignore */
      }
    }
    return
  }
  _liveTranslateWrappers.add(wrapper)
  state.raf = requestAnimationFrame((t) => animFrame(wrapper, state!, t))
}

// ── Horizontal-strip panel bloom (Top/Bottom drawer location) ────────────────
//
// In Top/Bottom location the wrapper's translateX is purely structural: it
// snaps to the open slot before the bloom and to the closed slot after it.
// The visible motion lives on the drawer (`.sidebar-ux-drawer`) and its panel
// (`.sidebar-ux-panel`), anchored at the rail edge — the panel emerges from
// under the pinned strip while fading, and collapses back into it on close.
// Subtle by design: a 10px rail tuck + 1.5% scale ≈ 20px of far-edge travel.
//
// The rail strip paints ABOVE the wrapper (pin-host z-index 10000 vs shell
// 9990), so the tuck is hidden by the strip's list chrome — never raise the
// wrapper's z-index or the illusion breaks.
//
// ANCHORING (revised 2026-09-15): when the drawer's displayed window has a
// strip button, `anchor` is that button's center expressed in percentages of
// the drawer box. It becomes the transform-origin, so the scale component
// moves the panel toward the button — the close visibly collapses into the
// tab it belongs to. With no anchor (OS close: the window is already
// dismissed and its button is gone) the close is a pure opacity fade with NO
// transform movement (`to` keeps ty 0 / scale 1). The open keeps its rail
// bloom either way (rail-center when unanchored — nothing to grow from).
//
// `pointer-events: none` on the drawer for the whole tween: a half-faded panel
// must not take clicks, and no resize/DnD drag may start and measure a scaled
// rect. It is restored to the construction value `auto` — clearing to `''`
// would inherit the wrapper's inline `pointer-events: none` permanently.
//
// Same rule for `will-change`: `transform` makes the drawer a containing block
// for fixed descendants even without a transform, so it is cleared on every
// exit path (settle, cancel, reduced motion).

/** Open duration — user-tuned 2026-09-15: 33% under the 400ms evaluation
 *  length (270ms ≈ 400 × 0.67). */
export const PANEL_OPEN_MS = 270
/** Close duration — matches the open: the fade reads as one deliberate
 *  collapse (the original 150ms exit was too quick). */
export const PANEL_CLOSE_MS = 270
/** Rail tuck on open: how far under the strip the panel starts. */
export const PANEL_ENTER_PX = 10
/** Rail tuck at the end of an anchored close (shorter — retracting). */
export const PANEL_EXIT_PX = 8
/** Scale at the open start / anchored-close end. With the origin at the
 *  button this also translates the panel toward it. */
export const PANEL_SCALE = 0.985
/** The UI layer (`.sidebar-ux-panel`) starts dimmer than the surface and
 *  resolves last (phase-shifted on the same clock): chrome first, content after. */
export const PANEL_UI_FROM = 0.55
/** Fraction of the open duration the UI channel waits before resolving. */
export const PANEL_UI_PHASE = 0.1
/** Settle grace over the duration when rAF is starved (background tab). */
const PANEL_SETTLE_GRACE_MS = 100
/** DOM hook while a panel motion is in flight. Keeps OS "no displayed window"
 *  parking (`display:none` on the content slot) from applying mid-fade — the
 *  user saw the content vanish instantly (2026-09-15). Mirrored literally in
 *  `sidebar/styles.ts` (that module is a leaf on purpose). */
export const PANEL_ANIMATING_ATTR = 'data-canvas-panel-animating'

interface PanelPose {
  opacity: number
  ty: number
  scale: number
  ui: number
}

/** Minimal rect shape for the anchor math (getBoundingClientRect-compatible). */
export interface AnchorRect {
  left: number
  top: number
  width: number
  height: number
}

/** The displayed window's strip-button center as percentages of the drawer
 *  box — a zoom-independent `transform-origin` anchor. Percentages may fall
 *  outside [0, 100] (the button sits on the rail, the drawer hangs below it),
 *  which is intended: scaling about an external point moves the panel toward
 *  the button. Null when the drawer has no measurable box. */
export function computePanelAnchor(
  button: AnchorRect,
  drawer: AnchorRect,
): { x: number; y: number } | null {
  if (!(drawer.width > 0) || !(drawer.height > 0)) return null
  const cx = button.left + button.width / 2
  const cy = button.top + button.height / 2
  return {
    x: ((cx - drawer.left) / drawer.width) * 100,
    y: ((cy - drawer.top) / drawer.height) * 100,
  }
}

interface PanelAnimState {
  raf: number | null
  timer: ReturnType<typeof setTimeout> | null
  start: number | null
  duration: number
  open: boolean
  edge: 'top' | 'bottom'
  closedPx: number
  wrapper: HTMLElement
  drawer: HTMLElement
  panel: HTMLElement | null
  anchor: { x: number; y: number } | null
  from: PanelPose
  to: PanelPose
  cur: PanelPose
  onComplete: (() => void) | null
  /** Callbacks run once the motion settles (or is cancelled). */
  settleCallbacks: Array<() => void>
  done: boolean
}

export interface PanelToggleOptions {
  open: boolean
  /** Which rail the panel hangs from (Top/Bottom location). */
  edge: 'top' | 'bottom'
  /** Structural closed translate of the wrapper (required on close). */
  closedPx?: number
  /** Displayed window's strip-button center, in % of the drawer box. When
   *  absent the close is a pure fade (no transform movement). */
  anchor?: { x: number; y: number } | null
  onComplete?: () => void
}

function panelRailSign(edge: 'top' | 'bottom'): number {
  return edge === 'top' ? -1 : 1
}

function applyPanelPose(
  drawer: HTMLElement,
  panel: HTMLElement | null,
  pose: PanelPose,
  edge: 'top' | 'bottom',
  anchor: { x: number; y: number } | null,
): void {
  drawer.style.opacity = String(pose.opacity)
  drawer.style.transform = `translateY(${pose.ty}px) scale(${pose.scale})`
  drawer.style.transformOrigin = anchor
    ? `${anchor.x}% ${anchor.y}%`
    : edge === 'top'
      ? '50% 0%'
      : '50% 100%'
  if (panel) panel.style.opacity = String(pose.ui)
}

/** Restore the drawer/panel to their construction state. `pointer-events`
 *  MUST be `auto` (the wrapper's inline `none` would otherwise be inherited). */
function resetPanelStyles(drawer: HTMLElement, panel: HTMLElement | null): void {
  drawer.style.opacity = ''
  drawer.style.transform = ''
  drawer.style.transformOrigin = ''
  drawer.style.willChange = ''
  drawer.style.pointerEvents = 'auto'
  if (panel) panel.style.opacity = ''
}

/** Finish a bloom: drop the state, reset inline styles, and (on close) apply
 *  the structural closed translate. `cancelled` skips the wrapper write —
 *  the cancelling caller owns the transform. */
function settlePanelToggle(state: PanelAnimState, opts?: { cancelled?: boolean }): void {
  if (state.done) return
  state.done = true
  if (state.raf !== null) {
    cancelAnimationFrame(state.raf)
    state.raf = null
  }
  if (state.timer !== null) {
    clearTimeout(state.timer)
    state.timer = null
  }
  if (_panelAnims.get(state.wrapper) === state) _panelAnims.delete(state.wrapper)
  _livePanelWrappers.delete(state.wrapper)
  resetPanelStyles(state.drawer, state.panel)
  state.wrapper.removeAttribute(PANEL_ANIMATING_ATTR)
  if (!state.open && !opts?.cancelled) {
    state.wrapper.style.transform = `translateX(${state.closedPx}px)`
  }
  const done = state.onComplete
  state.onComplete = null
  const callbacks = state.settleCallbacks
  state.settleCallbacks = []
  if (done) {
    try {
      done()
    } catch {
      /* caller errors must not break animation bookkeeping */
    }
  }
  for (const cb of callbacks) {
    try {
      cb()
    } catch {
      /* settle listeners are advisory */
    }
  }
}

/** Cancel an in-flight bloom and restore the settled (visible) drawer styles.
 *  Safe on wrappers that never bloomed. */
function cancelPanelToggle(wrapper: HTMLElement): void {
  const state = _panelAnims.get(wrapper)
  if (state) settlePanelToggle(state, { cancelled: true })
}

/** True while a panel motion is in flight for this wrapper (OS chrome uses
 *  this to defer no-displayed-window parking until the fade completes). */
export function isPanelAnimating(wrapper: HTMLElement): boolean {
  return _panelAnims.has(wrapper)
}

/** Run `cb` when the wrapper's current panel motion settles (or is cancelled);
 *  runs immediately when no motion is in flight. */
export function whenPanelMotionSettles(wrapper: HTMLElement, cb: () => void): void {
  const state = _panelAnims.get(wrapper)
  if (!state) {
    cb()
    return
  }
  state.settleCallbacks.push(cb)
}

function panelFrame(state: PanelAnimState, now: number): void {
  if (state.done) return
  if (state.start === null) state.start = now
  const t = Math.min((now - state.start) / state.duration, 1)
  const eased = easeOutCubic(t)
  const uiT = state.open
    ? easeOutCubic(Math.max(0, (t - PANEL_UI_PHASE) / (1 - PANEL_UI_PHASE)))
    : 0
  const pose: PanelPose = {
    opacity: state.from.opacity + (state.to.opacity - state.from.opacity) * eased,
    ty: state.from.ty + (state.to.ty - state.from.ty) * eased,
    scale: state.from.scale + (state.to.scale - state.from.scale) * eased,
    ui: state.open ? state.from.ui + (state.to.ui - state.from.ui) * uiT : state.from.ui,
  }
  state.cur = pose
  applyPanelPose(state.drawer, state.panel, pose, state.edge, state.anchor)
  if (t < 1) {
    state.raf = requestAnimationFrame((n) => panelFrame(state, n))
  } else {
    settlePanelToggle(state)
  }
}

/**
 * Bloom the panel open/closed (Top/Bottom location only — the Sides path uses
 * `animateWrapper`). The wrapper transform is structural and set instantly so
 * the panel never slides sideways. Interruptions continue from the current
 * inline pose; a close during a close is a no-op; a duplicate close on a
 * settled-closed wrapper returns without animating (never the 350ms slide).
 */
export function animatePanelToggle(
  wrapper: HTMLElement,
  drawer: HTMLElement,
  opts: PanelToggleOptions,
): void {
  _lastWrapper = wrapper
  // A Sides translate tween must never race the bloom.
  cancelTranslateTween(wrapper)

  const closedPx = opts.closedPx ?? 0
  let existing = _panelAnims.get(wrapper) ?? null
  if (existing) {
    // Close during close is a no-op (idempotent dismiss).
    if (!opts.open && !existing.open) return
    // Detach the old state WITHOUT resetting styles: the new tween continues
    // from its current pose (continuity, no pop).
    if (existing.raf !== null) cancelAnimationFrame(existing.raf)
    if (existing.timer !== null) clearTimeout(existing.timer)
    existing.done = true
    existing.raf = null
    existing.timer = null
    // An interruption supersedes the pending parking listener — the new
    // motion will re-register if it still applies (callbacks re-check state).
    existing.settleCallbacks = []
  } else if (!opts.open && parseTranslateX(wrapper.style.transform) === closedPx) {
    // Already settled closed — nothing to do (and never fall through to the
    // translate path, which would slide the off-screen wrapper for 350ms).
    return
  }

  const panel = (drawer.querySelector?.('.sidebar-ux-panel') as HTMLElement | null) ?? null
  const anchor =
    opts.anchor && Number.isFinite(opts.anchor.x) && Number.isFinite(opts.anchor.y)
      ? opts.anchor
      : null
  const sign = panelRailSign(opts.edge)
  const from: PanelPose = existing
    ? existing.cur
    : opts.open
      ? {
        opacity: 0,
        ty: sign * PANEL_ENTER_PX,
        scale: PANEL_SCALE,
        ui: PANEL_UI_FROM,
      }
      : { opacity: 1, ty: 0, scale: 1, ui: 1 }
  const to: PanelPose = opts.open
    ? { opacity: 1, ty: 0, scale: 1, ui: 1 }
    : anchor
      // Collapse into the displayed window's strip button: the external
      // origin + scale does the movement, the tuck adds the rail direction.
      ? { opacity: 0, ty: sign * PANEL_EXIT_PX, scale: PANEL_SCALE, ui: from.ui }
      // No associated button (OS close: the window is already dismissed and
      // its button is gone) — fade out in place, no transform movement.
      : { opacity: 0, ty: 0, scale: 1, ui: from.ui }
  const state: PanelAnimState = {
    raf: null,
    timer: null,
    start: null,
    duration: opts.open ? PANEL_OPEN_MS : PANEL_CLOSE_MS,
    open: opts.open,
    edge: opts.edge,
    closedPx,
    wrapper,
    drawer,
    panel,
    anchor,
    from,
    to,
    cur: from,
    onComplete: opts.onComplete ?? null,
    settleCallbacks: [],
    done: false,
  }

  if (opts.open) wrapper.style.transform = 'translateX(0)'
  applyPanelPose(drawer, panel, from, opts.edge, anchor)
  drawer.style.pointerEvents = 'none'
  drawer.style.willChange = 'opacity, transform'
  wrapper.setAttribute(PANEL_ANIMATING_ATTR, '1')
  _panelAnims.set(wrapper, state)
  _livePanelWrappers.add(wrapper)

  if (prefersReducedMotion()) {
    applyPanelPose(drawer, panel, to, opts.edge, anchor)
    state.cur = to
    settlePanelToggle(state)
    return
  }
  state.timer = setTimeout(() => settlePanelToggle(state), state.duration + PANEL_SETTLE_GRACE_MS)
  state.raf = requestAnimationFrame((n) => panelFrame(state, n))
}

/** Test helper: bloom state for a wrapper (or the last animated one). */
export function __getPanelAnimState(wrapper?: HTMLElement | null) {
  const target = wrapper ?? _lastWrapper
  if (!target) return { panelRaf: null as number | null, panelStart: null as number | null }
  const state = _panelAnims.get(target)
  return {
    panelRaf: state?.raf ?? null,
    panelStart: state?.start ?? null,
  }
}
