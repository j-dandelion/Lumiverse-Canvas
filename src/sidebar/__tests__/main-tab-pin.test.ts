// Tests for main-drawer mirror pin (src/sidebar/main-tab-pin.ts)
//
// Verifies:
// - Dual pin hosts coexist (secondary reparent + main mirror)
// - Main mirror builds buttons and forwards clicks
// - Open main drawer hides mirror host
// - Mobile force-off
// - Unpin clears main host without touching secondary

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { failed++; console.error(`FAIL: ${msg} — expected ${String(expected)}, got ${String(actual)}`) }
}

// --- Minimal DOM stubs ---

class StubStyle {
  private _props: Record<string, string> = {}
  get position() { return this._props['position'] ?? '' }
  set position(v: string) { this._props['position'] = v }
  get top() { return this._props['top'] ?? '' }
  set top(v: string) { this._props['top'] = v }
  get bottom() { return this._props['bottom'] ?? '' }
  set bottom(v: string) { this._props['bottom'] = v }
  get left() { return this._props['left'] ?? '' }
  set left(v: string) { this._props['left'] = v }
  get right() { return this._props['right'] ?? '' }
  set right(v: string) { this._props['right'] = v }
  get zIndex() { return this._props['zIndex'] ?? '' }
  set zIndex(v: string) { this._props['zIndex'] = v }
  get width() { return this._props['width'] ?? '' }
  set width(v: string) { this._props['width'] = v }
  get pointerEvents() { return this._props['pointerEvents'] ?? '' }
  set pointerEvents(v: string) { this._props['pointerEvents'] = v }
  get borderLeft() { return this._props['borderLeft'] ?? '' }
  set borderLeft(v: string) { this._props['borderLeft'] = v }
  get borderRight() { return this._props['borderRight'] ?? '' }
  set borderRight(v: string) { this._props['borderRight'] = v }
  get display() { return this._props['display'] ?? '' }
  set display(v: string) { this._props['display'] = v }
  get flexDirection() { return this._props['flexDirection'] ?? '' }
  set flexDirection(v: string) { this._props['flexDirection'] = v }
  get flexShrink() { return this._props['flexShrink'] ?? '' }
  set flexShrink(v: string) { this._props['flexShrink'] = v }
  get alignItems() { return this._props['alignItems'] ?? '' }
  set alignItems(v: string) { this._props['alignItems'] = v }
  get overflowY() { return this._props['overflowY'] ?? '' }
  set overflowY(v: string) { this._props['overflowY'] = v }
  get overflowX() { return this._props['overflowX'] ?? '' }
  set overflowX(v: string) { this._props['overflowX'] = v }
  get boxSizing() { return this._props['boxSizing'] ?? '' }
  set boxSizing(v: string) { this._props['boxSizing'] = v }
  get background() { return this._props['background'] ?? '' }
  set background(v: string) { this._props['background'] = v }
  get transform() { return this._props['transform'] ?? '' }
  set transform(v: string) { this._props['transform'] = v }
  get cssText() { return this._props['cssText'] ?? '' }
  set cssText(v: string) { this._props['cssText'] = v }
  setProperty(k: string, v: string, _priority?: string) { this._props[k] = v }
  getPropertyValue(k: string) { return this._props[k] ?? '' }
  removeProperty(k: string) { delete this._props[k] }
}

class StubElement {
  style = new StubStyle()
  className = ''
  type = ''
  tagName = 'DIV'
  innerHTML = ''
  private _classSet = new Set<string>()
  private _attrs: Record<string, string> = {}
  parentElement: StubElement | null = null
  children: StubElement[] = []
  nextSibling: StubElement | null = null
  firstChild: StubElement | null = null
  childNodes: StubElement[] = []
  isConnected = true
  clickCount = 0
  private _listeners: Record<string, Function[]> = {}

  classList = {
    add: (c: string) => {
      // Keep _classSet in sync with any prior className string writes.
      for (const t of this.className.split(/\s+/).filter(Boolean)) this._classSet.add(t)
      this._classSet.add(c)
      this.className = Array.from(this._classSet).join(' ')
    },
    remove: (c: string) => {
      for (const t of this.className.split(/\s+/).filter(Boolean)) this._classSet.add(t)
      this._classSet.delete(c)
      this.className = Array.from(this._classSet).join(' ')
    },
    contains: (c: string) => {
      for (const t of this.className.split(/\s+/).filter(Boolean)) this._classSet.add(t)
      return this._classSet.has(c)
    },
    toggle: (c: string, force?: boolean) => {
      for (const t of this.className.split(/\s+/).filter(Boolean)) this._classSet.add(t)
      const on = force === undefined ? !this._classSet.has(c) : force
      if (on) this.classList.add(c)
      else this.classList.remove(c)
      return on
    },
    toString: () => this.className,
  }

