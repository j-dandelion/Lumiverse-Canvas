// Enable-second-drawer cascade + same-side repro (2026-08-17).
//
// User report: toggling "Enable second drawer" breaks things — drawers end
// up on the SAME side, or a SAVE_LAYOUT cascade freezes the app (bytes
// alternating ~4189/4187 — two states ping-ponging).
//
// Suspect root cause: the owned-model restore (enable path) writes the
// dual slot's saved `drawerSide` through host.setSide. In this runtime the
// host settings bridge is NO-GO (patchHostDrawerSettings can only stamp a
// local cache), so the real DOM never flips. applyMainDrawerSideChange
// installs the side OVERRIDE anyway and — because the DOM never settles to
// the desired side — keeps it forever:
//   - getMainDrawerSide() (override) says 'right' while the real drawer is
//     'left' → createSecondarySidebar mounts on the OPPOSITE of the
//     override ('left') = SAME side as the real main drawer.
//   - observe() reports drawerSide from the override → the model converges
//     on a side the DOM does not have (persisted drawerSide poison).
//
// This test drives the REAL enable path (requestSecondDrawerMode →
// restoreSingleModeLayout → bootstrapFromLayout) with the REAL drawer-sync
// side machinery, host-settings (NO-GO), store, dispatch, and a side-aware
// FakeHost, and asserts:
//   E1: the secondary shell mounts on the SAME side as the DOM main drawer
//       (bug reproduced — must be OPPOSITE).
//   E2: the side override stays stuck after the enable (must be cleared).
//   E3: the persisted model side equals the slot side, not the real DOM
//       side (poison — must follow the real DOM).
//   E4: the enable flow itself must not cascade SAVE_LAYOUT writes.
//   E5: with a GO host bridge (test seam), the override settles and the
//       shells end up on opposite sides.

