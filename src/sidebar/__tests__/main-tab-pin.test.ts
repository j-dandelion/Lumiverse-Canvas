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
    if (sel.includes('tabBadge')) {
      for (const c of this.children) {
        if (c.className.includes('tabBadge')) return c
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
  get nextElementSibling(): StubElement | null { return this.nextSibling }
  // Element-only children make firstElementChild coincide with firstChild
  // (matches the renderer's fallback assumption; some stubs only track firstChild).
  get firstElementChild(): StubElement | null { return this.firstChild }
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
    // B1 (S7): serialize class + textContent so badge clones are
    // distinguishable in mirror innerHTML assertions.
    const cls = this.className ? ` class="${this.className}"` : ''
    const text = (this as any)._text ?? ''
    return `<${this.tagName}${cls}>${text}</${this.tagName}>`
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
  adoptMainMirrorNeighbor,
  findNeighborHostButtonFor,
  MAIN_MIRROR_LIST_CLASS,
  MAIN_MIRROR_BTN_CLASS,
  MAIN_MIRROR_LIST_MAIN_CLASS,
  MAIN_MIRROR_LIST_BOTTOM_CLASS,
  __resetMainTabPinForTest,
  __setActiveMainMirrorKeyForTest,
  __setMainTabPinEnabledForTest,
} from '../main-tab-pin'
import { captureMainMirrorMoveChrome, captureSecondaryNeighborForMove } from '../../recon/dispatch'
import { isCanvasMainOpen, getMainMirrorTitleEl, applyMainMirrorDrawer, isMainMirrorActive } from '../main-mirror-drawer'
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
import { setTabAssignment, deleteTabAssignment, setActiveSecondaryTabId } from '../../tabs/assignment'

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


// ── S2 renderer-era imports + helpers (old clone-era import block and the
// key/heal/neighbor assertions died with the parity layer) ──

import {
  applyMainTabListPin,
  reconcileMainTabListPin,
  isMainTabListPinActive,
  activateMainMirrorFromRestore,
  __resetMainTabPinForTest,
} from '../main-tab-pin'
import {
  MAIN_MIRROR_LIST_CLASS,
  MAIN_MIRROR_BTN_CLASS,
  MAIN_MIRROR_LIST_MAIN_CLASS,
  MAIN_MIRROR_LIST_BOTTOM_CLASS,
  renderMainMirrorTabs,
} from '../main-renderer'
import {
  bootstrap,
  shutdown as shutdownModel,
  flush,
  getModel,
  captureSecondaryNeighborForMove,
} from '../../recon/dispatch'
import { FakeHost, type LiveTab } from '../../host/fake/implementation'
import {
  createEmptyModel,
  builtinKey,
  extensionKey,
  type TabKey,
  type LayoutModel,
} from '../../core/model'
import {
  isCanvasMainOpen,
  getMainMirrorDrawer,
  getMainMirrorTitleEl,
  openCanvasMainDrawer,
  setCanvasMainNoActive,
} from '../main-mirror-drawer'
import { __setShowAssignmentMenuForTest } from '../../tabs/tab-context-menu'

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
import { setTabAssignment, deleteTabAssignment, setActiveSecondaryTabId } from '../../tabs/assignment'
import {
  __setHostSetSettingForTest,
  clearHostSettingsCache,
} from '../../dom/host-settings'
import { hydrateSettings } from '../../settings/state'

function makeLiveTab(key: TabKey, liveId: string, overrides?: Partial<LiveTab>): LiveTab {
  return {
    key, liveId, location: 'primary',
    hidden: false,
    activeInPrimary: false,
    activeInSecondary: false,
    hasContentRoot: true,
    isBuiltin: key.startsWith('builtin:'),
    ...overrides,
  }
}

const PROFILE = builtinKey('profile')
const MEMORY = builtinKey('memory')
const NOTES = builtinKey('notes')
const HONE = extensionKey('ext', 'Hone')

/**
 * Wire mainSidebar lookups for the flat-renderer era: findMainTabButton
 * queries by attribute selector, the Settings twin scan uses tabBtn buttons.
 * Also keeps the data-mirror-key walk used by the mirror lookup.
 */
function wireMainSidebarButtons(): void {
  mainSidebar.querySelectorAll = (sel: string): StubElement[] => {
    if (sel.includes('tabBtn') || sel === 'button[title]') {
      return mainSidebar.children.filter(
        (c) => c.className.includes('tabBtn') || String(c.tagName) === 'BUTTON',
      )
    }
    return []
  }
  mainSidebar.querySelector = (sel: string): StubElement | null => {
    // data-mirror-key walk (renderer mirror lookup).
    if (sel.includes('data-mirror-key=')) {
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
        for (const c of mainSidebar.children) {
          const hit = walk(c)
          if (hit) return hit
        }
      }
      return null
    }
    // findMainTabButton attribute paths.
    for (const attr of ['data-tab-id', 'title'] as const) {
      if (sel.includes(`[${attr}=`)) {
        const m = sel.match(new RegExp(`${attr}="([^"]+)"`))
        if (m) {
          return mainSidebar.children.find((c) => c.getAttribute(attr) === m[1]) ?? null
        }
      }
    }
    return null
  }
}

function mirrorListIn(host: StubElement): StubElement {
  return host.children.find((c) => c.className.includes(MAIN_MIRROR_LIST_CLASS))!
}

/** Reset + boot the model with the standard 3 builtin tabs, then mount. */
async function bootMirror(opts?: {
  primary?: TabKey[]
  hidden?: TabKey[]
  closed?: TabKey[]
  active?: TabKey | null
  extraTabs?: LiveTab[]
}): Promise<FakeHost> {
  const tabs: LiveTab[] = [
    makeLiveTab(PROFILE, 'profile'),
    makeLiveTab(MEMORY, 'memory'),
    makeLiveTab(NOTES, 'notes'),
    ...(opts?.extraTabs ?? []),
  ]
  const host = new FakeHost(tabs)
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: opts?.primary ?? [PROFILE, MEMORY, NOTES],
    secondary: [],
    hidden: opts?.hidden ?? [],
    closed: opts?.closed ?? [],
    active: { primary: opts?.active ?? null, secondary: null },
  }
  bootstrap(model, host)
  await flush()
  applyMainTabListPin(true, { force: true })
  return host
}

