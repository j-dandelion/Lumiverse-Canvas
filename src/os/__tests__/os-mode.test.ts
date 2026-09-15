// Custom assertion harness — see Chronicle testing-conventions.md
// Orchestration tests for os/os-mode.ts. The closed-set lives in the model
// (`model.closed`), so these tests assert on the SLOT writes + restore
// routing; closed-set semantics are covered by the layout-model round-trip
// and reduce tests.
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

import { mock } from 'bun:test'

// ── Fakes captured by the mock modules below ──
const fake: {
  osMode: boolean
  model: { secondary: unknown[]; closed: string[] } | null
  snapshot: Record<string, unknown> | null
  host: object | null
  osSingle: Record<string, unknown> | null
  osDual: Record<string, unknown> | null
  singleSlot: Record<string, unknown> | null
  dualSlot: Record<string, unknown> | null
  secondSidebarEnabled: boolean
  restoreCalls: Array<{ slot: unknown; host: unknown }>
  restoreResult: { ok: boolean; reason?: string }
  batchCalls: Array<Array<{ t: string; key: string; closed: boolean }>>
} = {
  osMode: false,
  model: { secondary: [], closed: [] },
  snapshot: null,
  host: {},
  osSingle: null,
  osDual: null,
  singleSlot: null,
  dualSlot: null,
  secondSidebarEnabled: false,
  restoreCalls: [],
  restoreResult: { ok: true },
  batchCalls: [],
}

mock.module('../../recon/dispatch', () => ({
  getHost: () => fake.host,
  getModel: () => fake.model,
  snapshotOwnedModelLayout: () => fake.snapshot,
  dispatchBatch: (intents: Array<{ t: string; key: string; closed: boolean }>) => {
    fake.batchCalls.push(intents)
    return Promise.resolve()
  },
}))
mock.module('../../persist/layout-load', () => ({
  cancelLayoutSave: () => {},
}))
mock.module('../../layout/mode-profiles', () => ({
  restoreSingleModeLayout: (slot: unknown, host: unknown) => {
    fake.restoreCalls.push({ slot, host })
    return Promise.resolve(fake.restoreResult)
  },
}))
mock.module('../../settings/state', () => ({
  getSettings: () => ({ secondSidebarEnabled: fake.secondSidebarEnabled }),
  isOsModeEnabled: () => fake.osMode,
  getSingleLayoutSlot: () => fake.singleSlot,
  getDualLayoutSlot: () => fake.dualSlot,
  setSingleLayoutSlot: (l: Record<string, unknown> | null) => { fake.singleSlot = l },
  setDualLayoutSlot: (l: Record<string, unknown> | null) => { fake.dualSlot = l },
  getOsSingleLayoutSlot: () => fake.osSingle,
  getOsDualLayoutSlot: () => fake.osDual,
  setOsSingleLayoutSlot: (l: Record<string, unknown> | null) => { fake.osSingle = l },
  setOsDualLayoutSlot: (l: Record<string, unknown> | null) => { fake.osDual = l },
}))

// Module under test — imports AFTER mocks (repo convention).
const { applyOsModeChange, seedOsSlotFromLive } = await import('../os-mode')

// Every test starts from clean fakes.
function fresh() {
  fake.restoreCalls.length = 0
  fake.restoreResult = { ok: true }
  fake.osSingle = null
  fake.osDual = null
  fake.batchCalls.length = 0
}

function tab(id: string, sidebar: 'primary' | 'secondary') {
  return { tabId: id, tabTitle: id.toUpperCase(), sidebar }
}

// ── Enable (D11: seed all-open) ──
{
  fresh()
  fake.model = { secondary: [], closed: [] }
  fake.snapshot = { detachedTabs: [tab('a', 'primary'), tab('b', 'primary')], tabOrder: ['a', 'b'], closedTabIds: [] }
  await applyOsModeChange({ osMode: false }, { osMode: true })
  assert(fake.osSingle !== null, 'enable (single) seeds the osSingle slot')
  assertEqual(fake.osDual, null, 'enable (single) leaves the osDual slot untouched')
  assertEqual(
    (fake.osSingle as { detachedTabs?: unknown[] })?.detachedTabs?.length,
    2,
    'seed carries the live tabs',
  )
  assertEqual(
    (fake.osSingle as { closedTabIds?: string[] })?.closedTabIds?.length,
    0,
    'seed carries an EMPTY closed-set (D11 all-open)',
  )
}
{
  fresh()
  fake.model = { secondary: [tab('s', 'secondary')], closed: [] }
  fake.snapshot = { detachedTabs: [tab('a', 'primary'), tab('s', 'secondary')], tabOrder: ['a', 's'], closedTabIds: [] }
  await applyOsModeChange({ osMode: false }, { osMode: true })
  assert(fake.osDual !== null, 'enable (dual model) seeds the osDual slot')
  assertEqual(fake.osSingle, null, 'enable (dual) leaves the osSingle slot untouched')
}
{
  // Boot/teardown edge: no live serialization → seed is a safe no-op.
  fresh()
  fake.model = null
  fake.snapshot = null
  seedOsSlotFromLive()
  assertEqual(fake.osSingle, null, 'no-model seed writes nothing')
  assertEqual(fake.osDual, null, 'no-model seed writes nothing (dual)')
}