;(globalThis as any).document = (() => {
  const classSet = new Set<string>(['wrapperLeft', 'wrapperOpen'])
  const wrapper: any = {
    classList: {
      toString() { return [...classSet].join(' ') },
      add(...cs: string[]) { for (const c of cs) classSet.add(c) },
      remove(...cs: string[]) { for (const c of cs) classSet.delete(c) },
      contains(c: string) { return classSet.has(c) },
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    getAttribute: () => null,
    offsetWidth: 400,
    isConnected: true,
  }
  ;(globalThis as any).__setMainWrapperSideForTest = (side: 'left' | 'right') => {
    classSet.delete('wrapperLeft')
    classSet.delete('wrapperRight')
    classSet.add(side === 'left' ? 'wrapperLeft' : 'wrapperRight')
  }
  const sidebar: any = {
    closest(sel: string) {
      if (typeof sel === 'string' && sel.includes('_wrapper_')) return wrapper
      return null
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  }
  return {
    querySelector: (sel: string) => {
      if (sel === '[data-spindle-mount="sidebar"]') return sidebar
      if (
        sel === '[data-spindle-mount="main-wrapper"]' ||
        sel === '[class*="wrapper"]' ||
        sel === '.wrapperLeft, .wrapperRight, [class*="wrapper"]'
      ) return wrapper
      return null
    },
    querySelectorAll: () => [],
    createElement: () => ({
      classList: { add() {}, remove() {}, contains() { return false }, toggle() {} },
      style: { setProperty() {}, removeProperty() {}, getPropertyValue() { return '' } },
      setAttribute() {}, getAttribute: () => null, appendChild() {}, remove() {}, removeChild() {},
      addEventListener() {}, removeEventListener() {}, querySelector: () => null,
      querySelectorAll: () => [], dataset: {}, isConnected: false, offsetWidth: 0, offsetHeight: 0,
    }),
    getElementById: () => null,
    documentElement: {
      classList: { add() {}, remove() {}, contains() { return false } },
      style: { setProperty() {}, removeProperty() {}, getPropertyValue() { return '' } },
    },
    body: { appendChild() {}, removeChild() {} },
    head: { appendChild() {} },
  }
})()
;(globalThis as any).window = {
  matchMedia: () => ({ matches: false }),
  addEventListener: () => {},
  removeEventListener: () => {},
  innerWidth: 1280,
  spindle: undefined,
}
;(globalThis as any).requestAnimationFrame = (cb: (t: number) => void) =>
  setTimeout(() => cb(Date.now()), 0) as unknown as number
;(globalThis as any).cancelAnimationFrame = () => {}
;(globalThis as any).CSS = { escape: (s: string) => s }
;(globalThis as any).getComputedStyle = () => ({})
;(globalThis as any).MutationObserver = (() => {
  const live: Array<{ cb: MutationCallback }> = []
  class StubMO {
    constructor(cb: MutationCallback) { live.push({ cb }) }
    observe() {}
    disconnect() {}
    takeRecords() { return [] }
  }
  ;(StubMO as any).__fireAll = () => {
    for (const l of live.splice(0)) {
      try { l.cb([], {} as MutationObserver) } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[repro] MO callback threw:', err)
      }
    }
  }
  return StubMO
})()
;(globalThis as any).ResizeObserver = class {
  observe() {}
  disconnect() {}
}

import { mock } from 'bun:test'

// ── Side-aware fake secondary (mirrors the REAL contract) ──
// mount side = opposite of getMainDrawerSide() (createSecondarySidebar
// reads it at mount). open/close flip module state AND dispatch the real
// setDrawer intent (persistSecondaryDrawerOpen's contract).
const secondaryState = {
  open: false,
  mountedSide: null as 'left' | 'right' | null,
  wrapper: null as unknown | null,
}

mock.module('../../sidebar/secondary', () => ({
  SECONDARY_WIDTH_VAR: '--sidebar-ux-secondary-width',
  PUZZLE_ICON_SVG: '',
  isSecondarySidebarOpen: () => secondaryState.open,
  getSecondaryWrapper: () => secondaryState.wrapper,
  getSecondaryDrawer: () => secondaryState.wrapper,
  getSecondaryPanel: () => null,
  getSecondaryTabList: () => null,
  isSecondaryShellLive: () => secondaryState.wrapper !== null,
  getClosedTransformPx: () => 0,
  createSecondarySidebar: () => ({}),
  mountSecondarySidebar: (opts?: { initialOpen?: boolean }) => {
    // REAL contract (secondary.tsx:141): anchors opposite the main drawer.
    // Imported lazily so the mock does not read a stale module-time value.
    void import('../../store').then((store) => {
      secondaryState.mountedSide = store.getMainDrawerSide() === 'left' ? 'right' : 'left'
      secondaryState.open = opts?.initialOpen === true
      secondaryState.wrapper = {
        querySelector: () => null,
        querySelectorAll: () => [],
        classList: { add() {}, remove() {}, contains() { return false } },
        style: {},
        dataset: {},
        isConnected: true,
      }
    })
  },
  unmountSecondarySidebar: () => {
    secondaryState.open = false
    secondaryState.wrapper = null
  },
  tearDownSecondarySidebar: () => {
    secondaryState.open = false
    secondaryState.wrapper = null
  },
  ensureSecondaryShellMounted: () => true,
  liveIdForFacadeKey: (key: string) => key,
  openSecondarySidebar: () => {
    if (!secondaryState.wrapper || secondaryState.open) return
    secondaryState.open = true
    void import('../../recon/dispatch').then((m) => {
      void m.dispatch({ t: 'setDrawer', side: 'secondary', open: true })
    })
  },
  closeSecondarySidebar: (opts?: { silent?: boolean }) => {
    if (!secondaryState.open) return
    secondaryState.open = false
    if (!opts?.silent) {
      void import('../../recon/dispatch').then((m) => {
        void m.dispatch({ t: 'setDrawer', side: 'secondary', open: false })
      })
    }
  },
  persistSecondaryDrawerOpen: (open: boolean) => {
    void import('../../recon/dispatch').then((m) => {
      void m.dispatch({ t: 'setDrawer', side: 'secondary', open })
    })
  },
  reassignSecondaryTabsFromModel: () => {},
}))

// ── Main mirror: headless no-ops ──
mock.module('../../sidebar/main-mirror-drawer', () => ({
  getMainMirrorWrapper: () => null,
  getMainMirrorDrawer: () => null,
  getMainMirrorTitleEl: () => null,
  getMainMirrorTabList: () => null,
  getMainMirrorPanelContent: () => null,
  getMainMirrorWidthVar: () => '',
  isCanvasMainOpen: () => false,
  isMainMirrorActive: () => false,
  reconcileMainMirrorDrawer: () => {},
  updateMainMirrorDrawerTabVisibility: () => {},
  onMainMirrorTabActivated: () => {},
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

mock.module('../../sidebar/strip-gutter', () => ({
  updateStripGutters: () => {},
}))

// ── features/registry: single feature mirroring secondSidebarFeature.apply ──
mock.module('../../features/registry', () => ({
  FEATURES: [
    {
      id: 'secondSidebarEnabled',
      mount() {},
      apply(prev: any, next: any) {
        if (prev.secondSidebarEnabled === next.secondSidebarEnabled) return
        if (next.secondSidebarEnabled) {
          void import('../../sidebar/secondary').then((s) => {
            void import('../../settings/state').then((st) => {
              const layout = st.getDualLayoutSlot() ?? st.getLastLoadedLayout()
              const open = !!(
                st.getSettings().persistDrawerOpenState &&
                layout?.secondary?.open === true &&
                (layout?.detachedTabs?.length ?? 0) > 0
              )
              s.mountSecondarySidebar({ initialOpen: open })
            })
          })
        } else {
          void import('../../sidebar/secondary').then((s) => s.unmountSecondarySidebar())
        }
      },
    },
  ],
}))

// settings/panel: the real applySettings bails when the settings panel was
// never mounted (headless). Mirror it with the feature loop so setSettings
// still drives the secondSidebar feature's mount/teardown.
mock.module('../../settings/panel', () => ({
  applySettings: (prev: any, next: any) => {
    void import('../../features/registry').then(({ FEATURES }) => {
      for (const f of FEATURES) {
        if (!f.apply) continue
        if (prev[f.id] === next[f.id]) continue
        f.apply(prev, next, null as any)
      }
    })
  },
  buildSettingsPanelDOM: () => {},
  setPanelRefresh: () => {},
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

// ── Dynamic imports (AFTER all mock.module calls) ──
const [{ requestSecondDrawerMode }] = await Promise.all([import('../second-drawer-mode')])
const [{ getSettings, setSettings, setDualLayoutSlot, setSingleLayoutSlot, hydrateSettings }] =
  await Promise.all([import('../state')])
const [
  {
    bootstrapFromLayout,
    shutdown,
    flush,
    getModel,
    dispatch,
    snapshotOwnedModelLayout,
  },
] = await Promise.all([import('../../recon/dispatch')])
const [{ armLayoutRepo, __resetLayoutRepoForTest, setLayoutRepoBackendCtx }] =
  await Promise.all([import('../../persist/layout-repo')])
const [{ setSettingsRepoBackendCtx, armSettingsRepo, __resetSettingsRepoForTest }] =
  await Promise.all([import('../../persist/settings-repo')])
const [{ serializeModelToLayout }] = await Promise.all([import('../../persist/layout-model')])
const [
  {
    applyMainDrawerSideChange,
    resetSideRemountStateAfterDisable,
    __setSideSettleHardMsForTest,
    __resetSideApplyStateForTest,
    __setLastKnownSideForTest,
    startSideChangeWatcher,
    stopSideChangeWatcher,
  },
] = await Promise.all([import('../../sidebar/drawer-sync')])
const [{ setMainDrawerSideOverride, getMainDrawerSideOverride, getMainDrawerSide }] =
  await Promise.all([import('../../store')])
const [{ __setHostSetSettingForTest, patchHostDrawerSettings, clearHostSettingsCache }] =
  await Promise.all([import('../../dom/host-settings')])
import { FakeHost, type LiveTab } from '../../host/fake/implementation'
const {
  createEmptyModel,
  builtinKey,
  extensionKey,
} = await import('../../core/model')
import type { TabKey, Side, DrawerSide, ObservedWorld } from '../../core/model'
const { __setMainTabPinEnabledForTest, __resetMainTabPinForTest } =
  await import('../../sidebar/main-tab-pin')

const PROFILE = builtinKey('profile')
const LOOM = builtinKey('loom')
const CORTEX = builtinKey('cortex')

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

function makeLiveTab(key: TabKey, liveId: string, location: Side, overrides?: Partial<LiveTab>): LiveTab {
  return {
    key, liveId, location,
    hidden: false,
    activeInPrimary: false,
    activeInSecondary: false,
    hasContentRoot: true,
    isBuiltin: key.startsWith('builtin:'),
    ...overrides,
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function settle(): Promise<void> {
  await sleep(10)
  await flush()
  await sleep(10)
  await flush()
}

// ── SideAwareHost: the LIVE LumiverseHost coupling ──
// observe() derives drawerSide from the REAL getMainDrawerSide (override-
// aware) and secondaryOpen from the (mocked) shell state — exactly like
// implementation.ts:325-329. setSide goes through the REAL host-settings
// bridge (NO-GO headless → cache-only) + the REAL applyMainDrawerSideChange.
// setDrawer('secondary') drives the REAL open/close → persistSecondaryDrawerOpen.
class SideAwareHost extends FakeHost {
  observe(): ObservedWorld {
    const base = super.observe()
    return {
      ...base,
      drawerSide: getMainDrawerSide() === 'left' ? 'left' : 'right',
      secondaryOpen: (secondaryState as { open: boolean }).open,
    }
  }
  async setSide(side: DrawerSide): Promise<'ok' | 'degraded' | 'failed'> {
    const ok = patchHostDrawerSettings({ side })
    // Mirrors the FIXED LumiverseHost.setSide: only drive the Canvas-side
    // flip (override + remount + settle) when the host accepted the write.
    // On NO-GO the DOM never flips — installing the override would stick.
    if (ok) {
      try {
        await applyMainDrawerSideChange(side)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[SideAwareHost] applyMainDrawerSideChange threw:', err)
      }
    }
    return ok ? 'ok' : 'degraded'
  }
  async setDrawer(side: Side, s: { open: boolean; width: number }): Promise<'ok' | 'degraded' | 'failed'> {
    if (side === 'secondary') {
      if (s.open) openSecondarySidebar()
      else closeSecondarySidebar()
      return 'ok'
    }
    return super.setDrawer(side, s as any)
  }
}
// Referenced from the mock surface (openSecondarySidebar is inside the mock
// module scope; import here so the class body binds the mock's function).
const { openSecondarySidebar, closeSecondarySidebar } = await import('../../sidebar/secondary')

function resetGlobal(): void {
  shutdown()
  __resetLayoutRepoForTest()
  __resetSettingsRepoForTest()
  __resetSideApplyStateForTest()
  __setSideSettleHardMsForTest(60)
  __setLastKnownSideForTest(null)
  setMainDrawerSideOverride(null)
  stopSideChangeWatcher()
  clearHostSettingsCache()
  __setHostSetSettingForTest(null)
  __resetMainTabPinForTest()
  __setMainTabPinEnabledForTest(false)
  ;(globalThis as any).__setMainWrapperSideForTest?.('left')
  secondaryState.open = false
  secondaryState.wrapper = null
  secondaryState.mountedSide = null
  hydrateSettings({ secondSidebarEnabled: false, persistDrawerOpenState: true, persistDrawerWidth: true })
}

function recordingBackend() {
  const writes: any[] = []
  const backend = {
    sendToBackend(message: { type: string; [key: string]: unknown }) {
      if (message.type === 'SAVE_LAYOUT') writes.push(message.layout)
    },
    onBackendMessage() { return () => {} },
  }
  setLayoutRepoBackendCtx(backend)
  setSettingsRepoBackendCtx(backend)
  armLayoutRepo()
  armSettingsRepo()
  return writes
}

// The user's disk state: dual slot carries drawerSide 'right' (dual era);
// the live main drawer is on the LEFT (single slot says 'left' — the
// disable-time restore put it back on the left).
const DUAL_SLOT: any = {
  version: 'test-v1.0',
  primary: { open: true, width: 414, tabId: 'profile' },
  secondary: { open: true, width: 420, activeTabId: 'loom' },
  tabOrder: ['profile', 'loom', 'cortex'],
  detachedTabs: [
    { tabId: 'loom', tabTitle: 'builtin:loom', sidebar: 'secondary' },
    { tabId: 'cortex', tabTitle: 'builtin:cortex', sidebar: 'secondary' },
  ],
  hiddenTabIds: [],
  drawerSide: 'right',
}
const SINGLE_SLOT: any = {
  version: 'test-v1.0',
  primary: { open: true, width: 414, tabId: 'profile' },
  secondary: { open: false, width: 420 },
  detachedTabs: [],
  tabOrder: ['profile', 'loom', 'cortex'],
  hiddenTabIds: [],
  drawerSide: 'left',
}

function dualHost(): SideAwareHost {
  return new SideAwareHost([
    makeLiveTab(PROFILE, 'profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(LOOM, 'loom', 'secondary', { activeInSecondary: true }),
    makeLiveTab(CORTEX, 'cortex', 'secondary'),
  ])
}

// ============================================================================
// E1–E4 — ENABLE with side mismatch, NO-GO host bridge (the user's runtime)
// ============================================================================
async function testEnableSideMismatchNoGo() {
  resetGlobal()
  const writes = recordingBackend()
  const host = dualHost()
  setDualLayoutSlot(DUAL_SLOT)
  setSingleLayoutSlot(SINGLE_SLOT)

  // The app is already booted in single mode (cold-load bootstrap), then the
  // user toggles "Enable second drawer".
  bootstrapFromLayout(SINGLE_SLOT, host, 'test-v1.0')
  await settle()
  await sleep(150) // drain the boot settings/layout debounce
  writes.length = 0

  await requestSecondDrawerMode(true)
  await settle()
  await sleep(80) // settle-timeout + debounce windows
  await settle()

  const model = getModel()
  assert(model != null, 'E1: model present after enable')
  if (model) {
    assertEqual(model.side, 'left', 'E1: model side converges to the REAL DOM side (left)')
  }
  console.log(`[E] mountedSide=${secondaryState.mountedSide} domSide=${getMainDrawerSide()} override=${getMainDrawerSideOverride()}`)
  assertEqual(secondaryState.mountedSide, 'right', 'E2: secondary mounts OPPOSITE the real DOM main side (left → right)')
  assertEqual(getMainDrawerSideOverride(), null, 'E3: side override cleared after enable (not stuck)')
  console.log(`[E] SAVE_LAYOUT writes during enable: ${writes.length}`)
  assert(writes.length <= 6, `E4: enable produces bounded writes, got ${writes.length}`)

  // The persisted blob must carry the REAL DOM side, not the slot fantasy.
  const blob = snapshotOwnedModelLayout()
  if (blob) {
    assertEqual(blob.drawerSide, 'left', 'E5: persisted drawerSide follows the REAL DOM side (left)')
  }
  // The NO-GO side writes must never stamp the host-settings cache — a
  // phantom cache side ('right') makes the Configure draft read
  // `hostSettings?.side || getMainDrawerSide()` as the phantom, so every
  // commit re-attempts the impossible swap (the Configure re-swap loop).
  const hc = await import('../../dom/host-settings')
  assertEqual(hc.getHostDrawerSettings()?.side, undefined, 'E5b: NO-GO side writes never stamp the host-settings cache (no phantom side)')
  shutdown()
}

// ============================================================================
// E6 — ENABLE with side mismatch, GO host bridge (test seam: host accepts
// the write and flips its DOM class) — must converge cleanly on the new side.
// ============================================================================
async function testEnableSideMismatchGo() {
  resetGlobal()
  const writes = recordingBackend()
  // GO bridge: setSetting updates the host "store"; the wrapper class flips
  // on the next microtask (React commit simulation).
  let hostSideSetting: 'left' | 'right' = 'left'
  __setHostSetSettingForTest(
    (key: string, value: unknown) => {
      if (key === 'drawerSettings' && value && typeof value === 'object') {
        hostSideSetting = (value as { side?: 'left' | 'right' }).side ?? hostSideSetting
      }
    },
    { side: 'left', tabOrder: [], hiddenTabIds: [] },
  )
  // Simulate the host React commit: wrapper class follows the store write.
  const host = dualHost()
  setDualLayoutSlot(DUAL_SLOT)
  setSingleLayoutSlot(SINGLE_SLOT)

  await sleep(150)
  writes.length = 0

  bootstrapFromLayout(SINGLE_SLOT, host, 'test-v1.0')
  await settle()
  await sleep(150)
  writes.length = 0

  await requestSecondDrawerMode(true)

  // Let the enable's setSide write land; simulate the host React commit
  // flipping the wrapper class to the new side, then fire the wrapper MO
  // (both the side-change watcher and the settle's MO).
  await sleep(20)
  ;(globalThis as any).__setMainWrapperSideForTest('right')
  ;(globalThis as any).MutationObserver?.__fireAll?.()
  await settle()
  await sleep(120)
  ;(globalThis as any).MutationObserver?.__fireAll?.()
  await settle()

  const model = getModel()
  assert(model != null, 'E6: model present after GO enable')
  if (model) {
    assertEqual(model.side, 'right', 'E6: model side follows the flipped host (right)')
  }
  console.log(`[E6] mountedSide=${secondaryState.mountedSide} domSide=${getMainDrawerSide()} override=${getMainDrawerSideOverride()}`)
  assertEqual(secondaryState.mountedSide, 'left', 'E6: secondary mounts opposite the flipped main (right → left)')
  assertEqual(getMainDrawerSideOverride(), null, 'E6: override settled/cleared on GO')
  console.log(`[E6] SAVE_LAYOUT writes during enable: ${writes.length}`)
  assert(writes.length <= 8, `E6: GO enable bounded writes, got ${writes.length}`)
  shutdown()
}

// ============================================================================
// E7 — storm AFTER enable (NO-GO): the user's freeze log shows two states
// ping-ponging forever (bytes alternating 4189/4187). Simulate the DOM
// storm (world flips + tracked-active writers + shell open/close re-asserts)
// and count SAVE_LAYOUT writes. Must be bounded.
// ============================================================================
async function testPostEnableStormNoGo() {
  resetGlobal()
  const writes = recordingBackend()
  const host = dualHost()
  setDualLayoutSlot(DUAL_SLOT)
  setSingleLayoutSlot(SINGLE_SLOT)

  await sleep(150)
  writes.length = 0

  bootstrapFromLayout(SINGLE_SLOT, host, 'test-v1.0')
  await settle()
  await sleep(150)
  writes.length = 0

  await requestSecondDrawerMode(true)
  await settle()

  // Real tracked-active hooks on (mirror key + secondary setter).
  __setMainTabPinEnabledForTest(true)

  // The storm: 12 rounds alternating the observed world between two states
  // (secondary active bounces between loom/cortex) while the tracked writers
  // re-assert and the shell open/close re-asserts. With the old stuck-side
  // bug this mirrored the user's endless flip (every round persisted); with
  // the fix the enable converges the model onto the REAL side and the storm
  // settles.
  const { setActiveSecondaryTabId } = await import('../../tabs/active-tab')
  const base = host.observe()
  for (let i = 0; i < 12; i++) {
    const flip = i % 2 === 0
    const world: ObservedWorld = {
      ...base,
      tabs: base.tabs.map((t) => {
        if (t.key === LOOM) {
          return { ...t, isActiveInSecondary: !flip }
        }
        if (t.key === CORTEX) {
          return { ...t, isActiveInSecondary: flip }
        }
        return t
      }),
    }
    await dispatch({ t: 'syncFromHost', observed: world })
    await settle()
    if (flip) setActiveSecondaryTabId('cortex')
    else setActiveSecondaryTabId('loom')
    await settle()
    // Shell open/close re-asserts (remount churn after side flip).
    if (i % 4 === 0) {
      if (secondaryState.open) closeSecondarySidebar()
      else openSecondarySidebar()
      await settle()
    }
  }
  await settle()

  const model = getModel()
  if (model) {
    const blob = snapshotOwnedModelLayout()
    console.log('[E7] final blob drawerSide:', blob?.drawerSide, 'model.side:', model.side)
    assertEqual(model.side, 'left', 'E7: model side stays on the REAL DOM side through the storm (no poison)')
    if (blob) assertEqual(blob.drawerSide, 'left', 'E7: persisted drawerSide stays on the REAL DOM side')
  }
  console.log(`[E7] SAVE_LAYOUT writes during storm: ${writes.length}`)
  assert(writes.length <= 20, `E7: storm writes bounded, got ${writes.length}`)
  shutdown()
}

await testEnableSideMismatchNoGo()
await testEnableSideMismatchGo()
await testPostEnableStormNoGo()

console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
if (failed > 0) process.exit(1)
