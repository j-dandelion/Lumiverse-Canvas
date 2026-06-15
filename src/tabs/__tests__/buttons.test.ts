// Regression test: showSecondaryTab() writes the active tab's color as
// `var(--lumiverse-primary, #9370db)` (with the `#9370db` literal fallback
// baked in) so the icon color renders correctly even when the
// `--lumiverse-primary` CSS variable is undefined, absent on
// `documentElement` at computation time, or resolves to a non-purple
// value (e.g. white-65% in some themes — the bug the user reported).
//
// Pre-fix, the code wrote just `var(--lumiverse-primary)` with no
// fallback. When the var was missing the browser fell through to the
// inherited color, which in the user's theme was the same white-65%
// that `--lumiverse-text-muted` resolves to, so active and inactive
// buttons looked identical.

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

function makeStyle() {
  return {
    color: '',
    background: '',
    boxShadow: '',
    borderRadius: '',
    cssText: '',
    display: '',
  }
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
  style: ReturnType<typeof makeStyle>
  classList: StubClassList
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
  querySelector(sel: string): { style: ReturnType<typeof makeStyle> } | null
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
    if (sel === '.sidebar-ux-tab-list button[data-tab-id]') return stubButtons
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
//   - btn1.style.color = 'var(--lumiverse-primary, #9370db)' (with fallback)
//   - btn2.style.color = 'var(--lumiverse-text-muted)'
//   - btn1.classList contains 'sidebar-ux-tab-active'
//   - btn2.classList does NOT contain 'sidebar-ux-tab-active'
//   - btn1.style.boxShadow references the primary var with fallback
//   - btn2.style.boxShadow = 'none'
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

  assertEqual(btn1.style.color, 'var(--lumiverse-primary, #9370db)',
    'T10.a: active button color uses var with #9370db fallback')
  assertEqual(btn2.style.color, 'var(--lumiverse-text-muted)',
    'T10.b: inactive button color is var(--lumiverse-text-muted) (no primary var)')

  assert(btn1.classList.contains('sidebar-ux-tab-active'),
    'T10.c: active button has sidebar-ux-tab-active class')
  assert(!btn2.classList.contains('sidebar-ux-tab-active'),
    'T10.d: inactive button does not have sidebar-ux-tab-active class')

  // The fallback should be present anywhere var(--lumiverse-primary)
  // is used, including the boxShadow (active-state indicator).
  assert(btn1.style.boxShadow.includes('var(--lumiverse-primary, #9370db)'),
    'T10.e: active button box-shadow uses var with #9370db fallback')
  assertEqual(btn2.style.boxShadow, 'none',
    'T10.f: inactive button box-shadow is "none"')

  // Label color: active = primary with fallback, inactive = text-dim
  const label1 = btn1.querySelector('.sidebar-ux-tab-label')
  const label2 = btn2.querySelector('.sidebar-ux-tab-label')
  assertEqual(label1?.style.color, 'var(--lumiverse-primary, #9370db)',
    'T10.g: active button label color uses var with #9370db fallback')
  assertEqual(label2?.style.color, 'var(--lumiverse-text-dim)',
    'T10.h: inactive button label color is var(--lumiverse-text-dim)')
}

// ============================================================
// T11: showSecondaryTab('tab2') switches the active tab.
//   - btn2.style.color = 'var(--lumiverse-primary, #9370db)' (with fallback)
//   - btn1.style.color = 'var(--lumiverse-text-muted)'
//   - The class toggle and box-shadow flip accordingly
// ============================================================
{
  // Reset state
  btn1.classList = makeClassList()
  btn2.classList = makeClassList()
  btn1.style = makeStyle()
  btn2.style = makeStyle()
  showSecondaryTab('tab2')

  assertEqual(btn2.style.color, 'var(--lumiverse-primary, #9370db)',
    'T11.a: new active button color uses var with #9370db fallback')
  assertEqual(btn1.style.color, 'var(--lumiverse-text-muted)',
    'T11.b: now-inactive button color is var(--lumiverse-text-muted)')

  assert(btn2.classList.contains('sidebar-ux-tab-active'),
    'T11.c: new active button has sidebar-ux-tab-active class')
  assert(!btn1.classList.contains('sidebar-ux-tab-active'),
    'T11.d: old active button no longer has the class')

  assert(btn2.style.boxShadow.includes('var(--lumiverse-primary, #9370db)'),
    'T11.e: new active button box-shadow uses var with #9370db fallback')
  assertEqual(btn1.style.boxShadow, 'none',
    'T11.f: now-inactive button box-shadow is "none"')
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
  const firstBox = btn1.style.boxShadow
  showSecondaryTab('tab1')
  assertEqual(btn1.style.color, firstColor,
    'T12.a: second call writes the same active color')
  assertEqual(btn1.style.boxShadow, firstBox,
    'T12.b: second call writes the same active box-shadow')
  assertEqual(btn1.style.color, 'var(--lumiverse-primary, #9370db)',
    'T12.c: idempotent active color has the #9370db fallback')
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
