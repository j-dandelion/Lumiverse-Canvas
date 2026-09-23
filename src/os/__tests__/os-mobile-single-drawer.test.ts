// OS + mobile single-drawer force (six-concerns #6) — orchestration tests for
// os/os-mode.syncOsMobileDrawerMode. The mode-switch API is mocked so these
// tests assert the decision + flag bookkeeping, not the layout machinery
// (second-drawer-mode.test.ts owns that).

import { mock } from 'bun:test'

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) passed++
  else {
    failed++
    console.error('FAIL:', msg)
  }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) passed++
  else {
    failed++
    console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

// ── Mutable mocks ──
let osMode = false
let mobile = false
let secondSidebarEnabled = false
let forcedSingleDrawer = false
const setSettingsCalls: Array<Record<string, unknown>> = []
const modeCalls: Array<{ next: boolean; opts?: unknown }> = []
let modeGate: Promise<void> | null = null
let modeReject = false
let modeSkipFlip = false

mock.module('../../recon/dispatch', () => ({
  getHost: () => ({}),
  getModel: () => null,
  snapshotOwnedModelLayout: () => null,
  dispatchBatch: () => Promise.resolve(),
  // os-mode statically imports these for the enable hold/tail (plan A2).
  bootPlacementDone: async () => {},
  flush: async () => {},
  // Run-scoped persist override (adversarial F2).
  setPersistOsOverride: () => {},
}))
mock.module('../../persist/layout-load', () => ({ cancelLayoutSave: () => {} }))
mock.module('../../layout/mode-profiles', () => ({
  restoreSingleModeLayout: () => Promise.resolve({ ok: true }),
}))
// os-mode statically imports the reveal hold (plan A2) — keep the real
// main-persist graph out of this suite.
mock.module('../../sidebar/main-persist', () => ({
  holdMainDrawerReveal: () => {},
  releaseMainDrawerReveal: () => {},
  waitForMainContentSettled: async () => {},
}))
mock.module('../../tabs/configure-modal', () => ({
  isConfigureTabsModalOpen: () => false,
  flushConfigureCommits: async () => {},
  refreshConfigureDraftFromLive: () => {},
  getConfigureDraftRef: () => null,
  getConfigureBaseRef: () => null,
}))
mock.module('../../settings/state', () => ({
  getSettings: () => ({
    osMode,
    secondSidebarEnabled,
    osForcedSingleDrawer: forcedSingleDrawer,
  }),
  setSettings: (patch: Record<string, unknown>) => {
    setSettingsCalls.push(patch)
    if (patch.osForcedSingleDrawer !== undefined) {
      forcedSingleDrawer = !!patch.osForcedSingleDrawer
    }
  },
  isOsModeEnabled: () => osMode,
  getSingleLayoutSlot: () => null,
  getDualLayoutSlot: () => null,
  setSingleLayoutSlot: () => {},
  setDualLayoutSlot: () => {},
  getOsSingleLayoutSlot: () => null,
  getOsDualLayoutSlot: () => null,
  setOsSingleLayoutSlot: () => {},
  setOsDualLayoutSlot: () => {},
}))
mock.module('../../settings/second-drawer-mode', () => ({
  requestSecondDrawerMode: async (next: boolean, opts?: unknown) => {
    modeCalls.push({ next, opts })
    if (modeGate) await modeGate
    if (modeReject) throw new Error('mode switch failed')
    if (!modeSkipFlip) secondSidebarEnabled = next
  },
}))

;(globalThis as { window?: unknown }).window = {
  matchMedia: () => ({ matches: mobile }),
}

const { syncOsMobileDrawerMode } = await import('../os-mode')

function reset() {
  osMode = false
  mobile = false
  secondSidebarEnabled = false
  forcedSingleDrawer = false
  setSettingsCalls.length = 0
  modeCalls.length = 0
  modeGate = null
  modeReject = false
  modeSkipFlip = false
}

// ── Force: OS on + mobile + dual → flag set, silent mode switch ──
{
  reset()
  osMode = true
  mobile = true
  secondSidebarEnabled = true
  await syncOsMobileDrawerMode()
  assert(
    setSettingsCalls.some((p) => p.osForcedSingleDrawer === true),
    'force sets osForcedSingleDrawer before the switch',
  )
  assertEqual(modeCalls.length, 1, 'force runs exactly one mode switch')
  assertEqual(modeCalls[0]?.next, false, 'force disables the second drawer')
  assert(
    (modeCalls[0]?.opts as { silent?: boolean } | undefined)?.silent === true,
    'force uses the silent switch (no dirty dialog)',
  )
}

// ── No force: OS off / desktop / already single ──
{
  reset()
  osMode = false
  mobile = true
  secondSidebarEnabled = true
  await syncOsMobileDrawerMode()
  assertEqual(modeCalls.length, 0, 'OS off → no mode switch')
  assertEqual(setSettingsCalls.length, 0, 'OS off → no flag write')
}
{
  reset()
  osMode = true
  mobile = false
  secondSidebarEnabled = true
  await syncOsMobileDrawerMode()
  assertEqual(modeCalls.length, 0, 'desktop viewport → no mode switch')
}
{
  reset()
  osMode = true
  mobile = true
  secondSidebarEnabled = false
  await syncOsMobileDrawerMode()
  assertEqual(modeCalls.length, 0, 'already single-drawer → no switch')
}

// ── Restore: flag set + OS off → clear flag, re-enable dual ──
{
  reset()
  osMode = false
  mobile = true
  secondSidebarEnabled = false
  forcedSingleDrawer = true
  await syncOsMobileDrawerMode()
  assert(
    setSettingsCalls.some((p) => p.osForcedSingleDrawer === false),
    'restore clears the flag',
  )
  assertEqual(modeCalls.length, 1, 'restore runs one mode switch')
  assertEqual(modeCalls[0]?.next, true, 'restore re-enables the second drawer')
}

// ── Restore on leaving mobile while OS stays on ──
{
  reset()
  osMode = true
  mobile = false
  secondSidebarEnabled = false
  forcedSingleDrawer = true
  await syncOsMobileDrawerMode()
  assertEqual(modeCalls.length, 1, 'cross-up restores the dual drawer')
  assertEqual(modeCalls[0]?.next, true, 'cross-up re-enables the second drawer')
}

// ── Recovery: flag already set but the drawer is still enabled ──
{
  reset()
  osMode = true
  mobile = true
  secondSidebarEnabled = true
  forcedSingleDrawer = true
  await syncOsMobileDrawerMode()
  assertEqual(modeCalls.length, 1, 'stuck dual is re-forced')
  assertEqual(modeCalls[0]?.next, false, 'recovery disables the second drawer')
  assertEqual(
    setSettingsCalls.filter((p) => p.osForcedSingleDrawer !== undefined).length,
    0,
    'recovery does not rewrite the already-true flag',
  )
}

// ── Single-flight: concurrent syncs share one run; the dirty rerun then
//    converges without a duplicate switch (state unchanged) ──
{
  reset()
  osMode = true
  mobile = true
  secondSidebarEnabled = true
  let release!: () => void
  modeGate = new Promise<void>((r) => { release = r })
  const p1 = syncOsMobileDrawerMode()
  const p2 = syncOsMobileDrawerMode()
  assert(p1 === p2, 'concurrent calls return the same promise')
  release()
  await p1
  assertEqual(modeCalls.length, 1, 'single-flight coalesces to one mode switch')
  assertEqual(secondSidebarEnabled, false, 'rerun converges on the single-drawer state')
}

// ── M5-A: crossing to desktop mid-force reruns and restores dual ──
{
  reset()
  osMode = true
  mobile = true
  secondSidebarEnabled = true
  let release!: () => void
  modeGate = new Promise<void>((r) => { release = r })
  const p1 = syncOsMobileDrawerMode()
  // Viewport crosses to desktop while the forced switch is still in flight.
  mobile = false
  const p2 = syncOsMobileDrawerMode()
  assert(p1 === p2, 'mid-flight trigger shares the in-flight promise')
  release()
  await p1
  assertEqual(modeCalls.length, 2, 'crossing reruns: force then restore')
  assertEqual(modeCalls[0]?.next, false, 'first run forced single-drawer')
  assertEqual(modeCalls[1]?.next, true, 'rerun restores dual-drawer')
  assertEqual(secondSidebarEnabled, true, 'final state is dual on desktop')
  assertEqual(forcedSingleDrawer, false, 'rerun clears the latch')
}

// ── M5-B: OS-off mid-force reruns and restores dual ──
{
  reset()
  osMode = true
  mobile = true
  secondSidebarEnabled = true
  let release!: () => void
  modeGate = new Promise<void>((r) => { release = r })
  const p1 = syncOsMobileDrawerMode()
  // OS mode turns off while the forced switch is still in flight.
  osMode = false
  const p2 = syncOsMobileDrawerMode()
  assert(p1 === p2, 'OS-off trigger shares the in-flight promise')
  release()
  await p1
  assertEqual(modeCalls.length, 2, 'OS-off reruns: force then restore')
  assertEqual(modeCalls[1]?.next, true, 'rerun re-enables the second drawer')
  assertEqual(secondSidebarEnabled, true, 'final state is dual')
  assertEqual(forcedSingleDrawer, false, 'OS-off clears the latch')
}

// ── L6: a rejecting restore keeps the latch so the next sync retries ──
{
  reset()
  osMode = false
  mobile = true
  secondSidebarEnabled = false
  forcedSingleDrawer = true
  modeReject = true
  await syncOsMobileDrawerMode().catch(() => {})
  assertEqual(modeCalls.length, 1, 'rejecting restore still runs the mode switch')
  assertEqual(secondSidebarEnabled, false, 'rejecting restore leaves the drawer off')
  assertEqual(forcedSingleDrawer, true, 'rejecting restore keeps the latch')
  modeReject = false
  await syncOsMobileDrawerMode()
  assertEqual(modeCalls.length, 2, 'next sync retries the restore switch')
  assertEqual(secondSidebarEnabled, true, 'retry lands the dual drawer')
  assertEqual(forcedSingleDrawer, false, 'retry clears the latch')
}

// ── L6: a resolved-but-failed restore (swallowed error) keeps the latch ──
{
  reset()
  osMode = false
  mobile = true
  secondSidebarEnabled = false
  forcedSingleDrawer = true
  modeSkipFlip = true
  await syncOsMobileDrawerMode()
  assertEqual(modeCalls.length, 1, 'swallowed failure runs the restore switch')
  assertEqual(secondSidebarEnabled, false, 'swallowed failure leaves the drawer off')
  assertEqual(forcedSingleDrawer, true, 'swallowed failure keeps the latch')
}

// ── L6: the latch clears only once the drawer is actually back ──
{
  reset()
  osMode = false
  mobile = true
  secondSidebarEnabled = false
  forcedSingleDrawer = true
  await syncOsMobileDrawerMode()
  assertEqual(modeCalls.length, 1, 'successful restore runs one mode switch')
  assertEqual(secondSidebarEnabled, true, 'successful restore lands the dual drawer')
  assertEqual(forcedSingleDrawer, false, 'successful restore clears the latch')
  assert(
    setSettingsCalls.some((p) => p.osForcedSingleDrawer === false),
    'successful restore writes the cleared latch',
  )
}

// ── L7: after the runner settles, the single-flight slot is clear — a later
//    dispatch must start a fresh run (the post-loop dirty drain / finally
//    re-dispatch must not leave the slot wedged). ──
{
  reset()
  osMode = true
  mobile = true
  secondSidebarEnabled = true
  let release!: () => void
  modeGate = new Promise<void>((r) => { release = r })
  const p1 = syncOsMobileDrawerMode()
  const p2 = syncOsMobileDrawerMode()
  assert(p1 === p2, 'L7-pre: join shares the in-flight promise')
  release()
  await p1
  assertEqual(secondSidebarEnabled, false, 'L7-pre: first run forced single')
  // Simulate a stuck dual after settle — a later dispatch must re-force,
  // proving _mobileDrawerSync was cleared (not left non-null by a dirty
  // race that never re-dispatched).
  secondSidebarEnabled = true
  modeGate = null
  await syncOsMobileDrawerMode()
  assertEqual(modeCalls.length, 2, 'L7: slot is clear after settle — a later dispatch runs a fresh force')
  assertEqual(secondSidebarEnabled, false, 'L7: fresh force converges single again')
}

console.log('---')
if (failed > 0) {
  console.error(`FAILED: ${failed}`)
  process.exitCode = 1
}
console.log(`PASS: ${passed}`)
