// Tests for recon/reconcile.ts + host/fake/implementation.ts
// Invariants 7–12 from the plan.
import {
  createEmptyModel,
  builtinKey,
  extensionKey,
  type LayoutModel,
  type TabKey,
  type Side,
} from '../../core/model'
import { visibleKeys } from '../../core/select'
import { FakeHost, type LiveTab } from '../../host/fake/implementation'
import { reconcile, epochState, resetEpochState, flushMicrotasks } from '../../recon/reconcile'

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed++ }
}
function assertArraysEqual(actual: readonly string[], expected: readonly string[], msg: string) {
  if (actual.length !== expected.length) {
    console.error(`FAIL: ${msg} — length mismatch (expected ${expected.length}, got ${actual.length})`)
    console.error(`  expected: ${JSON.stringify(expected)}`)
    console.error(`  actual:   ${JSON.stringify(actual)}`)
    failed++
    return
  }
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) {
      console.error(`FAIL: ${msg} — diff at index ${i}: expected "${expected[i]}", got "${actual[i]}"`)
      console.error(`  expected: ${JSON.stringify(expected)}`)
      console.error(`  actual:   ${JSON.stringify(actual)}`)
      failed++
      return
    }
  }
  passed++
}

function makeLiveTab(key: TabKey, liveId: string, location: Side, overrides?: Partial<LiveTab>): LiveTab {
  return {
    key, liveId, location,
    hidden: false,
    activeInPrimary: false,
    activeInSecondary: false,
    hasContentRoot: true,
    isBuiltin: key.startsWith('builtin:'),
    ...overrides,
  }
}

function tabIds(world: { tabs: readonly { liveId: string; location: string }[] }, side: string): string[] {
  return world.tabs.filter(t => t.location === side).map(t => t.liveId)
}

const A = extensionKey('ext', 'a')
const B = extensionKey('ext', 'b')
const C = extensionKey('ext', 'c')
const PROFILE = builtinKey('profile')
const PRESETS = builtinKey('presets')

// ============================================================================
// I7 — Idempotence
// ============================================================================
async function testIdempotence() {
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A],
    secondary: [B],
    hidden: [],
    active: { primary: PROFILE, secondary: null },
  }

  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'primary'),
    makeLiveTab(B, 'h:b', 'secondary'),
  ])

  const r1 = await reconcile(model, host)
  assert(r1.ops >= 0, 'I7a: first reconcile runs')
  const r2 = await reconcile(model, host)
  assertEqual(r2.ops, 0, 'I7b: second reconcile is idempotent (0 ops)')
  assertEqual(r2.unresolved.length, 0, 'I7c: no unresolved after convergence')

  const obs = host.observe()
  const primaryIds = tabIds(obs, 'primary')
  assertArraysEqual(primaryIds, ['h:profile', 'h:a'], 'I7d: primary order matches model')
  const secondaryIds = tabIds(obs, 'secondary')
  assertArraysEqual(secondaryIds, ['h:b'], 'I7e: secondary order matches model')
  assert(obs.tabs.find(t => t.key === PROFILE)!.isActiveInPrimary, 'I7f: active tab set')
}

// ============================================================================
// I7 — Empty model
// ============================================================================
async function testEmptyModelIdempotence() {
  const model = createEmptyModel()
  const host = new FakeHost()
  const r = await reconcile(model, host)
  assertEqual(r.ops, 0, 'I7g: empty model has 0 ops')
}

// ============================================================================
// I7 — Already converged
// ============================================================================
async function testAlreadyConverged() {
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
  ])
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE],
    active: { primary: PROFILE, secondary: null },
  }
  const r = await reconcile(model, host)
  assertEqual(r.ops, 0, 'I7h: already-converged has 0 ops')
}

