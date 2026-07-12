// Test for applyTabListPin in src/sidebar/tab-position.ts
//
// Verifies pinning behavior:
// - Fixed styles + safe-area insets + side-aware edges
// - Reparent onto pin host out of a transformed ancestor + drawer spacer
// - Unpin restores parent, width 56px, removes host/spacer
// - Idempotency, mobile no-op / force-clear, no-wrapper no-op
// - applyTabListPosition does not fight pin while pinned

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { failed++; console.error(`FAIL: ${msg} — expected ${String(expected)}, got ${String(actual)}`) }
}

// --- Minimal DOM stubs (parent/child stay consistent) ---

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
  get flexShrink() { return this._props['flexShrink'] ?? '' }
  set flexShrink(v: string) { this._props['flexShrink'] = v }
}

class StubElement {
  style = new StubStyle()
  className = ''
  private _classSet = new Set<string>()
  parentElement: StubElement | null = null
  children: StubElement[] = []
  nextSibling: StubElement | null = null
  firstChild: StubElement | null = null
  childNodes: StubElement[] = []
  classList = {
    add: (c: string) => { this._classSet.add(c); this.className = Array.from(this._classSet).join(' ') },
    remove: (c: string) => { this._classSet.delete(c); this.className = Array.from(this._classSet).join(' ') },
    contains: (c: string) => this._classSet.has(c),
    toString: () => this.className,
  }
  closest(_sel: string): StubElement | null { return null }
  querySelector(_sel: string): StubElement | null { return null }
  setAttribute(_k: string, _v: string) {}
  remove() {
    if (this.parentElement) this.parentElement.removeChild(this)
  }
  removeChild(child: StubElement) {
    this.children = this.children.filter((c) => c !== child)
    this.childNodes = this.children
    this.firstChild = this.children[0] ?? null
    child.parentElement = null
    this._relinkSiblings()
    return child
  }
  appendChild(child: StubElement) {
    if (child.parentElement) child.parentElement.removeChild(child)
    this.children.push(child)
    this.childNodes = this.children
    this.firstChild = this.children[0] ?? null
    child.parentElement = this
    this._relinkSiblings()
    return child
  }
  insertBefore(child: StubElement, ref: StubElement | null) {
    if (child.parentElement) child.parentElement.removeChild(child)
    if (!ref) return this.appendChild(child)
    const idx = this.children.indexOf(ref)
    if (idx < 0) return this.appendChild(child)
    this.children.splice(idx, 0, child)
    this.childNodes = this.children
    this.firstChild = this.children[0] ?? null
    child.parentElement = this
    this._relinkSiblings()
    return child
  }
  private _relinkSiblings() {
    for (let i = 0; i < this.children.length; i++) {
      this.children[i].nextSibling = this.children[i + 1] ?? null
    }
  }
}

const stubDrawer = new StubElement()
stubDrawer.className = 'sidebar-ux-drawer'
const stubTabList = new StubElement()
stubTabList.className = 'sidebar-ux-tab-list'
const stubPanel = new StubElement()
stubPanel.className = 'sidebar-ux-panel'

const secondaryWrapper = new StubElement()
secondaryWrapper.className = 'sidebar-ux-secondary-wrapper'
secondaryWrapper.style = new StubStyle()
// Production wrapper always has a non-none transform (the containing-block bug).
;(secondaryWrapper.style as any).transform = 'translateX(420px)'
secondaryWrapper.querySelector = (sel: string): StubElement | null => {
  if (sel === '.sidebar-ux-drawer') return stubDrawer
  if (sel === '.sidebar-ux-tab-list') {
    // Only when still under the drawer (unpinned)
    let p: StubElement | null = stubTabList.parentElement
    while (p) {
      if (p === stubDrawer) return stubTabList
      p = p.parentElement
    }
    return null
  }
  if (sel === '.sidebar-ux-panel') return stubPanel
  return null
}

function wireDefaultTree() {
  // Detach cleanly so parent/child stay consistent
  while (secondaryWrapper.firstChild) secondaryWrapper.removeChild(secondaryWrapper.firstChild!)
  while (stubDrawer.firstChild) stubDrawer.removeChild(stubDrawer.firstChild!)
  if (stubTabList.parentElement) stubTabList.parentElement.removeChild(stubTabList)
  if (stubPanel.parentElement) stubPanel.parentElement.removeChild(stubPanel)
  secondaryWrapper.appendChild(stubDrawer)
  stubDrawer.appendChild(stubTabList)
  stubDrawer.appendChild(stubPanel)
}