function reset(): void {
  resetAll()
  shutdownModel()
  wireMainSidebarButtons()
}

// M1: model-keyed render — order/ids from the model, no active while closed
{
  reset()
  await bootMirror()
  assert(isMainTabListPinActive(), 'M1: pin active')
  const pinHost = getMainPinHost() as unknown as StubElement | null
  assert(!!pinHost, 'M1: main pin host exists')
  assertEqual(pinHost!.getAttribute('data-pin-owner'), PIN_OWNER_MAIN, 'M1: owner=main')
  assert(pinHost!.className.includes(TAB_LIST_PIN_HOST_CLASS), 'M1: pin host class')
  assertEqual(pinHost!.style.display, '', 'M1: host visible when drawer closed')
  const list = mirrorListIn(pinHost!)
  assert(!!list, 'M1: mirror list present')
  const mirrors = collectMirrorButtons(list)
  assertEqual(mirrors.length, 3, 'M1: three mirror buttons (model keys)')
  assertEqual(mirrors[0].getAttribute('data-mirror-key'), PROFILE, 'M1: first mirror keyed by model key')
  assertEqual(mirrors[0].getAttribute('data-tab-id'), 'profile', 'M1: data-tab-id stamped from host.resolve')
  // Secondary parity: no tab looks selected while the drawer is closed.
  assert(mirrors.every((m) => !m.classList.contains('sidebar-ux-tab-active')), 'M1: no active highlight while closed')
  // Open via mirror click → model active + highlight only on open.
  mirrors[0].click()
  await flush()
  assert(isCanvasMainOpen(), 'M1: drawer open after click')
  assertEqual(getModel()!.active.primary, PROFILE, 'M1: model active follows the click')
  applyMainTabListPin(true, { force: true })
  const listAfter = mirrorListIn(getMainPinHost() as unknown as StubElement)
  const m0 = collectMirrorButtons(listAfter).find((c) => c.getAttribute('data-mirror-key') === PROFILE)!
  assert(m0.classList.contains('sidebar-ux-tab-active'), 'M1: active class from model when open')
}

// M2: host wrapperOpen does NOT hide pin host (Canvas owns open/close)
{
  reset()
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

// M3: click forwards to host button + activation dispatch
{
  reset()
  const hostBtn = makeHostBtn('profile', 'Profile', false)
  mainSidebar.appendChild(hostBtn)
  await bootMirror({ primary: [PROFILE] })

  const host = getMainPinHost() as unknown as StubElement
  const list = mirrorListIn(host)
  const mirror = collectMirrorButtons(list)[0]
  assert(!!mirror, 'M3: mirror exists')
  mirror.click()
  await flush()
  assertEqual(hostBtn.clickCount, 1, 'M3: host button clicked')
  assertEqual(getModel()!.active.primary, PROFILE, 'M3: activation dispatch recorded on the model')
}

// M4: dual hosts — secondary + main coexist; sweep does not kill either
{
  reset()
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
  reset()
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
  reset()
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

// M6b (review batch 2): a mobile reconcile must KEEP the shell (S6). The old
// mobile branch force-tore the whole mirror down, so narrowing the window
// with the main drawer open destroyed it; the shell must survive.
{
  reset()
  ;(globalThis as any).window.matchMedia = (query: string) => ({
    matches: /max-width:\s*600px/.test(query),
    addEventListener() {},
    removeEventListener() {},
  })
  applyMainMirrorDrawer(true, { force: true })
  assert(isMainMirrorActive(), 'M6b: shell active on mobile after mount')
  reconcileMainTabListPin()
  assert(isMainMirrorActive(), 'M6b: mobile reconcile keeps the shell (no teardown)')
  assertEqual(getMainPinHost(), null, 'M6b: no pin host on mobile')
  applyMainMirrorDrawer(false, { force: true })
}

// M7: hidden is MODEL-owned — a hidden key renders display:none; a host
// button that is not a model key (moved away) renders nowhere.
{
  reset()
  const visibleHost = makeHostBtn('profile', 'Profile', false)
  const movedHost = makeHostBtn('moved', 'Moved', false)
  movedHost.style.display = 'none'
  mainSidebar.appendChild(visibleHost)
  mainSidebar.appendChild(movedHost)
  await bootMirror({ hidden: [PROFILE] })

  const list = mirrorListIn(getMainPinHost() as unknown as StubElement)
  const mirrors = collectMirrorButtons(list)
  assertEqual(mirrors.length, 3, 'M7: all model-keyed buttons rendered')
  assertEqual(mirrors[0].getAttribute('data-tab-id'), 'profile', 'M7: first key stays first')
  assertEqual(mirrors[0].style.display, 'none', 'M7: model-hidden button is display:none')
}

// M7b: hidden survives a force remount (side-change / re-apply parity)
{
  reset()
  await bootMirror({ hidden: [MEMORY] })
  applyMainTabListPin(true, { force: true })
  const list = mirrorListIn(getMainPinHost() as unknown as StubElement)
  const mirrors = collectMirrorButtons(list)
  assertEqual(mirrors.length, 3, 'M7b: all model keys still rendered after remount')
  const memory = mirrors.find((m) => m.getAttribute('data-mirror-key') === MEMORY)!
  assert(!!memory, 'M7b: memory mirror survives the remount')
  assertEqual(memory.style.display, 'none', 'M7b: hidden key stays hidden after remount')
  assert(
    mirrors.find((m) => m.getAttribute('data-mirror-key') === PROFILE)!.style.display !== 'none',
    'M7b: visible sibling stays shown',
  )
}

// M7c: never-hide-all — when EVERY model key is hidden, the first stays
// visible (WORKFLOW gotcha; the renderer guards, the model is untouched).
{
  reset()
  mainSidebar.appendChild(makeHostBtn('profile', 'Profile', false))
  mainSidebar.appendChild(makeHostBtn('memory', 'Memory', false))
  mainSidebar.appendChild(makeHostBtn('notes', 'Notes', false))
  await bootMirror({ hidden: [PROFILE, MEMORY, NOTES], active: MEMORY })
  const list = mirrorListIn(getMainPinHost() as unknown as StubElement)
  const mirrors = collectMirrorButtons(list)
  assertEqual(mirrors.length, 3, 'M7c: all keyed buttons present')
  const shown = mirrors.filter((m) => m.style.display !== 'none')
  assertEqual(shown.length, 1, 'M7c: exactly one visible when all would hide')
  assertEqual(shown[0].getAttribute('data-mirror-key'), PROFILE, 'M7c: first key is the rescue tab')

  openCanvasMainDrawer()
  renderMainMirrorTabs()
  assertEqual(
    (getMainMirrorTitleEl() as any)?.textContent,
    'Profile',
    'M7c: header title follows the visible rescue tab when active is hidden',
  )
}

// D7: OS mode has no rescue key; an all-closed strip keeps its header clear.
{
  reset()
  hydrateSettings({ osMode: true })
  mainSidebar.appendChild(makeHostBtn('profile', 'Profile', false))
  mainSidebar.appendChild(makeHostBtn('memory', 'Memory', false))
  mainSidebar.appendChild(makeHostBtn('notes', 'Notes', false))
  await bootMirror({ active: PROFILE, closed: [PROFILE, MEMORY, NOTES] })
  openCanvasMainDrawer()
  setCanvasMainNoActive(true)
  renderMainMirrorTabs()

  const list = mirrorListIn(getMainPinHost() as unknown as StubElement)
  const shown = collectMirrorButtons(list).filter((m) => m.style.display !== 'none')
  assertEqual(shown.length, 0, 'D7: all closed tabs remain absent from the strip')
  assertEqual(
    (getMainMirrorTitleEl() as any)?.textContent,
    '',
    'D7: renderer leaves the cleared header title empty',
  )
  hydrateSettings(null)
}

// M8: reconcileMainTabListPin with default setting leaves off
{
  resetAll()
  reconcileMainTabListPin()
  assert(!isMainTabListPinActive(), 'M8: default off')
  assertEqual(getMainPinHost(), null, 'M8: no host')
}

// M8b: S1 gate inversion — reconcileMainTabListPin with taskbar OFF still
// mounts the Canvas main shell (ownership unconditional) and renders the
// model into the shell's own tab list, with NO pin host created.
{
  reset()
  const b1 = makeHostBtn('profile', 'Profile', true)
  const b2 = makeHostBtn('memory', 'Memory', false)
  mainSidebar.appendChild(b1)
  mainSidebar.appendChild(b2)
  wireMainSidebarButtons()
  const host = new FakeHost([makeLiveTab(PROFILE, 'profile'), makeLiveTab(MEMORY, 'memory')])
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, MEMORY],
    secondary: [],
    hidden: [],
    active: { primary: PROFILE, secondary: null },
  }
  bootstrap(model, host)
  await flush()
  reconcileMainTabListPin()
  assertEqual(getMainPinHost(), null, 'M8b: no pin host (taskbar chrome off)')
  assert(!isMainTabListPinActive(), 'M8b: not pin-active')
  // The shell wrapper is present (body-level) with the mirror list inside.
  const wrapper = bodyStub.children.find((c) =>
    String(c.className || '').includes('sidebar-ux-main-mirror-wrapper'),
  )
  assert(!!wrapper, 'M8b: main shell mounted without taskbar mode')
  // Buttons rendered into the shell's tab list (rides with the panel).
  const findList = (el: StubElement): StubElement | null => {
    if (String(el.className || '').includes('sidebar-ux-tab-list')) return el
    for (const c of el.children) {
      const hit = findList(c)
      if (hit) return hit
    }
    return null
  }
  const shellList = wrapper ? findList(wrapper) : null
  assert(!!shellList, 'M8b: shell tab list present')
  const mirrors = collectMirrorButtons(shellList!)
  assertEqual(mirrors.length, 2, 'M8b: two mirror buttons rendered into shell list')
  assertEqual(mirrors[0].getAttribute('data-mirror-key'), PROFILE, 'M8b: first mirror keyed by model key')
  shutdownModel()
}

