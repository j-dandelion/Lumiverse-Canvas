// Host-driven "Drawer side" flip → owned-model convergence (S8 #2).
//
// Live repro this guards: in Top/Bottom (and Sides), flipping Lumiverse's own
// "Drawer side" setting moves the Canvas strip — then opening a tab snaps it
// back. Root cause: the flip restyles geometry only; the 500ms host watcher
// compared the host side against getMainDrawerSide() (DOM-first, already the
// flipped side), so the owned model kept the OLD side and the next dispatch's
// reconcile wrote it back through diffSide (model→host).
//
// The geometry modules are mocked (this is not a geometry test); `recon/dispatch`
// stays REAL, and FakeHost's world side is mutated WITHOUT notifying observers
// (LumiverseHost.onWorldChanged never observes the host wrapper class, so the
// real host flip is invisible to Canvas observers — `host.setSide()` would
// simulate it wrongly by triggering a syncFromHost adoption).
//
// Plan: ~/Documents/plans/2026-09-14-canvas-host-side-flip-model-converge.md

import { mock } from 'bun:test'

// ── Mutable host-settings seam (the watcher's poll source) ──
let hostSettings: { side?: 'left' | 'right' } = { side: 'left' }

mock.module('../../dom/host-settings', () => ({
  getHostDrawerSettings: () => hostSettings,
  patchHostDrawerSettings: () => true,
  writeHostDrawerSettingsViaApi: async () => true,
}))

// ── Geometry mocks (restyle calls are asserted as a sanity check) ──
let restyleMainCalls = 0
let restyleSecondaryCalls = 0

mock.module('../secondary', () => ({
  getSecondaryWrapper: () => null,
  isSecondarySidebarOpen: () => false,
  isSecondaryShellLive: () => false,
  restyleSecondaryShellSide: () => { restyleSecondaryCalls++ },
}))

mock.module('../tab-position', () => ({
  applyTabListPosition: () => {},
  reconcileTabListPin: () => {},
}))

mock.module('../main-mirror-drawer', () => ({
  getMainMirrorWrapper: () => null,
  getMainMirrorDrawer: () => null,
  getMainMirrorTabList: () => null,
  getMainMirrorPanel: () => null,
  isCanvasMainOpen: () => false,
  isMainMirrorActive: () => false,
  restyleMainShellSide: () => { restyleMainCalls++ },
  updateMainMirrorDrawerTabVisibility: () => {},
}))

mock.module('../main-tab-pin', () => ({
  reconcileMainTabListPin: () => {},
}))

import {
  checkSideChanged,
  startHostSideWatcher,
  stopHostSideWatcher,
  __setLastKnownSideForTest,
} from '../drawer-sync'
import { bootstrap, dispatch, flush, getModel, shutdown } from '../../recon/dispatch'
import { FakeHost, type LiveTab } from '../../host/fake/implementation'
import { hydrateSettings } from '../../settings/state'
import { serializeModelToLayout } from '../../persist/layout-model'
import { createEmptyModel, type LayoutModel } from '../../core/model'

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

function tick(ms = 10): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function ensureDocument() {
  if (typeof (globalThis as any).document === 'undefined') {
    const classList = {
      _set: new Set<string>(),
      add(...cs: string[]) { for (const c of cs) this._set.add(c) },
      remove(...cs: string[]) { for (const c of cs) this._set.delete(c) },
      contains(c: string) { return this._set.has(c) },
      toggle(c: string, on?: boolean) { if (on) this._set.add(c); else this._set.delete(c); return !!on },
    }
    ;(globalThis as any).document = {
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
      createElement: () => ({}),
      documentElement: {
        classList,
        style: {
          setProperty() {},
          removeProperty() {},
          getPropertyValue() { return '' },
        },
      },
      body: { appendChild() {}, removeChild() {} },
    }
  }
  if (typeof (globalThis as any).requestAnimationFrame !== 'function') {
    ;(globalThis as any).requestAnimationFrame = (cb: (t: number) => void) =>
      setTimeout(() => cb(Date.now()), 0) as unknown as number
  }
  if (typeof (globalThis as any).MutationObserver === 'undefined') {
    ;(globalThis as any).MutationObserver = class {
      constructor(_cb: MutationCallback) {}
      observe() {}
      disconnect() {}
      takeRecords() { return [] }
    }
  }
  if (typeof (globalThis as any).window === 'undefined') {
    ;(globalThis as any).window = { location: { protocol: 'http:' } }
  }
}

