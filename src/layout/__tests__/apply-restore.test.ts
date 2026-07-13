// Tests for applyLayout observer-based restore loop.
// Verifies: basic restore, suffix-drift matching, safety timeout,
// MutationObserver firing, cancelApplyLayoutInterval, and setRestoringFromLayout guard.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { failed++; console.error(`FAIL: ${msg} — expected ${String(expected)}, got ${String(actual)}`) }
}

// =====================================================================
// Global DOM stubs (must exist before any module import touches document)
// =====================================================================

let _fakeSidebar: any = null
let _fakeSecondaryWrapper: any = null

;(globalThis as any).document = {
  querySelector(sel: string) {
    if (sel === '[data-spindle-mount="sidebar"]') return _fakeSidebar
    if (sel === '.sidebar-ux-panel-content') {
      return _fakeSecondaryWrapper?.querySelector('.sidebar-ux-panel-content') ?? null
    }
    return null
  },
  querySelectorAll(_sel: string) { return [] },
  documentElement: {
    style: { setProperty(_k: string, _v: string) {}, removeProperty(_k: string) {} },
    classList: {
      add() {},
      remove() {},
      contains() { return false },
      toggle() { return false },
    },
  },
  body: { appendChild() {}, removeChild() {} },
  createElement(_tag: string) {
    return {
      style: {},
      classList: { add() {}, remove() {}, contains() { return false } },
      setAttribute() {},
      getAttribute() { return null },
      appendChild() {},
      remove() {},
    }
  },
}
;(globalThis as any).CSS = {
  escape(s: string) { if (s == null) return ''; return s.replace(/([^\w-])/g, '\\$1') },
}
;(globalThis as any).getComputedStyle = () => ({ display: '', visibility: '' })
;(globalThis as any).HTMLElement = class {}
;(globalThis as any).requestAnimationFrame = (fn: () => void) => { setTimeout(fn, 0); return 0 }
;(globalThis as any).cancelAnimationFrame = () => {}

// Default window stub (overridden per-test where spindle is needed)
;(globalThis as any).window = {
  matchMedia: () => ({ matches: false }),
  innerWidth: 1200,
}

// MutationObserver stub — captures callbacks for manual firing
interface CapturedObserver {
  cb: (...args: any[]) => void
  target: any
  options: MutationObserverInit | undefined
}
const _capturedObservers: CapturedObserver[] = []
;(globalThis as any).MutationObserver = class {
  private _cb: (...args: any[]) => void
  constructor(cb: (...args: any[]) => void) { this._cb = cb }
  observe(target: any, options?: MutationObserverInit) {
    _capturedObservers.push({ cb: this._cb, target, options })
  }
  disconnect() {}
  takeRecords() { return [] }
}

// =====================================================================
// Imports (after DOM stubs)
// =====================================================================
import { drawerObserver } from '../../sidebar/drawer-observer'
import {
  getTabAssignments, hasTabAssignment, deleteTabAssignment, setTabAssignment,
} from '../../tabs/assignment'
import {
  __setSecondaryWrapperForTest,
  isSecondarySidebarOpen,
  setSecondarySidebarOpen,
} from '../../sidebar/secondary'
import { __setDrawerTabsForTest, __setStoreSnapshotForTest } from '../../store'
import { applyLayout, setRestoreTimeoutMs, cancelApplyLayoutInterval } from '../apply'
import {
  isRestoringFromLayout,
  setRestoringFromLayout,
  isSuppressAutoActivation,
  setSuppressAutoActivation,
} from '../../sidebar/secondary-drawer'
import { getActiveSecondaryTabId, setActiveSecondaryTabId } from '../../tabs/active-tab'

// =====================================================================
// DOM builders
// =====================================================================

function buildFakeRoot(tabId: string) {
  const root: any = {
    tagName: 'DIV',
    parentElement: null,
    _attrs: {} as Record<string, string>,
    style: {} as any,
    getAttribute(name: string) { return root._attrs[name] ?? null },
    setAttribute(name: string, value: string) { root._attrs[name] = value },
    hasAttribute(name: string) { return name in root._attrs },
    removeAttribute(name: string) { delete root._attrs[name] },
  }
  return root
}

