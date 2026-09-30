// Main-drawer persistence watcher.
//
// The secondary sidebar is fully owned by Canvas, so its open/close +
// resize handlers can call persistOpenState / persistLayout directly
// (see sidebar/secondary.tsx and resize/handles.ts). The main drawer is
// owned by Lumiverse and exposes no equivalent extension hook — its
// state is read-only from Canvas's side.
//
// Until this watcher existed, the `primary.{open,width}` fields in
// layout.json were effectively write-once: the live layout snapshot captured
// the live state on every save, but no event ever fired a save when
// the user opened/closed/resized the main drawer.
//
// v1.5.6 (MutationObserver approach): Lumiverse does not expose
// spindle.ui to extensions at runtime (the API is documented in
// node_modules/lumiverse-spindle-types/src/dom.ts but window.spindle
// is undefined inside an extension's frontend context). So we
// observe the main drawer's wrapper element directly:
//
//   - The wrapper is `.drawer.main` / `#main-drawer` (see
//     dom/lumiverse.ts). It carries a `wrapperOpen` class while open
//     (ViewportDrawer.tsx:177 in the Lumi frontend).
//   - A MutationObserver on the wrapper's `class` attribute fires
//     whenever the open/close state transitions. We read the new
//     state via the same class-name check isMainDrawerOpen() uses.
//   - A second MutationObserver watches the sidebar's tab list
//     (`[data-spindle-mount="sidebar"]`) for the `tabBtnActive`
//     class moving between buttons, so we can capture the active
//     tab id (the data-tab-id attribute or a derived label).
//   - Width is captured with a debounced ResizeObserver (300ms,
//     matching persistLayout's debounce) so drag-coalesces-to-one-write.
//
// Restore on load: since the host's `spindle.ui.openDrawerTab` API is
// also unavailable, the restore path is DOM-driven. If the saved
// state was `open=true` and the wrapper is currently closed, we
// programmatically `.click()` the first tab button inside the
// sidebar — the host's onClick handler runs `openDrawer()` and
// switches to that tab. We log the outcome and let any animation
// settle naturally.
//
// Restore caveat: if the user had a non-built-in tab active (a
// tab contributed by another extension), the click will switch
// them to the first tab. Acceptable degradation: at least the
// drawer reopens.

import { getMainDrawer } from '../dom/lumiverse'
import { clampSidebarWidth } from '../dom/clamp'
import { dlog, dwarn } from '../debug/log'
import { isPointerResizeActive } from '../resize/handles'
import { enforceExclusionOnOpen, isHostMobileDrawerViewport, isMobileViewport, setMobileOpenClass } from './mobile-exclusion'
import { waitForDrawerDOM, cleanupDomPoll } from './persist-polling'
// S1 gate inversion: mirror-liveness replaces the taskbarMode check — the
// Canvas main shell is the drawer surface on desktop regardless of pin state.
// Function-hoisted under the existing main-mirror-drawer ↔ drawer-sync cycle;
// main-mirror-drawer only dynamic-imports main-persist, so no eval-order trap.
import { isMainMirrorActive } from './main-mirror-drawer'

// Re-export for back-compat so existing imports keep working.
export { waitForDrawerDOM, cleanupDomPoll } from './persist-polling'

// Timeout (ms) to unsuppress the wrapper even if restore fails or the
// async LOAD_LAYOUT never arrives. Prevents a permanently hidden drawer.
const UNSUPPRESS_TIMEOUT_MS = 3000
// Delay before restoring the active primary tab via .click(). One frame
// is enough for taskbar mode pin/reconcile to attach mirror buttons; panel
// bodies stay opacity:0 until the correct tab is active, so we do not
// need a long blank settle.
const RESTORE_TAB_CLICK_MS = 0
// html class + stylesheet: hide host main AND Canvas main-mirror shell
// until primary open/tab restore finishes (prevents profile flash).
const RESTORE_PENDING_CLASS = 'sidebar-ux-main-restore-pending'
const RESTORE_GUARD_STYLE_ID = 'sidebar-ux-main-restore-guard'
// Mid-session mode-switch reveal hold (2026-09 live-verify #4): a VISUAL-ONLY
// class that hides both Canvas drawer shells + every main panel body while the
// runtime enable placement pass pre-activates host tabs. Deliberately separate
// from RESTORE_PENDING_CLASS: isMainDrawerRestorePending() gates observe()
// shell truth + setDrawer echo suppression (S1/S5), so flipping it mid-session
// would resume stale host-truth reads (the live-verify #1 ping-pong class).
// This class affects paint only — hold/release around the enable restore.
const REVEAL_HOLD_CLASS = 'sidebar-ux-main-reveal-hold'
// One-shot fade-in played when the hold lifts (2026-09): the settled drawers +
// pinned secondary strip fade in instead of snapping. Class-based keyframe
// animation, auto-removed after the animation window.
const REVEAL_IN_CLASS = 'sidebar-ux-main-reveal-in'
// Boot-only companion to REVEAL_IN_CLASS: the MAIN pin strip is hidden by the
// BOOT restore guard but deliberately NOT by the mid-session reveal hold (its
// buttons are not rebuilt). It must fade back in with the drawers on the boot
// reveal — otherwise, with no drawers open, the only visible chrome pops
// (live-verify #12). Separate class so the mid-session release, where the
// strip is already visible, never restarts it from opacity 0.
const REVEAL_IN_MAIN_HOST_CLASS = 'sidebar-ux-main-reveal-in-host'
/** Fade-in duration (ms); keep in sync with the injected stylesheet. */
const REVEAL_IN_MS = 180
/** Nested hold count; 0 = no active reveal hold. */
let _revealHolds = 0
/** Auto-removal timer for REVEAL_IN_CLASS. */
let _revealInTimer: ReturnType<typeof setTimeout> | null = null
// Secondary placement gate (2026-09, live-verify #5 final): the boot placement
// pass serializes secondary placements and can outlive the main restore reveal
// (setup caps its wait at 1.5s). This VISUAL-ONLY class keeps the second
// drawer + pinned strip hidden until the pass settles, so panel content never
// paints before its tab buttons. Separate from the main reveal hold: the main
// surface stays on its own schedule.
const SECONDARY_PLACEMENT_HOLD_CLASS = 'sidebar-ux-secondary-placement-hold'
// Secondary-only reveal fade for a LATE gate release (main already visible).
const SECONDARY_REVEAL_IN_CLASS = 'sidebar-ux-secondary-reveal-in'
/** Nested secondary placement holds; 0 = gate open. */
let _secondaryPlacementHolds = 0
/** Auto-removal timer for SECONDARY_REVEAL_IN_CLASS. */
let _secondaryRevealTimer: ReturnType<typeof setTimeout> | null = null
// Host tabBtnActive must hold for this many consecutive polls before we
// consider chrome "host-ready". Mirror-only active must NOT count (Canvas
// paints mirror highlight before React commits panel children).
const RESTORE_HOST_STABLE_POLLS = 2
// After host is stable: require panel-body mutation quiescence this long
// (ms) before lifting the restore guard. Fallback settle if no mutations
// (already-correct tab / empty panel).
const RESTORE_CONTENT_QUIET_MS = 40
const RESTORE_CONTENT_FALLBACK_MS = 50

