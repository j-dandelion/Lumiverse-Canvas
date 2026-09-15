/**
 * OS-mode window-state actions (spec §4.3 state machine).
 *
 * The shared API every chrome surface dispatches through — panel-header
 * buttons (minimize/X), strip-button clicks (D4 toggle), the Start menu
 * (D6/D13/D19), and the tab-button context menu (D14). Each action:
 *   - is an OS-mode no-op otherwise (chrome only exists while OS is on,
 *     but the guard makes every call site safe by construction),
 *   - expresses the state change as dispatch intents (pitfalls §2 — model
 *     changes go through dispatch, never facade writes; the reconcile →
 *     chrome → persist flow follows for free), and
 *   - relies on dispatch's identity no-op gate for redundant rounds.
 *
 * Transitions covered:
 *   close     — setClosed(true); closing the ACTIVE window clears it (D17).
 *   minimize  — deactivate(side); the drawer keeps no active window (D17).
 *   open      — D19 auto-opens a closed target drawer; D13 moves a tab
 *               assigned to the other drawer first (a minimized window
 *               arrives minimized; an open or closed one launches displayed).
 */

import type { Side } from '../core/model'
import { dispatch, dispatchBatch, dispatchMoveByLiveId, getHost, getModel } from '../recon/dispatch'
import { isOsModeEnabled } from '../settings/state'
import { commandDrawerOpen } from './drawer-command'
import { dlog } from '../debug/log'

/**
 * The drawer's DISPLAYED window as a live id (null = nothing displayed).
 * The model's active is TabKey-keyed; the host resolves to the live id.
 * Single source for the header chrome's presence checks (D17) and the
 * close policy (D2/D9) — panel-chrome + the header-close seam both use it.
 */
export function getDisplayedLiveId(side: Side): string | null {
  const host = getHost()
  const model = getModel()
  const key = model?.active[side] ?? null
  if (!host || !key) return null
  return host.resolve(key)
}

/**
 * Close a window: strip button hides; the Start menu keeps listing it.
 * Closing the drawer's DISPLAYED window leaves nothing displayed (D17) →
 * the drawer body collapses to the strip (D7 — setDrawer false; the
 * existing drawer-close machinery provides the animation + persist +
 * reflow). Closing a non-displayed (minimized) window is membership only.
 */
export function closeWindowByLiveId(liveId: string): Promise<void> {
  if (!isOsModeEnabled()) return Promise.resolve()
  const host = getHost()
  const model = getModel()
  const key = host?.findKey(liveId)
  if (!host || !model || !key) {
    dlog('[os] closeWindow: unresolved key', { liveId })
    return Promise.resolve()
  }
  const livesInPrimary = model.primary.includes(key)
  const side: Side = livesInPrimary ? 'primary' : 'secondary'
  const wasDisplayed = model.active[side] === key
  if (!wasDisplayed) {
    return dispatch({ t: 'setClosed', key, closed: true })
  }
  // D17 + D7: closing the displayed window → no active → collapse.
  const result = dispatchBatch([
    { t: 'setClosed', key, closed: true },
    { t: 'setDrawer', side, open: false },
  ])
  // The primary shell is the only writer of its open state (the model→host
  // setDrawer write is suppressed — live-verify #1 echo guard); command it
  // directly. No-op when the shell doesn't own the side.
  commandDrawerOpen(side, false)
  return result
}

/**
 * Minimize a window (D4/D17): clear the drawer's active — the panel parks,
 * the strip button stays, nothing is focused — and collapse the drawer
 * body to the strip (D7; the parked windows keep their states per D16).
 * A no-op when the tab is not that drawer's displayed window.
 */
export function minimizeWindowByLiveId(liveId: string, side: Side): Promise<void> {
  if (!isOsModeEnabled()) return Promise.resolve()
  const host = getHost()
  const model = getModel()
  const key = host?.findKey(liveId)
  if (!host || !model || !key) {
    dlog('[os] minimizeWindow: unresolved key', { liveId, side })
    return Promise.resolve()
  }
  if (model.active[side] !== key) {
    dlog('[os] minimizeWindow: not the drawer active — no-op', { liveId, side })
    return Promise.resolve()
  }
  const result = dispatchBatch([
    { t: 'deactivate', side },
    { t: 'setDrawer', side, open: false },
  ])
  // Primary shell command (see closeWindowByLiveId): the model write alone
  // cannot collapse the shell-owned primary drawer.
  commandDrawerOpen(side, false)
  return result
}

