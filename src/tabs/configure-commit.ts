// Batch commit for the Configure Tabs UI.
//
// Applies a ConfigureDraft to the live DOM and host settings in one
// atomic-like pass. Avoids the per-tab side effects of assignTab (no
// runHandoff, no auto-open, no per-tab persist), coalescing all writes
// into a single patchHostDrawerSettings + persistLayout call.
//
// Tab-assignment persistence is always-on (built-in), so persistLayout
// is always called after commit (no longer gated on a setting).

import {
  type ConfigureDraft,
  type BaseSnapshot,
  encodeHostTabOrder,
} from './configure-model'
import {
  getTabAssignments,
  setTabAssignment,
  deleteTabAssignment,
  hasSecondaryAssignedTabs,
  getActiveSecondaryTabId,
  setActiveSecondaryTabId,
  isTabActiveInMainDrawer,
} from './assignment'
import { runHandoff, captureSourceList } from './activation-handoff'
import {
  hideMainTabButton,
  showMainTabButton,
  findMainTabButton,
  readMainButtonShortName,
  addSecondaryTabButton,
  removeSecondaryTabButton,
  reorderSecondaryTabButtons,
  reorderMainMirrorTabButtons,
  reorderHostMainTabButtons,
  applyHiddenTabIdsToSecondary,
  applyHiddenTabIdsToMirror,
  updateDrawerTabVisibility,
  clearSecondaryTabButtonActive,
  showSecondaryTab,
  cssEscape,
} from './buttons'
import {
  patchHostDrawerSettings,
} from '../dom/host-settings'
import {
  setSuppressAutoActivation,
} from '../sidebar/secondary-drawer'
import { persistLayout } from '../layout/persist'
import { dlog, dwarn } from '../debug/log'
import { findStoreData, getDrawerTabs } from '../store'
import { getHostBridge } from '../dom/host-bridge'
import {
  getSecondaryWrapper,
  closeSecondarySidebar,
  isSecondarySidebarOpen,
} from '../sidebar/secondary'
import { getMainSidebar } from '../dom/lumiverse'
import { adoptMainMirrorHostActivation } from '../sidebar/main-tab-pin'
import { isMobileViewport } from '../sidebar/mobile-exclusion'

export type CommitResult = { ok: true } | { ok: false; error: string }

/**
 * Host sets pendingActiveTabReset on any requestTabLocation move and then
 * ViewportDrawer resets drawerTab to the first non-moved tab. rClick assignTab
 * re-clicks the pre-move active tab when the moved tab was *not* active.
 * Quiet live-DnD / Configure must do the same or main-mirror panel content
 * jumps to the top-most primary tab.
 *
 * Stick pattern (matches assignTab inactive restore + activateInPrimary):
 * keep re-clicking while wrong for the full safety window — do NOT disconnect
 * on the first correction. Quiet moves can flip active twice (ensureBuiltIn
 * pre-activate of a never-mounted tab, then host pendingActiveTabReset to the
 * first remaining primary). Early disconnect left the second flip stuck.
 *
 * Returns disconnect + reassert helpers; no-op when the active tab itself is
 * among the moved set (handoff owns neighbor selection then).
 */
