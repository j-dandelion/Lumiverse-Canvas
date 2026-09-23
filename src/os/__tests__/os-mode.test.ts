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
  if (actual === expected) {
    passed++
  } else {
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
  host: { findKey?: (id: string) => string | null } | null
  osSingle: Record<string, unknown> | null
  osDual: Record<string, unknown> | null
  singleSlot: Record<string, unknown> | null
  dualSlot: Record<string, unknown> | null
  secondSidebarEnabled: boolean
  forcedSingleDrawer: boolean
  restoreCalls: Array<{ slot: unknown; host: unknown; opts?: unknown }>
  restoreResult: { ok: boolean; reason?: string }
  restoreThrow: boolean
  restoreGate: Promise<void> | null
  holdEvents: string[]
  batchCalls: Array<Array<{ t: string; key: string; closed: boolean }>>
  setSettingsCalls: Array<Record<string, unknown>>
  modeCalls: Array<{ next: boolean; opts?: unknown }>
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
  forcedSingleDrawer: false,
  restoreCalls: [],
  restoreResult: { ok: true },
  restoreThrow: false,
  restoreGate: null,
  holdEvents: [],
  batchCalls: [],
  setSettingsCalls: [],
  modeCalls: [],
}

// Desktop viewport by default; A2-5 flips `mobile` per scenario.
let mobile = false
;(globalThis as { window?: unknown }).window = {
  matchMedia: () => ({ matches: mobile }),
}

