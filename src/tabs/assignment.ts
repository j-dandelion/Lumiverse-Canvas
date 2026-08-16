// Tab assignment system: which tabId is on which sidebar, and the
// assignTab policy layer that wires the move through the host.
//
// The owned model (LayoutModel in src/core/model.ts) is the source of
// truth for tab placement. This module is now a thin facade: reads
// derive from the owned model, and writes are no-ops when the model is
// active (the model handles placement via dispatch). The legacy move
// path (`assignTab`) is retained for callers that haven't been cut
// over to the dispatcher yet and is slated for deletion in Task 10.7.
import { dwarn } from '../debug/log'
import { isMobileViewport } from '../sidebar/mobile-exclusion'
import { getSettings } from '../settings/state'
import {
  ensureSecondaryShellMounted,
  isSecondarySidebarOpen,
  openSecondarySidebar,
} from '../sidebar/secondary'
import {
  hideMainTabButton, findMainTabButton,
  addSecondaryTabButton, updateDrawerTabVisibility,
  readMainButtonShortName,
} from '../tabs/buttons'
import {
  runHandoff,
  buildCrossDrawerHandoff,
  captureSourceList,
  reassertPrimaryNeighborAfterHandoff,
  armPreservePrimaryActiveOnToSecondary,
} from './activation-handoff'
import {
  isTabActiveInMainDrawer,
  getActiveSecondaryTabId,
  setActiveSecondaryTabId,
} from './active-tab'
import { getHostBridge } from '../dom/host-bridge'
import { getModel, getHost } from '../recon/dispatch'
import { sideOfKey } from '../core/select'
import type { TabKey, Side } from '../core/model'
import { stripTabIdSuffix } from '../persist/tab-id-heal'
import { drawerObserver } from '../sidebar/drawer-observer'
import { liveIdForFacadeKey } from '../sidebar/secondary'

// Re-export for backward compatibility — callers that import from
// tabs/assignment still get the same symbols.
export { isTabActiveInMainDrawer, getActiveSecondaryTabId, setActiveSecondaryTabId }

// Legacy in-memory map. Only used when the owned model is not active
// (tests, setup before bootstrap). The owned model replaces this as
// the source of truth.
const _tabAssignments: Map<string, 'primary' | 'secondary'> = new Map()

/**
 * Resolve a live id (or legacy title/key-shaped input) to a model TabKey.
 * Host resolver first (tabs/identity.ts — frozen keys, legacy inputs), then
 * a single builtin-prefix fallback for bare ids the host cannot resolve
 * (DOM-placed builtins whose observer record is temporarily missing; pinned
 * by assignment-facade R6/R7 suffix-drift). The old multi-candidate
 * `_ownedKeyCandidates` heuristic is retired — keyForLiveId never invents
 * keys, so only the builtin namespace needs the prefix.
 */
function _resolvedKey(liveId: string): TabKey | null {
  const host = getHost()
  if (host) {
    const key = host.findKey(liveId)
    if (key) return key
  }
  const stripped = stripTabIdSuffix(liveId)
  if (!stripped.includes(':')) return `builtin:${stripped}` as TabKey
  return null
}

function _readFromModel(): Map<string, 'primary' | 'secondary'> | null {
  const model = getModel()
  if (!model) return null
  const out = new Map<string, 'primary' | 'secondary'>()
  for (const key of model.primary) out.set(key, 'primary')
  for (const key of model.secondary) out.set(key, 'secondary')
  return out
}

/**
 * Read the tab-assignment map. When the owned model is active, returns
 * a fresh Map derived from the model. Otherwise returns the legacy
 * in-memory map. The returned Map is a snapshot — mutations do not
 * affect the owned model.
 *
 * KEYING (2026-07-31, three regressions): the model-derived map is keyed
 * by TabKey ('builtin:regex', 'ext:foo/Bar') — NEVER by liveId ('regex',
 * 'spindle:foo:tab:bar:0'). Looking the facade up by a liveId always
 * misses and forces the tab back to 'primary' in the observed world
 * (moves reverted), breaks the restore loop ("not found in DrawerObserver
 * or store"), and defeats placeTab's early-return. Convert liveId → TabKey
 * via the host's findKey / tabKeyFromDrawerTab; TabKey → liveId via
 * liveIdForFacadeKey (sidebar/secondary.tsx). See docs/pitfalls.md §1.
 */
