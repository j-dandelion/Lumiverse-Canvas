// Tab assignment system: which tabId is on which sidebar, and the
// assignTab policy layer that wires the move through the host.
//
// assignTab delegates to SecondaryDrawer for the secondary path and to
// unassignFromSecondary for the primary path. The display-toggle path
// (showSecondaryTab in buttons.ts) is preserved for backward
// compatibility — it toggles display:none on roots that are already in
// the secondary content area.
import { getMainSidebar } from '../dom/lumiverse'
import { dlog, dwarn } from '../debug/log'
import { isMobileViewport } from '../sidebar/mobile-exclusion'
import { getSecondaryWrapper, isSecondarySidebarOpen, openSecondarySidebar } from '../sidebar/secondary'
import {
  hideMainTabButton, showMainTabButton, findMainTabButton,
  addSecondaryTabButton, removeSecondaryTabButton, updateDrawerTabVisibility, showSecondaryTab,
  readMainButtonShortName,
} from '../tabs/buttons'
import { persistLayout } from '../layout/persist'
import { runHandoff, captureSourceList } from './activation-handoff'
import {
  isTabActiveInMainDrawer,
  getActiveSecondaryTabId,
  setActiveSecondaryTabId,
} from './active-tab'
import { getHostBridge } from '../dom/host-bridge'

// Re-export for backward compatibility — callers that import from
// tabs/assignment still get the same symbols.
export { isTabActiveInMainDrawer, getActiveSecondaryTabId, setActiveSecondaryTabId }

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
 * Move a tab between sidebars. The stable public API for "move this tab
 * to that sidebar". Delegates to SecondaryDrawer for the secondary path
 * and to unassignFromSecondary for the primary path.
 *
 * window.spindle IS defined at runtime (Lumiverse loader.ts:1032-1087).
 * The built-in branch CAN execute when getBuiltInTabRoot returns a root.
 */
