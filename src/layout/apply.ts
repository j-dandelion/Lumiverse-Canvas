// Restore a saved layout snapshot to the DOM.
// Extracted from persist.ts — applyLayout restores drawer positions,
// widths, open/closed state, and tab assignments from the persisted blob.

import { getDrawerTabs, isMainDrawerOpen, getMainDrawerSide } from '../store'
import {
  getSecondaryWrapper, isSecondarySidebarOpen, SECONDARY_WIDTH_VAR,
  animateWrapper, getClosedTransformPx,
  openSecondarySidebar, closeSecondarySidebar,
} from '../sidebar/secondary'
import {
  hasTabAssignment, setTabAssignment, getTabAssignments,
} from '../tabs/assignment'
import {
  assignToSecondary,
  unassignFromSecondary,
  setRestoringFromLayout,
  setSuppressAutoActivation,
} from '../sidebar/secondary-drawer'
import {
  hideMainTabButton, showSecondaryTab, findMainTabButton, updateDrawerTabVisibility,
  clearSecondaryTabButtonActive,
} from '../tabs/buttons'
import { dlog, dwarn } from '../debug/log'
import { isMobileViewport, enforceExclusionOnOpen } from '../sidebar/mobile-exclusion'
import { getSettings } from '../settings/state'

// Restore machinery: a MutationObserver on the main sidebar catches new
// tab buttons as extensions register (childList + subtree). Each fire
// re-runs the per-tab restore attempt. Built-in assigns are async and
// reparent into the *secondary* panel, which does not mutate main
// sidebar childList — so each assignToSecondary also re-checks on
// settle (see kickAssign). The loop ends when all tabs are fully
// restored or the safety timeout elapses.
//
// Test seam: setRestoreTimeoutMs() lets tests shrink the 10s default to
// 100ms (or any value). Used by the layout-restore tests.
let _restoreObserver: MutationObserver | null = null
let _restoreTimeoutHandle: ReturnType<typeof setTimeout> | null = null
let _restoreTimeoutMs = 10000
/** Resolve the pending applyLayout() awaiter when restore finishes or is cancelled. */
let _restoreDone: (() => void) | null = null
/** True while tab restore is in flight — suppress mid-restore SAVE_LAYOUT thrash. */
let _layoutRestoreActive = false

export function setRestoreTimeoutMs(ms: number): void {
  _restoreTimeoutMs = ms
}

/** True while applyLayout is restoring detached tabs (observer/timeout window). */
export function isLayoutRestoreActive(): boolean {
  return _layoutRestoreActive
}

function resolveRestoreDone(): void {
  const done = _restoreDone
  _restoreDone = null
  _layoutRestoreActive = false
  if (done) done()
}

/**
 * Cancel any in-flight layout restore. Disconnects the observer and
 * clears the safety timeout. Also releases restore/suppress guards so
 * disable/teardown cannot leave activation permanently deferred.
 * Called from features/registry.ts alwaysCleanups when Canvas is disabled.
 * Resolves any pending applyLayout() awaiter so Load previous cannot hang.
 */
export function cancelApplyLayoutInterval(): void {
  if (_restoreObserver !== null) {
    _restoreObserver.disconnect()
    _restoreObserver = null
  }
  if (_restoreTimeoutHandle !== null) {
    clearTimeout(_restoreTimeoutHandle)
    _restoreTimeoutHandle = null
  }
  setRestoringFromLayout(false)
  setSuppressAutoActivation(false)
  resolveRestoreDone()
}

/**
 * Check if a tab is fully restored: assignment is set AND its content root
 * is in the secondary panel. The original end condition only checked
 * hasTabAssignment, which is set early in assignToSecondary before the
 * fallback (move root, add button) runs. If the fallback fails (store
 * not loaded, root not found), the assignment might be set but the
 * content is not in the secondary panel. This stricter check ensures
 * the polling loop continues until the full restore is complete.
 *
 * For composite ids (e.g., "spindle:uuid:tab:html_preview:1"), the
 * wrapper sets data-canvas-moved to the bare id (options.id). So we
 * check both the full id and a derived bare id.
 *
 * Must scope to the secondary wrapper — `.sidebar-ux-panel-content` is
 * shared with main-mirror; an unscoped querySelector can hit the mirror
 * panel first and never see moved roots → infinite re-assign thrash.
 */
