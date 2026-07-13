// Tests for applyMainDrawerSideChange — Configure swap remount path.
//
// Verifies:
//   - With DOM lag (old side on wrapper), remount path runs under override
//     so getMainDrawerSide returns desired during checkSideChanged.
//   - _lastKnownSide updates to desired after apply.
//   - Override is cleared after settle when DOM matches (or after timeout).

import { mock } from 'bun:test'

// Track remount-related calls without mounting full secondary chrome.
let mountCalls = 0
let unmountCalls = 0

mock.module('../secondary', () => ({
  getSecondaryWrapper: () => null,
  isSecondarySidebarOpen: () => false,
  mountSecondarySidebar: () => { mountCalls++ },
  unmountSecondarySidebar: () => { unmountCalls++ },
}))

mock.module('../main-mirror-drawer', () => ({
  getMainMirrorWrapper: () => null,
  isCanvasMainOpen: () => false,
  isMainMirrorActive: () => false,
}))

mock.module('../main-tab-pin', () => ({
  reconcileMainTabListPin: () => {},
}))

// Import after mocks
import {
  applyMainDrawerSideChange,
  checkSideChanged,
  __setLastKnownSideForTest,
  __getLastKnownSideForTest,
  stopSideChangeWatcher,
} from '../drawer-sync'
import {
  getMainDrawerSide,
  setMainDrawerSideOverride,
  getMainDrawerSideOverride,
  __setStoreSnapshotForTest,
} from '../../store'

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

function ensureDocument() {
  if (typeof (globalThis as any).document === 'undefined') {
    ;(globalThis as any).document = {
      querySelector: () => null,
      createElement: () => ({}),
      documentElement: {
        classList: { add() {}, remove() {}, contains() { return false } },
        style: { setProperty() {}, removeProperty() {} },
      },
      body: { appendChild() {}, removeChild() {} },
    }
  }
  if (typeof (globalThis as any).requestAnimationFrame !== 'function') {
    ;(globalThis as any).requestAnimationFrame = (cb: (t: number) => void) =>
      setTimeout(() => cb(Date.now()), 0) as unknown as number
  }
  if (typeof (globalThis as any).MutationObserver === 'undefined') {
    ;(globalThis as any).MutationObserver = class {
      constructor(_cb: MutationCallback) {}
      observe() {}
      disconnect() {}
      takeRecords() { return [] }
    }
  }
}

function installMainWrapper(side: 'left' | 'right') {
  ensureDocument()
  const classSet = new Set<string>([
    side === 'left' ? 'wrapperLeft' : 'wrapperRight',
    'wrapperOpen',
    '_wrapper_abc',
  ])
  const wrapper: any = {
    classList: {
      toString() { return [...classSet].join(' ') },
      add(...cs: string[]) { for (const c of cs) classSet.add(c) },
      remove(...cs: string[]) { for (const c of cs) classSet.delete(c) },
      contains(c: string) { return classSet.has(c) },
    },
  }
  const sidebar: any = {
    closest(sel: string) {
      if (typeof sel === 'string' && sel.includes('_wrapper_')) return wrapper
      return null
    },
  }
  const prevQS = document.querySelector ? document.querySelector.bind(document) : null
  ;(document as any).querySelector = (sel: string) => {
    if (sel === '[data-spindle-mount="sidebar"]') return sidebar
    if (prevQS) {
      try { return prevQS(sel) } catch { return null }
    }
    return null
  }
  return {
    setSide(next: 'left' | 'right') {
      classSet.delete('wrapperLeft')
      classSet.delete('wrapperRight')
      classSet.add(next === 'left' ? 'wrapperLeft' : 'wrapperRight')
    },
  }
}

function reset() {
  mountCalls = 0
  unmountCalls = 0
  setMainDrawerSideOverride(null)
  __setLastKnownSideForTest(null)
  __setStoreSnapshotForTest(null)
  stopSideChangeWatcher()
}

// ── A1: override makes getMainDrawerSide return desired while DOM lags ──
{
  reset()
  installMainWrapper('right')
  __setLastKnownSideForTest('right')

  setMainDrawerSideOverride('left')
  assertEqual(getMainDrawerSide(), 'left', 'A1: override left while DOM right')
  assertEqual(__getLastKnownSideForTest(), 'right', 'A1: last known still right before check')

  checkSideChanged()
  assert(unmountCalls >= 1, 'A1: side change unmounts secondary')
  assert(mountCalls >= 1, 'A1: side change remounts secondary')
  assertEqual(__getLastKnownSideForTest(), 'left', 'A1: last known updated to left via override')
  setMainDrawerSideOverride(null)
}

// ── A2: applyMainDrawerSideChange remounts + settles when DOM flips mid-wait ──
{
  reset()
  const { setSide } = installMainWrapper('right')
  __setLastKnownSideForTest('right')

  // Flip DOM on next microtask so settle can clear override quickly.
  const flip = Promise.resolve().then(() => setSide('left'))

  const applyP = applyMainDrawerSideChange('left')
  await flip
  await applyP

  assert(unmountCalls >= 1, 'A2: apply remounts (unmount)')
  assert(mountCalls >= 1, 'A2: apply remounts (mount)')
  assertEqual(__getLastKnownSideForTest(), 'left', 'A2: last known is left')
  assertEqual(getMainDrawerSideOverride(), null, 'A2: override cleared after DOM settles')
  assertEqual(getMainDrawerSide(), 'left', 'A2: getMainDrawerSide is left after settle')
}

// ── A3: apply with no last-known still forces remount ──
{
  reset()
  const { setSide } = installMainWrapper('right')
  __setLastKnownSideForTest(null)

  void Promise.resolve().then(() => setSide('left'))

  await applyMainDrawerSideChange('left')
  assert(unmountCalls >= 1 || mountCalls >= 1, 'A3: remount path ran with null last-known')
  assertEqual(__getLastKnownSideForTest(), 'left', 'A3: last known becomes left')
}

// ── A4: apply when already on desired side does not double-remount ──
{
  reset()
  const { setSide } = installMainWrapper('left')
  setSide('left')
  __setLastKnownSideForTest('left')
  mountCalls = 0
  unmountCalls = 0

  await applyMainDrawerSideChange('left')
  assertEqual(unmountCalls, 0, 'A4: no unmount when already on desired side')
  assertEqual(mountCalls, 0, 'A4: no mount when already on desired side')
  assertEqual(getMainDrawerSideOverride(), null, 'A4: override cleared (DOM already matches)')
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}/${passed + failed}`)
