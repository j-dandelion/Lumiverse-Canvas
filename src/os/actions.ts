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
 *               assigned to the other drawer first; the window is always
 *               DISPLAYED in the target drawer (the Start menu launches into
 *               its own drawer) and, unless its button was already there,
 *               placed at the drawer's launch end.
 */

import type { Side } from '../core/model'
import { parseBuiltinKey } from '../core/model'
import { dispatch, dispatchBatch, dispatchMoveByLiveId, getHost, getModel } from '../recon/dispatch'
import { getSettings, isHorizontalStrip, isOsModeEnabled } from '../settings/state'
import { isCoreTabId } from '../tabs/core-tabs'
import { suppressNextCloseAnchor } from '../sidebar/panel-motion'
import { commandDrawerOpen } from './drawer-command'
import { dlog, dwarn } from '../debug/log'

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
 *      drawer's focus to its neighbor (pitfalls §5).
 *   3. Un-close + activate: the window is ALWAYS displayed in the target
 *      drawer, whatever drawer it lived in before (Start-menu launch
 *      semantics — the launching menu's drawer is authoritative).
 *
 * Launch placement (2026-09-16): a window whose strip button is NOT already
 * in the target drawer — absent (closed/hidden) or living in the other drawer
 * — is placed at the drawer's launch end in the same commit (bottom in Sides;
 * middle-facing end in Top/Bottom, see `launchEndVisibleIndex`). A window
 * whose button is already in the target drawer (open or minimized) keeps its
 * slot. The predicate is snapshotted before the batches mutate it.
 *
 * Display rule: `activate` is implicit — every call displays the window in the
 * target drawer, including a window minimized in the other drawer. Only the
 * cross-drawer MOVE keeps its `activateDest: false` (no focus during the
 * move); the open batch owns the focus.
 *
 * Source handoff: a move OUT of the second drawer also unassigns the stale
 * source button and activates the captured neighbor when the moved window was
 * displayed there — the secondary shell's removal/neighbor half is not
 * model-driven. Moves out of the main drawer are model-driven (mirror).
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
  // LUMI-23 (member decision 2026-09-28): the launch NEVER writes the menu
  // axis — no `{t:'setMenuHidden'}` intent fires from this path, in any
  // layout. A menu-hidden panel that is opened stays menu-hidden (dimmed in
  // manage mode, out of the menu's NORMAL list) until the manage checkbox
  // un-hides it. This overturns the LUMI-16b launch-unhide rationale ("a
  // launch is a stronger signal than a manage-mode un-check"). The menu axis
  // is written only from the manage checkbox (start-menu.ts), the OS-disable
  // sweep (os-mode.ts), and the reducer/persist plumbing.
  const livesInTarget = side === 'primary' ? model.primary.includes(key) : model.secondary.includes(key)
  // Launch placement: a button already in the TARGET drawer keeps its slot;
  // every other window (other drawer / closed / hidden) lands at the end.
  const placeAtEnd = !livesInTarget || isClosed || isHidden
  const launchIndex = placeAtEnd
    ? launchEndVisibleIndex(side, model.side, isHorizontalStrip())
    : -1

  // Source-drawer handoff for a move OUT of the second drawer. The secondary
  // shell's removal/neighbor half is NOT model-driven: reconcile derives the
  // observed location from the assignment facade, so a moved-out button is
  // never placed away and the stale source button (plus its header/content)
  // survives as a ghost. Capture the nearest visible neighbor BEFORE any
  // placement (the moved button must still be in the list), then sweep the
  // stale button + activate the neighbor once the move commits. Moves out of
  // the main drawer need none of this — the mirror renders from the model.
  const movingOutOfSecondary = !livesInTarget && side === 'primary'
  const secondaryCapture: Promise<{ neighborBtn: HTMLElement | null }> = movingOutOfSecondary
    // Dynamic: keeps the lean dispatch mocks in unrelated suites working (the
    // helper is only reached on a move out of the second drawer).
    ? import('../recon/dispatch').then((m) => m.captureSecondaryNeighborForMove(liveId))
    : Promise.resolve({ neighborBtn: null })

  // Hidden targets (Start-menu recovery path): activation is hidden-gated in
  // the reducer, so un-hide FIRST — otherwise the activate intent is dropped
  // and the tail still clicks host content through, leaving displayed content
  // with no active window. Un-hiding also restores the strip button. Same
  // drawer → the launch-end reorder folds into this batch; cross-drawer
  // targets are placed by the move's explicit index below.
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

  // D13: cross-drawer move first (no focus during the move). The move carries
  // the target drawer's launch-end index — the button was not in this drawer.
  const move = livesInTarget
    ? Promise.resolve()
    : dispatchMoveByLiveId(liveId, false, launchIndex)

  // Un-close + activate in one folded model transition. Identity no-ops
  // short-circuit inside reduce. A closed-but-visible same-drawer window also
  // folds its launch-end reorder between un-close and activate (hidden keys
  // already reordered in the un-hide batch).
  const open: Promise<void> = dispatchBatch([
    { t: 'setClosed', key, closed: false },
    // LUMI-23: no menu-axis write on launch — a menu-hidden panel opened
    // here keeps its menuHidden membership (see the comment above).
    ...(isClosed && !isHidden && livesInTarget
      ? [{ t: 'reorder', key, side, index: launchIndex } as const]
      : []),
    { t: 'activate', key, side },
  ])

  return secondaryCapture.then((secondaryChrome) =>
    unhide
      .then(() => openDrawer)
      .then(() => move)
      .then(() => open)
      .then(() => {
        // SOURCE CLEANUP BEFORE THE CONTENT CLICK (order matters). Moving a
        // window out of the second drawer re-homes its host button/root:
        // built-ins get `requestHostTabToMain`, extensions are reparented (or
        // detached so the host re-attaches on activation). Clicking the main
        // content BEFORE that re-home leaves the target panel empty — the
        // click resolves against a root still owned by the secondary wrapper
        // (live report 2026-09-16).
        if (!movingOutOfSecondary) return
        return releaseSecondarySource(liveId, secondaryChrome)
      })
      .then(() => {
        // CONTENT SWITCH (D6). A model-only activation does not move the host
        // content: on the primary side reconcile's diffActive is MODEL-derived
        // (observe() reads model.active.primary while the mirror owns the
        // surface), so nothing clicks the host twin; on the secondary the
        // tracked active still equals the tab after an OS minimize (reopen
        // memory), so reconcile's diffActive is a no-op too. Click through the
        // host port — primary = host twin click, secondary = showSecondaryTab
        // (silent: the model activation was dispatched above). Idempotent when
        // the tab is already host-active. Runs AFTER the source re-home so the
        // root is attached on the target side when the click lands.
        void host.activate(side, liveId)
      }),
  )
}

/**
 * Cleanup after an OS launch moved a window OUT of the second drawer:
 * remove the stale source button (the removal half is not model-driven — see
 * `secondaryTabsToUnassign` in sidebar/secondary.tsx) and activate the
 * captured neighbor when the moved window was the drawer's displayed one, so
 * the drawer never keeps a ghost button/header with no content. Mirrors the
 * capture/apply split of `placementFirstMoveByLiveId` (right-click / DnD).
 */
async function releaseSecondarySource(
  liveId: string,
  chrome: { neighborBtn: HTMLElement | null },
): Promise<void> {
  try {
    const drawer = await import('../sidebar/secondary-drawer')
    await drawer.unassignFromSecondary(liveId)
  } catch (err) {
    dwarn('[os] openWindow: secondary source cleanup failed:', err instanceof Error ? err.message : err)
  }
  const dispatchMod = await import('../recon/dispatch')
  await dispatchMod.applySecondaryNeighborHandoff(chrome, liveId)
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