export function getTabAssignments(): Map<string, 'primary' | 'secondary'> {
  const fromModel = _readFromModel()
  if (fromModel) return fromModel
  return _tabAssignments
}

export function hasTabAssignment(tabId: string): boolean {
  const fromModel = _readFromModel()
  if (fromModel) {
    // Try the live id directly, then resolve to a stable key: host adapter
    // first (classifies builtin/ext from the live inventory), then the
    // builtin-prefix fallback for tabs the host cannot resolve (e.g.
    // DOM-placed builtins).
    if (fromModel.has(tabId)) return true
    const key = _resolvedKey(tabId)
    if (key && fromModel.has(key)) return true
    return false
  }
  return _tabAssignments.has(tabId)
}

export function clearTabAssignments(): void {
  // No-op when the owned model is active — the model owns the state.
  // Legacy map is still cleared for callers that may inspect it
  // before bootstrap.
  _tabAssignments.clear()
}

/** True when at least one tab is assigned to the secondary drawer. */
export function hasSecondaryAssignedTabs(): boolean {
  const fromModel = _readFromModel()
  if (fromModel) {
    for (const side of fromModel.values()) {
      if (side === 'secondary') return true
    }
    return false
  }
  for (const side of _tabAssignments.values()) {
    if (side === 'secondary') return true
  }
  return false
}

/**
 * Set a tab assignment. No-op when the owned model is active — the
 * model handles placement via dispatch. Retained for test setup and
 * callers that haven't been cut over to the dispatcher yet.
 */
export function setTabAssignment(tabId: string, panelId: 'primary' | 'secondary'): void {
  if (getModel()) return
  _tabAssignments.set(tabId, panelId)
}

/**
 * Delete a tab assignment. No-op when the owned model is active.
 */
export function deleteTabAssignment(tabId: string): void {
  if (getModel()) return
  _tabAssignments.delete(tabId)
}

export function getTabSidebar(tabId: string): 'primary' | 'secondary' {
  const fromModel = _readFromModel()
  if (fromModel) {
    if (fromModel.has(tabId)) return fromModel.get(tabId)!
    // LiveId → TabKey via the host adapter (classifies builtin/ext from
    // the live inventory), then the builtin-prefix fallback. Without the
    // host resolution, secondary tabs keyed 'builtin:regex' / 'ext:foo/Bar'
    // always came back 'primary' — both context menus then offered
    // "Move to second drawer" for tabs already in the second drawer.
    const key = _resolvedKey(tabId)
    if (key && fromModel.has(key)) return fromModel.get(key)!
  }
  return _tabAssignments.get(tabId) || 'primary'
}

/**
 * Model-derived assignment map keyed by LIVE ID — the namespace the
 * catalog, the DnD draft (buildDraftAndBase), and the Configure modal use.
 *
 * The base facade (getTabAssignments) is TabKey-keyed ('builtin:regex',
 * 'ext:foo/Bar'); the draft layer looks ids up with catalog ids (bare
 * builtin ids, spindle-prefixed extension live ids). Against the TabKey
 * facade every lookup misses and defaults to 'primary' — draft.secondaryIds
 * came back empty, so secondary DnD reorders aborted ("tab not found in
 * draft for reorder" → snap-back) and the Configure modal showed an empty
 * secondary column (2026-07-31). Resolve each model key to its live id
 * (liveIdForFacadeKey: builtin → bare id, ext → extensionId + title lookup)
 * so the draft sees the same ids as the live strips.
 */
export function getLiveIdAssignments(
  tabs: { tabId: string; extensionId: string; title: string }[] = drawerObserver.getAllTabs(),
): Map<string, 'primary' | 'secondary'> {
  const fromModel = _readFromModel()
  if (!fromModel) return _tabAssignments
  const out = new Map<string, 'primary' | 'secondary'>()
  for (const [key, side] of fromModel) {
    const liveId = liveIdForFacadeKey(key, tabs)
    out.set(liveId ?? key, side)
  }
  return out
}

