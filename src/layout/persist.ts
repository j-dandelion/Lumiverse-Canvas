// Layout persistence.
//
// Reads and writes the layout blob (drawer open/close, width, tab
// assignments) to the backend via the SAVE_LAYOUT / LOAD_LAYOUT IPC.
// The blob also carries the Canvas settings field — see settings/state.ts.
//
// Two write paths:
//   - persistOpenState: synchronous. Used by openSecondarySidebar /
//     closeSecondarySidebar / the resize handle, so an "open then
//     immediately close within 100ms" sequence records the final state.
//   - persistLayout: 500ms debounced. Used by assignTab and the resize
//     handle (the drag is high-frequency).
//
// One read path (loadSavedLayout): sends LOAD_LAYOUT, resolves on the
// first LAYOUT_DATA response or after a 2s safety timeout.
//
// applyLayout restores the saved state. The 90-line polling loop (the
// suffix-drift fallback for tabId suffix drift across sessions) is moved
// here as-is; the rewrite into a MutationObserver callback is TODO.

import { getMainDrawerWidth } from '../dom/lumiverse'
import { getDrawerTabs, isMainDrawerOpen, getMainDrawerSide } from '../store'
import {
  getSecondaryWrapper, isSecondarySidebarOpen, SECONDARY_WIDTH_VAR,
  animateWrapper, getClosedTransformPx,
  openSecondarySidebar, closeSecondarySidebar,
} from '../sidebar/secondary'
import {
  getTabAssignments, hasTabAssignment, repositionTab,
} from '../tabs/assignment'
import {
  addSecondaryTabButton, hideMainTabButton, showSecondaryTab, updateDrawerTabVisibility,
} from '../tabs/buttons'
import { dlog, dwarn } from '../debug/log'
import { getSettings, cancelSettingsSave } from '../settings/state'

// Must match spindle.json version. Updated on each release.
export const CANVAS_VERSION = '1.5.10'

interface BackendCtx {
  sendToBackend(msg: { type: string; [key: string]: unknown }): void
  onBackendMessage(handler: (payload: { type: string; layout?: any; [key: string]: unknown }) => void): void
}

let _backendCtx: BackendCtx | null = null

export function getBackendCtx(): BackendCtx | null { return _backendCtx }
export function setBackendCtx(ctx: BackendCtx): void { _backendCtx = ctx }

// Debounce timer for persistLayout (tab assignments, width)
let _saveLayoutTimer: ReturnType<typeof setTimeout> | null = null
// Interval handle for applyLayout's tab-restore polling loop.
let _applyLayoutInterval: ReturnType<typeof setInterval> | null = null
// Called by sidebar/cleanup.cleanupAll on teardown.
export function cancelLayoutSave(): void {
  if (_saveLayoutTimer !== null) {
    clearTimeout(_saveLayoutTimer)
    _saveLayoutTimer = null
  }
}

export function cancelApplyLayoutInterval(): void {
  if (_applyLayoutInterval !== null) {
    clearInterval(_applyLayoutInterval)
    _applyLayoutInterval = null
  }
}

/**
 * Drain both the layout-debounce and the settings-debounce timers, then post
 * a single, fully-merged SAVE_LAYOUT carrying the current layout snapshot AND
 * the current settings. Used by the teardown path (setup/cleanup) on page
 * unload to guarantee the latest state lands on disk before the page goes
 * away — debounce windows are irrelevant on shutdown.
 *
 * Safe to call when no timer is in flight (one cheap IPC; we WANT the
 * freshest state on disk before unload). Safe to call before the backend
 * ctx is wired (returns early). Safe to call when persistence is disabled
 * (returns early).
 */
export function flushPendingSaves(): void {
  const backendCtx = getBackendCtx()
  if (!backendCtx) return
  if (!isPersistenceEnabled()) return
  if (_saveLayoutTimer !== null) {
    clearTimeout(_saveLayoutTimer)
    _saveLayoutTimer = null
  }
  // Cancel the settings timer (not flush) — we post a single merged save
  // below, and a second post from the settings callback would be a duplicate
  // write that could race the one we're about to send.
  cancelSettingsSave()
  const layout = { ...snapshotLayout(), settings: getSettings() }
  backendCtx.sendToBackend({ type: 'SAVE_LAYOUT', layout })
}

