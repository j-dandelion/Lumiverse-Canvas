// Sidebar polish concerns: cross-drawer visual sync and the
// side/registration watchers that keep the secondary wrapper in step
// with the main drawer's lifecycle.
//
// syncDrawerTabSettings / syncSecondaryTabLabels — mirror the main
// drawer's compact mode, vertical position, and tab-label visibility on
// the secondary drawer so the two feel like one surface.
//
// isShowTabLabels — derived from CanvasSettings.showTabLabels (the
// user's explicit Canvas override) or the live Lumiverse store
// (when the override is 'follow').
//
// checkSideChanged / startSideChangeWatcher — 2s poll that detects a
// flip of the main drawer's side in Lumiverse settings and rebuilds
// the secondary wrapper on the opposite edge.
//
// startTabRegistrationWatcher — 3s poll that re-tags main sidebar
// buttons (catches post-MutationObserver registrations) and removes
// _tabAssignments entries when their source extension unregisters.
import { getMainSidebar } from '../dom/lumiverse'
import { getDrawerTabs, getMainDrawerSide, getStoreSnapshot } from '../store'
import { dlog } from '../debug/log'
// FIXME-decomp(step 9): getSecondaryWrapper, isSecondarySidebarOpen,
// mountSecondarySidebar will live in sidebar/secondary.tsx after Step 9.
import { getSecondaryWrapper, isSecondarySidebarOpen, mountSecondarySidebar } from '../sidebar/secondary'
// FIXME-decomp(step 10): getTabAssignments, repositionAssignedTabs will
// live in tabs/assignment.ts after Step 10.
import { getTabAssignments, repositionAssignedTabs } from '../tabs/assignment'
// FIXME-decomp(step 12): persistLayout will live in layout/persist.ts.
import { persistLayout } from '../frontend'  // re-point to '../layout/persist'
// FIXME-decomp(step 14): registerCleanup will live in sidebar/cleanup.ts.
import { registerCleanup } from '../frontend'  // re-point to '../sidebar/cleanup'
// Step 1 complete: getSettings now lives in settings/state.ts.
import { getSettings } from '../settings/state'
// FIXME-decomp(step 5): tagMainSidebarButtons lives in chat/tag-buttons.ts.
import { tagMainSidebarButtons } from '../chat/tag-buttons'
// FIXME-decomp(step 6): addSecondaryTabButton, removeSecondaryTabButton
// live in tabs/buttons.ts.
import { addSecondaryTabButton, removeSecondaryTabButton } from '../tabs/buttons'

let _lastKnownSide: 'left' | 'right' | null = null
let _lastKnownCompact: boolean | null = null
let _lastKnownVerticalPos: number | null = null

// Called by applySettings's mirrorCompactPosition-off path (settings/state).
export function clearDrawerTabLayoutCache(): void {
  _lastKnownCompact = null
  _lastKnownVerticalPos = null
}

/** Read showTabLabels, honoring the user's Canvas override. */
export function isShowTabLabels(): boolean {
  const mode = getSettings().showTabLabels
  if (mode === 'show') return true
  if (mode === 'hide') return false
  // 'follow' (default) — read from the store snapshot or main sidebar DOM.
  const store = getStoreSnapshot()
  if (store && typeof (store as any).drawerSettings === 'object' && (store as any).drawerSettings !== null) {
    return !!(store as any).drawerSettings.showTabLabels
  }
  // Fallback: check if main sidebar buttons have the labeled class
  const sidebar = getMainSidebar()
  if (sidebar) {
    const labeledBtn = sidebar.querySelector('button[class*="tabBtnLabeled"]')
    if (labeledBtn) return true
  }
  return false
}

export function syncDrawerTabSettings(): void {
  const drawerTab = getSecondaryWrapper()?.querySelector('.sidebar-ux-drawer-tab') as HTMLElement
  if (!drawerTab) return

  // Read settings from the main sidebar's drawer tab DOM directly
  const mainDrawerTab = document.querySelector('[class*="_drawerTab_"]:not(.sidebar-ux-drawer-tab)') as HTMLElement
  if (!mainDrawerTab) return

  // Detect compact from main drawer tab width
  const mainWidth = mainDrawerTab.offsetWidth
  const isCompact = mainWidth <= 36

  // Detect vertical position from main drawer tab margin
  const mainParent = mainDrawerTab.parentElement
  const verticalPos = mainParent ? parseFloat(getComputedStyle(mainDrawerTab).marginTop) / window.innerHeight * 100 : 0
  // Use the raw vh value from the style attribute if available
  const mainMarginStyle = mainDrawerTab.style.marginTop
  const posVh = mainMarginStyle ? parseFloat(mainMarginStyle) : 0

  // Sync compact state via CSS class (width/padding/gap handled by CSS rules)
  if (_lastKnownCompact !== isCompact) {
    drawerTab.classList.toggle('sidebar-ux-drawer-tab--compact', isCompact)
    _lastKnownCompact = isCompact
  }

  if (_lastKnownVerticalPos !== posVh) {
    drawerTab.style.marginTop = `${posVh}vh`
    _lastKnownVerticalPos = posVh
  }

  // Sync active state via CSS class (background/border/color handled by CSS rules)
  drawerTab.classList.toggle('sidebar-ux-drawer-tab--active', isSecondarySidebarOpen())

  // Sync tab labels with showTabLabels setting
  syncSecondaryTabLabels()
}

