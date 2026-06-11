// Tests for src/drawerTabPosition/drag.ts
//
// Verifies:
// - pxToClampedVh math (clamp/round)
// - parseVhFromStyle parsing
// - installDrawerTabDrag click-vs-drag threshold (10px)
// - installDrawerTabDrag multi-move update (regression: subsequent moves
//   must keep updating the DOM, not just the first threshold-crossing one)
// - installDrawerTabDrag aria-label updates
// - installDrawerTabDrag mobile gate (isPointerResizeActive)
// - installDrawerTabDrag readCurrentVh: inline vh > inline px > computed px
// - installDrawerTabDrag teardown removes listeners
// - installDrawerTabDrag userSelect lock during drag

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { failed++; console.error(`FAIL: ${msg} — expected ${String(expected)}, got ${String(actual)}`) }
}

import { pxToClampedVh, parseVhFromStyle, installDrawerTabDrag } from '../drag'

// ============================================================
// pxToClampedVh: delta-to-vh conversion
// ============================================================
{
  // 100px on 1000px viewport with current 15 → 25 (10vh added)
  assertEqual(pxToClampedVh(100, 1000, 15), 25, 'pxToClamped: 100px on 1000vh + 15 = 25')

  // -200px on 1000px with current 15 → 0 (clamped)
  assertEqual(pxToClampedVh(-200, 1000, 15), 0, 'pxToClamped: -200px clamps to 0')

  // +9999px → 70 (clamped)
  assertEqual(pxToClampedVh(9999, 1000, 15), 70, 'pxToClamped: +9999px clamps to 70')

  // -9999px → 0 (clamped)
  assertEqual(pxToClampedVh(-9999, 1000, 15), 0, 'pxToClamped: -9999px clamps to 0')

  // 0 delta → current unchanged
  assertEqual(pxToClampedVh(0, 1000, 42), 42, 'pxToClamped: 0 delta preserves current')

  // Custom min/max
  assertEqual(pxToClampedVh(500, 1000, 0, 10, 50), 50, 'pxToClamped: custom max respected')
  assertEqual(pxToClampedVh(-500, 1000, 30, 10, 50), 10, 'pxToClamped: custom min respected')
}

// ============================================================
// parseVhFromStyle
// ============================================================
{
  assertEqual(parseVhFromStyle('12vh'), 12, 'parseVh: 12vh → 12')
  assertEqual(parseVhFromStyle('12.5vh'), 12.5, 'parseVh: 12.5vh → 12.5')
  assertEqual(parseVhFromStyle('0vh'), 0, 'parseVh: 0vh → 0')
  assertEqual(parseVhFromStyle(''), undefined, 'parseVh: empty string → undefined')
  assertEqual(parseVhFromStyle('abc'), undefined, 'parseVh: unparseable → undefined')
}

// ============================================================
// installDrawerTabDrag — minimal element with capture
// ============================================================
// We build a tiny EventTarget that records listeners so we can drive
// the pointer events through the installer's handlers directly.

interface RecordedHandler { type: string; fn: (e: any) => void; capture: boolean }

/** Build a fake pointer/click event with the methods the installer calls.
 *  `stopImmediatePropagation` sets a flag on the event that FakeEl.fire
 *  honors — subsequent listeners of the same type are not invoked.
 *  This matches the real DOM behavior: capture-phase listeners that
 *  call stopImmediatePropagation prevent later listeners (on the same
 *  element, same type) from firing. */
function fakeEvent(overrides: Partial<{ clientY: number; clientX: number; pointerId: number }> = {}) {
  const e: any = {
    clientY: 0,
    clientX: 0,
    pointerId: 1,
    preventDefault: () => {},
    stopImmediatePropagation: function() { this._stopped = true },
    stopPropagation: function() { this._stopped = true },
    _stopped: false,
    ...overrides,
  }
  return e
}

class FakeEl {
  private _listeners: RecordedHandler[] = []
  ariaLabel: string | null = null
  style = { marginTop: '' }
  addEventListener(type: string, fn: any, opts?: any) {
    const capture = typeof opts === 'boolean' ? opts : !!opts?.capture
    this._listeners.push({ type, fn, capture })
  }
  removeEventListener(type: string, fn: any, opts?: any) {
    const capture = typeof opts === 'boolean' ? opts : !!opts?.capture
    this._listeners = this._listeners.filter(
      (h) => !(h.type === type && h.fn === fn && h.capture === capture),
    )
  }
  setAttribute(k: string, v: string) {
    if (k === 'aria-label') this.ariaLabel = v
  }
  /** Dispatch listeners in registration order. Respects
   *  e._stopped (set by stopImmediatePropagation) so capture-phase
   *  listeners can prevent later listeners on the same element/type. */
  fire(type: string, e: any) {
    for (const h of this._listeners) {
      if (h.type === type) {
        h.fn(e)
        if (e._stopped) break
      }
    }
  }
  /** Count listeners of a given type and capture flag. */
  count(type: string, capture = false): number {
    return this._listeners.filter((h) => h.type === type && h.capture === capture).length
  }
}