function armPreservePrimaryActiveOnQuietToSecondary(
  toSecondary: string[],
): { disconnect: () => void; reassert: () => void } | null {
  if (toSecondary.length === 0 || isMobileViewport()) return null

  const sidebar = getMainSidebar()
  if (!sidebar) return null

  const preActiveBtn = sidebar.querySelector(
    'button.tabBtnActive, button[class*="tabBtnActive"]',
  ) as HTMLElement | null
  const preActiveId =
    preActiveBtn?.getAttribute('data-tab-id')
    || preActiveBtn?.getAttribute('title')
    || null
  if (!preActiveBtn || !preActiveId) return null

  // Active tab is being moved away — handoff will pick a neighbor; do not
  // re-activate the departing tab.
  if (toSecondary.includes(preActiveId)) return null
  // Also skip if any moved tab claims active via store/DOM (id alias).
  if (toSecondary.some((id) => isTabActiveInMainDrawer(id))) return null

  const restorePrimaryActive = (): void => {
    const btn =
      (findMainTabButton(preActiveId) as HTMLElement | null) || preActiveBtn
    if (!btn) return
    const active = sidebar.querySelector(
      'button.tabBtnActive, button[class*="tabBtnActive"]',
    ) as HTMLElement | null
    const activeId =
      active?.getAttribute('data-tab-id')
      || active?.getAttribute('title')
      || null
    if (activeId !== preActiveId) {
      try {
        btn.click()
      } catch {
        /* host may throw during teardown */
      }
    }
    const title =
      btn.getAttribute('title')
      || btn.getAttribute('aria-label')
      || undefined
    try {
      adoptMainMirrorHostActivation(btn, title)
    } catch {
      /* mirror may be off / mid-teardown */
    }
  }

  let observer: MutationObserver | null = new MutationObserver(() => {
    // Keep observing — host may override again after ensureBuiltIn or after
    // our own re-click races pendingActiveTabReset.
    restorePrimaryActive()
  })
  observer.observe(sidebar, {
    attributes: true,
    attributeFilter: ['class'],
    subtree: true,
  })
  // Longer than assignTab's 200ms stick: quiet batch does multi-tab moves +
  // handoff + pin reconcile; host reset can land late in that window.
  const safetyTimer = setTimeout(() => {
    if (observer) {
      observer.disconnect()
      observer = null
    }
    // Final restore after host useEffect window (same idea as activateInPrimary
    // 100ms re-click, but at end of safety).
    restorePrimaryActive()
  }, 350)

  const disconnect = () => {
    clearTimeout(safetyTimer)
    if (observer) {
      observer.disconnect()
      observer = null
    }
  }

  const reassert = () => {
    restorePrimaryActive()
  }

  return { disconnect, reassert }
}

// ── Helpers ──

/**
 * Compute assignment deltas between draft and current state.
 * Returns sets of tab ids that need to move.
 */
function computeDeltas(
  draft: ConfigureDraft,
): { toSecondary: string[]; toPrimary: string[] } {
  const currentAssignments = getTabAssignments()

  const toSecondary: string[] = []
  const toPrimary: string[] = []

  for (const id of draft.primaryIds) {
    const currentSide = currentAssignments.get(id) ?? 'primary'
    if (currentSide === 'secondary') {
      toPrimary.push(id)
    }
  }
  for (const id of draft.secondaryIds) {
    const currentSide = currentAssignments.get(id) ?? 'primary'
    if (currentSide !== 'secondary') {
      toSecondary.push(id)
    }
  }

  return { toSecondary, toPrimary }
}

// ── Public API ──

/**
 * True when a configure-batch commit is currently running.
 * Can be used as a guard elsewhere (e.g. skip observers).
 */
let _batchActive = false
export function isConfigureBatchActive(): boolean { return _batchActive }

/**
 * Commit a ConfigureDraft to the live host state and DOM.
 *
 * Algorithm:
 *   1. Compute deltas from current assignments.
 *   2. Suppress auto-activation so tab moves don't open the sidebar.
 *   3. Patch host drawer settings once (tabOrder, hiddenTabIds, side).
 *   4. Move tabs between drawers (quiet path — no handoff, no auto-open, no per-tab persist).
 *   5. Reorder secondary tab buttons to match draft order.
 *   6. Apply hidden state to secondary + mirror buttons.
 *   7. Reconcile drawer tab visibility (await each, guarded).
 *   8. Persist layout once (tab-assignment persistence is always-on, so
 *      persistLayout always runs).
 *   9. Bust store cache so downstream readers see new host state.
 */