// module-level cache, populated by the observers and read by
// the live layout snapshot so every save path (settings-toggle, pagehide
// flush, manual save) sees the live main-drawer state.
let _wrapper: HTMLElement | null = null
let _classObserver: MutationObserver | null = null
let _stopped = true
let _unsuppressTimer: ReturnType<typeof setTimeout> | null = null
/** Re-stamps inline hide on newly mounted panel bodies during restore. */
let _panelHideObserver: MutationObserver | null = null
let _panelHideRaf: number | null = null
/** Watches parked panel body children during restore tab settle. */
let _contentSettleObserver: MutationObserver | null = null
let _contentQuietTimer: ReturnType<typeof setTimeout> | null = null
let _contentFallbackTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Read the current open state of the main drawer from the wrapper's
 * class list. Mirrors isMainDrawerOpen()'s DOM fallback (see
 * store/index.ts) so the watcher's truth matches the rest of the
 * app's reads.
 */
function readWrapperOpen(wrapper: HTMLElement): boolean {
  return wrapper.classList.toString().includes('wrapperOpen')
}

function ensureRestoreGuardStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(RESTORE_GUARD_STYLE_ID)) return
  const el = document.createElement('style')
  el.id = RESTORE_GUARD_STYLE_ID
  // Hide chrome + every possible main panel body node. Host React can
  // remount `[class*="_panelContent_"]` outside the shell (or with
  // visibility:visible !important) during tab switches — class rules on
  // the shell alone are not enough. stampPanelBodyHide + _panelHideObserver
  // re-stamp panel bodies that escape the cascade (no separate wrapper
  // inline hide or data-canvas-restore-hide marker).
  el.textContent = `
    html.${RESTORE_PENDING_CLASS} [class*="_wrapper_"]:has([data-spindle-mount="sidebar"]),
    html.${RESTORE_PENDING_CLASS} .sidebar-ux-main-mirror-wrapper,
    /* Secondary shell too (live-verify #5): features mount during the guard
     * window, so the second drawer's strip would otherwise be visible/populate
     * while the main restore is still running. Revealed with the main by the
     * same fade at unsuppress. */
    html.${RESTORE_PENDING_CLASS} .sidebar-ux-secondary-wrapper {
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    /* Panel bodies anywhere — host tree, parked in shell, or mid-reparent. */
    html.${RESTORE_PENDING_CLASS} [class*="_panelContent_"],
    html.${RESTORE_PENDING_CLASS} [data-canvas-main-panel-content],
    html.${RESTORE_PENDING_CLASS} .sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content,
    html.${RESTORE_PENDING_CLASS} .sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content > * {
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    html.${RESTORE_PENDING_CLASS} .sidebar-ux-tab-list-pin-host[data-pin-owner="main"],
    html.${RESTORE_PENDING_CLASS} .sidebar-ux-tab-list-pin-host[data-pin-owner="secondary"] {
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    /* Mid-session mode-switch reveal hold (visual-only): hide BOTH Canvas
     * shells + every panel body while the enable placement pass churns host
     * tabs, so the drawers reveal once, settled. Same inline-stamp backup as
     * the restore guard (React can remount panel bodies). */
    html.${REVEAL_HOLD_CLASS} .sidebar-ux-main-mirror-wrapper,
    html.${REVEAL_HOLD_CLASS} .sidebar-ux-secondary-wrapper {
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    html.${REVEAL_HOLD_CLASS} [class*="_panelContent_"],
    html.${REVEAL_HOLD_CLASS} [data-canvas-main-panel-content],
    html.${REVEAL_HOLD_CLASS} .sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content,
    html.${REVEAL_HOLD_CLASS} .sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content > *,
    html.${REVEAL_HOLD_CLASS} .sidebar-ux-secondary-wrapper .sidebar-ux-panel-content,
    html.${REVEAL_HOLD_CLASS} .sidebar-ux-secondary-wrapper .sidebar-ux-panel-content > * {
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    /* Pinned secondary strip lives on a body-level host OUTSIDE the wrapper
     * (tab-position.ts) — without this rule the serial placement loop's
     * button-by-button appends are visible during the hold (live-verify #5).
     * The MAIN pin host is deliberately absent: its buttons are not rebuilt
     * during the pass, and hiding it would blink working chrome. */
    html.${REVEAL_HOLD_CLASS} .sidebar-ux-tab-list-pin-host[data-pin-owner="secondary"] {
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    /* One-shot reveal fade after the hold lifts (live-verify #5): the settled
     * drawers + pinned secondary strip fade in instead of snapping. The class
     * is removed after the animation window (playRevealIn). The MAIN pin strip
     * is hidden only by the BOOT guard, so its fade rides the companion
     * boot-only class (live-verify #12) — adding it to the mid-session release
     * would restart a visible strip from opacity 0. */
    html.${REVEAL_IN_CLASS} .sidebar-ux-main-mirror-wrapper,
    html.${REVEAL_IN_CLASS} .sidebar-ux-secondary-wrapper,
    html.${REVEAL_IN_CLASS} .sidebar-ux-tab-list-pin-host[data-pin-owner="secondary"],
    html.${REVEAL_IN_MAIN_HOST_CLASS} .sidebar-ux-tab-list-pin-host[data-pin-owner="main"] {
      animation: sidebar-ux-reveal-fade-in ${REVEAL_IN_MS}ms ease-out both;
    }
    @keyframes sidebar-ux-reveal-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    /* Secondary placement gate (live-verify #5 final): the boot placement pass
     * can outlive the main reveal (1.5s cap), so keep the second drawer + its
     * pinned strip hidden until placements settle — panel content must never
     * paint before its tab buttons. */
    html.${SECONDARY_PLACEMENT_HOLD_CLASS} .sidebar-ux-secondary-wrapper,
    html.${SECONDARY_PLACEMENT_HOLD_CLASS} .sidebar-ux-tab-list-pin-host[data-pin-owner="secondary"] {
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    /* Late gate release (main already visible): secondary-only fade with the
     * shared keyframes, so the second drawer appears smoothly on its own. */
    html.${SECONDARY_REVEAL_IN_CLASS} .sidebar-ux-secondary-wrapper,
    html.${SECONDARY_REVEAL_IN_CLASS} .sidebar-ux-tab-list-pin-host[data-pin-owner="secondary"] {
      animation: sidebar-ux-reveal-fade-in ${REVEAL_IN_MS}ms ease-out both;
    }
  `
  document.head.appendChild(el)
}

