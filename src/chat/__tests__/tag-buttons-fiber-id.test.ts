// Test: tagMainSidebarButtons must source the composite id from the REAL
// host store (fiber walk), NOT the observer-derived getDrawerTabs() facade.
//
// 2026-08-17 root cause: getDrawerTabs() prefers the observer inventory
// once it is running. At boot the observer can hold a STALE title-keyed
// extension entry (registered untagged; the tagger's write was missed).
// getDrawerTabs() then serves that stale entry, and the tagger writing
// data-tab-id=<title> from it LOCKS the stale state in forever — the
// observer's updateEntry sees existingId === entry.tabId and early-returns,
// so the boot restore keeps misclassifying the extension as a built-in.
//
// Custom assertion harness, see src/chat/__tests__/reflow-content-insets.test.ts

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

// ── Stub DOM ──
class StubElement {
  tagName = 'DIV'
  className = ''
  _attrs: Record<string, string> = {}
  _children: StubElement[] = []
  parentElement: StubElement | null = null
  appendChild(c: StubElement) { this._children.push(c); c.parentElement = this }
  setAttribute(n: string, v: string) { this._attrs[n] = v }
  getAttribute(n: string) { return this._attrs[n] ?? null }
  removeAttribute(n: string) { delete this._attrs[n] }
  querySelector(_s: string) { return null }
  querySelectorAll() { return [] }
  closest() { return null }
  addEventListener() {}
  removeEventListener() {}
  remove() {}
  get style() { return {} }
  get classList() { return { add() {}, remove() {}, contains: () => false, toggle() {} } }
  get children() { return this._children as any }
}
;(globalThis as any).HTMLElement = StubElement
;(globalThis as any).Element = StubElement

// ── Shared mock state ──
const state = {
  // REAL host store (fiber walk): composite spindle id + real extensionId.
  fiberTabs: [
    { id: 'spindle:ec535e94-9ee1-48e3-8f7d-2a7ceccadd4d:tab:hone:1', title: 'Hone', extensionId: 'ec535e94-9ee1-48e3-8f7d-2a7ceccadd4d', root: {} },
  ],
  // STALE observer facade (what getDrawerTabs returns while the observer
  // holds a pre-tag title-keyed entry).
  observerTabs: [
    { id: 'Hone', title: 'Hone', extensionId: '' },
  ],
  sidebar: null as any,
}

mock.module('../../dom/lumiverse', () => ({
  getMainSidebar: () => state.sidebar,
}))

mock.module('../../store', () => ({
  findStoreData: () => {},
  getDrawerTabs: () => state.observerTabs,
  getHostStoreTabs: () => state.fiberTabs,
}))

mock.module('../../dom/wait-for', () => ({
  waitForElement: () => Promise.resolve(null),
}))

const { tagMainSidebarButtons } = await import('../tag-buttons')

// ── T1: fiber-store id wins over the stale observer facade ──
{
  const btn = new StubElement()
  btn.tagName = 'BUTTON'
  btn.setAttribute('title', 'Hone')
  state.sidebar = {
    querySelectorAll: (sel: string) => (sel === 'button[title]' ? [btn] : []),
  }
  const tagged = tagMainSidebarButtons()
  assertEqual(tagged, 1, 'T1: one button tagged')
  assertEqual(
    btn.getAttribute('data-tab-id'),
    'spindle:ec535e94-9ee1-48e3-8f7d-2a7ceccadd4d:tab:hone:1',
    'T1: data-tab-id is the REAL composite spindle id (not the title-as-id)',
  )
}

// ── T2: already-tagged buttons are skipped ──
{
  const btn = new StubElement()
  btn.tagName = 'BUTTON'
  btn.setAttribute('title', 'Hone')
  btn.setAttribute('data-tab-id', 'spindle:ec535e94-9ee1-48e3-8f7d-2a7ceccadd4d:tab:hone:1')
  state.sidebar = {
    querySelectorAll: (sel: string) => (sel === 'button[title]' ? [btn] : []),
  }
  const tagged = tagMainSidebarButtons()
  assertEqual(tagged, 0, 'T2: tagged button skipped')
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