function buildFakePanelContent() {
  const _children: any[] = []
  const el: any = {
    tagName: 'DIV',
    className: 'sidebar-ux-panel-content',
    children: _children,
    _attrs: {} as Record<string, string>,
    appendChild(child: any) { child.parentElement = el; _children.push(child) },
    querySelector(sel: string) {
      if (sel.startsWith('[data-canvas-moved')) {
        const idMatch = sel.match(/\[data-canvas-moved="(.+?)"\]/)
        if (idMatch) {
          const target = idMatch[1].replace(/\\(.)/g, '$1')
          for (const c of _children) {
            if (c.getAttribute?.('data-canvas-moved') === target) return c
          }
        }
        return null
      }
      return null
    },
    querySelectorAll(sel: string) {
      if (sel === '[data-canvas-moved]') {
        return _children.filter((c: any) => c.getAttribute?.('data-canvas-moved'))
      }
      return []
    },
    getAttribute(name: string) { return el._attrs[name] ?? null },
    setAttribute(name: string, value: string) { el._attrs[name] = value },
  }
  return { el, _children }
}

function makeClassList(initial: string[] = []) {
  const set = new Set(initial)
  return {
    _set: set,
    add(c: string) { set.add(c) },
    remove(c: string) { set.delete(c) },
    contains(c: string) { return set.has(c) },
    toggle(c: string, force?: boolean) {
      if (force === true) { set.add(c); return true }
      if (force === false) { set.delete(c); return false }
      if (set.has(c)) { set.delete(c); return false }
      set.add(c)
      return true
    },
  }
}

function buildFakeSecondaryWrapper(opts?: { withTabList?: Array<{ tabId: string }> }) {
  const { el: panelContent } = buildFakePanelContent()
  const tabButtons: any[] = (opts?.withTabList ?? []).map((t) => {
    const btn: any = {
      tagName: 'BUTTON',
      classList: makeClassList(),
      style: {} as Record<string, string>,
      _attrs: { 'data-tab-id': t.tabId } as Record<string, string>,
      getAttribute(name: string) { return btn._attrs[name] ?? null },
      setAttribute(name: string, value: string) { btn._attrs[name] = value },
      querySelector(_sel: string) { return null },
    }
    return btn
  })
  const tabList: any = opts?.withTabList
    ? {
        tagName: 'DIV',
        className: 'sidebar-ux-tab-list',
        querySelector(sel: string) {
          if (sel.startsWith('[data-tab-id=')) {
            const m = sel.match(/\[data-tab-id="(.+?)"\]/)
            if (m) {
              const id = m[1].replace(/\\(.)/g, '$1')
              return tabButtons.find((b) => b.getAttribute('data-tab-id') === id) ?? null
            }
          }
          return null
        },
        querySelectorAll(sel: string) {
          if (sel === 'button[data-tab-id]' || sel === 'button.sidebar-ux-tab-active') {
            if (sel === 'button.sidebar-ux-tab-active') {
              return tabButtons.filter((b) => b.classList.contains('sidebar-ux-tab-active'))
            }
            return tabButtons
          }
          return []
        },
        appendChild(child: any) { tabButtons.push(child) },
      }
    : null
  const wrapper: any = {
    tagName: 'DIV',
    _attrs: {} as Record<string, string>,
    style: { transform: '', setProperty(_k: string, _v: string) {} },
    querySelector(sel: string) {
      if (sel === '.sidebar-ux-panel-content') return panelContent
      if (sel === '.sidebar-ux-tab-list') return tabList
      return null
    },
    querySelectorAll(_sel: string) { return [] },
    getAttribute(name: string) { return wrapper._attrs[name] ?? null },
    setAttribute(name: string, value: string) { wrapper._attrs[name] = value },
    removeAttribute(name: string) { delete wrapper._attrs[name] },
    hasAttribute(name: string) { return name in wrapper._attrs },
    addEventListener(_evt: string, _fn: any) {},
    removeEventListener(_evt: string, _fn: any) {},
    appendChild(child: any) { panelContent.appendChild(child) },
    contains(_node: any) { return false },
    setProperty(name: string, value: string) { wrapper.style[name] = value },
  }
  return { wrapper, panelContent, tabList, tabButtons }
}

