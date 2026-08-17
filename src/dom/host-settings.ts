// Host drawer settings read/write bridge.
//
// GO / NO-GO: This module walks the React fiber tree to find a Zustand store
// snapshot that contains both `drawerSettings` AND a `setSetting` function.
// When found (GO), patchHostDrawerSettings can write to the host store
// directly. When not found (NO-GO), patchHostDrawerSettings returns false
// cleanly — no error thrown, no window.spindle.setSetting invented.
//
// After a successful host write, call findStoreData(true) so the 3s cache in
// store/index.ts is busted and downstream code sees the new state.
//
// For unit tests, inject a mock setter via __setHostSetSettingForTest.

import { getMainSidebar, getMainPanel, getMainWrapper } from './lumiverse'
import { getFiberFromElement } from './fiber'
import { dlog } from '../debug/log'
import { findStoreData, getStoreSnapshot } from '../store'

// ── Types ──

/** Host drawer settings shape (subset of Lumiverse's drawerSettings). */
export type HostDrawerSettings = {
  side?: 'left' | 'right'
  tabOrder?: string[]
  hiddenTabIds?: string[]
  showTabLabels?: boolean
  [key: string]: unknown
}

// ── Module-level caches ──

let _cachedDrawerSettings: HostDrawerSettings | null = null
let _cachedSetSetting: ((key: string, value: unknown) => void) | null = null
let _cacheTimestamp = 0
const CACHE_TTL_MS = 3000

// ── Test seam ──

let _testSetSetting: ((key: string, value: unknown) => void) | null = null

/**
 * Inject a mock setSetting for unit tests. Pass null to clear.
 * When set, isHostDrawerSettingsWritable returns true and
 * patchHostDrawerSettings delegates to the mock.
 */
export function __setHostSetSettingForTest(
  fn: ((key: string, value: unknown) => void) | null,
  drawerSettings?: HostDrawerSettings | null,
): void {
  _testSetSetting = fn
  if (drawerSettings !== undefined) {
    _cachedDrawerSettings = drawerSettings
    _cacheTimestamp = Date.now()
  }
}

// ── Fiber walker ──

/**
 * Walk the React fiber tree from the sidebar root looking for a Zustand
 * store snapshot that contains BOTH `drawerSettings` and `setSetting`.
 */
