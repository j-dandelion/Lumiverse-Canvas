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
// Spread the real module so newly-imported exports keep linking; the stub
// below only neutralizes what this test isolates.
import * as actualStore from '../../../store'

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
  hostMainCalls: [] as string[],
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
  applyHiddenTabIdsToHostMain: (ids: ReadonlySet<string>) => {
    state.hostMainCalls = [...ids]
  },
}))

mock.module('../../../store', () => ({
  ...actualStore,
  findStoreData: () => {},
  getMainDrawerSide: () => 'left',
  isMainDrawerOpen: () => false,
  getDrawerTabs: () => [],
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

// Dispatch seam (lazy-imported by implementation.ts setHidden). Default:
// no model → the closed∧unhidden merge is a no-op. Cases D/E reassign
// _dispatchModel / _resolveMap to drive the merge.
let _dispatchModel: { hidden: Set<string>; closed: string[] } | null = null
const _resolveMap = new Map<string, string>()
mock.module('../../../recon/dispatch', () => ({
  getModel: () => _dispatchModel,
  getHost: () => ({ resolve: (key: string) => _resolveMap.get(key) ?? null }),
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
  // S2: hidden is MODEL-owned — setHidden no longer patches the host list.
  // The host copy is whatever the host itself holds; Canvas hidden is truth.
  assertIncludes(state.hostSettings.hiddenTabIds, HONE_LIVE, 'A2: host hiddenTabIds untouched (S2 model-owned)')
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
  // S2: the host list is not written — only the Canvas copy is authoritative.
  assertNotIncludes(state.hostSettings.hiddenTabIds, 'connections', 'B2: host hiddenTabIds NOT patched (S2 model-owned)')
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
  state.hostMainCalls = []

  const h = host()
  await h.setHidden('primary', ['connections'])
  assertIncludes(state.mirrorCalls, 'connections', 'C1: main-mirror strip applied for the primary hide')
  assertIncludes(state.hostMainCalls, 'connections', 'C1b: host MAIN drawer applicator applied for the primary hide (non-taskbar surface)')
  // Old NO-GO path: patchHostDrawerSettings returns false — strips still apply.
  state.patchResult = false
  state.mirrorCalls = []
  state.secondaryCalls = []
  state.hostMainCalls = []
  await h.setHidden('secondary', [HONE_LIVE])
  assertIncludes(state.secondaryCalls, HONE_LIVE, 'C2: secondary strip applied for the secondary hide (NO-GO)')
  assertIncludes(state.secondaryCalls, 'connections', 'C3: secondary applicator receives the effective union (primary hide preserved)')
  assertIncludes(state.hostMainCalls, 'connections', 'C3b: host MAIN applicator receives the effective union (NO-GO)')
  // S2: no host write on any path (GO or NO-GO); the Canvas copy carries it.
  assertNotIncludes(state.hostSettings.hiddenTabIds, HONE_LIVE, 'C4: host list NOT patched (S2 model-owned)')
  assertIncludes(getCanvasHiddenTabIds(), HONE_LIVE, 'C5: canvas hidden list persisted the secondary hide')
  state.patchResult = true
}

// ── D: closed∧unhidden tabs stay suppressed on the strips (OS mode, D3) ──
// A Start-menu manage un-hide drops the key from model.hidden only — the
// window is still CLOSED, so its strip button must stay hidden. The merge
// must touch the STRIP applies only: the Canvas copy stays pure model.hidden
// (no closed residue → no hiddenTabIds persist leak).
{
  __resetCanvasHiddenTabIdsForTest()
  state.assignments = new Map([[HONE_KEY, 'secondary']])
  state.observerTabs = [
    observerTab(HONE_KEY, HONE_LIVE, 'Hone', 'ec535e94-9ee1-48e3-8f7d-2a7ceccadd4d'),
  ]
  state.hostSettings = { tabOrder: [], hiddenTabIds: [] }
  setCanvasHiddenTabIds([])
  state.mirrorCalls = []
  state.secondaryCalls = []
  state.hostMainCalls = []
  _dispatchModel = { hidden: new Set<string>(), closed: [HONE_KEY] }
  _resolveMap.set(HONE_KEY, HONE_LIVE)

  const h = host()
  // The un-hide commit: reconcile sends the model.hidden projection — HONE
  // is NOT in it (it was just un-hidden); only the closed merge keeps the
  // button off the strip.
  await h.setHidden('secondary', [])
  assertIncludes(state.secondaryCalls, HONE_LIVE, 'D1: closed∧unhidden tab stays suppressed on the secondary strip')
  assertIncludes(state.mirrorCalls, HONE_LIVE, 'D1b: closed∧unhidden tab stays suppressed on the mirror strip')
  assertIncludes(state.hostMainCalls, HONE_LIVE, 'D1c: closed∧unhidden tab stays suppressed on the host-main strip')
  assertNotIncludes(getCanvasHiddenTabIds(), HONE_LIVE, 'D2: Canvas copy stays PURE model.hidden — no closed residue (no hiddenTabIds persist leak)')

  // A closed∧HIDDEN key is carried by `ids` (model projection) — the merge
  // skips it, so no double-add and the Canvas copy keeps it via ids.
  const CLOSED_HIDDEN_KEY = 'builtin:profile'
  const CLOSED_HIDDEN_LIVE = 'builtin:profile' // liveIdForKey passes builtins through
  _dispatchModel = { hidden: new Set<string>([CLOSED_HIDDEN_KEY]), closed: [CLOSED_HIDDEN_KEY, HONE_KEY] }
  state.assignments = new Map([
    [CLOSED_HIDDEN_KEY, 'primary'],
    [HONE_KEY, 'secondary'],
  ])
  state.observerTabs = [
    observerTab(CLOSED_HIDDEN_KEY, CLOSED_HIDDEN_LIVE, 'Profile', ''),
    observerTab(HONE_KEY, HONE_LIVE, 'Hone', 'ec535e94-9ee1-48e3-8f7d-2a7ceccadd4d'),
  ]
  state.mirrorCalls = []
  state.secondaryCalls = []
  state.hostMainCalls = []
  await h.setHidden('primary', [CLOSED_HIDDEN_LIVE])
  const profileCount = state.mirrorCalls.filter((id) => id === CLOSED_HIDDEN_LIVE).length
  assertEqual(profileCount, 1, 'D3: closed∧hidden id applied exactly once (carried by ids, not re-added by the closed merge)')
  assertIncludes(getCanvasHiddenTabIds(), CLOSED_HIDDEN_LIVE, 'D4: closed∧hidden id stays in the Canvas copy via the model projection')
  assertIncludes(state.secondaryCalls, HONE_LIVE, 'D5: the other side still gets the closed∧unhidden merge')

  // E: a closed key with NO live resolution must not crash the apply.
  _dispatchModel = { hidden: new Set<string>(), closed: ['ext:dead/Key'] }
  state.mirrorCalls = []
  state.secondaryCalls = []
  state.hostMainCalls = []
  const res = await h.setHidden('primary', [])
  assertEqual(res, 'ok', 'E1: unresolvable closed key → setHidden still returns ok')

  _dispatchModel = null
  _resolveMap.clear()
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)