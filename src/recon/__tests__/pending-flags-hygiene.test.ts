// B3-1 (layout-mode fixes, 2026-09-19): warm-persist flag hygiene (R2-7).
//
// `_persistResolvedWhilePending` and `_pendingWindowUserState` only exist
// while a pending restore is armed. In the `resolvedAll` block both reset —
// AFTER `mergeResolvedInto` has run for that round, because the merge reads
// `_pendingWindowUserState` to decide whether user geometry/hidden survive
// the final merge. This test mirrors the canary in
// partial-restore-retry.test.ts:129-145 (user actions inside the pending
// window win) and additionally asserts both flags reset only once the
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
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else {
    console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    failed++
  }
}

const [
  { bootstrapFromLayout, shutdown, flush, dispatch, getModel, __getPendingRestoreFlagsForTest },
] = await Promise.all([import('../../recon/dispatch')])
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

shutdown()
writes.length = 0
const host = new FakeHost([
  { key: LOOM, liveId: 'loom', location: 'primary', hidden: false, activeInPrimary: true, activeInSecondary: false, hasContentRoot: true, isBuiltin: true },
  { key: WEAVER, liveId: 'weaver', location: 'primary', hidden: false, activeInPrimary: false, activeInSecondary: false, hasContentRoot: true, isBuiltin: true },
])

// Warm restore arms _persistResolvedWhilePending; no user intent yet.
bootstrapFromLayout(slot, host, 'test-version', { persistWhilePending: true })
await flush()
let flags = __getPendingRestoreFlagsForTest()
assert(flags.persistResolvedWhilePending === true, 'B3-1a: warm restore arms _persistResolvedWhilePending while pending')
assert(flags.pendingWindowUserState === false, 'B3-1b: no user intent marked yet')

// User actions INSIDE the pending window (canary mirror): geometry, hidden,
// and a move. setDrawer/setHidden mark _pendingWindowUserState; the move is
// preserved by the add-only merge.
await dispatch({ t: 'setDrawer', side: 'primary', open: false, width: 333 })
await flush()
await dispatch({ t: 'setHidden', key: LOOM, hidden: true })
await flush()
await dispatch({ t: 'move', key: WEAVER, to: 'secondary', index: 0 })
await flush()

flags = __getPendingRestoreFlagsForTest()
assert(flags.persistResolvedWhilePending === true, 'B3-1c: flag stays armed while the restore is still pending')
assert(flags.pendingWindowUserState === true, 'B3-1d: setDrawer/setHidden inside the window mark _pendingWindowUserState')

// Late key registers → the final merge runs with keepUser=true, then the
// resolvedAll block resets BOTH flags (after the merge, never before).
host.addTab(HONE, 'Hone', 'secondary')
await flush()

flags = __getPendingRestoreFlagsForTest()
assert(flags.persistResolvedWhilePending === false, 'B3-1e: _persistResolvedWhilePending reset after the completing restore')
assert(flags.pendingWindowUserState === false, 'B3-1f: _pendingWindowUserState reset after the completing restore')

const model = getModel()
assert(model != null, 'B3-1g: model present after completion')
assertEqual(model!.drawers.primary.width, 333, 'B3-1h: user width survives the final merge (canary)')
assertEqual(model!.drawers.primary.open, false, 'B3-1i: user open state survives the final merge (canary)')
assert(model!.hidden.includes(LOOM), 'B3-1j: user hidden survives the final merge (canary)')
assert(model!.secondary.includes(HONE), 'B3-1k: late key merged into secondary')
assert(model!.secondary.includes(WEAVER), 'B3-1l: user move survives the final merge (add-only)')

shutdown()
console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
if (failed > 0) process.exit(1)
export {}
