// Mode-layout preservation round trip (2026-08-16).
//
// Regression for: "turn second drawer off in Configure Tabs, then on again →
// previous layout lost, all tabs in the same drawer."
//
// Root cause (two layers):
//   1. The dual snapshot written on disable stored **TabKeys** ('builtin:loom')
//      instead of live ids ('h:loom') — captureSessionDualProfileFromLive and
//      snapshotLayout read the TabKey-keyed assignment facade. On re-enable,
//      buildModelFromLayout resolved those keys through host.findKey, whose
//      assignment-map fallback turned every TabKey into a garbage 'ext:…' key
//      → the restored model had an empty secondary → host-sync converged
//      everything back to the main drawer (the reported bug).
//   2. There was no durable single-drawer layout — the vanilla baseline is
//      session-only, so the single layout was not saved/restored across modes.
//
// This test drives the REAL owned-model pipeline (recon/dispatch + core +
// host/fake) through the REAL second-drawer-mode toggle API, asserting:
//   - disable saves a dualLayout slot keyed by LIVE ids (poison fix);
//   - disable swaps the owned model to the single layout (model matches mode);
//   - a reload while single hydrates the slots from the persisted blob, and
//     enable then restores the dual layout (secondary tabs come back);
//   - the singleLayout slot survives the round trip;
//   - the persisted blob embeds both slots.

