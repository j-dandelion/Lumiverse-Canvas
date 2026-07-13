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
// isShowTabLabels — reads the live Lumiverse store for the host
// main-drawer showTabLabels setting. The Canvas tri-state override
// (showTabLabels) was removed — the second drawer always follows
// the host main-drawer setting.
//
// checkSideChanged / startSideChangeWatcher — 2s poll that detects a
// flip of the main drawer's side in Lumiverse settings and rebuilds
// the secondary wrapper on the opposite edge.
//
// startTabRegistrationWatcher — 3s poll that re-tags main sidebar
// buttons (catches post-MutationObserver registrations) and removes
// _tabAssignments entries when their source extension unregisters.

import { getMainSidebar, getMainWrapper } from '../dom/lumiverse'
import { getHostDrawerSettings } from '../dom/host-settings'
import {
  getDrawerTabs,
  getMainDrawerSide,
  getStoreSnapshot,
  asDrawerStore,
  findStoreData,
  setMainDrawerSideOverride,
  getMainDrawerSideOverride,
} from '../store'
import { dlog, dwarn } from '../debug/log'
// NOTE: secondary.tsx imports from this module (bidirectional). Both modules
// only call each other from inside function bodies — never at module init time.
// Keep it that way to avoid initialization races.
import { getSecondaryWrapper, isSecondarySidebarOpen, mountSecondarySidebar, unmountSecondarySidebar } from '../sidebar/secondary'
import { getMainMirrorWrapper, isCanvasMainOpen, isMainMirrorActive } from './main-mirror-drawer'
import { getTabAssignments, deleteTabAssignment } from '../tabs/assignment'
import { persistLayout } from '../layout/persist'
import { registerCleanup } from '../sidebar/cleanup'
import { getSettings } from '../settings/state'
import { tagMainSidebarButtons } from '../chat/tag-buttons'
import { addSecondaryTabButton, removeSecondaryTabButton, showSecondaryTab, updateDrawerTabVisibility, findMainTabButton } from '../tabs/buttons'
import { getActiveSecondaryTabId } from '../tabs/active-tab'
import { drawerObserver } from './drawer-observer'

let _lastKnownSide: 'left' | 'right' | null = null
let _lastKnownVerticalPos: number | null = null
let _mainDrawerTabResizeObserver: ResizeObserver | null = null
let _mainDrawerTabClassObserver: MutationObserver | null = null
let _mainDrawerTabStyleObserver: MutationObserver | null = null

// Coalescing: when syncDrawerTabSettings is called multiple times in the
// same tick (from ResizeObserver, 2x MutationObserver, 2s setInterval, and
// external callers), only one body run per frame. The previous code allowed
// 12+ redundant calls per tick, each logging 'enter' and re-stamping 8 CSS
// vars on the secondary wrapper.
let _syncPending = false
// Cache the serialized 8-dim value of the secondary wrapper's CSS vars.
// Skip the 8 setProperty calls when nothing changed (the hot path during
// a drag — only the actual drag ticks change the values).
let _lastWrittenDrawerTabVars: string | null = null
// Cache show/hide for syncSecondaryTabLabels. When showLabels is constant,
// skip the per-label opacity/height/marginTop re-stamp.
let _lastWrittenLabelsKey: string | null = null

/** Read showTabLabels from the host store / DOM (no Canvas tri-state override). */
export function isShowTabLabels(): boolean {
  // Prefer host-settings cache: patchHostDrawerSettings updates it
  // synchronously, while the React fiber snapshot (getStoreSnapshot) can
  // lag until the next commit. Without this, post-patch sync re-reads the
  // old value and secondary/mirror labels never flip.
  const host = getHostDrawerSettings()
  if (host && typeof host.showTabLabels === 'boolean') {
    return host.showTabLabels
  }
  // Fiber store snapshot (may lag after a direct setSetting write).
  const store = getStoreSnapshot()
  if (store) {
    const snapshot = asDrawerStore(store)
    if (snapshot.drawerSettings && typeof snapshot.drawerSettings.showTabLabels === 'boolean') {
      return snapshot.drawerSettings.showTabLabels
    }
  }
  // Fallback: host toggles tabBtnLabeled on main buttons. If the main
  // sidebar is mounted, its class state is authoritative.
  const sidebar = getMainSidebar()
  if (sidebar) {
    return !!sidebar.querySelector('button[class*="tabBtnLabeled"]')
  }
  // Host default when main sidebar is not yet in the DOM
  // (ViewportDrawer: drawerSettings.showTabLabels ?? true).
  return true
}

