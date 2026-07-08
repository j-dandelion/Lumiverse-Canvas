// Test for applyTabListPin in src/sidebar/tab-position.ts
//
// Verifies the pinning behavior:
// - When enabled, the tab list gets position: fixed, top/bottom/[side]: 0,
//   z-index, width, and pointer-events; the drawer's flex-direction is
//   reset; the panel's borders are cleared; the tab list's border is set
//   on the inner (panel-facing) side.
// - When disabled, all of the above are reverted and applyTabListPosition
//   is called to restore the drawer's flex-direction and the panel's
//   chat-facing border.
// - Side awareness: secondary on the right → tab list pinned at right: 0,
//   border on left. Secondary on the left → tab list pinned at left: 0,
//   border on right.
// - Idempotency: calling pin twice does not re-write the inline styles.
// - Mobile no-op: stub matchMedia to return mobile → no styles written.
// - No-wrapper no-op: when the secondary wrapper is null → no styles written.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { failed++; console.error(`FAIL: ${msg} — expected ${String(expected)}, got ${String(actual)}`) }
}

// --- Minimal DOM stubs ---

class StubStyle {
  private _props: Record<string, string> = {}
  get position() { return this._props['position'] ?? '' }
  set position(v: string) { this._props['position'] = v }
  get top() { return this._props['top'] ?? '' }
  set top(v: string) { this._props['top'] = v }
  get bottom() { return this._props['bottom'] ?? '' }
  set bottom(v: string) { this._props['bottom'] = v }
  get left() { return this._props['left'] ?? '' }
  set left(v: string) { this._props['left'] = v }
  get right() { return this._props['right'] ?? '' }
  set right(v: string) { this._props['right'] = v }
  get zIndex() { return this._props['zIndex'] ?? '' }
  set zIndex(v: string) { this._props['zIndex'] = v }
  get width() { return this._props['width'] ?? '' }
  set width(v: string) { this._props['width'] = v }
  get pointerEvents() { return this._props['pointerEvents'] ?? '' }
  set pointerEvents(v: string) { this._props['pointerEvents'] = v }
  get borderLeft() { return this._props['borderLeft'] ?? '' }
  set borderLeft(v: string) { this._props['borderLeft'] = v }
  get borderRight() { return this._props['borderRight'] ?? '' }
  set borderRight(v: string) { this._props['borderRight'] = v }
  get flexDirection() { return this._props['flexDirection'] ?? '' }
  set flexDirection(v: string) { this._props['flexDirection'] = v }
}

class StubElement {
  style = new StubStyle()
  private _className = ''
  get className() { return this._className }
  set className(v: string) { this._className = v }
  private _classSet = new Set<string>()
  classList = {
    add: (c: string) => { this._classSet.add(c); this._className = Array.from(this._classSet).join(' ') },
    remove: (c: string) => { this._classSet.delete(c); this._className = Array.from(this._classSet).join(' ') },
    contains: (c: string) => this._classSet.has(c),
    toString: () => this._className,
  }
  closest(_sel: string): StubElement | null { return null }
  querySelector(_sel: string): StubElement | null { return null }
}

// --- Secondary drawer stubs ---

const stubDrawer = new StubElement()
stubDrawer.className = 'sidebar-ux-drawer'
const stubTabList = new StubElement()
stubTabList.className = 'sidebar-ux-tab-list'
const stubPanel = new StubElement()
stubPanel.className = 'sidebar-ux-panel'

const secondaryWrapper = new StubElement()
secondaryWrapper.querySelector = (sel: string): StubElement | null => {
  if (sel === '.sidebar-ux-drawer') return stubDrawer
  if (sel === '.sidebar-ux-tab-list') return stubTabList
  if (sel === '.sidebar-ux-panel') return stubPanel
  return null
}

// --- Main drawer stubs (for getMainDrawerSide via getMainWrapper) ---

const mainWrapperStub = new StubElement()
const mainSidebarStub = new StubElement()
mainSidebarStub.className = '_sidebar_abc123'
mainSidebarStub.closest = (_sel: string): StubElement | null => mainWrapperStub
// getMainDrawerSide reads wrapper.classList.toString().includes('wrapperLeft')
// so the className must be a string (not the Set serialization). We use a
// className that doesn't go through the classList helper.
;(mainWrapperStub as any).classList = {
  toString: () => mainWrapperStub.className,
}

