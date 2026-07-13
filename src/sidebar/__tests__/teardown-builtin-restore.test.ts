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
// Run all tests
// =====================================================================

async function main() {
  await testT1_BuiltInRestore()
  await testT2_ExtensionNoCall()
  await testT3_MultipleBuiltins()
  await testT4_OrderBeforeRemoval()
  await testT5_NoAssignments()

  if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
  console.log(`PASS: ${passed}`)
}

main()
