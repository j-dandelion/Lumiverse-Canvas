// Regression test: showSecondaryTab() writes the active tab's color,
// background, box-shadow inset indicator, and label color as literal
// hex values with `!important` priority (no CSS var) so the active
// state always renders the Lumiverse-default purple (#9370db) — even
// in themes where `--lumiverse-primary` resolves to a non-purple value
// (e.g. the engine dark-mode formula `hsla(h, s, 75, 0.9)` produces
// near-white, identical to `--lumiverse-text-muted`).
//
// Pre-fix, the code wrote just `var(--lumiverse-primary)` with no
// fallback. When the var was missing the browser fell through to the
// inherited color (white-65%), so active and inactive buttons looked
// identical.
//
// The first fix attempt (cb56bc3) added `var(--lumiverse-primary, #9370db)`
// as a CSS-var fallback. This is wrong: CSS var fallbacks only fire when
// the var is UNSET, not when it's set to a wrong value. The user's
// theme sets `--lumiverse-primary` to white-65%, so the fallback is
// never reached and active still renders white.
//
// The correct fix: write the literal purple with `!important` priority
// via `setProperty(name, value, 'important')`. The `!important` flag
// forces the literal to win over any other declaration (including the
// theme-defined var). The inactive case keeps `var(--lumiverse-text-muted)`
// because that var resolves to the user-expected text color.

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
//   - getSecondaryWrapper().querySelectorAll('.sidebar-ux-tab-list button[data-tab-id]')
//     returns our stub buttons
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