function buildFakeSidebar(buttons: Array<{ tabId: string; title: string }>) {
  const _sidebarButtons: any[] = buttons.map(b => ({
    tagName: 'BUTTON',
    _attrs: { 'data-tab-id': b.tabId, title: b.title } as Record<string, string>,
    style: { display: '' },
    getAttribute(name: string) { return this._attrs[name] ?? null },
    setAttribute(name: string, value: string) { this._attrs[name] = value },
    querySelector(sel: string) {
      if (sel === 'svg') return { outerHTML: '<svg/>' }
      return null
    },
  }))

  return {
    tagName: 'DIV',
    parentElement: null as any,
    closest(_sel: string) { return null },
    querySelector(sel: string) {
      if (sel.startsWith('button[data-tab-id=')) {
        const idMatch = sel.match(/\[data-tab-id="(.+?)"\]/)
        if (idMatch) {
          const unescaped = idMatch[1].replace(/\\(.)/g, '$1')
          return _sidebarButtons.find(b => b.getAttribute('data-tab-id') === unescaped) ?? null
        }
      }
      if (sel.startsWith('button[title=')) {
        const titleMatch = sel.match(/\[title="(.+?)"\]/)
        if (titleMatch) {
          const unescaped = titleMatch[1].replace(/\\(.)/g, '$1')
          return _sidebarButtons.find(b => b.getAttribute('title') === unescaped) ?? null
        }
      }
      return null
    },
    querySelectorAll(sel: string) {
      if (sel === 'button[title]') return _sidebarButtons
      if (sel.startsWith('button[class*="tabBtn"')) return []
      return []
    },
  }
}

// =====================================================================
// Test helpers
// =====================================================================

function setupEnv(
  tabs: Array<{ id: string; title: string; extensionId?: string }>,
  opts?: { withTabList?: boolean },
) {
  const { wrapper, panelContent, tabButtons } = buildFakeSecondaryWrapper(
    opts?.withTabList ? { withTabList: tabs.map((t) => ({ tabId: t.id })) } : undefined,
  )
  const sidebar = buildFakeSidebar(tabs.map(t => ({ tabId: t.id, title: t.title })))

  _fakeSidebar = sidebar
  _fakeSecondaryWrapper = wrapper
  __setSecondaryWrapperForTest(wrapper)
  setSecondarySidebarOpen(false)
  __setDrawerTabsForTest(tabs.map(t => ({
    id: t.id,
    extensionId: t.extensionId ?? 'test-ext-uuid',
    title: t.title,
    root: buildFakeRoot(t.id),
  })))
  __setStoreSnapshotForTest({ drawerOpen: true })
  globalThis.window = {
    matchMedia: () => ({ matches: false }),
    innerWidth: 1200,
    spindle: { ui: { getBuiltInTabRoot: () => undefined, requestTabLocation: () => {} }, containers: {} },
  } as any

  return { wrapper, panelContent, sidebar, tabButtons }
}

function cleanup() {
  globalThis.window = { matchMedia: () => ({ matches: false }), innerWidth: 1200 } as any
  _fakeSidebar = null
  _fakeSecondaryWrapper = null
  for (const [key] of getTabAssignments()) deleteTabAssignment(key)
  ;(drawerObserver as any).tabs.clear()
  __setSecondaryWrapperForTest(null)
  setSecondarySidebarOpen(false)
  __setDrawerTabsForTest(null)
  __setStoreSnapshotForTest(null)
  _capturedObservers.length = 0
  cancelApplyLayoutInterval()
  setRestoreTimeoutMs(10000)
  setRestoringFromLayout(false)
  setSuppressAutoActivation(false)
  setActiveSecondaryTabId(null)
}

// Wait for microtasks (assignToSecondary is async — reparenting happens after await)
function tick() { return new Promise<void>(resolve => setTimeout(resolve, 0)) }

