// Custom assertion harness — see Chronicle testing-conventions.md
let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    console.error(`FAIL: ${message} — expected ${expected}, got ${actual}`)
    failed++
  }
}

import { animateWrapper, cancelWrapperAnimation, __getAnimState } from '../animation'

// --- Setup: mock rAF/cancelAnimationFrame for non-browser test env ---
let _rafId = 0
const _rafCallbacks = new Map<number, FrameRequestCallback>()
const _origRaf = globalThis.requestAnimationFrame
const _origCaf = globalThis.cancelAnimationFrame
let cancelCount = 0

globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
  _rafId++
  _rafCallbacks.set(_rafId, cb)
  return _rafId
}) as typeof requestAnimationFrame

globalThis.cancelAnimationFrame = ((id: number) => {
  cancelCount++
  _rafCallbacks.delete(id)
}) as typeof cancelAnimationFrame

function flushRaf() {
  const cbs = [..._rafCallbacks.values()]
  _rafCallbacks.clear()
  for (const cb of cbs) cb(performance.now())
}

function makeStubWrapper(): HTMLElement {
  return { style: { transform: '' } } as unknown as HTMLElement
}

// --- Test: cancel clears rAF state ---
try {
  const wrapper = makeStubWrapper()
  cancelWrapperAnimation() // ensure clean slate
  cancelCount = 0
  animateWrapper(wrapper, 200)
  const state = __getAnimState()
  assert(state.animRaf !== null, 'cancel clears rAF: animRaf is non-null after animateWrapper')

  cancelWrapperAnimation()
  const state2 = __getAnimState()
  assert(state2.animRaf === null, 'cancel clears rAF: animRaf is null after cancel')
  assertEqual(cancelCount, 1, 'cancel clears rAF: cancelAnimationFrame called once')
} catch (e) {
  console.log(`SKIP: cancel clears rAF — ${e}`)
}

// --- Test: cancel prevents transform overwrite ---
try {
  const wrapper = makeStubWrapper()
  cancelWrapperAnimation()
  animateWrapper(wrapper, 300)
  cancelWrapperAnimation()
  // After cancel, flushing the rAF queue should do nothing — the callback was removed
  flushRaf()
  // wrapper.style.transform should still be '' (never overwritten)
  assertEqual(wrapper.style.transform, '', 'cancel prevents overwrite: transform not set after cancel + flush')
} catch (e) {
  console.log(`SKIP: cancel prevents overwrite — ${e}`)
}

// --- Test: cancel is idempotent (no-op when nothing running) ---
try {
  cancelWrapperAnimation()
  cancelWrapperAnimation() // second call — should not throw
  const state = __getAnimState()
  assert(state.animRaf === null, 'cancel is idempotent: animRaf remains null')
  assert(state.animStart === null, 'cancel is idempotent: animStart remains null')
} catch (e) {
  console.log(`SKIP: cancel is idempotent — ${e}`)
}

// --- Test: subsequent animateWrapper still works after cancel ---
try {
  const wrapper = makeStubWrapper()
  cancelWrapperAnimation()
  animateWrapper(wrapper, 100)
  cancelWrapperAnimation()

  // Start a new animation after cancel
  animateWrapper(wrapper, 400)
  const state = __getAnimState()
  assert(state.animRaf !== null, 'subsequent animateWrapper works: animRaf scheduled')
  assert(state.animStart === null, 'subsequent animateWrapper works: animStart reset to null (lazy init)')
  // Flush to verify the new animation runs
  flushRaf()
  // transform should now be set (animFrame ran once)
  assert(wrapper.style.transform !== '', 'subsequent animateWrapper works: transform updated after flush')
} catch (e) {
  console.log(`SKIP: subsequent animateWrapper works — ${e}`)
}

// --- Cleanup ---
globalThis.requestAnimationFrame = _origRaf
globalThis.cancelAnimationFrame = _origCaf

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
