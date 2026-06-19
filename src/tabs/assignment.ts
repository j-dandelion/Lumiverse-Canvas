// Tab assignment system: which tabId is on which sidebar, and the
// policy layer (applyAssignment) on top.
//
// v2.0.0 (drawer overhaul): The legacy DOM-move hack pile (repositionTab,
// restoreTabToPrimary, the synthetic descriptor build, the DOM-walk
// fallback, the activate-then-move dance) has been gutted. Extension tabs
// now use bundle re-execution via ExtensionReExecutor + SecondaryDrawer.
// Built-in tabs use the host's requestTabLocation API.
//
// The assignTab public API delegates to SecondaryDrawer for the secondary
// path and unassigns directly for the primary path.
//
// The display-toggle path (showSecondaryTab in buttons.ts) is preserved
// for backward compatibility — it toggles display:none on roots that are
// already in the secondary content area.
import { getMainSidebar, getMainPanelContent } from '../dom/lumiverse'
import { findStoreData, getDrawerTabs } from '../store'
import { dlog, dwarn } from '../debug/log'
import { isMobileViewport } from '../sidebar/mobile-exclusion'
import { diagnoseMovedTab } from '../debug/moved-tab-diagnostics'
import { getSecondaryWrapper, isSecondarySidebarOpen, openSecondarySidebar, closeSecondarySidebar, PUZZLE_ICON_SVG } from '../sidebar/secondary'
import {
  hideMainTabButton, showMainTabButton, findMainTabButton,
  addSecondaryTabButton, removeSecondaryTabButton, updateDrawerTabVisibility, showSecondaryTab,
  cssEscape, findSafeFallbackButton, isSettingsButton, readMainButtonShortName,
} from '../tabs/buttons'
import { persistLayout } from '../layout/persist'
import { runHandoff, captureSourceList } from './activation-handoff'
import {
  _setTabAssignmentsGetter,
  getActiveTabId,
  isTabActiveInMainDrawer,
  getActiveSecondaryTabId,
  setActiveSecondaryTabId,
} from './active-tab'
// Wire the active-tab getter so isMovedTabId can read the assignments
// without a circular import.
_setTabAssignmentsGetter(() => _tabAssignments)

// Re-export for backward compatibility — callers that import from
// tabs/assignment still get the same symbols.
export { isTabActiveInMainDrawer, getActiveSecondaryTabId, setActiveSecondaryTabId }
export { isMovedTabNode, type ActiveTabState } from './active-tab'

// Maps tab ID → which sidebar it belongs to
const _tabAssignments: Map<string, 'primary' | 'secondary'> = new Map()

// Accessors used by other modules (sidebar/secondary, sidebar/drawer-sync,
// context-menu, layout/persist).
export function getTabAssignments(): Map<string, 'primary' | 'secondary'> { return _tabAssignments }
export function hasTabAssignment(tabId: string): boolean { return _tabAssignments.has(tabId) }
export function clearTabAssignments(): void { _tabAssignments.clear() }

/** Encapsulated mutation: set a tab assignment without exposing the mutable Map. */
export function setTabAssignment(tabId: string, panelId: 'primary' | 'secondary'): void {
  _tabAssignments.set(tabId, panelId)
}

/** Encapsulated mutation: delete a tab assignment without exposing the mutable Map. */
export function deleteTabAssignment(tabId: string): void {
  _tabAssignments.delete(tabId)
}

export function getTabSidebar(tabId: string): 'primary' | 'secondary' {
  return _tabAssignments.get(tabId) || 'primary'
}

/**
 * Magic 80ms wait for React to commit + mount after .click() on a tab button.
 * Empirical — must outlast a double-RAF (~32ms) plus mount cost.
 * v0.5.24 requestTabLocation is now published and used synchronously at
 * assignment.ts:240. This 80ms wait is retained for the showSecondaryTab
 * display-toggle path, where React commit latency still requires a brief
 * settle. See brain: orchestrator/spindle-tab-mobility-floating-plan B12.
 * See brain: orchestrator/spindle-tab-mobility-floating-plan B12.
 */
export const TIMEOUT_REACT_COMMIT_MS = 80

