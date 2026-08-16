// Regression coverage for host-facing legacy pitfalls.
import { builtinKey, createEmptyModel, extensionKey, type Side, type TabKey } from '../../core/model'
import { FakeHost, type LiveTab } from '../../host/fake/implementation'
import { reconcile } from '../reconcile'

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) passed++
  else { console.error('FAIL:', msg); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) passed++
  else {
    console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    failed++
  }
}
function tab(key: TabKey, id: string, location: Side, overrides: Partial<LiveTab> = {}): LiveTab {
  return {
    key, liveId: id, location, hidden: false,
    activeInPrimary: false, activeInSecondary: false,
    hasContentRoot: true, isBuiltin: key.startsWith('builtin:'),
    ...overrides,
  }
}

const A = builtinKey('a')
const B = extensionKey('ext', 'b')
const C = extensionKey('ext', 'c')

// A ghost secondary-strip entry is corrected by the same placement path as a normal move.
const ghostHost = new FakeHost([
  tab(A, 'host:a', 'primary', { activeInPrimary: true }),
  tab(B, 'host:b', 'primary'),
])
const ghostModel = {
  ...createEmptyModel(),
  primary: [A],
  secondary: [B],
  active: { primary: A, secondary: null },
}
const ghostReport = await reconcile(ghostModel, ghostHost)
assertEqual(ghostReport.unresolved.length, 0, 'ghost move keeps the stable key resolved')
assert(ghostHost.tabInSide('host:b', 'secondary'), 'ghost entry is placed in the model side')

// A closed primary drawer with no model active tab must not activate the host parking selection.
const closedHost = new FakeHost([
  tab(A, 'host:a', 'primary', { activeInPrimary: true }),
])
const closedModel = {
  ...createEmptyModel(),
  primary: [A],
  active: { primary: null, secondary: null },
  drawers: {
    primary: { open: false, width: 420 },
    secondary: { open: false, width: 420 },
  },
}
const closedReport = await reconcile(closedModel, closedHost)
assertEqual(closedReport.steps.find(step => step.step === 'activation')?.ops, 0, 'null active does not trigger activation')
assertEqual(closedHost.observe().primaryOpen, false, 'closed model keeps primary drawer closed')
assertEqual(closedHost.tabActive('primary', 'host:a'), true, 'host parked selection is tolerated while drawer is closed')

// An empty secondary model still converges its drawer geometry; it does not infer a tab.
const emptyHost = new FakeHost([], 'right')
const emptyModel = {
  ...createEmptyModel('left'),
  drawers: {
    primary: { open: true, width: 480 },
    secondary: { open: false, width: 360 },
  },
}
const emptyReport = await reconcile(emptyModel, emptyHost)
assertEqual(emptyReport.unresolved.length, 0, 'empty secondary has no unresolved tabs')
assertEqual(emptyHost.observe().drawerSide, 'left', 'empty model restores drawer side')
assertEqual(emptyHost.observe().secondaryOpen, false, 'empty secondary remains closed')

// A missing content root is degraded, but the model key is never dropped.
const missingRootHost = new FakeHost([
  tab(A, 'host:a', 'primary'),
  tab(B, 'host:b', 'primary', { hasContentRoot: false }),
])
const missingRootModel = {
  ...createEmptyModel(),
  primary: [A],
  secondary: [B],
}
const missingRootReport = await reconcile(missingRootModel, missingRootHost)
assertEqual(missingRootReport.unresolved.length, 0, 'missing root remains a resolved model key')
assertEqual(missingRootReport.steps.find(step => step.step === 'placement')?.status, 'degraded', 'missing root reports degraded placement')
assert(missingRootHost.tabInSide('host:b', 'primary'), 'missing-root tab is not falsely claimed as moved')

// A tab that registers after restore remains in the model and is adopted on
// the next pass, without disturbing the already-settled primary order.
const lateHost = new FakeHost([
  tab(A, 'host:a', 'primary'),
])
const lateModel = {
  ...createEmptyModel(),
  primary: [A, B],
  active: { primary: A, secondary: null },
}
const lateFirst = await reconcile(lateModel, lateHost)
assertEqual(lateFirst.unresolved.length, 1, 'late registration is reported without dropping the model key')
lateHost.addTab(B, 'host:b', 'primary')
const lateSecond = await reconcile(lateModel, lateHost)
assertEqual(lateSecond.unresolved.length, 0, 'late registration resolves on the next pass')
assertEqual(lateHost.observe().tabs.map(t => t.key).join(','), `${A},${B}`, 'late registration preserves model order')

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}/${passed + failed}`)
