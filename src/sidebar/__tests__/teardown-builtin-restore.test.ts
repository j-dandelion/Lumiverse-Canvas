// Tests for tearDownSecondarySidebar bug fix (2026-06-19):
// When tabs are in the second drawer and Canvas is disabled,
// tabs return to main drawer but do not display their content
// when activated. Root cause: tearDownSecondarySidebar did not
// call requestTabLocation({kind:'main-drawer'}) for built-in tabs,
// so Lumiverse's tabLocations still pointed at the now-removed
// secondary container, and ContainerTabContent could not render.
//
// Run with: bun run src/sidebar/__tests__/teardown-builtin-restore.test.ts

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    console.error(`FAIL: ${message} — expected ${expected}, got ${actual}`)
    failed++
  } else {
    passed++
  }
}

// =====================================================================
// Global DOM stubs (must exist before any module import touches document)
// =====================================================================

let _fakeSecondaryWrapper: any = null
let _fakeMainSidebar: any = null

;(globalThis as any).document = {
  documentElement: {
    style: { setProperty: () => {}, getPropertyValue: () => '', removeProperty: () => {} },
    classList: { add() {}, remove() {}, contains() { return false }, toggle() {} },
    // Reflow shadow ownership writes/removes data-canvas-chat-shadow here.
    _attrs: {} as Record<string, string>,
    setAttribute(name: string, value: string) { this._attrs[name] = value },
    removeAttribute(name: string) { delete this._attrs[name] },
    getAttribute(name: string) { return this._attrs[name] ?? null },
  },
  querySelector(sel: string) {
    if (sel === '[data-spindle-mount="sidebar"]') return _fakeMainSidebar
    if (sel === '.sidebar-ux-resize-handle') return null
    return null
  },
  querySelectorAll(sel: string) {
    if (sel === '.sidebar-ux-resize-handle') return []
    return []
  },
  createElement(tag: string) {
    return {
      tagName: tag.toUpperCase(),
      _attrs: {} as Record<string, string>,
      style: {} as any,
      className: '',
      innerHTML: '',
      textContent: '',
      src: '',
      alt: '',
      width: 0,
      height: 0,
      children: [] as any[],
      classList: {
        _classes: [] as string[],
        add(cls: string) { this._classes.push(cls) },
        contains(cls: string) { return this._classes.includes(cls) },
        toggle(cls: string, force?: boolean) {
          const has = this._classes.includes(cls)
          const shouldAdd = force !== undefined ? force : !has
          if (shouldAdd && !has) this._classes.push(cls)
          if (!shouldAdd && has) this._classes = this._classes.filter(c => c !== cls)
          return shouldAdd
        },
      },
      setAttribute(name: string, value: string) { this._attrs[name] = value },
      getAttribute(name: string) { return this._attrs[name] ?? null },
      setProperty(name: string, value: string, _imp?: string) { this.style[name] = value },
      appendChild(_child: any) {},
      removeChild(_child: any) {},
      remove() {},
      addEventListener(_evt: string, _fn: any) {},
      removeEventListener(_evt: string, _fn: any) {},
      contains(_node: any) { return false },
    }
  },
  body: { appendChild() {}, classList: { add() {}, remove() {}, contains() { return false }, toggle() {} } },
}
;(globalThis as any).CSS = { escape(s: string) { if (s == null) return ''; return s.replace(/([^\w-])/g, '\\$1') } }
;(globalThis as any).getComputedStyle = () => ({ display: '', visibility: '' })
;(globalThis as any).MutationObserver = class { observe() {} disconnect() {} }
;(globalThis as any).ResizeObserver = class { observe() {} disconnect() {} }
;(globalThis as any).HTMLElement = class {}
// Permanent window.matchMedia — survive setupEnv/restoreEnv
;(globalThis as any).window = Object.assign(globalThis.window ?? {}, {
  matchMedia: (_q: string) => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
})

// =====================================================================
// Imports
// =====================================================================

