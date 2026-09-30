// Tracked-active sync coalescing must not drop the trailing trigger
// (review batch 3).
//
// Bug: `dispatchTrackedActiveSync` cleared its coalescing flag only after the
// whole `await dispatch(...)` settled. A second activation arriving during
// that await returned early and was LOST — the body had already read the
// tracked values. Secondary clicks rely on this sync as their only
// model-convergence path, so rapid clicks could leave `active.secondary` on
// the earlier tab (and persist it).
//
// This drives the REAL dispatch with a changing tracked-active source:
//   pass #1 reads 'h:a' (model already active on A → no-op),
//   pass #2 (the trailing trigger) reads 'h:b' and must converge the model.

;(globalThis as any).document = {
  documentElement: {
    classList: {
      _c: new Set<string>(),
      contains(c: string) { return this._c.has(c) },
      add(c: string) { this._c.add(c) },
      remove(c: string) { this._c.delete(c) },
    },
    style: { setProperty() {}, removeProperty() {}, getPropertyValue() { return '' } },
  },
  querySelector: () => null,
  querySelectorAll: () => [],
  body: { querySelector: () => null, appendChild() {}, removeChild() {} },
}

import { mock } from 'bun:test'
import * as actualActiveTab from '../../tabs/active-tab'

mock.module('../../debug/log', () => ({ dlog: () => {}, dwarn: () => {}, setDebug: () => {} }))

// The tracked-active source: first read A, all later reads B. Spread the real
// module so other importers (assignment re-exports) keep their exports.
let reads = 0
mock.module('../../tabs/active-tab', () => ({
  ...actualActiveTab,
  resolvePrimaryActiveTabId: () => null,
  getActiveSecondaryTabId: () => (reads++ === 0 ? 'h:a' : 'h:b'),
}))

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else {
    console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    failed++
  }
}

const { bootstrap, shutdown, flush, getModel, dispatchTrackedActiveSync } =
  await import('../../recon/dispatch')
const { FakeHost } = await import('../../host/fake/implementation')
const { builtinKey, createEmptyModel } = await import('../../core/model')

const A = builtinKey('a')
const B = builtinKey('b')
const host = new FakeHost([
  { key: A, liveId: 'h:a', location: 'secondary', hidden: false, activeInPrimary: false, activeInSecondary: true, hasContentRoot: true, isBuiltin: true },
  { key: B, liveId: 'h:b', location: 'secondary', hidden: false, activeInPrimary: false, activeInSecondary: false, hasContentRoot: true, isBuiltin: true },
])
const model = {
  ...createEmptyModel(),
  secondary: [A, B],
  active: { primary: null, secondary: A },
}

shutdown()
reads = 0
bootstrap(model, host, 'test-version')
await flush()
assertEqual(getModel()!.active.secondary, A, 'setup: model active on A')

// Two triggers in the same tick: the second lands while pass #1 is awaiting
// the active-tab import + dispatch. It must be queued as a trailing rerun.
reads = 0
void dispatchTrackedActiveSync()
void dispatchTrackedActiveSync()
await new Promise<void>((r) => setTimeout(r, 30))
await flush()

assertEqual(getModel()!.active.secondary, B, 'trailing trigger converges the model to B')
assert(reads >= 2, `trailing rerun re-read the tracked source (reads=${reads})`)

console.log(`recon/tracked-sync-trailing: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

export {}
