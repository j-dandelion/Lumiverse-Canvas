// Lumiverse's Zustand store is NOT reachable by walking UP from the sidebar
// (the host element has no direct fiber reference to the store). Strategy:
// walk UP to the root ancestor, then scan DOWN to find the `drawerTabs`
// array and the full store snapshot. Caches the result for 3s.
//
// Caches are module-private. The public API is findStoreData (force-walk),
// getDrawerTabs (array of {id, title, root, ...}), getStoreSnapshot (raw
// store), isMainDrawerOpen / getMainDrawerSide (the two fields most code
// paths need).
import { getMainSidebar, getMainWrapper } from '../dom/lumiverse'
import { getFiberFromElement } from '../dom/fiber'
import { dlog } from '../debug/log'
import { drawerObserver } from '../sidebar/drawer-observer'

let _drawerTabsCache: DrawerTab[] | null = null
let _testDrawerTabsOverride = false
let _storeSnapshotCache: Record<string, unknown> | null = null
let _cacheTimestamp = 0
const CACHE_TTL_MS = 3000 // Re-walk fiber tree every 3 seconds max

export interface DrawerTab {
  id: string
  extensionId: string
  title: string
  description?: string
  shortName?: string
  iconSvg?: string
  iconUrl?: string
  root: HTMLElement
}

/**
 * Narrow view of the Lumiverse Zustand store snapshot's drawer-related fields.
 * The snapshot is typed as Record<string, unknown> because we extract it from
 * React fiber internals — this interface defines the known fields we read.
 */
export interface DrawerStoreSnapshot {
  drawerOpen?: boolean
  drawerSettings?: {
    side?: 'left' | 'right'
    showTabLabels?: boolean
  }
  /** Name of the currently active modal dialog, if any (e.g. "weaver").
   * May not be present in all Lumiverse versions — callers should handle
   * null (field absent) gracefully without fuzzy-matching dialogs. */
  activeModal?: string
}

/** Cast a raw store snapshot to the narrow DrawerStoreSnapshot view. */
export function asDrawerStore(store: Record<string, unknown>): DrawerStoreSnapshot {
  return store as DrawerStoreSnapshot
}

/**
 * Read the active modal name from the store snapshot, or null when no modal
 * is open or the field is not present in this Lumiverse version.
 * Use force=true to bust the 3s TTL and re-walk the fiber tree.
 */
export function getActiveModal(force = false): string | null {
  if (force) findStoreData(true)
  else findStoreData()
  const store = _storeSnapshotCache
  if (!store) return null
  const v = store['activeModal']
  if (typeof v === 'string') return v
  return null
}

function scanForStoreData(fiber: any, depth: number, maxDepth: number, visited: Set<any>, force: boolean): void {
  if (!fiber || depth > maxDepth || visited.has(fiber)) return
  visited.add(fiber)

  let hook = fiber.memoizedState
  let hookIdx = 0
  while (hook && hookIdx < 30) {
    const state = hook.memoizedState

    // Check for drawerTabs array (array of objects with id+title+root).
    // When force=true (called from tagMainSidebarButtons to re-tag missed
    // buttons), we overwrite the cache with a fresh result even if the
    // cache was non-null. Without this, a stale partial snapshot from the
    // first call (e.g., 1 of 3 tabs visible) would persist indefinitely.
    if ((force || !_drawerTabsCache) && Array.isArray(state) && state.length > 0 && state[0] && typeof state[0] === 'object') {
      const firstKeys = Object.keys(state[0])
      // DrawerTabState is the only spindle-placement slice whose entries
      // carry a `badge` field. Reject DockPanelState (has 'edge') and
      // FloatWidgetState (has 'x'/'y') which otherwise share id/title/root
      // with drawer tabs and would be mis-cached when LumiScript (or any
      // dock-panel-registering extension) is installed.
      if (firstKeys.includes('id') && firstKeys.includes('title') && firstKeys.includes('root')
          && firstKeys.includes('badge') && !firstKeys.includes('edge') && !firstKeys.includes('x')) {
        _drawerTabsCache = state as DrawerTab[]
      }
    }

    // Check for objects with drawerOpen (full store snapshot)
    if ((force || !_storeSnapshotCache) && state && typeof state === 'object' && !Array.isArray(state)) {
      const keys = Object.keys(state)
      if (keys.includes('drawerOpen') || keys.includes('drawerTabs')) {
        _storeSnapshotCache = state as Record<string, unknown>
      }
    }

    if (!force && _drawerTabsCache && _storeSnapshotCache) {
      _cacheTimestamp = Date.now()
      return // found both, stop early
    }

    hook = hook.next
    hookIdx++
  }

  scanForStoreData(fiber.child, depth + 1, maxDepth, visited, force)
  scanForStoreData(fiber.sibling, depth, maxDepth, visited, force)
}

