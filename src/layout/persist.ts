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
import {
  CANVAS_MAIN_ACTIVE_CLASS,
  CANVAS_MAIN_OPEN_CLASS,
  MAIN_MIRROR_WIDTH_VAR,
} from '../sidebar/styles'
import { getTabAssignments } from '../tabs/assignment'
import { getActiveSecondaryTabId } from '../tabs/active-tab'
import {
  getSettings, cancelSettingsSave, getLastLoadedLayout, setLastLoadedLayout,
} from '../settings/state'

export { applyLayout, isLayoutRestoreActive } from './apply'
import { isLayoutRestoreActive } from './apply'

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
// Guard: true while loadSavedLayout is awaiting the backend response.
// Suppresses all writes so a slow backend (2s timeout → null) does not
// result in the pagehide/beforeunload flush writing defaults over the
// real layout on disk.
let _loadInProgress = false
export function isLoadInProgress(): boolean { return _loadInProgress }
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
/**
 * Post SAVE_LAYOUT and keep `_lastLoadedLayout` aligned with disk.
 * Facet freeze (buildPersistedLayout for disabled facets) reads last-loaded;
 * without this sync, re-enabling "Remember tab assignments" falsely reports
 * drift after a successful save/load cycle.
 */
function writeLayoutToBackend(layout: any): void {
  const backendCtx = getBackendCtx()
  if (!backendCtx) return
  backendCtx.sendToBackend({ type: 'SAVE_LAYOUT', layout })
  setLastLoadedLayout(layout)
}

/** Update freeze base to the current merged layout without requiring IPC. */
export function syncLastLoadedFromPersistedLayout(): void {
  setLastLoadedLayout({ ...buildPersistedLayout(), settings: getSettings() })
}

export function flushPendingSaves(): void {
  const backendCtx = getBackendCtx()
  if (!backendCtx) return
  if (!isAnyLayoutPersistenceEnabled()) return
  if (_loadInProgress) return
  if (_saveLayoutTimer !== null) {
    clearTimeout(_saveLayoutTimer)
    _saveLayoutTimer = null
  }
  // Cancel the settings timer (not flush) — we post a single merged save
  // below, and a second post from the settings callback would be a duplicate
  // write that could race the one we're about to send.
  cancelSettingsSave()
  const layout = { ...buildPersistedLayout(), settings: getSettings() }
  writeLayoutToBackend(layout)
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
 * When keepTabListVisible owns main chrome, primary open/width live on the
 * Canvas main-mirror shell (document markers + CSS var), not the headless
 * host wrapper. Reading host open/width would freeze stale/wrong values.
 */
function isCanvasMainModeDom(): boolean {
  try {
    return typeof document !== 'undefined'
      && document.documentElement.classList.contains(CANVAS_MAIN_ACTIVE_CLASS)
  } catch {
    return false
  }
}

function readPrimaryOpen(): boolean {
  if (isCanvasMainModeDom()) {
    return document.documentElement.classList.contains(CANVAS_MAIN_OPEN_CLASS)
  }
  return _mainDrawerOpen
}

function readPrimaryWidth(): number {
  if (isCanvasMainModeDom()) {
    const fromVar = parseFloat(
      document.documentElement.style.getPropertyValue(MAIN_MIRROR_WIDTH_VAR),
    )
    if (isFinite(fromVar) && fromVar > 0) return fromVar
  }
  const hostW = getMainDrawerWidth()
  return hostW > 0 ? hostW : 420
}

/**
 * Build the current layout snapshot from in-memory state. Pure — no side effects.
 */
export function snapshotLayout(): any {
  const assignments = Array.from(getTabAssignments().entries())
  const secondaryAssignments = assignments.filter(([_, side]) => side === 'secondary')
  const result = {
    version: CANVAS_VERSION,
    primary: {
      // Host path: module-level cache from main-persist watchers.
      // Canvas main-mirror path: document open class + MAIN_MIRROR_WIDTH_VAR.
      open: readPrimaryOpen(),
      width: readPrimaryWidth(),
      tabId: _mainDrawerTabId,
    },
    secondary: {
      open: isSecondarySidebarOpen(),
      width: parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)) || 420,
      // The active secondary tab. Persisted so layout restore brings back
      // the same tab the user was on before refresh. Old layouts (saved
      // before this field existed) will have undefined; applyLayout falls
      // back to the first detached tab in that case. Only persisted when
      // a tab is actually active; null when the secondary has no active
      // tab (e.g. all tabs moved back to primary).
      activeTabId: getActiveSecondaryTabId(),
    },
    detachedTabs: secondaryAssignments
      .map(([tabId, side]) => {
        const tabs = getDrawerTabs()
        const tab = tabs.find(t => t.id === tabId)
        return { tabId, tabTitle: tab?.title || tabId, sidebar: side }
      }),
  }
  return result
}

/** Facet gates for independent layout persistence toggles. */
export function isOpenStatePersistenceEnabled(): boolean {
  return !!getSettings().persistDrawerOpenState
}
export function isWidthPersistenceEnabled(): boolean {
  return !!getSettings().persistDrawerWidth
}
export function isTabAssignmentPersistenceEnabled(): boolean {
  return !!getSettings().persistTabAssignments
}

/** Any geometry facet on — enables layout write paths (with merge). */
export function isAnyLayoutPersistenceEnabled(): boolean {
  const s = getSettings()
  return !!(s.persistDrawerOpenState || s.persistDrawerWidth || s.persistTabAssignments)
}