/**
 * Switch the main drawer to a fallback tab before moving the active extension
 * tab to the secondary sidebar. Without this, the previous ExtensionTabContent
 * stays mounted with an empty container (its useEffect dep [tab] is unchanged
 * after a DOM-move, so it doesn't re-fire), and the main panel renders a
 * stale header + empty body.
 *
 * Strategy: find the button immediately before the moved tab's button in the
 * main sidebar DOM, and click it. This is the user's expected behavior —
 * "the next panel whose tab was above or beneath" — and triggers Lumiverse's
 * real onClick → setDrawerTab + openDrawer flow.
 *
 * If the moved tab is the FIRST tab in the sidebar, fall back to the button
 * immediately after. If no neighbor exists (degenerate case), fall back to
 * the first built-in tab button. If even that fails, proceed without
 * switching (preserves the original buggy behavior rather than dead-locking).
 */
/**
 * Phase 4 (finding #10): unified drawer-fallback switcher. Replaces the
 * separate `switchMainDrawerToFallback` and the (as-yet-unwritten) secondary
 * counterpart. The two-RAF wait is only needed for `'main'` because React
 * unmounts the old `ExtensionTabContent` asynchronously there. For `'secondary'`
 * the call is synchronous — the moved tab's node guard and the panel's
 * synchronous state update are enough to detach the node.
 */
export function switchDrawerToFallback(side: 'main' | 'secondary', tabId: string, then: () => void): void {
  if (side === 'secondary') {
    // Phase 4 (finding #2): when the moved tab is the active secondary tab,
    // there is no fallback drawer to switch — restoreTabToPrimary already
    // handles the neighbor-tab fall-through via _activeSecondaryTabId.
    // Just invoke then() synchronously.
    then()
    return
  }
  // side === 'main' — legacy logic, preserved verbatim from the previous
  // switchMainDrawerToFallback implementation.
  const sidebar = getMainSidebar()
  if (!sidebar) {
    dwarn('switchDrawerToFallback(main): no main sidebar found')
    then()
    return
  }

  const allButtons = Array.from(sidebar.querySelectorAll('button[class*="tabBtn"]')) as HTMLElement[]

  let movedBtnIdx = allButtons.findIndex((b) => b.getAttribute('data-tab-id') === tabId)
  if (movedBtnIdx === -1) {
    const movedTab = getDrawerTabs().find((t: any) => t.id === tabId)
    const movedTitle = movedTab?.title
    if (movedTitle) {
      movedBtnIdx = allButtons.findIndex((b) => b.getAttribute('title') === movedTitle)
      if (movedBtnIdx === -1) {
        dwarn(`switchDrawerToFallback(main): no button for id="${tabId}" (title="${movedTitle}") found, proceeding without switching`)
        then()
        return
      }
      dwarn(`switchDrawerToFallback(main): id-match missed for ${tabId}, fell back to title-match — tagMainSidebarButtons may not have run yet`)
    } else {
      dwarn(`switchDrawerToFallback(main): no tab in store for id=${tabId}, proceeding without switching`)
      then()
      return
    }
  }

  // Pick a safe fallback: prefer the visible built-in tab immediately
  // adjacent to the moved tab. Skip non-visible buttons, extension tabs,
  // and the Lumiverse Settings tab.
  const isSafeCandidate = (b: HTMLElement | undefined): b is HTMLElement => {
    if (!b) return false
    if (b.style.display === 'none') return false
    if (!b.className.includes('tabBtn')) return false
    if (b.className.includes('tabBtnExtension')) return false
    return !isSettingsButton(b)
  }
  let fallbackBtn: HTMLElement | null = null
  for (let offset = -1; offset >= -(movedBtnIdx) && !fallbackBtn; offset--) {
    fallbackBtn = isSafeCandidate(allButtons[movedBtnIdx + offset]) ? allButtons[movedBtnIdx + offset] : null
  }
  if (!fallbackBtn) {
    for (let offset = 1; offset < allButtons.length - movedBtnIdx && !fallbackBtn; offset++) {
      fallbackBtn = isSafeCandidate(allButtons[movedBtnIdx + offset]) ? allButtons[movedBtnIdx + offset] : null
    }
  }
  if (!fallbackBtn) {
    fallbackBtn = findSafeFallbackButton(sidebar)
  }
  if (!fallbackBtn) {
    dwarn('switchDrawerToFallback(main): no safe fallback button found, proceeding without switching')
    then()
    return
  }

  fallbackBtn.click()

  // Wait two animation frames before performing the move.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      then()
    })
  })
}

