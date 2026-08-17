// Configure → toggle off "Enable second drawer" → main-mirror activation
// stops switching content (2026-08-17 user report: "the content remains on
// 'Summary' content, only the tab button visuals and the header update").
//
// This test drives the REAL disable path (requestSecondDrawerMode(false) →
// finishDisable → restoreSingleModeLayout → restoreMainDrawerFromDom) with
// REAL main-tab-pin + REAL main-mirror-drawer (parking) + REAL dispatch +
// REAL main-persist, and then simulates the user's mirror clicks. The host
// is modeled faithfully: clicking a host button switches the "host active"
// tab AND swaps the root inside panelContent (TabPanelContent contract).
//
// The assertion that catches the bug: after the disable, clicking a mirror
// button must (a) forward to the host button (content switch) and (b) the
// parked panelContent must show the newly activated tab's root.

;(globalThis as any).document = undefined // replaced below after stubs

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed++ }
}

// ── Minimal DOM stubs (main-tab-pin.test.ts pattern + host panel model) ──

class StubStyle {
  private _props: Record<string, string> = {}
  setProperty(k: string, v: string, _priority?: string) { this._props[k] = v }
  getPropertyValue(k: string) { return this._props[k] ?? '' }
  removeProperty(k: string) { delete this._props[k] }
  get display() { return this._props['display'] ?? '' }
  set display(v: string) { this._props['display'] = v }
  get transform() { return this._props['transform'] ?? '' }
  set transform(v: string) { this._props['transform'] = v }
  get width() { return this._props['width'] ?? '' }
  set width(v: string) { this._props['width'] = v }
  get height() { return this._props['height'] ?? '' }
  set height(v: string) { this._props['height'] = v }
  get opacity() { return this._props['opacity'] ?? '' }
  set opacity(v: string) { this._props['opacity'] = v }
  get visibility() { return this._props['visibility'] ?? '' }
  set visibility(v: string) { this._props['visibility'] = v }
  get pointerEvents() { return this._props['pointerEvents'] ?? '' }
  set pointerEvents(v: string) { this._props['pointerEvents'] = v }
}

class StubElement {
  style = new StubStyle()
  className = ''
  tagName = 'DIV'
  type = ''
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
  offsetWidth = 0
  offsetHeight = 0
  private _listeners: Record<string, Function[]> = {}
  dataset: Record<string, string> = {}
  // Host simulation: active tab id + roots per tab (TabPanelContent contract).
  hostActiveId: string | null = null
  roots: Record<string, StubElement> = {}

