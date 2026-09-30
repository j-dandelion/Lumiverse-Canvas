// Tests for applyCanvasSideChange — S4 CSS-only side swap.
//
// Verifies:
//   - NO remount machinery runs on any side change (the S0 payoff: no
//     secondary unmount/mount, no main-mirror teardown).
//   - Override stamped; getMainDrawerSide returns desired while DOM lags.
//   - _lastKnownSide stamps to desired after apply (real side on degraded).
//   - Override cleared after settle when DOM matches (kept on hard timeout).
//   - checkSideChanged's MO path drives geometry with syncHost:false —
//     the host side write NEVER fires from the DOM-observer path.
//   - syncHost:true performs the guarded host write (patch).

import { mock } from 'bun:test'

// Track remount-related calls — every path must keep these at ZERO.
let mountCalls = 0
let unmountCalls = 0
let restyleSecondaryCalls = 0
let restyleMainCalls = 0
let patchHostCalls = 0
let apiWriteCalls = 0
// Side-swap geometry: the secondary pin must be re-reconciled, and the
// position pass must target the VISIBLE Canvas main shell (not the hidden
// host main drawer) via the main* opts.
let pinReconcileCalls = 0
let positionCalls = 0
// `any`: the value is assigned from inside the mock factory below; a
// precise nullable type gets flow-narrowed to `never` under this project's
// TS settings (test-file noise otherwise).
let lastPositionOpts: any = null

const MAIN_SHELL = {
  drawer: { style: {} },
  tabList: { style: {} },
  panel: { style: {} },
}

mock.module('../secondary', () => ({
  getSecondaryWrapper: () => null,
  isSecondarySidebarOpen: () => false,
  restyleSecondaryShellSide: () => { restyleSecondaryCalls++ },
}))

mock.module('../tab-position', () => ({
  applyTabListPosition: (_enabled: boolean, opts?: typeof lastPositionOpts) => {
    positionCalls++
    if (opts) lastPositionOpts = opts
  },
  reconcileTabListPin: () => { pinReconcileCalls++ },
}))

mock.module('../main-mirror-drawer', () => ({
  getMainMirrorWrapper: () => null,
  isCanvasMainOpen: () => false,
  isMainMirrorActive: () => false,
  restyleMainShellSide: () => { restyleMainCalls++ },
  getMainMirrorDrawer: () => MAIN_SHELL.drawer,
  getMainMirrorTabList: () => MAIN_SHELL.tabList,
  getMainMirrorPanel: () => MAIN_SHELL.panel,
}))

mock.module('../main-tab-pin', () => ({
  reconcileMainTabListPin: () => {},
}))

mock.module('../../dom/host-settings', () => ({
  getHostDrawerSettings: () => null,
  patchHostDrawerSettings: () => { patchHostCalls++; return true },
  writeHostDrawerSettingsViaApi: async () => { apiWriteCalls++; return true },
}))

// Import after mocks
import {
  applyCanvasSideChange,
  checkSideChanged,
  startSideChangeWatcher,
  rebindSideChangeWatcherIfNeeded,
  resetSideRemountStateAfterDisable,
  __setLastKnownSideForTest,
  __getLastKnownSideForTest,
  __resetSideApplyStateForTest,
  __setSideSettleHardMsForTest,
  stopSideChangeWatcher,
} from '../drawer-sync'
import {
  getMainDrawerSide,
  setMainDrawerSideOverride,
  getMainDrawerSideOverride,
  __setStoreSnapshotForTest,
} from '../../store'
import { getSettings, hydrateSettings } from '../../settings/state'

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
  restyleSecondaryCalls = 0
  restyleMainCalls = 0
  patchHostCalls = 0
  apiWriteCalls = 0
  pinReconcileCalls = 0
  positionCalls = 0
  lastPositionOpts = null
  setMainDrawerSideOverride(null)
  __setLastKnownSideForTest(null)
  __setStoreSnapshotForTest(null)
  stopSideChangeWatcher()
  __resetSideApplyStateForTest()
  hydrateSettings({ secondSidebarEnabled: true })
}

