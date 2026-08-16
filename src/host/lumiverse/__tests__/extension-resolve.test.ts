// Extension-tab persistence: TabKey ↔ live-id resolution (2026-08-16).
//
// Symptom: after the mode-layout fix, built-in tabs persist their moves /
// reorders across the second-drawer toggle, but EXTENSION tabs (LumiBooks,
// Hone, …) lose their drawer placement and order. The owned-model layout
// profiles serialize via host.resolve(TabKey) → live id and restore via
// host.findKey(live id) → TabKey. If either leg drops an extension tab, its
// placement/order silently vanishes from the saved layout.
//
// This drives the REAL DrawerObserver singleton + REAL LumiverseHost against
// a fake sidebar to find where extension resolution breaks.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else {
    console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    failed++
  }
}

// ── Global DOM stubs (before imports) ──
;(globalThis as any).HTMLElement = class HTMLElement {
  hasAttribute(_n: string) { return false }
  getAttribute(_n: string) { return null }
  setAttribute() {}
  removeAttribute() {}
  querySelectorAll(_s: string) { return [] as any[] }
  textContent: string | null = null
}
let _fakeSidebar: any = null
;(globalThis as any).document = {
  querySelector(sel: string) {
    if (sel === '[data-spindle-mount="sidebar"]') return _fakeSidebar
    return null
  },
  querySelectorAll(_s: string) { return [] },
  documentElement: {
    classList: { contains() { return false }, add() {}, remove() {} },
    style: { setProperty() {}, removeProperty() {}, getPropertyValue() { return '' } },
  },
  body: { querySelector: () => null, appendChild() {}, removeChild() {} },
}
;(globalThis as any).MutationObserver = class MutationObserver {
  constructor(_cb: (m: any[]) => void) {}
  observe() {}
  disconnect() {}
}
;(globalThis as any).CSS = { escape(s: string) { if (s == null) return ''; return s.replace(/([^\w-])/g, '\\$1') } }
;(globalThis as any).getComputedStyle = () => ({ display: '', visibility: '' })
;(globalThis as any).requestAnimationFrame = (cb: any) => { cb(1); return 1 }
;(globalThis as any).cancelAnimationFrame = () => {}

function fakeButton(opts: { tabId?: string; title?: string; ext?: boolean } = {}) {
  const attrs: Record<string, string> = {}
  if (opts.tabId !== undefined) attrs['data-tab-id'] = opts.tabId
  if (opts.title !== undefined) attrs['title'] = opts.title
  const btn = new (globalThis.HTMLElement as any)()
  btn.hasAttribute = (n: string) => n in attrs
  btn.getAttribute = (n: string) => attrs[n] ?? null
  btn.setAttribute = (n: string, v: string) => { attrs[n] = v }
  btn.removeAttribute = (n: string) => { delete attrs[n] }
  btn.textContent = opts.title ?? null
  btn.querySelector = () => null
  btn.className = opts.ext ? '_tabBtn_1 _tabBtnExtension_2' : ''
  return btn
}
function fakeSidebarWithButtons(buttons: any[]) {
  return {
    querySelectorAll: (sel: string) => {
      if (sel === '[data-tab-id]') return buttons
      if (sel.includes('tabBtnExtension')) return buttons
      return []
    },
  }
}

const [{ drawerObserver }] = await Promise.all([import('../../../sidebar/drawer-observer')])
const [{ LumiverseHost }] = await Promise.all([import('../implementation')])

function withInventory(buttons: any[]): void {
  drawerObserver.stop()
  _fakeSidebar = fakeSidebarWithButtons(buttons)
  drawerObserver.start()
}

// ══ Scenario A: UNTAGGED extension tab (title id, extension class) ══
withInventory([fakeButton({ title: 'LumiBooks', ext: true })])
{
  const host = new LumiverseHost()
  const key = host.findKey('LumiBooks')
  assert(key != null, 'A: findKey resolves an untagged extension tab (title id)')
  if (key) {
    const live = host.resolve(key)
    assertEqual(live, 'LumiBooks', 'A: resolve round-trips the untagged extension id')
  }
}

// ══ Scenario B: TAGGED extension tab (real spindle id) ══
withInventory([fakeButton({ tabId: 'spindle:lumi:tab:lumi_books_tab:1', title: 'LumiBooks' })])
{
  const host = new LumiverseHost()
  const key = host.findKey('spindle:lumi:tab:lumi_books_tab:1')
  assertEqual(key, 'ext:lumi/LumiBooks', 'B: findKey maps a tagged extension live id to its ext key')
  if (key) {
    const live = host.resolve(key)
    assertEqual(live, 'spindle:lumi:tab:lumi_books_tab:1', 'B: resolve round-trips a tagged extension key')
  }
}

// ══ Scenario C: THE PERSISTENCE BREAKER — the model key was created while
// the extension tab was UNTAGGED ('builtin:LumiBooks'), then the tab got
// TAGGED and the observer re-keyed to the spindle id. The stale model key
// must still resolve, or serializeModelToLayout drops the tab from the saved
// layout and its move/reorder is lost. ══
withInventory([fakeButton({ tabId: 'spindle:lumi:tab:lumi_books_tab:1', title: 'LumiBooks' })])
{
  const host = new LumiverseHost()
  const live = host.resolve('builtin:LumiBooks')
  assert(live != null, `C: a pre-tag builtin-style key still resolves after tagging (got ${live})`)
}

