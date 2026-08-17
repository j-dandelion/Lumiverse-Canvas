// Configure Tabs changes in NON-taskbar single-drawer mode must apply to
// the host MAIN drawer (2026-08-17 user report: "when taskbar mode and
// 'move tab controls to outer edge' are off — so MAIN drawer renders
// instead of MAIN-MIRROR — changes in Configure Tabs menu no longer cause
// anything to happen. Changes to SINGLE-DRAWER layout should also apply to
// MAIN drawer").
//
// In taskbar mode the visible primary surface is the Canvas-owned
// main-mirror, which is rebuilt from the model. In non-taskbar mode the
// MAIN drawer is the HOST's React drawer: reorder reaches it via
// reorderHostMainTabButtons (direct DOM), and hides must reach it via
// applyHiddenTabIdsToHostMain (direct display:none) — the fiber setSetting
// bridge that would drive the host React filter is frequently NO-GO.
//
// This test drives the REAL commitDraftToOwnedModel → dispatch → reconcile
// → LumiverseHost.setOrder/setHidden chain with a stub host drawer DOM and
// asserts the host MAIN drawer buttons actually reorder and hide.

;(globalThis as any).document = undefined // replaced below

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed++ }
}

// ── Minimal DOM stubs (buttons.test.ts pattern) ──
const hostButtons: Record<string, { style: { display: string }; order: number; getAttribute: (n: string) => string | null; parentElement: unknown }> = {}
// Host main drawer tab list: buttons in DOM order (tabListWrap > tabList).
const tabListStub: {
  children: Array<{ order: number }>
  querySelectorAll: (sel: string) => unknown[]
  appendChild: (child: unknown) => void
} = {
  children: [],
  querySelectorAll(sel: string) {
    if (sel === 'button[data-tab-id]' || sel === ':scope > button') return this.children
    return []
  },
  appendChild(child: unknown) {
    this.children = this.children.filter((c) => c !== child)
    this.children.push(child as { order: number })
  },
}
function makeHostBtn(id: string, order: number) {
  hostButtons[id] = {
    style: { display: '' },
    order,
    getAttribute: (n: string) => (n === 'data-tab-id' ? id : null),
    parentElement: tabListStub,
  }
  return hostButtons[id]
}
makeHostBtn('profile', 0)
makeHostBtn('connections', 1)
makeHostBtn('worldinfo', 2)
tabListStub.children = Object.values(hostButtons).sort((a, b) => a.order - b.order)
const sidebarStub = {
  querySelector(sel: string) {
    if (sel.includes('tabListWrap') || sel.includes('tabList')) return tabListStub
    return null
  },
  querySelectorAll() { return [] },
}
;(globalThis as any).document = {
  body: { appendChild() {}, querySelector() { return null }, querySelectorAll() { return [] } },
  head: { appendChild() {} },
  documentElement: {
    style: {
      setProperty() {},
      removeProperty() {},
      getPropertyValue() { return '' },
    },
    classList: { add() {}, remove() {}, contains() { return false } },
  },
  createElement(tag: string) {
    return {
      tagName: tag.toUpperCase(),
      className: '',
      style: { display: '' },
      classList: { add() {}, remove() {}, contains() { return false } },
      setAttribute() {},
      getAttribute() { return null },
      appendChild() {},
      addEventListener() {},
      removeEventListener() {},
      querySelector() { return null },
      querySelectorAll() { return [] },
      children: [],
    }
  },
  querySelector(sel: string) {
    if (sel === '[data-spindle-mount="sidebar"]') return sidebarStub
    return null
  },
  querySelectorAll() { return [] },
}
;(globalThis as any).window = {
  innerWidth: 1280,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {},
  removeEventListener() {},
}
;(globalThis as any).requestAnimationFrame = (fn: (t: number) => void) => { fn(0); return 1 }
;(globalThis as any).cancelAnimationFrame = () => {}
;(globalThis as any).CSS = { escape: (s: string) => s }
;(globalThis as any).getComputedStyle = () => ({})
;(globalThis as any).MutationObserver = class { observe() {} disconnect() {} takeRecords() { return [] } }
;(globalThis as any).ResizeObserver = class { observe() {} disconnect() {} }