function isPanelBodyNode(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false
  const cls = String(el.className || '')
  if (cls.includes('_panelContent_')) return true
  if (el.hasAttribute('data-canvas-main-panel-content')) return true
  // Shell content slot that holds parked host panelContent.
  if (
    cls.includes('sidebar-ux-panel-content')
    && el.closest('.sidebar-ux-main-mirror-wrapper')
  ) {
    return true
  }
  return false
}

/** Selector for panel bodies that stampPanelBodyHide may style. */
const PANEL_BODY_HIDE_SELECTOR =
  '[class*="_panelContent_"],'
  + '[data-canvas-main-panel-content],'
  + '.sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content,'
  + '.sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content > *'

/**
 * Force-hide every live main panel body with inline !important styles.
 * Survives reparenting and CSS fights better than ancestor-only rules.
 * Safe to call repeatedly; also used from main-mirror after park.
 * Clear uses the same selector (no separate data-attr marker).
 */
export function stampPanelBodyHide(): void {
  if (typeof document === 'undefined') return
  if (!isMainDrawerVisualGuardActive()) return
  const nodes = document.querySelectorAll(PANEL_BODY_HIDE_SELECTOR)
  for (const node of Array.from(nodes)) {
    const el = node as HTMLElement
    el.style.setProperty('visibility', 'hidden', 'important')
    el.style.setProperty('opacity', '0', 'important')
    el.style.setProperty('pointer-events', 'none', 'important')
  }
}

function clearPanelBodyHide(): void {
  if (typeof document === 'undefined') return
  const nodes = document.querySelectorAll(PANEL_BODY_HIDE_SELECTOR)
  for (const node of Array.from(nodes)) {
    const el = node as HTMLElement
    el.style.removeProperty('visibility')
    el.style.removeProperty('opacity')
    el.style.removeProperty('pointer-events')
  }
}

function scheduleStampPanelBodyHide(): void {
  if (_panelHideRaf != null) return
  _panelHideRaf = requestAnimationFrame(() => {
    _panelHideRaf = null
    stampPanelBodyHide()
  })
}

function startPanelHideObserver(): void {
  if (typeof document === 'undefined' || _panelHideObserver) return
  stampPanelBodyHide()
  _panelHideObserver = new MutationObserver((mutations) => {
    if (!isMainDrawerVisualGuardActive()) return
    let needs = false
    for (const m of mutations) {
      if (m.type === 'childList') {
        for (const n of Array.from(m.addedNodes)) {
          if (n instanceof Element && (isPanelBodyNode(n) || n.querySelector?.('[class*="_panelContent_"], [data-canvas-main-panel-content]'))) {
            needs = true
            break
          }
        }
      }
      if (needs) break
    }
    if (needs) scheduleStampPanelBodyHide()
  })
  _panelHideObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  })
}

function stopPanelHideObserver(): void {
  if (_panelHideObserver) {
    _panelHideObserver.disconnect()
    _panelHideObserver = null
  }
  if (_panelHideRaf != null) {
    cancelAnimationFrame(_panelHideRaf)
    _panelHideRaf = null
  }
}

function armUnsuppressTimeout(): void {
  if (_unsuppressTimer) clearTimeout(_unsuppressTimer)
  _unsuppressTimer = setTimeout(() => {
    unsuppressMainDrawer()
    dlog('main-persist: unsuppress timeout fired (restore may have failed)')
  }, UNSUPPRESS_TIMEOUT_MS)
}

/**
 * Start the restore-pending visual guard early (before taskbar mode /
 * main-mirror mounts) so the host default tab (profile) never paints
 * for a frame. Safe to call before the main-drawer watcher attaches.
 */
export function beginMainDrawerRestoreGuard(): void {
  ensureRestoreGuardStyles()
  document.documentElement.classList.add(RESTORE_PENDING_CLASS)
  startPanelHideObserver()
  stampPanelBodyHide()
  armUnsuppressTimeout()
}

/**
 * Immediately hide the main drawer (and main-mirror shell via
 * RESTORE_PENDING_CLASS) to prevent a flash of the default (open /
 * profile) state while layout restore runs.
 * Shown again by unsuppressMainDrawer() after restore completes (or
 * after a timeout safety net).
 *
 * Hide stack is intentionally thin: html class CSS + stampPanelBodyHide
 * on panel bodies + _panelHideObserver. No per-wrapper inline hide.
 */
export function suppressMainDrawer(): void {
  beginMainDrawerRestoreGuard()
  stampPanelBodyHide()
}

/**
 * Restore visibility after restore is done. Safe to call multiple times; idempotent.
 *
 * While a mid-session reveal hold is active the request is deferred: the hold
 * owns visibility until releaseMainDrawerReveal(). Without this, the restore
 * path's own unsuppress (restoreTab tail) would lift the guard while the
 * enable placement pass is still churning host tabs.
 */
export function unsuppressMainDrawer(): void {
  if (_revealHolds > 0) {
    stampPanelBodyHide()
    return
  }
  // Boot reveal: when this call actually lifts an active restore guard, fade
  // the settled shells in instead of snapping (live-verify #5 polish). Only
  // when the guard was active (no repeated fade on idempotent unsuppress) and
  // never during teardown (_stopped) — stopMainDrawerPersistence clears the
  // class first and the cleanup-chain unsuppress must not resurrect it.
  const wasPending = isMainDrawerRestorePending()
  if (_unsuppressTimer) { clearTimeout(_unsuppressTimer); _unsuppressTimer = null }
  stopContentSettleWatch()
  stopPanelHideObserver()
  clearPanelBodyHide()
  document.documentElement.classList.remove(RESTORE_PENDING_CLASS)
  // Boot reveal is the only path where the MAIN pin strip was hidden (by the
  // guard) — fade it back in with the drawers (live-verify #12).
  if (wasPending && !_stopped) playRevealIn({ mainPinHost: true })
}

/** True while restore-pending guard is active (main-mirror park consults this). */
export function isMainDrawerRestorePending(): boolean {
  return typeof document !== 'undefined'
    && document.documentElement.classList.contains(RESTORE_PENDING_CLASS)
}

/** True while the mid-session reveal hold is active (visual-only). */
export function isMainDrawerRevealHeld(): boolean {
  return _revealHolds > 0
}

/**
 * True while ANY main-drawer visual guard wants panel bodies hidden: the boot
 * restore guard OR the mid-session reveal hold. Drives stampPanelBodyHide, the
 * panel-hide observer, and the content-settle watch.
 */
export function isMainDrawerVisualGuardActive(): boolean {
  if (typeof document === 'undefined') return false
  try {
    const cl = document.documentElement.classList
    return cl.contains(RESTORE_PENDING_CLASS) || cl.contains(REVEAL_HOLD_CLASS)
  } catch {
    return false
  }
}