/**
 * Phase 4 (finding #1): the policy layer for tab assignment. Wraps the pure
 * DOM move (repositionTab) with state updates, button affordances, optional
 * drawer open/close, optional active-tab switching, and optional save.
 *
 * v2.0.0: simplified — the complex hack pile (synthetic descriptor build,
 * DOM-walk fallback, activate-then-move dance) has been removed. The
 * assignTab public API now delegates to SecondaryDrawer for the secondary
 * path. applyAssignment is retained for backward compatibility but its body
 * is simplified.
 */
export function applyAssignment(tabId: string, target: 'primary' | 'secondary', options: {
  open?: boolean
  switchActive?: boolean
  save?: boolean
} = {}): void {
  const opts = { open: true, switchActive: true, save: true, ...options }

  // 1. State: record the assignment
  _tabAssignments.set(tabId, target)

  // 2. Button affordances: hide in main / show in secondary
  if (target === 'secondary') {
    hideMainTabButton(tabId)
    const tabs = getDrawerTabs()
    const tab = tabs.find(t => t.id === tabId)
    if (tab) addSecondaryTabButton(tab)
  } else {
    showMainTabButton(tabId)
    removeSecondaryTabButton(tabId)
  }
  updateDrawerTabVisibility()

  // 3. Display toggle for secondary (preserves backward compatibility)
  if (target === 'secondary' && opts.switchActive) {
    showSecondaryTab(tabId)
  }

  // 4. Open the drawer if requested.
  if (target === 'secondary' && opts.open && !isSecondarySidebarOpen()) {
    openSecondarySidebar()
  }

  // 5. Save (debounced via persistLayout).
  if (opts.save) {
    persistLayout()
  }
}

/**
 * Phase 4 (finding #1): one-line wrapper around applyAssignment with the
 * defaults for a user-initiated context-menu move. Kept as a stable public
 * API — any caller (current or future) that just wants "move this tab to
 * that sidebar" doesn't need to know about the options.
 *
 * v2.0.0: delegates to SecondaryDrawer for the secondary path and
 * unassigns directly for the primary path.
 *
 * window.spindle IS defined at runtime (Lumiverse loader.ts:1032-1087).
 * The built-in branch CAN execute when getBuiltInTabRoot returns a root.
 */
