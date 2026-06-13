// Cross-drawer visual sync and the side/registration watchers that keep
// the secondary wrapper in step with the main drawer's lifecycle.
//
// syncDrawerTabSettings / syncSecondaryTabLabels — mirror the main
// drawer's compact mode, vertical position, and tab-label visibility on
// the secondary drawer so the two feel like one surface. The vertical
// position mirror is wired to a MutationObserver on the main tab's
// `style` attribute, so the secondary follows the primary in real time
// during a drag (or when the Lumiverse slider moves). The mirror
// always wins when mirrorCompactPosition is ON, regardless of
// secondaryDrawerTabOverrideVh — the override is a per-tab
// independent value that only takes effect when the mirror is OFF
// (e.g., to set the secondary to a different position than the main).
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
import { getDrawerTabs, getMainDrawerSide, getStoreSnapshot, asDrawerStore } from '../store'
import { dlog } from '../debug/log'
import { getSecondaryWrapper, isSecondarySidebarOpen, mountSecondarySidebar, unmountSecondarySidebar } from '../sidebar/secondary'
import { getTabAssignments, repositionAssignedTabs, deleteTabAssignment } from '../tabs/assignment'
import { persistLayout } from '../layout/persist'
import { registerCleanup } from '../sidebar/cleanup'
import { getSettings } from '../settings/state'
import { tagMainSidebarButtons } from '../chat/tag-buttons'
import { addSecondaryTabButton, removeSecondaryTabButton, updateDrawerTabVisibility } from '../tabs/buttons'

let _lastKnownSide: 'left' | 'right' | null = null
let _lastKnownVerticalPos: number | null = null
let _mainDrawerTabResizeObserver: ResizeObserver | null = null
let _mainDrawerTabClassObserver: MutationObserver | null = null
let _mainDrawerTabStyleObserver: MutationObserver | null = null

