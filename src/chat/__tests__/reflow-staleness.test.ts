// Regression test for the "click 15 tabs then close drawer" bug.
//
// User-reported repro:
//   1. Open the main drawer
//   2. Click all 15 visible tab buttons (each click refreshes the
//      3-second-cached Zustand snapshot via the tagger observer's
//      findStoreData(true) call inside tagMainSidebarButtons)
//   3. Click the drawer tab to close
//   4. Chat reflow (--sidebar-ux-chat-ml/mr) is left set to "drawer
//      open" values, so the chat is shifted as if the drawer were still
//      open. The bug persists until refresh (which clears the
//      module-level _storeSnapshotCache).
//
// Root cause: isMainDrawerOpen() in src/store/index.ts read the cached
// store snapshot FIRST and fell back to the live wrapper DOM only when
// the store had no drawerOpen field. The sibling getMainDrawerSide()
// already does the opposite (DOM first, store as fallback) for exactly
// this reason -- its block comment explains the 3s-TTL staleness.
// The fix flips isMainDrawerOpen to the same DOM-first order.
//
// This test stubs the store snapshot cache directly via the
// __setStoreSnapshotForTest export (test-only, mirrors the
// __setSecondaryWrapperForTest pattern in sidebar/secondary.tsx) and
// verifies:
//   - DOM wins over the cache when both are present (the regression)
//   - Store is still consulted when the wrapper element is missing
//     (the pre-mount fallback)
//   - updateChatReflow end-to-end: with a stale store and a closed
//     wrapper, the chat margins are 0px (not 420px)
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

class StubElement {
  tagName = 'DIV'
  id = ''
  textContent = ''
  className = ''
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

const stubWindow: any = {
  addEventListener() {},
  removeEventListener() {},
  innerWidth: 1280,
  innerHeight: 800,
  matchMedia: () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }),
  requestAnimationFrame: (cb: any) => { setTimeout(cb, 0); return 1 },
  cancelAnimationFrame: () => {},
  __canvasDebug: undefined,
  Promise: (globalThis as any).Promise,
}

;(globalThis as any).document = stubDocument
;(globalThis as any).window = stubWindow
;(globalThis as any).MutationObserver = class {
  constructor(_cb: any) {}
  observe() {}
  disconnect() {}
  takeRecords() { return [] }
}
;(globalThis as any).HTMLElement = StubElement
;(globalThis as any).Element = StubElement

// --- DOM install helper ---

function _installDom(opts: { open?: boolean } = {}) {
  const body = new StubElement()
  body.className = '_body_xyz'

  const chat = new StubElement()
  chat.className = '_chatColumn_abc'
  body.appendChild(chat)

  // Wrapper with optional open class. The stale-cache regression test
  // uses { open: false } to model the post-close DOM state.
  const wrapper = new StubElement()
  const wrapperClasses = ['_wrapper_']
  if (opts.open) wrapperClasses.push('wrapperOpen')
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
  for (const k of Object.keys(_styleElements)) delete _styleElements[k]
  _headChildren.length = 0
  stubBody = new StubElement()
  stubDocument.body = stubBody
  stubQuerySelector = () => null
}

// --- Imports under test ---

import { isMainDrawerOpen, __setStoreSnapshotForTest } from '../../store'
import { updateChatReflow } from '../reflow'

// --- Test 1: REGRESSION -- stale store cache (drawerOpen: true) does
//              NOT make isMainDrawerOpen() return true when the wrapper
//              has lost its wrapperOpen class. The user repro: open
//              drawer, click all 15 tabs, close drawer. The cache was
//              just refreshed (drawerOpen: true) and the DOM correctly
//              lacks wrapperOpen. Pre-fix: isMainDrawerOpen() returned
//              the stale true; post-fix: returns false from the DOM. ---