// ============================================================================
// I7 — Idempotence after setHidden
// ============================================================================
async function testIdempotenceWithHidden() {
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A],
    hidden: [A],
    active: { primary: PROFILE, secondary: null },
  }
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'primary', { hidden: false }),
  ])

  const r1 = await reconcile(model, host)
  assert(r1.ops > 0, 'I7i: first pass applies hidden')
  const obsAfter = host.observe()
  assert(obsAfter.tabs.find(t => t.key === A)!.isHidden, 'I7j: tab A is hidden after reconcile')

  const r2 = await reconcile(model, host)
  assertEqual(r2.ops, 0, 'I7k: second pass idempotent after hide')

  // Unhide
  const model2: LayoutModel = {
    ...model,
    hidden: [],
  }
  const r3 = await reconcile(model2, host)
  assert(r3.ops > 0, 'I7l: unhide triggers ops')

  const r4 = await reconcile(model2, host)
  assertEqual(r4.ops, 0, 'I7m: idempotent after unhide')
}

// ============================================================================
// I8 — Late registration
// ============================================================================
async function testLateRegistration() {
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A],
    secondary: [B],
  }
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
  ])

  const r1 = await reconcile(model, host)
  assert(r1.unresolved.length > 0, 'I8a: unresolved tabs reported')
  assert(r1.unresolved.includes(A), 'I8b: A is unresolved')
  assert(r1.unresolved.includes(B), 'I8c: B is unresolved')

  host.addTab(A, 'h:a', 'primary')
  host.addTab(B, 'h:b', 'secondary')

  const r2 = await reconcile(model, host)
  assertEqual(r2.unresolved.length, 0, 'I8d: all resolved after late registration')
  const r3 = await reconcile(model, host)
  assertEqual(r3.ops, 0, 'I8e: idempotent after late registration convergence')

  const obs = host.observe()
  assertArraysEqual(tabIds(obs, 'primary'), ['h:profile', 'h:a'], 'I8f: primary order correct')
  assertArraysEqual(tabIds(obs, 'secondary'), ['h:b'], 'I8g: secondary order correct')
}

// ============================================================================
// I8 — Late registration with existing tab on wrong side
// ============================================================================
async function testLateRegistrationWrongSide() {
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A],
    secondary: [],
  }
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
  ])

  const r1 = await reconcile(model, host)
  assert(r1.unresolved.includes(A), 'I8h: A unresolved')

  host.addTab(A, 'h:a', 'secondary')
  const r2 = await reconcile(model, host)
  assertEqual(r2.unresolved.length, 0, 'I8i: A resolved')
  assert(host.tabInSide('h:a', 'primary'), 'I8j: A placed to primary per model')
}

// ============================================================================
// I9 — Degraded writes reported
// ============================================================================
async function testDegradedSetOrder() {
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [A, PROFILE],
  }
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary'),
    makeLiveTab(A, 'h:a', 'primary'),
  ])
  host._failureConfig = { setOrder: 'degraded' }

  const r = await reconcile(model, host)
  const orderStep = r.steps.find(s => s.step === 'order')
  assert(orderStep != null, 'I9a: order step exists')
  assertEqual(orderStep!.status, 'degraded', 'I9b: order step reports degraded')
}

async function testDegradedActivate() {
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A],
    active: { primary: A, secondary: null },
  }
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'primary'),
  ])
  host._failureConfig = { activate: 'degraded' }

  const r = await reconcile(model, host)
  const actStep = r.steps.find(s => s.step === 'activation')
  assert(actStep != null, 'I9c: activation step exists')
  assertEqual(actStep!.status, 'degraded', 'I9d: activation step reports degraded')
}

async function testDegradedSetHidden() {
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A],
    hidden: [A],
  }
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary'),
    makeLiveTab(A, 'h:a', 'primary'),
  ])
  host._failureConfig = { setHidden: 'degraded' }

  const r = await reconcile(model, host)
  const visStep = r.steps.find(s => s.step === 'visibility')
  assert(visStep != null, 'I9e: visibility step exists')
  assertEqual(visStep!.status, 'degraded', 'I9f: visibility step reports degraded')
}

async function testDegradedSetDrawer() {
  const model: LayoutModel = {
    ...createEmptyModel(),
    drawers: {
      primary: { open: true, width: 500 },
      secondary: { open: false, width: 420 },
    },
  }
  const host = new FakeHost([])
  host._failureConfig = { setDrawer: 'degraded' }

  const r = await reconcile(model, host)
  const drawerStep = r.steps.find(s => s.step === 'drawers')
  assert(drawerStep != null, 'I9g: drawer step exists')
  // setDrawer returns 'degraded' but we don't currently check that in the drawer step
}

