// Options (Settings gear) location tests — sidebar/settings-dock.ts.
//
// Verifies the DOM contract the chrome reconcile depends on:
//   - the main mirror gear hides/shows via the shared gear attr/class
//   - the secondary gear lives in the ONE shared secondary dock (never a
//     second dock), carries no data-tab-id, and classifies as settings chrome
//   - the empty dock collapses/removes only when nothing remains
//   - teardown restores the main gear
//
// Hand-rolled DOM stubs follow the repo convention. The matcher supports the
// selector shapes settings-dock uses: `.class`, `tag[attr="v"]`,
// comma lists, and `:scope > .class` (direct children).

import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ── Module mocks (registered before importing the module under test) ──

mock.module('../../debug/styles', () => ({ injectStyles: () => { /* no-op */ } }))
mock.module('../../debug/log', () => ({ dlog: () => {}, dwarn: () => {} }))

let secondaryList: FakeEl | null = null
let mainWrapper: FakeEl | null = null
let pinnedList: FakeEl | null = null
let settingsTwin: FakeEl | null = null
let storeActionCalls: string[] = []

mock.module('../../sidebar/secondary', () => ({
  getSecondaryTabList: () => secondaryList,
}))
mock.module('../../sidebar/main-mirror-drawer', () => ({
  getMainMirrorWrapper: () => mainWrapper,
  getMainMirrorTabList: () => pinnedList,
}))
mock.module('../../sidebar/main-renderer', () => ({
  SETTINGS_MIRROR_KEY: '__canvas-settings__',
  findSettingsTwin: () => settingsTwin,
}))
mock.module('../../store', () => ({
  callHostStoreAction: (name: string) => { storeActionCalls.push(name); return true },
}))

// ── Mini DOM ──

function matchesSelector(el: FakeEl, sel: string): boolean {
  const parts = sel.match(/(^[a-zA-Z][a-zA-Z0-9]*)|(\.[\w-]+)|(\[[\w-]+(?:="[^"]*")?\])/g) ?? []
  for (const p of parts) {
    if (p.startsWith('.')) {
      if (!el.classList.contains(p.slice(1))) return false
    } else if (p.startsWith('[')) {
      const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(p)
      if (!m) return false
      const v = el.getAttribute(m[1])
      if (m[2] === undefined ? v === null : v !== m[2]) return false
    } else if (el.tagName !== p.toUpperCase()) {
      return false
    }
  }
  return true
}

function queryAll(root: FakeEl, sel: string): FakeEl[] {
  const out: FakeEl[] = []
  for (const rawPart of sel.split(',')) {
    const part = rawPart.trim()
    const scopeChild = part.startsWith(':scope > ')
    const real = scopeChild ? part.slice(':scope > '.length) : part
    const pool = scopeChild ? [...root.children] : descendants(root)
    for (const el of pool) if (matchesSelector(el, real)) out.push(el)
  }
  return out
}

function descendants(root: FakeEl): FakeEl[] {
  const out: FakeEl[] = []
  const walk = (el: FakeEl) => {
    for (const c of el.children) {
      out.push(c)
      walk(c)
    }
  }
  walk(root)
  return out
}

class FakeEl {
  tagName: string
  id = ''
  textContent = ''
  type = ''
  disabled = false
  hidden = false
  innerHTML = ''
  children: FakeEl[] = []
  parentElement: FakeEl | null = null
  private _classes = new Set<string>()
  private _attrs = new Map<string, string>()
  private _listeners = new Map<string, Array<(ev: any) => void>>()

  constructor(tag: string) { this.tagName = tag.toUpperCase() }

  get className() { return [...this._classes].join(' ') }
  set className(v: string) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)) }
  get firstElementChild(): FakeEl | null { return this.children[0] ?? null }

  classList = {
    add: (...cs: string[]) => { for (const c of cs) this._classes.add(c) },
    remove: (...cs: string[]) => { for (const c of cs) this._classes.delete(c) },
    contains: (c: string) => this._classes.has(c),
    toggle: (c: string, force?: boolean) => {
      const on = force === undefined ? !this._classes.has(c) : force
      if (on) this._classes.add(c)
      else this._classes.delete(c)
      return on
    },
  }

  setAttribute(k: string, v: string) { this._attrs.set(k, v) }
  getAttribute(k: string) { return this._attrs.get(k) ?? null }
  removeAttribute(k: string) { this._attrs.delete(k) }
  hasAttribute(k: string) { return this._attrs.has(k) }
  appendChild(child: FakeEl) { child.parentElement = this; this.children.push(child); return child }
  remove() {
    if (!this.parentElement) return
    this.parentElement.children = this.parentElement.children.filter((c) => c !== this)
    this.parentElement = null
  }
  addEventListener(type: string, fn: (ev: any) => void) {
    const arr = this._listeners.get(type) ?? []
    arr.push(fn)
    this._listeners.set(type, arr)
  }
  click() {
    if (this.disabled) return
    for (const fn of this._listeners.get('click') ?? []) fn({})
  }
  querySelector(sel: string): FakeEl | null { return queryAll(this, sel)[0] ?? null }
  querySelectorAll(sel: string): FakeEl[] { return queryAll(this, sel) }
}

