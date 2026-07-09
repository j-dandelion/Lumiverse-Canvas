// Secondary sidebar — the mirror of Lumiverse's main drawer, anchored to
// the opposite edge. Hosts the moved extension tab roots + their
// per-tab buttons.
//
// Animation: a single `translateX` on the wrapper; both the drawerTab
// and the drawer are children, so they move as one unit. The wrapper
// animates with requestAnimationFrame + easeOutCubic (350ms); no CSS
// transitions, no counter-translate.
//
// Direction-aware: when the main drawer is on the LEFT, the secondary
// is anchored at `right: 0` (close transform is +width). When the main
// is on the RIGHT, the secondary is anchored at `left: 0` (close
// transform is -width). getClosedTransformPx() centralizes this.
import { getMainSidebar, getMainPanelContent } from '../dom/lumiverse'
import { getHostBridge } from '../dom/host-bridge'
import { getDrawerTabs, getMainDrawerSide } from '../store'
import { updateChatReflow } from '../chat/reflow'
// NOTE: drawer-sync.ts imports from this module (bidirectional). Both modules
// only call each other from inside function bodies — never at module init time.
// Keep it that way to avoid initialization races.
import { syncDrawerTabSettings } from './drawer-sync'
import { mountResizeHandles } from '../resize/handles'
import { isTabActiveInMainDrawer, clearTabAssignments, getTabAssignments } from '../tabs/assignment'
import { showMainTabButton, findSafeFallbackButton, updateDrawerTabVisibility } from '../tabs/buttons'
import { persistOpenState } from '../layout/persist'
import { isMobileViewport, enforceExclusionOnOpen, setMobileOpenClass } from './mobile-exclusion'
import { animateWrapper } from './animation'
import { SECONDARY_WIDTH_VAR } from './styles'
import {
  applyTabListPin,
  applyTabListPosition,
  getPinnedTabList,
  reconcileTabListPin,
} from './tab-position'
import { getSettings } from '../settings/state'
import { dwarn } from '../debug/log'
import { syncPanelHeaderFromMain as _syncPanelHeaderImpl, stopPanelHeaderObservers as _stopPanelHeaderObservers, resetPanelHeaderSyncCache } from './panel-header-sync'
import { setSuppressAutoActivation } from './secondary-drawer'
import {
  closedTransformPx,
  createDrawerShell,
  readWidthCssVar,
} from './drawer-shell'

// Re-export for backward compatibility — the test file imports these
// from secondary.tsx.
export { _stopPanelHeaderObservers as stopPanelHeaderObservers }

/**
 * Wrapper that passes the secondary wrapper accessor to the panel-header
 * sync module. Preserves the public API so callers don't need to change.
 */
export function syncPanelHeaderFromMain(): void {
  _syncPanelHeaderImpl(() => _secondaryWrapper)
}

// Re-export for backward compatibility
export { SECONDARY_WIDTH_VAR, injectDrawerTabStyles } from './styles'
export { animateWrapper } from './animation'

// Standalone Puzzle icon SVG (lucide-react fallback for extensions without icons)
export const PUZZLE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"/></svg>`

let _secondarySidebarOpen = false
let _secondaryWrapper: HTMLElement | null = null
let _secondaryDrawer: HTMLElement | null = null

// Cross-drawer panel-header sync state. Mirrors the same coalescing/cache
// pattern used in sidebar/drawer-sync.ts for the main drawer's tab button.
// The main drawer's panel header is owned by Lumiverse (its class is
// hashed in production builds, e.g. "_panelHeader_abc123") — we read its
// rendered height, padding, title font-size, border, and background, and
// expose them as CSS variables on the secondary wrapper. The secondary
// header's inline `style.cssText` references these variables, falling
// back to the 48px / 12px / 15px defaults when the main header is not
// yet mounted.

// Accessors used by other modules (resize/handles, sidebar/drawer-sync,
// tabs/buttons, context-menu, layout/persist). All read; setSecondarySidebarOpen
// and unmountSecondarySidebar mutate.
export function getSecondaryWrapper(): HTMLElement | null { return _secondaryWrapper }
export function getSecondaryDrawer(): HTMLElement | null {
  return _secondaryWrapper?.querySelector('.sidebar-ux-drawer') as HTMLElement | null
}

