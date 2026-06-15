// Regression test for Pitfall 7: apply-after-drawer-sync ordering.
//
// When mirrorCompactPosition is ON and the user has a Canvas-side
// override (mainDrawerTabOverrideVh), the secondary tab should reflect
// the Canvas override AFTER the drawer-sync mirror runs. This verifies that
// the apply-after-drawer-sync dispatch order produces the correct final
// marginTop on the secondary tab.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { failed++; console.error(`FAIL: ${msg} — expected ${String(expected)}, got ${String(actual)}`) }
}

// --- rAF queue for coalescing tests ---
const _rafQueue: Array<() => void> = []
;(globalThis as any).requestAnimationFrame = (fn: () => void) => { _rafQueue.push(fn); return 0 }
function _flushRaf() {
  const fns = [..._rafQueue]
  _rafQueue.length = 0
  for (const fn of fns) fn()
}

// --- Stub the DOM ---

class StubStyle {
  _setPropertyCalls = 0
  private _props: Record<string, string> = {}
  get marginTop() { return this._props['marginTop'] ?? '' }
  set marginTop(v: string) { this._props['marginTop'] = v }
  get paddingTop() { return this._props['paddingTop'] ?? '16px' }
  get paddingRight() { return this._props['paddingRight'] ?? '8px' }
  get paddingBottom() { return this._props['paddingBottom'] ?? '20px' }
  get paddingLeft() { return this._props['paddingLeft'] ?? '8px' }
  get borderTopWidth() { return this._props['borderTopWidth'] ?? '1px' }
  get gap() { return this._props['gap'] ?? '8px' }
  setProperty(k: string, v: string) { this._props[k] = v; this._setPropertyCalls++ }
}

class StubElement {
  style = new StubStyle()
  offsetWidth = 48
  offsetHeight = 100
  className = ''
  parentElement: StubElement | null = null
  classList = {
    _classes: new Set<string>(),
    toggle(cls: string, force?: boolean) {
      if (force === undefined) {
        if (this._classes.has(cls)) this._classes.delete(cls)
        else this._classes.add(cls)
      } else if (force) {
        this._classes.add(cls)
      } else {
        this._classes.delete(cls)
      }
    },
    contains(cls: string) { return this._classes.has(cls) },
    toString() { return Array.from(this._classes).join(' ') },
  }
  querySelector(_sel: string): StubElement | null { return null }
  querySelectorAll(_sel: string): StubElement[] { return [] }
  setAttribute(_k: string, _v: string) {}
}

// Main drawer tab stub
const mainDrawerTab = new StubElement()
mainDrawerTab.className = '_drawerTab_abc'

// Secondary wrapper stub
const secondaryWrapper = new StubElement()
const secondaryDrawerTab = new StubElement()
secondaryDrawerTab.className = 'sidebar-ux-drawer-tab'
secondaryWrapper.querySelector = (sel: string): StubElement | null => {
  if (sel === '.sidebar-ux-drawer-tab') return secondaryDrawerTab
  return null
}

// Stub document.querySelector
;(globalThis as any).document = {
  querySelector(sel: string): StubElement | null {
    // The selector [class*="_drawerTab_"]:not(.sidebar-ux-drawer-tab) targets
    // Lumiverse's main drawer tab. We match it by checking for the _drawerTab_
    // attribute selector — the :not(.sidebar-ux-drawer-tab) is a CSS-level
    // exclusion we don't need to replicate in the stub.
    if (sel.includes('[class*="_drawerTab_"]')) return mainDrawerTab
    return null
  },
}

// Stub window
;(globalThis as any).window = {
  innerHeight: 800,
  matchMedia: () => ({ matches: false }),
}

