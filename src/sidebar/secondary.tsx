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
import { getMainSidebar, getMainPanelHeader } from '../dom/lumiverse'
import { clampSidebarWidth } from '../dom/clamp'
import { getDrawerTabs, getMainDrawerSide } from '../store'
import { updateChatReflow } from '../chat/reflow'
import { syncDrawerTabSettings } from './drawer-sync'
import { mountResizeHandles } from '../resize/handles'
import { repositionAssignedTabs, repositionTab, isTabActiveInMainDrawer, clearTabAssignments, getTabAssignments } from '../tabs/assignment'
import { showMainTabButton, findSafeFallbackButton } from '../tabs/buttons'
import { persistOpenState } from '../layout/persist'
import { injectStyles } from '../debug/styles'
import { isMobileViewport, enforceExclusionOnOpen, setMobileOpenClass } from './mobile-exclusion'
import { animateWrapper } from './animation'
import { SECONDARY_WIDTH_VAR, injectDrawerTabStyles } from './styles'
import { applyTabListPosition } from './tab-position'
import { getSettings } from '../settings/state'
import { dlog, dwarn } from '../debug/log'
import { registerCleanup } from './cleanup'

// Re-export for backward compatibility
export { SECONDARY_WIDTH_VAR, injectDrawerTabStyles }
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
let _mainPanelHeaderResizeObserver: ResizeObserver | null = null
let _mainPanelHeaderAttrObserver: MutationObserver | null = null
let _syncPanelHeaderPending = false
let _lastWrittenHeaderVars: string | null = null

// Accessors used by other modules (resize/handles, sidebar/drawer-sync,
// tabs/buttons, context-menu, layout/persist). All read; setSecondarySidebarOpen
// and unmountSecondarySidebar mutate.
export function getSecondaryWrapper(): HTMLElement | null { return _secondaryWrapper }
export function getSecondaryDrawer(): HTMLElement | null {
  return _secondaryWrapper?.querySelector('.sidebar-ux-drawer') as HTMLElement | null
}

export function getSecondaryTabList(): HTMLElement | null {
  return _secondaryWrapper?.querySelector('.sidebar-ux-tab-list') as HTMLElement | null
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
  if (_secondaryWrapper) {
    _secondaryWrapper.remove()
    _secondaryWrapper = null
  }
  _secondarySidebarOpen = false
  // Drop the panel-header observers so a future remount rebuilds them
  // (the underlying main-drawer header may have been replaced too).
  // Safe to call when the observers were never attached.
  stopPanelHeaderObservers()
  // Invalidate the value cache so the next remount does a real read
  // instead of skipping based on a stale serialized key.
  _lastWrittenHeaderVars = null
}

