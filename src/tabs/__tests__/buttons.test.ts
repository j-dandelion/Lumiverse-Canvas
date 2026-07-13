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
// Include resilient documentElement for transitive imports (strip-gutter).
// Preserve addEventListener/removeEventListener for cross-file compatibility.
{
  const _doc = typeof document !== 'undefined' ? document : {} as Document
  // Always use a full stub createElement — bun's document may exist but
  // return incomplete nodes (no classList) when mixed with test stubs.
  const _stubCreateElement = (tag: string) => {
    const children: unknown[] = []
    const attrs: Record<string, string> = {}
    const classSet = new Set<string>()
    const style: Record<string, string> = { display: '' }
    const el = {
      tagName: tag.toUpperCase(),
      tag,
      className: '',
      children,
      attributes: attrs,
      style,
      classList: {
        add(...cs: string[]) {
          for (const c of cs) classSet.add(c)
          el.className = Array.from(classSet).join(' ')
        },
        remove(...cs: string[]) {
          for (const c of cs) classSet.delete(c)
          el.className = Array.from(classSet).join(' ')
        },
        contains(c: string) { return classSet.has(c) },
        toggle(c: string, force?: boolean) {
          if (force === true) classSet.add(c)
          else if (force === false) classSet.delete(c)
          else if (classSet.has(c)) classSet.delete(c)
          else classSet.add(c)
          el.className = Array.from(classSet).join(' ')
        },
      },
      setAttribute(name: string, value: string) { attrs[name] = value },
      getAttribute(name: string) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null },
      removeAttribute(name: string) { delete attrs[name] },
      appendChild(child: unknown) { children.push(child); return child },
      addEventListener() {},
      removeEventListener() {},
      querySelector(_sel: string): unknown { return null },
      querySelectorAll(_sel: string): unknown[] { return children },
      remove() {},
    }
    return el
  }
  ;(globalThis as any).document = {
    ..._doc,
    createElement: _stubCreateElement,
    querySelector(_sel: string): unknown { return null },
    // Resilient documentElement for transitive imports (strip-gutter, main-mirror-drawer).
    documentElement: (_doc as any)?.documentElement || {
      style: { removeProperty() {}, setProperty() {} },
      classList: { add() {}, remove() {}, contains() { return false }, toString() { return '' } },
    },
    // Preserve event listener methods for cross-file compatibility.
    addEventListener: (_doc as any)?.addEventListener || (() => {}),
    removeEventListener: (_doc as any)?.removeEventListener || (() => {}),
  }
}

// Stub CSS.escape since bun doesn't have CSS global.
if (typeof CSS === 'undefined') {
  ;(globalThis as any).CSS = {
    escape: (s: string) => s,
  }
}

// Stub getComputedStyle for the dlog call inside showSecondaryTab
;(globalThis as any).getComputedStyle = (_el: unknown) => ({ color: 'rgb(255, 0, 0)' })

// Stub window.spindle (matches assign-tab-wiring / secondary-drawer-wiring convention)
;(globalThis as any).window = {
  ...((globalThis as any).window || {}),
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
// T12: showSecondaryTab with pinned tab list (taskbarMode on)
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
const savedKeepTabs = getSettings().taskbarMode
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

// T17: Desktop, hide=true + taskbar=true + outer-edge=true → none
{
  getTabAssignments().set('test-tab-17', 'secondary')
  setSettings({
    hideDrawerOpenCloseButtons: true,
    taskbarMode: true,
    moveControlsToOuterEdge: true,
  })
  drawerTabStub.style.display = ''
  updateDrawerTabVisibility()
  assertEqual(drawerTabStub.style.display, 'none',
    'T17: desktop hide=true taskbar=true → none')
  setSettings({
    hideDrawerOpenCloseButtons: false,
    taskbarMode: savedKeepTabs,
    moveControlsToOuterEdge: savedOuterEdge,
  })
  getTabAssignments().delete('test-tab-17')
}

// T17a: Desktop, hide=true but taskbar=false → flex (hide requires taskbar)
{
  setSettings({
    hideDrawerOpenCloseButtons: true,
    taskbarMode: false,
    moveControlsToOuterEdge: true,
  })
  drawerTabStub.style.display = ''
  getTabAssignments().set('test-tab-17a', 'secondary')
  updateDrawerTabVisibility()
  assertEqual(drawerTabStub.style.display, 'flex',
    'T17a: desktop hide=true taskbar=false → flex (hide requires taskbar)')
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
    taskbarMode: true,
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
    taskbarMode: true,
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
  taskbarMode: savedKeepTabs,
  moveControlsToOuterEdge: savedOuterEdge,
})

