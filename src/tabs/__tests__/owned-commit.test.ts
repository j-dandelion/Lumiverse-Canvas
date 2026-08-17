// Tests for tabs/owned-commit.ts — the Configure commit rebase path.
//
// `commitDraftToOwnedModel` translates a ConfigureDraft (the UI's source
// of truth while editing) into a sequence of intents dispatched through
// the owned reducer. The rebase step (syncFromHost before key resolution)
// is what this file exercises — the rebase mutates the model without
// rollback unless the key resolution fails (Task 11.3 / P2-3).
//
// The tests use the global dispatcher state via bootstrap/shutdown so the
// real owned-commit code path runs end-to-end.

import type { LayoutModel, TabKey, Side } from '../../core/model'
import { createEmptyModel, builtinKey, extensionKey } from '../../core/model'
import type { LiveTabId } from '../../host/port'
import { FakeHost, type LiveTab } from '../../host/fake/implementation'
import { bootstrap, shutdown, getModel, flush } from '../../recon/dispatch'
import { commitDraftToOwnedModel, plannedMovesForCommit, missingSecondaryButtonKeys } from '../owned-commit'
import type { ConfigureDraft } from '../configure-model'

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

const PROFILE = builtinKey('profile')
const A = extensionKey('ext', 'a')
const B = extensionKey('ext', 'b')
const C = extensionKey('ext', 'c')

function makeDraft(opts: Partial<ConfigureDraft>): ConfigureDraft {
  return {
    drawerSide: 'left',
    primaryIds: [],
    secondaryIds: [],
    builtinOrder: [],
    extensionOrder: [],
    hiddenIds: new Set(),
    ...opts,
  }
}

// ── OC1: happy path — fully-resolved draft commits via dispatcher ──
async function test_OC1_happyPath() {
  shutdown()
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'primary'),
    makeLiveTab(B, 'h:b', 'primary'),
  ])
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A, B],
    secondary: [],
    hidden: [],
    active: { primary: PROFILE, secondary: null },
  }
  bootstrap(model, host)
  await flush()

  const draft = makeDraft({
    drawerSide: 'left',
    primaryIds: ['h:profile', 'h:a', 'h:b'],
    secondaryIds: [],
    builtinOrder: ['h:profile'],
    extensionOrder: ['h:a', 'h:b'],
    hiddenIds: new Set(),
  })

  const result = await commitDraftToOwnedModel(draft)
  assertEqual(result.ok, true, 'OC1a: commitDraftToOwnedModel returns ok')

  const after = getModel()
  assert(after != null, 'OC1b: model present after commit')
  if (after) {
    assertEqual(after.primary.length, 3, 'OC1c: primary length unchanged')
    assertEqual(after.secondary.length, 0, 'OC1d: secondary empty')
    assertEqual(after.active.primary, PROFILE, 'OC1e: PROFILE still active primary')
  }
  shutdown()
}

// ── OC2: cross-drawer move via Configure ──
async function test_OC2_crossDrawerMove() {
  shutdown()
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'primary'),
    makeLiveTab(B, 'h:b', 'primary'),
  ])
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A, B],
    secondary: [],
    hidden: [],
    active: { primary: PROFILE, secondary: null },
  }
  bootstrap(model, host)
  await flush()

  // Configure: move A to secondary, keep primary [PROFILE, B]
  const draft = makeDraft({
    drawerSide: 'left',
    primaryIds: ['h:profile', 'h:b'],
    secondaryIds: ['h:a'],
    builtinOrder: ['h:profile'],
    extensionOrder: ['h:b', 'h:a'],
    hiddenIds: new Set(),
  })

  const result = await commitDraftToOwnedModel(draft)
  assertEqual(result.ok, true, 'OC2a: commit ok')

  const after = getModel()
  if (after) {
    assert(after.secondary.includes(A), 'OC2b: A moved to secondary')
    assert(!after.primary.includes(A), 'OC2c: A gone from primary')
    assert(after.primary.includes(PROFILE), 'OC2d: PROFILE still in primary')
    assert(after.primary.includes(B), 'OC2e: B still in primary')
  }
  shutdown()
}

// ── OC8: skipChrome (live DnD path) converges identically ──
// The DnD caller captures + applies the taskbar/drawer chrome itself
// (pre-hide captures are authoritative); the commit must skip its internal
// chrome capture/apply without changing the model result.
async function test_OC8_skipChrome() {
  shutdown()
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'primary'),
    makeLiveTab(B, 'h:b', 'secondary', { activeInSecondary: true }),
  ])
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A],
    secondary: [B],
    hidden: [],
    active: { primary: PROFILE, secondary: B },
  }
  bootstrap(model, host)
  await flush()

  const draft = makeDraft({
    drawerSide: 'left',
    primaryIds: ['h:profile', 'h:b'],
    secondaryIds: ['h:a'],
    builtinOrder: ['h:profile'],
    extensionOrder: ['h:b', 'h:a'],
    hiddenIds: new Set(),
  })
  const result = await commitDraftToOwnedModel(draft, { primary: PROFILE, secondary: B }, { skipChrome: true })
  assertEqual(result.ok, true, 'OC8a: skipChrome commit ok')

  const after = getModel()
  if (after) {
    assertEqual(after.primary.join(','), [PROFILE, B].join(','), 'OC8b: B moved to primary')
    assertEqual(after.secondary.join(','), [A].join(','), 'OC8c: A moved to secondary')
    // The moved secondary ACTIVE (B) converges to a replacement on
    // secondary — A was moved in, but B's old side has no remaining tab:
    // active.secondary follows applyMove semantics (null here).
    assertEqual(after.active.secondary, null, 'OC8d: secondary active cleared (no remaining secondary tab)')
    assertEqual(after.active.primary, PROFILE, 'OC8e: primary active unchanged (quiet)')
  }
  shutdown()
}

