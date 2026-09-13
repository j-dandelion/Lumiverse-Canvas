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
// checkSideChanged / startSideChangeWatcher — wrapper-class observer +
// 500ms host-settings watcher that detect a main drawer side flip
// (Canvas swap, boot restore, or Lumiverse's own "Drawer side" setting)
// and apply it as CSS-only geometry: applyCanvasSideChange restyles both
// Canvas shells in place — no remount, no container churn (S4).
//
// startTabRegistrationWatcher — 3s poll that re-tags main sidebar
// buttons (catches post-MutationObserver registrations) and removes
// _tabAssignments entries when their source extension unregisters.

import { getMainSidebar, getMainWrapper } from '../dom/lumiverse'
import { getHostDrawerSettings, patchHostDrawerSettings } from '../dom/host-settings'
import {
  getDrawerTabs,
  getMainDrawerSide,
  getStoreSnapshot,
  asDrawerStore,
  setMainDrawerSideOverride,
  getMainDrawerSideOverride,
} from '../store'
import { dlog, dwarn } from '../debug/log'
// NOTE: secondary.tsx imports from this module (bidirectional). Both modules
// only call each other from inside function bodies — never at module init time.
// Keep it that way to avoid initialization races.
import {
  getSecondaryWrapper,
  isSecondarySidebarOpen,
  restyleSecondaryShellSide,
} from '../sidebar/secondary'
import {
  getMainMirrorDrawer,
  getMainMirrorPanel,
  getMainMirrorTabList,
  getMainMirrorWrapper,
  isCanvasMainOpen,
  isMainMirrorActive,
  restyleMainShellSide,
} from './main-mirror-drawer'
import { getTabAssignments } from '../tabs/assignment'
import { registerCleanup } from '../sidebar/cleanup'
import { getSettings, isHorizontalStrip } from '../settings/state'
import { applyTabListPosition, reconcileTabListPin } from './tab-position'
import { tagMainSidebarButtons } from '../chat/tag-buttons'
import { addSecondaryTabButton, removeSecondaryTabButton, updateDrawerTabVisibility, findMainTabButton, hideMainTabButton } from '../tabs/buttons'
import { drawerObserver } from './drawer-observer'

/**
 * Unified observation bus that batches all DOM change signals into a single
 * requestAnimationFrame callback. Replaces the previous pattern of 4 separate
 * observers each calling syncDrawerTabSettings() independently.
 *
 * Signal kinds:
 * - 'resize': ResizeObserver on main drawer tab (dimensions change)
 * - 'class': MutationObserver on main drawer tab class (compact mode toggle)
 * - 'style': MutationObserver on main drawer tab style (vertical position)
 * - 'side': MutationObserver on main wrapper class (side change)
 *
 * Heavy signals ('side') always trigger their own handler (checkSideChanged).
 * Light signals ('resize', 'class', 'style') are coalesced into a single
 * syncDrawerTabSettings() call.
 */
class ObserverCoordinator {
  private pending = new Map<string, unknown>()
  private frame: number | null = null
  private _stopped = false

  /**
   * Signal that a DOM change occurred. Batches multiple signals in the same
   * animation frame into a single flush.
   */
  signal(kind: string, payload?: unknown): void {
    if (this._stopped) return
    this.pending.set(kind, payload ?? null)
    if (this.frame === null) {
      this.frame = requestAnimationFrame(() => {
        this.frame = null
        if (this._stopped) return
        const entries = [...this.pending]
        this.pending.clear()
        this.flush(entries)
      })
    }
  }

  /** Stop the coordinator and prevent any pending flushes. */
  stop(): void {
    this._stopped = true
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame)
      this.frame = null
    }
    this.pending.clear()
  }

  private flush(entries: [string, unknown][]): void {
    // Heavy signals get their own handler
    const hasSideChange = entries.some(([kind]) => kind === 'side')
    const hasLightSignals = entries.some(([kind]) => kind !== 'side')

    // Side-change is heavy: always triggers checkSideChanged
    if (hasSideChange) {
      checkSideChanged()
    }

    // Light signals (resize, class, style) are coalesced into one sync
    if (hasLightSignals) {
      // The coordinator already owns the frame boundary. Calling the public
      // coalescing wrapper here would add a second RAF and make drag-position
      // mirroring visibly lag by an extra frame.
      _runSyncDrawerTabSettings()
    }
  }
}

