// Tests for main-drawer mirror pin (src/sidebar/main-tab-pin.ts)
//
// Verifies:
// - Dual pin hosts coexist (secondary reparent + main mirror)
// - Main mirror builds buttons and forwards clicks
// - Open main drawer hides mirror host
// - Mobile force-off
// - Unpin clears main host without touching secondary
// - Header title survives force remount / side change (M17)

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
  get height() { return this._props['height'] ?? '' }
  set height(v: string) { this._props['height'] = v }
  get gap() { return this._props['gap'] ?? '' }
  set gap(v: string) { this._props['gap'] = v }
  get border() { return this._props['border'] ?? '' }
  set border(v: string) { this._props['border'] = v }
  get cursor() { return this._props['cursor'] ?? '' }
  set cursor(v: string) { this._props['cursor'] = v }
  get transition() { return this._props['transition'] ?? '' }
  set transition(v: string) { this._props['transition'] = v }
  get padding() { return this._props['padding'] ?? '' }
  set padding(v: string) { this._props['padding'] = v }
  get color() { return this._props['color'] ?? '' }
  set color(v: string) { this._props['color'] = v }
  get boxShadow() { return this._props['boxShadow'] ?? '' }
  set boxShadow(v: string) { this._props['boxShadow'] = v }
  get borderRadius() { return this._props['borderRadius'] ?? '' }
  set borderRadius(v: string) { this._props['borderRadius'] = v }
  get justifyContent() { return this._props['justifyContent'] ?? '' }
  set justifyContent(v: string) { this._props['justifyContent'] = v }
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
  /** Synthetic contextmenu events received via dispatchEvent (M9c host-forward). */
  contextmenuDispatches: Array<{ clientX: number; clientY: number }> = []
  private _listeners: Record<string, Function[]> = {}
  /** dataset proxy used by drawer-shell (data-drawer-open, etc.). */
  dataset: Record<string, string> = {}

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

  setAttribute(k: string, v: string) {
    this._attrs[k] = v
    if (k.startsWith('data-') && k.length > 5) {
      const camel = k
        .slice(5)
        .replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())
      this.dataset[camel] = v
    }
  }
  getAttribute(k: string) { return this._attrs[k] ?? null }
  removeAttribute(k: string) {
    delete this._attrs[k]
    if (k.startsWith('data-') && k.length > 5) {
      const camel = k
        .slice(5)
        .replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())
      delete this.dataset[camel]
    }
  }
  closest(_sel: string): StubElement | null { return null }
  querySelector(sel: string): StubElement | null {
    // Attribute-key lookup must not fall through to "first matching class"
    if (sel.includes('[data-mirror-key=') || sel.includes('data-mirror-key=')) {
      const m = sel.match(/data-mirror-key="([^"]+)"/)
      if (m) {
        const walk = (el: StubElement): StubElement | null => {
          if (el.getAttribute('data-mirror-key') === m[1]) return el
          for (const c of el.children) {
            const hit = walk(c)
            if (hit) return hit
          }
          return null
        }
        for (const c of this.children) {
          const hit = walk(c)
          if (hit) return hit
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
    if (sel.includes('sidebar-ux-main-tab-mirror-btn')) {
      const out: StubElement[] = []
      const walk = (el: StubElement) => {
        if (el.className.includes('sidebar-ux-main-tab-mirror-btn')) out.push(el)
        for (const c of el.children) walk(c)
      }
      for (const c of this.children) walk(c)
      return out
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
  /**
   * Programmatic event dispatch (production onMirrorContextMenu uses this on
   * the host twin). Tracks contextmenu for M9c assertions.
   */
  dispatchEvent(ev: { type?: string; clientX?: number; clientY?: number }): boolean {
    if (ev?.type === 'contextmenu') {
      this.contextmenuDispatches.push({
        clientX: ev.clientX ?? 0,
        clientY: ev.clientY ?? 0,
      })
    }
    const type = ev?.type
    if (type && this._listeners[type]) {
      for (const fn of this._listeners[type]) {
        fn({
          ...ev,
          preventDefault() {},
          stopPropagation() {},
          currentTarget: this,
          target: this,
        })
      }
    }
    return true
  }
  /** Fire a contextmenu event on this element (mirror listener tests). */
  contextmenu(clientX = 10, clientY = 20) {
    for (const fn of this._listeners['contextmenu'] || []) {
      fn({
        preventDefault() {},
        stopPropagation() {},
        currentTarget: this,
        clientX,
        clientY,
      })
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

// MouseEvent for onMirrorContextMenu host-forward (bun stub env has no DOM events).
if (typeof (globalThis as any).MouseEvent === 'undefined') {
  ;(globalThis as any).MouseEvent = class MouseEvent {
    type: string
    bubbles: boolean
    cancelable: boolean
    view: unknown
    clientX: number
    clientY: number
    button: number
    buttons: number
    constructor(type: string, init: Record<string, unknown> = {}) {
      this.type = type
      this.bubbles = !!init.bubbles
      this.cancelable = !!init.cancelable
      this.view = init.view
      this.clientX = (init.clientX as number) ?? 0
      this.clientY = (init.clientY as number) ?? 0
      this.button = (init.button as number) ?? 0
      this.buttons = (init.buttons as number) ?? 0
    }
  }
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
  getActiveMainMirrorKey,
  activateMainMirrorFromRestore,
  adoptMainMirrorHostActivation,
  MAIN_MIRROR_LIST_CLASS,
  MAIN_MIRROR_BTN_CLASS,
  MAIN_MIRROR_LIST_MAIN_CLASS,
  MAIN_MIRROR_LIST_BOTTOM_CLASS,
  __resetMainTabPinForTest,
} from '../main-tab-pin'
import { isCanvasMainOpen, getMainMirrorTitleEl } from '../main-mirror-drawer'
import { __setShowAssignmentMenuForTest } from '../../tabs/tab-context-menu'
import {
  __setHostSetSettingForTest,
  clearHostSettingsCache,
} from '../../dom/host-settings'

/** Collect mirror buttons from the list (nested under main/bottom sections). */
function collectMirrorButtons(list: StubElement): StubElement[] {
  const out: StubElement[] = []
  const walk = (el: StubElement) => {
    if (el.className.includes(MAIN_MIRROR_BTN_CLASS)) out.push(el)
    for (const c of el.children) walk(c)
  }
  for (const c of list.children) walk(c)
  return out
}
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
import { setTabAssignment, deleteTabAssignment } from '../../tabs/assignment'

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
  // Clear canvas main open/active markers left by prior cases.
  for (const c of Array.from(_docClassSet)) documentElementStub.classList.remove(c)
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
  const mirrors = collectMirrorButtons(list!)
  assertEqual(mirrors.length, 2, 'M1: two mirror buttons')
  assertEqual(mirrors[0].getAttribute('data-tab-id'), 'profile', 'M1: first mirror id')
  // Secondary parity: no tab looks selected while the drawer is closed.
  assert(!mirrors[0].classList.contains('sidebar-ux-tab-active'), 'M1: no active highlight while closed')
  // Open via mirror click → host active should show on open.
  mirrors[0].click()
  // Reconcile after open restores host active class.
  applyMainTabListPin(true, { force: true })
  const listAfter = (getMainPinHost() as unknown as StubElement)!
    .children.find((c) => c.className.includes(MAIN_MIRROR_LIST_CLASS))!
  const m0 = collectMirrorButtons(listAfter).find((c) => c.getAttribute('data-tab-id') === 'profile')!
  assert(m0.classList.contains('sidebar-ux-tab-active'), 'M1: active class mirrored when open')
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
  const mirror = collectMirrorButtons(list)[0]
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

  // Secondary pin is gated on hasSecondaryAssignedTabs() (taskbar empty strip).
  setTabAssignment('m4-sec-tab', 'secondary')
  applyTabListPin(true, { force: true })
  applyMainTabListPin(true, { force: true })

  const secHost = __getPinHostForTest() as StubElement | null
  const mainHost = __getMainPinHostForTest() as StubElement | null
  assert(!!secHost, 'M4: secondary host')
  assert(!!mainHost, 'M4: main host')
  if (secHost && mainHost) {
    assert(secHost !== mainHost, 'M4: distinct hosts')
    assertEqual(secHost.getAttribute('data-pin-owner'), PIN_OWNER_SECONDARY, 'M4: sec owner')
    assertEqual(mainHost.getAttribute('data-pin-owner'), PIN_OWNER_MAIN, 'M4: main owner')
  }

  // Force re-ensure main host (runs sweep) — secondary must survive
  ensureMainPinHost('right')
  assert(!!__getPinHostForTest(), 'M4: secondary host survives main ensure')
  assert(!!__getMainPinHostForTest(), 'M4: main host survives')
  deleteTabAssignment('m4-sec-tab')
}

// M5: disable clears main host only
{
  resetAll()
  mainSidebar.querySelectorAll = (sel: string): StubElement[] => {
    if (sel.includes('tabBtn')) return mainSidebar.children.filter((c) => c.className.includes('tabBtn'))
    return []
  }
  mainSidebar.appendChild(makeHostBtn('profile', 'Profile', false))
  setTabAssignment('m5-sec-tab', 'secondary')
  applyTabListPin(true, { force: true })
  applyMainTabListPin(true, { force: true })
  applyMainTabListPin(false, { force: true })

  assertEqual(getMainPinHost(), null, 'M5: main host gone')
  assert(!isMainTabListPinActive(), 'M5: inactive')
  assert(!!__getPinHostForTest(), 'M5: secondary host remains')
  deleteTabAssignment('m5-sec-tab')
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
  const mirrors = collectMirrorButtons(list)
  assertEqual(mirrors.length, 1, 'M7: only visible button mirrored')
  assertEqual(mirrors[0].getAttribute('data-tab-id'), 'profile', 'M7: profile only')
}

// M8: reconcileMainTabListPin with default setting leaves off
{
  resetAll()
  reconcileMainTabListPin()
  assert(!isMainTabListPinActive(), 'M8: default off')
  assertEqual(getMainPinHost(), null, 'M8: no host')
}

// M9: Settings mirrors into bottom dock with separator chrome (host .sidebarBottom)
{
  resetAll()
  mainSidebar.querySelectorAll = (sel: string): StubElement[] => {
    if (sel.includes('tabBtn')) return mainSidebar.children.filter((c) => c.className.includes('tabBtn'))
    return []
  }
  const profile = makeHostBtn('profile', 'Profile', false)
  const settings = makeHostBtn('settings', 'Settings', false)
  // Host settings often has no data-tab-id — isSettingsButton uses title.
  settings.removeAttribute('data-tab-id')
  settings.setAttribute('title', 'Settings')
  settings.setAttribute('aria-label', 'Settings')
  mainSidebar.appendChild(profile)
  mainSidebar.appendChild(settings)

  applyMainTabListPin(true, { force: true })

  const host = getMainPinHost() as unknown as StubElement
  const list = host.children.find((c) => c.className.includes(MAIN_MIRROR_LIST_CLASS))!
  const mainSec = list.children.find((c) => c.className.includes(MAIN_MIRROR_LIST_MAIN_CLASS))
  const bottomSec = list.children.find((c) => c.className.includes(MAIN_MIRROR_LIST_BOTTOM_CLASS))
  assert(!!mainSec, 'M9: main section present')
  assert(!!bottomSec, 'M9: bottom section present')
  assertEqual(bottomSec!.style.display, 'flex', 'M9: bottom visible when settings exists')
  assertEqual(bottomSec!.style.marginTop, 'auto', 'M9: margin-top auto docks to strip end')
  assert(
    String(bottomSec!.style.borderTop || '').includes('primary-020') ||
      String(bottomSec!.style.borderTop || '').includes('1px'),
    'M9: top border separator',
  )

  const mainMirrors = mainSec!.children.filter((c) => c.className.includes(MAIN_MIRROR_BTN_CLASS))
  const bottomMirrors = bottomSec!.children.filter((c) => c.className.includes(MAIN_MIRROR_BTN_CLASS))
  assertEqual(mainMirrors.length, 1, 'M9: profile in main section')
  assertEqual(mainMirrors[0].getAttribute('data-tab-id'), 'profile', 'M9: profile id')
  assertEqual(bottomMirrors.length, 1, 'M9: settings in bottom section')
  assertEqual(bottomMirrors[0].getAttribute('title'), 'Settings', 'M9: settings title')
  // Click forwards to host but does not activate Canvas chrome (no key/open).
  assertEqual(getActiveMainMirrorKey(), null, 'M9: no active key before settings click')
  assert(!isCanvasMainOpen(), 'M9: drawer closed before settings click')
  bottomMirrors[0].click()
  assertEqual(settings.clickCount, 1, 'M9: settings click forwards to host')
  assertEqual(getActiveMainMirrorKey(), null, 'M9: settings does not set active key')
  assert(!isCanvasMainOpen(), 'M9: settings does not open drawer')

  // With a real tab open, Settings still only forwards — keeps key + open.
  mainMirrors[0].click()
  assertEqual(getActiveMainMirrorKey(), 'id__profile', 'M9: profile activates')
  assert(isCanvasMainOpen(), 'M9: profile opens drawer')
  bottomMirrors[0].click()
  assertEqual(settings.clickCount, 2, 'M9: second settings click still forwards')
  assertEqual(getActiveMainMirrorKey(), 'id__profile', 'M9: settings leaves profile key')
  assert(isCanvasMainOpen(), 'M9: settings leaves drawer open')
}

// M9b: stale-key heal must not adopt Settings as Canvas active tab / title.
{
  resetAll()
  mainSidebar.querySelectorAll = (sel: string): StubElement[] => {
    if (sel.includes('tabBtn')) return mainSidebar.children.filter((c) => c.className.includes('tabBtn'))
    return []
  }
  const memory = makeHostBtn('memory', 'Memory', false)
  const settings = makeHostBtn('settings', 'Settings', false)
  settings.removeAttribute('data-tab-id')
  settings.setAttribute('title', 'Settings')
  settings.setAttribute('aria-label', 'Settings')
  mainSidebar.appendChild(memory)
  mainSidebar.appendChild(settings)
  applyMainTabListPin(true, { force: true })

  const list0 = (getMainPinHost() as unknown as StubElement)!
    .children.find((c) => c.className.includes(MAIN_MIRROR_LIST_CLASS))!
  const memoryMirror = collectMirrorButtons(list0).find(
    (m) => m.getAttribute('data-tab-id') === 'memory',
  )!
  memoryMirror.click()
  assertEqual(getActiveMainMirrorKey(), 'id__memory', 'M9b: key = memory after click')

  // Memory leaves primary; only Settings remains and is host-active.
  mainSidebar.removeChild(memory)
  memory.isConnected = false
  settings.classList.add('tabBtnActive')
  settings.className = 'tabBtn tabBtnActive'
  applyMainTabListPin(true, { force: true })

  assertEqual(getActiveMainMirrorKey(), null, 'M9b: heal does not adopt Settings key')
}

// M9c: Settings right-click must not host-forward or open assignment menu.
// Profile right-click forwards synthetic contextmenu to the host twin (host
// ContextMenu + inject path) — never showAssignmentMenu.
{
  resetAll()
  const menuCalls: Array<{ tabId: string; title: string }> = []
  __setShowAssignmentMenuForTest((_x, _y, tabId, tabTitle) => {
    menuCalls.push({ tabId, title: tabTitle })
  })
  try {
    mainSidebar.querySelectorAll = (sel: string): StubElement[] => {
      if (sel.includes('tabBtn')) return mainSidebar.children.filter((c) => c.className.includes('tabBtn'))
      return []
    }
    const profile = makeHostBtn('profile', 'Profile', false)
    const settings = makeHostBtn('settings', 'Settings', false)
    settings.removeAttribute('data-tab-id')
    settings.setAttribute('title', 'Settings')
    settings.setAttribute('aria-label', 'Settings')
    mainSidebar.appendChild(profile)
    mainSidebar.appendChild(settings)
    applyMainTabListPin(true, { force: true })

    const host = getMainPinHost() as unknown as StubElement
    const list = host.children.find((c) => c.className.includes(MAIN_MIRROR_LIST_CLASS))!
    const mainSec = list.children.find((c) => c.className.includes(MAIN_MIRROR_LIST_MAIN_CLASS))!
    const bottomSec = list.children.find((c) => c.className.includes(MAIN_MIRROR_LIST_BOTTOM_CLASS))!
    const profileMirror = mainSec.children.find((c) => c.className.includes(MAIN_MIRROR_BTN_CLASS))!
    const settingsMirror = bottomSec.children.find((c) => c.className.includes(MAIN_MIRROR_BTN_CLASS))!

    profile.contextmenuDispatches = []
    settings.contextmenuDispatches = []

    settingsMirror.contextmenu(12, 34)
    assertEqual(menuCalls.length, 0, 'M9c: Settings contextmenu does not open assignment menu')
    assertEqual(settings.contextmenuDispatches.length, 0, 'M9c: Settings does not host-forward')
    assertEqual(profile.contextmenuDispatches.length, 0, 'M9c: Settings path does not dispatch on Profile')

    profileMirror.contextmenu(56, 78)
    assertEqual(menuCalls.length, 0, 'M9c: Profile does not open Canvas assignment menu')
    assertEqual(profile.contextmenuDispatches.length, 1, 'M9c: Profile host-forwards contextmenu')
    assertEqual(profile.contextmenuDispatches[0]?.clientX, 56, 'M9c: Profile forward clientX')
    assertEqual(profile.contextmenuDispatches[0]?.clientY, 78, 'M9c: Profile forward clientY')
    assertEqual(settings.contextmenuDispatches.length, 0, 'M9c: Profile path does not dispatch on Settings')
  } finally {
    __setShowAssignmentMenuForTest(null)
  }
}

// M10: toggle-close — click already-active tab while open closes drawer
// Regression: host can lose tabBtnActive while Canvas still owns open state;
// Canvas-owned active key must still close.
{
  resetAll()
  mainSidebar.querySelectorAll = (sel: string): StubElement[] => {
    if (sel.includes('tabBtn')) return mainSidebar.children.filter((c) => c.className.includes('tabBtn'))
    return []
  }
  const b1 = makeHostBtn('profile', 'Profile', false)
  const b2 = makeHostBtn('memory', 'Memory', false)
  mainSidebar.appendChild(b1)
  mainSidebar.appendChild(b2)
  applyMainTabListPin(true, { force: true })

  const list = (getMainPinHost() as unknown as StubElement)!
    .children.find((c) => c.className.includes(MAIN_MIRROR_LIST_CLASS))!
  const mirrors = collectMirrorButtons(list)
  const profileMirror = mirrors.find((m) => m.getAttribute('data-tab-id') === 'profile')!
  const memoryMirror = mirrors.find((m) => m.getAttribute('data-tab-id') === 'memory')!

  // Open profile
  profileMirror.click()
  assert(isCanvasMainOpen(), 'M10: drawer open after first click')
  assertEqual(getActiveMainMirrorKey(), 'id__profile', 'M10: active key = profile')
  assertEqual(b1.clickCount, 1, 'M10: host profile clicked once')

  // Simulate host losing tabBtnActive while Canvas stays open (repark / headless).
  b1.classList.remove('tabBtnActive')
  b1.className = 'tabBtn'
  applyMainTabListPin(true, { force: true })
  assert(isCanvasMainOpen(), 'M10: still open after reconcile')
  assertEqual(getActiveMainMirrorKey(), 'id__profile', 'M10: key survives host active loss')

  // Click same tab → close (must not re-open via onMainMirrorTabActivated)
  const hostClicksBeforeClose = b1.clickCount
  profileMirror.click()
  assert(!isCanvasMainOpen(), 'M10: click active tab closes drawer')
  assertEqual(b1.clickCount, hostClicksBeforeClose, 'M10: close path does not host-click')
  // Key retained for reopen parity (secondary-style)
  assertEqual(getActiveMainMirrorKey(), 'id__profile', 'M10: key not cleared on close')

  // Different tab while open switches (not close)
  profileMirror.click() // reopen
  assert(isCanvasMainOpen(), 'M10: reopen works')
  memoryMirror.click()
  assert(isCanvasMainOpen(), 'M10: switch keeps drawer open')
  assertEqual(getActiveMainMirrorKey(), 'id__memory', 'M10: active key updates to memory')
  assertEqual(b2.clickCount, 1, 'M10: memory host clicked')
}

// M11: restore / hard-refresh — Canvas key exclusive vs host default Profile.
// Host often leaves Profile tabBtnActive while restore activates another tab;
// mirror must not show two active highlights.
{
  resetAll()
  mainSidebar.querySelectorAll = (sel: string): StubElement[] => {
    if (sel.includes('tabBtn')) return mainSidebar.children.filter((c) => c.className.includes('tabBtn'))
    return []
  }
  // Profile still host-active (default); Memory is the restored target.
  const profile = makeHostBtn('profile', 'Profile', true)
  const memory = makeHostBtn('memory', 'Memory', false)
  mainSidebar.appendChild(profile)
  mainSidebar.appendChild(memory)
  applyMainTabListPin(true, { force: true })

  activateMainMirrorFromRestore(memory as unknown as HTMLElement, 'Memory')
  applyMainTabListPin(true, { force: true })

  assert(isCanvasMainOpen(), 'M11: drawer open after restore')
  assertEqual(getActiveMainMirrorKey(), 'id__memory', 'M11: canvas key = memory')

  const list = (getMainPinHost() as unknown as StubElement)!
    .children.find((c) => c.className.includes(MAIN_MIRROR_LIST_CLASS))!
  const mirrors = collectMirrorButtons(list)
  const profileMirror = mirrors.find((m) => m.getAttribute('data-tab-id') === 'profile')!
  const memoryMirror = mirrors.find((m) => m.getAttribute('data-tab-id') === 'memory')!
  assert(
    !profileMirror.classList.contains('sidebar-ux-tab-active'),
    'M11: Profile not active when canvas key is Memory (host still tabBtnActive)',
  )
  assert(
    memoryMirror.classList.contains('sidebar-ux-tab-active'),
    'M11: Memory alone is active',
  )
  assertEqual(
    mirrors.filter((m) => m.classList.contains('sidebar-ux-tab-active')).length,
    1,
    'M11: exactly one mirror active',
  )

  // Click Profile (host still tabBtnActive, not canvas key) must switch, not close.
  const profileClicksBefore = profile.clickCount
  profileMirror.click()
  assert(isCanvasMainOpen(), 'M11: Profile click switches (stays open), not close')
  assertEqual(getActiveMainMirrorKey(), 'id__profile', 'M11: canvas key updates to profile')
  assertEqual(profile.clickCount, profileClicksBefore + 1, 'M11: Profile host clicked on switch')
}

// M12: stale key heal after tab moves off primary (mirror button gone, host
// replacement tabBtnActive). Reconcile must adopt host active + highlight.
{
  resetAll()
  mainSidebar.querySelectorAll = (sel: string): StubElement[] => {
    if (sel.includes('tabBtn')) return mainSidebar.children.filter((c) => c.className.includes('tabBtn'))
    return []
  }
  const profile = makeHostBtn('profile', 'Profile', false)
  const memory = makeHostBtn('memory', 'Memory', false)
  mainSidebar.appendChild(profile)
  mainSidebar.appendChild(memory)
  applyMainTabListPin(true, { force: true })

  const list0 = (getMainPinHost() as unknown as StubElement)!
    .children.find((c) => c.className.includes(MAIN_MIRROR_LIST_CLASS))!
  const memoryMirror0 = collectMirrorButtons(list0).find(
    (m) => m.getAttribute('data-tab-id') === 'memory',
  )!
  memoryMirror0.click()
  assertEqual(getActiveMainMirrorKey(), 'id__memory', 'M12: key = memory after click')

  // Simulate move: remove Memory host button; Profile becomes host-active.
  mainSidebar.removeChild(memory)
  memory.isConnected = false
  profile.classList.add('tabBtnActive')
  profile.className = 'tabBtn tabBtnActive'
  applyMainTabListPin(true, { force: true })

  assertEqual(getActiveMainMirrorKey(), 'id__profile', 'M12: key healed to profile')
  const list = (getMainPinHost() as unknown as StubElement)!
    .children.find((c) => c.className.includes(MAIN_MIRROR_LIST_CLASS))!
  const mirrors = collectMirrorButtons(list)
  assertEqual(mirrors.length, 1, 'M12: only profile mirror remains')
  assertEqual(mirrors[0].getAttribute('data-tab-id'), 'profile', 'M12: remaining mirror is profile')
  assert(
    mirrors[0].classList.contains('sidebar-ux-tab-active'),
    'M12: profile mirror highlighted after heal',
  )
}

// M13: exclusive key while both host buttons still present — heal must NOT
// steal highlight to host tabBtnActive Profile when canvas key is Memory.
{
  resetAll()
  mainSidebar.querySelectorAll = (sel: string): StubElement[] => {
    if (sel.includes('tabBtn')) return mainSidebar.children.filter((c) => c.className.includes('tabBtn'))
    return []
  }
  const profile = makeHostBtn('profile', 'Profile', true)
  const memory = makeHostBtn('memory', 'Memory', false)
  mainSidebar.appendChild(profile)
  mainSidebar.appendChild(memory)
  applyMainTabListPin(true, { force: true })

  activateMainMirrorFromRestore(memory as unknown as HTMLElement, 'Memory')
  applyMainTabListPin(true, { force: true })

  assertEqual(getActiveMainMirrorKey(), 'id__memory', 'M13: key stays memory after reconcile')
  const list = (getMainPinHost() as unknown as StubElement)!
    .children.find((c) => c.className.includes(MAIN_MIRROR_LIST_CLASS))!
  const mirrors = collectMirrorButtons(list)
  const profileMirror = mirrors.find((m) => m.getAttribute('data-tab-id') === 'profile')!
  const memoryMirror = mirrors.find((m) => m.getAttribute('data-tab-id') === 'memory')!
  assert(
    !profileMirror.classList.contains('sidebar-ux-tab-active'),
    'M13: Profile not active (exclusive canvas key)',
  )
  assert(
    memoryMirror.classList.contains('sidebar-ux-tab-active'),
    'M13: Memory alone active',
  )
}

// M14: adoptMainMirrorHostActivation switches key without requiring host class first
{
  resetAll()
  mainSidebar.querySelectorAll = (sel: string): StubElement[] => {
    if (sel.includes('tabBtn')) return mainSidebar.children.filter((c) => c.className.includes('tabBtn'))
    return []
  }
  const profile = makeHostBtn('profile', 'Profile', true)
  const memory = makeHostBtn('memory', 'Memory', false)
  mainSidebar.appendChild(profile)
  mainSidebar.appendChild(memory)
  applyMainTabListPin(true, { force: true })

  adoptMainMirrorHostActivation(profile as unknown as HTMLElement, 'Profile')
  assert(isCanvasMainOpen(), 'M14: adopt opens drawer')
  assertEqual(getActiveMainMirrorKey(), 'id__profile', 'M14: key = profile after adopt')

  adoptMainMirrorHostActivation(memory as unknown as HTMLElement, 'Memory')
  assertEqual(getActiveMainMirrorKey(), 'id__memory', 'M14: key switches to memory')
  assert(isCanvasMainOpen(), 'M14: still open after second adopt')

  // open: false does not force-open after close
  const list = (getMainPinHost() as unknown as StubElement)!
    .children.find((c) => c.className.includes(MAIN_MIRROR_LIST_CLASS))!
  const profileMirror = collectMirrorButtons(list).find(
    (m) => m.getAttribute('data-tab-id') === 'profile',
  )!
  // Close via toggle
  adoptMainMirrorHostActivation(profile as unknown as HTMLElement, 'Profile')
  profileMirror.click() // active → close
  assert(!isCanvasMainOpen(), 'M14: closed after toggle')
  adoptMainMirrorHostActivation(memory as unknown as HTMLElement, 'Memory', { open: false })
  assert(!isCanvasMainOpen(), 'M14: open:false does not reopen')
  assertEqual(getActiveMainMirrorKey(), 'id__memory', 'M14: key still updates with open:false')
}

// M15: hide labels via host settings — stale host tabBtnLabeled must not
// re-inflate mirror height on reconcile/activate (empty label DOM).
{
  resetAll()
  clearHostSettingsCache()
  __setHostSetSettingForTest(() => {}, { showTabLabels: false, tabOrder: [], hiddenTabIds: [], side: 'right' })

  mainSidebar.querySelectorAll = (sel: string): StubElement[] => {
    if (sel.includes('tabBtn')) return mainSidebar.children.filter((c) => c.className.includes('tabBtn'))
    return []
  }
  // Stale host state after hide: class still labeled, but label span may lag.
  const profile = makeHostBtn('profile', 'Profile', true)
  profile.classList.add('tabBtnLabeled')
  profile.className = `${profile.className} tabBtnLabeled`
  mainSidebar.appendChild(profile)

  applyMainTabListPin(true, { force: true })
  let list = (getMainPinHost() as unknown as StubElement)!
    .children.find((c) => c.className.includes(MAIN_MIRROR_LIST_CLASS))!
  let mirror = collectMirrorButtons(list).find((m) => m.getAttribute('data-tab-id') === 'profile')!
  assert(
    !mirror.classList.contains('sidebar-ux-tab-labeled'),
    'M15: no labeled class when showTabLabels false (stale host class ignored)',
  )
  assertEqual(mirror.style.height, '48px', 'M15: icon-only height 48px after pin')

  // Click / activate path re-reconciles from host — must stay compact.
  adoptMainMirrorHostActivation(profile as unknown as HTMLElement, 'Profile')
  applyMainTabListPin(true, { force: true })
  list = (getMainPinHost() as unknown as StubElement)!
    .children.find((c) => c.className.includes(MAIN_MIRROR_LIST_CLASS))!
  mirror = collectMirrorButtons(list).find((m) => m.getAttribute('data-tab-id') === 'profile')!
  assert(
    !mirror.classList.contains('sidebar-ux-tab-labeled'),
    'M15: still unlabeled after activate/reconcile',
  )
  assertEqual(mirror.style.height, '48px', 'M15: height stays 48px after activate/reconcile')
  assert(
    !String(mirror.innerHTML || '').includes('sidebar-ux-tab-label'),
    'M15: no label span in mirror HTML when labels off',
  )

  clearHostSettingsCache()
}

// M16: Show labels after hide rebuilds main-mirror label HTML (title
// fallback when host .tabLabel not mounted yet — host React lag).
{
  resetAll()
  clearHostSettingsCache()
  __setHostSetSettingForTest(() => {}, { showTabLabels: false, tabOrder: [], hiddenTabIds: [], side: 'right' })

  mainSidebar.querySelectorAll = (sel: string): StubElement[] => {
    if (sel.includes('tabBtn')) return mainSidebar.children.filter((c) => c.className.includes('tabBtn'))
    return []
  }
  // Host after hide: no tabLabel span (Lumiverse unmounts it).
  const profile = makeHostBtn('profile', 'Profile', true)
  const hostLabel = profile.children.find((c) => String(c.className).includes('tabLabel'))
  if (hostLabel) profile.removeChild(hostLabel)
  mainSidebar.appendChild(profile)

  applyMainTabListPin(true, { force: true })
  let list = (getMainPinHost() as unknown as StubElement)!
    .children.find((c) => c.className.includes(MAIN_MIRROR_LIST_CLASS))!
  let mirror = collectMirrorButtons(list).find((m) => m.getAttribute('data-tab-id') === 'profile')!
  assert(
    !String(mirror.innerHTML || '').includes('sidebar-ux-tab-label'),
    'M16: no label HTML while showTabLabels false',
  )

  // Secondary Show path: patch cache then reconcile (same as sync → pin).
  __setHostSetSettingForTest(() => {}, { showTabLabels: true, tabOrder: [], hiddenTabIds: [], side: 'right' })
  applyMainTabListPin(true, { force: true })
  list = (getMainPinHost() as unknown as StubElement)!
    .children.find((c) => c.className.includes(MAIN_MIRROR_LIST_CLASS))!
  mirror = collectMirrorButtons(list).find((m) => m.getAttribute('data-tab-id') === 'profile')!
  assert(
    mirror.classList.contains('sidebar-ux-tab-labeled'),
    'M16: labeled class after showTabLabels true',
  )
  assertEqual(mirror.style.height, '56px', 'M16: labeled height 56px after show')
  assert(
    String(mirror.innerHTML || '').includes('sidebar-ux-tab-label'),
    'M16: label span rebuilt from title when host tabLabel missing',
  )
  assert(
    String(mirror.innerHTML || '').includes('Profile'),
    'M16: label text from title fallback',
  )

  clearHostSettingsCache()
}

// M17: header title survives force remount (side-change scenario).
// mountMainMirror always creates the shell with title 'Drawer'; reconcile
// must re-stamp the active tab's title after the remount.
{
  resetAll()
  clearHostSettingsCache()
  __setHostSetSettingForTest(() => {}, { showTabLabels: false, tabOrder: [], hiddenTabIds: [], side: 'right' })

  mainSidebar.querySelectorAll = (sel: string): StubElement[] => {
    if (sel.includes('tabBtn')) return mainSidebar.children.filter((c) => c.className.includes('tabBtn'))
    return []
  }
  const b1 = makeHostBtn('profile', 'Profile', false)
  const b2 = makeHostBtn('memory', 'Memory', false)
  mainSidebar.appendChild(b1)
  mainSidebar.appendChild(b2)

  // Mount and activate Profile via click.
  applyMainTabListPin(true, { force: true })
  const list0 = (getMainPinHost() as unknown as StubElement)!
    .children.find((c) => c.className.includes(MAIN_MIRROR_LIST_CLASS))!
  const profileMirror0 = collectMirrorButtons(list0).find(
    (m) => m.getAttribute('data-tab-id') === 'profile',
  )!
  profileMirror0.click()

  // Verify title was set after click (drawer opens + header stamped).
  assertEqual(
    (getMainMirrorTitleEl() as unknown as StubElement)?.textContent,
    'Profile',
    'M17a: title = Profile after click',
  )

  // Force remount (simulates side change) — resets shell title to 'Drawer',
  // then reconcileMainMirror must re-stamp.
  applyMainTabListPin(true, { force: true })

  // Verify reconcile re-stamped the header title (not still 'Drawer').
  assertEqual(
    (getMainMirrorTitleEl() as unknown as StubElement)?.textContent,
    'Profile',
    'M17b: title = Profile after force remount (not "Drawer")',
  )

  // Click Memory to switch, verify title updates + survives another remount.
  const list1 = (getMainPinHost() as unknown as StubElement)!
    .children.find((c) => c.className.includes(MAIN_MIRROR_LIST_CLASS))!
  const memoryMirror1 = collectMirrorButtons(list1).find(
    (m) => m.getAttribute('data-tab-id') === 'memory',
  )!
  memoryMirror1.click()
  assertEqual(
    (getMainMirrorTitleEl() as unknown as StubElement)?.textContent,
    'Memory',
    'M17c: title = Memory after switch',
  )

  // Force remount again — title should stay Memory.
  applyMainTabListPin(true, { force: true })
  assertEqual(
    (getMainMirrorTitleEl() as unknown as StubElement)?.textContent,
    'Memory',
    'M17d: title = Memory after second remount',
  )

  clearHostSettingsCache()
}

// M18: Show tab labels must not label the Settings gear in main-mirror.
// Host keeps Settings icon-only; title/aria still "Settings" for tooltips —
// title fallback must not invent a short-name label.
{
  resetAll()
  clearHostSettingsCache()
  __setHostSetSettingForTest(() => {}, { showTabLabels: true, tabOrder: [], hiddenTabIds: [], side: 'right' })

  mainSidebar.querySelectorAll = (sel: string): StubElement[] => {
    if (sel.includes('tabBtn')) return mainSidebar.children.filter((c) => c.className.includes('tabBtn'))
    return []
  }
  const profile = makeHostBtn('profile', 'Profile', true)
  const settings = makeHostBtn('settings', 'Settings', false)
  settings.removeAttribute('data-tab-id')
  settings.setAttribute('title', 'Settings')
  settings.setAttribute('aria-label', 'Settings')
  // Host may still expose tabBtnLabeled / a host label node — ignore for Settings.
  settings.classList.add('tabBtnLabeled')
  settings.className = `${settings.className} tabBtnLabeled`
  mainSidebar.appendChild(profile)
  mainSidebar.appendChild(settings)

  applyMainTabListPin(true, { force: true })
  const host = getMainPinHost() as unknown as StubElement
  const list = host.children.find((c) => c.className.includes(MAIN_MIRROR_LIST_CLASS))!
  const mainSec = list.children.find((c) => c.className.includes(MAIN_MIRROR_LIST_MAIN_CLASS))!
  const bottomSec = list.children.find((c) => c.className.includes(MAIN_MIRROR_LIST_BOTTOM_CLASS))!
  const profileMirror = mainSec.children.find(
    (c) => c.className.includes(MAIN_MIRROR_BTN_CLASS) && c.getAttribute('data-tab-id') === 'profile',
  )!
  const settingsMirror = bottomSec.children.find((c) => c.className.includes(MAIN_MIRROR_BTN_CLASS))!

  assert(
    profileMirror.classList.contains('sidebar-ux-tab-labeled'),
    'M18: profile labeled when showTabLabels true',
  )
  assert(
    String(profileMirror.innerHTML || '').includes('sidebar-ux-tab-label'),
    'M18: profile has label span',
  )
  assert(
    !settingsMirror.classList.contains('sidebar-ux-tab-labeled'),
    'M18: Settings never gets labeled class',
  )
  assertEqual(settingsMirror.style.height, '48px', 'M18: Settings stays icon-only height')
  assert(
    !String(settingsMirror.innerHTML || '').includes('sidebar-ux-tab-label'),
    'M18: Settings has no label span',
  )
  assert(
    !String(settingsMirror.innerHTML || '').includes('Settings'),
    'M18: Settings title not rendered as label text',
  )
  assertEqual(settingsMirror.getAttribute('title'), 'Settings', 'M18: tooltip title preserved')

  clearHostSettingsCache()
}

// M19: first enable of taskbar mode seeds header from host tabBtnActive
// (shell mounts with title "Drawer"; must not stay that way when a tab is active).
{
  resetAll()
  clearHostSettingsCache()
  mainSidebar.querySelectorAll = (sel: string): StubElement[] => {
    if (sel.includes('tabBtn')) return mainSidebar.children.filter((c) => c.className.includes('tabBtn'))
    return []
  }
  const profile = makeHostBtn('profile', 'Profile', true)
  const memory = makeHostBtn('memory', 'Memory', false)
  mainSidebar.appendChild(profile)
  mainSidebar.appendChild(memory)

  // No prior Canvas key (fresh enable). Shell title defaults to Drawer.
  assertEqual(getActiveMainMirrorKey(), null, 'M19: key null before enable')
  applyMainTabListPin(true, { force: true })

  assertEqual(getActiveMainMirrorKey(), 'id__profile', 'M19: key seeded from host active')
  assertEqual(
    (getMainMirrorTitleEl() as unknown as StubElement)?.textContent,
    'Profile',
    'M19: header title = host active tab (not "Drawer")',
  )
  // Secondary parity: closed drawer still no highlight even with seeded key.
  const list = (getMainPinHost() as unknown as StubElement)!
    .children.find((c) => c.className.includes(MAIN_MIRROR_LIST_CLASS))!
  const profileMirror = collectMirrorButtons(list).find(
    (m) => m.getAttribute('data-tab-id') === 'profile',
  )!
  assert(
    !profileMirror.classList.contains('sidebar-ux-tab-active'),
    'M19: no active highlight while drawer closed',
  )

  clearHostSettingsCache()
}

// M19b: first enable must not seed Settings as header when only Settings is host-active.
{
  resetAll()
  mainSidebar.querySelectorAll = (sel: string): StubElement[] => {
    if (sel.includes('tabBtn')) return mainSidebar.children.filter((c) => c.className.includes('tabBtn'))
    return []
  }
  const settings = makeHostBtn('settings', 'Settings', true)
  settings.removeAttribute('data-tab-id')
  settings.setAttribute('title', 'Settings')
  settings.setAttribute('aria-label', 'Settings')
  mainSidebar.appendChild(settings)

  applyMainTabListPin(true, { force: true })
  assertEqual(getActiveMainMirrorKey(), null, 'M19b: Settings not adopted as canvas key')
  assertEqual(
    (getMainMirrorTitleEl() as unknown as StubElement)?.textContent,
    'Drawer',
    'M19b: title stays Drawer when only Settings is host-active',
  )
}

console.log(`main-tab-pin tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