// M8c (live-verify #8): a runtime "Move tab controls to outer edge" toggle
// must refresh the VISIBLE main shell's orientation. Before the fix,
// reconcileMainTabListPin only handled pin chrome; the other position pass
// (`applyTabListPosition(enabled)` with no opts) targets the HIDDEN host main
// drawer, so the shell kept its mount-time flex until a hard refresh.
{
  reset()
  mainSidebar.appendChild(makeHostBtn('profile', 'Profile', true))
  wireMainSidebarButtons()
  const host = new FakeHost([makeLiveTab(PROFILE, 'profile')])
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE],
    secondary: [],
    hidden: [],
    active: { primary: PROFILE, secondary: null },
  }
  hydrateSettings({ moveControlsToOuterEdge: false, taskbarMode: false })
  bootstrap(model, host)
  await flush()
  reconcileMainTabListPin()

  const shellDrawer = getMainMirrorDrawer() as unknown as StubElement | null
  assert(!!shellDrawer, 'M8c: main shell drawer mounted')
  assertEqual(
    shellDrawer!.style.flexDirection,
    'row',
    'M8c: default flex (side right, controls sit in the drawer)',
  )

  hydrateSettings({ moveControlsToOuterEdge: true })
  reconcileMainTabListPin()
  assertEqual(
    shellDrawer!.style.flexDirection,
    'row-reverse',
    'M8c: outer-edge ON flips the visible shell flex',
  )

  hydrateSettings({ moveControlsToOuterEdge: false })
  reconcileMainTabListPin()
  assertEqual(
    shellDrawer!.style.flexDirection,
    'row',
    'M8c: outer-edge OFF restores the visible shell flex',
  )

  // Leave global settings at defaults for the cases that follow.
  hydrateSettings(null)
  shutdownModel()
}

