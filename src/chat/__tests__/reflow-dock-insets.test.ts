// Test file: chat reflow dock inset subtraction
//
// Validates the fix for the chat reflow bug where opening the main drawer
// on the same side as the LumiScript (Spindle) dock panel pushes the chat
// column too far inward, creating a visible gap.
//
// Root cause: The dock panel and main drawer on the same side OVERLAP (both
// at `right: 0` / `left: 0` with `position: fixed`; the drawer has higher
// z-index). The App's `padding-right: var(--spindle-dock-right)` already
// pushes the chat by the dock panel's width, but canvas_ext's updateChatReflow
// was ADDING the main drawer's width on top, resulting in `dockInset + mainWidth`
// total right inset. The fix subtracts the dock insets from the drawer widths
// so the total inset is `max(mainWidth, dockInset)`.
//
// getDockInsets() reads the `--spindle-dock-left` and `--spindle-dock-right`
// CSS variables from the App element (`[data-app-root]`). These are set as
// inline style by Lumiverse's App.tsx.
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
  addEventListener(_e: string, _h: any) {},
  removeEventListener(_e: string, _h: any) {},
  innerWidth: 1280,
  innerHeight: 800,
  matchMedia: (_q: string) => ({
    matches: false,
    addEventListener(_e: string, _h: any) {},
    removeEventListener(_e: string, _h: any) {},
    addListener(_h: any) {},
    removeListener(_h: any) {},
  }),
  requestAnimationFrame: (cb: any) => { setTimeout(cb, 0); return 1 },
  cancelAnimationFrame: () => {},
  Promise: (globalThis as any).Promise,
}

;(globalThis as any).document = stubDocument
;(globalThis as any).window = stubWindow
;(globalThis as any).MutationObserver = class {
  constructor(_cb: any) {}
  observe(_target: any, _options: any) {}
  disconnect() {}
  takeRecords() { return [] }
}
;(globalThis as any).HTMLElement = StubElement
;(globalThis as any).Element = StubElement

// --- DOM install helper ---

function _installDom(opts: {
  open?: boolean
  leftSide?: boolean
  appRoot?: boolean
  dockLeft?: number
  dockRight?: number
} = {}) {
  const body = new StubElement()
  body.className = '_body_xyz'

  const chat = new StubElement()
  chat.className = '_chatColumn_abc'
  body.appendChild(chat)

  // Wrapper with optional open + side classes
  const wrapper = new StubElement()
  const wrapperClasses = ['_wrapper_']
  if (opts.open) wrapperClasses.push('wrapperOpen')
  if (opts.leftSide) wrapperClasses.push('wrapperLeft')
  wrapper.className = wrapperClasses.join(' ')

  const sidebar = new StubElement()
  sidebar.setAttribute('data-spindle-mount', 'sidebar')
  wrapper.appendChild(sidebar)
  body.appendChild(wrapper)

  // App root element with optional dock insets
  let appEl: StubElement | null = null
  if (opts.appRoot) {
    appEl = new StubElement()
    appEl.setAttribute('data-app-root', '')
    if (opts.dockLeft !== undefined) {
      appEl.style.setProperty('--spindle-dock-left', `${opts.dockLeft}px`)
    }
    if (opts.dockRight !== undefined) {
      appEl.style.setProperty('--spindle-dock-right', `${opts.dockRight}px`)
    }
  }

  stubBody = body
  stubDocument.body = body
  stubQuerySelector = (sel: string) => {
    if (sel === '[data-spindle-mount="sidebar"]') return sidebar
    if (sel.includes('_body_')) return body
    if (sel.includes('_chatColumn_')) return chat
    if (sel === '[data-app-root]') return appEl
    return null
  }

  return { chat, wrapper, body, sidebar, appEl }
}

function _rootStyle(): any {
  return stubDocument.documentElement.style
}

function _resetAll() {
  for (const k of Object.keys(_styleElements)) delete _styleElements[k]
  _headChildren.length = 0
  stubBody = new StubElement()
  stubDocument.body = stubBody
  stubDocument.documentElement = new StubElement()
  stubQuerySelector = () => null
}

// --- Imports under test ---

import { updateChatReflow } from '../reflow'

// --- Test 1: No dock panel (no App element) — no change from baseline ---
// When there is no App element, getDockInsets returns { left: 0, right: 0 },
// so the margins should be the same as before the fix.

{
  _resetAll()
  const { chat } = _installDom({ open: true, leftSide: false, appRoot: false })
  updateChatReflow()
  // mainSide='right', mainWidth=420, secondaryWidth=0
  // dockInsets = { left: 0, right: 0 }
  // rightMargin = max(0, 420 - 0) = 420, leftMargin = max(0, 0 - 0) = 0
  assertEqual(
    _rootStyle().getPropertyValue('--sidebar-ux-chat-mr'),
    '420px',
    'test 1: no dock panel — --sidebar-ux-chat-mr = 420px (baseline)'
  )
  assertEqual(
    _rootStyle().getPropertyValue('--sidebar-ux-chat-ml'),
    '0px',
    'test 1: no dock panel — --sidebar-ux-chat-ml = 0px (baseline)'
  )
}

