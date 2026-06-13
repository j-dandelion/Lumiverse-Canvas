// Restore a saved layout snapshot to the DOM.
// Extracted from persist.ts — applyLayout restores drawer positions,
// widths, open/closed state, and tab assignments from the persisted blob.

import { getDrawerTabs, isMainDrawerOpen, getMainDrawerSide } from '../store'
import {
  getSecondaryWrapper, isSecondarySidebarOpen, SECONDARY_WIDTH_VAR,
  animateWrapper, getClosedTransformPx,
  openSecondarySidebar, closeSecondarySidebar,
  PUZZLE_ICON_SVG,
} from '../sidebar/secondary'
import {
  hasTabAssignment, repositionTab, setTabAssignment, switchDrawerToFallback,
} from '../tabs/assignment'
import {
  addSecondaryTabButton, hideMainTabButton, showSecondaryTab, updateDrawerTabVisibility, findMainTabButton,
} from '../tabs/buttons'
import { dlog, dwarn } from '../debug/log'
import { isMobileViewport, enforceExclusionOnOpen } from '../sidebar/mobile-exclusion'

// Polling interval for the suffix-drift fallback tab-restore loop. The
// producer is applyLayout below; cancelApplyLayoutInterval is exported so
// setup.ts can register it in the cleanup chain and stop the loop on
// extension disable (otherwise the interval would keep running on a
// torn-down store, logging warnings and reading stale tab data).
let _applyLayoutInterval: ReturnType<typeof setInterval> | null = null

export function cancelApplyLayoutInterval(): void {
  if (_applyLayoutInterval !== null) {
    clearInterval(_applyLayoutInterval)
    _applyLayoutInterval = null
  }
}