/** Read showTabLabels, honoring the user's Canvas override. */
export function isShowTabLabels(): boolean {
  const mode = getSettings().showTabLabels
  if (mode === 'show') return true
  if (mode === 'hide') return false
  // 'follow' (default) — read from the store snapshot or main sidebar DOM.
  const store = getStoreSnapshot()
  if (store) {
    const snapshot = asDrawerStore(store)
    if (snapshot.drawerSettings) {
      return !!snapshot.drawerSettings.showTabLabels
    }
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
  if (!drawerTab) { dlog(`[drawer-sync] syncDrawerTabSettings: secondary tab not found`); return }
  dlog(`[drawer-sync] syncDrawerTabSettings: enter (lastVh=${_lastKnownVerticalPos})`)

  // Read settings from the main sidebar's drawer tab DOM directly
  const mainDrawerTab = document.querySelector('[class*="_drawerTab_"]:not(.sidebar-ux-drawer-tab)') as HTMLElement
  if (!mainDrawerTab) {
    // Retry on the next frame — the main sidebar may not be painted yet
    // (e.g. on first mount or after a side flip).
    requestAnimationFrame(() => syncDrawerTabSettings())
    return
  }

  // Attach ResizeObserver to the main drawer tab so we re-sync whenever
  // the user resizes it (e.g. drag to resize). Only attach once.
  if (!_mainDrawerTabResizeObserver) {
    _mainDrawerTabResizeObserver = new ResizeObserver(() => {
      syncDrawerTabSettings()
    })
    _mainDrawerTabResizeObserver.observe(mainDrawerTab)
    registerCleanup(stopDrawerTabResizeWatcher)
  }

  // Mirror the main drawer's computed dimensions into CSS custom properties
  // on the secondary wrapper, so the secondary tab follows any size change
  // Lumiverse applies (settings, mobile, resize, etc.).
  const secondaryWrapper = getSecondaryWrapper()
  if (secondaryWrapper) {
    const mainStyle = getComputedStyle(mainDrawerTab)
    secondaryWrapper.style.setProperty('--sidebar-ux-drawer-tab-w', `${mainDrawerTab.offsetWidth}px`)
    secondaryWrapper.style.setProperty('--sidebar-ux-drawer-tab-h', `${mainDrawerTab.offsetHeight}px`)
    secondaryWrapper.style.setProperty('--sidebar-ux-drawer-tab-pt', mainStyle.paddingTop)
    secondaryWrapper.style.setProperty('--sidebar-ux-drawer-tab-pr', mainStyle.paddingRight)
    secondaryWrapper.style.setProperty('--sidebar-ux-drawer-tab-pb', mainStyle.paddingBottom)
    secondaryWrapper.style.setProperty('--sidebar-ux-drawer-tab-pl', mainStyle.paddingLeft)
    secondaryWrapper.style.setProperty('--sidebar-ux-drawer-tab-gap', mainStyle.gap)
    // Use borderTopWidth as representative (all sides are same for the main tab)
    secondaryWrapper.style.setProperty('--sidebar-ux-drawer-tab-border', `${mainStyle.borderTopWidth} solid var(--lumiverse-border-hover)`)
  }

  // Attach MutationObserver to the main drawer tab so we re-sync whenever
  // Lumiverse toggles compact mode via a class change. Only attach once.
  if (!_mainDrawerTabClassObserver) {
    _mainDrawerTabClassObserver = new MutationObserver(() => {
      syncDrawerTabSettings()
    })
    _mainDrawerTabClassObserver.observe(mainDrawerTab, { attributes: true, attributeFilter: ['class'] })
    registerCleanup(stopDrawerTabClassObserver)
  }

  // Attach MutationObserver on the main tab's `style` attribute so the
  // secondary follows the main's inline-style changes in real time. This
  // covers two sources of vertical-position change:
  //   1. The drag handler in drawerTabPosition/drag.ts, which writes to
  //      mainDrawerTab.style.marginTop on every pointermove. Without this
  //      observer, the secondary only updates on the 2s checkSideChanged
  //      tick and visibly teleports during a drag.
  //   2. The Lumiverse slider, which writes the same inline style when
  //      the user moves it.
  // MutationObserver is microtask-batched, so 60+ updates/sec coalesce
  // into one sync call per tick. The work in this function is O(1) —
  // read main's style, write secondary's style. Only attach once.
  if (!_mainDrawerTabStyleObserver) {
    _mainDrawerTabStyleObserver = new MutationObserver(() => {
      dlog(`[drawer-sync] style observer fired`)
      syncDrawerTabSettings()
    })
    _mainDrawerTabStyleObserver.observe(mainDrawerTab, { attributes: true, attributeFilter: ['style'] })
    registerCleanup(stopDrawerTabStyleObserver)
  }

  // Detect vertical position from main drawer tab margin
  const mainParent = mainDrawerTab.parentElement
  const verticalPos = mainParent ? parseFloat(getComputedStyle(mainDrawerTab).marginTop) / window.innerHeight * 100 : 0
  // Use the raw vh value from the style attribute if available
  const mainMarginStyle = mainDrawerTab.style.marginTop
  const posVh = mainMarginStyle ? parseFloat(mainMarginStyle) : 0

  if (_lastKnownVerticalPos !== posVh) {
    const settings = getSettings()
    dlog(`[drawer-sync] vertical sync: posVh=${posVh} mirror=${settings.mirrorCompactPosition} override=${settings.secondaryDrawerTabOverrideVh}`)
    if (settings.mirrorCompactPosition) {
      // Mirror always wins when on. The secondaryDrawerTabOverrideVh is
      // a per-tab independent value, but it only takes effect when the
      // mirror is off (see below). This means a stale override from a
      // previous session can't strand the secondary at a wrong position
      // when the user has mirror on and expects the tabs to follow.
      dlog(`[drawer-sync] writing secondary marginTop=${posVh}vh`)
      drawerTab.style.marginTop = `${posVh}vh`
    } else if (settings.secondaryDrawerTabOverrideVh === undefined) {
      drawerTab.style.marginTop = ''  // mirror off, no override → clear
    }
    // else: mirror off, override set → keep the override (do nothing;
    // applyDrawerTabPosition re-writes the override on every settings
    // diff, which is the canonical owner of the secondary's value in
    // this case).
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
    // Toggle labeled class on the parent button so mobile CSS can size it
    const btn = label.closest('button[data-tab-id]') as HTMLElement | null
    if (btn) btn.classList.toggle('sidebar-ux-tab-labeled', showLabels)
  }
}

export function checkSideChanged(): void {
  const currentSide = getMainDrawerSide()
  if (_lastKnownSide !== null && _lastKnownSide !== currentSide) {
    // Capture open state BEFORE unmount — unmountSecondarySidebar()
    // unconditionally sets _secondarySidebarOpen = false.
    const wasOpen = isSecondarySidebarOpen()
    unmountSecondarySidebar()
    mountSecondarySidebar({ initialOpen: wasOpen })
    // Restore tab buttons for every tab still assigned to secondary. The
    // new wrapper is empty after mountSecondarySidebar() (createSecondarySidebar
    // only builds the chrome), so without this the tab list is blank until
    // the user re-drags every tab. _tabAssignments is the source of truth
    // for what's been moved; the actual store data (iconSvg, root, etc.)
    // comes from getDrawerTabs() inside addSecondaryTabButton.
    restoreSecondaryTabButtons()
    repositionAssignedTabs()
    // The drawerTab handle is created with display:none (secondary.tsx:112)
    // and only becomes visible when this function runs. Without this call,
    // the clickable edge handle stays hidden after the wrapper is recreated.
    updateDrawerTabVisibility()
  }
  _lastKnownSide = currentSide
  syncDrawerTabSettings()
}

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
  // Cleanup is registered here (not at call sites) because these functions
  // are also called from settings/panel.ts which doesn't have its own
  // cleanup chain.
  registerCleanup(() => stopSideChangeWatcher())
}

export function stopSideChangeWatcher(): void {
  if (_sideCheckInterval === null) return
  clearInterval(_sideCheckInterval)
  _sideCheckInterval = null
}

export function stopDrawerTabResizeWatcher(): void {
  if (_mainDrawerTabResizeObserver) {
    _mainDrawerTabResizeObserver.disconnect()
    _mainDrawerTabResizeObserver = null
  }
}

export function stopDrawerTabClassObserver(): void {
  if (_mainDrawerTabClassObserver) {
    _mainDrawerTabClassObserver.disconnect()
    _mainDrawerTabClassObserver = null
  }
}

export function stopDrawerTabStyleObserver(): void {
  if (_mainDrawerTabStyleObserver) {
    _mainDrawerTabStyleObserver.disconnect()
    _mainDrawerTabStyleObserver = null
  }
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

    // Clean up stale assignments when an extension is unregistered.
    for (const oldId of _tabRegPrevIds) {
      if (!currentIds.has(oldId) && getTabAssignments().has(oldId)) {
        dlog(`Extension tab ${oldId} was removed, cleaning up`)
        deleteTabAssignment(oldId)
        removeSecondaryTabButton(oldId)
        persistLayout()
      }
    }

    _tabRegPrevIds = currentIds
  }

  _tabRegInterval = setInterval(check, 3000)
  // Cleanup is registered here (not at call sites) because these functions
  // are also called from settings/panel.ts which doesn't have its own
  // cleanup chain.
  registerCleanup(() => stopTabRegistrationWatcher())
}

export function stopTabRegistrationWatcher(): void {
  if (_tabRegInterval === null) return
  clearInterval(_tabRegInterval)
  _tabRegInterval = null
}