// M8d (live report 2026-09-14): Sides mode + taskbar chrome (pinned strip).
// The pin must orient the drawer so the 56px spacer sits on the OUTER
// (screen-edge) side: side-right → row-reverse, side-left → row. Before the
// fix, pinMainMirrorShellTabList only touched the list; while pinned,
// applyTabListPosition deliberately skips the drawer flex and restyleShellSide
// is not reached on a location flip, so the previous (unpinned) flex survived
// ('row' for the default right side): the spacer sat on the inner side and the
// panel rode 56px under the pin strip with a gap. Toggling outer-edge off/on
// masked it by running applyTabListPosition while temporarily unpinned.
// Horizontal skips the write (spacer neutralized to 0×0) — the Sides pin must
// re-assert it.
{
  reset()
  mainSidebar.appendChild(makeHostBtn('profile', 'Profile', true))
  const host = new FakeHost([makeLiveTab(PROFILE, 'profile')])
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE],
    secondary: [],
    hidden: [],
    active: { primary: PROFILE, secondary: null },
  }
  // Boot in Sides with taskbar chrome on (pinned strip).
  hydrateSettings({ drawerLocation: 'sides', taskbarMode: true, moveControlsToOuterEdge: true })
  bootstrap(model, host)
  await flush()
  reconcileMainTabListPin()

  const shellDrawer = getMainMirrorDrawer() as unknown as StubElement | null
  assert(!!shellDrawer, 'M8d: main shell drawer mounted')

  // The stale state the real app carries into a Top→Sides flip: while pinned,
  // applyTabListPosition deliberately skips the drawer flex and restyleShellSide
  // is not called on a location flip (same side) — so the mount/horizontal
  // value survives. Side-right default (controls in the inner drawer) is 'row';
  // the pinned orientation must be 'row-reverse' (spacer on the outer edge).
  shellDrawer!.style.flexDirection = 'row'

  reconcileMainTabListPin()
  assertEqual(
    shellDrawer!.style.flexDirection,
    'row-reverse',
    'M8d: Sides pin writes the outer-edge drawer flex (side-right)',
  )

  // Re-pinning (already pinned) re-asserts it too — idempotent.
  shellDrawer!.style.flexDirection = 'row'
  reconcileMainTabListPin()
  assertEqual(
    shellDrawer!.style.flexDirection,
    'row-reverse',
    'M8d: re-pin re-asserts the pinned flex',
  )

  hydrateSettings(null)
  shutdownModel()
}

// M9: Settings mirrors into bottom dock with separator chrome (host .sidebarBottom)
{
  reset()
  const profile = makeHostBtn('profile', 'Profile', false)
  const settings = makeHostBtn('settings', 'Settings', false)
  // Host settings often has no data-tab-id — isSettingsButton uses title.
  settings.removeAttribute('data-tab-id')
  settings.setAttribute('title', 'Settings')
  settings.setAttribute('aria-label', 'Settings')
  mainSidebar.appendChild(profile)
  mainSidebar.appendChild(settings)
  await bootMirror({ primary: [PROFILE] })

  const host = getMainPinHost() as unknown as StubElement
  const list = mirrorListIn(host)
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
  // Click forwards to host but never touches the model selection.
  assertEqual(getModel()!.active.primary, null, 'M9: no active before settings click')
  assert(!isCanvasMainOpen(), 'M9: drawer closed before settings click')
  bottomMirrors[0].click()
  await flush()
  assertEqual(settings.clickCount, 1, 'M9: settings click forwards to host')
  assertEqual(getModel()!.active.primary, null, 'M9: settings does not set model active')
  assert(!isCanvasMainOpen(), 'M9: settings does not open drawer')

  // With a real tab open, Settings still only forwards — keeps active + open.
  mainMirrors[0].click()
  await flush()
  assertEqual(getModel()!.active.primary, PROFILE, 'M9: profile activates')
  assert(isCanvasMainOpen(), 'M9: profile opens drawer')
  bottomMirrors[0].click()
  assertEqual(settings.clickCount, 2, 'M9: second settings click still forwards')
  assertEqual(getModel()!.active.primary, PROFILE, 'M9: settings leaves profile active')
  assert(isCanvasMainOpen(), 'M9: settings leaves drawer open')
}

// M9c: Settings right-click must not host-forward or open assignment menu.
// Profile right-click forwards synthetic contextmenu to the host twin (host
// ContextMenu + inject path) — never showAssignmentMenu.
{
  reset()
  const menuCalls: Array<{ tabId: string; title: string }> = []
  __setShowAssignmentMenuForTest((_x, _y, tabId, tabTitle) => {
    menuCalls.push({ tabId, title: tabTitle })
  })
  try {
    const profile = makeHostBtn('profile', 'Profile', false)
    const settings = makeHostBtn('settings', 'Settings', false)
    settings.removeAttribute('data-tab-id')
    settings.setAttribute('title', 'Settings')
    settings.setAttribute('aria-label', 'Settings')
    mainSidebar.appendChild(profile)
    mainSidebar.appendChild(settings)
    await bootMirror({ primary: [PROFILE] })

    const host = getMainPinHost() as unknown as StubElement
    const list = mirrorListIn(host)
    const mainSec = list.children.find((c) => c.className.includes(MAIN_MIRROR_LIST_MAIN_CLASS))!
    const bottomSec = list.children.find((c) => c.className.includes(MAIN_MIRROR_LIST_BOTTOM_CLASS))!
    const profileMirror = mainSec.children.find((c) => c.className.includes(MAIN_MIRROR_BTN_CLASS))!
    const settingsMirror = bottomSec.children.find((c) => c.className.includes(MAIN_MIRROR_BTN_CLASS))!

    profile.contextmenuDispatches = []
    settings.contextmenuDispatches = []

    settingsMirror.contextmenu(12, 34)
    await flush()
    assertEqual(menuCalls.length, 0, 'M9c: Settings contextmenu does not open assignment menu')
    assertEqual(settings.contextmenuDispatches.length, 0, 'M9c: Settings does not host-forward')
    assertEqual(profile.contextmenuDispatches.length, 0, 'M9c: Settings path does not dispatch on Profile')

    profileMirror.contextmenu(56, 78)
    await flush()
    assertEqual(menuCalls.length, 0, 'M9c: Profile does not open Canvas assignment menu')
    assertEqual(profile.contextmenuDispatches.length, 1, 'M9c: Profile host-forwards contextmenu')
    assertEqual(profile.contextmenuDispatches[0]?.clientX, 56, 'M9c: Profile forward clientX')
    assertEqual(profile.contextmenuDispatches[0]?.clientY, 78, 'M9c: Profile forward clientY')
    assertEqual(settings.contextmenuDispatches.length, 0, 'M9c: Profile path does not dispatch on Settings')
  } finally {
    __setShowAssignmentMenuForTest(null)
  }
}