export function findStoreData(force = false): void {
  const now = Date.now()
  if (!force && _drawerTabsCache && _storeSnapshotCache && (now - _cacheTimestamp) < CACHE_TTL_MS) return // cached and fresh

  // Guard: DOM not available (headless test / SSR).
  if (typeof document === 'undefined') return

  const sidebar = getMainSidebar()
  if (!sidebar) return

  const rootFiber = getFiberFromElement(sidebar)
  if (!rootFiber) return

  // Walk UP to root ancestor
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fiber: any = rootFiber
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ancestors: any[] = []
  while (fiber) {
    ancestors.push(fiber)
    fiber = fiber.return
  }

  // When forcing, we want a complete walk (not an early-out) so the cache
  // is fully refreshed. Pass force through to the recursive walker.
  if (force) {
    const visited = new Set<any>()
    for (let i = ancestors.length - 1; i >= Math.max(0, ancestors.length - 5); i--) {
      scanForStoreData(ancestors[i], 0, 30, visited, true)
    }
    _cacheTimestamp = Date.now()
    return
  }

  // Scan DOWN from the top ancestors (the root covers the whole tree)
  const visited = new Set<any>()
  for (let i = ancestors.length - 1; i >= Math.max(0, ancestors.length - 5); i--) {
    scanForStoreData(ancestors[i], 0, 30, visited, false)
    if (_drawerTabsCache && _storeSnapshotCache) {
      _cacheTimestamp = Date.now()
      break
    }
  }
}

export function getDrawerTabs(): DrawerTab[] {
  if (_testDrawerTabsOverride && _drawerTabsCache) return _drawerTabsCache
  // The DOM inventory is authoritative once DrawerObserver is running. Do
  // not let a stale fiber snapshot reintroduce a second live tab universe.
  // The observer registers untagged extension buttons by class, so this
  // inventory is complete without fiber unions (which were UNSTABLE: the
  // fiber walk can land on any extension's partial store, flip-flopping the
  // tab universe and driving an infinite SAVE_LAYOUT cascade).
  const observed = drawerObserver.getAllTabs()
  if (observed.length > 0) {
    return observed.map((tab) => ({
      id: tab.tabId,
      title: tab.title,
      root: tab.button,
      iconSvg: '',
      extensionId: tab.extensionId === 'unknown' ? '' : tab.extensionId,
    }))
  }
  findStoreData()
  if (_drawerTabsCache) return _drawerTabsCache
  dlog('getDrawerTabs: no host inventory available')
  return []
}

/**
 * Force-walk the fiber tree and return the REAL host-store drawerTabs,
 * bypassing the observer-derived facade that getDrawerTabs() prefers once
 * the observer is running.
 *
 * Why this exists (2026-08-17): at boot the observer can hold STALE
 * title-keyed entries (an extension registered untagged; the tagger's
 * composite-id write was missed). getDrawerTabs() then serves the stale
 * entry, and anyone sourcing ids from it — the tagger, the
 * assignToSecondary stale-entry upgrade — would see the title-as-id /
 * extensionId '' instead of the real spindle id. The tagger must write the
 * REAL composite id on the host button; the observer's updateEntry can then
 * upgrade the entry in place (the title-keyed state is otherwise
 * self-perpetuating: a re-scan sees existingId === entry.tabId and
 * early-returns). The DnD-install path already proved the fiber store is
 * authoritative pre-start (it resolved the composite id + extension kind).
 */
export function getHostStoreTabs(): DrawerTab[] {
  findStoreData(true)
  return _drawerTabsCache ? [..._drawerTabsCache] : []
}

export function getStoreSnapshot(): Record<string, unknown> | null {
  findStoreData()
  return _storeSnapshotCache
}

