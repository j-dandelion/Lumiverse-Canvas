// Test file: computeContentLaneInsets / publishContentLaneInsets extracted
// from updateChatReflow. Validates that the extracted function produces the
// same geometry as the original inline math for all scenarios.
//
// Because mock.module must run before imports, this test uses dynamic
// import() for the module under test and its dependencies.
//
// Custom assertion harness, see src/features/__tests__/chat-reflow-lifecycle.test.ts

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { failed++; console.error(`FAIL: ${msg} -- expected ${String(expected)}, got ${String(actual)}`) }
}

import { mock } from 'bun:test'

// ── Stub DOM (minimal — the mock deps below avoid needing real imports) ──

class StubElement {
  tagName = 'DIV'
  className = ''
  _style: Record<string, string> = {}
  _attrs: Record<string, string> = {}
  _children: StubElement[] = []
  parentElement: StubElement | null = null
  appendChild(c: StubElement) { this._children.push(c); c.parentElement = this }
  get style() {
    const s = this._style
    return { setProperty: (n: string, v: string) => { s[n] = v }, getPropertyValue: (n: string) => s[n] ?? '', removeProperty: (n: string) => { delete s[n] } }
  }
  setAttribute(n: string, v: string) { this._attrs[n] = v }
  getAttribute(n: string) { return this._attrs[n] ?? null }
  get classList() {
    const self = this
    return { contains: (c: string) => self.className.split(/\s+/).includes(c), toString: () => self.className }
  }
  get children() { return this._children as any }
  querySelector(_s: string) { return null }
  querySelectorAll() { return [] }
  closest(sel: string): any {
    let cur: StubElement | null = this
    const sub = sel.match(/\[class\*="([^"]+)"\]/)?.[1]
    if (sub) { while (cur) { if (cur.className?.split(/\s+/).some((c: string) => c.includes(sub))) return cur; cur = cur.parentElement } }
    return null
  }
  getBoundingClientRect() { return { width: 420, height: 600, top: 0, left: 0, right: 420, bottom: 600 } }
  addEventListener() {}
  removeEventListener() {}
  remove() {}
}

;(globalThis as any).HTMLElement = StubElement
;(globalThis as any).Element = StubElement

// ── Mock all reflow module dependencies ──

// State shared between mocks
const state = { mainOpen: false, mainSide: 'right' as 'left' | 'right', secondaryOpen: false, secondaryTabList: false, keepTabs: false, mobile: false, dockLeft: 0, dockRight: 0 }

mock.module('../../sidebar/mobile-exclusion', () => ({
  isMobileViewport: () => state.mobile,
}))

mock.module('../../store', () => ({
  isMainDrawerOpen: () => state.mainOpen,
  getMainDrawerSide: () => state.mainSide,
  getActiveModal: () => null,
  findStoreData: () => {},
  getStoreSnapshot: () => null,
  getDrawerTabs: () => [],
}))

mock.module('../../sidebar/main-mirror-drawer', () => ({
  isMainMirrorActive: () => false,
  isCanvasMainOpen: () => false,
}))

mock.module('../../settings/state', () => ({
  isKeepTabListVisibleEnabled: () => state.keepTabs,
  getSettings: () => ({ keepTabListVisible: state.keepTabs }),
}))

mock.module('../../sidebar/secondary', () => ({
  isSecondarySidebarOpen: () => state.secondaryOpen,
  getSecondaryTabList: () => state.secondaryTabList ? ({} as any) : null,
  SECONDARY_WIDTH_VAR: '--sidebar-ux-secondary-w',
}))

mock.module('../../dom/lumiverse', () => ({
  getMainSidebar: () => null,
  getMainDrawer: () => null,
  getMainWrapper: () => null,
  getMainDrawerWidth: () => 420,
  getChatColumn: () => null,
  getMainPanelContent: () => null,
}))

// Stub document.querySelector for getDockInsets
let _appElStyle: Record<string, string> = {}
const stubDoc: any = {
  documentElement: { style: { setProperty: () => {}, getPropertyValue: () => '', removeProperty: () => {} } },
  body: { querySelector: () => null },
  getElementById: () => null,
  createElement: () => new StubElement(),
  querySelector: (sel: string) => {
    if (sel === '[data-app-root]') {
      return _appElStyle ? { style: { getPropertyValue: (n: string) => (_appElStyle as any)[n] ?? '' } } : null
    }
    return null
  },
  querySelectorAll: () => [],
  head: { appendChild: () => {}, removeChild: () => {} },
  addEventListener: () => {},
  removeEventListener: () => {},
}
;(globalThis as any).document = stubDoc
;(globalThis as any).window = { innerWidth: 1280, matchMedia: () => ({ matches: false, addEventListener: () => {} }), requestAnimationFrame: (cb: any) => { setTimeout(cb, 0); return 1 }, cancelAnimationFrame: () => {} }
;(globalThis as any).MutationObserver = class { constructor() {} observe() {} disconnect() {} }

// ── Dynamic import of module under test ──
// Must happen after mock.module calls above.
const mod = await import('../reflow')
const { computeContentLaneInsets, publishContentLaneInsets, CONTENT_INSET_L_VAR, CONTENT_INSET_R_VAR } = mod

