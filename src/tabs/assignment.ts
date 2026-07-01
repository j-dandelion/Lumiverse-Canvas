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
/**
 * BUG 3 FIX: preserve the originally active main-drawer tab when a
 * non-activated built-in tab is moved. Lumiverse's spindle-placement.ts
 * sets `pendingActiveTabReset = tabId` unconditionally, and
 * ViewportDrawer.tsx's useEffect resets drawerTab to the first non-moved
 * tab. We watch for the resulting tabBtnActive class swap on main-sidebar
 * buttons and re-click the original to restore it. React 18 batches the
 * useEffect's setDrawerTab with our click's setDrawerTab; the last one
 * (ours) wins. The 200ms safety timeout disconnects the observer if the
 * useEffect didn't fire, so we don't fight a legitimate user tab swap.
 * Skipped on mobile (the main sidebar is hidden offscreen there) and
 * when the moved tab IS the active tab (the reset is expected then).
 */
function armMainDrawerActiveRestore(tabId: string): void {
  if (isMobileViewport()) return
  const sidebar = getMainSidebar()
  if (!sidebar) return
  // Match both unhashed `tabBtnActive` and CSS-module hashed variants
  // (e.g. `_tabBtnActive_xyz123`). See main-persist.ts:101.
  const restoreBtn = sidebar.querySelector('button.tabBtnActive, button[class*="tabBtnActive"]') as HTMLElement | null
  const restoreActiveId = restoreBtn?.getAttribute('data-tab-id') ?? null
  if (!restoreBtn || !restoreActiveId || restoreActiveId === tabId) return
  let observer: MutationObserver | null = new MutationObserver(() => {
    if (observer) { observer.disconnect(); observer = null }
    restoreBtn.click()
  })
  observer.observe(sidebar, { attributes: true, attributeFilter: ['class'], subtree: true })
  setTimeout(() => { if (observer) { observer.disconnect(); observer = null } }, 200)
}

export interface EnsureActiveHooks {
  isTabActiveInMainDrawer?: (tabId: string) => boolean
  findMainTabButton?: (tabId: string) => Element | null
  isMobileViewport?: () => boolean
  getBuiltInTabRoot?: (tabId: string) => HTMLElement | undefined
  dlog?: (...args: unknown[]) => void
}

/**
 * Bug fix: built-in tabs (Lorebook, Databank, etc.) don't have their root
 * in the DOM unless Lumiverse decides to render them as the active tab.
 * Per the BUILT-IN TAB LIMITATION comment in src/sidebar/secondary-drawer.ts:
 * "Lumiverse only renders the ACTIVE tab's root in the main panel content."
 * Most built-ins populate dropdowns/tables via a React useEffect that fires
 * on component mount. So moving a never-activated built-in tab to the
 * secondary drawer reparents *nothing* — the root never existed.
 *
 * The supported mechanism to mount a built-in root is to make the tab
 * active in the main drawer, which Lumiverse does on tab-button click.
 * This helper does that activation as a setup step before requestTabLocation.
 *
 * No-op when the tab is already active in main (avoids a re-click that
 * would briefly empty an already-populated dropdown via React re-mount).
 * No-op on mobile (the main sidebar is hidden; clicks land on the wrong
 * element via the mobile flyout pattern). Mobile edge case is unhandled
 * in this fix; follow up if a mobile user reports it.
 */
export async function ensureBuiltInTabActiveInMain(
  tabId: string,
  h: EnsureActiveHooks = {},
): Promise<void> {
  const _isActive = h.isTabActiveInMainDrawer ?? isTabActiveInMainDrawer
  const _findBtn = h.findMainTabButton ?? findMainTabButton
  const _isMobile = h.isMobileViewport ?? isMobileViewport
  const _getRoot = h.getBuiltInTabRoot ?? (() => undefined)
  const _dlog = h.dlog ?? (() => {})

  if (_isActive(tabId)) return

  if (_isMobile()) {
    _dlog(`[tabmove] ensure-active: mobile, skipping pre-activation for "${tabId}"`)
    return
  }

  const btn = _findBtn(tabId)
  if (!btn) {
    _dlog(
      `[tabmove] ensure-active: main button-not-found for "${tabId}", ` +
      `relying on host lazy-mount`,
    )
    return
  }
  // btn is Element (per buttons.ts:47) — narrow at click site.
  ;(btn as HTMLElement).click()

  // Wait for one rAF (~16ms) so Lumiverse commits the activation and
  // Lorebook's mount useEffect fires. 1-16ms is the documented latency
  // of Lumiverse's pendingActiveTabReset useEffect.
  await new Promise<void>(r => requestAnimationFrame(() => r()))

  const root = _getRoot(tabId)
  if (!root) {
    _dlog(
      `[tabmove] ensure-active: post-click root still null for "${tabId}"; ` +
      `move will fall through to host lazy-mount`,
    )
  }
}

/**
 * Warn if ContainerTabContent's Pass 3 reset undid our move. Pass 3
 * fires on the next React commit (~microtask) and reverts tabLocations
 * to main-drawer when the target container is missing from the host's
 * containers store. The microtask read-back catches the reset.
 */