import { setTabAssignment, clearTabAssignments, getTabAssignments } from '../../tabs/assignment'
import { setActiveSecondaryTabId } from '../../tabs/active-tab'
import { __setSecondaryWrapperForTest } from '../secondary'
import { __setDrawerTabsForTest, __setStoreSnapshotForTest } from '../../store'
import { drawerObserver } from '../drawer-observer'

// =====================================================================
// Test helpers
// =====================================================================

let _requestTabLocationCalls: Array<{ tabId: string; location: unknown }> = []
let _origWindow: typeof globalThis.window

function setupEnv(opts: {
  builtInTabIds?: string[]
  extensionTabIds?: string[]
} = {}) {
  _requestTabLocationCalls = []
  _origWindow = globalThis.window
  _fakeMainSidebar = null
  _fakeSecondaryWrapper = null

  const builtInTabIds = opts.builtInTabIds ?? ['databank', 'characters']
  const extensionTabIds = opts.extensionTabIds ?? []

  // Fake main sidebar with safe fallback button (Chats) for
  // tearDownSecondarySidebar's click-to-fallback logic.
  const _sidebarButtons: any[] = []
  for (const id of builtInTabIds) {
    _sidebarButtons.push({
      tagName: 'BUTTON',
      _attrs: { 'data-tab-id': id, title: id } as Record<string, string>,
      className: 'tabBtn',
      style: { display: '' },
      getAttribute(name: string) { return this._attrs[name] ?? null },
      setAttribute(name: string, value: string) { this._attrs[name] = value },
      classList: { contains: () => false },
    })
  }
  _sidebarButtons.push({
    tagName: 'BUTTON',
    _attrs: { title: 'Chats' } as Record<string, string>,
    className: 'tabBtn',
    style: { display: '' },
    getAttribute(name: string) { return this._attrs[name] ?? null },
    setAttribute(name: string, value: string) { this._attrs[name] = value },
    classList: { contains: () => false },
  })
  _fakeMainSidebar = {
    closest(_sel: string) { return null },
    querySelector(sel: string) {
      if (sel.startsWith('button[data-tab-id=')) {
        const m = sel.match(/\[data-tab-id="(.+?)"\]/)
        if (m) {
          const unescaped = m[1].replace(/\\(.)/g, '$1')
          return _sidebarButtons.find((b: any) => b.getAttribute?.('data-tab-id') === unescaped) ?? null
        }
      }
      if (sel === 'button[class*="tabBtnActive"]') return null
      if (sel === '[class*="_panelContent_"]') return null
      if (sel === '[class*="_panel_"]') return null
      return null
    },
    querySelectorAll(sel: string) {
      if (sel === 'button[class*="tabBtn"]') {
        return _sidebarButtons.filter((b: any) => b.className.includes('tabBtn') && b.style.display !== 'none')
      }
      return []
    },
  }

  // Fake secondary wrapper
  const _wrapperChildren: any[] = []
  const fakeWrapper: any = {
    tagName: 'DIV',
    _attrs: {} as Record<string, string>,
    style: {} as any,
    className: 'sidebar-ux-secondary-wrapper',
    children: _wrapperChildren,
    parentElement: null,
    classList: {
      _classes: [] as string[],
      add(cls: string) { this._classes.push(cls) },
      remove(cls: string) { this._classes = this._classes.filter(c => c !== cls) },
      contains(cls: string) { return this._classes.includes(cls) },
      toggle(cls: string, force?: boolean) {
        const has = this._classes.includes(cls)
        const shouldAdd = force !== undefined ? force : !has
        if (shouldAdd && !has) this._classes.push(cls)
        if (!shouldAdd && has) this._classes = this._classes.filter(c => c !== cls)
        return shouldAdd
      },
    },
    querySelector(_sel: string) { return null },
    querySelectorAll(_sel: string) { return [] },
    setAttribute(name: string, value: string) { this._attrs[name] = value },
    getAttribute(name: string) { return this._attrs[name] ?? null },
    hasAttribute(name: string) { return name in this._attrs },
    addEventListener(_evt: string, _fn: any) {},
    removeEventListener(_evt: string, _fn: any) {},
    appendChild(child: any) { _wrapperChildren.push(child); child.parentElement = this },
    removeChild(child: any) { const i = _wrapperChildren.indexOf(child); if (i >= 0) _wrapperChildren.splice(i, 1); return child },
    setProperty(name: string, value: string) { this.style[name] = value },
    remove() { this._removed = true },
  }
  _fakeSecondaryWrapper = fakeWrapper
  __setSecondaryWrapperForTest(fakeWrapper)

  // Store stubs
  __setDrawerTabsForTest([])
  __setStoreSnapshotForTest({ drawerOpen: true })

  // Spindle bridge — getBuiltInTabRoot returns a truthy root for built-in
  // ids, undefined for extension ids. requestTabLocation is captured.
  const _builtInRoots: Record<string, any> = {}
  for (const id of builtInTabIds) {
    _builtInRoots[id] = { tagName: 'DIV', _attrs: {} } // truthy
  }
  const _spindleUi: Record<string, unknown> = {
    getBuiltInTabRoot: (tabId: string) => _builtInRoots[tabId],
    requestTabLocation: (tabId: string, location: unknown) => {
      _requestTabLocationCalls.push({ tabId, location })
    },
    getTabLocation: () => null,
  }
  globalThis.window = {
    spindle: { ui: _spindleUi },
    matchMedia(_q: string) { return { matches: false, addEventListener() {}, removeEventListener() {} } },
  } as any

  // Register built-in tabs with drawerObserver
  for (const id of builtInTabIds) {
    const fakeButton = {
      tagName: 'BUTTON',
      _attrs: { title: id } as Record<string, string>,
      getAttribute(name: string) { return this._attrs[name] ?? null },
      setAttribute(name: string, value: string) { this._attrs[name] = value },
      querySelector(_sel: string) { return null },
    }
    ;(drawerObserver as any).tabs.set(id, {
      tabId: id,
      button: fakeButton,
      extensionId: 'unknown',
      title: id,
    })
  }
}

