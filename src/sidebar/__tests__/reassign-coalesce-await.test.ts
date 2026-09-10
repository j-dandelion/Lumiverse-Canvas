// Reassign drain promise contract — live-verify #5 (2026-09-10).
//
// When the second drawer is enabled mid-session, `requestSecondDrawerMode`
// holds the visual reveal guard and awaits `bootPlacementDone()` before
// releasing it. The boot placement pass awaits
// `reassignSecondaryTabsFromModel`, but the mount-open echo
// (openSecondarySidebar BAIL → reassign) usually starts a placement loop
// FIRST — so the boot pass's call was coalesced to `Promise.resolve()`
// (old code) and `bootPlacementDone()` resolved while the serial loop was
// still appending secondary tab buttons. The hold lifted mid-loop and the
// tabs visibly popped in one by one.
//
// These tests drive the REAL `reassignSecondaryTabsFromModel` with a gated
// `assignToSecondary` mock and pin the fixed contract:
//   - a coalesced call returns a waiter that does NOT resolve while the
//     in-flight placement is pending (the old code resolved immediately);
//   - it resolves only after the whole drain (run + trailing rerun) settles;
//   - the queued call's opts (quiet flags + `activateKey`) are merged into
//     the trailing rerun instead of being dropped.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed++ }
}

// ── Minimal DOM stubs (secondary-open-active.test.ts pattern — the real
//    import graph loads drawer-sync / tab-position / main-mirror-drawer / store) ──

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
const assignCalls: Array<{ id: string; opts: any }> = []
/** Set per test; called by the mocked assignToSecondary. */
let assignImpl: ((id: string, opts?: any) => Promise<void>) | null = null

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
  assignToSecondary: (id: string, opts?: any) =>
    assignImpl ? assignImpl(id, opts) : Promise.resolve(),
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
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

function setupEmptyList(): StubElement {
  const wrapper = new StubElement()
  const list = new StubElement()
  const buttons: StubElement[] = []
  ;(list as any)._buttons = buttons
  list.className = 'sidebar-ux-tab-list'
  ;(wrapper as any)._tabList = list
  __setSecondaryWrapperForTest(wrapper as any)
  return wrapper
}

function resetState(): void {
  activated.length = 0
  assignCalls.length = 0
  assignImpl = null
  deleteTabAssignment('ext:ext:a/A')
  deleteTabAssignment('ext:ext:b/B')
  setActiveSecondaryTabId(null)
  setSecondarySidebarOpen(false)
  __setSecondaryWrapperForTest(null)
}

// ══ C1: a coalesced call must await the whole drain — not `Promise.resolve()` ══
{
  resetState()
  setTabAssignment('ext:ext:a/A', 'secondary')
  setTabAssignment('ext:ext:b/B', 'secondary')
  setupEmptyList()
  setSecondarySidebarOpen(true)

  // Gate placement so the first run is in flight when the second call lands.
  let releaseGate!: () => void
  const gate = new Promise<void>((resolve) => { releaseGate = resolve })
  assignImpl = async (id, opts) => {
    assignCalls.push({ id, opts })
    await gate
  }

  const p1 = reassignSecondaryTabsFromModel()
  // Let the dynamic import resolve + the first loop iteration reach the gate.
  await tick()
  await tick()
  assertEqual(assignCalls.length, 1, 'C1: first run reached the gated assignment')
  assertEqual(assignCalls[0]!.id, 'h:a', 'C1: first placement is h:a')

  // Overlapping call (the boot placement pass) with its quiet boot opts.
  const p2 = reassignSecondaryTabsFromModel({
    openOnClosed: false,
    setActiveWhenReady: false,
    activateKey: 'ext:ext:b/B',
  })

  let p1Resolved = false
  let p2Resolved = false
  p1.then(() => { p1Resolved = true })
  p2.then(() => { p2Resolved = true })
  await tick()
  await tick()
  assertEqual(p1Resolved, false, 'C1: drain still pending while placement gated')
  assertEqual(p2Resolved, false, 'C1: coalesced call does NOT resolve immediately (regression pin)')

  releaseGate()
  await p1
  assertEqual(p1Resolved, true, 'C1: drain promise resolved')
  assertEqual(p2Resolved, true, 'C1: coalesced waiter resolved with the drain')

  // Run 1 placed a+b (2 calls); the trailing rerun re-ran the loop because the
  // list has no buttons (mock does not add them) → 2 more calls with the MERGED
  // opts. The rerun is the signal that the queued caller's opts were honored.
  assertEqual(assignCalls.length, 4, 'C1: trailing rerun ran after the first run')
  const rerunOpts = assignCalls[2]!.opts
  assert(rerunOpts != null, 'C1: rerun received the merged opts')
  assertEqual(rerunOpts?.openOnClosed, false, 'C1: merged opts keep quiet openOnClosed=false')
  assertEqual(rerunOpts?.setActiveWhenReady, false, 'C1: merged opts keep quiet setActiveWhenReady=false')
  assertEqual(rerunOpts?.activateKey, 'ext:ext:b/B', 'C1: merged opts keep the boot activateKey')
  // Run 1's tail used no activateKey → first placed tab; the rerun's tail must
  // use the merged key → h:b last. Proves the key survives coalescing.
  assertEqual(activated.join(','), 'h:a,h:b', 'C1: rerun tail activates the merged activateKey target')
}

// ══ C2: after the drain settles, a fresh call starts a NEW drain (no stale gate) ══
{
  resetState()
  setTabAssignment('ext:ext:a/A', 'secondary')
  setTabAssignment('ext:ext:b/B', 'secondary')
  setupEmptyList()
  setSecondarySidebarOpen(true)
  assignImpl = async (id, opts) => { assignCalls.push({ id, opts }) }

  await reassignSecondaryTabsFromModel()
  assertEqual(assignCalls.length, 2, 'C2: fresh drain ran the placement loop')

  await reassignSecondaryTabsFromModel()
  assertEqual(assignCalls.length, 4, 'C2: subsequent call is not swallowed by a wedged drain flag')
}

// ══ C3: a throwing placement is absorbed and does not wedge the drain ══
{
  resetState()
  setTabAssignment('ext:ext:a/A', 'secondary')
  setTabAssignment('ext:ext:b/B', 'secondary')
  setupEmptyList()
  setSecondarySidebarOpen(true)

  let failNext = true
  assignImpl = async (id, opts) => {
    assignCalls.push({ id, opts })
    if (failNext) { failNext = false; throw new Error('boom') }
  }

  await reassignSecondaryTabsFromModel()
  const callsAfterFirst = assignCalls.length
  assert(callsAfterFirst >= 2, 'C3: first drain ran the loop despite a placement throw')

  await reassignSecondaryTabsFromModel()
  assert(assignCalls.length > callsAfterFirst, 'C3: next drain runs after a throwing placement')
}

resetState()

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
