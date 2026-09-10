// Regression: resize-handle drag direction must follow the CURRENT drawer
// side, not the side captured when the handle was created.
//
// Symptom (user, S4 live-verify #7): after "Swap drawer locations" the drag
// resized the drawer in the opposite direction. Root cause: S4 restyles the
// shells in place (no remount), so the existing handle is kept and only
// re-positioned — its pointermove closure still held the pre-swap direction.
// Fix: `createResizeHandle` accepts a direction PROVIDER and resolves it at
// pointerdown (drag start).
//
// Run with: bun run src/resize/__tests__/resize-direction-live.test.ts

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    console.error(`FAIL: ${message} — expected ${String(expected)}, got ${String(actual)}`)
    failed++
  } else {
    passed++
  }
}

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
  private _handlers: Record<string, Array<(e: unknown) => void>> = {}
  rectWidth = 420

  addEventListener(type: string, fn: (e: unknown) => void) {
    ;(this._handlers[type] ||= []).push(fn)
  }
  removeEventListener(type: string, fn: (e: unknown) => void) {
    this._handlers[type] = (this._handlers[type] ?? []).filter((h) => h !== fn)
  }
  dispatch(type: string, ev: unknown) {
    for (const h of [...(this._handlers[type] ?? [])]) h(ev)
  }
  appendChild(child: StubElement) {
    child.parentElement = this
    return child
  }
  getBoundingClientRect() {
    return { width: this.rectWidth }
  }
  closest(_sel: string): StubElement | null { return null }
  querySelector(_sel: string): StubElement | null { return null }
  setAttribute(_k: string, _v: string) {}
  remove() { this.parentElement = null }
}

const docHandlers: Record<string, Array<(e: unknown) => void>> = {}
function fireDoc(type: string, ev: unknown) {
  for (const h of [...(docHandlers[type] ?? [])]) h(ev)
}
function pointerEvent(clientX: number) {
  return { clientX, preventDefault() {}, stopPropagation() {} }
}

;(globalThis as any).document = {
  createElement: () => new StubElement(),
  addEventListener(type: string, fn: (e: unknown) => void) {
    ;(docHandlers[type] ||= []).push(fn)
  },
  removeEventListener(type: string, fn: (e: unknown) => void) {
    docHandlers[type] = (docHandlers[type] ?? []).filter((h) => h !== fn)
  },
  documentElement: { style: { setProperty() {}, removeProperty() {} } },
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

import { createResizeHandle } from '../handles'

// ── T1/T2: provider is resolved at drag start; a side swap between drags
// flips the sign without recreating the handle. ──
{
  const results: Array<{ start: number; delta: number }> = []
  let mainSide: 'left' | 'right' = 'left'
  // Mirrors the main-drawer call site: left drawer expands on rightward drag.
  const handle = createResizeHandle(
    () => (mainSide === 'left' ? 'right' : 'left'),
    (start, delta) => results.push({ start, delta }),
    () => {},
  ) as unknown as StubElement
  const drawer = new StubElement()
  drawer.rectWidth = 400
  drawer.appendChild(handle)

  // Drag 1 — main on the left, drag right 50px → +50 width.
  handle.dispatch('pointerdown', pointerEvent(100))
  fireDoc('pointermove', pointerEvent(150))
  fireDoc('pointerup', pointerEvent(150))
  assertEqual(results.length, 1, 'T1: one resize committed')
  assertEqual(results[0]!.start, 400, 'T1: startWidth read from drawer at drag start')
  assertEqual(results[0]!.delta, 50, 'T1: left drawer, drag right → +50')

  // Side swap WITHOUT recreating the handle (S4 restyle-in-place).
  mainSide = 'right'
  handle.dispatch('pointerdown', pointerEvent(100))
  fireDoc('pointermove', pointerEvent(150))
  fireDoc('pointerup', pointerEvent(150))
  assertEqual(results.length, 2, 'T2: second drag committed')
  assertEqual(
    results[1]!.delta,
    -50,
    'T2: right drawer, drag right → -50 (direction follows live side)',
  )
}

// ── T3: secondary provider mapping (main left → secondary right → expand
// left; main right → expand right). ──
{
  const results: Array<number> = []
  let mainSide: 'left' | 'right' = 'left'
  const handle = createResizeHandle(
    () => (mainSide === 'left' ? 'left' : 'right'),
    (_start, delta) => results.push(delta),
    () => {},
  ) as unknown as StubElement
  new StubElement().appendChild(handle)

  handle.dispatch('pointerdown', pointerEvent(200))
  fireDoc('pointermove', pointerEvent(170))
  fireDoc('pointerup', pointerEvent(170))
  assertEqual(results[0], 30, 'T3: secondary on right, drag left → +30')

  mainSide = 'right'
  handle.dispatch('pointerdown', pointerEvent(200))
  fireDoc('pointermove', pointerEvent(170))
  fireDoc('pointerup', pointerEvent(170))
  assertEqual(results[1], -30, 'T3: secondary on left, drag left → -30')
}

// ── T4: static string direction still supported (back-compat). ──
{
  const results: Array<number> = []
  const handle = createResizeHandle(
    'right',
    (_s, delta) => results.push(delta),
    () => {},
  ) as unknown as StubElement
  new StubElement().appendChild(handle)
  handle.dispatch('pointerdown', pointerEvent(0))
  fireDoc('pointermove', pointerEvent(25))
  fireDoc('pointerup', pointerEvent(25))
  assertEqual(results[0], 25, 'T4: static right direction → +25')
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
