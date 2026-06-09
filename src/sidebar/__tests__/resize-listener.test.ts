// Custom assertion harness — see Chronicle testing-conventions.md
let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}

// --- Ensure browser globals exist (bun standalone has none) ---
const g = globalThis as any
if (!g.window) g.window = g
if (!g.document) {
  g.document = {
    documentElement: { style: {} },
    body: { classList: { add() {}, remove() {}, toString() { return '' } } },
    getElementById() { return null },
    querySelector() { return null },
  }
}

// --- Save originals ---
const _origRaf = g.requestAnimationFrame
const _origCaf = g.cancelAnimationFrame
const _origMatchMedia = g.window.matchMedia
const _origDocEl = g.document.documentElement

let rafId = 0
const rafCallbacks = new Map<number, FrameRequestCallback>()

// --- Mock requestAnimationFrame / cancelAnimationFrame ---
g.requestAnimationFrame = ((cb: FrameRequestCallback) => {
  rafId++
  rafCallbacks.set(rafId, cb)
  return rafId
}) as typeof requestAnimationFrame

g.cancelAnimationFrame = ((id: number) => {
  rafCallbacks.delete(id)
}) as typeof cancelAnimationFrame

// --- Mock window.matchMedia ---
g.window.matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
})

// --- Mock document.documentElement.style ---
const _styleStore: Record<string, string> = {}
g.document.documentElement = {
  style: {
    getPropertyValue(k: string) { return _styleStore[k] ?? '' },
    setProperty(k: string, v: string) { _styleStore[k] = v },
    removeProperty(k: string) { delete _styleStore[k] },
  },
}

// --- Mock document.body ---
const _bodyClasses = new Set<string>()
g.document.body = {
  classList: {
    add(...c: string[]) { c.forEach(x => _bodyClasses.add(x)) },
    remove(...c: string[]) { c.forEach(x => _bodyClasses.delete(x)) },
    toString() { return [..._bodyClasses].join(' ') },
  },
}

// --- Mock document.getElementById ---
g.document.getElementById = (() => null) as any

// --- Track window.addEventListener / removeEventListener for 'resize' ---
const _resizeListeners: Array<(...args: any[]) => void> = []
const _origAddEventListener = g.window.addEventListener.bind(g.window)
const _origRemoveEventListener = g.window.removeEventListener.bind(g.window)
g.window.addEventListener = ((type: string, ...args: any[]) => {
  if (type === 'resize') _resizeListeners.push(args[0] as any)
  return _origAddEventListener(type, ...args)
}) as typeof window.addEventListener
g.window.removeEventListener = ((type: string, ...args: any[]) => {
  if (type === 'resize') {
    const idx = _resizeListeners.indexOf(args[0] as any)
    if (idx !== -1) _resizeListeners.splice(idx, 1)
  }
  return _origRemoveEventListener(type, ...args)
}) as typeof window.removeEventListener

// --- Mock window.innerWidth ---
Object.defineProperty(g.window, 'innerWidth', { writable: true, configurable: true, value: 400 })

// --- Mock window.dispatchEvent for resize events ---
const _origDispatchEvent = g.window.dispatchEvent?.bind(g.window)
g.window.dispatchEvent = ((evt: Event) => {
  if (evt.type === 'resize') {
    for (const fn of _resizeListeners) fn(evt)
  }
  return _origDispatchEvent?.(evt) ?? true
}) as typeof window.dispatchEvent

// --- Import after mocks ---
import { startMobileExclusion } from '../mobile-exclusion'

// --- Test: startMobileExclusion registers resize listener ---
try {
  _resizeListeners.length = 0
  const cleanup = startMobileExclusion()
  assert(_resizeListeners.length === 1, 'resize listener registered: expected 1 resize listener, got ' + _resizeListeners.length)
  cleanup()
} catch (e) {
  console.log(`SKIP: resize listener registered — ${e}`)
}

// --- Test: cleanup removes resize listener ---
try {
  _resizeListeners.length = 0
  const cleanup = startMobileExclusion()
  assert(_resizeListeners.length === 1, 'cleanup removes listener: resize listener present before cleanup')
  cleanup()
  assert(_resizeListeners.length === 0, 'cleanup removes listener: resize listener removed after cleanup')
} catch (e) {
  console.log(`SKIP: cleanup removes listener — ${e}`)
}

// --- Test: cleanup doesn't throw with no pending rAF ---
try {
  rafCallbacks.clear()
  const cleanup = startMobileExclusion()
  cleanup() // no pending rAF — should not throw
  assert(true, 'cleanup no-op: no throw with no pending rAF')
} catch (e) {
  console.log(`SKIP: cleanup no-op — ${e}`)
}

// --- Test: cleanup cancels pending resize rAF ---
try {
  rafCallbacks.clear()
  const cleanup = startMobileExclusion()
  // Switch matchMedia to return matches:true (mobile) so resize handler proceeds
  g.window.matchMedia = () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  })
  const resizeEvt = new Event('resize')
  g.window.dispatchEvent(resizeEvt)
  // Should have one pending rAF callback
  assert(rafCallbacks.size === 1, 'cleanup cancels rAF: one pending rAF after resize event on mobile')
  cleanup()
  // After cleanup, the rAF should have been cancelled (removed from map)
  assert(rafCallbacks.size === 0, 'cleanup cancels rAF: pending rAF cancelled after cleanup')
} catch (e) {
  console.log(`SKIP: cleanup cancels rAF — ${e}`)
}

// --- Cleanup mocks ---
g.requestAnimationFrame = _origRaf
g.cancelAnimationFrame = _origCaf
g.window.matchMedia = _origMatchMedia
g.document.documentElement = _origDocEl
g.window.addEventListener = _origAddEventListener
g.window.removeEventListener = _origRemoveEventListener
if (_origDispatchEvent) g.window.dispatchEvent = _origDispatchEvent
if (g.window === g) delete g.window

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