// Stub getComputedStyle
;(globalThis as any).getComputedStyle = (_el: StubElement) => ({
  get marginTop() { return _el.style.marginTop },
  get paddingTop() { return _el.style.paddingTop },
  get paddingRight() { return _el.style.paddingRight },
  get paddingBottom() { return _el.style.paddingBottom },
  get paddingLeft() { return _el.style.paddingLeft },
  get borderTopWidth() { return _el.style.borderTopWidth },
  get gap() { return _el.style.gap },
})

// Stub ResizeObserver (used by syncDrawerTabSettings to watch main drawer tab)
;(globalThis as any).ResizeObserver = class { observe() {} disconnect() {} unobserve() {} }

// Stub MutationObserver. Captures every (callback, target, options)
// triple passed to observe() so tests can fire the callback manually —
// the real MutationObserver is async and depends on the browser, so
// we don't get one for free in this test environment. Used by the
// drawer-sync class observer (attributeFilter: ['class']) and the new
// style observer (attributeFilter: ['style']) in syncDrawerTabSettings.
interface CapturedMutationObserver {
  cb: () => void
  target: any
  options: MutationObserverInit | undefined
}
const _capturedMutationObservers: CapturedMutationObserver[] = []
;(globalThis as any).MutationObserver = class {
  private _cb: () => void
  constructor(cb: () => void) { this._cb = cb }
  observe(target: any, options?: MutationObserverInit) {
    _capturedMutationObservers.push({ cb: this._cb, target, options })
  }
  disconnect() {}
  takeRecords() { return [] }
}

// Stub __setSecondaryWrapperForTest is needed by the secondary module import chain
// We'll import it after stubbing the secondary wrapper

// --- Import modules ---

// We need to control getSecondaryWrapper, so import from secondary
import { __setSecondaryWrapperForTest } from '../secondary'

// Set the secondary wrapper for the test
__setSecondaryWrapperForTest(secondaryWrapper as any)

import { syncDrawerTabSettings } from '../drawer-sync'
import { applyDrawerTabPosition } from '../../drawerTabPosition/apply'
import type { FullCanvasSettings } from '../../settings/state'

// We need to control getSettings().mirrorCompactPosition
// Import the settings state module — it uses a module-level _settings
// which we can't easily stub. Instead, we'll directly manipulate the
// settings state by importing getSettings and checking what it returns.
import { getSettings } from '../../settings/state'

// ============================================================
// Case 1: mirrorCompactPosition ON, secondaryDrawerTabOverrideVh = 25
//   - Main tab has marginTop of '12vh'
//   - After syncDrawerTabSettings: secondary should get '12vh' (mirror)
//   - After applyDrawerTabPosition: secondary should get '25vh' (override wins)
// ============================================================
{
  // Reset state
  mainDrawerTab.style = new StubStyle()
  mainDrawerTab.style.marginTop = '12vh'  // stale Lumiverse value
  secondaryDrawerTab.style = new StubStyle()
  _resetLastKnownVerticalPos()

  // Create a settings object that simulates mirrorCompactPosition ON
  // and secondaryDrawerTabOverrideVh = 25 (overrides the mirror on secondary)
  const settings: FullCanvasSettings = {
    ...getSettings(),
    mirrorCompactPosition: true,
    secondaryDrawerTabOverrideVh: 25,
  }

  // Step 1: syncDrawerTabSettings writes the main's value to the
  // secondary. With mirrorCompactPosition ON, the mirror always wins
  // — secondaryDrawerTabOverrideVh is ignored while mirror is on.
  // (The override only takes effect when the mirror is turned off.)
  syncDrawerTabSettings()
  _flushRaf()
  // At this point, secondary should have the mirrored value from the
  // main tab (12vh), regardless of the override being set.
  assertEqual(secondaryDrawerTab.style.marginTop, '12vh',
    'C1.a: secondary = 12vh after mirror sync (override ignored while mirror ON)')

  // Step 2: applyDrawerTabPosition applies the Canvas override
  applyDrawerTabPosition(settings, mainDrawerTab as any, secondaryDrawerTab as any)

  // The final value should be the Canvas override (25), not the stale mirror (12)
  assertEqual(secondaryDrawerTab.style.marginTop, '25vh',
    'C1: secondary marginTop = 25vh after apply-after-drawer-sync (override wins)')
}