mock.module('../../recon/dispatch', () => ({
  getHost: () => fake.host,
  getModel: () => fake.model,
  snapshotOwnedModelLayout: () => fake.snapshot,
  dispatchBatch: (intents: Array<{ t: string; key: string; closed: boolean }>) => {
    fake.batchCalls.push(intents)
    return Promise.resolve()
  },
  // os-mode statically imports these for the enable hold/tail (plan A2).
  bootPlacementDone: async () => {},
  flush: async () => {},
  // Run-scoped persist override (adversarial F2) — recorded so run
  // enable/disable bracketing stays observable if asserted later.
  setPersistOsOverride: () => {},
}))
mock.module('../../persist/layout-load', () => ({
  cancelLayoutSave: () => {},
}))
// os-mode statically imports the reveal hold (plan A2) — mock so the real
// main-persist graph (mobile-exclusion → shell) never loads here.
mock.module('../../sidebar/main-persist', () => ({
  holdMainDrawerReveal: () => { fake.holdEvents.push('hold') },
  releaseMainDrawerReveal: () => { fake.holdEvents.push('release') },
  waitForMainContentSettled: async () => {},
}))
// Dynamic import in the enable/disable paths — mock so the React modal
// never loads headless.
mock.module('../../tabs/configure-modal', () => ({
  isConfigureTabsModalOpen: () => false,
  flushConfigureCommits: async () => {},
  refreshConfigureDraftFromLive: () => {},
  getConfigureDraftRef: () => null,
  getConfigureBaseRef: () => null,
}))
mock.module('../../layout/mode-profiles', () => ({
  restoreSingleModeLayout: (
    slot: unknown,
    host: unknown,
    opts?: { osActive?: boolean; restoreOpen?: boolean; restoreWidth?: boolean },
  ) => {
    if (fake.restoreThrow) {
      fake.restoreThrow = false
      return Promise.reject(new Error('restore exploded'))
    }
    fake.restoreCalls.push({ slot, host, opts })
    // Mirror the real slot-wins bootstrap: a successful restore rebuilds the
    // model from the non-OS slot, so the live closed set empties.
    if (fake.restoreResult.ok && fake.model) fake.model.closed.length = 0
    if (fake.restoreGate) {
      const gate = fake.restoreGate
      fake.restoreGate = null
      return gate.then(() => fake.restoreResult)
    }
    return Promise.resolve(fake.restoreResult)
  },
}))
mock.module('../../settings/state', () => ({
  getSettings: () => ({
    secondSidebarEnabled: fake.secondSidebarEnabled,
    osMode: fake.osMode,
    osForcedSingleDrawer: fake.forcedSingleDrawer,
  }),
  setSettings: (patch: Record<string, unknown>) => { fake.setSettingsCalls.push(patch) },
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
mock.module('../../settings/second-drawer-mode', () => ({
  requestSecondDrawerMode: async (next: boolean, opts?: unknown) => {
    fake.modeCalls.push({ next, opts })
  },
}))

// Module under test — imports AFTER mocks (repo convention).
const { applyOsModeChange, seedOsSlotFromLive } = await import('../os-mode')

// Every test starts from clean fakes.
function fresh() {
  fake.restoreCalls.length = 0
  fake.restoreResult = { ok: true }
  fake.restoreThrow = false
  fake.restoreGate = null
  fake.holdEvents.length = 0
  fake.osSingle = null
  fake.osDual = null
  fake.singleSlot = null
  fake.dualSlot = null
  fake.batchCalls.length = 0
  fake.setSettingsCalls.length = 0
  fake.modeCalls.length = 0
  fake.forcedSingleDrawer = false
  fake.osMode = false
  fake.secondSidebarEnabled = false
  fake.model = { secondary: [], closed: [] }
  fake.snapshot = null
  fake.host = { findKey: (id: string) => id }
  mobile = false
}

function tab(id: string, sidebar: 'primary' | 'secondary') {
  return { tabId: id, tabTitle: id.toUpperCase(), sidebar }
}

// ── Enable (A2: restore-if-slot, else D11 seed all-open) ──
// Note: the live setting is flipped BEFORE apply runs (setSettings →
// applySettings invariant), so each enable scenario sets fake.osMode=true
// to mirror that.
{
  fresh()
  fake.osMode = true
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
  fake.osMode = true
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
  fake.singleSlot = { detachedTabs: [], tabOrder: ['a'] }
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
  fake.singleSlot = { detachedTabs: [], tabOrder: ['a'] }
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
  fake.singleSlot = { detachedTabs: [], tabOrder: ['a'] }
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
  fake.singleSlot = { detachedTabs: [], tabOrder: ['a'] }
  fake.host = {}
  await applyOsModeChange({ osMode: true }, { osMode: false })
  assertEqual(fake.restoreCalls.length, 1, 'clean restore still runs')
  assertEqual(fake.batchCalls.length, 0, 'no closed survivors → no clear batch')
}

{
  // H3 production single-drawer shape: single slots serialize
  // `detachedTabs: []` with a populated `tabOrder`, so the restore gate must
  // key off either list — otherwise a closed+hidden core window survives
  // OS-off forever (no Start menu to reopen it).
  fresh()
  fake.model = { secondary: [], closed: ['builtin:loom'] }
  fake.snapshot = { detachedTabs: [], tabOrder: ['builtin:loom'], closedTabIds: ['builtin:loom'] }
  fake.secondSidebarEnabled = false
  fake.singleSlot = { detachedTabs: [], tabOrder: ['builtin:loom'] }
  fake.host = {}
  await applyOsModeChange({ osMode: true }, { osMode: false })
  assertEqual(fake.restoreCalls.length, 1, 'production single slot (tabOrder only) restores')
  assertEqual(fake.restoreCalls[0]?.slot, fake.singleSlot, 'restore consumes the single slot')
  assertEqual(fake.model?.closed.length ?? -1, 0, 'closed set is empty — the core key is no longer hidden')
  assertEqual(fake.batchCalls.length, 0, 'restore — not the residual sweep — cleared the hidden window')
}

console.log('---')
// ── A2-1: pre-existing non-empty osSingle → restore, not seed ──
{
  fresh()
  fake.osMode = true
  fake.model = { secondary: [], closed: [] }
  fake.snapshot = { detachedTabs: [tab('live', 'primary')], tabOrder: ['live'], closedTabIds: [] }
  const preExisting = { detachedTabs: [], tabOrder: ['a'], closedTabIds: [] }
  fake.osSingle = preExisting
  fake.host = { findKey: (id: string) => (id === 'a' ? 'k:a' : null) }
  await applyOsModeChange({ osMode: false }, { osMode: true })
  assertEqual(fake.restoreCalls.length, 1, 'A2-1: pre-existing osSingle restores')
  assertEqual(fake.restoreCalls[0]?.slot, preExisting, 'A2-1: restore consumes the PRE-EXISTING slot object')
  assertEqual(fake.osSingle, preExisting, 'A2-1: seed did NOT overwrite the slot')
  assertEqual(fake.osDual, null, 'A2-1: osDual untouched')
  assertEqual(
    (fake.restoreCalls[0]?.opts as { osActive?: boolean } | undefined)?.osActive,
    true,
    'A2-1: restore routed with osActive:true',
  )
}
// ── A2-2: pre-existing non-empty osDual (dual model) → restore(osDual) ──
{
  fresh()
  fake.osMode = true
  fake.model = { secondary: [tab('s', 'secondary')], closed: [] }
  fake.snapshot = { detachedTabs: [tab('a', 'primary'), tab('s', 'secondary')], tabOrder: ['a', 's'], closedTabIds: [] }
  const preDual = { detachedTabs: [{ tabId: 'x', tabTitle: 'X', sidebar: 'secondary' }], tabOrder: [] }
  fake.osDual = preDual
  fake.host = { findKey: (id: string) => (id === 'x' ? 'k:x' : null) }
  await applyOsModeChange({ osMode: false }, { osMode: true })
  assertEqual(fake.restoreCalls.length, 1, 'A2-2: pre-existing osDual restores on a dual model')
  assertEqual(fake.restoreCalls[0]?.slot, preDual, 'A2-2: restore consumes the osDual slot')
  assertEqual(fake.osSingle, null, 'A2-2: osSingle untouched (not seeded)')
}
// ── A2-3: empty/absent slot → seed (no restore) — covered by the enable
// blocks above; assert the restore gate explicitly here too. ──
{
  fresh()
  fake.osMode = true
  fake.model = { secondary: [], closed: [] }
  fake.snapshot = { detachedTabs: [tab('a', 'primary')], tabOrder: ['a'], closedTabIds: [] }
  fake.osSingle = { detachedTabs: [], tabOrder: [] } // empty
  await applyOsModeChange({ osMode: false }, { osMode: true })
  assertEqual(fake.restoreCalls.length, 0, 'A2-3: empty slot → no restore')
  assert(fake.osSingle !== null, 'A2-3: empty slot → seeded from live')
  assertEqual(
    (fake.osSingle as { tabOrder?: string[] })?.tabOrder?.join(','),
    'a',
    'A2-3: seed wrote the live layout',
  )
}
// ── A2-4: all-unresolvable slot → seed, NOT restore ──
{
  fresh()
  fake.osMode = true
  fake.model = { secondary: [], closed: [] }
  fake.snapshot = { detachedTabs: [tab('live', 'primary')], tabOrder: ['live'], closedTabIds: [] }
  const unresolvable = { detachedTabs: [], tabOrder: ['renamed-gone'] }
  fake.osSingle = unresolvable
  fake.host = { findKey: () => null } // nothing resolves
  await applyOsModeChange({ osMode: false }, { osMode: true })
  assertEqual(fake.restoreCalls.length, 0, 'A2-4: unresolvable slot → NOT restored')
  assert(fake.osSingle !== unresolvable, 'A2-4: unresolvable slot → reseeding from live')
  assertEqual(
    (fake.osSingle as { tabOrder?: string[] })?.tabOrder?.join(','),
    'live',
    'A2-4: seed replaced the dead slot with the live layout',
  )
}
// ── A2-5: mobile + dual model → enters via osSingle, no osDual restore ──
{
  fresh()
  mobile = true // viewport ≤600px
  fake.osMode = true
  fake.model = { secondary: [tab('s', 'secondary')], closed: [] }
  fake.snapshot = { detachedTabs: [tab('a', 'primary'), tab('s', 'secondary')], tabOrder: ['a', 's'], closedTabIds: [] }
  const preDual = { detachedTabs: [{ tabId: 'x', tabTitle: 'X', sidebar: 'secondary' }], tabOrder: [] }
  fake.osDual = preDual
  fake.secondSidebarEnabled = true // mobile force will kick in after restore
  await applyOsModeChange({ osMode: false }, { osMode: true })
  assertEqual(fake.restoreCalls.length, 0, 'A2-5: mobile skips the osDual restore')
  assertEqual(fake.osDual, preDual, 'A2-5: osDual slot untouched')
  assert(fake.osSingle !== null, 'A2-5: mobile seeds/enters via osSingle')
  assert(fake.modeCalls.some((c) => c.next === false), 'A2-5: mobile force disables the second drawer (nested)')
  assertEqual(
    (fake.modeCalls.find((c) => c.next === false)?.opts as { nested?: boolean } | undefined)?.nested,
    true,
    'A2-5: force runs nested (inline inside the OS transition)',
  )
}
// ── A3-1: rapid off→on: both runs in order; osActive routes per run ──
{
  fresh()
  fake.osMode = false // starting live state: OS off
  fake.secondSidebarEnabled = true
  fake.model = { secondary: [tab('s', 'secondary')], closed: [] }
  fake.snapshot = { detachedTabs: [tab('a', 'primary'), tab('s', 'secondary')], tabOrder: ['a', 's'], closedTabIds: [] }
  fake.dualSlot = { detachedTabs: [tab('a', 'primary')], tabOrder: ['a'] }
  const preOsDual = { detachedTabs: [{ tabId: 's', tabTitle: 'S', sidebar: 'secondary' }], tabOrder: [] }
  fake.osDual = preOsDual
  fake.host = { findKey: (id: string) => id }
  // Gate the DISABLE restore so the enable request lands mid-run.
  let release!: () => void
  fake.restoreGate = new Promise<void>((r) => { release = r })
  const pDisable = applyOsModeChange({ osMode: true }, { osMode: false })
  // Let the drain start and hit the gated restore (the call is recorded,
  // its completion is gated — the enable restore has not run yet).
  await new Promise((r) => setTimeout(r, 10))
  assertEqual(fake.restoreCalls.length, 1, 'A3-1: only the disable restore has entered while gated')
  // Flip the live setting back on (setSettings invariant) + fire enable
  // while the disable run is still draining.
  fake.osMode = true
  const pEnable = applyOsModeChange({ osMode: false }, { osMode: true })
  release()
  await Promise.all([pDisable, pEnable])
  assertEqual(fake.restoreCalls.length, 2, 'A3-1: both runs executed')
  assertEqual(
    (fake.restoreCalls[0]?.opts as { osActive?: boolean } | undefined)?.osActive,
    false,
    'A3-1: disable restore routed osActive:false (run intent, not live setting)',
  )
  assertEqual(
    (fake.restoreCalls[1]?.opts as { osActive?: boolean } | undefined)?.osActive,
    true,
    'A3-1: enable restore routed osActive:true (no contamination)',
  )
  assertEqual(fake.restoreCalls[0]?.slot, fake.dualSlot, 'A3-1: disable restored the non-OS dual slot')
  // Disable snapshots live OS state into osDual first (close-the-window), so
  // the enable restores that freshest snapshot — not the pre-test plant.
  assertEqual(fake.restoreCalls[1]?.slot, fake.snapshot, 'A3-1: enable restored the OS dual slot (disable-time snapshot)')
}
// ── A3-2: a throwing run does not strand the drain ──
{
  fresh()
  fake.osMode = false
  fake.secondSidebarEnabled = false
  fake.model = { secondary: [], closed: [] }
  fake.snapshot = { detachedTabs: [tab('a', 'primary')], tabOrder: ['a'], closedTabIds: [] }
  fake.singleSlot = { detachedTabs: [], tabOrder: ['a'] }
  fake.host = { findKey: (id: string) => id }
  fake.restoreThrow = true // first restore call explodes
  let threw = false
  try {
    await applyOsModeChange({ osMode: true }, { osMode: false })
  } catch { threw = true }
  assertEqual(threw, false, 'A3-2: throwing disable does not reject the drain')
  // Next transition still runs (drain ref cleared, chain not wedged).
  fake.osMode = true
  fake.osSingle = { detachedTabs: [], tabOrder: ['a'] }
  await applyOsModeChange({ osMode: false }, { osMode: true })
  assert(fake.restoreCalls.length >= 1, 'A3-2: the next transition still executes a restore')
  assertEqual(
    (fake.restoreCalls[0]?.opts as { osActive?: boolean } | undefined)?.osActive,
    true,
    'A3-2: post-failure restore routed with the new run intent',
  )
}
// ── A2-6 shape guard lives in mode-profiles (real) — see
// os-closed-active-restore.test.ts; here assert the enable hold ordering. ──
{
  fresh()
  fake.osMode = true
  fake.model = { secondary: [], closed: [] }
  fake.snapshot = { detachedTabs: [tab('a', 'primary')], tabOrder: ['a'], closedTabIds: [] }
  fake.host = { findKey: (id: string) => id }
  await applyOsModeChange({ osMode: false }, { osMode: true })
  assertEqual(fake.holdEvents.join(','), 'hold,release', 'enable takes the reveal hold synchronously and releases it')
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