  setAttribute(k: string, v: string) { this._attrs[k] = v }
  getAttribute(k: string) { return this._attrs[k] ?? null }
  removeAttribute(k: string) { delete this._attrs[k] }
  closest(_sel: string): StubElement | null { return null }
  querySelector(sel: string): StubElement | null {
    // Attribute-key lookup must not fall through to "first matching class"
    if (sel.includes('[data-mirror-key=') || sel.includes('data-mirror-key=')) {
      const m = sel.match(/data-mirror-key="([^"]+)"/)
      if (m) {
        for (const c of this.children) {
          if (c.getAttribute('data-mirror-key') === m[1]) return c
        }
      }
      return null
    }
    if (sel.includes('sidebar-ux-main-tab-list-mirror')) {
      for (const c of this.children) {
        if (c.className.includes('sidebar-ux-main-tab-list-mirror')) return c
      }
      return null
    }
    if (sel.includes('tabLabel')) {
      for (const c of this.children) {
        if (c.className.includes('tabLabel')) return c
        const nested = c.querySelector(sel)
        if (nested) return nested
      }
    }
    if (sel === 'svg') {
      for (const c of this.children) {
        if (c.tagName === 'SVG' || c.tagName === 'svg') return c
        const nested = c.querySelector('svg')
        if (nested) return nested
      }
    }
    return null
  }
  querySelectorAll(sel: string): StubElement[] {
    if (sel.includes('tabBtn')) {
      return this.children.filter((c) => c.className.includes('tabBtn') || String(c.tagName) === 'BUTTON')
    }
    return []
  }
  addEventListener(type: string, fn: Function) {
    if (!this._listeners[type]) this._listeners[type] = []
    this._listeners[type].push(fn)
  }
  removeEventListener(type: string, fn: Function) {
    this._listeners[type] = (this._listeners[type] || []).filter((f) => f !== fn)
  }
  click() {
    this.clickCount++
    for (const fn of this._listeners['click'] || []) {
      fn({ preventDefault() {}, stopPropagation() {}, currentTarget: this })
    }
  }
  getBoundingClientRect() {
    return { width: 420, height: 800, top: 0, left: 0, right: 420, bottom: 800, x: 0, y: 0, toJSON() {} }
  }
  remove() {
    if (this.parentElement) this.parentElement.removeChild(this)
  }
  removeChild(child: StubElement) {
    this.children = this.children.filter((c) => c !== child)
    this.childNodes = this.children
    this.firstChild = this.children[0] ?? null
    child.parentElement = null
    this._relinkSiblings()
    return child
  }
  appendChild(child: StubElement) {
    if (child.parentElement) child.parentElement.removeChild(child)
    this.children.push(child)
    this.childNodes = this.children
    this.firstChild = this.children[0] ?? null
    child.parentElement = this
    this._relinkSiblings()
    return child
  }
  insertBefore(child: StubElement, ref: StubElement | null) {
    if (child.parentElement) child.parentElement.removeChild(child)
    if (!ref) return this.appendChild(child)
    const idx = this.children.indexOf(ref)
    if (idx < 0) return this.appendChild(child)
    this.children.splice(idx, 0, child)
    this.childNodes = this.children
    this.firstChild = this.children[0] ?? null
    child.parentElement = this
    this._relinkSiblings()
    return child
  }
  private _relinkSiblings() {
    for (let i = 0; i < this.children.length; i++) {
      this.children[i].nextSibling = this.children[i + 1] ?? null
    }
  }
}

const bodyStub = new StubElement()
const mainWrapper = new StubElement()
mainWrapper.className = '_wrapper_abc'
const mainSidebar = new StubElement()
mainSidebar.className = '_sidebar_xyz'
mainSidebar.setAttribute('data-spindle-mount', 'sidebar')
mainWrapper.appendChild(mainSidebar)
mainSidebar.closest = (sel: string) => {
  if (sel.includes('_wrapper_')) return mainWrapper
  return null
}