export async function commitConfigureDraft(
  draft: ConfigureDraft,
  _base: BaseSnapshot,
): Promise<CommitResult> {
  if (_batchActive) return { ok: false, error: 'Commit already in progress' }
  _batchActive = true

  try {
    // 1. Compute deltas.
    const { toSecondary, toPrimary } = computeDeltas(draft)

    // 2. Suppress auto-activation during moves.
    setSuppressAutoActivation(true)

    // 3. Patch host drawer settings (order, hidden, side).
    const hostWriteOk = patchHostDrawerSettings({
      tabOrder: encodeHostTabOrder(draft),
      hiddenTabIds: [...draft.hiddenIds],
      side: draft.drawerSide,
    })
    if (!hostWriteOk) {
      dwarn(
        '[configure-commit] patchHostDrawerSettings returned false; ' +
        'host order/hide/side may not persist. Continuing with DOM moves.',
      )
    }

    // 4. Capture source lists + active flags *before* quiet moves so handoff
    //    can pick the rClick neighbor (above, else below) — not first remaining.
    //    Live drawer DnD uses this quiet path; without handoff, source kept
    //    selecting the first tab in the strip after an active tab was moved.
    type QuietHandoff = {
      tabId: string
      source: 'primary' | 'secondary'
      destination: 'primary' | 'secondary'
      sourceList: string[]
      preMoveSourceActiveTab: boolean
    }
    const pendingHandoffs: QuietHandoff[] = []
    if (toSecondary.length > 0) {
      const primaryList = await captureSourceList('primary')
      for (const tabId of toSecondary) {
        pendingHandoffs.push({
          tabId,
          source: 'primary',
          destination: 'secondary',
          sourceList: primaryList,
          preMoveSourceActiveTab: isTabActiveInMainDrawer(tabId),
        })
      }
    }
    if (toPrimary.length > 0) {
      const secondaryList = await captureSourceList('secondary')
      for (const tabId of toPrimary) {
        pendingHandoffs.push({
          tabId,
          source: 'secondary',
          destination: 'primary',
          sourceList: secondaryList,
          preMoveSourceActiveTab: getActiveSecondaryTabId() === tabId,
        })
      }
    }

    // 4b. Preserve primary/main-mirror active when moving a *non-active* tab
    //     to secondary (host pendingActiveTabReset → first non-moved tab).
    const preservePrimary = armPreservePrimaryActiveOnQuietToSecondary(toSecondary)

    // 4c. Move tabs (quiet — no per-tab handoff/persist; handoff runs in 4d).
    const movePromises: Promise<void>[] = []

    for (const tabId of toSecondary) {
      movePromises.push(moveTabToSecondaryQuiet(tabId).catch((err) => {
        dwarn(`[configure-commit] moveTabToSecondaryQuiet failed for "${tabId}":`, err)
      }))
    }
    for (const tabId of toPrimary) {
      movePromises.push(moveTabToPrimaryQuiet(tabId).catch((err) => {
        dwarn(`[configure-commit] moveTabToPrimaryQuiet failed for "${tabId}":`, err)
      }))
    }
    await Promise.all(movePromises)

    // Give host React a frame to apply pendingActiveTabReset. Keep the stick
    // observer armed through handoff + reorder + pin reconcile — disconnecting
    // after one rAF raced a second host reset (ensureBuiltIn then first-tab).
    if (preservePrimary) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
      try {
        preservePrimary.reassert()
      } catch (err) {
        dwarn('[configure-commit] post-move primary active reassert failed:', err)
      }
    }

    // 4d. Source neighbor + destination activation (same rules as assignTab /
    //     rClick Move). Suppress-auto-open stays on; handoff does not open.
    for (const h of pendingHandoffs) {
      try {
        await runHandoff(h)
      } catch (err) {
        dwarn(`[configure-commit] runHandoff failed for "${h.tabId}":`, err)
      }
    }

    // Re-assert original primary active after handoff/reorder side effects.
    // Main-mirror panel follows host/mirror key — without this, content jumps
    // to the top-most primary tab after live DnD of an inactive tab.
    if (preservePrimary) {
      try {
        preservePrimary.reassert()
      } catch (err) {
        dwarn('[configure-commit] preserve primary active reassert failed:', err)
      }
    }

    // 4e. Empty secondary shell: handoff leaves active null when no neighbor.
    //     Close the open panel so live DnD last-tab→primary is not blank.
    if (toPrimary.length > 0) {
      try {
        reconcileSecondaryAfterQuietPrimaryMoves(draft.secondaryIds)
      } catch (err) {
        dwarn('[configure-commit] reconcileSecondaryAfterQuietPrimaryMoves failed:', err)
      }
    }

    // 5. Reorder buttons to match draft (Canvas lists + host main).
    //    Secondary is Canvas-owned. Primary also needs an explicit DOM apply:
    //    reconcileMainTabListPin mirrors host button order, and host React
    //    may not have flushed the new tabOrder yet — without this, live
    //    primary DnD animates mid-drag then snaps back on release.
    reorderSecondaryTabButtons(draft.secondaryIds)
    reorderHostMainTabButtons(draft.primaryIds)
    reorderMainMirrorTabButtons(draft.primaryIds)

    // 6. Apply hidden state.
    applyHiddenTabIdsToSecondary(draft.hiddenIds)
    applyHiddenTabIdsToMirror(draft.hiddenIds)

    // 7. Reconcile drawer tab visibility (awaited, guarded).
    updateDrawerTabVisibility()
    try {
      const mm = await import('../sidebar/main-mirror-drawer')
      mm.updateMainMirrorDrawerTabVisibility?.()
      // Keep host content parked under taskbar-mode after primary→secondary
      // (same as assignTab). Prevents main panel flash while mirror shows content.
      if (toSecondary.length > 0 && mm.isMainMirrorActive?.()) {
        mm.ensureHostContentParkedPublic?.()
      }
    } catch (err) {
      dwarn('[configure-commit] updateMainMirrorDrawerTabVisibility failed:', err)
    }
    try {
      const tp = await import('../sidebar/tab-position')
      tp.reconcileTabListPin()
    } catch (err) {
      dwarn('[configure-commit] reconcileTabListPin failed:', err)
    }
    try {
      const mp = await import('../sidebar/main-tab-pin')
      mp.reconcileMainTabListPin()
    } catch (err) {
      dwarn('[configure-commit] reconcileMainTabListPin failed:', err)
    }

    // Reconcile can re-sync mirror chrome from host; reassert once more if we
    // were preserving a non-moved primary active tab, then release the stick
    // observer. A delayed reassert covers host useEffects that fire after
    // this async function returns (pendingActiveTabReset lag).
    if (preservePrimary) {
      try {
        preservePrimary.reassert()
      } catch (err) {
        dwarn('[configure-commit] post-reconcile primary active reassert failed:', err)
      }
      try {
        const mm = await import('../sidebar/main-mirror-drawer')
        if (mm.isMainMirrorActive?.()) mm.ensureHostContentParkedPublic?.()
      } catch { /* ignore */ }
      // Stick ~100ms more (activateInPrimary verification window), then drop.
      const stick = preservePrimary
      void new Promise<void>((r) => setTimeout(() => r(), 120)).then(() => {
        try {
          stick.reassert()
        } catch {
          /* ignore */
        }
        try {
          stick.disconnect()
        } catch {
          /* ignore */
        }
      })
    }

    // 8. One persist. Tab-assignment persistence is always-on (built-in),
    //    so persistLayout always runs after commit.
    persistLayout()

    // 9. Bust store cache.
    findStoreData(true)

    dlog('[configure-commit] commit successful', {
      toSecondary: toSecondary.length,
      toPrimary: toPrimary.length,
      hidden: draft.hiddenIds.size,
    })

    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    dwarn('[configure-commit] commit failed:', msg)
    return { ok: false, error: msg }
  } finally {
    setSuppressAutoActivation(false)
    _batchActive = false
  }
}