function tick(ms = 10): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ── A1: checkSideChanged (MO path) applies geometry with syncHost:false —
// no remount, no host write. ──
{
  reset()
  installMainWrapper('right')
  __setLastKnownSideForTest('right')

  setMainDrawerSideOverride('left')
  assertEqual(getMainDrawerSide(), 'left', 'A1: override left while DOM right')
  assertEqual(__getLastKnownSideForTest(), 'right', 'A1: last known still right before check')

  checkSideChanged()
  await tick()
  assertEqual(unmountCalls, 0, 'A1: NO unmount — remount machinery is gone')
  assertEqual(mountCalls, 0, 'A1: NO mount — shells restyle in place')
  assert(restyleMainCalls >= 1, 'A1: main shell restyled in place')
  assert(restyleSecondaryCalls >= 1, 'A1: secondary shell restyled in place')
  assert(pinReconcileCalls >= 1, 'A1: secondary pin re-reconciled for the new side')
  assert(positionCalls >= 2, 'A1: position applied to host + Canvas main shell')
  assert(lastPositionOpts?.mainDrawer === MAIN_SHELL.drawer, 'A1: position pass targets Canvas main drawer')
  assert(lastPositionOpts?.mainTabList === MAIN_SHELL.tabList, 'A1: position pass targets Canvas main tab list')
  assert(lastPositionOpts?.mainPanel === MAIN_SHELL.panel, 'A1: position pass targets Canvas main panel')
  assertEqual(patchHostCalls, 0, 'A1: MO path does NOT write the host (syncHost:false)')
  assertEqual(apiWriteCalls, 0, 'A1: MO path does NOT hit the settings API')
  assertEqual(__getLastKnownSideForTest(), 'left', 'A1: last known updated to left via apply')
  setMainDrawerSideOverride(null)
}

// ── A2: apply + DOM settles mid-wait → override cleared ──
{
  reset()
  const { setSide } = installMainWrapper('right')
  __setLastKnownSideForTest('right')
  __setSideSettleHardMsForTest(300)

  // Flip DOM on the FIRST microtask — it must beat the apply chain's
  // microtask so settle's immediate check sees the matched DOM
  // (the MutationObserver is a no-op stub in this harness).
  const flip = Promise.resolve().then(() => setSide('left'))

  const applyP = applyCanvasSideChange('left', { syncHost: false })
  await flip
  await applyP
  await tick(30)

  assertEqual(unmountCalls, 0, 'A2: apply restyles (no unmount)')
  assertEqual(__getLastKnownSideForTest(), 'left', 'A2: last known is left')
  assertEqual(getMainDrawerSideOverride(), null, 'A2: override cleared after DOM settles')
  assertEqual(getMainDrawerSide(), 'left', 'A2: getMainDrawerSide is left after settle')
}

// ── A3: apply with null last-known still applies ──
{
  reset()
  installMainWrapper('right')
  __setLastKnownSideForTest(null)

  await applyCanvasSideChange('left', { syncHost: false })
  assert(restyleMainCalls >= 1 && restyleSecondaryCalls >= 1, 'A3: restyles ran with null last-known')
  assertEqual(__getLastKnownSideForTest(), 'left', 'A3: last known becomes left')
}

// ── A4: apply when already on desired side — no remount, override settles ──
{
  reset()
  installMainWrapper('left')
  __setLastKnownSideForTest('left')

  await applyCanvasSideChange('left', { syncHost: false })
  await tick()
  assertEqual(unmountCalls, 0, 'A4: no unmount when already on desired side')
  assertEqual(mountCalls, 0, 'A4: no mount when already on desired side')
  assertEqual(getMainDrawerSideOverride(), null, 'A4: override cleared (DOM already matches)')
}

// ── A5: DOM never settles — keep override + lastKnown stays desired ──
// Old bug: timeout cleared override while shells sat on desired →
// getMainDrawerSide returned lagging DOM → reverse flip risk.
{
  reset()
  installMainWrapper('right') // never flips
  __setLastKnownSideForTest('right')
  __setSideSettleHardMsForTest(40)

  await applyCanvasSideChange('left', { syncHost: false })
  await tick(60)

  assertEqual(getMainDrawerSideOverride(), 'left', 'A5: override kept when DOM never settles')
  assertEqual(__getLastKnownSideForTest(), 'left', 'A5: lastKnown stamped to desired')
  assertEqual(getMainDrawerSide(), 'left', 'A5: getMainDrawerSide still returns override')
  assertEqual(unmountCalls, 0, 'A5: no remount under override (geometry only)')
}

// ── A6: concurrent applies serialize; final side is last desired ──
{
  reset()
  const { setSide } = installMainWrapper('right')
  __setLastKnownSideForTest('right')

  const p1 = applyCanvasSideChange('left', { syncHost: false })
  const p2 = applyCanvasSideChange('right', { syncHost: false })
  void tick(15).then(() => setSide('right'))
  await Promise.all([p1, p2])

  assertEqual(__getLastKnownSideForTest(), 'right', 'A6: last known ends on last apply (right)')
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

  startSideChangeWatcher()
  assertEqual(__getLastKnownSideForTest(), 'left', 'A7: start does not stomp non-null lastKnown')

  rebindSideChangeWatcherIfNeeded()
  assertEqual(__getLastKnownSideForTest(), 'left', 'A7: rebind preserves lastKnown')

  stopSideChangeWatcher()
  setMainDrawerSideOverride(null)
  assertEqual(__getLastKnownSideForTest(), 'left', 'A7: lastKnown still left after clear')
}

