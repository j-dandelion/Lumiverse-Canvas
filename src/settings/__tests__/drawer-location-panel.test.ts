// Drawer location panel control + gating (S8 / WS1).
//
// Drives the REAL settings panel with a minimal DOM stub and a mocked
// features registry (the live-apply fan-out is irrelevant here). Asserts:
// segmented-control aria state, taskbar/outer-edge locks, the hide row's
// inert mode, dynamic hint text, arrow-key selection, and the disabled
// seam exposed by the control handle (pre-hydration guard).
//
// DOM stubs follow the repo convention (see
// src/settings/__tests__/disable-content-stuck-repro.test.ts): hand-rolled
// elements, no jsdom.

import { describe, test, expect, mock, beforeEach } from 'bun:test'

// The panel's applySettings fan-out imports the feature graph; the panel DOM
// under test never needs it.
mock.module('../../features/registry', () => ({
  FEATURES: [],
  alwaysCleanups: () => [],
}))

class FakeElement {
  tagName: string
  id = ''
  textContent = ''
  type = ''
  disabled = false
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
    const labelEl = row.children[0]?.children[0]
    if (labelEl?.textContent === label) return row
  }
  throw new Error(`setting row not found: ${label}`)
}

function control(row: El): El { return row.children[1] }
function hint(row: El): El { return row.querySelector('.sidebar-ux-panel-row-hint')! }

describe('drawer location panel (WS1)', () => {
  beforeEach(() => { hydrateSettings(null) })

  test('Sides default: radiogroup aria, taskbar rows gated by stored settings, DnD enabled', () => {
    const root = mountPanel()
    const group = root.querySelector('.sidebar-ux-panel-segmented')!
    expect(group.getAttribute('role')).toBe('radiogroup')
    expect(group.getAttribute('aria-label')).toBe('Drawer location')
    const radios = group.children
    expect(radios.length).toBe(3)
    expect(radios[0].textContent).toBe('Sides')
    expect(radios[1].textContent).toBe('Top')
    expect(radios[2].textContent).toBe('Bottom')
    for (const r of radios) expect(r.getAttribute('role')).toBe('radio')
    expect(radios[0].getAttribute('aria-checked')).toBe('true')
    expect(radios[1].getAttribute('aria-checked')).toBe('false')
    expect(radios[2].getAttribute('aria-checked')).toBe('false')

    const moveRow = rowByLabel(root, 'Move tab controls to outer edge')
    const taskbarRow = rowByLabel(root, 'Taskbar mode')
    const hideRow = rowByLabel(root, 'Hide drawer open/close buttons')
    const dndRow = rowByLabel(root, 'Drag and drop drawer tabs')
    expect(control(moveRow).disabled).toBe(false)
    expect(control(taskbarRow).disabled).toBe(true)
    expect(control(hideRow).disabled).toBe(true)
    expect(control(dndRow).disabled).toBe(false)
    expect(moveRow.classList.contains('sidebar-ux-panel-row-disabled')).toBe(false)
    expect(taskbarRow.classList.contains('sidebar-ux-panel-row-disabled')).toBe(true)
    expect(hint(moveRow).textContent).toContain('Moves the list of tab buttons')
    expect(hint(taskbarRow).textContent).toContain('Pins tab buttons to the screen edge')
  })

  test('selecting Top auto-enables and locks the taskbar rows; hide row is inert', () => {
    const root = mountPanel()
    const group = root.querySelector('.sidebar-ux-panel-segmented')!
    group.children[1].click() // Top

    const s = getSettings()
    expect(s.drawerLocation).toBe('top')
    expect(s.taskbarMode).toBe(true)
    expect(s.moveControlsToOuterEdge).toBe(true)
    expect(group.children[1].getAttribute('aria-checked')).toBe('true')
    expect(group.children[0].getAttribute('aria-checked')).toBe('false')

    const moveRow = rowByLabel(root, 'Move tab controls to outer edge')
    const taskbarRow = rowByLabel(root, 'Taskbar mode')
    const hideRow = rowByLabel(root, 'Hide drawer open/close buttons')
    const dndRow = rowByLabel(root, 'Drag and drop drawer tabs')
    expect(control(moveRow).disabled).toBe(true)
    expect(moveRow.classList.contains('sidebar-ux-panel-row-disabled')).toBe(true)
    expect(control(taskbarRow).disabled).toBe(true)
    expect(taskbarRow.classList.contains('sidebar-ux-panel-row-disabled')).toBe(true)
    expect(hint(moveRow).textContent).toBe(
      'Required by Drawer location: Top/Bottom. Switch to Sides to change.',
    )
    expect(hint(taskbarRow).textContent).toBe(
      'Required by Drawer location: Top/Bottom. Switch to Sides to change.',
    )
    // Hide row renders inert + checked regardless of the stored false.
    expect(control(hideRow).disabled).toBe(true)
    expect(control(hideRow).getAttribute('aria-checked')).toBe('true')
    expect(control(hideRow).classList.contains('sidebar-ux-panel-toggle-on')).toBe(true)
    expect(hint(hideRow).textContent).toContain('Handles are hidden')
    // DnD stays enabled (desktop fine-pointer only is a runtime gate).
    expect(control(dndRow).disabled).toBe(false)
  })

  test('returning to Sides unlocks rows and restores the stored hide value', () => {
    const root = mountPanel()
    const group = root.querySelector('.sidebar-ux-panel-segmented')!
    group.children[2].click() // Bottom
    group.children[0].click() // Sides

    const s = getSettings()
    expect(s.drawerLocation).toBe('sides')
    // Returning to sides leaves the auto-enabled flags on.
    expect(s.taskbarMode).toBe(true)
    expect(s.moveControlsToOuterEdge).toBe(true)

    const moveRow = rowByLabel(root, 'Move tab controls to outer edge')
    const taskbarRow = rowByLabel(root, 'Taskbar mode')
    const hideRow = rowByLabel(root, 'Hide drawer open/close buttons')
    expect(control(moveRow).disabled).toBe(false)
    expect(moveRow.classList.contains('sidebar-ux-panel-row-disabled')).toBe(false)
    expect(control(taskbarRow).disabled).toBe(false)
    expect(hint(moveRow).textContent).toContain('Moves the list of tab buttons')
    expect(hint(taskbarRow).textContent).toContain('Pins tab buttons to the screen edge')
    // Stored hide value is false, so the row shows off + enabled (taskbar on).
    expect(control(hideRow).getAttribute('aria-checked')).toBe('false')
    expect(control(hideRow).disabled).toBe(false)
    expect(hint(hideRow).textContent).toContain('Hides the small button')
  })

  test('arrow keys move the radio selection', () => {
    const root = mountPanel()
    const group = root.querySelector('.sidebar-ux-panel-segmented')!
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
