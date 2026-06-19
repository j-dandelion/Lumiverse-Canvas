// Tests for DrawerObserver's registration contract and LumiScript isolation.
//
// DrawerObserver watches the main sidebar for buttons with `data-tab-id`
// and registers them in an internal Map. LumiScript dock panels may inject
// buttons with other data-* markers (e.g. `data-canvas-edge`) into the
// same sidebar — these must NOT be mis-registered.
//
// These tests verify the observer's filtering contract and idempotency:
//   T1: Buttons without `data-tab-id` are never registered
//   T2: Dock-panel buttons (edge marker, no data-tab-id) are not registered
//   T3: Duplicate data-tab-id from MutationObserver fires stays at count 1
//
// Custom assertion harness — matches src/sidebar/__tests__/secondary-drawer.test.ts

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

// HTMLElement base class — provides instanceof target and default stubs.
// textContent is a plain (writable) property so test helpers can override it.
;(globalThis as any).HTMLElement = class HTMLElement {
  hasAttribute(_name: string) { return false }
  getAttribute(_name: string) { return null }
  querySelectorAll(_sel: string) { return [] as any[] }
  textContent: string | null = null
}

// Fake sidebar holder — set before each test
let _fakeSidebar: any = null

;(globalThis as any).document = {
  querySelector(sel: string) {
    if (sel === '[data-spindle-mount="sidebar"]') return _fakeSidebar
    return null
  },
  querySelectorAll(_sel: string) { return [] },
}

// Capture the MutationObserver callback so tests can trigger mutations
let _observerCallback: ((mutations: any[]) => void) | null = null
;(globalThis as any).MutationObserver = class MutationObserver {
  _cb: (mutations: any[]) => void
  constructor(cb: (mutations: any[]) => void) {
    this._cb = cb
    _observerCallback = cb
  }
  observe() {}
  disconnect() { _observerCallback = null }
}

;(globalThis as any).CSS = { escape(s: string) { if (s == null) return ''; return s.replace(/([^\w-])/g, '\\$1') } }
;(globalThis as any).getComputedStyle = () => ({ display: '', visibility: '' })

// =====================================================================
// Imports (after DOM stubs)
// =====================================================================
import { DrawerObserver } from '../drawer-observer'

// =====================================================================
// Fake element factories
// =====================================================================

function fakeButton(opts: {
  tabId?: string
  title?: string
  canvasEdge?: string
  text?: string
} = {}) {
  const attrs: Record<string, string> = {}
  if (opts.tabId !== undefined) attrs['data-tab-id'] = opts.tabId
  if (opts.canvasEdge !== undefined) attrs['data-canvas-edge'] = opts.canvasEdge
  if (opts.title !== undefined) attrs['title'] = opts.title

  const btn = new (globalThis.HTMLElement as any)()
  btn.hasAttribute = (name: string) => name in attrs
  btn.getAttribute = (name: string) => attrs[name] ?? null
  btn.setAttribute = (name: string, value: string) => { attrs[name] = value }
  btn.removeAttribute = (name: string) => { delete attrs[name] }
  btn.textContent = opts.text ?? null
  btn.querySelector = (_sel: string) => null
  return btn
}

function fakeSidebarWithButtons(buttons: any[]) {
  return {
    querySelectorAll: (sel: string) => {
      if (sel === '[data-tab-id]') return buttons
      return []
    },
  }
}

function triggerMutation(addedNodes: any[]) {
  if (_observerCallback) {
    _observerCallback([{ type: 'childList', addedNodes, removedNodes: [] }])
  }
}

function triggerRemoval(removedNodes: any[]) {
  if (_observerCallback) {
    _observerCallback([{ type: 'childList', addedNodes: [], removedNodes }])
  }
}

