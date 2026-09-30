// Main drawer side panel control (2026-09-19).
//
// The control is live-derived from the store (host Display setting / Configure
// swap) and dispatches the `swapSides` model intent when the requested side
// differs from the MODEL side. Locks: pre-hydration load, store not loaded,
// and mid-swap override.

import { describe, test, expect, mock, beforeEach } from 'bun:test'
// Real modules for spread-mocks: keeps every export other graph importers
// expect, while overriding only the functions under test.
import * as realStore from '../../store'
import * as realDispatch from '../../recon/dispatch'

mock.module('../../features/registry', () => ({
  FEATURES: [],
  alwaysCleanups: () => [],
}))

let side: 'left' | 'right' = 'right'
let override: 'left' | 'right' | null = null
let model: { side: 'left' | 'right' } | null = { side: 'right' }
const dispatches: unknown[] = []

mock.module('../../store', () => ({
  ...realStore,
  getMainDrawerSide: () => side,
  getMainDrawerSideOverride: () => override,
}))
mock.module('../../recon/dispatch', () => ({
  ...realDispatch,
  getModel: () => model,
  dispatch: async (intent: unknown) => { dispatches.push(intent) },
  // Run-scoped persist override (adversarial F2 — os-mode static import).
  setPersistOsOverride: () => {},
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
  addEventListener(type: string, fn: (ev: any) => void) {
    const arr = this._listeners.get(type) ?? []
    arr.push(fn)
    this._listeners.set(type, arr)
  }
  click() {
    if (this.disabled) return
    for (const fn of this._listeners.get('click') ?? []) fn({})
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

const { hydrateSettings, refreshSettingsPanel } = await import('../state')
const { mountSettingsPanel } = await import('../panel')

type El = FakeEl

function mountPanel(): El {
  const host = new FakeEl('div')
  mountSettingsPanel({ ui: { mount: () => host } } as any)
  refreshSettingsPanel()
  return host.children[0]
}

function rowByLabel(root: El, label: string): El {
  for (const row of root.querySelectorAll('.sidebar-ux-panel-row')) {
    if (row.querySelector('.sidebar-ux-panel-row-label')?.textContent === label) return row
  }
  throw new Error(`setting row not found: ${label}`)
}

function control(row: El): El { return row.children[1] }
function hint(row: El): El { return row.querySelector('.sidebar-ux-panel-row-hint')! }

/** Let the panel's lazy store import resolve, then re-render. */
async function settleStore(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0))
  refreshSettingsPanel()
}

beforeEach(() => {
  side = 'right'
  override = null
  model = { side: 'right' }
  dispatches.length = 0
})

describe('Main drawer side panel control', () => {
  test('shows the live host side as selected', async () => {
    hydrateSettings(null)
    const root = mountPanel()
    await settleStore()
    const row = rowByLabel(root, 'Main drawer side')
    const selected = (control(row).children as unknown as El[])
      .filter((b) => b.getAttribute('aria-checked') === 'true')
    expect(selected.length).toBe(1)
    expect(selected[0].textContent).toBe('Right')
    expect(control(row).disabled).toBe(false)
  })

  test('clicking the other side dispatches swapSides once', async () => {
    hydrateSettings(null)
    const root = mountPanel()
    await settleStore()
    const row = rowByLabel(root, 'Main drawer side')
    const left = (control(row).children as unknown as El[])[0]
    left.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(dispatches).toEqual([{ t: 'swapSides' }])
  })

  test('no dispatch when the model already matches the requested side', async () => {
    hydrateSettings(null)
    const root = mountPanel()
    await settleStore()
    const row = rowByLabel(root, 'Main drawer side')
    const right = (control(row).children as unknown as El[])[1]
    right.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(dispatches.length).toBe(0)
  })

  test('no dispatch before the model exists (locked with a swap hint)', async () => {
    hydrateSettings(null)
    model = null
    const root = mountPanel()
    await settleStore()
    const row = rowByLabel(root, 'Main drawer side')
    expect(control(row).disabled).toBe(true)
    expect(row.classList.contains('sidebar-ux-panel-row-disabled')).toBe(true)
  })

  test('locks while an override is pending and explains why', async () => {
    hydrateSettings(null)
    override = 'left'
    const root = mountPanel()
    await settleStore()
    const row = rowByLabel(root, 'Main drawer side')
    expect(control(row).disabled).toBe(true)
    expect(hint(row).textContent).toContain('Swapping drawer sides')
    // The selected side follows the override (optimistic display).
    const selected = (control(row).children as unknown as El[])
      .filter((b) => b.getAttribute('aria-checked') === 'true')
    expect(selected[0].textContent).toBe('Left')
  })
})
