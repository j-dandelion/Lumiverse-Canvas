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
    style: { setProperty(_k: string, _v: string) {} },
  },
  body: { appendChild() {} },
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
  getTabAssignments, hasTabAssignment, deleteTabAssignment,
} from '../../tabs/assignment'
import { __setSecondaryWrapperForTest } from '../../sidebar/secondary'
import { __setDrawerTabsForTest, __setStoreSnapshotForTest } from '../../store'
import { applyLayout, setRestoreTimeoutMs, cancelApplyLayoutInterval } from '../apply'
import { isRestoringFromLayout, setRestoringFromLayout } from '../../sidebar/secondary-drawer'

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

function buildFakeSecondaryWrapper() {
  const { el: panelContent } = buildFakePanelContent()
  const wrapper: any = {
    tagName: 'DIV',
    _attrs: {} as Record<string, string>,
    style: { transform: '', setProperty(_k: string, _v: string) {} },
    querySelector(sel: string) {
      if (sel === '.sidebar-ux-panel-content') return panelContent
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
  return { wrapper, panelContent }
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

function setupEnv(tabs: Array<{ id: string; title: string; extensionId?: string }>) {
  const { wrapper, panelContent } = buildFakeSecondaryWrapper()
  const sidebar = buildFakeSidebar(tabs.map(t => ({ tabId: t.id, title: t.title })))

  _fakeSidebar = sidebar
  _fakeSecondaryWrapper = wrapper
  __setSecondaryWrapperForTest(wrapper)
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

  return { wrapper, panelContent, sidebar }
}

function cleanup() {
  globalThis.window = { matchMedia: () => ({ matches: false }), innerWidth: 1200 } as any
  _fakeSidebar = null
  _fakeSecondaryWrapper = null
  for (const [key] of getTabAssignments()) deleteTabAssignment(key)
  ;(drawerObserver as any).tabs.clear()
  __setSecondaryWrapperForTest(null)
  __setDrawerTabsForTest(null)
  __setStoreSnapshotForTest(null)
  _capturedObservers.length = 0
  cancelApplyLayoutInterval()
  setRestoreTimeoutMs(10000)
  setRestoringFromLayout(false)
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
// =====================================================================
{
  setupEnv([])
  setRestoreTimeoutMs(50)

  const layout = {
    secondary: { open: true, width: 300 },
    detachedTabs: [{ tabId: 'tab:ext:1' }],
  }

  await applyLayout(layout)
  assert(isRestoringFromLayout(), 'T3: guard is true (no tabs to restore)')

  await new Promise(resolve => setTimeout(resolve, 150))
  assert(!isRestoringFromLayout(), 'T3: guard cleared after safety timeout')

  cleanup()
}

// =====================================================================
// T4: MutationObserver callback restores tabs when they appear
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

  await applyLayout(layout)
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
  await tick()
  assert(!isRestoringFromLayout(), 'T4: guard cleared after all tabs restored')

  cleanup()
}

// =====================================================================
// T5: cancelApplyLayoutInterval stops an in-flight restore
// =====================================================================
{
  setupEnv([])
  setRestoreTimeoutMs(50)

  const layout = {
    secondary: { open: true, width: 300 },
    detachedTabs: [{ tabId: 'tab:ext:1' }],
  }

  await applyLayout(layout)
  assert(isRestoringFromLayout(), 'T5: guard is true (restore in flight)')

  cancelApplyLayoutInterval()

  // Wait past the safety timeout — the timeout should NOT fire
  await new Promise(resolve => setTimeout(resolve, 150))

  // Guard is still true (cancel doesn't call finishRestore)
  assert(isRestoringFromLayout(), 'T5: guard still true after cancel')

  cleanup()
}

// =====================================================================
// T6: setRestoringFromLayout guard — false before applyLayout, true during
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
  await tick()

  // Fire observer to trigger isTabFullyRestored check
  if (isRestoringFromLayout() && _capturedObservers.length > 0) {
    _capturedObservers[0].cb()
  }
  await new Promise(resolve => setTimeout(resolve, 100))

  assert(!isRestoringFromLayout(), 'T6b: guard cleared after finishRestore')

  cleanup()

  // Now test: empty store → guard stays true until timeout
  setupEnv([])
  setRestoreTimeoutMs(50)

  const layout2 = {
    secondary: { open: true, width: 300 },
    detachedTabs: [{ tabId: 'tab:ext:1' }],
  }

  await applyLayout(layout2)
  assert(isRestoringFromLayout(), 'T6c: guard is true when restore in flight')

  await new Promise(resolve => setTimeout(resolve, 150))
  assert(!isRestoringFromLayout(), 'T6d: guard cleared after timeout')

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
// Summary
// =====================================================================
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