/**
 * Model-derived assignment entries with BOTH namespaces: the model TabKey
 * and its current live id. Writers of `detachedTabs` use this so the field
 * semantics stay unified — `tabId` = live id, `tabTitle` = TabKey
 * (REFACTOR-PLAN v2 §4.4).
 */
export function getLiveIdAssignmentEntries(
  tabs: { tabId: string; extensionId: string; title: string }[] = drawerObserver.getAllTabs(),
): { key: TabKey; liveId: string; side: Side }[] {
  const fromModel = _readFromModel()
  if (!fromModel) return []
  const out: { key: TabKey; liveId: string; side: Side }[] = []
  for (const [key, side] of fromModel) {
    const liveId = liveIdForFacadeKey(key, tabs)
    out.push({ key, liveId: liveId ?? key, side })
  }
  return out
}

/**
 * Move a tab between sidebars. The stable public API for "move this tab
 * to that sidebar". Delegates to SecondaryDrawer for the secondary path
 * and to unassignFromSecondary for the primary path.
 *
 * Host bridge comes from setup(ctx) via setHostBridgeContext (not
 * window.spindle — the loader never assigns that global). Built-in moves
 * need ui_panels so getBuiltInTabRoot / requestTabLocation succeed.
 */
export interface EnsureActiveHooks {
  isTabActiveInMainDrawer?: (tabId: string) => boolean
  findMainTabButton?: (tabId: string) => Element | null
  isMobileViewport?: () => boolean
  getBuiltInTabRoot?: (tabId: string) => HTMLElement | undefined
  dlog?: (...args: unknown[]) => void
}

/**
 * Bug fix: built-in tabs (Lorebook, Databank, etc.) don't have their root
 * in the DOM unless Lumiverse decides to render them as the active tab.
 * Per the BUILT-IN TAB LIMITATION comment in src/sidebar/secondary-drawer.ts:
 * "Lumiverse only renders the ACTIVE tab's root in the main panel content."
 * Most built-ins populate dropdowns/tables via a React useEffect that fires
 * on component mount. So moving a never-activated built-in tab to the
 * secondary drawer reparents *nothing* — the root never existed.
 *
 * The supported mechanism to mount a built-in root is to make the tab
 * active in the main drawer, which Lumiverse does on tab-button click.
 * This helper does that activation as a setup step before requestTabLocation.
 *
 * No-op when the tab is already active in main (avoids a re-click that
 * would briefly empty an already-populated dropdown via React re-mount).
 * No-op on mobile (the main sidebar is hidden; clicks land on the wrong
 * element via the mobile flyout pattern). Mobile edge case is unhandled
 * in this fix; follow up if a mobile user reports it.
 */
export async function ensureBuiltInTabActiveInMain(
  tabId: string,
  h: EnsureActiveHooks = {},
): Promise<void> {
  const _isActive = h.isTabActiveInMainDrawer ?? isTabActiveInMainDrawer
  const _findBtn = h.findMainTabButton ?? findMainTabButton
  const _isMobile = h.isMobileViewport ?? isMobileViewport
  const _getRoot = h.getBuiltInTabRoot ?? (() => undefined)
  const _dlog = h.dlog ?? (() => {})

  _dlog(`[canvas-debug] ENSURE_ACTIVE_BEGIN tab=${tabId} isActive=${_isActive(tabId)} mobile=${_isMobile()}`)

  const _isActiveResult = _isActive(tabId)
  if (_isActiveResult) return

  const _isMobileResult = _isMobile()
  if (_isMobileResult) {
    _dlog(`[tabmove] ensure-active: mobile, skipping pre-activation for "${tabId}"`)
    return
  }

  const btn = _findBtn(tabId)
  if (!btn) {
    _dlog(
      `[tabmove] ensure-active: main button-not-found for "${tabId}", ` +
      `relying on host lazy-mount`,
    )
    return
  }
  // btn is Element (per buttons.ts:47) — narrow at click site.
  _dlog(`[canvas-debug] ENSURE_ACTIVE_CLICK tab=${tabId}`)
  ;(btn as HTMLElement).click()

  // Wait for one rAF (~16ms) so Lumiverse commits the activation and
  // Lorebook's mount useEffect fires. 1-16ms is the documented latency
  // of Lumiverse's pendingActiveTabReset useEffect.
  await new Promise<void>(r => requestAnimationFrame(() => r()))

  const root = _getRoot(tabId)
  _dlog(`[canvas-debug] ENSURE_ACTIVE_DONE tab=${tabId} rootAfter=${root?.tagName ?? 'null'}`)
  if (!root) {
    _dlog(
      `[tabmove] ensure-active: post-click root still null for "${tabId}"; ` +
      `move will fall through to host lazy-mount`,
    )
  }
}