export function getSecondaryTabList(): HTMLElement | null {
  if (!_secondaryWrapper) return null
  // 1) In-wrapper list wins when present — covers unpinned layout and the
  //    remount window where a fresh empty list sits in the drawer while an
  //    orphan may still linger on the pin host (pin will reparent + drop
  //    orphans).
  const inWrapper = _secondaryWrapper.querySelector('.sidebar-ux-tab-list') as HTMLElement | null
  if (inWrapper) return inWrapper
  // 2) Module-owned pin list (not document.querySelector first-match, which
  //    returns a stale orphan when dual lists exist under the host).
  return getPinnedTabList()
}

export function getSecondaryPanel(): HTMLElement | null {
  return _secondaryWrapper?.querySelector('.sidebar-ux-panel') as HTMLElement | null
}

/** Test-only: set the cached secondary wrapper so getters can return non-null in unit tests. */
export function __setSecondaryWrapperForTest(wrapper: HTMLElement | null): void {
  _secondaryWrapper = wrapper
}

export function isSecondarySidebarOpen(): boolean { return _secondarySidebarOpen }
export function setSecondarySidebarOpen(open: boolean): void { _secondarySidebarOpen = open }
// Consolidates the "remove + null + open=false" pattern used by
// tearDownSecondarySidebar, checkSideChanged, and cleanupAll.
export function unmountSecondarySidebar(): void {
  // Unpin first so a reparented tab list is restored (or cleaned) before
  // the wrapper is removed — otherwise the pin host keeps an orphan strip.
  applyTabListPin(false, { force: true })
  if (_secondaryWrapper) {
    _secondaryWrapper.remove()
    _secondaryWrapper = null
  }
  _secondarySidebarOpen = false
  // Drop the panel-header observers so a future remount rebuilds them
  // (the underlying main-drawer header may have been replaced too).
  // Safe to call when the observers were never attached.
  _stopPanelHeaderObservers()
  // Invalidate the value cache so the next remount does a real read
  // instead of skipping based on a stale serialized key.
  resetPanelHeaderSyncCache()
}

export function createSecondarySidebar(options?: { initialWidth?: number; initialOpen?: boolean }): HTMLElement {
  // Secondary anchors opposite the main drawer.
  const side = getMainDrawerSide() === 'left' ? 'right' : 'left'
  const onMobile = isMobileViewport()

  const shell = createDrawerShell({
    owner: 'secondary',
    side,
    widthCssVar: SECONDARY_WIDTH_VAR,
    defaultWidth: 420,
    initialWidth: options?.initialWidth,
    initialOpen: options?.initialOpen === true,
    fullViewportWidth: onMobile,
    title: 'Second drawer',
    drawerTabDisplay: 'none',
    onDrawerTabClick: () => {
      if (_secondarySidebarOpen) closeSecondarySidebar()
      else openSecondarySidebar()
    },
    onHeaderClose: () => closeSecondarySidebar(),
  })

  // Register the secondary drawer content area with Spindle so built-in
  // tabs can use requestTabLocation to move into this container.
  // System-level registration — not gated by extension permissions.
  try {
    const wSpindle = getHostBridge()
    const wContainers = wSpindle?.containers

    if (wContainers?.registerContainer) {
      wContainers.registerContainer({
        id: 'canvas-secondary-drawer',
        side,
        element: shell.content,
      })
    } else {
      dwarn(
        `[tabmove] createSecondarySidebar: registerContainer SKIPPED — ` +
        `window.spindle.containers.registerContainer not available. ` +
        `Built-in tab moves will silently fail (ContainerTabContent Pass 3 resets to main-drawer).`
      )
    }
  } catch (err) {
    dwarn(`[tabmove] createSecondarySidebar: registerContainer THREW:`, err)
  }

  _secondaryDrawer = shell.drawer
  return shell.wrapper
}

