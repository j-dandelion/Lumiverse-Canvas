// Restore-time OS routing override (2026-09-19, layout-mode fixes F3 /
// R1-BLOCKER-1; re-scoped adversarial F2): `setSettings` flips `osMode`
// synchronously BEFORE the transition's restore runs, so a queued/superseded
// run can be persisting while the live setting already reads the NEXT mode.
// TWO slots (F2): `setPersistOsOverride` writes the RUN-scoped value (OS
// run entry/exit); `bootstrapFromLayout` records `opts.osActive` in the
// bootstrap-scoped slot; `buildPersistedBlob` reads
// `run ?? boot ?? isOsModeEnabled()` — the run value survives the
// bootstrap's settle.
//
// Scenario A: live setting says osMode ON, but the restore routes with
// `{ osActive: false }` (an OS-disable run whose setting was superseded back
// on). The write captured during the restore must route as NON-OS:
//   - singleLayout carries the model (single non-OS slot written),
//   - osSingleLayout passes through the STORED slot untouched,
//   - top-level closedTabIds stripped (non-OS serialization).
// Scenario B (control, no override): the same live-ON boot WITHOUT
// opts.osActive routes as OS — singleLayout passes through stored,
// osSingleLayout carries the model — proving A's assertions discriminate.
// Scenario C (F2): a RUN-scoped override set BEFORE a plain
// bootstrapFromLayout (no opts, live OFF) must (1) route that restore's
// write OS-despite-live-OFF, (2) SURVIVE the bootstrap settle — a write
// triggered AFTER flush() still routes with the run's value (the old single
// slot was nulled by settle here, the exact F2 defect), and (3) fall back
// to the live setting only after setPersistOsOverride(null).
// Scenario D (L4, 2026-09-23): a pending-layout restore whose 30s retry
// window expires must clear ONLY the bootstrap-scoped override — never the
// RUN-scoped slot (a normal OS run clears its own run slot in its finally;
// the deadline is not a reliable run-end signal).

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

const [{ bootstrapFromLayout, shutdown, flush, setPersistOsOverride, dispatchBatch }] =
  await Promise.all([
    import('../../recon/dispatch'),
  ])
const [{ FakeHost }] = await Promise.all([import('../../host/fake/implementation')])
const [{ builtinKey }] = await Promise.all([import('../../core/model')])
const [
  { armLayoutRepo, __resetLayoutRepoForTest, setLayoutRepoBackendCtx, bindLayoutSaveResultBridge },
] = await Promise.all([import('../../persist/layout-repo')])
const [
  { hydrateSettings, setSingleLayoutSlot, setOsSingleLayoutSlot },
] = await Promise.all([import('../../settings/state')])

const LOOM = builtinKey('loom')
const WEAVER = builtinKey('weaver')

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

// Single-shaped restore (no detached tabs → isDual false) with a closed-set
// id so the non-OS serialization strip is observable too.
const layout = {
  version: 't',
  primary: { open: false, width: 420, tabId: 'loom' },
  secondary: { open: false, width: 420, activeTabId: null },
  tabOrder: ['loom', 'weaver'],
  detachedTabs: [],
  hiddenTabIds: [],
  closedTabIds: ['weaver'],
  drawerSide: 'left',
}

// Live setting says OS mode ON for BOTH scenarios.
hydrateSettings({ osMode: true })
setSingleLayoutSlot({ marker: 'stored-single' })
setOsSingleLayoutSlot({ marker: 'stored-os-single' })