function restoreEnv() {
  globalThis.window = _origWindow
  _fakeSecondaryWrapper = null
  _fakeMainSidebar = null
  for (const [key] of getTabAssignments()) {
    clearTabAssignments()
    break
  }
  clearTabAssignments()
  ;(drawerObserver as any).tabs.clear()
  __setSecondaryWrapperForTest(null)
  __setDrawerTabsForTest(null)
  __setStoreSnapshotForTest(null)
}

// =====================================================================
// T1: Built-in tab — requestTabLocation({kind:'main-drawer'}) is called
// =====================================================================
async function testT1_BuiltInRestore() {
  setupEnv({ builtInTabIds: ['databank'] })
  try {
    setTabAssignment('databank', 'secondary')
    setActiveSecondaryTabId('databank')

    const { tearDownSecondarySidebar } = await import('../secondary')
    tearDownSecondarySidebar()

    // Verify requestTabLocation was called with {kind:'main-drawer'} for the built-in
    const builtinCall = _requestTabLocationCalls.find(
      (c) => c.tabId === 'databank' && JSON.stringify(c.location) === JSON.stringify({ kind: 'main-drawer' })
    )
    assert(!!builtinCall, 'T1: requestTabLocation called for built-in tab with {kind:"main-drawer"}')
  } finally { restoreEnv() }
}

// =====================================================================
// T2: Extension tab — requestTabLocation is NOT called
// =====================================================================
async function testT2_ExtensionNoCall() {
  setupEnv({ builtInTabIds: ['databank'], extensionTabIds: ['ext-tab'] })
  try {
    // For extension tabs, getBuiltInTabRoot returns undefined
    setTabAssignment('ext-tab', 'secondary')
    setActiveSecondaryTabId('ext-tab')

    const { tearDownSecondarySidebar } = await import('../secondary')
    tearDownSecondarySidebar()

    // No requestTabLocation call for the extension tab
    const extCall = _requestTabLocationCalls.find((c) => c.tabId === 'ext-tab')
    assert(!extCall, 'T2: requestTabLocation NOT called for extension tab (extension tabs use raw DOM reparenting)')
  } finally { restoreEnv() }
}

