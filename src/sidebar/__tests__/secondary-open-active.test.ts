// Reassign tails must read the TRACKED active (2026-09): clicking a
// pinned-strip tab while the drawer is closed writes only the tracked cell
// (tabs/active-tab.ts) — the state-machine cell (secondary-drawer
// `_activeTabId`) is not updated by the click path. The empty-content
// restore tails in reassignSecondaryTabsFromModel previously guarded on the
// STATE-MACHINE cell, so after the active tab was moved out (cell nulled),
// clicking another pinned tab made the tail auto-activate the FIRST placed
// tab instead of the clicked one.
//
// These tests drive the REAL reassignSecondaryTabsFromModel with
// module-mocked drawer-observer + secondary-drawer (activation captured)
// and assert the tails no-op when the tracked cell holds the user's click.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed++ }
}

// ── Minimal DOM stubs (main-tab-pin.test.ts pattern — the real import
//    graph loads drawer-sync / tab-position / main-mirror-drawer / store) ──

class StubStyle {
  private _props: Record<string, string> = {}
  setProperty(k: string, v: string, _p?: string) { this._props[k] = v }
  getPropertyValue(k: string) { return this._props[k] ?? '' }
  removeProperty(k: string) { delete this._props[k] }
  get cssText() { return '' }
  set cssText(v: string) { /* ignore */ }
}

class StubElement {
  style = new StubStyle()
  className = ''
  tagName = 'DIV'
  innerHTML = ''
  type = ''
  dataset: Record<string, string> = {}
  parentElement: StubElement | null = null
  children: StubElement[] = []
  nextSibling: StubElement | null = null
  firstChild: StubElement | null = null
  childNodes: StubElement[] = []
  isConnected = true
  private _classSet = new Set<string>()
  private _attrs: Record<string, string> = {}
  classList = {
    add: (c: string) => { this._classSet.add(c); this.className = Array.from(this._classSet).join(' ') },
    remove: (c: string) => { this._classSet.delete(c); this.className = Array.from(this._classSet).join(' ') },
    contains: (c: string) => this._classSet.has(c),
    toggle: (c: string, force?: boolean) => {
      const on = force === undefined ? !this._classSet.has(c) : force
      if (on) this.classList.add(c); else this.classList.remove(c)
      return on
    },
    toString: () => this.className,
  }
  setAttribute(k: string, v: string) {
    this._attrs[k] = v
    if (k.startsWith('data-') && k.length > 5) {
      const camel = k.slice(5).replace(/-([a-z])/g, (_m: string, c: string) => c.toUpperCase())
      this.dataset[camel] = v
    }
  }
  getAttribute(k: string) { return this._attrs[k] ?? null }
  removeAttribute(k: string) {
    delete this._attrs[k]
    if (k.startsWith('data-') && k.length > 5) {
      const camel = k.slice(5).replace(/-([a-z])/g, (_m: string, c: string) => c.toUpperCase())
      delete this.dataset[camel]
    }
  }
  closest(_sel: string): StubElement | null { return null }
  querySelector(sel: string): StubElement | null {
    if (sel === '.sidebar-ux-tab-list' && this._tabList) return this._tabList
    if (sel === '.sidebar-ux-panel-content' && this._panelContent) return this._panelContent
    return null
  }
  querySelectorAll(sel: string): StubElement[] {
    if (sel === 'button[data-tab-id]' && this._tabList) return this._tabList._buttons
    return []
  }
  addEventListener(_t: string, _f: Function) {}
  removeEventListener(_t: string, _f: Function) {}
  click() { this._clickCount = (this._clickCount ?? 0) + 1 }
  remove() { if (this.parentElement) this.parentElement.removeChild(this) }
  removeChild(child: StubElement) {
    this.children = this.children.filter((c) => c !== child)
    this.childNodes = this.children
    this.firstChild = this.children[0] ?? null
    child.parentElement = null
    return child
  }
  appendChild(child: StubElement) {
    if (child.parentElement) child.parentElement.removeChild(child)
    this.children.push(child)
    this.childNodes = this.children
    this.firstChild = this.children[0] ?? null
    child.parentElement = this
    return child
  }
  insertBefore(child: StubElement, _ref: StubElement | null) { return this.appendChild(child) }
  getBoundingClientRect() { return { width: 420, height: 800, top: 0, left: 0, right: 420, bottom: 800 } }
  // Test wiring
  _tabList: { _buttons: StubElement[]; querySelectorAll(sel: string): StubElement[]; className: string } | null = null
  _panelContent: StubElement | null = null
}

