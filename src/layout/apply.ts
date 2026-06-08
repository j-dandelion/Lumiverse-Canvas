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
  hasTabAssignment, repositionTabToSecondary, setTabAssignment,
} from '../tabs/assignment'
import {
  addSecondaryTabButton, hideMainTabButton, showSecondaryTab, updateDrawerTabVisibility,
} from '../tabs/buttons'
import { dlog, dwarn } from '../debug/log'
import { isMobileViewport, enforceExclusionOnOpen } from '../sidebar/mobile-exclusion'

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
    const interval = setInterval(() => {
      attempts++
      const tabs = getDrawerTabs()
      for (let i = 0; i < layout.detachedTabs.length; i++) {
        const dt = layout.detachedTabs[i]
        if (hasTabAssignment(dt.tabId)) continue
        // Try exact match first
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
          repositionTabToSecondary(tab.id)
        } else if (!usedFallback) {
          // Once we've tried a few times and the id is still missing, surface
          // a visible warning. The first few attempts may simply be racing
          // the store's tab registration.
          if (attempts === 5) {
            const knownIds = tabs.map(t => t.id)
            dwarn(`applyLayout: stored detached tabId "${dt.tabId}" not found in store (and no suffix-drift match). Known ids: ${knownIds.join(', ')}. Layout may be stale.`)
          }
        }
      }
      if (attempts > 20 || layout.detachedTabs.every((dt: any) => hasTabAssignment(dt.tabId))) {
        clearInterval(interval)
        // Phase 4 (finding #2): if at least one tab was restored, pick the
        // first one as the active secondary tab. Without this, the
        // secondary panel header stays empty when the user opens the
        // drawer (showSecondaryTab was never called from the lightweight
        // restore path to avoid double-animating the active tab).
        // The first-tab pick is a reasonable default — the user can click
        // any tab button to switch. Future work: persist the active
        // secondary tab id in layout.json so we restore the exact one.
        const restored = layout.detachedTabs.find((dt: any) => hasTabAssignment(dt.tabId))
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
