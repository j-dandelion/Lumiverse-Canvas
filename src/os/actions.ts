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
import { parseBuiltinKey } from '../core/model'
import { dispatch, dispatchBatch, dispatchMoveByLiveId, getHost, getModel } from '../recon/dispatch'
import { getSettings, isHorizontalStrip, isOsModeEnabled } from '../settings/state'
import { isCoreTabId } from '../tabs/core-tabs'
import { suppressNextCloseAnchor } from '../sidebar/panel-motion'
import { commandDrawerOpen } from './drawer-command'
import { dlog } from '../debug/log'

/**
 * True when closing this window must also mark the tab hidden in Configure
 * Tabs. Only core built-ins need the reflection (`coreTabsHidden` is forced
 * on by OS mode); non-core close semantics stay closed-only. The check uses
 * the resolved model key — live ids may carry `:N` suffix drift, while
 * `CORE_HIDE_LOCKED` holds bare ids.
 */
function shouldHideOnClose(key: string): boolean {
  if (!getSettings().coreTabsHidden) return false
  const coreId = parseBuiltinKey(key)
  return !!coreId && isCoreTabId(coreId)
}

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
  // Core tabs (with coreTabsHidden on): closing also marks the tab hidden so
  // Configure Tabs reflects the closed state. Appended AFTER setClosed so the
  // displayed-window clear (D17) is never replaced by a neighbor via
  // applySetHidden's active-replacement branch.
  const hideOnClose = shouldHideOnClose(key)
  if (!wasDisplayed) {
    return dispatchBatch([
      { t: 'setClosed', key, closed: true },
      ...(hideOnClose ? [{ t: 'setHidden', key, hidden: true } as const] : []),
    ])
  }
  // D17 + D7: closing the displayed window → no active → collapse.
  // The close animation must NOT collapse toward the window's strip button:
  // the button is about to be hidden, and the model commit below is async, so
  // the anchor resolver would still see it. Fade in place instead (user:
  // "no associated tab button → fade out without moving"). Guarded on the
  // drawer being open — a closed drawer has no collapse to animate.
  if (model.drawers[side].open) suppressNextCloseAnchor(side)
  const result = dispatchBatch([
    { t: 'setClosed', key, closed: true },
    { t: 'setDrawer', side, open: false },
    ...(hideOnClose ? [{ t: 'setHidden', key, hidden: true } as const] : []),
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
 * Visible index that lands a freshly launched (previously absent) window at
 * the drawer's END:
 *   - vertical (Sides): append → the bottom of the strip.
 *   - horizontal (Top/Bottom): the clusters are anchored to their drawer's
 *     screen edge, so the end closest to the screen middle is index `-1` for
 *     a LEFT drawer (the order runs away from the left edge) but index `0`
 *     for a RIGHT drawer (the run is right-anchored by the CSS spacer, so
 *     index 0 already faces the middle).
 * `primary` uses the main drawer's physical side; `secondary` is the
 * opposite. Pure so the per-side mapping is directly testable.
 */
export function launchEndVisibleIndex(
  side: Side,
  mainDrawerSide: 'left' | 'right',
  horizontal: boolean,
): number {
  if (!horizontal) return -1
  const physical =
    side === 'primary'
      ? mainDrawerSide
      : mainDrawerSide === 'left'
        ? 'right'
        : 'left'
  return physical === 'right' ? 0 : -1
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
 * Launch placement (2026-09-16): a window that was ABSENT (closed or hidden)
 * is reordered to the drawer's end in the same commit — launching changes
 * its order. A window whose strip button is already in the drawer (open or
 * minimized) keeps its slot. The predicate is snapshotted before the batches
 * mutate it.
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
  const isHidden = model.hidden.includes(key)
  const livesInTarget = side === 'primary' ? model.primary.includes(key) : model.secondary.includes(key)
  const sourceSide: Side = side === 'primary' ? 'secondary' : 'primary'
  const activate = livesInTarget || model.active[sourceSide] === key || isClosed
  // Launch placement: absent windows move to the end of the target drawer.
  const absent = isClosed || isHidden
  const launchIndex = absent
    ? launchEndVisibleIndex(side, model.side, isHorizontalStrip())
    : -1

  // Hidden targets (Start-menu recovery path): activation is hidden-gated in
  // the reducer, so un-hide FIRST — otherwise the activate intent is dropped
  // and the tail still clicks host content through, leaving displayed content
  // with no active window. Un-hiding also restores the strip button. Same
  // drawer → the launch-end reorder folds into this batch; cross-drawer
  // absents are placed by the move's explicit index below.
  const unhide: Promise<void> = isHidden
    ? dispatchBatch([
        { t: 'setHidden', key, hidden: false },
        ...(livesInTarget
          ? [{ t: 'reorder', key, side, index: launchIndex } as const]
          : []),
      ])
    : Promise.resolve()

  // D19: auto-open the target drawer when it is closed (width omitted —
  // applySetDrawer keeps the drawer's saved width). Primary is shell-owned:
  // the model write is suppressed, so command the shell directly too.
  const drawerClosed = !model.drawers[side].open
  const openDrawer: Promise<void> = drawerClosed
    ? dispatch({ t: 'setDrawer', side, open: true })
    : Promise.resolve()
  if (drawerClosed) commandDrawerOpen(side, true)

  // D13: cross-drawer move first (no focus during the move). Absent launches
  // carry their launch-end index; present ones keep the append default.
  const move = livesInTarget
    ? Promise.resolve()
    : dispatchMoveByLiveId(liveId, false, absent ? launchIndex : undefined)

  // Un-close + activate in one folded model transition — LAZY so the
  // `activate=false` branch (D13 minimized arrival) never dispatches it.
  // Identity no-ops short-circuit inside reduce. A closed-but-visible
  // same-drawer window also folds its launch-end reorder between un-close and
  // activate (hidden keys already reordered in the un-hide batch).
  const open: Promise<void> = activate
    ? dispatchBatch([
        { t: 'setClosed', key, closed: false },
        ...(isClosed && !isHidden && livesInTarget
          ? [{ t: 'reorder', key, side, index: launchIndex } as const]
          : []),
        { t: 'activate', key, side },
      ])
    : Promise.resolve()

  return unhide
    .then(() => openDrawer)
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