// --- Mock environment ---
const VIEWPORT_HEIGHT = 1000
;(globalThis as any).window = {
  innerHeight: VIEWPORT_HEIGHT,
  matchMedia: () => ({ matches: false }),  // not coarse pointer
}
// getComputedStyle in real browsers always returns px values for marginTop.
// We use a per-element map so different elements can simulate different
// computed margins.
const _computedMargins = new WeakMap<object, string>()
function setComputedMargin(el: object, px: number) {
  _computedMargins.set(el, `${px}px`)
}
;(globalThis as any).getComputedStyle = (el: object) => ({
  marginTop: _computedMargins.get(el) ?? '0px',
})

class FakeBody {
  style = { userSelect: '' }
}
class FakeDocument {
  body = new FakeBody()
  private _listeners: RecordedHandler[] = []
  addEventListener(type: string, fn: any, opts?: any) {
    const capture = typeof opts === 'boolean' ? opts : !!opts?.capture
    this._listeners.push({ type, fn, capture })
  }
  removeEventListener(type: string, fn: any, opts?: any) {
    const capture = typeof opts === 'boolean' ? opts : !!opts?.capture
    this._listeners = this._listeners.filter(
      (h) => !(h.type === type && h.fn === fn && h.capture === capture),
    )
  }
  fire(type: string, e: any) {
    for (const h of this._listeners) {
      if (h.type === type) h.fn(e)
    }
  }
}
const fakeDoc = new FakeDocument()
;(globalThis as any).document = fakeDoc

// ============================================================
// Drag threshold: < 10px does not start drag
// ============================================================
{
  const el = new FakeEl()
  let committed = -1
  const teardown = installDrawerTabDrag(el as any, 'main', (vh) => { committed = vh })

  assertEqual(el.ariaLabel, 'Drag to reposition', 'install: aria-label set on install')

  // pointerdown on el
  el.fire('pointerdown', fakeEvent({ clientY: 100 }))
  // pointermove on document with delta = 9 (below threshold)
  fakeDoc.fire('pointermove', fakeEvent({ clientY: 109 }))
  // pointerup
  fakeDoc.fire('pointerup', fakeEvent())

  assertEqual(committed, -1, 'threshold-9: onCommit not called for 9px move')
  assertEqual(el.count('click', true), 0, 'threshold-9: no capture-phase click listener installed')

  teardown()
}

// ============================================================
// Drag threshold: >= 10px starts drag, commits on pointerup
// ============================================================
{
  const el = new FakeEl()
  let committed = -1
  const teardown = installDrawerTabDrag(el as any, 'main', (vh) => { committed = vh })

  el.style.marginTop = '15vh'  // current vh
  el.fire('pointerdown', fakeEvent({ clientY: 100 }))
  // Move 100px down → 10vh added → 25vh
  fakeDoc.fire('pointermove', fakeEvent({ clientY: 200 }))
  assertEqual(el.count('click', true), 1, 'threshold-100: capture-phase click listener installed')
  assertEqual(el.style.marginTop, '25vh', 'threshold-100: style.marginTop updated live')
  assertEqual(el.ariaLabel, 'Position: 25vh', 'threshold-100: aria-label updated during drag')

  fakeDoc.fire('pointerup', fakeEvent())
  assertEqual(committed, 25, 'threshold-100: onCommit called with 25')
  assertEqual(el.ariaLabel, 'Drag to reposition', 'threshold-100: aria-label restored on pointerup')
  // The capture click listener is NOT removed synchronously in cleanup
  // — it's deferred via setTimeout(0) so the synthesized click event
  // (which fires synchronously after pointerup) can be suppressed
  // first. In the test we don't await the setTimeout, so the listener
  // is still attached here. The teardown below synchronously removes
  // it (bypassing the setTimeout) so it doesn't leak into the next case.
  assertEqual(el.count('click', true), 1, 'threshold-100: capture click listener still present after pointerup (deferred removal)')

  teardown()
}