// =====================================================================
// T3: Multiple built-ins — each gets its own requestTabLocation call
// =====================================================================
async function testT3_MultipleBuiltins() {
  setupEnv({ builtInTabIds: ['databank', 'characters', 'history'] })
  try {
    setTabAssignment('databank', 'secondary')
    setTabAssignment('characters', 'secondary')
    setTabAssignment('history', 'secondary')
    setActiveSecondaryTabId('databank')

    const { tearDownSecondarySidebar } = await import('../secondary')
    tearDownSecondarySidebar()

    const mainDrawerCalls = _requestTabLocationCalls.filter(
      (c) => JSON.stringify(c.location) === JSON.stringify({ kind: 'main-drawer' })
    )
    assertEqual(mainDrawerCalls.length, 3, 'T3: 3 requestTabLocation({kind:main-drawer}) calls for 3 built-ins')
    const ids = mainDrawerCalls.map((c) => c.tabId).sort()
    assertEqual(ids[0], 'characters', 'T3: characters called')
    assertEqual(ids[1], 'databank', 'T3: databank called')
    assertEqual(ids[2], 'history', 'T3: history called')
  } finally { restoreEnv() }
}

// =====================================================================
// T4: Built-in restore happens BEFORE wrapper removal
// (Lumiverse needs the container to still exist when requestTabLocation fires)
// =====================================================================
async function testT4_OrderBeforeRemoval() {
  setupEnv({ builtInTabIds: ['databank'] })
  try {
    setTabAssignment('databank', 'secondary')
    setActiveSecondaryTabId('databank')

    let wrapperRemovedAtCallTime = false
    const _origRequestTabLocation = (globalThis.window as any).spindle.ui.requestTabLocation
    ;(globalThis.window as any).spindle.ui.requestTabLocation = (tabId: string, loc: unknown) => {
      // Check if wrapper has been removed
      wrapperRemovedAtCallTime = !!_fakeSecondaryWrapper._removed
      _origRequestTabLocation(tabId, loc)
    }

    const { tearDownSecondarySidebar } = await import('../secondary')
    tearDownSecondarySidebar()

    assert(!wrapperRemovedAtCallTime, 'T4: requestTabLocation called BEFORE secondary wrapper removal (container must still exist)')
  } finally { restoreEnv() }
}

// =====================================================================
// T5: No assignments — no requestTabLocation calls
// =====================================================================
async function testT5_NoAssignments() {
  setupEnv({ builtInTabIds: ['databank'] })
  try {
    // No assignments set
    const { tearDownSecondarySidebar } = await import('../secondary')
    tearDownSecondarySidebar()

    assertEqual(_requestTabLocationCalls.length, 0, 'T5: no requestTabLocation calls when no assignments')
  } finally { restoreEnv() }
}

// =====================================================================
// T6: tearDownSecondarySidebar's mirror-strip reconcile is liveness-gated
// (2026-09-12 teardown fix)
// =====================================================================
//
// Main-mirror filters display:none host buttons; its observer does NOT
// watch style, so a mid-session teardown (second-drawer toggle off) must
// reconcile the pin strip to pick the unhidden buttons up. On extension
// disable the mirror is already gone and reconcileMainTabListPin →
// reconcileMainMirrorDrawer would REMOUNT the shell (ownership is
// unconditional) — a post-disable Canvas shell with an empty tab list at
// the outer edge. The call is therefore gated on isMainMirrorActive().
import { mock } from 'bun:test'

let _reconcilePinCallCount = 0

async function runTeardownWithMirrorActive(active: boolean): Promise<number> {
  setupEnv({ builtInTabIds: ['databank'] })
  _reconcilePinCallCount = 0

  mock.module('../main-tab-pin', () => ({
    reconcileMainTabListPin: () => { _reconcilePinCallCount++ },
  }))
  mock.module('../main-mirror-drawer', () => ({
    isMainMirrorActive: () => active,
  }))

  try {
    setTabAssignment('databank', 'secondary')

    const { tearDownSecondarySidebar } = await import('../secondary')
    tearDownSecondarySidebar()

    // Yield microtasks so the dynamic import promises resolve and the
    // guarded reconcile path runs (or not).
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  } finally {
    restoreEnv()
  }
  return _reconcilePinCallCount
}