function makeTabButton(id: string): StubElement {
  const btn = new StubElement()
  btn.tagName = 'BUTTON'
  btn.setAttribute('data-tab-id', id)
  return btn
}

const bodyStub = new StubElement()
const headStub = new StubElement()
const docElStub = new StubElement()
;(globalThis as any).document = {
  body: bodyStub,
  head: headStub,
  documentElement: docElStub,
  getElementById(_id: string) { return null },
  createElement(_tag: string) { return new StubElement() },
  querySelector(_sel: string) { return null },
  querySelectorAll(_sel: string) { return [] },
}
;(globalThis as any).window = {
  innerWidth: 1280,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame: (cb: any) => { queueMicrotask(() => cb(1)); return 1 },
  cancelAnimationFrame() {},
}
;(globalThis as any).requestAnimationFrame = (cb: any) => { queueMicrotask(() => cb(1)); return 1 }
;(globalThis as any).cancelAnimationFrame = () => {}
;(globalThis as any).MutationObserver = class { observe() {} disconnect() {} }
;(globalThis as any).ResizeObserver = class { observe() {} disconnect() {} }
;(globalThis as any).CSS = { escape: (s: string) => s }
;(globalThis as any).getComputedStyle = () => ({})
;(globalThis as any).MouseEvent = class {}

import { mock } from 'bun:test'

const activated: string[] = []
mock.module('../../sidebar/drawer-observer', () => ({
  drawerObserver: {
    getAllTabs: () => [
      { tabId: 'h:a', extensionId: 'ext:a', title: 'A' },
      { tabId: 'h:b', extensionId: 'ext:b', title: 'B' },
    ],
    getTab: () => null,
    start: () => {},
    onTabRegistered: () => () => {},
    onTabUnregistered: () => () => {},
    reset: () => {},
  },
}))

mock.module('../../sidebar/secondary-drawer', () => ({
  setSuppressAutoActivation: () => {},
  isSuppressAutoActivation: () => false,
  markDrawerOpenState: () => {},
  initSecondaryDrawer: () => {},
  teardownSecondaryDrawer: () => {},
  assignToSecondary: async () => {},
  unassignFromSecondary: async () => {},
  activateSecondaryTab: (id: string) => { activated.push(id) },
  getActiveSecondaryTab: () => null,
  getSecondaryDrawerState: () => 'tab_active',
  setRestoringFromLayout: () => {},
  isRestoringFromLayout: () => false,
}))

const mod = await import('../secondary')
const { reassignSecondaryTabsFromModel, __setSecondaryWrapperForTest, setSecondarySidebarOpen } = mod
const { setTabAssignment, deleteTabAssignment } = await import('../../tabs/assignment')
const { setActiveSecondaryTabId } = await import('../../tabs/active-tab')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function settle(): Promise<void> {
  await sleep(10)
  await sleep(10)
}

function setupList(buttonIds: string[]): StubElement {
  const wrapper = new StubElement()
  const list = new StubElement()
  const buttons = buttonIds.map(makeTabButton)
  ;(list as any)._buttons = buttons
  list.className = 'sidebar-ux-tab-list'
  ;(wrapper as any)._tabList = list
  __setSecondaryWrapperForTest(wrapper as any)
  return wrapper
}

function resetState(): void {
  activated.length = 0
  deleteTabAssignment('ext:ext:a/A')
  deleteTabAssignment('ext:ext:b/B')
  setActiveSecondaryTabId(null)
  setSecondarySidebarOpen(false)
  __setSecondaryWrapperForTest(null)
}