// ============================================================
// REGRESSION: multiple moves must all update the DOM.
// Before the fix, the second and subsequent moves early-returned
// (`isDragging ||` in onPointerMove), so the tab only moved once on
// the threshold-crossing move.
// ============================================================
{
  const el = new FakeEl()
  let committed = -1
  const teardown = installDrawerTabDrag(el as any, 'main', (vh) => { committed = vh })

  el.style.marginTop = '15vh'
  el.fire('pointerdown', fakeEvent({ clientY: 100 }))
  // Move 1: 10px down (crosses threshold) → 15 + 1 = 16vh
  fakeDoc.fire('pointermove', fakeEvent({ clientY: 110 }))
  assertEqual(el.style.marginTop, '16vh', 'multi-move: after move 1 (10px)')
  // Move 2: 200px down (delta = 200) → 15 + 20 = 35vh  ← would have been
  // the old bug: second move early-returns, marginTop stays at 16vh
  fakeDoc.fire('pointermove', fakeEvent({ clientY: 300 }))
  assertEqual(el.style.marginTop, '35vh', 'multi-move: after move 2 (200px) — should be 35vh, not stuck at 16')
  // Move 3: 400px down (delta = 400) → 15 + 40 = 55vh
  fakeDoc.fire('pointermove', fakeEvent({ clientY: 500 }))
  assertEqual(el.style.marginTop, '55vh', 'multi-move: after move 3 (400px) — should be 55vh')

  fakeDoc.fire('pointerup', fakeEvent())
  assertEqual(committed, 55, 'multi-move: onCommit called with final 55vh')

  teardown()
}

// ============================================================
// REGRESSION: readCurrentVh from computed style in px (no inline override).
// This is the common case on first mount before any drag has happened —
// Lumiverse has set the position via inline style, but if a future path
// strips that, the computed style fallback must convert px → vh correctly.
// Before the fix, parseFloat('150px') was treated as 150vh (clamped to 70),
// which made every drag snap to the max.
// ============================================================
{
  const el = new FakeEl()
  // No inline style — fallback to computed style in px (150px = 15vh on 1000px viewport)
  setComputedMargin(el, 150)
  let committed = -1
  const teardown = installDrawerTabDrag(el as any, 'main', (vh) => { committed = vh })

  el.fire('pointerdown', fakeEvent({ clientY: 100 }))
  // Move 100px down → +10vh → 25vh
  fakeDoc.fire('pointermove', fakeEvent({ clientY: 200 }))
  assertEqual(el.style.marginTop, '25vh', 'px-fallback: 100px on 1000vh + 15vh baseline = 25vh')

  fakeDoc.fire('pointerup', fakeEvent())
  assertEqual(committed, 25, 'px-fallback: onCommit called with 25')

  teardown()
}

// ============================================================
// readCurrentVh from inline px (rare but possible)
// ============================================================
{
  const el = new FakeEl()
  el.style.marginTop = '150px'  // inline px, not vh
  let committed = -1
  const teardown = installDrawerTabDrag(el as any, 'main', (vh) => { committed = vh })

  el.fire('pointerdown', fakeEvent({ clientY: 100 }))
  // 100px delta on 1000vh viewport → +10vh → 15 + 10 = 25vh
  fakeDoc.fire('pointermove', fakeEvent({ clientY: 200 }))
  assertEqual(el.style.marginTop, '25vh', 'inline-px: 150px on 1000vh = 15vh baseline, +100px = 25vh')

  fakeDoc.fire('pointerup', fakeEvent())
  assertEqual(committed, 25, 'inline-px: onCommit called with 25')

  teardown()
}

// ============================================================
// Capture-phase click listener suppresses click when dragging
// ============================================================
{
  const el = new FakeEl()
  let clickReached = false
  const teardown = installDrawerTabDrag(el as any, 'main', () => {})

  el.fire('pointerdown', fakeEvent({ clientY: 100 }))
  fakeDoc.fire('pointermove', fakeEvent({ clientY: 115 }))  // 15px → crosses 10px threshold → drag
  // Now simulate a click event. The capture-phase listener should
  // call stopImmediatePropagation, preventing any bubble handler.
  // We can't directly observe stopImmediatePropagation in this stub,
  // but we can verify the listener exists and is removed on pointerup.
  assertEqual(el.count('click', true), 1, 'capture-click: listener present during drag')

  // Simulate a click that fires while still dragging (before pointerup).
  // The capture listener should call e.stopImmediatePropagation. In our
  // fake, we can't observe the propagation flag, so we just check the
  // listener is still present.
  el.fire('click', fakeEvent())

  fakeDoc.fire('pointerup', fakeEvent())
  // The capture click listener is still present after pointerup — the
  // removal is deferred via setTimeout(0) so the synthesized click can
  // be suppressed first. The teardown below synchronously removes it.
  assertEqual(el.count('click', true), 1, 'capture-click: listener still present after pointerup (deferred removal)')

  teardown()
  // Click is the assertion; clickReached may be true or false depending
  // on stopImmediatePropagation stub, which is fine — we just need the
  // listener to be present during drag and gone after teardown.
  assertEqual(el.count('click', true), 0, 'capture-click: listener removed by teardown')
  void clickReached
}

