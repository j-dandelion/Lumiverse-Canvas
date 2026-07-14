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
let mirrorReconcileCalls = 0

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
  reconcileMainMirrorDrawer: () => { mirrorReconcileCalls++ },
}))

mock.module('../main-tab-pin', () => ({
  reconcileMainTabListPin: () => {},
}))

// Import after mocks
import {
  applyMainDrawerSideChange,
  checkSideChanged,
  startSideChangeWatcher,
  rebindSideChangeWatcherIfNeeded,
  resetSideRemountStateAfterDisable,
  __setLastKnownSideForTest,
  __getLastKnownSideForTest,
  __resetSideApplyStateForTest,
  __setSideSettleHardMsForTest,
  __getSideRemountGenForTest,
  stopSideChangeWatcher,
} from '../drawer-sync'
import {
  getMainDrawerSide,
  setMainDrawerSideOverride,
  getMainDrawerSideOverride,
  __setStoreSnapshotForTest,
} from '../../store'
import { getSettings, hydrateSettings, resetHydrationGuard } from '../../settings/state'

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
  mirrorReconcileCalls = 0
  setMainDrawerSideOverride(null)
  __setLastKnownSideForTest(null)
  __setStoreSnapshotForTest(null)
  stopSideChangeWatcher()
  __resetSideApplyStateForTest()
  // Default second drawer ON so A1–A8 remount paths stay active.
  // Prefer hydrate over setSettings so we do not run feature apply.
  resetHydrationGuard()
  hydrateSettings({ secondSidebarEnabled: true })
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
  assert(mirrorReconcileCalls >= 1, 'A1: side change explicitly reconciles main mirror')
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
  assert(mirrorReconcileCalls >= 1, 'A2: apply reconciles main mirror')
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

// ── A5: DOM never settles — keep override + lastKnown stays desired ──
// Old bug: timeout cleared override while shells sat on desired → getMainDrawerSide
// returned lagging DOM → next check could remount reverse.
{
  reset()
  installMainWrapper('right') // never flips
  __setLastKnownSideForTest('right')
  __setSideSettleHardMsForTest(40) // exercise hard-timeout without 2.5s wait

  await applyMainDrawerSideChange('left')

  assertEqual(getMainDrawerSideOverride(), 'left', 'A5: override kept when DOM never settles')
  assertEqual(__getLastKnownSideForTest(), 'left', 'A5: lastKnown stamped to desired')
  assertEqual(getMainDrawerSide(), 'left', 'A5: getMainDrawerSide still returns override')
  assert(unmountCalls >= 1, 'A5: remount still ran under override')
}

// ── A6: concurrent applies serialize; final side is last desired ──
{
  reset()
  const { setSide } = installMainWrapper('right')
  __setLastKnownSideForTest('right')

  // Start left then right rapidly. DOM settles to right only.
  const p1 = applyMainDrawerSideChange('left')
  const p2 = applyMainDrawerSideChange('right')
  // Flip DOM to final desired after a tick so settle can clear.
  void Promise.resolve().then(() => setSide('right'))
  await Promise.all([p1, p2])

  assertEqual(__getLastKnownSideForTest(), 'right', 'A6: last known ends on last apply (right)')
  // Override should be cleared once DOM matches right (or still right if lagging).
  const ov = getMainDrawerSideOverride()
  assert(ov === null || ov === 'right', 'A6: override null or final desired, never left')
  assertEqual(getMainDrawerSide(), 'right', 'A6: getMainDrawerSide is right')
}

// ── A7: rebind / startSideChangeWatcher must not stomp lastKnown after apply ──
{
  reset()
  installMainWrapper('right') // DOM lags on right
  __setLastKnownSideForTest('left') // shells already on left after apply
  setMainDrawerSideOverride('left')

  // startSideChangeWatcher used to set lastKnown = getMainDrawerSide() which
  // under override is left (ok) — but after settle-clear + lagging DOM it
  // would stomp to right. With null-only seed, non-null lastKnown is preserved.
  startSideChangeWatcher()
  assertEqual(__getLastKnownSideForTest(), 'left', 'A7: start does not stomp non-null lastKnown')

  // rebind path also must not stomp.
  rebindSideChangeWatcherIfNeeded()
  assertEqual(__getLastKnownSideForTest(), 'left', 'A7: rebind preserves lastKnown')

  stopSideChangeWatcher()
  setMainDrawerSideOverride(null)
  // After clear, lastKnown still left even though DOM is right — intentional
  // stamp from apply; only checkSideChanged should update on real change.
  assertEqual(__getLastKnownSideForTest(), 'left', 'A7: lastKnown still left after clear')
}

// ── A8: checkSideChanged bumps remount gen (async assign guard contract) ──
{
  reset()
  installMainWrapper('right')
  __setLastKnownSideForTest('left')
  setMainDrawerSideOverride('right')
  const genBefore = __getSideRemountGenForTest()
  checkSideChanged()
  assert(
    __getSideRemountGenForTest() > genBefore,
    'A8: remount gen increments on side change',
  )
  setMainDrawerSideOverride(null)
}

// ── A9: secondSidebarEnabled false — side change does NOT remount ──
{
  reset()
  installMainWrapper('right')
  __setLastKnownSideForTest('left')
  setMainDrawerSideOverride('right')
  resetHydrationGuard()
  hydrateSettings({ secondSidebarEnabled: false })
  assertEqual(getSettings().secondSidebarEnabled, false, 'A9: second drawer off')

  const genBefore = __getSideRemountGenForTest()
  mountCalls = 0
  unmountCalls = 0
  mirrorReconcileCalls = 0

  checkSideChanged()

  assertEqual(unmountCalls, 0, 'A9: no unmount when second drawer off')
  assertEqual(mountCalls, 0, 'A9: no mount when second drawer off')
  assertEqual(mirrorReconcileCalls, 0, 'A9: no mirror reconcile when second drawer off')
  assertEqual(__getSideRemountGenForTest(), genBefore, 'A9: remount gen unchanged when gated off')
  assertEqual(__getLastKnownSideForTest(), 'right', 'A9: lastKnown still updates to current side')
  setMainDrawerSideOverride(null)
}

// ── A10: resetSideRemountStateAfterDisable bumps gen, clears override, reseeds ──
{
  reset()
  installMainWrapper('left')
  __setLastKnownSideForTest('right')
  setMainDrawerSideOverride('right')
  const genBefore = __getSideRemountGenForTest()

  resetSideRemountStateAfterDisable()

  assert(
    __getSideRemountGenForTest() > genBefore,
    'A10: remount gen increments on reset after disable',
  )
  assertEqual(getMainDrawerSideOverride(), null, 'A10: side override cleared')
  assertEqual(
    __getLastKnownSideForTest(),
    getMainDrawerSide(),
    'A10: lastKnown reseeded from getMainDrawerSide()',
  )
  assertEqual(__getLastKnownSideForTest(), 'left', 'A10: lastKnown matches live DOM left')
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}/${passed + failed}`)
