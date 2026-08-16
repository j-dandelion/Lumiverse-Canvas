// Active-tab tracking: which tab is currently active in each sidebar.
//
// Extracted from tabs/assignment.ts to reduce file size and isolate
// the active-tab concern from the tab-assignment/policy concerns.

import { findStoreData, getDrawerTabs, getStoreSnapshot } from '../store'
import { getMainSidebar } from '../dom/lumiverse'
import {
  getMainMirrorActiveTabId,
  isMainTabPinEnabled,
} from '../sidebar/main-tab-pin'

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
 * User-visible primary active tab id — **single source of truth** for
 * rClick assignTab, live DnD, and Configure quiet commit handoff.
 *
 * Taskbar main-mirror (pin on): only the Canvas exclusive key counts.
 * Host `tabBtnActive` often stays on a parked/top tab while the strip
 * highlights a different tab. Key null = no selection (do not fall back
 * to host) so closed-strip moves do not force-activate a park target.
 *
 * Pin off: prefer live host DOM `tabBtnActive` (user-visible, sync on
 * click) over Zustand store (can lag a frame). Store is the fallback
 * when DOM has no active button.
 *
 * STALENESS WARNING (2026-07-31): the host drawer's tabBtnActive can stay
 * on a stale tab (often the persisted primary.tabId, e.g. "Databank")
 * long after the user clicked elsewhere, and after a move the host's
 * pendingActiveTabReset marks the FIRST remaining tab. Callers must treat
 * a host-flagged active as suspect when its observed location is not the
 * primary side — adoptActive in core/reduce.ts enforces exactly that.
 */
export function resolvePrimaryActiveTabId(): string | null {
  if (isMainTabPinEnabled()) {
    return getMainMirrorActiveTabId()
  }

  const sidebar = getMainSidebar()
  if (sidebar) {
    const activeBtn = sidebar.querySelector(
      'button.tabBtnActive, button[class*="tabBtnActive"]',
    ) as HTMLElement | null
    const id =
      activeBtn?.getAttribute('data-tab-id')
      || activeBtn?.getAttribute('title')
      || null
    if (id) return id
  }

  const active = getActiveTabId()
  if (active.state === 'active') return active.id
  return null
}

/**
 * Thin boolean wrapper over resolvePrimaryActiveTabId() for callers that
 * only need a yes/no. Prefer getActiveTabId() / resolvePrimaryActiveTabId()
 * when the full state or id is needed.
 *
 * Used by rClick assignTab, activation handoff, and Configure/live-DnD
 * quiet commit so wasActive / inactive-preserve share one policy.
 */
export function isTabActiveInMainDrawer(tabId: string): boolean {
  const id = resolvePrimaryActiveTabId()
  return id != null && id === tabId
}

// --- Secondary tab tracking ---

let _activeSecondaryTabId: string | null = null
export function getActiveSecondaryTabId(): string | null { return _activeSecondaryTabId }
export function setActiveSecondaryTabId(tabId: string | null): void { _activeSecondaryTabId = tabId }
