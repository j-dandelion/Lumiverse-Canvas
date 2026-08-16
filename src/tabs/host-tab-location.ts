// Host tabLocations write path for built-in (and other) drawer tabs.
//
// Official API: ctx.ui.requestTabLocation (requires ui_panels). The host
// silently no-ops for built-ins outside CORE_DRAWER_TAB_IDS (wallpaper,
// imagegen, connections, worldinfo, …) — getBuiltInTabRoot still works,
// so Canvas used to show empty secondary tabs.
//
// After every request we verify with getTabLocation. On silent deny we
// fall back to the live Zustand action moveTabTo found via fiber walk
// (same pattern as host-settings setSetting). ContainerTabContent only
// reparents when tabLocations says { kind: 'container', containerId }.

import type { SpindleTabLocation } from '../dom/host-bridge'
import { getHostBridge } from '../dom/host-bridge'
import { getFiberFromElement } from '../dom/fiber'
import { getMainPanel, getMainSidebar, getMainWrapper } from '../dom/lumiverse'
import { findStoreData, getStoreSnapshot } from '../store'
import { dlog, dwarn } from '../debug/log'

export const CANVAS_SECONDARY_CONTAINER_ID = 'canvas-secondary-drawer'

export type RequestHostTabLocationResult = {
  ok: boolean
  via: 'bridge' | 'store' | 'none'
}

type MoveTabToFn = (tabId: string, location: SpindleTabLocation) => void

let _cachedMoveTabTo: MoveTabToFn | null = null
let _moveTabToCacheTs = 0
const MOVE_TAB_TO_TTL_MS = 3000

/** Test seam: inject moveTabTo without fiber walk. */
let _testMoveTabTo: MoveTabToFn | null = null

export function __setHostMoveTabToForTest(fn: MoveTabToFn | null): void {
  _testMoveTabTo = fn
  _cachedMoveTabTo = fn
  _moveTabToCacheTs = Date.now()
}

export function locationMatches(
  actual: { kind: string; containerId?: string } | null | undefined,
  expected: SpindleTabLocation,
): boolean {
  // Host treats missing entries as main-drawer.
  const effective = actual ?? { kind: 'main-drawer' as const }
  if (effective.kind !== expected.kind) return false
  if (expected.kind === 'container') {
    return (effective as { containerId?: string }).containerId === expected.containerId
  }
  return true
}

function readLocation(tabId: string): { kind: string; containerId?: string } | null {
  const ui = getHostBridge()?.ui
  if (ui?.getTabLocation) {
    try {
      return ui.getTabLocation(tabId) ?? null
    } catch {
      /* permission / inactive */
    }
  }
  findStoreData(true)
  const snap = getStoreSnapshot() as {
    tabLocations?: Record<string, { kind: string; containerId?: string }>
  } | null
  const loc = snap?.tabLocations?.[tabId]
  return loc ?? null
}

