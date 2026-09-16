// osSecondaryStartMenu (2026-09-16): the second drawer's OS-mode Start
// button/menu is opt-in (default OFF). Covers setting semantics (default,
// merge passthrough, OS off/on survival, osChromePrefs non-involvement,
// normalize no-op), the REAL settings-panel row (locked while OS mode is off
// or the second drawer is disabled, hint swap, click writes the setting), and
// source pins for the chrome gating + feature wiring — the applySettings diff
// contract keys on feature.id, so the setting needs its own feature entry,
// and the secondary ensure/removal paths must stay gated.
//
// DOM stubs follow the repo convention (see drawer-location-panel.test.ts):
// hand-rolled elements, no jsdom.

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

// The panel's applySettings fan-out imports the feature graph; the panel DOM
// under test never needs it (the source pins read registry.ts from disk).
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

const { getSettings, hydrateSettings, refreshSettingsPanel, setSettings } = await import('../state')
const { mergeCanvasSettings, normalizeCanvasSettingsFields } = await import('../../types')
const { mountSettingsPanel } = await import('../panel')

type El = FakeElement

// ── Setting semantics ────────────────────────────────────────────────────────

describe('osSecondaryStartMenu semantics', () => {
  beforeEach(() => { hydrateSettings(null) })

  test('defaults to off for new and legacy blobs', () => {
    expect(getSettings().osSecondaryStartMenu).toBe(false)
    expect(mergeCanvasSettings(null).osSecondaryStartMenu).toBe(false)
    expect(mergeCanvasSettings({}).osSecondaryStartMenu).toBe(false)
  })

  test('explicit value round-trips; the OS invariant does not touch it', () => {
    expect(mergeCanvasSettings({ osSecondaryStartMenu: true }).osSecondaryStartMenu).toBe(true)
    expect(
      mergeCanvasSettings({ osMode: true, osSecondaryStartMenu: false }).osSecondaryStartMenu,
    ).toBe(false)
    const n = normalizeCanvasSettingsFields(
      mergeCanvasSettings({ osMode: true, osSecondaryStartMenu: false }),
    )
    expect(n.osSecondaryStartMenu).toBe(false)
  })

  test('survives OS off/on and is never snapshotted into osChromePrefs', () => {
    hydrateSettings({ osMode: false, osSecondaryStartMenu: true })
    expect(getSettings().osSecondaryStartMenu).toBe(true)

    setSettings({ osMode: true })
    expect(getSettings().osSecondaryStartMenu).toBe(true)
    expect((getSettings().osChromePrefs as any)?.osSecondaryStartMenu).toBeUndefined()

    setSettings({ osMode: false })
    expect(getSettings().osSecondaryStartMenu).toBe(true)
  })
})

// ── Real panel row ───────────────────────────────────────────────────────────

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

describe('osSecondaryStartMenu panel row', () => {
  beforeEach(() => { hydrateSettings(null) })

  test('locked while OS mode is off', () => {
    hydrateSettings({ osMode: false, secondSidebarEnabled: true, osSecondaryStartMenu: true })
    const root = mountPanel()
    const row = rowByLabel(root, 'Start menu in the second drawer')
    expect(control(row).disabled).toBe(true)
    expect(row.classList.contains('sidebar-ux-panel-row-disabled')).toBe(true)
    expect(hint(row).textContent).toContain('Requires OS mode and the second drawer')
  })

  test('locked while the second drawer is disabled', () => {
    hydrateSettings({ osMode: true, secondSidebarEnabled: false })
    const root = mountPanel()
    const row = rowByLabel(root, 'Start menu in the second drawer')
    expect(control(row).disabled).toBe(true)
    expect(hint(row).textContent).toContain('Requires OS mode and the second drawer')
  })

  test('enabled with OS mode + second drawer on; click writes the setting', () => {
    hydrateSettings({ osMode: true, secondSidebarEnabled: true, osSecondaryStartMenu: false })
    const root = mountPanel()
    const row = rowByLabel(root, 'Start menu in the second drawer')
    expect(control(row).disabled).toBe(false)
    expect(control(row).getAttribute('aria-checked')).toBe('false')
    expect(hint(row).textContent).toContain('Off by default')

    control(row).click()
    expect(getSettings().osSecondaryStartMenu).toBe(true)
    expect(control(row).getAttribute('aria-checked')).toBe('true')
  })

  test('OS mode flip re-locks the row in place via refresh', () => {
    hydrateSettings({ osMode: true, secondSidebarEnabled: true })
    const root = mountPanel()
    const row = rowByLabel(root, 'Start menu in the second drawer')
    expect(control(row).disabled).toBe(false)

    setSettings({ osMode: false })
    expect(control(row).disabled).toBe(true)
    expect(row.classList.contains('sidebar-ux-panel-row-disabled')).toBe(true)
    expect(hint(row).textContent).toContain('Requires OS mode')
  })
})

// ── Source pins (chrome gating + feature wiring) ─────────────────────────────

const startMenuSrc = readFileSync(join(process.cwd(), 'src/os/start-menu.ts'), 'utf8')
const registrySrc = readFileSync(join(process.cwd(), 'src/features/registry.ts'), 'utf8')
const panelSrc = readFileSync(join(process.cwd(), 'src/settings/panel.ts'), 'utf8')

describe('osSecondaryStartMenu source pins', () => {
  test('secondary ensure is gated on the setting', () => {
    expect(startMenuSrc).toContain(
      'getSettings().secondSidebarEnabled && getSettings().osSecondaryStartMenu',
    )
  })

  test('apply hook exists and no-ops without OS mode', () => {
    expect(startMenuSrc).toContain('export function applySecondaryStartMenuChange(')
    expect(startMenuSrc).toContain('if (!isOsModeEnabled()) return')
  })

  test('removal is document-wide for docks, list-scoped for the button', () => {
    expect(startMenuSrc).toContain('document.querySelectorAll(`.${SECONDARY_START_DOCK_CLASS}`)')
    expect(startMenuSrc).toContain('getSecondaryTabList()?.querySelector(`button[${START_ATTR}]`)?.remove()')
    // The lifecycle pin literal must survive the extraction.
    expect(startMenuSrc).toContain("if (_menuOpenFor === 'secondary') hideStartMenu({ immediate: true })")
  })

  test('runtime mount self-registers a teardown (disable-leak fix)', () => {
    expect(startMenuSrc).toContain('registerCleanup(teardownStartMenu)')
  })

  test('registry wires the setting as its own feature id', () => {
    expect(registrySrc).toContain("id: 'osSecondaryStartMenu'")
    expect(registrySrc).toContain('applySecondaryStartMenuChange(next.osSecondaryStartMenu)')
    expect(registrySrc).toContain(
      "import { applySecondaryStartMenuChange, hideStartMenu, mountStartMenu, teardownStartMenu } from '../os/start-menu'",
    )
  })

  test('panel exposes the row, writes the setting, and locks it', () => {
    expect(panelSrc).toContain("label: 'Start menu in the second drawer'")
    expect(panelSrc).toContain('setSettings({ osSecondaryStartMenu: v })')
    expect(panelSrc).toContain('!getSettings().osMode || !getSettings().secondSidebarEnabled')
  })
})
