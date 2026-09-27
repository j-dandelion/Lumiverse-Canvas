// Unified chrome-location reconciliation (settings overhaul 2026-09-19).
//
// Three settings resolve against live drawer state (main side + second-drawer
// enablement):
//   - optionsButtonLocation → Settings gear per drawer
//   - startButtonLocation   → OS Start button per drawer
//   - startButtonAlwaysOnScreenEdge → Start order in Top/Bottom strips
//   - startButtonAtStripTop → Start at the top of the vertical Sides strip
//
// One function keeps them consistent. It MUST be called from every chrome
// lifecycle event, not just `applySettings`:
//   - the three settings' feature mount/apply
//   - DRAWER_SHELL_CREATED_EVENT (second-drawer enable / shell remount)
//   - refreshSideGeometry (S4 side flips are geometry-only — no shell event)
//   - resetSideRemountStateAfterDisable (second-drawer disable)
//   - drawerLocationFeature.apply (Sides ↔ Top/Bottom)
//   - after applyCanvasSideChange settles
//   - after a model commit (belt: the panel/boot refresh at setup.ts) and
//     after the main renderer rebuilds its dock (M1/M6)
//
// Why not rely on applySettings: it early-returns when the settings panel was
// never mounted (`_settingsPanelCtx` null) and it keys on `feature.id`, so
// side/dual changes (no settings diff) never reach it.

import { getSettings } from '../settings/state'
import { getMainDrawerSide } from '../store'
import { resolveChromeSides } from '../sidebar/chrome-sides'
import { injectStartStripTopStyles } from '../sidebar/styles'
import { applyOptionsButtonLocation, teardownSettingsDock } from '../sidebar/settings-dock'
import { hideStartMenu, reconcileStartChrome } from './start-menu'
import { DRAWER_SHELL_CREATED_EVENT } from '../sidebar/drawer-shell'
import { dlog } from '../debug/log'

// ── Shell-created re-reconcile ───────────────────────────────────────────────
// Second-drawer enable creates the shell asynchronously with no settings diff
// for the chrome-location features; without this listener the Options gear /
// Start halves are not re-resolved against the new world.

let _onShellCreated: (() => void) | null = null
let _unsubModelChanged: (() => void) | null = null
/** Coalesced rAF/setTimeout cancel for scheduleChromeReconcile. */
let _scheduledCancel: (() => void) | null = null
/** Extension-disable tombstone: late async callers (side-settle imports) must
 *  not resurrect the listener/stylesheet after teardown. Cleared by
 *  `activateChromeLocations()` on the next feature mount (L7 2026-09-19). */
let _disposed = false
/** Bounded deferred-retry budget for the secondary gear (H1 2026-09-19):
 *  DRAWER_SHELL_CREATED_EVENT fires before the secondary wrapper is assigned,
 *  so the first include pass cannot find the tab list. */
let _pendingSecondRetries = 0
const MAX_PENDING_SECOND_RETRIES = 5
/** Last main side seen — detects S4 in-place flips so a body-level Start menu
 *  anchored to the old strip position is dismissed (L8). */
let _lastMainSide: 'left' | 'right' | null = null

function ensureShellCreatedListener(): void {
  if (_onShellCreated !== null) return
  try {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
    _onShellCreated = () => reconcileChromeLocations()
    window.addEventListener(DRAWER_SHELL_CREATED_EVENT, _onShellCreated)
    // Lazy cleanup registration (module loads before the cleanup chain exists
    // in some boot orders). The remover also clears the guard.
    void import('../sidebar/cleanup')
      .then((m) => m.registerCleanup(() => removeShellCreatedListener()))
      .catch(() => { /* cleanup module unavailable in tests */ })
    dlog('[chrome-locations] shell-created listener installed')
  } catch {
    /* stub window */
  }
}

/**
 * Re-reconcile after model commits (dynamic import: chrome-locations is
 * imported by the feature registry, and dispatch is a leaf here). The
 * subscriber is rAF-coalesced and ordered after the main renderer's own
 * model-commit render (registered later), so a gear recreated by that render
 * gets its location state re-applied (M1/M6 2026-09-19).
 */
function ensureModelListener(): void {
  if (_unsubModelChanged !== null) return
  void import('../recon/dispatch')
    .then((m) => {
      if (_disposed || _unsubModelChanged !== null) return
      _unsubModelChanged = m.onModelChanged(() => scheduleChromeReconcile())
    })
    .catch(() => { /* dispatch unavailable in tests */ })
}

/** Remove the shell-created + model listeners (teardown; safe when never installed). */
export function removeShellCreatedListener(): void {
  try {
    if (_onShellCreated && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener(DRAWER_SHELL_CREATED_EVENT, _onShellCreated)
    }
  } catch {
    /* ignore */
  }
  _onShellCreated = null
  try {
    _unsubModelChanged?.()
  } catch {
    /* ignore */
  }
  _unsubModelChanged = null
}

/**
 * Coalesced deferred reconcile (one per frame). Used for the H1 pending-second
 * retry, model-commit re-apply and the post-render main-renderer hook.
 */