// --- Test 2: App element exists but no dock insets set — same as baseline ---

{
  _resetAll()
  const { chat } = _installDom({ open: true, leftSide: false, appRoot: true })
  updateChatReflow()
  // dockInsets = { left: 0, right: 0 } (variables not set on appEl)
  assertEqual(
    _rootStyle().getPropertyValue('--sidebar-ux-chat-mr'),
    '420px',
    'test 2: app root exists, no dock insets — --sidebar-ux-chat-mr = 420px'
  )
  assertEqual(
    _rootStyle().getPropertyValue('--sidebar-ux-chat-ml'),
    '0px',
    'test 2: app root exists, no dock insets — --sidebar-ux-chat-ml = 0px'
  )
}

// --- Test 3: Dock panel on right side, main drawer on right side ---
// Same side: the dock inset should be subtracted from the drawer width.

{
  _resetAll()
  const { chat } = _installDom({
    open: true,
    leftSide: false,  // main drawer on right
    appRoot: true,
    dockRight: 300,    // dock panel is 300px wide on the right
  })
  updateChatReflow()
  // mainSide='right', mainWidth=420, secondaryWidth=0
  // dockInsets = { left: 0, right: 300 }
  // rightMargin = max(0, 420 - 300) = 120
  // leftMargin = max(0, 0 - 0) = 0
  assertEqual(
    _rootStyle().getPropertyValue('--sidebar-ux-chat-mr'),
    '120px',
    'test 3: dock right=300 + drawer right=420 — --sidebar-ux-chat-mr = 120px (subtracted)'
  )
  assertEqual(
    _rootStyle().getPropertyValue('--sidebar-ux-chat-ml'),
    '0px',
    'test 3: dock right=300 + drawer right=420 — --sidebar-ux-chat-ml = 0px'
  )
}

// --- Test 4: Dock panel wider than drawer — clamped to 0 ---

{
  _resetAll()
  const { chat } = _installDom({
    open: true,
    leftSide: false,  // main drawer on right
    appRoot: true,
    dockRight: 500,    // dock panel is wider than the 420px drawer
  })
  updateChatReflow()
  // rightMargin = max(0, 420 - 500) = max(0, -80) = 0
  assertEqual(
    _rootStyle().getPropertyValue('--sidebar-ux-chat-mr'),
    '0px',
    'test 4: dock right=500 > drawer right=420 — --sidebar-ux-chat-mr clamped to 0px'
  )
}

// --- Test 5: Dock panel on left side, main drawer on left side ---

{
  _resetAll()
  const { chat } = _installDom({
    open: true,
    leftSide: true,   // main drawer on left
    appRoot: true,
    dockLeft: 300,     // dock panel is 300px wide on the left
  })
  updateChatReflow()
  // mainSide='left', mainWidth=420, secondaryWidth=0
  // dockInsets = { left: 300, right: 0 }
  // leftMargin = max(0, 420 - 300) = 120
  // rightMargin = max(0, 0 - 0) = 0
  assertEqual(
    _rootStyle().getPropertyValue('--sidebar-ux-chat-ml'),
    '120px',
    'test 5: dock left=300 + drawer left=420 — --sidebar-ux-chat-ml = 120px (subtracted)'
  )
  assertEqual(
    _rootStyle().getPropertyValue('--sidebar-ux-chat-mr'),
    '0px',
    'test 5: dock left=300 + drawer left=420 — --sidebar-ux-chat-mr = 0px'
  )
}

// --- Test 6: Dock panel on opposite side from drawer — no subtraction ---
// The dock panel is on the left, but the drawer is on the right. The dock
// inset on the left side should NOT affect the right margin (and vice versa).

{
  _resetAll()
  const { chat } = _installDom({
    open: true,
    leftSide: false,  // main drawer on right
    appRoot: true,
    dockLeft: 300,     // dock panel is on the LEFT (opposite side)
  })
  updateChatReflow()
  // mainSide='right', mainWidth=420, secondaryWidth=0
  // dockInsets = { left: 300, right: 0 }
  // rightMargin = max(0, 420 - 0) = 420  (no subtraction on right side)
  // leftMargin = max(0, 0 - 300) = 0  (clamped)
  assertEqual(
    _rootStyle().getPropertyValue('--sidebar-ux-chat-mr'),
    '420px',
    'test 6: dock left=300 (opposite side) — --sidebar-ux-chat-mr = 420px (no subtraction)'
  )
  assertEqual(
    _rootStyle().getPropertyValue('--sidebar-ux-chat-ml'),
    '0px',
    'test 6: dock left=300 (opposite side) — --sidebar-ux-chat-ml = 0px (clamped)'
  )
}

