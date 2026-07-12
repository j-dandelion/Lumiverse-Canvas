// Tests for vanilla baseline (session-only) — preserves the pre-dual
// host state so disable restores the user's original Lumiverse layout.
//
// Strategy:
// - All `mock.module(...)` calls live at the top of the file. Bun's
//   bundler hoists them to the top of the module so the SUT's static
//   imports resolve to the mocks — but we ALSO use a dynamic import
//   for the SUT below to make the order explicit and robust against
//   any hoisting edge case (matches the working pattern used
//   elsewhere in this repo, e.g. `second-drawer-mode.test.ts`).
// - Mock the host-settings seam (`getHostDrawerSettings`,
//   `patchHostDrawerSettings`, `isHostDrawerSettingsWritable`) so
//   the SUT reads/writes the controlled values without walking the
//   fiber tree.
// - Mock `../store`, `../tabs/active-tab`, `../sidebar/main-persist`,
//   `../persist`, `../debug/log`, `../dom/lumiverse` so the SUT
//   never touches the real DOM/host. No DOM access needed.

import { mock } from 'bun:test'

// ── Module mocks (process-global) ──
// All mocks must be registered before the SUT is imported. Bun's
// bundler hoists `mock.module` calls, but we ALSO use a dynamic
// `await import` for the SUT to make the registration order
// explicit and robust.

const hostWritten: Array<{ key: string; value: unknown }> = []
let _hostSettings: any = { side: 'right', tabOrder: [], hiddenTabIds: [] }
let _hostWritable = true

mock.module('../../dom/host-settings', () => ({
  getHostDrawerSettings: () => _hostSettings,
  patchHostDrawerSettings: (partial: any) => {
    if (!_hostWritable) return false
    const current = _hostSettings ?? {}
    const merged = { ...current, ...partial }
    hostWritten.push({ key: 'drawerSettings', value: merged })
    _hostSettings = merged
    return true
  },
  isHostDrawerSettingsWritable: () => _hostWritable,
  __setHostSetSettingForTest: (
    fn: ((key: string, value: unknown) => void) | null,
    settings?: any,
  ) => {
    if (settings !== undefined) _hostSettings = settings
  },
  clearHostSettingsCache: () => { _hostSettings = null; _hostWritable = true; hostWritten.length = 0 },
  HostDrawerSettings: undefined as any,
}))

let _mainOpen = false
let _mainDrawerSide: 'left' | 'right' = 'right'
let _drawerTabs: Array<{ id: string; title: string; extensionId: string; root: any }> = []

mock.module('../../store', () => ({
  isMainDrawerOpen: () => _mainOpen,
  getMainDrawerSide: () => _mainDrawerSide,
  getDrawerTabs: () => _drawerTabs,
  findStoreData: () => {},
  getStoreSnapshot: () => null,
  asDrawerStore: (s: any) => s,
  __setStoreSnapshotForTest: () => {},
  __setDrawerTabsForTest: (tabs: any) => { _drawerTabs = tabs },
  getMainDrawerWidth: () => 420,
}))

let _activeTabId: string | null = null

mock.module('../../tabs/active-tab', () => ({
  getActiveTabId: () => ({ state: _mainOpen ? 'active' as const : 'closed' as const, id: _activeTabId }),
  isTabActiveInMainDrawer: (tabId: string) => _mainOpen && tabId === _activeTabId,
  getActiveSecondaryTabId: () => null,
  setActiveSecondaryTabId: () => {},
}))

const restoreCalls: Array<{ targetOpen: boolean; targetTabId: string | null; opts: any }> = []
mock.module('../../sidebar/main-persist', () => ({
  restoreMainDrawerFromDom: (open: boolean, tabId: string | null, _w: number | undefined, opts: any) => {
    restoreCalls.push({ targetOpen: open, targetTabId: tabId, opts })
  },
  unsuppressMainDrawer: () => {},
  stampPanelBodyHide: () => {},
}))

mock.module('../persist', () => ({
  applyMainDrawer: (_layout: any) => {},
}))

mock.module('../../debug/log', () => ({
  dlog: () => {},
  dwarn: () => {},
  setDebug: () => {},
}))

mock.module('../../dom/lumiverse', () => ({
  getMainSidebar: () => null,
  getMainWrapper: () => null,
  getMainDrawer: () => null,
  getMainPanelContent: () => null,
  getMainDrawerWidth: () => 420,
}))