/**
 * Open a window in a drawer (D6/D13/D19). Branches compose as a promise
 * chain — each stage reuses the proven dispatch machinery instead of
 * re-deriving placement logic:
 *   1. D19 — auto-open the target drawer when it is closed.
 *   2. D13 — cross-drawer move first via dispatchMoveByLiveId with
 *      `activateDest: false` (no focus during the move — the batch below
 *      decides it). The move's activeAfterRemoval hands the source
 *      drawer's focus to its neighbor (pitfalls §5) while a minimized key
 *      stays minimized through the move.
 *   3. Un-close + activate: closed → the window launches fresh and becomes
 *      the drawer's displayed window.
 *
 * Activation rule: `activate` is true for a same-drawer open/restore
 * (launch or un-minimize), for a window active in the source (becomes
 * displayed here), and for a closed window (launch fresh) — but false for
 * a window minimized in the other drawer (D13: it arrives minimized).
 */
export function openWindowInDrawerByLiveId(liveId: string, side: Side): Promise<void> {
  if (!isOsModeEnabled()) return Promise.resolve()
  const host = getHost()
  const model = getModel()
  const key = host?.findKey(liveId)
  if (!host || !model || !key) {
    dlog('[os] openWindow: unresolved key', { liveId, side })
    return Promise.resolve()
  }

  const isClosed = model.closed.includes(key)
  const livesInTarget = side === 'primary' ? model.primary.includes(key) : model.secondary.includes(key)
  const sourceSide: Side = side === 'primary' ? 'secondary' : 'primary'
  const activate = livesInTarget || model.active[sourceSide] === key || isClosed

  // D19: auto-open the target drawer when it is closed (width omitted —
  // applySetDrawer keeps the drawer's saved width). Primary is shell-owned:
  // the model write is suppressed, so command the shell directly too.
  const drawerClosed = !model.drawers[side].open
  const openDrawer: Promise<void> = drawerClosed
    ? dispatch({ t: 'setDrawer', side, open: true })
    : Promise.resolve()
  if (drawerClosed) commandDrawerOpen(side, true)

  // D13: cross-drawer move first (no focus during the move).
  const move = livesInTarget
    ? Promise.resolve()
    : dispatchMoveByLiveId(liveId, false)

  // Un-close + activate in one folded model transition — LAZY so the
  // `activate=false` branch (D13 minimized arrival) never dispatches it.
  // Identity no-ops short-circuit inside reduce.
  const open: Promise<void> = activate
    ? dispatchBatch([
        { t: 'setClosed', key, closed: false },
        { t: 'activate', key, side },
      ])
    : Promise.resolve()

  return openDrawer
    .then(() => move)
    .then(() => open)
    .then(() => {
      // CONTENT SWITCH (D6). A model-only activation does not move the host
      // content: on the primary side reconcile's diffActive is MODEL-derived
      // (observe() reads model.active.primary while the mirror owns the
      // surface), so nothing clicks the host twin; on the secondary the
      // tracked active still equals the tab after an OS minimize (reopen
      // memory), so reconcile's diffActive is a no-op too. Click through the
      // host port — primary = host twin click, secondary = showSecondaryTab
      // (silent: the model activation was dispatched above). Idempotent when
      // the tab is already host-active; skipped for a minimized arrival
      // (D13).
      if (activate) void host.activate(side, liveId)
    })
}

/**
 * D4 strip-click toggle: minimize the drawer's DISPLAYED window, otherwise
 * open/restore it (cross-drawer move per D13, closed-drawer auto-open per
 * D19).
 *
 * The MODEL's active is the predicate. The secondary drawer's tracked active
 * (getActiveSecondaryTabId) deliberately survives OS minimize/close as
 * reopen memory, so a tracked-based predicate makes every post-minimize
 * strip click a no-op minimize and never reopens the window.
 */
export function toggleWindowByLiveId(liveId: string, side: Side): Promise<void> {
  if (!isOsModeEnabled()) return Promise.resolve()
  const host = getHost()
  const model = getModel()
  const key = host?.findKey(liveId)
  if (!host || !model || !key) {
    dlog('[os] toggleWindow: unresolved key', { liveId, side })
    return Promise.resolve()
  }
  const displayed = model.drawers[side].open && model.active[side] === key
  return displayed
    ? minimizeWindowByLiveId(liveId, side)
    : openWindowInDrawerByLiveId(liveId, side)
}
