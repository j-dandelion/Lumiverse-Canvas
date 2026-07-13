// Tests for second-drawer-mode enable path.
//
// Verifies the re-enable sequence:
//   A. Facet ON: refreshConfigureDraftFromLive runs ONLY after applyLayout resolves.
//   B. Facet ON: applyLayout is called with the lastLoaded layout (containing tabs).
//   C. Non-empty lastLoaded → applyLayout called (tab-assignment persistence is
//      always-on, so the facet-ON path is always taken).
//   D. Empty lastLoaded + non-empty session profile → fallback before refresh.
//   E. applyLayout rejects → still completes, modal still refreshes.
//
// Tab-assignment persistence is always-on (built-in). The
// persistTabAssignments setting was removed, so the enable path always
// uses the facet-ON logic (no OFF branch).
//
// Strategy:
// - Don't mock `../state` or `../layout/dual-session-profile` (they are
//   process-globally leaked by bun's mock.module; persist.test.ts and
//   dual-session-profile.test.ts rely on the real modules).
// - For each case, re-mock `../../layout/apply` with a case-specific
//   `applyLayout` function. This keeps the spy observable while avoiding
//   stale closures across cases. `mock.module` is process-global but
//   we re-issue it for each case to control behavior.

import { mock } from 'bun:test'

// configure-modal mock (process-global; one factory is enough)
const isConfigureTabsModalOpenSpy = mock(() => false)
const refreshConfigureDraftFromLiveSpy = mock(() => {})
mock.module('../../tabs/configure-modal', () => ({
  isConfigureTabsModalOpen: isConfigureTabsModalOpenSpy,
  refreshConfigureDraftFromLive: refreshConfigureDraftFromLiveSpy,
  getConfigureDraftRef: () => null,
  getConfigureBaseRef: () => null,
  openConfigureTabsModal: () => {},
  closeConfigureTabsModal: () => true,
  forceUnmountConfigureTabsModal: () => {},
}))

// debug/styles, debug/log, features/registry — no-ops
mock.module('../../debug/styles', () => ({
  injectStyles: (_id: string, _css: string) => {},
}))
mock.module('../../debug/log', () => ({
  dlog: () => {},
  dwarn: () => {},
  setDebug: (_v: boolean) => {},
}))
mock.module('../../features/registry', () => ({
  FEATURES: [],
}))

// DOM seam: return null for all Lumiverse queries so the real
// vanilla-baseline can run in headless bun without throwing on
// `document.querySelector`. Cases A-E call captureVanillaBaseline via
// the SUT; with this mock in place, getMainDrawerSide falls through to
// the store (also empty) and returns 'right', and isMainDrawerOpen /
// getActiveTabId return safe defaults. The vanilla-baseline.test.ts
// file registers its own dom/lumiverse mock which overrides this one
// (mock.module is process-global; latest call wins).
mock.module('../../dom/lumiverse', () => ({
  getMainSidebar: () => null,
  getMainWrapper: () => null,
  getMainDrawer: () => null,
  getMainPanelContent: () => null,
  getMainPanel: () => null,
  getMainPanelHeader: () => null,
  getChatColumn: () => null,
  getMainDrawerWidth: () => 420,
}))

// host-settings seam: control isHostDrawerSettingsWritable and
// patchHostDrawerSettings so cases G/H can drive the real vanilla-
// baseline's restore to success or NO-GO without depending on its
// internals. Default = writable + succeeds; cases override per-test.
let _hostWritable = true
let _hostPatchOk = true
mock.module('../../dom/host-settings', () => ({
  getHostDrawerSettings: () => null,
  isHostDrawerSettingsWritable: () => _hostWritable,
  patchHostDrawerSettings: (_partial: any) => _hostPatchOk,
  __setHostSetSettingForTest: () => {},
  clearHostSettingsCache: () => {},
  HostDrawerSettings: undefined as any,
}))

// main-persist seam: restoreMainDrawerFromDom is a no-op so the real
// vanilla-baseline's restore path completes synchronously in tests.
mock.module('../../sidebar/main-persist', () => ({
  restoreMainDrawerFromDom: () => {},
  unsuppressMainDrawer: () => {},
  stampPanelBodyHide: () => {},
  startMainDrawerPersistence: () => {},
  stopMainDrawerPersistence: () => {},
}))

