/**
 * Drawer open/close motion router.
 *
 * Sides: the battle-tested `animateWrapper` translateX slide.
 * Top/Bottom (taskbar/OS horizontal strips): the "rail bloom" — the wrapper
 * snaps structurally (no sideways slide) and the panel (`.sidebar-ux-drawer`)
 * emerges from under the pinned strip with a fade + micro-scale while the UI
 * layer resolves last. See `animation.ts` for the tween.
 *
 * Anchor policy: the close collapses toward the DISPLAYED window's strip
 * button when one exists (non-OS closes, OS minimize), and fades in place
 * when it does not (OS close: the window is dismissed, its button is gone).
 * The open always keeps the rail bloom — anchored to the button when known,
 * rail-centered otherwise.
 *
 * Reduced motion is evaluated inside `animatePanelToggle` at call time.
 */

import type { Side } from '../core/model'
import { animatePanelToggle, animateWrapper, computePanelAnchor } from './animation'
import { getStripEdge, isHorizontalStrip } from '../settings/state'

/**
 * Pin-host hooks duplicated as literals: importing `tab-position` here would
 * add a static cycle (tab-position → mobile-exclusion → secondary →
 * panel-motion). The strings are the public DOM contract
 * (`TAB_LIST_PIN_HOST_CLASS` / `PIN_OWNER_*`).
 */
const PIN_HOST_SEL = '.sidebar-ux-tab-list-pin-host'
const PIN_OWNER_ATTR = 'data-pin-owner'
const PIN_OWNER_MAIN = 'main'
const PIN_OWNER_SECONDARY = 'secondary'

interface ActiveRecord {
  /** Model key (TabKey) — matches the main mirror's `data-mirror-key`. */
  key: string
  /** Resolved live id — matches `data-tab-id` on both strips. */
  liveId: string | null
}

interface SideAnchorState {
  /** The model's current active (null when nothing is displayed). */
  current: ActiveRecord | null
  /** Last non-null active — the recently displayed window. */
  last: ActiveRecord | null
}

const _anchors: Record<Side, SideAnchorState> = {
  primary: { current: null, last: null },
  secondary: { current: null, last: null },
}
let _tracking = false

/**
 * One-shot "this close has no associated button" hint. OS close dismisses the
 * window and collapses the drawer, but the model commit that clears the active
 * is a microtask — the close command runs BEFORE it, so the anchor resolver
 * would still see the (about to vanish) window. `os/actions.ts` sets this for
 * the displayed-window close; the next close consumes it and fades in place.
 * Minimize deliberately does NOT set it: the mimimized window's button stays,
 * so the panel collapses toward it.
 */
const _suppressCloseAnchor: Record<Side, boolean> = { primary: false, secondary: false }

/** Mark the next close of `side` as unanchored (fade in place). One-shot. */
export function suppressNextCloseAnchor(side: Side): void {
  _suppressCloseAnchor[side] = true
}

/** Test seam: seed the tracked active window for a side (harnesses have no
 *  bootstrapped model, so the subscription cannot populate it). Pass null to
 *  clear. Production never calls this. */
export function __setAnchorForTest(side: Side, key: string | null, liveId: string | null): void {
  const rec: ActiveRecord | null = key ? { key, liveId } : null
  _anchors[side].current = rec
  _anchors[side].last = rec
}

/**
 * Track the model's per-side active window. Dynamic import: the static
 * chain recon/dispatch → reconcile → active-tab → main-mirror → panel-motion
 * would be circular (call-time-safe today, but this module is loaded at boot
 * — keep it out of that cycle on purpose, matching main-mirror/secondary).
 *
 * `last` survives the OS deactivate/close that clears `current` before the
 * drawer-close command, so an OS minimize can still find its button; a
 * dismissed (hidden) button then fails the visibility check → fade.
 */