export function openSecondarySidebar() {
  if (!_secondaryWrapper || !_secondaryDrawer) return
  if (_secondarySidebarOpen) return
  // On mobile, close the other sidebar first
  enforceExclusionOnOpen('secondary')
  // Animate wrapper to translateX(0) — both drawerTab and drawer slide in as one unit
  animateWrapper(_secondaryWrapper!, 0)
  _secondarySidebarOpen = true
  syncDrawerTabSettings()
  updateDrawerTabVisibility()
  // Re-sync the panel header in case the main header changed since the
  // secondary was last open (e.g. user toggled compact mode in Lumiverse
  // settings while the secondary was closed). The ResizeObserver attached
  // by syncPanelHeaderFromMain also catches this, but observers don't
  // fire while the main panel is hidden via display:none, so an explicit
  // call here guarantees the secondary matches on the very next open.
  syncPanelHeaderFromMain()
  updateChatReflow()
  // Re-attach any moved tab roots to the (possibly fresh) wrapper.
  // assignToSecondary is idempotent — for a tab already in the wrapper
  // it hits the early-guard and just refreshes button + active state.
  // Suppress auto-activation during the re-assignment loop so that if
  // the user clicked a tab button to open the drawer, their clicked
  // tab stays highlighted instead of being overwritten by the last
  // tab in the loop.
  import('../sidebar/secondary-drawer').then(({ assignToSecondary }) => {
    setSuppressAutoActivation(true)
    const promises = Array.from(getTabAssignments())
      .filter(([, side]) => side === 'secondary')
      .map(([tabId]) => assignToSecondary(tabId).catch(() => {}))
    Promise.all(promises).finally(() => setSuppressAutoActivation(false))
  })
  persistOpenState()
  setMobileOpenClass('secondary', true)
}

export function closeSecondarySidebar(options?: { silent?: boolean }): void {
  if (!_secondaryWrapper || !_secondaryDrawer) return
  // Animate wrapper back to its closed transform — direction-aware via
  // getClosedTransformPx: secondary on the right closes at +width, on the
  // left at -width.
  animateWrapper(_secondaryWrapper!, getClosedTransformPx())
  _secondarySidebarOpen = false
  syncDrawerTabSettings()
  updateDrawerTabVisibility()
  // Mirror the open-path sync: in case the main header changed while the
  // drawer is mid-close animation, the variables stay current. Cheap
  // (rAF-coalesced + cache-key skip), so calling on every close is fine.
  syncPanelHeaderFromMain()
  updateChatReflow()

  for (const [tabId, sidebar] of getTabAssignments()) {
    if (sidebar === 'secondary') {
      const tabs = getDrawerTabs()
      const tab = tabs.find(t => t.id === tabId)
      if (tab?.root) tab.root.removeAttribute('data-canvas-active')
    }
  }

  // Clear the active highlight from all tab buttons so no tab appears
  // selected while the drawer is closed.
  const tabList = getSecondaryTabList()
  if (tabList) {
    for (const btn of tabList.querySelectorAll('button.sidebar-ux-tab-active')) {
      btn.classList.remove('sidebar-ux-tab-active')
    }
  }

  if (!options?.silent) {
    persistOpenState()
  }
  setMobileOpenClass('secondary', false)
}

/**
 * Return the wrapper's `translateX` value (in px) that fully hides the
 * secondary sidebar, accounting for which edge it's anchored to.
 *
 * The secondary wrapper is anchored to one edge of the viewport (the edge
 * opposite the main drawer). Closing the sidebar slides the wrapper off
 * its anchor edge so only the drawerTab remains visible. The sign of the
 * translation depends on which edge the wrapper is anchored to:
 *   - main on the LEFT, secondary on the RIGHT (anchored at `right: 0`)
 *     → close transform is +width (pushes wrapper right, off the right edge)
 *   - main on the RIGHT, secondary on the LEFT (anchored at `left: 0`)
 *     → close transform is -width (pushes wrapper left, off the left edge)
 *
 * Centralizing this in one helper avoids the sign-inversion bug that
 * recurred when the close transform was hardcoded at multiple call sites
 * (the open-source repo was developed with the main on the left, so
 * `+width` worked by accident for the dev case but flipped the wrong way
 * when the user moved the main to the right).
 */