function scanForHostSettings(
  fiber: Record<string, unknown> | null,
  depth: number,
  maxDepth: number,
  visited: Set<Record<string, unknown>>,
): void {
  if (!fiber || depth > maxDepth || visited.has(fiber)) return
  visited.add(fiber)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let hook: any = (fiber as any).memoizedState
  let hookIdx = 0
  while (hook && hookIdx < 40) {
    const state = hook.memoizedState

    if (state && typeof state === 'object' && !Array.isArray(state)) {
      const keys = Object.keys(state)
      const hasDrawerSettings = keys.includes('drawerSettings')
      const hasSetSetting = keys.includes('setSetting') && typeof state.setSetting === 'function'

      if (hasDrawerSettings) {
        _cachedDrawerSettings = state.drawerSettings as HostDrawerSettings
      }
      if (hasSetSetting) {
        _cachedSetSetting = state.setSetting as (key: string, value: unknown) => void
      }
      if (hasDrawerSettings && hasSetSetting) {
        _cacheTimestamp = Date.now()
        return // found both
      }
    }

    hook = hook.next
    hookIdx++
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scanForHostSettings((fiber as any).child, depth + 1, maxDepth, visited)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scanForHostSettings((fiber as any).sibling, depth, maxDepth, visited)
}

/**
 * Walk fiber ancestry of a DOM node looking for drawerSettings + setSetting.
 * Host often uses fine-grained useStore selectors, so the full store (with
 * both keys) may only appear under useStore() without a selector (e.g. some
 * panels) or deep in the app tree — not only under the sidebar mount.
 */
function walkElementForHostSettings(el: Element | null, visited: Set<Record<string, unknown>>): void {
  if (!el) return
  const rootFiber = getFiberFromElement(el)
  if (!rootFiber) return

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fiber: any = rootFiber
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ancestors: any[] = []
  while (fiber) {
    ancestors.push(fiber)
    fiber = fiber.return
  }

  // Prefer top ancestors (closer to app root / full store subscriptions).
  for (let i = ancestors.length - 1; i >= Math.max(0, ancestors.length - 8); i--) {
    scanForHostSettings(ancestors[i], 0, 40, visited)
    if (_cachedSetSetting && _cachedDrawerSettings) return
  }
}

function findHostSettings(force = false): void {
  const now = Date.now()
  if (!force && _cachedSetSetting && _cachedDrawerSettings && (now - _cacheTimestamp) < CACHE_TTL_MS) {
    return // cached and fresh
  }

  if (_testSetSetting) {
    // Test seam active — don't walk the real DOM.
    if (_cachedDrawerSettings) return
    _cachedDrawerSettings = { tabOrder: [], hiddenTabIds: [], side: 'right' }
    return
  }

  // Guard: DOM not available (headless test / SSR).
  if (typeof document === 'undefined') return

  const visited = new Set<Record<string, unknown>>()
  // Sidebar first (historical path), then panel / wrapper / app root so we
  // can reach components that subscribe to the full store (useStore()).
  walkElementForHostSettings(getMainSidebar(), visited)
  if (!(_cachedSetSetting && _cachedDrawerSettings)) {
    walkElementForHostSettings(getMainPanel(), visited)
  }
  if (!(_cachedSetSetting && _cachedDrawerSettings)) {
    walkElementForHostSettings(getMainWrapper(), visited)
  }
  if (!(_cachedSetSetting && _cachedDrawerSettings)) {
    // Test stubs / partial documents may lack getElementById.
    const getById =
      typeof document.getElementById === 'function'
        ? (id: string) => document.getElementById(id)
        : () => null
    const appRoot = getById('root') || getById('app') || document.body || null
    walkElementForHostSettings(appRoot, visited)
  }
  if (_cachedSetSetting || _cachedDrawerSettings) {
    _cacheTimestamp = Date.now()
  }
}

// ── Public API ──

/**
 * Read the current host drawer settings from the fiber tree.
 * Returns null when the store snapshot is unavailable.
 */
export function getHostDrawerSettings(): HostDrawerSettings | null {
  findHostSettings()
  return _cachedDrawerSettings
}

/**
 * Write a partial update to host drawer settings.
 * Returns true if the write was applied. Returns false if the bridge is
 * unavailable (NO-GO path — no setSetting found in fiber tree).
 *
 * When successful, also calls findStoreData(true) to bust the 3s cache
 * in store/index.ts so downstream readers see the new state.
 */
export function patchHostDrawerSettings(
  partial: Partial<HostDrawerSettings>,
): boolean {
  findHostSettings()

  // Prefer test seam.
  if (_testSetSetting) {
    const current = getHostDrawerSettings() ?? {}
    const merged = { ...current, ...partial }
    _testSetSetting('drawerSettings', merged)
    // Update cache so subsequent getHostDrawerSettings() reflects the write.
    _cachedDrawerSettings = merged as HostDrawerSettings
    _cacheTimestamp = Date.now()
    // Bust the store cache so getDrawerTabs etc. see the new state.
    findStoreData(true)
    return true
  }

  if (!_cachedSetSetting) {
    // Fallback: the full Zustand snapshot (drawerOpen / drawerTabs walk)
    // often carries setSetting even when the dedicated host-settings walk
    // only found drawerSettings on a partial hook state.
    findStoreData(true)
    const snap = getStoreSnapshot() as { setSetting?: (k: string, v: unknown) => void; drawerSettings?: HostDrawerSettings } | null
    if (snap && typeof snap.setSetting === 'function') {
      _cachedSetSetting = snap.setSetting.bind(snap)
      if (snap.drawerSettings && typeof snap.drawerSettings === 'object') {
        _cachedDrawerSettings = snap.drawerSettings
      }
      _cacheTimestamp = Date.now()
      dlog('patchHostDrawerSettings: setSetting recovered from store snapshot')
    }
  }

  // Merge against the best-known current settings, then stamp the cache
  // *before* the host write (and even on NO-GO) so isShowTabLabels /
  // secondary menu wording see the intended value. Secondary Hide/Show
  // still stamps Canvas labels when the fiber bridge is unavailable;
  // without an optimistic cache, the next RClick still said "Hide".
  const current = _cachedDrawerSettings ?? {}
  const merged = { ...current, ...partial }
  _cachedDrawerSettings = merged as HostDrawerSettings
  _cacheTimestamp = Date.now()

  if (!_cachedSetSetting) {
    // NO-GO: no setSetting found in fiber tree / store snapshot.
    // Cache already holds the intended merge for Canvas chrome. But the
    // SIDE must never be optimistic: without a host write the drawer
    // physically cannot move, so a stamped side is a phantom that makes
    // every side read (Configure draft, single-layout fallback) disagree
    // with reality — Configure then re-attempts the swap on every Apply
    // and the model fights the world (2026-08-17). Drop `side` from the
    // cache entirely; readers fall back to getMainDrawerSide() (the real
    // DOM side). This also heals a phantom side stamped before this guard.
    if ('side' in partial) {
      delete (merged as Record<string, unknown>).side
      _cachedDrawerSettings = merged as HostDrawerSettings
    }
    dlog('patchHostDrawerSettings: setSetting not available (NO-GO)')
    return false
  }

  _cachedSetSetting('drawerSettings', merged)
  // Bust the 3s store cache so downstream readers see the new state.
  findStoreData(true)
  return true
}

// ── Host settings API fallback (NO-GO bridge) ──

/**
 * Test seam: inject a fake fetch for the host settings API. Pass null to
 * clear (the real global fetch is used in the browser).
 */
type SettingsApiFetch = (url: string, init?: RequestInit) => Promise<Response>
let _settingsApiFetch: SettingsApiFetch | null = null
export function __setSettingsApiFetchForTest(fn: SettingsApiFetch | null): void {
  _settingsApiFetch = fn
}

/**
 * Write drawer settings through Lumiverse's OWN settings API — the same PUT
 * the Settings modal's setSetting → persistKey flush performs
 * (PUT /api/v1/settings/:key, requireAuth via the session cookie, server
 * broadcasts SETTINGS_UPDATED → the client's ws handler reloads settings →
 * the store applies → React re-renders the drawer wrapper).
 *
 * Why: the fiber bridge is NO-GO in this runtime (the full store with
 * `setSetting` only lands in memoizedState while a bare `useStore()`
 * component is mounted — UserManagement/DatabankPanel, usually not), so
 * patchHostDrawerSettings can only stamp a local cache. The SIDE is the one
 * drawer setting Canvas cannot fake via DOM (the wrapper class is
 * React-owned), so a real host write needs this path.
 *
 * Safety: GETs the current row first and merges the patch into it, so a
 * partial patch can never clobber fields the page owns (showTabLabels,
 * panelWidthMode, customPanelWidth, ...). Returns false when the API is
 * unreachable (offline / non-hosted dev) — callers keep the converge-on-
 * real-side behavior.
 */
export async function writeHostDrawerSettingsViaApi(
  patch: Partial<HostDrawerSettings>,
): Promise<boolean> {
  try {
    const doFetch = _settingsApiFetch ?? ((url: string, init?: RequestInit) => fetch(url, init))
    // GET the current row first (404 when never written — fine).
    let current: HostDrawerSettings = {}
    try {
      const res = await doFetch('/api/v1/settings/drawerSettings', {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      if (res.ok) {
        const row = (await res.json()) as { value?: unknown } | null
        if (row && typeof row.value === 'object' && row.value !== null) {
          current = row.value as HostDrawerSettings
        }
      }
    } catch {
      /* row may not exist yet — start from {} */
    }
    const merged = { ...current, ...patch }
    const res = await doFetch('/api/v1/settings/drawerSettings', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: merged }),
    })
    if (res.ok) {
      dlog('writeHostDrawerSettingsViaApi: ok', { patch })
      return true
    }
    dlog('writeHostDrawerSettingsViaApi: rejected', { status: res.status })
    return false
  } catch (err) {
    dlog('writeHostDrawerSettingsViaApi: failed', String(err))
    return false
  }
}

/**
 * True when a writable `setSetting` was found in the fiber tree (or a
 * test seam is active), meaning patchHostDrawerSettings will succeed.
 */
export function isHostDrawerSettingsWritable(): boolean {
  if (_testSetSetting) return true
  findHostSettings()
  return _cachedSetSetting !== null
}

/** Clear all caches (for teardown / tests). */
export function clearHostSettingsCache(): void {
  _cachedDrawerSettings = null
  _cachedSetSetting = null
  _cacheTimestamp = 0
  _testSetSetting = null
}