// ============================================================
// B22-B28: reorderSecondaryTabButtons, applyHiddenTabIdsToSecondary,
// addSecondaryTabButton (mirror-orphan guard)
// ============================================================
import {
  reorderSecondaryTabButtons,
  applyHiddenTabIdsToSecondary,
  addSecondaryTabButton,
} from '../buttons'

// Factory for tab list stubs used by reorder/hide tests.
// Returns a stub with DOM-like querySelector/appendChild/children.
function makeListStub(initialButtons: Array<{
  id: string
  style?: { display?: string }
  /** When true, simulate a mid-drag main-mirror orphan (not a real secondary btn). */
  mirrorOrphan?: boolean
}>): {
  className: string
  children: unknown[]
  querySelector: (sel: string) => unknown
  querySelectorAll: (sel: string) => unknown[]
  appendChild: (child: unknown) => void
} {
  // Each "button" is a lightweight object with data-tab-id attribute via getAttribute.
  const listStub: {
    className: string
    children: unknown[]
    querySelector: (sel: string) => unknown
    querySelectorAll: (sel: string) => unknown[]
    appendChild: (child: unknown) => void
    insertBefore: (child: unknown, ref: unknown) => void
  } = {} as any

  const items: any[] = initialButtons.map((b) => {
    const classes = new Set<string>()
    if (b.mirrorOrphan) classes.add('sidebar-ux-main-tab-mirror-btn')
    const el: any = {
      _id: b.id,
      style: { display: b.style?.display ?? '' },
      classList: {
        contains(c: string) { return classes.has(c) },
        add(c: string) { classes.add(c) },
      },
      getAttribute(name: string) { return name === 'data-tab-id' ? b.id : null },
      closest(_sel: string) { return null },
      get parentNode() { return listStub },
      get nextSibling() {
        const idx = items.indexOf(el)
        return idx >= 0 && idx < items.length - 1 ? items[idx + 1] : null
      },
      remove() {
        const idx = items.indexOf(el)
        if (idx >= 0) items.splice(idx, 1)
      },
    }
    return el
  })

  Object.assign(listStub, {
    className: 'sidebar-ux-tab-list',
    children: items as unknown[],
    querySelector(sel: string) {
      // Handle [data-tab-id="..."]
      const match = sel.match(/\[data-tab-id="([^"]+)"\]/)
      if (match) {
        return items.find((i) => i._id === match[1] || i.getAttribute?.('data-tab-id') === match[1]) ?? null
      }
      return null
    },
    querySelectorAll(sel: string) {
      if (sel === 'button[data-tab-id]') return items as unknown[]
      const match = sel.match(/\[data-tab-id="([^"]+)"\]/)
      if (match) {
        return items.filter(
          (i) => i._id === match[1] || i.getAttribute?.('data-tab-id') === match[1],
        ) as unknown[]
      }
      return []
    },
    appendChild(child: unknown) {
      // "Move" the child to the end (re-insert rather than duplicate).
      const idx = items.indexOf(child as any)
      if (idx >= 0) {
        items.splice(idx, 1)
      }
      items.push(child as any)
    },
    insertBefore(child: unknown, ref: unknown) {
      const fromIdx = items.indexOf(child as any)
      if (fromIdx >= 0) items.splice(fromIdx, 1)
      if (ref == null) {
        items.push(child as any)
        return
      }
      const refIdx = items.indexOf(ref as any)
      if (refIdx < 0) {
        items.push(child as any)
        return
      }
      items.splice(refIdx, 0, child as any)
    },
  })

  return listStub
}