// ── Disable (D12 slot-wins restore) ──
{
  fresh()
  fake.model = { secondary: [tab('s', 'secondary')], closed: [] }
  fake.snapshot = { detachedTabs: [tab('a', 'primary'), tab('s', 'secondary')], tabOrder: ['a', 's'], closedTabIds: ['s'] }
  fake.secondSidebarEnabled = true
  fake.dualSlot = { detachedTabs: [tab('a', 'primary')], tabOrder: ['a'] }
  fake.host = {}
  await applyOsModeChange({ osMode: true }, { osMode: false })
  assert(fake.osDual !== null, 'disable snapshots the live OS state into the osDual slot')
  assertEqual(
    (fake.osDual as { closedTabIds?: string[] })?.closedTabIds?.join(','),
    's',
    'disable snapshot carries the closed-set',
  )
  assertEqual(fake.restoreCalls.length, 1, 'disable restores the non-OS slot')
  assertEqual(fake.restoreCalls[0]?.slot, fake.dualSlot, 'disable restores the DUAL slot while secondSidebarEnabled')
  assert(fake.restoreCalls[0]?.host === fake.host, 'disable passes the host port')
}
{
  fresh()
  fake.model = { secondary: [], closed: [] }
  fake.snapshot = { detachedTabs: [tab('a', 'primary')], tabOrder: ['a'], closedTabIds: [] }
  fake.secondSidebarEnabled = false
  fake.singleSlot = { detachedTabs: [tab('a', 'primary')], tabOrder: ['a'] }
  fake.host = {}
  await applyOsModeChange({ osMode: true }, { osMode: false })
  assertEqual(fake.restoreCalls.length, 1, 'disable (single) restores the singleLayout slot')
  assertEqual(fake.restoreCalls[0]?.slot, fake.singleSlot, 'disable (single) picks the single slot')
}
{
  // Missing/empty slot → no restore, no throw.
  fresh()
  fake.model = { secondary: [], closed: [] }
  fake.snapshot = null
  fake.secondSidebarEnabled = false
  fake.singleSlot = null
  fake.host = {}
  await applyOsModeChange({ osMode: true }, { osMode: false })
  assertEqual(fake.restoreCalls.length, 0, 'missing slot → no restore call')
}
{
  // Empty slot (no tabs) → no restore (first-enable + immediate disable).
  fresh()
  fake.model = { secondary: [], closed: [] }
  fake.snapshot = { detachedTabs: [tab('a', 'primary')], tabOrder: ['a'], closedTabIds: [] }
  fake.secondSidebarEnabled = false
  fake.singleSlot = { detachedTabs: [], tabOrder: [] }
  fake.host = {}
  await applyOsModeChange({ osMode: true }, { osMode: false })
  assertEqual(fake.restoreCalls.length, 0, 'empty slot → no restore')
}
{
  // No host (boot/teardown edge) → no restore, no throw.
  fresh()
  fake.model = { secondary: [], closed: [] }
  fake.snapshot = { detachedTabs: [tab('a', 'primary')], tabOrder: ['a'], closedTabIds: [] }
  fake.secondSidebarEnabled = false
  fake.singleSlot = { detachedTabs: [tab('a', 'primary')], tabOrder: ['a'] }
  fake.host = null
  await applyOsModeChange({ osMode: true }, { osMode: false })
  assertEqual(fake.restoreCalls.length, 0, 'no host → no restore')
}
{
  // Restore failure degrades to a logged partial (no throw).
  fresh()
  fake.model = { secondary: [], closed: [] }
  fake.snapshot = { detachedTabs: [tab('a', 'primary')], tabOrder: ['a'], closedTabIds: [] }
  fake.secondSidebarEnabled = false
  fake.singleSlot = { detachedTabs: [tab('a', 'primary')], tabOrder: ['a'] }
  fake.host = {}
  fake.restoreResult = { ok: false, reason: 'bootstrap: fake failure' }
  let threw = false
  try {
    await applyOsModeChange({ osMode: true }, { osMode: false })
  } catch { threw = true }
  assertEqual(threw, false, 'restore failure does not throw (degrades to log)')
}

// ── Disable invariant: OS off ⇒ model.closed empty (2026-09-15) ──
// A missing/empty non-OS slot performs no restore, so the live OS closed-set
// survives — and with the Start menu gone those windows would stay hidden
// forever. The disable must clear any residual membership through the model.
{
  fresh()
  fake.model = { secondary: [], closed: ['builtin:loom', 'builtin:Hone'] }
  fake.snapshot = { detachedTabs: [tab('a', 'primary')], tabOrder: ['a'], closedTabIds: ['a'] }
  fake.secondSidebarEnabled = false
  fake.singleSlot = null
  fake.host = {}
  await applyOsModeChange({ osMode: true }, { osMode: false })
  assertEqual(fake.restoreCalls.length, 0, 'no slot → no restore')
  assertEqual(fake.batchCalls.length, 1, 'residual closed keys are cleared via one batch')
  assertEqual(fake.batchCalls[0]?.length, 2, 'one setClosed intent per closed key')
  assert(
    (fake.batchCalls[0] ?? []).every((i) => i.t === 'setClosed' && i.closed === false),
    'clear intents use setClosed(closed:false)',
  )
}
{
  // No residual closed keys → no clear dispatch (successful restore path).
  fresh()
  fake.model = { secondary: [], closed: [] }
  fake.snapshot = { detachedTabs: [tab('a', 'primary')], tabOrder: ['a'], closedTabIds: [] }
  fake.secondSidebarEnabled = false
  fake.singleSlot = { detachedTabs: [tab('a', 'primary')], tabOrder: ['a'] }
  fake.host = {}
  await applyOsModeChange({ osMode: true }, { osMode: false })
  assertEqual(fake.restoreCalls.length, 1, 'clean restore still runs')
  assertEqual(fake.batchCalls.length, 0, 'no closed survivors → no clear batch')
}

console.log('---')
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
