// Lifecycle test for the slash runtime feature.
//
// The original no-op bug was that the slash runtime's toggle-off path
// silently failed to detach (the panel's _slashDetach stayed null after
// the initial setup() mount, so applySettings' on→off branch was a no-op).
// This test exercises the feature's full mount → apply(on) → apply(off) →
// alwaysCleanup lifecycle with a stub attach function to assert that:
//   1. mount() calls the attach function and tracks the teardown
//   2. apply(prev, next { slashCommandsEnabled: true }) attaches a
//      runtime if none is active
//   3. apply(prev, next { slashCommandsEnabled: false }) detaches the
//      active runtime
//   4. alwaysCleanup() tears down any active runtime
//
// The test uses makeSlashFeature with a stub attach — no real Spindle
// ctx, no DOM, no document.querySelector. The lifecycle is what matters;
// the actual intercept listeners are tested in intercept.test.ts.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { failed++; console.error(`FAIL: ${msg} — expected ${String(expected)}, got ${String(actual)}`) }
}

import { makeSlashFeature } from '../registry'
import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import type { FullCanvasSettings } from '../../settings/state'
import { mergeCanvasSettings } from '../../types'

// --- Helpers ---

/** Build a minimal settings object with the given slashCommandsEnabled value. */
function settingsWithSlash(value: boolean): FullCanvasSettings {
  return { ...mergeCanvasSettings(null), slashCommandsEnabled: value }
}

/** Build a stub SpindleFrontendContext — the slash feature only needs
 *  getActiveChat() to be callable, and even that is only consulted lazily
 *  inside setText/toast. A no-op stub suffices for lifecycle testing. */
function makeStubCtx(): SpindleFrontendContext {
  return {} as SpindleFrontendContext
}

/** Build a stub attach function. Returns a tuple: [attach, detachSpy,
 *  attachSpy, activeRuntimeRefs]. Each call to attach produces a fresh
 *  runtime with its own teardown spy. */
function makeStubAttach() {
  const attachSpy = { count: 0 }
  const detachSpy = { count: 0 }
  const rids: number[] = []
  let nextRid = 0
  function attach(_ctx: SpindleFrontendContext): () => void {
    attachSpy.count++
    const rid = nextRid++
    rids.push(rid)
    return () => { detachSpy.count++ }
  }
  return { attach, attachSpy, detachSpy, rids }
}

// --- Tests ---

// Test 1: mount() attaches a runtime and tracks the teardown.
{
  const { attach, attachSpy, detachSpy, rids } = makeStubAttach()
  const { feature, getActiveDetach } = makeSlashFeature(attach)
  const ctx = makeStubCtx()
  feature.mount!(ctx, null)
  assertEqual(attachSpy.count, 1, 'mount() calls attach exactly once')
  assertEqual(rids.length, 1, 'mount() produces one runtime')
  assert(detachSpy.count === 0, 'mount() does not call detach')
  assert(getActiveDetach() !== null, 'mount() tracks the teardown')
  // Cleanup for next test
  detachSpy.count; // unused here
  // No way to clean up — makeStubAttach is fresh per test
  void detachSpy
}

// Test 2: apply(prev { off }, next { on }) attaches a runtime.
{
  const { attach, attachSpy } = makeStubAttach()
  const { feature } = makeSlashFeature(attach)
  const prev = settingsWithSlash(false)
  const next = settingsWithSlash(true)
  feature.apply!(prev, next, makeStubCtx())
  assertEqual(attachSpy.count, 1, 'apply(off→on) calls attach exactly once')
}

// Test 3: apply(prev { on }, next { off }) detaches the active runtime.
{
  const { attach, attachSpy, detachSpy } = makeStubAttach()
  const { feature } = makeSlashFeature(attach)
  // First mount to get a runtime active
  feature.mount!(makeStubCtx(), null)
  assertEqual(attachSpy.count, 1, 'precondition: mount attached a runtime')
  // Now apply off
  const prev = settingsWithSlash(true)
  const next = settingsWithSlash(false)
  feature.apply!(prev, next, makeStubCtx())
  assertEqual(detachSpy.count, 1, 'apply(on→off) calls detach exactly once')
}

