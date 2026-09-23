// Drawer location / mode panel control tests (S8 + 2026-09-19 overhaul).
//
// The panel's applySettings fan-out imports the feature graph; the real
// registry is mocked out (see the mock below) so only the panel DOM is
// exercised. `rowByLabel` resolves the label inside the new label-head wrapper
// (label + `?` help button).

import { describe, test, expect, mock, beforeEach } from 'bun:test'

// The panel's applySettings fan-out imports the feature graph; the panel DOM
// under test never needs it.
mock.module('../../features/registry', () => ({
  FEATURES: [],
  alwaysCleanups: () => [],
}))

// Mode tiles (plan A7): selectMode dynamic-imports these only for
// OS-involving transitions. Mock both so the heavy os-mode/second-drawer
// graph never loads here; the flags below steer willRestore/cancel for A7-1.
let entrySlotHasTabs = false
let exitSlotHasTabs = false
let guardChoice: 'proceed' | 'cancel' = 'proceed'
let guardCalls = 0
mock.module('../../os/os-mode', () => ({
  osEntrySlotHasTabs: () => entrySlotHasTabs,
  osExitSlotHasTabs: () => exitSlotHasTabs,
  // Not exercised by this suite's tile paths, but keep the symbols linked
  // in case another dynamic import lands here.
  seedOsSlotFromLive: () => {},
  applyOsModeChange: async () => {},
  syncOsMobileDrawerMode: async () => {},
}))
mock.module('../../settings/second-drawer-mode', () => ({
  guardConfigureDirty: async () => {
    guardCalls++
    return guardChoice
  },
  requestSecondDrawerMode: async () => {},
}))

class FakeElement {
  tagName: string
  id = ''
  textContent = ''
  type = ''
  disabled = false
  hidden = false
  tabIndex = 0
  style: Record<string, string> = {}
  children: FakeElement[] = []
  parentElement: FakeElement | null = null
  private _classes = new Set<string>()
  private _attrs = new Map<string, string>()
  private _listeners = new Map<string, Array<(ev: any) => void>>()

  constructor(tag: string) { this.tagName = tag.toUpperCase() }

  get className() { return [...this._classes].join(' ') }
  set className(v: string) {
    this._classes = new Set(String(v).split(/\s+/).filter(Boolean))
  }

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
  appendChild(child: FakeElement) {
    child.parentElement = this
    this.children.push(child)
    return child
  }
  replaceChildren() { this.children = [] }
  addEventListener(type: string, fn: (ev: any) => void) {
    const arr = this._listeners.get(type) ?? []
    arr.push(fn)
    this._listeners.set(type, arr)
  }
  focus() { /* no-op */ }
  click() {
    if (this.disabled) return
    for (const fn of this._listeners.get('click') ?? []) fn({})
  }
  fireKey(key: string) {
    const ev = { key, preventDefault() { /* no-op */ } }
    for (const fn of this._listeners.get('keydown') ?? []) fn(ev)
  }
  querySelector(sel: string): FakeElement | null {
    return this.querySelectorAll(sel)[0] ?? null
  }
  querySelectorAll(sel: string): FakeElement[] {
    const out: FakeElement[] = []
    const match = (el: FakeElement): boolean => {
      if (sel.startsWith('.')) return el._classes.has(sel.slice(1))
      if (sel.startsWith('#')) return el.id === sel.slice(1)
      const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel)
      if (attr) {
        const v = el.getAttribute(attr[1])
        return attr[2] === undefined ? v !== null : v === attr[2]
      }
      return el.tagName === sel.toUpperCase()
    }
    const walk = (el: FakeElement) => {
      for (const c of el.children) {
        if (match(c)) out.push(c)
        walk(c)
      }
    }
    walk(this)
    return out
  }
}

const doc = {
  head: new FakeElement('head'),
  documentElement: new FakeElement('html'),
  body: new FakeElement('body'),
  createElement: (tag: string) => new FakeElement(tag),
  getElementById: (_id: string) => null as FakeElement | null,
}
;(globalThis as any).document = doc

const { getSettings, hydrateSettings, refreshSettingsPanel } = await import('../state')
const { mountSettingsPanel } = await import('../panel')
const { buildSegmentedControl } = await import('../render')

type El = FakeElement

function mountPanel(): El {
  const host = new FakeElement('div')
  mountSettingsPanel({ ui: { mount: () => host } } as any)
  // Production refreshes the panel after settings hydration (setup.ts);
  // mirror that here so initial disabled/hint state is applied.
  refreshSettingsPanel()
  return host.children[0]
}