function makeHostBtn(id: string, title: string, active = false): StubElement {
  const btn = new StubElement()
  btn.tagName = 'BUTTON'
  btn.className = active ? 'tabBtn tabBtnActive' : 'tabBtn'
  btn.classList.add('tabBtn')
  if (active) btn.classList.add('tabBtnActive')
  btn.setAttribute('data-tab-id', id)
  btn.setAttribute('title', title)
  const span = new StubElement()
  span.tagName = 'SPAN'
  const svg = new StubElement()
  svg.tagName = 'svg'
  svg.setAttribute('data-icon', id)
  span.appendChild(svg)
  btn.appendChild(span)
  const label = new StubElement()
  label.tagName = 'SPAN'
  label.className = 'tabLabel_abc'
  label.classList.add('tabLabel_abc')
  ;(label as any).textContent = title.slice(0, 4)
  btn.appendChild(label)
  return btn
}

// Fix outerHTML / textContent for stubs used in buildMirrorInnerHtml
Object.defineProperty(StubElement.prototype, 'outerHTML', {
  get(this: StubElement) {
    if (this.tagName === 'svg' || this.tagName === 'SVG') {
      return `<svg data-stub="${this.getAttribute('data-icon') || ''}"></svg>`
    }
    return `<${this.tagName}></${this.tagName}>`
  },
  configurable: true,
})
Object.defineProperty(StubElement.prototype, 'textContent', {
  get(this: StubElement) {
    return (this as any)._text ?? ''
  },
  set(this: StubElement, v: string) {
    ;(this as any)._text = v
  },
  configurable: true,
})

const headStub = new StubElement()
headStub.tagName = 'HEAD'
const documentElementStub = new StubElement()
documentElementStub.tagName = 'HTML'
documentElementStub.classList = mainWrapper.classList // will re-bind after; use own set
// Own classList for documentElement
documentElementStub.className = ''
const _docClassSet = new Set<string>()
documentElementStub.classList = {
  add: (c: string) => { _docClassSet.add(c); documentElementStub.className = Array.from(_docClassSet).join(' ') },
  remove: (c: string) => { _docClassSet.delete(c); documentElementStub.className = Array.from(_docClassSet).join(' ') },
  contains: (c: string) => _docClassSet.has(c),
  toggle: (c: string, force?: boolean) => {
    const on = force === undefined ? !_docClassSet.has(c) : force
    if (on) documentElementStub.classList.add(c)
    else documentElementStub.classList.remove(c)
    return on
  },
  toString: () => documentElementStub.className,
}

;(globalThis as any).document = {
  body: bodyStub,
  head: headStub,
  documentElement: documentElementStub,
  getElementById(_id: string): StubElement | null { return null },
  createElement(_tag: string): StubElement {
    const el = new StubElement()
    if (_tag === 'button') el.tagName = 'BUTTON'
    if (_tag === 'style') el.tagName = 'STYLE'
    return el
  },
  querySelector(sel: string): StubElement | null {
    if (sel === '[data-spindle-mount="sidebar"]') return mainSidebar
    if (sel.includes('_wrapper_')) return mainWrapper
    return null
  },
  querySelectorAll(sel: string): StubElement[] {
    if (sel.includes('sidebar-ux-tab-list-pin-host')) {
      return bodyStub.children.filter((c) => c.className.includes('sidebar-ux-tab-list-pin-host'))
    }
    return []
  },
}

let _rafTime = 0
const _raf = (fn: FrameRequestCallback) => {
  // Advance time past ANIM_DURATION so one frame completes the ease.
  _rafTime += 400
  const t = _rafTime
  queueMicrotask(() => fn(t))
  return t
}
;(globalThis as any).window = {
  innerWidth: 1280,
  matchMedia: (_q: string) => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }),
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame: _raf,
  cancelAnimationFrame() {},
}

// requestAnimationFrame on global
;(globalThis as any).requestAnimationFrame = _raf
;(globalThis as any).cancelAnimationFrame = () => {}
;(globalThis as any).MutationObserver = class {
  observe() {}
  disconnect() {}
}

import {
  applyMainTabListPin,
  reconcileMainTabListPin,
  isMainTabListPinActive,
  MAIN_MIRROR_LIST_CLASS,
  MAIN_MIRROR_BTN_CLASS,
  __resetMainTabPinForTest,
} from '../main-tab-pin'
import {
  applyTabListPin,
  ensureMainPinHost,
  getMainPinHost,
  TAB_LIST_PIN_HOST_CLASS,
  PIN_OWNER_MAIN,
  PIN_OWNER_SECONDARY,
  __resetPinStateForTest,
  __getPinHostForTest,
  __getMainPinHostForTest,
} from '../tab-position'
import { __setSecondaryWrapperForTest } from '../secondary'