// ── SUT (dynamic import so mocks are guaranteed to be in effect) ──
const {
  hasVanillaBaseline,
  getVanillaBaseline,
  clearVanillaBaseline,
  captureVanillaBaseline,
  restoreVanillaBaseline,
  readVanillaHostState,
} = await import('../vanilla-baseline')

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed++ }
}

/** Reset all mocks between cases. */
function reset() {
  clearVanillaBaseline()
  _hostSettings = { side: 'right', tabOrder: [], hiddenTabIds: [], showTabLabels: undefined }
  _hostWritable = true
  hostWritten.length = 0
  _mainOpen = false
  _mainDrawerSide = 'right'
  _drawerTabs = []
  _activeTabId = null
  restoreCalls.length = 0
}

// =====================================================================
// 1. Initial state: no baseline
// =====================================================================
{
  reset()
  assert(!hasVanillaBaseline(), '1: no baseline initially')
  assert(getVanillaBaseline() === null, '1: getVanillaBaseline returns null initially')
}

// =====================================================================
// 2. Capture baseline reads host settings + main open/active
// =====================================================================
{
  reset()
  _hostSettings = {
    side: 'left',
    tabOrder: ['profile', 'presets', 'memory'],
    hiddenTabIds: ['memory'],
    showTabLabels: true,
  }
  _mainOpen = true
  _mainDrawerSide = 'left'
  _activeTabId = 'profile'

  const { baseline, captured } = captureVanillaBaseline()

  assert(captured, '2: first capture returns captured=true')
  assert(hasVanillaBaseline(), '2: baseline present after capture')
  assertEqual(baseline.host.side, 'left', '2: baseline host side = left')
  assertEqual(baseline.host.tabOrder.length, 3, '2: baseline tabOrder has 3 items')
  assertEqual(baseline.host.tabOrder[0], 'profile', '2: baseline tabOrder[0] = profile')
  assertEqual(baseline.host.hiddenTabIds.length, 1, '2: baseline hiddenTabIds has 1 item')
  assertEqual(baseline.host.hiddenTabIds[0], 'memory', '2: baseline hiddenTabIds[0] = memory')
  assertEqual(baseline.host.showTabLabels, true, '2: baseline showTabLabels = true')
  assertEqual(baseline.mainOpen, true, '2: baseline mainOpen = true')
  assertEqual(baseline.mainActiveTabId, 'profile', '2: baseline mainActiveTabId = profile')
  assert(typeof baseline.capturedAt === 'number', '2: capturedAt is a number')
}

// =====================================================================
// 3. Capture is idempotent — repeated calls do not overwrite
// =====================================================================
{
  reset()
  _hostSettings = { side: 'right', tabOrder: ['profile'], hiddenTabIds: [] }
  _mainOpen = false
  _activeTabId = null

  const first = captureVanillaBaseline()
  // Mutate live state.
  _hostSettings = { side: 'left', tabOrder: ['profile', 'memory'], hiddenTabIds: ['memory'] }
  _mainOpen = true
  _activeTabId = 'memory'

  const second = captureVanillaBaseline()

  assertEqual(first.captured, true, '3: first call captured')
  assertEqual(second.captured, false, '3: second call not captured (idempotent)')
  assertEqual(second.baseline.host.side, 'right', '3: baseline unchanged (side still right)')
  assertEqual(second.baseline.host.tabOrder[0], 'profile', '3: baseline unchanged (tabOrder[0] still profile)')
  assertEqual(second.baseline.mainOpen, false, '3: baseline unchanged (mainOpen still false)')
  assertEqual(second.baseline.mainActiveTabId, null, '3: baseline unchanged (active still null)')
}

// =====================================================================
// 4. After clear, next capture is fresh
// =====================================================================
{
  reset()
  _hostSettings = { side: 'right', tabOrder: ['profile'], hiddenTabIds: [] }
  captureVanillaBaseline()
  assert(hasVanillaBaseline(), '4: baseline present after capture')

  clearVanillaBaseline()
  assert(!hasVanillaBaseline(), '4: baseline cleared')

  _hostSettings = { side: 'left', tabOrder: ['profile', 'memory'], hiddenTabIds: [] }
  _mainOpen = true
  _activeTabId = 'memory'

  const next = captureVanillaBaseline()
  assertEqual(next.captured, true, '4: capture after clear returns captured=true')
  assertEqual(next.baseline.host.side, 'left', '4: new baseline reflects current state')
  assertEqual(next.baseline.mainOpen, true, '4: new baseline reflects main open')
}

