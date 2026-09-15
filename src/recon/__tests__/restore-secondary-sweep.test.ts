// Custom assertion harness — see Chronicle testing-conventions.md
//
// 2026-09-15 (OS-off duplicate fix): the boot placement pass must run the
// secondary UNASSIGN sweep after a COMPLETE restore — a slot restore that
// moves a tab secondary→primary leaves its host button in the secondary
// shell (reconcile cannot see it: observed location is model/facade-derived),
// producing a duplicate strip button whose activation cannot load content.
// It must SKIP the sweep while a partial restore's pending merge can still
// add secondary keys (the sweep would wrongly unassign them).
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

mock.module('../../sidebar/secondary', () => ({
  reassignSecondaryTabsFromModel: async () => { seq.push('reassign') },
  unassignSecondaryTabsNotInModel: async () => { seq.push('unassign') },
}))
mock.module('../../sidebar/main-persist', () => ({
  holdSecondaryPlacementReveal: () => {},
  releaseSecondaryPlacementReveal: () => {},
  ensureRestoredPrimaryTab: () => {},
  ensureHostContentParkedPublic: () => {},
}))
mock.module('../../sidebar/main-mirror-drawer', () => ({
  isMainMirrorActive: () => false,
  ensureHostContentParkedPublic: () => {},
}))

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

// A complete restore (every saved tab resolves) → pending flag is null →
// placement first, then the removal sweep.
{
  seq.length = 0
  const host = new FakeHost([
    makeLiveTab(A, 'h:a', 'primary', { activeInPrimary: true }),
    makeLiveTab(B, 'h:b', 'secondary'),
  ])
  const layout = {
    version: 'test-v1.0',
    primary: { open: true, width: 420, tabId: 'h:a' },
    secondary: { open: false, width: 420, activeTabId: 'h:b' },
    tabOrder: ['h:a', 'h:b'],
    detachedTabs: [{ tabId: 'h:b', tabTitle: 'b', sidebar: 'secondary' as const }],
    hiddenTabIds: [],
    drawerSide: 'left' as const,
  }

  shutdown()
  bootstrapFromLayout(layout, host, 'test-v1.0')
  await flush()
  await bootPlacementDone()

  assertEqual(seq.join(','), 'reassign,unassign',
    'complete restore runs placement THEN the removal sweep')
  shutdown()
}

// A partial restore (a saved tab is unresolved) keeps _pendingLayout — the
// pending merge may still add secondary keys, so the sweep must not run.
{
  seq.length = 0
  const host = new FakeHost([
    makeLiveTab(A, 'h:a', 'primary', { activeInPrimary: true }),
  ])
  const layout = {
    version: 'test-v1.0',
    primary: { open: true, width: 420, tabId: 'h:a' },
    secondary: { open: false, width: 420, activeTabId: 'h:b' },
    tabOrder: ['h:a', 'h:b'],
    detachedTabs: [{ tabId: 'h:b', tabTitle: 'b', sidebar: 'secondary' as const }],
    hiddenTabIds: [],
    drawerSide: 'left' as const,
  }

  shutdown()
  bootstrapFromLayout(layout, host, 'test-v1.0')
  await flush()
  await bootPlacementDone()

  assertEqual(seq.join(','), 'reassign',
    'partial restore keeps placement only — the sweep waits for completeness')
  shutdown()
}

if (failed > 0) {
  console.error(`FAILED: ${failed}`)
  process.exitCode = 1
}
console.log(`PASS: ${passed}/${passed + failed}`)