// T6a: mirror INACTIVE (extension disable) → no reconcile, no remount.
const _pinCallsInactive = await runTeardownWithMirrorActive(false)
assert(_pinCallsInactive === 0,
  'T6a: mirror inactive → reconcileMainTabListPin NOT called (no post-disable remount)')

// T6b: mirror ACTIVE (mid-session second-drawer toggle off) → reconcile fires.
const _pinCallsActive = await runTeardownWithMirrorActive(true)
assert(_pinCallsActive >= 1,
  'T6b: mirror active → reconcileMainTabListPin called (strip refresh)')

// Leave the process-global module mocks in a benign state for later tests.
mock.module('../main-tab-pin', () => ({}))
mock.module('../main-mirror-drawer', () => ({ isMainMirrorActive: () => false }))

// =====================================================================
// T7: null wrapper still clears tab assignments
// =====================================================================
async function testT7_NullWrapperClearsAssignments() {
  setupEnv({ builtInTabIds: ['databank'] })
  try {
    // Ensure no secondary wrapper, but leave stale assignments as if a prior
    // path left map entries after the shell was already gone.
    __setSecondaryWrapperForTest(null)
    setTabAssignment('databank', 'secondary')
    setTabAssignment('ghost-tab', 'secondary')
    assert(getTabAssignments().size >= 2, 'T7 precondition: assignments present')

    const { tearDownSecondarySidebar } = await import('../secondary')
    tearDownSecondarySidebar()

    assertEqual(getTabAssignments().size, 0, 'T7: clearTabAssignments runs even when wrapper is null')
  } finally { restoreEnv() }
}

// =====================================================================
// T8: a dead host bridge (SPINDLE_FRONTEND_INACTIVE at disable) must not
// abort the teardown
// =====================================================================
//
// The host invalidates the extension frontend generation BEFORE running the
// cleanup chain, so every ctx.ui call throws. getBuiltInTabRoot used to be
// called unguarded at the top of the per-tab loop: the throw aborted the
// whole function — wrapper left in the DOM, every root still parked, and the
// vanilla drawer rendered empty panels (2026-09-12 live report — lorebook).
async function testT8_HostInactiveDoesNotAbort() {
  setupEnv({ builtInTabIds: ['databank', 'lorebook'] })
  try {
    // Simulate the host's placeholder error during disable.
    ;((globalThis.window as any).spindle.ui as any).getBuiltInTabRoot = () => {
      throw new Error('SPINDLE_FRONTEND_INACTIVE: extension frontend generation is no longer active')
    }
    setTabAssignment('databank', 'secondary')
    setTabAssignment('lorebook', 'secondary')

    const { tearDownSecondarySidebar } = await import('../secondary')
    tearDownSecondarySidebar()

    assert((_fakeSecondaryWrapper as any)?._removed === true,
      'T8: wrapper removed despite the host throwing')
    assertEqual(getTabAssignments().size, 0, 'T8: assignments cleared despite the host throwing')
    assertEqual(_requestTabLocationCalls.length, 0,
      'T8: no host location calls attempted against the dead ctx')
  } finally { restoreEnv() }
}

// =====================================================================
// T9: dead-ctx unregisterContainer falls back to the raw store action
// =====================================================================
//
// During extension disable the host generation-gates ctx.containers, so the
// bridge call throws. The raw Zustand action is still callable and MUST run:
// while the container entry stays registered, the host keeps routing the
// affected tabs into the detached Canvas element and ContainerTabContent
// Pass 3 never resets them to main-drawer (2026-09-12 live report:
// Theme/Lore/Profile panels stayed empty after disable).
async function testT9_ContainerUnregisterStoreFallback() {
  setupEnv({ builtInTabIds: ['lorebook'] })
  try {
    const unregistered: string[] = []
    ;((globalThis.window as any).spindle as any).containers = {
      unregisterContainer: () => {
        throw new Error('SPINDLE_FRONTEND_INACTIVE: extension frontend generation is no longer active')
      },
    }
    __setStoreSnapshotForTest({
      drawerOpen: true,
      unregisterContainer: (id: string) => { unregistered.push(id) },
    })
    setTabAssignment('lorebook', 'secondary')

    const { tearDownSecondarySidebar } = await import('../secondary')
    tearDownSecondarySidebar()

    assertEqual(unregistered.join(','), 'canvas-secondary-drawer',
      'T9: raw store unregisterContainer ran after the ctx call threw')
  } finally { restoreEnv() }
}