// vanilla-baseline is NOT mocked. The SUT uses the real module; cases
// F-I inspect the in-memory baseline (set by captureVanillaBaseline in
// the SUT) via the real getVanillaBaseline / clearVanillaBaseline.
// Cases G/H control the restore outcome by flipping _hostPatchOk /
// _hostWritable on the host-settings mock above.

// Import the SUT, the real state module, and the real session-profile module.
import { requestSecondDrawerMode } from '../second-drawer-mode'
import {
  getSettings,
  setLastLoadedLayout,
  hydrateSettings,
  resetHydrationGuard,
} from '../state'
import {
  setSessionDualProfile,
  clearSessionDualProfile,
} from '../../layout/dual-session-profile'
import {
  getVanillaBaseline,
  clearVanillaBaseline,
} from '../../layout/vanilla-baseline'

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed++ }
}

/** Per-case observable state for the applyLayout mock. */
let applyLayoutArgs: any[] = []
let applyLayoutCallCount = 0

/** Reset all spies and state between cases. */
function resetSpies() {
  applyLayoutArgs = []
  applyLayoutCallCount = 0
  isConfigureTabsModalOpenSpy.mockClear()
  refreshConfigureDraftFromLiveSpy.mockClear()
  clearSessionDualProfile()
  // Reset real state to defaults so the next test file starts clean.
  resetHydrationGuard()
  hydrateSettings(null)
  setLastLoadedLayout(null)
}

/** Seed state for a case. Uses hydrateSettings which only writes when the
 *  user-touched guard is false — we reset the guard first.
 *  persistTabAssignments is omitted because tab-assignment persistence is
 *  always-on (built-in). */
function seedState(patch: {
  secondSidebarEnabled?: boolean
}) {
  resetHydrationGuard()
  hydrateSettings({
    secondSidebarEnabled: patch.secondSidebarEnabled ?? false,
  })
}

/** Re-mock layout/apply with a case-specific applyLayout. */
function mockApplyLayout(fn: (layout: any) => Promise<void>) {
  mock.module('../../layout/apply', () => ({
    applyLayout: (layout: any) => {
      applyLayoutArgs.push(layout)
      applyLayoutCallCount++
      return fn(layout)
    },
    isLayoutRestoreActive: () => false,
    cancelApplyLayoutInterval: () => {},
    setRestoreTimeoutMs: (_ms: number) => {},
  }))
}

/** Create a deferred promise with a `resolve` function exposed. The
 *  single-cell array pattern works around TS strict-narrowing issues
 *  when the resolve is captured inside a Promise constructor closure. */
function makeDeferred(): { promise: Promise<void>; resolve: () => void } {
  const cell: { fn?: () => void } = {}
  const promise = new Promise<void>((resolve) => { cell.fn = resolve })
  return { promise, resolve: () => { if (cell.fn) cell.fn() } }
}

// =====================================================================
// A. Facet ON: refresh runs ONLY after applyLayout resolves
// =====================================================================
{
  resetSpies()
  seedState({ secondSidebarEnabled: false })
  setLastLoadedLayout({
    primary: { open: false, width: 420, tabId: null },
    secondary: { activeTabId: 'tab-1', open: false, width: 420 },
    detachedTabs: [
      { tabId: 'tab-1', tabTitle: 'Tab 1', sidebar: 'secondary' },
      { tabId: 'tab-2', tabTitle: 'Tab 2', sidebar: 'secondary' },
    ],
  })
  isConfigureTabsModalOpenSpy.mockReturnValue(true)

  // Make applyLayout defer its resolve until we say so.
  const deferred = makeDeferred()
  mockApplyLayout(() => deferred.promise)

  // Start the enable — do NOT await yet.
  const pending = requestSecondDrawerMode(true)

  // Yield a few microtasks so setSettings runs and the code reaches
  // applyLayout. The production code should NOT have refreshed the
  // modal yet because applyLayout hasn't resolved.
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()

  assert(applyLayoutCallCount === 1, 'A: applyLayout called exactly once on enable')
  assert(refreshConfigureDraftFromLiveSpy.mock.calls.length === 0,
    'A: refresh NOT called before applyLayout resolves')
  assert(getSettings().secondSidebarEnabled === true, 'A: setSettings flipped secondSidebarEnabled to true')

  // Now release applyLayout and let the await chain complete.
  deferred.resolve()
  await pending

  assert(refreshConfigureDraftFromLiveSpy.mock.calls.length === 1,
    'A: refresh called exactly once AFTER applyLayout resolves')
}

