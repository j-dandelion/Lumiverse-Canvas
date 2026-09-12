// Persist retry after a failed disk write (review B3, 2026-09-12).
//
// Bug: `persistModel` set `_lastPersistedLayout = json` BEFORE the async save
// resolved and never cleared it on failure. A failed write therefore stayed
// "dedup-cached": every later reconcile of the same content short-circuited
// and the change only lived in memory (and the backend used to ack `ok` even
// on failure — review B2 — so nothing surfaced it).
//
// This drives the REAL dispatch + layout-repo + FakeHost with a backend whose
// FIRST save fails and whose subsequent saves ack ok:
//   1. bootstrap #1 → save #1 fails.
//   2. bootstrap #2 with identical content → save #2 must be SENT (retry).
//   3. bootstrap #3 with identical content → skipped (dedup still works for
//      successful saves, so the fix does not disable the guard).

;(globalThis as any).document = {
  documentElement: {
    classList: {
      _c: new Set<string>(),
      contains(c: string) { return this._c.has(c) },
      add(c: string) { this._c.add(c) },
      remove(c: string) { this._c.delete(c) },
    },
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

const [{ bootstrap, shutdown, flush }, { FakeHost }, { builtinKey, createEmptyModel }] =
  await Promise.all([
    import('../../recon/dispatch'),
    import('../../host/fake/implementation'),
    import('../../core/model'),
  ])
const { armLayoutRepo, __resetLayoutRepoForTest, setLayoutRepoBackendCtx, bindLayoutSaveResultBridge } =
  await import('../../persist/layout-repo')

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

// Recording backend: the first save fails, the rest ack ok.
const writes: any[] = []
const backendHandlers = new Set<(payload: unknown) => void>()
const backend = {
  sendToBackend(message: { type: string; [key: string]: unknown }) {
    if (message.type !== 'SAVE_LAYOUT') return
    writes.push(message.layout)
    const status = writes.length === 1 ? 'error' : 'ok'
    const result = status === 'error'
      ? { status, reason: 'disk full' }
      : { status }
    backendHandlers.forEach((h) =>
      h({ type: 'SAVE_LAYOUT_RESULT', saveId: message.saveId, result }))
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

// Clean module state (also resets the persist dedup cache on this build).
shutdown()
writes.length = 0

const A = builtinKey('a')
const host = new FakeHost([
  { key: A, liveId: 'h:a', location: 'primary', hidden: false, activeInPrimary: true, activeInSecondary: false, hasContentRoot: true, isBuiltin: true },
])
const model = {
  ...createEmptyModel(),
  primary: [A],
  active: { primary: A, secondary: null },
}

// 1. First bootstrap → first save → backend error.
bootstrap(model, host, 'test-version')
await flush()
await tick()
assertEqual(writes.length, 1, '1a: first bootstrap issued one save')
assertEqual(writes[0]?.primary?.tabId, 'h:a', '1b: saved blob carries the resolved primary')

// 2. Identical content again → the failed write must be retried.
bootstrap(model, host, 'test-version')
await flush()
await tick()
assertEqual(writes.length, 2, '2a: identical content re-sent after a failed save (retry)')

// 3. A successful save still dedups identical content.
bootstrap(model, host, 'test-version')
await flush()
await tick()
assertEqual(writes.length, 2, '3a: dedup still skips identical content after a successful save')

console.log(`recon/persist-retry: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

export {}