function isTabFullyRestored(tabId: string): boolean {
  if (!hasTabAssignment(tabId)) return false
  const _secondaryContent =
    getSecondaryWrapper()?.querySelector('.sidebar-ux-panel-content') ?? null
  if (!_secondaryContent) return false
  // For composite ids, derive the bare id (last segment, stripped of trailing :N)
  const _bareId = tabId.includes(':')
    ? (tabId.replace(/:\d+$/, '').split(':').pop() ?? tabId)
    : tabId
  const _roots = _secondaryContent.querySelectorAll('[data-canvas-moved]')
  for (const _r of Array.from(_roots)) {
    const _moved = _r.getAttribute('data-canvas-moved')
    if (_moved === tabId || _moved === _bareId) return true
  }
  return false
}

/**
 * Restore a saved layout. When tab restore runs, the returned Promise
 * resolves only after finishRestore (all tabs done or safety timeout) —
 * callers like "Load previous" must not flush/save until then.
 */
export async function applyLayout(layout: any): Promise<void> {
  if (!layout) return

  // Abort any prior restore so we do not stack observers or hang an old awaiter.
  cancelApplyLayoutInterval()

  const settings = getSettings()
  const restoreWidth = !!settings.persistDrawerWidth
  const restoreTabs = !!settings.persistTabAssignments
  const restoreOpen = !!settings.persistDrawerOpenState

  // Restore secondary sidebar width — clamp to viewport so the closed
  // transform fully hides the sidebar on narrow screens. Mirrors the
  // clamp in restoreMainDrawerFromDom (main-persist.ts) and the
  // resize-handle bounds (resize/handles.ts).
  //
  // On mobile (≤600px), skip this entirely: mobile-exclusion.ts manages
  // the CSS variable to keep it in sync with the 100vw inline width.
  // If we overwrote it here with the desktop-saved width, getClosedTransformPx()
  // would produce a short close offset and the drawer would peek.
  if (restoreWidth && layout.secondary?.width && !isMobileViewport()) {
    const clamped = Math.max(200, Math.min(window.innerWidth * 0.8, layout.secondary.width))
    document.documentElement.style.setProperty(SECONDARY_WIDTH_VAR, `${clamped}px`)
    // Phase 3 (finding #13): createSecondarySidebar already initialized the
    // wrapper transform with the right width on mount (see the options
    // parameter). No animateWrapper call needed here — that would re-trigger
    // the close animation and cause a flicker. The conditional animateWrapper
    // below is kept as a safety net for the case where applyLayout is called
    // without a prior mountSecondarySidebar(layout) (e.g. from a future
    // "reload layout" debug action that runs after setup).
    if (getSecondaryWrapper() && !isSecondarySidebarOpen()) {
      const currentTransform = getSecondaryWrapper()!.style.transform?.match(/-?[\d.]+/)?.[0]
      // Compare against the sign-aware closed transform. The saved width is
      // always positive, but the rendered transform carries a sign
      // (+width when sec is on the right, -width when sec is on the left),
      // so a direct string match against the saved width would always
      // differ when the secondary is on the left. Use the same sign logic
      // as getClosedTransformPx to compute the desired closed value.
      const desiredClosed = getMainDrawerSide() === 'right'
        ? -clamped
        : clamped
      if (currentTransform !== String(desiredClosed)) {
        animateWrapper(getSecondaryWrapper()!, desiredClosed)
      }
    }
  }

  /** Apply secondary open/close from layout (open facet only). */
  const applySecondaryOpenState = () => {
    if (!restoreOpen) return
    const mobileExcluded = isMobileViewport() && isMainDrawerOpen()
    const savedOpen = layout.secondary?.open === true
    // Live assignments only: disk detachedTabs may still exist when tabs facet is frozen off.
    const hasSecondaryTabs = getTabAssignments().size > 0
    const shouldBeOpen = savedOpen && hasSecondaryTabs
    if (mobileExcluded && isSecondarySidebarOpen()) {
      enforceExclusionOnOpen('primary')
    } else if (shouldBeOpen && !isSecondarySidebarOpen()) {
      openSecondarySidebar()
    } else if (!shouldBeOpen && isSecondarySidebarOpen()) {
      closeSecondarySidebar()
      updateDrawerTabVisibility()
    }
  }

  // Restore tab assignments (replace semantics, not merge).
  // Load previous can run while live secondary already has tabs the saved
  // layout wants on main — we must unassign those extras, not only assign
  // saved detachedTabs.
  if (restoreTabs) {
    // Wait for extension tabs to register, then restore.
    // Phase 2: match by stable tabId only. Title fallback was removed because
    // tabTitle can drift across sessions (e.g. "LumiBooks" → "LumiBooks v2")
    // and was the source of the "Hone / Prompt Inspector unreliable" symptom.
    // If a stored tabId is no longer in the store (extension uninstalled or
    // id schema changed), we warn and skip — the user can clean up via the
    // future "reset layout" action.
    //
    // Phase 3 (finding #5): polling now uses assignToSecondary for both
    // direct and LumiScript-fallback paths. assignToSecondary handles the
    // full lifecycle (state, buttons, DOM reparenting for extension tabs,
    // display-toggle for built-in tabs) without the policy-layer side
    // effects of assignTab: it does not manipulate the main drawer
    // (which is already in its saved state) and it does NOT call
    // persistLayout (we just LOADED this layout, no need to write it
    // back — the internal persistLayout call in assignToSecondary is
    // idempotent).
    //
    // Phase 4.0 (suffix-drift fallback): Lumiverse assigns a session-variant
    // suffix (`:1`, `:2`, `:3`) to extension tab ids in the order they're
    // registered. The suffix in the live DOM is NOT the same as the one in
    // layout.json after a session restart — e.g. layout says
    // `prompt-viewer:2` but live is `prompt-viewer:1`. An exact-match-only
    // restore leaves the user with empty secondary panels after a restart.
    // Fix: if an exact match fails, strip the last `:N` from both the stored
    // id and each live id, and match by the stripped prefix. If exactly one
    // live id matches, use it AND rewrite the stored id in the in-memory
    // layout (so the next persistLayout write self-heals). If multiple live
    // ids match, the stripped prefix is too coarse — warn and skip.
    //
    // Phase 4.1 (replace vs merge): unassign live secondary tabs that are not
    // in the saved detachedTabs set (suffix-aware) before assigning wanted
    // tabs. Without this, Load previous leaves extra secondary tabs that
    // belonged on main in the previous saved layout.
    //
    // The Promise below resolves only when finishRestore runs so callers
    // (e.g. Load previous) do not flush SAVE_LAYOUT over a half-restored live state.
    return new Promise<void>((resolve) => {
      _restoreDone = resolve
      _layoutRestoreActive = true

      const stripSuffix = (id: string): string => {
        const lastColon = id.lastIndexOf(':')
        if (lastColon <= 0) return id
        const tail = id.slice(lastColon + 1)
        return /^\d+$/.test(tail) ? id.slice(0, lastColon) : id
      }
      // Guard: prevent the auto-close in secondary-drawer.ts's onTabUnregistered
      // handler from firing during the restore. Lumiverse re-renders the main
      // sidebar during restore (extensions finish loading, React re-commits),
      // which can spuriously unregister and re-register tabs (see
      // secondary-drawer.ts flag declaration for full rationale).
      //
      // Also suppress per-assign activation so finishRestore is the sole
      // authority for which secondary tab is active (late Lorebook assigns
      // must not overwrite the saved active tab after ~10s).
      setRestoringFromLayout(true)
      setSuppressAutoActivation(true)

      // Once-guard: finishRestore can be reached from observer, assign
      // settle, initial/follow-up passes, and the safety timeout.
      let _restoreFinished = false
      // Dedup in-flight assigns so observer/settle re-checks do not stack
      // concurrent assignToSecondary for the same tab id.
      const _assigningIds = new Set<string>()
      // Ids whose assign has settled once. Prevents sync re-kick storms when
      // isTabFullyRestored stays false (would spin microtasks and starve the
      // safety timeout). Observer clears this so late DOM can re-attempt.
      const _settledIds = new Set<string>()

      /** Resolve which secondary tab should be active after restore. */
      const resolveRestoredActiveTabId = (): string | null => {
        const detached = (layout.detachedTabs ?? []) as { tabId: string }[]
        const saved = layout.secondary?.activeTabId as string | undefined
        if (saved) {
          if (hasTabAssignment(saved)) return saved
          const prefix = stripSuffix(saved)
          const matches = detached
            .map((dt) => dt.tabId)
            .filter((id) => hasTabAssignment(id) && stripSuffix(id) === prefix)
          if (matches.length === 1) {
            if (layout.secondary) layout.secondary.activeTabId = matches[0]
            return matches[0]
          }
        }
        const fallback = detached.find((dt) => hasTabAssignment(dt.tabId))
        return fallback?.tabId ?? null
      }

      // End-of-restore block. Runs once when all tabs are restored OR the
      // safety timeout fires. Disconnects the observer, clears the timeout,
      // picks the active tab (authoritative), re-applies open/closed state,
      // then releases restore/suppress guards.
      const finishRestore = () => {
        if (_restoreFinished) return
        _restoreFinished = true
        if (_restoreObserver !== null) {
          _restoreObserver.disconnect()
          _restoreObserver = null
        }
        if (_restoreTimeoutHandle !== null) {
          clearTimeout(_restoreTimeoutHandle)
          _restoreTimeoutHandle = null
        }
        // Prefer the persisted active secondary tab (with suffix-drift heal).
        // Old layouts without activeTabId fall back to the first detached tab.
        // Keep suppress true through this call so concurrent assigns cannot steal.
        if (restoreTabs) {
          const restoredId = resolveRestoredActiveTabId()
          if (restoredId) {
            showSecondaryTab(restoredId)
          }
        }
        // Safety net for the case where applyLayout is called WITHOUT a
        // prior mountSecondarySidebar(layout) — re-apply open/closed state.
        // Mobile exclusion: don't reopen the secondary if the primary is
        // open on mobile.
        applySecondaryOpenState()
        // showSecondaryTab always paints sidebar-ux-tab-active. applySecondaryOpenState
        // only calls closeSecondarySidebar when the drawer is currently open — when
        // mount already left it closed (saved open:false / keep-tabs strip), the
        // close path never runs and a tab stays highlighted on the closed strip.
        // Match closeSecondarySidebar: no button looks selected while closed;
        // activeTabId remains for the next open/click.
        if (!isSecondarySidebarOpen()) {
          clearSecondaryTabButtonActive()
        }
        // Refresh strip/gutter after assigns and after empty-layout unassigns.
        updateDrawerTabVisibility()
        // Re-assert primary tab after secondary assigns (open facet owns primary.tabId).
        // Moving tabs off main can leave the host on "profile" even if applyMainDrawer already ran.
        if (restoreOpen) {
          const primaryTabId =
            typeof layout.primary?.tabId === 'string' ? layout.primary.tabId : null
          if (primaryTabId && layout.primary?.open !== false) {
            void import('../sidebar/main-persist').then((m) => {
              m.ensureRestoredPrimaryTab(primaryTabId)
            })
          }
        }
        setRestoringFromLayout(false)
        setSuppressAutoActivation(false)
        resolveRestoreDone()
      }

      /**
       * Live secondary tabs not wanted by the saved layout → main drawer.
       * Suffix-aware: if saved wants `ext:1` and live secondary is only
       * `ext:2` (session re-register), keep it for the assign path to heal.
       */
      const unassignUnwantedSecondary = async (): Promise<void> => {
        const wantedList = ((layout.detachedTabs ?? []) as { tabId: string }[])
          .map((dt) => dt.tabId)
          .filter(Boolean)
        const liveSecondary = new Set<string>()
        for (const [id, panel] of getTabAssignments()) {
          if (panel === 'secondary') liveSecondary.add(id)
        }
        if (liveSecondary.size === 0) return

        const keep = new Set<string>()
        for (const wanted of wantedList) {
          if (liveSecondary.has(wanted)) {
            keep.add(wanted)
            continue
          }
          const prefix = stripSuffix(wanted)
          const candidates = [...liveSecondary].filter((id) => stripSuffix(id) === prefix)
          if (candidates.length === 1) {
            keep.add(candidates[0])
          }
        }

        const extras = [...liveSecondary].filter((id) => !keep.has(id))
        for (const id of extras) {
          // Skip if a prior unassign already cleared a dual bare/composite key.
          if (!hasTabAssignment(id)) continue
          try {
            await unassignFromSecondary(id)
            dlog(`applyLayout: unassigned extra secondary tab "${id}" (not in saved layout)`)
          } catch (err) {
            dwarn(`applyLayout: unassignFromSecondary(${id}) failed:`, err)
          }
        }
      }

      // Kick assignToSecondary once per id (until settle). On settle, re-check
      // completion: built-in tabs reparent into the secondary panel and never
      // mutate main sidebar childList, so the MutationObserver alone would
      // leave activation deferred until the 10s safety timeout.
      const kickAssign = (tabId: string): void => {
        if (_restoreFinished || _assigningIds.has(tabId) || _settledIds.has(tabId)) return
        _assigningIds.add(tabId)
        assignToSecondary(tabId)
          .catch((err) => {
            dwarn(`applyLayout: assignToSecondary(${tabId}) failed:`, err)
          })
          .finally(() => {
            _assigningIds.delete(tabId)
            _settledIds.add(tabId)
            if (_restoreFinished) return
            const remaining = attemptRestore()
            if (remaining === 0) finishRestore()
          })
      }

      // One pass of restore work. Returns the number of tabs that still need
      // more work. Observer, assign settle, and the safety timeout all call
      // this; progress is measured via isTabFullyRestored.
      const attemptRestore = (): number => {
        if (_restoreFinished) return 0
        const detached = (layout.detachedTabs ?? []) as { tabId: string }[]
        if (detached.length === 0) return 0
        let remaining = 0
        for (let i = 0; i < detached.length; i++) {
          const dt = detached[i]
          const liveIdForCheck = (() => {
            // Prefer already-healed layout id; also check assignment under stored id.
            return dt.tabId
          })()
          const _alreadyAssigned = hasTabAssignment(liveIdForCheck)
          const _fullyRestored = _alreadyAssigned ? isTabFullyRestored(liveIdForCheck) : false
          if (_alreadyAssigned && _fullyRestored) continue
          remaining++
          // Already tried assign; wait for observer (DOM) or safety timeout.
          if (_settledIds.has(liveIdForCheck) || _assigningIds.has(liveIdForCheck)) continue
          // Try exact match first
          const tabs = getDrawerTabs()
          let tab = tabs.find(t => t.id === dt.tabId)
          if (!tab) {
            // Exact match missed — try stripped-suffix match
            const storedPrefix = stripSuffix(dt.tabId)
            const candidates = tabs.filter(t => stripSuffix(t.id) === storedPrefix)
            if (candidates.length === 1) {
              tab = candidates[0]
              dlog(`applyLayout: suffix-drift fallback matched stored "${dt.tabId}" → live "${tab.id}"`)
              // Self-heal: rewrite the in-memory layout so the next persistLayout
              // call stores the live id. Also heal secondary.activeTabId when it
              // pointed at the drifted stored id (exact or same stripped prefix).
              const prevId = dt.tabId
              layout.detachedTabs[i] = { ...dt, tabId: tab.id }
              const savedActive = layout.secondary?.activeTabId as string | undefined
              if (
                savedActive &&
                (savedActive === prevId || stripSuffix(savedActive) === stripSuffix(prevId))
              ) {
                layout.secondary = { ...layout.secondary, activeTabId: tab.id }
              }
            } else if (candidates.length > 1) {
              dwarn(`applyLayout: stripped-suffix match for "${dt.tabId}" is ambiguous (${candidates.length} candidates). Skipping.`)
            }
          }
          if (tab) {
            kickAssign(tab.id)
          } else {
            const mainBtn = findMainTabButton(dt.tabId)
            if (mainBtn) {
              const liveTabId = mainBtn.getAttribute('data-tab-id') || dt.tabId
              kickAssign(liveTabId)
              dlog(`applyLayout: LumiScript fallback matched stored "${dt.tabId}" via main button → live "${liveTabId}"`)
            } else {
              const knownIds = tabs.map(t => t.id)
              dwarn(`applyLayout: stored detached tabId "${dt.tabId}" not found in store or DOM (and no suffix-drift match). Known ids: ${knownIds.join(', ')}. Layout may be stale.`)
            }
          }
        }
        return remaining
      }

      /** Start observer + assign loop after extras have been unassigned. */
      const startAssignPhase = (): void => {
        if (_restoreFinished) return

        const detachedLen = (layout.detachedTabs?.length ?? 0)
        if (detachedLen === 0) {
          // Saved layout has no secondary tabs — unassigns already ran.
          finishRestore()
          return
        }

        // Observe the main sidebar for childList + subtree — each new tab
        // button (extension registration) fires the observer and re-runs
        // the restore pass. End condition checked after each fire.
        // Assign-settle (kickAssign.finally) covers completion when work
        // only mutates the secondary panel.
        const sidebar = document.querySelector('[data-spindle-mount="sidebar"]')
        if (sidebar) {
          _restoreObserver = new MutationObserver(() => {
            // Allow re-assign after DOM churn (late extension registration).
            _settledIds.clear()
            const remaining = attemptRestore()
            if (remaining === 0) finishRestore()
          })
          _restoreObserver.observe(sidebar, { childList: true, subtree: true })
        } else {
          // Sidebar not present yet (early layout application). Drain work
          // on a microtask + safety timeout so the observer doesn't
          // sit silent if the sidebar never appears.
          queueMicrotask(() => {
            if (_restoreFinished) return
            const remaining = attemptRestore()
            if (remaining === 0) finishRestore()
          })
        }

        // Safety timeout: drain work if extensions never register their tabs
        // (e.g., the extension was uninstalled but the layout still references
        // it). Preserves the original 10s bounded wait.
        _restoreTimeoutHandle = setTimeout(() => {
          attemptRestore()
          finishRestore()
        }, _restoreTimeoutMs)

        // Initial pass: handle the case where tabs are already registered
        // before the observer attaches. Most common on a fast session restart.
        const initialRemaining = attemptRestore()
        if (initialRemaining === 0) {
          finishRestore()
        } else {
          // assignToSecondary may complete synchronously when the drawer is
          // already open (the await openSecondarySidebar path is skipped). The
          // first pass already fired it — a second pass catches the
          // now-fully-restored tabs without waiting for the observer or timeout.
          // Async assigns still finish via kickAssign.finally.
          const followUp = attemptRestore()
          if (followUp === 0) finishRestore()
        }
      }

      // Unassign extras first so Load previous is replace, not merge; then assign.
      void unassignUnwantedSecondary()
        .catch((err) => {
          dwarn('applyLayout: unassignUnwantedSecondary failed:', err)
        })
        .then(() => {
          startAssignPhase()
        })
    })
  } else if (restoreOpen) {
    // Tabs facet off: still restore secondary open/close.
    applySecondaryOpenState()
  }
}
