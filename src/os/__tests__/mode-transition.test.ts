// Mode-transition arbiter (plan A-new) + A5-2: the nested mobile force must
// run inside an OS transition WITHOUT deadlocking.
//
// Chain semantics are unit-tested against the real leaf module (it imports
// nothing). The A5-2 integration drives the REAL os-mode + REAL
// second-drawer-mode (mocks mirror second-drawer-mode.test.ts) so the
// nested requestSecondDrawerMode path is the production code path.

// Custom assertion harness — see Chronicle testing-conventions.md
let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else {
    console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    failed++
  }
}

import { mock } from 'bun:test'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ── Chain unit tests (leaf module — no mocks) ──
const { runOsTransition, runDrawerTransition, runNestedDrawerTransition } =
  await import('../../settings/mode-transition')

// Drawer chain serializes; a rejecting run never wedges the chain.
{
  const order: string[] = []
  const p1 = runDrawerTransition(async () => {
    order.push('d1-start')
    await sleep(20)
    order.push('d1-end')
  })
  const p2 = runDrawerTransition(async () => { order.push('d2') })
  const p3 = runDrawerTransition(async () => { throw new Error('boom') })
  const p4 = runDrawerTransition(async () => { order.push('d4') })
  await Promise.all([p1, p2, p3.catch(() => {}), p4])
  assertEqual(
    order.join(','),
    'd1-start,d1-end,d2,d4',
    'drawer chain serializes in order; a rejection does not wedge later runs',
  )
}

// An OS run holds the drawer chain for its whole duration: external drawer
// requests queue behind it and execute only after it releases.
{
  const order: string[] = []
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  const osP = runOsTransition(async () => {
    order.push('os-start')
    await gate
    order.push('os-end')
  })
  await sleep(10) // OS run starts and holds the drawer chain
  const extP = runDrawerTransition(async () => { order.push('ext') })
  await sleep(30)
  assert(order.includes('os-start'), 'OS run started')
  assert(!order.includes('ext'), 'external drawer request queues behind the in-flight OS run')
  release()
  await Promise.all([osP, extP])
  assertEqual(order.join(','), 'os-start,os-end,ext', 'queued drawer request runs after the OS run releases')
}

// OS transitions serialize on the OS chain.
{
  const order: string[] = []
  const a = runOsTransition(async () => { order.push('os-a-start'); await sleep(20); order.push('os-a-end') })
  const b = runOsTransition(async () => { order.push('os-b') })
  await Promise.all([a, b])
  assertEqual(order.join(','), 'os-a-start,os-a-end,os-b', 'OS transitions serialize on the OS chain')
}

// Nested runner executes inline (caller already holds the drawer chain).
{
  const order: string[] = []
  await runOsTransition(async () => {
    order.push('os')
    await runNestedDrawerTransition(async () => { order.push('nested') })
    order.push('os-after')
  })
  assertEqual(order.join(','), 'os,nested,os-after', 'runNestedDrawerTransition runs inline inside the OS run')
}

// ── A5-2: nested mobile force inside an OS transition — no deadlock ──
// Mocks mirror second-drawer-mode.test.ts (real: settings/state,
// second-drawer-mode, os-mode, mode-transition, layout-model, layout-load).

;(globalThis as any).document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
    classList: { add() {}, remove() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => null,
    appendChild() {}, removeChild() {}, remove() {},
    addEventListener() {}, removeEventListener() {}, focus() {},
    children: [],
  }),
  documentElement: {
    classList: { add() {}, remove() {}, contains: () => false },
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
  },
  body: { appendChild() {}, removeChild() {} },
  addEventListener() {},
  removeEventListener() {},
}
;(globalThis as any).requestAnimationFrame = (cb: any) => { cb(1); return 1 }
;(globalThis as any).cancelAnimationFrame = () => {}
;(globalThis as any).CSS = { escape: (s: string) => s }
;(globalThis as any).getComputedStyle = () => ({})

// Mobile viewport: the OS enable must take the mobile-first slot path and
// force the second drawer through the NESTED requestSecondDrawerMode.
;(globalThis as { window?: unknown }).window = {
  matchMedia: () => ({ matches: true }),
}

import * as actualDispatch from '../../recon/dispatch'

const fakeSnapshot = {
  version: 2,
  primary: { open: false, width: 420, tabId: null },
  secondary: { open: false, width: 420, activeTabId: null },
  detachedTabs: [],
  tabOrder: ['builtin:loom'],
  hiddenTabIds: [],
  closedTabIds: [],
}

