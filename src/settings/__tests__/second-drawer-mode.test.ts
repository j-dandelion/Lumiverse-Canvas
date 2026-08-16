// Regression: "Enable second drawer" toggled on from Configure Tabs must
// persist across a hard refresh.
//
// requestSecondDrawerMode(true) cancels the debounced settings save armed by
// setSettings (so the mid-restore empty layout never reaches the snapshot),
// but it MUST re-arm the save after the restore — layout.json carries no
// settings, so without the re-arm the enable only lives in memory and
// reverts on reload. This test drives the real enable path with mocked
// DOM-heavy deps and asserts the settings save actually reaches the backend.

;(globalThis as any).document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({}),
  documentElement: {
    classList: { add() {}, remove() {}, contains() { return false } },
    style: { setProperty() {}, removeProperty() {}, getPropertyValue() { return '' } },
  },
  body: { appendChild() {}, removeChild() {} },
}
;(globalThis as any).requestAnimationFrame = (cb: any) => { cb(1); return 1 }
;(globalThis as any).cancelAnimationFrame = () => {}
;(globalThis as any).CSS = { escape: (s: string) => s }
;(globalThis as any).getComputedStyle = () => ({})

import { mock } from 'bun:test'

// ── Mock transitive deps of settings/second-drawer-mode.ts ──
// (real modules: settings/state, persist/layout-load, persist/settings-repo,
//  persist/backend-ctx, debug/persist-debug)

const calls = {
  bootstrapFromLayout: 0,
  restoreFromProfile: 0,
}

// features/registry: mock to empty so setSettings → applySettings iterates
// nothing (no React / secondary.tsx mount) — same as tab-context-menu.test.ts.
mock.module('../../features/registry', () => ({
  FEATURES: [],
}))

mock.module('../../debug/log', () => ({
  dlog: () => {},
  dwarn: () => {},
  setDebug: () => {},
}))

// layout/snapshot: buildPersistedLayout is called by the settings debounce
// (via state.ts) — mock it so no DOM snapshot is taken headless.
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

mock.module('../../layout/dual-session-profile', () => ({
  captureSessionDualProfileFromLive: () => ({ detachedTabs: [], activeTabId: null }),
  getSessionDualProfile: () => null,
  clearSessionDualProfile: () => {},
  restoreSessionDualProfile: async () => { calls.restoreFromProfile++ },
}))

mock.module('../../recon/dispatch', () => ({
  bootstrapFromLayout: () => { calls.bootstrapFromLayout++ },
  flush: async () => {},
  getHost: () => ({ resolve: (k: string) => k }),
  getModel: () => null,
  snapshotOwnedModelLayout: () => null,
  dispatch: async () => {},
  dispatchBatch: async () => {},
  dispatchMoveByLiveId: async () => {},
  placementFirstMoveByLiveId: async () => {},
  captureMainMirrorMoveChrome: async () => ({ neighborBtn: null, reassertId: null }),
  applyMainMirrorMoveChrome: async () => {},
  captureSecondaryNeighborForMove: async () => ({ neighborBtn: null }),
  applySecondaryNeighborHandoff: async () => {},
  shutdown: () => {},
  bootstrap: () => {},
}))

mock.module('../../tabs/owned-commit', () => ({
  commitDraftToOwnedModel: async () => ({ ok: true }),
}))

mock.module('../../sidebar/drawer-sync', () => ({
  resetSideRemountStateAfterDisable: () => {},
  isShowTabLabels: () => false,
  syncDrawerTabSettings: () => {},
  applyMainDrawerSideChange: async () => {},
  syncSecondaryTabLabels: () => {},
}))

mock.module('../../debug/styles', () => ({
  injectStyles: () => {},
}))

// Dynamic import in the enable path — modal not open → all no-ops.
mock.module('../../tabs/configure-modal', () => ({
  isConfigureTabsModalOpen: () => false,
  flushConfigureCommits: async () => {},
  refreshConfigureDraftFromLive: () => {},
  getConfigureDraftRef: () => null,
  getConfigureBaseRef: () => null,
}))

// ── Dynamic imports (must be AFTER mock.module calls) ──
const [{ requestSecondDrawerMode }] = await Promise.all([
  import('../second-drawer-mode'),
])
const [{ getSettings, setSettings, setDualLayoutSlot }] = await Promise.all([
  import('../state'),
])
const [
  { setSettingsRepoBackendCtx, armSettingsRepo, __resetSettingsRepoForTest, bindSettingsSaveResultBridge },
] = await Promise.all([
  import('../../persist/settings-repo'),
])

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

// ── Recording backend (acks saves like the real bridge so no timeouts) ──
const sent: Array<{ type: string; [key: string]: unknown }> = []
const backendHandlers = new Set<(payload: unknown) => void>()
const backendCtx = {
  sendToBackend: (msg: any) => {
    sent.push(msg)
    if (msg.type === 'SAVE_SETTINGS') {
      backendHandlers.forEach((h) =>
        h({ type: 'SAVE_SETTINGS_RESULT', saveId: msg.saveId, result: { status: 'ok' } }))
    }
  },
  onBackendMessage: (handler: (payload: unknown) => void) => {
    backendHandlers.add(handler)
    return () => backendHandlers.delete(handler)
  },
}

__resetSettingsRepoForTest()
setSettingsRepoBackendCtx(backendCtx)
armSettingsRepo()
bindSettingsSaveResultBridge()

// ── Scenario: re-enable from OFF with a persisted dual layout ──
// (the state finishDisable leaves on disk: the dualLayout slot)

// Start from OFF (default is ON). Drain the OFF save so it does not
// pollute later assertions.
setSettings({ secondSidebarEnabled: false })
await sleep(150)
sent.length = 0

// Seed the persisted dual layout (re-enable restore source — the slot, not
// lastLoaded; REFACTOR-PLAN v2 §4.6 retired lastLoaded's mode-restore role).
setDualLayoutSlot({
  version: 2,
  primary: { open: false, width: 420, tabId: null },
  secondary: { open: false, width: 420, activeTabId: 'builtin:loom' },
  detachedTabs: [{ tabId: 'builtin:loom', tabTitle: 'builtin:loom', sidebar: 'secondary' }],
  hiddenTabIds: [],
})

calls.bootstrapFromLayout = 0
await requestSecondDrawerMode(true)

assert(getSettings().secondSidebarEnabled === true, 'enable is live in memory')
assertEqual(calls.bootstrapFromLayout, 1, 'owned-model restore ran on enable')

// The re-armed debounced save fires ~100ms after the enable returns.
await sleep(250)

const settingsSaves = sent.filter((m) => m.type === 'SAVE_SETTINGS')
assert(settingsSaves.length >= 1, 'settings save reached the backend after enable')
assertEqual(
  ((settingsSaves[settingsSaves.length - 1].settings as any)?.settings as any)?.secondSidebarEnabled,
  true,
  'persisted settings carry secondSidebarEnabled: true',
)

// ── Disable path parity: disable must also persist (regression guard) ──
sent.length = 0
await requestSecondDrawerMode(false)
await sleep(250)

const disableSaves = sent.filter((m) => m.type === 'SAVE_SETTINGS')
assert(disableSaves.length >= 1, 'settings save reached the backend after disable')
assertEqual(
  ((disableSaves[disableSaves.length - 1].settings as any)?.settings as any)?.secondSidebarEnabled,
  false,
  'persisted settings carry secondSidebarEnabled: false',
)

// ── Summary ──
console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
if (failed > 0) process.exit(1)
