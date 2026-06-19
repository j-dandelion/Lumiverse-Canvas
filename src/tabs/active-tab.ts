// Active-tab tracking: which tab is currently active in each sidebar,
// and the moved-tab identification helpers used by the DOM guard.
//
// Extracted from tabs/assignment.ts to reduce file size and isolate
// the active-tab concern from the tab-assignment/policy concerns.

import { findStoreData, getDrawerTabs, getStoreSnapshot } from '../store'
import { getMainSidebar } from '../dom/lumiverse'

/**
 * Discriminated union describing the active-tab state of the main drawer.
 */
export type ActiveTabState =
  | { state: 'closed' }
  | { state: 'active'; id: string }
  | { state: 'other'; id: string }
  | { state: 'unknown' }

export function getActiveTabId(): ActiveTabState {
  // Primary: store snapshot
  findStoreData(true)
  const store = getStoreSnapshot() as { drawerTab?: string | null; drawerOpen?: boolean } | null
  if (store && typeof store.drawerOpen === 'boolean') {
    if (!store.drawerOpen) return { state: 'closed' }
    if (typeof store.drawerTab === 'string') {
      return { state: 'active', id: store.drawerTab }
    }
  }

  // Fallback: DOM-based check
  const sidebar = getMainSidebar()
  if (!sidebar) return { state: 'unknown' }
  const activeBtn = sidebar.querySelector('button[class*="tabBtnActive"]') as HTMLElement | null
  if (!activeBtn) return { state: 'unknown' }
  const activeTitle = activeBtn.getAttribute('title') || ''
  if (!activeTitle) return { state: 'unknown' }

  const tabs = getDrawerTabs()
  const tab = tabs.find((t: any) => t.title === activeTitle)
  if (tab) return { state: 'active', id: tab.id }
  return { state: 'active', id: activeTitle }
}

/**
 * Thin boolean wrapper over getActiveTabId() for callers that only need
 * a yes/no. Prefer getActiveTabId() for new code — the sentinel shape is
 * the authoritative contract.
 *
 * DOM fallback (Q4 fix): the Zustand store can be stale relative to the
 * DOM — a user click on a tab updates the DOM's `tabBtnActive` class
 * synchronously, but the React commit that updates the store can lag by
 * microtask/macrotask. When the store says "not active" but the DOM
 * shows the tab as active, the DOM is the user-visible truth. Without
 * this fallback, runHandoff's preMoveActiveTab check returns false, the
 * source-replacement gate is skipped, and the host's
 * pendingActiveTabReset useEffect then resets the active tab to the
 * first non-moved tab (Profile) — the "always Profile" bug reported
 * after wiring into all 4 paths.
 */
export function isTabActiveInMainDrawer(tabId: string): boolean {
  const active = getActiveTabId()
  if (active.state === 'active' && active.id === tabId) return true
  // DOM validation: when the store says "not active" (or the store is
  // stale), double-check the DOM. If the DOM's active button has the
  // same data-tab-id, the tab is active regardless of what the store
  // says.
  const sidebar = getMainSidebar()
  if (sidebar) {
    const activeBtn = sidebar.querySelector('button[class*="tabBtnActive"]') as HTMLElement | null
    const activeTabId = activeBtn?.getAttribute('data-tab-id') ?? null
    if (activeTabId === tabId) return true
  }
  return false
}

// --- Secondary tab tracking ---

let _activeSecondaryTabId: string | null = null
export function getActiveSecondaryTabId(): string | null { return _activeSecondaryTabId }
export function setActiveSecondaryTabId(tabId: string | null): void { _activeSecondaryTabId = tabId }

// --- Moved-tab identification (v1.3.0 tabId-keyed) ---

// Setter for the tab-assignments map (avoids circular import with assignment.ts).
// Called once by assignment.ts at module init.
let _getTabAssignments: (() => Map<string, 'primary' | 'secondary'>) | null = null
export function _setTabAssignmentsGetter(getter: () => Map<string, 'primary' | 'secondary'>): void {
  _getTabAssignments = getter
}

/**
 * Pure check: returns true iff this tabId is currently assigned to the
 * secondary sidebar. No DOM lookup, no cache dependency.
 */
function isMovedTabId(tabId: string): boolean {
  return _getTabAssignments?.().get(tabId) === 'secondary'
}

/**
 * What the wrapped container methods call. Primary check is the Canvas-owned
 * `data-canvas-moved` attribute set by repositionTab — this works even when
 * getDrawerTabs is broken (LumiScript interference: store returns only the
 * dock panel, so the store-based reverse-lookup misses extension tabs).
 * Falls back to the store-based lookup for nodes that are mounted in the
 * primary but have not been moved (defensive — the attribute is set/removed
 * symmetrically so this branch should rarely fire).
 */
export function isMovedTabNode(node: Node): boolean {
  if (node instanceof Element && node.hasAttribute('data-canvas-moved')) {
    return true
  }
  findStoreData(true)
  const tabs = getDrawerTabs()
  const tab = tabs.find((t: any) => t.root === node)
  if (!tab) return false
  return isMovedTabId(tab.id)
}