// =====================================================================
// 5. Restore: writes host settings via patchHostDrawerSettings
// =====================================================================
{
  reset()
  // Live state: dual-mutated (different from baseline).
  _hostSettings = { side: 'right', tabOrder: ['profile', 'memory'], hiddenTabIds: ['profile'], showTabLabels: false }
  _mainOpen = true
  _activeTabId = 'memory'

  // Capture from a "vanilla" state by clearing the cache first.
  clearVanillaBaseline()
  // Simulate the original vanilla state.
  _hostSettings = { side: 'left', tabOrder: ['profile', 'presets', 'memory'], hiddenTabIds: ['presets'], showTabLabels: true }
  _mainOpen = false
  _activeTabId = 'profile'
  captureVanillaBaseline()

  // Now mutate to dual state.
  _hostSettings = { side: 'right', tabOrder: ['profile', 'memory'], hiddenTabIds: ['profile'], showTabLabels: false }
  _mainOpen = true
  _activeTabId = 'memory'
  _drawerTabs = [
    { id: 'profile', title: 'Profile', extensionId: 'ext', root: null },
    { id: 'memory', title: 'Memory', extensionId: 'ext', root: null },
    { id: 'presets', title: 'Presets', extensionId: 'ext', root: null },
  ]

  const baseline = getVanillaBaseline()!
  const result = await restoreVanillaBaseline(baseline)

  assertEqual(result.ok, true, '5: restore returns ok=true')
  assertEqual(hostWritten.length, 1, '5: host settings patched exactly once')
  const written = hostWritten[0].value as Record<string, unknown>
  assertEqual(written.side, 'left', '5: host side = left (vanilla)')
  assertEqual((written.tabOrder as string[]).length, 3, '5: host tabOrder has 3 items')
  assertEqual((written.tabOrder as string[])[0], 'profile', '5: tabOrder[0] = profile')
  assertEqual((written.hiddenTabIds as string[])[0], 'presets', '5: hiddenTabIds[0] = presets')
  assertEqual(written.showTabLabels, true, '5: showTabLabels = true')
  // Baseline is NOT cleared by restoreVanillaBaseline itself; the caller
  // (finishDisable) calls clearVanillaBaseline() after a successful result.
  assert(hasVanillaBaseline(), '5: baseline still present (caller clears)')

  // Simulate the caller's clear-after-success.
  clearVanillaBaseline()
  assert(!hasVanillaBaseline(), '5: baseline cleared by caller after success')
}

// =====================================================================
// 6. Restore: also calls restoreMainDrawerFromDom for main open/active
// =====================================================================
{
  reset()
  _hostSettings = { side: 'right', tabOrder: ['profile'], hiddenTabIds: [] }
  _mainOpen = false
  _activeTabId = null
  captureVanillaBaseline()

  // The baseline now says main was open with profile active.
  // Mutate to dual state where main is closed.
  _hostSettings = { side: 'right', tabOrder: ['profile'], hiddenTabIds: [] }
  _mainOpen = false
  _activeTabId = null
  _drawerTabs = [{ id: 'profile', title: 'Profile', extensionId: 'ext', root: null }]

  const baseline = getVanillaBaseline()!
  const result = await restoreVanillaBaseline(baseline)

  assertEqual(result.ok, true, '6: restore ok')
  assertEqual(restoreCalls.length, 1, '6: restoreMainDrawerFromDom called once')
  // We didn't set mainOpen in this case (stayed false), so the call
  // should be with open=false and tabId=null.
  assertEqual(restoreCalls[0].targetOpen, false, '6: targetOpen = false')
  assertEqual(restoreCalls[0].targetTabId, null, '6: targetTabId = null')
  assertEqual(restoreCalls[0].opts.restoreOpen, true, '6: opts.restoreOpen = true (unconditional)')
  assertEqual(restoreCalls[0].opts.restoreWidth, true, '6: opts.restoreWidth = true (unconditional)')
}