// M10: toggle-close — click the model-active tab while open closes the drawer
// (no host click on the close path); a different tab switches without closing.
// The renderer never consults host tabBtnActive for the close decision.
{
  reset()
  const b1 = makeHostBtn('profile', 'Profile', false)
  const b2 = makeHostBtn('memory', 'Memory', false)
  mainSidebar.appendChild(b1)
  mainSidebar.appendChild(b2)
  await bootMirror()
  const list = mirrorListIn(getMainPinHost() as unknown as StubElement)
  const mirrors = collectMirrorButtons(list)
  const profileMirror = mirrors.find((m) => m.getAttribute('data-mirror-key') === PROFILE)!
  const memoryMirror = mirrors.find((m) => m.getAttribute('data-mirror-key') === MEMORY)!

  // Open profile
  profileMirror.click()
  await flush()
  assert(isCanvasMainOpen(), 'M10: drawer open after first click')
  assertEqual(getModel()!.active.primary, PROFILE, 'M10: model active = profile')
  assertEqual(b1.clickCount, 1, 'M10: host profile clicked once')

  // Host can lose tabBtnActive (repark / headless) — model active survives.
  b1.classList.remove('tabBtnActive')
  b1.className = 'tabBtn'
  applyMainTabListPin(true, { force: true })
  assert(isCanvasMainOpen(), 'M10: still open after re-render')
  assertEqual(getModel()!.active.primary, PROFILE, 'M10: model active survives host active loss')

  // Click same tab → close (no host click on the close path)
  const hostClicksBeforeClose = b1.clickCount
  profileMirror.click()
  await flush()
  assert(!isCanvasMainOpen(), 'M10: click active tab closes drawer')
  assertEqual(b1.clickCount, hostClicksBeforeClose, 'M10: close path does not host-click')
  // Model active retained for reopen parity (secondary-style)
  assertEqual(getModel()!.active.primary, PROFILE, 'M10: model active not cleared on close')

  // Different tab while open switches (not close)
  profileMirror.click() // reopen
  await flush()
  assert(isCanvasMainOpen(), 'M10: reopen works')
  memoryMirror.click()
  await flush()
  assert(isCanvasMainOpen(), 'M10: switch keeps drawer open')
  assertEqual(getModel()!.active.primary, MEMORY, 'M10: model active updates to memory')
  assertEqual(b2.clickCount, 1, 'M10: memory host clicked')
}

// M11: host tabBtnActive on Profile while the MODEL active is Memory —
// exactly one mirror highlight (the model's); Profile click switches.
{
  reset()
  const profile = makeHostBtn('profile', 'Profile', true)
  const memory = makeHostBtn('memory', 'Memory', false)
  mainSidebar.appendChild(profile)
  mainSidebar.appendChild(memory)
  await bootMirror({ active: MEMORY })

  // Open via the model-active mirror button (highlights are open-only).
  const openList = mirrorListIn(getMainPinHost() as unknown as StubElement)
  const mmBtn = collectMirrorButtons(openList).find((m) => m.getAttribute('data-mirror-key') === MEMORY)!
  mmBtn.click()
  await flush()

  const list = mirrorListIn(getMainPinHost() as unknown as StubElement)
  const mirrors = collectMirrorButtons(list)
  const profileMirror = mirrors.find((m) => m.getAttribute('data-mirror-key') === PROFILE)!
  const memoryMirror = mirrors.find((m) => m.getAttribute('data-mirror-key') === MEMORY)!
  assert(
    !profileMirror.classList.contains('sidebar-ux-tab-active'),
    'M11: Profile not active when model active is Memory (host tabBtnActive ignored)',
  )
  assertEqual(
    mirrors.filter((m) => m.classList.contains('sidebar-ux-tab-active')).length,
    0,
    'M11: no mirror highlighted while closed (open-only, model-owned)',
  )

  // Click Profile (host tabBtnActive, not the model active) must switch, not close.
  const profileClicksBefore = profile.clickCount
  profileMirror.click()
  await flush()
  assert(isCanvasMainOpen(), 'M11: Profile click switches (stays open), not close')
  assertEqual(getModel()!.active.primary, PROFILE, 'M11: model active updates to profile')
  assertEqual(profile.clickCount, profileClicksBefore + 1, 'M11: Profile host clicked on switch')
}

// M15: stale host tabBtnLabeled must not re-inflate mirror height; the
// renderer derives label state from showTabLabels (twin class ignored).
{
  reset()
  clearHostSettingsCache()
  __setHostSetSettingForTest(() => {}, { showTabLabels: false, tabOrder: [], hiddenTabIds: [], side: 'right' })
  const profile = makeHostBtn('profile', 'Profile', true)
  profile.classList.add('tabBtnLabeled')
  profile.className = `${profile.className} tabBtnLabeled`
  mainSidebar.appendChild(profile)
  await bootMirror({ primary: [PROFILE] })

  const list = mirrorListIn(getMainPinHost() as unknown as StubElement)
  const mirror = collectMirrorButtons(list).find(
    (m) => m.getAttribute('data-mirror-key') === PROFILE,
  )!
  assert(
    !mirror.classList.contains('sidebar-ux-tab-labeled'),
    'M15: no labeled class while showTabLabels off (stale host class ignored)',
  )
  assertEqual(mirror.style.height, '48px', 'M15: icon-only height 48px')

  // Activate path re-renders — must stay compact.
  mirror.click()
  await flush()
  applyMainTabListPin(true, { force: true })
  const list2 = mirrorListIn(getMainPinHost() as unknown as StubElement)
  const mirror2 = collectMirrorButtons(list2).find(
    (m) => m.getAttribute('data-mirror-key') === PROFILE,
  )!
  assert(
    !mirror2.classList.contains('sidebar-ux-tab-labeled'),
    'M15: still unlabeled after activate/re-render',
  )
  assertEqual(mirror2.style.height, '48px', 'M15: height stays 48px after activate/re-render')
  clearHostSettingsCache()
}