mock.module('../../features/registry', () => ({
  FEATURES: [],
}))
mock.module('../../debug/log', () => ({
  dlog: () => {},
  dwarn: () => {},
  setDebug: () => {},
}))
mock.module('../../debug/styles', () => ({
  injectStyles: () => {},
}))
mock.module('../../layout/snapshot', () => ({
  hasDetachedTabs: (l: any) => Array.isArray(l?.detachedTabs) && l.detachedTabs.length > 0,
  seedDualLayoutFromLive: () => {},
  buildPersistedLayout: () => fakeSnapshot,
}))
mock.module('../../recon/dispatch', () => ({
  ...actualDispatch,
  bootstrapFromLayout: () => {},
  flush: async () => {},
  bootPlacementDone: async () => {},
  getHost: () => null,
  getModel: () => null,
  snapshotOwnedModelLayout: () => fakeSnapshot,
  dispatchBatch: async () => {},
  onModelChanged: () => () => {},
}))
mock.module('../../tabs/owned-commit', () => ({
  commitDraftToOwnedModel: async () => ({ ok: true }),
}))
mock.module('../../sidebar/drawer-sync', () => ({
  resetSideRemountStateAfterDisable: () => {},
  isShowTabLabels: () => false,
  syncDrawerTabSettings: () => {},
  applyMainDrawerSideChange: async () => {},
  syncSecondaryTabLabels: () => {},
}))
mock.module('../../tabs/configure-modal', () => ({
  isConfigureTabsModalOpen: () => false,
  flushConfigureCommits: async () => {},
  refreshConfigureDraftFromLive: () => {},
  getConfigureDraftRef: () => null,
  getConfigureBaseRef: () => null,
}))
mock.module('../../tabs/configure-model', () => ({
  isDraftDirty: () => false,
}))

// Real modules under test (AFTER mocks).
const { applyOsModeChange, syncOsMobileDrawerMode } = await import('../os-mode')
const { requestSecondDrawerMode } = await import('../../settings/second-drawer-mode')
const { getSettings, setSettings, getOsSingleLayoutSlot } = await import('../../settings/state')

{
  // OS on + mobile + dual drawer enabled — the state runOsEnable's nested
  // force must reconcile. The OS drain holds both arbiter chains; a queued
  // (non-nested) requestSecondDrawerMode here would deadlock against them,
  // so resolving at all proves the nested path.
  setSettings({ osMode: true, secondSidebarEnabled: true, osForcedSingleDrawer: false })
  const p = applyOsModeChange({ osMode: false }, { osMode: true })
  const winner = await Promise.race([
    p.then(() => 'done'),
    sleep(2000).then(() => 'timeout'),
  ])
  assertEqual(winner, 'done', 'A5-2: OS enable with nested mobile force resolves (no deadlock)')
  assertEqual(
    getSettings().secondSidebarEnabled,
    false,
    'A5-2: nested force landed the single drawer inside the OS transition',
  )
  assert(
    getOsSingleLayoutSlot() != null,
    'A5-2: mobile-first path seeded the osSingle slot',
  )
  assertEqual(
    getSettings().osForcedSingleDrawer,
    true,
    'A5-2: force latch recorded the OS-initiated disable',
  )
}

{
  // External (non-nested) requests still queue normally after the OS run.
  setSettings({ secondSidebarEnabled: false })
  const p = requestSecondDrawerMode(true)
  const winner = await Promise.race([p.then(() => 'done'), sleep(2000).then(() => 'timeout')])
  // M6 guard: OS mode + mobile refuses the enable — resolves either way;
  // what matters is the queued chain is alive (not deadlocked).
  assertEqual(winner, 'done', 'A5-2: post-transition external request completes')
}

// ── F1 (adversarial): nested sync must never await a non-nested runner ──
// Deadlock cycle being locked: a NON-nested syncOsMobileDrawerMode fires
// (viewport crossing) while an OS run holds the drawer chain — its force
// body queues requestSecondDrawerMode behind that chain. The OS run then
// calls syncOsMobileDrawerMode({nested:true}). Old code joined the SAME
// single-flight promise → the OS run awaited the queued runner → circular
// wait. Fix: the nested caller runs the body inline (it already holds the
// chain) and flags the external runner dirty.
{
  setSettings({ osMode: true, secondSidebarEnabled: true, osForcedSingleDrawer: false })
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  let extP: Promise<void> | null = null
  let nestedOutcome = ''
  let extOutcome = ''
  const osP = runOsTransition(async () => {
    // External (non-nested) viewport-crossing sync fires WHILE this run
    // holds the drawer chain: its runner starts, its force body queues a
    // drawer request behind us.
    extP = syncOsMobileDrawerMode().then(() => { extOutcome = 'done' })
    await sleep(30) // runner reaches its queued requestSecondDrawerMode
    // Nested caller inside the OS run — must complete inline (2s guard).
    nestedOutcome = await Promise.race([
      syncOsMobileDrawerMode({ nested: true }).then(() => 'done'),
      sleep(2000).then(() => 'timeout'),
    ])
    assertEqual(
      nestedOutcome,
      'done',
      'F1: nested sync completes inline while the non-nested runner is queued behind this OS run',
    )
    assertEqual(
      extOutcome,
      '',
      'F1: external runner is still pending during the OS run (nested did not await it)',
    )
    release()
  })
  const osWinner = await Promise.race([osP.then(() => 'done'), sleep(2000).then(() => 'timeout')])
  assertEqual(osWinner, 'done', 'F1: OS run completes (no circular wait)')
  // The external runner's queued request now runs (chain released), its
  // dirty flag reruns the body against fresh settings, then it resolves.
  const extWinner = await Promise.race([
    (extP ?? Promise.resolve()).then(() => 'done'),
    sleep(2000).then(() => 'timeout'),
  ])
  assertEqual(
    extWinner,
    'done',
    "F1: external non-nested sync's promise resolves after the OS run releases the chain",
  )
  assertEqual(
    getSettings().secondSidebarEnabled,
    false,
    'F1: both syncs converged on the forced single drawer',
  )
}

console.log('---')
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