/**
 * Build the secondary tab button for a moved built-in tab. Title, icon,
 * and short name are resolved from the bridge + main button.
 */
function addBuiltInSecondaryButton(
  bridge: NonNullable<ReturnType<typeof getHostBridge>>,
  tabId: string,
  builtInRoot: HTMLElement,
): void {
  const mainBtn = findMainTabButton(tabId)
  const title = bridge.ui.getBuiltInTabTitle?.(tabId)
    || mainBtn?.getAttribute('title')
    || tabId
  const iconSvg = mainBtn?.querySelector('svg')?.outerHTML
    ?? builtInRoot.querySelector('svg')?.outerHTML
  const shortName = readMainButtonShortName(mainBtn)
  addSecondaryTabButton({ id: tabId, title, root: builtInRoot, iconSvg, shortName })
}

/**
 * After primary→secondary: force main-mirror pin rebuild.
 * hideMainTabButton only sets host `display:none`; the mirror observer does
 * not watch `style`, so without this the taskbar strip keeps the moved tab
 * and (if the secondary shell failed to open) the move looks like a no-op.
 */
async function reconcileMainMirrorAfterSecondaryAssign(): Promise<void> {
  try {
    const pin = await import('../sidebar/main-tab-pin')
    pin.reconcileMainTabListPin()
  } catch { /* pin optional during teardown */ }
  try {
    const m = await import('../sidebar/main-mirror-drawer')
    if (m.isMainMirrorActive()) m.ensureHostContentParkedPublic()
  } catch { /* ignore */ }
}