const mainWrapperStub = new StubElement()
const mainSidebarStub = new StubElement()
mainSidebarStub.className = '_sidebar_abc123'
mainSidebarStub.closest = (_sel: string): StubElement | null => mainWrapperStub
;(mainWrapperStub as any).classList = {
  toString: () => mainWrapperStub.className,
}

const bodyStub = new StubElement()
bodyStub.className = 'body'

;(globalThis as any).document = {
  body: bodyStub,
  createElement(_tag: string): StubElement {
    return new StubElement()
  },
  querySelector(sel: string): StubElement | null {
    if (sel === '[data-spindle-mount="sidebar"]') return mainSidebarStub
    if (sel.includes('sidebar-ux-tab-list-pin-host') && sel.includes('tab-list')) {
      for (const c of bodyStub.children) {
        if (c.className.includes('sidebar-ux-tab-list-pin-host')) {
          for (const ch of c.children) {
            if (ch.className.includes('sidebar-ux-tab-list')) return ch
          }
        }
      }
    }
    return null
  },
  querySelectorAll(sel: string): StubElement[] {
    if (sel.includes('sidebar-ux-tab-list-pin-host')) {
      return bodyStub.children.filter((c) => c.className.includes('sidebar-ux-tab-list-pin-host'))
    }
    return []
  },
}

;(globalThis as any).window = {
  matchMedia: (_q: string) => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }),
  addEventListener() {},
  removeEventListener() {},
}

import {
  applyTabListPin,
  applyTabListPosition,
  getPinnedTabList,
  TAB_LIST_PINNED_CLASS,
  TAB_LIST_PIN_HOST_CLASS,
  TAB_LIST_SPACER_CLASS,
  TAB_LIST_WIDTH_PX,
  reconcileTabListPin,
  __getPinHostForTest,
  __resetPinStateForTest,
} from '../tab-position'
import { __setSecondaryWrapperForTest, getSecondaryTabList } from '../secondary'
import {
  clearTabAssignments,
  setTabAssignment,
  deleteTabAssignment,
} from '../../tabs/assignment'

const SAFE_TOP = 'env(safe-area-inset-top, 0px)'
const SAFE_BOTTOM = 'env(safe-area-inset-bottom, 0px)'
const STUB_SECONDARY_TAB = 'stub-secondary-tab'

function resetStubs(secondarySide: 'left' | 'right' = 'right') {
  // Ensure getters can find the tree, then clear module pin state.
  __setSecondaryWrapperForTest(secondaryWrapper as any)
  ;(globalThis as any).window.matchMedia = (_q: string) => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  })
  // Pin enable requires at least one secondary assignment.
  clearTabAssignments()
  setTabAssignment(STUB_SECONDARY_TAB, 'secondary')
  applyTabListPin(false, { force: true })

  while (bodyStub.firstChild) bodyStub.removeChild(bodyStub.firstChild!)
  stubDrawer.style = new StubStyle()
  stubTabList.style = new StubStyle()
  stubTabList.style.width = `${TAB_LIST_WIDTH_PX}px`
  stubPanel.style = new StubStyle()
  stubTabList.className = 'sidebar-ux-tab-list'
  ;(stubTabList as any).classList = {
    _set: new Set<string>(),
    add(c: string) { this._set.add(c); stubTabList.className = ['sidebar-ux-tab-list', ...this._set].join(' ') },
    remove(c: string) { this._set.delete(c); stubTabList.className = ['sidebar-ux-tab-list', ...this._set].join(' ') },
    contains(c: string) { return this._set.has(c) },
    toString() { return stubTabList.className },
  }
  mainWrapperStub.className = secondarySide === 'right' ? 'wrapperLeft_wrapper' : 'wrapperRight'
  wireDefaultTree()
}