// ── OC3: resolution failure → error + rebase rollback (Task 11.3) ──
async function test_OC3_resolutionFailureRollsBackRebase() {
  shutdown()
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'primary'),
  ])
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A],
    secondary: [],
    hidden: [],
    active: { primary: PROFILE, secondary: null },
  }
  bootstrap(model, host)
  await flush()
  // Extra flush to drain any post-bootstrap enqueueHostSync that the
  // `void task.then` callback may have queued.
  await flush()

  // Capture the pre-rebase state. We will assert that after the failed
  // commit the model returns to this state.
  const preRebase = getModel()
  const preRebaseSnapshot = JSON.stringify({
    primary: preRebase?.primary,
    secondary: preRebase?.secondary,
    hidden: preRebase?.hidden,
    active: preRebase?.active,
  })

  // Draft references a tab id that host.findKey() returns null for.
  const draft = makeDraft({
    drawerSide: 'left',
    primaryIds: ['h:profile', 'h:does-not-exist'],
    secondaryIds: [],
    builtinOrder: ['h:profile'],
    extensionOrder: ['h:does-not-exist'],
    hiddenIds: new Set(),
  })

  const result = await commitDraftToOwnedModel(draft)
  assertEqual(result.ok, false, 'OC3a: commit returns error')
  if (!result.ok) {
    assert(result.error.includes('changed while Configure'), `OC3b: error mentions race, got: ${result.error}`)
  }

  const after = getModel()
  assert(after != null, 'OC3c: model still present after failed commit')
  // The rebase must have been rolled back so the model matches what the
  // user had when they opened Configure.
  const afterSnapshot = JSON.stringify({
    primary: after?.primary,
    secondary: after?.secondary,
    hidden: after?.hidden,
    active: after?.active,
  })
  assertEqual(afterSnapshot, preRebaseSnapshot, 'OC3d: rebase rolled back to pre-Configure state')
  shutdown()
}

// ── OC4: commit lag — the rebase dispatches through the queue ──
async function test_OC4_rebaseHandlesLateRegistration() {
  shutdown()
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'primary'),
  ])
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A],
    secondary: [],
    hidden: [],
    active: { primary: PROFILE, secondary: null },
  }
  bootstrap(model, host)
  await flush()

  // Late registration: B appears in the host after bootstrap. The rebase
  // picks it up via host.observe() before key resolution.
  host.addTab(B, 'h:b', 'primary')

  const draft = makeDraft({
    drawerSide: 'left',
    primaryIds: ['h:profile', 'h:a', 'h:b'],
    secondaryIds: [],
    builtinOrder: ['h:profile'],
    extensionOrder: ['h:a', 'h:b'],
    hiddenIds: new Set(),
  })

  const result = await commitDraftToOwnedModel(draft)
  assertEqual(result.ok, true, 'OC4a: commit ok with late registration')

  const after = getModel()
  if (after) {
    assert(after.primary.includes(B), 'OC4b: late-registered B included in primary')
    assertEqual(after.primary.length, 3, 'OC4c: primary has all three tabs')
  }
  shutdown()
}

// ── OC5: drawer side swap via Configure ──
async function test_OC5_drawerSideSwap() {
  shutdown()
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'primary'),
  ])
  host.setSide('left')
  const model: LayoutModel = {
    ...createEmptyModel('left'),
    primary: [PROFILE, A],
    secondary: [],
    hidden: [],
    active: { primary: PROFILE, secondary: null },
  }
  bootstrap(model, host)
  await flush()

  const draft = makeDraft({
    drawerSide: 'right',
    primaryIds: ['h:profile', 'h:a'],
    secondaryIds: [],
    builtinOrder: ['h:profile'],
    extensionOrder: ['h:a'],
    hiddenIds: new Set(),
  })

  const result = await commitDraftToOwnedModel(draft)
  assertEqual(result.ok, true, 'OC5a: commit ok')

  const after = getModel()
  if (after) {
    assertEqual(after.side, 'right', 'OC5b: side swapped to right')
  }
  shutdown()
}

