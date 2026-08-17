// LumiverseHost.setHidden — Configure hide/unhide regression (2026-08-17).
//
// User report: "Hiding/unhiding extension tabs in Configure Tabs menu does
// not work. Appears to be a no-op." Also built-ins like connections.
//
// Root causes fixed here:
//   1. sideIds was resolved by looking the TabKey-keyed assignment facade up
//      by LIVE id — always a miss. The per-side filter then added EVERY live
//      tab for the primary side and NONE for the secondary side, so a
//      primary hide wiped the other side's hidden ids from the persisted
//      lists, and an unhidden secondary id was never removed — it stayed in
//      host + canvas hiddenTabIds and re-hid on the next host-sync.
//   2. The Canvas-owned main-mirror / secondary strips were only updated
//      when the host React write (patchHostDrawerSettings) is GO. Under
//      NO-GO the mirror buttons never got display:none and the toggle was a
//      visual no-op. The pre-owned-model Configure commit applied the strips
//      directly; that apply was lost in the owned-commit refactor.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed++ }
}
function assertIncludes(list: string[], id: string, msg: string) {
  if (list.includes(id)) { passed++ } else { console.error(`FAIL: ${msg} — ${JSON.stringify(id)} not in ${JSON.stringify(list)}`); failed++ }
}
function assertNotIncludes(list: string[], id: string, msg: string) {
  if (!list.includes(id)) { passed++ } else { console.error(`FAIL: ${msg} — ${JSON.stringify(id)} still in ${JSON.stringify(list)}`); failed++ }
}

import { mock } from 'bun:test'

// ── Shared mock state ──
const HONE_LIVE = 'spindle:ec535e94-9ee1-48e3-8f7d-2a7ceccadd4d:tab:hone:1'
const HONE_KEY = 'ext:ec535e94/Hone'

const state = {
  hostSettings: { tabOrder: [], hiddenTabIds: [] as string[] },
  patchResult: true as boolean,
  assignments: new Map<string, 'primary' | 'secondary'>(),
  observerTabs: [] as Array<{
    tabId: string
    extensionId: string
    title: string
    key: string
    button: unknown
    titles?: Set<string>
  }>,
  mirrorCalls: [] as string[],
  secondaryCalls: [] as string[],
  setSettingCalls: [] as unknown[],
}

mock.module('../../../dom/host-settings', () => ({
  getHostDrawerSettings: () => state.hostSettings,
  patchHostDrawerSettings: (partial: Record<string, unknown>) => {
    state.setSettingCalls.push(partial)
    state.hostSettings = { ...state.hostSettings, ...partial } as typeof state.hostSettings
    return state.patchResult
  },
  writeHostDrawerSettingsViaApi: async () => state.patchResult,
}))

mock.module('../../../tabs/assignment', () => ({
  getTabAssignments: () => state.assignments,
}))

mock.module('../../../sidebar/drawer-observer', () => ({
  drawerObserver: {
    getAllTabs: () => state.observerTabs,
  },
}))

mock.module('../../../tabs/buttons', () => ({
  addSecondaryTabButton: () => {},
  removeSecondaryTabButton: () => {},
  reorderSecondaryTabButtons: () => {},
  secondaryTabButtonsReady: () => true,
  reorderMainMirrorTabButtons: () => {},
  reorderHostMainTabButtons: () => {},
  hideMainTabButton: () => {},
  showMainTabButton: () => {},
  showSecondaryTab: () => {},
  findMainTabButton: () => null,
  applyHiddenTabIdsToSecondary: (ids: ReadonlySet<string>) => {
    state.secondaryCalls = [...ids]
  },
  applyHiddenTabIdsToMirror: (ids: ReadonlySet<string>) => {
    state.mirrorCalls = [...ids]
  },
}))

mock.module('../../../store', () => ({
  findStoreData: () => {},
  getMainDrawerSide: () => 'left',
  isMainDrawerOpen: () => false,
}))

mock.module('../../../dom/lumiverse', () => ({
  getMainSidebar: () => null,
  getMainDrawerWidth: () => 420,
}))

mock.module('../../../dom/host-bridge', () => ({
  getHostBridge: () => null,
}))

mock.module('../../../tabs/active-tab', () => ({
  resolvePrimaryActiveTabId: () => null,
  getActiveSecondaryTabId: () => null,
}))

mock.module('../../../sidebar/secondary', () => ({
  ensureSecondaryShellMounted: () => {},
  getSecondaryWrapper: () => null,
  isSecondarySidebarOpen: () => false,
  openSecondarySidebar: () => {},
  closeSecondarySidebar: () => {},
  getSecondaryTabList: () => null,
}))

mock.module('../../../sidebar/secondary-drawer', () => ({
  assignToSecondary: async () => {},
  unassignFromSecondary: async () => {},
}))

mock.module('../../../sidebar/main-mirror-drawer', () => ({
  getMainMirrorDrawer: () => null,
}))

mock.module('../../../tabs/live-tab-order', () => ({
  readVisibleTabIdsFromList: () => [],
}))

