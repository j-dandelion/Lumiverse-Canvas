// Test for showSecondaryTab().
//
// showSecondaryTab toggles the sidebar-ux-tab-active CSS class on tab
// buttons and clears any leftover inline styles so the CSS rules in
// src/sidebar/styles.ts drive the active visual. The active tab's root
// gets data-canvas-active and the header title is updated.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { failed++; console.error(`FAIL: ${msg} — expected ${String(expected)}, got ${String(actual)}`) }
}

// --- Stub the DOM ---
//
// showSecondaryTab needs:
//   - getSecondaryWrapper() returns our stub (via __setSecondaryWrapperForTest)
//   - getSecondaryTabList() resolves via wrapper.querySelector('.sidebar-ux-tab-list')
//     (unpinned) or getPinnedTabList() / module pin host (pinned)
//   - tab list querySelectorAll('button[data-tab-id]') returns stub buttons
//   - getMainDrawerSide() falls through to the default 'right' (no DOM matches)
//   - getComputedStyle(btn).color (the dlog call uses it for debug output)
//
// We deliberately do NOT stub panel content / moved roots, so the
// "findMainTabButton" call inside the moved-roots loop is never reached.
// The test focuses on the tab-button styling that showSecondaryTab writes.

type StubStyle = {
  color: string
  background: string
  boxShadow: string
  borderRadius: string
  cssText: string
  display: string
  _priorities: Record<string, string>
  setProperty(name: string, value: string, priority?: string): void
  getPropertyPriority(name: string): string
  removeProperty(name: string): void
}

// Convert a camelCase JS property name (e.g. "boxShadow") to the
// corresponding CSS property name (e.g. "box-shadow"). Real browsers
// store the CSS name internally; the JS accessors are convenience
// aliases. Our stub mirrors that.
function _toCssName(jsName: string): string {
  return jsName.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
}

function makeStyle(): StubStyle {
  // Internal map keyed by the CSS property name (e.g. 'box-shadow').
  const props: Record<string, string> = {}
  const priorities: Record<string, string> = {}
  const style: StubStyle = {
    get color() { return props.color ?? '' },
    set color(v: string) { style.setProperty('color', v) },
    get background() { return props.background ?? '' },
    set background(v: string) { style.setProperty('background', v) },
    get boxShadow() { return props['box-shadow'] ?? '' },
    set boxShadow(v: string) { style.setProperty('box-shadow', v) },
    get borderRadius() { return props['border-radius'] ?? '' },
    set borderRadius(v: string) { style.setProperty('border-radius', v) },
    cssText: '',
    display: '',
    _priorities: priorities,
    setProperty(name: string, value: string, priority?: string) {
      props[name] = value
      if (priority) priorities[name] = priority
      else delete priorities[name]
    },
    getPropertyPriority(name: string) {
      return priorities[name] ?? ''
    },
    removeProperty(name: string) {
      delete props[name]
      delete priorities[name]
    },
  }
  return style
}

type StubClassList = {
  _set: Set<string>
  add(c: string): void
  remove(c: string): void
  contains(c: string): boolean
  toggle(c: string, force?: boolean): void
  toString(): string
}

function makeClassList(): StubClassList {
  const set = new Set<string>()
  return {
    _set: set,
    add(c) { set.add(c) },
    remove(c) { set.delete(c) },
    contains(c) { return set.has(c) },
    toggle(c, force) {
      if (force === undefined) {
        if (set.has(c)) set.delete(c)
        else set.add(c)
      } else if (force) {
        set.add(c)
      } else {
        set.delete(c)
      }
    },
    toString() { return Array.from(set).join(' ') },
  }
}

type StubButton = {
  attrs: Record<string, string>
  style: StubStyle
  classList: StubClassList
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
  querySelector(sel: string): { style: StubStyle } | null
}

function makeButton(tabId: string, title: string): StubButton {
  const attrs: Record<string, string> = { 'data-tab-id': tabId, title }
  const style = makeStyle()
  // The label sub-element must be a stable reference — the test
  // inspects it after showSecondaryTab returns, and each
  // querySelector call must return the same object so the writes
  // land on the inspected instance.
  const label = { style: makeStyle() }
  return {
    attrs,
    style,
    classList: makeClassList(),
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null },
    setAttribute(name, value) { attrs[name] = value },
    removeAttribute(name) { delete attrs[name] },
    querySelector(sel) {
      if (sel === '.sidebar-ux-tab-label') return label
      return null
    },
  }
}