let _lastKnownSide: 'left' | 'right' | null = null
let _lastKnownVerticalPos: number | null = null
let _mainDrawerTabResizeObserver: ResizeObserver | null = null
let _mainDrawerTabClassObserver: MutationObserver | null = null
let _mainDrawerTabStyleObserver: MutationObserver | null = null

// Unified observation coordinator that batches all DOM change signals
let _observerCoordinator: ObserverCoordinator | null = null

/**
 * Serialize intentional applyCanvasSideChange calls so two rapid swaps
 * do not interleave settle loops / override clears.
 */
let _applySideChain: Promise<void> = Promise.resolve()
/** Monotonic id of the latest applyCanvasSideChange; stale settles exit early. */
let _sideApplyGen = 0

// Host Settings side watcher — keeps Lumiverse's own "Drawer side" setting
// identical to the Canvas side. Store-based (500ms poll of the host settings
// cache/snapshot), NOT a wrapper-class observer: the old class MO fired on
// every frame and dispatched swapSides per tick (the 4562↔4564 save loop).
let _hostSideWatcher: ReturnType<typeof setInterval> | null = null
let _lastSeenHostSide: 'left' | 'right' | null = null
let _lastCanvasSwapMs = 0
let _hostWatcherStarted = false

/** Read the host drawer side from the settings cache or store snapshot. */
function getHostSide(): 'left' | 'right' | null {
  const host = getHostDrawerSettings()
  if (host && (host.side === 'left' || host.side === 'right')) return host.side
  try {
    const snap = getStoreSnapshot() as { drawerSettings?: { side?: unknown } } | null
    const s = snap?.drawerSettings?.side
    if (s === 'left' || s === 'right') return s as 'left' | 'right'
  } catch {
    /* snapshot may be mid-walk */
  }
  return null
}

/**
 * Write the host side to match the model (boot coalesce + after a Canvas
 * swap). No-op when the host is not writable; falls back to the settings
 * API (fire-and-forget — the flip must never depend on this write).
 */
async function syncHostSideToModel(
  modelSide: 'left' | 'right',
): Promise<boolean> {
  const hostSide = getHostSide()
  if (hostSide === modelSide) return true
  const ok = patchHostDrawerSettings({ side: modelSide })
  if (ok) {
    _lastSeenHostSide = modelSide
    dlog('[drawer-sync] syncHostSideToModel: host side written to match model', { modelSide, prevHostSide: hostSide })
    return true
  }
  // NO-GO path — try the settings API. Only in a hosted browser context:
  // in tests / non-http pages there is no API to call and a real fetch
  // must not fire. Awaited so applyCanvasSideChange can report ok/degraded
  // synchronously to host.setSide (reconcile's correction path depends on
  // the verdict); boot-coalesce callers just don't await the promise.
  if (isHostedBrowserContext()) {
    const m = await import('../dom/host-settings')
    const apiOk = await m.writeHostDrawerSettingsViaApi({ side: modelSide })
    if (apiOk) {
      _lastSeenHostSide = modelSide
      dlog('[drawer-sync] syncHostSideToModel: host side written via API', { modelSide })
    }
    return apiOk
  }
  return false
}

/** True in the real app page (http/https with a window); false in bun test harnesses. */
function isHostedBrowserContext(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.location !== 'undefined' &&
      /^https?:/.test(window.location.protocol)
    )
  } catch {
    return false
  }
}

/**
 * Host Settings side watcher — makes Lumiverse's Drawer side identical to
 * the Canvas side. On boot, prefer the model and write the host to match.
 * When the USER flips Lumiverse's own setting, unify via a Canvas swap.
 * The 800ms guard after a Canvas swap suppresses the echo path.
 */
