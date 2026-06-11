// Test file: chat reflow mobile behavior
//
// Validates:
//   1. updateChatReflow() is a no-op on mobile (and clears stale inline vars)
//   2. injectReflowStyles() includes a mobile media query that nullifies
//      margin + transition on the chat column at <=600px
//   3. A matchMedia 'change' listener registered in startReflowObserver:
//        - clears inline margin vars on cross-down (desktop -> mobile)
//        - re-runs updateChatReflow on cross-up (mobile -> desktop)
//   4. The listener is removed by the teardown function
//   5. Toggle on at mobile does not shift the chat
//
// This is the first test in the suite that exercises a real
// MediaQueryListEvent change path. The matchMedia stub stores
// listeners and lets tests fire change events.
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

// --- Stubs ---

class StubObserver {
  static instances: StubObserver[] = []
  observed: { target: any; options: any } | null = null
  constructor(_cb: any) { StubObserver.instances.push(this) }
  disconnect = () => { this.observed = null }
  observe(target: any, options: any) { this.observed = { target, options } }
  takeRecords = () => []
}

class StubElement {
  tagName = 'DIV'
  id = ''
  className = ''
  textContent = ''
  _style: Record<string, string> = {}
  _attrs: Record<string, string> = {}
  _children: StubElement[] = []
  appendChild(c: StubElement) { this._children.push(c); c.parentElement = this }
  remove() {}
  setAttribute(n: string, v: string) { this._attrs[n] = v }
  getAttribute(n: string) { return this._attrs[n] ?? null }
  get style(): any {
    const s = this._style
    return {
      setProperty: (n: string, v: string) => { s[n] = v },
      removeProperty: (n: string) => { delete s[n] },
      getPropertyValue: (n: string) => s[n] ?? '',
    }
  }
  get classList() {
    const self = this
    return {
      add: (c: string) => { self.className = (self.className + ' ' + c).trim() },
      remove: (c: string) => {
        self.className = self.className.split(/\s+/).filter((x) => x && x !== c).join(' ')
      },
      contains: (c: string) => self.className.split(/\s+/).includes(c),
      toString: () => self.className,
    }
  }
  get children() { return this._children as any[] }
  get firstChild() { return this._children[0] ?? null }
  get childNodes() { return this._children as any[] }
  get offsetWidth() { return 100 }
  get offsetHeight() { return 30 }
  parentElement: StubElement | null = null
  querySelector(_sel: string) { return null }
  querySelectorAll(sel: string): any[] {
    const results: StubElement[] = []
    const sub = sel.match(/\[class\*="([^"]+)"\]/)?.[1]
    if (sub) {
      for (const c of this._children) {
        if (c.className && c.className.split(/\s+/).some((k) => k.includes(sub))) {
          results.push(c)
        }
      }
    }
    return results
  }
  removeChild(_child: any) {}
  addEventListener(_e: string, _h: any) {}
  removeEventListener(_e: string, _h: any) {}
  getBoundingClientRect() { return { width: 420, height: 600, top: 0, left: 0, right: 420, bottom: 600 } }
  closest(sel: string): any {
    // Walk up the parent chain looking for a matching class substring
    let cur: StubElement | null = this
    const sub = sel.match(/\[class\*="([^"]+)"\]/)?.[1]
    if (sub) {
      while (cur) {
        if (cur.className && cur.className.split(/\s+/).some((c) => c.includes(sub))) return cur
        cur = cur.parentElement
      }
    }
    return null
  }
}

// --- matchMedia stub that stores listeners and supports firing change events ---

let _mediaListeners: Array<(e: any) => void> = []
let _mediaMatches = false
let _mediaInnerWidth = 1280

const stubMatchMedia = (_q: string) => ({
  get matches() { return _mediaMatches },
  addEventListener(_e: string, h: any) { _mediaListeners.push(h) },
  removeEventListener(_e: string, h: any) {
    const i = _mediaListeners.indexOf(h)
    if (i >= 0) _mediaListeners.splice(i, 1)
  },
  addListener(h: any) { _mediaListeners.push(h) },
  removeListener(h: any) {
    const i = _mediaListeners.indexOf(h)
    if (i >= 0) _mediaListeners.splice(i, 1)
  },
})

function _fireChange(matches: boolean) {
  _mediaMatches = matches
  for (const h of _mediaListeners) h({ matches })
}

function _setViewport(mobile: boolean) {
  _mediaMatches = mobile
  _mediaInnerWidth = mobile ? 480 : 1280
}

function _resetMedia() {
  _mediaListeners = []
  _mediaMatches = false
  _mediaInnerWidth = 1280
}

// --- Document / head / window stubs ---

const _styleElements: Record<string, StubElement> = {}
const _headChildren: StubElement[] = []