// =====================================================================
// T1: Basic restore — tab is assigned and guard is cleared
// =====================================================================
{
  setupEnv([{ id: 'tab:ext:1', title: 'My Tab' }])
  setRestoreTimeoutMs(50)

  const layout = {
    secondary: { open: true, width: 300 },
    detachedTabs: [{ tabId: 'tab:ext:1' }],
  }

  await applyLayout(layout)
  await tick() // let assignToSecondary async work complete

  assert(hasTabAssignment('tab:ext:1'), 'T1: tab assigned after applyLayout')

  // The async assignToSecondary reparented the root → isTabFullyRestored returns true.
  // If the initial pass didn't call finishRestore (because assignToSecondary was async),
  // fire the observer to trigger the check.
  if (isRestoringFromLayout() && _capturedObservers.length > 0) {
    _capturedObservers[0].cb()
  }

  // Wait for safety timeout as fallback
  await new Promise(resolve => setTimeout(resolve, 100))

  assert(!isRestoringFromLayout(), 'T1: guard cleared after restore completes')

  cleanup()
}

// =====================================================================
// T2: Suffix-drift matching — stored ":0" matches live ":1"
// =====================================================================
{
  setupEnv([{ id: 'tab:ext:1', title: 'My Tab' }])
  setRestoreTimeoutMs(50)

  // Layout has :0 but store has :1 — suffix-drift should match
  const layout = {
    secondary: { open: true, width: 300 },
    detachedTabs: [{ tabId: 'tab:ext:0' }],
  }

  await applyLayout(layout)
  await tick()

  assert(hasTabAssignment('tab:ext:1'), 'T2: tab assigned (suffix-drift matched :0 → :1)')
  assertEqual(layout.detachedTabs[0].tabId, 'tab:ext:1', 'T2: layout self-healed from :0 to :1')

  // Fire observer + wait for timeout
  if (isRestoringFromLayout() && _capturedObservers.length > 0) {
    _capturedObservers[0].cb()
  }
  await new Promise(resolve => setTimeout(resolve, 100))
  assert(!isRestoringFromLayout(), 'T2: guard cleared')

  cleanup()
}

// =====================================================================
// T3: Safety timeout fires and clears the guard (tabs never available)
// applyLayout now awaits finishRestore, so the promise resolves only after
// the safety timeout when tabs never appear.
// =====================================================================
{
  setupEnv([])
  setRestoreTimeoutMs(50)

  const layout = {
    secondary: { open: true, width: 300 },
    detachedTabs: [{ tabId: 'tab:ext:1' }],
  }

  assert(!isRestoringFromLayout(), 'T3a: guard false before applyLayout')
  await applyLayout(layout)
  assert(!isRestoringFromLayout(), 'T3: guard cleared after applyLayout awaits safety timeout')

  cleanup()
}

// =====================================================================
// T4: MutationObserver callback restores tabs when they appear
// Start applyLayout without awaiting completion so we can inject store mid-flight.
// =====================================================================
{
  // Start with empty store but sidebar has buttons ready
  const { wrapper, panelContent } = buildFakeSecondaryWrapper()
  const sidebar = buildFakeSidebar([{ tabId: 'tab:ext:1', title: 'My Tab' }])
  _fakeSidebar = sidebar
  _fakeSecondaryWrapper = wrapper
  __setSecondaryWrapperForTest(wrapper)
  __setDrawerTabsForTest([]) // empty store
  __setStoreSnapshotForTest({ drawerOpen: true })
  globalThis.window = {
    matchMedia: () => ({ matches: false }),
    innerWidth: 1200,
    spindle: { ui: { getBuiltInTabRoot: () => undefined, requestTabLocation: () => {} }, containers: {} },
  } as any
  setRestoreTimeoutMs(5000) // long timeout — we want to test observer, not timeout

  const layout = {
    secondary: { open: true, width: 300 },
    detachedTabs: [{ tabId: 'tab:ext:1' }],
  }

  const layoutPromise = applyLayout(layout)
  await tick()
  assert(isRestoringFromLayout(), 'T4: guard is true (tab not in store)')
  assert(!hasTabAssignment('tab:ext:1'), 'T4: no assignment yet')

  // Add the tab to the store (simulating extension registration)
  __setDrawerTabsForTest([{
    id: 'tab:ext:1',
    extensionId: 'test-ext-uuid',
    title: 'My Tab',
    root: buildFakeRoot('tab:ext:1'),
  }])

  // Fire the MutationObserver callback
  assert(_capturedObservers.length > 0, 'T4: observer was captured')
  if (_capturedObservers.length > 0) {
    try {
      _capturedObservers[0].cb()
    } catch (e) {
      console.error('T4: observer callback threw:', e)
    }
  }

  // assignToSecondary is async — wait for reparenting to complete
  await tick()
  assert(hasTabAssignment('tab:ext:1'), 'T4: tab assigned after observer fired')

  // Fire observer again to check isTabFullyRestored (now that root is in DOM)
  if (_capturedObservers.length > 0) {
    try { _capturedObservers[0].cb() } catch (e) { console.error('T4: 2nd observer threw:', e) }
  }
  await layoutPromise
  assert(!isRestoringFromLayout(), 'T4: guard cleared after all tabs restored')

  cleanup()
}