// Pre-populate a tab list with 2 stub buttons
const btn1 = makeButton('tab1', 'Tab One')
const btn2 = makeButton('tab2', 'Tab Two')
const stubButtons: StubButton[] = [btn1, btn2]

// Unpinned: list under wrapper.
const stubTabList = {
  className: 'sidebar-ux-tab-list',
  querySelector(_sel: string): unknown { return null },
  querySelectorAll(sel: string): StubButton[] {
    if (sel === 'button[data-tab-id]') return stubButtons
    return []
  },
}

// Pinned: list under module pin host (getPinnedTabList).
const stubPinnedTabList = {
  className: 'sidebar-ux-tab-list sidebar-ux-tab-list--pinned',
  querySelector(_sel: string): unknown { return null },
  querySelectorAll(sel: string): StubButton[] {
    if (sel === 'button[data-tab-id]') return stubButtons
    return []
  },
}
const stubPinHost = {
  className: 'sidebar-ux-tab-list-pin-host',
  children: [stubPinnedTabList] as unknown[],
  querySelector(sel: string): unknown {
    if (typeof sel === 'string' && sel.includes('sidebar-ux-tab-list')) return stubPinnedTabList
    return null
  },
}

let pinMode = false

const secondaryWrapper = {
  querySelector(sel: string): unknown {
    // Unpinned: tab list lives under the wrapper.
    if (sel === '.sidebar-ux-tab-list' && !pinMode) return stubTabList
    // No panel content / title for this test — styling branch only.
    return null
  },
  querySelectorAll(_sel: string): StubButton[] {
    return []
  },
}

// Stub document.querySelector so getMainDrawerSide() falls through to
// the default 'right' (no DOM wrappers, no store cache).
;(globalThis as any).document = {
  querySelector(_sel: string): unknown { return null },
}

// Stub getComputedStyle for the dlog call inside showSecondaryTab
;(globalThis as any).getComputedStyle = (_el: unknown) => ({ color: 'rgb(255, 0, 0)' })

// Stub window.spindle (matches assign-tab-wiring / secondary-drawer-wiring convention)
;(globalThis as any).window = {
  spindle: {
    ui: {
      getBuiltInTabRoot: () => undefined,
      requestTabLocation: (_tabId: string, _loc: unknown) => {},
      getTabLocation: () => null,
    },
    containers: {},
  },
  matchMedia(q: string) {
    if (q === '(max-width: 600px)') return { matches: false }
    return { matches: false }
  },
}

// --- Import the module under test ---
//
// We have to import secondary first to use __setSecondaryWrapperForTest,
// then import the buttons module and set the wrapper. The import order
// matters: setting the wrapper before showSecondaryTab is called ensures
// the getter returns the stub.
import { __setSecondaryWrapperForTest } from '../../sidebar/secondary'
import { __setPinHostForTest, __resetPinStateForTest } from '../../sidebar/tab-position'
__setSecondaryWrapperForTest(secondaryWrapper as unknown as HTMLElement)

import { showSecondaryTab } from '../buttons'

// ============================================================
// T10: showSecondaryTab('tab1') makes btn1 active and btn2 inactive.
//   - sidebar-ux-tab-active class toggled on btn1, cleared on btn2
//   - Inline styles cleared on both buttons so CSS takes over
// ============================================================
{
  // Reset button state in case prior tests touched them
  btn1.classList = makeClassList()
  btn2.classList = makeClassList()
  btn1.style = makeStyle()
  btn2.style = makeStyle()
  showSecondaryTab('tab1')

  assert(btn1.classList.contains('sidebar-ux-tab-active'),
    'T10.a: active button has sidebar-ux-tab-active class')
  assert(!btn2.classList.contains('sidebar-ux-tab-active'),
    'T10.b: inactive button does not have sidebar-ux-tab-active class')

  // Inline styles cleared on all buttons — CSS drives the visuals.
  assertEqual(btn1.style.color, '',
    'T10.c: active button inline color cleared')
  assertEqual(btn1.style.background, '',
    'T10.d: active button inline background cleared')
  assertEqual(btn1.style.boxShadow, '',
    'T10.e: active button inline box-shadow cleared')
  assertEqual(btn2.style.color, '',
    'T10.f: inactive button inline color cleared')
  assertEqual(btn2.style.boxShadow, '',
    'T10.g: inactive button inline box-shadow cleared')

  // Label styles cleared too.
  const label1 = btn1.querySelector('.sidebar-ux-tab-label')
  assertEqual(label1?.style.color, '',
    'T10.h: active button label inline color cleared')
}