// C1: pin on, secondary on right
{
  resetStubs('right')
  applyTabListPin(true)

  assertEqual(stubTabList.style.position, 'fixed', 'C1: position = fixed')
  assertEqual(stubTabList.style.top, SAFE_TOP, 'C1: top uses safe-area')
  assertEqual(stubTabList.style.bottom, SAFE_BOTTOM, 'C1: bottom uses safe-area')
  assertEqual(stubTabList.style.right, '0', 'C1: right = 0')
  assertEqual(stubTabList.style.zIndex, '10000', 'C1: z-index')
  assertEqual(stubTabList.style.width, '56px', 'C1: width')
  assertEqual(stubTabList.style.pointerEvents, 'auto', 'C1: pointer-events')
  assertEqual(stubTabList.style.borderLeft, '1px solid var(--lumiverse-primary-020)', 'C1: borderLeft')
  assertEqual(stubTabList.style.borderRight, 'none', 'C1: borderRight')
  assertEqual(stubDrawer.style.flexDirection, 'row-reverse', 'C1: drawer flex row-reverse (spacer under right-edge pin strip)')
  // Secondary on right → chat on left → chat-facing panel border on left.
  assertEqual(stubPanel.style.borderLeft, '1px solid var(--lumiverse-primary-020)', 'C1: panel chat-facing borderLeft')
  assertEqual(stubPanel.style.borderRight, 'none', 'C1: panel borderRight none')
  assert(stubTabList.classList.contains(TAB_LIST_PINNED_CLASS), 'C1: pinned class')
}

// C2: pin on, secondary on left
{
  resetStubs('left')
  applyTabListPin(true)

  assertEqual(stubTabList.style.left, '0', 'C2: left = 0')
  assertEqual(stubTabList.style.right, '', 'C2: right empty')
  assertEqual(stubTabList.style.borderRight, '1px solid var(--lumiverse-primary-020)', 'C2: borderRight')
  assertEqual(stubTabList.style.borderLeft, 'none', 'C2: borderLeft')
  assertEqual(stubDrawer.style.flexDirection, 'row', 'C2: drawer flex row (spacer under left-edge pin strip)')
  // Secondary on left → chat on right → chat-facing panel border on right.
  assertEqual(stubPanel.style.borderRight, '1px solid var(--lumiverse-primary-020)', 'C2: panel chat-facing borderRight')
  assertEqual(stubPanel.style.borderLeft, 'none', 'C2: panel borderLeft none')
  assert(stubTabList.classList.contains(TAB_LIST_PINNED_CLASS), 'C2: pinned class')
}

// C3: unpin restores width 56px
{
  resetStubs('right')
  applyTabListPin(true)
  applyTabListPin(false)

  assertEqual(stubTabList.style.position, '', 'C3: position cleared')
  assertEqual(stubTabList.style.top, '', 'C3: top cleared')
  assertEqual(stubTabList.style.bottom, '', 'C3: bottom cleared')
  assertEqual(stubTabList.style.right, '', 'C3: right cleared')
  assertEqual(stubTabList.style.zIndex, '', 'C3: zIndex cleared')
  assertEqual(stubTabList.style.width, '56px', 'C3: width restored to 56px (not blanked)')
  assertEqual(stubTabList.style.pointerEvents, '', 'C3: pointerEvents cleared')
  assert(!stubTabList.classList.contains(TAB_LIST_PINNED_CLASS), 'C3: class removed')
  assertEqual(stubDrawer.style.flexDirection, 'row', 'C3: flex restored via applyTabListPosition')
}

// C4: idempotency
{
  resetStubs('right')
  applyTabListPin(true)
  const posAfter1 = stubTabList.style.position
  applyTabListPin(true)
  assertEqual(stubTabList.style.position, posAfter1, 'C4: position unchanged')
}

// C5: unpin when already unpinned
{
  resetStubs('right')
  applyTabListPin(false)
  assert(!stubTabList.classList.contains(TAB_LIST_PINNED_CLASS), 'C5: no class')
  assertEqual(stubTabList.style.position, '', 'C5: position empty')
}

// C6: mobile enable is no-op
{
  resetStubs('right')
  ;(globalThis as any).window.matchMedia = () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  })
  applyTabListPin(true)
  assertEqual(stubTabList.style.position, '', 'C6: mobile no position')
  assert(!stubTabList.classList.contains(TAB_LIST_PINNED_CLASS), 'C6: no class')
}

// C7: no secondary wrapper
{
  resetStubs('right')
  __setSecondaryWrapperForTest(null)
  applyTabListPin(true)
  assertEqual(stubTabList.style.position, '', 'C7: no pin without wrapper')
  assert(!stubTabList.classList.contains(TAB_LIST_PINNED_CLASS), 'C7: no class')
  __setSecondaryWrapperForTest(secondaryWrapper as any)
}

