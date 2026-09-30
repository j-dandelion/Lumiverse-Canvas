// Enable-captures-single-slot (folding) — live-verify #2 (2026-09-10).
//
// Regression for: "open Configure Tabs, enable the Second drawer toggle, then
// disable it → layout resets to default (hidden tabs gone, side/order
// reverted). Hard-refresh fixes it."
//
// Root cause (two-writer story): on the OFF→ON path, the singleLayout slot
// was only captured when the owned model was single-shaped
// (`model.secondary.length === 0`). In the documented disable-fallback boot
// anomaly (`secondSidebarEnabled=false` but a dual-shaped model booted from a
// dual top-level blob), that guard SKIPPED the capture — so the stale slot on
// disk survived the whole session, and disable restored it wholesale: hidden
// wiped to 0, drawer side reverted, order reverted (the "default layout").
// Because that restore also left ids unresolved (pendingRetry), persistence
// was gated and disk kept the good blob — hence hard refresh healed the live
// view.
//
// Fix: enable ALWAYS captures the single slot as a single PROJECTION of the
// current model (all tabs folded into primary order, hidden preserved,
// live geometry/side) via serializeModelToSingleLayout — never a raw dual
// serialization, never a skip. The disable-time no-slot fallback also prefers
// the model fold over the host-DOM walk (host truth lost Canvas hidden when
// hidden-tabs write-back was deleted).
//
// This test drives the REAL second-drawer-mode toggle API through the REAL
// recon/dispatch pipeline with a FakeHost, asserting:
//   - enable (with a dual-shaped model while the drawer is off — the
//     anomaly state) RE-CAPTURES the single slot as a fold: no detachedTabs,
//     all live ids in tabOrder, hidden preserved, model side;
//   - the subsequent disable restores hidden (the old bug lost it) and folds
//     the model back to single;
//   - the dual slot survives the round trip uncorrupted.

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
//    recon/dispatch, core, host/fake, persist/layout-model, layout/mode-profiles) ──

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

mock.module('../../debug/styles', () => ({
  injectStyles: () => {},
}))

mock.module('../../tabs/configure-modal', () => ({
  isConfigureTabsModalOpen: () => true,
  flushConfigureCommits: async () => {},
  // Pin live-verify #3: the modal refresh must not run mid-placement — the
  // mode toggle awaits the boot placement pass BEFORE refreshing, so at
  // refresh time the restored dual state is already settled in the model.
  refreshConfigureDraftFromLive: () => {
    const m = modelGetter()
    if (m) {
      lastRefreshPrimary = [...m.primary]
      lastRefreshSecondary = [...m.secondary]
    }
  },
  getConfigureDraftRef: () => null,
  getConfigureBaseRef: () => null,
}))

let modelGetter: () => any = () => null
let lastRefreshPrimary: string[] | null = null
let lastRefreshSecondary: string[] | null = null

mock.module('../../tabs/owned-commit', () => ({
  commitDraftToOwnedModel: async () => ({ ok: true }),
}))

// ── Reveal-hold ordering spies (live-verify #4) ──
// The enable path must hold the visual guard before setSettings/restore, wait
// for the placement pass + content settle, then release — so the drawers
// reveal once, settled. Partial mock (spread the real module) keeps every
// unmocked main-persist export working for mode-profiles/dispatch.
const realMainPersist = await import('../../sidebar/main-persist')
const mpEvents: string[] = []
mock.module('../../sidebar/main-persist', () => ({
  ...realMainPersist,
  holdMainDrawerReveal: () => { mpEvents.push('hold') },
  releaseMainDrawerReveal: () => { mpEvents.push('release') },
  waitForMainContentSettled: async () => { mpEvents.push('settle') },
}))

// ── Dynamic imports (after mock.module calls) ──
const [{ requestSecondDrawerMode }] = await Promise.all([import('../second-drawer-mode')])
const [
  {
    getSettings,
    setSettings,
    getSingleLayoutSlot,
    setSingleLayoutSlot,
    getDualLayoutSlot,
    setDualLayoutSlot,
  },
] = await Promise.all([import('../state')])
const [{ getModel, bootstrap, flush }] = await Promise.all([import('../../recon/dispatch')])
modelGetter = getModel
const [{ FakeHost }] = await Promise.all([import('../../host/fake/implementation')])
const [{ builtinKey, createEmptyModel }] = await Promise.all([import('../../core/model')])

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

// ══ The disable-fallback boot anomaly: secondSidebarEnabled=false (the
// production repro state) but a dual-shaped model was booted (dual top-level
// blob on disk). ══
const host = makeHost()
bootstrap({
  ...createEmptyModel(),
  primary: [PROFILE, REGEX],
  secondary: [LOOM],
  hidden: [REGEX],
  active: { primary: PROFILE, secondary: LOOM },
}, host, 'test-version')
await flush()
await sleep(10)