// ── OC6: hide intent flows through the commit ──
async function test_OC6_hideIntent() {
  shutdown()
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'primary'),
  ])
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A],
    secondary: [],
    hidden: [],
    active: { primary: PROFILE, secondary: null },
  }
  bootstrap(model, host)
  await flush()

  const draft = makeDraft({
    drawerSide: 'left',
    primaryIds: ['h:profile', 'h:a'],
    secondaryIds: [],
    builtinOrder: ['h:profile'],
    extensionOrder: ['h:a'],
    hiddenIds: new Set(['h:a']),
  })

  const result = await commitDraftToOwnedModel(draft)
  assertEqual(result.ok, true, 'OC6a: commit ok with hidden')

  const after = getModel()
  if (after) {
    assert(after.hidden.includes(A), 'OC6b: A is hidden after commit')
  }
  shutdown()
}

// ── plannedMovesForCommit (2026-07-31) ─────────────────────────────────
// Pure planning of the commit's cross-side moves — drives the DOM placement
// pass (the reconciler never places in this environment) and the taskbar /
// drawer chrome handoffs. Desired side vs current side only.

function test_plannedMoves(): void {
  const A = builtinKey('a')
  const B = builtinKey('b')
  const C = builtinKey('c')
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [A, B],
    secondary: [C],
    hidden: [],
    active: { primary: A, secondary: C },
  }

  // No moves: draft matches the model sides.
  const same = plannedMovesForCommit(model, new Map([[A, 'primary'], [B, 'primary'], [C, 'secondary']]))
  assertEqual(same.length, 0, 'OC7: identical sides → no planned moves')

  // One cross-side move each direction.
  const mixed = plannedMovesForCommit(model, new Map([[A, 'secondary'], [B, 'primary'], [C, 'primary']]))
  assertEqual(mixed.length, 2, 'OC7: two planned moves')
  assertEqual(mixed.find(m => m.key === A)?.to, 'secondary', 'OC7: A planned to secondary')
  assertEqual(mixed.find(m => m.key === C)?.to, 'primary', 'OC7: C planned to primary')

  // Unknown keys (not in the model) are ignored.
  const withUnknown = plannedMovesForCommit(model, new Map([[A, 'primary'], [builtinKey('ghost'), 'secondary']]))
  assertEqual(withUnknown.length, 0, 'OC7: unknown key → no planned move')
}

// ── missingSecondaryButtonKeys (2026-08-17) ────────────────────────────
// Model-vs-DOM divergence supplement: a tab the model ALREADY claims is
// secondary but that has no secondary button in the live list still needs
// its DOM placement (failed boot restore / mid-session placement failure —
// e.g. an extension tab misclassified while untagged). Without this heal
// the commit plans no move, the placement pass is skipped, and the tab
// silently stays in the main drawer ("drag an extension tab to another
// drawer → doesn't move in the main UI / activation lands on the old
// drawer").

function test_missingSecondaryButtonKeys(): void {
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE],
    secondary: [A],
    hidden: [],
    active: { primary: PROFILE, secondary: null },
  }
  const desiredSide = new Map<TabKey, Side>([
    [PROFILE, 'primary'],
    [A, 'secondary'], // desired AGREES with the model — plannedMovesForCommit plans nothing
  ])
  const resolve = (key: TabKey) =>
    (key === A ? 'h:a' : key === PROFILE ? 'h:profile' : null) as unknown as LiveTabId

  // Divergence: A's secondary button is missing → heal plans the placement.
  const missing = missingSecondaryButtonKeys(
    model, desiredSide, resolve, (id) => id !== 'h:a',
  )
  assertEqual(missing.length, 1, 'OC9a: divergence detected for model-secondary tab without a button')
  assertEqual(missing[0]?.key, A, 'OC9b: missing key is A')
  assertEqual(missing[0]?.to, 'secondary', 'OC9c: heal targets secondary')

  // No divergence when the button exists.
  const none = missingSecondaryButtonKeys(model, desiredSide, resolve, () => true)
  assertEqual(none.length, 0, 'OC9d: no heal when the secondary button exists')

  // A REAL move (model says primary, desired secondary) is NOT a divergence —
  // plannedMovesForCommit already covers it; the heal must not double-plan.
  const model2: LayoutModel = { ...model, primary: [PROFILE, A], secondary: [] }
  const desired2 = new Map<TabKey, Side>([[A, 'secondary']])
  const missing2 = missingSecondaryButtonKeys(model2, desired2, resolve, () => false)
  assertEqual(missing2.length, 0, 'OC9e: real moves are not classified as divergence')

  // Unresolvable key → no heal.
  const missing3 = missingSecondaryButtonKeys(model, desiredSide, () => null, () => false)
  assertEqual(missing3.length, 0, 'OC9f: unresolvable key skipped')
}

test_plannedMoves()
test_missingSecondaryButtonKeys()

await test_OC1_happyPath()
await test_OC2_crossDrawerMove()
await test_OC3_resolutionFailureRollsBackRebase()
await test_OC4_rebaseHandlesLateRegistration()
await test_OC5_drawerSideSwap()
await test_OC6_hideIntent()
await test_OC8_skipChrome()

console.log(`tabs/owned-commit: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exitCode = 1
  process.exit(1)
}