export function syncDrawerTabSettings(): void {
  if (_syncPending) return
  _syncPending = true
  requestAnimationFrame(() => {
    _syncPending = false
    _runSyncDrawerTabSettings()
  })
}

function _runSyncDrawerTabSettings(): void {
  // Secondary and/or Canvas main-mirror edge toggles. Either may be absent
  // (second drawer off, taskbarMode off) — still sync the other.
  const drawerTab = getSecondaryWrapper()?.querySelector('.sidebar-ux-drawer-tab') as HTMLElement | null
  const mainMirrorWrapperEarly = getMainMirrorWrapper()
  if (!drawerTab && !mainMirrorWrapperEarly) return

  // Bug fix (2026-06-19, follow-up): scope the main-drawer-tab query to
  // the main WRAPPER rather than the whole document. The previous
  // `document.querySelector('[class*="_drawerTab_"]:not(.sidebar-ux-drawer-tab)')`
  // was returning the FIRST element in the document with `_drawerTab_` in
  // its class. After a drawer-side change, Lumiverse re-renders the main
  // drawer, and there can be transient elements in the DOM (e.g. during
  // a multi-step transition, the old main drawer tab may still be in the
  // tree with a class like `_drawerTabOld_abc`, OR a wrapper element may
  // briefly have a class containing `_drawerTab_`). The wrong element's
  // `offsetWidth` can be very large (e.g. 420px for the full drawer width
  // or the full viewport), and the CSS vars get stamped to that value —
  // the secondary's open/close drawer tab then renders at 420px wide,
  // the "open/close tab becomes large" symptom reported on 2026-06-19.
  //
  // Scoping to `getMainWrapper()` (the Lumiverse wrapper element) means
  // we only consider the main drawer's own drawer tab, never a transient
  // or unrelated element elsewhere in the document. `getMainWrapper()`
  // reads the DOM class (wrapperLeft / wrapperRight) so it's stable
  // across re-renders.
  //
  // Fallback: if the wrapper isn't mounted yet (very early mount, before
  // Lumiverse has rendered the wrapper element), fall back to the
  // document-level query so the sync still works. The validation below
  // catches the "wrong element" case even at the document level.
  let mainDrawerTab: HTMLElement | null = null
  const mainWrapper = getMainWrapper()
  if (mainWrapper) {
    mainDrawerTab = mainWrapper.querySelector(
      '[class*="_drawerTab_"]:not(.sidebar-ux-drawer-tab)'
    ) as HTMLElement | null
  }
  if (!mainDrawerTab) {
    mainDrawerTab = document.querySelector(
      '[class*="_drawerTab_"]:not(.sidebar-ux-drawer-tab)'
    ) as HTMLElement | null
  }
  if (!mainDrawerTab) {
    // Retry on the next frame. Bypass the coalesce gate — the retry must
    // actually fire even if the wrapper is still mid-coalesce.
    requestAnimationFrame(() => _runSyncDrawerTabSettings())
    return
  }

  // Bug fix (2026-06-19, follow-up): validate the read dimensions. The
  // main drawer's `.drawerTab` is 48px wide (or 32px in compact mode).
  // Anything outside [16, 120]px is almost certainly the wrong element
  // (e.g. the drawer, the wrapper, or a transient transition node). Fall
  // back to Lumiverse's documented defaults rather than stamping
  // garbage values that make the secondary's drawer tab render as a
  // full-width slab.
  const w = mainDrawerTab.offsetWidth
  const h = mainDrawerTab.offsetHeight
  if (w < 16 || w > 120 || h < 16 || h > 400) {
    dlog(`[drawer-sync] main drawer tab dimensions look wrong (w=${w} h=${h}), skipping mirror`)
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

      syncDrawerTabSettings()
    })
    _mainDrawerTabStyleObserver.observe(mainDrawerTab, { attributes: true, attributeFilter: ['style'] })
    registerCleanup(stopDrawerTabStyleObserver)
  }

  // Mirror dimensions — GUARDED. Cache the 8 values as a serialized string.
  // Stamp onto secondary AND main-mirror wrappers so both edge toggles match host.
  const secondaryWrapper = getSecondaryWrapper()
  const mainMirrorWrapper = getMainMirrorWrapper()
  const mainStyle = getComputedStyle(mainDrawerTab)
  const newVars = [
    `${mainDrawerTab.offsetWidth}px`,
    `${mainDrawerTab.offsetHeight}px`,
    mainStyle.paddingTop,
    mainStyle.paddingRight,
    mainStyle.paddingBottom,
    mainStyle.paddingLeft,
    mainStyle.gap,
    `${mainStyle.borderTopWidth} solid var(--lumiverse-border-hover)`,
  ].join('|')
  if (newVars !== _lastWrittenDrawerTabVars) {
    _lastWrittenDrawerTabVars = newVars
    const parts = newVars.split('|')
    const stamp = (wrapper: HTMLElement) => {
      wrapper.style.setProperty('--sidebar-ux-drawer-tab-w', parts[0])
      wrapper.style.setProperty('--sidebar-ux-drawer-tab-h', parts[1])
      wrapper.style.setProperty('--sidebar-ux-drawer-tab-pt', parts[2])
      wrapper.style.setProperty('--sidebar-ux-drawer-tab-pr', parts[3])
      wrapper.style.setProperty('--sidebar-ux-drawer-tab-pb', parts[4])
      wrapper.style.setProperty('--sidebar-ux-drawer-tab-pl', parts[5])
      wrapper.style.setProperty('--sidebar-ux-drawer-tab-gap', parts[6])
      wrapper.style.setProperty('--sidebar-ux-drawer-tab-border', parts[7])
    }
    if (secondaryWrapper) stamp(secondaryWrapper)
    if (mainMirrorWrapper) stamp(mainMirrorWrapper)
  } else {
    // First paint of main mirror after vars already cached — still stamp once.
    if (mainMirrorWrapper && !mainMirrorWrapper.style.getPropertyValue('--sidebar-ux-drawer-tab-w')) {
      const parts = newVars.split('|')
      mainMirrorWrapper.style.setProperty('--sidebar-ux-drawer-tab-w', parts[0])
      mainMirrorWrapper.style.setProperty('--sidebar-ux-drawer-tab-h', parts[1])
      mainMirrorWrapper.style.setProperty('--sidebar-ux-drawer-tab-pt', parts[2])
      mainMirrorWrapper.style.setProperty('--sidebar-ux-drawer-tab-pr', parts[3])
      mainMirrorWrapper.style.setProperty('--sidebar-ux-drawer-tab-pb', parts[4])
      mainMirrorWrapper.style.setProperty('--sidebar-ux-drawer-tab-pl', parts[5])
      mainMirrorWrapper.style.setProperty('--sidebar-ux-drawer-tab-gap', parts[6])
      mainMirrorWrapper.style.setProperty('--sidebar-ux-drawer-tab-border', parts[7])
    }
  }

  // Detect vertical position from main drawer tab margin
  const mainParent = mainDrawerTab.parentElement
  const verticalPos = mainParent ? parseFloat(getComputedStyle(mainDrawerTab).marginTop) / window.innerHeight * 100 : 0
  // Use the raw vh value from the style attribute if available
  const mainMarginStyle = mainDrawerTab.style.marginTop
  const posVh = mainMarginStyle ? parseFloat(mainMarginStyle) : 0

  if (_lastKnownVerticalPos !== posVh) {
    const settings = getSettings()

    if (settings.mirrorCompactPosition) {
      if (drawerTab) drawerTab.style.marginTop = `${posVh}vh`
      // Canvas main edge toggle tracks host vertical position too.
      const mainMirrorTab = mainMirrorWrapper?.querySelector('.sidebar-ux-drawer-tab') as HTMLElement | null
      if (mainMirrorTab) mainMirrorTab.style.marginTop = `${posVh}vh`
    } else if (settings.secondaryDrawerTabOverrideVh === undefined) {
      if (drawerTab) drawerTab.style.marginTop = ''  // mirror off, no override → clear
    }
    _lastKnownVerticalPos = posVh
  }

  // Sync active state via CSS class (background/border/color handled by CSS rules)
  if (drawerTab) {
    drawerTab.classList.toggle('sidebar-ux-drawer-tab--active', isSecondarySidebarOpen())
  }
  const mainMirrorTab = mainMirrorWrapper?.querySelector('.sidebar-ux-drawer-tab') as HTMLElement | null
  if (mainMirrorTab && isMainMirrorActive()) {
    mainMirrorTab.classList.toggle('sidebar-ux-drawer-tab--active', isCanvasMainOpen())
  }

  // Sync tab labels with showTabLabels setting
  syncSecondaryTabLabels()
}