let stubBody: StubElement = new StubElement()
let stubQuerySelector: (sel: string) => any = () => null

const stubDocument: any = {
  getElementById(id: string) { return _styleElements[id] ?? null },
  createElement(_tag: string) { return new StubElement() },
  documentElement: new StubElement(),
  body: stubBody,
  visibilityState: 'visible',
  addEventListener(_e: string, _h: any) {},
  removeEventListener(_e: string, _h: any) {},
  head: {
    appendChild(child: StubElement) {
      _headChildren.push(child)
      if (child.id) _styleElements[child.id] = child
    },
    removeChild(child: StubElement) {
      const i = _headChildren.indexOf(child)
      if (i >= 0) _headChildren.splice(i, 1)
      if (child.id) delete _styleElements[child.id]
    },
  },
  querySelector(sel: string) { return stubQuerySelector(sel) },
}

// --- rAF stub that supports cancellation ---
let _rafNextId = 0
const _rafPending = new Map<number, ReturnType<typeof setTimeout>>()

const stubWindow: any = {
  addEventListener(_e: string, _h: any) {},
  removeEventListener(_e: string, _h: any) {},
  get innerWidth() { return _mediaInnerWidth },
  innerHeight: 800,
  matchMedia: stubMatchMedia,
  requestAnimationFrame: (cb: any) => {
    const id = ++_rafNextId
    _rafPending.set(id, setTimeout(() => { _rafPending.delete(id); cb() }, 0))
    return id
  },
  cancelAnimationFrame: (id: number) => {
    const t = _rafPending.get(id)
    if (t !== undefined) { clearTimeout(t); _rafPending.delete(id) }
  },
  Promise: (globalThis as any).Promise,
}

;(globalThis as any).document = stubDocument
;(globalThis as any).window = stubWindow
;(globalThis as any).MutationObserver = StubObserver
;(globalThis as any).HTMLElement = StubElement
;(globalThis as any).Element = StubElement

// --- DOM install helper ---

function _installDom(opts: { open?: boolean; leftSide?: boolean } = {}) {
  // Body with chat column -- getChatColumn returns the chat stub.
  const body = new StubElement()
  body.className = '_body_xyz'

  const chat = new StubElement()
  chat.className = '_chatColumn_abc'
  body.appendChild(chat)

  // Wrapper with optional open + side classes. isMainDrawerOpen reads
  // wrapperOpen; getMainDrawerSide reads wrapperLeft first, defaults to right.
  const wrapper = new StubElement()
  const wrapperClasses = ['_wrapper_']
  if (opts.open) wrapperClasses.push('wrapperOpen')
  if (opts.leftSide) wrapperClasses.push('wrapperLeft')
  wrapper.className = wrapperClasses.join(' ')

  const sidebar = new StubElement()
  sidebar.setAttribute('data-spindle-mount', 'sidebar')
  wrapper.appendChild(sidebar)

  body.appendChild(wrapper)

  stubBody = body
  stubDocument.body = body
  stubQuerySelector = (sel: string) => {
    if (sel === '[data-spindle-mount="sidebar"]') return sidebar
    if (sel.includes('_body_')) return body
    if (sel.includes('_chatColumn_')) return chat
    return null
  }

  return { chat, wrapper, body, sidebar }
}

function _resetAll() {
  // Wipe style registry and head
  for (const k of Object.keys(_styleElements)) delete _styleElements[k]
  _headChildren.length = 0
  // Wipe body and querySelector
  stubBody = new StubElement()
  stubDocument.body = stubBody
  stubQuerySelector = () => null
  // Reset matchMedia
  _resetMedia()
  // Reset MutationObserver instances
  StubObserver.instances = []
  // Flush pending rAF callbacks
  for (const t of _rafPending.values()) clearTimeout(t)
  _rafPending.clear()
}

// --- Imports under test ---

import { injectReflowStyles, updateChatReflow, clearChatMargins, startReflowObserver, scheduleReflow } from '../reflow'
import { FEATURES } from '../../features/registry'
import type { SpindleFrontendContext } from 'lumiverse-spindle-types'

// --- Helpers ---

function makeStubCtx(): SpindleFrontendContext {
  return { ui: { mount: () => null } } as any
}

// --- Pre-test sanity ---

assert(typeof injectReflowStyles === 'function', 'precondition: injectReflowStyles is importable')
assert(typeof updateChatReflow === 'function', 'precondition: updateChatReflow is importable')
assert(typeof clearChatMargins === 'function', 'precondition: clearChatMargins is importable')
assert(typeof startReflowObserver === 'function', 'precondition: startReflowObserver is importable')
const chatReflowFeature = FEATURES.find((f) => f.id === 'chatReflow')!
assert(chatReflowFeature !== undefined, 'precondition: chatReflowFeature exists in FEATURES')