// ── Mocks: keep the host + buttons REAL; stub the store/observer/assignment
// surfaces the real LumiverseHost reads. ──
import { mock } from 'bun:test'

const state = {
  hostSettings: { tabOrder: [] as string[], hiddenTabIds: [] as string[] },
  assignments: new Map<string, 'primary' | 'secondary'>(),
  observerTabs: [] as Array<{ tabId: string; extensionId: string; title: string; key: string; button: unknown }>,
  patchResult: true as boolean,
}

mock.module('../../../dom/host-settings', () => ({
  getHostDrawerSettings: () => state.hostSettings,
  patchHostDrawerSettings: (partial: Record<string, unknown>) => {
    state.hostSettings = { ...state.hostSettings, ...partial } as typeof state.hostSettings
    return state.patchResult
  },
  writeHostDrawerSettingsViaApi: async () => state.patchResult,
}))

mock.module('../../../tabs/assignment', () => ({
  getTabAssignments: () => state.assignments,
  getLiveIdAssignments: () => new Map(state.assignments),
  getTabSidebar: (tabId: string) => state.assignments.get(tabId) ?? 'primary',
  hasTabAssignment: (tabId: string) => state.assignments.has(tabId),
  hasSecondaryAssignedTabs: () => Array.from(state.assignments.values()).some((s) => s === 'secondary'),
  setTabAssignment: () => {},
  deleteTabAssignment: () => {},
  clearTabAssignments: () => {},
  getActiveSecondaryTabId: () => null,
  setActiveSecondaryTabId: () => {},
  getLiveIdAssignmentEntries: () => [],
}))

mock.module('../../../sidebar/drawer-observer', () => ({
  drawerObserver: {
    getAllTabs: () => state.observerTabs,
    getSnapshot: () => ({ status: 'ready', revision: 0, tabs: [] }),
    getTab: () => null,
    onTabRegistered: () => () => {},
    onTabUnregistered: () => () => {},
    start: () => {},
    stop: () => {},
  },
  keyForTabShape: (tabId: string) => tabId,
}))

mock.module('../../../store', () => ({
  findStoreData: () => {},
  getMainDrawerSide: () => 'left',
  isMainDrawerOpen: () => false,
  getMainDrawerWidth: () => 420,
  getDrawerTabs: () => [],
  getHostStoreTabs: () => [],
  getStoreSnapshot: () => null,
  getMainDrawerSideOverride: () => null,
  setMainDrawerSideOverride: () => {},
  getActiveModal: () => null,
}))

mock.module('../../../dom/lumiverse', () => ({
  getMainSidebar: () => sidebarStub as unknown as HTMLElement,
  getMainDrawer: () => null,
  getMainPanel: () => null,
  getMainPanelContent: () => null,
  getMainPanelHeader: () => null,
  getMainWrapper: () => null,
  getChatColumn: () => null,
  getMainDrawerWidth: () => 420,
}))

mock.module('../../../dom/host-bridge', () => ({
  getHostBridge: () => null,
}))

mock.module('../../../tabs/active-tab', () => ({
  resolvePrimaryActiveTabId: () => null,
  getActiveSecondaryTabId: () => null,
  setActiveSecondaryTabId: () => {},
  getActiveTabId: () => ({ primary: null, secondary: null }),
  isTabActiveInMainDrawer: () => false,
}))