// ============================================================
// Mobile (coarse pointer): drag is enabled with the 10px threshold.
// Previously the drag was gated off on coarse pointers (mobile gate).
// Now it's enabled — the 10px threshold filters out tap "settle jitter"
// and touch-action: none on the element prevents browser scroll during
// drag. This test verifies a touch-style drag commits normally.
// ============================================================
{
  ;(globalThis as any).window = {
    innerHeight: VIEWPORT_HEIGHT,
    matchMedia: () => ({ matches: true }),  // coarse pointer = mobile
  }

  const el = new FakeEl()
  el.style.marginTop = '15vh'
  let committed = -1
  const teardown = installDrawerTabDrag(el as any, 'main', (vh) => { committed = vh })

  el.fire('pointerdown', fakeEvent({ clientY: 100 }))
  // Cross the 10px threshold (50px move)
  fakeDoc.fire('pointermove', fakeEvent({ clientY: 150 }))
  assertEqual(el.count('click', true), 1, 'mobile: capture listener installed after 50px move')
  assertEqual(el.style.marginTop, '20vh', 'mobile: style.marginTop updated to 20vh (15 + 5)')

  fakeDoc.fire('pointerup', fakeEvent())
  assertEqual(committed, 20, 'mobile: onCommit called with 20')

  teardown()

  // Restore non-mobile for other tests
  ;(globalThis as any).window = {
    innerHeight: VIEWPORT_HEIGHT,
    matchMedia: () => ({ matches: false }),
  }
}

// ============================================================
// userSelect is locked during drag and released on cleanup
// ============================================================
{
  const el = new FakeEl()
  const teardown = installDrawerTabDrag(el as any, 'main', () => {})

  el.fire('pointerdown', fakeEvent({ clientY: 100 }))
  assertEqual(fakeDoc.body.style.userSelect, 'none', 'userSelect: locked to none on pointerdown')

  fakeDoc.fire('pointermove', fakeEvent({ clientY: 110 }))
  assertEqual(fakeDoc.body.style.userSelect, 'none', 'userSelect: still none during drag')

  fakeDoc.fire('pointerup', fakeEvent())
  assertEqual(fakeDoc.body.style.userSelect, '', 'userSelect: cleared on pointerup')

  teardown()
}

// ============================================================
// Teardown removes all listeners
// ============================================================
{
  const el = new FakeEl()
  let committed = -1
  const teardown = installDrawerTabDrag(el as any, 'main', (vh) => { committed = vh })

  // Verify listeners are installed
  assert(el.count('pointerdown') > 0, 'teardown: pointerdown listener installed')
  assert(fakeDoc['_listeners'].length > 0, 'teardown: document listeners installed')

  teardown()

  // Verify listeners are removed
  assertEqual(el.count('pointerdown'), 0, 'teardown: pointerdown removed')
  assertEqual(fakeDoc['_listeners'].length, 0, 'teardown: document listeners removed')

  // Subsequent drag should not work
  el.fire('pointerdown', fakeEvent({ clientY: 100 }))
  fakeDoc.fire('pointermove', fakeEvent({ clientY: 200 }))
  fakeDoc.fire('pointerup', fakeEvent())
  assertEqual(committed, -1, 'teardown: subsequent drag does not commit')
}