function watchForContainerPass3Reset(
  bridge: NonNullable<ReturnType<typeof getHostBridge>>,
  tabId: string,
  builtInRoot: HTMLElement,
  afterLoc: { kind: string; containerId?: string } | null,
): void {
  queueMicrotask(() => {
    const microLoc = bridge.ui.getTabLocation?.(tabId) ?? null
    const microContainer = getSecondaryWrapper()?.querySelector('.sidebar-ux-panel-content')
    const rootInContainer = microContainer?.contains(builtInRoot) ?? false
    if (afterLoc?.kind === 'container' && microLoc?.kind === 'main-drawer') {
      dwarn(
        `[tabmove] PASS 3 RESET DETECTED: tabLocations["${tabId}"] was set to ` +
        `${JSON.stringify(afterLoc)} but ContainerTabContent Pass 3 reset it to ` +
        `main-drawer because the target container is missing from Lumiverse's ` +
        `containers store. Fix: ensure the secondary drawer's panel content ` +
        `element is registered via bridge.containers.registerContainer BEFORE ` +
        `the move. (See secondary.tsx:308 — the call exists but may be failing silently.)`
      )
    }
    void rootInContainer
  })
}

/**
 * Build the secondary tab button for a moved built-in tab. Title, icon,
 * and short name are resolved from the bridge + main button.
 */
function addBuiltInSecondaryButton(
  bridge: NonNullable<ReturnType<typeof getHostBridge>>,
  tabId: string,
  builtInRoot: HTMLElement,
): void {
  const mainBtn = findMainTabButton(tabId)
  const title = bridge.ui.getBuiltInTabTitle?.(tabId)
    || mainBtn?.getAttribute('title')
    || tabId
  const iconSvg = mainBtn?.querySelector('svg')?.outerHTML
    ?? builtInRoot.querySelector('svg')?.outerHTML
  const shortName = readMainButtonShortName(mainBtn)
  addSecondaryTabButton({ id: tabId, title, root: builtInRoot, iconSvg, shortName })
}

export async function assignTab(tabId: string, sidebar: 'primary' | 'secondary'): Promise<void> {
  if (sidebar === 'secondary') {
    // Built-in tabs: delegate to the host's requestTabLocation API.
    // Extension tabs fall through to SecondaryDrawer.assignToSecondary.
    const bridge = getHostBridge()
    const builtInRoot = bridge?.ui.getBuiltInTabRoot?.(tabId)
    if (builtInRoot && bridge) {
      // Tag the built-in root BEFORE the host's async move. The
      // data-canvas-moved/active attributes travel with the root when
      // the host reparents it. The CSS rule that hides inactive moved
      // roots is scoped to `.sidebar-ux-panel-content` so the
      // attributes have no effect while the root is still in main.
      // This is what allows showSecondaryTab to drop the F14 safety
      // net and the F15 deferred-activation observer.
      builtInRoot.setAttribute('data-canvas-moved', tabId)
      builtInRoot.setAttribute('data-canvas-active', '')
      armMainDrawerActiveRestore(tabId)
      const preMoveSourceList = await captureSourceList('primary')
      const preMoveActiveTab = isTabActiveInMainDrawer(tabId)

      bridge.ui.requestTabLocation!(tabId, { kind: 'container', containerId: 'canvas-secondary-drawer' })
      const afterLoc = bridge.ui.getTabLocation?.(tabId) ?? null
      watchForContainerPass3Reset(bridge, tabId, builtInRoot, afterLoc)

      // UI side effects: the data-layer move above is invisible to the user
      // without these. See [[orchestrator/canvas-v1-6-6-built-in-move-diagnose]]
      // phase 9 for the symptom history.
      setTabAssignment(tabId, 'secondary')
      hideMainTabButton(tabId)
      addBuiltInSecondaryButton(bridge, tabId, builtInRoot)
      updateDrawerTabVisibility()
      // On mobile, do not auto-open the destination drawer. Otherwise
      // enforceExclusionOnOpen inside openSecondarySidebar clicks the
      // source (currently-open) drawer's toggle button closed. The user
      // stays in the source drawer; runHandoff Part B already activates
      // a neighbor in the source on mobile (activation-handoff.ts:11-13).
      // Destination drawer can be opened manually.
      if (!isSecondarySidebarOpen() && !isMobileViewport()) openSecondarySidebar()
      await runHandoff({tabId, source: 'primary', destination: 'secondary', sourceList: preMoveSourceList, preMoveSourceActiveTab: preMoveActiveTab})
      persistLayout()
      return
    }
    // No bridge, or bridge present but tab isn't a built-in. Treat as
    // extension. SecondaryDrawer's early-guard handles reparented
    // extension tabs; built-in tabs the host doesn't recognize wouldn't
    // have been moveable in the first place, so this is a no-op for them.
    if (!bridge) {
      dwarn(`[tabmove] no host bridge; tabId="${tabId}" treated as extension. Built-in move requires the spindle loader.`)
    }
    const { assignToSecondary } = await import('../sidebar/secondary-drawer')
    const preMoveSourceList = await captureSourceList('primary')
    const preMoveActiveTab = isTabActiveInMainDrawer(tabId)
    await assignToSecondary(tabId)
    await runHandoff({tabId, source: 'primary', destination: 'secondary', sourceList: preMoveSourceList, preMoveSourceActiveTab: preMoveActiveTab})
  } else {
    // Primary restore. For built-ins, also tell the host to reset
    // tabLocations back to main-drawer, otherwise ContainerTabContent
    // will re-move the root back to the container on the next React
    // commit. The local UI side is handled by unassignFromSecondary.
    const bridge = getHostBridge()
    if (bridge?.ui.getBuiltInTabRoot?.(tabId) && bridge.ui.requestTabLocation) {
      bridge.ui.requestTabLocation(tabId, { kind: 'main-drawer' })
    }
    const { unassignFromSecondary } = await import('../sidebar/secondary-drawer')
    const preMoveSourceList = await captureSourceList('secondary')
    const preMoveActiveTab = getActiveSecondaryTabId() === tabId
    await unassignFromSecondary(tabId)
    await runHandoff({tabId, source: 'secondary', destination: 'primary', sourceList: preMoveSourceList, preMoveSourceActiveTab: preMoveActiveTab})
  }
}