// =====================================================================
// B. applyLayout is called with the lastLoaded layout
// =====================================================================
{
  resetSpies()
  seedState({ secondSidebarEnabled: false })
  const savedLayout = {
    primary: { open: false, width: 420, tabId: null },
    secondary: { activeTabId: 'tab-x', open: false, width: 420 },
    detachedTabs: [
      { tabId: 'tab-x', tabTitle: 'Tab X', sidebar: 'secondary' },
    ],
  }
  setLastLoadedLayout(savedLayout)
  isConfigureTabsModalOpenSpy.mockReturnValue(false) // modal closed path
  mockApplyLayout(async () => { /* resolves cleanly */ })

  await requestSecondDrawerMode(true)

  assertEqual(applyLayoutCallCount, 1, 'B: applyLayout called once')
  assert(applyLayoutArgs[0] === savedLayout, 'B: applyLayout called with the exact lastLoaded layout')
  assert(refreshConfigureDraftFromLiveSpy.mock.calls.length === 0,
    'B: refresh NOT called when modal closed')
}

// =====================================================================
// C. Non-empty lastLoaded → applyLayout called (always-on tabs facet)
// =====================================================================
// Tab-assignment persistence is always-on, so the facet-ON path is always
// taken. Non-empty lastLoaded with detachedTabs should result in applyLayout
// being called (inverted from the old test which expected NO call when
// the facet was OFF).
{
  resetSpies()
  seedState({ secondSidebarEnabled: false })
  setLastLoadedLayout({
    primary: { open: false, width: 420, tabId: null },
    secondary: { activeTabId: 'tab-y', open: false, width: 420 },
    detachedTabs: [
      { tabId: 'tab-y', tabTitle: 'Tab Y', sidebar: 'secondary' },
    ],
  })
  isConfigureTabsModalOpenSpy.mockReturnValue(false)
  clearSessionDualProfile()
  // applyLayout SHOULD be called: tabs persistence is always-on.
  let wasCalled = false
  mockApplyLayout(async () => {
    wasCalled = true
  })

  await requestSecondDrawerMode(true)

  assert(wasCalled, 'C: applyLayout IS called when lastLoaded has tabs (always-on tabs facet)')
  assertEqual(getSettings().secondSidebarEnabled, true, 'C: still flips secondSidebarEnabled to true')
}

// =====================================================================
// D. Empty lastLoaded + non-empty session profile → fallback
// =====================================================================
{
  resetSpies()
  seedState({ secondSidebarEnabled: false })
  setLastLoadedLayout({
    primary: { open: false, width: 420, tabId: null },
    secondary: { activeTabId: null, open: false, width: 420 },
    detachedTabs: [], // empty → must fall back to session profile
  })
  isConfigureTabsModalOpenSpy.mockReturnValue(true)
  setSessionDualProfile({
    detachedTabs: [
      { tabId: 'sess-tab', tabTitle: 'Sess Tab', sidebar: 'secondary' },
    ],
    activeTabId: 'sess-tab',
  })
  // applyLayout should NOT be called when lastLoaded has no tabs; session
  // profile fallback runs instead.
  mockApplyLayout(async () => {
    throw new Error('D: applyLayout should NOT be called when lastLoaded has no tabs')
  })

  await requestSecondDrawerMode(true)

  assertEqual(applyLayoutCallCount, 0, 'D: applyLayout NOT called when lastLoaded has no tabs')
  assertEqual(getSettings().secondSidebarEnabled, true, 'D: setting still flipped to true')
  assertEqual(refreshConfigureDraftFromLiveSpy.mock.calls.length, 1,
    'D: refresh called AFTER session profile fallback')

  clearSessionDualProfile()
}