// ============================================================================
// I10 — Placement without content root
// ============================================================================
async function testPlacementWithoutContentRoot() {
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A],
    secondary: [B],
  }
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'secondary'),
    makeLiveTab(B, 'h:b', 'primary', { hasContentRoot: false }),
  ])

  const r = await reconcile(model, host)
  assertEqual(r.unresolved.length, 0, 'I10a: all resolved')
  const placementStep = r.steps.find(s => s.step === 'placement')
  assert(placementStep != null, 'I10b: placement step exists')
  assertEqual(placementStep!.status, 'degraded', 'I10c: placement reports degraded')
  assert(placementStep!.reason != null, 'I10d: placement has reason')
  assert(placementStep!.reason!.includes('failed'), 'I10e: reason mentions failed')

  assert(host.tabInSide('h:a', 'primary'), 'I10f: A placed to primary')
  assert(host.tabInSide('h:b', 'primary'), 'I10g: B stays in primary (no root)')
}

// ============================================================================
// I10 — Placement for tabs whose location must change
// ============================================================================
async function testPlacementCrossSide() {
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE],
    secondary: [A],
    active: { primary: PROFILE, secondary: null },
  }
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'primary'),
  ])

  const r = await reconcile(model, host)
  const placementStep = r.steps.find(s => s.step === 'placement')
  assertEqual(placementStep!.status, 'ok', 'I10h: placement OK')
  assert(host.tabInSide('h:a', 'secondary'), 'I10i: A placed to secondary')
}

// ============================================================================
// I11 — Idempotence under no external change (echo supression stub)
// ============================================================================
async function testIdempotenceAfterFullConvergence() {
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A, B],
    secondary: [C],
    hidden: [B],
    active: { primary: A, secondary: C },
    drawers: {
      primary: { open: true, width: 500 },
      secondary: { open: true, width: 350 },
    },
    side: 'right',
  }
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary'),
    makeLiveTab(A, 'h:a', 'primary', { activeInPrimary: true }),
    makeLiveTab(B, 'h:b', 'primary', { hidden: true }),
    makeLiveTab(C, 'h:c', 'secondary', { activeInSecondary: true }),
  ])

  const r1 = await reconcile(model, host)
  const r2 = await reconcile(model, host)
  assertEqual(r2.ops, 0, 'I11a: full convergence idempotent')
}

// ============================================================================
// I12 — Concurrent dispatch serialization (simplified)
// ============================================================================
async function testSequentialModelConvergence() {
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'primary'),
  ])

  const m1: LayoutModel = {
    ...createEmptyModel(),
    primary: [A, PROFILE],
  }
  const m2: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A],
    active: { primary: PROFILE, secondary: null },
  }

  await reconcile(m1, host)
  const r2 = await reconcile(m2, host)
  assert(r2.ops > 0, 'I12a: second model reconciles')

  const r3 = await reconcile(m2, host)
  assertEqual(r3.ops, 0, 'I12b: final state converged')

  const obs = host.observe()
  assertArraysEqual(tabIds(obs, 'primary'), ['h:profile', 'h:a'], 'I12c: final order matches m2')
}

// ============================================================================
// Extra — Drawer state reconciliation
// ============================================================================
async function testDrawerStateReconciliation() {
  const model: LayoutModel = {
    ...createEmptyModel(),
    drawers: {
      primary: { open: true, width: 600 },
      secondary: { open: true, width: 300 },
    },
    side: 'right',
  }
  const host = new FakeHost([])

  const r1 = await reconcile(model, host)
  assert(r1.ops > 0, 'ED1: drawer reconciliation applies')

  const obs = host.observe()
  assertEqual(obs.primaryOpen, true, 'ED2: primary open')
  assertEqual(obs.primaryWidth, 600, 'ED3: primary width')
  assertEqual(obs.secondaryOpen, true, 'ED4: secondary open')
  assertEqual(obs.secondaryWidth, 300, 'ED5: secondary width')
  assertEqual(obs.drawerSide, 'right', 'ED6: drawer side right')

  const r2 = await reconcile(model, host)
  assertEqual(r2.ops, 0, 'ED7: drawer idempotent')
}