export function createSecondarySidebar(options?: { initialWidth?: number; initialOpen?: boolean }): HTMLElement {
  const side = getMainDrawerSide() === 'left' ? 'right' : 'left'

  // Wrapper: mirrors main sidebar .wrapper exactly
  // The WRAPPER translates — drawerTab and drawer are both children, moving as one unit.
  const wrapper = document.createElement('div')
  // Side class enables mobile CSS to align the tab list to the correct edge
  wrapper.className = `sidebar-ux-secondary-wrapper sidebar-ux-side-${side}`
  // Phase 3 (finding #13): prefer the layout-supplied width on first mount so the
  // initial paint matches the saved state — no 420px fallback flash.
  const cssVarWidth = parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR))
  const rawWidth = options?.initialWidth && options.initialWidth > 0
    ? options.initialWidth
    : (isFinite(cssVarWidth) ? cssVarWidth : 420)
  // On mobile, the drawer is 100vw and the close transform must match.
  // Use the viewport width directly — clamping a desktop-saved width to
  // 80% of a mobile viewport would leave a visible peek. The desktop
  // branch uses the shared clamp helper (PR-C) so resize handles,
  // applyLayout, and createSecondarySidebar all share the same bounds.
  const onMobile = isMobileViewport()
  const initWidth = onMobile
    ? window.innerWidth
    : Math.ceil(clampSidebarWidth(rawWidth))
  // Set the CSS var to match the drawer's actual width so
  // getClosedTransformPx() stays in sync.
  document.documentElement.style.setProperty(SECONDARY_WIDTH_VAR, `${initWidth}px`)
  // Phase 3: if the saved layout says open, translate to 0 so the drawer is
  // visible from the very first frame. Otherwise stay off-screen. The
  // closed transform's sign is direction-aware (see getClosedTransformPx):
  // +width when the secondary is anchored on the right (main on left), and
  // -width when anchored on the left (main on right).
  const initialOpen = options?.initialOpen === true
  const initWrapperTransform = initialOpen
    ? 'translateX(0)'
    : `translateX(${
        getMainDrawerSide() === 'right' ? -initWidth : initWidth
      }px)`
  wrapper.style.cssText = `
    position: fixed;
    top: env(safe-area-inset-top, 0px); bottom: env(safe-area-inset-bottom, 0px);
    z-index: 9990;
    display: flex;
    align-items: stretch;
    pointer-events: none;
    transform: ${initWrapperTransform};
    ${side === 'left'
      ? `left: 0; flex-direction: row-reverse;`
      : `right: 0; flex-direction: row;`};
  `

  // Inject CSS rules for drawer tab (default, hover, active, compact states)
  injectDrawerTabStyles()

  // Drawer tab — flex child of wrapper, NOT position: fixed.
  // When the wrapper translates, the drawerTab moves with it as a unit.
  // Visual state managed via CSS classes (sidebar-ux-drawer-tab--active, --compact).
  // Only layout properties (width, padding, gap, marginTop) use inline styles.
  const drawerTab = document.createElement('button')
  drawerTab.className = 'sidebar-ux-drawer-tab'
  drawerTab.style.cssText = `
    display: none;
    border-${side === 'left' ? 'left' : 'right'}: none;
    border-radius: ${side === 'left' ? '0 12px 12px 0' : '12px 0 0 12px'};
  `
  const iconWrapper = document.createElement('div')
  iconWrapper.className = 'sidebar-ux-drawer-tab-icon'
  iconWrapper.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>`
  drawerTab.appendChild(iconWrapper)
  drawerTab.addEventListener('click', () => {
    if (_secondarySidebarOpen) closeSecondarySidebar()
    else openSecondarySidebar()
  })

  // Drawer (contains tab strip + panel, mirrors main sidebar .drawer)
  const drawer = document.createElement('div')
  drawer.className = 'sidebar-ux-drawer'
  // No initial transform — the wrapper handles all positioning via translateX.
  // `position: relative` makes the drawer a positioning context so the
  // resize handle (inserted by mountResizeHandles) offsets from the
  // drawer itself rather than from the wrapper. Without this, the handle's
  // position is computed relative to the wrapper's full translated width,
  // which corrupts the position when the drawerTab sibling's visibility
  // changes (e.g. when no tabs are assigned). The wrapper is at 100%
  // viewport height via top:0/bottom:0; the drawer's height is 100% of
  // that.
  drawer.style.cssText = `
    width: ${isMobileViewport() ? '100vw' : `var(${SECONDARY_WIDTH_VAR}, 420px)`};
    height: 100%;
    position: relative;
    display: flex;
    background: var(--lumiverse-bg-deep);
    box-shadow: var(--lumiverse-shadow-xl);
    pointer-events: auto;
    /* overflow intentionally not set (defaults to visible) so the resize
       handle's 4px overhang on the inner edge isn't clipped. Children
       (sidebar, panel, content) handle their own overflow containment. */
    isolation: isolate;
    flex-direction: ${side === 'right' ? 'row' : 'row-reverse'};
  `

  // Sidebar (tab list, matches main sidebar .sidebar exactly)
  const sidebar = document.createElement('div')
  sidebar.className = 'sidebar-ux-tab-list'
  sidebar.style.cssText = `
    width: 56px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    padding: 6px 0;
    gap: 4px;
    overflow-y: auto;
    scrollbar-width: none;
    border-${side === 'right' ? 'right' : 'left'}: 1px solid var(--lumiverse-primary-020);
    background: color-mix(in srgb, var(--lumiverse-primary) 6%, var(--lumiverse-bg-deep));
  `

  // Panel (content area, mirrors main sidebar .panel)
  const panel = document.createElement('div')
  panel.className = 'sidebar-ux-panel'
  panel.style.cssText = `
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  `

  // Panel header (matches the main drawer's .panelHeader).
  // Height/padding/border/background are driven by CSS variables set by
  // syncPanelHeaderFromMain() below. The fallbacks in each var(..., ...)
  // keep the original hardcoded values for the case where the main
  // header is not yet mounted (cold start, host rebuild) — see
  // syncPanelHeaderFromMain for the "keep 48px fallback" contract.
  const header = document.createElement('div')
  header.className = 'sidebar-ux-panel-header'
  header.style.cssText = `
    min-height: var(--sidebar-ux-panel-header-h, 48px);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sidebar-ux-panel-header-pt, 12px) 16px var(--sidebar-ux-panel-header-pb, 12px);
    border-bottom: var(--sidebar-ux-panel-header-border-bottom, 1px solid var(--lumiverse-primary-015));
    background: var(--sidebar-ux-panel-header-bg, var(--lumiverse-primary-008, rgba(255, 255, 255, 0.02)));
    flex-shrink: 0;
  `

  const title = document.createElement('h2')
  title.className = 'sidebar-ux-panel-title'
  title.style.cssText = `
    margin: 0;
    font-size: var(--sidebar-ux-panel-header-font-size, calc(15px * var(--lumiverse-font-scale, 1)));
    font-weight: 600;
    color: var(--lumiverse-text);
  `
  title.textContent = 'Second drawer'

  const closeBtn = document.createElement('button')
  closeBtn.className = 'sidebar-ux-close-btn'
  closeBtn.style.cssText = `
    background: none;
    border: none;
    color: var(--lumiverse-text-dim);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  `
  closeBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>`
  closeBtn.addEventListener('click', () => closeSecondarySidebar())

  header.appendChild(title)
  header.appendChild(closeBtn)

  // Panel content (where extension tab roots are appended)
  const content = document.createElement('div')
  content.className = 'sidebar-ux-panel-content'
  // Position moved tab roots absolutely so they overlap. With
  // position: relative on this container, position: absolute on
  // children anchors them to this content area instead of the body.
  // Inactive tabs get display: none in showSecondaryTab, which fully
  // removes them from the layout — preventing the "active tab below
  // the fold" symptom where the second tab in a stack is invisible
  // without scrolling.
  content.style.cssText = `
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior-y: contain;
    --sidebar-ux-content-pt: 12px;
    --sidebar-ux-content-pr: 12px;
    --sidebar-ux-content-pb: 40px;
    --sidebar-ux-content-pl: 12px;
    padding: var(--sidebar-ux-content-pt) var(--sidebar-ux-content-pr) var(--sidebar-ux-content-pb) var(--sidebar-ux-content-pl);
    position: relative;
  `

  panel.appendChild(header)
  panel.appendChild(content)
  drawer.appendChild(sidebar)
  drawer.appendChild(panel)
  wrapper.appendChild(drawerTab)
  wrapper.appendChild(drawer)

  // Register the secondary drawer content area with Spindle so built-in
  // tabs can use requestTabLocation to move into this container.
  // System-level registration — not gated by extension permissions.
  try {
    const wSpindle = (window as any).spindle
    const wContainers = wSpindle?.containers
    dlog(
      `[tabmove] createSecondarySidebar: registerContainer probe: ` +
      `window.spindle=${wSpindle ? 'present' : 'UNDEFINED'}, ` +
      `window.spindle.containers=${wContainers ? 'present' : 'UNDEFINED'}, ` +
      `has_registerContainer=${typeof wContainers?.registerContainer}, ` +
      `target_element=${content ? 'present' : 'absent'} (className="${content?.className}")`
    )
    if (wContainers?.registerContainer) {
      wContainers.registerContainer({
        id: 'canvas-secondary-drawer',
        side,
        element: content,
      })
      dlog(`[tabmove] createSecondarySidebar: registerContainer CALLED id=canvas-secondary-drawer side=${side}`)
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

  _secondaryDrawer = drawer
  return wrapper
}

// Collect all ancestor elements that need overflow: visible override.
// DELETED 2026-06-09 — the per-element overflow-override machinery
// (_savedOverflow, enableOverflowVisible, restoreOverflow) was never wired
// to a caller. enableOverflowVisible has zero call sites in the entire
// repo history; restoreOverflow's call site in tabs/assignment.ts:400
// short-circuits on the `if (!saved) return` guard because the map is
// always empty. The "PR-B fix" comment described a real bug in code that
// was never reachable. If the original intent (allowing tab roots to
// overflow their ancestor's hidden overflow container) is ever revived,
// the wiring should start from a fresh design rather than resurrecting
// this dead machinery.

export function openSecondarySidebar() {
  if (!_secondaryWrapper || !_secondaryDrawer) return
  if (_secondarySidebarOpen) return
  dlog(`[reflow-trace] openSecondarySidebar called from: ${(new Error().stack || '').split('\n').slice(1, 4).join(' | ')}`)
  // On mobile, close the other sidebar first
  enforceExclusionOnOpen('secondary')
  // Animate wrapper to translateX(0) — both drawerTab and drawer slide in as one unit
  animateWrapper(_secondaryWrapper!, 0)
  _secondarySidebarOpen = true
  syncDrawerTabSettings()
  // Re-sync the panel header in case the main header changed since the
  // secondary was last open (e.g. user toggled compact mode in Lumiverse
  // settings while the secondary was closed). The ResizeObserver attached
  // by syncPanelHeaderFromMain also catches this, but observers don't
  // fire while the main panel is hidden via display:none, so an explicit
  // call here guarantees the secondary matches on the very next open.
  syncPanelHeaderFromMain()
  updateChatReflow()
  repositionAssignedTabs()
  persistOpenState()
  setMobileOpenClass('secondary', true)
}

export function closeSecondarySidebar(options?: { silent?: boolean }): void {
  if (!_secondaryWrapper || !_secondaryDrawer) return
  dlog(`[reflow-trace] closeSecondarySidebar called from: ${(new Error().stack || '').split('\n').slice(1, 4).join(' | ')}`)
  // Animate wrapper back to its closed transform — direction-aware via
  // getClosedTransformPx: secondary on the right closes at +width, on the
  // left at -width.
  animateWrapper(_secondaryWrapper!, getClosedTransformPx())
  _secondarySidebarOpen = false
  syncDrawerTabSettings()
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
  const w = Math.ceil(
    parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)) || 420
  )
  // `getMainDrawerSide()` returns the MAIN drawer's side. The secondary
  // lives on the opposite side. When the main is on the LEFT, the
  // secondary is on the RIGHT (anchored at `right: 0`) → close transform
  // is +w (pushes wrapper right, off the right edge). When the main is
  // on the RIGHT, the secondary is on the LEFT (anchored at `left: 0`)
  // → close transform is -w (pushes wrapper left, off the left edge).
  return getMainDrawerSide() === 'right' ? -w : w
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
  if (_secondaryWrapper) {
    // If the main drawer is currently showing a tab that lives in the
    // secondary sidebar, switch to a built-in fallback first. Otherwise
    // restoreTabToPrimary's click() won't re-render React (the DOM node
    // was physically in the secondary sidebar and React never unmounted it).
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
    const _wSpindleUi = (window as any).spindle?.ui
    for (const [tabId] of Array.from(getTabAssignments())) {
      // Built-in detection: the host bridge can lazy-resolve a root for
      // built-in tab IDs. Extension tab IDs return undefined.
      const _isBuiltIn = _wSpindleUi?.getBuiltInTabRoot?.(tabId) != null
      if (_isBuiltIn) {
        try {
          _wSpindleUi.requestTabLocation(tabId, { kind: 'main-drawer' })
          dlog(`[tabmove] teardown: requestTabLocation CALLED for built-in tabId=${tabId} -> main-drawer`)
        } catch (err) {
          dwarn(`[tabmove] teardown: requestTabLocation failed for tabId=${tabId}:`, err)
        }
      }
      repositionTab(tabId, 'primary')
      showMainTabButton(tabId)
    }
    clearTabAssignments()
    _secondaryWrapper.remove()
    _secondaryWrapper = null
  }
  _secondarySidebarOpen = false
  setMobileOpenClass('secondary', false)
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
  stopPanelHeaderObservers()
  _lastWrittenHeaderVars = null
  updateChatReflow()
}