function byClass(root: El, cls: string): El[] {
  return root.querySelectorAll('.' + cls)
}

function rowByLabel(root: El, label: string): El {
  for (const row of byClass(root, 'sidebar-ux-panel-row')) {
    const labelEl = row.querySelector('.sidebar-ux-panel-row-label')
    if (labelEl?.textContent === label) return row
  }
  throw new Error(`setting row not found: ${label}`)
}

function control(row: El): El { return row.children[1] }
function hint(row: El): El { return row.querySelector('.sidebar-ux-panel-row-hint')! }

/** The Drawer layout segmented is the first radiogroup in the panel. */
function layoutGroup(root: El): El {
  const groups = byClass(root, 'sidebar-ux-panel-segmented')
  const layout = groups.find((g) => g.getAttribute('aria-label') === 'Drawer layout')
  if (!layout) throw new Error('Drawer layout group not found')
  return layout
}

function modeTiles(root: El): El {
  const modes = root.querySelector('.sidebar-ux-panel-modes')
  if (!modes) throw new Error('mode tiles not found')
  return modes
}

/** selectMode is fire-and-forget async (plan A7) — let its await points run. */
const flushSelectMode = () => new Promise<void>((r) => setTimeout(r, 0))

describe('drawer location panel', () => {
  beforeEach(() => { hydrateSettings(null) })

  test('Sides default: labels + gating', () => {
    const root = mountPanel()
    const group = layoutGroup(root)
    expect(group.getAttribute('role')).toBe('radiogroup')
    const radios = group.children
    expect(radios.length).toBe(3)
    expect(radios[0].textContent).toBe('Sides')
    expect(radios[1].textContent).toBe('Top')
    expect(radios[2].textContent).toBe('Bottom')
    for (const r of radios) expect(r.getAttribute('role')).toBe('radio')
    expect(radios[0].getAttribute('aria-checked')).toBe('true')

    const moveRow = rowByLabel(root, 'Move tab strip to outer edge')
    const hideRow = rowByLabel(root, 'Hide drawer open/close buttons')
    const dndRow = rowByLabel(root, 'Drag and drop tabs')
    expect(control(moveRow).disabled).toBe(false)
    expect(control(hideRow).disabled).toBe(true)
    expect(control(dndRow).disabled).toBe(false)
    expect(moveRow.classList.contains('sidebar-ux-panel-row-disabled')).toBe(false)
    expect(hideRow.classList.contains('sidebar-ux-panel-row-disabled')).toBe(true)
    expect(hint(moveRow).textContent).toContain('Puts the tab strip on the screen edge')
    expect(hint(hideRow).textContent).toContain('Hides the small handle')
  })

  test('selecting Top auto-enables and locks the chrome rows; hide row is inert', () => {
    const root = mountPanel()
    const group = layoutGroup(root)
    group.children[1].click() // Top

    const s = getSettings()
    expect(s.drawerLocation).toBe('top')
    expect(s.taskbarMode).toBe(true)
    expect(s.moveControlsToOuterEdge).toBe(true)
    expect(group.children[1].getAttribute('aria-checked')).toBe('true')
    expect(group.children[0].getAttribute('aria-checked')).toBe('false')

    const moveRow = rowByLabel(root, 'Move tab strip to outer edge')
    const hideRow = rowByLabel(root, 'Hide drawer open/close buttons')
    expect(control(moveRow).disabled).toBe(true)
    expect(moveRow.classList.contains('sidebar-ux-panel-row-disabled')).toBe(true)
    expect(hint(moveRow).textContent).toBe(
      'Locked while Drawer layout is Top or Bottom — the horizontal strip is already edge-anchored.',
    )
    // Hide row renders inert + checked regardless of the stored false.
    expect(control(hideRow).disabled).toBe(true)
    expect(control(hideRow).getAttribute('aria-checked')).toBe('true')
    expect(control(hideRow).classList.contains('sidebar-ux-panel-toggle-on')).toBe(true)
    expect(hint(hideRow).textContent).toContain('Handles are always hidden')
  })

  test('returning to Sides restores the pre-excursion Sides flags (defaults when unset)', () => {
    const root = mountPanel()
    const group = layoutGroup(root)
    group.children[2].click() // Bottom (forces taskbar chrome on)
    group.children[0].click() // Sides

    const s = getSettings()
    expect(s.drawerLocation).toBe('sides')
    // No explicit Sides choice was recorded before the excursion, so the
    // horizontal-forced values are NOT carried back — defaults (off/off).
    expect(s.taskbarMode).toBe(false)
    expect(s.moveControlsToOuterEdge).toBe(false)

    const moveRow = rowByLabel(root, 'Move tab strip to outer edge')
    const hideRow = rowByLabel(root, 'Hide drawer open/close buttons')
    expect(control(moveRow).disabled).toBe(false)
    expect(moveRow.classList.contains('sidebar-ux-panel-row-disabled')).toBe(false)
    expect(hint(moveRow).textContent).toContain('Puts the tab strip on the screen edge')
    // Hide requires taskbar → off + disabled with the normal hint.
    expect(control(hideRow).getAttribute('aria-checked')).toBe('false')
    expect(control(hideRow).disabled).toBe(true)
    expect(hint(hideRow).textContent).toContain('Hides the small handle')
  })

  test('returning to Sides restores flags the user explicitly enabled on Sides', () => {
    const root = mountPanel()
    const group = layoutGroup(root)
    const tiles = modeTiles(root)
    const moveRow = rowByLabel(root, 'Move tab strip to outer edge')
    // Record a deliberate on/on choice while on Sides: outer edge toggle +
    // Taskbar mode tile (which forces the pair).
    control(moveRow).click()
    tiles.children[1].click() // Taskbar
    expect(getSettings().moveControlsToOuterEdge).toBe(true)
    expect(getSettings().taskbarMode).toBe(true)

    group.children[1].click() // Top
    group.children[0].click() // Sides
    const s = getSettings()
    expect(s.drawerLocation).toBe('sides')
    expect(s.taskbarMode).toBe(true)
    expect(s.moveControlsToOuterEdge).toBe(true)
    expect(control(moveRow).disabled).toBe(false)
    const hideRow = rowByLabel(root, 'Hide drawer open/close buttons')
    expect(control(hideRow).disabled).toBe(false)
  })

  test('arrow keys move the radio selection', () => {
    const root = mountPanel()
    const group = layoutGroup(root)
    group.children[0].fireKey('ArrowRight')
    expect(getSettings().drawerLocation).toBe('top')
    expect(group.children[1].getAttribute('aria-checked')).toBe('true')
    group.children[1].fireKey('ArrowRight')
    expect(getSettings().drawerLocation).toBe('bottom')
    group.children[2].fireKey('ArrowRight')
    expect(getSettings().drawerLocation).toBe('sides')
    group.children[0].fireKey('ArrowLeft')
    expect(getSettings().drawerLocation).toBe('bottom')
  })
})