/** Shared gate alias: true when any layout facet is enabled. */
export function isPersistenceEnabled(): boolean {
  return isAnyLayoutPersistenceEnabled()
}

/**
 * Live snapshot for enabled facets; freeze last-loaded (or defaults) for
 * disabled facets. SAVE_LAYOUT replaces the whole blob, so partial write
 * means merge — never omit keys.
 */
export function buildPersistedLayout(): ReturnType<typeof snapshotLayout> {
  const live = snapshotLayout()
  const last = getLastLoadedLayout()
  const base = {
    primary: last?.primary ?? { open: false, width: 420 },
    secondary: last?.secondary ?? { open: false, width: 420 },
    detachedTabs: last?.detachedTabs ?? [],
  }
  const s = getSettings()
  return {
    version: live.version,
    primary: {
      open: s.persistDrawerOpenState ? live.primary.open : (base.primary.open ?? false),
      width: s.persistDrawerWidth ? live.primary.width : (base.primary.width ?? 420),
      tabId: s.persistDrawerOpenState
        ? live.primary.tabId
        : ((base.primary as { tabId?: string | null }).tabId ?? null),
    },
    secondary: {
      open: s.persistDrawerOpenState ? live.secondary.open : (base.secondary.open ?? false),
      width: s.persistDrawerWidth ? live.secondary.width : (base.secondary.width ?? 420),
      activeTabId: s.persistTabAssignments
        ? live.secondary.activeTabId
        : (base.secondary as { activeTabId?: string | null }).activeTabId,
    },
    detachedTabs: s.persistTabAssignments ? live.detachedTabs : (base.detachedTabs ?? []),
  }
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
  if (!isAnyLayoutPersistenceEnabled()) return
  if (_loadInProgress) return
  // Mid-restore assigns/unassigns must not thrash SAVE_LAYOUT (Load previous).
  if (isLayoutRestoreActive()) return
  if (_saveLayoutTimer !== null) {
    // A debounced persistLayout is in flight; cancel it so we don't double-write.
    clearTimeout(_saveLayoutTimer)
    _saveLayoutTimer = null
  }
  // Drain any pending settings save too: the synchronous layout write below
  // will carry the latest settings, so the older settings-bearing snapshot
  // must not be allowed to clobber it.
  cancelSettingsSave()
  const layout = { ...buildPersistedLayout(), settings: getSettings() }
  writeLayoutToBackend(layout)
}

/**
 * Persist the tab-assignment list + drawer width, debounced 500ms. Called
 * from assignTab and from the resize handle (the width change is frequent
 * during drag; the debounce coalesces to a single write at drag end).
 */
export function persistLayout(): void {
  const backendCtx = getBackendCtx()
  if (!backendCtx) return
  if (!isAnyLayoutPersistenceEnabled()) return
  if (_loadInProgress) return
  // Mid-restore assigns call persistLayout; defer until finishRestore + flush.
  if (isLayoutRestoreActive()) return
  if (_saveLayoutTimer !== null) {
    clearTimeout(_saveLayoutTimer)
  }
  // Drain any pending settings save: the debounced layout write below will
  // carry the latest settings, so the older settings-bearing snapshot must
  // not be allowed to clobber it.
  cancelSettingsSave()
  _saveLayoutTimer = setTimeout(() => {
    _saveLayoutTimer = null
    if (isLayoutRestoreActive()) return
    const layout = { ...buildPersistedLayout(), settings: getSettings() }
    writeLayoutToBackend(layout)
  }, 500)
}

export function loadSavedLayout(): Promise<any> {
  const backendCtx = getBackendCtx()
  if (!backendCtx) return Promise.resolve(null)
  _loadInProgress = true
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
        _loadInProgress = false
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
      _loadInProgress = false
      if (typeof unsub === 'function') unsub()
      resolve(null)
    }, 2000)
  })
}

/**
 * Restore the main drawer's open/close + active tab and/or width from
 * the saved layout. Independent of applyLayout (which is gated on
 * secondSidebarEnabled) — the main drawer is host-owned.
 *
 * Open/tab and width are gated separately via layout facet settings.
 *
 * Delegates to restoreMainDrawerFromDom() in sidebar/main-persist.ts,
 * which simulates a tab-button click to open the drawer (the host's
 * spindle.ui API is not exposed to extensions at runtime).
 */
export function applyMainDrawer(layout: any): void {
  const restoreOpen = isOpenStatePersistenceEnabled()
  const restoreWidth = isWidthPersistenceEnabled()

  if (!restoreOpen && !restoreWidth) {
    // No main-drawer facets on — do not restore open/tab/width; still lift
    // the restore-pending guard so host/mirror is not left hidden.
    import('../sidebar/main-persist').then(({ unsuppressMainDrawer }) => {
      unsuppressMainDrawer()
    })
    return
  }

  if (!layout || !layout.primary) {
    // No primary state to restore — lift the restore-pending guard so
    // the host/mirror drawer is not left hidden until the 3s timeout.
    import('../sidebar/main-persist').then(({ unsuppressMainDrawer }) => {
      unsuppressMainDrawer()
    })
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
      restoreWidth && typeof layout.primary.width === 'number' ? layout.primary.width : undefined,
      { restoreOpen, restoreWidth },
    )
  })
}