/**
 * Call a main-store Zustand action directly from the React fiber tree.
 *
 * Teardown paths need this: during extension disable the host invalidates the
 * frontend generation BEFORE running the cleanup chain, so every ctx API call
 * throws `SPINDLE_FRONTEND_INACTIVE` (assertFrontendActive) — but the raw
 * store action (`useStore.getState()[name]`) still works. The critical one is
 * `unregisterContainer`: while Canvas's container entry stays registered, the
 * host keeps routing its tabs into the detached Canvas element and never heals
 * them; once removed, ContainerTabContent's Pass 3 resets every affected tab
 * to `{kind:'main-drawer'}`.
 *
 * How the API object is found: zustand v5's `useStore` calls
 * `React.useCallback(() => selector(api.getState()), [api, selector])`, and
 * React stores a useCallback hook as `[callback, deps]` — so the deps array
 * contains the store API (`{getState, setState, subscribe, …}`) for EVERY
 * component that subscribes with a selector.
 *
 * Returns false when the action is not reachable so callers can log/degrade.
 */
type HostStoreApi = {
  getState?: () => Record<string, unknown> | null
  setState?: (...args: unknown[]) => unknown
}

function looksLikeStoreApi(v: unknown): v is HostStoreApi {
  if (!v || (typeof v !== 'object' && typeof v !== 'function')) return false
  const rec = v as HostStoreApi
  return typeof rec.getState === 'function' && typeof rec.setState === 'function'
}

/** Bounded recursive search for a store API in a hook memoizedState. */
function findStoreApiIn(value: unknown, depth: number): HostStoreApi | null {
  if (depth < 0 || value == null) return null
  const t = typeof value
  if (t !== 'object' && t !== 'function') return null
  if (looksLikeStoreApi(value)) return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findStoreApiIn(item, depth - 1)
      if (hit) return hit
    }
  }
  return null
}

function scanFiberForStoreApi(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fiber: any,
  depth: number,
  maxDepth: number,
  visited: Set<unknown>,
): HostStoreApi | null {
  if (!fiber || depth > maxDepth || visited.has(fiber)) return null
  visited.add(fiber)

  let hook = fiber.memoizedState
  let hookIdx = 0
  while (hook && hookIdx < 60) {
    const hit = findStoreApiIn(hook.memoizedState, 3)
    if (hit) {
      try {
        const state = hit.getState?.()
        if (state && typeof state === 'object'
            && ('unregisterContainer' in state || 'drawerTabs' in state)) {
          return hit
        }
      } catch { /* not the app store — keep scanning */ }
    }
    hook = hook.next
    hookIdx++
  }

  return scanFiberForStoreApi(fiber.child, depth + 1, maxDepth, visited)
      ?? scanFiberForStoreApi(fiber.sibling, depth, maxDepth, visited)
}

/** Locate the host Zustand API object via React fiber hook deps. */
export function findHostStoreApi(): HostStoreApi | null {
  if (typeof document === 'undefined') return null
  const anchors: Array<Element | null> = []
  try {
    anchors.push(
      getMainSidebar(),
      document.getElementById?.('root') ?? null,
      document.getElementById?.('app') ?? null,
      document.body ?? null,
    )
  } catch { /* non-DOM environment */ }

  for (const el of anchors) {
    if (!el) continue
    const fiber = getFiberFromElement(el)
    if (!fiber) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let root: any = fiber
    while (root?.return) root = root.return
    const hit = scanFiberForStoreApi(root, 0, 90, new Set())
    if (hit) return hit
  }
  return null
}

export function callHostStoreAction(name: string, ...args: unknown[]): boolean {
  // Preferred: the real Zustand API from React hook deps.
  const api = findHostStoreApi()
  if (api?.getState) {
    try {
      const state = api.getState()
      const fn = state?.[name]
      if (typeof fn === 'function') {
        ;(fn as (...a: unknown[]) => unknown).apply(state, args)
        return true
      }
    } catch { /* fall through to the snapshot cache */ }
  }
  // Fallback: the coarse fiber snapshot cache (may not carry actions).
  findStoreData(true)
  const snapFn = (_storeSnapshotCache as Record<string, unknown> | null)?.[name]
  if (typeof snapFn !== 'function') return false
  try {
    ;(snapFn as (...a: unknown[]) => unknown)(...args)
    return true
  } catch {
    return false
  }
}