describe('mode tiles', () => {
  beforeEach(() => { hydrateSettings(null) })

  test('derives the effective tile from settings', () => {
    const root = mountPanel()
    const tiles = modeTiles(root)
    expect(tiles.children[0].getAttribute('aria-checked')).toBe('true') // vanilla
    expect(tiles.children[1].getAttribute('aria-checked')).toBe('false')
    expect(tiles.children[2].getAttribute('aria-checked')).toBe('false')
  })

  test('Taskbar tile enables the pair, OS tile enables osMode, Vanilla clears', async () => {
    const root = mountPanel()
    const tiles = modeTiles(root)

    tiles.children[1].click()
    await flushSelectMode()
    expect(getSettings().taskbarMode).toBe(true)
    expect(getSettings().moveControlsToOuterEdge).toBe(true)
    expect(getSettings().osMode).toBe(false)
    refreshSettingsPanel()
    expect(tiles.children[1].getAttribute('aria-checked')).toBe('true')

    tiles.children[2].click()
    await flushSelectMode()
    expect(getSettings().osMode).toBe(true)
    // Normalize invariant forces the chrome on.
    expect(getSettings().taskbarMode).toBe(true)
    expect(getSettings().moveControlsToOuterEdge).toBe(true)
    expect(getSettings().coreTabsHidden).toBe(true)
    refreshSettingsPanel()
    expect(tiles.children[2].getAttribute('aria-checked')).toBe('true')

    tiles.children[0].click()
    await flushSelectMode()
    expect(getSettings().osMode).toBe(false)
    expect(getSettings().taskbarMode).toBe(false)
    expect(getSettings().moveControlsToOuterEdge).toBe(false)
    refreshSettingsPanel()
    expect(tiles.children[0].getAttribute('aria-checked')).toBe('true')
  })

  test('Vanilla from a Top layout auto-returns to Sides', () => {
    const root = mountPanel()
    const group = layoutGroup(root)
    const tiles = modeTiles(root)
    group.children[1].click() // Top
    expect(getSettings().drawerLocation).toBe('top')
    tiles.children[0].click() // Vanilla
    expect(getSettings().drawerLocation).toBe('sides')
    expect(getSettings().taskbarMode).toBe(false)
    expect(getSettings().moveControlsToOuterEdge).toBe(false)
  })

  test('Vanilla clears a stale taskbarMode with the outer edge off (L1)', () => {
    // taskbarMode:true + outer off derives as Vanilla; clicking Vanilla must
    // still clear the stored taskbarMode or re-enabling the edge resurrects
    // Taskbar mode.
    hydrateSettings({ taskbarMode: true, moveControlsToOuterEdge: false })
    const root = mountPanel()
    const tiles = modeTiles(root)
    expect(tiles.children[0].getAttribute('aria-checked')).toBe('true') // derived vanilla
    tiles.children[0].click()
    expect(getSettings().taskbarMode).toBe(false)
    expect(getSettings().moveControlsToOuterEdge).toBe(false)
  })

  test('arrow keys move the tile selection', async () => {
    const root = mountPanel()
    const tiles = modeTiles(root)
    tiles.children[0].fireKey('ArrowRight')
    await flushSelectMode()
    expect(getSettings().taskbarMode).toBe(true)
    expect(tiles.children[1].getAttribute('aria-checked')).toBe('true')
    tiles.children[1].fireKey('ArrowRight')
    await flushSelectMode()
    expect(getSettings().osMode).toBe(true)
    tiles.children[2].fireKey('ArrowRight')
    await flushSelectMode()
    expect(getSettings().taskbarMode).toBe(false)
    expect(getSettings().osMode).toBe(false)
  })

  // ── A7-1: a restoring tile guards the Configure dirty draft ──
  test('tile cancel snaps back; clean proceeds (no dialog when clean)', async () => {
    // Cancel: entering OS with a restorable slot + dirty draft → guard
    // cancels → settings unchanged, tile still derives vanilla.
    entrySlotHasTabs = true
    guardChoice = 'cancel'
    guardCalls = 0
    hydrateSettings(null)
    let root = mountPanel()
    let tiles = modeTiles(root)
    tiles.children[2].click() // OS
    await flushSelectMode()
    expect(guardCalls).toBe(1)
    expect(getSettings().osMode).toBe(false) // snapped back — no patch
    expect(tiles.children[2].getAttribute('aria-checked')).toBe('false')
    expect(tiles.children[0].getAttribute('aria-checked')).toBe('true')

    // Proceed: guard clean → the patch runs normally (may refresh mid-flight).
    guardChoice = 'proceed'
    guardCalls = 0
    root = mountPanel()
    tiles = modeTiles(root)
    tiles.children[2].click()
    await flushSelectMode()
    expect(guardCalls).toBe(1)
    expect(getSettings().osMode).toBe(true)

    // Leaving OS with a restorable non-OS slot: exit guard consulted too.
    exitSlotHasTabs = true
    guardChoice = 'cancel'
    guardCalls = 0
    root = mountPanel()
    tiles = modeTiles(root)
    tiles.children[0].click() // Vanilla while OS on
    await flushSelectMode()
    expect(guardCalls).toBe(1)
    expect(getSettings().osMode).toBe(true) // cancel keeps OS on
    entrySlotHasTabs = false
    exitSlotHasTabs = false
    guardChoice = 'proceed'
  })

  test('tile without a restorable slot skips the guard entirely', async () => {
    entrySlotHasTabs = false
    exitSlotHasTabs = false
    guardCalls = 0
    hydrateSettings(null)
    const root = mountPanel()
    const tiles = modeTiles(root)
    tiles.children[2].click() // OS
    await flushSelectMode()
    expect(guardCalls).toBe(0)
    expect(getSettings().osMode).toBe(true) // no guard → direct patch
  })
})

describe('buildSegmentedControl disabled seam', () => {
  test('setDisabled disables every option + aria-disabled', () => {
    let picked = ''
    const handle = buildSegmentedControl(
      [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ] as const,
      'a',
      (v) => { picked = v },
    )
    const btns = handle.root.children as unknown as FakeElement[]
    handle.setDisabled(true)
    for (const btn of btns) {
      expect(btn.disabled).toBe(true)
      expect(btn.getAttribute('aria-disabled')).toBe('true')
    }
    btns[1].click()
    expect(picked).toBe('')
    handle.setDisabled(false)
    btns[1].click()
    expect(picked).toBe('b')
  })
})