/**
 * Begin a mid-session reveal hold (refcounted, VISUAL-ONLY). While held, both
 * Canvas drawer shells + every main panel body are hidden and unsuppress
 * requests are deferred, so a mode-switch restore can churn host tabs (the
 * placement pass pre-activates each secondary builtin) invisibly and reveal
 * once when released.
 *
 * Deliberately does NOT add RESTORE_PENDING_CLASS: isMainDrawerRestorePending()
 * gates observe() shell truth + setDrawer echo suppression — flipping that
 * mid-session would resume stale host-truth reads (live-verify #1 class).
 */
export function holdMainDrawerReveal(): void {
  if (typeof document === 'undefined') return
  _revealHolds++
  if (_revealHolds !== 1) return
  try {
    ensureRestoreGuardStyles()
    document.documentElement.classList.add(REVEAL_HOLD_CLASS)
    startPanelHideObserver()
    stampPanelBodyHide()
    dlog('main-persist: reveal hold ON (mode switch)')
  } catch (err) {
    dwarn(`main-persist: holdMainDrawerReveal failed: ${err}`)
  }
}

/**
 * Play the one-shot reveal fade (REVEAL_IN_CLASS) on the Canvas shells +
 * pinned secondary strip. Called when the mid-session hold lifts; the class is
 * removed after the animation window so it never lingers. No-op while the boot
 * restore guard still owns visibility (the fade would run hidden).
 *
 * `opts.mainPinHost` additionally fades the MAIN pinned strip via the boot-only
 * companion class. Only the boot reveal passes it: that is the only path where
 * the main strip was hidden (by the restore guard) and must fade back in
 * (live-verify #12). Mid-session holds leave the main strip visible.
 */
function playRevealIn(opts?: { mainPinHost?: boolean }): void {
  if (typeof document === 'undefined') return
  try {
    document.documentElement.classList.add(REVEAL_IN_CLASS)
    if (opts?.mainPinHost) {
      document.documentElement.classList.add(REVEAL_IN_MAIN_HOST_CLASS)
    }
    dlog(`main-persist: reveal fade-in ON (${REVEAL_IN_MS}ms)${opts?.mainPinHost ? ' + main pin strip' : ''}`)
    if (_revealInTimer) clearTimeout(_revealInTimer)
    _revealInTimer = setTimeout(() => {
      _revealInTimer = null
      try {
        document.documentElement.classList.remove(REVEAL_IN_CLASS)
        document.documentElement.classList.remove(REVEAL_IN_MAIN_HOST_CLASS)
      } catch { /* teardown raced the timer */ }
    }, REVEAL_IN_MS + 60)
  } catch (err) {
    dwarn(`main-persist: playRevealIn failed: ${err}`)
  }
}

/**
 * Release a reveal hold; at zero the visual guard lifts (unless the boot
 * restore guard is still active, which owns its own teardown) and the settled
 * drawers play a quick fade-in.
 */
export function releaseMainDrawerReveal(): void {
  if (_revealHolds === 0) return
  _revealHolds--
  if (_revealHolds > 0) return
  if (typeof document === 'undefined') return
  try {
    document.documentElement.classList.remove(REVEAL_HOLD_CLASS)
    dlog('main-persist: reveal hold OFF (mode switch)')
    if (!isMainDrawerRestorePending()) {
      stopPanelHideObserver()
      clearPanelBodyHide()
      playRevealIn()
    }
  } catch (err) {
    dwarn(`main-persist: releaseMainDrawerReveal failed: ${err}`)
  }
}

/** Secondary-only fade for a late placement-gate release (main already shown). */
function playSecondaryRevealIn(): void {
  if (typeof document === 'undefined') return
  try {
    document.documentElement.classList.add(SECONDARY_REVEAL_IN_CLASS)
    dlog(`main-persist: secondary reveal fade-in ON (${REVEAL_IN_MS}ms)`)
    if (_secondaryRevealTimer) clearTimeout(_secondaryRevealTimer)
    _secondaryRevealTimer = setTimeout(() => {
      _secondaryRevealTimer = null
      try {
        document.documentElement.classList.remove(SECONDARY_REVEAL_IN_CLASS)
      } catch { /* teardown raced the timer */ }
    }, REVEAL_IN_MS + 60)
  } catch (err) {
    dwarn(`main-persist: playSecondaryRevealIn failed: ${err}`)
  }
}

/**
 * Hold the secondary placement gate (refcounted, VISUAL-ONLY). The second
 * drawer shell + pinned strip stay hidden until the boot placement pass has
 * fully settled, so its serial button-by-button placement + active-root paint
 * can never flash content before the strip. Used by `bootstrapFromLayout`'s
 * pass; unlike the main reveal hold it never touches the main surface, so a
 * slow pass cannot stall the main reveal (see releaseMainDrawerReveal).
 */
export function holdSecondaryPlacementReveal(): void {
  if (typeof document === 'undefined') return
  _secondaryPlacementHolds++
  if (_secondaryPlacementHolds !== 1) return
  try {
    ensureRestoreGuardStyles()
    document.documentElement.classList.add(SECONDARY_PLACEMENT_HOLD_CLASS)
    dlog('main-persist: secondary placement gate ON')
  } catch (err) {
    dwarn(`main-persist: holdSecondaryPlacementReveal failed: ${err}`)
  }
}

/**
 * Release the secondary placement gate; at zero the second drawer is shown.
 * While the boot restore guard or the main reveal hold still owns visibility
 * the class is simply dropped (their reveal fades both drawers). When the main
 * is already visible, play the secondary-only fade so a late finish still
 * appears smoothly.
 */
export function releaseSecondaryPlacementReveal(): void {
  if (_secondaryPlacementHolds === 0) return
  _secondaryPlacementHolds--
  if (_secondaryPlacementHolds > 0) return
  if (typeof document === 'undefined') return
  try {
    document.documentElement.classList.remove(SECONDARY_PLACEMENT_HOLD_CLASS)
    dlog('main-persist: secondary placement gate OFF')
    if (!isMainDrawerRestorePending() && !isMainDrawerRevealHeld()) {
      playSecondaryRevealIn()
    }
  } catch (err) {
    dwarn(`main-persist: releaseSecondaryPlacementReveal failed: ${err}`)
  }
}

/**
 * True when the **host** sidebar marks targetTabId as active via
 * `tabBtnActive`. Does **not** consult Canvas mirror chrome — mirror
 * highlight is set synchronously in activateMainMirrorFromRestore and
 * would unsuppress before React commits panel children.
 *
 * Accepts data-tab-id equality, title match, or bare-id suffix match
 * (stored "spindle:…:tab:memory:1" vs host data-tab-id "memory").
 */
export function isHostPrimaryTabActive(targetTabId: string): boolean {
  const sidebar = document.querySelector(
    '[data-spindle-mount="sidebar"]',
  ) as HTMLElement | null
  const active = sidebar?.querySelector(
    'button.tabBtnActive, button[class*="tabBtnActive"]',
  ) as HTMLElement | null
  if (!active) return false
  const id = active.getAttribute('data-tab-id') || ''
  const title = active.getAttribute('title') || ''
  if (id === targetTabId || title === targetTabId) return true
  // `:tab:${id}:` is covered by the broader `:tab:${id}` includes check.
  if (id && (targetTabId.endsWith(`:${id}`) || targetTabId.includes(`:tab:${id}`))) {
    return true
  }
  return false
}

