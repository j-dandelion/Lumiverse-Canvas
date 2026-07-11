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
        if (set.has(c)) set.remove(c)
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

// Stub drawer-tab element shared by updateDrawerTabVisibility tests.
// Initialized before import so the wrapper stub can reference it.
const drawerTabStub = { style: { display: '' } }

const secondaryWrapper = {
  querySelector(sel: string): unknown {
    // Unpinned: tab list lives under the wrapper.
    if (sel === '.sidebar-ux-tab-list' && !pinMode) return stubTabList
    // Drawer tab edge toggle (updateDrawerTabVisibility).
    if (sel === '.sidebar-ux-drawer-tab') return drawerTabStub
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
import {
  __setSecondaryWrapperForTest,
  setSecondarySidebarOpen,
  isSecondarySidebarOpen,
} from '../../sidebar/secondary'
import { __setPinHostForTest, __resetPinStateForTest } from '../../sidebar/tab-position'
import { getActiveSecondaryTabId, setActiveSecondaryTabId } from '../active-tab'
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

  assertEqual(btn2.style.background, '',
    'T11.e: new active button inline background cleared')
  assertEqual(btn1.style.background, '',
    'T11.f: old active button inline background cleared')

  assertEqual(btn2.style.boxShadow, '',
    'T11.g: new active button inline box-shadow cleared')
  assertEqual(btn1.style.boxShadow, '',
    'T11.h: old active button inline box-shadow cleared')

  const label1 = btn1.querySelector('.sidebar-ux-tab-label')
  assertEqual(label1?.style.color, '',
    'T11.i: old active button label inline color cleared after switch')
  const label2 = btn2.querySelector('.sidebar-ux-tab-label')
  assertEqual(label2?.style.color, '',
    'T11.j: new active button label inline color cleared')
}

// ============================================================
// T12: showSecondaryTab with pinned tab list (keepTabListVisible on)
//   - Same behavior as unpinned: active class + inline clear
// ============================================================
{
  pinMode = true
  __setPinHostForTest(stubPinHost as unknown as HTMLElement)

  // Reset state
  btn1.classList = makeClassList()
  btn2.classList = makeClassList()
  btn1.style = makeStyle()
  btn2.style = makeStyle()
  showSecondaryTab('tab1')

  assert(btn1.classList.contains('sidebar-ux-tab-active'),
    'T12.a: pinned: active button has sidebar-ux-tab-active class')
  assert(!btn2.classList.contains('sidebar-ux-tab-active'),
    'T12.b: pinned: inactive button does not have sidebar-ux-tab-active class')

  assertEqual(btn1.style.color, '',
    'T12.c: pinned: active button inline color cleared')
  assertEqual(btn2.style.color, '',
    'T12.d: pinned: inactive button inline color cleared')

  __resetPinStateForTest()
  pinMode = false
}

// ============================================================
// T13: showSecondaryTab('tab1') when already active — still sets
//      sidebar-ux-tab-active on btn1 and clears on btn2 (stable).
// ============================================================
{
  btn1.classList = makeClassList()
  btn2.classList = makeClassList()
  btn1.style = makeStyle()
  btn2.style = makeStyle()
  showSecondaryTab('tab1')

  assert(btn1.classList.contains('sidebar-ux-tab-active'),
    'T13.a: same active tab still gets class')
  assert(!btn2.classList.contains('sidebar-ux-tab-active'),
    'T13.b: other tab still does not have class')
}

// ============================================================
// T14: showSecondaryTab after a tab has sticky inline styles
// (e.g. from a previous CSS transition) — must clear them.
// ============================================================
{
  btn1.classList = makeClassList()
  btn2.classList = makeClassList()
  btn1.style = makeStyle()
  btn2.style = makeStyle()
  // Simulate leftover inline styles from a previous CSS transition
  btn1.style.color = 'red'
  btn1.style.background = 'blue'
  btn1.style.boxShadow = '0 0 5px black'
  btn2.style.color = 'green'
  btn2.style.background = 'yellow'
  btn2.style.boxShadow = '0 0 3px gray'

  showSecondaryTab('tab1')

  assertEqual(btn1.style.color, '',
    'T14.a: stale inline color cleared on active tab')
  assertEqual(btn1.style.background, '',
    'T14.b: stale inline background cleared on active tab')
  assertEqual(btn1.style.boxShadow, '',
    'T14.c: stale inline box-shadow cleared on active tab')

  assertEqual(btn2.style.color, '',
    'T14.d: stale inline color cleared on inactive tab')
  assertEqual(btn2.style.background, '',
    'T14.e: stale inline background cleared on inactive tab')
  assertEqual(btn2.style.boxShadow, '',
    'T14.f: stale inline box-shadow cleared on inactive tab')
}

// ============================================================
// T15: showSecondaryTab toggle-close behavior
//
// When the drawer is open and the clicked tab is already the active
// one, showSecondaryTab should close the drawer. This is tested via
// the integration path (addSecondaryTabButton's click handler), but
// showSecondaryTab alone should leave close to the click handler.
// ============================================================
{
  // Open → active match → close
  setSecondarySidebarOpen(true)
  btn1.classList = makeClassList()
  btn2.classList = makeClassList()
  btn1.style = makeStyle()
  btn2.style = makeStyle()
  showSecondaryTab('tab1')

  // showSecondaryTab does not close — it's the click handler that
  // checks isSecondarySidebarOpen + getActiveSecondaryTabId.
  assert(isSecondarySidebarOpen(),
    'T15.a: showSecondaryTab does not close the drawer')

  // showSecondaryTab updates active for switch path
  showSecondaryTab('tab2')
  assertEqual(getActiveSecondaryTabId(), 'tab2', 'T15.e: showSecondaryTab sets active')
  assert(
    isSecondarySidebarOpen() && getActiveSecondaryTabId() === 'tab2',
    'T15.f: after switch, tab2 is the toggle-close target',
  )

  // Closed → not close (open path)
  setSecondarySidebarOpen(false)
  assert(
    !(isSecondarySidebarOpen() && getActiveSecondaryTabId() === 'tab2'),
    'T15.g: when closed, active match does not close',
  )

  // Cleanup
  setActiveSecondaryTabId(null)
  setSecondarySidebarOpen(false)
}

// ============================================================
// T16-T21: updateDrawerTabVisibility — hideDrawerOpenCloseButtons
// ============================================================
import { updateDrawerTabVisibility } from '../buttons'
import { setSettings, getSettings } from '../../settings/state'
import { getTabAssignments } from '../../tabs/assignment'

const savedHideValue = getSettings().hideDrawerOpenCloseButtons
const savedKeepTabs = getSettings().keepTabListVisible
const savedOuterEdge = getSettings().moveControlsToOuterEdge

// T16: Desktop, hide=false, hasSecondaryTabs → flex
{
  setSettings({ hideDrawerOpenCloseButtons: false })
  drawerTabStub.style.display = ''
  getTabAssignments().set('test-tab-16', 'secondary')
  updateDrawerTabVisibility()
  assertEqual(drawerTabStub.style.display, 'flex',
    'T16: desktop hide=false has tabs → flex')
  getTabAssignments().delete('test-tab-16')
}

// T17: Desktop, hide=true + keep-tabs=true + outer-edge=true → none
{
  getTabAssignments().set('test-tab-17', 'secondary')
  setSettings({
    hideDrawerOpenCloseButtons: true,
    keepTabListVisible: true,
    moveControlsToOuterEdge: true,
  })
  drawerTabStub.style.display = ''
  updateDrawerTabVisibility()
  assertEqual(drawerTabStub.style.display, 'none',
    'T17: desktop hide=true keep-tabs=true → none')
  setSettings({
    hideDrawerOpenCloseButtons: false,
    keepTabListVisible: savedKeepTabs,
    moveControlsToOuterEdge: savedOuterEdge,
  })
  getTabAssignments().delete('test-tab-17')
}

// T17a: Desktop, hide=true but keep-tabs=false → flex (hide requires keep-tabs)
{
  setSettings({
    hideDrawerOpenCloseButtons: true,
    keepTabListVisible: false,
    moveControlsToOuterEdge: true,
  })
  drawerTabStub.style.display = ''
  getTabAssignments().set('test-tab-17a', 'secondary')
  updateDrawerTabVisibility()
  assertEqual(drawerTabStub.style.display, 'flex',
    'T17a: desktop hide=true keep-tabs=false → flex (hide requires keep-tabs)')
  setSettings({ hideDrawerOpenCloseButtons: false })
  getTabAssignments().delete('test-tab-17a')
}

// T18: Desktop, hide=false, no secondary tabs → none
{
  setSettings({ hideDrawerOpenCloseButtons: false })
  drawerTabStub.style.display = ''
  // Clear any secondary tabs from previous tests
  for (const [k, v] of [...getTabAssignments()]) {
    if (v === 'secondary') getTabAssignments().delete(k)
  }
  updateDrawerTabVisibility()
  assertEqual(drawerTabStub.style.display, 'none',
    'T18: desktop hide=false no secondary tabs → none')
}

// T19: Mobile, hide=true, hasSecondaryTabs → flex (setting ignored on mobile)
{
  const origMatchMedia = globalThis.window.matchMedia
  globalThis.window.matchMedia = (q: string) => ({ matches: q === '(max-width: 600px)' })
  setSettings({
    hideDrawerOpenCloseButtons: true,
    keepTabListVisible: true,
    moveControlsToOuterEdge: true,
  })
  drawerTabStub.style.display = ''
  getTabAssignments().set('test-tab-19', 'secondary')
  updateDrawerTabVisibility()
  assertEqual(drawerTabStub.style.display, 'flex',
    'T19: mobile hide=true has tabs → flex (setting ignored)')
  getTabAssignments().delete('test-tab-19')
  globalThis.window.matchMedia = origMatchMedia
}

// T20: Mobile, hide=true, no secondary tabs → none (has-tabs still applies)
{
  const origMatchMedia = globalThis.window.matchMedia
  globalThis.window.matchMedia = (q: string) => ({ matches: q === '(max-width: 600px)' })
  setSettings({
    hideDrawerOpenCloseButtons: true,
    keepTabListVisible: true,
    moveControlsToOuterEdge: true,
  })
  drawerTabStub.style.display = ''
  for (const [k, v] of [...getTabAssignments()]) {
    if (v === 'secondary') getTabAssignments().delete(k)
  }
  updateDrawerTabVisibility()
  assertEqual(drawerTabStub.style.display, 'none',
    'T20: mobile hide=true no tabs → none (has-tabs still applies)')
  globalThis.window.matchMedia = origMatchMedia
}

// Restore
setSettings({
  hideDrawerOpenCloseButtons: savedHideValue,
  keepTabListVisible: savedKeepTabs,
  moveControlsToOuterEdge: savedOuterEdge,
})

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