// =====================================================================
// T5: cancelApplyLayoutInterval stops an in-flight restore and clears guards
// =====================================================================
{
  setupEnv([])
  setRestoreTimeoutMs(5000)

  const layout = {
    secondary: { open: true, width: 300 },
    detachedTabs: [{ tabId: 'tab:ext:1' }],
  }

  const layoutPromise = applyLayout(layout)
  await tick()
  assert(isRestoringFromLayout(), 'T5: guard is true (restore in flight)')
  assert(isSuppressAutoActivation(), 'T5: suppress is true during restore')

  cancelApplyLayoutInterval()

  // Cancel clears restore/suppress so teardown cannot leave activation deferred
  assert(!isRestoringFromLayout(), 'T5: restoring guard cleared after cancel')
  assert(!isSuppressAutoActivation(), 'T5: suppress cleared after cancel')

  await layoutPromise
  assert(!isRestoringFromLayout(), 'T5: still cleared after applyLayout promise settles')

  cleanup()
}

// =====================================================================
// T6: setRestoringFromLayout guard — false before applyLayout, cleared after await
// =====================================================================
{
  assert(!isRestoringFromLayout(), 'T6a: guard is false before any applyLayout')

  setupEnv([{ id: 'tab:ext:1', title: 'My Tab' }])
  setRestoreTimeoutMs(50)

  const layout = {
    secondary: { open: true, width: 300 },
    detachedTabs: [{ tabId: 'tab:ext:1' }],
  }

  await applyLayout(layout)
  assert(!isRestoringFromLayout(), 'T6b: guard cleared after applyLayout awaits finishRestore')

  cleanup()

  // Empty store → await waits for safety timeout, then guard is clear
  setupEnv([])
  setRestoreTimeoutMs(50)

  const layout2 = {
    secondary: { open: true, width: 300 },
    detachedTabs: [{ tabId: 'tab:ext:1' }],
  }

  await applyLayout(layout2)
  assert(!isRestoringFromLayout(), 'T6c: guard cleared after applyLayout awaits timeout path')

  cleanup()
}

// =====================================================================
// T7: Multiple tabs — all must be restored before guard clears
// =====================================================================
{
  setupEnv([
    { id: 'tab:ext:1', title: 'Tab One' },
    { id: 'tab:ext:2', title: 'Tab Two' },
  ])
  setRestoreTimeoutMs(50)

  const layout = {
    secondary: { open: true, width: 300 },
    detachedTabs: [{ tabId: 'tab:ext:1' }, { tabId: 'tab:ext:2' }],
  }

  await applyLayout(layout)
  await tick()

  assert(hasTabAssignment('tab:ext:1'), 'T7a: tab:ext:1 assigned')
  assert(hasTabAssignment('tab:ext:2'), 'T7b: tab:ext:2 assigned')

  // Fire observer to trigger isTabFullyRestored checks
  if (isRestoringFromLayout() && _capturedObservers.length > 0) {
    _capturedObservers[0].cb()
  }
  await new Promise(resolve => setTimeout(resolve, 100))

  assert(!isRestoringFromLayout(), 'T7c: guard cleared after all tabs restored')

  cleanup()
}

// =====================================================================
// T8: Empty detachedTabs — no restore loop, guard not set
// =====================================================================
{
  const layout = { secondary: { open: true, width: 300 }, detachedTabs: [] }
  await applyLayout(layout)
  assert(!isRestoringFromLayout(), 'T8: guard not set for empty detachedTabs')
  cleanup()
}