;(globalThis as any).document = {
  querySelector(sel: string): StubElement | null {
    if (sel === '[data-spindle-mount="sidebar"]') return mainSidebarStub
    if (sel === '.sidebar-ux-drawer') return stubDrawer
    if (sel === '.sidebar-ux-tab-list') return stubTabList
    if (sel === '.sidebar-ux-panel') return stubPanel
    return null
  },
}

;(globalThis as any).window = {
  matchMedia: (_q: string) => ({
    matches: false, // desktop by default
    addEventListener() {},
    removeEventListener() {},
  }),
}

// --- Import after stubs are in place ---

import { applyTabListPin, TAB_LIST_PINNED_CLASS } from '../tab-position'
import { __setSecondaryWrapperForTest } from '../secondary'

// --- Helper: reset stubs between cases ---
// 'side' here is the SECONDARY drawer's side (not the main's).
// The main wrapper's className is set to match (opposite of secondary).

function resetStubs(secondarySide: 'left' | 'right' = 'right') {
  stubDrawer.style = new StubStyle()
  stubTabList.style = new StubStyle()
  stubPanel.style = new StubStyle()
  ;(stubTabList as any).classList = {
    _set: new Set<string>(),
    add(c: string) { this._set.add(c); stubTabList.className = Array.from(this._set).join(' ') },
    remove(c: string) { this._set.delete(c); stubTabList.className = Array.from(this._set).join(' ') },
    contains(c: string) { return this._set.has(c) },
    toString() { return stubTabList.className },
  }
  // Main wrapper's className encodes the MAIN drawer's side.
  // The secondary is on the opposite side.
  mainWrapperStub.className = secondarySide === 'right' ? 'wrapperLeft_wrapper' : 'wrapperRight'
  __setSecondaryWrapperForTest(secondaryWrapper as any)
}

// ============================================================
// Case 1: pin on, secondary on right → tab list pinned at right: 0,
// border on left
// ============================================================
{
  resetStubs('right')  // secondary on right (main on left)

  applyTabListPin(true)

  assertEqual(stubTabList.style.position, 'fixed', 'C1: tab list position = fixed')
  assertEqual(stubTabList.style.top, '0', 'C1: tab list top = 0')
  assertEqual(stubTabList.style.bottom, '0', 'C1: tab list bottom = 0')
  assertEqual(stubTabList.style.right, '0', 'C1: tab list right = 0 (secondary on right)')
  assertEqual(stubTabList.style.zIndex, '10000', 'C1: tab list z-index = 10000')
  assertEqual(stubTabList.style.width, '56px', 'C1: tab list width = 56px')
  assertEqual(stubTabList.style.pointerEvents, 'auto', 'C1: tab list pointer-events = auto')
  assertEqual(stubTabList.style.borderLeft, '1px solid var(--lumiverse-primary-020)', 'C1: tab list borderLeft set (inner side)')
  assertEqual(stubTabList.style.borderRight, 'none', 'C1: tab list borderRight = none')
  assertEqual(stubDrawer.style.flexDirection, '', 'C1: drawer flex-direction reset')
  assertEqual(stubPanel.style.borderRight, 'none', 'C1: panel borderRight cleared')
  assertEqual(stubPanel.style.borderLeft, 'none', 'C1: panel borderLeft cleared')
  assert(stubTabList.classList.contains(TAB_LIST_PINNED_CLASS), 'C1: pinned class added')
}

// ============================================================
// Case 2: pin on, secondary on left → tab list pinned at left: 0,
// border on right
// ============================================================
{
  resetStubs('left')  // secondary on left (main on right)

  applyTabListPin(true)

  assertEqual(stubTabList.style.position, 'fixed', 'C2: tab list position = fixed')
  assertEqual(stubTabList.style.left, '0', 'C2: tab list left = 0 (secondary on left)')
  assertEqual(stubTabList.style.right, '', 'C2: tab list right = empty (secondary on left)')
  assertEqual(stubTabList.style.borderRight, '1px solid var(--lumiverse-primary-020)', 'C2: tab list borderRight set (inner side)')
  assertEqual(stubTabList.style.borderLeft, 'none', 'C2: tab list borderLeft = none')
  assertEqual(stubDrawer.style.flexDirection, '', 'C2: drawer flex-direction reset')
  assert(stubTabList.classList.contains(TAB_LIST_PINNED_CLASS), 'C2: pinned class added')
}