// =====================================================================
// T10: store API reached through React fiber hook deps (zustand v5 path)
// =====================================================================
//
// zustand v5's useStore calls
//   React.useCallback(() => selector(api.getState()), [api, selector])
// so the useCallback hook's memoizedState is [callback, [api, selector]] —
// the store API object sits in the deps array. The coarse snapshot cache does
// NOT carry actions (live console: "unregisterContainer unavailable"), so
// callHostStoreAction must find the API through the fiber hook chain.
async function testT10_StoreApiViaFiberDeps() {
  setupEnv({ builtInTabIds: ['lorebook'] })
  try {
    const unregistered: string[] = []
    const api = {
      getState: () => ({
        drawerTabs: [],
        unregisterContainer: (id: string) => { unregistered.push(id) },
      }),
      setState: () => {},
      subscribe: () => () => {},
    }
    const depsHook = { memoizedState: [() => {}, [api, () => {}]], next: null }
    const rootFiber: any = { memoizedState: depsHook, child: null, sibling: null, return: null }
    ;(_fakeMainSidebar as any).__reactFiber$test = rootFiber

    ;((globalThis.window as any).spindle as any).containers = {
      unregisterContainer: () => {
        throw new Error('SPINDLE_FRONTEND_INACTIVE: extension frontend generation is no longer active')
      },
    }

    setTabAssignment('lorebook', 'secondary')
    const { tearDownSecondarySidebar } = await import('../secondary')
    tearDownSecondarySidebar()

    assertEqual(unregistered.join(','), 'canvas-secondary-drawer',
      'T10: raw action called via the fiber-dep store API')
  } finally { restoreEnv() }
}

// =====================================================================
// T11: post-teardown hidden-sync cannot re-hide the restored strips
// (LUMI-21)
//
// AC1: toggling Canvas off must leave the vanilla UI intact. The disable
// chain's restoreHostContent() re-registers host tabs, which re-arms the
// hidden-sync debounce and fires syncHiddenTabsFromHost — post-teardown
// continuations must no-op (lifecycle guard) and the debounce must be
// cancelled, or the vanilla tab strip renders empty of buttons again.
//
// T11-local mocks are registered INSIDE the test, after T1–T10 have
// completed (mock.module is process-global; registering late keeps the
// earlier tests on the real modules).
let _t11HostSettings: any = { side: 'right', tabOrder: [], hiddenTabIds: [] as string[] }
let _t11Secondary: string[] = []
let _t11Mirror: string[] = []
let _t11HostMain: string[] = []