export function isMainDrawerOpen(): boolean {
  // DOM first: the wrapper's className updates synchronously when the user
  // closes/opens the drawer, so it's the authoritative "is the drawer
  // visibly open right now?" source. The Zustand store snapshot is cached
  // with a 3-second TTL (see getStoreSnapshot), so for up to 3s after an
  // open/close the store can return the OLD value while the DOM already
  // shows the new state. The chat-reflow MutationObserver (in
  // chat/reflow.startReflowObserver) fires on wrapper class changes and
  // reads this function, so a stale-cache read here would leave the chat
  // shifted as if the drawer were still open until the cache TTL expires
  // (or a hard refresh, which clears the module-level cache). The user
  // repro is: open drawer, click all 15 tab buttons (each click refreshes
  // the cache via the tagger observer's findStoreData(true) call), click
  // the drawer tab to close -- the cache is now fresh with drawerOpen:
  // true, the DOM correctly lacks wrapperOpen, and the previous
  // store-first order would return the stale true. The store is kept as
  // a fallback for the very early code path where getMainWrapper() can't
  // resolve yet (first mount, before the wrapper element is in the DOM).
  const wrapper = getMainWrapper()
  if (wrapper) {
    return wrapper.classList.toString().includes('wrapperOpen')
  }
  const store = getStoreSnapshot()
  if (store) {
    const snapshot = asDrawerStore(store)
    if (typeof snapshot.drawerOpen === 'boolean') {
      return snapshot.drawerOpen
    }
  }
  return false
}

/**
 * Short-lived override for intentional side writes (Configure "Swap drawer
 * locations"). Host React may lag a frame (or longer under taskbar-mode)
 * before flipping wrapperLeft/wrapperRight; without this override,
 * getMainDrawerSide still returns the old DOM side and checkSideChanged
 * never remounts secondary / main-mirror.
 */
let _mainDrawerSideOverride: 'left' | 'right' | null = null

/** Set or clear the main-drawer-side override used by getMainDrawerSide. */
export function setMainDrawerSideOverride(side: 'left' | 'right' | null): void {
  _mainDrawerSideOverride = side
}

/** Current override value (null when none). Exported for settle helpers / tests. */
export function getMainDrawerSideOverride(): 'left' | 'right' | null {
  return _mainDrawerSideOverride
}

export function getMainDrawerSide(): 'left' | 'right' {
  // Intentional write path (Configure swap): prefer override until host DOM
  // catches up. See applyMainDrawerSideChange in drawer-sync.ts.
  if (_mainDrawerSideOverride === 'left' || _mainDrawerSideOverride === 'right') {
    return _mainDrawerSideOverride
  }
  // DOM first: the wrapper's className updates synchronously when the user
  // changes drawer side in Lumiverse settings. The Zustand store snapshot is
  // cached with a 3-second TTL (see getStoreSnapshot), so for up to 3s after
  // a side change the store can return the OLD value while the DOM already
  // shows the new side. The startSideChangeWatcher (2s poll) and
  // createSecondarySidebar (which reads getMainDrawerSide on first mount)
  // both depend on this function returning the up-to-date value, so we
  // prefer the live DOM class. The store is kept as a fallback for code
  // paths that run before getMainWrapper() can resolve (e.g. very early
  // during bundle init).
  const wrapper = getMainWrapper()
  if (wrapper) {
    return wrapper.classList.toString().includes('wrapperLeft') ? 'left' : 'right'
  }
  const store = getStoreSnapshot()
  if (store) {
    const snapshot = asDrawerStore(store)
    if (snapshot.drawerSettings) {
      return snapshot.drawerSettings.side || 'right'
    }
  }
  return 'right'
}

/** Test-only: pre-populate the store snapshot cache to simulate a stale
 *  cached read. Used by the chat-reflow staleness regression test
 *  (src/chat/__tests__/reflow-staleness.test.ts). The timestamp defaults
 *  to now, so subsequent getStoreSnapshot() calls return this snapshot
 *  for the standard 3s TTL window. Mirrors the __setSecondaryWrapperForTest
 *  pattern in src/sidebar/secondary.tsx. */
export function __setStoreSnapshotForTest(
  snap: Record<string, unknown> | null,
  timestamp: number = Date.now(),
): void {
  _storeSnapshotCache = snap
  _cacheTimestamp = timestamp
}

/** Test-only: pre-populate the drawer tabs cache to simulate a store lookup.
 *  Used by secondary-drawer.test.ts to inject extension tabs without needing
 *  a real fiber tree. Paired with __setStoreSnapshotForTest so the TTL cache
 *  check passes cleanly. */
export function __setDrawerTabsForTest(
  tabs: DrawerTab[] | null,
): void {
  _drawerTabsCache = tabs
  _testDrawerTabsOverride = tabs !== null
  _cacheTimestamp = Date.now()
}