export async function assignTab(tabId: string, sidebar: 'primary' | 'secondary'): Promise<void> {
  // [Canvas:tabmove] Entry probe — emitted on every assignTab call so we
  // can correlate "user clicked move" with downstream side effects.
  dlog(`[tabmove] assignTab ENTRY tabId=${tabId} sidebar=${sidebar} stack=`, new Error().stack?.split('\n').slice(1, 4).join(' | '))

  if (sidebar === 'secondary') {
    // Built-in tabs: delegate to the host's requestTabLocation API.
    // The move is host-driven — no ExtensionReExecutor needed.
    const wSpindle = (window as any).spindle
    const wSpindleUi = wSpindle?.ui
    const builtInRoot = wSpindleUi?.getBuiltInTabRoot?.(tabId)
    // [Canvas:tabmove] Probe the broken bridge. The `wSpindle === undefined`
    // branch is the silent failure — getBuiltInTabRoot() cannot be called
    // on an undefined object, so the function call never happens and
    // builtInRoot is always undefined here.
    dlog(
      `[tabmove] built-in probe: window.spindle=${wSpindle ? 'present' : 'UNDEFINED'} ` +
      `(type=${typeof wSpindle}), ` +
      `window.spindle.ui=${wSpindleUi ? 'present' : 'UNDEFINED'} (type=${typeof wSpindleUi}), ` +
      `getBuiltInTabRoot=${typeof wSpindleUi?.getBuiltInTabRoot}, ` +
      `requestTabLocation=${typeof wSpindleUi?.requestTabLocation}, ` +
      `builtInRoot=${builtInRoot ? 'present' : 'absent'} for tabId="${tabId}"`
    )
    if (builtInRoot) {
      // [Canvas:tabmove] Pre-call probe: is the target container actually
      // registered? Per Lumiverse's ContainerTabContent (Pass 3), if the
      // container is NOT in the `containers` store, the move is silently
      // undone (moveTabTo is called with main-drawer) right after we set
      // it. Probing BOTH `window.spindle.containers` (existence + count)
      // and `getTabLocation(tabId)` (read-back of the move we just made)
      // tells us which half is broken. The microtask re-read on line ~282
      // also catches Pass 3's reset.
      const wContainers = wSpindle?.containers
      let containerCount: number | string = 'N/A'
      let containerIds: string[] = []
      try {
        // The store itself isn't exposed on the bridge, but we can detect
        // the registration by trying to read tabLocation for a known
        // pre-moved tab OR by calling the bridge's own methods. Best we
        // have without store access: log what we can.
        if (wContainers && typeof wContainers === 'object') {
          // Probe the container registration via a no-op move + read-back.
          // If `getTabLocation` is available, the bridge is functional.
          containerCount = 'bridge-present (cannot enumerate without store access)'
        }
      } catch { /* ignore */ }
      dlog(
        `[tabmove] pre-call container probe: ` +
        `window.spindle.containers=${wContainers ? 'present' : 'UNDEFINED'} (type=${typeof wContainers}), ` +
        `has_registerContainer=${typeof wContainers?.registerContainer}, ` +
        `has_unregisterContainer=${typeof wContainers?.unregisterContainer}, ` +
        `has_getTabLocation=${typeof wSpindleUi?.getTabLocation}`
      )
      // Snapshot tabLocation BEFORE the move (baseline).
      const beforeLoc = wSpindleUi?.getTabLocation?.(tabId)
      dlog(`[tabmove] pre-call tabLocation: tabId="${tabId}" before=${JSON.stringify(beforeLoc)}`)

      // BUG 3 FIX: preserve the originally active main-drawer tab when a
      // non-activated tab is moved. Lumiverse's spindle-placement.ts:354-358
      // sets pendingActiveTabReset = tabId unconditionally, and
      // ViewportDrawer.tsx:114-120's useEffect resets drawerTab to the first
      // non-moved tab via setDrawerTab(fallback). We watch for the resulting
      // tabBtnActive class swap on main-sidebar buttons and re-click the
      // original to restore it. React 18 batches the useEffect's setDrawerTab
      // with our click's setDrawerTab in the same scheduler tick; the last
      // one (ours) wins. The 200ms safety timeout disconnects the observer
      // if the useEffect didn't fire (e.g., the host's reset was already
      // cleared), so we don't fight a legitimate user tab swap. Skipped when
      // the moved tab IS the active tab — the reset is expected then.
      // Skipped on mobile — the main sidebar is hidden offscreen there, so
      // fighting the reset has no visible effect and just causes churn.
      const _restoreSidebar = getMainSidebar()
      // Match both unhashed `tabBtnActive` and CSS-module hashed variants
      // (e.g. `_tabBtnActive_xyz123`). See main-persist.ts:101.
      const _restoreBtn = _restoreSidebar?.querySelector('button.tabBtnActive, button[class*="tabBtnActive"]') as HTMLElement | null
      const _restoreActiveId = _restoreBtn?.getAttribute('data-tab-id') ?? null
      let _restoreObserver: MutationObserver | null = null
      if (!isMobileViewport() && _restoreSidebar && _restoreBtn && _restoreActiveId && _restoreActiveId !== tabId) {
        _restoreObserver = new MutationObserver(() => {
          if (_restoreObserver) { _restoreObserver.disconnect(); _restoreObserver = null }
          dlog(`[tabmove] restore observer fired: re-clicking original main-drawer active button to preserve drawerTab`)
          _restoreBtn.click()
        })
        _restoreObserver.observe(_restoreSidebar, { attributes: true, attributeFilter: ['class'], subtree: true })
        setTimeout(() => { if (_restoreObserver) { _restoreObserver.disconnect(); _restoreObserver = null } }, 200)
        dlog(`[tabmove] restore observer armed for originalActiveTabId="${_restoreActiveId}"`)
      }

      const preMoveSourceList = await captureSourceList('primary')
      const preMoveActiveTab = isTabActiveInMainDrawer(tabId)

      const result = wSpindleUi.requestTabLocation(tabId, { kind: 'container', containerId: 'canvas-secondary-drawer' })
      dlog(`[tabmove] requestTabLocation CALLED for tabId=${tabId} -> container=canvas-secondary-drawer; returned=${typeof result}`)

      // Read-back IMMEDIATELY (synchronous after the call): does the store
      // see the new location? `getTabLocation` is a direct store read.
      const afterLoc = wSpindleUi?.getTabLocation?.(tabId)
      dlog(`[tabmove] immediate read-back: tabId="${tabId}" after=${JSON.stringify(afterLoc)}`)

      // Read-back AFTER a microtask: catches ContainerTabContent's Pass 3
      // reset, which fires on the next React commit (~microtask). If
      // after=microtask_after but immediate_after was the container
      // location, Pass 3 reset the move. If both are the container
      // location, the move stuck but something else is preventing the
      // visible tab button.
      queueMicrotask(() => {
        const microLoc = wSpindleUi?.getTabLocation?.(tabId)
        const microContainer = getSecondaryWrapper()?.querySelector('.sidebar-ux-panel-content')
        const rootInContainer = microContainer?.contains(builtInRoot)
        dlog(
          `[tabmove] microtask read-back: tabId="${tabId}" after=${JSON.stringify(microLoc)}, ` +
          `rootInContainer=${rootInContainer ? 'YES' : 'no'}, ` +
          `containerElement=${microContainer ? 'present' : 'absent'}`
        )
        if (afterLoc?.kind === 'container' && microLoc?.kind === 'main-drawer') {
          dwarn(
            `[tabmove] PASS 3 RESET DETECTED: tabLocations["${tabId}"] was set to ` +
            `${JSON.stringify(afterLoc)} but ContainerTabContent Pass 3 reset it to ` +
            `main-drawer because the target container is missing from Lumiverse's ` +
            `containers store. This is the bug. Fix: ensure the secondary drawer's ` +
            `panel content element is registered via window.spindle.containers.registerContainer ` +
            `BEFORE the move is attempted. (See secondary.tsx:275 — the call exists ` +
            `but may be failing silently.)`
          )
        }
      })
      // [Canvas:tabmove] UI SIDE EFFECTS (v1.6.6 fix). The data-layer move
      // above (requestTabLocation + ContainerTabContent reparent) is
      // invisible to the user without these. The v2 assignTab path
      // previously returned here immediately, skipping the canvas_ext
      // button/persistence/drawer management. Symptom: content is in the
      // secondary container (microtask read-back confirms rootInContainer=YES),
      // but no secondary tab button appears, the main button stays
      // visible, and the drawer doesn't open. See
      // [[orchestrator/canvas-v1-6-6-built-in-move-diagnose]] phase 9.
      setTabAssignment(tabId, 'secondary')
      hideMainTabButton(tabId)
      // Build the secondary tab button. Title: prefer the spindle bridge's
      // DRAWER_TABS lookup; fall back to the main button's title attr (works
      // for any built-in that has a sidebar button with title="<name>").
      // Icon: extract the SVG from the built-in root so the secondary
      // button matches the main button visually.
      const title = wSpindleUi?.getBuiltInTabTitle?.(tabId)
        || findMainTabButton(tabId)?.getAttribute('title')
        || tabId
      const mainBtn = findMainTabButton(tabId)
      const iconSvg = mainBtn?.querySelector('svg')?.outerHTML
        ?? builtInRoot.querySelector('svg')?.outerHTML
      const shortName = readMainButtonShortName(mainBtn)
      dlog(`[tabmove] built-in icon: tabId="${tabId}" source=${mainBtn?.querySelector('svg') ? 'main-button' : iconSvg ? 'builtIn-root' : 'NONE'}`)
      addSecondaryTabButton({ id: tabId, title, root: builtInRoot, iconSvg, shortName })
      updateDrawerTabVisibility()
      if (!isSecondarySidebarOpen()) openSecondarySidebar()
      // showSecondaryTab sets data-canvas-active on the moved root via
      // the built-in safety-net branch (buttons.ts:348-378) and toggles
      // the secondary header title. Must run AFTER addSecondaryTabButton
      // so the active state propagation finds the new button.
      await runHandoff({tabId, source: 'primary', destination: 'secondary', sourceList: preMoveSourceList, preMoveSourceActiveTab: preMoveActiveTab})
      persistLayout()
      dlog(`[tabmove] built-in UI side effects complete: tabId="${tabId}" -> secondary (button hidden in main, button added to secondary, drawer opened, layout persisted)`)
      return
    }
    // This branch fires when getBuiltInTabRoot returns undefined despite window.spindle being present — meaning the tab is not recognized as built-in by the host.
    if (!wSpindle) {
      dwarn(
        `[tabmove] SILENT FAILURE: tabId="${tabId}" looks built-in (no window.spindle bridge). ` +
        `getBuiltInTabRoot() could not be called; built-in branch skipped; ` +
        `falling through to extension re-execution which is a no-op for built-ins. ` +
        `This is the reported bug. Fix: capture SpindleFrontendContext in setup(ctx) ` +
        `and use ctx.ui.requestTabLocation instead of window.spindle?.ui?.requestTabLocation. ` +
        `See [[debug/canvas-lumiscript-tab-move]] for analysis.`
      )
    } else {
      dwarn(
        `[tabmove] FALLTHROUGH: tabId="${tabId}" not recognized as built-in by host ` +
        `(getBuiltInTabRoot returned undefined despite window.spindle being present). ` +
        `Possibly an extension tab or an id mismatch — checking store.`
      )
    }
    // Extension tabs: re-execute in the secondary drawer context.
    const { assignToSecondary } = await import('../sidebar/secondary-drawer')
    dlog(`[tabmove] calling assignToSecondary (extension path) for tabId=${tabId}`)
    const preMoveSourceList = await captureSourceList('primary')
    const preMoveActiveTab = isTabActiveInMainDrawer(tabId)
    await assignToSecondary(tabId)
    await runHandoff({tabId, source: 'primary', destination: 'secondary', sourceList: preMoveSourceList, preMoveSourceActiveTab: preMoveActiveTab})
  } else {
    // [Canvas:tabmove] Primary restore (move from secondary back to main).
    // For built-ins, ALSO tell the host to reset tabLocations back to
    // main-drawer, otherwise ContainerTabContent will re-move the root
    // back to the container on the next React commit. The local UI side
    // (button restore, persistence, drawer state) is handled by
    // unassignFromSecondary. See
    // [[orchestrator/canvas-v1-6-6-built-in-move-diagnose]] phase 9.
    const wUi = (window as any).spindle?.ui
    if (wUi?.getBuiltInTabRoot) {
      const builtInRootRestore = wUi.getBuiltInTabRoot(tabId)
      if (builtInRootRestore) {
        wUi.requestTabLocation(tabId, { kind: 'main-drawer' })
        dlog(`[tabmove] built-in primary restore: requestTabLocation CALLED for tabId=${tabId} -> main-drawer`)
      }
    }
    const { unassignFromSecondary } = await import('../sidebar/secondary-drawer')
    dlog(`[tabmove] calling unassignFromSecondary (primary path) for tabId=${tabId}`)
    const preMoveSourceList = await captureSourceList('secondary')
    const preMoveActiveTab = getActiveSecondaryTabId() === tabId
    await unassignFromSecondary(tabId)
    await runHandoff({tabId, source: 'secondary', destination: 'primary', sourceList: preMoveSourceList, preMoveSourceActiveTab: preMoveActiveTab})
  }
}