// ============================================================
// onLiveUpdate: called on every move after threshold, not before
//   - Used for bidirectional mirror: feature passes an onLiveUpdate
//     that writes the new vh to the mirror element. Verifies the
//     callback is fired synchronously on every pointermove after the
//     4px threshold is crossed, with the latest newVh value.
// ============================================================
{
  const el = new FakeEl()
  const liveUpdates: number[] = []
  let committed = -1
  const teardown = installDrawerTabDrag(
    el as any,
    'secondary',
    (vh) => { committed = vh },
    (vh) => { liveUpdates.push(vh) },
  )

  el.fire('pointerdown', fakeEvent({ clientY: 100 }))

  // Below threshold (3px) — onLiveUpdate should NOT fire
  fakeDoc.fire('pointermove', fakeEvent({ clientY: 103 }))
  assertEqual(liveUpdates.length, 0, 'live: no callback below threshold')

  // Cross threshold (10px) — onLiveUpdate fires with first newVh
  fakeDoc.fire('pointermove', fakeEvent({ clientY: 110 }))
  assertEqual(liveUpdates.length, 1, 'live: callback fires once on threshold cross')
  assertEqual(liveUpdates[0], 1, 'live: first newVh = 1.0 (0 + 10/1000*100)')

  // Subsequent moves — onLiveUpdate fires with each newVh
  fakeDoc.fire('pointermove', fakeEvent({ clientY: 130 }))
  assertEqual(liveUpdates.length, 2, 'live: callback fires on each subsequent move')
  assertEqual(liveUpdates[1], 3, 'live: second newVh = 3.0')

  // Pointerup commits the final vh
  fakeDoc.fire('pointerup', fakeEvent())
  assertEqual(committed, 3, 'live: pointerup commits the last newVh')
  assertEqual(liveUpdates.length, 2, 'live: no extra callback on pointerup')

  teardown()
}

// ============================================================
// onLiveUpdate: omitted → drag handler still works (backward compat)
// ============================================================
{
  const el = new FakeEl()
  let committed = -1
  // 3-arg form: no onLiveUpdate. Drag should still commit on pointerup.
  const teardown = installDrawerTabDrag(el as any, 'main', (vh) => { committed = vh })

  el.fire('pointerdown', fakeEvent({ clientY: 100 }))
  fakeDoc.fire('pointermove', fakeEvent({ clientY: 120 }))
  fakeDoc.fire('pointerup', fakeEvent())
  assertEqual(committed, 2, 'live-omitted: drag commits normally without onLiveUpdate')

  teardown()
}

// ============================================================
// Deferred click-listener removal: synthesized click after pointerup
//   is still suppressed (regression for "drag opens/closes the drawer")
//
// Before the fix, cleanup() called removeEventListener synchronously on
// pointerup. The browser then synthesized a click event from the
// pointerdown+pointerup pair — but the capture-phase listener was
// already gone, so the click reached Lumiverse's React onClick and
// opened/closed the drawer.
//
// After the fix, cleanup() defers the removal via setTimeout(0). The
// synthesized click fires synchronously after pointerup (same task),
// and the capture-phase listener is still attached to suppress it.
// Verified by checking that the event's _stopped flag is set (the
// capture listener called e.stopImmediatePropagation). The listener
// is then removed on the next task.
//
// Note: in the real browser, Lumiverse's React onClick is delegated to
// a root container via React's synthetic event system — not attached
// directly to the tab. The capture-phase listener on the tab fires
// first (during the capture phase) and calls stopImmediatePropagation,
// which stops the bubble-phase dispatch entirely, so React's delegated
// listener never fires. Our test verifies the capture listener ran
// (via the _stopped flag), which is the behavior that matters.
// ============================================================
{
  const el = new FakeEl()
  let committed = -1
  const teardown = installDrawerTabDrag(el as any, 'main', (vh) => { committed = vh })

  // Full drag sequence
  el.fire('pointerdown', fakeEvent({ clientY: 100 }))
  fakeDoc.fire('pointermove', fakeEvent({ clientY: 150 }))
  assertEqual(el.count('click', true), 1, 'deferred: capture listener installed after threshold cross')

  // Pointerup runs cleanup. The listener is NOT removed yet (deferred).
  fakeDoc.fire('pointerup', fakeEvent())
  assertEqual(committed, 5, 'deferred: onCommit called with 5vh')
  assertEqual(el.count('click', true), 1, 'deferred: capture listener STILL present after pointerup (deferred removal)')

  // Now the browser synthesizes a click from the pointerdown+pointerup
  // pair. The capture-phase listener should fire and call
  // stopImmediatePropagation, setting the _stopped flag on the event.
  const clickEvent = fakeEvent()
  el.fire('click', clickEvent)
  assertEqual(clickEvent._stopped, true, 'deferred: capture listener stopped the synthesized click (regression for drawer open/close)')

  teardown()
}

console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
process.exit(failed > 0 ? 1 : 0)