// Test 4: apply(on→on) is a no-op (does not double-attach).
{
  const { attach, attachSpy } = makeStubAttach()
  const { feature } = makeSlashFeature(attach)
  feature.mount!(makeStubCtx(), null)
  assertEqual(attachSpy.count, 1, 'precondition: mount attached one runtime')
  const prev = settingsWithSlash(true)
  const next = settingsWithSlash(true)
  feature.apply!(prev, next, makeStubCtx())
  assertEqual(attachSpy.count, 1, 'apply(on→on) does not re-attach')
}

// Test 5: apply(off→off) is a no-op (does not call attach).
{
  const { attach, attachSpy } = makeStubAttach()
  const { feature } = makeSlashFeature(attach)
  const prev = settingsWithSlash(false)
  const next = settingsWithSlash(false)
  feature.apply!(prev, next, makeStubCtx())
  assertEqual(attachSpy.count, 0, 'apply(off→off) does not call attach')
}

// Test 6: mount() is idempotent (does not re-attach if a runtime is active).
{
  const { attach, attachSpy } = makeStubAttach()
  const { feature } = makeSlashFeature(attach)
  feature.mount!(makeStubCtx(), null)
  feature.mount!(makeStubCtx(), null)
  assertEqual(attachSpy.count, 1, 'mount() called twice attaches only once')
}

// Test 7: apply(off→on) when no runtime is active attaches a new one.
{
  const { attach, attachSpy } = makeStubAttach()
  const { feature } = makeSlashFeature(attach)
  // (No prior mount — fresh state.)
  const prev = settingsWithSlash(false)
  const next = settingsWithSlash(true)
  feature.apply!(prev, next, makeStubCtx())
  assertEqual(attachSpy.count, 1, 'apply(off→on) from clean state attaches one runtime')
}

// Test 8: apply(on→off) when no runtime is active is a no-op (no error).
{
  const { attach, detachSpy } = makeStubAttach()
  const { feature } = makeSlashFeature(attach)
  // (No prior mount — fresh state. No active runtime to detach.)
  const prev = settingsWithSlash(true)
  const next = settingsWithSlash(false)
  feature.apply!(prev, next, makeStubCtx())
  assertEqual(detachSpy.count, 0, 'apply(on→off) from clean state does not call detach')
}

// Test 9: alwaysCleanup() tears down an active runtime.
{
  const { attach, detachSpy } = makeStubAttach()
  const { feature, alwaysCleanup } = makeSlashFeature(attach)
  feature.mount!(makeStubCtx(), null)
  alwaysCleanup()
  assertEqual(detachSpy.count, 1, 'alwaysCleanup() detaches the active runtime')
}

// Test 10: alwaysCleanup() is a no-op when no runtime is active.
{
  const { attach, detachSpy } = makeStubAttach()
  const { alwaysCleanup } = makeSlashFeature(attach)
  alwaysCleanup()
  assertEqual(detachSpy.count, 0, 'alwaysCleanup() from clean state is a no-op')
}

// Test 11: getActiveDetach reflects state correctly.
{
  const { attach } = makeStubAttach()
  const { feature, getActiveDetach } = makeSlashFeature(attach)
  assert(getActiveDetach() === null, 'initial state: no active detach')
  feature.mount!(makeStubCtx(), null)
  assert(getActiveDetach() !== null, 'after mount: active detach is tracked')
  // apply off
  const prev = settingsWithSlash(true)
  const next = settingsWithSlash(false)
  feature.apply!(prev, next, makeStubCtx())
  assert(getActiveDetach() === null, 'after apply off: no active detach')
}

// Test 12: A user can toggle on→off→on→off in sequence; the runtime
// is attached/detached correctly each time. This is the regression test
// for the original no-op bug — the apply(on→off) MUST call detach.
{
  const { attach, attachSpy, detachSpy } = makeStubAttach()
  const { feature } = makeSlashFeature(attach)
  const ctx = makeStubCtx()
  // First mount (initial load with slash=on)
  feature.mount!(ctx, null)
  assertEqual(attachSpy.count, 1, 'initial mount attaches one')
  // User toggles off
  feature.apply!(settingsWithSlash(true), settingsWithSlash(false), ctx)
  assertEqual(detachSpy.count, 1, 'toggle off detaches')
  // User toggles on
  feature.apply!(settingsWithSlash(false), settingsWithSlash(true), ctx)
  assertEqual(attachSpy.count, 2, 'toggle on re-attaches')
  // User toggles off again
  feature.apply!(settingsWithSlash(true), settingsWithSlash(false), ctx)
  assertEqual(detachSpy.count, 2, 'toggle off detaches again')
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