mock.module('../../../sidebar/secondary', () => ({
  SECONDARY_WIDTH_VAR: '--sidebar-ux-secondary-width',
  PUZZLE_ICON_SVG: '',
  isSecondarySidebarOpen: () => false,
  getSecondaryWrapper: () => null,
  getSecondaryDrawer: () => null,
  getSecondaryPanel: () => null,
  getSecondaryTabList: () => null,
  isSecondaryShellLive: () => false,
  getClosedTransformPx: () => 0,
  ensureSecondaryShellMounted: () => {},
  createSecondarySidebar: () => ({}),
  mountSecondarySidebar: () => {},
  unmountSecondarySidebar: () => {},
  tearDownSecondarySidebar: () => {},
  openSecondarySidebar: () => {},
  closeSecondarySidebar: () => {},
  liveIdForFacadeKey: (key: string) => key,
  reassignSecondaryTabsFromModel: () => {},
  persistSecondaryDrawerOpen: () => {},
  setSecondarySidebarOpen: () => {},
  secondaryTabsAllPlaced: () => true,
  syncPanelHeaderFromMain: () => {},
}))

mock.module('../../../sidebar/main-mirror-drawer', () => ({
  getMainMirrorTabList: () => null,
  getMainMirrorWrapper: () => null,
  getMainMirrorDrawer: () => null,
  getMainMirrorTitleEl: () => null,
  getMainMirrorPanelContent: () => null,
  getMainMirrorWidthVar: () => '',
  isMainMirrorActive: () => false,
  isCanvasMainOpen: () => false,
  reconcileMainMirrorDrawer: () => {},
  updateMainMirrorDrawerTabVisibility: () => {},
  setCanvasMainTitle: () => {},
  applyMainMirrorDrawer: () => {},
  applyMainMirrorRestoredWidth: () => {},
  openCanvasMainDrawer: () => {},
  closeCanvasMainDrawer: () => {},
  ensureHostContentParkedPublic: () => {},
  restartReparkWatch: () => {},
  __getReparkIdleCountForTest: () => 0,
  __resetMainMirrorForTest: () => {},
  MAIN_MIRROR_WIDTH_VAR: '--sidebar-ux-main-mirror-w',
}))

mock.module('../../../tabs/live-tab-order', () => ({
  readVisibleTabIdsFromList: () => [],
  readLivePrimaryTabIds: () => Object.keys(hostButtons),
  readLiveSecondaryTabIds: () => [],
}))

mock.module('../../../sidebar/drawer-sync', () => ({
  isShowTabLabels: () => true,
  syncSecondaryTabLabels: () => {},
  syncDrawerTabSettings: () => {},
  applyMainDrawerSideChange: async () => {},
  checkSideChanged: () => {},
  resetSideRemountStateAfterDisable: () => {},
  ensureObserverCoordinator: () => ({ signal: () => {} }),
}))

mock.module('../../../settings/state', () => ({
  getSettings: () => ({
    taskbarMode: false,
    moveControlsToOuterEdge: false,
    secondSidebarEnabled: false,
    hideDrawerOpenCloseButtons: false,
    dragAndDropDrawerTabs: false,
    persistDrawerOpenState: false,
    persistDrawerWidth: false,
    showTabLabels: true,
    mirrorCompactPosition: false,
  }),
  setSettings: () => {},
  getLastLoadedLayout: () => null,
  setLastLoadedLayout: () => {},
  getSingleLayoutSlot: () => null,
  getDualLayoutSlot: () => null,
  setSingleLayoutSlot: () => {},
  setDualLayoutSlot: () => {},
  hydrateSettings: () => {},
  hydrateModeLayoutSlots: () => {},
  persistSettings: () => {},
  cancelSettingsSave: () => {},
  refreshSettingsPanel: () => {},
  isHideDrawerOpenCloseButtonsEnabled: () => false,
  isDragAndDropDrawerTabsEnabled: () => false,
  isTaskbarModeEnabled: () => false,
  normalizeCanvasSettings: (s: any) => s,
}))

mock.module('../../../tabs/configure-catalog', () => ({
  BUILTIN_TAB_IDS: ['profile', 'connections', 'worldinfo'],
  isHideLocked: () => false,
}))