/**
 * Phase 4 (finding #1) + v1.3.0: pure DOM move — moves a tab's root element
 * between sidebars WITHOUT touching state, buttons, save, or open/close.
 * The policy layer (applyAssignment) wraps this with the side effects.
 *
 * v2.0.0 (drawer overhaul): The complex hack pile body has been gutted.
 * The synthetic descriptor build, DOM-walk fallback, and activate-then-move
 * dance are no longer needed — DrawerObserver provides tab discovery and
 * ExtensionReExecutor provides re-execution in the secondary context.
 *
 * This function is retained as a simplified stub for backward compatibility
 * with applyLayout and other callers. The core DOM move is preserved for
 * the display-toggle path (showSecondaryTab toggles display:none on roots
 * that are already in the secondary content area).
 *
 * TODO: Remove this function entirely once applyLayout is updated to use
 * SecondaryDrawer.assignToSecondary / unassignFromSecondary.
 */
export function repositionTab(tabId: string, target: 'primary' | 'secondary'): boolean {
  // Simplified: just do the DOM move without the complex hack pile.
  findStoreData(true)
  const tabs = getDrawerTabs()
  const tab = tabs.find(t => t.id === tabId)
  if (!tab?.root) {
    dwarn(`repositionTab: tab not found for id=${tabId}`)
    return false
  }

  if (target === 'secondary') {
    const secondaryWrapper = getSecondaryWrapper()
    const secondaryContent = secondaryWrapper?.querySelector('.sidebar-ux-panel-content') as HTMLElement
    if (!secondaryContent) {
      dwarn('repositionTab: no secondary content area')
      return false
    }
    if (tab.root.parentElement !== secondaryContent) {
      // Sweep: remove any prior copy of this tabId that is already in the
      // secondary content area.
      secondaryContent.querySelectorAll(`[data-canvas-moved="${cssEscape(tabId)}"]`)
        .forEach(n => n.remove())
      secondaryContent.appendChild(tab.root)
      tab.root.setAttribute('data-canvas-moved', tabId)
    }
    // Position absolutely so the moved root overlaps the secondary content
    // area. Use the content div's padding custom properties as inset values
    // so the tab root sits INSIDE the padding rather than covering it —
    // preserving the visual gap between the tab and the panel edge.
    tab.root.style.setProperty('position', 'absolute', 'important')
    tab.root.style.setProperty('inset',
      'var(--sidebar-ux-content-pt) var(--sidebar-ux-content-pr) var(--sidebar-ux-content-pb) var(--sidebar-ux-content-pl)',
      'important')
    // Display management: hide if not the active secondary tab.
    const activeId = getActiveSecondaryTabId()
    if (activeId === tabId) {
      tab.root.setAttribute('data-canvas-active', '')
    } else if (activeId !== null) {
      tab.root.removeAttribute('data-canvas-active')
    } else {
      // First-open case: set active so CSS rule doesn't hide it.
      // showSecondaryTab will set correct displays via the applyLayout polling loop.
      tab.root.setAttribute('data-canvas-active', '')
    }

    diagnoseMovedTab(tabId, tab.root)
    // Delayed re-snapshot: showSecondaryTab runs AFTER repositionTab and
    // may clear/change the display override; the steady-state layout is
    // visible only ~100ms after the move completes. Capture both.
    setTimeout(() => {
      try {
        if (tab.root.isConnected) diagnoseMovedTab(tabId + ' [+1s]', tab.root)
      } catch { /* tab detached */ }
    }, 1000)
    return true
  } else {
    // target === 'primary' — restore from secondary back to the main panel.
    const targetEl = getMainPanelContent()
    if (!targetEl) {
      dwarn(`repositionTab: no main panel content for tabId=${tabId}`)
      return false
    }
    if (tab.root.parentElement !== targetEl) {
      targetEl.appendChild(tab.root)
    }
    // Clear all secondary-state markers so the tab renders normally in
    // the main panel. These are cleared unconditionally (not just when
    // the DOM actually moved) so a root that's already in the main
    // panel but still carries stale markers from a previous move gets
    // cleaned up too — matches the unconditional clears for the other
    // markers below.
    //
    // Markers/styles set while the tab was in secondary:
    //   - data-canvas-moved={tabId} (this tab lives in secondary)
    //   - data-canvas-active="" (this tab is the active secondary tab)
    //   - display: none !important (showSecondaryTab for inactive tabs,
    //     closeSecondarySidebar for all tabs on close)
    //   - position: absolute !important + inset: 0 !important
    //     (repositionTab secondary case, to make moved roots overlap
    //     the secondary content area)
    //
    // Without clearing these, the restored tab would be invisible
    // (display:none) and absolutely positioned relative to the wrong
    // container (position:absolute anchors to panelContent, not the
    // moved root's actual parent in the main panel).
    tab.root.removeAttribute('data-canvas-moved')
    tab.root.removeAttribute('data-canvas-active')
    tab.root.style.removeProperty('position')
    tab.root.style.removeProperty('inset')
    // Bug fix (2026-06-19): also clear inline `display` set while the tab
    // was in secondary. `repositionTab` secondary case doesn't set inline
    // display, but other code paths (clearSecondaryTab at assignment.ts:629,
    // future showSecondaryTab changes) may have. Without this clear, the
    // root would remain `display: none !important` and invisible in the
    // main panel — the "tabs return to main but content doesn't display"
    // symptom reported on Canvas disable.
    tab.root.style.removeProperty('display')
    return true
  }
}