export function startHostSideWatcher(): void {
  if (_hostWatcherStarted) return
  _hostWatcherStarted = true
  // Seed lastSeen without dispatching — on boot, prefer model and write host to match model.
  const initialHost = getHostSide()
  const modelSide = getMainDrawerSide()
  _lastSeenHostSide = initialHost
  if (initialHost && initialHost !== modelSide) {
    dlog('[drawer-sync] host side differs from model on boot — syncing host to model', { hostSide: initialHost, modelSide })
    syncHostSideToModel(modelSide)
  }
  _hostSideWatcher = setInterval(() => {
    const hostSide = getHostSide()
    if (!hostSide) return
    if (hostSide === _lastSeenHostSide) return
    _lastSeenHostSide = hostSide
    const currentModelSide = getMainDrawerSide()
    if (hostSide === currentModelSide) return
    // Ignore the echo of our own Canvas swap (model already flipping to hostSide).
    if (Date.now() - _lastCanvasSwapMs < 800) {
      dlog('[drawer-sync] host side change ignored — recent Canvas swap', { hostSide, currentModelSide })
      return
    }
    dlog('[drawer-sync] host side change detected — unifying via Canvas', { hostSide, currentModelSide })
    void import('../recon/dispatch').then((m) => {
      // swapSides toggles; since hostSide !== currentModelSide, one swap reaches hostSide
      m.dispatch({ t: 'swapSides' } as unknown as Parameters<typeof m.dispatch>[0]).catch((err) => {
        dwarn('[drawer-sync] host side unify dispatch failed:', err)
      })
    })
  }, 500)
  // unref so a pending poll never keeps the process alive in tests; the
  // browser ignores the method (timers are numbers there).
  ;(_hostSideWatcher as unknown as { unref?: () => void }).unref?.()
  registerCleanup(() => stopHostSideWatcher())
}

export function stopHostSideWatcher(): void {
  if (_hostSideWatcher) {
    clearInterval(_hostSideWatcher)
    _hostSideWatcher = null
  }
  _hostWatcherStarted = false
}

/** Called by applyCanvasSideChange when Canvas initiates a swap — records time and syncs host. */
async function recordCanvasSwapAndSyncHost(
  desired: 'left' | 'right',
): Promise<boolean> {
  _lastCanvasSwapMs = Date.now()
  _lastSeenHostSide = desired
  // Write host side to match Canvas so host Settings UI reflects the new
  // side and the next poll doesn't flip back. Verbatim write semantics of
  // the old host.setSide: patch first; on NO-GO fall back to the settings
  // API unconditionally (the same PUT the Settings modal's flush performs;
  // test harnesses stub it via __setSettingsApiFetchForTest — no real
  // fetch fires there). The 500ms WATCHER path keeps its gated fallback
  // instead (syncHostSideToModel) — a real fetch must not fire from a
  // background poll in non-hosted contexts.
  const ok = patchHostDrawerSettings({ side: desired })
  if (ok) return true
  try {
    const m = await import('../dom/host-settings')
    const apiOk = await m.writeHostDrawerSettingsViaApi({ side: desired })
    if (apiOk) {
      _lastSeenHostSide = desired
      dlog('[drawer-sync] recordCanvasSwapAndSyncHost: host side written via API', { desired })
    }
    return apiOk
  } catch {
    return false
  }
}