const body = new FakeEl('body')
const doc = {
  head: new FakeEl('head'),
  documentElement: new FakeEl('html'),
  body,
  createElement: (tag: string) => new FakeEl(tag),
  getElementById: (_id: string) => null as FakeEl | null,
  querySelectorAll: (sel: string) => queryAll(body, sel),
}
;(globalThis as any).document = doc

const { applyOptionsButtonLocation, refreshMainDockEmptyState, teardownSettingsDock } =
  await import('../settings-dock')

// ── Fixtures ──

function makeMainShell(withStart: boolean): { wrapper: FakeEl; gear: FakeEl; dock: FakeEl } {
  const wrapper = new FakeEl('div')
  wrapper.className = 'sidebar-ux-main-mirror-wrapper'
  const list = new FakeEl('div')
  list.className = 'sidebar-ux-tab-list'
  wrapper.appendChild(list)
  const dock = new FakeEl('div')
  dock.className = 'sidebar-ux-tab-list-bottom'
  list.appendChild(dock)
  const gear = new FakeEl('button')
  gear.setAttribute('data-mirror-key', '__canvas-settings__')
  dock.appendChild(gear)
  if (withStart) {
    const start = new FakeEl('button')
    start.setAttribute('data-canvas-os-start', '1')
    dock.appendChild(start)
  }
  body.appendChild(wrapper)
  return { wrapper, gear, dock }
}

function makeSecondaryList(): { list: FakeEl } {
  const list = new FakeEl('div')
  list.className = 'sidebar-ux-tab-list'
  body.appendChild(list)
  return { list }
}

const MAIN = { sides: ['right'] as Array<'left' | 'right'>, main: true, second: false }
const SECOND = { sides: ['left'] as Array<'left' | 'right'>, main: false, second: true }
const BOTH = { sides: ['right', 'left'] as Array<'left' | 'right'>, main: true, second: true }

beforeEach(() => {
  body.children = []
  secondaryList = null
  mainWrapper = null
  pinnedList = null
  settingsTwin = null
  storeActionCalls = []
})

describe('main drawer gear', () => {
  test('hides via the shared class when the main drawer is excluded', () => {
    const { gear } = makeMainShell(false)
    mainWrapper = body.children.find((c) => c.classList.contains('sidebar-ux-main-mirror-wrapper')) ?? null
    // The clone target must exist, otherwise the main gear is deliberately
    // kept as the reachable fallback (H1).
    secondaryList = makeSecondaryList().list
    applyOptionsButtonLocation(SECOND)
    expect(gear.classList.contains('sidebar-ux-options-hidden')).toBe(true)
    expect(gear.getAttribute('data-canvas-settings-gear')).toBe('main')

    applyOptionsButtonLocation(MAIN)
    expect(gear.classList.contains('sidebar-ux-options-hidden')).toBe(false)
  })

  test('collapses the dock when the gear is hidden and no Start remains', () => {
    const { dock } = makeMainShell(false)
    mainWrapper = body.children.find((c) => c.classList.contains('sidebar-ux-main-mirror-wrapper')) ?? null
    secondaryList = makeSecondaryList().list
    applyOptionsButtonLocation(SECOND)
    expect(dock.classList.contains('sidebar-ux-dock-empty')).toBe(true)

    // Start keeps the dock alive.
    const start = new FakeEl('button')
    start.setAttribute('data-canvas-os-start', '1')
    dock.appendChild(start)
    refreshMainDockEmptyState()
    expect(dock.classList.contains('sidebar-ux-dock-empty')).toBe(false)
  })

  test('keeps the main gear visible while the secondary clone cannot be created (H1)', () => {
    const { gear } = makeMainShell(false)
    mainWrapper = body.children.find((c) => c.classList.contains('sidebar-ux-main-mirror-wrapper')) ?? null
    // The shell-created event fires before the secondary wrapper exists:
    // include:true cannot find the tab list yet.
    secondaryList = null
    const res = applyOptionsButtonLocation(SECOND)
    expect(res.pendingSecond).toBe(true)
    // Never hide the only reachable gear while the clone is pending.
    expect(gear.classList.contains('sidebar-ux-options-hidden')).toBe(false)

    // Once the list mounts, the deferred reconcile applies the real exclusion.
    const { list } = makeSecondaryList()
    secondaryList = list
    const res2 = applyOptionsButtonLocation(SECOND)
    expect(res2.pendingSecond).toBe(false)
    expect(gear.classList.contains('sidebar-ux-options-hidden')).toBe(true)
    expect(list.querySelector('button[data-canvas-settings-gear="secondary"]')).not.toBeNull()
  })

  test('finds a pinned (body-level) dock for the empty state (H4)', () => {
    const { dock } = makeMainShell(true)
    // Simulate taskbar pinning: the list (dock included) lives outside the
    // wrapper, so a wrapper-scoped lookup misses it.
    pinnedList = dock.parentElement
    mainWrapper = null

    applyOptionsButtonLocation({ sides: [], main: false, second: false })
    // The Start button keeps the dock alive ...
    expect(dock.classList.contains('sidebar-ux-dock-empty')).toBe(false)

    // ... and removing it collapses the dock using the pinned list.
    dock.querySelector('button[data-canvas-os-start]')!.remove()
    refreshMainDockEmptyState()
    expect(dock.classList.contains('sidebar-ux-dock-empty')).toBe(true)
  })
})