const { LumiverseHost } = await import('../implementation')
const {
  getCanvasHiddenTabIds,
  setCanvasHiddenTabIds,
  __resetCanvasHiddenTabIdsForTest,
} = await import('../../../tabs/canvas-hidden')

function observerTab(key: string, tabId: string, title: string, extensionId: string) {
  return { key, tabId, title, extensionId, button: {} }
}

function host() {
  return new LumiverseHost()
}

// ── A: unhiding a SECONDARY tab removes its id from persisted lists ──
// (old code: sideIds held only TabKeys, so the live-id filter never matched
// and the id stayed in host + canvas hiddenTabIds → re-hid on next sync)
{
  __resetCanvasHiddenTabIdsForTest()
  state.assignments = new Map([[HONE_KEY, 'secondary']])
  state.observerTabs = [observerTab(HONE_KEY, HONE_LIVE, 'Hone', 'ec535e94-9ee1-48e3-8f7d-2a7ceccadd4d')]
  state.hostSettings = { tabOrder: [], hiddenTabIds: [HONE_LIVE] }
  setCanvasHiddenTabIds([HONE_LIVE])

  const h = host()
  const res = await h.setHidden('secondary', [])

  assertEqual(res, 'ok', 'A1: setHidden returns ok')
  assertNotIncludes(state.hostSettings.hiddenTabIds, HONE_LIVE, 'A2: host hiddenTabIds no longer has the unhidden secondary id')
  assertNotIncludes(getCanvasHiddenTabIds(), HONE_LIVE, 'A3: canvas hidden list no longer has the unhidden secondary id')
}

// ── B: hiding a PRIMARY tab preserves OTHER-side (secondary) hides ──
// (old code: the primary-side filter included EVERY live tab, wiping the
// secondary id from host + canvas hiddenTabIds)
{
  __resetCanvasHiddenTabIdsForTest()
  state.assignments = new Map([
    ['builtin:profile', 'primary'],
    ['builtin:connections', 'primary'],
    [HONE_KEY, 'secondary'],
  ])
  state.observerTabs = [
    observerTab('builtin:profile', 'profile', 'Profile', ''),
    observerTab('builtin:connections', 'connections', 'Connections', ''),
    observerTab(HONE_KEY, HONE_LIVE, 'Hone', 'ec535e94-9ee1-48e3-8f7d-2a7ceccadd4d'),
  ]
  state.hostSettings = { tabOrder: [], hiddenTabIds: [HONE_LIVE] }
  setCanvasHiddenTabIds([HONE_LIVE])

  const h = host()
  const res = await h.setHidden('primary', ['connections'])

  assertEqual(res, 'ok', 'B1: setHidden returns ok')
  assertIncludes(state.hostSettings.hiddenTabIds, 'connections', 'B2: host hiddenTabIds includes the newly hidden primary tab')
  assertIncludes(state.hostSettings.hiddenTabIds, HONE_LIVE, 'B3: host hiddenTabIds KEEPS the secondary hide (not wiped)')
  const canvas = getCanvasHiddenTabIds()
  assertIncludes(canvas, 'connections', 'B4: canvas hidden list includes the primary hide')
  assertIncludes(canvas, HONE_LIVE, 'B5: canvas hidden list KEEPS the secondary hide')
}

// ── C: the strips get applied directly (mirror + secondary), GO or NO-GO ──
// (old code: mirror was never applied on the Configure commit path at all;
// secondary only for the secondary side. New code applies the effective
// union to BOTH strips on every setHidden.)
{
  __resetCanvasHiddenTabIdsForTest()
  state.assignments = new Map([
    ['builtin:profile', 'primary'],
    ['builtin:connections', 'primary'],
    [HONE_KEY, 'secondary'],
  ])
  state.observerTabs = [
    observerTab('builtin:profile', 'profile', 'Profile', ''),
    observerTab('builtin:connections', 'connections', 'Connections', ''),
    observerTab(HONE_KEY, HONE_LIVE, 'Hone', 'ec535e94-9ee1-48e3-8f7d-2a7ceccadd4d'),
  ]
  state.hostSettings = { tabOrder: [], hiddenTabIds: [] }
  setCanvasHiddenTabIds([])
  state.mirrorCalls = []
  state.secondaryCalls = []

  const h = host()
  await h.setHidden('primary', ['connections'])
  assertIncludes(state.mirrorCalls, 'connections', 'C1: main-mirror strip applied for the primary hide')
  // Old NO-GO path: patchHostDrawerSettings returns false — strips still apply.
  state.patchResult = false
  state.mirrorCalls = []
  state.secondaryCalls = []
  await h.setHidden('secondary', [HONE_LIVE])
  assertIncludes(state.secondaryCalls, HONE_LIVE, 'C2: secondary strip applied for the secondary hide (NO-GO)')
  assertIncludes(state.secondaryCalls, 'connections', 'C3: secondary applicator receives the effective union (primary hide preserved)')
  assertEqual(state.hostSettings.hiddenTabIds.includes(HONE_LIVE), true, 'C4: host list still persisted even when patch NO-GO (cache stamped)')
  state.patchResult = true
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)