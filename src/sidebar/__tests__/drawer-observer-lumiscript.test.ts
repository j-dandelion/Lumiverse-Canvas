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
  extensionClass?: boolean
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
  btn.className = opts.extensionClass ? '_tabBtn_1 _tabBtnExtension_2' : ''
  return btn
}

function fakeSidebarWithButtons(buttons: any[]) {
  return {
    querySelectorAll: (sel: string) => {
      if (sel === '[data-tab-id]') return buttons
      // The observer's scan selector combines data-tab-id + the extension
      // class; the stub returns the full button set for either form.
      if (sel.includes('tabBtnExtension')) return buttons
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

function triggerAttribute(target: any, attributeName: string) {
  if (_observerCallback) {
    _observerCallback([{ type: 'attributes', target, attributeName, oldValue: null }])
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
// T4: Untagged extension buttons — host extension buttons WITHOUT
//     data-tab-id (class tabBtnExtension) register by title with the
//     FROZEN key 'ext:unknown/{title}' (never the 'builtin:{title}' wart).
//     When the Canvas tagger later adds data-tab-id, the entry updates its
//     ADDRESS in place — the key never changes (never two entries for one
//     button, never a re-key).
// =====================================================================
async function testT4() {
  const observer = new DrawerObserver()
  const untagged = fakeButton({ title: 'Hone', extensionClass: true })

  _fakeSidebar = fakeSidebarWithButtons([untagged])
  observer.start()

  let tabs = observer.getAllTabs()
  assertEqual(tabs.length, 1, 'T4: untagged extension button registered by title')
  assertEqual(tabs[0].tabId, 'Hone', 'T4: title is the stable id while untagged')
  assertEqual(tabs[0].extensionId, 'unknown', 'T4: extensionId unknown until tagged')
  assertEqual(tabs[0].key, 'ext:unknown/Hone', 'T4: frozen key is ext:unknown/{title} (never builtin:{title})')

  // Tagger adds data-tab-id → address update in place, single entry, key FROZEN.
  // Real Lumiverse format: spindle:{extensionId}:tab:{tabName}:{counter}.
  untagged.setAttribute('data-tab-id', 'spindle:ext1:tab:myTab:1')
  triggerMutation([untagged])

  tabs = observer.getAllTabs()
  assertEqual(tabs.length, 1, 'T4: tagging keeps a single entry')
  assertEqual(tabs[0].tabId, 'spindle:ext1:tab:myTab:1', 'T4: address re-keyed to store id')
  assertEqual(tabs[0].extensionId, 'ext1', 'T4: extensionId parsed from parts[1] (spindle:{extId}:tab:...)')
  assertEqual(tabs[0].key, 'ext:unknown/Hone', 'T4: KEY IS FROZEN across tagging (never re-keyed)')

  // Non-extension chrome without data-tab-id stays unregistered.
  const chrome = fakeButton({ title: 'Settings' })
  _fakeSidebar = fakeSidebarWithButtons([untagged, chrome])
  observer.start() // already started — scan only via mutation in this harness
  triggerMutation([chrome])
  assertEqual(
    observer.getAllTabs().length,
    1,
    'T4: chrome button without id/extension class never registered',
  )

  observer.stop()
}

// =====================================================================
// T5: Attribute-aware updates — the tagger writes data-tab-id via
//     setAttribute; the observer watches attributes and updates the entry
//     IN PLACE (no childList mutation needed, no stale window).
// =====================================================================
async function testT5() {
  const observer = new DrawerObserver()
  const btn = fakeButton({ title: 'Hone', extensionClass: true })

  _fakeSidebar = fakeSidebarWithButtons([btn])
  observer.start()
  assertEqual(observer.getAllTabs()[0].key, 'ext:unknown/Hone', 'T5: untagged extension frozen key')

  // Tagger writes the real id — an ATTRIBUTE mutation (not childList).
  btn.setAttribute('data-tab-id', 'spindle:hone:tab:hone_tab:1')
  triggerAttribute(btn, 'data-tab-id')

  const tabs = observer.getAllTabs()
  assertEqual(tabs.length, 1, 'T5: attribute mutation keeps a single entry')
  assertEqual(tabs[0].tabId, 'spindle:hone:tab:hone_tab:1', 'T5: address updated in place via attribute watch')
  assertEqual(tabs[0].extensionId, 'hone', 'T5: extensionId upgraded in place')
  assertEqual(tabs[0].key, 'ext:unknown/Hone', 'T5: key FROZEN across attribute updates')
  assertEqual(tabs[0].titles.has('Hone'), true, 'T5: titles records the display title')

  // Title rename: the entry keeps its key and records the old title.
  btn.setAttribute('title', 'Hone Renamed')
  triggerAttribute(btn, 'title')
  const renamed = observer.getAllTabs()[0]
  assertEqual(renamed.title, 'Hone Renamed', 'T5: title updated in place')
  assertEqual(renamed.key, 'ext:unknown/Hone', 'T5: key FROZEN across title rename')
  assertEqual(renamed.titles.has('Hone') && renamed.titles.has('Hone Renamed'), true,
    'T5: titles tracks first-seen + current titles')

  observer.stop()
}

// =====================================================================
// T6: Same-key collision — two tabs from the same extension with the same
//     title get an '@N' suffix on the KEY only (addresses stay unique).
// =====================================================================
async function testT6() {
  const observer = new DrawerObserver()
  const a = fakeButton({ tabId: 'spindle:hone:tab:hone_a:1', title: 'Hone' })
  const b = fakeButton({ tabId: 'spindle:hone:tab:hone_b:1', title: 'Hone' })

  _fakeSidebar = fakeSidebarWithButtons([a, b])
  observer.start()

  const keys = observer.getAllTabs().map(t => t.key).sort()
  assertEqual(keys.length, 2, 'T6: both same-title tabs registered')
  assertEqual(keys[0], 'ext:hone/Hone', 'T6: first tab keeps the base key')
  assertEqual(keys[1], 'ext:hone/Hone@2', 'T6: second tab disambiguated with @2 on the key only')

  observer.stop()
}

// =====================================================================
// T7: Builtin classification — bare data-tab-id buttons (no extension
//     class, no spindle prefix) get 'builtin:{id}' keys.
// =====================================================================
async function testT7() {
  const observer = new DrawerObserver()
  const loom = fakeButton({ tabId: 'loom', title: 'Loom' })
  const ext = fakeButton({ tabId: 'spindle:lumi:tab:lumi_books_tab:1', title: 'LumiBooks' })

  _fakeSidebar = fakeSidebarWithButtons([loom, ext])
  observer.start()

  const byId = new Map(observer.getAllTabs().map(t => [t.tabId, t]))
  assertEqual(byId.get('loom')?.key, 'builtin:loom', 'T7: builtin key from bare id')
  assertEqual(byId.get('spindle:lumi:tab:lumi_books_tab:1')?.key, 'ext:lumi/LumiBooks',
    'T7: tagged extension key from spindle parts[1] + title')

  observer.stop()
}

// =====================================================================
// Run all tests
// =====================================================================
async function main() {
  await testT1()
  await testT2()
  await testT3()
  await testT4()
  await testT5()
  await testT6()
  await testT7()

  if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
  console.log(`PASS: ${passed}`)
}

main()
