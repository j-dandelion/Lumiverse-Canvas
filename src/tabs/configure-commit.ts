// Batch commit for the Configure Tabs UI.
//
// Serialized fail-forward step queue (not a real transaction). Concurrent
// callers share `_commitChain` and are never rejected as "already in progress".
// On step failure, best-effort reverse of prior reversible steps may run;
// persist / side apply may already be irreversible. Avoids per-tab assignTab
// side effects (no runHandoff, no auto-open, no per-tab persist), coalescing
// writes into patchHostDrawerSettings + persistLayout where possible.
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
  readLivePrimaryTabIds,
  readLiveSecondaryTabIds,
} from './live-tab-order'
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
  getHostDrawerSettings,
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
import {
  adoptMainMirrorHostActivation,
  getMainMirrorActiveTabId,
  isMainTabPinEnabled,
} from '../sidebar/main-tab-pin'
import { isCanvasMainOpen } from '../sidebar/main-mirror-drawer'
import { isMobileViewport } from '../sidebar/mobile-exclusion'

export type CommitResult = { ok: true } | { ok: false; error: string }

/** Context for commit steps */
interface CommitContext {
  draft: ConfigureDraft
  base: BaseSnapshot
  toSecondary: string[]
  toPrimary: string[]
  sideChanged: boolean
  pendingHandoffs: Array<{
    tabId: string
    source: 'primary' | 'secondary'
    destination: 'primary' | 'secondary'
    sourceList: string[]
    preMoveSourceActiveTab: boolean
    activateDestination: false
  }>
  preservePrimary: ReturnType<typeof armPreservePrimaryActiveOnQuietToSecondary>
  /** Rollback state storage */
  rollbackState: {
    previousTabOrder?: string[]
    previousHiddenTabIds?: string[]
    previousSide?: 'left' | 'right'
    preMoveSecondaryIds?: string[]
    preMovePrimaryIds?: string[]
    preReorderSecondaryIds?: string[]
    preReorderPrimaryIds?: string[]
    previousHiddenIds?: Set<string>
  }
}

/** A discrete step in the commit pipeline */
interface CommitStep {
  name: string
  run: (ctx: CommitContext) => Promise<void>
  rollback?: (ctx: CommitContext) => Promise<void>
  /** Predicate to determine if this step should run */
  shouldRun?: (ctx: CommitContext) => boolean
  /** Whether this step is irreversible (no rollback) */
  irreversible?: boolean
}