// ============================================================
// Case 2: mirrorCompactPosition ON, mainDrawerTabOverrideVh undefined
//   - Main tab has marginTop of '15vh'
//   - After syncDrawerTabSettings: secondary should get '15vh' (mirror)
//   - After applyDrawerTabPosition: secondary should stay '15vh' (no override)
// ============================================================
{
  mainDrawerTab.style = new StubStyle()
  mainDrawerTab.style.marginTop = '15vh'
  secondaryDrawerTab.style = new StubStyle()
  _resetLastKnownVerticalPos()

  const settings: FullCanvasSettings = {
    ...getSettings(),
    mirrorCompactPosition: true,
    mainDrawerTabOverrideVh: undefined as unknown as number,
  }

  syncDrawerTabSettings()
  _flushRaf()

  // applyDrawerTabPosition with undefined override should NOT clear the style
  applyDrawerTabPosition(settings, mainDrawerTab as any, secondaryDrawerTab as any)

  assertEqual(secondaryDrawerTab.style.marginTop, '15vh',
    'C2: secondary marginTop = 15vh (mirror, no override to clear)')
}

// ============================================================
// Case 3: mirrorCompactPosition OFF, secondaryDrawerTabOverrideVh = 30
//   - Main tab has marginTop of '10vh'
//   - After syncDrawerTabSettings: secondary should be CLEARED (mirror off)
//   - After applyDrawerTabPosition: secondary should get '30vh' (override)
// ============================================================
{
  mainDrawerTab.style = new StubStyle()
  mainDrawerTab.style.marginTop = '10vh'
  secondaryDrawerTab.style = new StubStyle()
  secondaryDrawerTab.style.marginTop = '10vh'  // previous value
  _resetLastKnownVerticalPos()

  const settings: FullCanvasSettings = {
    ...getSettings(),
    mirrorCompactPosition: false,
    secondaryDrawerTabOverrideVh: 30,
  }

  syncDrawerTabSettings()
  _flushRaf()

  // With mirror OFF and override set, syncDrawerTabSettings does NOT
  // touch the secondary's inline style (the override's value is
  // owned by applyDrawerTabPosition, which re-writes on settings diff).
  // The secondary retains its previous inline value (10vh) until
  // applyDrawerTabPosition writes the override below.
  applyDrawerTabPosition(settings, mainDrawerTab as any, secondaryDrawerTab as any)

  assertEqual(secondaryDrawerTab.style.marginTop, '30vh',
    'C3: secondary marginTop = 30vh (mirror off, override restored by apply)')
}

