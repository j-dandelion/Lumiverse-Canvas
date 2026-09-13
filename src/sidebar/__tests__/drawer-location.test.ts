// S8 drawer-location orchestrator tests.
//
// The pin modules / consumers are mocked: this test verifies the
// PRESENTATION contract only — html classes + strip var, shell edge offsets,
// reconcile fan-out, presence subscription, skip-cache, re-entrancy
// coalescing and idempotent teardown. Strip geometry itself is asserted in
// tab-position/main-tab-pin tests (the single geometry writer).

import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ── Controllable test state (read by the module mocks) ──
let loc: 'sides' | 'top' | 'bottom' = 'sides'
let secondEnabled = true
let shellLive = true
let presence = false
let mobile = false
let side: 'left' | 'right' = 'left'
const calls: string[] = []
let modelCb: (() => void) | null = null
let reentrantOnce = false
let dragActive = false
let modRef: { reconcileDrawerLocation: (opts?: { force?: boolean }) => void } | null = null

// Force the synchronous presence path (no rAF in this harness).
;(globalThis as any).requestAnimationFrame = undefined

// ── Module mocks (registered before importing the module under test) ──

mock.module('../../settings/state', () => ({
  getDrawerLocation: () => loc,
  isHorizontalStrip: () => loc !== 'sides',
  getStripEdge: () => (loc === 'top' ? 'top' : loc === 'bottom' ? 'bottom' : null),
  getSettings: () => ({
    secondSidebarEnabled: secondEnabled,
    taskbarMode: true,
    moveControlsToOuterEdge: true,
    drawerLocation: loc,
  }),
}))

mock.module('../../recon/dispatch', () => ({
  onModelChanged: (cb: () => void) => {
    modelCb = cb
    return () => { modelCb = null }
  },
}))

mock.module('../../tabs/assignment', () => ({
  hasSecondaryAssignedTabs: () => presence,
}))

mock.module('../../store', () => ({
  getMainDrawerSide: () => side,
}))

mock.module('../mobile-exclusion', () => ({
  isMobileViewport: () => mobile,
}))

mock.module('../main-mirror-drawer', () => ({
  getMainMirrorWrapper: () => mainWrapper,
  updateMainMirrorDrawerTabVisibility: () => {
    calls.push('mainHandles')
    // Mirror the production writer: visible on Sides, hidden horizontal.
    mainWrapper.handle!.style.display = loc === 'sides' ? 'flex' : 'none'
  },
}))

mock.module('../secondary', () => ({
  getSecondaryWrapper: () => secWrapper,
  isSecondaryShellLive: () => shellLive,
}))

mock.module('../tab-position', () => ({
  reconcileTabListPin: () => {
    calls.push('secondaryPin')
    if (reentrantOnce) {
      reentrantOnce = false
      // Re-entrant reconcile from inside the fan-out must coalesce, not
      // recurse, and must produce exactly one follow-up pass.
      modRef?.reconcileDrawerLocation()
    }
  },
}))

mock.module('../main-tab-pin', () => ({
  reconcileMainTabListPin: () => calls.push('mainPin'),
}))

mock.module('../strip-gutter', () => ({
  updateStripGutters: () => calls.push('gutters'),
}))

mock.module('../../chat/reflow', () => ({
  updateChatReflow: () => calls.push('reflow'),
}))

mock.module('../../tabs/buttons', () => ({
  updateDrawerTabVisibility: () => {
    calls.push('secondaryHandles')
    secWrapper.handle!.style.display = loc === 'sides' ? 'flex' : 'none'
  },
}))

mock.module('../../debug/styles', () => ({
  injectStyles: () => {},
}))

mock.module('../../tabs/tab-list-dnd', () => ({
  isDndDragActive: () => dragActive,
  invalidateDndGeometry: () => calls.push('invalidateDnd'),
}))

// ── Minimal DOM stubs ──