// ============================================================================
// Extra — Side swap reconciliation
// ============================================================================
async function testSideSwap() {
  const model: LayoutModel = {
    ...createEmptyModel(),
    side: 'right',
  }
  const host = new FakeHost([], 'left')

  const r1 = await reconcile(model, host)
  assertEqual(host.observe().drawerSide, 'right', 'ES1: side swapped to right')

  const model2: LayoutModel = {
    ...model,
    side: 'left',
  }
  const r2 = await reconcile(model2, host)
  assertEqual(host.observe().drawerSide, 'left', 'ES2: side swapped back to left')
}

// ============================================================================
// Extra — Active null
// ============================================================================
async function testActiveNull() {
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A],
    active: { primary: null, secondary: null },
  }
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'primary'),
  ])

  const r = await reconcile(model, host)
  // Model says active primary is null → we don't deactivate in host
  // (HostPort has no deactivate method). This is expected — model.active.null
  // means "nothing selected", which we can't force on the host.
  const actStep = r.steps.find(s => s.step === 'activation')
  assertEqual(actStep!.ops, 0, 'EA1: null active → no activation ops')
}

// ============================================================================
// Extra — Tab missing in host but then appears with wrong location
// ============================================================================
async function testLateRegistrationCrossSide() {
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A],
    secondary: [B],
  }
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
  ])

  const r1 = await reconcile(model, host)
  assertEqual(r1.unresolved.length, 2, 'EL1: A and B unresolved')

  // B appears first, but on the wrong side
  host.addTab(B, 'h:b', 'primary')

  const r2 = await reconcile(model, host)
  assert(r2.unresolved.includes(A), 'EL2: A still unresolved')
  assert(!r2.unresolved.includes(B), 'EL3: B resolved')
  assert(host.tabInSide('h:b', 'secondary'), 'EL4: B placed to secondary')

  // Now A appears late
  host.addTab(A, 'h:a', 'secondary')

  const r3 = await reconcile(model, host)
  assertEqual(r3.unresolved.length, 0, 'EL5: all resolved')
  assert(host.tabInSide('h:a', 'primary'), 'EL6: A placed to primary')
}

// ============================================================================
// Extra — All tabs, full convergence, then add a new one
// ============================================================================
async function testAddNewTabAfterConvergence() {
  const model1: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A],
  }
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary'),
    makeLiveTab(A, 'h:a', 'primary'),
  ])

  const r1 = await reconcile(model1, host)
  assertEqual(r1.ops, 0, 'EN1: already converged')

  const model2: LayoutModel = {
    ...model1,
    primary: [PROFILE, A, B],
  }
  const r2 = await reconcile(model2, host)
  assert(r2.unresolved.includes(B), 'EN2: B unresolved')
  host.addTab(B, 'h:b', 'primary')
  const r3 = await reconcile(model2, host)
  assertEqual(r3.unresolved.length, 0, 'EN3: B resolved')
  assertArraysEqual(tabIds(host.observe(), 'primary'), ['h:profile', 'h:a', 'h:b'], 'EN4: order correct')
}

// ============================================================================
// A14 — Suffix drift: liveId changes but key stays stable
// ============================================================================
async function testSuffixDrift() {
  const host = new FakeHost([
    makeLiveTab(A, 'h:a:1', 'primary'),
  ])
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [A],
    active: { primary: null, secondary: null },
  }

  // First reconcile: converge
  const r1 = await reconcile(model, host)
  assertEqual(r1.ops, 0, 'S1a: already converged')

  // Suffix drift: liveId changes from h:a:1 → h:a:2
  // The key stays the same, resolve should still work
  host.changeLiveId(A, 'h:a:2')
  assertEqual(host.resolve(A), 'h:a:2', 'S1b: resolve returns new liveId')
  assertEqual(host.findKey('h:a:2'), A, 'S1c: findKey maps back')

  // Reconcile should still be idempotent (world unchanged except id)
  const r2 = await reconcile(model, host)
  assertEqual(r2.ops, 0, 'S1d: still idempotent after suffix drift')
}