/* ------------------------------------------------------------------ */
/* Panel-header sync: keep the secondary drawer's panel header in      */
/* step with the main drawer's panel header (height, padding, title    */
/* font-size, border, background).                                     */
/* ------------------------------------------------------------------ */

/**
 * Public, coalesced entry point. Call this after the secondary wrapper
 * mounts, opens/closes, or whenever the main drawer's panel header
 * might have changed. Internally routes through requestAnimationFrame
 * to dedupe rapid back-to-back calls (the ResizeObserver, the
 * MutationObserver, openSecondarySidebar, mountSecondarySidebar, and
 * the side-flip remount can all fire in the same tick).
 *
 * No-op if the secondary wrapper isn't mounted or if the main panel
 * header can't be found (e.g. cold start before Lumiverse mounted its
 * panel). The CSS variables on the wrapper stay at their initial
 * empty state, and the secondary header falls back to its inline
 * defaults (`min-height: 48px`, `padding: 12px 16px`, etc.).
 */
export function syncPanelHeaderFromMain(): void {
  if (_syncPanelHeaderPending) return
  _syncPanelHeaderPending = true
  requestAnimationFrame(() => {
    _syncPanelHeaderPending = false
    _runSyncPanelHeaderFromMain()
  })
}

function _runSyncPanelHeaderFromMain(): void {
  const secondaryWrapper = _secondaryWrapper
  if (!secondaryWrapper) return
  const mainHeader = getMainPanelHeader()
  // Missing main header → keep current CSS var values (empty or stale).
  // The 48px / 12px / 15px fallbacks in the header's `style.cssText`
  // cover the case where the vars were never written yet.
  if (!mainHeader) return

  // Lazy-attach the observers on the FIRST successful run. We watch:
  //   1. ResizeObserver → fires on size changes (padding, font-scale,
  //      font-size CSS variable bump, viewport resize, etc.).
  //   2. MutationObserver (class + style) → fires when Lumiverse
  //      toggles a class for compact mode or rewrites the inline style
  //      for some other reason. ResizeObserver alone misses class-only
  //      changes that don't change the rendered box.
  // Both observers are attached to the main header (which survives
  // across secondary wrapper remounts), so we only ever attach once
  // per process lifetime — matching the drawer-sync.ts pattern at
  // syncDrawerTabSettings.
  if (!_mainPanelHeaderResizeObserver) {
    _mainPanelHeaderResizeObserver = new ResizeObserver(() => {
      syncPanelHeaderFromMain()
    })
    _mainPanelHeaderResizeObserver.observe(mainHeader)
    registerCleanup(stopPanelHeaderObservers)
  }
  if (!_mainPanelHeaderAttrObserver) {
    _mainPanelHeaderAttrObserver = new MutationObserver(() => {
      syncPanelHeaderFromMain()
    })
    _mainPanelHeaderAttrObserver.observe(mainHeader, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    })
    registerCleanup(stopPanelHeaderObservers)
  }

  // Read the six mirrored values. The title lookup tries the common
  // patterns: a heading, an element with a "title"-bearing class, then
  // a direct text-node child. If nothing matches, font-size is left
  // at its CSS default.
  const headerStyle = getComputedStyle(mainHeader)
  const titleEl = findHeaderTitleElement(mainHeader)
  const titleStyle = titleEl ? getComputedStyle(titleEl) : null

  const height = `${mainHeader.offsetHeight}px`
  const paddingTop = headerStyle.paddingTop
  const paddingBottom = headerStyle.paddingBottom
  const fontSize = titleStyle?.fontSize || ''
  const borderBottom = headerStyle.borderBottomWidth === '0px'
    ? '0px'
    : `${headerStyle.borderBottomWidth} ${headerStyle.borderBottomStyle} ${headerStyle.borderBottomColor}`
  const background = headerStyle.backgroundColor

  const cacheKey = [height, paddingTop, paddingBottom, fontSize, borderBottom, background].join('|')
  if (cacheKey === _lastWrittenHeaderVars) return
  _lastWrittenHeaderVars = cacheKey

  secondaryWrapper.style.setProperty('--sidebar-ux-panel-header-h', height)
  secondaryWrapper.style.setProperty('--sidebar-ux-panel-header-pt', paddingTop)
  secondaryWrapper.style.setProperty('--sidebar-ux-panel-header-pb', paddingBottom)
  if (fontSize) {
    secondaryWrapper.style.setProperty('--sidebar-ux-panel-header-font-size', fontSize)
  }
  secondaryWrapper.style.setProperty('--sidebar-ux-panel-header-border-bottom', borderBottom)
  secondaryWrapper.style.setProperty('--sidebar-ux-panel-header-bg', background)
}