// =====================================================================
// E. applyLayout rejects → still completes, modal still refreshes
// =====================================================================
{
  resetSpies()
  seedState({ secondSidebarEnabled: false })
  setLastLoadedLayout({
    primary: { open: false, width: 420, tabId: null },
    secondary: { activeTabId: 'tab-z', open: false, width: 420 },
    detachedTabs: [
      { tabId: 'tab-z', tabTitle: 'Tab Z', sidebar: 'secondary' },
    ],
  })
  isConfigureTabsModalOpenSpy.mockReturnValue(true)
  // Build a rejected promise with a pre-attached .then(_, noop) handler.
  // The SUT's `await` will register another handler, so the rejection is
  // doubly-handled. This avoids the "unhandled rejection" noise bun
  // emits between test files.
  mockApplyLayout(() => {
    const rejected = Promise.reject(new Error('applyLayout boom'))
    // Pre-handle so the unhandledRejection event is suppressed.
    rejected.then(
      () => {},
      () => {},
    )
    return rejected
  })

  await requestSecondDrawerMode(true)

  assertEqual(applyLayoutCallCount, 1, 'E: applyLayout was called once before rejecting')
  assertEqual(getSettings().secondSidebarEnabled, true, 'E: setting still flipped to true despite failure')
  assertEqual(refreshConfigureDraftFromLiveSpy.mock.calls.length, 1,
    'E: refresh called once after applyLayout rejects (graceful completion)')
}

// =====================================================================
// F. Vanilla baseline: enable captures pre-dual host state once
// =====================================================================
// Strategy: the SUT calls the real captureVanillaBaseline. After the
// enable call, the in-memory baseline should be non-null. We inspect
// it via the real getVanillaBaseline (imported above).
{
  const sut = await import('../second-drawer-mode')
  resetSpies()
  seedState({ secondSidebarEnabled: false })
  isConfigureTabsModalOpenSpy.mockReturnValue(false)
  mockApplyLayout(async () => { throw new Error('F: applyLayout should not be called (no profile, no lastLoaded)') })
  clearSessionDualProfile()
  clearVanillaBaseline()
  assert(getVanillaBaseline() === null, 'F: no baseline before enable')

  await sut.requestSecondDrawerMode(true)

  assert(getVanillaBaseline() !== null, 'F: captureVanillaBaseline ran on enable (baseline present)')
}

// =====================================================================
// G. Vanilla baseline: disable restores + clears on success
// =====================================================================
// Strategy: seed an in-memory baseline, flip host-settings to success
// (default), call disable, expect baseline cleared by the SUT after
// the successful restore.
{
  const sut = await import('../second-drawer-mode')
  resetSpies()
  resetHydrationGuard()
  hydrateSettings({ secondSidebarEnabled: true })
  isConfigureTabsModalOpenSpy.mockReturnValue(false)
  _hostWritable = true
  _hostPatchOk = true

  // Seed a baseline so getVanillaBaseline returns one during disable.
  // We re-use captureVanillaBaseline (real) to populate the in-memory
  // state — the dom/lumiverse mock makes it return a default snapshot.
  clearVanillaBaseline()
  // Trigger a capture via the real SUT enable path so the baseline
  // exists. Use a throwaway secondSidebarEnabled=true to avoid
  // affecting later cases.
  resetHydrationGuard()
  hydrateSettings({ secondSidebarEnabled: false })
  await sut.requestSecondDrawerMode(true)
  assert(getVanillaBaseline() !== null, 'G: baseline captured for the test')

  // Now flip to off and run disable. host-settings mock is success.
  resetHydrationGuard()
  hydrateSettings({ secondSidebarEnabled: true })
  await sut.requestSecondDrawerMode(false)

  assert(getVanillaBaseline() === null,
    'G: clearVanillaBaseline called after successful restore (baseline cleared)')
}

