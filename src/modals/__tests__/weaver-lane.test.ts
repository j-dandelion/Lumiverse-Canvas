// Test file: weaver-lane strip-only geometry (taskbar-mode pin strips, not drawers).
//
// Validates:
//   - aria-label "Weaver" tags dialog even when activeModal is null
//   - Insets use strip gutters only (never open-drawer 420)
//   - taskbar mode off → 0,0
//   - Live pin hosts contribute strip width
//   - Teardown clears tag + styles
//   - Non-weaver modal not tagged
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
  id = ''
  offsetWidth = 0
  offsetHeight = 0
  _styleProps: Record<string, string> = {}
  _attrs: Record<string, string> = {}
  _children: StubElement[] = []
  parentElement: StubElement | null = null
  firstElementChild: StubElement | null = null
  appendChild(c: StubElement) {
    this._children.push(c)
    c.parentElement = this
    if (!this.firstElementChild) this.firstElementChild = c
  }
  remove() {
    if (this.parentElement) {
      const i = this.parentElement._children.indexOf(this)
      if (i >= 0) this.parentElement._children.splice(i, 1)
      if (this.parentElement.firstElementChild === this) {
        this.parentElement.firstElementChild = this.parentElement._children[0] ?? null
      }
    }
  }
  setAttribute(n: string, v: string) { this._attrs[n] = v }
  getAttribute(n: string) { return this._attrs[n] ?? null }
  hasAttribute(n: string): boolean { return n in this._attrs }
  removeAttribute(n: string) { delete this._attrs[n] }
  getBoundingClientRect() {
    return { width: this.offsetWidth, height: this.offsetHeight || 600, top: 0, left: 0, right: this.offsetWidth, bottom: 600 }
  }
  get style() {
    const self = this
    return {
      setProperty: (n: string, v: string, _priority?: string) => { self._styleProps[n] = v },
      removeProperty: (n: string) => { delete self._styleProps[n] },
      getPropertyValue: (n: string) => self._styleProps[n] ?? '',
    }
  }
  querySelector(sel: string): any {
    if (sel.includes('[data-canvas-weaver-lane]')) {
      if (this.getAttribute('data-canvas-weaver-lane') === '1') return this
      for (const c of this._children) { const f = c.querySelector(sel); if (f) return f }
      return null
    }
    if (sel.startsWith('.')) {
      const cls = sel.slice(1).split(/[\s\[]/)[0]
      if (this.className.includes(cls)) return this
      for (const c of this._children) { const f = c.querySelector(sel); if (f) return f }
      return null
    }
    if (sel.includes('[') ) {
      const parts = sel.match(/\[([^\]]+)\]/g) || []
      const checks = parts.map((p) => {
        const inner = p.slice(1, -1)
        const eq = inner.indexOf('=')
        if (eq < 0) return { name: inner, val: null as string | null }
        return { name: inner.slice(0, eq).trim(), val: inner.slice(eq + 1).replace(/"/g, '').trim() }
      })
      const matches = (el: StubElement) => checks.every((c) =>
        c.val === null ? el.hasAttribute(c.name) : el.getAttribute(c.name) === c.val,
      )
      if (matches(this)) return this
      for (const c of this._children) { const f = c.querySelector(sel); if (f) return f }
      return null
    }
    for (const c of this._children) { const f = c.querySelector(sel); if (f) return f }
    return null
  }
  querySelectorAll(sel: string): any[] {
    const out: StubElement[] = []
    const walk = (el: StubElement) => {
      if (sel.includes('[data-canvas-weaver-lane]') && el.getAttribute('data-canvas-weaver-lane') === '1') out.push(el)
      else if (sel === '.sidebar-ux-tab-list-pin-host' && el.className.includes('sidebar-ux-tab-list-pin-host')) out.push(el)
      else if (sel.includes('[role="dialog"]')) {
        if (el.getAttribute('role') === 'dialog' && el.getAttribute('aria-modal') === 'true') out.push(el)
      }
      for (const c of el._children) walk(c)
    }
    walk(this)
    return out
  }
  addEventListener() {}
  removeEventListener() {}
}

;(globalThis as any).HTMLElement = StubElement
;(globalThis as any).Element = StubElement

const _styleElements: Record<string, StubElement> = {}
const stubBody = new StubElement()
const stubDocEl = {
  clientWidth: 1280,
  style: {
    _props: {} as Record<string, string>,
    setProperty: (n: string, v: string) => { (stubDocEl.style._props as any)[n] = v },
    getPropertyValue: (n: string) => (stubDocEl.style._props as any)[n] ?? '',
    removeProperty: (n: string) => { delete (stubDocEl.style._props as any)[n] },
  },
}

const stubDoc: any = {
  documentElement: stubDocEl,
  body: stubBody,
  getElementById: (id: string) => _styleElements[id] ?? null,
  createElement: () => new StubElement(),
  querySelector: (sel: string) => {
    if (sel === '[role="dialog"][aria-modal="true"]') {
      return stubBody.querySelectorAll('[role="dialog"]').find((d: StubElement) => d.getAttribute('aria-modal') === 'true') ?? null
    }
    if (sel.startsWith('[data-canvas-weaver-lane')) return stubBody.querySelector(sel)
    return stubBody.querySelector(sel)
  },
  querySelectorAll: (sel: string) => {
    if (sel === '[role="dialog"][aria-modal="true"]') return stubBody.querySelectorAll('[role="dialog"]')
    return stubBody.querySelectorAll(sel)
  },
  head: { appendChild: (c: StubElement) => { if (c.id) _styleElements[c.id] = c }, removeChild: () => {} },
  addEventListener: () => {},
  removeEventListener: () => {},
}
;(globalThis as any).document = stubDoc
const _listeners: Record<string, Function[]> = {}
;(globalThis as any).window = {
  innerWidth: 1280,
  requestAnimationFrame: (cb: any) => { setTimeout(cb, 0); return 1 },
  cancelAnimationFrame: () => {},
  getComputedStyle: () => ({ display: '', visibility: '' }),
  addEventListener: (t: string, cb: any) => {
    _listeners[t] = _listeners[t] || []
    _listeners[t].push(cb)
  },
  removeEventListener: (t: string, cb: any) => {
    _listeners[t] = (_listeners[t] || []).filter((f) => f !== cb)
  },
}
;(globalThis as any).requestAnimationFrame = (cb: any) => { setTimeout(cb, 0); return 1 }
;(globalThis as any).cancelAnimationFrame = () => {}
;(globalThis as any).MutationObserver = class {
  constructor(_cb: any) {}
  observe() {}
  disconnect() {}
  takeRecords() { return [] }
}

// ── Mocks ──
let _mockActiveModal: string | null = null
let _taskbarMode = true
let _mobile = false
let _stripGutters = { left: 56, right: 56 }
let _publishCalled = false
let _secondaryOpen = true
let _mainMirrorActive = true
let _canvasMainOpen = true
let _closeSecondaryCalls = 0
let _closeMainMirrorCalls = 0
let _hostCloseDrawerCalls = 0
/** When true, store exposes closeDrawer (host vanilla path). */
let _hostStoreHasCloseDrawer = false

mock.module('../../store', () => ({
  getActiveModal: (_force = false) => _mockActiveModal,
  findStoreData: (_force = false) => {},
  getStoreSnapshot: () => {
    if (!_hostStoreHasCloseDrawer) return null
    return {
      drawerOpen: true,
      closeDrawer: () => { _hostCloseDrawerCalls++ },
    }
  },
}))

mock.module('../../chat/reflow', () => ({
  publishContentLaneInsets: () => { _publishCalled = true },
  // Intentionally NOT used by weaver-lane for geometry — if something
  // still imported computeContentLaneInsets, tests would fail on missing export.
}))

mock.module('../../debug/log', () => ({
  dwarn: () => {},
  dlog: () => {},
}))

mock.module('../../sidebar/styles', () => ({
  TAB_LIST_WIDTH_PX: 56,
}))

mock.module('../../settings/state', () => ({
  isTaskbarModeEnabled: () => _taskbarMode,
}))

mock.module('../../sidebar/strip-gutter', () => ({
  computeStripGutters: () => ({ ..._stripGutters }),
}))

mock.module('../../sidebar/mobile-exclusion', () => ({
  isMobileViewport: () => _mobile,
}))

mock.module('../../sidebar/secondary', () => ({
  isSecondarySidebarOpen: () => _secondaryOpen,
  closeSecondarySidebar: () => { _closeSecondaryCalls++ },
}))

mock.module('../../sidebar/main-mirror-drawer', () => ({
  isMainMirrorActive: () => _mainMirrorActive,
  isCanvasMainOpen: () => _canvasMainOpen,
  closeCanvasMainDrawer: () => { _closeMainMirrorCalls++ },
}))

mock.module('../../dom/lumiverse', () => ({
  getMainWrapper: () => null,
}))

mock.module('../../sidebar/main-persist', () => ({
  findDrawerToggleButton: () => null,
}))

const mod = await import('../weaver-lane')
const { startWeaverLane, computeWeaverStripInsets } = mod

function reset() {
  _mockActiveModal = null
  _taskbarMode = true
  _mobile = false
  _stripGutters = { left: 56, right: 56 }
  _publishCalled = false
  _secondaryOpen = true
  _mainMirrorActive = true
  _canvasMainOpen = true
  _closeSecondaryCalls = 0
  _closeMainMirrorCalls = 0
  _hostCloseDrawerCalls = 0
  _hostStoreHasCloseDrawer = false
  stubBody._children = []
  stubBody.firstElementChild = null
  stubDocEl.style._props = {}
  for (const k of Object.keys(_styleElements)) delete _styleElements[k]
  for (const k of Object.keys(_listeners)) delete _listeners[k]
}

function makeDialog(ariaLabel?: string): StubElement {
  const dialog = new StubElement()
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  if (ariaLabel) dialog.setAttribute('aria-label', ariaLabel)
  const shell = new StubElement()
  shell.className = 'shell'
  dialog.appendChild(shell)
  stubBody.appendChild(dialog)
  return dialog
}

function makePinHost(side: 'left' | 'right', width = 56): StubElement {
  const host = new StubElement()
  host.className = `sidebar-ux-tab-list-pin-host sidebar-ux-side-${side}`
  host.offsetWidth = width
  host.offsetHeight = 800
  if (side === 'right') {
    host.getBoundingClientRect = () => ({
      width, height: 800, top: 0, left: 1280 - width, right: 1280, bottom: 800,
    })
  } else {
    host.getBoundingClientRect = () => ({
      width, height: 800, top: 0, left: 0, right: width, bottom: 800,
    })
  }
  stubBody.appendChild(host)
  return host
}

// ── Unit: computeWeaverStripInsets ──
reset()
_taskbarMode = true
_stripGutters = { left: 56, right: 56 }
assertEqual(computeWeaverStripInsets().left, 56, 'strip gutters left')
assertEqual(computeWeaverStripInsets().right, 56, 'strip gutters right')

reset()
_taskbarMode = false
_stripGutters = { left: 56, right: 56 }
assertEqual(computeWeaverStripInsets().left, 0, 'taskbar off: left 0')
assertEqual(computeWeaverStripInsets().right, 0, 'taskbar off: right 0')

reset()
_mobile = true
_taskbarMode = true
assertEqual(computeWeaverStripInsets().left, 0, 'mobile: left 0')

// Strip gutters stay at 56 even if a hypothetical open-drawer path would be 420
reset()
_taskbarMode = true
_stripGutters = { left: 56, right: 56 }
assertEqual(computeWeaverStripInsets().left, 56, 'never open-drawer width on left')
assert(computeWeaverStripInsets().left < 100, 'strip inset is strip-scale not drawer-scale')

// Live pin can raise above zero gutters
reset()
_taskbarMode = true
_stripGutters = { left: 0, right: 0 }
makePinHost('left', 56)
makePinHost('right', 56)
assertEqual(computeWeaverStripInsets().left, 56, 'live pin left')
assertEqual(computeWeaverStripInsets().right, 56, 'live pin right')

// ── Integration: tag + stamp ──
reset()
const d1 = makeDialog('Weaver')
makePinHost('left', 56)
makePinHost('right', 56)
_mockActiveModal = null
_taskbarMode = true
_stripGutters = { left: 56, right: 56 }
const t1 = startWeaverLane()
await new Promise((r) => setTimeout(r, 15))
assertEqual(d1.getAttribute('data-canvas-weaver-lane'), '1', 'aria-label Weaver: tagged')
assertEqual(d1.style.getPropertyValue('left'), '56px', 'left = strip only')
assertEqual(d1.style.getPropertyValue('right'), '56px', 'right = strip only')
assertEqual(
  stubDocEl.style.getPropertyValue('--sidebar-ux-weaver-inset-l'),
  '56px',
  'weaver-only L var (not content-lane)',
)
t1()

// Store path
reset()
const d2 = makeDialog()
_mockActiveModal = 'weaver'
_taskbarMode = true
_stripGutters = { left: 56, right: 0 }
const t2 = startWeaverLane()
await new Promise((r) => setTimeout(r, 15))
assertEqual(d2.getAttribute('data-canvas-weaver-lane'), '1', 'store weaver: tagged')
assertEqual(d2.style.getPropertyValue('left'), '56px', 'store path left strip')
assertEqual(d2.style.getPropertyValue('right'), '0px', 'no secondary strip → right 0')
t2()

// taskbar mode off while weaver open → 0 insets (full host modal)
reset()
const d3 = makeDialog('Weaver')
_mockActiveModal = 'weaver'
_taskbarMode = false
const t3 = startWeaverLane()
await new Promise((r) => setTimeout(r, 15))
assertEqual(d3.getAttribute('data-canvas-weaver-lane'), '1', 'still tagged when taskbar mode off')
assertEqual(d3.style.getPropertyValue('left'), '0px', 'taskbar off: left 0')
assertEqual(d3.style.getPropertyValue('right'), '0px', 'taskbar off: right 0')
t3()

// Non-weaver
reset()
const d4 = makeDialog('Settings')
_mockActiveModal = 'settings'
const t4 = startWeaverLane()
await new Promise((r) => setTimeout(r, 15))
assertEqual(d4.getAttribute('data-canvas-weaver-lane'), null, 'settings not tagged')
t4()

// Teardown
reset()
const d5 = makeDialog('Weaver')
_mockActiveModal = 'weaver'
_taskbarMode = true
const t5 = startWeaverLane()
await new Promise((r) => setTimeout(r, 15))
t5()
assertEqual(d5.getAttribute('data-canvas-weaver-lane'), null, 'teardown removes tag')
assertEqual(d5.style.getPropertyValue('left'), '', 'teardown clears left')
assert(_publishCalled, 'teardown republishes content-lane insets')

// ── Drawer collapse on Weaver open (rising edge) ──
reset()
const d6 = makeDialog('Weaver')
_mockActiveModal = 'weaver'
_secondaryOpen = true
_mainMirrorActive = true
_canvasMainOpen = true
const t6 = startWeaverLane()
await new Promise((r) => setTimeout(r, 40))
assertEqual(_closeSecondaryCalls, 1, 'open weaver closes secondary once')
assertEqual(_closeMainMirrorCalls, 1, 'open weaver closes main-mirror once')
// Poll must not re-close
await new Promise((r) => setTimeout(r, 300))
assertEqual(_closeSecondaryCalls, 1, 'poll does not re-close secondary')
assertEqual(_closeMainMirrorCalls, 1, 'poll does not re-close main')
t6()

// Already-closed drawers: close still gated by is*Open checks
reset()
const d7 = makeDialog('Weaver')
_mockActiveModal = 'weaver'
_secondaryOpen = false
_canvasMainOpen = false
_mainMirrorActive = true
const t7 = startWeaverLane()
await new Promise((r) => setTimeout(r, 40))
assertEqual(_closeSecondaryCalls, 0, 'secondary already closed: no close call')
assertEqual(_closeMainMirrorCalls, 0, 'main already closed: no close call')
t7()

// Second drawer not active / closed — main-mirror still closes main
reset()
const d8 = makeDialog('Weaver')
_mockActiveModal = 'weaver'
_secondaryOpen = false
_mainMirrorActive = true
_canvasMainOpen = true
const t8 = startWeaverLane()
await new Promise((r) => setTimeout(r, 40))
assertEqual(_closeSecondaryCalls, 0, 'second off: no secondary close')
assertEqual(_closeMainMirrorCalls, 1, 'second off + taskbar: still closes main-mirror')
assertEqual(_hostCloseDrawerCalls, 0, 'mirror active: skip host closeDrawer')
t8()

// Second off + taskbar mode off — host store closeDrawer closes main
reset()
const d9 = makeDialog('Weaver')
_mockActiveModal = 'weaver'
_secondaryOpen = false
_mainMirrorActive = false
_canvasMainOpen = false
_hostStoreHasCloseDrawer = true
const t9 = startWeaverLane()
await new Promise((r) => setTimeout(r, 40))
assertEqual(_closeSecondaryCalls, 0, 'host path: no secondary close')
assertEqual(_closeMainMirrorCalls, 0, 'host path: no mirror close')
assertEqual(_hostCloseDrawerCalls, 1, 'second off + no taskbar: host closeDrawer once')
t9()

// ── Summary ──
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