// ── A: osActive:false while live osMode ON → write routes as non-OS ──
{
  shutdown()
  writes.length = 0
  const host = makeHost()
  bootstrapFromLayout(layout, host, 'test-version', { osActive: false })
  await flush()
  assert(writes.length >= 1, 'A0: the restore wrote a layout blob')
  const blob = writes[0]

  // singleLayout carries the model (non-OS single slot written)…
  assert(
    blob?.singleLayout != null
      && Array.isArray(blob.singleLayout.tabOrder)
      && JSON.stringify(blob.singleLayout.tabOrder) === JSON.stringify(blob.tabOrder),
    'A1: singleLayout carries the restored model (tabOrder matches the top-level blob)',
  )
  assert(
    blob?.singleLayout?.marker !== 'stored-single',
    'A2: singleLayout does NOT pass through the stored non-OS slot (model wins)',
  )
  // …while osSingleLayout passes through stored, untouched.
  assertEqual(
    blob?.osSingleLayout?.marker, 'stored-os-single',
    'A3: osSingleLayout passes through the stored OS slot (non-OS routing)',
  )
  assert(
    blob?.osSingleLayout?.tabOrder === undefined,
    'A4: osSingleLayout is NOT the model under non-OS routing',
  )
  assertEqual(
    (blob?.closedTabIds ?? []).length, 0,
    'A5: non-OS serialization strips closedTabIds from the top-level blob',
  )
}

// ── B (control): no override, live osMode ON → write routes as OS ──
{
  shutdown()
  writes.length = 0
  const host = makeHost()
  bootstrapFromLayout(layout, host, 'test-version')
  await flush()
  assert(writes.length >= 1, 'B0: the control restore wrote a layout blob')
  const blob = writes[0]

  assertEqual(
    blob?.singleLayout?.marker, 'stored-single',
    'B1: control — without the override, live osMode ON routes singleLayout to the STORED slot',
  )
  assert(
    blob?.osSingleLayout != null
      && Array.isArray(blob.osSingleLayout.tabOrder)
      && JSON.stringify(blob.osSingleLayout.tabOrder) === JSON.stringify(layout.tabOrder),
    'B2: control — osSingleLayout carries the model (OS routing)',
  )
}

// ── C (F2): RUN-scoped override survives the bootstrap settle ──
{
  shutdown()
  writes.length = 0
  // Live says OS OFF — discriminates against the run override TRUE below.
  hydrateSettings({ osMode: false })
  setSingleLayoutSlot({ marker: 'stored-single-c' })
  setOsSingleLayoutSlot({ marker: 'stored-os-single-c' })
  const host = makeHost()

  // An OS-enable run is in flight: run-scoped override set at run entry.
  setPersistOsOverride(true)
  // The run's restore bootstraps with NO osActive opt (plain call inside
  // the run): the bootstrap slot is null, but the RUN slot must win, and
  // the bootstrap's settle (fires during the flush below) must NOT clear it.
  bootstrapFromLayout(layout, host, 'test-version')
  await flush() // settle happens here (gen current) — old code nulled the slot
  assert(writes.length >= 1, 'C0: the restore wrote a layout blob')
  const cBlob = writes[writes.length - 1]
  assert(
    cBlob?.osSingleLayout != null
      && Array.isArray(cBlob.osSingleLayout.tabOrder)
      && JSON.stringify(cBlob.osSingleLayout.tabOrder) === JSON.stringify(layout.tabOrder),
    'C1: run-scoped override routes the restore write OS-despite-live-OFF + no opts',
  )
  assertEqual(
    cBlob?.singleLayout?.marker, 'stored-single-c',
    'C2: singleLayout passes through stored under the run override (OS routing)',
  )

  // POST-SETTLE persist during the run (sweep/pending-window analog): the
  // live setting is still OFF, the run override must still own routing.
  // Flip a closed bit so the model change forces a fresh write.
  writes.length = 0
  await dispatchBatch([{ t: 'setClosed', key: WEAVER, closed: true }])
  await flush()
  assert(writes.length >= 1, 'C3: post-settle persist during the run wrote a blob')
  const cBlob2 = writes[writes.length - 1]
  assertEqual(
    cBlob2?.singleLayout?.marker, 'stored-single-c',
    'C4: AFTER settle the write still routes with the RUN\'s osActive (F2 regression — old code cleared at settle → non-OS routing here)',
  )
  assert(
    Array.isArray(cBlob2?.closedTabIds) && cBlob2.closedTabIds.includes('weaver'),
    'C4b: OS routing keeps the closed-set written during the run',
  )

  // Run end: clearing the run override falls back to the LIVE setting
  // (OFF → non-OS routing) for the next persist.
  setPersistOsOverride(null)
  writes.length = 0
  await dispatchBatch([{ t: 'setClosed', key: WEAVER, closed: false }])
  await flush()
  assert(writes.length >= 1, 'C5: post-run-end persist wrote a blob')
  const cBlob3 = writes[writes.length - 1]
  assert(
    cBlob3?.singleLayout != null
      && Array.isArray(cBlob3.singleLayout.tabOrder)
      && cBlob3.singleLayout.marker !== 'stored-single-c',
    'C6: after setPersistOsOverride(null) the write routes with the LIVE setting (non-OS: singleLayout carries the model)',
  )
  assertEqual(
    cBlob3?.osSingleLayout?.marker, 'stored-os-single-c',
    'C7: osSingleLayout passes through stored once the run override is cleared',
  )
}