// =====================================================================
// T9: Null layout — no-op
// =====================================================================
{
  await applyLayout(null)
  assert(!isRestoringFromLayout(), 'T9: guard not set for null layout')
  cleanup()
}

// =====================================================================
// T10: Observer watches correct target with correct options
// =====================================================================
{
  setupEnv([{ id: 'tab:ext:1', title: 'My Tab' }])

  const layout = {
    secondary: { open: true, width: 300 },
    detachedTabs: [{ tabId: 'tab:ext:1' }],
  }

  await applyLayout(layout)

  assert(_capturedObservers.length > 0, 'T10: observer was created')
  if (_capturedObservers.length > 0) {
    const obs = _capturedObservers[_capturedObservers.length - 1]
    assert(obs.options?.childList === true, 'T10: observer watches childList')
    assert(obs.options?.subtree === true, 'T10: observer watches subtree')
  }

  cleanup()
}

// =====================================================================
// T11: activeTabId suffix-drift — saved :0 resolves to live :1
// =====================================================================
{
  setupEnv([
    { id: 'tab:lore:1', title: 'Lorebook' },
    { id: 'tab:ext:1', title: 'My Tab' },
  ])
  setRestoreTimeoutMs(50)

  const layout = {
    secondary: { open: true, width: 300, activeTabId: 'tab:ext:0' },
    detachedTabs: [
      { tabId: 'tab:lore:0' },
      { tabId: 'tab:ext:0' },
    ],
  }

  await applyLayout(layout)
  await tick()
  if (isRestoringFromLayout() && _capturedObservers.length > 0) {
    _capturedObservers[0].cb()
  }
  await new Promise(resolve => setTimeout(resolve, 100))

  assertEqual(getActiveSecondaryTabId(), 'tab:ext:1', 'T11: active is healed ext:1 not first detached lore')
  assertEqual(layout.secondary.activeTabId, 'tab:ext:1', 'T11: layout.secondary.activeTabId self-healed')
  assert(!isRestoringFromLayout(), 'T11: guard cleared')
  assert(!isSuppressAutoActivation(), 'T11: suppress cleared')

  cleanup()
}

// =====================================================================
// T12: Missing activeTabId falls back to first assigned detached
// =====================================================================
{
  setupEnv([
    { id: 'tab:lore:1', title: 'Lorebook' },
    { id: 'tab:ext:1', title: 'My Tab' },
  ])
  setRestoreTimeoutMs(50)

  const layout = {
    secondary: { open: true, width: 300 },
    detachedTabs: [
      { tabId: 'tab:lore:1' },
      { tabId: 'tab:ext:1' },
    ],
  }

  await applyLayout(layout)
  await tick()
  if (isRestoringFromLayout() && _capturedObservers.length > 0) {
    _capturedObservers[0].cb()
  }
  await new Promise(resolve => setTimeout(resolve, 100))

  assertEqual(getActiveSecondaryTabId(), 'tab:lore:1', 'T12: fallback active is first assigned detached')
  assert(!isRestoringFromLayout(), 'T12: guard cleared')

  cleanup()
}

// =====================================================================
// T13: Saved active wins over last-assigned during multi-tab restore
// =====================================================================
{
  setupEnv([
    { id: 'tab:lore:1', title: 'Lorebook' },
    { id: 'tab:ext:1', title: 'My Tab' },
  ])
  setRestoreTimeoutMs(50)

  // First in list is Lorebook (would win last-assign without suppress);
  // saved active is the second tab.
  const layout = {
    secondary: { open: true, width: 300, activeTabId: 'tab:ext:1' },
    detachedTabs: [
      { tabId: 'tab:lore:1' },
      { tabId: 'tab:ext:1' },
    ],
  }

  await applyLayout(layout)
  await tick()
  if (isRestoringFromLayout() && _capturedObservers.length > 0) {
    _capturedObservers[0].cb()
  }
  await new Promise(resolve => setTimeout(resolve, 100))

  assertEqual(getActiveSecondaryTabId(), 'tab:ext:1', 'T13: final active matches saved, not last assign')
  assert(!isSuppressAutoActivation(), 'T13: suppress cleared after finish')

  cleanup()
}