// M16: Show labels rebuilds main-mirror label HTML from the twin's title
// (twin .tabLabel span may not be mounted — host React lag cover).
{
  reset()
  clearHostSettingsCache()
  __setHostSetSettingForTest(() => {}, { showTabLabels: true, tabOrder: [], hiddenTabIds: [], side: 'right' })

  const profile = makeHostBtn('profile', 'Profile', true)
  // Host after hide: no tabLabel span (Lumiverse unmounts it).
  const hostLabel = profile.children.find((c) => String(c.className).includes('tabLabel'))
  if (hostLabel) profile.removeChild(hostLabel)
  mainSidebar.appendChild(profile)
  await bootMirror({ primary: [PROFILE] })

  const list = mirrorListIn(getMainPinHost() as unknown as StubElement)
  const mirror = collectMirrorButtons(list).find(
    (m) => m.getAttribute('data-mirror-key') === PROFILE,
  )!
  assert(mirror.classList.contains('sidebar-ux-tab-labeled'), 'M16: labeled class when showTabLabels on')
  assertEqual(mirror.style.height, '56px', 'M16: labeled height 56px')
  assert(
    String(mirror.innerHTML || '').includes('sidebar-ux-tab-label'),
    'M16: label span rebuilt from twin title',
  )
  assert(
    String(mirror.innerHTML || '').includes('Prof'),
    'M16: label text from twin title fallback',
  )
  clearHostSettingsCache()
}

// M17: header title follows the MODEL active and survives force remount
// (shell mounts with 'Drawer'; renderer re-stamps from the twin's title).
{
  reset()
  const b1 = makeHostBtn('profile', 'Profile', false)
  const b2 = makeHostBtn('memory', 'Memory', false)
  mainSidebar.appendChild(b1)
  mainSidebar.appendChild(b2)
  void b2
  await bootMirror({ active: PROFILE })

  applyMainTabListPin(true, { force: true })
  const list = mirrorListIn(getMainPinHost() as unknown as StubElement)
  const profileMirror = collectMirrorButtons(list).find(
    (m) => m.getAttribute('data-mirror-key') === PROFILE,
  )!
  profileMirror.click()
  await flush()
  assertEqual(
    (getMainMirrorTitleEl() as unknown as StubElement)?.textContent,
    'Profile',
    'M17a: title = Profile after click',
  )

  // Force remount (simulates side change) — resets shell title to 'Drawer',
  // then the renderer re-stamps from the MODEL active.
  applyMainTabListPin(true, { force: true })
  assertEqual(
    (getMainMirrorTitleEl() as unknown as StubElement)?.textContent,
    'Profile',
    'M17b: title = Profile after force remount (not "Drawer")',
  )
}

// M18: Show tab labels must not label the Settings gear in main-mirror.
// Host keeps Settings icon-only; title/aria still "Settings" for tooltips —
// the twin title must not be rendered as a short-name label.
{
  reset()
  __setHostSetSettingForTest(() => {}, { showTabLabels: true, tabOrder: [], hiddenTabIds: [], side: 'right' })

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
  await bootMirror({ primary: [PROFILE] })

  const host = getMainPinHost() as unknown as StubElement
  const list = mirrorListIn(host)
  const mainSec = list.children.find((c) => c.className.includes(MAIN_MIRROR_LIST_MAIN_CLASS))!
  const bottomSec = list.children.find((c) => c.className.includes(MAIN_MIRROR_LIST_BOTTOM_CLASS))!
  const profileMirror = mainSec.children.find(
    (c) => c.className.includes(MAIN_MIRROR_BTN_CLASS) && c.getAttribute('data-tab-id') === 'profile',
  )!
  const settingsMirror = bottomSec.children.find((c) => c.className.includes(MAIN_MIRROR_BTN_CLASS))!

  assert(profileMirror.classList.contains('sidebar-ux-tab-labeled'), 'M18: profile labeled when showTabLabels true')
  assert(String(profileMirror.innerHTML || '').includes('sidebar-ux-tab-label'), 'M18: profile has label span')
  assert(!settingsMirror.classList.contains('sidebar-ux-tab-labeled'), 'M18: Settings never gets labeled class')
  assertEqual(settingsMirror.style.height, '48px', 'M18: Settings stays icon-only height')
  assert(!String(settingsMirror.innerHTML || '').includes('sidebar-ux-tab-label'), 'M18: Settings has no label span')
  assertEqual(settingsMirror.getAttribute('title'), 'Settings', 'M18: tooltip title preserved')

  clearHostSettingsCache()
}

// B1/B2 (S7): extension tab badge (host dt.badge → span.tabBadge) is copied
// into the mirror button HTML after the label, and twin badge changes are
// picked up by the next render (data-mirror-html cache invalidates).
{
  reset()
  clearHostSettingsCache()
  __setHostSetSettingForTest(() => {}, { showTabLabels: true, tabOrder: [], hiddenTabIds: [], side: 'right' })

  const profile = makeHostBtn('profile', 'Profile', true)
  const badge = new StubElement()
  badge.tagName = 'SPAN'
  badge.className = 'tabBadge_xyz'
  badge.classList.add('tabBadge_xyz')
  ;(badge as any).textContent = '3'
  profile.appendChild(badge)
  mainSidebar.appendChild(profile)
  await bootMirror({ primary: [PROFILE] })

  const list = mirrorListIn(getMainPinHost() as unknown as StubElement)
  const mirrorFor = () =>
    collectMirrorButtons(list).find(
      (m) => m.getAttribute('data-mirror-key') === PROFILE,
    )!
  const html = String(mirrorFor().innerHTML || '')
  assert(html.includes('tabBadge'), 'B1: badge span copied into mirror HTML')
  assert(html.includes('>3<'), 'B1: badge text carried over')
  assert(
    html.indexOf('sidebar-ux-tab-label') !== -1 &&
      html.indexOf('tabBadge') > html.indexOf('sidebar-ux-tab-label'),
    'B1: badge after label (host DOM order)',
  )

  // B2: change the twin badge text → next render shows the new badge
  // (production trigger: sidebar observer → scheduleReconcile → render;
  // direct call exercises the render + data-mirror-html cache logic).
  ;(badge as any).textContent = '7'
  renderMainMirrorTabs()
  const html2 = String(mirrorFor().innerHTML || '')
  assert(html2.includes('>7<'), 'B2: updated badge text on re-render')

  clearHostSettingsCache()
}

// M19: no host-sourced seeding — fresh mount with a null model active keeps
// the shell title 'Drawer' and highlights nothing (model owns activation).
{
  reset()
  const b1 = makeHostBtn('profile', 'Profile', true)
  const b2 = makeHostBtn('memory', 'Memory', false)
  mainSidebar.appendChild(b1)
  mainSidebar.appendChild(b2)
  void b2
  await bootMirror({ active: null })

  assertEqual(getModel()!.active.primary, null, 'M19: model active null after mount')
  assertEqual(
    (getMainMirrorTitleEl() as unknown as StubElement)?.textContent,
    'Drawer',
    'M19: title stays Drawer (no host-based seeding)',
  )
  const list = mirrorListIn(getMainPinHost() as unknown as StubElement)
  const mirrors = collectMirrorButtons(list)
  assert(mirrors.every((m) => !m.classList.contains('sidebar-ux-tab-active')), 'M19: no active highlight while closed')
}

