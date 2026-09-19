// Unified chrome-location reconciliation (settings overhaul 2026-09-19).
//
// Three settings resolve against live drawer state (main side + second-drawer
// enablement):
//   - optionsButtonLocation → Settings gear per drawer
//   - startButtonLocation   → OS Start button per drawer
//   - startButtonAlwaysOnScreenEdge → Start order in Top/Bottom strips
//
// One function keeps them consistent. It MUST be called from every chrome
// lifecycle event, not just `applySettings`:
//   - the three settings' feature mount/apply
//   - DRAWER_SHELL_CREATED_EVENT (second-drawer enable / shell remount)
//   - refreshSideGeometry (S4 side flips are geometry-only — no shell event)
//   - resetSideRemountStateAfterDisable (second-drawer disable)
//   - drawerLocationFeature.apply (Sides ↔ Top/Bottom)
//   - after applyCanvasSideChange settles
//
// Why not rely on applySettings: it early-returns when the settings panel was
// never mounted (`_settingsPanelCtx` null) and it keys on `feature.id`, so
// side/dual changes (no settings diff) never reach it.

import { getSettings } from '../settings/state'
import { getMainDrawerSide } from '../store'
import { resolveChromeSides } from '../sidebar/chrome-sides'
import { applyOptionsButtonLocation, teardownSettingsDock } from '../sidebar/settings-dock'
import { reconcileStartChrome } from './start-menu'
import { DRAWER_SHELL_CREATED_EVENT } from '../sidebar/drawer-shell'
import { dlog } from '../debug/log'

// ── Shell-created re-reconcile ───────────────────────────────────────────────
// Second-drawer enable creates the shell asynchronously with no settings diff
// for the chrome-location features; without this listener the Options gear /
// Start halves are not re-resolved against the new world.

let _onShellCreated: (() => void) | null = null

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

/** Remove the shell-created listener (teardown; safe when never installed). */
export function removeShellCreatedListener(): void {
  try {
    if (_onShellCreated && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener(DRAWER_SHELL_CREATED_EVENT, _onShellCreated)
    }
  } catch {
    /* ignore */
  }
  _onShellCreated = null
}

/** Marks `<html>` while Start anchors to the TAB-FACING strip end. A class on
 *  the root (not per-pin-host attrs) so pin-host recreation — which happens on
 *  every Top/Bottom reconcile — can never drop the variant. */
export const START_EDGE_INNER_CLASS = 'sidebar-ux-start-edge-inner'

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

/**
 * Reconcile all three location-dependent chrome surfaces. Idempotent and
 * safe in stub/headless environments (every DOM access is guarded inside the
 * callees).
 */
export function reconcileChromeLocations(): void {
  ensureShellCreatedListener()
  const s = getSettings()
  const mainSide = getMainDrawerSide()
  const secondEnabled = !!s.secondSidebarEnabled
  applyOptionsButtonLocation(
    resolveChromeSides(s.optionsButtonLocation, mainSide, secondEnabled),
  )
  applyStartEdgeClass()
  reconcileStartChrome()
}

/** Extension-disable teardown: drop the secondary gear + the edge class, and
 *  detach the shell listener. Start chrome is owned by os/start-menu's own
 *  teardown chain. */
export function teardownChromeLocations(): void {
  removeShellCreatedListener()
  teardownSettingsDock()
  clearStartEdgeClass()
}