// ============================================================================
// A15 — Host activation theft (pendingActiveTabReset)
// ============================================================================
async function testHostActivationTheft() {
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'primary'),
  ])
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A],
    hidden: [],
    active: { primary: A, secondary: null },
  }

  // Register a callback that steals activation to PROFILE whenever the
  // world changes. This simulates pendingActiveTabReset: after every write,
  // the host resets active to the first tab.
  let stoleOnce = false
  const unsub = host.onWorldChanged(() => {
    if (stoleOnce) return
    stoleOnce = true
    host.stealActivation('primary', 'h:profile')
  })

  resetEpochState()

  // Reconcile: model wants A active. Reconcile activates A, _notify fires.
  // Steal callback fires during epoch: host resets activation to PROFILE.
  // Echo suppression detects at least one non-echo (the steal changed the
  // world away from what the model expects), schedules a post-epoch.
  const r1 = await reconcile(model, host)
  assertEqual(r1.ops, 1, 'T1a: one write op (activate A)')
  assert(r1.echo != null, 'T1b: echo info present')
  if (r1.echo) {
    assert(r1.echo.nonEcho >= 1, `T1c: at least one non-echo from steal, got ${r1.echo.nonEcho}`)
    assert(r1.echo.postEpochScheduled === true, 'T1d: post-epoch scheduled')
  }

  // Flush the post-epoch reconcile — it re-asserts A
  await flushMicrotasks()
  assertEqual(epochState().active, false, 'T1e: epoch closed')

  // After post-epoch converge, A should be active again
  const w = host.observe()
  const aEntry = w.tabs.find(t => t.key === A)
  assert(aEntry!.isActiveInPrimary, 'T1f: A is active after post-epoch re-assert')

  unsub()
}

// ============================================================================
// A15b — Commit lag: writes apply immediately, notifications fire after N ticks
// ============================================================================
async function testCommitLag() {
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'primary', { activeInPrimary: false }),
  ])
  host._failureConfig = { commitLagTicks: 2 }

  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A],
    hidden: [],
    active: { primary: A, secondary: null },
  }

  resetEpochState()

  // First reconcile: model wants A active. Host writes immediately.
  // Notifications are delayed 2 microtask ticks, but the reconciler's
  // `await` between write steps drains the microtask queue, so the
  // delayed notification fires before `reconcile()` returns.
  const r1 = await reconcile(model, host)
  assertEqual(r1.ops, 1, 'L1a: one write op (activate A)')
  assert(r1.echo != null, 'L1b: echo info present')
  if (r1.echo) {
    // The notification fires during the await yield → echo is counted.
    // With a single write and converged state, it should be counted as echo.
    assert(r1.echo.echoDropped >= 1, `L1c: echo from delayed notify during await, got ${r1.echo.echoDropped}`)
    assert(r1.echo.postEpochScheduled === false, 'L1d: no post-epoch (single write, converged)')
  }

  await flushMicrotasks()

  // Second reconcile: idempotent
  const r2 = await reconcile(model, host)
  assertEqual(r2.ops, 0, 'L1e: idempotent after lag')
  assert(r2.echo!.postEpochScheduled === false, 'L1f: no post-epoch')

  // Final state: A is active
  const w = host.observe()
  const aEntry = w.tabs.find(t => t.key === A)
  assert(aEntry!.isActiveInPrimary, 'L1g: A is active after lag convergence')
}

// ============================================================================
// A16 — Bridge→store→DOM fallback: placeTab fails first, succeeds on retry
// ============================================================================
async function testPlaceRetryAfterFailed() {
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'primary'),
  ])
  host._placeTabFailCount = 1

  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE],
    secondary: [A],
    hidden: [],
    active: { primary: PROFILE, secondary: A },
  }

  // First reconcile: placeTab fails for A (bridge NO-GO)
  const r1 = await reconcile(model, host)
  const placeStep = r1.steps.find(s => s.step === 'placement')
  assert(placeStep != null, 'R1a: placement step exists')
  assertEqual(placeStep!.status, 'degraded', 'R1b: placement degraded on first try')

  // Second reconcile: placeTab succeeds (store fallback)
  const r2 = await reconcile(model, host)
  const placeStep2 = r2.steps.find(s => s.step === 'placement')
  assert(placeStep2 != null, 'R1c: second placement step exists')
  assertEqual(placeStep2!.status, 'ok', 'R1d: placement succeeds on retry')

  // Third pass: idempotent
  const r3 = await reconcile(model, host)
  assertEqual(r3.ops, 0, 'R1e: idempotent after retry succeeds')
}