// ── Helper to reset state between tests ──
function reset() {
  state.mainOpen = false
  state.mainSide = 'right'
  state.secondaryOpen = false
  state.secondaryTabList = false
  state.keepTabs = false
  state.mobile = false
  state.dockLeft = 0
  state.dockRight = 0
  _appElStyle = {}
}

// ── Test 1: Main right, open, no secondary ──
reset()
state.mainOpen = true
state.mainSide = 'right'
assertEqual(computeContentLaneInsets().left, 0, 'main right open: left = 0')
assertEqual(computeContentLaneInsets().right, 420, 'main right open: right = 420 (main width)')

// ── Test 2: publishContentLaneInsets sets vars ──
reset()
state.mainOpen = true
state.mainSide = 'right'
const docEl = stubDoc.documentElement
let _publishedL = ''
let _publishedR = ''
docEl.style.setProperty = (n: string, v: string) => {
  if (n === CONTENT_INSET_L_VAR) _publishedL = v
  else if (n === CONTENT_INSET_R_VAR) _publishedR = v
}
publishContentLaneInsets()
assertEqual(_publishedL, '0px', 'publish sets left var to 0px')
assertEqual(_publishedR, '420px', 'publish sets right var to 420px')

// ── Test 3: Main left, open, no secondary ──
reset()
state.mainOpen = true
state.mainSide = 'left'
assertEqual(computeContentLaneInsets().left, 420, 'main left open: left = 420 (main width)')
assertEqual(computeContentLaneInsets().right, 0, 'main left open: right = 0')

// ── Test 4: Secondary open on left side (main right) ──
reset()
state.secondaryOpen = true
state.mainSide = 'right'
assertEqual(computeContentLaneInsets().left, 420, 'secondary open: left = 420 (secondary width)')
assertEqual(computeContentLaneInsets().right, 0, 'secondary open: right = 0 (main closed)')

// ── Test 5: Both drawers open ──
reset()
state.mainOpen = true
state.mainSide = 'right'
state.secondaryOpen = true
assertEqual(computeContentLaneInsets().left, 420, 'both open: left = 420 (secondary)')
assertEqual(computeContentLaneInsets().right, 420, 'both open: right = 420 (main)')

// ── Test 6: Second drawer off (no secondary) ──
reset()
state.mainOpen = true
state.mainSide = 'right'
state.secondaryOpen = false
assertEqual(computeContentLaneInsets().left, 0, 'second off: left = 0')
assertEqual(computeContentLaneInsets().right, 420, 'second off: right = 420')

// ── Test 7: Keep-tabs with secondary strip (closed, strip visible) ──
reset()
state.mainOpen = false
state.mainSide = 'right'
state.keepTabs = true
state.secondaryTabList = true
state.secondaryOpen = false
// main closed but keepTabs → mainWidth = 56 (TAB_LIST_WIDTH_PX) from legacy pin path
// secondary closed with strip → secondaryWidth = 56
// mainSide='right', so left=secondary=56, right=main=56
assertEqual(computeContentLaneInsets().left, 56, 'keep-tabs: left = 56 (secondary strip)')
assertEqual(computeContentLaneInsets().right, 56, 'keep-tabs: right = 56 (main strip via legacy pin path)')

// ── Test 8: Zero secondary tabs (no strip) ──
reset()
state.mainOpen = false
state.mainSide = 'right'
state.keepTabs = true
state.secondaryTabList = false
// main closed but keepTabs → mainWidth = 56
// secondary has no tab list → secondaryWidth = 0
// mainSide='right', so left=secondary=0, right=main=56
assertEqual(computeContentLaneInsets().left, 0, 'zero secondary tabs: left = 0')
assertEqual(computeContentLaneInsets().right, 56, 'zero secondary tabs: right = 56 (main strip via legacy pin path)')

// ── Test 9: Dock clamp (main right, dock right = 100) ──
reset()
state.mainOpen = true
state.mainSide = 'right'
_appElStyle = { '--spindle-dock-right': '100px' }
assertEqual(computeContentLaneInsets().right, 320, 'dock clamp: right = 320 (420 - 100)')

// ── Test 10: Dock wider than drawer ──
reset()
state.mainOpen = true
state.mainSide = 'right'
_appElStyle = { '--spindle-dock-right': '500px' }
assertEqual(computeContentLaneInsets().right, 0, 'dock wider than drawer: right = 0 (clamped)')

// ── Test 11: Mobile viewport → {0,0} ──
reset()
state.mobile = true
state.mainOpen = true
state.mainSide = 'right'
assertEqual(computeContentLaneInsets().left, 0, 'mobile: left = 0')
assertEqual(computeContentLaneInsets().right, 0, 'mobile: right = 0')

// ── Test 12: Mobile publish sets vars to 0px ──
reset()
state.mobile = true
_publishedL = ''
_publishedR = ''
publishContentLaneInsets()
assertEqual(_publishedL, '0px', 'mobile publish: left var = 0px')
assertEqual(_publishedR, '0px', 'mobile publish: right var = 0px')

// ── Summary ──
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
