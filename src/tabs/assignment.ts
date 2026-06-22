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