// =====================================================================
// T14: Async assign settles without main-sidebar observer → finish early
// Regression for hard-refresh built-in restore: reparent mutates the
// secondary panel only, so the main childList observer never re-fires.
// finishRestore must run from assign settle, not the 10s safety timeout.
// =====================================================================
{
  setupEnv([{ id: 'tab:lore:1', title: 'Lorebook' }])
  // Long timeout — if we finish via timeout, the test fails the timing assert.
  setRestoreTimeoutMs(5000)

  const layout = {
    secondary: { open: true, width: 300, activeTabId: 'tab:lore:1' },
    detachedTabs: [{ tabId: 'tab:lore:1' }],
  }

  const t0 = Date.now()
  await applyLayout(layout)
  // Let assignToSecondary async reparent complete. Do NOT fire the
  // MutationObserver — that is the production blind spot.
  await tick()
  await tick()

  assert(hasTabAssignment('tab:lore:1'), 'T14: tab assigned after async assign')
  assert(!isRestoringFromLayout(), 'T14: guard cleared via assign settle (no observer fire)')
  assert(!isSuppressAutoActivation(), 'T14: suppress cleared via assign settle')
  assertEqual(getActiveSecondaryTabId(), 'tab:lore:1', 'T14: active tab set by finishRestore')
  const elapsed = Date.now() - t0
  assert(elapsed < 1000, `T14: finished well under safety timeout (elapsed ${elapsed}ms)`)

  cleanup()
}

// =====================================================================
// T15: Closed secondary restore — activeTabId restored, no button highlight
// Hard refresh with taskbar-mode strip + secondary.open:false: finishRestore
// used to call showSecondaryTab (paint active) then skip close (already
// closed), leaving a highlighted tab on the closed strip.
// =====================================================================
{
  const { tabButtons } = setupEnv(
    [{ id: 'tab:ext:1', title: 'Lorebook' }],
    { withTabList: true },
  )
  setRestoreTimeoutMs(50)
  setSecondarySidebarOpen(false)

  const layout = {
    secondary: { open: false, width: 300, activeTabId: 'tab:ext:1' },
    detachedTabs: [{ tabId: 'tab:ext:1' }],
  }

  await applyLayout(layout)
  await tick()
  await tick()
  if (isRestoringFromLayout() && _capturedObservers.length > 0) {
    _capturedObservers[0].cb()
  }
  await new Promise(resolve => setTimeout(resolve, 100))

  assert(!isRestoringFromLayout(), 'T15: restore finished')
  assert(!isSecondarySidebarOpen(), 'T15: drawer stays closed')
  assertEqual(getActiveSecondaryTabId(), 'tab:ext:1', 'T15: activeTabId restored for reopen')
  const anyActive = tabButtons.some((b: any) => b.classList.contains('sidebar-ux-tab-active'))
  assert(!anyActive, 'T15: no tab button highlighted while closed')

  cleanup()
}

// =====================================================================
// T16: Load previous replace — live secondary tab not in saved layout
// is unassigned (moved back to main). Previously applyLayout only assigned
// saved detachedTabs and left extras on secondary (merge, not replace).
// =====================================================================
{
  setupEnv([
    { id: 'tab:keep:1', title: 'Keep On Secondary' },
    { id: 'tab:extra:1', title: 'Should Return To Main' },
  ])
  setRestoreTimeoutMs(50)
  // Simulate live state after user moved extra tab to secondary while facet was off.
  setTabAssignment('tab:keep:1', 'secondary')
  setTabAssignment('tab:extra:1', 'secondary')

  const layout = {
    secondary: { open: true, width: 300, activeTabId: 'tab:keep:1' },
    detachedTabs: [{ tabId: 'tab:keep:1' }],
  }

  await applyLayout(layout)
  await tick()
  await tick()
  if (isRestoringFromLayout() && _capturedObservers.length > 0) {
    _capturedObservers[0].cb()
  }
  await new Promise(resolve => setTimeout(resolve, 80))

  assert(!isRestoringFromLayout(), 'T16: restore finished')
  assert(hasTabAssignment('tab:keep:1'), 'T16: saved secondary tab still assigned')
  assert(!hasTabAssignment('tab:extra:1'), 'T16: extra live secondary tab unassigned (back to main)')

  cleanup()
}

