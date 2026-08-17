// Regression: clicking a tab in the SECONDARY drawer must converge the owned
// model's active.secondary — the persisted secondary.activeTabId follows the
// click, not the stale pre-click key.
//
// The secondary wrapper lives on document.body — OUTSIDE the host sidebar
// subtree the world-changed observers watch — so secondary activations never
// fire a host-sync on their own. The unified choke point is the tracked-
// active writer: setActiveSecondaryTabId (tabs/active-tab.ts) dispatches
// dispatchTrackedActiveSync() (one round converges BOTH drawers), so every
// activation surface — clicks, reopen, placement-with-activation, handoff —
// persists without per-surface wiring. This test drives the REAL click
// handler with a recording dispatch module and asserts the sync fires.

;(globalThis as any).document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: (tag: string) => makeEl(tag),
  documentElement: {
    classList: { add() {}, remove() {}, contains() { return false } },
    style: { setProperty() {}, removeProperty() {}, getPropertyValue() { return '' } },
  },
  body: { appendChild() {}, removeChild() {} },
}
;(globalThis as any).window = {
  matchMedia: () => ({ matches: false }),
  addEventListener: () => {},
  removeEventListener: () => {},
}
;(globalThis as any).requestAnimationFrame = (cb: any) => { cb(1); return 1 }
;(globalThis as any).cancelAnimationFrame = () => {}
;(globalThis as any).CSS = { escape: (s: string) => s }
;(globalThis as any).getComputedStyle = () => ({})

// Minimal DOM element stub covering everything addSecondaryTabButton +
// showSecondaryTab touch in the click path (attrs, classList, style props,
// listeners, children).
function makeEl(tag: string) {
  const el: any = {
    tagName: tag.toUpperCase(),
    children: [] as any[],
    attrs: {} as Record<string, string>,
    classSet: new Set<string>(),
    listeners: {} as Record<string, Array<() => void>>,
    style: {
      cssText: '', color: '', background: '', boxShadow: '', borderRadius: '',
      display: '', opacity: '', height: '', marginTop: '', width: '', flexShrink: '',
    },
    dataset: {} as Record<string, string>,
    innerHTML: '',
    textContent: '',
    parentNode: null,
  }
  el.classList = {
    add: (c: string) => { el.classSet.add(c) },
    remove: (c: string) => { el.classSet.delete(c) },
    contains: (c: string) => el.classSet.has(c),
    toggle: (c: string, force?: boolean) => {
      if (force === undefined) {
        if (el.classSet.has(c)) el.classSet.delete(c)
        else el.classSet.add(c)
      } else if (force) el.classSet.add(c)
      else el.classSet.delete(c)
    },
  }
  el.setAttribute = (k: string, v: string) => { el.attrs[k] = v }
  el.getAttribute = (k: string) => (k in el.attrs ? el.attrs[k] : null)
  el.appendChild = (child: any) => { child.parentNode = el; el.children.push(child); return child }
  el.insertBefore = (child: any, _ref: any) => { child.parentNode = el; el.children.push(child); return child }
  el.remove = () => { el.parentNode = null }
  el.addEventListener = (type: string, fn: () => void) => {
    (el.listeners[type] ??= []).push(fn)
  }
  el.querySelector = () => null
  el.querySelectorAll = (sel: string) =>
    sel.includes('button') ? el.children.filter((c: any) => c.tagName === 'BUTTON') : []
  return el
}

import { mock } from 'bun:test'

// Mock recon/dispatch with a recording dispatchTrackedActiveSync. Must include
// the exports the STATIC import chain needs (tabs/assignment imports
// getModel/getHost; tab-context-menu imports dispatchMoveByLiveId /
// placementFirstMoveByLiveId) or the module load fails.
let syncCount = 0
mock.module('../../recon/dispatch', () => ({
  dispatchTrackedActiveSync: async () => { syncCount++ },
  dispatch: async () => {},
  dispatchBatch: async () => {},
  getModel: () => null,
  getHost: () => null,
  flush: async () => {},
  bootstrap: () => {},
  bootstrapFromLayout: () => {},
  shutdown: () => {},
  dispatchMoveByLiveId: async () => {},
  captureMainMirrorMoveChrome: async () => ({ neighborBtn: null }),
  applyMainMirrorMoveChrome: async () => {},
  captureSecondaryNeighborForMove: async () => ({ neighborBtn: null }),
  applySecondaryNeighborHandoff: async () => {},
  placementFirstMoveByLiveId: async () => {},
}))

// ── Dynamic imports (must be AFTER mock.module calls) ──
const { addSecondaryTabButton } = await import('../buttons')
const { __setSecondaryWrapperForTest, setSecondarySidebarOpen } = await import('../../sidebar/secondary')
const { getActiveSecondaryTabId, setActiveSecondaryTabId } = await import('../active-tab')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ── Custom assertion harness (repo convention) ──
let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual === expected) { passed++ }
  else {
    console.error(`FAIL: ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    failed++
  }
}

// ── The drawer is open, tab 'loom' is NOT the active tab ──
const wrapper = makeEl('div')
const list = makeEl('div')
wrapper.appendChild(list)
wrapper.querySelector = (sel: string) => (sel === '.sidebar-ux-tab-list' ? list : null)
__setSecondaryWrapperForTest(wrapper)
setSecondarySidebarOpen(true)

addSecondaryTabButton({
  id: 'loom',
  title: 'Loom',
  root: makeEl('div'),
})
await sleep(10) // let the dynamic tab-position import settle

const btn = list.children[0]
assert(btn != null, 'click test: secondary tab button was created')
assertEqual(btn.getAttribute('data-tab-id'), 'loom', 'click test: button carries the live id')

// Click the tab → showSecondaryTab → setActiveSecondaryTabId → the unified
// tracked-active sync fires.
btn.listeners.click?.[0]?.()
await sleep(10)

assertEqual(getActiveSecondaryTabId(), 'loom', 'click updates the drawer-tracked active')
assertEqual(syncCount, 1, 'click fires exactly one tracked-active sync')

// Clicking the SAME tab again closes the drawer and must NOT fire another
// sync (no tracked-active change → the model already has the key).
setSecondarySidebarOpen(true) // (close path animation is stubbed away; re-open for the second click)
btn.listeners.click?.[0]?.()
await sleep(10)
assertEqual(syncCount, 1, 're-click of the active tab does not re-sync')

// Same-id re-assert and null clears are handled by the move flows — the
// setter hook must not fire for them (no redundant rounds).
setActiveSecondaryTabId('loom')
await sleep(10)
assertEqual(syncCount, 1, 'same-id re-assert does not re-sync')
setActiveSecondaryTabId(null)
await sleep(10)
assertEqual(syncCount, 1, 'null clear (unassign path) does not fire the sync')

// ── Summary ──
console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
if (failed > 0) process.exit(1)