function scanFiberForMoveTabTo(
  fiber: Record<string, unknown> | null,
  depth: number,
  maxDepth: number,
  visited: Set<Record<string, unknown>>,
): MoveTabToFn | null {
  if (!fiber || depth > maxDepth || visited.has(fiber)) return null
  visited.add(fiber)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let hook: any = (fiber as any).memoizedState
  let hookIdx = 0
  while (hook && hookIdx < 40) {
    const state = hook.memoizedState
    if (state && typeof state === 'object' && !Array.isArray(state)) {
      const move = (state as { moveTabTo?: unknown }).moveTabTo
      if (typeof move === 'function') {
        return move as MoveTabToFn
      }
    }
    hook = hook.next
    hookIdx++
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const child = scanFiberForMoveTabTo((fiber as any).child, depth + 1, maxDepth, visited)
  if (child) return child
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return scanFiberForMoveTabTo((fiber as any).sibling, depth, maxDepth, visited)
}

function walkElementForMoveTabTo(el: Element | null, visited: Set<Record<string, unknown>>): MoveTabToFn | null {
  if (!el) return null
  const rootFiber = getFiberFromElement(el)
  if (!rootFiber) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fiber: any = rootFiber
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ancestors: any[] = []
  while (fiber) {
    ancestors.push(fiber)
    fiber = fiber.return
  }

  for (let i = ancestors.length - 1; i >= Math.max(0, ancestors.length - 8); i--) {
    const found = scanFiberForMoveTabTo(ancestors[i], 0, 40, visited)
    if (found) return found
  }
  return null
}

/**
 * Resolve host store.moveTabTo. Prefers injected test seam, then store
 * snapshot cache, then multi-anchor fiber walk (sidebar → panel → wrapper → app).
 */
export function getHostMoveTabTo(force = false): MoveTabToFn | null {
  if (_testMoveTabTo) return _testMoveTabTo

  const now = Date.now()
  if (!force && _cachedMoveTabTo && now - _moveTabToCacheTs < MOVE_TAB_TO_TTL_MS) {
    return _cachedMoveTabTo
  }

  findStoreData(force)
  const snap = getStoreSnapshot() as { moveTabTo?: unknown } | null
  if (snap && typeof snap.moveTabTo === 'function') {
    _cachedMoveTabTo = snap.moveTabTo as MoveTabToFn
    _moveTabToCacheTs = now
    return _cachedMoveTabTo
  }

  if (typeof document === 'undefined') return null

  const visited = new Set<Record<string, unknown>>()
  const anchors: Array<Element | null> = [
    getMainSidebar(),
    getMainPanel(),
    getMainWrapper(),
  ]
  if (typeof document.getElementById === 'function') {
    anchors.push(document.getElementById('root'), document.getElementById('app'), document.body)
  }

  for (const el of anchors) {
    const found = walkElementForMoveTabTo(el, visited)
    if (found) {
      _cachedMoveTabTo = found
      _moveTabToCacheTs = now
      return found
    }
  }

  _cachedMoveTabTo = null
  _moveTabToCacheTs = now
  return null
}

/**
 * Move a tab via official bridge, verifying with getTabLocation. On silent
 * allowlist deny (or missing bridge write), fall back to store.moveTabTo.
 */
export function requestHostTabLocation(
  tabId: string,
  location: SpindleTabLocation,
): RequestHostTabLocationResult {
  const ui = getHostBridge()?.ui

  if (ui?.requestTabLocation) {
    try {
      ui.requestTabLocation(tabId, location)
    } catch (err) {
      dwarn(`[tabmove] requestTabLocation threw for "${tabId}":`, err)
    }
    const after = readLocation(tabId)
    if (locationMatches(after, location)) {
      dlog(`[tabmove] requestHostTabLocation ok via=bridge tab=${tabId} loc=${JSON.stringify(location)}`)
      return { ok: true, via: 'bridge' }
    }
    dlog(
      `[tabmove] requestTabLocation did not stick for "${tabId}" ` +
      `(got ${JSON.stringify(after)}; often non-CORE allowlist silent no-op). Trying store.moveTabTo.`,
    )
  }

  const moveTabTo = getHostMoveTabTo(true)
  if (!moveTabTo) {
    // Intermediate: callers (builtin-move) fall through to DOM reparent.
    // Keep at dlog so the console does not look like a hard failure before via=dom.
    dlog(
      `[tabmove] bridge+store unavailable for "${tabId}" ` +
      `(allowlist no-op and moveTabTo missing) — caller may DOM-place.`,
    )
    return { ok: false, via: 'none' }
  }

  try {
    moveTabTo(tabId, location)
  } catch (err) {
    dwarn(`[tabmove] store.moveTabTo threw for "${tabId}":`, err)
    return { ok: false, via: 'none' }
  }

  const afterStore = readLocation(tabId)
  if (locationMatches(afterStore, location)) {
    dlog(`[tabmove] requestHostTabLocation ok via=store tab=${tabId} loc=${JSON.stringify(location)}`)
    return { ok: true, via: 'store' }
  }

  // Some fiber snapshots expose a dead moveTabTo from a prior generation.
  dwarn(
    `[tabmove] store.moveTabTo for "${tabId}" did not stick (loc=${JSON.stringify(afterStore)}).`,
  )
  return { ok: false, via: 'none' }
}

/** Convenience: place tab into canvas-secondary-drawer. */
export function requestHostTabToSecondary(tabId: string): RequestHostTabLocationResult {
  return requestHostTabLocation(tabId, {
    kind: 'container',
    containerId: CANVAS_SECONDARY_CONTAINER_ID,
  })
}

/** Convenience: restore tab to main drawer. */
export function requestHostTabToMain(tabId: string): RequestHostTabLocationResult {
  return requestHostTabLocation(tabId, { kind: 'main-drawer' })
}