// =====================================================================
// T1: Document current contract — button WITHOUT data-tab-id is NOT
//     registered by DrawerObserver.
//
// Set up DOM with 2 buttons (one with data-tab-id="ext1", one without),
// call start(), assert only ext1 is registered in the observer's map.
// =====================================================================
async function testT1() {
  const observer = new DrawerObserver()
  const btnWithId = fakeButton({ tabId: 'ext1', title: 'Extension 1' })
  const btnWithoutId = fakeButton({ title: 'No Tab ID Button' })

  _fakeSidebar = fakeSidebarWithButtons([btnWithId, btnWithoutId])
  observer.start()

  const tabs = observer.getAllTabs()
  assertEqual(tabs.length, 1, 'T1: only 1 tab registered (button without data-tab-id ignored)')
  assertEqual(tabs[0].tabId, 'ext1', 'T1: registered tabId is "ext1"')
  assertEqual(tabs[0].button, btnWithId, 'T1: registered button reference matches')
  assertEqual(tabs[0].title, 'Extension 1', 'T1: title parsed from button attribute')

  observer.stop()
}

// =====================================================================
// T2: LumiScript dock panel buttons — buttons with edge markers but NO
//     data-tab-id must NOT be registered.
//
// DrawerObserver scans by [data-tab-id] only. Add a button with
// data-canvas-edge="right" (LumiScript marker) but no data-tab-id —
// assert it is not registered.
// =====================================================================
async function testT2() {
  const observer = new DrawerObserver()
  const btnWithId = fakeButton({ tabId: 'ext2', title: 'Extension 2' })
  const dockPanelBtn = fakeButton({ canvasEdge: 'right', title: 'Canvas Dock Panel' })

  _fakeSidebar = fakeSidebarWithButtons([btnWithId, dockPanelBtn])
  observer.start()

  const tabs = observer.getAllTabs()
  assertEqual(tabs.length, 1, 'T2: only 1 tab registered (dock-panel button ignored)')
  assertEqual(tabs[0].tabId, 'ext2', 'T2: registered tabId is "ext2"')

  // Verify the dock-panel button was not touched at all
  const allTabIds = tabs.map((t: any) => t.tabId)
  assert(allTabIds.indexOf('lumiscript-dock') === -1, 'T2: dock-panel button not registered')

  observer.stop()
}

// =====================================================================
// T3: Idempotency — when a button's data-tab-id is mutated (or the same
//     data-tab-id is set on a new button), follow-up MutationObserver
//     fires do NOT double-register it.
//
// Register a tab via start(), then trigger a mutation with a NEW button
// carrying the same data-tab-id. Verify the registration count stays at 1.
// =====================================================================
async function testT3() {
  const observer = new DrawerObserver()
  const btn = fakeButton({ tabId: 'ext3', title: 'Extension 3' })

  _fakeSidebar = fakeSidebarWithButtons([btn])
  observer.start()

  // Initial scan registered 1 tab
  assertEqual(observer.getAllTabs().length, 1, 'T3: initial scan registered 1 tab')

  // Simulate MutationObserver firing with a NEW button carrying same data-tab-id
  const duplicateBtn = fakeButton({ tabId: 'ext3', title: 'Extension 3 Clone' })
  triggerMutation([duplicateBtn])

  // Should still be 1 — idempotent
  assertEqual(observer.getAllTabs().length, 1, 'T3: duplicate mutation did not increase count')

  // Verify it's still the original button, not the duplicate
  assertEqual(
    observer.getTab('ext3')?.button, btn,
    'T3: original button reference preserved (not replaced by duplicate)'
  )

  // Now add a genuinely new tab via mutation — should increase to 2
  const btnNew = fakeButton({ tabId: 'ext4', title: 'Extension 4' })
  triggerMutation([btnNew])
  assertEqual(observer.getAllTabs().length, 2, 'T3: new tab mutation correctly increased count to 2')

  observer.stop()
}

// =====================================================================
// Run all tests
// =====================================================================
async function main() {
  await testT1()
  await testT2()
  await testT3()

  if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
  console.log(`PASS: ${passed}`)
}

main()
