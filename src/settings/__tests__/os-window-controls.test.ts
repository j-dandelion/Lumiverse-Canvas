// osWindowControls (2026-09-16): the OS panel header shows both the injected
// minimize ("–") control and the close ("X") while ON (default). When OFF,
// only the X remains and it MINIMIZES (vanilla Lumiverse drawer behavior);
// OS-close stays available from the tab button context menu.
//
// Covers setting semantics (default, merge passthrough, OS off/on survival,
// osChromePrefs non-involvement), the REAL settings-panel row (locked while OS
// mode is off, hint swap, click writes the setting), and source pins for the
// chrome gating + feature wiring — the applySettings diff contract keys on
// feature.id, so the setting needs its own feature entry, and the X branch
// must read the setting per click.
//
// DOM stubs follow the repo convention (see drawer-location-panel.test.ts).

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

describe('osWindowControls semantics', () => {
  beforeEach(() => { hydrateSettings(null) })

  test('defaults to on for new and legacy blobs', () => {
    expect(getSettings().osWindowControls).toBe(true)
    expect(mergeCanvasSettings(null).osWindowControls).toBe(true)
    expect(mergeCanvasSettings({}).osWindowControls).toBe(true)
  })

  test('explicit value round-trips; the OS invariant does not touch it', () => {
    expect(mergeCanvasSettings({ osWindowControls: false }).osWindowControls).toBe(false)
    expect(
      mergeCanvasSettings({ osMode: true, osWindowControls: false }).osWindowControls,
    ).toBe(false)
    const n = normalizeCanvasSettingsFields(
      mergeCanvasSettings({ osMode: true, osWindowControls: false }),
    )
    expect(n.osWindowControls).toBe(false)
  })

  test('survives OS off/on and is never snapshotted into osChromePrefs', () => {
    hydrateSettings({ osMode: false, osWindowControls: false })
    expect(getSettings().osWindowControls).toBe(false)

    setSettings({ osMode: true })
    expect(getSettings().osWindowControls).toBe(false)
    expect((getSettings().osChromePrefs as any)?.osWindowControls).toBeUndefined()

    setSettings({ osMode: false })
    expect(getSettings().osWindowControls).toBe(false)
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
    const labelEl = row.querySelector('.sidebar-ux-panel-row-label')
    if (labelEl?.textContent === label) return row
  }
  throw new Error(`setting row not found: ${label}`)
}

function control(row: El): El { return row.children[1] }
function hint(row: El): El { return row.querySelector('.sidebar-ux-panel-row-hint')! }

describe('osWindowControls panel row', () => {
  beforeEach(() => { hydrateSettings(null) })

  test('locked while OS mode is off', () => {
    hydrateSettings({ osMode: false, osWindowControls: true })
    const root = mountPanel()
    const row = rowByLabel(root, 'Separate minimize and close controls')
    expect(control(row).disabled).toBe(true)
    expect(row.classList.contains('sidebar-ux-panel-row-disabled')).toBe(true)
    expect(hint(row).textContent).toContain('Requires OS mode')
  })

  test('enabled with OS mode on; click writes the setting', () => {
    hydrateSettings({ osMode: true, osWindowControls: true })
    const root = mountPanel()
    const row = rowByLabel(root, 'Separate minimize and close controls')
    expect(control(row).disabled).toBe(false)
    expect(control(row).getAttribute('aria-checked')).toBe('true')
    expect(hint(row).textContent).toContain('– (minimize) and X (close)')

    control(row).click()
    expect(getSettings().osWindowControls).toBe(false)
    expect(control(row).getAttribute('aria-checked')).toBe('false')
    // The off-hint must state the vanilla minimize behavior.
    expect(hint(row).textContent).toContain('minimizes')
  })

  test('OS mode flip re-locks the row in place via refresh', () => {
    hydrateSettings({ osMode: true })
    const root = mountPanel()
    const row = rowByLabel(root, 'Separate minimize and close controls')
    expect(control(row).disabled).toBe(false)

    setSettings({ osMode: false })
    expect(control(row).disabled).toBe(true)
    expect(row.classList.contains('sidebar-ux-panel-row-disabled')).toBe(true)
    expect(hint(row).textContent).toContain('Requires OS mode')
  })
})

// ── Source pins (chrome gating + feature wiring + unconditional Close) ───────

const panelChromeSrc = readFileSync(join(process.cwd(), 'src/os/panel-chrome.ts'), 'utf8')
const registrySrc = readFileSync(join(process.cwd(), 'src/features/registry.ts'), 'utf8')
const panelSrc = readFileSync(join(process.cwd(), 'src/settings/panel.ts'), 'utf8')
const contextMenuSrc = readFileSync(join(process.cwd(), 'src/context-menu/index.ts'), 'utf8')
const tabContextMenuSrc = readFileSync(join(process.cwd(), 'src/tabs/tab-context-menu.ts'), 'utf8')

describe('osWindowControls source pins', () => {
  test('minimize injection/removal is gated on the setting', () => {
    expect(panelChromeSrc).toContain('getSettings().osWindowControls')
    expect(panelChromeSrc).toContain('if (!getSettings().osWindowControls && minBtn)')
    // Removal must not touch the shell-owned close button.
    expect(panelChromeSrc).toContain('minBtn.remove()')
  })

  test('X branch minimizes while the setting is off', () => {
    expect(panelChromeSrc).toContain('void closeWindowByLiveId(liveId)')
    expect(panelChromeSrc).toContain('void minimizeWindowByLiveId(liveId, side)')
    expect(panelChromeSrc).toContain('applyOsWindowControlsChange')
  })

  test('registry wires the setting as its own feature id', () => {
    expect(registrySrc).toContain("id: 'osWindowControls'")
    expect(registrySrc).toContain('applyOsWindowControlsChange()')
    expect(registrySrc).toContain('osWindowControlsFeature')
  })

  test('panel exposes the row, writes the setting, and locks it', () => {
    expect(panelSrc).toContain("label: 'Separate minimize and close controls'")
    expect(panelSrc).toContain('setSettings({ osWindowControls: v })')
    expect(panelSrc).toContain('const d = !s.osMode')
  })

  test('context-menu Close stays unconditional (not gated by the setting)', () => {
    expect(contextMenuSrc).not.toContain('osWindowControls')
    expect(tabContextMenuSrc).not.toContain('osWindowControls')
    expect(contextMenuSrc).toContain('closeWindowByLiveId')
    expect(tabContextMenuSrc).toContain('closeWindowByLiveId')
  })
})