/**
 * Restore a tab from the secondary drawer back to the primary sidebar.
 *
 * v2.0.0 (drawer overhaul): The complex hack pile body has been gutted.
 * The synthetic descriptor build, DOM-walk fallback, and neighbor-tab
 * fall-through dance are no longer needed — SecondaryDrawer handles
 * the state machine transitions.
 *
 * This function is retained as a simplified stub for backward compatibility.
 * The core logic delegates to repositionTab for the DOM move and
 * switchDrawerToFallback for the main drawer switch.
 *
 * TODO: Remove this function entirely once all callers are migrated to
 * SecondaryDrawer.unassignFromSecondary.
 */
export function restoreTabToPrimary(tabId: string) {
  // Simplified: just do the DOM move and switch the main drawer.
  repositionTab(tabId, 'primary')

  // Activate the restored tab in the main drawer with a guaranteed remount.
  switchDrawerToFallback('main', tabId, () => {
    const btn = findMainTabButton(tabId)
    if (btn) (btn as HTMLElement).click()
  })

  // If the restored tab was the active secondary tab, fall through to a neighbor.
  if (getActiveSecondaryTabId() === tabId) {
    let neighborId: string | null = null
    for (const [tid, side] of _tabAssignments) {
      if (side === 'secondary' && tid !== tabId) {
        neighborId = tid
        break
      }
    }
    if (neighborId) {
      dlog(`restoreTabToPrimary: falling through to neighbor tab ${neighborId}`)
      showSecondaryTab(neighborId)
    } else {
      dlog('restoreTabToPrimary: no neighbor tab in secondary; clearing panel header')
      clearSecondaryTab()
    }
  }
}