/** Commit steps pipeline */
const commitSteps: CommitStep[] = [
  // Step 1: Compute deltas and set up context
  {
    name: 'compute-deltas',
    run: async (ctx) => {
      const { toSecondary, toPrimary } = computeDeltas(ctx.draft)
      ctx.toSecondary = toSecondary
      ctx.toPrimary = toPrimary
      ctx.sideChanged = ctx.draft.drawerSide !== ctx.base.drawerSide
    },
  },

  // Step 2: Suppress auto-activation during moves
  {
    name: 'suppress-auto-activation',
    run: async () => {
      setSuppressAutoActivation(true)
    },
    rollback: async () => {
      setSuppressAutoActivation(false)
    },
  },

  // Step 3: Patch host drawer settings (order, hidden, side)
  {
    name: 'patch-host-settings',
    run: async (ctx) => {
      // Save previous settings for rollback
      const currentSettings = getHostDrawerSettings()
      if (currentSettings) {
        ctx.rollbackState.previousTabOrder = currentSettings.tabOrder
        ctx.rollbackState.previousHiddenTabIds = currentSettings.hiddenTabIds
        ctx.rollbackState.previousSide = currentSettings.side
      }

      const hostWriteOk = patchHostDrawerSettings({
        tabOrder: encodeHostTabOrder(ctx.draft),
        hiddenTabIds: [...ctx.draft.hiddenIds],
        side: ctx.draft.drawerSide,
      })
      if (!hostWriteOk) {
        dwarn(
          '[configure-commit] patchHostDrawerSettings returned false; ' +
          'host order/hide/side may not persist. Continuing with DOM moves.',
        )
      }
    },
    rollback: async (ctx) => {
      // Restore previous settings
      if (ctx.rollbackState.previousTabOrder !== undefined) {
        patchHostDrawerSettings({
          tabOrder: ctx.rollbackState.previousTabOrder,
          hiddenTabIds: ctx.rollbackState.previousHiddenTabIds || [],
          side: ctx.rollbackState.previousSide || 'left',
        })
      }
    },
  },

  // Step 4: Apply side change if needed
  {
    name: 'apply-side-change',
    run: async (ctx) => {
      if (ctx.sideChanged) {
        try {
          await forceMainDrawerSideChange(ctx.draft.drawerSide)
        } catch (err) {
          dwarn('[configure-commit] forceMainDrawerSideChange failed:', err)
        }
      }
    },
    shouldRun: (ctx) => ctx.sideChanged,
  },

  // Step 5: Capture source lists for handoff
  {
    name: 'capture-source-lists',
    run: async (ctx) => {
      const pendingHandoffs: CommitContext['pendingHandoffs'] = []

      if (ctx.toSecondary.length > 0) {
        const primaryList = await captureSourceList('primary')
        for (const tabId of ctx.toSecondary) {
          pendingHandoffs.push({
            tabId,
            source: 'primary',
            destination: 'secondary',
            sourceList: primaryList,
            preMoveSourceActiveTab: isPrimaryActiveForQuiet(tabId),
            activateDestination: false,
          })
        }
      }

      if (ctx.toPrimary.length > 0) {
        const secondaryList = await captureSourceList('secondary')
        for (const tabId of ctx.toPrimary) {
          pendingHandoffs.push({
            tabId,
            source: 'secondary',
            destination: 'primary',
            sourceList: secondaryList,
            preMoveSourceActiveTab: getActiveSecondaryTabId() === tabId,
            activateDestination: false,
          })
        }
      }

      ctx.pendingHandoffs = pendingHandoffs
    },
  },

  // Step 6: Preserve primary active on quiet to-secondary
  {
    name: 'preserve-primary-active',
    run: async (ctx) => {
      ctx.preservePrimary = armPreservePrimaryActiveOnQuietToSecondary(ctx.toSecondary)
    },
  },

  // Step 7: Move tabs (quiet — no per-tab handoff/persist)
  {
    name: 'move-tabs',
    run: async (ctx) => {
      // Pre-move live order for rollback (never draft — draft is post-edit targets).
      ctx.rollbackState.preMoveSecondaryIds = readLiveSecondaryTabIds()
      ctx.rollbackState.preMovePrimaryIds = readLivePrimaryTabIds()

      const movePromises: Promise<void>[] = []

      for (const tabId of ctx.toSecondary) {
        movePromises.push(moveTabToSecondaryQuiet(tabId).catch((err) => {
          dwarn(`[configure-commit] moveTabToSecondaryQuiet failed for "${tabId}":`, err)
        }))
      }
      for (const tabId of ctx.toPrimary) {
        movePromises.push(moveTabToPrimaryQuiet(tabId).catch((err) => {
          dwarn(`[configure-commit] moveTabToPrimaryQuiet failed for "${tabId}":`, err)
        }))
      }
      await Promise.all(movePromises)
    },
    rollback: async (ctx) => {
      // Best-effort reverse; persist/side may already be irreversible.
      const movePromises: Promise<void>[] = []

      // Move tabs that were moved to secondary back to primary
      for (const tabId of ctx.toSecondary) {
        movePromises.push(moveTabToPrimaryQuiet(tabId).catch((err) => {
          dwarn(`[configure-commit] rollback moveTabToPrimaryQuiet failed for "${tabId}":`, err)
        }))
      }

      // Move tabs that were moved to primary back to secondary
      for (const tabId of ctx.toPrimary) {
        movePromises.push(moveTabToSecondaryQuiet(tabId).catch((err) => {
          dwarn(`[configure-commit] rollback moveTabToSecondaryQuiet failed for "${tabId}":`, err)
        }))
      }

      await Promise.all(movePromises)

      // Restore pre-move live order captured at step entry
      reorderSecondaryTabButtons(ctx.rollbackState.preMoveSecondaryIds || [])
      reorderHostMainTabButtons(ctx.rollbackState.preMovePrimaryIds || [])
      reorderMainMirrorTabButtons(ctx.rollbackState.preMovePrimaryIds || [])
    },
  },

  // Step 8: Reorder secondary tab buttons
  {
    name: 'reorder-buttons',
    run: async (ctx) => {
      // Live DOM order immediately before applying draft (post-move if any).
      ctx.rollbackState.preReorderSecondaryIds = readLiveSecondaryTabIds()
      ctx.rollbackState.preReorderPrimaryIds = readLivePrimaryTabIds()

      reorderSecondaryTabButtons(ctx.draft.secondaryIds)
      reorderHostMainTabButtons(ctx.draft.primaryIds)
      reorderMainMirrorTabButtons(ctx.draft.primaryIds)
    },
    rollback: async (ctx) => {
      // Best-effort reverse to pre-step live order.
      if (ctx.rollbackState.preReorderSecondaryIds) {
        reorderSecondaryTabButtons(ctx.rollbackState.preReorderSecondaryIds)
      }
      if (ctx.rollbackState.preReorderPrimaryIds) {
        reorderHostMainTabButtons(ctx.rollbackState.preReorderPrimaryIds)
        reorderMainMirrorTabButtons(ctx.rollbackState.preReorderPrimaryIds)
      }
    },
  },

  // Step 9: Preserve primary active after moves
  {
    name: 'preserve-primary-after-moves',
    run: async (ctx) => {
      if (ctx.preservePrimary) {
        await new Promise<void>((r) => requestAnimationFrame(() => r()))
        try {
          ctx.preservePrimary.reassert()
        } catch (err) {
          dwarn('[configure-commit] post-move primary active reassert failed:', err)
        }
        // Host React may reshuffle host buttons on the same frame as reset.
        reorderHostMainTabButtons(ctx.draft.primaryIds)
        reorderMainMirrorTabButtons(ctx.draft.primaryIds)
      }
    },
    shouldRun: (ctx) => !!ctx.preservePrimary,
  },

  // Step 10: Run handoffs
  {
    name: 'run-handoffs',
    run: async (ctx) => {
      for (const h of ctx.pendingHandoffs) {
        try {
          await runHandoff(h)
        } catch (err) {
          dwarn(`[configure-commit] runHandoff failed for "${h.tabId}":`, err)
        }
      }
    },
  },

  // Step 11: Re-assert primary active after handoff
  {
    name: 'reassert-primary-after-handoff',
    run: async (ctx) => {
      if (ctx.preservePrimary) {
        try {
          ctx.preservePrimary.reassert()
        } catch (err) {
          dwarn('[configure-commit] preserve primary active reassert failed:', err)
        }
      }
    },
    shouldRun: (ctx) => !!ctx.preservePrimary,
  },

  // Step 12: Reconcile secondary after quiet primary moves
  {
    name: 'reconcile-secondary',
    run: async (ctx) => {
      if (ctx.toPrimary.length > 0) {
        try {
          reconcileSecondaryAfterQuietPrimaryMoves(ctx.draft.secondaryIds)
        } catch (err) {
          dwarn('[configure-commit] reconcileSecondaryAfterQuietPrimaryMoves failed:', err)
        }
      }
    },
    shouldRun: (ctx) => ctx.toPrimary.length > 0,
  },

  // Step 13: Final reorder
  {
    name: 'final-reorder',
    run: async (ctx) => {
      reorderSecondaryTabButtons(ctx.draft.secondaryIds)
      reorderHostMainTabButtons(ctx.draft.primaryIds)
      reorderMainMirrorTabButtons(ctx.draft.primaryIds)
    },
  },

  // Step 14: Apply hidden state
  {
    name: 'apply-hidden-state',
    run: async (ctx) => {
      // Pre-step hidden set from base (not draft targets).
      ctx.rollbackState.previousHiddenIds = new Set(ctx.base.hiddenTabIds)

      applyHiddenTabIdsToSecondary(ctx.draft.hiddenIds)
      applyHiddenTabIdsToMirror(ctx.draft.hiddenIds)
    },
    rollback: async (ctx) => {
      // Best-effort reverse; persist/side may already be irreversible.
      if (ctx.rollbackState.previousHiddenIds) {
        applyHiddenTabIdsToSecondary(ctx.rollbackState.previousHiddenIds)
        applyHiddenTabIdsToMirror(ctx.rollbackState.previousHiddenIds)
      }
    },
  },

  // Step 15: Reconcile drawer tab visibility
  {
    name: 'reconcile-visibility',
    run: async (ctx) => {
      updateDrawerTabVisibility()
      try {
        const mm = await import('../sidebar/main-mirror-drawer')
        mm.updateMainMirrorDrawerTabVisibility?.()
        // Keep host content parked under taskbar-mode after primary→secondary
        if (ctx.toSecondary.length > 0 && mm.isMainMirrorActive?.()) {
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
    },
  },

  // Step 16: Reorder after reconcile
  {
    name: 'reorder-after-reconcile',
    run: async (ctx) => {
      if (ctx.toPrimary.length > 0 || ctx.toSecondary.length > 0) {
        reorderHostMainTabButtons(ctx.draft.primaryIds)
        reorderMainMirrorTabButtons(ctx.draft.primaryIds)
      }
    },
    shouldRun: (ctx) => ctx.toPrimary.length > 0 || ctx.toSecondary.length > 0,
  },

  // Step 17: Reconcile can re-sync mirror chrome from host; reassert once more
  {
    name: 'final-reassert',
    run: async (ctx) => {
      if (ctx.preservePrimary) {
        try {
          ctx.preservePrimary.reassert()
        } catch (err) {
          dwarn('[configure-commit] post-reconcile primary active reassert failed:', err)
        }
        try {
          const mm = await import('../sidebar/main-mirror-drawer')
          if (mm.isMainMirrorActive?.()) mm.ensureHostContentParkedPublic?.()
        } catch { /* ignore */ }
        // Stick ~100ms more (activateInPrimary verification window), then drop.
        const stick = ctx.preservePrimary
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
    },
    shouldRun: (ctx) => !!ctx.preservePrimary,
  },

  // Step 18: Persist layout
  {
    name: 'persist-layout',
    run: async () => {
      persistLayout()
    },
    irreversible: true,
  },

  // Step 19: Bust store cache
  {
    name: 'bust-store-cache',
    run: async () => {
      findStoreData(true)
    },
  },
]

/** Injectable side-change applier (production uses drawer-sync.applyMainDrawerSideChange). */
type MainDrawerSideChangeApplier = (desired: 'left' | 'right') => void | Promise<void>
let _applyMainDrawerSideChangeImpl: MainDrawerSideChangeApplier | null = null

/** Test-only: inject a spy for the side-change remount path. Pass null to reset. */
export function __setApplyMainDrawerSideChangeForTest(
  fn: MainDrawerSideChangeApplier | null,
): void {
  _applyMainDrawerSideChangeImpl = fn
}

async function forceMainDrawerSideChange(desired: 'left' | 'right'): Promise<void> {
  if (_applyMainDrawerSideChangeImpl) {
    await _applyMainDrawerSideChangeImpl(desired)
    return
  }
  const { applyMainDrawerSideChange } = await import('../sidebar/drawer-sync')
  await applyMainDrawerSideChange(desired)
}

/**
 * User-visible primary active tab id for quiet DnD / Configure handoff.
 *
 * When taskbar main-mirror pin owns the strip, **only** the Canvas exclusive
 * key counts. Host `tabBtnActive` often stays on a parked/top tab while the
 * closed strip has no selection — falling back re-clicks that park target
 * and opens/activates a tab the user never chose.
 *
 * When pin is off, fall back to host DOM tabBtnActive.
 */
function resolvePrimaryActiveTabIdForQuiet(): string | null {
  if (isMainTabPinEnabled()) {
    return getMainMirrorActiveTabId()
  }

  const sidebar = getMainSidebar()
  if (sidebar) {
    const activeBtn = sidebar.querySelector(
      'button.tabBtnActive, button[class*="tabBtnActive"]',
    ) as HTMLElement | null
    const id =
      activeBtn?.getAttribute('data-tab-id')
      || activeBtn?.getAttribute('title')
      || null
    if (id) return id
  }
  return null
}

/** True when `tabId` is the user-visible primary active tab (mirror-aware). */
function isPrimaryActiveForQuiet(tabId: string): boolean {
  if (isMainTabPinEnabled()) {
    // Key null = no exclusive selection (closed strip / never activated).
    // Do not treat host parked tabBtnActive as user-active.
    const mirrorId = getMainMirrorActiveTabId()
    return mirrorId != null && mirrorId === tabId
  }
  const resolved = resolvePrimaryActiveTabIdForQuiet()
  if (resolved != null) return resolved === tabId
  return isTabActiveInMainDrawer(tabId)
}

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

  // Mirror key first: under taskbar mode host tabBtnActive is often the
  // parked/top tab while Canvas exclusive key is the real strip selection.
  const preActiveId = resolvePrimaryActiveTabIdForQuiet()
  if (!preActiveId) return null

  const preActiveBtn =
    (findMainTabButton(preActiveId) as HTMLElement | null)
    || (sidebar.querySelector(
      'button.tabBtnActive, button[class*="tabBtnActive"]',
    ) as HTMLElement | null)
  if (!preActiveBtn) return null

  // Active tab is being moved away — handoff will pick a neighbor; do not
  // re-activate the departing tab.
  if (toSecondary.includes(preActiveId)) return null
  // Also skip if any moved tab claims active via store/DOM/mirror (id alias).
  if (toSecondary.some((id) => isPrimaryActiveForQuiet(id))) return null

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
      // Preserve key/host active without force-opening a closed main-mirror.
      // Default adopt open:true would re-open the drawer mid quiet DnD.
      adoptMainMirrorHostActivation(btn, title, { open: isCanvasMainOpen() })
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
 * True when a configure-batch commit is currently running (not merely queued).
 * Can be used as a guard elsewhere (e.g. skip observers).
 */
let _batchActive = false
export function isConfigureBatchActive(): boolean { return _batchActive }

/**
 * Serial chain for all configure commits (Configure modal, live DnD, mode-switch).
 * Concurrent callers wait their turn instead of getting "already in progress".
 */
let _commitChain: Promise<void> = Promise.resolve()

/**
 * Resolve when every enqueued `commitConfigureDraft` has finished (ok or fail).
 * Mode-switch / Done use this so dirty checks see a rebased base.
 */
export function waitForConfigureCommitIdle(): Promise<void> {
  return _commitChain.then(() => undefined, () => undefined)
}

/**
 * Commit a ConfigureDraft to the live host state and DOM.
 *
 * Concurrent calls are **serialized** on a module queue (not rejected). Each
 * call runs the full algorithm in order with the draft/base it was given.
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
  const prev = _commitChain
  let result: CommitResult = { ok: false, error: 'Commit did not run' }

  const myTurn = prev.then(
    () => runCommitConfigureDraft(draft, _base),
    () => runCommitConfigureDraft(draft, _base),
  ).then((r) => {
    result = r
    return r
  })

  // Keep the chain alive even if a commit rejects unexpectedly.
  _commitChain = myTurn.then(
    () => undefined,
    () => undefined,
  )

  await myTurn
  return result
}

async function runCommitConfigureDraft(
  draft: ConfigureDraft,
  _base: BaseSnapshot,
): Promise<CommitResult> {
  _batchActive = true

  // Create initial context
  const ctx: CommitContext = {
    draft,
    base: _base,
    toSecondary: [],
    toPrimary: [],
    sideChanged: false,
    pendingHandoffs: [],
    preservePrimary: null as any,
    rollbackState: {},
  }

  try {
    // Execute steps sequentially with rollback on failure
    const executedSteps: CommitStep[] = []

    for (const step of commitSteps) {
      // Check if step should run
      if (step.shouldRun && !step.shouldRun(ctx)) {
        continue
      }

      try {
        // Execute step
        await step.run(ctx)
        executedSteps.push(step)
      } catch (err) {
        // Rollback executed steps in reverse order
        for (const executedStep of executedSteps.reverse()) {
          if (!executedStep.irreversible && executedStep.rollback) {
            try {
              await executedStep.rollback(ctx)
            } catch (rollbackErr) {
              dwarn(`[configure-commit] rollback "${executedStep.name}" failed:`, rollbackErr)
            }
          }
        }

        const msg = err instanceof Error ? err.message : String(err)
        dwarn('[configure-commit] commit failed:', msg)
        return { ok: false, error: msg }
      }
    }

    dlog('[configure-commit] commit successful', {
      toSecondary: ctx.toSecondary.length,
      toPrimary: ctx.toPrimary.length,
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
    if (!root) {
      // Do not record secondary assignment without a panel root — that leaves
      // the map claiming secondary while the host button/DOM stay primary.
      dwarn(`[configure-commit] built-in "${tabId}" move returned no root; assignment unchanged.`)
      return
    }
    setTabAssignment(tabId, 'secondary')
    // Capture chrome before hide so main-button SVG is still in a normal
    // layout tree (display:none still works, but order matches assignTab).
    const storeTab = findDrawerTab(tabId)
    const chrome = resolveSecondaryButtonChrome(tabId, { root, storeTab })
    hideMainTabButton(tabId)
    addSecondaryTabButton({
      id: tabId,
      title: chrome.title,
      root,
      iconSvg: chrome.iconSvg,
      iconUrl: chrome.iconUrl,
      shortName: chrome.shortName,
    })
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
    // Resolve main panel *before* unhiding the strip button so a dynamic
    // import cannot yield a paint with the tab visible at the wrong index.
    deleteTabAssignment(tabId)
    let mainContent: HTMLElement | null = null
    try {
      const { getMainPanelContent } = await import('../dom/lumiverse')
      mainContent = getMainPanelContent()
    } catch (err) {
      dwarn(`[configure-commit] resolve main panel for "${tabId}" failed:`, err)
    }
    showMainTabButton(tabId)
    removeSecondaryTabButton(tabId)

    // Reparent the extension root back to main panel content.
    const storeTab = findDrawerTab(tabId)
    if (storeTab?.root) {
      try {
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