// C8: reparent out of transformed drawer + spacer + restore
{
  resetStubs('right')
  assertEqual(stubTabList.parentElement, stubDrawer, 'C8: pre — parent is drawer')

  applyTabListPin(true)

  assert(stubTabList.parentElement !== stubDrawer, 'C8: reparented off drawer')
  assert(
    !!stubTabList.parentElement?.className.includes(TAB_LIST_PIN_HOST_CLASS),
    'C8: parent is pin host',
  )
  assert(
    bodyStub.children.some((c) => c.className.includes(TAB_LIST_PIN_HOST_CLASS)),
    'C8: pin host on body',
  )
  const spacer = stubDrawer.children.find((c) => c.className.includes(TAB_LIST_SPACER_CLASS))
  assert(!!spacer, 'C8: spacer in drawer')
  assertEqual(spacer!.style.width, '56px', 'C8: spacer width 56px')

  let anc: StubElement | null = stubTabList.parentElement
  let underWrapper = false
  while (anc) {
    if (anc === secondaryWrapper) underWrapper = true
    anc = anc.parentElement
  }
  assert(!underWrapper, 'C8: tab list not under transformed wrapper')

  applyTabListPin(false)

  assertEqual(stubTabList.parentElement, stubDrawer, 'C8: restored to drawer')
  assert(
    !stubDrawer.children.some((c) => c.className.includes(TAB_LIST_SPACER_CLASS)),
    'C8: spacer removed',
  )
  assert(
    !bodyStub.children.some((c) => c.className.includes(TAB_LIST_PIN_HOST_CLASS)),
    'C8: pin host removed from body',
  )
  assertEqual(stubTabList.style.width, '56px', 'C8: width restored')
}

// C9: applyTabListPosition while pinned skips secondary writes
{
  resetStubs('right')
  applyTabListPin(true)
  const borderLeft = stubTabList.style.borderLeft
  applyTabListPosition(true)
  assertEqual(stubTabList.style.borderLeft, borderLeft, 'C9: pin borders preserved')
  assert(stubTabList.classList.contains(TAB_LIST_PINNED_CLASS), 'C9: still pinned')
}

// C10: force unpin on mobile after desktop pin
{
  resetStubs('right')
  applyTabListPin(true)
  assert(stubTabList.classList.contains(TAB_LIST_PINNED_CLASS), 'C10: pre pinned')
  ;(globalThis as any).window.matchMedia = () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  })
  applyTabListPin(false, { force: true })
  assert(!stubTabList.classList.contains(TAB_LIST_PINNED_CLASS), 'C10: force unpin clears class')
  assertEqual(stubTabList.style.position, '', 'C10: force unpin clears position')
  assertEqual(stubTabList.parentElement, stubDrawer, 'C10: restored to drawer')
}

// C11: reconcileTabListPin with default setting (false) leaves unpinned
{
  resetStubs('right')
  reconcileTabListPin()
  assert(!stubTabList.classList.contains(TAB_LIST_PINNED_CLASS), 'C11: reconcile with default false')
}

// C12: orphan list under pin host is removed when a new list is pinned
// (simulates incomplete tearDown leaving a stale strip)
{
  resetStubs('right')
  applyTabListPin(true)
  const host = __getPinHostForTest() as unknown as StubElement | null
  assert(!!host, 'C12: pin host exists after pin')

  // Inject an orphan tab list *before* the live one in the host.
  // Set both class tokens on className (stub classList.add overwrites className).
  const orphan = new StubElement()
  orphan.className = `sidebar-ux-tab-list ${TAB_LIST_PINNED_CLASS}`
  orphan.classList = {
    _set: new Set(['sidebar-ux-tab-list', TAB_LIST_PINNED_CLASS]),
    add(c: string) { this._set.add(c); orphan.className = Array.from(this._set).join(' ') },
    remove(c: string) { this._set.delete(c); orphan.className = Array.from(this._set).join(' ') },
    contains(c: string) { return this._set.has(c) },
    toString() { return orphan.className },
  } as any
  // Put orphan first: insertBefore live list
  host!.insertBefore(orphan, stubTabList)

  assertEqual(host!.children.length, 2, 'C12: pre — dual lists under host')
  assertEqual(host!.children[0], orphan, 'C12: pre — orphan is first (document-first-match trap)')

  // Force re-pin the live list — should drop the orphan.
  applyTabListPin(true, { force: true })

  assertEqual(host!.children.length, 1, 'C12: only one tab list under host after force pin')
  assertEqual(host!.children[0], stubTabList, 'C12: live list remains')
  assertEqual(getPinnedTabList(), stubTabList as any, 'C12: getPinnedTabList returns live list')
  assertEqual(getSecondaryTabList(), stubTabList as any, 'C12: getSecondaryTabList returns live list')
}