// ── Quiet move helpers ──

/**
 * Find a DrawerTab from the store, matching by exact id, composite-id
 * segment, or title. Mirrors findStoreTab in secondary-drawer.ts.
 */
function findDrawerTab(tabId: string): import('../store').DrawerTab | undefined {
  findStoreData(true)
  const tabs = getDrawerTabs()
  return tabs.find(t => t.id === tabId)
    || tabs.find(t => t.id.includes(`:tab:${tabId}:`) || t.id.endsWith(`:${tabId}`))
    || tabs.find(t => t.title === tabId)
}

/**
 * Resolve icon/title/shortName for a newly created secondary tab button.
 *
 * Built-in host tabs almost never carry iconSvg on the store DrawerTab —
 * the real SVG lives on the main (or main-mirror) strip button. Live DnD
 * and Configure quiet commits used only store fields, so cross-drawer
 * drops fell through to PUZZLE_ICON_SVG. Match assignTab / secondary-drawer:
 * prefer main-button SVG, then store, then root.
 */
function resolveSecondaryButtonChrome(
  tabId: string,
  opts?: { root?: HTMLElement | null; storeTab?: ReturnType<typeof findDrawerTab> },
): {
  title: string
  iconSvg?: string
  iconUrl?: string
  shortName?: string
} {
  const storeTab = opts?.storeTab ?? findDrawerTab(tabId)
  const root = opts?.root
  const mainBtn = findMainTabButton(tabId) as HTMLElement | null
  const bridge = getHostBridge()
  const bridgeTitle = bridge?.ui?.getBuiltInTabTitle?.(tabId)
  const title =
    bridgeTitle
    || mainBtn?.getAttribute('title')
    || storeTab?.title
    || tabId
  const iconSvg =
    mainBtn?.querySelector('svg')?.outerHTML
    || storeTab?.iconSvg
    || root?.querySelector?.('svg')?.outerHTML
    || undefined
  const iconUrl = storeTab?.iconUrl
  const shortName =
    readMainButtonShortName(mainBtn)
    || (bridgeTitle ? undefined : storeTab?.shortName)
  return { title, iconSvg, iconUrl, shortName }
}