// Authoritative main-drawer state, updated by the watcher's onDrawerChange
// callback. snapshotLayout() reads from these vars instead of calling
// isMainDrawerOpen() (Zustand snapshot) or getMainDrawerWidth() (DOM
// measurement) directly, because:
//
// - isMainDrawerOpen() reads from a 3s-cached fiber-tree walk that can
//   return drawerOpen=false even when the wrapper is open, if the walker
//   missed the right fiber (transitional state during mount, or a hot
//   reload that broke the cache).
// - The host's onDrawerChange stream is the source of truth for the main
//   drawer's open/close + active tab. When the host says open=true, it IS
//   open. Routing the watcher's events through a module-level cache and
//   reading from it at snapshot time eliminates the unreliable indirect
//   read entirely.
// - getMainDrawerWidth() is still called from snapshotLayout for the
//   width field — a DOM measurement is the only way to get a width
//   value, and the watcher's ResizeObserver-debounced path also writes
//   through this snapshot, so the width is fresh.
let _mainDrawerOpen = false
let _mainDrawerTabId: string | null = null

/**
 * Push the host's authoritative main-drawer state into the module
 * cache. Called by the watcher in sidebar/main-persist.ts from the
 * spindle.ui.onDrawerChange callback. Subsequent snapshotLayout() calls
 * will return this state for primary.{open,tabId} instead of reading
 * the unreliable Zustand snapshot.
 */
export function setMainDrawerState(open: boolean, tabId: string | null): void {
  _mainDrawerOpen = open
  _mainDrawerTabId = tabId
}

/**
 * Build the current layout snapshot from in-memory state. Pure — no side effects.
 */
export function snapshotLayout(): any {
  return {
    version: CANVAS_VERSION,
    primary: {
      // Read from the module-level cache populated by the watcher. Falls
      // back to isMainDrawerOpen() (Zustand snapshot) at module init
      // time, before the watcher has had a chance to fire its first
      // event. After the first event, the cache is authoritative.
      open: _mainDrawerOpen,
      width: getMainDrawerWidth(),
      tabId: _mainDrawerTabId,
    },
    secondary: {
      open: isSecondarySidebarOpen(),
      width: parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)) || 420,
    },
    detachedTabs: Array.from(getTabAssignments().entries())
      .filter(([_, side]) => side === 'secondary')
      .map(([tabId, side]) => {
        const tabs = getDrawerTabs()
        const tab = tabs.find(t => t.id === tabId)
        return { tabId, tabTitle: tab?.title || tabId, sidebar: side }
      }),
  }
}

function isPersistenceEnabled(): boolean {
  return getSettings().layoutPersistence
}

/**
 * Persist the drawer's open/closed state + width synchronously. No debounce —
 * called from openSecondarySidebar / closeSecondarySidebar / the resize handle,
 * so a user opening then immediately closing the drawer (within the 500ms
 * debounce window of persistLayout) still records the final state. The
 * verification case from the plan: "open, immediately close within 100ms —
 * final state on hard-refresh is closed."
 */
export function persistOpenState(): void {
  const backendCtx = getBackendCtx()
  if (!backendCtx) return
  if (!isPersistenceEnabled()) return
  if (_saveLayoutTimer !== null) {
    // A debounced persistLayout is in flight; cancel it so we don't double-write.
    clearTimeout(_saveLayoutTimer)
    _saveLayoutTimer = null
  }
  // Drain any pending settings save too: the synchronous layout write below
  // will carry the latest settings, so the older settings-bearing snapshot
  // must not be allowed to clobber it.
  cancelSettingsSave()
  const layout = { ...snapshotLayout(), settings: getSettings() }
  backendCtx.sendToBackend({ type: 'SAVE_LAYOUT', layout })
}

/**
 * Persist the tab-assignment list + drawer width, debounced 500ms. Called
 * from assignTab and from the resize handle (the width change is frequent
 * during drag; the debounce coalesces to a single write at drag end).
 */
export function persistLayout(): void {
  const backendCtx = getBackendCtx()
  if (!backendCtx) return
  if (!isPersistenceEnabled()) return
  if (_saveLayoutTimer !== null) {
    clearTimeout(_saveLayoutTimer)
  }
  // Drain any pending settings save: the debounced layout write below will
  // carry the latest settings, so the older settings-bearing snapshot must
  // not be allowed to clobber it.
  cancelSettingsSave()
  _saveLayoutTimer = setTimeout(() => {
    _saveLayoutTimer = null
    const layout = { ...snapshotLayout(), settings: getSettings() }
    backendCtx.sendToBackend({ type: 'SAVE_LAYOUT', layout })
  }, 500)
}