// A live inventory is allowed to be non-empty while React is still committing.
// Reconcile must wait for the settled revision instead of writing a partial
// primary/secondary order.
async function testNonReadyInventoryDefersWrites() {
  const host = new FakeHost([
    makeLiveTab(A, 'h:a', 'primary'),
  ])
  const originalObserve = host.observe.bind(host)
  let settled = false
  ;(host as any).observe = () => {
    const observed = originalObserve()
    return {
      ...observed,
      inventory: { status: settled ? 'ready' : 'partial', revision: settled ? 2 : 1 },
    }
  }

  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [A],
  }
  const deferred = await reconcile(model, host)
  assertEqual(deferred.ops, 0, 'N1: partial inventory performs no writes')
  assertEqual(deferred.steps.find(step => step.step === 'inventory')?.status, 'degraded', 'N2: partial inventory is reported')

  settled = true
  const converged = await reconcile(model, host)
  assertEqual(converged.ops, 0, 'N3: settled inventory converges normally')
}

// ============================================================================
// I14 — Epoch cleared after exception (Task 1: try/finally invariant)
// ============================================================================
async function testEpochClearedAfterException() {
  const host = new FakeHost([
    makeLiveTab(A, 'h:a', 'primary', { activeInPrimary: true }),
    makeLiveTab(B, 'h:b', 'primary'),
  ])
  // setOrder throws — but the model has B after A in primary, so setOrder is
  // called during reconcile. The exception propagates after the listener
  // subscription is installed; the test seam must be the only failure
  // point. A no-op diff is needed so the throw is hit: order primary
  // [A, B] vs observed [A] would not diff (length mismatch → wants [A,B]
  // but the host already has [A] then [B] after the first attempt) — we
  // rely on the test observing that the throw happens. To force a setOrder
  // call: model says [B, A], host has [A, B] → diff exists.
  host._failureConfig = { setOrder: 'throw' }

  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [B, A],
    active: { primary: B, secondary: null },
  }

  resetEpochState()

  let caught: unknown = null
  try {
    await reconcile(model, host)
  } catch (err) {
    caught = err
  }
  assert(caught instanceof Error, 'X1a: setOrder throw propagates out of reconcile')
  assertEqual(epochState().active, false, 'X1b: epoch cleared after exception')

  // After the exception, the post-epoch re-assertion must not be scheduled
  // (the listener that would have set it was disposed in the finally).
  // Run a converged reconcile to confirm the queue has not been corrupted.
  const convergedHost = new FakeHost([
    makeLiveTab(A, 'h:a', 'primary', { activeInPrimary: true }),
  ])
  resetEpochState()
  const convergedModel: LayoutModel = {
    ...createEmptyModel(),
    primary: [A],
    active: { primary: A, secondary: null },
  }
  const r = await reconcile(convergedModel, convergedHost)
  assertEqual(r.ops, 0, 'X1c: fresh reconcile after throw converges normally')
  assertEqual(epochState().active, false, 'X1d: epoch closed after fresh reconcile')
}

// ============================================================================
// I13 — Echo suppression (§4.6)
// ============================================================================

const PROFILE13 = builtinKey('profile')
const A13 = extensionKey('a', 'a')

async function testEchoAlreadyConverged() {
  const host = new FakeHost([
    makeLiveTab(PROFILE13, 'h:profile', 'primary', { activeInPrimary: true }),
  ])
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE13],
    active: { primary: PROFILE13, secondary: null },
  }

  resetEpochState()
  const r = await reconcile(model, host)
  assertEqual(r.ops, 0, 'E1a: already-converged has 0 ops')
  assert(r.echo != null, 'E1b: echo info present')
  if (r.echo) {
    assertEqual(r.echo.echoDropped, 0, 'E1c: no echoes dropped (no writes)')
    assertEqual(r.echo.nonEcho, 0, 'E1d: no non-echoes')
    assert(r.echo.postEpochScheduled === false, 'E1e: no post-epoch scheduled')
  }
  await flushMicrotasks()
  assertEqual(epochState().active, false, 'E1f: epoch closed after flush')
}