export function scheduleChromeReconcile(): void {
  if (_disposed || _scheduledCancel !== null) return
  try {
    if (typeof requestAnimationFrame === 'function') {
      const id = requestAnimationFrame(() => {
        _scheduledCancel = null
        reconcileChromeLocations()
      })
      _scheduledCancel = () => cancelAnimationFrame(id)
      return
    }
    if (typeof setTimeout === 'function') {
      const id = setTimeout(() => {
        _scheduledCancel = null
        reconcileChromeLocations()
      }, 0)
      _scheduledCancel = () => clearTimeout(id)
      return
    }
  } catch {
    /* fall through to the synchronous path */
  }
  reconcileChromeLocations()
}

/** Marks `<html>` while Start anchors to the TAB-FACING strip end. A class on
 *  the root (not per-pin-host attrs) so pin-host recreation — which happens on
 *  every Top/Bottom reconcile — can never drop the variant. */
export const START_EDGE_INNER_CLASS = 'sidebar-ux-start-edge-inner'

/** Marks `<html>` while the Sides Start button sits at the TOP of the vertical
 *  tab strip (startButtonAtStripTop on). Root class again: pin hosts are
 *  recreated by the pin modules and applyPinHostChrome's className assignment
 *  is wholesale, so a per-host attr would drop the variant (docs/pitfalls.md).
 *  CSS styles only the top position (divider spacing); the DOM move itself is
 *  owned by ensureStartButtonForSide (os/start-menu.ts). */
export const START_STRIP_TOP_CLASS = 'sidebar-ux-start-at-strip-top'

/** Apply/clear the Start-order variant on `<html>`. `inner` (setting off) puts
 *  Start on the tab-facing side of its dock; absent keeps the shipped
 *  screen-edge anchoring. CSS owns the order rules. */
function applyStartEdgeClass(): void {
  try {
    const el = document.documentElement
    if (!el || typeof el.classList?.toggle !== 'function') return
    const inner = !getSettings().startButtonAlwaysOnScreenEdge
    el.classList.toggle(START_EDGE_INNER_CLASS, inner)
  } catch {
    /* no document (stub/headless) */
  }
}

/** Remove the edge class (teardown). */
export function clearStartEdgeClass(): void {
  try {
    document.documentElement?.classList?.remove(START_EDGE_INNER_CLASS)
  } catch {
    /* ignore */
  }
}

/** Apply/clear the Sides strip-top variant on `<html>`. */
function applyStartStripTopClass(): void {
  try {
    const el = document.documentElement
    if (!el || typeof el.classList?.toggle !== 'function') return
    injectStartStripTopStyles()
    el.classList.toggle(START_STRIP_TOP_CLASS, !!getSettings().startButtonAtStripTop)
  } catch {
    /* no document (stub/headless) */
  }
}

/** Remove the strip-top class (teardown). */
export function clearStartStripTopClass(): void {
  try {
    document.documentElement?.classList?.remove(START_STRIP_TOP_CLASS)
  } catch {
    /* ignore */
  }
}

/**
 * Reconcile all three location-dependent chrome surfaces. Idempotent and
 * safe in stub/headless environments (every DOM access is guarded inside the
 * callees).
 */
export function reconcileChromeLocations(): void {
  if (_disposed) return
  ensureShellCreatedListener()
  ensureModelListener()
  const s = getSettings()
  const mainSide = getMainDrawerSide()
  // S4 in-place side flips carry no shell event; the buttons re-anchor via
  // the scheduled ensure, but an open body-level menu would keep its old
  // viewport coords. Dismiss it now (same policy as drawerLocation apply).
  if (_lastMainSide !== null && _lastMainSide !== mainSide) {
    hideStartMenu({ immediate: true })
  }
  _lastMainSide = mainSide
  const secondEnabled = !!s.secondSidebarEnabled
  const applied = applyOptionsButtonLocation(
    resolveChromeSides(s.optionsButtonLocation, mainSide, secondEnabled),
  )
  applyStartEdgeClass()
  applyStartStripTopClass()
  reconcileStartChrome()
  if (applied?.pendingSecond) {
    // The shell-created event fires BEFORE the secondary wrapper is assigned;
    // retry on the next frame(s) until the tab list exists (bounded).
    if (_pendingSecondRetries < MAX_PENDING_SECOND_RETRIES) {
      _pendingSecondRetries++
      scheduleChromeReconcile()
    }
  } else {
    _pendingSecondRetries = 0
  }
}

/**
 * Feature-mount entry: clear the teardown tombstone and reconcile. Called by
 * the three chrome-location features so a disable → enable cycle re-arms the
 * listeners (a bare reconcile after teardown is a no-op by design).
 */
export function activateChromeLocations(): void {
  _disposed = false
  _pendingSecondRetries = 0
  reconcileChromeLocations()
}

/** Extension-disable teardown: drop the secondary gear + the edge class, and
 *  detach the shell listener. Start chrome is owned by os/start-menu's own
 *  teardown chain. */
export function teardownChromeLocations(): void {
  _disposed = true
  if (_scheduledCancel) {
    try {
      _scheduledCancel()
    } catch {
      /* ignore */
    }
    _scheduledCancel = null
  }
  removeShellCreatedListener()
  teardownSettingsDock()
  clearStartEdgeClass()
  clearStartStripTopClass()
  _lastMainSide = null
  _pendingSecondRetries = 0
}