// C13: force destroy when pin host exists but getter cannot resolve list
{
  resetStubs('right')
  applyTabListPin(true)
  assert(!!__getPinHostForTest(), 'C13: pre — pin host set')

  // Detach list from host without going through unpin — leaves orphan host state.
  const host = __getPinHostForTest() as unknown as StubElement
  if (stubTabList.parentElement === host) host.removeChild(stubTabList)
  // Put list back in drawer so the tree is not fully lost
  stubDrawer.insertBefore(stubTabList, stubPanel)
  stubTabList.classList.remove(TAB_LIST_PINNED_CLASS)

  // Clear module host pointer simulation: destroy via force unpin with null getter path
  // (wrapper still exists; host may still hold no list). Force-disable must clear host.
  applyTabListPin(false, { force: true })
  assertEqual(__getPinHostForTest(), null, 'C13: force unpin clears module pin host')
  assert(
    !bodyStub.children.some((c) => c.className.includes(TAB_LIST_PIN_HOST_CLASS)),
    'C13: pin host removed from body',
  )
}

// C14: getSecondaryTabList prefers module pin list over document first-match
{
  resetStubs('right')
  applyTabListPin(true)
  const host = __getPinHostForTest() as unknown as StubElement
  const orphan = new StubElement()
  orphan.className = 'sidebar-ux-tab-list'
  host.insertBefore(orphan, stubTabList)

  // Without exclusive cleanup, document first-match would be orphan.
  // Getter must still return the module-walk first child after we force-pin
  // which removes orphans — call force pin first then check.
  // Here we only check that after force pin the getter is live:
  applyTabListPin(true, { force: true })
  assertEqual(getSecondaryTabList(), stubTabList as any, 'C14: getter is live list not orphan')
  assertEqual(getPinnedTabList(), stubTabList as any, 'C14: pinned accessor is live list')
}

// C15: __resetPinStateForTest clears module refs without throwing
{
  resetStubs('right')
  applyTabListPin(true)
  __resetPinStateForTest()
  assertEqual(__getPinHostForTest(), null, 'C15: reset clears host ref')
  // Clean body leftovers for subsequent tests
  while (bodyStub.firstChild) bodyStub.removeChild(bodyStub.firstChild!)
  wireDefaultTree()
  __setSecondaryWrapperForTest(secondaryWrapper as any)
}

// C16: pin enable with zero secondary assignments is a no-op
{
  resetStubs('right')
  clearTabAssignments()
  applyTabListPin(true)
  assert(!stubTabList.classList.contains(TAB_LIST_PINNED_CLASS), 'C16: empty secondary not pinned')
  assertEqual(__getPinHostForTest(), null, 'C16: no pin host when empty')
}

// C17: pin with tabs → clear assignments → reconcile unpins
{
  resetStubs('right')
  applyTabListPin(true)
  assert(stubTabList.classList.contains(TAB_LIST_PINNED_CLASS), 'C17: pre — pinned with tabs')
  clearTabAssignments()
  reconcileTabListPin()
  assert(!stubTabList.classList.contains(TAB_LIST_PINNED_CLASS), 'C17: unpinned after empty reconcile')
  assertEqual(__getPinHostForTest(), null, 'C17: pin host destroyed after empty reconcile')
}

// C18: delete last assignment then reconcile (same as last-tab move)
{
  resetStubs('right')
  applyTabListPin(true)
  deleteTabAssignment(STUB_SECONDARY_TAB)
  reconcileTabListPin()
  assert(!stubTabList.classList.contains(TAB_LIST_PINNED_CLASS), 'C18: unpinned after last delete')
}

console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
process.exit(failed > 0 ? 1 : 0)