async function testEchoSingleWrite() {
  const host = new FakeHost([
    makeLiveTab(PROFILE13, 'h:profile', 'primary', { activeInPrimary: true, hidden: true }),
  ])
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE13],
    hidden: [],
    active: { primary: PROFILE13, secondary: null },
  }

  resetEpochState()
  const r = await reconcile(model, host)
  assertEqual(r.ops, 1, 'E2a: one write op (unhide)')
  assert(r.echo != null, 'E2b: echo info present')
  if (r.echo) {
    assert(r.echo.echoDropped >= 1, `E2c: echo dropped >= 1, got ${r.echo.echoDropped}`)
    assertEqual(r.echo.nonEcho, 0, 'E2d: no non-echoes (world matches after single write)')
    assert(r.echo.postEpochScheduled === false, 'E2e: no post-epoch needed')
  }
  await flushMicrotasks()
}

async function testEchoMultiWrite() {
  const host = new FakeHost([
    makeLiveTab(PROFILE13, 'h:profile', 'primary', { activeInPrimary: true, hidden: true }),
    makeLiveTab(A13, 'h:a', 'primary', { activeInPrimary: false }),
  ])
  host.setOrder('primary', ['h:a', 'h:profile'])

  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE13, A13],
    hidden: [],
    active: { primary: PROFILE13, secondary: null },
  }

  resetEpochState()
  const r = await reconcile(model, host)
  assert(r.ops >= 2, `E3a: at least 2 write ops (unhide + reorder), got ${r.ops}`)
  assert(r.echo != null, 'E3b: echo info present')
  if (r.echo) {
    assert(r.echo.nonEcho >= 1, `E3c: at least one non-echo during multi-write, got ${r.echo.nonEcho}`)
    assert(r.echo.echoDropped >= 1, `E3d: at least one echo dropped (last write), got ${r.echo.echoDropped}`)
    assert(r.echo.postEpochScheduled === true, 'E3e: post-epoch scheduled')
  }
  await flushMicrotasks()
  assertEqual(epochState().active, false, 'E3f: epoch closed after flush')
}

async function testEchoIdempotentAfterConvergence() {
  const host = new FakeHost([
    makeLiveTab(PROFILE13, 'h:profile', 'primary', { activeInPrimary: true, hidden: true }),
  ])
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE13],
    hidden: [],
    active: { primary: PROFILE13, secondary: null },
  }

  resetEpochState()
  const r1 = await reconcile(model, host)
  assert(r1.echo != null, 'E4a: first pass has echo info')
  await flushMicrotasks()

  const r2 = await reconcile(model, host)
  assertEqual(r2.ops, 0, 'E4b: second pass idempotent')
  assert(r2.echo != null, 'E4c: second pass has echo info')
  if (r2.echo) {
    assertEqual(r2.echo.echoDropped, 0, 'E4d: no echoes (no writes)')
    assertEqual(r2.echo.nonEcho, 0, 'E4e: no non-echoes')
    assert(r2.echo.postEpochScheduled === false, 'E4f: no re-schedule')
  }
  await flushMicrotasks()
}

async function testEchoSequentialConvergence() {
  const host = new FakeHost([
    makeLiveTab(PROFILE13, 'h:profile', 'primary', { activeInPrimary: true, hidden: true }),
  ])
  host.setOrder('primary', ['h:profile'])

  const model1: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE13],
    hidden: [],
    active: { primary: PROFILE13, secondary: null },
  }

  resetEpochState()
  const r1 = await reconcile(model1, host)
  assert(r1.ops >= 1, `E5a: first pass has ops (unhide), got ${r1.ops}`)
  assert(r1.echo!.postEpochScheduled === false, 'E5b: no post-epoch')
  await flushMicrotasks()

  const r2 = await reconcile(model1, host)
  assertEqual(r2.ops, 0, 'E5c: second pass idempotent')
  await flushMicrotasks()

  const model2: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE13],
    hidden: [PROFILE13],
    active: { primary: PROFILE13, secondary: null },
  }

  const r3 = await reconcile(model2, host)
  assertEqual(r3.ops, 1, 'E5d: third pass has op (re-hide)')
  assert(r3.echo!.echoDropped >= 1, 'E5e: echo dropped')
  await flushMicrotasks()

  const r4 = await reconcile(model2, host)
  assertEqual(r4.ops, 0, 'E5f: fourth pass idempotent')
  await flushMicrotasks()
}