// ============================================================
// B22: reorderSecondaryTabButtons — reorders buttons via DOM appendChild
// ============================================================
{
  const listStub = makeListStub([
    { id: 'tab-a', style: {} },
    { id: 'tab-b', style: {} },
    { id: 'tab-c', style: {} },
  ])

  // Set up a wrapper that returns our list stub.
  const wrapper = {
    querySelector(sel: string) {
      if (sel === '.sidebar-ux-tab-list') return listStub as unknown as HTMLElement
      return null
    },
    querySelectorAll() { return [] },
  }
  __setSecondaryWrapperForTest(wrapper as unknown as HTMLElement)

  // Initial order: a, b, c
  assertEqual((listStub.children as any[])[0]._id, 'tab-a', 'B22: initial order a')
  assertEqual((listStub.children as any[])[1]._id, 'tab-b', 'B22: initial order b')
  assertEqual((listStub.children as any[])[2]._id, 'tab-c', 'B22: initial order c')

  // Reorder to: c, a, b
  reorderSecondaryTabButtons(['tab-c', 'tab-a', 'tab-b'])

  assertEqual((listStub.children as any[]).length, 3, 'B22.a: still 3 children after reorder')
  assertEqual((listStub.children as any[])[0]._id, 'tab-c', 'B22.b: first is tab-c')
  assertEqual((listStub.children as any[])[1]._id, 'tab-a', 'B22.c: second is tab-a')
  assertEqual((listStub.children as any[])[2]._id, 'tab-b', 'B22.d: third is tab-b')

  // Reorder again: b, c, a
  reorderSecondaryTabButtons(['tab-b', 'tab-c', 'tab-a'])

  assertEqual((listStub.children as any[])[0]._id, 'tab-b', 'B22.e: first is tab-b')
  assertEqual((listStub.children as any[])[1]._id, 'tab-c', 'B22.f: second is tab-c')
  assertEqual((listStub.children as any[])[2]._id, 'tab-a', 'B22.g: third is tab-a')

  __setSecondaryWrapperForTest(null)
}

// ============================================================
// B23: reorderSecondaryTabButtons — missing ids are skipped
// ============================================================
{
  const listStub = makeListStub([
    { id: 'tab-x', style: {} },
    { id: 'tab-y', style: {} },
  ])

  const wrapper = {
    querySelector(sel: string) {
      if (sel === '.sidebar-ux-tab-list') return listStub as unknown as HTMLElement
      return null
    },
    querySelectorAll() { return [] },
  }
  __setSecondaryWrapperForTest(wrapper as unknown as HTMLElement)

  // Attempt to reorder including a non-existent id.
  reorderSecondaryTabButtons(['tab-y', 'tab-z', 'tab-x'])

  const items = listStub.children as any[]
  assertEqual(items.length, 2, 'B23.a: still 2 children')
  assertEqual(items[0]._id, 'tab-y', 'B23.b: first is tab-y')
  assertEqual(items[1]._id, 'tab-x', 'B23.c: second is tab-x')

  __setSecondaryWrapperForTest(null)
}

// ============================================================
// B24: reorderSecondaryTabButtons — no-op when tabList is null
// ============================================================
{
  __setSecondaryWrapperForTest(null)
  // Should not throw.
  reorderSecondaryTabButtons(['tab-a', 'tab-b'])
  assert(true, 'B24: no-op does not throw when tabList is null')
}

// ============================================================
// B25: applyHiddenTabIdsToSecondary — hides matching buttons
// ============================================================
{
  const listStub = makeListStub([
    { id: 'hide-me', style: {} },
    { id: 'show-me', style: {} },
    { id: 'hide-me-too', style: {} },
  ])

  const wrapper = {
    querySelector(sel: string) {
      if (sel === '.sidebar-ux-tab-list') return listStub as unknown as HTMLElement
      return null
    },
    querySelectorAll() { return [] },
  }
  __setSecondaryWrapperForTest(wrapper as unknown as HTMLElement)

  applyHiddenTabIdsToSecondary(new Set(['hide-me', 'hide-me-too']))

  const items = listStub.children as any[]
  assertEqual(items[0].style.display, 'none', 'B25.a: hide-me button hidden')
  assertEqual(items[1].style.display, '', 'B25.b: show-me button visible')
  assertEqual(items[2].style.display, 'none', 'B25.c: hide-me-too button hidden')

  __setSecondaryWrapperForTest(null)
}

// ============================================================
// B26: applyHiddenTabIdsToSecondary — no-op when tabList is null
// ============================================================
{
  __setSecondaryWrapperForTest(null)
  applyHiddenTabIdsToSecondary(new Set(['any-tab']))
  assert(true, 'B26: no-op does not throw when tabList is null')
}