// ============================================================
// Case 3: pin off after pin on — clears all styles, re-applies position
// ============================================================
{
  resetStubs('right')
  applyTabListPin(true)
  // After pin, tab list has position: fixed etc.
  assertEqual(stubTabList.style.position, 'fixed', 'C3: pre-condition — pinned')

  applyTabListPin(false)

  assertEqual(stubTabList.style.position, '', 'C3: position cleared')
  assertEqual(stubTabList.style.top, '', 'C3: top cleared')
  assertEqual(stubTabList.style.bottom, '', 'C3: bottom cleared')
  assertEqual(stubTabList.style.right, '', 'C3: right cleared')
  assertEqual(stubTabList.style.zIndex, '', 'C3: zIndex cleared')
  assertEqual(stubTabList.style.width, '', 'C3: width cleared')
  assertEqual(stubTabList.style.pointerEvents, '', 'C3: pointerEvents cleared')
  assert(!stubTabList.classList.contains(TAB_LIST_PINNED_CLASS), 'C3: pinned class removed')
  // After unpin, applyTabListPosition(moveControlsToOuterEdge) runs.
  // With moveControlsToOuterEdge default (false) and secondary on right
  // (main on left → secondary on right), the drawer's flex-direction is
  // 'row' (tab list on left of drawer, panel on right).
  assertEqual(stubDrawer.style.flexDirection, 'row', 'C3: drawer flex-direction restored via applyTabListPosition')
}

// ============================================================
// Case 4: idempotency — pin twice does not re-write
// ============================================================
{
  resetStubs('right')
  applyTabListPin(true)
  // Snapshot
  const posAfter1 = stubTabList.style.position
  const rightAfter1 = stubTabList.style.right

  applyTabListPin(true)  // second call — no-op

  assertEqual(stubTabList.style.position, posAfter1, 'C4: position unchanged on second pin')
  assertEqual(stubTabList.style.right, rightAfter1, 'C4: right unchanged on second pin')
}

// ============================================================
// Case 5: unpin on already-unpinned tab list — no-op
// ============================================================
{
  resetStubs('right')
  // No pin first — tab list is in default state
  applyTabListPin(false)  // should be a no-op (idempotent)
  assert(!stubTabList.classList.contains(TAB_LIST_PINNED_CLASS), 'C5: no class added')
  assertEqual(stubTabList.style.position, '', 'C5: position unchanged')
}

// ============================================================
// Case 6: mobile no-op — matchMedia returns mobile
// ============================================================
{
  resetStubs('right')
  const origMatchMedia = (globalThis as any).window.matchMedia
  ;(globalThis as any).window.matchMedia = (_q: string) => ({
    matches: true, // mobile
    addEventListener() {},
    removeEventListener() {},
  })

  applyTabListPin(true)

  assertEqual(stubTabList.style.position, '', 'C6: mobile → no position written')
  assertEqual(stubTabList.style.right, '', 'C6: mobile → no right written')
  assert(!stubTabList.classList.contains(TAB_LIST_PINNED_CLASS), 'C6: mobile → no class added')

  ;(globalThis as any).window.matchMedia = origMatchMedia
}

// ============================================================
// Case 7: no secondary wrapper — no-op
// ============================================================
{
  resetStubs('right')
  __setSecondaryWrapperForTest(null)

  applyTabListPin(true)

  assertEqual(stubTabList.style.position, '', 'C7: no wrapper → no position written')
  assert(!stubTabList.classList.contains(TAB_LIST_PINNED_CLASS), 'C7: no wrapper → no class added')

  __setSecondaryWrapperForTest(secondaryWrapper as any)
}

console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
process.exit(failed > 0 ? 1 : 0)
