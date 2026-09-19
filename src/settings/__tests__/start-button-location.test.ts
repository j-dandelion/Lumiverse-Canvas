// startButtonLocation (2026-09-19, replaces osSecondaryStartMenu): which
// drawer(s) show the OS-mode Start button. Covers setting semantics (default
// null = main drawer, legacy boolean migration, enum coercion, OS off/on
// survival, osChromePrefs non-involvement), the REAL settings-panel row
// (locked while OS mode is off, hint swap, click writes the setting), and
// source pins for the location-resolved chrome + feature wiring — the
// applySettings diff contract keys on feature.id, so the setting needs its own
// feature entry.
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

const { getSettings, hydrateSettings, refreshSettingsPanel, setSettings } = await import('../state')
const { mergeCanvasSettings, normalizeCanvasSettingsFields } = await import('../../types')
const { mountSettingsPanel } = await import('../panel')

type El = FakeElement

// ── Setting semantics ────────────────────────────────────────────────────────

describe('startButtonLocation semantics', () => {
  beforeEach(() => { hydrateSettings(null) })

  test('defaults to null (main drawer only) for new blobs', () => {
    expect(getSettings().startButtonLocation).toBe(null)
    expect(mergeCanvasSettings(null).startButtonLocation).toBe(null)
    expect(mergeCanvasSettings({}).startButtonLocation).toBe(null)
  })

  test('legacy osSecondaryStartMenu migrates: true → both, false → null', () => {
    const legacyOn = mergeCanvasSettings({ osSecondaryStartMenu: true } as any)
    expect(legacyOn.startButtonLocation).toBe('both')
    const legacyOff = mergeCanvasSettings({ osSecondaryStartMenu: false } as any)
    expect(legacyOff.startButtonLocation).toBe(null)
    // Explicit new value wins over the legacy key.
    const both = mergeCanvasSettings({ startButtonLocation: 'left', osSecondaryStartMenu: true } as any)
    expect(both.startButtonLocation).toBe('left')
  })

  test('explicit values round-trip; unknown disk values coerce to null', () => {
    expect(mergeCanvasSettings({ startButtonLocation: 'left' }).startButtonLocation).toBe('left')
    expect(mergeCanvasSettings({ startButtonLocation: 'right' }).startButtonLocation).toBe('right')
    expect(mergeCanvasSettings({ startButtonLocation: 'both' }).startButtonLocation).toBe('both')
    const corrupt = normalizeCanvasSettingsFields(
      mergeCanvasSettings({ startButtonLocation: 'middle' as any }),
    )
    expect(corrupt.startButtonLocation).toBe(null)
  })

  test('survives OS off/on and is never snapshotted into osChromePrefs', () => {
    hydrateSettings({ osMode: false, startButtonLocation: 'both' })
    expect(getSettings().startButtonLocation).toBe('both')

    setSettings({ osMode: true })
    expect(getSettings().startButtonLocation).toBe('both')
    expect((getSettings().osChromePrefs as any)?.startButtonLocation).toBeUndefined()

    setSettings({ osMode: false })
    expect(getSettings().startButtonLocation).toBe('both')
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

describe('startButtonLocation panel row', () => {
  beforeEach(() => { hydrateSettings(null) })

  test('locked while OS mode is off', () => {
    hydrateSettings({ osMode: false, secondSidebarEnabled: true, startButtonLocation: 'both' })
    const root = mountPanel()
    const row = rowByLabel(root, 'Start button location')
    expect(control(row).disabled).toBe(true)
    expect(row.classList.contains('sidebar-ux-panel-row-disabled')).toBe(true)
    expect(hint(row).textContent).toContain('Requires OS mode')
  })

  test('enabled with OS mode on; selection reflects the stored location', () => {
    hydrateSettings({ osMode: true, secondSidebarEnabled: true, startButtonLocation: 'both' })
    const root = mountPanel()
    const row = rowByLabel(root, 'Start button location')
    expect(control(row).disabled).toBe(false)
    expect(hint(row).textContent).toContain('which drawer shows the Start button')
    const selected = Array.from(control(row).children as unknown as El[])
      .filter((b) => b.getAttribute('aria-checked') === 'true')
    expect(selected.length).toBe(1)
    expect(selected[0].textContent).toBe('Both')

    // Click the Left drawer option → setting writes 'left'.
    const left = (control(row).children as unknown as El[])[0]
    left.click()
    expect(getSettings().startButtonLocation).toBe('left')
  })

  test('OS mode flip re-locks the row in place via refresh', () => {
    hydrateSettings({ osMode: true, secondSidebarEnabled: true })
    const root = mountPanel()
    const row = rowByLabel(root, 'Start button location')
    expect(control(row).disabled).toBe(false)

    setSettings({ osMode: false })
    expect(control(row).disabled).toBe(true)
    expect(row.classList.contains('sidebar-ux-panel-row-disabled')).toBe(true)
    expect(hint(row).textContent).toContain('Requires OS mode')
  })
})

// ── Source pins (location-resolved chrome + feature wiring) ──────────────────

const startMenuSrc = readFileSync(join(process.cwd(), 'src/os/start-menu.ts'), 'utf8')
const registrySrc = readFileSync(join(process.cwd(), 'src/features/registry.ts'), 'utf8')
const panelSrc = readFileSync(join(process.cwd(), 'src/settings/panel.ts'), 'utf8')
const chromeLocSrc = readFileSync(join(process.cwd(), 'src/os/chrome-locations.ts'), 'utf8')

describe('startButtonLocation source pins', () => {
  test('ensure pass resolves the location set (no boolean gate left)', () => {
    expect(startMenuSrc).toContain('resolveChromeSides(')
    expect(startMenuSrc).toContain('getSettings().startButtonLocation')
    expect(startMenuSrc).not.toContain('osSecondaryStartMenu')
  })

  test('apply hook exists and no-ops without OS mode', () => {
    expect(startMenuSrc).toContain('export function applyStartButtonLocationChange(')
    expect(startMenuSrc).toContain('if (!isOsModeEnabled()) return')
  })

  test('per-side removal is stamped and dock-empty-safe (gear may remain)', () => {
    expect(startMenuSrc).toContain("START_SIDE_ATTR")
    expect(startMenuSrc).toContain('if (!dock.firstElementChild) dock.remove()')
    expect(startMenuSrc).toContain("if (_menuOpenFor === side) hideStartMenu({ immediate: true })")
  })

  test('runtime mount self-registers a teardown (disable-leak fix)', () => {
    expect(startMenuSrc).toContain('registerCleanup(teardownStartMenu)')
  })

  test('registry wires the setting as its own unconditional feature id', () => {
    expect(registrySrc).toContain("id: 'startButtonLocation'")
    expect(registrySrc).toContain('applyStartButtonLocationChange()')
    expect(registrySrc).toContain('startButtonLocationFeature')
    expect(registrySrc).toContain("import { applyStartButtonLocationChange, hideStartMenu, mountStartMenu, teardownStartMenu } from '../os/start-menu'")
  })

  test('chrome lifecycle fans out through the unified reconcile', () => {
    expect(chromeLocSrc).toContain('export function reconcileChromeLocations(')
    expect(chromeLocSrc).toContain('resolveChromeSides(s.optionsButtonLocation')
    expect(registrySrc).toContain('reconcileChromeLocations()')
  })

  test('panel exposes the row, writes the setting, and locks it', () => {
    expect(panelSrc).toContain("label: 'Start button location'")
    expect(panelSrc).toContain('setSettings({ startButtonLocation: v })')
    expect(panelSrc).toContain('START_LOCATION_LOCK_HINT')
    expect(panelSrc).toContain('const d = !s.osMode')
  })
})