export async function assignTab(tabId: string, sidebar: 'primary' | 'secondary'): Promise<void> {
  if (sidebar === 'secondary') {
    // Built-in tabs: delegate to the host's requestTabLocation API.
    // The move is host-driven — no ExtensionReExecutor needed.
    const bridge = getHostBridge()
    const builtInRoot = bridge?.ui.getBuiltInTabRoot?.(tabId)
    if (builtInRoot) {
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
          _restoreBtn.click()
        })
        _restoreObserver.observe(_restoreSidebar, { attributes: true, attributeFilter: ['class'], subtree: true })
        setTimeout(() => { if (_restoreObserver) { _restoreObserver.disconnect(); _restoreObserver = null } }, 200)
      }

      const preMoveSourceList = await captureSourceList('primary')
      const preMoveActiveTab = isTabActiveInMainDrawer(tabId)

      bridge!.ui.requestTabLocation!(tabId, { kind: 'container', containerId: 'canvas-secondary-drawer' })

      // Read-back IMMEDIATELY + AFTER a microtask: catches ContainerTabContent's
      // Pass 3 reset, which fires on the next React commit. If the move stuck
      // (after == microtask_after == container), all good. If after=container
      // but microtask_after=main-drawer, Pass 3 reset the move — the target
      // container wasn't registered before the move.
      const afterLoc = bridge!.ui.getTabLocation?.(tabId) ?? null
      queueMicrotask(() => {
        const microLoc = bridge!.ui.getTabLocation?.(tabId) ?? null
        const microContainer = getSecondaryWrapper()?.querySelector('.sidebar-ux-panel-content')
        const rootInContainer = microContainer?.contains(builtInRoot) ?? false
        if (afterLoc?.kind === 'container' && microLoc?.kind === 'main-drawer') {
          dwarn(
            `[tabmove] PASS 3 RESET DETECTED: tabLocations["${tabId}"] was set to ` +
            `${JSON.stringify(afterLoc)} but ContainerTabContent Pass 3 reset it to ` +
            `main-drawer because the target container is missing from Lumiverse's ` +
            `containers store. This is the bug. Fix: ensure the secondary drawer's ` +
            `panel content element is registered via bridge.containers.registerContainer ` +
            `BEFORE the move is attempted. (See secondary.tsx:308 — the call exists ` +
            `but may be failing silently.)`
          )
        }
        void rootInContainer // used implicitly via the warn check above
      })
      // [Canvas:tabmove] UI SIDE EFFECTS (v1.6.6 fix). The data-layer move
      // above (requestTabLocation + ContainerTabContent reparent) is
      // invisible to the user without these. Symptom: content is in the
      // secondary container, but no secondary tab button appears, the main
      // button stays visible, and the drawer doesn't open. See
      // [[orchestrator/canvas-v1-6-6-built-in-move-diagnose]] phase 9.
      setTabAssignment(tabId, 'secondary')
      hideMainTabButton(tabId)
      // Build the secondary tab button. Title: prefer the spindle bridge's
      // getBuiltInTabTitle; fall back to the main button's title attr (works
      // for any built-in that has a sidebar button with title="<name>").
      // Icon: extract the SVG from the built-in root so the secondary
      // button matches the main button visually.
      const title = bridge!.ui.getBuiltInTabTitle?.(tabId)
        || findMainTabButton(tabId)?.getAttribute('title')
        || tabId
      const mainBtn = findMainTabButton(tabId)
      const iconSvg = mainBtn?.querySelector('svg')?.outerHTML
        ?? builtInRoot.querySelector('svg')?.outerHTML
      const shortName = readMainButtonShortName(mainBtn)
      addSecondaryTabButton({ id: tabId, title, root: builtInRoot, iconSvg, shortName })
      updateDrawerTabVisibility()
      if (!isSecondarySidebarOpen()) openSecondarySidebar()
      // showSecondaryTab sets data-canvas-active on the moved root via
      // the built-in safety-net branch (buttons.ts:348-378) and toggles
      // the secondary header title. Must run AFTER addSecondaryTabButton
      // so the active state propagation finds the new button.
      await runHandoff({tabId, source: 'primary', destination: 'secondary', sourceList: preMoveSourceList, preMoveSourceActiveTab: preMoveActiveTab})
      persistLayout()
      return
    }
    // Bridge missing entirely, OR bridge present but this tab isn't a
    // built-in (getBuiltInTabRoot returned undefined). Fall through to the
    // extension path. unassignFromSecondary's early-guard handles reparented
    // extension tabs; built-in tabs that the host doesn't recognize would
    // not have been moveable in the first place, so this is a no-op for them.
    if (!bridge) {
      dwarn(
        `[tabmove] no host bridge; tabId="${tabId}" treated as extension. ` +
        `Built-in move requires the spindle loader to populate window.spindle.`
      )
    }
    const { assignToSecondary } = await import('../sidebar/secondary-drawer')
    const preMoveSourceList = await captureSourceList('primary')
    const preMoveActiveTab = isTabActiveInMainDrawer(tabId)
    await assignToSecondary(tabId)
    await runHandoff({tabId, source: 'primary', destination: 'secondary', sourceList: preMoveSourceList, preMoveSourceActiveTab: preMoveActiveTab})
  } else {
    // Primary restore (move from secondary back to main). For built-ins,
    // also tell the host to reset tabLocations back to main-drawer,
    // otherwise ContainerTabContent will re-move the root back to the
    // container on the next React commit. The local UI side (button
    // restore, persistence, drawer state) is handled by
    // unassignFromSecondary. See
    // [[orchestrator/canvas-v1-6-6-built-in-move-diagnose]] phase 9.
    const bridge = getHostBridge()
    const builtInRootRestore = bridge?.ui.getBuiltInTabRoot?.(tabId)
    if (builtInRootRestore && bridge?.ui.requestTabLocation) {
      bridge.ui.requestTabLocation(tabId, { kind: 'main-drawer' })
    }
    const { unassignFromSecondary } = await import('../sidebar/secondary-drawer')
    const preMoveSourceList = await captureSourceList('secondary')
    const preMoveActiveTab = getActiveSecondaryTabId() === tabId
    await unassignFromSecondary(tabId)
    await runHandoff({tabId, source: 'secondary', destination: 'primary', sourceList: preMoveSourceList, preMoveSourceActiveTab: preMoveActiveTab})
  }
}