  classList = {
    add: (c: string) => {
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
      const camel = k.slice(5).replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())
      this.dataset[camel] = v
    }
  }
  getAttribute(k: string) { return this._attrs[k] ?? null }
  removeAttribute(k: string) {
    delete this._attrs[k]
    if (k.startsWith('data-') && k.length > 5) {
      const camel = k.slice(5).replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())
      delete this.dataset[camel]
    }
  }
  closest(sel: string): StubElement | null {
    if (typeof sel === 'string' && sel.includes('_wrapper_')) {
      // walk up
      let cur: StubElement | null = this
      while (cur) {
        if (cur.className.includes('_wrapper_')) return cur
        cur = cur.parentElement
      }
    }
    return null
  }
  querySelector(sel: string): StubElement | null {
    // data-tab-id attr lookup (any element, recursive)
    if (sel.includes('[data-tab-id=') || sel.includes('data-tab-id=')) {
      const m = sel.match(/data-tab-id="([^"]+)"/)
      if (m) {
        const walk = (el: StubElement): StubElement | null => {
          if (el.getAttribute('data-tab-id') === m[1]) return el
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
    if (sel.includes('_drawerTab_')) {
      const walk = (el: StubElement): StubElement | null => {
        if (el.className.includes('_drawerTab_') && !el.className.includes('sidebar-ux-drawer-tab')) return el
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
      return null
    }
    if (sel.includes('_panelContent_')) {
      const walk = (el: StubElement): StubElement | null => {
        if (el.className.includes('_panelContent_')) return el
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
      return null
    }
    if (sel.includes('_panel_')) {
      const walk = (el: StubElement): StubElement | null => {
        if (el.className.includes('_panel_')) return el
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
      return null
    }
    if (sel.includes('tabBtnActive')) {
      const walk = (el: StubElement): StubElement | null => {
        if (el.className.includes('tabBtn') && el.className.includes('tabBtnActive')) return el
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
      return null
    }
    if (sel.includes('sidebar-ux-panel-content')) {
      const walk = (el: StubElement): StubElement | null => {
        if (el.className.includes('sidebar-ux-panel-content')) return el
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
      return null
    }
    return null
  }
  querySelectorAll(sel: string): StubElement[] {
    if (sel.includes('tabBtn')) {
      const out: StubElement[] = []
      const walk = (el: StubElement) => {
        if (el.className.includes('tabBtn')) out.push(el)
        for (const c of el.children) walk(c)
      }
      for (const c of this.children) walk(c)
      return out
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
    if (sel.includes('sidebar-ux-tab-list-pin-host')) {
      const out: StubElement[] = []
      const walk = (el: StubElement) => {
        if (el.className.includes('sidebar-ux-tab-list-pin-host')) out.push(el)
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
      fn({ preventDefault() {}, stopPropagation() {}, currentTarget: this, target: this })
    }
  }
  dispatchEvent(ev: { type?: string }): boolean {
    const type = ev?.type
    if (type && this._listeners[type]) {
      for (const fn of this._listeners[type]) {
        fn({ ...ev, preventDefault() {}, stopPropagation() {}, currentTarget: this, target: this })
      }
    }
    return true
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
  getBoundingClientRect() {
    return { width: 420, height: 800, top: 0, left: 0, right: 420, bottom: 800, x: 0, y: 0, toJSON() {} }
  }
}

Object.defineProperty(StubElement.prototype, 'outerHTML', {
  get(this: StubElement) {
    if (this.tagName === 'svg' || this.tagName === 'SVG') return `<svg data-stub="${this.getAttribute('data-icon') || ''}"></svg>`
    return `<${this.tagName}></${this.tagName}>`
  },
  configurable: true,
})
Object.defineProperty(StubElement.prototype, 'textContent', {
  get(this: StubElement) { return (this as any)._text ?? '' },
  set(this: StubElement, v: string) { (this as any)._text = v },
  configurable: true,
})

// ── Host DOM model ──
const bodyStub = new StubElement()
const documentElementStub = new StubElement()
documentElementStub.tagName = 'HTML'
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
const headStub = new StubElement()
headStub.tagName = 'HEAD'

const mainWrapper = new StubElement()
mainWrapper.className = '_wrapper_abc wrapperLeft'
mainWrapper.classList.add('_wrapper_abc')
mainWrapper.classList.add('wrapperLeft')
const mainSidebar = new StubElement()
mainSidebar.className = '_sidebar_xyz'
mainSidebar.setAttribute('data-spindle-mount', 'sidebar')
const panel = new StubElement()
panel.className = '_panel_abc'
const panelContent = new StubElement()
panelContent.className = '_panelContent_abc'
const containerRef = new StubElement()
containerRef.className = '_tabPanelContainer_'
panel.appendChild(panelContent)
panelContent.appendChild(containerRef)
mainWrapper.appendChild(mainSidebar)
mainWrapper.appendChild(panel)
const hostDrawerTab = new StubElement()
hostDrawerTab.tagName = 'BUTTON'
hostDrawerTab.className = '_drawerTab_abc'
hostDrawerTab.offsetWidth = 48
hostDrawerTab.offsetHeight = 48
mainWrapper.appendChild(hostDrawerTab)

/** Host tab button with the ViewportDrawer click contract. */
function makeHostBtn(id: string, title: string, active = false): StubElement {
  const btn = new StubElement()
  btn.tagName = 'BUTTON'
  btn.className = 'tabBtn'
  btn.classList.add('tabBtn')
  if (active) { btn.className += ' tabBtnActive'; btn.classList.add('tabBtnActive') }
  btn.setAttribute('data-tab-id', id)
  btn.setAttribute('title', title)
  const span = new StubElement(); span.tagName = 'SPAN'
  const svg = new StubElement(); svg.tagName = 'svg'; svg.setAttribute('data-icon', id)
  span.appendChild(svg); btn.appendChild(span)
  // Host click contract: switch host active + swap the root in the container.
  btn.addEventListener('click', () => {
    mainSidebar.hostActiveId = id
    for (const b of mainSidebar.querySelectorAll('button[class*="tabBtn"]')) {
      b.classList.remove('tabBtnActive')
    }
    btn.classList.add('tabBtnActive')
    // TabPanelContent: containerRef holds the active tab's root.
    const root = mainSidebar.roots[id]
    containerRef.children = root ? [root] : []
    containerRef.firstChild = containerRef.children[0] ?? null
    root && (root.parentElement = containerRef)
    // mirror-content watcher simulates React re-render noise
  })
  return btn
}

const hostLore = makeHostBtn('lore', 'Lore')
const hostSummary = makeHostBtn('summary', 'Summary', true)
const hostPresets = makeHostBtn('presets', 'Presets')
mainSidebar.hostActiveId = 'summary'
mainSidebar.appendChild(hostLore)
mainSidebar.appendChild(hostSummary)
mainSidebar.appendChild(hostPresets)
// Secondary-assigned in dual mode: hidden host button (hideMainTabButton).
hostPresets.style.display = 'none'
// Roots per tab (built-in registry roots).
for (const id of ['lore', 'summary', 'presets']) {
  const root = new StubElement()
  root.className = `root-${id}`
  mainSidebar.roots[id] = root
}
// Host currently renders the summary root (active tab).
containerRef.appendChild(mainSidebar.roots['summary'])

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
    if (sel === 'body') return bodyStub
    if (sel.includes('data-canvas-main-panel-content')) {
      const walk = (el: StubElement): StubElement | null => {
        if (el.getAttribute('data-canvas-main-panel-content') === '1') return el
        for (const c of el.children) {
          const hit = walk(c)
          if (hit) return hit
        }
        return null
      }
      for (const c of bodyStub.children) {
        const hit = walk(c)
        if (hit) return hit
      }
      return null
    }
    return null
  },
  querySelectorAll(sel: string): StubElement[] {
    if (sel.includes('sidebar-ux-tab-list-pin-host')) {
      return bodyStub.children.filter((c) => c.className.includes('sidebar-ux-tab-list-pin-host'))
    }
    if (sel.includes('sidebar-ux-main-mirror-wrapper')) {
      return bodyStub.children.filter((c) => c.className.includes('sidebar-ux-main-mirror-wrapper'))
    }
    return []
  },
}
;(globalThis as any).window = {
  innerWidth: 1280,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {},
  removeEventListener() {},
}
let _rafTime = 0
const _raf = (fn: FrameRequestCallback) => {
  _rafTime += 400
  const t = _rafTime
  queueMicrotask(() => fn(t))
  return t
}
;(globalThis as any).requestAnimationFrame = _raf
;(globalThis as any).cancelAnimationFrame = () => {}
;(globalThis as any).CSS = { escape: (s: string) => s }
;(globalThis as any).getComputedStyle = () => ({})
;(globalThis as any).MutationObserver = class {
  observe() {}
  disconnect() {}
  takeRecords() { return [] }
}
;(globalThis as any).ResizeObserver = class {
  observe() {}
  disconnect() {}
}
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

// ── Mocks (same surface as enable-side-cascade-repro.test.ts) ──
import { mock } from 'bun:test'

const secondaryState = {
  open: false,
  mountedSide: null as 'left' | 'right' | null,
  wrapper: null as unknown | null,
}
/** DOM-placed roots simulated in the harness (tabId → root element). */
const domPlacedRoots = new Map<string, StubElement>()

mock.module('../../sidebar/secondary', () => ({
  SECONDARY_WIDTH_VAR: '--sidebar-ux-secondary-width',
  PUZZLE_ICON_SVG: '',
  isSecondarySidebarOpen: () => secondaryState.open,
  getSecondaryWrapper: () => secondaryState.wrapper,
  getSecondaryDrawer: () => secondaryState.wrapper,
  getSecondaryPanel: () => null,
  getSecondaryTabList: () => null,
  isSecondaryShellLive: () => secondaryState.wrapper !== null,
  getClosedTransformPx: () => 0,
  createSecondarySidebar: () => ({}),
  mountSecondarySidebar: (opts?: { initialOpen?: boolean }) => {
    void import('../../store').then((store) => {
      secondaryState.mountedSide = store.getMainDrawerSide() === 'left' ? 'right' : 'left'
      secondaryState.open = opts?.initialOpen === true
      secondaryState.wrapper = { querySelector: () => null, querySelectorAll: () => [], classList: { add() {}, remove() {}, contains() { return false } }, style: {}, dataset: {}, isConnected: true }
    })
  },
  unmountSecondarySidebar: () => {
    secondaryState.open = false
    secondaryState.wrapper = null
  },
  tearDownSecondarySidebar: () => {
    // Faithful subset of the REAL teardown's sidebar effects: re-show host
    // buttons of secondary-assigned tabs (showMainTabButton), restore
    // DOM-placed roots via the REAL restore helper (detaches them), clear
    // the assignment facade, drop the shell, rebuild the main pin.
    for (const btn of mainSidebar.querySelectorAll('button[class*="tabBtn"]')) {
      if (btn.style.display === 'none') btn.style.display = ''
    }
    void import('../../tabs/dom-placed-builtin').then(({ restoreDomPlacedBuiltInToMain }) => {
      for (const [tabId, root] of domPlacedRoots) {
        restoreDomPlacedBuiltInToMain(tabId, root as unknown as HTMLElement)
      }
    })
    void import('../../tabs/assignment').then(({ clearTabAssignments }) => {
      clearTabAssignments()
    })
    secondaryState.open = false
    secondaryState.wrapper = null
    void import('../../sidebar/main-tab-pin').then((m) => m.reconcileMainTabListPin())
  },
  ensureSecondaryShellMounted: () => true,
  liveIdForFacadeKey: (key: string) => key,
  openSecondarySidebar: () => {
    if (!secondaryState.wrapper || secondaryState.open) return
    secondaryState.open = true
  },
  closeSecondarySidebar: (_opts?: { silent?: boolean }) => {
    secondaryState.open = false
  },
  persistSecondaryDrawerOpen: (_open: boolean) => {},
  reassignSecondaryTabsFromModel: () => {},
}))

mock.module('../../sidebar/strip-gutter', () => ({
  updateStripGutters: () => {},
}))

mock.module('../../features/registry', () => ({
  FEATURES: [
    {
      id: 'secondSidebarEnabled',
      mount() {},
      apply(prev: any, next: any) {
        if (prev.secondSidebarEnabled === next.secondSidebarEnabled) return
        if (next.secondSidebarEnabled) {
          void import('../../sidebar/secondary').then((s) => s.mountSecondarySidebar({}))
        } else {
          void import('../../sidebar/secondary').then((s) => s.tearDownSecondarySidebar())
        }
      },
    },
  ],
}))

mock.module('../../settings/panel', () => ({
  applySettings: (prev: any, next: any) => {
    void import('../../features/registry').then(({ FEATURES }) => {
      for (const f of FEATURES) {
        if (!f.apply) continue
        if (prev[f.id] === next[f.id]) continue
        f.apply(prev, next, null as any)
      }
    })
  },
  buildSettingsPanelDOM: () => {},
  setPanelRefresh: () => {},
}))

mock.module('../../debug/styles', () => ({
  injectStyles: () => {},
}))

mock.module('../../tabs/configure-modal', () => ({
  isConfigureTabsModalOpen: () => false,
  flushConfigureCommits: async () => {},
  refreshConfigureDraftFromLive: () => {},
  getConfigureDraftRef: () => null,
  getConfigureBaseRef: () => null,
}))

mock.module('../../tabs/owned-commit', () => ({
  commitDraftToOwnedModel: async () => ({ ok: true }),
}))

// ── Dynamic imports (AFTER mocks) ──
const [{ requestSecondDrawerMode }] = await Promise.all([import('../second-drawer-mode')])
const [{ getSettings, setSettings, setSingleLayoutSlot, setDualLayoutSlot, hydrateSettings }] =
  await Promise.all([import('../state')])
const [
  { bootstrap, shutdown, flush, getModel, dispatchBatch },
] = await Promise.all([import('../../recon/dispatch')])
const [{ serializeModelToLayout }] = await Promise.all([import('../../persist/layout-model')])
const [
  { applyMainTabListPin, getActiveMainMirrorKey, __resetMainTabPinForTest },
] = await Promise.all([import('../../sidebar/main-tab-pin')])
const [{ __resetMainMirrorForTest }] = await Promise.all([import('../../sidebar/main-mirror-drawer')])
const [
  { startMainDrawerPersistence, stopMainDrawerPersistence },
] = await Promise.all([import('../../sidebar/main-persist')])
const [{ clearHostSettingsCache }] = await Promise.all([import('../../dom/host-settings')])
const { createEmptyModel, builtinKey, extensionKey } = await import('../../core/model')
const { FakeHost } = await import('../../host/fake/implementation')
import type { TabKey, Side, DrawerSide } from '../../core/model'
import type { LiveTab } from '../../host/fake/implementation'

const LORE = builtinKey('lore')
const SUMMARY = builtinKey('summary')
const PRESETS = builtinKey('presets')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function settle(rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await sleep(30)
    await flush()
  }
}

function makeLiveTab(key: TabKey, liveId: string, location: Side, overrides?: Partial<LiveTab>): LiveTab {
  return {
    key, liveId, location,
    hidden: false,
    activeInPrimary: false,
    activeInSecondary: false,
    hasContentRoot: true,
    isBuiltin: key.startsWith('builtin:'),
    ...overrides,
  }
}

function mirrorButtons(): StubElement[] {
  const out: StubElement[] = []
  const walk = (el: StubElement) => {
    if (el.className.includes('sidebar-ux-main-tab-mirror-btn')) out.push(el)
    for (const c of el.children) walk(c)
  }
  for (const c of bodyStub.children) walk(c)
  return out
}
function mirrorFor(key: string): StubElement | null {
  return mirrorButtons().find((b) => b.getAttribute('data-mirror-key') === key) ?? null
}

// ============================================================================
// R1 — THE REPRO: dual → disable → mirror clicks must still forward to host
// ============================================================================
async function runRepro() {
  shutdown()
  __resetMainTabPinForTest()
  __resetMainMirrorForTest()
  clearHostSettingsCache()
  stopMainDrawerPersistence()

  hydrateSettings({
    taskbarMode: true,
    moveControlsToOuterEdge: true,
    secondSidebarEnabled: true,
    persistDrawerOpenState: false,
    dragAndDropDrawerTabs: true,
  } as any)

  const host = new FakeHost([
    makeLiveTab(LORE, 'lore', 'primary'),
    makeLiveTab(SUMMARY, 'summary', 'primary', { activeInPrimary: true }),
    makeLiveTab(PRESETS, 'presets', 'secondary'),
  ], 'left')

  const dualModel = {
    ...createEmptyModel(),
    primary: [LORE, SUMMARY],
    secondary: [PRESETS],
    hidden: [],
    active: { primary: SUMMARY, secondary: null },
    side: 'left' as DrawerSide,
  }
  bootstrap(dualModel, host)
  await flush()

  // Dual-mode slots.
  setDualLayoutSlot(serializeModelToLayout(dualModel, (k) => host.resolve(k), 'test-v1.0'))
  setSingleLayoutSlot({
    version: 'test-v1.0',
    primary: { open: true, width: 420, tabId: 'summary' },
    secondary: { open: false, width: 420, activeTabId: undefined },
    detachedTabs: [],
    tabOrder: ['lore', 'summary', 'presets'],
    hiddenTabIds: [],
    drawerSide: 'left' as const,
  })

  // Mount the main mirror (taskbar). Presets' host button is display:none
  // (secondary-assigned) so it is not in the mirror yet.
  applyMainTabListPin(true, { force: true })

  // User session state: active main tab = summary, picked by the user.
  const summaryMirror = mirrorFor('id__summary')
  assert(!!summaryMirror, 'R1a: summary mirror button exists (dual)')
  const loreMirror = mirrorFor('id__lore')
  assert(!!loreMirror, 'R1b: lore mirror button exists (dual)')
  if (summaryMirror) {
      summaryMirror.click()
    summaryMirror.click()
    await settle()
  }
  assertEqual(hostSummary.clickCount, 1, 'R1c: boot user click forwarded to host summary button')
  assertEqual(getActiveMainMirrorKey(), 'id__summary', 'R1d: mirror key = summary')

  // Enable main-drawer persistence so the restore path runs for real.
  startMainDrawerPersistence()

  // ── THE DISABLE: Configure "Enable second drawer" → OFF ──
  setSettings({ secondSidebarEnabled: true }) // ensure on
  await requestSecondDrawerMode(false)
  // Let the restore polling + settle finish.
  await settle(12)
  await sleep(300)

  const model = getModel()
  assert(model != null, 'R1e: model present after disable')
  if (model) {
    assertEqual(model.secondary.length, 0, 'R1f: model is single-drawer after disable')
  }

  // Mirror must still be mounted with both tabs.
  assert(!!mirrorFor('id__lore'), 'R1g: lore mirror button still present after disable')
  assert(!!mirrorFor('id__summary'), 'R1h: summary mirror button still present after disable')
  assert(!!mirrorFor('id__presets'), 'R1i: presets mirror button now present (host button re-shown)')

  // ── THE USER CLICK: activate Lore after the disable ──
  const loreMirrorAfter = mirrorFor('id__lore')
  assert(!!loreMirrorAfter, 'R1j: lore mirror present for click')
  if (loreMirrorAfter) {
    loreMirrorAfter.click()
    await settle()
  }

  // (a) mirror chrome: key + visuals moved
  assertEqual(getActiveMainMirrorKey(), 'id__lore', 'R1k: mirror key moved to lore')

  // (b) the HOST must have received the click → content switch
  assertEqual(hostLore.clickCount, 1, 'R1l: host lore button clicked after disable (content switch)')
  assertEqual(mainSidebar.hostActiveId, 'lore', 'R1m: host active moved to lore')
  assert(containerRef.firstChild === mainSidebar.roots['lore'],
    'R1n: panelContent container shows lore root')

  // (c) the parked mirror content must show lore root
  const parked = panelContent.parentElement
  assert(parked !== null && parked.className.includes('sidebar-ux-panel-content'),
    'R1o: panelContent parked in the mirror shell')
  assert(panelContent.firstChild === containerRef,
    'R1p: parked panelContent still hosts the TabPanelContent container')
  assert(containerRef.firstChild === mainSidebar.roots['lore'],
    'R1q: parked content shows lore root')

  stopMainDrawerPersistence()
}

// ============================================================================
// R2 — host replaces panelContent (content-area remount) while the old node
// is still parked: the mirror must re-park the NEW node and evict the stale
// one (the "content stuck on old tab" class of bug).
// ============================================================================
async function runStaleParkRepro() {
  shutdown()
  __resetMainTabPinForTest()
  __resetMainMirrorForTest()
  clearHostSettingsCache()
  stopMainDrawerPersistence()

  hydrateSettings({
    taskbarMode: true,
    moveControlsToOuterEdge: true,
    secondSidebarEnabled: true,
    dragAndDropDrawerTabs: true,
  } as any)

  const host = new FakeHost([
    makeLiveTab(LORE, 'lore', 'primary'),
    makeLiveTab(SUMMARY, 'summary', 'primary', { activeInPrimary: true }),
  ], 'left')

  const dualModel = {
    ...createEmptyModel(),
    primary: [LORE, SUMMARY],
    secondary: [],
    hidden: [],
    active: { primary: SUMMARY, secondary: null },
    side: 'left' as DrawerSide,
  }
  bootstrap(dualModel, host)
  await flush()

  applyMainTabListPin(true, { force: true })

  // Park P1 (the original host panelContent) via the open path.
  const summaryMirror = mirrorFor('id__summary')
  assert(!!summaryMirror, 'R2a: mirror present')
  if (summaryMirror) summaryMirror.click()
  await settle()
  const shell = (() => {
    const hostEls = bodyStub.children.filter((c) => c.className.includes('sidebar-ux-main-mirror-wrapper'))
    if (hostEls.length === 0) return null
    const walk = (el: StubElement): StubElement | null => {
      if (el.className.includes('sidebar-ux-panel-content')) return el
      for (const c of el.children) {
        const hit = walk(c)
        if (hit) return hit
      }
      return null
    }
    for (const c of hostEls) {
      const hit = walk(c)
      if (hit) return hit
    }
    return null
  })()
  assert(shell !== null, 'R2b: mirror shell content slot exists')
  assert(panelContent.parentElement === shell, 'R2c: P1 parked in the shell slot')

  // Simulate the host remounting its drawer content area: a NEW panelContent
  // node appears under the host panel (the old parked node stays in the
  // shell — the exact stale-node shape the mirror previously froze on).
  const p2 = new StubElement()
  p2.className = '_panelContent_abc'
  const containerRef2 = new StubElement()
  containerRef2.className = '_tabPanelContainer_'
  p2.appendChild(containerRef2)
  panel.appendChild(p2)
  // The host renders the ACTIVE tab's root into the new node.
  containerRef2.appendChild(mainSidebar.roots['summary'])

  // A user click (or the repark watch tick) must re-park the LIVE node.
  const loreMirror = mirrorFor('id__lore')
  assert(!!loreMirror, 'R2d: lore mirror present')
  if (loreMirror) loreMirror.click()
  await settle()
  const loreMirrorAfter = mirrorFor('id__lore')
  assert(!!loreMirrorAfter, 'R2d2: lore mirror present after settle')
  if (loreMirrorAfter) {
    assert(loreMirrorAfter.getAttribute('data-mirror-key') === 'id__lore', 'R2i: mirror chrome intact')
  }

  assert(p2.parentElement === shell, 'R2e: new panelContent parked in the shell slot')
  assert(panelContent.parentElement !== shell, 'R2f: stale P1 evicted from the shell')
  assert(panelContent.parentElement === null, 'R2g: stale P1 detached (no longer in the shell)')
  assert(containerRef2.firstChild === mainSidebar.roots['summary'],
    'R2h: parked new node shows the active tab root')

  stopMainDrawerPersistence()
}

// ============================================================================
// R3 — DOM-placed built-in roots must NOT be appended into the parked
// panelContent on disable (they render as stacked orphan panels inside the
// mirror — the "content stuck on a previous tab" bug). The real teardown's
// restoreDomPlacedBuiltInToMain now DETACHES them; the host re-attaches on
// activation.
// ============================================================================
async function runDomPlacedRestoreRepro() {
  shutdown()
  __resetMainTabPinForTest()
  __resetMainMirrorForTest()
  clearHostSettingsCache()
  stopMainDrawerPersistence()
  domPlacedRoots.clear()
  const { __clearDomPlacedForTest } = await import('../../tabs/dom-placed-builtin')
  __clearDomPlacedForTest()

  hydrateSettings({
    taskbarMode: true,
    moveControlsToOuterEdge: true,
    secondSidebarEnabled: true,
    dragAndDropDrawerTabs: true,
  } as any)

  const host = new FakeHost([
    makeLiveTab(LORE, 'lore', 'primary'),
    makeLiveTab(SUMMARY, 'summary', 'primary', { activeInPrimary: true }),
    makeLiveTab(PRESETS, 'presets', 'secondary'),
  ], 'left')

  const dualModel = {
    ...createEmptyModel(),
    primary: [LORE, SUMMARY],
    secondary: [PRESETS],
    hidden: [],
    active: { primary: SUMMARY, secondary: null },
    side: 'left' as DrawerSide,
  }
  bootstrap(dualModel, host)
  await flush()
  setDualLayoutSlot(serializeModelToLayout(dualModel, (k) => host.resolve(k), 'test-v1.0'))
  setSingleLayoutSlot({
    version: 'test-v1.0',
    primary: { open: true, width: 420, tabId: 'summary' },
    secondary: { open: false, width: 420, activeTabId: undefined },
    detachedTabs: [],
    tabOrder: ['lore', 'summary', 'presets'],
    hiddenTabIds: [],
    drawerSide: 'left' as const,
  })

  applyMainTabListPin(true, { force: true })
  const summaryMirror = mirrorFor('id__summary')
  assert(!!summaryMirror, 'R3a: mirror present')
  if (summaryMirror) summaryMirror.click()
  await settle()
  const parkedNode = (globalThis as any).document.querySelector(
    '[data-canvas-main-panel-content]',
  ) as StubElement | null
  assert(parkedNode !== null, 'R3b: a panelContent node is parked in the shell')

  // Simulate the DUAL-era DOM-placed state: presets' root reparented into
  // the secondary content with the Canvas placement attrs (the real
  // tryDomPlaceRoot path), and the root OUT of the parked panelContent.
  const secondaryContentEl = new StubElement()
  secondaryContentEl.className = 'sidebar-ux-panel-content'
  const presetsRoot = mainSidebar.roots['presets']
  if (presetsRoot.parentElement) presetsRoot.parentElement.removeChild(presetsRoot)
  secondaryContentEl.appendChild(presetsRoot)
  presetsRoot.setAttribute('data-canvas-moved', 'presets')
  presetsRoot.setAttribute('data-canvas-dom-placed', '')
  domPlacedRoots.set('presets', presetsRoot)

  // ── THE DISABLE ──
  await requestSecondDrawerMode(false)
  await settle(12)
  await sleep(300)

  const model = getModel()
  assert(model != null, 'R3c: model present after disable')
  if (model) {
    assertEqual(model.secondary.length, 0, 'R3d: single mode after disable')
  }

  // THE BUG CHECK: the parked panelContent must contain ONLY the host's
  // TabPanelContent containerRef — NO orphan roots as direct children.
  const directChildren = (parkedNode?.children ?? []).map((c) => c.className)
  assert(
    directChildren.length === 1 && directChildren[0] === '_tabPanelContainer_',
    'R3e: parked panelContent has no orphan roots (got: ' + JSON.stringify(directChildren) + ')',
  )
  assertEqual(
    presetsRoot.parentElement,
    null,
    'R3f: DOM-placed root detached (host re-attaches on activation)',
  )
  // Host re-attach on activation: clicking presets' mirror moves its root
  // into the containerRef (TabPanelContent contract).
  const presetsMirror = mirrorFor('id__presets')
  assert(!!presetsMirror, 'R3g: presets mirror present')
  if (presetsMirror) presetsMirror.click()
  await settle()
  assertEqual(hostPresets.clickCount, 1, 'R3h: host presets button clicked')
  assert(
    containerRef.firstChild === presetsRoot,
    'R3i: host attached presets root into its containerRef (re-attach on activation)',
  )

  stopMainDrawerPersistence()
  domPlacedRoots.clear()
}

await runRepro()
await runStaleParkRepro()
await runDomPlacedRestoreRepro()

if (failed > 0) {
  console.error(`disable-content-stuck-repro: ${passed} passed, ${failed} failed`)
  process.exit(1)
} else {
  console.log(`disable-content-stuck-repro: ${passed} passed, 0 failed`)
}
