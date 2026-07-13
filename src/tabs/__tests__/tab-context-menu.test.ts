// Custom assertion harness — see Chronicle testing-conventions.md
let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { failed++; console.error(`FAIL: ${msg} -- expected ${String(expected)}, got ${String(actual)}`) }
}

// ── DOM stubs (must exist before any module import touches document) ──

const _allElements: any[] = []
let _nextId = 1

class StubElement {
  tagName = 'DIV'
  _id = _nextId++
  _attrs: Record<string, string> = {}
  _children: StubElement[] = []
  _parent: StubElement | null = null
  _styleMap: Record<string, string> = {}
  _handlers: Record<string, (...args: any[]) => void> = {}
  textContent = ''
  className = ''
  innerHTML = ''

  constructor(tag?: string) {
    if (tag) this.tagName = tag.toUpperCase()
    _allElements.push(this)
  }

  get parentElement() { return this._parent }

  getAttribute(n: string) { return this._attrs[n] ?? null }
  setAttribute(n: string, v: string) { this._attrs[n] = v }
  removeAttribute(n: string) { delete this._attrs[n] }
  hasAttribute(n: string) { return n in this._attrs }

  get style() {
    const map = this._styleMap
    function setCssText(v: string) {
      v.split(';').filter(Boolean).forEach(part => {
        const colon = part.indexOf(':')
        if (colon > 0) {
          const k = part.slice(0, colon).trim()
          const v = part.slice(colon + 1).trim()
          map[k] = v
        }
      })
    }
    return {
      set cssText(v: string) { setCssText(v) },
      get cssText() { return Object.entries(map).map(([k, v]) => `${k}: ${v}`).join('; ') },
      setProperty(n: string, v: string) { map[n] = v },
      getPropertyValue(n: string) { return map[n] ?? '' },
      removeProperty(n: string) { delete map[n] },
      get display() { return map.display ?? '' },
      set display(v: string) { map.display = v },
      get left() { return map.left ?? '' },
      set left(v: string) { map.left = v },
      get top() { return map.top ?? '' },
      set top(v: string) { map.top = v },
      get transform() { return map.transform ?? '' },
      set transform(v: string) { map.transform = v },
      get zIndex() { return map['z-index'] ?? '' },
      set zIndex(v: string) { map['z-index'] = v },
    }
  }

  appendChild(c: any) {
    if (c._parent) {
      const idx = c._parent._children.indexOf(c)
      if (idx >= 0) c._parent._children.splice(idx, 1)
    }
    this._children.push(c)
    c._parent = this
    return c
  }

  remove() {
    if (this._parent) {
      const idx = this._parent._children.indexOf(this)
      if (idx >= 0) this._parent._children.splice(idx, 1)
    }
    this._parent = null
  }

  addEventListener(evt: string, fn: (...args: any[]) => void) { this._handlers[evt] = fn }
  removeEventListener(evt: string, _fn: (...args: any[]) => void) { delete this._handlers[evt] }

  dispatchEvent(evt: any) {
    const fn = this._handlers[evt.type]
    if (fn) fn(evt)
  }

  click() {
    const evt = { type: 'click', stopPropagation: () => {} }
    this.dispatchEvent(evt)
  }

  getBoundingClientRect() {
    return { x: 0, y: 0, width: 200, height: 200, top: 0, left: 0, right: 200, bottom: 200 }
  }

  get children() { return this._children }

  querySelector(sel: string): any {
    if (sel === '.canvas-tab-context-menu') {
      return this._children.find(c => c.className === 'canvas-tab-context-menu') ?? null
    }
    for (const c of this._children) {
      const parts = sel.startsWith('.') ? [sel.slice(1)] : []
      if (parts.length && c.className.split(' ').some(p => parts.includes(p))) return c
      const f = c.querySelector(sel)
      if (f) return f
    }
    return null
  }

  querySelectorAll(_sel: string) { return [] }
  closest(_sel: string) { return null }
}

;(globalThis as any).HTMLElement = StubElement
;(globalThis as any).Element = StubElement

const stubBody = new StubElement('body')
;(globalThis as any).document = {
  body: stubBody,
  documentElement: { style: { setProperty: () => {}, getPropertyValue: () => '' } },
  head: { appendChild: () => {}, removeChild: () => {} },
  createElement: (tag?: string) => new StubElement(tag),
  getElementById: () => null,
  querySelector: (sel: string) => stubBody.querySelector(sel),
  querySelectorAll: (sel: string) => stubBody.querySelectorAll(sel),
}
;(globalThis as any).window = {
  innerWidth: 1024,
  innerHeight: 768,
  requestAnimationFrame: (cb: any) => { cb(1); return 1 },
  cancelAnimationFrame: () => {},
}
;(globalThis as any).requestAnimationFrame = (cb: any) => { cb(1); return 1 }
;(globalThis as any).cancelAnimationFrame = () => {}
;(globalThis as any).CSS = { escape: (s: string) => s }
;(globalThis as any).getComputedStyle = () => ({})