/**
 * Move a tab to the secondary drawer without handoff, auto-open, or per-tab persist.
 */
async function moveTabToSecondaryQuiet(tabId: string): Promise<void> {
  const bridge = getHostBridge()
  const ui = bridge?.ui
  const isBuiltIn = !!ui?.getBuiltInTabRoot?.(tabId)

  if (isBuiltIn) {
    // Built-in path: use moveBuiltInTabToSecondaryContainer.
    const { moveBuiltInTabToSecondaryContainer } = await import('./builtin-move')
    const root = await moveBuiltInTabToSecondaryContainer({ tabId, deferActivation: true })
    setTabAssignment(tabId, 'secondary')
    // Capture chrome before hide so main-button SVG is still in a normal
    // layout tree (display:none still works, but order matches assignTab).
    const storeTab = findDrawerTab(tabId)
    const chrome = resolveSecondaryButtonChrome(tabId, { root, storeTab })
    hideMainTabButton(tabId)
    if (root) {
      addSecondaryTabButton({
        id: tabId,
        title: chrome.title,
        root,
        iconSvg: chrome.iconSvg,
        iconUrl: chrome.iconUrl,
        shortName: chrome.shortName,
      })
    } else {
      dwarn(`[configure-commit] built-in "${tabId}" move returned no root; assignment recorded.`)
    }
  } else {
    // Extension path: quiet move without persist, open, or handoff.
    const storeTab = findDrawerTab(tabId)
    if (!storeTab?.root) {
      dwarn(`[configure-commit] extension "${tabId}" not found in store; skipping move to secondary`)
      return
    }
    setTabAssignment(tabId, 'secondary')
    const chrome = resolveSecondaryButtonChrome(tabId, { root: storeTab.root, storeTab })
    hideMainTabButton(tabId)

    // Reparent the extension root into secondary content.
    const secondaryContent = getSecondaryWrapper()?.querySelector('.sidebar-ux-panel-content')
    if (secondaryContent && storeTab.root.parentElement !== secondaryContent) {
      secondaryContent.appendChild(storeTab.root)
    }
    storeTab.root.setAttribute('data-canvas-moved', tabId)

    addSecondaryTabButton({
      id: tabId,
      title: chrome.title,
      root: storeTab.root,
      iconSvg: chrome.iconSvg,
      iconUrl: chrome.iconUrl,
      shortName: chrome.shortName,
    })
    updateDrawerTabVisibility()
  }
}

/**
 * Clear Canvas placement attrs on a root (and any residual secondary match).
 * Mirrors unassignFromSecondary attr cleanup without reparent/persist.
 */
function clearCanvasMovedAttrs(tabId: string, root?: HTMLElement | null): void {
  const clear = (el: HTMLElement | null | undefined) => {
    if (!el) return
    el.removeAttribute('data-canvas-moved')
    el.removeAttribute('data-canvas-active')
  }
  clear(root)
  const secondaryContent = getSecondaryWrapper()?.querySelector('.sidebar-ux-panel-content')
  if (secondaryContent) {
    const residual = secondaryContent.querySelector(
      `[data-canvas-moved="${cssEscape(tabId)}"]`,
    ) as HTMLElement | null
    clear(residual)
  }
  // Residual may already be outside secondary after host requestTabLocation.
  if (typeof document !== 'undefined' && !root) {
    const residual = document.querySelector(
      `[data-canvas-moved="${cssEscape(tabId)}"]`,
    ) as HTMLElement | null
    clear(residual)
  }
}