/** Install a main host wrapper whose class drives getMainDrawerSide(). */
function installMainWrapper(side: 'left' | 'right') {
  ensureDocument()
  const classSet = new Set<string>([
    side === 'left' ? 'wrapperLeft' : 'wrapperRight',
    'wrapperOpen',
    '_wrapper_abc',
  ])
  const wrapper: any = {
    classList: {
      toString() { return [...classSet].join(' ') },
      add(...cs: string[]) { for (const c of cs) classSet.add(c) },
      remove(...cs: string[]) { for (const c of cs) classSet.delete(c) },
      contains(c: string) { return classSet.has(c) },
    },
  }
  const sidebar: any = {
    closest(sel: string) {
      if (typeof sel === 'string' && sel.includes('_wrapper_')) return wrapper
      return null
    },
  }
  ;(document as any).querySelector = (sel: string) => {
    if (sel === '[data-spindle-mount="sidebar"]') return sidebar
    return null
  }
}

function liveTab(key: string, liveId: string, active: boolean): LiveTab {
  return {
    key,
    liveId,
    location: 'primary',
    hidden: false,
    activeInPrimary: active,
    activeInSecondary: false,
    hasContentRoot: true,
    isBuiltin: true,
  }
}

function twoTabModel(side: 'left' | 'right'): LayoutModel {
  const base = createEmptyModel(side)
  return {
    ...base,
    primary: ['builtin:alpha', 'builtin:beta'],
    active: { primary: 'builtin:alpha', secondary: null },
  }
}

/** The host flips its wrapper/state outside Canvas observers (no notify). */
function quietHostFlip(host: FakeHost, side: 'left' | 'right'): void {
  ;(host as unknown as { _side: 'left' | 'right' })._side = side
  installMainWrapper(side)
  hostSettings = { side }
}

ensureDocument()
hydrateSettings({ secondSidebarEnabled: true, moveControlsToOuterEdge: false })

// ── A: the 500ms watcher converges the owned model ──
// Watcher starts on left/left, then the host flips; the poll must compare
// host side against the MODEL (not getMainDrawerSide, which already flipped).
{
  restyleMainCalls = 0
  restyleSecondaryCalls = 0
  installMainWrapper('left')
  hostSettings = { side: 'left' }
  __setLastKnownSideForTest(null)

  const hostA = new FakeHost([liveTab('builtin:alpha', 'alpha-1', true), liveTab('builtin:beta', 'beta-1', false)], 'left')
  bootstrap(twoTabModel('left'), hostA)
  await flush()

  startHostSideWatcher()
  await tick(600) // one poll with no change → must not dispatch
  await flush()
  assertEqual(getModel()?.side, 'left', 'A1: no convergence while host side is unchanged')

  const hostSideBefore = hostA.observe().drawerSide
  quietHostFlip(hostA, 'right')
  await tick(700) // poll observes the new host side
  await flush()
  await flush()

  assertEqual(getModel()?.side, 'right', 'A2: watcher adopts the host side into the owned model')
  assertEqual(hostA.observe().drawerSide, 'right', 'A3: host side untouched by convergence (model was stale, not the world)')
  assertEqual(hostSideBefore, 'left', 'A4: pre-flip host side is left')
  stopHostSideWatcher()
  shutdown()
}

// ── B: the wrapper-class event converges immediately (no 500ms wait) ──
{
  installMainWrapper('left')
  hostSettings = { side: 'left' }
  const restyledBefore = restyleMainCalls
  const restyledSecBefore = restyleSecondaryCalls

  const hostB = new FakeHost([liveTab('builtin:alpha', 'alpha-1', true), liveTab('builtin:beta', 'beta-1', false)], 'left')
  bootstrap(twoTabModel('left'), hostB)
  await flush()

  quietHostFlip(hostB, 'right')
  __setLastKnownSideForTest('left') // what Canvas last applied

  checkSideChanged()
  await tick(30)
  await flush()
  await flush()

  assertEqual(getModel()?.side, 'right', 'B1: MO event adopts the host side without the watcher poll')
  assert(restyleMainCalls > restyledBefore, 'B2: main shell still restyled (S4 geometry path intact)')
  assert(restyleSecondaryCalls > restyledSecBefore, 'B3: secondary shell still restyled (S4 geometry path intact)')

  // ── C: the user repro — the next dispatch must NOT write the old side back ──
  await dispatch({ t: 'activate', key: 'builtin:beta', side: 'primary' })
  await flush()

  assertEqual(hostB.observe().drawerSide, 'right', 'C1: opening a tab does not reset the host side')
  assert((hostB as unknown as { _side: string })._side === 'right', 'C2: inner host side still right')
  const blob = serializeModelToLayout(getModel()!, (key) => hostB.resolve(key), 'test')
  assertEqual(blob.drawerSide, 'right', 'C3: persisted layout carries the converged side')

  shutdown()
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}/${passed + failed}`)
