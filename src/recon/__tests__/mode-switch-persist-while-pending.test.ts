// Mode-switch persist-while-pending (2026-09-15).
//
// Symptom: enabling the second drawer in OS mode restores its tabs into the
// live model, but `layout.json` is never written when the entering slot
// carries an unresolvable key — `bootstrapFromLayout` arms `_pendingLayout`
// and `reconcileAndPersist` refuses to persist. A reload then restores the
// stale top-level (single) layout and the second drawer comes back empty.
//
// Warm restores (`restoreSingleModeLayout`: second-drawer enable/disable,
// OS disable) pass `{ persistWhilePending: true }`: the resolved live model
// is written immediately while the retry window stays armed, so a merely-late
// key still merges + re-persists; only never-resolving keys are pruned.
// Boot (no option) keeps the partial-restore contract: no write until the
// restore completes.

;(globalThis as any).document = {
  documentElement: {
    classList: { contains() { return false }, add() {}, remove() {} },
    style: { setProperty() {}, removeProperty() {}, getPropertyValue() { return '' } },
  },
  querySelector: () => null,
  querySelectorAll: () => [],
  body: { querySelector: () => null, appendChild() {}, removeChild() {} },
}
;(globalThis as any).requestAnimationFrame = (cb: any) => { cb(1); return 1 }
;(globalThis as any).cancelAnimationFrame = () => {}
;(globalThis as any).CSS = { escape: (s: string) => s }
;(globalThis as any).getComputedStyle = () => ({})

import { mock } from 'bun:test'

mock.module('../../features/registry', () => ({ FEATURES: [] }))
mock.module('../../debug/log', () => ({ dlog: () => {}, dwarn: () => {}, setDebug: () => {} }))
mock.module('../../layout/snapshot', () => ({
  hasDetachedTabs: (l: any) => Array.isArray(l?.detachedTabs) && l.detachedTabs.length > 0,
  seedDualLayoutFromLive: () => {},
  buildPersistedLayout: () => ({
    version: 2,
    primary: { open: false, width: 420, tabId: null },
    secondary: { open: false, width: 420, activeTabId: null },
    detachedTabs: [],
    hiddenTabIds: [],
  }),
}))

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}

const [{ bootstrapFromLayout, shutdown, flush }] = await Promise.all([
  import('../../recon/dispatch'),
])
const [{ FakeHost }] = await Promise.all([import('../../host/fake/implementation')])
const [{ builtinKey }] = await Promise.all([import('../../core/model')])
const [
  { armLayoutRepo, __resetLayoutRepoForTest, setLayoutRepoBackendCtx, bindLayoutSaveResultBridge },
] = await Promise.all([import('../../persist/layout-repo')])

const LOOM = builtinKey('loom')
const WEAVER = builtinKey('weaver')
const HONE = builtinKey('Hone')

// Recording backend (ack saves so nothing times out).
const writes: any[] = []
const backendHandlers = new Set<(payload: unknown) => void>()
const backend = {
  sendToBackend(message: { type: string; [key: string]: unknown }) {
    if (message.type === 'SAVE_LAYOUT') {
      writes.push(message.layout)
      backendHandlers.forEach((h) =>
        h({ type: 'SAVE_LAYOUT_RESULT', saveId: message.saveId, result: { status: 'ok' } }))
    }
  },
  onBackendMessage(handler: (payload: unknown) => void) {
    backendHandlers.add(handler)
    return () => backendHandlers.delete(handler)
  },
}
__resetLayoutRepoForTest()
setLayoutRepoBackendCtx(backend)
armLayoutRepo()
bindLayoutSaveResultBridge()

const makeHost = () => new FakeHost([
  { key: LOOM, liveId: 'loom', location: 'primary', hidden: false, activeInPrimary: true, activeInSecondary: false, hasContentRoot: true, isBuiltin: true },
  { key: WEAVER, liveId: 'weaver', location: 'primary', hidden: false, activeInPrimary: false, activeInSecondary: false, hasContentRoot: true, isBuiltin: true },
])

// Entering dual slot with one unresolvable key (Hone not registered).
const slot = {
  version: 't',
  primary: { open: false, width: 420, tabId: 'loom' },
  secondary: { open: false, width: 420, activeTabId: null },
  detachedTabs: [{ tabId: 'Hone', tabTitle: 'Hone', sidebar: 'secondary' }],
  tabOrder: ['loom', 'weaver', 'Hone'],
  hiddenTabIds: [],
  drawerSide: 'left',
}

// ── S1: warm restore + persistWhilePending → resolved model persisted now ──
{
  shutdown()
  writes.length = 0
  const host = makeHost()
  bootstrapFromLayout(slot, host, 'test-version', { persistWhilePending: true })
  await flush()
  assert(writes.length >= 1, 'S1: warm restore persisted while the stale key is still pending')
  const blob = writes[writes.length - 1]
  assert(
    Array.isArray(blob?.tabOrder) && blob.tabOrder.includes('loom') && blob.tabOrder.includes('weaver'),
    'S1: persisted blob carries the resolved primary tabs',
  )
  assert(
    Array.isArray(blob?.detachedTabs) && blob.detachedTabs.length === 0,
    'S1: unresolvable Hone not in the resolved serialization yet',
  )

  // Retry window remains armed: a late registration merges and re-persists.
  host.addTab(HONE, 'Hone', 'secondary')
  await flush()
  const after = writes[writes.length - 1]
  assert(
    (after?.detachedTabs ?? []).some((d: any) => d.tabId === 'Hone'),
    'S1: late key merged + re-persisted (retry window intact)',
  )
}

// ── S2: boot control (no option) → no write while the restore is partial ──
{
  shutdown()
  writes.length = 0
  const host = makeHost()
  bootstrapFromLayout(slot, host, 'test-version')
  await flush()
  assert(writes.length === 0, 'S2: boot keeps the retry window — no persist while pending')

  host.addTab(HONE, 'Hone', 'secondary')
  await flush()
  assert(writes.length >= 1, 'S2: boot persists once every key resolves')
}

console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
if (failed > 0) process.exit(1)
export {}