function ensureAnchorTracking(): void {
  if (_tracking) return
  _tracking = true
  void import('../recon/dispatch')
    .then(({ getHost, getModel, onModelChanged }) => {
      const sync = (): void => {
        const model = getModel()
        // Pre-bootstrap / teardown: keep any tracked (or test-seeded) records —
        // there is nothing live to sync against.
        if (!model) return
        const host = getHost()
        for (const side of Object.keys(_anchors) as Side[]) {
          const key = model?.active[side] ?? null
          if (!key) {
            _anchors[side].current = null
            continue
          }
          const rec: ActiveRecord = { key, liveId: host ? host.resolve(key) : null }
          _anchors[side].current = rec
          _anchors[side].last = rec
        }
      }
      sync()
      onModelChanged(sync)
    })
    .catch(() => {
      /* no model module (tests) — anchors stay null */
    })
}

/** The visible strip button for a recorded window, scoped to the drawer's
 *  pin-host zone. Null when the window has no button (closed/hidden) or the
 *  strip is not pinned (boot transients). */
function findStripButton(side: Side, rec: ActiveRecord | null): Element | null {
  if (!rec || typeof document === 'undefined') return null
  const owner = side === 'primary' ? PIN_OWNER_MAIN : PIN_OWNER_SECONDARY
  const candidates = document.querySelectorAll('button[data-tab-id], button[data-mirror-key]')
  for (const el of Array.from(candidates)) {
    const matches =
      (rec.liveId !== null && el.getAttribute('data-tab-id') === rec.liveId)
      || (side === 'primary' && el.getAttribute('data-mirror-key') === rec.key)
    if (!matches || !el.isConnected) continue
    const host = el.closest(PIN_HOST_SEL)
    if (!host || host.getAttribute(PIN_OWNER_ATTR) !== owner) continue
    const rect = el.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) return el
  }
  return null
}

/** Anchored origin for the animation, or null for the fade-only / rail-center
 *  fallback. Opens use the current displayed window only; closes may fall
 *  back to the last displayed one (OS clears the active before the collapse). */
function resolveAnchor(
  side: Side,
  drawer: HTMLElement,
  mode: 'open' | 'close',
): { x: number; y: number } | null {
  const state = _anchors[side]
  const rec = mode === 'open' ? state.current : (state.current ?? state.last)
  const button = findStripButton(side, rec)
  if (!button) return null
  return computePanelAnchor(button.getBoundingClientRect(), drawer.getBoundingClientRect())
}

// Prime the tracker at import time (this module loads during setup) so the
// first user animation already has the active window recorded. Dynamic
// import inside — no module-evaluation cycle.
ensureAnchorTracking()

/** Animate a drawer open (mode-routed). */
export function animateDrawerOpen(wrapper: HTMLElement, drawer: HTMLElement, side: Side): void {
  if (!isHorizontalStrip()) {
    animateWrapper(wrapper, 0)
    return
  }
  ensureAnchorTracking()
  animatePanelToggle(wrapper, drawer, {
    open: true,
    edge: getStripEdge() ?? 'top',
    anchor: resolveAnchor(side, drawer, 'open'),
  })
}

/** Animate a drawer closed (mode-routed). `closedPx` is the structural closed
 *  translate for the wrapper (side/width-derived, caller-owned).
 *
 *  Top/Bottom shadow policy: during the bloom the drawer's real box-shadow
 *  (a child of the fading drawer) is what the user sees — it fades with the
 *  panel and micro-scales in place. chat/reflow only paints the chat-owned
 *  inset (which would ride the chat reflow margin, reading as a slide from
 *  the screen edge) once the panel is settled; `data-canvas-panel-animating`
 *  is the flag it reads. */
export function animateDrawerClose(
  wrapper: HTMLElement,
  drawer: HTMLElement,
  closedPx: number,
  side: Side,
): void {
  if (!isHorizontalStrip()) {
    animateWrapper(wrapper, closedPx)
    return
  }
  ensureAnchorTracking()
  const suppressed = _suppressCloseAnchor[side]
  _suppressCloseAnchor[side] = false
  animatePanelToggle(wrapper, drawer, {
    open: false,
    edge: getStripEdge() ?? 'top',
    closedPx,
    anchor: suppressed ? null : resolveAnchor(side, drawer, 'close'),
  })
}
