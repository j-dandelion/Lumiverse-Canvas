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
import { getDrawerTabs } from '../store'
import {
  getSecondaryWrapper, isSecondarySidebarOpen, SECONDARY_WIDTH_VAR,
} from '../sidebar/secondary'
import { getTabAssignments } from '../tabs/assignment'
import { getSettings, cancelSettingsSave } from '../settings/state'

export { applyLayout } from './apply'

// Stub value — build.sh injects the real version from package.json via sed before bundling.
export const CANVAS_VERSION = ''

interface BackendCtx {
  sendToBackend(msg: { type: string; [key: string]: unknown }): void
  onBackendMessage(handler: (payload: unknown) => void): () => void
}

let _backendCtx: BackendCtx | null = null

export function getBackendCtx(): BackendCtx | null { return _backendCtx }
export function setBackendCtx(ctx: BackendCtx): void { _backendCtx = ctx }

// Debounce timer for persistLayout (tab assignments, width)
let _saveLayoutTimer: ReturnType<typeof setTimeout> | null = null
// Called by sidebar/cleanup.cleanupAll on teardown.
export function cancelLayoutSave(): void {
  if (_saveLayoutTimer !== null) {
    clearTimeout(_saveLayoutTimer)
    _saveLayoutTimer = null
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
    let settled = false

    // Phase 3 (finding #13): register a one-shot handler that resolves the
    // promise when LAYOUT_DATA arrives. The handler is replaced by the
    // permanent ctx.onBackendMessage listener in setup() before any other
    // LAYOUT_DATA could come through.
    const handler = (payload: any) => {
      if (payload.type === 'LAYOUT_DATA') {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        if (typeof unsub === 'function') unsub()
        resolve(payload.layout)
      }
    }
    const unsub = backendCtx.onBackendMessage(handler)
    backendCtx.sendToBackend({ type: 'LOAD_LAYOUT' })
    // Safety timeout: if the backend never responds (e.g. corrupt storage),
    // resolve with null so the mount proceeds with defaults rather than
    // hanging the extension. 2s is enough for the file I/O round-trip on
    // a warm cache; longer waits mask real bugs.
    const timeoutId = setTimeout(() => {
      if (settled) return
      settled = true
      if (typeof unsub === 'function') unsub()
      resolve(null)
    }, 2000)
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