/** Resolve the parked / live main panel body for content-settle watch. */
function resolveMainPanelBody(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const marked = document.querySelector(
    '[data-canvas-main-panel-content]',
  ) as HTMLElement | null
  if (marked) return marked
  const shellPanel = document.querySelector(
    '.sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content [class*="_panelContent_"],'
    + '.sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content > [data-canvas-main-panel-content],'
    + '.sidebar-ux-main-mirror-wrapper [class*="_panelContent_"]',
  ) as HTMLElement | null
  if (shellPanel) return shellPanel
  return document.querySelector('[class*="_panelContent_"]') as HTMLElement | null
}

function stopContentSettleWatch(): void {
  if (_contentSettleObserver) {
    _contentSettleObserver.disconnect()
    _contentSettleObserver = null
  }
  if (_contentQuietTimer != null) {
    clearTimeout(_contentQuietTimer)
    _contentQuietTimer = null
  }
  if (_contentFallbackTimer != null) {
    clearTimeout(_contentFallbackTimer)
    _contentFallbackTimer = null
  }
}

/**
 * Prefer a stable parent for content settle: React may remount
 * `_panelContent_` under the shell, so observing a detached old node
 * would never see the real swap.
 */
function resolveContentSettleRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const shellSlot = document.querySelector(
    '.sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content',
  ) as HTMLElement | null
  if (shellSlot) return shellSlot
  const panel = resolveMainPanelBody()
  if (panel?.parentElement instanceof HTMLElement) return panel.parentElement
  return panel
}

/**
 * Watch panel-body childList mutations after host tab is active.
 * Sets contentSettled via callbacks when mutations quiet or fallback
 * timeout fires (already-correct tab with no swap).
 */
function startContentSettleWatch(
  onSettled: (reason: 'mutation-quiet' | 'fallback') => void,
): void {
  stopContentSettleWatch()
  let settled = false
  const settle = (reason: 'mutation-quiet' | 'fallback') => {
    if (settled) return
    settled = true
    stopContentSettleWatch()
    onSettled(reason)
  }

  const root = resolveContentSettleRoot()
  if (!root) {
    // No panel node yet — fall back shortly; repark may create it.
    _contentFallbackTimer = setTimeout(() => settle('fallback'), RESTORE_CONTENT_FALLBACK_MS)
    return
  }

  let sawMutation = false
  _contentSettleObserver = new MutationObserver(() => {
    if (!isMainDrawerVisualGuardActive()) return
    sawMutation = true
    if (_contentQuietTimer != null) clearTimeout(_contentQuietTimer)
    if (_contentFallbackTimer != null) {
      clearTimeout(_contentFallbackTimer)
      _contentFallbackTimer = null
    }
    _contentQuietTimer = setTimeout(() => settle('mutation-quiet'), RESTORE_CONTENT_QUIET_MS)
    // Re-stamp + repark if React remounts mid-switch
    stampPanelBodyHide()
    void import('./main-mirror-drawer').then((m) => {
      m.ensureHostContentParkedPublic()
    }).catch(() => { /* ignore */ })
  })
  _contentSettleObserver.observe(root, { childList: true, subtree: true })

  // Already-correct tab / no child swap: unsuppress after short settle.
  _contentFallbackTimer = setTimeout(() => {
    if (!sawMutation) settle('fallback')
  }, RESTORE_CONTENT_FALLBACK_MS)
}

/**
 * Wait for content to settle (mutations quiet or fallback timeout).
 * Returns a Promise that resolves when content is ready.
 */
function waitForSettle(timeout: number): Promise<void> {
  return new Promise((resolve) => {
    if (_stopped) {
      resolve()
      return
    }

    let settled = false
    let hardTimer: ReturnType<typeof setTimeout> | null = null
    const settle = () => {
      if (settled) return
      settled = true
      if (hardTimer != null) clearTimeout(hardTimer)
      stopContentSettleWatch()
      resolve()
    }

    startContentSettleWatch(() => settle())

    // Hard timeout (fail-forward)
    hardTimer = setTimeout(() => settle(), Math.max(0, timeout))
  })
}

/**
 * Await main panel-body content quiescence (public wrapper over the private
 * content-settle watcher). Used by the mode-switch reveal hold: the placement
 * pass re-asserts the persisted primary, so wait for the React commit before
 * releasing the hold — the reveal must never show a stale panel.
 */
export function waitForMainContentSettled(timeoutMs = 1000): Promise<void> {
  return waitForSettle(timeoutMs)
}

/**
 * Unsuppress after two animation frames (to ensure paints happen).
 */
function unsuppressAfterTwoPaints(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        unsuppressMainDrawer()
        resolve()
      })
    })
  })
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Restore a tab then unsuppress.
 *
 * Sequential contract (not content-only race):
 * 1. Phase H — poll every RESTORE_TAB_POLL_MS; re-click when polls%3===0 and
 *    host not active; require RESTORE_HOST_STABLE_POLLS consecutive active polls.
 * 2. Phase C — content settle (mutation quiet or short fallback).
 * 3. Final stamp + repark, then two-rAF unsuppress.
 *
 * Mirror highlight alone is never "ready" — only host tabBtnActive.
 */
async function restoreTab(
  targetTabId: string | null,
  preferMirror: boolean,
  timeout: number,
  opts?: {
    repark?: () => void
    isMirrorMode?: boolean
  },
): Promise<void> {
  if (_stopped) return

  if (!targetTabId) {
    opts?.repark?.()
    await unsuppressAfterTwoPaints()
    return
  }

  const repark = opts?.repark
  const isMirrorMode = opts?.isMirrorMode ?? false
  const deadline = Date.now() + timeout
  let polls = 0
  let stable = 0

  // Phase H: host-stable polls
  while (!_stopped && Date.now() < deadline) {
    if (isHostPrimaryTabActive(targetTabId)) {
      stable++
      if (stable >= RESTORE_HOST_STABLE_POLLS) break
    } else {
      stable = 0
      if (polls % 3 === 0) {
        clickRestoredPrimaryTab(targetTabId, preferMirror)
      }
    }
    // Host mode needs per-tick stamp; mirror CSS covers shell while pending.
    if (!isMirrorMode) {
      stampPanelBodyHide()
    }
    repark?.()
    polls++
    await delayMs(RESTORE_TAB_POLL_MS)
  }

  // Phase C: content settle only after host stable (or overall timeout)
  if (!_stopped) {
    const remaining = Math.max(0, deadline - Date.now())
    // Even on host timeout, give content a brief chance if budget left;
    // if budget exhausted waitForSettle(0) still runs fallback path quickly.
    await waitForSettle(remaining > 0 ? remaining : RESTORE_CONTENT_FALLBACK_MS)
  }

  // Final stamp + repark while still pending, then reveal.
  if (!isMirrorMode) {
    stampPanelBodyHide()
  }
  repark?.()
  await unsuppressAfterTwoPaints()
}