// ── T1: all-placed branch — tracked click wins, no auto-activation ──
{
  resetState()
  setTabAssignment('ext:ext:a/A', 'secondary')
  setTabAssignment('ext:ext:b/B', 'secondary')
  setupList(['h:a', 'h:b'])
  setSecondarySidebarOpen(true)
  // The user clicked pinned tab 'h:a' (tracked cell only).
  setActiveSecondaryTabId('h:a', { silent: true })

  reassignSecondaryTabsFromModel()
  await settle()

  assertEqual(activated.length, 0, 'T1: no auto-activation over the clicked tab')
}

// ── T2: all-placed branch — no tracked (restore/empty) → first-list fallback ──
{
  resetState()
  setTabAssignment('ext:ext:a/A', 'secondary')
  setTabAssignment('ext:ext:b/B', 'secondary')
  setupList(['h:a', 'h:b'])
  setSecondarySidebarOpen(true)
  setActiveSecondaryTabId(null)

  reassignSecondaryTabsFromModel()
  await settle()

  assertEqual(activated.length, 1, 'T2: fallback fired once')
  assertEqual(activated[0], 'h:a', 'T2: fallback activates first list tab')
}

// ── T3: placement-loop branch — tracked click wins, no auto-activation ──
{
  resetState()
  setTabAssignment('ext:ext:a/A', 'secondary')
  setTabAssignment('ext:ext:b/B', 'secondary')
  // Only one button placed → the placement loop runs for the second tab.
  setupList(['h:a'])
  setSecondarySidebarOpen(true)
  setActiveSecondaryTabId('h:b', { silent: true })

  reassignSecondaryTabsFromModel()
  await settle()

  assertEqual(activated.length, 0, 'T3: loop tail does not overwrite the clicked tab')
}

// ── T4: placement-loop branch — no tracked → first-placed fallback ──
{
  resetState()
  setTabAssignment('ext:ext:a/A', 'secondary')
  setTabAssignment('ext:ext:b/B', 'secondary')
  setupList(['h:a'])
  setSecondarySidebarOpen(true)
  setActiveSecondaryTabId(null)

  reassignSecondaryTabsFromModel()
  await settle()

  assertEqual(activated.length, 1, 'T4: fallback fired once')
  assertEqual(activated[0], 'h:a', 'T4: fallback activates first placed tab')
}

// ── B1: boot restore (activateKey) — tracked pre-seeded by the model→chrome
//    echo, but no root is displayed; the tail must STILL show the persisted
//    active. (d908d53 boot-empty regression: the tracked guard made the tail
//    skip, so every placed root stayed display:none → black open drawer.) ──
{
  resetState()
  setTabAssignment('ext:ext:a/A', 'secondary')
  setTabAssignment('ext:ext:b/B', 'secondary')
  setupList(['h:a', 'h:b'])
  setSecondarySidebarOpen(true)
  // The boot reconcile echo seeds tracked with the persisted active BEFORE
  // placement (no root existed yet — nothing was ever displayed).
  setActiveSecondaryTabId('h:a', { silent: true })

  reassignSecondaryTabsFromModel({ activateKey: 'ext:ext:a/A' })
  await settle()

  assertEqual(activated.length, 1, 'B1: boot tail fires despite seeded tracked')
  assertEqual(activated[0], 'h:a', 'B1: shows the persisted active')
}

// ── B2: boot restore, placement-loop branch — same as B1 but the active tab's
//    button is placed by the loop (not pre-existing in the list). ──
{
  resetState()
  setTabAssignment('ext:ext:a/A', 'secondary')
  setTabAssignment('ext:ext:b/B', 'secondary')
  setupList(['h:a']) // h:b not placed yet → placement loop runs
  setSecondarySidebarOpen(true)
  setActiveSecondaryTabId('h:b', { silent: true }) // echo seeded b pre-placement

  reassignSecondaryTabsFromModel({ activateKey: 'ext:ext:b/B' })
  await settle()

  assertEqual(activated.length, 1, 'B2: loop tail fires over seeded tracked')
  assertEqual(activated[0], 'h:b', 'B2: activates the persisted active, not first')
}

resetState()

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)