export function loadSavedLayout(): Promise<any> {
  const backendCtx = getBackendCtx()
  if (!backendCtx) return Promise.resolve(null)
  return new Promise((resolve) => {
    // Phase 3 (finding #13): register a one-shot handler that resolves the
    // promise when LAYOUT_DATA arrives. The handler is replaced by the
    // permanent ctx.onBackendMessage listener in setup() before any other
    // LAYOUT_DATA could come through.
    const handler = (payload: any) => {
      if (payload.type === 'LAYOUT_DATA') {
        resolve(payload.layout)
      }
    }
    backendCtx.onBackendMessage(handler)
    backendCtx.sendToBackend({ type: 'LOAD_LAYOUT' })
    // Safety timeout: if the backend never responds (e.g. corrupt storage),
    // resolve with null so the mount proceeds with defaults rather than
    // hanging the extension. 2s is enough for the file I/O round-trip on
    // a warm cache; longer waits mask real bugs.
    setTimeout(() => { resolve(null) }, 2000)
  })
}

/**
 * Restore the main drawer's open/close + active tab from the saved
 * layout. Independent of applyLayout (which is gated on
 * secondSidebarEnabled) — the main drawer is host-owned, so its
 * restore is feature-gated only on the master layoutPersistence
 * toggle.
 *
 * Delegates to restoreMainDrawerFromDom() in sidebar/main-persist.ts,
 * which simulates a tab-button click to open the drawer (the host's
 * spindle.ui API is not exposed to extensions at runtime).
 */
export function applyMainDrawer(layout: any): void {
  if (!layout || !layout.primary) {
    return
  }

  // Delegate to the watcher module's DOM-driven restore.
  // We import lazily to avoid circular deps (main-persist imports
  // persist, and this function is only ever called from setup.ts's
  // loadSavedLayout callback — long after module init).
  import('../sidebar/main-persist').then(({ restoreMainDrawerFromDom }) => {
    restoreMainDrawerFromDom(
      layout.primary.open === true,
      typeof layout.primary.tabId === 'string' ? layout.primary.tabId : null,
      typeof layout.primary.width === 'number' ? layout.primary.width : undefined,
    )
  })
}