{
  _resetAll()
  // DOM says drawer is closed (no wrapperOpen)
  const { wrapper } = _installDom({ open: false })
  // Cache says drawer is open (stale -- the post-15-clicks state)
  __setStoreSnapshotForTest({ drawerOpen: true })

  assertEqual(
    isMainDrawerOpen(),
    false,
    'regression: stale store drawerOpen: true + DOM wrapperOpen absent → isMainDrawerOpen() returns false (DOM wins)'
  )
  // Sanity: the wrapper's class is what we set it to (no race)
  assertEqual(wrapper.classList.contains('wrapperOpen'), false, 'sanity: wrapper does not have wrapperOpen class')
}

// --- Test 2: inverse -- when DOM has wrapperOpen and the store has
//              drawerOpen: false (also stale), DOM still wins. Closes
//              the symmetric failure mode (drawing the wrong conclusion
//              on a stale "false" cache). ---

{
  _resetAll()
  // DOM says drawer is open
  _installDom({ open: true })
  // Cache says drawer is closed (stale)
  __setStoreSnapshotForTest({ drawerOpen: false })

  assertEqual(
    isMainDrawerOpen(),
    true,
    'inverse: stale store drawerOpen: false + DOM wrapperOpen present → isMainDrawerOpen() returns true (DOM wins)'
  )
}

// --- Test 3: pre-mount fallback -- when the wrapper element is not
//              in the DOM (first mount, before the wrapper renders),
//              the function falls back to the store snapshot. Locks
//              the original pre-mount code path that getMainWrapper()
//              returning null uses. ---

{
  _resetAll()
  // No DOM installed -- getMainWrapper() returns null
  __setStoreSnapshotForTest({ drawerOpen: true })
  assertEqual(
    isMainDrawerOpen(),
    true,
    'pre-mount fallback: no wrapper in DOM + store drawerOpen: true → returns true'
  )
}

{
  _resetAll()
  __setStoreSnapshotForTest({ drawerOpen: false })
  assertEqual(
    isMainDrawerOpen(),
    false,
    'pre-mount fallback: no wrapper in DOM + store drawerOpen: false → returns false'
  )
}

{
  _resetAll()
  // No wrapper, no store snapshot at all
  __setStoreSnapshotForTest(null)
  assertEqual(
    isMainDrawerOpen(),
    false,
    'pre-mount fallback: no wrapper in DOM + no store snapshot → returns false (default)'
  )
}

// --- Test 4: end-to-end -- the user-reported scenario, end-to-end
//              through updateChatReflow. With a stale store (drawerOpen:
//              true) and a closed DOM, the chat margins must be 0px --
//              NOT 420px. Pre-fix this test fails: the chat was
//              shifted as if the drawer were still open. ---

{
  _resetAll()
  const { chat } = _installDom({ open: false })  // DOM: closed
  // Pre-populate the stale store cache. Simulates the post-15-clicks
  // state where the cache was just refreshed while the drawer was
  // still open.
  __setStoreSnapshotForTest({ drawerOpen: true })

  // Sanity: this is the regression pre-condition.
  assertEqual(isMainDrawerOpen(), false, 'precondition: isMainDrawerOpen reads false (DOM wins)')

  updateChatReflow()

  // With the DOM showing closed, both margins should be 0 regardless
  // of the stale store. Pre-fix: --sidebar-ux-chat-mr would be '420px'
  // because isMainDrawerOpen returned the cached true.
  const ml = chat.style.getPropertyValue('--sidebar-ux-chat-ml')
  const mr = chat.style.getPropertyValue('--sidebar-ux-chat-mr')
  assertEqual(ml, '0px', 'end-to-end: --sidebar-ux-chat-ml = 0px (not 420px) with stale store drawerOpen: true')
  assertEqual(mr, '0px', 'end-to-end: --sidebar-ux-chat-mr = 0px (not 420px) with stale store drawerOpen: true')
}

// --- Summary ---

console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
process.exit(failed > 0 ? 1 : 0)