// ── A8: syncHost:true performs the guarded host write (patch) ──
{
  reset()
  installMainWrapper('right')
  __setLastKnownSideForTest('right')

  const res = await applyCanvasSideChange('left') // syncHost defaults true
  assertEqual(res.writeOk, true, 'A8: guarded write reports ok')
  assert(patchHostCalls >= 1, 'A8: patchHostDrawerSettings called for the swap')
  assertEqual(apiWriteCalls, 0, 'A8: no API fallback needed (patch seam ok)')
  assert(pinReconcileCalls >= 1, 'A8: secondary pin re-reconciled on the syncHost path')
  assert(lastPositionOpts?.mainDrawer === MAIN_SHELL.drawer, 'A8: Canvas main shell targeted on syncHost path')
  setMainDrawerSideOverride(null)
}

// ── A9: second drawer off — geometry still applies (no remount gating) ──
{
  reset()
  installMainWrapper('right')
  __setLastKnownSideForTest('left')
  setMainDrawerSideOverride('right')
  hydrateSettings({ secondSidebarEnabled: false })
  assertEqual(getSettings().secondSidebarEnabled, false, 'A9: second drawer off')

  restyleSecondaryCalls = 0
  checkSideChanged()
  await tick()
  assertEqual(unmountCalls, 0, 'A9: no unmount when second drawer off')
  assertEqual(mountCalls, 0, 'A9: no mount when second drawer off')
  assertEqual(__getLastKnownSideForTest(), 'right', 'A9: lastKnown updates to current side')
  setMainDrawerSideOverride(null)
}

// ── A10: resetSideRemountStateAfterDisable clears override, reseeds ──
{
  reset()
  installMainWrapper('left')
  __setLastKnownSideForTest('right')
  setMainDrawerSideOverride('right')

  resetSideRemountStateAfterDisable()

  assertEqual(getMainDrawerSideOverride(), null, 'A10: side override cleared')
  assertEqual(
    __getLastKnownSideForTest(),
    getMainDrawerSide(),
    'A10: lastKnown reseeded from getMainDrawerSide()',
  )
  assertEqual(__getLastKnownSideForTest(), 'left', 'A10: lastKnown matches live DOM left')
}

// ── A11: apply returns immediately; does not await host DOM settle ──
// Old bug: configure auto-commit blocked on waitForSideSettle (up to 2.5s),
// so rapid "Swap drawer locations" clicks queued multi-second delays.
{
  reset()
  installMainWrapper('right') // never flips
  __setLastKnownSideForTest('right')
  __setSideSettleHardMsForTest(800)

  const t0 = Date.now()
  await applyCanvasSideChange('left', { syncHost: false })
  const elapsed = Date.now() - t0

  assert(elapsed < 200, `A11: apply returns without awaiting settle (elapsed=${elapsed}ms)`)
  assertEqual(getMainDrawerSideOverride(), 'left', 'A11: override still held while DOM lags')
  assertEqual(__getLastKnownSideForTest(), 'left', 'A11: lastKnown desired after apply')
  assertEqual(unmountCalls, 0, 'A11: no remount before return')
  assertEqual(getMainDrawerSide(), 'left', 'A11: getMainDrawerSide is override left immediately')
}

// ── A12: rapid applies both return quickly; final side is last desired ──
{
  reset()
  installMainWrapper('right') // never flips during applies
  __setLastKnownSideForTest('right')
  __setSideSettleHardMsForTest(800)

  const t0 = Date.now()
  const p1 = applyCanvasSideChange('left', { syncHost: false })
  const p2 = applyCanvasSideChange('right', { syncHost: false })
  await Promise.all([p1, p2])
  const elapsed = Date.now() - t0

  assert(elapsed < 200, `A12: rapid applies do not stack settle waits (elapsed=${elapsed}ms)`)
  assertEqual(__getLastKnownSideForTest(), 'right', 'A12: last known is final desired')
  const ov = getMainDrawerSideOverride()
  assert(ov === null || ov === 'right', 'A12: override null or final desired, never left')
  assertEqual(getMainDrawerSide(), 'right', 'A12: getMainDrawerSide is right immediately')
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}/${passed + failed}`)
