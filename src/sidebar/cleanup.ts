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
// on teardown") refers to clearStoreCache — wired into this module by a
// later cleanup-pass step. For now this module owns the registry and the
// iteration; consumers (sidebar/polish.ts) register their own teardowns.

import { dwarn } from '../debug/log'

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
  // (cleanupAll in the final module will also reset state; for now
  // this matches the v1.4.2 behavior of the registered teardowns.)
}