class FakeStyle {
  private _props: Record<string, string> = {}
  setProperty(k: string, v: string) { this._props[k] = v }
  getPropertyValue(k: string) { return this._props[k] ?? '' }
  removeProperty(k: string) { delete this._props[k] }
  get top() { return this._props['top'] ?? '' }
  set top(v: string) { this._props['top'] = v }
  get bottom() { return this._props['bottom'] ?? '' }
  set bottom(v: string) { this._props['bottom'] = v }
  get display() { return this._props['display'] ?? '' }
  set display(v: string) { this._props['display'] = v }
}

class FakeClassList {
  private _set = new Set<string>()
  add(...cs: string[]) { for (const c of cs) this._set.add(c) }
  remove(...cs: string[]) { for (const c of cs) this._set.delete(c) }
  contains(c: string) { return this._set.has(c) }
  toggle(c: string, force?: boolean) {
    const on = force === undefined ? !this._set.has(c) : force
    if (on) this._set.add(c)
    else this._set.delete(c)
    return on
  }
  toString() { return [...this._set].join(' ') }
}

class FakeEl {
  style = new FakeStyle()
  classList = new FakeClassList()
  querySelector(sel: string): FakeEl | null {
    if (sel === '.sidebar-ux-drawer-tab') return this.handle
    return null
  }
  handle: FakeEl | null = null
}

const root = new FakeEl()
;(globalThis as any).document = {
  documentElement: root,
  head: { appendChild() {} },
  getElementById: () => null,
  createElement: () => new FakeEl(),
}

const secWrapper = new FakeEl()
secWrapper.handle = new FakeEl()
const mainWrapper = new FakeEl()
mainWrapper.handle = new FakeEl()

const mod = await import('../drawer-location')
modRef = mod
const {
  initDrawerLocation,
  mountDrawerLocation,
  reconcileDrawerLocation,
  clearDrawerLocation,
  restyleShellLocation,
  assertLocationApplied,
  __resetDrawerLocationForTest,
} = mod

const TOP_EXPR = 'calc(env(safe-area-inset-top, 0px) + var(--sidebar-ux-strip-h, 56px))'
const BOTTOM_EXPR = 'calc(env(safe-area-inset-bottom, 0px) + var(--sidebar-ux-strip-h, 56px))'
const SAFE_TOP = 'env(safe-area-inset-top, 0px)'
const SAFE_BOTTOM = 'env(safe-area-inset-bottom, 0px)'

function resetState() {
  __resetDrawerLocationForTest()
  loc = 'sides'
  secondEnabled = true
  shellLive = true
  presence = false
  mobile = false
  side = 'left'
  calls.length = 0
  reentrantOnce = false
  dragActive = false
  secWrapper.handle!.style.display = 'flex'
  mainWrapper.handle!.style.display = 'flex'
}