// ── D (L4): pending-expiry clears only the boot override, not the run slot ──
{
  shutdown()
  writes.length = 0
  // Live says OS OFF — discriminates against the run override TRUE below.
  hydrateSettings({ osMode: false })
  setSingleLayoutSlot({ marker: 'stored-single-d' })
  setOsSingleLayoutSlot({ marker: 'stored-os-single-d' })
  const host = makeHost()

  // Pending layout: loom+weaver resolve, ghost never will → armed window.
  const pendingLayout = {
    version: 't',
    primary: { open: false, width: 420, tabId: 'loom' },
    secondary: { open: false, width: 420, activeTabId: 'ghost' },
    tabOrder: ['loom', 'weaver', 'ghost'],
    detachedTabs: [{ tabId: 'ghost', tabTitle: 'Ghost', sidebar: 'secondary' }],
    hiddenTabIds: [],
    drawerSide: 'left',
  }

  // An OS-enable run is in flight: run-scoped override set at run entry.
  setPersistOsOverride(true)
  bootstrapFromLayout(pendingLayout, host, 'test-version', { persistWhilePending: false })
  await flush()

  // Jump past the 30s deadline, then fire a world change so enqueueHostSync
  // hits the pending-expiry branch (which must NOT null the run slot).
  const realNow = Date.now.bind(Date)
  Date.now = () => realNow() + 31_000
  try {
    host.addTab(builtinKey('late'), 'late', 'primary')
    await flush()
  } finally {
    Date.now = realNow
  }

  // A later persist during the still-open run must route with the RUN value
  // (live OFF, run ON → OS routing: osSingleLayout carries the model).
  writes.length = 0
  await dispatchBatch([{ t: 'setClosed', key: WEAVER, closed: true }])
  await flush()
  assert(writes.length >= 1, 'D0: post-expiry persist during the run wrote a blob')
  const dBlob = writes[writes.length - 1]
  assert(
    dBlob?.osSingleLayout != null
      && Array.isArray(dBlob.osSingleLayout.tabOrder)
      && dBlob.osSingleLayout.tabOrder.includes('weaver'),
    'D1: pending-expiry left the RUN override intact (post-expiry write still routes OS-despite-live-OFF)',
  )
  assertEqual(
    dBlob?.singleLayout?.marker, 'stored-single-d',
    'D2: singleLayout passes through stored under the surviving run override',
  )

  // Run end: clearing the run override falls back to the LIVE setting (OFF).
  setPersistOsOverride(null)
  writes.length = 0
  await dispatchBatch([{ t: 'setClosed', key: WEAVER, closed: false }])
  await flush()
  assert(writes.length >= 1, 'D3: post-run-end persist wrote a blob')
  const dBlob2 = writes[writes.length - 1]
  assert(
    dBlob2?.singleLayout != null
      && Array.isArray(dBlob2.singleLayout.tabOrder)
      && dBlob2.singleLayout.marker !== 'stored-single-d',
    'D4: after setPersistOsOverride(null) the write routes with the LIVE setting (non-OS)',
  )
  assertEqual(
    dBlob2?.osSingleLayout?.marker, 'stored-os-single-d',
    'D5: osSingleLayout passes through stored once the run override is cleared',
  )
}

shutdown()
hydrateSettings(null)
setSingleLayoutSlot(null)
setOsSingleLayoutSlot(null)

console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
if (failed > 0) process.exit(1)
export {}