// Seed the disabled setting: the settings default is ON, but the live-verify
// #2 repro starts with the second drawer OFF (secondSidebarEnabled=false).
setSettings({ secondSidebarEnabled: false })
assertEqual(getSettings().secondSidebarEnabled, false, 'start state: secondSidebarEnabled=false')

// A STALE single slot, as found in the wild (pre-hidden-tabs era: no hidden,
// old order, old side). Enable must overwrite it with a fresh capture.
setSingleLayoutSlot({
  version: 'test-version',
  primary: { open: false, width: 420, tabId: 'h:profile' },
  secondary: { open: false, width: 420, activeTabId: null },
  detachedTabs: [],
  tabOrder: ['h:profile', 'h:loom'],
  hiddenTabIds: [],
  drawerSide: 'left',
})

// Also seed expectations of the dual path: enable restores the dual layout.
setDualLayoutSlot({
  version: 'test-version',
  primary: { open: false, width: 420, tabId: 'h:profile' },
  secondary: { open: false, width: 420, activeTabId: 'h:loom' },
  detachedTabs: [{ tabId: 'h:loom', tabTitle: 'ext:loom', sidebar: 'secondary' }],
  tabOrder: ['h:profile', 'h:regex', 'h:loom'],
  hiddenTabIds: ['h:regex'],
  drawerSide: 'left',
})

// ══ Phase 1: enable (OFF → ON). With the OLD guard (model.secondary>0)
// the single-slot capture was SKIPPED and the stale slot never refreshed. ══
await requestSecondDrawerMode(true)
await flush()
await sleep(10)

const freshSlot = getSingleLayoutSlot()
assert(freshSlot != null, 'enable captures a single layout slot even with a dual-shaped model')
assert(freshSlot != null && (freshSlot.detachedTabs == null || freshSlot.detachedTabs.length === 0),
  'captured single slot has NO detachedTabs (folded, not a dual serialization)')
assert(
  freshSlot != null && Array.isArray(freshSlot.tabOrder) &&
  freshSlot.tabOrder.includes('h:profile') && freshSlot.tabOrder.includes('h:regex') && freshSlot.tabOrder.includes('h:loom'),
  'captured single slot folds ALL tabs (primary then secondary) into tabOrder as live ids',
)
assert(
  freshSlot != null && Array.isArray(freshSlot.hiddenTabIds) && freshSlot.hiddenTabIds.includes('h:regex'),
  'captured single slot PRESERVES the hidden set (the live bug lost it)',
)

const modelAfterEnable = getModel()
assert(modelAfterEnable != null, 'model present after enable')
assert(modelAfterEnable != null && modelAfterEnable!.secondary.includes(LOOM),
  'enable restores the dual layout (secondary tab back in the model)')

// The modal refresh captured the FULL settled dual model — not a
// mid-placement state that disagrees with the final order/secondary.
assert(lastRefreshPrimary != null, 'Configure modal refresh ran during enable')

assert(
  lastRefreshPrimary != null && lastRefreshSecondary != null &&
  lastRefreshSecondary!.length === 1 && lastRefreshSecondary!.includes(LOOM) &&
  lastRefreshPrimary!.includes(PROFILE) && lastRefreshPrimary!.includes(REGEX),
  'modal refresh saw the SETTLED dual model (full placement state, not mid-flight)',
)

// Reveal-hold ordering (live-verify #4): held first, settled after the pass,
// released last — and released by the time enable resolves (modal refresh is
// now post-release).
assertEqual(mpEvents.join(','), 'hold,settle,release',
  'enable: hold → settle → release exactly once, in order')

// ══ Phase 2: disable (ON → OFF). The restore must use the FRESH folded slot,
// not the stale capture planted above — hidden must survive. ══
await requestSecondDrawerMode(false)
await flush()
await sleep(10)

const modelAfterDisable = getModel()
assert(modelAfterDisable != null, 'model present after disable')
assert(modelAfterDisable != null && modelAfterDisable!.secondary.length === 0,
  'disable empties model secondary (single layout restored)')
assert(modelAfterDisable != null && modelAfterDisable!.primary.includes(LOOM),
  'disable folds the secondary tab back into primary')
assert(modelAfterDisable != null && modelAfterDisable!.hidden.includes(REGEX),
  'disable DOES NOT wipe hidden tabs (the live-verify #2 regression: hidden was lost)')

const singleAfter = getSingleLayoutSlot()
assert(singleAfter != null && Array.isArray(singleAfter.hiddenTabIds) && singleAfter.hiddenTabIds.includes('h:regex'),
  'single slot still carries the hidden set after the round trip')
assertEqual((singleAfter?.tabOrder ?? []).length, 3, 'single slot kept all three tabs')

// Dual slot survives the disable intact (each mode keeps its own layout).
const dualAfter = getDualLayoutSlot()
assert(dualAfter != null && Array.isArray(dualAfter.detachedTabs) && dualAfter.detachedTabs.length === 1,
  'dual slot intact after disable (mode layouts both survive)')

// ── Summary ──
console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
if (failed > 0) process.exit(1)
