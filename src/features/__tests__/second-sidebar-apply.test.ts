// secondSidebarFeature.apply ON path: mounts secondary when missing but must
// NOT call applyLayout — requestSecondDrawerMode / setup cold-load own that.

import { mock } from 'bun:test'

// Minimal DOM before any module load (matches chat-reflow-lifecycle pattern).
;(globalThis as any).document = {
  getElementById: () => null,
  createElement: () => ({
    style: { setProperty() {}, removeProperty() {} },
    classList: { add() {}, remove() {}, contains() { return false }, toggle() {} },
    setAttribute() {},
    appendChild() {},
    remove() {},
  }),
  documentElement: {
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
    classList: { add() {}, remove() {}, contains() { return false }, toggle() {} },
  },
  body: {
    appendChild() {},
    classList: { add() {}, remove() {}, contains() { return false }, toggle() {} },
  },
  head: { appendChild() {}, removeChild() {} },
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
}
;(globalThis as any).window = {
  addEventListener() {},
  removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  requestAnimationFrame: (cb: any) => setTimeout(cb, 0),
  innerWidth: 1280,
  innerHeight: 800,
}
;(globalThis as any).MutationObserver = class { observe() {} disconnect() {} }
;(globalThis as any).ResizeObserver = class { observe() {} disconnect() {} }
;(globalThis as any).HTMLElement = class {}

let mountCalls = 0
let applyLayoutCalls = 0
let secondaryWrapper: unknown = null

mock.module('../../sidebar/secondary', () => ({
  mountSecondarySidebar: () => { mountCalls++ },
  tearDownSecondarySidebar: () => {},
  getSecondaryWrapper: () => secondaryWrapper,
}))

mock.module('../../layout/apply', () => ({
  applyLayout: () => { applyLayoutCalls++ },
  cancelApplyLayoutInterval: () => {},
  isLayoutRestoreActive: () => false,
}))

mock.module('../../layout/persist', () => ({
  cancelLayoutSave: () => {},
  getBackendCtx: () => null,
  buildPersistedLayout: () => ({}),
  isLoadInProgress: () => false,
  isLayoutRestoreActive: () => false,
  applyLayout: () => { applyLayoutCalls++ },
  flushPendingSaves: () => {},
  syncLastLoadedFromPersistedLayout: () => {},
  hasDetachedTabs: () => false,
  seedDualLayoutFromLive: () => {},
}))

import { FEATURES } from '../registry'
import { setLastLoadedLayout } from '../../settings/state'
import { mergeCanvasSettings } from '../../types'
import type { SpindleFrontendContext } from 'lumiverse-spindle-types'

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else {
    console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    failed++
  }
}

const feature = FEATURES.find((f) => f.id === 'secondSidebarEnabled')!
assert(!!feature && typeof feature.apply === 'function', 'precondition: secondSidebarFeature in FEATURES')

const prev = { ...mergeCanvasSettings(null), secondSidebarEnabled: false } as any
const next = { ...mergeCanvasSettings(null), secondSidebarEnabled: true } as any
const ctx = {} as SpindleFrontendContext

// Layout present so a regression that re-adds applyLayout(layout) would fire.
setLastLoadedLayout({
  detachedTabs: [{ tabId: 't1', index: 0 }],
  secondary: { open: true, width: 420, activeTabId: 't1' },
  primary: { open: true, width: 420, tabId: null },
})

// Case 1: no wrapper → mount, no applyLayout
mountCalls = 0
applyLayoutCalls = 0
secondaryWrapper = null
feature.apply!(prev, next, ctx)
assertEqual(mountCalls, 1, 'ON apply mounts secondary when wrapper missing')
assertEqual(applyLayoutCalls, 0, 'ON apply does not call applyLayout (owned by requestSecondDrawerMode/setup)')

// Case 2: wrapper already present → neither mount nor applyLayout
mountCalls = 0
applyLayoutCalls = 0
secondaryWrapper = { id: 'already-mounted' }
feature.apply!(prev, next, ctx)
assertEqual(mountCalls, 0, 'ON apply skips mount when wrapper exists')
assertEqual(applyLayoutCalls, 0, 'ON apply still does not call applyLayout when wrapper exists')

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}/${passed + failed}`)