// ══ Scenario D: extension key whose extensionId the observer reports as
// 'unknown' even after the drawer parsed it — resolve must still find it by
// title (never drop a tab the user placed). ══
withInventory([fakeButton({ tabId: 'spindle:lumi:tab:lumi_books_tab:1', title: 'LumiBooks' })])
{
  const host = new LumiverseHost()
  const live = host.resolve('ext:lumi/LumiBooks')
  assert(live != null, 'D: resolve finds a tagged extension key by title (observer normalization)')
}

// ══ Scenario E: the observer holds the TAGGED entry, but a restore/move
// arrives with the TITLE as the live id (saved layout written while the tab
// was untagged). findKey must still resolve it after re-keying. ══
withInventory([fakeButton({ tabId: 'spindle:lumi:tab:lumi_books_tab:1', title: 'LumiBooks' })])
{
  const host = new LumiverseHost()
  const key = host.findKey('LumiBooks')
  assert(key != null, 'E: findKey resolves a title id against a tagged observer entry (re-key survivor)')
}

// ══ Scenario F: untagged observer entry — an 'ext:unknown/Title' key
// (built from a non-blanked extensionId) must still resolve. ══
withInventory([fakeButton({ title: 'Hone', ext: true })])
{
  const host = new LumiverseHost()
  const live = host.resolve('ext:unknown/Hone')
  assertEqual(live, 'Hone', 'F: resolve normalizes the unknown/blank extensionId (ext:unknown key)')
}

// ══ Round trip: the layout-slot persistence chain (what the mode toggle
// does to extension tabs). Real serializeModelToLayout + buildModelFromLayout
// against the REAL host resolution.
const [{ serializeModelToLayout, buildModelFromLayout }] = await Promise.all([
  import('../../../persist/layout-model'),
])
const [{ builtinKey, createEmptyModel }] = await Promise.all([import('../../../core/model')])
const LOOM = builtinKey('loom')
const WEAVER = builtinKey('weaver')

// G1 — move persistence: model has the extension tab in SECONDARY (key built
// while untagged: 'builtin:Hone'), the observer is now TAGGED. The serialized
// slot must restore the tab into secondary (symptom: "move doesn't persist").
withInventory([
  fakeButton({ tabId: 'loom', title: 'loom' }),
  fakeButton({ tabId: 'weaver', title: 'weaver' }),
  fakeButton({ tabId: 'spindle:hone:tab:hone_tab:1', title: 'Hone' }),
])
{
  const host = new LumiverseHost()
  const model = {
    ...createEmptyModel(),
    primary: [LOOM, WEAVER],
    secondary: [builtinKey('Hone')],
    active: { primary: LOOM, secondary: null },
  }
  const layout = serializeModelToLayout(model, (k) => host.resolve(k), 't')
  assert((layout.detachedTabs ?? []).some((d) => d.tabId.includes('spindle:hone')),
    `G1: serialized layout carries the tagged extension live id (got ${JSON.stringify((layout.detachedTabs ?? []).map(d => d.tabId))})`)
  const restored = buildModelFromLayout(layout, (id) => host.findKey(id))
  assert(restored.secondary.some((k) => k === 'ext:hone/Hone' || k === builtinKey('Hone')),
    `G1: restore puts the extension tab back in secondary (got ${JSON.stringify(restored.secondary)})`)
}

// G2 — order persistence: the extension tab sits at a specific PRIMARY index;
// the round trip must preserve its position (symptom: "reorder doesn't
// persist").
withInventory([
  fakeButton({ tabId: 'loom', title: 'loom' }),
  fakeButton({ tabId: 'weaver', title: 'weaver' }),
  fakeButton({ tabId: 'spindle:hone:tab:hone_tab:1', title: 'Hone' }),
])
{
  const host = new LumiverseHost()
  const model = {
    ...createEmptyModel(),
    primary: [LOOM, builtinKey('Hone'), WEAVER],
    secondary: [],
    active: { primary: LOOM, secondary: null },
  }
  const layout = serializeModelToLayout(model, (k) => host.resolve(k), 't')
  assertEqual(layout.tabOrder?.[1], 'spindle:hone:tab:hone_tab:1', 'G2: serialized tabOrder keeps the extension tab at index 1')
  const restored = buildModelFromLayout(layout, (id) => host.findKey(id))
  assert(restored.primary[0] === LOOM && restored.primary[2] === WEAVER,
    `G2: restore keeps the neighbors at their slots (got ${JSON.stringify(restored.primary)})`)
  assert(restored.primary[1] !== undefined, 'G2: extension tab restored at index 1 (order preserved)')
}

console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
if (failed > 0) process.exit(1)

// Force module mode for TS (the bun:test import may resolve to ambient
// types in some setups).
export {}