// =====================================================================
// 7. Restore: NO-GO returns ok=false, baseline retained
// =====================================================================
{
  reset()
  _hostSettings = { side: 'right', tabOrder: ['profile'], hiddenTabIds: [] }
  captureVanillaBaseline()
  _hostWritable = false // simulate NO-GO

  const baseline = getVanillaBaseline()!
  const result = await restoreVanillaBaseline(baseline)

  assertEqual(result.ok, false, '7: NO-GO returns ok=false')
  if (!result.ok) assertEqual(result.reason, 'no-go', '7: reason = no-go')
  assert(hasVanillaBaseline(), '7: baseline retained on NO-GO for retry')
  assertEqual(hostWritten.length, 0, '7: no host writes on NO-GO')
}

// =====================================================================
// 8. Restore with closed baseline + null active tab → no tab click
// =====================================================================
{
  reset()
  _hostSettings = { side: 'right', tabOrder: ['profile'], hiddenTabIds: [] }
  _mainOpen = false
  _activeTabId = null
  captureVanillaBaseline()

  // Mutate to dual state.
  _mainOpen = true
  _activeTabId = 'profile'

  const baseline = getVanillaBaseline()!
  const result = await restoreVanillaBaseline(baseline)

  assertEqual(result.ok, true, '8: restore ok for closed baseline')
  assertEqual(restoreCalls.length, 1, '8: restoreMainDrawerFromDom called once')
  assertEqual(restoreCalls[0].targetOpen, false, '8: targetOpen = false (closed)')
  assertEqual(restoreCalls[0].targetTabId, null, '8: targetTabId = null (no click needed)')
}

// =====================================================================
// 9. Restore with hidden baseline active tab → fallback to first visible
// =====================================================================
{
  reset()
  _hostSettings = { side: 'right', tabOrder: ['profile', 'memory'], hiddenTabIds: ['memory'] }
  _mainOpen = true
  _activeTabId = 'memory'
  _drawerTabs = [
    { id: 'profile', title: 'Profile', extensionId: 'ext', root: null },
    { id: 'memory', title: 'Memory', extensionId: 'ext', root: null },
  ]
  captureVanillaBaseline()

  // Simulate the "memory" tab being hidden after the dual session.
  // hostSettings has 'memory' and 'presets' in hiddenTabIds; live
  // _drawerTabs reports three tabs in this order: profile, memory, presets.
  _hostSettings = { side: 'right', tabOrder: ['profile', 'memory', 'presets'], hiddenTabIds: ['memory', 'presets'] }
  _drawerTabs = [
    { id: 'profile', title: 'Profile', extensionId: 'ext', root: null },
    { id: 'memory', title: 'Memory', extensionId: 'ext', root: null },
    { id: 'presets', title: 'Presets', extensionId: 'ext', root: null },
  ]

  const baseline = getVanillaBaseline()!
  const result = await restoreVanillaBaseline(baseline)

  assertEqual(result.ok, true, '9: restore ok with hidden active tab')
  assertEqual(restoreCalls.length, 1, '9: restoreMainDrawerFromDom called once')
  // Baseline said mainOpen=true with mainActiveTabId=memory.
  // 'memory' is now in hiddenTabIds, so isTabKnownAndVisible(memory)=false
  // and pickSafeFallbackTabId() walks getDrawerTabs() and returns the
  // first non-hidden tab — 'profile'.
  assertEqual(restoreCalls[0].targetOpen, true, '9: targetOpen = true')
  assertEqual(restoreCalls[0].targetTabId, 'profile', '9: targetTabId = profile (first non-hidden)')
}

// =====================================================================
// 10. Restore with unknown active tab → fallback to first tab
// =====================================================================
{
  reset()
  _hostSettings = { side: 'right', tabOrder: ['profile'], hiddenTabIds: [] }
  _mainOpen = true
  _activeTabId = 'stale-tab'
  captureVanillaBaseline()

  // Live state: stale-tab is no longer registered; profile is the
  // only tab in getDrawerTabs().
  _hostSettings = { side: 'right', tabOrder: ['profile'], hiddenTabIds: [] }
  _drawerTabs = [{ id: 'profile', title: 'Profile', extensionId: 'ext', root: null }]

  const baseline = getVanillaBaseline()!
  const result = await restoreVanillaBaseline(baseline)

  assertEqual(result.ok, true, '10: restore ok with unknown active tab')
  assertEqual(restoreCalls.length, 1, '10: restoreMainDrawerFromDom called once')
  // 'stale-tab' is not in getDrawerTabs() and not in any suffix-drift
  // alias, so isTabKnownAndVisible(stale-tab)=false. The fallback walks
  // getDrawerTabs() and returns the first tab — 'profile'.
  assertEqual(restoreCalls[0].targetOpen, true, '10: targetOpen = true (baseline said open)')
  assertEqual(restoreCalls[0].targetTabId, 'profile', '10: targetTabId = profile (first tab)')
}