async function testEchoCrossSidePlacement() {
  const host = new FakeHost([
    makeLiveTab(PROFILE13, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A13, 'h:a', 'primary', { activeInPrimary: false }),
  ])
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE13],
    secondary: [A13],
    hidden: [],
    active: { primary: PROFILE13, secondary: A13 },
  }

  resetEpochState()
  const r = await reconcile(model, host)
  // The post-placement snapshot may already expose the desired secondary
  // order, so the corrected reconciler needs only placement + activation.
  assert(r.ops >= 2, `E6a: at least 2 ops (place + activate), got ${r.ops}`)
  assert(r.echo != null, 'E6b: echo info present')
  if (r.echo) {
    assert(r.echo.nonEcho >= 1, `E6c: non-echoes during cross-side, got ${r.echo.nonEcho}`)
    assert(r.echo.postEpochScheduled === true, 'E6d: post-epoch scheduled')
  }
  await flushMicrotasks()

  const r2 = await reconcile(model, host)
  assertEqual(r2.ops, 0, 'E6e: idempotent after convergence')
  assertArraysEqual(tabIds(host.observe(), 'primary'), ['h:profile'], 'E6f: primary order')
  assertArraysEqual(tabIds(host.observe(), 'secondary'), ['h:a'], 'E6g: secondary order')
  await flushMicrotasks()
}

async function testEchoDegradedWrites() {
  const host = new FakeHost([
    makeLiveTab(PROFILE13, 'h:profile', 'primary', { activeInPrimary: true, hidden: true }),
  ])
  host._failureConfig = { setHidden: 'degraded' }

  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE13],
    hidden: [],
    active: { primary: PROFILE13, secondary: null },
  }

  resetEpochState()
  const r = await reconcile(model, host)
  assertEqual(r.ops, 1, 'E7a: one write op (degraded)')
  assert(r.echo != null, 'E7b: echo info present')
  if (r.echo) {
    assertEqual(r.echo.nonEcho, 0, 'E7c: degraded write with no state change → no callback')
    assertEqual(r.echo.echoDropped, 0, 'E7d: no echoes (state unchanged)')
    assert(r.echo.postEpochScheduled === false, 'E7e: no post-epoch (world unchanged)')
  }
  await flushMicrotasks()

  const r2 = await reconcile(model, host)
  assertEqual(r2.ops, 1, 'E7f: retry still sees the diff (degraded persists)')
  await flushMicrotasks()
}

// ============================================================================
// Run all tests
// ============================================================================
await testIdempotence()
await testEmptyModelIdempotence()
await testAlreadyConverged()
await testIdempotenceWithHidden()
await testLateRegistration()
await testLateRegistrationWrongSide()
await testDegradedSetOrder()
await testDegradedActivate()
await testDegradedSetHidden()
await testDegradedSetDrawer()
await testPlacementWithoutContentRoot()
await testPlacementCrossSide()
await testIdempotenceAfterFullConvergence()
await testSequentialModelConvergence()
await testDrawerStateReconciliation()
await testSideSwap()
await testActiveNull()
await testLateRegistrationCrossSide()
await testAddNewTabAfterConvergence()

// Echo suppression
await testEchoAlreadyConverged()
await testEchoSingleWrite()
await testEchoMultiWrite()
await testEchoIdempotentAfterConvergence()
await testEchoSequentialConvergence()
await testEchoCrossSidePlacement()
await testEchoDegradedWrites()

// Adversarial — suffix drift
await testSuffixDrift()
// Adversarial — host activation theft
await testHostActivationTheft()
// Adversarial — commit lag (microtask delay)
await testCommitLag()
// Adversarial — bridge→store→DOM retry
await testPlaceRetryAfterFailed()
await testNonReadyInventoryDefersWrites()
await testEpochClearedAfterException()

if (failed > 0) {
  console.error(`FAILED: ${failed}`)
  process.exitCode = 1
}
console.log(`PASS: ${passed}/${passed + failed}`)