export function getClosedTransformPx(): number {
  // Secondary is opposite the main drawer. Map main side → secondary
  // anchor side, then use the shared closed-transform helper.
  const secondarySide: 'left' | 'right' =
    getMainDrawerSide() === 'left' ? 'right' : 'left'
  const w = Math.ceil(readWidthCssVar(SECONDARY_WIDTH_VAR, 420))
  return closedTransformPx(secondarySide, w)
}

export function mountSecondarySidebar(options?: { initialWidth?: number; initialOpen?: boolean }) {
  if (_secondaryWrapper) return
  _secondaryWrapper = createSecondarySidebar(options)
  document.body.appendChild(_secondaryWrapper)
  applyTabListPosition(getSettings().moveControlsToOuterEdge, {
    drawer: _secondaryWrapper.querySelector('.sidebar-ux-drawer') as HTMLElement,
    tabList: _secondaryWrapper.querySelector('.sidebar-ux-tab-list') as HTMLElement,
    handle: _secondaryWrapper.querySelector('.sidebar-ux-resize-handle') as HTMLElement | null,
  })
  // Re-apply pin after construction/remount. Setting can stay true across a
  // side-change remount while the fresh DOM is unpinned.
  reconcileTabListPin()
  // Phase 3: sync the in-flight state to the initial layout so a hard-refresh
  // with secondary open doesn't trip the "no transition needed" check inside
  // openSecondarySidebar() on the first user click.
  if (options?.initialOpen === true) {
    _secondarySidebarOpen = true
  }
  syncDrawerTabSettings()
  // Initial panel-header sync: covers first mount and the side-flip
  // remount path in checkSideChanged. The ResizeObserver attached inside
  // syncPanelHeaderFromMain keeps the values current after this.
  syncPanelHeaderFromMain()
  // Mount the resize handles. The main handle is short-circuited by its
  // own querySelector check inside mountResizeHandles, so this is safe to
  // call from both the initial setup path (which already calls it once via
  // setup()) and from checkSideChanged()'s wrapper-remount path. Without
  // this, the secondary handle disappears for the rest of the session
  // whenever the wrapper is recreated (e.g. after a drawer-side flip).
  mountResizeHandles()
}

/**
 * Tear down the secondary sidebar wrapper, restoring every assigned tab to
 * the primary drawer first so we don't leak DOM nodes. Used by the master
 * toggle's "off" path. Does NOT touch the layout blob — that's a separate
 * decision (the user may flip the master back on and want the layout back).
 */
