// Partial-restore retry (2026-08-16).
//
// Symptom: a direct drag-and-drop move of an extension tab (Hone) to the
// second drawer persists to layout.json, but a hard refresh loses it — the
// tab is back in the main drawer. Root cause (restore side): the boot
// restore is a ONE-SHOT pass. Extension buttons often register AFTER the
// first buildModelFromLayout (React commit lag), so the tab fails to resolve
// on the first pass; because the layout's other tabs resolved fine, the
// deferred-restore retry (historically gated on a FULLY-empty model) never
// fired, and the late tab was silently dropped from the model.
//
// This drives the REAL dispatch + FakeHost: a layout whose Hone tab cannot
// resolve at bootstrap (host does not have it yet) must be retried on the
// next world change, and the model must end up with Hone in SECONDARY.

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

const [{ bootstrapFromLayout, shutdown, getModel, flush, dispatch }] = await Promise.all([
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

shutdown()
// Host knows loom + weaver only — Hone's button has NOT registered yet.
const host = new FakeHost([
  { key: LOOM, liveId: 'loom', location: 'primary', hidden: false, activeInPrimary: true, activeInSecondary: false, hasContentRoot: true, isBuiltin: true },
  { key: WEAVER, liveId: 'weaver', location: 'primary', hidden: false, activeInPrimary: false, activeInSecondary: false, hasContentRoot: true, isBuiltin: true },
])

const layout = {
  version: 't',
  primary: { open: false, width: 420, tabId: 'loom' },
  secondary: { open: false, width: 420, activeTabId: 'Hone' },
  detachedTabs: [{ tabId: 'Hone', tabTitle: 'Hone', sidebar: 'secondary' }],
  tabOrder: ['loom', 'weaver', 'Hone'],
  hiddenTabIds: [],
  drawerSide: 'left',
}

bootstrapFromLayout(layout, host, 'test-version')
await flush()

// First pass: Hone unresolvable → model is partial (no secondary).
let model = getModel()
assert(model != null, 'model present after partial bootstrap')
assert(model!.secondary.length === 0, 'first pass drops the unresolvable Hone tab (partial restore)')
assert(model!.primary.includes(LOOM) && model!.primary.includes(WEAVER), 'first pass keeps the resolvable tabs')

// User action INSIDE the boot window: move weaver to the secondary drawer
// before Hone registers. The convergence merge must never undo it.
await dispatch({ t: 'move', key: WEAVER, to: 'secondary', index: 0 })
await flush()
model = getModel()
assert(model!.secondary.includes(WEAVER), 'user move inside the window is applied to the model')

// Hone registers late (extension button appears) → world change → converge.
host.addTab(HONE, 'Hone', 'secondary')
await flush()

model = getModel()
assert(model != null, 'model present after retry')
assert(model!.secondary.includes(HONE), 'Hone back in secondary after the retry')
assert(model!.secondary.includes(WEAVER), 'user move survives the convergence merge (add-only)')
assert(!model!.primary.includes(HONE), 'Hone not in primary after the retry')

// The completed restore persists the full layout (with Hone detached).
const blob = writes[writes.length - 1]
assert(blob != null, 'a layout blob was persisted after the restore completed')
assert((blob?.detachedTabs ?? []).some((d: any) => d.tabId === 'Hone'), 'persisted layout carries Hone in detachedTabs')

console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
if (failed > 0) process.exit(1)
export {}