/**
 * Find the host button for a persisted primary tabId and activate it.
 * Never dispatches through main-mirror onMirrorClick — that path
 * toggle-closes when the drawer is already open on the same tab.
 * When taskbar mode / canvas-main is active, also set the Canvas active
 * key via activateMainMirrorFromRestore; `opts.open === false` suppresses
 * the shell open (content re-assert only).
 */
function clickRestoredPrimaryTab(
  targetTabId: string | null,
  preferMirror: boolean,
  opts?: { open?: boolean },
): boolean {
  if (!targetTabId) return false
  const sidebar = document.querySelector(
    '[data-spindle-mount="sidebar"]',
  ) as HTMLElement | null
  let tabBtn =
    sidebar?.querySelector(
      `button[data-tab-id="${CSS.escape(targetTabId)}"]`,
    ) as HTMLButtonElement | null
  if (!tabBtn) {
    tabBtn = sidebar?.querySelector(
      `button[title="${CSS.escape(targetTabId)}"]`,
    ) as HTMLButtonElement | null
  }
  // Bare-id / suffix-drift: layout may store full spindle id while host
  // buttons use data-tab-id="profile" | "memory" etc.
  if (!tabBtn && targetTabId.includes(':')) {
    const bare = targetTabId.replace(/:\d+$/, '').split(':').pop()
    if (bare) {
      tabBtn = sidebar?.querySelector(
        `button[data-tab-id="${CSS.escape(bare)}"]`,
      ) as HTMLButtonElement | null
    }
  }

  // Canvas main-mirror mode: activate via host + open helper (no mirror.click).
  // preferMirror only means "we are in taskbar mode restore"; still use host for content.
  if (preferMirror || document.documentElement.classList.contains('sidebar-ux-canvas-main-active')) {
    void import('./main-tab-pin').then((m) => {
      const title =
        tabBtn?.getAttribute('title') ||
        tabBtn?.getAttribute('aria-label') ||
        targetTabId
      m.activateMainMirrorFromRestore(tabBtn, title, opts)
    }).catch((err) => {
      dlog(`main-persist restore: activateMainMirrorFromRestore failed: ${err}`)
      // Fallback: host click only if available
      if (tabBtn) {
        try { tabBtn.click() } catch { /* ignore */ }
      }
    })
    // Host-only path if import path will run; if no host yet, try bare host later.
    if (tabBtn || document.querySelector('.sidebar-ux-main-tab-mirror-btn')) {
      return true
    }
  }

  if (!tabBtn) {
    dlog(`main-persist restore: no button for tabId="${targetTabId}"`)
    return false
  }
  try {
    tabBtn.click()
    return true
  } catch (err) {
    dlog(`main-persist restore: tab click threw: ${err}`)
    return false
  }
}

/** Max polls if the host is slow to honor the tab click (~1s). */
const RESTORE_TAB_POLL_MAX = 50
const RESTORE_TAB_POLL_MS = 16

/**
 * Activate the restored tab, keep stamping panel-body hide, reveal only
 * after **host** tabBtnActive matches and panel body has settled
 * (mutation quiet or short fallback). Mirror chrome alone must not
 * unsuppress — activateMainMirrorFromRestore paints highlight before
 * React commits children.
 *
 * Optimizations (Issue 13):
 * - Mirror module import hoisted once per run(), not per polls%3 tick.
 * - In mirror mode, per-tick stampPanelBodyHide is skipped (CSS guard
 *   class already covers the wrapper + panel bodies; stamp once on
 *   enter and at settle).
 * - Phase split: host wrong → cheap re-click; host correct → settle.
 */
function scheduleRestoreTabThenUnsuppress(
  targetTabId: string | null,
  preferMirror: boolean,
  fallbackClickFirstHostTab = false,
): void {
  const run = async () => {
    if (_stopped) {
      unsuppressMainDrawer()
      return
    }

    // Hoist the mirror module import once — avoids per-tick dynamic import.
    let mirrorMod: typeof import('./main-mirror-drawer') | null = null
    let mirrorLoaded = false
    void import('./main-mirror-drawer').then((m) => {
      mirrorMod = m
      mirrorLoaded = true
      // Force repark while still hidden — tab click may recreate panelContent
      // under the host; repark watch is slower once restore-pending lifts.
      m.ensureHostContentParkedPublic()
    }).catch(() => { /* mirror not loaded */ })

    const reparkIfNeeded = () => {
      if (mirrorLoaded && mirrorMod) {
        mirrorMod.ensureHostContentParkedPublic()
      }
    }

    // Detect mirror mode: the restore-pending CSS guard covers the wrapper
    // via class rules, so per-tick inline stamp is redundant in mirror mode.
    const isMirrorMode = preferMirror
      || document.documentElement.classList.contains('sidebar-ux-canvas-main-active')

    // Stamp once at entry (host mode needs it; mirror mode is covered by CSS).
    if (!isMirrorMode) {
      stampPanelBodyHide()
    }

    if (targetTabId) {
      // Always drive restore click when host is not on target. Mirror-only
      // "active" does not skip the click (host may still be Profile).
      if (!isHostPrimaryTabActive(targetTabId)) {
        clickRestoredPrimaryTab(targetTabId, preferMirror)
      }
    } else if (fallbackClickFirstHostTab) {
      const sidebar = document.querySelector(
        '[data-spindle-mount="sidebar"]',
      ) as HTMLElement | null
      const first =
        sidebar?.querySelector('button[class*="tabBtn"]') as HTMLButtonElement | null
      if (first) {
        try { first.click() } catch (err) {
          dlog(`main-persist restore: first-tab click threw: ${err}`)
        }
      }
    }

    // Host-stable N + content settle + repark; unsuppress inside restoreTab.
    const timeout = RESTORE_TAB_POLL_MAX * RESTORE_TAB_POLL_MS
    await restoreTab(targetTabId, preferMirror, timeout, {
      repark: reparkIfNeeded,
      isMirrorMode,
    })

    dlog('main-persist restore: unsuppress (host-stable + content settle)')
  }

  if (RESTORE_TAB_CLICK_MS > 0) {
    setTimeout(run, RESTORE_TAB_CLICK_MS)
  } else {
    run()
  }
}

/**
 * Find the host's "drawer tab" toggle button — the direct-child <button>
 * inside the wrapper that opens/closes the main drawer. In the DOM
 * hierarchy it's the sibling of the drawer div:
 *
 *   div.wrapper
 *     button.drawerTab   ← this one (toggle open/close)
 *     div.drawer
 */
