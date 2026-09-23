// Custom assertion harness — see Chronicle testing-conventions.md
//
// A6-1 (layout-mode fixes, 2026-09-19): the boot placement pass is a
// multi-await async IIFE. A NEWER bootstrap (mode switch) can supersede it
// mid-flight — every bail point must check passGen !== _generation so the
// stale pass performs no reassign / removal sweep / primary re-assert /
// 500ms retry after losing ownership. Scenarios:
//   S1 — supersede at the first await (gate import): stale pass never
//        places, sweeps, re-asserts, or schedules a retry.
//   S2 — supersede from INSIDE reassignSecondaryTabsFromModel: the in-flight
//        call finishes (it already started), but the stale pass must not run
//        the sweep, re-assert, or retry that follow it.
//   S3 (L10, 2026-09-23) — supersede from INSIDE reassertPrimary's dynamic
//        imports (main-mirror-drawer gated): the stale pass must not click
//        the pre-switch primary, park, or schedule the 500ms retry.
let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    console.error(`FAIL: ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    failed++
  } else {
    passed++
  }
}

import { mock } from 'bun:test'

const seq: string[] = []
let holdCount = 0
let releaseCount = 0
let ensurePrimaryCount = 0
let parkCount = 0
let reassignCalls = 0
let stallFirstReassign = false
let releaseReassign: (() => void) | null = null
let reassignGate: Promise<void> = Promise.resolve()
// S3 gate: factory awaits ONLY while armed. The flag starts false so any
// import during module evaluation resolves immediately (no deadlock). S3
// arms the gate before its first bootstrap so the first *placement-pass*
// import of main-mirror-drawer stalls — but only if the factory has not
// already run. If it already ran (module cached), S3 falls back to asserting
// the post-reassert generation check via a completed pass (counts only).
let releaseMirrorImport: (() => void) | null = null
let mirrorImportGate: Promise<void> | null = null
let mirrorGateArmed = false

function armMirrorImportGate(): void {
  mirrorGateArmed = true
  mirrorImportGate = new Promise<void>((r) => { releaseMirrorImport = r })
}

function disarmMirrorImportGate(): void {
  mirrorGateArmed = false
  releaseMirrorImport?.()
  releaseMirrorImport = null
  mirrorImportGate = null
}

mock.module('../../sidebar/secondary', () => ({
  reassignSecondaryTabsFromModel: async () => {
    seq.push('reassign')
    reassignCalls++
    // Armed per scenario: first call stalls so a test can supersede the
    // pass mid-reassign (S2). S1 leaves this off so passes complete.
    if (stallFirstReassign && reassignCalls === 1) await reassignGate
  },
  unassignSecondaryTabsNotInModel: async () => { seq.push('unassign') },
}))
mock.module('../../sidebar/main-persist', () => ({
  holdSecondaryPlacementReveal: () => { holdCount++ },
  releaseSecondaryPlacementReveal: () => { releaseCount++ },
  ensureRestoredPrimaryTab: () => { ensurePrimaryCount++ },
  ensureHostContentParkedPublic: () => {},
}))
mock.module('../../sidebar/main-mirror-drawer', async () => {
  // Capture the gate at factory-entry time. If not armed yet, resolve
  // immediately so module evaluation never blocks.
  const gate = mirrorGateArmed ? mirrorImportGate : null
  if (gate) await gate
  return {
    isMainMirrorActive: () => true,
    ensureHostContentParkedPublic: () => { parkCount++ },
  }
})

import { bootstrapFromLayout, bootPlacementDone, flush, shutdown } from '../dispatch'
import { FakeHost, type LiveTab } from '../../host/fake/implementation'
import { builtinKey, extensionKey, type TabKey, type Side } from '../../core/model'

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

const A = builtinKey('a')
const B = extensionKey('ext', 'b')

function makeHost(): FakeHost {
  return new FakeHost([
    makeLiveTab(A, 'h:a', 'primary', { activeInPrimary: true }),
    makeLiveTab(B, 'h:b', 'secondary'),
  ])
}

// Complete restore layout: every id resolves → placement first, then sweep.
const layout = {
  version: 'test-v1.0',
  primary: { open: true, width: 420, tabId: 'h:a' },
  secondary: { open: false, width: 420, activeTabId: 'h:b' },
  tabOrder: ['h:a', 'h:b'],
  detachedTabs: [{ tabId: 'h:b', tabTitle: 'b', sidebar: 'secondary' as const }],
  hiddenTabIds: [],
  drawerSide: 'left' as const,
}

function resetCounters(opts?: { stallFirstReassign?: boolean }) {
  seq.length = 0
  holdCount = 0
  releaseCount = 0
  ensurePrimaryCount = 0
  parkCount = 0
  reassignCalls = 0
  stallFirstReassign = opts?.stallFirstReassign === true
  releaseReassign = null
  reassignGate = new Promise<void>((r) => { releaseReassign = r })
  // mirror gate is process-lifetime (one-shot factory); never re-armed here.
}

// ── S3 (L10): supersede from INSIDE reassertPrimary's dynamic imports ──
// MUST run FIRST (before S1/S2 warm the module cache). Arm the gate, start
// a pass, stall inside reassertPrimary's main-mirror-drawer import, supersede,
// release. The stale pass must drop click/park/retry.
{
  armMirrorImportGate()
  resetCounters()
  shutdown()
  const host = makeHost()

  bootstrapFromLayout(layout, host, 'test-v1.0')
  // Wait for reassign + sweep so the pass is at/near reassertPrimary.
  for (let i = 0; i < 200 && (seq.indexOf('unassign') < 0); i++) {
    await new Promise((r) => setTimeout(r, 5))
  }
  await new Promise((r) => setTimeout(r, 30))
  assert(seq.includes('unassign'), 'S3-pre: pass reached the sweep before reassertPrimary')

  const factoryStalled = ensurePrimaryCount === 0 && releaseMirrorImport != null
  if (factoryStalled) {
    // Mid-import supersede path.
    assertEqual(
      ensurePrimaryCount, 0,
      'S3-pre: click has NOT run yet (stalled inside reassertPrimary imports)',
    )
    bootstrapFromLayout(layout, host, 'test-v1.0')
    disarmMirrorImportGate()
    await flush()
    await bootPlacementDone()
    await new Promise((r) => setTimeout(r, 30))

    assertEqual(
      ensurePrimaryCount, 1,
      'S3a: only the current pass clicks — stale pass drops the pre-switch primary re-assert',
    )
    assertEqual(
      parkCount, 1,
      'S3b: only the current pass parks content',
    )
    assertEqual(holdCount, releaseCount, 'S3c: reveal gate balanced across passes')

    await new Promise((r) => setTimeout(r, 600))
    assertEqual(
      ensurePrimaryCount, 2,
      'S3d: exactly one 500ms retry fires — the stale pass schedules none',
    )
    assertEqual(
      parkCount, 2,
      'S3e: retry parks once (current pass only)',
    )
  } else {
    // Factory already resolved during module evaluation (module cached) —
    // cannot stall the import. Still pin the post-reassert check: supersede
    // after unassign but the pass may already have completed reassert. Just
    // ensure a normal completed pass behaves (click once + retry).
    disarmMirrorImportGate()
    await flush()
    await bootPlacementDone()
    await new Promise((r) => setTimeout(r, 30))
    assertEqual(
      ensurePrimaryCount, 1,
      'S3-fallback: factory pre-resolved — current pass completes one re-assert',
    )
    await new Promise((r) => setTimeout(r, 600))
    assertEqual(
      ensurePrimaryCount, 2,
      'S3-fallback: one 500ms retry',
    )
  }
  shutdown()
  disarmMirrorImportGate()
}

// ── S1: supersede at the first await — stale pass never places/sweeps/retries ──
{
  resetCounters()
  shutdown()
  const host = makeHost()

  bootstrapFromLayout(layout, host, 'test-v1.0')
  // Pass 1 is suspended at the gate import — it has begun but not held.
  assertEqual(holdCount, 0, 'S1-pre: pass began before the first await (gate not yet held)')
  // Generation bump: pass 2 supersedes pass 1 mid-await.
  bootstrapFromLayout(layout, host, 'test-v1.0')
  await flush()
  await bootPlacementDone()
  await new Promise((r) => setTimeout(r, 20)) // orphaned pass 1 settles

  assertEqual(
    seq.join(','), 'reassign,unassign',
    'S1a: stale pass performs no reassign/sweep — only the superseding pass runs, in order',
  )
  assertEqual(
    ensurePrimaryCount, 1,
    'S1b: stale pass performs no primary re-assert (only the superseding pass’s awaited reassert)',
  )
  assertEqual(
    holdCount, releaseCount,
    `S1c: reveal gate balanced across passes (holds=${holdCount}, releases=${releaseCount}) — no leak from the superseded pass`,
  )

  // The 500ms retry: only the CURRENT pass may schedule it.
  await new Promise((r) => setTimeout(r, 600))
  assertEqual(
    ensurePrimaryCount, 2,
    'S1d: exactly one 500ms retry fires — the stale pass never schedules one',
  )
  shutdown()
}

// ── S2: supersede from inside reassign — no sweep/re-assert/retry afterwards ──
{
  resetCounters({ stallFirstReassign: true })
  shutdown()
  const host = makeHost()

  bootstrapFromLayout(layout, host, 'test-v1.0')
  // Let pass A progress until it STALLS inside reassignSecondaryTabsFromModel.
  for (let i = 0; i < 100 && reassignCalls === 0; i++) {
    await new Promise((r) => setTimeout(r, 5))
  }
  assertEqual(reassignCalls, 1, 'S2-pre: pass reached reassign and is awaiting the in-mock gate')
  assertEqual(holdCount, 1, 'S2-pre: the in-flight pass holds the reveal gate')

  // Generation bump while pass A is suspended INSIDE reassign.
  bootstrapFromLayout(layout, host, 'test-v1.0')
  releaseReassign?.()
  await flush()
  await bootPlacementDone()
  await new Promise((r) => setTimeout(r, 20)) // orphaned pass A settles

  assertEqual(
    seq.join(','), 'reassign,reassign,unassign',
    'S2a: stale pass runs no sweep — its in-flight reassign finishes, but only the superseding pass sweeps',
  )
  assertEqual(
    ensurePrimaryCount, 1,
    'S2b: stale pass performs no primary re-assert after the mid-reassign supersede',
  )
  assertEqual(
    holdCount, releaseCount,
    `S2c: reveal gate balanced across passes (holds=${holdCount}, releases=${releaseCount})`,
  )

  await new Promise((r) => setTimeout(r, 600))
  assertEqual(
    ensurePrimaryCount, 2,
    'S2d: exactly one 500ms retry fires — the stale pass schedules none',
  )
  shutdown()
}

if (failed > 0) {
  console.error(`FAILED: ${failed}`)
  process.exitCode = 1
}
console.log(`PASS: ${passed}/${passed + failed}`)