// =====================================================================
// H. Vanilla baseline: disable retains baseline on failure (NO-GO)
// =====================================================================
// Strategy: seed a baseline, flip host-settings to NO-GO, call
// disable, expect baseline retained for retry.
{
  const sut = await import('../second-drawer-mode')
  resetSpies()
  resetHydrationGuard()
  hydrateSettings({ secondSidebarEnabled: true })
  isConfigureTabsModalOpenSpy.mockReturnValue(false)
  _hostWritable = false // NO-GO: patchHostDrawerSettings returns false

  // Capture a baseline via the real SUT enable path.
  clearVanillaBaseline()
  resetHydrationGuard()
  hydrateSettings({ secondSidebarEnabled: false })
  await sut.requestSecondDrawerMode(true)
  assert(getVanillaBaseline() !== null, 'H: baseline captured for the test')

  // Now disable with host-settings NO-GO. The restore returns
  // { ok: false, reason: 'no-go' } and the SUT must NOT clear.
  resetHydrationGuard()
  hydrateSettings({ secondSidebarEnabled: true })
  await sut.requestSecondDrawerMode(false)

  assert(getVanillaBaseline() !== null,
    'H: clearVanillaBaseline NOT called on failure (baseline retained for retry)')
}

// =====================================================================
// I. Vanilla baseline: disable with no baseline is a no-op
// =====================================================================
// Strategy: ensure no baseline is in memory, call disable, expect
// no change. The SUT must not call restoreVanillaBaseline or
// clearVanillaBaseline when getVanillaBaseline() is null.
{
  const sut = await import('../second-drawer-mode')
  resetSpies()
  resetHydrationGuard()
  hydrateSettings({ secondSidebarEnabled: true })
  isConfigureTabsModalOpenSpy.mockReturnValue(false)
  _hostWritable = true
  _hostPatchOk = true

  clearVanillaBaseline()
  assert(getVanillaBaseline() === null, 'I: no baseline before disable')

  await sut.requestSecondDrawerMode(false)

  assert(getVanillaBaseline() === null, 'I: still no baseline after disable (no-op)')
}

// Final cleanup so the next test file (vanilla-baseline.test.ts and
// others) starts clean. Cases F-I mutate the in-memory baseline via
// the real vanilla-baseline module; we clear it here so the next file
// sees a fresh state. Also re-register the dom/lumiverse + dom/host-
// settings + main-persist mock seams with no-ops so later test files
// that don't register their own mocks see safe defaults.
//
// Note: the cases A-E `mockApplyLayout` helper re-mocks
// `../../layout/apply` per case. The last case's mock is in effect
// when this file ends and leaks into apply-restore.test.ts if that
// file runs next. This is a pre-existing limitation of the per-case
// mock pattern (bun's `mock.module` is process-global and there is no
// public API to restore the real module after a mock is registered).
// The vanilla-baseline.test.ts file does not depend on the real
// applyLayout, so it runs cleanly after this file.
mock.module('../../dom/lumiverse', () => ({
  getMainSidebar: () => null,
  getMainWrapper: () => null,
  getMainDrawer: () => null,
  getMainPanelContent: () => null,
  getMainPanel: () => null,
  getMainPanelHeader: () => null,
  getChatColumn: () => null,
  getMainDrawerWidth: () => 420,
}))
mock.module('../../dom/host-settings', () => ({
  getHostDrawerSettings: () => null,
  isHostDrawerSettingsWritable: () => false,
  patchHostDrawerSettings: () => false,
  __setHostSetSettingForTest: () => {},
  clearHostSettingsCache: () => {},
  HostDrawerSettings: undefined as any,
}))
mock.module('../../sidebar/main-persist', () => ({
  restoreMainDrawerFromDom: () => {},
  unsuppressMainDrawer: () => {},
  stampPanelBodyHide: () => {},
  startMainDrawerPersistence: () => {},
  stopMainDrawerPersistence: () => {},
}))
clearVanillaBaseline()
resetHydrationGuard()
hydrateSettings(null)
setLastLoadedLayout(null)
clearSessionDualProfile()

console.log(`second-drawer-mode: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
