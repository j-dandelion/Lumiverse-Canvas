// Tests for keep-tabs strip gutters (page bounds between pin strips).

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { failed++; console.error(`FAIL: ${msg} -- expected ${String(expected)}, got ${String(actual)}`) }
}

class StubElement {
  tagName = 'DIV'
  id = ''
  className = ''
  textContent = ''
  _style: Record<string, string> = {}
  _attrs: Record<string, string> = {}
  _children: StubElement[] = []
  appendChild(c: StubElement) {
    this._children.push(c)
    c.parentElement = this
  }
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
    }
  }
  parentElement: StubElement | null = null
  querySelector(sel: string): StubElement | null {
    if (sel === '.sidebar-ux-tab-list') {
      return this._children.find((c) => c.className.includes('sidebar-ux-tab-list')) ?? null
    }
    return null
  }
  closest(sel: string): StubElement | null {
    let cur: StubElement | null = this
    const sub = sel.match(/\[class\*="([^"]+)"\]/)?.[1]
    if (!sub) return null
    while (cur) {
      if (cur.className && cur.className.split(/\s+/).some((c) => c.includes(sub))) return cur
      cur = cur.parentElement
    }
    return null
  }
}

class StubObserver {
  static instances: StubObserver[] = []
  observed: { target: any; options: any } | null = null
  constructor(_cb: any) { StubObserver.instances.push(this) }
  disconnect = () => { this.observed = null }
  observe(target: any, options: any) { this.observed = { target, options } }
  takeRecords = () => []
}

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
})

const _styleElements: Record<string, StubElement> = {}
const _headChildren: StubElement[] = []
let stubQuerySelector: (sel: string) => any = () => null

const stubDocument: any = {
  getElementById(id: string) { return _styleElements[id] ?? null },
  createElement(_tag: string) { return new StubElement() },
  documentElement: new StubElement(),
  body: new StubElement(),
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
  get innerWidth() { return _mediaInnerWidth },
  innerHeight: 800,
  matchMedia: stubMatchMedia,
  addEventListener() {},
  removeEventListener() {},
}

;(globalThis as any).document = stubDocument
;(globalThis as any).window = stubWindow
;(globalThis as any).MutationObserver = StubObserver
;(globalThis as any).HTMLElement = StubElement
;(globalThis as any).Element = StubElement

import { hydrateSettings, resetHydrationGuard } from '../../settings/state'
import {
  updateStripGutters,
  clearStripGutters,
  computeStripGutters,
  injectStripGutterStyles,
  STRIP_GUTTER_CLASS,
  STRIP_L_VAR,
  STRIP_R_VAR,
} from '../strip-gutter'
import { TAB_LIST_WIDTH_PX } from '../styles'
import { __setSecondaryWrapperForTest } from '../secondary'

function _setViewport(mobile: boolean) {
  _mediaMatches = mobile
  _mediaInnerWidth = mobile ? 480 : 1280
}

function _installDom(opts: {
  leftSide?: boolean
  dockLeft?: number
  dockRight?: number
  secondaryList?: boolean
} = {}) {
  const wrapper = new StubElement()
  const classes = ['_wrapper_']
  if (opts.leftSide) classes.push('wrapperLeft')
  wrapper.className = classes.join(' ')
  const sidebar = new StubElement()
  sidebar.setAttribute('data-spindle-mount', 'sidebar')
  wrapper.appendChild(sidebar)

  const appEl = new StubElement()
  appEl.setAttribute('data-app-root', '')
  if (opts.dockLeft !== undefined) {
    appEl.style.setProperty('--spindle-dock-left', `${opts.dockLeft}px`)
  }
  if (opts.dockRight !== undefined) {
    appEl.style.setProperty('--spindle-dock-right', `${opts.dockRight}px`)
  }

  if (opts.secondaryList) {
    const sec = new StubElement()
    sec.className = 'sidebar-ux-secondary-wrapper'
    const tabList = new StubElement()
    tabList.className = 'sidebar-ux-tab-list'
    sec.appendChild(tabList)
    __setSecondaryWrapperForTest(sec as any)
  } else {
    __setSecondaryWrapperForTest(null)
  }

  stubDocument.body = wrapper
  stubQuerySelector = (sel: string) => {
    if (sel === '[data-spindle-mount="sidebar"]') return sidebar
    if (sel.includes('_wrapper_')) return wrapper
    if (sel === '[data-app-root]') return appEl
    return null
  }

  return { wrapper, sidebar, appEl }
}

function _resetAll() {
  for (const k of Object.keys(_styleElements)) delete _styleElements[k]
  _headChildren.length = 0
  stubDocument.documentElement = new StubElement()
  stubDocument.body = new StubElement()
  stubQuerySelector = () => null
  _mediaListeners = []
  _mediaMatches = false
  _mediaInnerWidth = 1280
  StubObserver.instances = []
  __setSecondaryWrapperForTest(null)
  clearStripGutters()
  resetHydrationGuard()
  hydrateSettings({ keepTabListVisible: false, moveControlsToOuterEdge: false })
}

// --- Tests ---