// M20: restore activation cannot steal the model active — the thin
// activateMainMirrorFromRestore clicks the host (content) and opens the
// drawer, but never writes a selection; the MODEL keeps the user's pick.
{
  reset()
  const profile = makeHostBtn('profile', 'Profile', false)
  const memory = makeHostBtn('memory', 'Memory', false)
  const databank = makeHostBtn('databank', 'Databank', false)
  mainSidebar.appendChild(profile)
  mainSidebar.appendChild(memory)
  mainSidebar.appendChild(databank)
  void profile
  void memory
  await bootMirror()

  // User clicks Memory → model established.
  const list0 = mirrorListIn(getMainPinHost() as unknown as StubElement)
  collectMirrorButtons(list0).find((m) => m.getAttribute('data-mirror-key') === MEMORY)!.click()
  await flush()
  assertEqual(getModel()!.active.primary, MEMORY, 'M20: model active = memory after user click')

  // Late restore/host-driven activation targets the persisted tab (databank).
  const dbClicksBefore = databank.clickCount
  activateMainMirrorFromRestore(databank as unknown as HTMLElement, 'Databank')
  await flush()
  assertEqual(getModel()!.active.primary, MEMORY, 'M20: model active survives restore activation')
  assertEqual(databank.clickCount, dbClicksBefore + 1, 'M20: thin restore re-clicks the persisted tab for content')
}

// U1: untagged host twin renders labeled — the twin carries no data-tab-id;
// the renderer resolves it through the key's title fallback (findMainTabButton
// byAttribute chain) and uses it read-only for chrome. The data-tab-id stamp
// stays absent from the mirror (nothing resolved) and a later click still
// reaches the twin.
{
  reset()
  const honeyHostBtn = makeHostBtn('hone', 'Hone', false)
  honeyHostBtn.removeAttribute('data-tab-id')
  mainSidebar.appendChild(honeyHostBtn)
  await bootMirror({
    primary: [PROFILE, HONE],
    extraTabs: [makeLiveTab(HONE, 'h:hone-ghost')],
  })

  const list = mirrorListIn(getMainPinHost() as unknown as StubElement)
  const mirrors = collectMirrorButtons(list)
  const honeMirror = mirrors.find((m) => m.getAttribute('data-mirror-key') === HONE)!
  assert(!!honeMirror, 'U1: keyed mirror exists though the host twin is untagged')
  assertEqual(honeMirror.getAttribute('title'), 'Hone', 'U1: chrome title from the twin')
  assert(honeMirror.getAttribute('data-mirror-html') !== null && String(honeMirror.innerHTML || '').length > 0, 'U1: chrome HTML built')
  assertEqual(honeMirror.getAttribute('data-tab-id'), 'h:hone-ghost', 'U1: resolved key stamped even when the twin lacks its tag')

  // Click still reaches the twin via the key→title fallback.
  honeMirror.click()
  await flush()
  assertEqual(honeyHostBtn.clickCount, 1, 'U1: untagged twin clicked')
}

// M24: captureSecondaryNeighborForMove — the drawer-side chrome capture for
// moves OUT of the second drawer (right-click "Move to main drawer", DnD
// secondary→primary, Configure cross-column drags). Gated on the drawer's
// TRACKED active (the model lags — secondary clicks don't produce
// host-syncs); neighbor = nearest visible button above, else below.
{
  reset()
  const secA = new StubElement()
  secA.tagName = 'BUTTON'
  secA.setAttribute('data-tab-id', 'tab-a')
  secA.setAttribute('title', 'Tab A')
  const secB = new StubElement()
  secB.tagName = 'BUTTON'
  secB.setAttribute('data-tab-id', 'tab-b')
  secB.setAttribute('title', 'Tab B')
  const secC = new StubElement()
  secC.tagName = 'BUTTON'
  secC.setAttribute('data-tab-id', 'tab-c')
  secC.setAttribute('title', 'Tab C')
  const secButtons = [secA, secB, secC]
  for (const b of secButtons) secTabList.appendChild(b)
  secTabList.querySelectorAll = (sel: string): StubElement[] => {
    if (sel === 'button[data-tab-id]') return secButtons
    return []
  }

  // Collapsed/absent model → no displayed window to hand off from: the
  // capture bails before consulting the tracked active (reopen memory).
  setActiveSecondaryTabId('tab-b')
  let secChrome = await captureSecondaryNeighborForMove('tab-b')
  assert(secChrome.neighborBtn === null, 'M24: collapsed drawer → no neighbor capture')

  // Bootstrap an OPEN secondary drawer — only an open drawer displays the
  // tracked active window the move must hand off from.
  const host = await bootMirror()
  const booted = getModel()!
  bootstrap({
    ...booted,
    drawers: {
      ...booted.drawers,
      secondary: { ...booted.drawers.secondary, open: true },
    },
  }, host)
  await flush()

  // Moved tab is NOT the drawer's tracked active → no capture (the active
  // tab keeps its replacement; quiet move).
  setActiveSecondaryTabId('tab-a')
  secChrome = await captureSecondaryNeighborForMove('tab-b')
  assert(secChrome.neighborBtn === null, 'M24: not the tracked active → no neighbor')

  // Moved tab IS the tracked active → nearest visible button above.
  setActiveSecondaryTabId('tab-b')
  secChrome = await captureSecondaryNeighborForMove('tab-b')
  assertEqual(
    (secChrome.neighborBtn as unknown as StubElement | null)?.getAttribute('data-tab-id') ?? null,
    'tab-a',
    'M24: active-tab move captures neighbor above',
  )

  // Hidden above → nearest visible below.
  secA.style.display = 'none'
  secChrome = await captureSecondaryNeighborForMove('tab-b')
  assertEqual(
    (secChrome.neighborBtn as unknown as StubElement | null)?.getAttribute('data-tab-id') ?? null,
    'tab-c',
    'M24: hidden above → neighbor below',
  )

  setActiveSecondaryTabId(null)
}