export function findDrawerToggleButton(wrapper: HTMLElement): HTMLButtonElement | null {
  // Direct-child buttons inside the wrapper
  const buttons = wrapper.querySelectorAll(':scope > button')
  for (const btn of buttons) {
    // The host's drawer-tab button has a class containing "drawerTab"
    // (CSS-module hashed). Match by substring.
    if (/drawerTab/i.test((btn as HTMLElement).className)) {
      return btn as HTMLButtonElement
    }
  }
  return null
}

/**
 * Core initialization: attach all observers, seed state, suppress/restore.
 * Extracted from startMainDrawerPersistence so it can be called either
 * immediately (drawer already in DOM) or after _waitForDrawerDOM resolves.
 */
function _initObservers(drawer: HTMLElement): void {
  // The wrapper (which carries `wrapperOpen`) is the grandparent of
  // the sidebar mount node, NOT the parent. DOM hierarchy:
  //   div.wrapper[.wrapperOpen]     ← we need this (grandparent)
  //     button.drawerTab
  //     div.drawer                  ← getMainDrawer() returns this
  //       div.sidebar[data-spindle-mount="sidebar"]
  //
  // If the grandparent has no `wrapperOpen`-like class on first read
  // (drawer starts closed), walk upward to the closest ancestor with
  // a "wrapper" CSS-module class (the mangled name always contains
  // "wrapper" as a substring — confirmed from ViewportDrawer.module.css).
  let wrapper: HTMLElement = drawer as HTMLElement
  // Try parent (in case getMainDrawer already returns the wrapper)
  const parent = drawer.parentElement as HTMLElement | null
  if (parent && parent.classList.toString().match(/wrapper/i)) {
    wrapper = parent
  }
  // Also try grandparent (the common case)
  const grandparent = parent?.parentElement as HTMLElement | null
  if (grandparent && grandparent.classList.toString().match(/wrapper/i)) {
    wrapper = grandparent
  }
  _wrapper = wrapper

  // Immediately hide the wrapper to prevent a flash of the default
  // (open) state while the async LOAD_LAYOUT round-trip resolves.
  // unsuppressMainDrawer() is called by restoreMainDrawerFromDom()
  // after the state is applied, or by the 3s safety-net timeout.
  suppressMainDrawer()

  // Owned model tracks drawer state; no-op setMainDrawerState retired.


  // Observe the wrapper's class attribute. Open/close transitions
  // toggle `wrapperOpen`. S3: this observer now serves ONLY the mobile
  // exclusion hooks — host-state persistence flows through the owned
  // model (dispatch), not host-DOM observation.
  //
  // S6 shell truth (live-verify follow-up 2026-09-12): while the Canvas main
  // shell owns the surface, the host wrapper is HEADLESS. Canvas's own
  // pre-activation clicks (`hostBtn.click()` in builtin-move) run the host's
  // `handleTabClick → openDrawer()` as a side effect, which flips
  // `wrapperOpen`. Reacting to that here closed the second drawer and
  // stamped `canvas-ux-mobile-primary-open` for a drawer the user never
  // opened (the host mobile backdrop then swallowed taps over the secondary).
  // Shell open/close paths call setMobileOpenClass themselves, so ignore
  // host class churn entirely while the shell is active.
  _classObserver = new MutationObserver((mutations) => {
    if (_stopped) return
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'class') {
        // Mobile exclusion: detect closed→open transition
        if (wrapper) {
          if (isMainMirrorActive()) {
            dlog('[main-persist] classObserver: shell owns surface — host wrapper class ignored')
            break
          }
          const isOpen = readWrapperOpen(wrapper)
          enforceExclusionOnOpen('primary')
          setMobileOpenClass('primary', isOpen)
        }
        break
      }
    }
  })
  _classObserver.observe(wrapper, { attributes: true, attributeFilter: ['class'] })
}

export function startMainDrawerPersistence(): void {
  if (!_stopped) return
  _stopped = false

  const drawer = getMainDrawer()
  if (!drawer) {
    
    waitForDrawerDOM(
      { get value() { return _stopped } },
      _initObservers,
    )
    return
  }
  _initObservers(drawer)
}

/**
 * Re-click the persisted primary tab after secondary layout restore.
 * assignToSecondary can shove the host back to profile; unassign can leave
 * host tabBtnActive while the panel body is empty/stale after tabLocations
 * reset. Always re-click so content settles — host-only "already active"
 * skip previously left blank panels after Load previous unassign.
 * Does not toggle the restore-pending guard.
 */
export function ensureRestoredPrimaryTab(targetTabId: string): void {
  if (!targetTabId || _stopped) return
  // Do not early-return on isHostPrimaryTabActive: after unassignFromSecondary
  // the host button can still carry tabBtnActive while ContainerTabContent
  // has not re-rendered into main-drawer yet. Re-click forces content settle.
  // S1: prefer the mirror path whenever the Canvas main shell is the surface.
  //
  // `open: false` (live-verify): this is a CONTENT re-assert called by the
  // boot placement pass (and its +500ms retry) — it must never touch the
  // shell's open/close state. It previously ran after
  // restoreMainDrawerFromDom had honored a persisted `primary.open: false`
  // and reopened the drawer via onMainMirrorTabActivated.
  clickRestoredPrimaryTab(targetTabId, isMainMirrorActive(), { open: false })
}

/**
 * Restore the main-drawer open/close state on load by simulating a
 * click on the host's first tab button. Called from
 * src/setup.ts after loadLayoutFromDisk resolves.
 *
 * Optionally restores the drawer width by setting `drawer.style.width`
 * and the `--drawer-panel-w` CSS variable on the wrapper (mirroring
 * the resize handle's onDrag logic in resize/handles.ts).
 */