async function testT11_PostTeardownHiddenSync() {
  mock.module('../../dom/host-settings', () => ({
    getHostDrawerSettings: () => _t11HostSettings,
  }))
  mock.module('../../tabs/buttons', () => ({
    applyHiddenTabIdsToSecondary: (ids: ReadonlySet<string>) => { _t11Secondary = [...ids] },
    applyHiddenTabIdsToMirror: (ids: ReadonlySet<string>) => { _t11Mirror = [...ids] },
    applyHiddenTabIdsToHostMain: (ids: ReadonlySet<string>) => { _t11HostMain = [...ids] },
  }))
  mock.module('../../recon/dispatch', () => ({
    getModel: () => null,
    getHost: () => null,
  }))

  const {
    syncHiddenTabsFromHost,
    scheduleSyncHiddenTabsFromHost,
    cancelScheduledHiddenTabsSync,
    resetCanvasHiddenTabIds,
    setCanvasHiddenTabIds,
    hydrateCanvasHiddenFromLayout,
    getCanvasHiddenTabIds,
  } = await import('../../tabs/hidden-tabs')
  const { beginLifecycle, endLifecycle } = await import('../../lifecycle/instance')
  const flush = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

  // T11a (control): with the instance LIVE, the sync applies the stored
  // hidden set to all three strips.
  const gen = beginLifecycle()
  resetCanvasHiddenTabIds()
  _t11HostSettings = { side: 'right', tabOrder: [], hiddenTabIds: ['databank'] }
  _t11Secondary = []; _t11Mirror = []; _t11HostMain = []
  syncHiddenTabsFromHost()
  assert(_t11Secondary.includes('databank'), 'T11a: live sync applies to the secondary strip (control)')
  assert(_t11HostMain.includes('databank'), 'T11a-b: live sync applies to the host main strip (control)')

  // T11b: post-teardown direct sync no-ops — the disable chain's
  // restoreHostContent()-driven pass must not re-hide the restored buttons.
  endLifecycle(gen)
  _t11Secondary = []; _t11Mirror = []; _t11HostMain = []
  setCanvasHiddenTabIds(['databank'])
  syncHiddenTabsFromHost()
  assertEqual(_t11Secondary.length, 0, 'T11b: post-teardown sync does not apply to the secondary strip')
  assertEqual(_t11Mirror.length, 0, 'T11b-b: post-teardown sync does not apply to the mirror strip')
  assertEqual(_t11HostMain.length, 0, 'T11b-c: post-teardown sync does not apply to the host main strip (AC1)')
  await flush(20)
  assertEqual(_t11HostMain.length, 0, 'T11b-d: lazy closed-set continuation inert post-teardown')

  // T11c: a debounce timer armed post-teardown never fires (fire-time
  // generation guard — belt to the cancel's suspenders).
  scheduleSyncHiddenTabsFromHost({ delayMs: 10 })
  await flush(80)
  assertEqual(_t11Secondary.length, 0, 'T11c: post-teardown debounce fire no-ops')

  // T11d: re-enable — cancel sweeps a pending timer armed before teardown
  // completed; the fresh session re-seeds from the hydrated layout.
  const gen2 = beginLifecycle()
  scheduleSyncHiddenTabsFromHost({ delayMs: 10 })
  cancelScheduledHiddenTabsSync()
  await flush(80)
  assertEqual(_t11Secondary.length, 0, 'T11d: cancelled debounce never fires')

  // T11e: the re-enabled session re-seeds from the hydrated layout (the
  // teardown reset cleared the stale set) — an empty layout hide list
  // applies an empty set, leaving the vanilla/Canvas strips unhidden.
  // Host settings are cleared too: the hydrate/layout blob is the truth
  // the fresh session re-seeds from, not the disabled session's memory.
  _t11HostSettings = { side: 'right', tabOrder: [], hiddenTabIds: [] }
  resetCanvasHiddenTabIds() // teardown cleanup registration (setup.ts)
  hydrateCanvasHiddenFromLayout({ hiddenTabIds: [] })
  syncHiddenTabsFromHost()
  assertEqual(_t11Secondary.length, 0, 'T11e: re-seeded empty hide list applies empty (no stale hides)')
  assertEqual(getCanvasHiddenTabIds().length, 0, 'T11e-b: stale hidden set did not survive the toggle')

  _t11HostSettings = { side: 'right', tabOrder: [], hiddenTabIds: [] }
}

// =====================================================================
// Run all tests
// =====================================================================

async function main() {
  await testT1_BuiltInRestore()
  await testT2_ExtensionNoCall()
  await testT3_MultipleBuiltins()
  await testT4_OrderBeforeRemoval()
  await testT5_NoAssignments()
  await testT7_NullWrapperClearsAssignments()
  await testT8_HostInactiveDoesNotAbort()
  await testT9_ContainerUnregisterStoreFallback()
  await testT10_StoreApiViaFiberDeps()
  await testT11_PostTeardownHiddenSync()

  if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
  console.log(`PASS: ${passed}`)
}

main()
