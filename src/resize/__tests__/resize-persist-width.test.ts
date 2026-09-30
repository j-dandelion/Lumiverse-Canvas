// Regression (live-verify #9): a completed resize drag must commit the new
// width to the owned model. The drag writes DOM/CSS directly; the model (and
// therefore the persisted layout) only learns about it through a setDrawer
// intent. Before this fix the commit callbacks were retired-no-op stubs
// ("persist via the owned model" with no dispatch), so a reload — or the next
// reconcile — snapped the drawer back to the pre-drag width.
//
// Run with: bun run src/resize/__tests__/resize-persist-width.test.ts

import { mock } from 'bun:test'

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) {
    passed++
  } else {
    failed++
    console.error('FAIL:', msg)
  }
}
function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    console.error(`FAIL: ${message} — expected ${String(expected)}, got ${String(actual)}`)
    failed++
  } else {
    passed++
  }
}

type RecordedIntent = { t: string; side?: string; width?: number }
const dispatched: RecordedIntent[] = []

// Spread the real module so every named export the static import chain
// destructures stays present; only dispatch is recorded.
const actualDispatch = await import('../../recon/dispatch')
mock.module('../../recon/dispatch', () => ({
  ...actualDispatch,
  dispatch: async (intent: RecordedIntent) => {
    dispatched.push(intent)
  },
}))

class StubStyle {
  private _props: Record<string, string> = {}
  setProperty(k: string, v: string) { this._props[k] = v }
  getPropertyValue(k: string) { return this._props[k] ?? '' }
  removeProperty(k: string) { delete this._props[k] }
  set cssText(_v: string) {}
  cursor = ''
  userSelect = ''
}

class StubElement {
  style = new StubStyle()
  className = ''
  parentElement: StubElement | null = null
  addEventListener() {}
  removeEventListener() {}
  appendChild(child: StubElement) {
    child.parentElement = this
    return child
  }
  getBoundingClientRect() {
    return { width: 420 }
  }
  closest(_sel: string): StubElement | null { return null }
  querySelector(_sel: string): StubElement | null { return null }
  setAttribute(_k: string, _v: string) {}
  remove() { this.parentElement = null }
}

;(globalThis as any).document = {
  createElement: () => new StubElement(),
  addEventListener() {},
  removeEventListener() {},
  documentElement: { style: new StubStyle() },
  body: { style: new StubStyle(), appendChild() {} },
  querySelector: () => null,
  querySelectorAll: () => [],
}
;(globalThis as any).window = {
  innerWidth: 1200,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {},
  removeEventListener() {},
}

// Must come AFTER mock.module.
const { persistResizeWidth } = await import('../handles')

const flush = () => new Promise((r) => setTimeout(r, 10))
const MAX_WIDTH = 1200 * 0.8

// ── T1: primary commit dispatches the dragged width as a setDrawer intent ──
persistResizeWidth('primary', 512)
await flush()
assertEqual(dispatched.length, 1, 'T1: one intent dispatched')
assertEqual(dispatched[0]?.t, 'setDrawer', 'T1: intent is setDrawer')
assertEqual(dispatched[0]?.side, 'primary', 'T1: primary side')
assertEqual(dispatched[0]?.width, 512, 'T1: dragged width forwarded')

// ── T2: secondary commit follows the same path ──
persistResizeWidth('secondary', 480.5)
await flush()
assertEqual(dispatched[1]?.side, 'secondary', 'T2: secondary side')
assertEqual(dispatched[1]?.width, 480.5, 'T2: width forwarded unrounded')

// ── T3: clamp bounds apply at commit (window 1200 → [200, 960]) ──
persistResizeWidth('primary', 50)
persistResizeWidth('primary', 5000)
await flush()
assertEqual(dispatched[2]?.width, 200, 'T3: below-min width clamps to 200')
assertEqual(dispatched[3]?.width, MAX_WIDTH, 'T3b: above-max width clamps to 960')

// ── T4: junk widths never reach the model ──
persistResizeWidth('primary', 0)
persistResizeWidth('primary', Number.NaN)
persistResizeWidth('secondary', -10)
await flush()
assertEqual(dispatched.length, 4, 'T4: invalid widths never dispatch')

if (failed > 0) {
  console.error(`FAILED: ${failed}`)
  process.exitCode = 1
}
console.log(`PASS: ${passed}`)

export {}