export function tearDownSecondarySidebar(): void {
  // Unpin first (same as unmountSecondarySidebar). While pinned the tab
  // list lives on a body-level host outside the wrapper — removing the
  // wrapper without unpin leaves an orphan strip that poisons remount
  // (dual lists; highlight / restore write to the wrong one).
  applyTabListPin(false, { force: true })

  if (_secondaryWrapper) {
    // If the main drawer is currently showing a tab that lives in the
    // secondary sidebar, switch to a built-in fallback first. Otherwise
    // the DOM node that was physically in the secondary sidebar won't
    // re-render React (it was never unmounted from the main drawer's
    // perspective).
    // Use findSafeFallbackButton so we never click the Lumiverse Settings
    // tab (which would open the Settings panel and leave a ghost panel
    // behind — same root cause as the move-to-secondary bug fixed in
    // tabs/assignment.ts).
    const sidebar = getMainSidebar()
    if (sidebar) {
      const fallbackBtn = findSafeFallbackButton(sidebar)
      if (fallbackBtn) {
        // Check if any secondary tab is currently active in the main drawer.
        for (const [tabId, side] of getTabAssignments()) {
          if (side === 'secondary' && isTabActiveInMainDrawer(tabId)) {
            fallbackBtn.click()
            break
          }
        }
      }
    }
    // Restore all secondary tabs to primary — just reposition the DOM
    // nodes back, don't activate them (the fallback above handles that).
    //
    // Bug fix (2026-06-19): for built-in tabs, also call
    // requestTabLocation({kind:'main-drawer'}) BEFORE removing the
    // secondary wrapper. Without this, Lumiverse's internal
    // `tabLocations` store still says the tab is in the
    // 'canvas-secondary-drawer' container. When the wrapper is removed,
    // the container is gone. When the user clicks the tab button,
    // ContainerTabContent checks tabLocations, sees the missing
    // container, and fails to render the content — the "tabs return to
    // main drawer but do not display their content when activated"
    // symptom reported on Canvas disable. Extension tabs are not
    // tracked in tabLocations (they use raw DOM reparenting), so they
    // don't need this call.
    const _wSpindleUi = getHostBridge()?.ui
    const _mainPanelContent = getMainPanelContent()
    for (const [tabId] of Array.from(getTabAssignments())) {
      // Built-in detection: the host bridge can lazy-resolve a root for
      // built-in tab IDs. Extension tab IDs return undefined.
      const _isBuiltIn = _wSpindleUi?.getBuiltInTabRoot?.(tabId) != null
      if (_isBuiltIn && _wSpindleUi?.requestTabLocation) {
        try {
          _wSpindleUi.requestTabLocation(tabId, { kind: 'main-drawer' })
        } catch (err) {
          dwarn(`[tabmove] teardown: requestTabLocation failed for tabId=${tabId}:`, err)
        }
      }
      // Move any moved root back to the main panel. Clear data-canvas-moved,
      // data-canvas-active, and any inline position/inset/display styles
      // left over from the tab's time in secondary.
      //
      // Skip this for built-in tabs: requestTabLocation (called above)
      // handles moving built-in roots back to the main drawer via
      // Lumiverse's React reconciliation. The DOM fallback below would
      // run BEFORE that async reconciliation completes, moving the root
      // to main prematurely. When React then fires, it moves the root
      // again from secondary to main, creating a duplicate visible root
      // (the "tabs stack instead of swapping" bug).
      if (!_isBuiltIn) {
        const _movedRoot = _secondaryWrapper?.querySelector(
          `.sidebar-ux-panel-content [data-canvas-moved="${CSS.escape(tabId)}"]:not([data-canvas-secondary])`
        ) as HTMLElement | null
        if (_movedRoot && _mainPanelContent && _movedRoot.parentElement !== _mainPanelContent) {
          _mainPanelContent.appendChild(_movedRoot)
        }
        if (_movedRoot) {
          _movedRoot.removeAttribute('data-canvas-moved')
          _movedRoot.removeAttribute('data-canvas-active')
          _movedRoot.style.removeProperty('position')
          _movedRoot.style.removeProperty('inset')
          _movedRoot.style.removeProperty('display')
        }
      }
      showMainTabButton(tabId)
    }
    clearTabAssignments()
    // Unregister the container from the host bridge so re-enabling
    // (mount → registerContainer) doesn't conflict with a stale entry.
    try {
      const wContainers = getHostBridge()?.containers
      wContainers?.unregisterContainer?.('canvas-secondary-drawer')
    } catch (err) {
      dwarn('[tabmove] teardown: unregisterContainer failed:', err)
    }
    _secondaryWrapper.remove()
    _secondaryWrapper = null
  }
  _secondarySidebarOpen = false
  setMobileOpenClass('secondary', false)
  // Clear stale chat margins left by the now-removed secondary drawer.
  updateChatReflow()
  // Drop any in-flight resize handle bound to the wrapper, so a re-mount
  // creates a fresh one.
  const handles = document.querySelectorAll('.sidebar-ux-resize-handle')
  for (const h of Array.from(handles)) {
    if (h.parentElement && h.parentElement.classList.contains('sidebar-ux-drawer')) {
      h.remove()
    }
  }
  // Disconnect the panel-header observers (tearDownSecondarySidebar is
  // used by the master "second drawer" toggle's off path; the observers
  // would otherwise leak across the on→off→on cycle).
  _stopPanelHeaderObservers()
  resetPanelHeaderSyncCache()
}