describe('secondary gear', () => {
  test('creates the shared dock + gear, classified as settings chrome', () => {
    const { list } = makeSecondaryList()
    secondaryList = list
    settingsTwin = new FakeEl('button')
    settingsTwin.innerHTML = '<svg class="gear"></svg>'

    applyOptionsButtonLocation(BOTH)

    const dock = list.querySelector(':scope > .sidebar-ux-secondary-start-dock')
    expect(dock).not.toBeNull()
    const gear = dock!.querySelector('button[data-canvas-settings-gear="secondary"]')
    expect(gear).not.toBeNull()
    expect(gear!.getAttribute('data-tab-id')).toBe(null)
    expect(gear!.classList.contains('tabBtnSettings')).toBe(true)
    expect(gear!.getAttribute('title')).toBe('Settings')
    // The dock stays last.
    expect(list.children[list.children.length - 1]).toBe(dock!)
  })

  test('click forwards to the host settings twin', () => {
    const { list } = makeSecondaryList()
    secondaryList = list
    let twinClicks = 0
    settingsTwin = new FakeEl('button')
    settingsTwin.click = () => { twinClicks++ }

    applyOptionsButtonLocation(BOTH)
    const gear = list.querySelector('button[data-canvas-settings-gear="secondary"]')!
    gear.click()
    expect(twinClicks).toBe(1)
    expect(storeActionCalls).toEqual([])
  })

  test('click falls back to the host store action when the twin is missing', () => {
    const { list } = makeSecondaryList()
    secondaryList = list
    settingsTwin = null

    applyOptionsButtonLocation(BOTH)
    const gear = list.querySelector('button[data-canvas-settings-gear="secondary"]')!
    gear.click()
    expect(storeActionCalls).toEqual(['openSettings'])
  })

  test('removes the gear and the now-empty dock when excluded', () => {
    const { list } = makeSecondaryList()
    secondaryList = list
    applyOptionsButtonLocation(BOTH)
    expect(list.querySelector('.sidebar-ux-secondary-start-dock')).not.toBeNull()

    applyOptionsButtonLocation(MAIN)
    expect(list.querySelector('button[data-canvas-settings-gear="secondary"]')).toBeNull()
    expect(list.querySelector('.sidebar-ux-secondary-start-dock')).toBeNull()
  })

  test('keeps the dock when a Start button still lives in it', () => {
    const { list } = makeSecondaryList()
    secondaryList = list
    const dock = new FakeEl('div')
    dock.className = 'sidebar-ux-tab-list-bottom sidebar-ux-secondary-start-dock'
    const start = new FakeEl('button')
    start.setAttribute('data-canvas-os-start', '1')
    dock.appendChild(start)
    list.appendChild(dock)

    applyOptionsButtonLocation(BOTH)
    applyOptionsButtonLocation(MAIN)
    expect(list.querySelector('.sidebar-ux-secondary-start-dock')).not.toBeNull()
  })

  test('teardown removes the secondary gear + empty docks and un-hides the main gear', () => {
    const { gear } = makeMainShell(false)
    mainWrapper = body.children.find((c) => c.classList.contains('sidebar-ux-main-mirror-wrapper')) ?? null
    const { list } = makeSecondaryList()
    secondaryList = list
    // SECOND excludes the main drawer (gear hidden) but includes the
    // secondary (gear created there).
    applyOptionsButtonLocation(SECOND)
    expect(gear.classList.contains('sidebar-ux-options-hidden')).toBe(true)
    expect(list.querySelector('button[data-canvas-settings-gear="secondary"]')).not.toBeNull()

    teardownSettingsDock()
    expect(gear.classList.contains('sidebar-ux-options-hidden')).toBe(false)
    expect(list.querySelector('button[data-canvas-settings-gear="secondary"]')).toBeNull()
    expect(list.querySelector('.sidebar-ux-secondary-start-dock')).toBeNull()
  })
})