/**
 * After quiet toPrimary + runHandoff: close empty secondary, or if active is
 * still missing (handoff found no neighbor / was inactive), activate a
 * remaining tab so the open drawer is not a blank panel.
 *
 * Neighbor selection for *active* moves is owned by runHandoff
 * (pickSourceReplacement: above, else below). Do not prefer ids[0] when
 * handoff already set a neighbor — that was the "first tab" bug.
 */
function reconcileSecondaryAfterQuietPrimaryMoves(secondaryIds: string[]): void {
  const remaining = secondaryIds.filter((id) => {
    const side = getTabAssignments().get(id)
    // After quiet moves, secondary assignments are deleted for moved tabs.
    // Prefer draft secondaryIds ∩ live secondary map; fall back to map scan.
    return side === 'secondary'
  })
  const liveSecondary: string[] = []
  for (const [id, side] of getTabAssignments()) {
    if (side === 'secondary') liveSecondary.push(id)
  }
  const ids = remaining.length > 0 ? remaining : liveSecondary

  if (!hasSecondaryAssignedTabs() || ids.length === 0) {
    setActiveSecondaryTabId(null)
    clearSecondaryTabButtonActive()
    if (isSecondarySidebarOpen()) {
      // Persist closed (default silent=false) so reload does not reopen empty.
      closeSecondarySidebar()
    }
    updateDrawerTabVisibility()
    return
  }

  const active = getActiveSecondaryTabId()
  const activeStillHere =
    !!active &&
    (ids.includes(active) || getTabAssignments().get(active) === 'secondary')
  if (!activeStillHere) {
    // Fallback only when handoff did not set an active secondary (inactive
    // move, or no neighbor). Prefer first remaining so the open panel is not blank.
    showSecondaryTab(ids[0]!)
  }
}

/**
 * Move a tab to the primary drawer without handoff, auto-close, or per-tab persist.
 * Still clears Canvas attrs + secondary active flag so panel content does not
 * linger; post-batch reconcile closes empty secondary or activates a neighbor.
 */
async function moveTabToPrimaryQuiet(tabId: string): Promise<void> {
  const bridge = getHostBridge()
  const ui = bridge?.ui
  const isBuiltIn = !!ui?.getBuiltInTabRoot?.(tabId)
  const activeId = getActiveSecondaryTabId()
  const wasActive = activeId === tabId

  if (isBuiltIn) {
    // Built-in: requestTabLocation back to main-drawer.
    if (ui?.requestTabLocation) {
      try {
        ui.requestTabLocation(tabId, { kind: 'main-drawer' })
      } catch (err) {
        dwarn(`[configure-commit] requestTabLocation(main-drawer) failed for "${tabId}":`, err)
      }
    }
    const bridgeRoot = ui?.getBuiltInTabRoot?.(tabId) as HTMLElement | undefined
    clearCanvasMovedAttrs(tabId, bridgeRoot)
    // Clean up assignment + buttons without full unassignFromSecondary (avoids persist).
    deleteTabAssignment(tabId)
    showMainTabButton(tabId)
    removeSecondaryTabButton(tabId)
  } else {
    // Extension path: quiet unassign without persist, close, or handoff.
    deleteTabAssignment(tabId)
    showMainTabButton(tabId)
    removeSecondaryTabButton(tabId)

    // Reparent the extension root back to main panel content.
    const storeTab = findDrawerTab(tabId)
    if (storeTab?.root) {
      try {
        const { getMainPanelContent } = await import('../dom/lumiverse')
        const mainContent = getMainPanelContent()
        if (mainContent && storeTab.root.parentElement !== mainContent) {
          mainContent.appendChild(storeTab.root)
        }
      } catch (err) {
        dwarn(`[configure-commit] reparent "${tabId}" to main panel failed:`, err)
      }
      clearCanvasMovedAttrs(tabId, storeTab.root)
    } else {
      clearCanvasMovedAttrs(tabId)
    }
  }

  if (wasActive) {
    setActiveSecondaryTabId(null)
    clearSecondaryTabButtonActive()
  }
  updateDrawerTabVisibility()
}
