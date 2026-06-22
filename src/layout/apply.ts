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
  hasTabAssignment, setTabAssignment,
} from '../tabs/assignment'
import { getActiveSecondaryTabId } from '../tabs/active-tab'
import { assignToSecondary, setRestoringFromLayout } from '../sidebar/secondary-drawer'
import {
  hideMainTabButton, showSecondaryTab, findMainTabButton, updateDrawerTabVisibility,
} from '../tabs/buttons'
import { dlog, dwarn } from '../debug/log'
import { isMobileViewport, enforceExclusionOnOpen } from '../sidebar/mobile-exclusion'

// Restore machinery: a MutationObserver on the main sidebar catches new
// tab buttons as extensions register (childList + subtree). Each fire
// re-runs the per-tab restore attempt, and the loop ends when all tabs
// are fully restored or the safety timeout elapses. Replaces the
// setInterval(500ms, 20 attempts) polling loop that was needed because
// polling can't tell when Lumiverse re-renders.
//
// Test seam: setRestoreTimeoutMs() lets tests shrink the 10s default to
// 100ms (or any value). Used by the layout-restore tests.
let _restoreObserver: MutationObserver | null = null
let _restoreTimeoutHandle: ReturnType<typeof setTimeout> | null = null
let _restoreTimeoutMs = 10000

export function setRestoreTimeoutMs(ms: number): void {
  _restoreTimeoutMs = ms
}

/**
 * Cancel any in-flight layout restore. Disconnects the observer and
 * clears the safety timeout. Called from features/registry.ts
 * alwaysCleanups when Canvas is disabled. Replaces the old
 * cancelApplyLayoutInterval — same role, observer-backed now.
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
 */