// Secondary tree stubs (minimal for dual-host test)
const secDrawer = new StubElement()
const secTabList = new StubElement()
secTabList.className = 'sidebar-ux-tab-list'
secTabList.classList.add('sidebar-ux-tab-list')
const secPanel = new StubElement()
const secWrapper = new StubElement()
secWrapper.className = 'sidebar-ux-secondary-wrapper'
secWrapper.querySelector = (sel: string): StubElement | null => {
  if (sel === '.sidebar-ux-drawer') return secDrawer
  if (sel === '.sidebar-ux-tab-list') {
    let p: StubElement | null = secTabList.parentElement
    while (p) {
      if (p === secDrawer) return secTabList
      p = p.parentElement
    }
    return null
  }
  if (sel === '.sidebar-ux-panel') return secPanel
  return null
}
secDrawer.appendChild(secTabList)
secDrawer.appendChild(secPanel)
secWrapper.appendChild(secDrawer)

function resetAll() {
  __resetMainTabPinForTest()
  __resetPinStateForTest()
  while (bodyStub.firstChild) bodyStub.removeChild(bodyStub.firstChild!)
  while (mainSidebar.firstChild) mainSidebar.removeChild(mainSidebar.firstChild!)
  mainWrapper.className = '_wrapper_abc' // closed — no wrapperOpen
  ;(globalThis as any).window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  })
  __setSecondaryWrapperForTest(secWrapper as any)
  // Re-wire secondary tree
  while (secDrawer.firstChild) secDrawer.removeChild(secDrawer.firstChild!)
  secTabList.className = 'sidebar-ux-tab-list'
  secTabList.classList.add('sidebar-ux-tab-list')
  secDrawer.appendChild(secTabList)
  secDrawer.appendChild(secPanel)
}

// M1: enable main pin creates host with data-pin-owner=main and mirror buttons
{
  resetAll()
  const b1 = makeHostBtn('profile', 'Profile', true)
  const b2 = makeHostBtn('memory', 'Memory', false)
  mainSidebar.appendChild(b1)
  mainSidebar.appendChild(b2)

  // Fix querySelectorAll on mainSidebar to return buttons
  mainSidebar.querySelectorAll = (sel: string): StubElement[] => {
    if (sel.includes('tabBtn')) {
      return mainSidebar.children.filter((c) => c.className.includes('tabBtn'))
    }
    return []
  }

  applyMainTabListPin(true, { force: true })

  assert(isMainTabListPinActive(), 'M1: pin active')
  const host = getMainPinHost() as unknown as StubElement | null
  assert(!!host, 'M1: main pin host exists')
  assertEqual(host!.getAttribute('data-pin-owner'), PIN_OWNER_MAIN, 'M1: owner=main')
  assert(host!.className.includes(TAB_LIST_PIN_HOST_CLASS), 'M1: pin host class')
  assertEqual(host!.style.display, '', 'M1: host visible when drawer closed')

  const list = host!.children.find((c) => c.className.includes(MAIN_MIRROR_LIST_CLASS))
  assert(!!list, 'M1: mirror list present')
  const mirrors = list!.children.filter((c) => c.className.includes(MAIN_MIRROR_BTN_CLASS))
  assertEqual(mirrors.length, 2, 'M1: two mirror buttons')
  assertEqual(mirrors[0].getAttribute('data-tab-id'), 'profile', 'M1: first mirror id')
  assert(mirrors[0].classList.contains('sidebar-ux-tab-active'), 'M1: active class mirrored')
}

// M2: host wrapperOpen does NOT hide pin host (Canvas owns open/close)
{
  resetAll()
  mainSidebar.querySelectorAll = (sel: string): StubElement[] => {
    if (sel.includes('tabBtn')) return mainSidebar.children.filter((c) => c.className.includes('tabBtn'))
    return []
  }
  mainSidebar.appendChild(makeHostBtn('profile', 'Profile', true))
  applyMainTabListPin(true, { force: true })
  assertEqual((getMainPinHost() as unknown as StubElement)!.style.display, '', 'M2: pre visible')

  mainWrapper.className = '_wrapper_abc wrapperOpen'
  applyMainTabListPin(true, { force: true })
  assertEqual(
    (getMainPinHost() as unknown as StubElement)!.style.display,
    '',
    'M2: pin stays visible when host open',
  )
  // Host is hidden via documentElement CSS marker, not host class mutation
  // (mutating host className fought React and froze the tab).
  assert(
    documentElementStub.classList.contains('sidebar-ux-canvas-main-active'),
    'M2: document marker for Canvas main mode',
  )
}