/**
 * Locate the title element inside the main panel header. Tries, in order:
 *   1. `<h1>` / `<h2>` / `<h3>` direct child
 *   2. A descendant with a class containing "title" or "Title"
 *   3. Any direct child (fallback — at least we'll get a font-size)
 * Returns `null` only if the header has no children at all.
 */
function findHeaderTitleElement(header: HTMLElement): HTMLElement | null {
  for (const tag of ['H1', 'H2', 'H3']) {
    const byTag = header.querySelector(tag) as HTMLElement | null
    if (byTag) return byTag
  }
  const byClass = header.querySelector('[class*="title"], [class*="Title"]') as HTMLElement | null
  if (byClass) return byClass
  if (header.children.length > 0) return header.children[0] as HTMLElement
  return null
}

/**
 * Disconnect both panel-header observers and null the handles so the
 * next syncPanelHeaderFromMain call rebuilds them. Idempotent — safe
 * to call when no observers are attached (e.g. on a cold start where
 * the main header was never found).
 */
export function stopPanelHeaderObservers(): void {
  if (_mainPanelHeaderResizeObserver) {
    _mainPanelHeaderResizeObserver.disconnect()
    _mainPanelHeaderResizeObserver = null
  }
  if (_mainPanelHeaderAttrObserver) {
    _mainPanelHeaderAttrObserver.disconnect()
    _mainPanelHeaderAttrObserver = null
  }
}