// Regression: clicking a tab in the SECONDARY drawer must converge the owned
// model's active.secondary — the persisted secondary.activeTabId follows the
// click, not the stale pre-click key.
//
// The secondary wrapper lives on document.body — OUTSIDE the host sidebar
// subtree the world-changed observers watch — so secondary clicks never fire
// a host-sync (the mechanism that keeps the primary side converged via
// applySyncFromHost's adoptActive). The drawer-tracked active updates, but
// the model lags, and serializeModelToLayout writes the STALE key to
// layout.json: after a hard refresh the OLD tab comes back active. The click
// handler dispatches an explicit activate intent (dispatchActivateByLiveId)
// so the model — and the persisted value — follows the clicked tab.

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

// Mock recon/dispatch with a recording dispatchActivateByLiveId. Must include
// the exports the STATIC import chain needs (tabs/assignment imports
// getModel/getHost; tab-context-menu imports dispatchMoveByLiveId /
// placementFirstMoveByLiveId) or the module load fails.
const activated: Array<{ liveId: string; side: string }> = []
mock.module('../../recon/dispatch', () => ({
  dispatchActivateByLiveId: async (liveId: string, side: string) => { activated.push({ liveId, side }) },
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

// tab-position's reconcileTabListPin runs at the end of addSecondaryTabButton;
// its DOM calls are null-tolerant in this stub env (same as buttons.test.ts),
// so the real module is used — only recon/dispatch is mocked.

// ── Dynamic imports (must be AFTER mock.module calls) ──
const { addSecondaryTabButton } = await import('../buttons')
const { __setSecondaryWrapperForTest, setSecondarySidebarOpen } = await import('../../sidebar/secondary')
const { getActiveSecondaryTabId } = await import('../active-tab')

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

// Click the tab → showSecondaryTab + persistSecondaryTabActivation.
btn.listeners.click?.[0]?.()
await sleep(10)

assertEqual(getActiveSecondaryTabId(), 'loom', 'click updates the drawer-tracked active')
assertEqual(activated.length, 1, 'click dispatches exactly one activate intent')
assertEqual(activated[0]?.liveId, 'loom', 'activate intent carries the clicked tab live id')
assertEqual(activated[0]?.side, 'secondary', 'activate intent targets the secondary side')

// Clicking the SAME tab again closes the drawer and must NOT dispatch
// another activate (the model already has the key — no redundant round).
setSecondarySidebarOpen(true) // (close path animation is stubbed away; re-open for the second click)
btn.listeners.click?.[0]?.()
await sleep(10)
assertEqual(activated.length, 1, 're-click of the active tab does not re-dispatch activate')

// ── Summary ──
console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
if (failed > 0) process.exit(1)