function isTabFullyRestored(tabId: string): boolean {
  if (!hasTabAssignment(tabId)) return false
  const _secondaryContent = document.querySelector('.sidebar-ux-panel-content')
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

export async function applyLayout(layout: any) {
  if (!layout) return

  // Restore secondary sidebar width — clamp to viewport so the closed
  // transform fully hides the sidebar on narrow screens. Mirrors the
  // clamp in restoreMainDrawerFromDom (main-persist.ts) and the
  // resize-handle bounds (resize/handles.ts).
  //
  // On mobile (≤600px), skip this entirely: mobile-exclusion.ts manages
  // the CSS variable to keep it in sync with the 100vw inline width.
  // If we overwrote it here with the desktop-saved width, getClosedTransformPx()
  // would produce a short close offset and the drawer would peek.
  if (layout.secondary?.width && !isMobileViewport()) {
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

  // Restore tab assignments
  if (layout.detachedTabs?.length) {
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
    // full lifecycle (state, buttons, re-execution for extension tabs,
    // display-toggle for built-in tabs) without the policy-layer side
    // effects of assignTab: it does NOT call switchMainDrawerToFallback
    // (which would manipulate the main drawer that's already in its saved
    // state) and it does NOT call persistLayout (we just LOADED this
    // layout, no need to write it back — the internal persistLayout call
    // in assignToSecondary is idempotent).
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
    const stripSuffix = (id: string): string => {
      const lastColon = id.lastIndexOf(':')
      if (lastColon <= 0) return id
      const tail = id.slice(lastColon + 1)
      return /^\d+$/.test(tail) ? id.slice(0, lastColon) : id
    }
    // Guard: prevent the auto-close in secondary-drawer.ts's onTabUnregistered
    // handler from firing during the restore. The re-execution lifecycle can
    // spuriously unregister and re-register tabs (see secondary-drawer.ts
    // flag declaration for full rationale).
    setRestoringFromLayout(true)

    // One pass of restore work. Returns the number of tabs that still need
    // more work. The observer callback calls this; the timeout also calls
    // it to drain any remaining work. assignToSecondary is async; we
    // fire-and-forget it and let the next observer/timeout tick check
    // progress via isTabFullyRestored.
    const attemptRestore = (): number => {
      let remaining = 0
      for (let i = 0; i < layout.detachedTabs.length; i++) {
        const dt = layout.detachedTabs[i]
        const _alreadyAssigned = hasTabAssignment(dt.tabId)
        const _fullyRestored = _alreadyAssigned ? isTabFullyRestored(dt.tabId) : false
        if (_alreadyAssigned && _fullyRestored) continue
        remaining++
        // Try exact match first
        const tabs = getDrawerTabs()
        let tab = tabs.find(t => t.id === dt.tabId)
        let usedFallback = false
        if (!tab) {
          // Exact match missed — try stripped-suffix match
          const storedPrefix = stripSuffix(dt.tabId)
          const candidates = tabs.filter(t => stripSuffix(t.id) === storedPrefix)
          if (candidates.length === 1) {
            tab = candidates[0]
            usedFallback = true
            dlog(`applyLayout: suffix-drift fallback matched stored "${dt.tabId}" → live "${tab.id}"`)
            // Self-heal: rewrite the in-memory layout so the next persistLayout
            // call stores the live id.
            layout.detachedTabs[i] = { ...dt, tabId: tab.id }
          } else if (candidates.length > 1) {
            dwarn(`applyLayout: stripped-suffix match for "${dt.tabId}" is ambiguous (${candidates.length} candidates). Skipping.`)
          }
        }
        if (tab) {
          assignToSecondary(tab.id).catch((err) => {
            dwarn(`applyLayout: assignToSecondary(${tab.id}) failed:`, err)
          })
        } else {
          const mainBtn = findMainTabButton(dt.tabId)
          if (mainBtn) {
            const liveTabId = mainBtn.getAttribute('data-tab-id') || dt.tabId
            assignToSecondary(liveTabId).catch((err) => {
              dwarn(`applyLayout: LumiScript fallback assignToSecondary(${liveTabId}) failed:`, err)
            })
            dlog(`applyLayout: LumiScript fallback matched stored "${dt.tabId}" via main button → live "${liveTabId}"`)
          } else {
            const knownIds = tabs.map(t => t.id)
            dwarn(`applyLayout: stored detached tabId "${dt.tabId}" not found in store or DOM (and no suffix-drift match). Known ids: ${knownIds.join(', ')}. Layout may be stale.`)
          }
        }
      }
      return remaining
    }

    // End-of-restore block. Runs once when all tabs are restored OR the
    // safety timeout fires. Disconnects the observer, clears the timeout,
    // releases the restoring-from-layout guard, picks the active tab, and
    // re-applies the persisted open/closed state.
    const finishRestore = () => {
      if (_restoreObserver !== null) {
        _restoreObserver.disconnect()
        _restoreObserver = null
      }
      if (_restoreTimeoutHandle !== null) {
        clearTimeout(_restoreTimeoutHandle)
        _restoreTimeoutHandle = null
      }
      setRestoringFromLayout(false)
      // Prefer the persisted active secondary tab if it was saved and is
      // still assigned. Old layouts fall back to the first detached tab.
      const savedActive = layout.secondary?.activeTabId
      const restored = (savedActive && hasTabAssignment(savedActive))
        ? { tabId: savedActive }
        : layout.detachedTabs.find((dt: any) => hasTabAssignment(dt.tabId))
      if (restored) {
        showSecondaryTab(restored.tabId)
      }
      // Safety net for the case where applyLayout is called WITHOUT a
      // prior mountSecondarySidebar(layout) — re-apply open/closed state.
      // Mobile exclusion: don't reopen the secondary if the primary is
      // open on mobile.
      const mobileExcluded = isMobileViewport() && isMainDrawerOpen()
      const _hasDetachedTabs = (layout.detachedTabs?.length ?? 0) > 0
      const savedOpen = layout.secondary?.open
      const _shouldBeOpen = savedOpen !== undefined ? savedOpen === true : _hasDetachedTabs
      if (mobileExcluded && isSecondarySidebarOpen()) {
        enforceExclusionOnOpen('primary')
      } else if (_shouldBeOpen && !isSecondarySidebarOpen()) {
        openSecondarySidebar()
      } else if (!_shouldBeOpen && isSecondarySidebarOpen()) {
        closeSecondarySidebar()
      }
      if (_hasDetachedTabs) {
        updateDrawerTabVisibility()
      }
    }

    // Observe the main sidebar for childList + subtree — each new tab
    // button (extension registration) fires the observer and re-runs
    // the restore pass. End condition checked after each fire.
    const sidebar = document.querySelector('[data-spindle-mount="sidebar"]')
    if (sidebar) {
      _restoreObserver = new MutationObserver(() => {
        const remaining = attemptRestore()
        if (remaining === 0) finishRestore()
      })
      _restoreObserver.observe(sidebar, { childList: true, subtree: true })
    } else {
      // Sidebar not present yet (early layout application). Drain work
      // on a 100ms microtask + safety timeout so the observer doesn't
      // sit silent if the sidebar never appears.
      queueMicrotask(() => {
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
    if (initialRemaining === 0) finishRestore()
  }
}