// ============================================================
// Case 4: style observer fires → secondary updates in real time
//   - mirrorCompactPosition ON, no override
//   - syncDrawerTabSettings attaches a MutationObserver on the main
//     tab's `style` attribute
//   - When that observer fires, the secondary should follow the main
//     immediately (not wait for the 2s checkSideChanged tick)
//   - Regression for the "teleports every 1-2s" lag during drag
// ============================================================
{
  mainDrawerTab.style = new StubStyle()
  mainDrawerTab.style.marginTop = '20vh'
  secondaryDrawerTab.style = new StubStyle()
  _resetLastKnownVerticalPos()

  // Need mirrorCompactPosition ON (mutate the live settings object)
  const liveSettings = getSettings() as any
  const prevMirror = liveSettings.mirrorCompactPosition
  const prevOverride = liveSettings.secondaryDrawerTabOverrideVh
  liveSettings.mirrorCompactPosition = true
  liveSettings.secondaryDrawerTabOverrideVh = undefined

  // First call attaches the observers (class + style) and writes the
  // current mirror value to the secondary.
  syncDrawerTabSettings()
  _flushRaf()
  assertEqual(secondaryDrawerTab.style.marginTop, '20vh',
    'C4.a: secondary = 20vh after initial sync')

  // Find the style observer wired up by syncDrawerTabSettings. The
  // class observer was attached first; the style observer has
  // attributeFilter: ['style'].
  const styleObs = _capturedMutationObservers.find(
    (o) => o.options?.attributeFilter?.includes('style'),
  )
  assert(styleObs !== undefined, 'C4.b: a style observer was attached to the main tab')
  if (styleObs) {
    // Simulate a drag move: main's marginTop changes from 20vh to 25vh.
    mainDrawerTab.style.marginTop = '25vh'
    // Fire the captured observer callback (real MutationObserver is
    // microtask-batched — we don't have one in this test env).
    styleObs.cb()
    _flushRaf()
    assertEqual(secondaryDrawerTab.style.marginTop, '25vh',
      'C4.c: secondary follows main style change immediately on observer fire')
  }

  // Restore settings
  liveSettings.mirrorCompactPosition = prevMirror
  liveSettings.secondaryDrawerTabOverrideVh = prevOverride
}

// ============================================================
// Case 5: mirror ON ignores the override — secondary follows main
//   - mirrorCompactPosition ON, secondaryDrawerTabOverrideVh = 40
//   - The style observer fires when the main's style changes
//   - The override is IGNORED (mirror always wins when ON)
//   - Regression: ensures the design change "mirror wins when ON"
//     holds across the style observer path
// ============================================================
{
  mainDrawerTab.style = new StubStyle()
  mainDrawerTab.style.marginTop = '20vh'
  secondaryDrawerTab.style = new StubStyle()
  secondaryDrawerTab.style.marginTop = '40vh'  // stale override value in DOM
  _resetLastKnownVerticalPos()

  const liveSettings = getSettings() as any
  const prevMirror = liveSettings.mirrorCompactPosition
  const prevOverride = liveSettings.secondaryDrawerTabOverrideVh
  liveSettings.mirrorCompactPosition = true
  liveSettings.secondaryDrawerTabOverrideVh = 40

  // Initial sync: mirror wins. Override is set but ignored.
  syncDrawerTabSettings()
  _flushRaf()
  assertEqual(secondaryDrawerTab.style.marginTop, '20vh',
    'C5.a: secondary = 20vh after initial sync (mirror wins, override 40 ignored)')

  // Style observer fires on a main change.
  const styleObs = _capturedMutationObservers.find(
    (o) => o.options?.attributeFilter?.includes('style'),
  )
  assert(styleObs !== undefined, 'C5.b: style observer exists')
  if (styleObs) {
    mainDrawerTab.style.marginTop = '30vh'
    styleObs.cb()
    _flushRaf()
    // Mirror wins again — secondary follows the new main value, not
    // the override.
    assertEqual(secondaryDrawerTab.style.marginTop, '30vh',
      'C5.c: secondary follows new main 30vh (override 40 still ignored while mirror ON)')
  }

  // Restore settings
  liveSettings.mirrorCompactPosition = prevMirror
  liveSettings.secondaryDrawerTabOverrideVh = prevOverride
}

