// Batch commit for the Configure Tabs UI.
//
// Applies a ConfigureDraft to the live DOM and host settings in one
// atomic-like pass. Avoids the per-tab side effects of assignTab (no
// runHandoff, no auto-open, no per-tab persist), coalescing all writes
// into a single patchHostDrawerSettings + persistLayout call.

import {
  type ConfigureDraft,
  type BaseSnapshot,
  encodeHostTabOrder,
} from './configure-model'
import {
  getTabAssignments,
  setTabAssignment,
  deleteTabAssignment,
} from './assignment'
import {
  hideMainTabButton,
  showMainTabButton,
  addSecondaryTabButton,
  removeSecondaryTabButton,
  reorderSecondaryTabButtons,
  applyHiddenTabIdsToSecondary,
  applyHiddenTabIdsToMirror,
  updateDrawerTabVisibility,
} from './buttons'
import {
  patchHostDrawerSettings,
} from '../dom/host-settings'
import {
  setSuppressAutoActivation,
} from '../sidebar/secondary-drawer'
import { persistLayout } from '../layout/persist'
import { getSettings } from '../settings/state'
import { dlog, dwarn } from '../debug/log'
import { findStoreData, getDrawerTabs } from '../store'
import { getHostBridge } from '../dom/host-bridge'
import { getSecondaryWrapper } from '../sidebar/secondary'
import { cssEscape } from './buttons'

export type CommitResult = { ok: true } | { ok: false; error: string }

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
 *   8. Persist layout once (only if persistTabAssignments enabled).
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

    // 4. Move tabs.
    //    Parallel moves; errors caught per-tab so one failure doesn't abort batch.
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

    // 5. Reorder secondary buttons.
    reorderSecondaryTabButtons(draft.secondaryIds)

    // 6. Apply hidden state.
    applyHiddenTabIdsToSecondary(draft.hiddenIds)
    applyHiddenTabIdsToMirror(draft.hiddenIds)

    // 7. Reconcile drawer tab visibility (awaited, guarded).
    updateDrawerTabVisibility()
    try {
      const mm = await import('../sidebar/main-mirror-drawer')
      mm.updateMainMirrorDrawerTabVisibility?.()
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

    // 8. One persist (only if setting enabled).
    if (getSettings().persistTabAssignments) {
      persistLayout()
    }

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
    hideMainTabButton(tabId)
    if (root) {
      const storeTab = findDrawerTab(tabId)
      const title = ui?.getBuiltInTabTitle?.(tabId) || storeTab?.title || tabId
      addSecondaryTabButton({
        id: tabId,
        title,
        root,
        iconSvg: storeTab?.iconSvg,
        iconUrl: storeTab?.iconUrl,
        shortName: ui?.getBuiltInTabTitle?.(tabId) ? undefined : storeTab?.shortName,
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
    hideMainTabButton(tabId)

    // Reparent the extension root into secondary content.
    const secondaryContent = getSecondaryWrapper()?.querySelector('.sidebar-ux-panel-content')
    if (secondaryContent && storeTab.root.parentElement !== secondaryContent) {
      secondaryContent.appendChild(storeTab.root)
    }
    storeTab.root.setAttribute('data-canvas-moved', tabId)

    addSecondaryTabButton({
      id: tabId,
      title: storeTab.title,
      root: storeTab.root,
      iconSvg: storeTab.iconSvg,
      iconUrl: storeTab.iconUrl,
      shortName: storeTab.shortName,
    })
    updateDrawerTabVisibility()
  }
}

/**
 * Move a tab to the primary drawer without handoff, auto-close, or per-tab persist.
 */
async function moveTabToPrimaryQuiet(tabId: string): Promise<void> {
  const bridge = getHostBridge()
  const ui = bridge?.ui
  const isBuiltIn = !!ui?.getBuiltInTabRoot?.(tabId)

  if (isBuiltIn) {
    // Built-in: requestTabLocation back to main-drawer.
    if (ui?.requestTabLocation) {
      try {
        ui.requestTabLocation(tabId, { kind: 'main-drawer' })
      } catch (err) {
        dwarn(`[configure-commit] requestTabLocation(main-drawer) failed for "${tabId}":`, err)
      }
    }
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
      storeTab.root.removeAttribute('data-canvas-moved')
      storeTab.root.removeAttribute('data-canvas-active')
    }
  }
  updateDrawerTabVisibility()
}
