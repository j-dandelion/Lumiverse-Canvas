// LUMI-29 ghost-tab regression tests.
//
// Bug: turning off an extension that owns a tab (e.g. Palette) left a ghost
// strip button in Canvas — label only, no icon; click and right-click were
// no-ops. Root cause: `LumiverseHost.observe()` synthesizes assignment
// entries for model keys missing from the live inventory, and the synthesis
// re-fed the dead key into `applySyncFromHost` forever — the model kept the
// tab, every surface kept rendering it, and persistence kept saving it.
//
// Fix under test:
//   1. observe() gives a missing EXTENSION key a grace window (transient
//      host re-renders never expire it); past the window the key is no
//      longer synthesized, so the authoritative host-sync drops it from the
//      model. Built-ins keep the synthesis lifeline (DOM-placed built-ins
//      legitimately have no live button).
//   2. tabs/ghost-tabs.ts sweeps the Canvas-OWNED secondary strip button
//      when a model commit drops its facade key (the liveId no longer
//      resolves, so id-based removal can never find it).

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { failed++; console.error(`FAIL: ${msg} — expected ${String(expected)}, got ${String(actual)}`) }
}

// ── Global DOM stubs (before imports) ──
const _classes = new Set<string>()
const _styles = new Map<string, string>()
;(globalThis as any).HTMLElement = class HTMLElement {
  isConnected = true
  hasAttribute(_n: string) { return false }
  getAttribute(_n: string) { return null }
  setAttribute() {}
  removeAttribute() {}
  querySelector(_s: string) { return null }
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
    classList: {
      contains(c: string) { return _classes.has(c) },
      add(c: string) { _classes.add(c) },
      remove(c: string) { _classes.delete(c) },
    },
    style: {
      getPropertyValue(k: string) { return _styles.get(k) ?? '' },
      setProperty(k: string, v: string) { _styles.set(k, v) },
      removeProperty(k: string) { _styles.delete(k) },
    },
  },
  body: { querySelector: () => null, querySelectorAll: () => [], appendChild() {}, removeChild() {} },
}
;(globalThis as any).window = {
  matchMedia: () => ({ matches: false }),
  addEventListener: () => {},
  removeEventListener: () => {},
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

// Shiftable clock for the grace window.
const _realNow = Date.now
let _nowOffset = 0
;(globalThis as any).Date = class extends Array {
  static now() { return _realNow() + _nowOffset }
}

const GHOST_KEY = 'ext:ghost/Ghost'
const ALIVE_KEY = 'ext:palette/Palette'

function makeTaggedExtButton(id: string, title: string): any {
  const btn: any = new (globalThis as any).HTMLElement()
  btn.attrs = {} as Record<string, string>
  btn.getAttribute = (k: string) => (k in btn.attrs ? btn.attrs[k] : null)
  btn.setAttribute = (k: string, v: string) => { btn.attrs[k] = v }
  btn.className = 'tabBtnExtension some-host-class'
  btn.attrs['data-tab-id'] = id
  btn.attrs['title'] = title
  return btn
}

// Sidebar exposing a configurable button list to the DrawerObserver scan.
function setSidebarButtons(buttons: any[]): void {
  _fakeSidebar = new (globalThis as any).HTMLElement()
  _fakeSidebar.querySelectorAll = (_sel: string) => buttons
}

import { extensionKey } from '../../../core/model'
import { setTabAssignment, getTabAssignments } from '../../../tabs/assignment'
const { setCanvasHiddenTabIds, __resetCanvasHiddenTabIdsForTest } = await import('../../../tabs/canvas-hidden')
const { setActiveSecondaryTabId } = await import('../../../tabs/active-tab')

const [{ LumiverseHost }] = await Promise.all([import('../implementation')])
import { drawerObserver } from '../../../sidebar/drawer-observer'

// ── G1/G2/G4: the observe() ghost grace ──
{
  // One ALIVE extension tab in the host sidebar; one DEAD extension key that
  // only the facade (legacy pre-model map) knows about.
  const aliveBtn = makeTaggedExtButton('spindle:palette:tab:main:0', 'Palette')
  setSidebarButtons([aliveBtn])
  drawerObserver.start()
  setTabAssignment(ALIVE_KEY, 'primary')
  setTabAssignment(GHOST_KEY, 'primary')
  setCanvasHiddenTabIds(['spindle:ghost:tab:main:0'])

  const host = new LumiverseHost()

  // G1: first absence arms the tracker — the entry is still synthesized
  // (transient re-render protection) alongside the live inventory entry.
  const obs1 = host.observe()
  const keys1 = obs1.tabs.map(t => t.key)
  assert(keys1.includes(GHOST_KEY), 'G1a: missing extension key synthesized within grace')
  assert(keys1.includes(ALIVE_KEY), 'G1b: live extension key present')
  assertEqual(
    obs1.tabs.find(t => t.key === GHOST_KEY)?.isHidden,
    false,
    'G1d: unresolved extension stays unhidden during ghost grace',
  )
  assertEqual(obs1.inventory?.status, 'ready', 'G1c: inventory ready (one live tab)')

  // G4: the tab comes back (extension re-enabled / re-render re-add) — the
  // absence state must clear; the live entry wins, no duplicate synthesis.
  setSidebarButtons([aliveBtn])
  const obsBack = host.observe()
  assertEqual(
    obsBack.tabs.filter(t => t.key === ALIVE_KEY).length, 1,
    'G4a: returned tab appears exactly once (live entry, not synthesized)',
  )
  assert(keys1.includes(GHOST_KEY), 'G4b: (pre-state) ghost still within grace')

  // The tab dies again: re-arms, still within grace → synthesized.
  setSidebarButtons([])
  const obs2 = host.observe()
  assert(obs2.tabs.map(t => t.key).includes(GHOST_KEY), 'G4c: re-armed absence still synthesized within grace')

  // G2: past the grace window the synthesis stops — the observed world no
  // longer carries the dead key, so applySyncFromHost drops it from the
  // model. The live tab is untouched.
  _nowOffset = 11_000
  const obs3 = host.observe()
  const keys3 = obs3.tabs.map(t => t.key)
  assert(!keys3.includes(GHOST_KEY), 'G2a: dead extension key dropped past grace')
  assert(keys3.includes(ALIVE_KEY), 'G2b: live extension key survives the grace round')

  // Grace expiry is sustained absence, not a single clock jump: a fresh
  // absence starts a NEW window (regression guard for re-arm loops).
  _nowOffset = 0
  setSidebarButtons([aliveBtn])
  host.observe() // alive again → tracker forgets
  setSidebarButtons([])
  _nowOffset = 0
  const obs4 = host.observe() // re-arms at t=0
  assert(obs4.tabs.map(t => t.key).includes(GHOST_KEY), 'G2c: fresh absence synthesized again (new window)')
  _nowOffset = 5_000
  assert(
    host.observe().tabs.map(t => t.key).includes(GHOST_KEY),
    'G2d: absence of 5s < grace → still synthesized',
  )
  _nowOffset = 11_000
  assert(
    !host.observe().tabs.map(t => t.key).includes(GHOST_KEY),
    'G2e: absence of 11s ≥ grace → dropped',
  )
  _nowOffset = 0
  __resetCanvasHiddenTabIdsForTest()
}

// ── G3: built-ins are never ghost-purged ──
{
  setSidebarButtons([]) // no live tabs at all
  setTabAssignment('builtin:ghostpanel', 'primary')
  const host = new LumiverseHost()
  const obs1 = host.observe()
  assert(
    obs1.tabs.map(t => t.key).includes('builtin:ghostpanel'),
    'G3a: builtin key synthesized (synthesis lifeline)',
  )
  _nowOffset = 60_000
  const obs2 = host.observe()
  assert(
    obs2.tabs.map(t => t.key).includes('builtin:ghostpanel'),
    'G3b: builtin key NEVER expires — DOM-placed built-ins have no live button by design',
  )

  const key = 'builtin:ghostpanel'
  setTabAssignment(key, 'secondary')
  setCanvasHiddenTabIds(['ghostpanel'])
  setActiveSecondaryTabId('ghostpanel', { silent: true })
  const observed = host.observe()
  const entry = observed.tabs.find(t => t.key === key)
  assertEqual(entry?.isHidden, true, 'G3c: synthesized builtin observes its live-ID hidden state')
  assertEqual(entry?.isActiveInSecondary, true, 'G3d: synthesized builtin observes its secondary active state')

  const { createEmptyModel } = await import('../../../core/model')
  const { reconcile, resetEpochState } = await import('../../../recon/reconcile')
  const reconcileSynthetic = async (hidden: boolean, active: boolean) => {
    setCanvasHiddenTabIds(hidden ? ['ghostpanel'] : [])
    const world = host.observe()
    const model = {
      ...createEmptyModel(world.drawerSide),
      secondary: [key],
      hidden: hidden ? [key] : [],
      active: { primary: null, secondary: active ? key : null },
      drawers: {
        primary: { open: world.primaryOpen, width: world.primaryWidth },
        secondary: { open: world.secondaryOpen, width: world.secondaryWidth },
      },
    }
    const port: any = {
      observe: () => world,
      resolve: (candidate: string) => candidate === key ? 'ghostpanel' : null,
      findKey: (id: string) => id === 'ghostpanel' ? key : null,
      placeTab: async () => ({ placed: true }),
      setOrder: async () => 'ok',
      setHidden: async () => 'ok',
      activate: async () => 'ok',
      setDrawer: async () => 'ok',
      setSide: async () => 'ok',
      onWorldChanged: () => () => {},
    }
    resetEpochState()
    return reconcile(model, port)
  }

  const hiddenReport = await reconcileSynthetic(true, false)
  assertEqual(
    hiddenReport.steps.find(step => step.step === 'visibility')?.ops,
    0,
    'G3e: hidden synthesized builtin has no visibility diff after converge',
  )
  const activeReport = await reconcileSynthetic(false, true)
  assertEqual(
    activeReport.steps.find(step => step.step === 'activation')?.ops,
    0,
    'G3f: active synthesized builtin has no activation diff after converge',
  )

  __resetCanvasHiddenTabIdsForTest()
  setActiveSecondaryTabId(null, { silent: true })
  _nowOffset = 0
  setSidebarButtons([])
}

// ── G5: droppedSecondaryKeys — the sweep diff ──
{
  const { droppedSecondaryKeys } = await import('../../../tabs/ghost-tabs')
  // A secondary→primary move keeps the key in the model — never swept.
  assertEqual(
    JSON.stringify(droppedSecondaryKeys(['a', 'b'], { primary: ['a'], secondary: ['b'] })),
    '[]',
    'G5a: moved-to-primary key is not swept',
  )
  // A key gone from BOTH sides was dropped by the authoritative sync — swept.
  assertEqual(
    JSON.stringify(droppedSecondaryKeys(['a', 'dead'], { primary: ['a'], secondary: [] })),
    JSON.stringify(['dead']),
    'G5b: dropped key is swept',
  )
  assertEqual(
    droppedSecondaryKeys([], { primary: [], secondary: [] }).length, 0,
    'G5c: empty prev → nothing to sweep',
  )
}

// ── G6: the sweeper removes the dead Canvas-owned secondary button on the
// model commit that drops its key (and only then) ──
{
  setSidebarButtons([])
  const { __setSecondaryWrapperForTest } = await import('../../../sidebar/secondary')
  const { bootstrap, shutdown, dispatch, getModel, flush } = await import('../../../recon/dispatch')
  const { startGhostTabSweeper } = await import('../../../tabs/ghost-tabs')
  const { FakeHost } = await import('../../../host/fake/implementation')
  const { createEmptyModel } = await import('../../../core/model')

  function makeNode(tag: string, attrs: Record<string, string>): any {
    const el: any = new (globalThis as any).HTMLElement()
    el.tagName = tag.toUpperCase()
    el.attrs = { ...attrs }
    el.getAttribute = (k: string) => (k in el.attrs ? el.attrs[k] : null)
    el.style = { display: '' }
    el.removed = false
    el.remove = () => { el.removed = true }
    return el
  }

  const PROFILE = 'builtin:profile'
  const deadLiveId = 'spindle:ghost:tab:main:0'
  const ghostBtn = makeNode('button', {
    'data-tab-id': deadLiveId,
    'data-canvas-facade-key': GHOST_KEY,
    title: 'Ghost',
  })
  const liveBtn = makeNode('button', {
    'data-tab-id': 'profile',
    'data-canvas-facade-key': PROFILE,
    title: 'Profile',
  })
  const list = makeNode('div', {})
  list.children = []
  list.appendChild = (child: any) => { list.children.push(child); return child }
  list.appendChild(ghostBtn)
  list.appendChild(liveBtn)
  list.querySelectorAll = (sel: string) => {
    if (typeof sel === 'string' && sel.includes('data-canvas-facade-key')) {
      const key = sel.split('"')[1]!.replace(/\\(.)/g, '$1')
      return list.children.filter((c: any) => c.attrs['data-canvas-facade-key'] === key)
    }
    if (typeof sel === 'string' && sel.includes('data-tab-id')) {
      const id = sel.split('"')[1]!.replace(/\\(.)/g, '$1')
      return list.children.filter((c: any) => c.attrs['data-tab-id'] === id)
    }
    if (typeof sel === 'string' && sel.includes('button[data-tab-id]')) {
      return list.children.filter((c: any) => c.tagName === 'BUTTON')
    }
    return []
  }
  list.querySelector = (sel: string) => list.querySelectorAll(sel)[0] ?? null
  const wrapper = makeNode('div', {})
  wrapper.querySelector = (sel: string) =>
    sel === '.sidebar-ux-tab-list' ? list : null
  ;(__setSecondaryWrapperForTest as (w: any) => void)(wrapper)

  // Model: the dead extension tab sits in SECONDARY; a live builtin too.
  const model = {
    ...createEmptyModel(),
    primary: [PROFILE],
    secondary: [GHOST_KEY],
    active: { primary: PROFILE, secondary: null },
  }
  const host = new FakeHost([
    { key: PROFILE, liveId: 'profile', isBuiltin: true, location: 'primary', hidden: false, activeInPrimary: true, activeInSecondary: false, hasContentRoot: true, title: 'Profile' },
  ])
  bootstrap(model as any, host as any)
  await flush()

  const stop = startGhostTabSweeper()
  assertEqual(getModel()!.secondary.includes(GHOST_KEY), true, 'G6a: pre-state — dead key in model.secondary')

  // Authoritative host-sync without the dead key → the model drops it →
  // the sweeper removes the Canvas-owned button (by facade key), keeps the
  // live one.
  await dispatch({ t: 'syncFromHost', observed: host.observe() })
  await flush()
  assertEqual(getModel()!.secondary.includes(GHOST_KEY), false, 'G6b: sync dropped the dead key from the model')
  assertEqual(ghostBtn.removed, true, 'G6c: ghost secondary button removed by facade key')
  assertEqual(liveBtn.removed, false, 'G6d: live secondary button untouched')

  // Control: a secondary→primary move (key still in the model) must NOT sweep.
  ghostBtn.removed = false
  const moved = { ...createEmptyModel(), primary: [PROFILE, GHOST_KEY], secondary: [], active: { primary: PROFILE, secondary: null } }
  const hostWithMoved = new FakeHost([
    { key: PROFILE, liveId: 'profile', isBuiltin: true, location: 'primary', hidden: false, activeInPrimary: true, activeInSecondary: false, hasContentRoot: true, title: 'Profile' },
    { key: GHOST_KEY, liveId: deadLiveId, isBuiltin: false, location: 'primary', hidden: false, activeInPrimary: false, activeInSecondary: false, hasContentRoot: true, title: 'Ghost' },
  ])
  bootstrap(moved as any, hostWithMoved as any)
  await flush()
  const stop2 = startGhostTabSweeper()
  await dispatch({ t: 'syncFromHost', observed: hostWithMoved.observe() })
  await flush()
  assertEqual(getModel()!.primary.includes(GHOST_KEY), true, 'G6e: moved key still in the model (primary)')
  assertEqual(ghostBtn.removed, false, 'G6f: moved (not dropped) key keeps its button')
  stop()
  stop2()
  shutdown()
}

console.log(`ghost-tabs: ${passed} passed, ${failed} failed`)
console.log(`PASSED: ${passed}`)
if (failed > 0) {
  console.log(`FAILED: ${failed}`)
  process.exitCode = 1
}