const secondaryWrapper = {
  querySelector(_sel: string): unknown {
    // No panel content / title for this test — we only exercise the
    // tab-button styling branch.
    return null
  },
  querySelectorAll(sel: string): StubButton[] {
    if (sel === '.sidebar-ux-tab-list button[data-tab-id]:not(.sidebar-ux-tab-secondary-canvas)') return stubButtons
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
__setSecondaryWrapperForTest(secondaryWrapper as unknown as HTMLElement)

import { showSecondaryTab } from '../buttons'

// ============================================================
// T10: showSecondaryTab('tab1') makes btn1 active and btn2 inactive.
//   - btn1.style.color = '#9370db' with !important
//   - btn2.style.color = 'var(--lumiverse-text-muted)' (no priority)
//   - btn1.style.background = 'rgba(147, 112, 219, 0.2)' with !important
//   - btn1.style.boxShadow references the literal #9370db with !important
//   - btn2.style.boxShadow = 'none'
//   - btn1's label color = '#9370db' with !important
// ============================================================
{
  // Reset button state in case prior tests touched them
  btn1.classList = makeClassList()
  btn2.classList = makeClassList()
  btn1.style = makeStyle()
  btn2.style = makeStyle()
  // The label sub-element is created lazily by querySelector — its style
  // is also reset on each call.
  showSecondaryTab('tab1')

  assertEqual(btn1.style.color, '#9370db',
    'T10.a: active button color is literal #9370db')
  assertEqual(btn1.style.getPropertyPriority('color'), 'important',
    'T10.b: active button color has !important priority')
  assertEqual(btn2.style.color, 'var(--lumiverse-text-muted)',
    'T10.c: inactive button color is var(--lumiverse-text-muted) (no primary var)')
  assertEqual(btn2.style.getPropertyPriority('color'), '',
    'T10.d: inactive button color has no priority')

  assert(btn1.classList.contains('sidebar-ux-tab-active'),
    'T10.e: active button has sidebar-ux-tab-active class')
  assert(!btn2.classList.contains('sidebar-ux-tab-active'),
    'T10.f: inactive button does not have sidebar-ux-tab-active class')

  // Active background should be a literal purple with !important
  assertEqual(btn1.style.background, 'rgba(147, 112, 219, 0.2)',
    'T10.g: active button background is literal purple-20%')
  assertEqual(btn1.style.getPropertyPriority('background'), 'important',
    'T10.h: active button background has !important priority')
  assertEqual(btn2.style.background, '',
    'T10.i: inactive button background is empty string')

  // Active box-shadow: literal #9370db inset, !important, side-aware
  // (with default getMainDrawerSide='right', indicatorOnRight=true → '-3px').
  assertEqual(btn1.style.boxShadow, 'inset -3px 0 0 #9370db',
    'T10.j: active button box-shadow uses literal #9370db with correct inset side')
  assertEqual(btn1.style.getPropertyPriority('box-shadow'), 'important',
    'T10.k: active button box-shadow has !important priority')
  assertEqual(btn2.style.boxShadow, 'none',
    'T10.l: inactive button box-shadow is "none"')

  // Label color: active = literal #9370db with !important, inactive = text-dim
  const label1 = btn1.querySelector('.sidebar-ux-tab-label')
  const label2 = btn2.querySelector('.sidebar-ux-tab-label')
  assertEqual(label1?.style.color, '#9370db',
    'T10.m: active button label color is literal #9370db')
  assertEqual(label1?.style.getPropertyPriority('color'), 'important',
    'T10.n: active button label color has !important priority')
  assertEqual(label2?.style.color, 'var(--lumiverse-text-dim)',
    'T10.o: inactive button label color is var(--lumiverse-text-dim)')
}

// ============================================================
// T11: showSecondaryTab('tab2') switches the active tab.
//   - btn2.style.color = '#9370db' with !important
//   - btn1.style.color = 'var(--lumiverse-text-muted)' (no priority)
//   - The class toggle and box-shadow flip accordingly
// ============================================================
{
  // Reset state
  btn1.classList = makeClassList()
  btn2.classList = makeClassList()
  btn1.style = makeStyle()
  btn2.style = makeStyle()
  showSecondaryTab('tab2')

  assertEqual(btn2.style.color, '#9370db',
    'T11.a: new active button color is literal #9370db')
  assertEqual(btn2.style.getPropertyPriority('color'), 'important',
    'T11.b: new active button color has !important priority')
  assertEqual(btn1.style.color, 'var(--lumiverse-text-muted)',
    'T11.c: now-inactive button color is var(--lumiverse-text-muted)')

  assert(btn2.classList.contains('sidebar-ux-tab-active'),
    'T11.d: new active button has sidebar-ux-tab-active class')
  assert(!btn1.classList.contains('sidebar-ux-tab-active'),
    'T11.e: old active button no longer has the class')

  assertEqual(btn2.style.boxShadow, 'inset -3px 0 0 #9370db',
    'T11.f: new active button box-shadow uses literal #9370db')
  assertEqual(btn2.style.getPropertyPriority('box-shadow'), 'important',
    'T11.g: new active button box-shadow has !important priority')
  assertEqual(btn1.style.boxShadow, 'none',
    'T11.h: now-inactive button box-shadow is "none"')
}

// ============================================================
// T12: Calling showSecondaryTab() twice with the same id is idempotent.
//   The second call writes the same color values, not a different
//   fallback (regression for any "apply once then skip" optimization
//   that might bypass the color write).
// ============================================================
{
  btn1.classList = makeClassList()
  btn2.classList = makeClassList()
  btn1.style = makeStyle()
  btn2.style = makeStyle()
  showSecondaryTab('tab1')
  const firstColor = btn1.style.color
  const firstPriority = btn1.style.getPropertyPriority('color')
  const firstBox = btn1.style.boxShadow
  const firstBoxPriority = btn1.style.getPropertyPriority('box-shadow')
  showSecondaryTab('tab1')
  assertEqual(btn1.style.color, firstColor,
    'T12.a: second call writes the same active color')
  assertEqual(btn1.style.getPropertyPriority('color'), firstPriority,
    'T12.b: second call preserves the !important priority on color')
  assertEqual(btn1.style.boxShadow, firstBox,
    'T12.c: second call writes the same active box-shadow')
  assertEqual(btn1.style.getPropertyPriority('box-shadow'), firstBoxPriority,
    'T12.d: second call preserves the !important priority on box-shadow')
  assertEqual(btn1.style.color, '#9370db',
    'T12.e: idempotent active color is the literal purple')
  assertEqual(btn1.style.getPropertyPriority('color'), 'important',
    'T12.f: idempotent active color has !important')
}

// ============================================================
// T13: Switching active tab demotes the previously-active button:
//   The old active button's !important inline color must be replaced
//   by a non-!important `var(--lumiverse-text-muted)` write. Otherwise
//   the old active tab would stay purple even after the user clicks a
//   different tab.
// ============================================================
{
  // Activate tab1, then switch to tab2
  btn1.classList = makeClassList()
  btn2.classList = makeClassList()
  btn1.style = makeStyle()
  btn2.style = makeStyle()
  showSecondaryTab('tab1')
  showSecondaryTab('tab2')

  // btn1 (now inactive) must NOT have !important on its color
  // (it should be the non-priority var(--lumiverse-text-muted) write)
  assertEqual(btn1.style.getPropertyPriority('color'), '',
    'T13.a: demoted button color has NO !important (was set as inactive)')
  assertEqual(btn1.style.color, 'var(--lumiverse-text-muted)',
    'T13.b: demoted button color is var(--lumiverse-text-muted)')
  assertEqual(btn1.style.boxShadow, 'none',
    'T13.c: demoted button box-shadow is "none"')
  assertEqual(btn1.style.getPropertyPriority('box-shadow'), '',
    'T13.d: demoted button box-shadow has NO !important')
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
