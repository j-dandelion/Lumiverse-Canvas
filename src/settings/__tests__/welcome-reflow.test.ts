// welcomeReflow setting — Landing-screen reflow consumer.
//
// Covers:
//   1. settings semantics (default on, merge override, required key)
//   2. the real settings panel row (present in Chat, independent of chatReflow)
//   3. live-apply wiring: welcomeReflow owns its own feature id, and the shared
//      reflow sheet survives while EITHER consumer is on (source pins — the
//      feature graph is mocked for the panel DOM tests).
//
// DOM stubs follow the repo convention (see drawer-location-panel.test.ts).

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { readFileSync } from 'node:fs'

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

const { getSettings, hydrateSettings, refreshSettingsPanel } = await import('../state')
const { mountSettingsPanel } = await import('../panel')
const { DEFAULT_CANVAS_SETTINGS, mergeCanvasSettings } = await import('../../types')

type El = FakeElement

function mountPanel(): El {
  const host = new FakeElement('div')
  mountSettingsPanel({ ui: { mount: () => host } } as any)
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

const reflowSrc = readFileSync(new URL('../../chat/reflow.ts', import.meta.url), 'utf8')
const registrySrc = readFileSync(new URL('../../features/registry.ts', import.meta.url), 'utf8')
const setupSrc = readFileSync(new URL('../../setup.ts', import.meta.url), 'utf8')

describe('welcomeReflow setting', () => {
  beforeEach(() => { hydrateSettings(null) })

  test('defaults on; mergeCanvasSettings round-trips the override', () => {
    expect(DEFAULT_CANVAS_SETTINGS.welcomeReflow).toBe(true)
    expect(mergeCanvasSettings({}).welcomeReflow).toBe(true)
    expect(mergeCanvasSettings({ welcomeReflow: false }).welcomeReflow).toBe(false)
  })

  test('panel row lives in Chat, is enabled, and toggles the setting', () => {
    const root = mountPanel()
    const row = rowByLabel(root, 'Center the Welcome screen in the visible area')
    expect(control(row)).toBeDefined()
    expect(control(row).getAttribute('aria-checked')).toBe('true')
    // Independent of chatReflow — never disabled by the other consumer.
    expect(control(row).disabled).toBe(false)

    control(row).click()
    expect(getSettings().welcomeReflow).toBe(false)
    control(row).click()
    expect(getSettings().welcomeReflow).toBe(true)
  })

  test('live-apply wiring: own feature id + shared-sheet lifecycle', () => {
    // Own feature id: applySettings diffs on feature.id.
    expect(registrySrc).toContain("id: 'welcomeReflow'")
    expect(registrySrc).toContain('welcomeReflowFeature')
    // Shared sheet: the chat off-path keeps it while welcome is on...
    expect(registrySrc).toContain('if (!getSettings().welcomeReflow)')
    // ...and the welcome off-path keeps it while chat is on.
    expect(registrySrc).toContain('if (!getSettings().chatReflow)')
    // The reflow pass gates each consumer on its own setting.
    expect(reflowSrc).toContain('if (getSettings().chatReflow)')
    expect(reflowSrc).toContain('if (!getSettings().welcomeReflow)')
    // Landing rule: setting class gate + TS authority specificity guards.
    expect(reflowSrc).toContain('html.sidebar-ux-welcome-reflow [data-component="LandingPage"]')
    expect(reflowSrc).toContain(':not(#__theme_studio_authority_a__):not(#__theme_studio_authority_b__)')
    // Extension teardown sweep clears the landing state too.
    expect(setupSrc).toContain('clearWelcomeReflow()')
  })
})