export async function assignTab(tabId: string, sidebar: 'primary' | 'secondary'): Promise<void> {
  if (sidebar === 'secondary') {
    // Shell must be live before host requestTabLocation (container register)
    // and before addSecondaryTabButton / openSecondarySidebar. Setting can be
    // true while the wrapper was never mounted or was detached from the DOM.
    if (!ensureSecondaryShellMounted({ initialOpen: false })) {
      dwarn(
        `[tabmove] assignTab: secondary shell unavailable (secondSidebarEnabled=${!!getSettings().secondSidebarEnabled}); abort move of "${tabId}"`,
      )
      return
    }

    // Capture source list + wasActive BEFORE place (same policy as quiet
    // Configure/live-DnD via buildCrossDrawerHandoff). Part C stays on for
    // rClick so the moved tab becomes active in the destination.
    const preMoveSourceList = await captureSourceList('primary')
    const handoff = buildCrossDrawerHandoff({
      tabId,
      source: 'primary',
      destination: 'secondary',
      sourceList: preMoveSourceList,
      activateDestination: true,
    })
    const preMoveActiveTab = !!handoff.preMoveSourceActiveTab

    // Inactive: shared preserve fights host pendingActiveTabReset (same as
    // quiet DnD/Configure). Active: handoff owns neighbor — preserve no-ops.
    const preservePrimary = armPreservePrimaryActiveOnToSecondary([tabId])

    const bridge = getHostBridge()
    // Built-in tabs: host tabLocations only (never raw DOM reparent).
    // Shared with assignToSecondary via moveBuiltInTabToSecondaryContainer.
    // getBuiltInTabRoot alone is enough to enter this path — requestTabLocation
    // may silent-no-op for non-CORE tabs; the helper falls back to store.moveTabTo.
    if (bridge?.ui.getBuiltInTabRoot) {
      const { moveBuiltInTabToSecondaryContainer } = await import('./builtin-move')
      const builtInRoot = await moveBuiltInTabToSecondaryContainer({ tabId })

      if (builtInRoot) {
        setTabAssignment(tabId, 'secondary')
        hideMainTabButton(tabId)
        addBuiltInSecondaryButton(bridge, tabId, builtInRoot)
        updateDrawerTabVisibility()
        // rClick-only: open secondary so the moved tab is visible (DnD/Configure
        // leave drawer open state alone).
        if (!isSecondarySidebarOpen() && !isMobileViewport()) openSecondarySidebar()
        await runHandoff(handoff)
        await reconcileMainMirrorAfterSecondaryAssign()
        // Pin reconcile + late host pendingActiveTabReset can reseat main to
        // the first remaining primary after handoff. Reassert neighbor once
        // more after strip rebuild (same as quiet final-reassert).
        if (preMoveActiveTab) {
          await reassertPrimaryNeighborAfterHandoff(tabId, preMoveSourceList)
        } else {
          try {
            preservePrimary?.reassert()
          } catch { /* ignore */ }
        }
        // Stick a bit longer so late host reset cannot reseat first-tab
        // after we return (matches quiet commit safety window).
        if (preservePrimary) {
          void new Promise<void>((r) => setTimeout(() => r(), 120)).then(() => {
            try { preservePrimary.reassert() } catch { /* ignore */ }
            try { preservePrimary.disconnect() } catch { /* ignore */ }
          })
        }
        return
      }
      // Built-in place failed (bridge+store+DOM). Do not fall through to
      // extension path or handoff — that left empty secondary "active" for
      // connections/imagegen/wallpaper when host allowlist denied.
      try {
        preservePrimary?.disconnect()
      } catch { /* ignore */ }
      let knownBuiltIn = false
      try {
        knownBuiltIn =
          !!bridge.ui.getBuiltInTabRoot?.(tabId) ||
          !!bridge.ui.getBuiltInTabTitle?.(tabId)
      } catch {
        knownBuiltIn = false
      }
      if (knownBuiltIn) {
        dwarn(
          `[tabmove] assignTab: built-in "${tabId}" place failed; aborting ` +
          `(no empty secondary handoff).`,
        )
        return
      }
      // Bridge present but this tabId is not a host built-in — extension path.
    }

    if (!bridge) {
      dwarn(`[tabmove] no host bridge; tabId="${tabId}" treated as extension. Built-in move requires the spindle loader.`)
    }
    const { assignToSecondary } = await import('../sidebar/secondary-drawer')
    await assignToSecondary(tabId)
    await runHandoff(handoff)
    await reconcileMainMirrorAfterSecondaryAssign()
    if (preMoveActiveTab) {
      await reassertPrimaryNeighborAfterHandoff(tabId, preMoveSourceList)
    } else {
      try {
        preservePrimary?.reassert()
      } catch { /* ignore */ }
    }
    if (preservePrimary) {
      void new Promise<void>((r) => setTimeout(() => r(), 120)).then(() => {
        try { preservePrimary.reassert() } catch { /* ignore */ }
        try { preservePrimary.disconnect() } catch { /* ignore */ }
      })
    }
  } else {
    // Primary restore. unassignFromSecondary owns host tabLocations reset +
    // DOM restore for dom-placed non-CORE roots. Avoid a double
    // requestHostTabToMain here (would race with unassign's path).
    const { unassignFromSecondary } = await import('../sidebar/secondary-drawer')
    const preMoveSourceList = await captureSourceList('secondary')
    const handoff = buildCrossDrawerHandoff({
      tabId,
      source: 'secondary',
      destination: 'primary',
      sourceList: preMoveSourceList,
      activateDestination: true,
    })
    await unassignFromSecondary(tabId)
    await runHandoff(handoff)
  }
}

