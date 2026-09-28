// LUMI-21 rework — teardown applicator quiesce (review findings 1–3).
//
// The first LUMI-21 pass guarded only the tab-button/hidden-sync
// continuations; the review reproduced the same bug through the rest of
// the applicator family:
//   AC1 — the disable chain's own `void import('./drawer-location')`
//         continuations re-ran the reconcile fan-out post-teardown and
//         REMOUNTED an empty Canvas shell over the restored vanilla drawer
//         (reconcileDrawerLocation → reconcileMainTabListPin →
//         applyMainMirrorDrawer(true) → mountMainMirror re-injecting the
//         host-hide style + html classes).
//   AC2 — the stale instance's applicator entries
//         (ensureMainPinHost → sweepStrayPinHosts et al.) destroyed the
//         NEXT boot's rendered chrome when the old module graph kept
//         firing during the re-enable.
//
// This test pins the guard at every applicator entry named by the verdict:
// with the instance ENDED (disable done) the entries no-op — no pin host is
// created, no shell is mounted, no html class is written — and after a
// re-begin (the off→on transition; production re-imports a fresh module
// graph whose lifecycle starts active) the entries work again.

import { describe, test, expect, mock } from 'bun:test'
// Spread the real store so newly-imported named exports keep linking; the
// stub below only neutralizes what the guard seams touch.
import * as actualStore from '../../store'

// ── DOM stubs (must exist before module import) ──────────────────────────

class StubElement {
  style: Record<string, string> = {}
  className = ''
  private _classSet = new Set<string>()
  parentElement: StubElement | null = null
  children: StubElement[] = []
  childNodes: StubElement[] = []
  firstChild: StubElement | null = null
  classList = {
    add: (c: string) => { this._classSet.add(c) },
    remove: (c: string) => { this._classSet.delete(c) },
    contains: (c: string) => this._classSet.has(c),
  }
  setAttribute(_k: string, _v: string) {}
  getAttribute(_k: string): string | null { return null }
  appendChild(child: StubElement) {
    if (child.parentElement) child.parentElement.removeChild(child)
    this.children.push(child)
    this.childNodes = this.children
    child.parentElement = this
    return child
  }
  removeChild(child: StubElement) {
    this.children = this.children.filter((c) => c !== child)
    this.childNodes = this.children
    child.parentElement = null
    return child
  }
  insertBefore(child: StubElement, _ref: StubElement | null) {
    return this.appendChild(child)
  }
  remove() {
    if (this.parentElement) this.parentElement.removeChild(this)
  }
  querySelector(_sel: string): StubElement | null { return null }
  querySelectorAll(_sel: string): StubElement[] { return [] }
}

const bodyStub = new StubElement()
const htmlStub = new StubElement()
// Reflow/style writes go through documentElement.style.
;(htmlStub as any).style = {
  setProperty: () => {},
  removeProperty: () => {},
  getPropertyValue: () => '',
}

;(globalThis as any).document = {
  documentElement: htmlStub,
  body: bodyStub,
  head: new StubElement(),
  createElement: (_tag: string) => new StubElement(),
  getElementById: (_id: string) => null,
  querySelector: (_sel: string) => null,
  querySelectorAll: (_sel: string) => [] as StubElement[],
  addEventListener() {},
  removeEventListener() {},
}
;(globalThis as any).window = {
  matchMedia: (_q: string) => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {},
  removeEventListener() {},
}
;(globalThis as any).MutationObserver = class { observe() {} disconnect() {} }
;(globalThis as any).ResizeObserver = class { observe() {} disconnect() {} }
;(globalThis as any).getComputedStyle = () => ({ display: '', visibility: '' })
// Synchronous presence path (no rAF in this harness).
;(globalThis as any).requestAnimationFrame = undefined

// ── Module mocks for the heavy dep graph (guard seams stay REAL) ─────────