mock.module('../../../persist/backend-ctx', () => ({ CANVAS_VERSION: 'test-v1.0' }))

// ── Dynamic imports AFTER mocks ──
const dispatchMod = await import('../../../recon/dispatch')
const { bootstrap, shutdown, flush, getModel } = dispatchMod
const { commitDraftToOwnedModel } = await import('../../../tabs/owned-commit')
const { createEmptyModel, builtinKey } = await import('../../../core/model')

const PROFILE = builtinKey('profile')
const CONNECTIONS = builtinKey('connections')
const WORLDINFO = builtinKey('worldinfo')

function observerTab(key: string, tabId: string, title: string) {
  return { key, tabId, title, extensionId: '', button: { style: { display: '' } } }
}

// ── The repro: single-drawer, taskbar OFF — Configure reorder + hide must
// reach the host MAIN drawer. ──
{
  shutdown()
  state.assignments = new Map([
    [PROFILE, 'primary'],
    [CONNECTIONS, 'primary'],
    [WORLDINFO, 'primary'],
  ])
  state.observerTabs = [
    observerTab(PROFILE, 'profile', 'Profile'),
    observerTab(CONNECTIONS, 'connections', 'Connections'),
    observerTab(WORLDINFO, 'worldinfo', 'World Info'),
  ]
  state.hostSettings = { tabOrder: ['profile', 'connections', 'worldinfo'], hiddenTabIds: [] }
  state.patchResult = true
  hostButtons['profile'].style.display = ''
  hostButtons['connections'].style.display = ''
  hostButtons['worldinfo'].style.display = ''

  const model = {
    ...createEmptyModel(),
    primary: [PROFILE, CONNECTIONS, WORLDINFO],
    secondary: [],
    hidden: [],
    active: { primary: PROFILE, secondary: null },
    side: 'left' as const,
  }
  const { LumiverseHost } = await import('../../../host/lumiverse/implementation')
  const host = new LumiverseHost()
  bootstrap(model, host as any)
  await flush()

  // ── Configure: reorder (worldinfo to front) + hide connections ──
  const draft = {
    drawerSide: 'left' as const,
    primaryIds: ['worldinfo', 'profile', 'connections'],
    secondaryIds: [],
    builtinOrder: ['worldinfo', 'profile', 'connections'],
    extensionOrder: [],
    hiddenIds: new Set(['connections']),
  }
  const result = await commitDraftToOwnedModel(draft as any)
  assertEqual(result.ok, true, 'R1: Configure commit ok in non-taskbar single-drawer mode')

  // Let the async mirror-applicator lazy import settle (microtask chain).
  await new Promise((r) => setTimeout(r, 10))

  // (a) Model converged.
  const after = getModel()
  if (after) {
    assertEqual(after.primary.join(','), [WORLDINFO, PROFILE, CONNECTIONS].join(','), 'R2: model primary order = draft')
    assert(after.hidden.includes(CONNECTIONS), 'R3: model hidden includes connections')
  }

  // (b) The HOST MAIN drawer reordered (reorderHostMainTabButtons).
  const domOrder = (tabListStub.children as Array<{ order: number }>)
    .map((c) => c.order)
  // children order after appendChild: worldinfo, profile, connections
  const idsInDomOrder = (tabListStub.children as Array<{ order: number }>)
    .map((c) => Object.keys(hostButtons).find((k) => hostButtons[k] === c))
  assertEqual(idsInDomOrder.join(','), 'worldinfo,profile,connections', 'R4: host MAIN drawer buttons reordered')

  // (c) The HOST MAIN drawer hid the hidden tab (applyHiddenTabIdsToHostMain).
  assertEqual(hostButtons['connections'].style.display, 'none', 'R5: hidden host main button display:none')
  assertEqual(hostButtons['profile'].style.display, '', 'R6: visible host main button keeps display')
  assertEqual(hostButtons['worldinfo'].style.display, '', 'R7: reordered host main button keeps display')
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