/**
 * Update all secondary + main-mirror tab buttons' label visibility to match
 * showTabLabels.
 *
 * @param forceShow — when provided (e.g. right after patchHostDrawerSettings),
 *   apply this visibility instead of re-reading store/fiber, which can still
 *   hold the pre-write value until React commits. Forced writes also skip the
 *   last-written cache so a previous no-op (0 labels found / remount race)
 *   cannot leave secondary labels stuck visible.
 */
export function syncSecondaryTabLabels(forceShow?: boolean): void {
  const showLabels = typeof forceShow === 'boolean' ? forceShow : isShowTabLabels()
  const cacheKey = showLabels ? 'show' : 'hide'
  const forced = typeof forceShow === 'boolean'
  // Unforced path: skip when nothing changed. Forced path always re-stamps.
  if (!forced && cacheKey === _lastWrittenLabelsKey) return
  _lastWrittenLabelsKey = cacheKey

  // Host uses CSS-module `.tabLabel_*`. Only Canvas secondary / main-mirror
  // (and their pin hosts) use `.sidebar-ux-tab-label`. Query the whole
  // document so taskbar reparent (list outside the secondary wrapper) and
  // dual pin hosts cannot miss live buttons.
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return

  const labels = document.querySelectorAll('.sidebar-ux-tab-label')
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i] as HTMLElement
    if (showLabels) {
      label.style.display = ''
      label.style.visibility = 'visible'
      label.style.opacity = '1'
      label.style.height = 'auto'
      label.style.minHeight = ''
      label.style.marginTop = '1px'
    } else {
      // Host unmounts the label span. We keep the node but must fully
      // collapse it: flex items default to min-height:auto, so height:0
      // alone does not shrink below text; opacity:0 alone can look like a
      // failed toggle if a later style write restores opacity.
      label.style.display = 'none'
      label.style.visibility = 'hidden'
      label.style.opacity = '0'
      label.style.height = '0'
      label.style.minHeight = '0'
      label.style.marginTop = '0'
    }
    const btn = label.closest(
      'button[data-tab-id], button.sidebar-ux-main-tab-mirror-btn',
    ) as HTMLElement | null
    if (btn) {
      btn.classList.toggle('sidebar-ux-tab-labeled', showLabels)
      // Keep square geometry in sync with labeled class (secondary + main).
      btn.style.height = showLabels ? '56px' : '48px'
    }
  }

  // Main-mirror omits `.sidebar-ux-tab-label` while labels are off (no flex
  // gap). Stamping existing labels alone cannot Show them on mirror — rebuild
  // mirror HTML from host settings. Hide drops spans again on reconcile.
  // Dynamic import avoids a static cycle (main-tab-pin → isShowTabLabels).
  void import('./main-tab-pin').then((m) => {
    try {
      m.reconcileMainTabListPin()
    } catch {
      /* ignore teardown races */
    }
  })
}