mock.module('../../settings/state', () => ({
  getDrawerLocation: () => 'sides',
  isHorizontalStrip: () => false,
  getStripEdge: () => null,
  getSettings: () => ({
    secondSidebarEnabled: true,
    taskbarMode: true,
    moveControlsToOuterEdge: true,
    drawerLocation: 'sides',
  }),
  isTaskbarModeEnabled: () => true,
}))

mock.module('../../recon/dispatch', () => ({
  onModelChanged: () => () => {},
  getModel: () => null,
  getHost: () => null,
  dispatch: () => {},
  shutdown: () => {},
  bootstrapFromLayout: () => {},
  bootPlacementDone: () => Promise.resolve(),
  setPersistOsOverride: () => {},
}))

mock.module('../../store', () => ({
  ...actualStore,
  getMainDrawerSide: () => 'left',
  isMainDrawerOpen: () => true,
  getDrawerTabs: () => [],
}))

// ── Imports (real guard seams under test) ────────────────────────────────

const { beginLifecycle, endLifecycle } = await import('../../lifecycle/instance')
const { reconcileDrawerLocation } = await import('../drawer-location')
const { reconcileMainTabListPin } = await import('../main-tab-pin')
const {
  reconcileTabListPin,
  ensureMainPinHost,
  destroyMainPinHost,
} = await import('../tab-position')
const {
  applyMainMirrorDrawer,
  pinMainMirrorShellTabList,
  teardownMainMirror,
} = await import('../main-mirror-drawer')
const { CANVAS_MAIN_ACTIVE_CLASS } = await import('../styles')

const bodyChildCount = () => bodyStub.children.length

describe('LUMI-21 rework: teardown applicator quiesce', () => {
  test('control: entries work while the instance is live', () => {
    const gen = beginLifecycle()
    // ensureMainPinHost is the exact entry the review traced killing the
    // next boot's chrome — while live it must create the host.
    const host = ensureMainPinHost('left')
    expect(host).not.toBeNull()
    expect(bodyChildCount()).toBe(1)
    destroyMainPinHost()
    expect(bodyChildCount()).toBe(0)
    endLifecycle(gen)
  })

  test('AC1/AC2: post-teardown applicator entries are quiesced', () => {
    const gen = beginLifecycle()
    endLifecycle(gen) // disable chain completed

    // The teardown chain's own continuations (secondary.tsx:1142 + siblings)
    // and any rAF armed pre-teardown land here:
    expect(() => reconcileDrawerLocation()).not.toThrow()
    // The stale instance's observers/timers drive these during the next
    // boot — none may mount, pin, or sweep:
    expect(() => reconcileMainTabListPin()).not.toThrow()
    expect(() => reconcileTabListPin()).not.toThrow()
    expect(() => applyMainMirrorDrawer(true)).not.toThrow()

    // No remount: the shell was never mounted, so the html active class and
    // the host-hide re-injection (mountMainMirror's first writes) never ran.
    expect(htmlStub.classList.contains(CANVAS_MAIN_ACTIVE_CLASS)).toBe(false)
    expect(bodyChildCount()).toBe(0)

    // The traced kill chain: pinMainMirrorShellTabList → ensureMainPinHost →
    // sweepStrayPinHosts. Post-teardown every entry no-ops.
    expect(pinMainMirrorShellTabList('left')).toBeNull()
    expect(ensureMainPinHost('left')).toBeNull()
    expect(bodyChildCount()).toBe(0)

    // teardownMainMirror itself stays functional (pure removal, no mounts):
    expect(() => teardownMainMirror()).not.toThrow()
    expect(htmlStub.classList.contains(CANVAS_MAIN_ACTIVE_CLASS)).toBe(false)
  })

  test('off→on: the re-enabled instance passes the guards again', () => {
    beginLifecycle() // fresh boot (fresh module graph in production)
    const host = ensureMainPinHost('left')
    expect(host).not.toBeNull()
    expect(bodyChildCount()).toBe(1)
    destroyMainPinHost()
    expect(bodyChildCount()).toBe(0)
  })
})
