// Test file: weaver-lane detection and dialog tagging.
//
// Validates:
//   - getActiveModal()==='weaver' tags [role="dialog"][aria-modal="true"]
//   - getActiveModal() returns null or non-weaver removes the tag
//   - Teardown removes the tag
//   - null activeModal (field absent) → no tag
//
// Uses dynamic import() so mock.module is registered before the module loads.

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
  _style: Record<string, string> = {}
  _attrs: Record<string, string> = {}
  _children: StubElement[] = []
  parentElement: StubElement | null = null
  appendChild(c: StubElement) { this._children.push(c); c.parentElement = this }
  remove() { if (this.parentElement) { const i = this.parentElement._children.indexOf(this); if (i >= 0) this.parentElement._children.splice(i, 1) } }
  setAttribute(n: string, v: string) { this._attrs[n] = v }
  getAttribute(n: string) { return this._attrs[n] ?? null }
  hasAttribute(n: string): boolean { return n in this._attrs }
  removeAttribute(n: string) { delete this._attrs[n] }
  get style() { return this._style }
  get children() { return this._children as any }
  querySelector(sel: string): any {
    // data-canvas-weaver-lane attribute search
    if (sel.includes('[data-canvas-weaver-lane]')) {
      const attrName = sel.match(/\[([^\]]+)\]/)?.[1]
      if (attrName && this.hasAttribute(attrName)) return this
      for (const c of this._children) { const f = c.querySelector(sel); if (f) return f }
      return null
    }
    // General attribute selector
    if (sel.startsWith('[') && sel.includes(']')) {
      const parts = sel.slice(1, -1).split('=')
      const attrName = parts[0].trim()
      const attrVal = parts[1]?.replace(/"/g, '').trim()
      if (attrVal !== undefined) {
        if (this.getAttribute(attrName) === attrVal) return this
      } else {
        if (this.hasAttribute(attrName)) return this
      }
      for (const c of this._children) { const f = c.querySelector(sel); if (f) return f }
      return null
    }
    // Default: recursive child search
    for (const c of this._children) { const f = c.querySelector(sel); if (f) return f }
    return null
  }
  querySelectorAll(sel: string): any[] {
    if (sel.includes('[data-canvas-weaver-lane]')) return this._children.filter(c => c.hasAttribute('data-canvas-weaver-lane'))
    return []
  }
  addEventListener() {}
  removeEventListener() {}
}

;(globalThis as any).HTMLElement = StubElement
;(globalThis as any).Element = StubElement

const _styleElements: Record<string, StubElement> = {}
const stubBody = new StubElement()

const stubDoc: any = {
  documentElement: { style: { setProperty: () => {}, getPropertyValue: () => '' } },
  body: stubBody,
  getElementById: (id: string) => _styleElements[id] ?? null,
  createElement: () => new StubElement(),
  querySelector: (sel: string) => {
    if (sel === '[role="dialog"][aria-modal="true"]') {
      return stubBody._children.find(c => c.getAttribute('role') === 'dialog' && c.getAttribute('aria-modal') === 'true') ?? null
    }
    return stubBody.querySelector(sel)
  },
  querySelectorAll: (sel: string) => stubBody.querySelectorAll(sel),
  head: { appendChild: (c: StubElement) => { if (c.id) _styleElements[c.id] = c }, removeChild: () => {} },
  addEventListener: () => {},
  removeEventListener: () => {},
}
;(globalThis as any).document = stubDoc
;(globalThis as any).window = { requestAnimationFrame: (cb: any) => { setTimeout(cb, 0); return 1 }, cancelAnimationFrame: () => {} }
;(globalThis as any).requestAnimationFrame = (cb: any) => { setTimeout(cb, 0); return 1 }
;(globalThis as any).cancelAnimationFrame = () => {}
;(globalThis as any).MutationObserver = class { _cb: any; _target: any; constructor(cb: any) { this._cb = cb } observe(t: any) { this._target = t } disconnect() { this._target = null } takeRecords() { return [] } }

// ── Mocks ──

let _mockActiveModal: string | null = null
let _publishCalled = false

mock.module('../../store', () => ({
  getActiveModal: () => _mockActiveModal,
}))

mock.module('../../chat/reflow', () => ({
  publishContentLaneInsets: () => { _publishCalled = true },
}))

// Suppress dwarn output during tests
mock.module('../../debug/log', () => ({
  dwarn: () => {},
  dlog: () => {},
}))

// ── Dynamic import of module under test ──
const mod = await import('../weaver-lane')
const { startWeaverLane } = mod

// ── Helpers ──
function reset() {
  _mockActiveModal = null
  _publishCalled = false
  // Clear body children
  stubBody._children = []
  // Clear style elements
  for (const k of Object.keys(_styleElements)) delete _styleElements[k]
}

// ── Test 1: Start with no weaver → no tag, publish called ──
reset()
const teardown1 = startWeaverLane()
// Wait for RAF to fire
await new Promise(r => setTimeout(r, 10))
const tagged1 = stubBody.querySelector('[data-canvas-weaver-lane]')
assert(tagged1 === null, 'start with no weaver: no tag')
assert(_publishCalled, 'start calls publishContentLaneInsets')
teardown1()

// ── Test 2: Start with weaver dialog → tags it ──
reset()
// Create and attach a dialog
const dialog2 = new StubElement()
dialog2.setAttribute('role', 'dialog')
dialog2.setAttribute('aria-modal', 'true')
stubBody.appendChild(dialog2)
_mockActiveModal = 'weaver'
const teardown2 = startWeaverLane()
// Wait for RAF (setTimeout 0)
await new Promise(r => setTimeout(r, 10))
const tagged2 = stubBody.querySelector('[data-canvas-weaver-lane]')
assert(tagged2 !== null, 'weaver dialog tagged')
assertEqual(tagged2!.getAttribute('data-canvas-weaver-lane'), '1', 'weaver lane attr = "1"')
teardown2()

// --- Test 3: Non-weaver modal → no tag ---
reset()
const dialog3 = new StubElement()
dialog3.setAttribute('role', 'dialog')
dialog3.setAttribute('aria-modal', 'true')
stubBody.appendChild(dialog3)
_mockActiveModal = 'presets'
const teardown3 = startWeaverLane()
await new Promise(r => setTimeout(r, 10))
const tagged3 = stubBody.querySelector('[data-canvas-weaver-lane]')
assert(tagged3 === null, 'non-weaver modal not tagged')
teardown3()

// --- Test 4: Teardown removes the tag ---
reset()
const dialog4 = new StubElement()
dialog4.setAttribute('role', 'dialog')
dialog4.setAttribute('aria-modal', 'true')
stubBody.appendChild(dialog4)
dialog4.setAttribute('data-canvas-weaver-lane', '1')
_mockActiveModal = 'weaver'
const teardown4 = startWeaverLane()
teardown4()
const tagged4 = stubBody.querySelector('[data-canvas-weaver-lane]')
assert(tagged4 === null, 'teardown removes weaver lane tag')

// --- Test 5: getActiveModal returns null (field absent) → no tag ---
reset()
const dialog5 = new StubElement()
dialog5.setAttribute('role', 'dialog')
dialog5.setAttribute('aria-modal', 'true')
stubBody.appendChild(dialog5)
_mockActiveModal = null
startWeaverLane()
await new Promise(r => setTimeout(r, 10))
const tagged5 = stubBody.querySelector('[data-canvas-weaver-lane]')
assert(tagged5 === null, 'null activeModal: no tag')

// --- Summary ---
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