// ── Mock transitive deps ──

import { mock } from 'bun:test'

let _mockSyncCalled = false

// Mock drawer-sync to avoid Preact/TSX transitive chain.
// Must include ALL exports that any static-import chain needs — features/registry
// imports syncDrawerTabSettings, so if we omit it the import fails.
let _mockSyncForceShow: boolean | undefined
let _mockIsShowTabLabels = false
mock.module('../../sidebar/drawer-sync', () => {
  return {
    isShowTabLabels: () => _mockIsShowTabLabels,
    syncSecondaryTabLabels: (forceShow?: boolean) => {
      _mockSyncCalled = true
      _mockSyncForceShow = forceShow
    },
    syncDrawerTabSettings: () => {},
    checkSideChanged: () => {},
    restoreSecondaryTabButtons: () => {},
    startSideChangeWatcher: () => {},
    stopSideChangeWatcher: () => {},
    stopDrawerTabResizeWatcher: () => {},
    stopDrawerTabClassObserver: () => {},
    stopDrawerTabStyleObserver: () => {},
  }
})

mock.module('../configure-modal', () => ({
  openConfigureTabsModal: () => {},
}))

mock.module('../../debug/log', () => ({
  dlog: () => {},
  dwarn: () => {},
  setDebug: () => {},
}))

// Mock features/registry to avoid loading sidebar/secondary.tsx etc.
mock.module('../../features/registry', () => ({
  FEATURES: [],
}))

// ── Dynamic imports (must be AFTER mock.module calls — static imports hoist
//    and would pre-load the real drawer-sync via settings/state → panel → features/registry) ──

const [{ getSettings, setSettings }, { __setHostSetSettingForTest, clearHostSettingsCache }] = await Promise.all([
  import('../../settings/state'),
  import('../../dom/host-settings'),
])
const { showAssignmentMenu, hideAssignmentMenu, __setShowAssignmentMenuForTest } = await import('../tab-context-menu')

// There is NO try/catch here — if DOM stubs fail, the test
// fails loudly (which is the right behavior).

// --- Test 1: Multi-item menu structure (second on) ---
hideAssignmentMenu()
const prev1 = getSettings().secondSidebarEnabled
setSettings({ secondSidebarEnabled: true })
try {
  showAssignmentMenu(100, 200, 'test-tab', 'Test Tab')
  const menu = stubBody.querySelector('.canvas-tab-context-menu')
  assert(menu !== null, 'showAssignmentMenu creates a .canvas-tab-context-menu element')
  assertEqual(menu!.children.length, 4, 'menu has exactly 4 children')

  // Item 1: toggle labels
  const toggleItem = menu!.children[0]
  assertEqual(toggleItem.tagName, 'BUTTON', 'first item is a BUTTON')
  assert(
    toggleItem.textContent === 'Show tab labels' || toggleItem.textContent === 'Hide tab labels',
    'first item is label toggle (host wording)',
  )
  // Mock isShowTabLabels → false, so item is "Show tab labels" (not danger).
  // When showLabels is true, host paints danger (--lumiverse-error).
  assert(
    !String(toggleItem.style.cssText || '').includes('lumiverse-error') &&
      !String((toggleItem as any)._styleMap?.color || '').includes('lumiverse-error'),
    'Show tab labels is not danger-colored when labels are hidden',
  )

  // Item 2: configure tabs
  const configureItem = menu!.children[1]
  assertEqual(configureItem.tagName, 'BUTTON', 'second item is a BUTTON')
  assertEqual(configureItem.textContent, 'Configure tabs', 'second item is Configure tabs')

  // Item 3: divider
  const divider = menu!.children[2]
  assertEqual(divider.getAttribute('role'), 'separator', 'third item has role="separator"')

  // Item 4: move
  const moveItem = menu!.children[3]
  assertEqual(moveItem.tagName, 'BUTTON', 'fourth item is a BUTTON')
  assertEqual(moveItem.textContent, 'Move to second drawer', 'fourth item is Move to second drawer')
} finally {
  setSettings({ secondSidebarEnabled: prev1 })
  hideAssignmentMenu()
}

// --- Test 2: Second off → only toggle + configure (no divider, no move) ---
hideAssignmentMenu()
const prev2 = getSettings().secondSidebarEnabled
setSettings({ secondSidebarEnabled: false })
try {
  showAssignmentMenu(100, 200, 'test-tab-gated', 'Gated Tab')
  const menu = stubBody.querySelector('.canvas-tab-context-menu')
  assert(menu !== null, 'showAssignmentMenu creates menu even when second sidebar off')
  assertEqual(menu!.children.length, 2, 'menu has exactly 2 children when second off')

  const toggleItem = menu!.children[0]
  assertEqual(toggleItem.tagName, 'BUTTON', 'first item is a BUTTON')
  assert(
    toggleItem.textContent === 'Show tab labels' || toggleItem.textContent === 'Hide tab labels',
    'first item is label toggle (host wording)',
  )

  const configureItem = menu!.children[1]
  assertEqual(configureItem.tagName, 'BUTTON', 'second item is a BUTTON')
  assertEqual(configureItem.textContent, 'Configure tabs', 'second item is Configure tabs')
} finally {
  setSettings({ secondSidebarEnabled: prev2 })
  hideAssignmentMenu()
}

