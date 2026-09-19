// Help tooltip (`?` popover) tests — settings/render.ts + its panel wiring.
//
// Verifies: every setting row carries a help button; clicking opens the
// body-level popover with the row's hint text; clicking again (or Esc via the
// same button) closes; dynamic lock hints are read at open time; dispose
// removes the popover (remount/extension-disable leak guard).

import { describe, test, expect, mock, beforeEach } from 'bun:test'

const featureList: Array<{ id: string; apply?: (...args: unknown[]) => void }> = []

mock.module('../../features/registry', () => ({
  FEATURES: featureList,
  alwaysCleanups: () => [],
}))

class FakeEl {
  tagName: string
  id = ''
  textContent = ''
  type = ''
  disabled = false
  hidden = false
  tabIndex = 0
  style: Record<string, string> = {}
  children: FakeEl[] = []
  parentElement: FakeEl | null = null
  private _classes = new Set<string>()
  private _attrs = new Map<string, string>()
  private _listeners = new Map<string, Array<(ev: any) => void>>()

  constructor(tag: string) { this.tagName = tag.toUpperCase() }

  get className() { return [...this._classes].join(' ') }
  set className(v: string) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)) }

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
  appendChild(child: FakeEl) { child.parentElement = this; this.children.push(child); return child }
  replaceChildren() { this.children = [] }
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
    for (const fn of this._listeners.get('click') ?? []) fn({ preventDefault() {}, stopPropagation() {} })
  }
  focus() {
    for (const fn of this._listeners.get('focus') ?? []) fn({})
  }
  fireKey(key: string) {
    const ev = { key, preventDefault() {}, stopPropagation() {} }
    for (const fn of this._listeners.get('keydown') ?? []) fn(ev)
  }
  querySelector(sel: string): FakeEl | null { return this.querySelectorAll(sel)[0] ?? null }
  querySelectorAll(sel: string): FakeEl[] {
    const out: FakeEl[] = []
    const match = (el: FakeEl): boolean => {
      if (sel.startsWith('.')) return el._classes.has(sel.slice(1))
      if (sel.startsWith('#')) return el.id === sel.slice(1)
      const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel)
      if (attr) {
        const v = el.getAttribute(attr[1])
        return attr[2] === undefined ? v !== null : v === attr[2]
      }
      return el.tagName === sel.toUpperCase()
    }
    const walk = (el: FakeEl) => { for (const c of el.children) { if (match(c)) out.push(c); walk(c) } }
    walk(this)
    return out
  }
}

const doc = {
  head: new FakeEl('head'),
  documentElement: new FakeEl('html'),
  body: new FakeEl('body'),
  createElement: (tag: string) => new FakeEl(tag),
  getElementById: (_id: string) => null as FakeEl | null,
}
;(globalThis as any).document = doc

const { getSettings, hydrateSettings, refreshSettingsPanel, setSettings } = await import('../state')
const { mountSettingsPanel } = await import('../panel')
const { disposeHelpLayer, getHelpPopover } = await import('../render')

type El = FakeEl

function mountPanel(): El {
  const host = new FakeEl('div')
  mountSettingsPanel({ ui: { mount: () => host } } as any)
  refreshSettingsPanel()
  return host.children[0]
}

function byClass(root: El, cls: string): El[] { return root.querySelectorAll('.' + cls) }

function rowByLabel(root: El, label: string): El {
  for (const row of byClass(root, 'sidebar-ux-panel-row')) {
    if (row.querySelector('.sidebar-ux-panel-row-label')?.textContent === label) return row
  }
  throw new Error(`setting row not found: ${label}`)
}

function popover(): El | null {
  return doc.body.querySelector('.sidebar-ux-help-popover')
}

describe('panel help tooltips', () => {
  beforeEach(() => {
    hydrateSettings(null)
    disposeHelpLayer()
    featureList.length = 0
  })

  test('every setting row carries a help button', () => {
    const root = mountPanel()
    const rows = byClass(root, 'sidebar-ux-panel-row')
    expect(rows.length).toBeGreaterThan(0)
    // Every row carries one; the mode-tiles group adds its own help button
    // outside any row (L5 2026-09-19).
    for (const row of rows) {
      expect(row.querySelector('.sidebar-ux-panel-help')).not.toBeNull()
    }
  })

  test('click opens the popover with the hint text; second click closes', () => {
    const root = mountPanel()
    const help = rowByLabel(root, 'Move tab strip to outer edge').querySelector('.sidebar-ux-panel-help')!
    expect(help.getAttribute('aria-expanded')).toBe('false')

    help.click()
    const pop = popover()
    expect(pop).not.toBeNull()
    expect(pop!.textContent).toContain('Puts the tab strip on the screen edge')
    expect(help.getAttribute('aria-expanded')).toBe('true')
    expect(help.getAttribute('aria-describedby')).toBe('sidebar-ux-help-popover')

    help.click()
    expect(help.getAttribute('aria-expanded')).toBe('false')
    expect(pop!.hidden).toBe(true)
  })

  test('dynamic lock hints are read at open time', () => {
    const root = mountPanel()
    const help = rowByLabel(root, 'Move tab strip to outer edge').querySelector('.sidebar-ux-panel-help')!

    setSettings({ drawerLocation: 'top' })
    help.click()
    expect(popover()!.textContent).toBe(
      'Locked while Drawer layout is Top or Bottom — the horizontal strip is already edge-anchored.',
    )
  })

  test('Escape on the help button closes the popover', () => {
    const root = mountPanel()
    const help = rowByLabel(root, 'Drawer layout').querySelector('.sidebar-ux-panel-help')!
    help.click()
    expect(popover()!.hidden).toBe(false)
    help.fireKey('Escape')
    expect(popover()!.hidden).toBe(true)
    expect(help.getAttribute('aria-expanded')).toBe('false')
  })

  test('focus-then-click (touch tap) keeps the popover open; next tap closes (M4)', () => {
    const root = mountPanel()
    const help = rowByLabel(root, 'Move tab strip to outer edge').querySelector('.sidebar-ux-panel-help')!

    // Coarse-pointer tap: focus fires before click.
    help.focus()
    expect(getHelpPopover()!.hidden).toBe(false)
    help.click()
    expect(getHelpPopover()!.hidden).toBe(false)
    expect(help.getAttribute('aria-expanded')).toBe('true')

    // Second tap: no new focus event, click closes.
    help.click()
    expect(getHelpPopover()!.hidden).toBe(true)
    expect(help.getAttribute('aria-expanded')).toBe('false')
  })

  test('a throwing feature apply does not block the panel refresh (N3)', () => {
    const root = mountPanel()
    featureList.push({
      id: 'debugMode',
      apply: () => { throw new Error('boom') },
    })
    // setSettings must not throw, and the panel must still reflect the value.
    setSettings({ debugMode: true })
    expect(getSettings().debugMode).toBe(true)
    const toggle = rowByLabel(root, 'Debug mode').querySelector('.sidebar-ux-panel-toggle')!
    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })

  test('re-mount disposes the previous popover (no leak)', () => {
    const rootA = mountPanel()
    rowByLabel(rootA, 'Drawer layout').querySelector('.sidebar-ux-panel-help')!.click()
    expect(popover()).not.toBeNull()

    const rootB = mountPanel()
    rowByLabel(rootB, 'Drawer layout').querySelector('.sidebar-ux-panel-help')!.click()
    // Exactly one popover node in the body after the remount.
    expect(doc.body.querySelectorAll('.sidebar-ux-help-popover').length).toBe(1)
  })
})