// --- Test 7: Both main drawer and secondary open, dock panels on both sides ---

{
  _resetAll()
  const { chat } = _installDom({
    open: true,
    leftSide: false,  // main drawer on right
    appRoot: true,
    dockLeft: 200,     // dock panel on left
    dockRight: 100,    // dock panel on right
  })
  // Stub isSecondarySidebarOpen to return true
  // We need to stub the secondary sidebar state. Since isSecondarySidebarOpen
  // is imported from '../sidebar/secondary', and the test file imports
  // updateChatReflow from '../reflow', the secondary state is determined by
  // the module-level _secondarySidebarOpen variable in secondary.tsx.
  // For this test, we rely on the fact that isSecondarySidebarOpen reads
  // the _secondarySidebarOpen variable which defaults to false.
  // To test with secondary open, we'd need to stub it. Since we can't
  // easily do that without module mocking, this test uses secondary closed.
  // The important thing is that both dock insets are subtracted correctly.
  updateChatReflow()
  // mainSide='right', mainWidth=420, secondaryWidth=0
  // dockInsets = { left: 200, right: 100 }
  // rightMargin = max(0, 420 - 100) = 320
  // leftMargin = max(0, 0 - 200) = 0
  assertEqual(
    _rootStyle().getPropertyValue('--sidebar-ux-chat-mr'),
    '320px',
    'test 7: dock right=100 + drawer right=420 — --sidebar-ux-chat-mr = 320px'
  )
  assertEqual(
    _rootStyle().getPropertyValue('--sidebar-ux-chat-ml'),
    '0px',
    'test 7: dock left=200 + no secondary — --sidebar-ux-chat-ml = 0px (clamped)'
  )
}

// --- Test 8: Drawer closed — no margin regardless of dock panels ---

{
  _resetAll()
  const { chat } = _installDom({
    open: false,      // drawer closed
    leftSide: false,
    appRoot: true,
    dockRight: 300,
  })
  updateChatReflow()
  // mainOpen=false, mainWidth=0
  // rightMargin = max(0, 0 - 300) = 0
  assertEqual(
    _rootStyle().getPropertyValue('--sidebar-ux-chat-mr'),
    '0px',
    'test 8: drawer closed + dock right=300 — --sidebar-ux-chat-mr = 0px'
  )
}

// --- Test 9: Dock inset exactly equals drawer width — margin is 0 ---

{
  _resetAll()
  const { chat } = _installDom({
    open: true,
    leftSide: false,
    appRoot: true,
    dockRight: 420,    // exactly equals drawer width
  })
  updateChatReflow()
  // rightMargin = max(0, 420 - 420) = 0
  assertEqual(
    _rootStyle().getPropertyValue('--sidebar-ux-chat-mr'),
    '0px',
    'test 9: dock right=420 == drawer right=420 — --sidebar-ux-chat-mr = 0px (exactly absorbed)'
  )
}

// --- Test 10: Multiple dock inset values — only right matters for right drawer ---

{
  _resetAll()
  const { chat } = _installDom({
    open: true,
    leftSide: false,
    appRoot: true,
    dockLeft: 150,
    dockRight: 250,
  })
  updateChatReflow()
  // rightMargin = max(0, 420 - 250) = 170
  // leftMargin = max(0, 0 - 150) = 0
  assertEqual(
    _rootStyle().getPropertyValue('--sidebar-ux-chat-mr'),
    '170px',
    'test 10: dock right=250 — --sidebar-ux-chat-mr = 170px'
  )
  assertEqual(
    _rootStyle().getPropertyValue('--sidebar-ux-chat-ml'),
    '0px',
    'test 10: dock left=150, no secondary — --sidebar-ux-chat-ml = 0px'
  )
}

// --- Test 11: startReflowObserver observes App element for style changes ---

;(async () => {
  _resetAll()
  const { appEl } = _installDom({ open: true, leftSide: false, appRoot: true })

  // Track MutationObserver.observe calls
  const observeCalls: Array<{ target: any; options: any }> = []
  const origMO = (globalThis as any).MutationObserver
  ;(globalThis as any).MutationObserver = class {
    constructor(_cb: any) {}
    observe(target: any, options: any) { observeCalls.push({ target, options }) }
    disconnect() {}
    takeRecords() { return [] }
  }

  const { startReflowObserver } = await import('../reflow')
  const teardown = startReflowObserver()

  // The observer should have been set up for the wrapper and the app element
  const appObserveCall = observeCalls.find(
    (c) => c.target === appEl && c.options.attributeFilter?.includes('style')
  )
  assert(
    appObserveCall !== undefined,
    'test 11: startReflowObserver observes the App element for style changes'
  )

  teardown()
  ;(globalThis as any).MutationObserver = origMO
})()

// --- Summary ---

console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
process.exit(failed > 0 ? 1 : 0)