// --- Test 1: injectReflowStyles() inserts a <style> tag with the right id ---

_resetAll()
injectReflowStyles()
const styleEl = stubDocument.getElementById('sidebar-ux-reflow')
assert(styleEl !== null, 'injectReflowStyles inserts a <style id="sidebar-ux-reflow">')
assert(styleEl !== null && (styleEl as any).textContent.includes('@media (max-width: 600px)'),
  'injected style includes @media (max-width: 600px)')

// --- Test 2: the mobile media query nullifies margin + transition ---

const css = (styleEl as any).textContent
assert(css.includes('margin-left: 0 !important'), 'mobile rule sets margin-left: 0 !important')
assert(css.includes('margin-right: 0 !important'), 'mobile rule sets margin-right: 0 !important')
assert(css.includes('transition: none !important'), 'mobile rule sets transition: none !important')

// --- Test 3: updateChatReflow is a no-op on mobile ---

_resetAll()
const dom3 = _installDom()
_setViewport(true)
updateChatReflow()
assertEqual(
  dom3.chat.style.getPropertyValue('--sidebar-ux-chat-ml'),
  '',
  'updateChatReflow on mobile: --sidebar-ux-chat-ml not set (was empty before)'
)
assertEqual(
  dom3.chat.style.getPropertyValue('--sidebar-ux-chat-mr'),
  '',
  'updateChatReflow on mobile: --sidebar-ux-chat-mr not set (was empty before)'
)

// --- Test 4: updateChatReflow on mobile clears stale inline vars ---

_resetAll()
const dom4 = _installDom()
// Pre-set stale vars as if a prior desktop reflow had run.
dom4.chat.style.setProperty('--sidebar-ux-chat-ml', '420px')
dom4.chat.style.setProperty('--sidebar-ux-chat-mr', '420px')
_setViewport(true)
updateChatReflow()
assertEqual(
  dom4.chat.style.getPropertyValue('--sidebar-ux-chat-ml'),
  '',
  'updateChatReflow on mobile clears stale --sidebar-ux-chat-ml'
)
assertEqual(
  dom4.chat.style.getPropertyValue('--sidebar-ux-chat-mr'),
  '',
  'updateChatReflow on mobile clears stale --sidebar-ux-chat-mr'
)

// --- Test 5: updateChatReflow on desktop writes vars correctly ---

_resetAll()
const dom5 = _installDom({ open: true, leftSide: false })
// No drawer child -- getMainDrawerWidth falls back to 420
_setViewport(false)
updateChatReflow()
// mainSide defaults to 'right' (no wrapperLeft class),
// mainOpen=true, mainWidth=420, secondaryWidth=0.
// Right branch: setChatMargin('right', 420), setChatMargin('left', 0).
assertEqual(
  dom5.chat.style.getPropertyValue('--sidebar-ux-chat-mr'),
  '420px',
  'updateChatReflow on desktop (main right, open) sets --sidebar-ux-chat-mr to 420px'
)
assertEqual(
  dom5.chat.style.getPropertyValue('--sidebar-ux-chat-ml'),
  '0px',
  'updateChatReflow on desktop (main right, open) sets --sidebar-ux-chat-ml to 0px'
)

// --- Test 6: startReflowObserver registers a matchMedia change listener ---

_resetAll()
const teardown6 = startReflowObserver()
assertEqual(_mediaListeners.length, 1, 'startReflowObserver registers exactly one matchMedia change listener')
assertEqual(typeof teardown6, 'function', 'startReflowObserver returns a teardown function')
teardown6()
assertEqual(_mediaListeners.length, 0, 'teardown removes the matchMedia change listener')

// --- Test 7: cross-down (desktop -> mobile) clears inline vars ---

_resetAll()
const dom7 = _installDom()
dom7.chat.style.setProperty('--sidebar-ux-chat-ml', '420px')
dom7.chat.style.setProperty('--sidebar-ux-chat-mr', '420px')
_setViewport(false) // start on desktop
const teardown7 = startReflowObserver()
assertEqual(_mediaListeners.length, 1, 'precondition: listener registered')
_setViewport(true) // simulate user drag-resize to mobile
_fireChange(true)
assertEqual(
  dom7.chat.style.getPropertyValue('--sidebar-ux-chat-ml'),
  '',
  'cross-down clears --sidebar-ux-chat-ml on chat column'
)
assertEqual(
  dom7.chat.style.getPropertyValue('--sidebar-ux-chat-mr'),
  '',
  'cross-down clears --sidebar-ux-chat-mr on chat column'
)
teardown7()

// --- Test 8: cross-up (mobile -> desktop) re-runs updateChatReflow ---