export function checkSideChanged(): void {
  const currentSide = getMainDrawerSide()
  if (_lastKnownSide !== null && _lastKnownSide !== currentSide) {
    // Capture open state BEFORE unmount — unmountSecondarySidebar()
    // unconditionally sets _secondarySidebarOpen = false.
    const wasOpen = isSecondarySidebarOpen()
    unmountSecondarySidebar()
    // Bug fix (2026-06-19): invalidate caches and stop observers BEFORE
    // mounting the new wrapper. The new wrapper has no CSS variables set
    // (its style.cssText doesn't include them) and no observers attached
    // to the new main drawer tab element. Without this reset:
    //   1. _runSyncDrawerTabSettings computes newVars from the (possibly
    //      new) main drawer tab, but newVars === _lastWrittenDrawerTabVars
    //      (same dimensions, same padding, etc.) — the cache check at
    //      line 159 short-circuits and the setProperty calls at lines
    //      162-169 are SKIPPED. The new wrapper's drawer tab then falls
    //      back to CSS defaults: width=48px, height=auto — the "open/close
    //      tab becomes large" symptom reported on drawer side change.
    //   2. _mainDrawerTabResizeObserver / _mainDrawerTabClassObserver /
    //      _mainDrawerTabStyleObserver point at the OLD main drawer tab
    //      (now detached). Subsequent syncs (drag resize, compact mode
    //      toggle) never fire because the observers don't see mutations
    //      on the new main drawer tab element.
    //   3. _lastWrittenLabelsKey short-circuits the label visibility
    //      update similarly (showLabels is a boolean so the cache key is
    //      stable across mounts, but the new wrapper has no labels
    //      styled yet).
    // Resetting all three forces a full re-write on the new wrapper.
    _lastWrittenDrawerTabVars = null
    _lastWrittenLabelsKey = null
    _lastKnownVerticalPos = null
    stopDrawerTabResizeWatcher()
    stopDrawerTabClassObserver()
    stopDrawerTabStyleObserver()
    // Force-walk the store so the rebuilt wrapper's tab buttons can find
    // their tabs. The 3s cache (store/index.ts:97) may be stale or
    // reference elements that were unmounted by Lumiverse's side-change
    // re-render. getDrawerTabs() below will do a fresh fiber walk.
    findStoreData(true)
    mountSecondarySidebar({ initialOpen: wasOpen })
    // Reposition main-drawer mirror pin on the new main edge (does not
    // reparent host DOM). Secondary pin is reconciled inside mount.
    void import('./main-tab-pin').then((m) => m.reconcileMainTabListPin())
    // Restore tab buttons for every tab still assigned to secondary. The
    // new wrapper is empty after mountSecondarySidebar() (createSecondarySidebar
    // only builds the chrome), so without this the tab list is blank until
    // the user re-drags every tab. _tabAssignments is the source of truth
    // for what's been moved; the actual store data (iconSvg, root, etc.)
    // comes from getDrawerTabs() inside addSecondaryTabButton.
    restoreSecondaryTabButtons()
    // Re-attach the moved tab roots to the freshly-mounted wrapper.
    // assignToSecondary hits the primary path (root not yet in the new
    // content) for each tab, appendChild-ing the root and re-tagging it.
    // Fire-and-forget — DOM work is synchronous inside the async function.
    import('../sidebar/secondary-drawer').then(({ assignToSecondary }) => {
      for (const [tabId, side] of getTabAssignments()) {
        if (side === 'secondary') assignToSecondary(tabId).catch(() => {})
      }
    })
    // The drawerTab handle is created with display:none (secondary.tsx:112)
    // and only becomes visible when this function runs. Without this call,
    // the clickable edge handle stays hidden after the wrapper is recreated.
    updateDrawerTabVisibility()
    // The new wrapper has a hardcoded title "Second drawer" (secondary.tsx:225).
    // On initial mount, applyLayout (apply.ts:226) calls showSecondaryTab()
    // to set the title to the active tab's name — but that path is not reached
    // on a side-change remount. Calling showSecondaryTab here restores the
    // header text and the active state on tab buttons (sidebar-ux-tab-active
    // class, box-shadow indicator, icon/label color) which are also lost
    // because addSecondaryTabButton doesn't set the active class.
    //
    // Guard: only call if there's an active tab that's still assigned to
    // secondary. Without this guard, a stale _activeSecondaryTabId (active
    // tab was moved out before the side change) would cause showSecondaryTab
    // to mark a non-existent button as active.
    const activeTabId = getActiveSecondaryTabId()
    if (activeTabId !== null) {
      const assignments = getTabAssignments()
      if (assignments.get(activeTabId) === 'secondary') {
        showSecondaryTab(activeTabId)
      }
    }
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
 * Mirrors the per-tab button creation in `assignToSecondary`,
 * but in a single pass over the assignments map.
 */
export function restoreSecondaryTabButtons(): void {
  const tabs = getDrawerTabs()
  for (const [tabId, sidebar] of getTabAssignments()) {
    if (sidebar !== 'secondary') continue
    // Exact-match first (canonical path).
    let tab = tabs && tabs.find(t => t.id === tabId)
    if (!tab && tabs) {
      // Suffix-drift fallback: Lumiverse assigns a session-variant suffix
      // (:1, :2, :3) to extension tab ids. The assignment map may have an
      // older suffix than the live store (e.g., the wrapper was just
      // recreated after a side change and the extension re-registered
      // with a new suffix). Strip the trailing :N from both the stored
      // id and each live id, then match by the stripped prefix. If
      // exactly one live id matches, use it.
      const stripSuffix = (id: string): string => {
        const lastColon = id.lastIndexOf(':')
        if (lastColon <= 0) return id
        const tail = id.slice(lastColon + 1)
        return /^\d+$/.test(tail) ? id.slice(0, lastColon) : id
      }
      const storedPrefix = stripSuffix(tabId)
      const candidates = tabs.filter(t => stripSuffix(t.id) === storedPrefix)
      if (candidates.length === 1) {
        tab = candidates[0]
        dlog(`restoreSecondaryTabButtons: suffix-drift fallback matched stored "${tabId}" -> live "${tab.id}"`)
      }
    }
    if (tab) {
      addSecondaryTabButton(tab)
      continue
    }
    // Bug fix (2026-06-19, follow-up): DOM fallback. When the store
    // doesn't have the tab (extension tabs moved to secondary are
    // reparented, so the primary context's store entry may have been
    // removed), fall back to reading the tab
    // data from the main sidebar's button. The main sidebar still
    // renders a button for every tab — even moved-to-secondary tabs
    // (hidden via display:none by hideMainTabButton). The button has
    // data-tab-id, title, and an SVG icon child — enough to build a
    // secondary tab button via addSecondaryTabButton.
    //
    // Without this fallback, the user reports "all of the tab buttons
    // in the second drawer no longer appear" after a drawer-side change
    // when extension tabs are in the secondary drawer.
    const mainBtn = findMainTabButton(tabId) as HTMLElement | null
    if (mainBtn) {
      const id = mainBtn.getAttribute('data-tab-id') || tabId
      const title = mainBtn.getAttribute('title') || tabId
      const svg = mainBtn.querySelector('svg')?.outerHTML
      addSecondaryTabButton({
        id,
        title,
        root: undefined as any, // not used by addSecondaryTabButton body
        iconSvg: svg,
      } as any)
      dlog(`restoreSecondaryTabButtons: DOM-fallback restored tab "${id}" from main sidebar button`)
    } else {
      dwarn(`restoreSecondaryTabButtons: tab "${tabId}" not found in store or main sidebar`)
    }
  }
}

let _sideObserver: MutationObserver | null = null
/** Wrapper node currently observed by _sideObserver (for rebind-on-replace). */
let _observedMainWrapper: HTMLElement | null = null
let _sideWatcherCleanupRegistered = false

/**
 * Force Canvas to remount/reposition for a newly written main drawer side.
 *
 * Used by Configure "Swap drawer locations": patchHostDrawerSettings updates
 * the Zustand store, but host React may lag before flipping wrapperLeft /
 * wrapperRight. getMainDrawerSide prefers live DOM, so without an override
 * checkSideChanged sees no change and secondary + main-mirror stay put.
 *
 * Steps:
 *   1. Install short-lived main-side override (desired).
 *   2. Ensure checkSideChanged remounts (seed _lastKnownSide if needed).
 *   3. Poll briefly for host DOM class to match; clear override when it does
 *      (or after ~800ms timeout).
 *   4. Re-attach the side MutationObserver if the host replaced the wrapper.
 */
export async function applyMainDrawerSideChange(
  desired: 'left' | 'right',
): Promise<void> {
  setMainDrawerSideOverride(desired)

  // Force remount when last-known differs or was never set (tests / early boot).
  // If already aligned with desired, skip remount but still settle override.
  if (_lastKnownSide === null || _lastKnownSide !== desired) {
    if (_lastKnownSide === null) {
      _lastKnownSide = desired === 'left' ? 'right' : 'left'
    }
    try {
      checkSideChanged()
    } catch (err) {
      dwarn('[drawer-sync] applyMainDrawerSideChange remount failed:', err)
    }
  }

  await settleMainDrawerSideDom(desired)
  rebindSideChangeWatcherIfNeeded()
}

/** Read main wrapper side from live class tokens only (ignores override). */
function readMainWrapperSideFromDom(): 'left' | 'right' | null {
  const wrapper = getMainWrapper()
  if (!wrapper) return null
  const cls = wrapper.classList.toString()
  if (cls.includes('wrapperLeft')) return 'left'
  if (cls.includes('wrapperRight')) return 'right'
  // Host sometimes only stamps wrapperLeft for left and omits both tokens on right.
  // Only treat as right when some wrapper* class is present without wrapperLeft.
  if (/\bwrapper\w*/.test(cls) && !cls.includes('wrapperLeft')) return 'right'
  return null
}

/** Wait for host wrapper class to match desired; clear override when settled. */
async function settleMainDrawerSideDom(desired: 'left' | 'right'): Promise<void> {
  const deadline = Date.now() + 800
  while (Date.now() < deadline) {
    if (readMainWrapperSideFromDom() === desired) {
      setMainDrawerSideOverride(null)
      return
    }
    await new Promise<void>((r) => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => r())
      } else {
        setTimeout(() => r(), 16)
      }
    })
  }

  // Timeout: drop override so future Settings UI side changes use live DOM.
  if (getMainDrawerSideOverride() === desired) {
    dwarn(
      `[drawer-sync] applyMainDrawerSideChange: host DOM side did not settle to "${desired}" within 800ms; clearing override`,
    )
    setMainDrawerSideOverride(null)
  }
}

