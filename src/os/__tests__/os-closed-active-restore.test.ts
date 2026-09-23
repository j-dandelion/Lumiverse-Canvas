// A2-6: closed-active staleness through the REAL OS-enable path.
//
// A slot whose `primary.tabId` sits inside `closedTabIds` must restore with
// an NULL active tab (plan contract R1-8 / closed-active fix in
// mode-profiles) — never a fallback pick that would open a window the model
// calls closed (D17 split). This suite drives applyOsModeChange(enable) with
// the REAL mode-profiles + REAL dispatch pipeline (FakeHost), spying on
// restoreMainDrawerFromDom via a partial main-persist mock.

// Custom assertion harness — see Chronicle testing-conventions.md
let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else {
    console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    failed++
  }
}

import { mock } from 'bun:test'

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
  addEventListener() {},
  removeEventListener() {},
}
;(globalThis as any).requestAnimationFrame = (cb: any) => { cb(1); return 1 }
;(globalThis as any).cancelAnimationFrame = () => {}
;(globalThis as any).CSS = { escape: (s: string) => s }
;(globalThis as any).getComputedStyle = () => ({})

// Desktop viewport: A2-6 is about the closed-active restore, not the
// mobile-first slot choice.
;(globalThis as { window?: unknown }).window = {
  matchMedia: () => ({ matches: false }),
}

// ── Mocks (real: settings/state, recon/dispatch, core, host/fake,
//    persist/layout-model, layout/mode-profiles, os/os-mode) ──

mock.module('../../features/registry', () => ({
  FEATURES: [],
}))
mock.module('../../debug/log', () => ({
  dlog: () => {},
  dwarn: () => {},
  setDebug: () => {},
}))
mock.module('../../debug/styles', () => ({
  injectStyles: () => {},
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

// Partial main-persist mock: spy the restore entry + neutralize the reveal
// hold tail (spread real keeps every other export linked for
// mode-profiles/dispatch).
const realMainPersist = await import('../../sidebar/main-persist')
type RestoreArgs = [open: boolean, tabId: string | null, width?: number, opts?: unknown]
const restoreCalls: RestoreArgs[] = []
mock.module('../../sidebar/main-persist', () => ({
  ...realMainPersist,
  restoreMainDrawerFromDom: (
    open: boolean,
    tabId: string | null,
    width?: number,
    opts?: unknown,
  ) => {
    restoreCalls.push([open, tabId, width, opts])
  },
  holdMainDrawerReveal: () => {},
  releaseMainDrawerReveal: () => {},
  waitForMainContentSettled: async () => {},
}))

// ── Real modules ──
const { applyOsModeChange } = await import('../os-mode')
const { setSettings, setOsSingleLayoutSlot } = await import('../../settings/state')
const { bootstrap, shutdown, getModel, flush } = await import('../../recon/dispatch')
const { FakeHost } = await import('../../host/fake/implementation')
const { builtinKey, createEmptyModel } = await import('../../core/model')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const LOOM = builtinKey('loom')
const makeHost = () => new FakeHost([
  {
    key: LOOM,
    liveId: 'h:loom',
    location: 'primary',
    hidden: false,
    activeInPrimary: true,
    activeInSecondary: false,
    hasContentRoot: true,
    isBuiltin: true,
  },
])

// ── A2-6: pre-existing osSingle carries a closed active ──
{
  const host = makeHost()
  shutdown()
  bootstrap({
    ...createEmptyModel(),
    primary: [LOOM],
    secondary: [],
    active: { primary: LOOM, secondary: null },
  }, host, 'test-version')
  await flush()
  await sleep(10)

  // Saved active `h:loom` is listed as closed — stale (R1-8).
  setOsSingleLayoutSlot({
    version: 'test-version',
    primary: { open: true, width: 420, tabId: 'h:loom' },
    secondary: { open: false, width: 420, activeTabId: undefined },
    detachedTabs: [],
    tabOrder: ['h:loom'],
    hiddenTabIds: [],
    closedTabIds: ['h:loom'],
    drawerSide: 'left',
  } as any)
  setSettings({ osMode: true, persistDrawerWidth: true })

  restoreCalls.length = 0
  await applyOsModeChange({ osMode: false }, { osMode: true })
  await flush()
  await sleep(10)

  assert(restoreCalls.length >= 1, 'A2-6: enable restored the pre-existing osSingle slot')
  const [open, tabId] = restoreCalls[0]
  assertEqual(open, true, 'A2-6: drawer restores OPEN from the slot')
  assertEqual(
    tabId,
    null,
    'A2-6: closed-active is stale → restoreMainDrawerFromDom receives a NULL tab',
  )
  const model = getModel()
  assert(model != null, 'A2-6: model present after the restore')
}

console.log('---')
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