export function applyLayout(layout: any) {
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
    // Phase 3 (finding #5): polling loop now calls the lighter restore path
    // (set state + update buttons + DOM move) directly, NOT assignTab. This
    // avoids the policy-layer side effects: assignTab would call
    // switchMainDrawerToFallback (which manipulates the main drawer that's
    // already in its saved state) and persistLayout (we just LOADED this
    // layout, no need to write it back).
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
    let attempts = 0
    // Track tabs whose move is in flight (LumiScript fallback schedules
    // the move via setTimeout 80ms; the end-of-interval block must wait
    // for all in-flight moves to complete before running showSecondaryTab,
    // otherwise showSecondaryTab sees no moved roots and the header
    // doesn't update).
    const pendingMoves = new Set<string>()
    _applyLayoutInterval = setInterval(() => {
      attempts++
      for (let i = 0; i < layout.detachedTabs.length; i++) {
        const dt = layout.detachedTabs[i]
        if (hasTabAssignment(dt.tabId)) continue
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
            // call stores the live id. No additional save here — the rewrite
            // only takes effect when the user makes another change that
            // triggers persistLayout (open/close, move another tab, etc.).
            layout.detachedTabs[i] = { ...dt, tabId: tab.id }
          } else if (candidates.length > 1) {
            // Ambiguous — multiple live tabs share this stripped prefix.
            // This shouldn't happen in practice (the prefix includes the
            // extension uuid), but log defensively.
            dwarn(`applyLayout: stripped-suffix match for "${dt.tabId}" is ambiguous (${candidates.length} candidates). Skipping.`)
          }
        }
        if (tab) {
          // Lightweight restore: state + button affordances + DOM move.
          // No save (we just loaded). No open/close cascade (mount handled it).
          setTabAssignment(tab.id, 'secondary')
          hideMainTabButton(tab.id)
          addSecondaryTabButton(tab)
          updateDrawerTabVisibility()
          repositionTab(tab.id, 'secondary')
        } else {
          // LumiScript interference fallback: getDrawerTabs() returns only
          // the dock panel, so the store never has extension tabs. Find
          // the main sidebar button by data-tab-id or title (Canvas-owned
          // DOM observation, same pattern as the synthetic-descriptor
          // fallback in applyAssignment). If found, do the activate-then-move
          // dance so the tab's content is mounted in the main panel before
          // the move runs.
          const mainBtn = findMainTabButton(dt.tabId)
          if (mainBtn) {
            const liveTabId = mainBtn.getAttribute('data-tab-id') || dt.tabId
            const title = mainBtn.getAttribute('title') || ''
            const btnText = (mainBtn.textContent || '').trim()
            const shortName = btnText && btnText !== title ? btnText : ''
            const btnSvg = mainBtn.querySelector('svg')
            const iconSvg = btnSvg ? btnSvg.outerHTML : PUZZLE_ICON_SVG
            setTabAssignment(liveTabId, 'secondary')
            hideMainTabButton(liveTabId)
            addSecondaryTabButton({
              id: liveTabId,
              title,
              root: null as any,
              iconSvg,
              shortName,
            } as any)
            updateDrawerTabVisibility()
            // Activate the tab so its content mounts in the main panel.
            // After 80ms (React commit + mount), the setTimeout callback
            // runs repositionTab (DOM-walk fallback finds the content),
            // then switchDrawerToFallback (clears the main drawer's
            // drawerTab so it doesn't show the moved tab's header with
            // empty content), then showSecondaryTab (updates the
            // secondary's header and active state from the moved root).
            // All three must run after the move completes — running
            // showSecondaryTab before the move means movedRoots is
            // empty and the header doesn't update.
            mainBtn.click()
            pendingMoves.add(liveTabId)
            setTimeout(() => {
              repositionTab(liveTabId, 'secondary')
              switchDrawerToFallback('main', liveTabId, () => {
                showSecondaryTab(liveTabId)
              })
              pendingMoves.delete(liveTabId)
            }, 80)
            dlog(`applyLayout: LumiScript fallback matched stored "${dt.tabId}" via main button → live "${liveTabId}" title="${title}"`)
          } else if (!usedFallback && attempts === 5) {
            const knownIds = tabs.map(t => t.id)
            dwarn(`applyLayout: stored detached tabId "${dt.tabId}" not found in store or DOM (and no suffix-drift match). Known ids: ${knownIds.join(', ')}. Layout may be stale.`)
          }
        }
      }
      // End condition: either attempts exceeded, or every tab has an
      // assignment AND every in-flight move has completed. The pendingMoves
      // gate ensures showSecondaryTab runs only after the LumiScript
      // fallback's repositionTab has actually moved the content.
      if (attempts > 20 || (layout.detachedTabs.every((dt: any) => hasTabAssignment(dt.tabId)) && pendingMoves.size === 0)) {
        cancelApplyLayoutInterval()
        // Phase 4 (finding #2): if at least one tab was restored, pick the
        // first one as the active secondary tab. Without this, the
        // secondary panel header stays empty when the user opens the
        // drawer (showSecondaryTab was never called from the lightweight
        // restore path to avoid double-animating the active tab).
        // The first-tab pick is a reasonable default — the user can click
        // any tab button to switch. Future work: persist the active
        // secondary tab id in layout.json so we restore the exact one.
        // Prefer the persisted active secondary tab if it was saved and is
        // still assigned. Old layouts (saved before activeTabId was
        // persisted) fall back to the first detached tab.
        const savedActive = layout.secondary?.activeTabId
        const restored = (savedActive && hasTabAssignment(savedActive))
          ? { tabId: savedActive }
          : layout.detachedTabs.find((dt: any) => hasTabAssignment(dt.tabId))
        if (restored) {
          showSecondaryTab(restored.tabId)
        }
        // Phase 3 (finding #5): the end-of-interval open/close block is gone.
        // The drawer's open/closed state was set at mount time via the
        // initialOpen option on createSecondarySidebar, so by the time we get
        // here the wrapper is already in the correct position. This is the
        // "fully open from the first paint" requirement.
        //
        // Safety net kept for the case where applyLayout is called WITHOUT a
        // prior mountSecondarySidebar(layout) — e.g. a future "reload layout"
        // debug action that re-applies after a session tweak.
        // Mobile exclusion: on mobile, don't reopen the secondary if the
        // primary is open — enforceExclusionOnOpen may have closed it
        // during mount. Without this guard, the polling loop fights the
        // exclusion logic and creates an open/close toggle every 500ms.
        const mobileExcluded = isMobileViewport() && isMainDrawerOpen()
        if (mobileExcluded && isSecondarySidebarOpen()) {
          // On mobile with primary open, close secondary silently (skip
          // persistOpenState so the desktop-saved state survives).
          enforceExclusionOnOpen('primary')
        } else if (layout.secondary?.open === true && !isSecondarySidebarOpen()) {
          openSecondarySidebar()
        } else if (layout.secondary?.open === false && isSecondarySidebarOpen()) {
          closeSecondarySidebar()
        }
      }
    }, 500)
  }
}