// ============================================================
// T11: showSecondaryTab('tab2') switches the active tab.
//   - sidebar-ux-tab-active class toggled on btn2, cleared on btn1
//   - Inline styles cleared on both buttons
// ============================================================
{
  // Reset state
  btn1.classList = makeClassList()
  btn2.classList = makeClassList()
  btn1.style = makeStyle()
  btn2.style = makeStyle()
  showSecondaryTab('tab2')

  assert(btn2.classList.contains('sidebar-ux-tab-active'),
    'T11.a: new active button has sidebar-ux-tab-active class')
  assert(!btn1.classList.contains('sidebar-ux-tab-active'),
    'T11.b: old active button no longer has the class')

  assertEqual(btn2.style.color, '',
    'T11.c: new active button inline color cleared')
  assertEqual(btn1.style.color, '',
    'T11.d: old active button inline color cleared')
  assertEqual(btn2.style.boxShadow, '',
    'T11.e: new active button inline box-shadow cleared')
  assertEqual(btn1.style.boxShadow, '',
    'T11.f: old active button inline box-shadow cleared')
}

// ============================================================
// T12: Calling showSecondaryTab() twice with the same id is idempotent.
//   The second call produces the same class state as the first.
// ============================================================
{
  btn1.classList = makeClassList()
  btn2.classList = makeClassList()
  btn1.style = makeStyle()
  btn2.style = makeStyle()
  showSecondaryTab('tab1')
  showSecondaryTab('tab1')

  assert(btn1.classList.contains('sidebar-ux-tab-active'),
    'T12.a: idempotent active button has sidebar-ux-tab-active class')
  assert(!btn2.classList.contains('sidebar-ux-tab-active'),
    'T12.b: idempotent inactive button still lacks the class')
  assertEqual(btn1.style.color, '',
    'T12.c: idempotent active button inline color still cleared')
}

// ============================================================
// T13: Switching active tab demotes the previously-active button:
//   The old active button loses the sidebar-ux-tab-active class
//   and all inline styles are cleared.
// ============================================================
{
  // Activate tab1, then switch to tab2
  btn1.classList = makeClassList()
  btn2.classList = makeClassList()
  btn1.style = makeStyle()
  btn2.style = makeStyle()
  showSecondaryTab('tab1')
  showSecondaryTab('tab2')

  assert(!btn1.classList.contains('sidebar-ux-tab-active'),
    'T13.a: demoted button lost sidebar-ux-tab-active class')
  assert(btn2.classList.contains('sidebar-ux-tab-active'),
    'T13.b: new active button has sidebar-ux-tab-active class')
  assertEqual(btn1.style.color, '',
    'T13.c: demoted button inline color cleared')
  assertEqual(btn1.style.boxShadow, '',
    'T13.d: demoted button inline box-shadow cleared')
}

// ============================================================
// T14: keepTabListVisible (pin host) — showSecondaryTab still updates
//   highlight when the tab list is outside the secondary wrapper.
// ============================================================
{
  pinMode = true
  __setPinHostForTest(stubPinHost as unknown as HTMLElement)
  btn1.classList = makeClassList()
  btn2.classList = makeClassList()
  btn1.style = makeStyle()
  btn2.style = makeStyle()
  showSecondaryTab('tab1')

  assert(btn1.classList.contains('sidebar-ux-tab-active'),
    'T14.a: pinned list — active button has sidebar-ux-tab-active')
  assert(!btn2.classList.contains('sidebar-ux-tab-active'),
    'T14.b: pinned list — inactive button lacks the class')

  showSecondaryTab('tab2')
  assert(!btn1.classList.contains('sidebar-ux-tab-active'),
    'T14.c: pinned list — old active demoted after switch')
  assert(btn2.classList.contains('sidebar-ux-tab-active'),
    'T14.d: pinned list — new active promoted after switch')

  pinMode = false
  __resetPinStateForTest()
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