// =====================================================================
// T17: Load previous with empty detachedTabs — all live secondary cleared
// =====================================================================
{
  setupEnv([
    { id: 'tab:only:1', title: 'Only Secondary' },
  ])
  setRestoreTimeoutMs(50)
  setTabAssignment('tab:only:1', 'secondary')

  const layout = {
    secondary: { open: false, width: 300 },
    detachedTabs: [],
  }

  await applyLayout(layout)
  await tick()
  await tick()
  await new Promise(resolve => setTimeout(resolve, 80))

  assert(!isRestoringFromLayout(), 'T17: restore finished')
  assert(!hasTabAssignment('tab:only:1'), 'T17: empty saved layout unassigns all secondary tabs')

  cleanup()
}

// =====================================================================
// T18: Suffix-drift keep — live secondary with different :N than saved
// is not unassigned as an "extra" (same stripped prefix, unique match).
// =====================================================================
{
  setupEnv([
    { id: 'tab:drift:2', title: 'Drifted Tab' },
  ])
  setRestoreTimeoutMs(50)
  setTabAssignment('tab:drift:2', 'secondary')

  const layout = {
    secondary: { open: true, width: 300, activeTabId: 'tab:drift:1' },
    detachedTabs: [{ tabId: 'tab:drift:1' }],
  }

  await applyLayout(layout)
  await tick()
  await tick()
  if (isRestoringFromLayout() && _capturedObservers.length > 0) {
    _capturedObservers[0].cb()
  }
  await new Promise(resolve => setTimeout(resolve, 80))

  assert(!isRestoringFromLayout(), 'T18: restore finished')
  // After heal, either live id or healed id should remain secondary.
  const stillSecondary =
    hasTabAssignment('tab:drift:2') || hasTabAssignment('tab:drift:1')
  assert(stillSecondary, 'T18: suffix-drift secondary tab kept (not unassigned as extra)')

  cleanup()
}

// =====================================================================
// T19: Cancel race — second applyLayout mid-restore must not let the
// prior kickAssign.finally clobber the new restore's suppress flags.
// Issue 1: generation token short-circuits finishRestore from the old call.
// =====================================================================
{
  setupEnv([
    { id: 'tab:a:1', title: 'Tab A' },
    { id: 'tab:b:1', title: 'Tab B' },
  ])
  setRestoreTimeoutMs(5000)

  const layout1 = {
    secondary: { open: true, width: 300, activeTabId: 'tab:a:1' },
    detachedTabs: [{ tabId: 'tab:a:1' }],
  }
  const layout2 = {
    secondary: { open: true, width: 300, activeTabId: 'tab:b:1' },
    detachedTabs: [{ tabId: 'tab:b:1' }],
  }

  // Start first restore; kickAssign may be in flight (async assignToSecondary).
  const p1 = applyLayout(layout1)
  // Immediate second applyLayout — cancels first (bumps generation) before
  // p1's assign.finally can finishRestore into the new call's flags.
  const p2 = applyLayout(layout2)

  await tick()
  // Mid-flight: either p2 still restoring, or already finished — suppress
  // must not be stuck false while restore is active.
  const midRestoring = isRestoringFromLayout()
  const midSuppress = isSuppressAutoActivation()
  if (midRestoring) {
    assert(midSuppress, 'T19: suppress stays armed while second restore is active')
  }

  // Drain async assigns + observer.
  await tick()
  await tick()
  if (isRestoringFromLayout() && _capturedObservers.length > 0) {
    _capturedObservers[0].cb()
  }
  await new Promise(resolve => setTimeout(resolve, 120))
  await Promise.all([p1, p2])

  assert(!isRestoringFromLayout(), 'T19: guards clear after both promises settle')
  assert(!isSuppressAutoActivation(), 'T19: suppress clear after both promises settle')
  // Second layout wins for tab set (replace unassigns extras).
  assert(hasTabAssignment('tab:b:1'), 'T19: second layout tab assigned')
  assert(!hasTabAssignment('tab:a:1'), 'T19: first layout tab not left secondary')

  cleanup()
}

// =====================================================================
// Summary
// =====================================================================
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