_resetAll()
const dom8 = _installDom({ open: true, leftSide: false })
_setViewport(true) // start on mobile
const teardown8 = startReflowObserver()
// On mobile, updateChatReflow has already short-circuited -- vars are empty.
assertEqual(dom8.chat.style.getPropertyValue('--sidebar-ux-chat-ml'), '',
  'precondition: vars empty while on mobile')
_setViewport(false) // simulate user drag-resize to desktop
_fireChange(false)
assertEqual(
  dom8.chat.style.getPropertyValue('--sidebar-ux-chat-mr'),
  '420px',
  'cross-up re-runs updateChatReflow, sets --sidebar-ux-chat-mr to 420px'
)
assertEqual(
  dom8.chat.style.getPropertyValue('--sidebar-ux-chat-ml'),
  '0px',
  'cross-up re-runs updateChatReflow, sets --sidebar-ux-chat-ml to 0px'
)
teardown8()

// --- Test 9: teardown removes the listener (no fires reach handler after teardown) ---

_resetAll()
const teardown9 = startReflowObserver()
const beforeCount = _mediaListeners.length
teardown9()
const afterCount = _mediaListeners.length
assertEqual(afterCount, beforeCount - 1, 'teardown decrements the listener count by 1')
_fireChange(true) // should not throw even though handler is gone
assertEqual(_mediaListeners.length, 0, 'firing change after teardown is a no-op (no listeners)')

// --- Test 10: idempotency on desktop ---

_resetAll()
const dom10 = _installDom({ open: true, leftSide: false })
_setViewport(false)
updateChatReflow()
const ml1 = dom10.chat.style.getPropertyValue('--sidebar-ux-chat-ml')
const mr1 = dom10.chat.style.getPropertyValue('--sidebar-ux-chat-mr')
updateChatReflow()
const ml2 = dom10.chat.style.getPropertyValue('--sidebar-ux-chat-ml')
const mr2 = dom10.chat.style.getPropertyValue('--sidebar-ux-chat-mr')
assertEqual(ml1, ml2, 'idempotency: second call sets same --sidebar-ux-chat-ml as first')
assertEqual(mr1, mr2, 'idempotency: second call sets same --sidebar-ux-chat-mr as first')

// --- Test 11: apply(off -> on) at mobile does not set inline vars ---

_resetAll()
const dom11 = _installDom()
_setViewport(true)
chatReflowFeature.apply!({ chatReflow: false } as any, { chatReflow: true } as any, makeStubCtx())
assertEqual(
  dom11.chat.style.getPropertyValue('--sidebar-ux-chat-ml'),
  '',
  'apply(off->on) at mobile: --sidebar-ux-chat-ml not set'
)
assertEqual(
  dom11.chat.style.getPropertyValue('--sidebar-ux-chat-mr'),
  '',
  'apply(off->on) at mobile: --sidebar-ux-chat-mr not set'
)
// Sanity: the <style> tag IS injected (it's gated on chatReflow being on, not on viewport)
assert(stubDocument.getElementById('sidebar-ux-reflow') !== null,
  'apply(off->on) injects the reflow <style> tag (gated on setting, not viewport)')

// --- Test R1: teardown cancels observer reconnection ---

;(async () => {
  _resetAll()
  // No DOM installed — waitForElement won't find wrapper quickly
  const teardown = startReflowObserver()
  // Teardown immediately, before the .then() resolves
  teardown()
  // Flush microtask queue so waitForElement's .then() fires
  await new Promise(r => setTimeout(r, 0))
  // The observer should never have been attached (cancelled = true)
  assert(StubObserver.instances.length > 0, 'R1: observer was created')
  assertEqual(StubObserver.instances[0].observed, null, 'R1: teardown cancels observer reconnection — observed is null')
})()

// --- Test R2: teardown cancels in-flight rAF ---

;(async () => {
  _resetAll()
  const dom = _installDom({ open: true, leftSide: false })
  _setViewport(false)
  const teardown = startReflowObserver()
  // Schedule a reflow (sets _reflowRaf)
  scheduleReflow()
  // Teardown immediately — should cancel the rAF
  teardown()
  // Let any pending rAF tick fire
  await new Promise(r => setTimeout(r, 10))
  // The rAF callback should not have run, so no chat margin vars were set
  assertEqual(
    dom.chat.style.getPropertyValue('--sidebar-ux-chat-ml'),
    '',
    'R2: teardown cancels in-flight rAF — --sidebar-ux-chat-ml not set'
  )
  assertEqual(
    dom.chat.style.getPropertyValue('--sidebar-ux-chat-mr'),
    '',
    'R2: teardown cancels in-flight rAF — --sidebar-ux-chat-mr not set'
  )
})()

// --- Summary ---

console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
process.exit(failed > 0 ? 1 : 0)