// LR1: late-register tab appears — a tab merged into the model by a later
// host-sync (enqueueHostSync membership adopt) renders without a manual
// re-render (the renderer subscribes to model commits).
{
  reset()
  const host = await bootMirror()
  // Late extension tab registers in the host world + merges into the model.
  const HONE2 = HONE
  host.addTab(HONE2, 'h:hone-ghost', 'primary')
  await flush()
  const { getModel: gm } = await import('../../recon/dispatch')
  // Simulate the membership adopt the enqueueHostSync path performs: append
  // the key into the model and commit (bootstrap merge semantics).
  const model = gm()!
  const merged: LayoutModel = { ...model, primary: [...model.primary, HONE2] }
  bootstrap(merged, host)
  await flush()
  applyMainTabListPin(true, { force: true })
  const list = mirrorListIn(getMainPinHost() as unknown as StubElement)
  const mirrors = collectMirrorButtons(list)
  const late = mirrors.find((m) => m.getAttribute('data-mirror-key') === HONE2)!
  assert(!!late, 'LR1: late-registered tab appears in the flat strip')
  assertEqual(mirrors.length, 4, 'LR1: strip grew to 4')
  shutdownModel()
}
shutdownModel()

// ST1 (LUMI-14): strip-top Start is a PINNED first child across renders —
// renderMainMirrorTabs must keep the lifted Start at list child 0 and main
// right behind it, synchronously (no rAF reconcile needed). Also pins the
// sweep guard: Start inside the main section survives when the gate is on.
{
  reset()
  hydrateSettings({ drawerLocation: 'sides', startButtonAtStripTop: true })
  const host = await bootMirror()
  const pinHost = getMainPinHost() as unknown as StubElement
  const list = mirrorListIn(pinHost)
  // Simulate the ensure's lift: a direct list child above the main section,
  // exactly what os/start-menu.ts ensureStartButtonForSide produces.
  const startBtn = new StubElement()
  startBtn.tagName = 'BUTTON'
  startBtn.setAttribute('data-canvas-os-start', '1')
  startBtn.setAttribute('data-canvas-start-side', 'primary')
  startBtn.setAttribute('aria-label', 'Start')
  list.insertBefore(startBtn, list.firstChild)

  // Render 1: Start stays first child, main follows it.
  renderMainMirrorTabs()
  assertEqual(list.children[0], startBtn, 'ST1: Start still the first list child after render')
  assert(
    list.children[1]?.className.includes('sidebar-ux-tab-list-main'),
    'ST1: main section directly follows the pinned Start',
  )
  assert(startBtn.parentElement === list, 'ST1: Start not swept into a section')

  // Render 2 (idempotence): no flicker reorder — same order again.
  renderMainMirrorTabs()
  assertEqual(list.children[0], startBtn, 'ST1: order stable across a second render')
  assertEqual(list.children.indexOf(startBtn as unknown as StubElement), 0, 'ST1: Start index 0')

  // LUMI-15: with the strip-top divider present (ensureStartButtonForSide
  // places it directly after Start), the renderer must treat button +
  // divider as the PINNED HEAD: main inserts after the divider, never
  // between button and divider — otherwise every render pushes the divider
  // below the whole tab section (reproduced displacement, review blocker).
  const dividerEl = new StubElement()
  dividerEl.className = 'sidebar-ux-start-strip-top-divider'
  list.insertBefore(dividerEl, startBtn.nextSibling)
  renderMainMirrorTabs()
  assertEqual(list.children[0], startBtn, 'ST1+divider: Start still first')
  assertEqual(list.children[1], dividerEl, 'ST1+divider: divider directly follows Start across renders')
  assert(
    list.children[2]?.className.includes('sidebar-ux-tab-list-main'),
    'ST1+divider: main section directly follows the divider (not inserted between button and divider)',
  )
  renderMainMirrorTabs()
  assertEqual(list.children[0], startBtn, 'ST1+divider: order stable across a second render')
  assertEqual(list.children[1], dividerEl, 'ST1+divider: divider still index 1 after re-render')
  // A divider that is NOT a direct child right after Start must not pin the
  // structure: remove the real one, drop a stray divider at the list end —
  // main must insert right after Start again (cleanup owns stray dividers).
  dividerEl.parentElement!.removeChild(dividerEl)
  const strayDivider = new StubElement()
  strayDivider.className = 'sidebar-ux-start-strip-top-divider'
  list.appendChild(strayDivider)
  renderMainMirrorTabs()
  assert(
    list.children[1]?.className.includes('sidebar-ux-tab-list-main'),
    'ST1+divider: a stray divider elsewhere does not displace main (only a direct child after Start pins)',
  )
  strayDivider.parentElement!.removeChild(strayDivider)

  // Gate off → canonical order is absolute again (Start no longer pinned;
  // the ensure's re-dock path owns the move — here it just must not be
  // special-cased by the renderer anymore).
  hydrateSettings({ drawerLocation: 'sides', startButtonAtStripTop: false })
  renderMainMirrorTabs()
  assert(
    list.children[0] !== startBtn || startBtn.parentElement !== list,
    'ST1: gate off → renderer stops pinning Start (canonical main-first order resumes)',
  )

  // Sweep guard: a legacy Start INSIDE the main section survives the sweep
  // while the gate is on (it is the pinned child; sweeping it breaks the
  // ensure's invariant).
  hydrateSettings({ drawerLocation: 'sides', startButtonAtStripTop: true })
  renderMainMirrorTabs()
  const mainSection = list.children.find((c) => c.className.includes('sidebar-ux-tab-list-main'))!
  const stray = new StubElement()
  stray.tagName = 'BUTTON'
  stray.setAttribute('data-canvas-os-start', '1')
  mainSection.appendChild(stray)
  renderMainMirrorTabs()
  assert(
    mainSection.children.includes(stray),
    'ST1: Start inside the main section survives the non-mirror sweep while pinned',
  )

  // Control: a genuinely foreign node in the main section is still swept.
  const junk = new StubElement()
  junk.className = 'legacy-stray'
  mainSection.appendChild(junk)
  renderMainMirrorTabs()
  assert(!mainSection.children.includes(junk), 'ST1: foreign nodes still swept from the main section')

  shutdownModel()
  void host
}

console.log(`main-tab-pin tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