describe('drawer-location presentation (WS2)', () => {
  beforeEach(resetState)

  test('init sets Sides class + strip var before any mount', () => {
    initDrawerLocation()
    expect(root.classList.contains('sidebar-ux-location-sides')).toBe(true)
    expect(root.classList.contains('sidebar-ux-location-top')).toBe(false)
    expect(root.style.getPropertyValue('--sidebar-ux-strip-h')).toBe('56px')
    expect(assertLocationApplied('sides')).toBe(true)
  })

  test('reconcile fans out to the pin writers + consumers', () => {
    initDrawerLocation()
    reconcileDrawerLocation({ force: true })
    expect(calls).toContain('secondaryPin')
    expect(calls).toContain('mainPin')
    expect(calls).toContain('secondaryHandles')
    expect(calls).toContain('mainHandles')
    expect(calls).toContain('gutters')
    expect(calls).toContain('reflow')
    // Idle: no DnD cache invalidation.
    expect(calls).not.toContain('invalidateDnd')
  })

  test('reconcile mid-drag invalidates cached DnD geometry', () => {
    initDrawerLocation()
    reconcileDrawerLocation({ force: true })
    calls.length = 0
    dragActive = true
    reconcileDrawerLocation({ force: true })
    expect(calls).toContain('invalidateDnd')
  })

  test('Top: classes, wrapper offsets and handles', () => {
    initDrawerLocation()
    loc = 'top'
    reconcileDrawerLocation({ force: true })
    expect(root.classList.contains('sidebar-ux-location-top')).toBe(true)
    expect(root.classList.contains('sidebar-ux-location-sides')).toBe(false)
    expect(secWrapper.style.top).toBe(TOP_EXPR)
    expect(mainWrapper.style.top).toBe(TOP_EXPR)
    expect(secWrapper.style.bottom).toBe(SAFE_BOTTOM)
    // Handles hidden while horizontal.
    expect(secWrapper.handle!.style.display).toBe('none')
    expect(mainWrapper.handle!.style.display).toBe('none')
    expect(assertLocationApplied('top')).toBe(true)
  })

  test('Bottom → Sides restores offsets and leaves handles to the writers', () => {
    initDrawerLocation()
    loc = 'bottom'
    reconcileDrawerLocation({ force: true })
    expect(mainWrapper.style.bottom).toBe(BOTTOM_EXPR)
    loc = 'sides'
    reconcileDrawerLocation({ force: true })
    expect(root.classList.contains('sidebar-ux-location-sides')).toBe(true)
    expect(secWrapper.style.top).toBe(SAFE_TOP)
    expect(secWrapper.style.bottom).toBe(SAFE_BOTTOM)
    expect(mainWrapper.style.top).toBe(SAFE_TOP)
    expect(mainWrapper.style.bottom).toBe(SAFE_BOTTOM)
    // Writers ran after the flip and re-set the handles (mock does not hide).
    expect(secWrapper.handle!.style.display).toBe('flex')
    expect(mainWrapper.handle!.style.display).toBe('flex')
  })

  test('skip-cache: same key is a no-op; presence change re-splits', () => {
    initDrawerLocation()
    reconcileDrawerLocation({ force: true })
    calls.length = 0
    reconcileDrawerLocation()
    expect(calls.length).toBe(0)

    presence = true
    reconcileDrawerLocation()
    expect(calls).toContain('secondaryPin')
  })

  test('shell-liveness and side changes bust the cache', () => {
    initDrawerLocation()
    reconcileDrawerLocation({ force: true })
    calls.length = 0
    side = 'right'
    reconcileDrawerLocation()
    expect(calls).toContain('secondaryPin')

    calls.length = 0
    shellLive = false
    reconcileDrawerLocation()
    expect(calls).toContain('secondaryPin')
  })

  test('mount subscribes to onModelChanged and presence commits reconcile', () => {
    const teardown = mountDrawerLocation()
    expect(modelCb).not.toBeNull()
    calls.length = 0
    presence = true
    modelCb!()
    expect(calls).toContain('secondaryPin')
    teardown()
    expect(modelCb).toBeNull()
  })

  test('re-entrant reconcile coalesces into one follow-up pass', () => {
    initDrawerLocation()
    reconcileDrawerLocation({ force: true })
    calls.length = 0
    reentrantOnce = true
    // The first pass triggers a re-entrant call via the mocked pin writer;
    // the follow-up pass must run after it (dirty flag), not recurse.
    reconcileDrawerLocation({ force: true })
    const secondaryPinCalls = calls.filter((c) => c === 'secondaryPin').length
    expect(secondaryPinCalls).toBe(2)
  })

  test('restyleShellLocation flips presentation in place', () => {
    initDrawerLocation()
    loc = 'top'
    restyleShellLocation()
    expect(root.classList.contains('sidebar-ux-location-top')).toBe(true)
    expect(secWrapper.style.top).toBe(TOP_EXPR)
  })

  test('clear is idempotent and empties the location DOM state', () => {
    mountDrawerLocation()
    loc = 'top'
    reconcileDrawerLocation({ force: true })
    clearDrawerLocation()
    clearDrawerLocation()
    expect(root.classList.contains('sidebar-ux-location-top')).toBe(false)
    expect(root.classList.contains('sidebar-ux-location-bottom')).toBe(false)
    expect(root.classList.contains('sidebar-ux-location-sides')).toBe(false)
    expect(root.style.getPropertyValue('--sidebar-ux-strip-h')).toBe('')
    expect(secWrapper.style.top).toBe(SAFE_TOP)
    expect(mainWrapper.style.top).toBe(SAFE_TOP)
  })
})