// --- Test 3: hideAssignmentMenu removes the menu ---
setSettings({ secondSidebarEnabled: true })
showAssignmentMenu(100, 200, 'test-tab-hide', 'Hide Tab')
hideAssignmentMenu()
const menuAfterHide = stubBody.querySelector('.canvas-tab-context-menu')
assert(menuAfterHide === null, 'hideAssignmentMenu removes menu from DOM')

// --- Test 4: patchHostDrawerSettings fail path → still stamps secondary labels ---
// Secondary chrome must follow the click even when the host fiber bridge is
// NO-GO; otherwise Hide tab labels appears to do nothing on the second drawer.
__setHostSetSettingForTest(null)
clearHostSettingsCache()
hideAssignmentMenu()
const prev4 = getSettings().secondSidebarEnabled
setSettings({ secondSidebarEnabled: true })
try {
  _mockSyncCalled = false
  _mockSyncForceShow = undefined
  _mockIsShowTabLabels = true // Hide tab labels → next = false
  showAssignmentMenu(100, 200, 'test-tab-patch-fail', 'Patch Fail Tab')
  const menu = stubBody.querySelector('.canvas-tab-context-menu')
  assert(menu !== null, 'patch fail: menu is created')

  const toggleItem = menu!.children[0]
  assertEqual(toggleItem.tagName, 'BUTTON', 'patch fail: toggle is a button')
  toggleItem.click()
  assert(true, 'patch fail: toggle click did not throw')
  assert(_mockSyncCalled, 'patch fail: sync still called so secondary labels update')
  assertEqual(_mockSyncForceShow, false, 'patch fail: sync receives known next=false')
} finally {
  setSettings({ secondSidebarEnabled: prev4 })
  hideAssignmentMenu()
  __setHostSetSettingForTest(null)
  clearHostSettingsCache()
  _mockIsShowTabLabels = false
}

// --- Test 5: patchHostDrawerSettings success → toggle DOES call sync(next) ---
__setHostSetSettingForTest((_key: string, _value: unknown) => {
  // Mock write succeeds
})
hideAssignmentMenu()
const prev5 = getSettings().secondSidebarEnabled
setSettings({ secondSidebarEnabled: true })
try {
  _mockSyncCalled = false
  _mockSyncForceShow = undefined
  _mockIsShowTabLabels = false // menu says "Show tab labels"; next = true
  showAssignmentMenu(100, 200, 'test-tab-patch-ok', 'Patch OK Tab')
  const menu = stubBody.querySelector('.canvas-tab-context-menu')
  assert(menu !== null, 'patch ok: menu is created')

  const toggleItem = menu!.children[0]
  assertEqual(toggleItem.textContent, 'Show tab labels', 'patch ok: show labels wording')
  toggleItem.click()
  assert(_mockSyncCalled, 'patch ok: toggle click calls syncSecondaryTabLabels when patch succeeds')
  assertEqual(_mockSyncForceShow, true, 'patch ok: sync receives known next=true (not stale re-read)')
} finally {
  setSettings({ secondSidebarEnabled: prev5 })
  hideAssignmentMenu()
  __setHostSetSettingForTest(null)
  clearHostSettingsCache()
  _mockIsShowTabLabels = false
}

// --- Test 6: Hide path — danger color + sync(false) ---
__setHostSetSettingForTest((_key: string, _value: unknown) => {})
hideAssignmentMenu()
const prev6 = getSettings().secondSidebarEnabled
setSettings({ secondSidebarEnabled: true })
try {
  _mockSyncCalled = false
  _mockSyncForceShow = undefined
  _mockIsShowTabLabels = true // labels on → "Hide tab labels" + danger
  showAssignmentMenu(100, 200, 'test-tab-hide-labels', 'Hide Labels Tab')
  const menu = stubBody.querySelector('.canvas-tab-context-menu')
  assert(menu !== null, 'hide path: menu is created')

  const toggleItem = menu!.children[0]
  assertEqual(toggleItem.textContent, 'Hide tab labels', 'hide path: host wording')
  const color =
    (toggleItem as any)._styleMap?.color ||
    String(toggleItem.style.cssText || '')
  assert(
    String(color).includes('lumiverse-error') || String(color).includes('#e54545'),
    'hide path: danger color (host itemDanger)',
  )

  toggleItem.click()
  assert(_mockSyncCalled, 'hide path: sync called')
  assertEqual(_mockSyncForceShow, false, 'hide path: sync receives known next=false')
} finally {
  setSettings({ secondSidebarEnabled: prev6 })
  hideAssignmentMenu()
  __setHostSetSettingForTest(null)
  clearHostSettingsCache()
  _mockIsShowTabLabels = false
}

// --- Summary ---
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