;(globalThis as any).document = {
  documentElement: {
    classList: {
      _classes: new Set<string>(),
      contains(c: string) { return this._classes.has(c) },
      add(c: string) { this._classes.add(c) },
      remove(c: string) { this._classes.delete(c) },
    },
    style: {
      _props: new Map<string, string>(),
      getPropertyValue(k: string) { return this._props.get(k) ?? '' },
      setProperty(k: string, v: string) { this._props.set(k, v) },
      removeProperty(k: string) { this._props.delete(k) },
    },
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

// ── Mock heavy DOM deps (real: settings/state, second-drawer-mode,
//    recon/dispatch, core, host/fake, persist/layout-model, persist/layout-repo,
//    layout/dual-session-profile, sidebar/drawer-sync) ──

mock.module('../../features/registry', () => ({
  FEATURES: [],
}))

mock.module('../../debug/log', () => ({
  dlog: () => {},
  dwarn: () => {},
  setDebug: () => {},
}))

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

mock.module('../../layout/vanilla-baseline', () => ({
  captureVanillaBaseline: () => ({
    captured: false,
    baseline: {
      host: { side: 'left', tabOrder: [], hiddenTabIds: [], showTabLabels: undefined },
      mainOpen: false,
      mainActiveTabId: null,
    },
  }),
  getVanillaBaseline: () => null,
  clearVanillaBaseline: () => {},
  restoreVanillaBaseline: async () => ({ ok: true }),
}))

mock.module('../../debug/styles', () => ({
  injectStyles: () => {},
}))

mock.module('../../tabs/configure-modal', () => ({
  isConfigureTabsModalOpen: () => false,
  flushConfigureCommits: async () => {},
  refreshConfigureDraftFromLive: () => {},
  getConfigureDraftRef: () => null,
  getConfigureBaseRef: () => null,
}))

mock.module('../../tabs/owned-commit', () => ({
  commitDraftToOwnedModel: async () => ({ ok: true }),
}))

// ── Dynamic imports (after mock.module calls) ──
const [{ requestSecondDrawerMode }] = await Promise.all([import('../second-drawer-mode')])
const [
  {
    getSettings,
    setLastLoadedLayout,
    getSingleLayoutSlot,
    setSingleLayoutSlot,
    getDualLayoutSlot,
    hydrateModeLayoutSlots,
  },
] = await Promise.all([import('../state')])
const [
  {
    bootstrap,
    shutdown,
    getModel,
    flush,
  },
] = await Promise.all([import('../../recon/dispatch')])
const [{ FakeHost }] = await Promise.all([import('../../host/fake/implementation')])
const [{ builtinKey, createEmptyModel }] = await Promise.all([import('../../core/model')])
const [{ buildModelFromLayout }] = await Promise.all([import('../../persist/layout-model')])
const [
  { armLayoutRepo, __resetLayoutRepoForTest, setLayoutRepoBackendCtx, bindLayoutSaveResultBridge },
] = await Promise.all([import('../../persist/layout-repo')])

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ── Custom assertion harness (repo convention) ──
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

const PROFILE = builtinKey('profile')
const REGEX = builtinKey('regex')
const LOOM = builtinKey('loom')

const makeHost = () => new FakeHost([
  { key: PROFILE, liveId: 'h:profile', location: 'primary', hidden: false, activeInPrimary: true, activeInSecondary: false, hasContentRoot: true, isBuiltin: true },
  { key: REGEX, liveId: 'h:regex', location: 'primary', hidden: false, activeInPrimary: false, activeInSecondary: false, hasContentRoot: true, isBuiltin: true },
  { key: LOOM, liveId: 'h:loom', location: 'primary', hidden: false, activeInPrimary: false, activeInSecondary: false, hasContentRoot: true, isBuiltin: true },
])

// Recording backend captures the persisted blob (which embeds the slots).
const writes: any[] = []
const backendHandlers = new Set<(payload: unknown) => void>()
const backend = {
  sendToBackend(message: { type: string; [key: string]: unknown }) {
    if (message.type === 'SAVE_LAYOUT') {
      writes.push(message.layout)
      // Ack so the fire-and-forget save promises resolve (no 5s timeouts).
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

// ══ Phase 1: disable (dual → single) ══
const host1 = makeHost()
shutdown()
bootstrap({
  ...createEmptyModel(),
  primary: [PROFILE, REGEX],
  secondary: [LOOM],
  active: { primary: PROFILE, secondary: LOOM },
}, host1, 'test-version')

// Provide the single-drawer layout that disable must restore (in production
// this is the persisted singleLayout slot or the vanilla baseline).
setSingleLayoutSlot({
  version: 'test-version',
  primary: { open: false, width: 420, tabId: 'h:profile' },
  secondary: { open: false, width: 420, activeTabId: null },
  detachedTabs: [],
  tabOrder: ['h:profile', 'h:regex', 'h:loom'],
  hiddenTabIds: [],
  drawerSide: 'left',
})

writes.length = 0
await requestSecondDrawerMode(false)
await flush()
await sleep(10)

const dualSlot = getDualLayoutSlot()
assert(dualSlot != null, 'disable saves a dual layout slot')
assert(Array.isArray(dualSlot?.detachedTabs) && dualSlot.detachedTabs.length === 1, 'dual slot has 1 detached tab')
assertEqual(dualSlot.detachedTabs[0].tabId, 'h:loom', 'dual slot stores the LIVE id (not builtin:loom) — poison fix')

let model = getModel()
assert(model != null, 'model present after disable')
assert(model!.secondary.length === 0, 'model secondary emptied on disable (single layout restored)')
assert(model!.primary.includes(LOOM), 'loom back in primary after disable (single layout restored)')

// The persisted blob after disable = single active layout + both slots.
const singleBlob = writes[writes.length - 1]
assert(singleBlob != null, 'a layout blob was persisted during disable')
assert(singleBlob.dualLayout != null, 'persisted blob embeds the dualLayout slot on disable')
assert(singleBlob.singleLayout != null, 'persisted blob embeds the singleLayout slot on disable')

// ══ Phase 2: reload while single — hydrate slots from the blob, boot the
// single (active) layout into a fresh owned model ══
shutdown()
const host2 = makeHost()
setLastLoadedLayout(singleBlob)
hydrateModeLayoutSlots(singleBlob)
const freshSingle = buildModelFromLayout(singleBlob, (id: string) => host2.findKey(id))
assert(freshSingle.secondary.length === 0, 'reload while single boots a single model')
bootstrap(freshSingle, host2, 'test-version')
await flush()
await sleep(10)
model = getModel()
assert(model != null && model!.secondary.length === 0, 'fresh single model is single')
assert(getSettings().secondSidebarEnabled === false, 'settings say drawer disabled after reload')

// ══ Phase 3: enable (single → dual) from the hydrated dualLayout slot ══
writes.length = 0
await requestSecondDrawerMode(true)
await flush()
await sleep(10)

model = getModel()
assert(model != null, 'model present after enable')
assert(model!.secondary.length === 1, 'model secondary restored on enable')
assert(model!.secondary.includes(LOOM), 'loom back in secondary on enable (dual layout restored)')
assert(!model!.primary.includes(LOOM), 'loom out of primary on enable')

const singleSlot = getSingleLayoutSlot()
assert(singleSlot != null, 'single layout slot preserved on enable')
assertEqual(singleSlot.primary.tabId, 'h:profile', 'single slot still the single layout (not overwritten by dual)')

// ── Persisted blob after enable embeds both mode profiles ──
const blob = writes[writes.length - 1]
assert(blob != null, 'a layout blob was persisted on enable')
assert(blob?.dualLayout != null, 'persisted blob embeds the dualLayout slot on enable')
assert(blob?.singleLayout != null, 'persisted blob embeds the singleLayout slot on enable')
assert(Array.isArray(blob?.dualLayout?.detachedTabs) && blob.dualLayout.detachedTabs.length === 1, 'persisted dualLayout carries the detached tabs')
assertEqual(blob?.dualLayout?.detachedTabs[0]?.tabId, 'h:loom', 'persisted dualLayout detached tabs are live ids')

// ── Summary ──
console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
if (failed > 0) process.exit(1)