// Coalescing: when syncDrawerTabSettings is called multiple times in the
// same tick (from ResizeObserver, 2x MutationObserver, 2s setInterval, and
// external callers), only one body run per frame. The previous code allowed
// 12+ redundant calls per tick, each logging 'enter' and re-stamping 8 CSS
// vars on the secondary wrapper.
let _syncPending = false
/** Bounded retry counter for the missing main-drawer-tab path (2026-08-17). */
let _drawerTabRetryCount = 0
const DRAWER_TAB_RETRY_MAX = 30
// Diagnostic noise guard: log the missing drawer-tab retry once per session.
let _drawerTabRetryLogged = false
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
    // BUGFIX (2026-08-17): the previous code re-armed itself on EVERY
    // frame while the main drawer-tab element was missing — an unbounded
    // rAF loop that starves the event loop (timers never fire) whenever
    // the element is absent (early boot, stripped host chrome, stub
    // environments). Retry is now bounded; after the budget is spent the
    // next explicit syncDrawerTabSettings() call re-arms it.
    _drawerTabRetryCount++
    if (!_drawerTabRetryLogged) {
      _drawerTabRetryLogged = true
      dlog('[drawer-sync] main drawer tab not found — bounded retry engaged', {
        retryMax: DRAWER_TAB_RETRY_MAX,
      })
    }
    if (_drawerTabRetryCount < DRAWER_TAB_RETRY_MAX) {
      // Retry on the next frame. Bypass the coalesce gate — the retry must
      // actually fire even if the wrapper is still mid-coalesce.
      requestAnimationFrame(() => _runSyncDrawerTabSettings())
    }
    return
  }
  _drawerTabRetryCount = 0

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
    const coordinator = ensureObserverCoordinator()
    _mainDrawerTabResizeObserver = new ResizeObserver(() => {
      coordinator.signal('resize')
    })
    _mainDrawerTabResizeObserver.observe(mainDrawerTab)
    registerCleanup(stopDrawerTabResizeWatcher)
  }

  // Attach MutationObserver to the main drawer tab so we re-sync whenever
  // Lumiverse toggles compact mode via a class change. Only attach once.
  if (!_mainDrawerTabClassObserver) {
    const coordinator = ensureObserverCoordinator()
    _mainDrawerTabClassObserver = new MutationObserver(() => {
      coordinator.signal('class')
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
    const coordinator = ensureObserverCoordinator()
    _mainDrawerTabStyleObserver = new MutationObserver(() => {
      coordinator.signal('style')
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

  // S8: while Top/Bottom both edge handles are hidden — the vertical
  // position mirror is inert. Skip the writes, clear any stale marginTop a
  // Sides phase wrote, and reset the cache so returning to Sides re-applies.
  const horizontalLocation = isHorizontalStrip()
  if (horizontalLocation) {
    if (drawerTab?.style.marginTop) drawerTab.style.marginTop = ''
    const mainMirrorTabH = mainMirrorWrapper?.querySelector('.sidebar-ux-drawer-tab') as HTMLElement | null
    if (mainMirrorTabH?.style.marginTop) mainMirrorTabH.style.marginTop = ''
    _lastKnownVerticalPos = null
  } else if (_lastKnownVerticalPos !== posVh) {
    const settings = getSettings()

    // Canvas drag overrides take precedence over the host position
    // (drawerTabPosition/apply.ts), and the mirror sources the MAIN's
    // EFFECTIVE position. A side change resets `_lastKnownVerticalPos`
    // (checkSideChanged), which re-runs this block — using raw `posVh` here
    // clobbered a dragged handle with the stale host value and snapped both
    // handles back to default after "Swap drawer locations" (live-verify #11).
    const effectiveMainVh = settings.mainDrawerTabOverrideVh !== undefined
      ? settings.mainDrawerTabOverrideVh
      : posVh

    if (settings.mirrorCompactPosition) {
      if (drawerTab) drawerTab.style.marginTop = `${effectiveMainVh}vh`
      // Canvas main edge toggle tracks the main vertical position too.
      const mainMirrorTab = mainMirrorWrapper?.querySelector('.sidebar-ux-drawer-tab') as HTMLElement | null
      if (mainMirrorTab) mainMirrorTab.style.marginTop = `${effectiveMainVh}vh`
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

/**
 * S4 geometry-only side-change handler (was: full remount machinery —
 * unmount/mount secondary, store force-walk, tab-button restore, root
 * re-attach, main-mirror teardown+mount).
 *
 * Sources of a real flip:
 *  - Canvas swap (Configure "Swap drawer locations" → owned-commit
 *    swapSides → reconcile diffSide → host.setSide → applyCanvasSideChange
 *    with syncHost:true) — by the time the host DOM class flips, the
 *    shells are already restyled; this handler only stamps + light-syncs.
 *  - Host-driven flip (Lumiverse "Drawer side" setting): the host DOM
 *    class flips FIRST. The shells lag → restyle via applyCanvasSideChange
 *    with syncHost:false — pure geometry, NO _lastSeenHostSide stamp, so
 *    the 500ms host watcher still observes the change and converges the
 *    model (dispatch swapSides → diffSide → host.setSide no-op).
 */
export function checkSideChanged(): void {
  const currentSide = getMainDrawerSide()
  // Drawer-tab watcher reset: the host React re-render behind a wrapper
  // class flip can replace the drawer tab element; stale observers +
  // caches would freeze the edge-toggle sync. The sync body re-attaches
  // the watchers on the live element (attach-once guards see null refs).
  // Idempotent + cheap.
  _lastWrittenDrawerTabVars = null
  _lastWrittenLabelsKey = null
  _lastKnownVerticalPos = null
  stopDrawerTabResizeWatcher()
  stopDrawerTabClassObserver()
  stopDrawerTabStyleObserver()
  if (_lastKnownSide !== null && _lastKnownSide !== currentSide) {
    dlog('[drawer-sync] side changed detected (geometry-only)', {
      from: _lastKnownSide,
      to: currentSide,
      secondDrawerEnabled: getSettings().secondSidebarEnabled,
    })
    void applyCanvasSideChange(currentSide, { syncHost: false })
  } else {
    // Same side (override settle echo) — just light-sync + stamp.
    _lastKnownSide = currentSide
    syncDrawerTabSettings()
  }
  // Re-anchor both drawers' resize handles to the new inner edge.
  // Dynamic import avoids a static cycle (handles → secondary → drawer-sync).
  void import('../resize/handles').then((m) => {
    try {
      m.refreshResizeHandles()
    } catch {
      /* ignore teardown races */
    }
  })
}

/**
 * After second-drawer disable: drop any intentional side override and
 * reseed last-known from the live main side (post-baseline-restore).
 * Does not apply side changes or restyle shells (S4: no remount machinery).
 */
export function resetSideRemountStateAfterDisable(): void {
  setMainDrawerSideOverride(null)
  _lastKnownSide = getMainDrawerSide()
}

let _sideObserver: MutationObserver | null = null
/** Wrapper node currently observed by _sideObserver (for rebind-on-replace). */
let _observedMainWrapper: HTMLElement | null = null
let _sideWatcherCleanupRegistered = false

/**
 * Hard settle cap (ms). After this we stamp lastKnown to desired and keep
 * the override until DOM matches or MO sees a host-driven different side.
 * Clearing override while DOM still lags is what caused flip-back remounts.
 * (Host React usually settles well under ~800ms; we poll up to this hard cap.)
 */
const SIDE_SETTLE_HARD_MS = 2500
/** Runtime hard settle cap (overridable in tests). */
let _sideSettleHardMs = SIDE_SETTLE_HARD_MS

/** S4: refresh every geometry consumer after a shell restyle (design §4
 *  item 3). Dynamic imports avoid static cycles (handles → secondary →
 *  drawer-sync, etc.). */
function refreshSideGeometry(): void {
  void import('../resize/handles').then((m) => {
    try {
      m.refreshResizeHandles()
    } catch {
      /* ignore teardown races */
    }
  })
  void import('../chat/reflow').then((m) => {
    try {
      m.updateChatReflow()
    } catch {
      /* ignore */
    }
  })
  void import('./strip-gutter').then((m) => {
    try {
      m.updateStripGutters()
    } catch {
      /* ignore */
    }
  })
  void import('./main-tab-pin').then((m) => {
    try {
      m.reconcileMainTabListPin()
    } catch {
      /* ignore teardown races */
    }
  })
  // Secondary pin chrome follows the side too. The S4 restyle moves the
  // secondary WRAPPER, but the tab list lives on a body-level pin host while
  // pinned — without this reconcile the strip stays on the old secondary
  // edge (which is the new main edge) and paints over the main strip.
  // Force re-pin also restores the pinned drawer flex + panel border.
  try {
    reconcileTabListPin()
  } catch {
    /* ignore teardown races */
  }
  try {
    // Hidden HOST main drawer: keep its own flex/border in step for the
    // eventual Canvas teardown (pre-S4 behavior; host chrome is not visible
    // while the shell owns the surface).
    applyTabListPosition(getSettings().moveControlsToOuterEdge)
  } catch {
    /* ignore */
  }
  try {
    // The mounted Canvas main shell is the VISIBLE main drawer — refresh
    // ITS flex/border. The call above targets the hidden host nodes; this
    // one restores the pinned (spacer-to-outer-edge) orientation that
    // restyleShellSide must guess before the pin state is re-applied.
    applyTabListPosition(getSettings().moveControlsToOuterEdge, {
      mainDrawer: getMainMirrorDrawer(),
      mainTabList: getMainMirrorTabList(),
      mainPanel: getMainMirrorPanel(),
    })
  } catch {
    /* ignore */
  }
  syncDrawerTabSettings()
  // The drawerTab handle is display-gated; a restyle must re-evaluate it
  // (the old remount called this after mount).
  updateDrawerTabVisibility()
}

/**
 * S4: apply a main drawer side change as CSS-only geometry — restyle both
 * Canvas shells in place, refresh geometry consumers, do the ONE guarded
 * host side write, and settle the override in the background. No remount,
 * no container churn, no root moves, no content re-park.
 *
 * Covers all three flip sources (design doc §4):
 *  - Configure "Swap drawer locations" (owned-commit swapSides → reconcile
 *    diffSide → host.setSide → here, syncHost:true).
 *  - Boot restore (diffSide → host.setSide → here, syncHost:true).
 *  - Host-driven Lumiverse Settings flip (checkSideChanged → here with
 *    syncHost:false — NO _lastSeenHostSide stamp so the 500ms host watcher
 *    still observes the change and converges the model via swapSides).
 *
 * The override (setMainDrawerSideOverride) protects getMainDrawerSide's
 * DOM-first read during the host React lag window; waitForSideSettle clears
 * it when the host DOM matches (or keeps it on hard timeout so lagging DOM
 * cannot reverse the swap). Never depends on the host write succeeding —
 * the shells are Canvas-owned; a degraded write is corrected by reconcile's
 * modelSideCorrection converging on the real side.
 *
 * Why settle is not awaited: configure auto-commit used to block the whole
 * commit queue on host React lag (up to SIDE_SETTLE_HARD_MS). Rapid "Swap
 * drawer locations" clicks then stacked multi-second delays before the next
 * swap. The restyle is synchronous under the override; host settle only
 * needs gen-guarded background cleanup.
 */
export async function applyCanvasSideChange(
  desired: 'left' | 'right',
  opts?: { syncHost?: boolean },
): Promise<{ writeOk: boolean }> {
  const gen = ++_sideApplyGen
  const syncHost = opts?.syncHost !== false
  const run = async (): Promise<{ writeOk: boolean }> => {
    // A newer apply may have started while we waited on the chain.
    if (gen !== _sideApplyGen) return { writeOk: true }

    dlog('[drawer-sync] apply canvas side change (geometry-only)', {
      desired,
      syncHost,
    })
    // Observed side before the swap — the degraded-revert target.
    const priorSide = readMainWrapperSideFromDom()
      ?? (desired === 'left' ? 'right' : 'left')

    setMainDrawerSideOverride(desired)
    let writeOk = true
    if (syncHost) {
      // The single host side write per swap (800ms echo guard inside).
      writeOk = await recordCanvasSwapAndSyncHost(desired)
    }

    // Restyle both shells in place. Order: main first (stamps
    // _shell.side/_mountedSide + recomputes its transform), then secondary
    // (opposite anchor; its closed-transform read follows the override
    // already stamped above).
    restyleMainShellSide(desired)
    restyleSecondaryShellSide(desired === 'left' ? 'right' : 'left')
    refreshSideGeometry()

    if (!writeOk) {
      // Both write paths failed: the swap is physically impossible in this
      // environment (NO-GO bridge + unreachable API). Revert the geometry
      // to the observed side and drop the override — reconcile's
      // modelSideCorrection converges the MODEL on the real side, so the
      // shells must follow it or they sit orphaned on the desired edge. A
      // stuck override here was the enable-toggle poison (2026-08-17).
      const realSide = readMainWrapperSideFromDom() ?? getHostSide() ?? priorSide
      setMainDrawerSideOverride(null)
      restyleMainShellSide(realSide)
      restyleSecondaryShellSide(realSide === 'left' ? 'right' : 'left')
      _lastKnownSide = realSide
      refreshSideGeometry()
      return { writeOk: false }
    }

    // Always stamp lastKnown to desired after an intentional apply so a
    // subsequent rebind / startSideChangeWatcher cannot re-seed from
    // lagging DOM while shells already sit on desired.
    _lastKnownSide = desired

    // Background settle only — do not block configure commit / next swap.
    // Latest gen owns settle; stale settles exit early via gen checks.
    void waitForSideSettle(desired, gen).then(() => {
      if (gen !== _sideApplyGen) return
      // Ensure lastKnown still matches what we wrote (settle may have run
      // under a concurrent MO that shouldn't reverse intentional side).
      _lastKnownSide = desired
      rebindSideChangeWatcherIfNeeded()
    })

    return { writeOk: true }
  }

  // Chain: rapid A then B must not interleave restyles. Settle is background.
  const next = _applySideChain.then(run, run)
  _applySideChain = next.then(() => {}, () => {})
  return next
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

/**
 * If a side override is active, reconcile it with live DOM:
 *   - DOM matches override → settled; clear override.
 *   - DOM differs from override → only clear when host store side also
 *     disagrees with the override AND matches DOM (genuine Settings flip).
 *     During React lag after Configure swap, store already matches override
 *     while DOM is still old — must NOT clear or checkSideChanged remounts
 *     reverse to the lagging DOM side.
 * Call before checkSideChanged from the MutationObserver path.
 */
function reconcileSideOverrideFromDom(): void {
  const override = getMainDrawerSideOverride()
  if (override === null) return
  const domSide = readMainWrapperSideFromDom()
  // No readable side yet (wrapper mid-replace) — leave override in place.
  if (domSide === null) return
  if (domSide === override) {
    setMainDrawerSideOverride(null)
    return
  }
  // DOM lags or host wrote a different side. Prefer host-settings cache
  // (patchHostDrawerSettings updates it sync); fiber snapshot can lag.
  const hostSide = getHostDrawerSettings()?.side
  if (
    (hostSide === 'left' || hostSide === 'right') &&
    hostSide !== override &&
    hostSide === domSide
  ) {
    // Store + DOM agree on a side other than our intentional override →
    // Settings (or another host write) won. Drop override so remount follows DOM.
    setMainDrawerSideOverride(null)
  }
  // else: keep override (React lag after our write, or store not yet readable)
}

/**
 * Wait for host wrapper class to match desired; clear override when settled.
 * Hard timeout resolves without clearing override (avoids reverse remount).
 * Timeout is cleared on success so late warn/disconnect cannot race.
 */
function waitForSideSettle(desired: 'left' | 'right', gen: number): Promise<void> {
  return new Promise((resolve) => {
    if (gen !== _sideApplyGen) {
      resolve()
      return
    }

    let observed = getMainWrapper()
    if (!observed) {
      resolve()
      return
    }

    // Check immediately
    if (readMainWrapperSideFromDom() === desired) {
      if (gen === _sideApplyGen && getMainDrawerSideOverride() === desired) {
        setMainDrawerSideOverride(null)
      }
      resolve()
      return
    }

    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let observer!: MutationObserver
    const finish = () => {
      if (settled) return
      settled = true
      if (timer != null) clearTimeout(timer)
      try {
        observer.disconnect()
      } catch {
        /* ignore */
      }
      resolve()
    }

    observer = new MutationObserver(() => {
      if (settled) return
      if (gen !== _sideApplyGen) {
        finish()
        return
      }

      // Rebind if wrapper was replaced (keep `observed` in sync for connectivity).
      if (!observed || !observed.isConnected) {
        observer.disconnect()
        const next = getMainWrapper()
        if (!next) return
        observed = next
        observer.observe(observed, { attributes: true, attributeFilter: ['class'] })
        // Fall through to match check on the new node.
      }

      if (readMainWrapperSideFromDom() === desired) {
        if (gen === _sideApplyGen && getMainDrawerSideOverride() === desired) {
          setMainDrawerSideOverride(null)
        }
        finish()
      }
    })

    observer.observe(observed, { attributes: true, attributeFilter: ['class'] })

    // Hard timeout — resolve, don't reject. Keep override while DOM lags.
    timer = setTimeout(() => {
      if (settled) return
      if (gen === _sideApplyGen) {
        _lastKnownSide = desired
        dwarn(
          `[drawer-sync] applyCanvasSideChange: host DOM side did not settle to "${desired}" within ${_sideSettleHardMs}ms; keeping override until DOM matches or host writes a different side`,
        )
      }
      finish()
    }, _sideSettleHardMs)
  })
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
  // Only seed lastKnown when never set. After applyCanvasSideChange,
  // shells may already sit on desired while DOM still lags; stomping
  // lastKnown from getMainDrawerSide() (DOM after override clear) desyncs
  // and can reverse-remount on the next check.
  if (_lastKnownSide === null) {
    _lastKnownSide = getMainDrawerSide()
  }
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
  // Side MO must always have a coordinator — setup may start this watcher
  // without light-sync attach, so optional `?.signal` would no-op remounts.
  const coordinator = ensureObserverCoordinator()
  _sideObserver = new MutationObserver(() => {
    // Host class flip: clear override when DOM settled to override OR when
    // DOM shows a different side (Settings path won). Then remount.
    reconcileSideOverrideFromDom()
    coordinator.signal('side')
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
  // Host Settings side watcher — identical side via the store, not the
  // wrapper class (which fired per frame and caused the 4562↔4564 loop).
  startHostSideWatcher()
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

/** Test-only: reset apply chain / gen between tests. */
export function __resetSideApplyStateForTest(): void {
  _sideApplyGen = 0
  _applySideChain = Promise.resolve()
  _sideSettleHardMs = SIDE_SETTLE_HARD_MS
}

/** Test-only: clear cached tab-sync values between isolated DOM setups. */
export function __resetDrawerTabSyncStateForTest(): void {
  _lastKnownVerticalPos = null
  _lastWrittenDrawerTabVars = null
  _lastWrittenLabelsKey = null
  _syncPending = false
  // The missing-drawer-tab retry budget is per-session in production (once
  // the budget is spent, only an explicit syncDrawerTabSettings() call
  // re-arms it). Sibling test files that run in the same process each set
  // up their own DOM — a retry budget spent by one file must not starve
  // another file's retry-path assertions.
  _drawerTabRetryCount = 0
  _drawerTabRetryLogged = false
}

/** Test-only: shorten/lengthen hard settle timeout (default 2500). */
export function __setSideSettleHardMsForTest(ms: number): void {
  _sideSettleHardMs = ms
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

/**
 * Initialize the observer coordinator. Call this once at module init or
 * when the first observer is attached.
 */
function ensureObserverCoordinator(): ObserverCoordinator {
  if (!_observerCoordinator) {
    _observerCoordinator = new ObserverCoordinator()
    registerCleanup(stopObserverCoordinator)
  }
  return _observerCoordinator
}

/** Stop the observer coordinator and prevent any pending flushes. */
export function stopObserverCoordinator(): void {
  if (_observerCoordinator) {
    _observerCoordinator.stop()
    _observerCoordinator = null
  }
}

// Tab registration watcher is now handled by DrawerObserver (drawer-observer.ts)
// which uses a MutationObserver instead of the 3s polling interval.
