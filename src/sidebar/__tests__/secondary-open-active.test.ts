// Reassign tails use DISPLAY TRUTH (2026-09): the tracked active
// (tabs/active-tab.ts) is intent-memory — the boot model→chrome echo seeds
// it with the persisted active even when the drawer was closed and no root
// was ever displayed. Guarding the empty-content tails on `tracked === null`
// made "close secondary → refresh → open" skip activation: no root gained
// data-canvas-active → empty panel + no highlight. A real pinned-strip click
// runs showSecondaryTab, which sets data-canvas-active on the root, so
// `secondaryHasDisplayedRoot()` preserves the click and only fires the tail
// when nothing is displayed. The target is the tracked/boot-restore tab
// (fallback: first placed), never an arbitrary first tab.
//
// These tests drive the REAL reassignSecondaryTabsFromModel with
// module-mocked drawer-observer + secondary-drawer (activation captured).

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
    if (sel === '[data-canvas-moved][data-canvas-active]') {
      // secondaryHasDisplayedRoot() probes the panel content for a displayed
      // moved root — walk the stub tree for both attributes.
      const walk = (n: StubElement): StubElement | null => {
        if (n.getAttribute('data-canvas-moved') !== null && n.getAttribute('data-canvas-active') !== null) return n
        for (const c of n.children) { const hit = walk(c); if (hit) return hit }
        return null
      }
      for (const c of this.children) { const hit = walk(c); if (hit) return hit }
    }
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
  const content = new StubElement()
  content.className = 'sidebar-ux-panel-content'
  ;(wrapper as any)._panelContent = content
  __setSecondaryWrapperForTest(wrapper as any)
  return wrapper
}

/** Mark a placed root as displayed (showSecondaryTab sets both attrs). */
function displayRoot(wrapper: StubElement, id: string): void {
  const content = (wrapper as any)._panelContent as StubElement
  const root = new StubElement()
  root.setAttribute('data-canvas-moved', id)
  root.setAttribute('data-canvas-active', '')
  content.appendChild(root)
}

function resetState(): void {
  activated.length = 0
  deleteTabAssignment('ext:ext:a/A')
  deleteTabAssignment('ext:ext:b/B')
  setActiveSecondaryTabId(null)
  setSecondarySidebarOpen(false)
  __setSecondaryWrapperForTest(null)
}

// ── T1: all-placed branch — a DISPLAYED pinned click is preserved ──
{
  resetState()
  setTabAssignment('ext:ext:a/A', 'secondary')
  setTabAssignment('ext:ext:b/B', 'secondary')
  const wrapper = setupList(['h:a', 'h:b'])
  setSecondarySidebarOpen(true)
  // The user clicked pinned tab 'h:a': showSecondaryTab displayed its root.
  displayRoot(wrapper, 'h:a')
  setActiveSecondaryTabId('h:a', { silent: true })

  reassignSecondaryTabsFromModel()
  await settle()

  assertEqual(activated.length, 0, 'T1: no auto-activation over the displayed clicked tab')
}

// ── T1b: all-placed branch — echo-seeded tracked + NOTHING displayed
//    ("close secondary → refresh → open") → show the tracked tab ──
{
  resetState()
  setTabAssignment('ext:ext:a/A', 'secondary')
  setTabAssignment('ext:ext:b/B', 'secondary')
  setupList(['h:a', 'h:b'])
  setSecondarySidebarOpen(true)
  // The boot reconcile echo seeded tracked while the drawer was closed; no
  // root was ever displayed.
  setActiveSecondaryTabId('h:b', { silent: true })

  reassignSecondaryTabsFromModel()
  await settle()

  assertEqual(activated.length, 1, 'T1b: tail fires when nothing is displayed')
  assertEqual(activated[0], 'h:b', 'T1b: shows the tracked tab, not the first')
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

// ── T3: placement-loop branch — a DISPLAYED pinned click is preserved ──
{
  resetState()
  setTabAssignment('ext:ext:a/A', 'secondary')
  setTabAssignment('ext:ext:b/B', 'secondary')
  // Only one button placed → the placement loop runs for the second tab.
  const wrapper = setupList(['h:a'])
  setSecondarySidebarOpen(true)
  displayRoot(wrapper, 'h:b')
  setActiveSecondaryTabId('h:b', { silent: true })

  reassignSecondaryTabsFromModel()
  await settle()

  assertEqual(activated.length, 0, 'T3: loop tail does not overwrite the displayed clicked tab')
}

// ── T3b: placement-loop branch — echo-seeded tracked + nothing displayed →
//    activate the tracked tab (not the first placed) ──
{
  resetState()
  setTabAssignment('ext:ext:a/A', 'secondary')
  setTabAssignment('ext:ext:b/B', 'secondary')
  setupList(['h:a']) // h:b not placed yet → placement loop runs
  setSecondarySidebarOpen(true)
  setActiveSecondaryTabId('h:b', { silent: true })

  reassignSecondaryTabsFromModel()
  await settle()

  assertEqual(activated.length, 1, 'T3b: loop tail fires when nothing is displayed')
  assertEqual(activated[0], 'h:b', 'T3b: activates the tracked tab, not the first placed')
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