/** Update all secondary tab buttons' label visibility to match showTabLabels. */
export function syncSecondaryTabLabels(): void {
  const showLabels = isShowTabLabels()
  const labels = getSecondaryWrapper()?.querySelectorAll('.sidebar-ux-tab-label') as NodeListOf<HTMLElement>
  if (!labels) return
  for (const label of labels) {
    label.style.opacity = showLabels ? '1' : '0'
    label.style.height = showLabels ? 'auto' : '0'
    label.style.marginTop = showLabels ? '1px' : '0'
  }
}

export function checkSideChanged(): void {
  const currentSide = getMainDrawerSide()
  if (_lastKnownSide !== null && _lastKnownSide !== currentSide) {
    // Side changed — need to recreate secondary sidebar
    unmountSecondarySidebar()
    mountSecondarySidebar()
    // Restore tab buttons for every tab still assigned to secondary. The
    // new wrapper is empty after mountSecondarySidebar() (createSecondarySidebar
    // only builds the chrome), so without this the tab list is blank until
    // the user re-drags every tab. _tabAssignments is the source of truth
    // for what's been moved; the actual store data (iconSvg, root, etc.)
    // comes from getDrawerTabs() inside addSecondaryTabButton.
    restoreSecondaryTabButtons()
    repositionAssignedTabs()
  }
  _lastKnownSide = currentSide
  syncDrawerTabSettings()
}

// The unmountSecondarySidebar call in checkSideChanged needs to be in scope.
// Re-import from the transient entry — sidebar/secondary.tsx owns it
// after Step 9; the import statement will be a direct one by then.
import { unmountSecondarySidebar } from '../sidebar/secondary'

/**
 * Re-create secondary tab buttons for every tab currently assigned to the
 * secondary sidebar. Used after the wrapper is recreated (e.g. on a
 * drawer-side flip) so the tab list is restored from the persisted
 * `_tabAssignments` map without requiring the user to re-drag tabs.
 *
 * Mirrors the per-tab button creation in `applyAssignment` → `secondary`,
 * but in a single pass over the assignments map.
 */
export function restoreSecondaryTabButtons(): void {
  const tabs = getDrawerTabs()
  if (!tabs || tabs.length === 0) return
  for (const [tabId, sidebar] of getTabAssignments()) {
    if (sidebar !== 'secondary') continue
    const tab = tabs.find(t => t.id === tabId)
    if (tab) addSecondaryTabButton(tab)
  }
}

let _sideCheckInterval: ReturnType<typeof setInterval> | null = null

export function startSideChangeWatcher(): void {
  if (_sideCheckInterval !== null) return // already running
  _lastKnownSide = getMainDrawerSide()
  _sideCheckInterval = setInterval(checkSideChanged, 2000)
  registerCleanup(() => stopSideChangeWatcher())
}

export function stopSideChangeWatcher(): void {
  if (_sideCheckInterval === null) return
  clearInterval(_sideCheckInterval)
  _sideCheckInterval = null
}

// Tab registration watcher (handles extension unregistration)
let _tabRegInterval: ReturnType<typeof setInterval> | null = null
let _tabRegPrevIds: Set<string> = new Set()

export function startTabRegistrationWatcher(): void {
  if (_tabRegInterval !== null) return // already running
  _tabRegPrevIds = new Set<string>()

  const check = () => {
    // Re-tag any main sidebar buttons that weren't tagged on the first pass.
    // This catches the case where the store's drawerTabs array was still
    // being populated when tagMainSidebarButtons() first ran from the
    // MutationObserver — the watcher's 3s poll gives the store time to
    // settle.
    tagMainSidebarButtons()

    const currentTabs = getDrawerTabs()
    const currentIds = new Set(currentTabs.map(t => t.id))

    // Check for removed tabs (only when auto-cleanup is enabled).
    if (getSettings().autoCleanupOnUninstall) {
      for (const oldId of _tabRegPrevIds) {
        if (!currentIds.has(oldId) && getTabAssignments().has(oldId)) {
          dlog(`Extension tab ${oldId} was removed, cleaning up`)
          ;(getTabAssignments() as Map<string, 'primary' | 'secondary'>).delete(oldId)
          removeSecondaryTabButton(oldId)
          persistLayout()
        }
      }
    }

    _tabRegPrevIds = currentIds
  }

  _tabRegInterval = setInterval(check, 3000)
  registerCleanup(() => stopTabRegistrationWatcher())
}

export function stopTabRegistrationWatcher(): void {
  if (_tabRegInterval === null) return
  clearInterval(_tabRegInterval)
  _tabRegInterval = null
}