// ============================================================
// B27: applyHiddenTabIdsToSecondary — clear hidden works
// ============================================================
{
  const listStub = makeListStub([
    { id: 'toggle-tab', style: { display: 'none' } },
  ])

  const wrapper = {
    querySelector(sel: string) {
      if (sel === '.sidebar-ux-tab-list') return listStub as unknown as HTMLElement
      return null
    },
    querySelectorAll() { return [] },
  }
  __setSecondaryWrapperForTest(wrapper as unknown as HTMLElement)

  // Apply empty set (unhide all).
  applyHiddenTabIdsToSecondary(new Set())

  const items = listStub.children as any[]
  assertEqual(items[0].style.display, '', 'B27: toggle-tab button shown')

  __setSecondaryWrapperForTest(null)
}

// ============================================================
// B28: addSecondaryTabButton ignores mid-drag mirror orphans
//
// Live DnD can park a .sidebar-ux-main-tab-mirror-btn with the same
// data-tab-id in the secondary list. That must not block creating a
// real secondary button (and the orphan should be removed).
// ============================================================
{
  const listStub = makeListStub([
    { id: 'moved-tab', mirrorOrphan: true },
  ])

  const wrapper = {
    querySelector(sel: string) {
      if (sel === '.sidebar-ux-tab-list') return listStub as unknown as HTMLElement
      return null
    },
    querySelectorAll() { return [] },
  }
  __setSecondaryWrapperForTest(wrapper as unknown as HTMLElement)

  const root = document.createElement('div')
  addSecondaryTabButton({
    id: 'moved-tab',
    title: 'Moved Tab',
    root: root as unknown as HTMLElement,
  })

  const items = listStub.children as any[]
  // Orphan mirror removed; real secondary button appended.
  assertEqual(items.length, 1, 'B28.a: one child after add (orphan replaced)')
  const created = items[0]
  const createdId =
    created?.getAttribute?.('data-tab-id') ??
    created?.attrs?.['data-tab-id'] ??
    created?._id
  assertEqual(createdId, 'moved-tab', 'B28.b: created button has data-tab-id=moved-tab')
  assert(
    !created?.classList?.contains?.('sidebar-ux-main-tab-mirror-btn'),
    'B28.c: created button is not a mirror orphan',
  )

  // Second call with real button present is a no-op (still one child).
  addSecondaryTabButton({
    id: 'moved-tab',
    title: 'Moved Tab',
    root: root as unknown as HTMLElement,
  })
  assertEqual(
    (listStub.children as any[]).length,
    1,
    'B28.d: already-has real secondary → no duplicate',
  )

  __setSecondaryWrapperForTest(null)
}

// B28e: foreign mid-drag mirror orphan is replaced *in place* (not append)
// so neighbors do not collapse/re-expand when the real secondary button lands.
{
  const listStub = makeListStub([
    { id: 'keep-a' },
    { id: 'moved-tab', mirrorOrphan: true },
    { id: 'keep-b' },
  ])
  const wrapper = {
    querySelector(sel: string) {
      if (sel === '.sidebar-ux-tab-list') return listStub as unknown as HTMLElement
      return null
    },
    querySelectorAll() { return [] },
  }
  __setSecondaryWrapperForTest(wrapper as unknown as HTMLElement)

  addSecondaryTabButton({
    id: 'moved-tab',
    title: 'Moved Tab',
    root: document.createElement('div') as unknown as HTMLElement,
  })

  const items = listStub.children as any[]
  assertEqual(items.length, 3, 'B28e.a: still three slots after in-place replace')
  assertEqual(
    items[0]?.getAttribute?.('data-tab-id') ?? items[0]?._id,
    'keep-a',
    'B28e.b: first sibling unchanged',
  )
  assertEqual(
    items[1]?.getAttribute?.('data-tab-id') ?? items[1]?._id,
    'moved-tab',
    'B28e.c: real secondary sits where orphan was (middle)',
  )
  assertEqual(
    items[2]?.getAttribute?.('data-tab-id') ?? items[2]?._id,
    'keep-b',
    'B28e.d: last sibling unchanged',
  )
  assert(
    !items[1]?.classList?.contains?.('sidebar-ux-main-tab-mirror-btn'),
    'B28e.e: middle button is not a mirror orphan',
  )

  __setSecondaryWrapperForTest(null)
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