// M3: click forwards to host button
{
  resetAll()
  mainSidebar.querySelectorAll = (sel: string): StubElement[] => {
    if (sel.includes('tabBtn')) return mainSidebar.children.filter((c) => c.className.includes('tabBtn'))
    return []
  }
  const hostBtn = makeHostBtn('profile', 'Profile', false)
  mainSidebar.appendChild(hostBtn)
  applyMainTabListPin(true, { force: true })

  const host = getMainPinHost() as unknown as StubElement
  const list = host.children.find((c) => c.className.includes(MAIN_MIRROR_LIST_CLASS))!
  const mirror = list.children[0] as StubElement
  assert(!!mirror, 'M3: mirror exists')
  mirror.click()
  assertEqual(hostBtn.clickCount, 1, 'M3: host button clicked')
}

// M4: dual hosts — secondary + main coexist; sweep does not kill either
{
  resetAll()
  mainSidebar.querySelectorAll = (sel: string): StubElement[] => {
    if (sel.includes('tabBtn')) return mainSidebar.children.filter((c) => c.className.includes('tabBtn'))
    return []
  }
  mainSidebar.appendChild(makeHostBtn('profile', 'Profile', false))

  applyTabListPin(true, { force: true })
  applyMainTabListPin(true, { force: true })

  const secHost = __getPinHostForTest() as StubElement | null
  const mainHost = __getMainPinHostForTest() as StubElement | null
  assert(!!secHost, 'M4: secondary host')
  assert(!!mainHost, 'M4: main host')
  assert(secHost !== mainHost, 'M4: distinct hosts')
  assertEqual(secHost!.getAttribute('data-pin-owner'), PIN_OWNER_SECONDARY, 'M4: sec owner')
  assertEqual(mainHost!.getAttribute('data-pin-owner'), PIN_OWNER_MAIN, 'M4: main owner')

  // Force re-ensure main host (runs sweep) — secondary must survive
  ensureMainPinHost('right')
  assert(!!__getPinHostForTest(), 'M4: secondary host survives main ensure')
  assert(!!__getMainPinHostForTest(), 'M4: main host survives')
}

// M5: disable clears main host only
{
  resetAll()
  mainSidebar.querySelectorAll = (sel: string): StubElement[] => {
    if (sel.includes('tabBtn')) return mainSidebar.children.filter((c) => c.className.includes('tabBtn'))
    return []
  }
  mainSidebar.appendChild(makeHostBtn('profile', 'Profile', false))
  applyTabListPin(true, { force: true })
  applyMainTabListPin(true, { force: true })
  applyMainTabListPin(false, { force: true })

  assertEqual(getMainPinHost(), null, 'M5: main host gone')
  assert(!isMainTabListPinActive(), 'M5: inactive')
  assert(!!__getPinHostForTest(), 'M5: secondary host remains')
}

// M6: mobile no-op
{
  resetAll()
  mainSidebar.querySelectorAll = (sel: string): StubElement[] => {
    if (sel.includes('tabBtn')) return mainSidebar.children.filter((c) => c.className.includes('tabBtn'))
    return []
  }
  mainSidebar.appendChild(makeHostBtn('profile', 'Profile', false))
  ;(globalThis as any).window.matchMedia = () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  })
  applyMainTabListPin(true, { force: true })
  assertEqual(getMainPinHost(), null, 'M6: no host on mobile')
  assert(!isMainTabListPinActive(), 'M6: inactive on mobile')
}

// M7: hidden host buttons (display:none) are not mirrored
{
  resetAll()
  mainSidebar.querySelectorAll = (sel: string): StubElement[] => {
    if (sel.includes('tabBtn')) return mainSidebar.children.filter((c) => c.className.includes('tabBtn'))
    return []
  }
  const visible = makeHostBtn('profile', 'Profile', false)
  const hidden = makeHostBtn('moved', 'Moved', false)
  hidden.style.display = 'none'
  mainSidebar.appendChild(visible)
  mainSidebar.appendChild(hidden)
  applyMainTabListPin(true, { force: true })
  const host = getMainPinHost() as unknown as StubElement
  const list = host.children.find((c) => c.className.includes(MAIN_MIRROR_LIST_CLASS))!
  assertEqual(list.children.length, 1, 'M7: only visible button mirrored')
  assertEqual(list.children[0].getAttribute('data-tab-id'), 'profile', 'M7: profile only')
}

// M8: reconcileMainTabListPin with default setting leaves off
{
  resetAll()
  reconcileMainTabListPin()
  assert(!isMainTabListPinActive(), 'M8: default off')
  assertEqual(getMainPinHost(), null, 'M8: no host')
}

console.log(`main-tab-pin tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
