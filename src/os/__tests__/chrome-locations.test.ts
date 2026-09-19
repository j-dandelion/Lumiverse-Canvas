// Unified chrome-location reconcile tests (os/chrome-locations.ts).
//
// Verifies the fan-out contract: one call resolves the Options sides, toggles
// the Start-edge root class, and delegates the Start chrome reconcile. The
// collaborator modules are mocked so this stays a wiring test.

import { describe, test, expect, mock, beforeEach } from 'bun:test'

let settings: any = {
  optionsButtonLocation: null,
  startButtonLocation: null,
  startButtonAlwaysOnScreenEdge: true,
  secondSidebarEnabled: true,
}
let mainSide: 'left' | 'right' = 'right'
const calls: Array<[string, unknown?]> = []

mock.module('../../settings/state', () => ({
  getSettings: () => settings,
}))
mock.module('../../store', () => ({
  getMainDrawerSide: () => mainSide,
}))
mock.module('../../sidebar/settings-dock', () => ({
  applyOptionsButtonLocation: (resolved: unknown) => { calls.push(['options', resolved]) },
  teardownSettingsDock: () => { calls.push(['teardown-dock']) },
}))
mock.module('../start-menu', () => ({
  reconcileStartChrome: () => { calls.push(['start']) },
}))

// ── Minimal documentElement (classList only) ──

class FakeRoot {
  classes = new Set<string>()
  classList = {
    toggle: (c: string, force?: boolean) => {
      const on = force === undefined ? !this.classes.has(c) : force
      if (on) this.classes.add(c)
      else this.classes.delete(c)
      return on
    },
    add: (c: string) => { this.classes.add(c) },
    remove: (c: string) => { this.classes.delete(c) },
    contains: (c: string) => this.classes.has(c),
  }
}

const documentElement = new FakeRoot()
;(globalThis as any).document = { documentElement }

const {
  reconcileChromeLocations,
  teardownChromeLocations,
  clearStartEdgeClass,
  START_EDGE_INNER_CLASS,
} = await import('../chrome-locations')

beforeEach(() => {
  calls.length = 0
  documentElement.classes.clear()
  settings = {
    optionsButtonLocation: null,
    startButtonLocation: null,
    startButtonAlwaysOnScreenEdge: true,
    secondSidebarEnabled: true,
  }
  mainSide = 'right'
})

describe('reconcileChromeLocations', () => {
  test('resolves the Options sides against the live main side + dual state', () => {
    settings.optionsButtonLocation = 'both'
    mainSide = 'right'
    settings.secondSidebarEnabled = true
    reconcileChromeLocations()
    expect(calls).toContainEqual(['options', { sides: ['right', 'left'], main: true, second: true }])

    calls.length = 0
    settings.secondSidebarEnabled = false
    reconcileChromeLocations()
    expect(calls).toContainEqual(['options', { sides: ['right'], main: true, second: false }])
  })

  test('toggles the Start-edge root class from startButtonAlwaysOnScreenEdge', () => {
    reconcileChromeLocations()
    expect(documentElement.classes.has(START_EDGE_INNER_CLASS)).toBe(false)

    settings.startButtonAlwaysOnScreenEdge = false
    reconcileChromeLocations()
    expect(documentElement.classes.has(START_EDGE_INNER_CLASS)).toBe(true)

    settings.startButtonAlwaysOnScreenEdge = true
    reconcileChromeLocations()
    expect(documentElement.classes.has(START_EDGE_INNER_CLASS)).toBe(false)
  })

  test('delegates the Start chrome reconcile exactly once per call', () => {
    reconcileChromeLocations()
    expect(calls.filter(([name]) => name === 'start').length).toBe(1)
  })

  test('teardown clears the edge class and tears the dock down', () => {
    settings.startButtonAlwaysOnScreenEdge = false
    reconcileChromeLocations()
    teardownChromeLocations()
    expect(documentElement.classes.has(START_EDGE_INNER_CLASS)).toBe(false)
    expect(calls).toContainEqual(['teardown-dock'])

    documentElement.classes.add(START_EDGE_INNER_CLASS)
    clearStartEdgeClass()
    expect(documentElement.classes.has(START_EDGE_INNER_CLASS)).toBe(false)
  })
})