_resetAll()
injectStripGutterStyles()
const styleEl = stubDocument.getElementById('sidebar-ux-strip-gutter')
assert(styleEl !== null, 'injectStripGutterStyles inserts style tag')
const css = (styleEl as any).textContent as string
assert(css.includes('LandingPage'), 'strip gutter CSS targets LandingPage')
assert(!css.includes('_chatColumn_'), 'strip gutter CSS does not own chat column (reflow does)')
assert(!css.includes('transition:'), 'strip gutter CSS has no transition: property')

function _hydrate(patch: { keepTabListVisible?: boolean; moveControlsToOuterEdge?: boolean }) {
  resetHydrationGuard()
  hydrateSettings(patch)
}

// keep-tabs off → clear
_resetAll()
_installDom()
_hydrate({ keepTabListVisible: false, moveControlsToOuterEdge: true })
updateStripGutters()
assert(
  !stubDocument.documentElement.classList.contains(STRIP_GUTTER_CLASS),
  'keep-tabs off: no gutter class',
)
assertEqual(
  stubDocument.documentElement.style.getPropertyValue(STRIP_R_VAR),
  '',
  'keep-tabs off: no right strip var',
)

// keep-tabs on, main right, no secondary → right strip only
_resetAll()
_installDom({ leftSide: false, secondaryList: false })
_hydrate({ keepTabListVisible: true, moveControlsToOuterEdge: true })
updateStripGutters()
assert(
  stubDocument.documentElement.classList.contains(STRIP_GUTTER_CLASS),
  'keep-tabs on: gutter class set',
)
assertEqual(
  stubDocument.documentElement.style.getPropertyValue(STRIP_R_VAR),
  `${TAB_LIST_WIDTH_PX}px`,
  'main right, no secondary: right = strip width',
)
assertEqual(
  stubDocument.documentElement.style.getPropertyValue(STRIP_L_VAR),
  '0px',
  'main right, no secondary: left = 0',
)

// main left + secondary → both sides
_resetAll()
_installDom({ leftSide: true, secondaryList: true })
_hydrate({ keepTabListVisible: true, moveControlsToOuterEdge: true })
updateStripGutters()
assertEqual(
  stubDocument.documentElement.style.getPropertyValue(STRIP_L_VAR),
  `${TAB_LIST_WIDTH_PX}px`,
  'main left + secondary: left = strip',
)
assertEqual(
  stubDocument.documentElement.style.getPropertyValue(STRIP_R_VAR),
  `${TAB_LIST_WIDTH_PX}px`,
  'main left + secondary: right = strip',
)

// dock wider than strip → 0 extra on that side
_resetAll()
_installDom({ leftSide: false, secondaryList: false, dockRight: 100 })
_hydrate({ keepTabListVisible: true, moveControlsToOuterEdge: true })
const computed = computeStripGutters()
assertEqual(computed.right, 0, 'dock right 100 > strip 56: right extra = 0')
assertEqual(computed.left, 0, 'dock right 100: left still 0 (no secondary)')
updateStripGutters()
assertEqual(
  stubDocument.documentElement.style.getPropertyValue(STRIP_R_VAR),
  '0px',
  'dock wider than strip: --sidebar-ux-strip-r = 0px',
)

// dock narrower than strip → partial extra
_resetAll()
_installDom({ leftSide: false, secondaryList: false, dockRight: 20 })
_hydrate({ keepTabListVisible: true, moveControlsToOuterEdge: true })
assertEqual(
  computeStripGutters().right,
  TAB_LIST_WIDTH_PX - 20,
  'dock right 20: right extra = strip - dock',
)

// mobile → clear vars
_resetAll()
_installDom({ leftSide: false, secondaryList: true })
_hydrate({ keepTabListVisible: true, moveControlsToOuterEdge: true })
_setViewport(false)
updateStripGutters()
assert(
  stubDocument.documentElement.classList.contains(STRIP_GUTTER_CLASS),
  'precondition: gutters active on desktop',
)
_setViewport(true)
updateStripGutters()
assert(
  !stubDocument.documentElement.classList.contains(STRIP_GUTTER_CLASS),
  'mobile: gutter class cleared',
)
assertEqual(
  stubDocument.documentElement.style.getPropertyValue(STRIP_R_VAR),
  '',
  'mobile: strip vars cleared',
)

// clearStripGutters full cleanup
_resetAll()
_installDom({ leftSide: false, secondaryList: true })
_hydrate({ keepTabListVisible: true, moveControlsToOuterEdge: true })
_setViewport(false)
updateStripGutters()
clearStripGutters()
assert(
  !stubDocument.documentElement.classList.contains(STRIP_GUTTER_CLASS),
  'clearStripGutters removes class',
)
assertEqual(
  stubDocument.documentElement.style.getPropertyValue(STRIP_L_VAR),
  '',
  'clearStripGutters removes left var',
)
assertEqual(
  stubDocument.documentElement.style.getPropertyValue(STRIP_R_VAR),
  '',
  'clearStripGutters removes right var',
)

// keep-tabs requires outer-edge (normalize)
_resetAll()
_installDom()
_hydrate({ keepTabListVisible: true, moveControlsToOuterEdge: false })
updateStripGutters()
assert(
  !stubDocument.documentElement.classList.contains(STRIP_GUTTER_CLASS),
  'keep-tabs without outer-edge: no gutters (normalized off)',
)

console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
process.exit(failed > 0 ? 1 : 0)