export function applyLayout(layout: any) {
  if (!layout) return

  // Restore secondary sidebar width — clamp to viewport so the closed
  // transform fully hides the sidebar on narrow screens. Mirrors the
  // clamp in restoreMainDrawerFromDom (main-persist.ts) and the
  // resize-handle bounds (resize/handles.ts).
  if (layout.secondary?.width) {
    const clamped = Math.max(200, Math.min(window.innerWidth * 0.8, layout.secondary.width))
    document.documentElement.style.setProperty(SECONDARY_WIDTH_VAR, `${clamped}px`)
    // Phase 3 (finding #13): createSecondarySidebar already initialized the
    // wrapper transform with the right width on mount (see the options
    // parameter). No animateWrapper call needed here — that would re-trigger
    // the close animation and cause a flicker. The conditional animateWrapper
    // below is kept as a safety net for the case where applyLayout is called
    // without a prior mountSecondarySidebar(layout) (e.g. from a future
    // "reload layout" debug action that runs after setup).
    if (getSecondaryWrapper() && !isSecondarySidebarOpen()) {
      const currentTransform = getSecondaryWrapper()!.style.transform?.match(/-?[\d.]+/)?.[0]
      // Compare against the sign-aware closed transform. The saved width is
      // always positive, but the rendered transform carries a sign
      // (+width when sec is on the right, -width when sec is on the left),
      // so a direct string match against the saved width would always
      // differ when the secondary is on the left. Use the same sign logic
      // as getClosedTransformPx to compute the desired closed value.
      const desiredClosed = getMainDrawerSide() === 'right'
        ? -clamped
        : clamped
      if (currentTransform !== String(desiredClosed)) {
        animateWrapper(desiredClosed)
      }
    }
  }

  // Restore tab assignments
  if (layout.detachedTabs?.length) {
    // Wait for extension tabs to register, then restore.
    // Phase 2: match by stable tabId only. Title fallback was removed because
    // tabTitle can drift across sessions (e.g. "LumiBooks" → "LumiBooks v2")
    // and was the source of the "Hone / Prompt Inspector unreliable" symptom.
    // If a stored tabId is no longer in the store (extension uninstalled or
    // id schema changed), we warn and skip — the user can clean up via the
    // future "reset layout" action.
    //
    // Phase 3 (finding #5): polling loop now calls the lighter restore path
    // (set state + update buttons + DOM move) directly, NOT assignTab. This
    // avoids the policy-layer side effects: assignTab would call
    // switchMainDrawerToFallback (which manipulates the main drawer that's
    // already in its saved state) and persistLayout (we just LOADED this
    // layout, no need to write it back).
    //
    // Phase 4.0 (suffix-drift fallback): Lumiverse assigns a session-variant
    // suffix (`:1`, `:2`, `:3`) to extension tab ids in the order they're
    // registered. The suffix in the live DOM is NOT the same as the one in
    // layout.json after a session restart — e.g. layout says
    // `prompt-viewer:2` but live is `prompt-viewer:1`. An exact-match-only
    // restore leaves the user with empty secondary panels after a restart.
    // Fix: if an exact match fails, strip the last `:N` from both the stored
    // id and each live id, and match by the stripped prefix. If exactly one
    // live id matches, use it AND rewrite the stored id in the in-memory
    // layout (so the next persistLayout write self-heals). If multiple live
    // ids match, the stripped prefix is too coarse — warn and skip.
    const stripSuffix = (id: string): string => {
      const lastColon = id.lastIndexOf(':')
      if (lastColon <= 0) return id
      const tail = id.slice(lastColon + 1)
      return /^\d+$/.test(tail) ? id.slice(0, lastColon) : id
    }
    let attempts = 0
    _applyLayoutInterval = setInterval(() => {
      attempts++
      const tabs = getDrawerTabs()
      for (let i = 0; i < layout.detachedTabs.length; i++) {
        const dt = layout.detachedTabs[i]
        if (hasTabAssignment(dt.tabId)) continue
        // Try exact match first
        let tab = tabs.find(t => t.id === dt.tabId)
        let usedFallback = false
        if (!tab) {
          // Exact match missed — try stripped-suffix match
          const storedPrefix = stripSuffix(dt.tabId)
          const candidates = tabs.filter(t => stripSuffix(t.id) === storedPrefix)
          if (candidates.length === 1) {
            tab = candidates[0]
            usedFallback = true
            dlog(`applyLayout: suffix-drift fallback matched stored "${dt.tabId}" → live "${tab.id}"`)
            // Self-heal: rewrite the in-memory layout so the next persistLayout
            // call stores the live id. No additional save here — the rewrite
            // only takes effect when the user makes another change that
            // triggers persistLayout (open/close, move another tab, etc.).
            layout.detachedTabs[i] = { ...dt, tabId: tab.id }
          } else if (candidates.length > 1) {
            // Ambiguous — multiple live tabs share this stripped prefix.
            // This shouldn't happen in practice (the prefix includes the
            // extension uuid), but log defensively.
            dwarn(`applyLayout: stripped-suffix match for "${dt.tabId}" is ambiguous (${candidates.length} candidates). Skipping.`)
          }
        }
        if (tab) {
          // Lightweight restore: state + button affordances + DOM move.
          // No save (we just loaded). No open/close cascade (mount handled it).
          getTabAssignments().set(tab.id, 'secondary')
          hideMainTabButton(tab.id)
          addSecondaryTabButton(tab)
          updateDrawerTabVisibility()
          repositionTab(tab.id, 'secondary')
        } else if (!usedFallback) {
          // Once we've tried a few times and the id is still missing, surface
          // a visible warning. The first few attempts may simply be racing
          // the store's tab registration.
          if (attempts === 5) {
            const knownIds = tabs.map(t => t.id)
            dwarn(`applyLayout: stored detached tabId "${dt.tabId}" not found in store (and no suffix-drift match). Known ids: ${knownIds.join(', ')}. Layout may be stale.`)
          }
        }
      }
      if (attempts > 20 || layout.detachedTabs.every((dt: any) => hasTabAssignment(dt.tabId))) {
        if (_applyLayoutInterval !== null) {
          clearInterval(_applyLayoutInterval)
          _applyLayoutInterval = null
        }
        // Phase 4 (finding #2): if at least one tab was restored, pick the
        // first one as the active secondary tab. Without this, the
        // secondary panel header stays empty when the user opens the
        // drawer (showSecondaryTab was never called from the lightweight
        // restore path to avoid double-animating the active tab).
        // The first-tab pick is a reasonable default — the user can click
        // any tab button to switch. Future work: persist the active
        // secondary tab id in layout.json so we restore the exact one.
        const restored = layout.detachedTabs.find((dt: any) => hasTabAssignment(dt.tabId))
        if (restored) {
          showSecondaryTab(restored.tabId)
        }
        // Phase 3 (finding #5): the end-of-interval open/close block is gone.
        // The drawer's open/closed state was set at mount time via the
        // initialOpen option on createSecondarySidebar, so by the time we get
        // here the wrapper is already in the correct position. This is the
        // "fully open from the first paint" requirement.
        //
        // Safety net kept for the case where applyLayout is called WITHOUT a
        // prior mountSecondarySidebar(layout) — e.g. a future "reload layout"
        // debug action that re-applies after a session tweak.
        if (layout.secondary?.open === true && !isSecondarySidebarOpen()) {
          openSecondarySidebar()
        } else if (layout.secondary?.open === false && isSecondarySidebarOpen()) {
          closeSecondarySidebar()
        }
      }
    }, 500)
  }
}