export function restoreMainDrawerFromDom(
  targetOpen: boolean,
  targetTabId: string | null,
  targetWidthPx?: number,
  opts?: { restoreOpen?: boolean; restoreWidth?: boolean },
): void {
  if (_stopped) return
  const restoreOpen = opts?.restoreOpen !== false
  const restoreWidth = opts?.restoreWidth !== false
  const drawer = getMainDrawer()
  const wrapper = _wrapper || (drawer as HTMLElement | null)
  if (!wrapper) {
    dlog('main-persist restore: no wrapper in DOM, cannot restore')
    unsuppressMainDrawer()
    return
  }

  // Restore width first (even if the drawer is closed, the width
  // should be applied so it's visible when the user opens it).
  // NOTE: --drawer-panel-w is only set when the target state is OPEN
  // and the viewport is desktop (>600px). On mobile, the host's CSS
  // (ViewportDrawer.module.css @media max-width:600px) forces
  // .drawer { width: calc(100vw / var(--lumiverse-ui-scale, 1)) !important }
  // independently. Setting the variable with !important on mobile
  // decouples the wrapper transform from the actual drawer width,
  // causing a ~80px peek when the user closes the sidebar.
  const clampedWidth = (restoreWidth && typeof targetWidthPx === 'number' && targetWidthPx > 0)
    ? clampSidebarWidth(targetWidthPx)
    : null

  // Canvas main-mirror owns open/close + width while the shell is the main
  // surface on desktop (S1: shell is unconditional — no taskbarMode gate).
  // Host wrapperOpen / --drawer-panel-w are headless and must not drive
  // restore — apply MAIN_MIRROR_WIDTH_VAR and open/close the shell.
  //
  // Stay suppressed until after the restored tab is activated: the host
  // defaults to "profile", and opening the mirror early would flash that
  // panel for a frame (or ~100ms) before the deferred tab click.
  const mirrorActive = isMainMirrorActive()
  // Larger mobile detection for host main drawer width.
  // When true, saved width must not be stamped inline; either host CSS
  // (≤600px) or JS full-bleed force (coarse, >600) takes over.
  const isHostMobile = isHostMobileDrawerViewport()
  if (mirrorActive) {
    void import('./main-mirror-drawer').then((m) => {
      if (_stopped) {
        unsuppressMainDrawer()
        return
      }
      if (clampedWidth !== null && !isMobileViewport()) {
        // S6: on mobile the shell is full-bleed — never stamp the saved
        // desktop width over the viewport width.
        m.applyMainMirrorRestoredWidth(clampedWidth)
      }
      if (!restoreOpen) {
        // Width-only: leave open/close alone; still lift the guard.
        unsuppressMainDrawer()
        return
      }
      if (targetOpen) {
        m.openCanvasMainDrawer()
        // Prefer mirror button; always wait for tab click before showing.
        scheduleRestoreTabThenUnsuppress(targetTabId, true)
      } else {
        m.closeCanvasMainDrawer()
        unsuppressMainDrawer()
        // Re-assert the persisted closed state AFTER the guard lifts: during
        // the restore window observe() reads host truth (default-open), and a
        // boot host-sync can adopt open:true into the model/disk. observe()
        // now reads shell truth (closed), so this write is drift-free and
        // keeps "close → refresh → stays closed" durable.
        m.persistCanvasMainOpenState()
      }
    })
    return
  }

  // Host-mobile: clear any Canvas-set inline width and let host CSS
  // (≤600px) or our full-bleed override (larger touch mobile) take over.
  // This prevents a saved desktop width (e.g. 420px) from staying
  // stamped with !important after the viewport crosses into mobile.
  // S1: reached only when the mirror is inactive (no taskbar gate — on
  // mobile the shell is always torn down, host owns the width).
  if (isHostMobile && drawer) {
    drawer.style.removeProperty('width')
    wrapper.style.removeProperty('--drawer-panel-w')
    if (!isMobileViewport()) {
      // Larger mobile (coarse, >600, no @media full-width rule):
      // force via the scaled viewport +1px expression.
      wrapper.style.setProperty(
        '--drawer-panel-w',
        'calc(var(--app-scaled-viewport-width, calc(100vw / var(--lumiverse-ui-scale, 1))) + 1px)',
        'important',
      )
    }
  }

  if (!restoreOpen) {
    // Width-only: apply width if currently open; do not click open/close.
    const currentOpen = readWrapperOpen(wrapper)
    if (currentOpen && clampedWidth !== null && drawer && !isHostMobile) {
      if (!isPointerResizeActive()) {
        drawer.style.width = `${clampedWidth}px`
        wrapper.style.setProperty('--drawer-panel-w', `${clampedWidth}px`, 'important')
      }
    }
    unsuppressMainDrawer()
    return
  }

  const currentOpen = readWrapperOpen(wrapper)
  if (currentOpen === targetOpen) {
    // If the drawer is open, set the width so it's correct on this session.
    // If closed, leave --drawer-panel-w alone — the host's CSS uses it
    // for the close animation (translateX). Clearing it breaks the
    // animation on desktop.
    if (targetOpen && clampedWidth !== null && drawer && !isHostMobile) {
      if (!isPointerResizeActive()) {
        drawer.style.width = `${clampedWidth}px`
        wrapper.style.setProperty('--drawer-panel-w', `${clampedWidth}px`, 'important')
      }
    }
    // Drawer is already in the target state — still restore the active tab
    // before lifting the guard so profile does not paint first.
    if (targetOpen) {
      scheduleRestoreTabThenUnsuppress(targetTabId, false)
    } else {
      unsuppressMainDrawer()
    }
    return
  }
  if (targetOpen) {
    // Set width BEFORE opening so the drawer renders at the right size.
    // On mobile, skip the width override — the host's mobile CSS
    // handles sizing and setting --drawer-panel-w with !important
    // causes the close-animation peek.
    if (clampedWidth !== null && drawer && !isHostMobile) {
      if (!isPointerResizeActive()) {
        drawer.style.width = `${clampedWidth}px`
        wrapper.style.setProperty('--drawer-panel-w', `${clampedWidth}px`, 'important')
      }
    }
    // Open by clicking the restored tab (or first host tab). Stay
    // suppressed until after the click so the default profile panel
    // never paints.
    scheduleRestoreTabThenUnsuppress(targetTabId, false, true)
  } else {
    // Target state is "closed" but drawer is open. The host's
    // drawer-tab button (sibling of the drawer div inside the wrapper)
    // toggles open/close. Click it to close.
    const toggleBtn = findDrawerToggleButton(wrapper)
    if (toggleBtn) {
      try {
        toggleBtn.click()
      } catch (err) {
        dlog(`main-persist restore: toggleBtn.click() threw: ${err}`)
      }
    }
    unsuppressMainDrawer()
  }
}

export function stopMainDrawerPersistence(): void {
  if (_stopped) return
  _stopped = true
  if (_classObserver) { _classObserver.disconnect(); _classObserver = null }
  cleanupDomPoll()
  // Drop any mid-session reveal hold + lift any in-flight restore guard so
  // teardown does not leave the drawer permanently hidden/stamped. Also kill
  // a pending reveal fade + the secondary placement gate so no stray class
  // survives the unload.
  _revealHolds = 0
  _secondaryPlacementHolds = 0
  if (typeof document !== 'undefined') {
    document.documentElement.classList.remove(REVEAL_HOLD_CLASS)
    if (_revealInTimer) { clearTimeout(_revealInTimer); _revealInTimer = null }
    document.documentElement.classList.remove(REVEAL_IN_CLASS)
    document.documentElement.classList.remove(REVEAL_IN_MAIN_HOST_CLASS)
    document.documentElement.classList.remove(SECONDARY_PLACEMENT_HOLD_CLASS)
    if (_secondaryRevealTimer) { clearTimeout(_secondaryRevealTimer); _secondaryRevealTimer = null }
    document.documentElement.classList.remove(SECONDARY_REVEAL_IN_CLASS)
  }
  unsuppressMainDrawer()
  document.getElementById(RESTORE_GUARD_STYLE_ID)?.remove()
  _wrapper = null
}
