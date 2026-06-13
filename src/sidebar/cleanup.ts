// Sidebar cleanup registry.
//
// Each long-lived feature (side-change watcher, tab-registration watcher,
// slash runtime, etc.) registers a teardown function here at mount time.
// When the extension is disabled, the host calls the function returned by
// `setup()` — which is `cleanupAll` from this module — to run every
// registered teardown in order, swallowing errors so one failing teardown
// doesn't block the rest.
//
// The comment in store/index.ts:110 ("Called by sidebar/cleanup.cleanupAll
// on teardown") referred to clearStoreCache, which has been removed.
// This module owns the registry and the iteration; consumers
// (sidebar/drawer-sync.ts) register their own teardowns. PR-A wired
// clearTabAssignments/clearOriginalParents into cleanupAll so a
// disable→re-enable cycle doesn't see stale state.

import { dwarn } from '../debug/log'
import { clearTabAssignments, clearOriginalParents } from '../tabs/assignment'

const _cleanupFns: Array<() => void> = []

export function registerCleanup(fn: () => void) {
  _cleanupFns.push(fn)
}

export function cleanupAll() {
  for (const fn of _cleanupFns) {
    try { fn() } catch (err: unknown) {
      dwarn('Cleanup error:', err)
    }
  }
  _cleanupFns.length = 0

  // Reset module-level caches that don't have their own teardown registration
  try { clearTabAssignments() } catch (err: unknown) { dwarn('clearTabAssignments error:', err) }
  try { clearOriginalParents() } catch (err: unknown) { dwarn('clearOriginalParents error:', err) }
}