// =====================================================================
// 11. Configure Apply changes do not modify the captured baseline
// =====================================================================
{
  reset()
  _hostSettings = { side: 'right', tabOrder: ['profile', 'memory'], hiddenTabIds: [] }
  _mainOpen = false
  _activeTabId = null
  captureVanillaBaseline()

  // Simulate Configure Apply mutating host settings.
  _hostSettings = { side: 'left', tabOrder: ['memory', 'profile'], hiddenTabIds: ['profile'] }
  _mainOpen = true
  _activeTabId = 'memory'

  // Verify baseline is still the original.
  const baseline = getVanillaBaseline()!
  assertEqual(baseline.host.side, 'right', '11: baseline.side unchanged after Apply')
  assertEqual(baseline.host.tabOrder[0], 'profile', '11: baseline.tabOrder unchanged after Apply')
  assertEqual(baseline.host.hiddenTabIds.length, 0, '11: baseline.hiddenTabIds unchanged after Apply')
  assertEqual(baseline.mainOpen, false, '11: baseline.mainOpen unchanged after Apply')
}

// =====================================================================
// 12. Repeated enable requests do not recapture
// =====================================================================
{
  reset()
  _hostSettings = { side: 'right', tabOrder: ['profile'], hiddenTabIds: [] }
  _mainOpen = true
  _activeTabId = 'profile'

  const first = captureVanillaBaseline()
  // Simulate: user does something in dual mode that mutates the live host state.
  _hostSettings = { side: 'left', tabOrder: ['memory', 'profile'], hiddenTabIds: ['profile'] }

  const second = captureVanillaBaseline()

  assertEqual(first.captured, true, '12: first capture = true')
  assertEqual(second.captured, false, '12: repeated capture = false (no recapture)')
  assertEqual(second.baseline.host.side, 'right', '12: baseline still right (not recaptured)')
  assertEqual(second.baseline.host.tabOrder[0], 'profile', '12: baseline still profile-first')
}

// =====================================================================
// 13. Restore with empty baseline runs both patch + main restore
// =====================================================================
// Verifies that `restoreVanillaBaseline` runs the host patch AND the
// main-drawer restore even when the captured baseline is empty (no
// dual changes to revert). The "no baseline at disable time" path
// (when `getVanillaBaseline()` returns null in the SUT) is covered by
// case I in second-drawer-mode.test.ts.
{
  reset()
  // No live state to restore from — the function is called with a
  // hand-built empty baseline.
  const result = await restoreVanillaBaseline({
    host: { side: 'right', tabOrder: [], hiddenTabIds: [] },
    mainOpen: false,
    mainActiveTabId: null,
    capturedAt: 0,
  })

  assertEqual(result.ok, true, '13: empty baseline restore returns ok')
  assertEqual(hostWritten.length, 1, '13: host patch ran once (empty patch)')
  assertEqual(restoreCalls.length, 1, '13: main restore ran once')
  assertEqual(restoreCalls[0].targetOpen, false, '13: main restore targetOpen = false')
  assertEqual(restoreCalls[0].targetTabId, null, '13: main restore targetTabId = null')
  // restoreVanillaBaseline does not clear the baseline itself; the
  // caller (finishDisable) decides. No baseline was captured in this
  // case, so hasVanillaBaseline stays false.
  assert(!hasVanillaBaseline(), '13: no baseline in memory (none was captured)')
}

// =====================================================================
// 14. readVanillaHostState: closed drawer → null active
// =====================================================================
{
  reset()
  _hostSettings = { side: 'right', tabOrder: ['profile'], hiddenTabIds: [] }
  _mainOpen = false
  _activeTabId = 'profile' // would be set if open, but drawer is closed

  const state = readVanillaHostState()
  assertEqual(state.host.side, 'right', '14: read state side = right')
  assertEqual(state.mainOpen, false, '14: read state mainOpen = false')
  assertEqual(state.mainActiveTabId, null, '14: read state mainActiveTabId = null (closed)')
}

// =====================================================================
// Cleanup
// =====================================================================
clearVanillaBaseline()
console.log(`vanilla-baseline: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
