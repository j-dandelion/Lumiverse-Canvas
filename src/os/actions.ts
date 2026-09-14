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
import { dlog } from '../debug/log'

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
  return dispatchBatch([
    { t: 'setClosed', key, closed: true },
    { t: 'setDrawer', side, open: false },
  ])
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
  return dispatchBatch([
    { t: 'deactivate', side },
    { t: 'setDrawer', side, open: false },
  ])
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
  // applySetDrawer keeps the drawer's saved width).
  const openDrawer: Promise<void> = model.drawers[side].open
    ? Promise.resolve()
    : dispatch({ t: 'setDrawer', side, open: true })

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

  return openDrawer.then(() => move).then(() => open)
}