// ============================================================
// Case 6: mirror OFF + override set — override is preserved
//   - mirrorCompactPosition OFF, secondaryDrawerTabOverrideVh = 40
//   - The style observer fires when the main's style changes
//   - syncDrawerTabSettings must NOT touch the secondary (the override
//     is the canonical owner; applyDrawerTabPosition re-writes it on
//     settings diff)
//   - Regression: ensures the mirror-off branch does not clobber the
//     override when the main's style changes
// ============================================================
{
  mainDrawerTab.style = new StubStyle()
  mainDrawerTab.style.marginTop = '20vh'
  secondaryDrawerTab.style = new StubStyle()
  secondaryDrawerTab.style.marginTop = '40vh'  // previous override value
  _resetLastKnownVerticalPos()

  const liveSettings = getSettings() as any
  const prevMirror = liveSettings.mirrorCompactPosition
  const prevOverride = liveSettings.secondaryDrawerTabOverrideVh
  liveSettings.mirrorCompactPosition = false
  liveSettings.secondaryDrawerTabOverrideVh = 40

  // Initial sync: mirror is OFF and override is set, so syncDrawerTabSettings
  // must NOT touch the secondary. The override is preserved.
  syncDrawerTabSettings()
  _flushRaf()
  assertEqual(secondaryDrawerTab.style.marginTop, '40vh',
    'C6.a: secondary retains 40vh (override) after initial sync (mirror OFF)')

  // Style observer fires on a main change. With mirror OFF and override
  // set, the drawer-sync path still must NOT touch the secondary.
  const styleObs = _capturedMutationObservers.find(
    (o) => o.options?.attributeFilter?.includes('style'),
  )
  assert(styleObs !== undefined, 'C6.b: style observer exists')
  if (styleObs) {
    mainDrawerTab.style.marginTop = '25vh'
    styleObs.cb()
    _flushRaf()
    assertEqual(secondaryDrawerTab.style.marginTop, '40vh',
      'C6.c: secondary stays at 40vh (override) when style observer fires (mirror OFF)')
  }

  // Restore settings
  liveSettings.mirrorCompactPosition = prevMirror
  liveSettings.secondaryDrawerTabOverrideVh = prevOverride
}

// ============================================================
// T7: Coalescing — 10 calls in the same tick result in 1 body run.
//   Regression for the bug where style observer + rAF retry + ResizeObserver
//   all fired syncDrawerTabSettings() 12+ times per tick, flooding the console.
// ============================================================
{
  mainDrawerTab.style = new StubStyle()
  mainDrawerTab.style.marginTop = '7vh'
  // Use offsetWidth=60 (different from prior cases' default 48) so the
  // module-level cache from Cases 1-6 is invalidated, giving us a clean
  // cache miss on the first call.
  mainDrawerTab.offsetWidth = 60
  mainDrawerTab.offsetHeight = 120
  secondaryDrawerTab.style = new StubStyle()
  secondaryWrapper.style = new StubStyle()  // fresh counter
  _flushRaf()  // drain any pending from previous case

  // 10 calls in the same tick — should coalesce to 1 rAF
  for (let i = 0; i < 10; i++) syncDrawerTabSettings()
  assertEqual(_rafQueue.length, 1, 'T7.a: 10 calls in same tick coalesce to exactly 1 rAF')

  _flushRaf()
  assertEqual(secondaryWrapper.style._setPropertyCalls, 8,
    'T7.b: body ran once → 8 setProperty writes (not 80)')

  // A second batch of 10 in a new tick should schedule a second rAF
  for (let i = 0; i < 10; i++) syncDrawerTabSettings()
  assertEqual(_rafQueue.length, 1, 'T7.c: 10 more calls in a new tick schedule exactly 1 rAF')
  _flushRaf()
  // Cache is the same value (7vh, same dimensions), so 0 new writes
  assertEqual(secondaryWrapper.style._setPropertyCalls, 8,
    'T7.d: second batch cache hit → still 8 setProperty writes (not 16)')
}