/**
 * Phase 4 (finding #2): hide the secondary panel header and content when
 * no tab is assigned. Used by restoreTabToPrimary when the last secondary
 * tab is moved out.
 *
 * v2.0.0: simplified — the complex body has been gutted. The core logic
 * is preserved for backward compatibility.
 */
function clearSecondaryTab() {
  const secondaryWrapper = getSecondaryWrapper()
  const title = secondaryWrapper?.querySelector('.sidebar-ux-panel-title')
  if (title) title.textContent = ''
  // Skip Canvas-owned buttons — they're owned by the wrapper in
  // src/context/secondary-ctx.ts and have their own teardown via
  // teardownExtension → clearSecondaryTabs. Touching them here would
  // try to match against their bare options.id, which wouldn't match
  // the composite Lumiverse id we iterate by.
  const allBtns = secondaryWrapper?.querySelectorAll(
    '.sidebar-ux-tab-list button[data-tab-id]:not(.sidebar-ux-tab-secondary-canvas)',
  ) as NodeListOf<HTMLElement>
  if (allBtns) {
    for (const btn of allBtns) {
      btn.classList.remove('sidebar-ux-tab-active')
      btn.style.color = ''
      btn.style.background = ''
      btn.style.boxShadow = ''
      btn.style.borderRadius = ''
      const label = btn.querySelector('.sidebar-ux-tab-label') as HTMLElement
      if (label) label.style.color = ''
    }
  }
  // Hide tab roots that are in the secondary content area.
  const content = secondaryWrapper?.querySelector('.sidebar-ux-panel-content') as HTMLElement
  if (content) {
    for (const child of Array.from(content.children) as HTMLElement[]) {
      child.style.setProperty('display', 'none', 'important')
    }
  }
  setActiveSecondaryTabId(null)
}

/**
 * Reposition all assigned tabs (called after secondary sidebar opens/resizes).
 *
 * v2.0.0: retained for backward compatibility with applyLayout.
 * TODO: Remove once applyLayout is updated to use SecondaryDrawer.
 */
export function repositionAssignedTabs() {
  for (const [tabId, sidebar] of _tabAssignments) {
    if (sidebar === 'secondary') {
      repositionTab(tabId, 'secondary')
    }
  }
}