/**
 * Re-attach the side watcher when the host replaces the main wrapper element
 * (React remount). No-op if already observing the live wrapper.
 */
export function rebindSideChangeWatcherIfNeeded(): void {
  const wrapper = getMainWrapper()
  if (!wrapper) return
  if (_sideObserver !== null && _observedMainWrapper === wrapper) return
  // Drop stale observer (disconnected node) and re-observe current wrapper.
  if (_sideObserver !== null) {
    try {
      _sideObserver.disconnect()
    } catch {
      /* ignore */
    }
    _sideObserver = null
    _observedMainWrapper = null
  }
  startSideChangeWatcher()
}

export function startSideChangeWatcher(): void {
  if (_sideObserver !== null) return // already running
  _lastKnownSide = getMainDrawerSide()
  // Observe the main wrapper's class attribute. The host toggles
  // `wrapperLeft` / `wrapperRight` on the wrapper when the user changes
  // drawer side in Lumiverse settings. MutationObserver fires on the
  // real event, so the rebuild happens in <100ms (was: up to 2s on the
  // polling interval). Matches the pattern in main-persist.ts:225-242.
  const wrapper = getMainWrapper()
  if (!wrapper) {
    dwarn('startSideChangeWatcher: no main wrapper found; side changes will not be detected until the wrapper appears')
    return
  }
  _sideObserver = new MutationObserver(() => {
    checkSideChanged()
  })
  _sideObserver.observe(wrapper, { attributes: true, attributeFilter: ['class'] })
  _observedMainWrapper = wrapper
  // Cleanup is registered here (not at call sites) because these functions
  // are also called from settings/panel.ts which doesn't have its own
  // cleanup chain.
  if (!_sideWatcherCleanupRegistered) {
    _sideWatcherCleanupRegistered = true
    registerCleanup(() => stopSideChangeWatcher())
  }
}

export function stopSideChangeWatcher(): void {
  if (_sideObserver === null) return
  _sideObserver.disconnect()
  _sideObserver = null
  _observedMainWrapper = null
}

/** Test-only: seed / read last-known main side for remount-path tests. */
export function __setLastKnownSideForTest(side: 'left' | 'right' | null): void {
  _lastKnownSide = side
}

export function __getLastKnownSideForTest(): 'left' | 'right' | null {
  return _lastKnownSide
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

// Tab registration watcher is now handled by DrawerObserver (drawer-observer.ts)
// which uses a MutationObserver instead of the 3s polling interval.