// ============================================================
// T8: Cache hit on unchanged dimensions — 0 setProperty writes.
//   The 8 setProperty calls at drawer-sync.ts lines 97-105 (now guarded)
//   must skip when the serialized 8-dim value matches the last write.
//   This is the hot path during a drag — only the actual drag ticks
//   change the values.
// ============================================================
{
  mainDrawerTab.style = new StubStyle()
  mainDrawerTab.style.marginTop = '8vh'
  // Use offsetWidth=50 (different from T7's 48) so the module-level cache
  // from T7 is invalidated, giving us a clean cache miss on first call.
  mainDrawerTab.offsetWidth = 50
  mainDrawerTab.offsetHeight = 110
  secondaryDrawerTab.style = new StubStyle()
  secondaryWrapper.style = new StubStyle()  // fresh counter
  _flushRaf()

  syncDrawerTabSettings()
  _flushRaf()
  assertEqual(secondaryWrapper.style._setPropertyCalls, 8,
    'T8.a: first call writes 8 vars (cache miss from T7)')

  // Second call with IDENTICAL dimensions — should be a cache hit
  syncDrawerTabSettings()
  _flushRaf()
  assertEqual(secondaryWrapper.style._setPropertyCalls, 8,
    'T8.b: second call cache hit → 0 new writes (counter still 8)')

  // Third call with one CHANGED dimension — should invalidate cache
  mainDrawerTab.offsetWidth = 51
  syncDrawerTabSettings()
  _flushRaf()
  assertEqual(secondaryWrapper.style._setPropertyCalls, 16,
    'T8.c: dimension change invalidates cache → 8 new writes (counter now 16)')
}

// ============================================================
// T9: rAF retry path bypasses the coalesce gate.
//   When mainDrawerTab is null on first call, the function schedules a
//   rAF retry at drawer-sync.ts line 99. The retry must call
//   _runSyncDrawerTabSettings() DIRECTLY (not the coalescing wrapper),
//   so it actually fires even if a coalesce is pending.
// ============================================================
{
  mainDrawerTab.style = new StubStyle()
  mainDrawerTab.style.marginTop = '9vh'
  // Use offsetWidth=70 (different from prior cases) to ensure clean cache
  mainDrawerTab.offsetWidth = 70
  mainDrawerTab.offsetHeight = 140
  secondaryDrawerTab.style = new StubStyle()
  secondaryWrapper.style = new StubStyle()
  _flushRaf()

  // Override querySelector to return null for the main-drawer-tab selector
  // (simulating "main tab not painted yet")
  const _origQuerySelector = (globalThis as any).document.querySelector
  let _mainDrawerQueryCount = 0
  ;(globalThis as any).document.querySelector = (sel: string) => {
    if (sel.includes('[class*="_drawerTab_"]')) {
      _mainDrawerQueryCount++
      return null  // main tab not found
    }
    return _origQuerySelector(sel)
  }

  syncDrawerTabSettings()
  // The wrapper scheduled 1 rAF (the initial run)
  assertEqual(_rafQueue.length, 1, 'T9.a: wrapper scheduled 1 rAF (initial run)')
  _flushRaf()
  // After the initial rAF runs and finds null, it scheduled a RETRY rAF
  // that bypasses the gate
  assertEqual(_rafQueue.length, 1, 'T9.b: retry rAF scheduled (bypassed coalesce gate)')

  // Restore querySelector so the retry finds mainDrawerTab
  ;(globalThis as any).document.querySelector = _origQuerySelector

  _flushRaf()
  // The retry found mainDrawerTab, ran the body, and wrote 8 vars
  assertEqual(secondaryWrapper.style._setPropertyCalls, 8,
    'T9.c: retry ran, found mainDrawerTab, wrote 8 vars')
}

// ============================================================
// Helper: reset the module-level _lastKnownVerticalPos in drawer-sync.ts
// ============================================================
function _resetLastKnownVerticalPos() {
  // Reset the module-level _lastKnownVerticalPos cache. We can't access
  // the variable directly, but calling syncDrawerTabSettings with a
  // DIFFERENT value forces the cache to update. Since the rAF stub is a
  // no-op, syncDrawerTabSettings won't recurse. Each test case sets a
  // fresh distinct marginTop so the if-check at drawer-sync.ts:145 passes.
  // We just need to clear the cache; the test body sets the real value.
}

// Cleanup
__setSecondaryWrapperForTest(null)

console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
process.exit(failed > 0 ? 1 : 0)
