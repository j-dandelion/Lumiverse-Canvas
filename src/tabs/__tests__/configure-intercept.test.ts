// Tests for configure-intercept.ts
//
// Tests the context menu click interception logic:
// - Lifecycle (start/stop)
// - Intercept fires on the second menu button (Configure tabs)
// - Intercept fires on the first menu button (Hide/Show tab labels)
// - Intercept does NOT fire after stopConfigureTabsIntercept
// - stopConfigureTabsIntercept does NOT force-close an open modal
//   (modal lifecycle is owned by settings/second-drawer-mode.ts, not the intercept)

// Mock configure-modal before importing the intercept (the intercept uses
// a dynamic import inside its click handler; this spy verifies that stop
// does not call any modal lifecycle function).
import { mock } from 'bun:test'
const closeConfigureTabsModalSpy = mock(() => true)
const openConfigureTabsModalSpy = mock(() => {})
const isConfigureTabsModalOpenSpy = mock(() => true)
const refreshConfigureDraftFromLiveSpy = mock(() => {})
mock.module('../configure-modal', () => ({
  openConfigureTabsModal: openConfigureTabsModalSpy,
  closeConfigureTabsModal: closeConfigureTabsModalSpy,
  isConfigureTabsModalOpen: isConfigureTabsModalOpenSpy,
  refreshConfigureDraftFromLive: refreshConfigureDraftFromLiveSpy,
  getConfigureDraftRef: () => null,
  getConfigureBaseRef: () => null,
  forceUnmountConfigureTabsModal: () => {},
}))

// Label-toggle intercept calls host-settings + drawer-sync (mocked here).
let _mockIsShowTabLabels = true
let _mockPatchPartial: unknown = null
let _mockPatchOk = true
let _mockSyncForceShow: boolean | undefined
let _mockSyncCallCount = 0
const patchHostDrawerSettingsSpy = mock((partial: unknown) => {
  _mockPatchPartial = partial
  return _mockPatchOk
})
const syncSecondaryTabLabelsSpy = mock((forceShow?: boolean) => {
  _mockSyncCallCount++
  _mockSyncForceShow = forceShow
})
mock.module('../../dom/host-settings', () => ({
  patchHostDrawerSettings: patchHostDrawerSettingsSpy,
  getHostDrawerSettings: () => null,
  isHostDrawerSettingsWritable: () => true,
  clearHostSettingsCache: () => {},
  __setHostSetSettingForTest: () => {},
}))
mock.module('../../sidebar/drawer-sync', () => ({
  isShowTabLabels: () => _mockIsShowTabLabels,
  syncSecondaryTabLabels: syncSecondaryTabLabelsSpy,
  syncDrawerTabSettings: () => {},
  checkSideChanged: () => {},
  restoreSecondaryTabButtons: () => {},
  startSideChangeWatcher: () => {},
  stopSideChangeWatcher: () => {},
  stopDrawerTabResizeWatcher: () => {},
  stopDrawerTabClassObserver: () => {},
  stopDrawerTabStyleObserver: () => {},
}))

import {
  startConfigureTabsIntercept,
  stopConfigureTabsIntercept,
  isConfigureTabsInterceptActive,
} from '../configure-intercept'

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed++ }
}

// ── Polyfill DOM globals missing in bun ──

// Fake MouseEvent with trackable stopPropagation
class FakeMouseEvent {
  readonly type: string
  readonly bubbles: boolean
  readonly cancelable: boolean
  readonly composed: boolean
  target: any = null
  _propagationStopped = false
  _immediatePropagationStopped = false
  _defaultPrevented = false

  constructor(type: string, opts?: any) {
    this.type = type
    this.bubbles = opts?.bubbles ?? true
    this.cancelable = opts?.cancelable ?? true
    this.composed = opts?.composed ?? false
    this.target = opts?.target ?? null
  }

  stopPropagation() { this._propagationStopped = true }
  stopImmediatePropagation() { this._immediatePropagationStopped = true; this._propagationStopped = true }
  preventDefault() { this._defaultPrevented = true }
}

// Fake KeyboardEvent with key property
class FakeKeyboardEvent {
  readonly type: string
  readonly key: string
  readonly bubbles: boolean
  readonly cancelable: boolean
  target: any = null

  constructor(type: string, opts?: any) {
    this.type = type
    this.key = opts?.key ?? ''
    this.bubbles = opts?.bubbles ?? true
    this.cancelable = opts?.cancelable ?? true
    this.target = opts?.target ?? null
  }

  stopPropagation() {}
  preventDefault() {}
}

if (typeof MouseEvent === 'undefined') {
  ;(globalThis as any).MouseEvent = FakeMouseEvent
}
if (typeof KeyboardEvent === 'undefined') {
  ;(globalThis as any).KeyboardEvent = FakeKeyboardEvent
}

// Always override getComputedStyle so it works with our fake elements.
// Bun's native getComputedStyle may not handle plain-object style stubs.
;(globalThis as any).getComputedStyle = (el: any) => el?.style ?? {}

// ── Ensure document is available in bun environment ──
// Always set up our own document stub at module level, even when a prior
// test file already set globalThis.document (which may lack body/children).

// Helpers for smarter querySelector/querySelectorAll on stub elements.
function _findChildByTag(el: any, tag: string): any | null {
  const upper = tag.toUpperCase()
  for (const c of el.children || []) {
    if ((c as any).tagName === upper) return c
  }
  return null
}
function _findAllChildrenByTag(el: any, tag: string): any[] {
  const upper = tag.toUpperCase()
  const result: any[] = []
  for (const c of el.children || []) {
    if ((c as any).tagName === upper) result.push(c)
  }
  return result
}

// Track the last body child for findLumiverseContextMenu.
let bodyLastChild: any = null
const docEvents: Record<string, Array<(e: any) => void>> = {}

// Shared resilient style for documentElement (defensive against transitive imports).
const docElStyle: Record<string, any> = {}
docElStyle.removeProperty = () => {}
docElStyle.setProperty = () => {}

// Shared classList for documentElement.
const docElClassList = {
  add() {},
  remove() {},
  contains() { return false },
  toString() { return '' },
}

// Shared element factory that creates elements with working querySelector/querySelectorAll.
function makeElement(tag: string) {
  const children: unknown[] = []
  const attrs: Record<string, string> = {}
  const style: Record<string, string> = {}
  return {
    tag,
    tagName: tag.toUpperCase(),
    className: '',
    children,
    attributes: attrs,
    style,
    textContent: '',
    setAttribute(name: string, value: string) { attrs[name] = value },
    getAttribute(name: string) { return attrs[name] ?? null },
    removeAttribute(name: string) { delete attrs[name] },
    appendChild(c: unknown) { children.push(c) },
    remove() {
      const idx = children.indexOf(this as any)
      if (idx >= 0) children.splice(idx, 1)
    },
    contains(other: unknown) { return children.includes(other) || this === other },
    closest() { return null },
    parentNode: null,
    querySelector(sel: string) {
      if (sel === 'button' || sel === 'button[data-tab-id]') {
        return _findChildByTag(this, 'button')
      }
      const match = sel.match(/\[data-tab-id="([^"]+)"\]/)
      if (match) {
        for (const c of children as any[]) {
          if (c.getAttribute?.('data-tab-id') === match[1]) return c
        }
      }
      // Fallback: check children by tag
      for (const c of children as any[]) {
        if (typeof sel === 'string' && c.tagName === sel.toUpperCase()) return c
      }
      return null
    },
    querySelectorAll(sel: string) {
      if (sel === 'button') {
        return _findAllChildrenByTag(this, 'button')
      }
      return []
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent(e: any) {
      return true
    },
  }
}

// Always replace globalThis.document with our test stub so this file is
// self-contained regardless of which test file ran before it.
{
  const doc = {
    createElement: makeElement,
    body: {
      children: [] as unknown[],
      appendChild(c: unknown) {
        (this as any).children.push(c)
        bodyLastChild = c
      },
      removeChild(c: unknown) {
        const idx = (this as any).children.indexOf(c)
        if (idx >= 0) (this as any).children.splice(idx, 1)
        bodyLastChild = (this as any).children[(this as any).children.length - 1] ?? null
      },
      querySelectorAll(_sel: string) { return [] as unknown[] },
      lastElementChild: null as any,
      get lastElementChild() { return bodyLastChild },
      set lastElementChild(v: any) { bodyLastChild = v },
    } as any,
    querySelector() { return null },
    querySelectorAll() { return [] as unknown[] },
    documentElement: {
      style: docElStyle,
      classList: docElClassList,
    },
    head: { appendChild() {}, removeChild() {} },
    addEventListener(type: string, handler: any) {
      if (!docEvents[type]) docEvents[type] = []
      docEvents[type].push(handler)
    },
    removeEventListener(type: string, handler: any) {
      if (docEvents[type]) {
        const idx = docEvents[type].indexOf(handler)
        if (idx >= 0) docEvents[type].splice(idx, 1)
      }
    },
    dispatchEvent(e: any) {
      const handlers = docEvents[e.type] || []
      for (const h of handlers) h(e)
      return true
    },
    createEvent() { return { initEvent() {} } },
  } as any
  ;(globalThis as any).document = doc
}

// ── Test helpers ──

/**
 * Create a fake Lumiverse context menu structure that findLumiverseContextMenu
 * will detect:
 *   - Last child of body is DIV
 *   - style.position: fixed
 *   - style.zIndex: 11000
 *   - Contains at least one button
 */
function createFakeContextMenu(buttonCount: number): HTMLElement {
  const menu = document.createElement('div')
  menu.style.position = 'fixed'
  menu.style.zIndex = '11000'
  for (let i = 0; i < buttonCount; i++) {
    const btn = document.createElement('button')
    btn.textContent = i === 0 ? 'Toggle labels' : 'Configure tabs'
    menu.appendChild(btn)
  }
  document.body.appendChild(menu)
  ;(document.body as any).lastElementChild = menu
  return menu
}

function cleanup(): void {
  stopConfigureTabsIntercept()
  // Guard: when run in sequence after other test files, document.body may
  // have been replaced by a different stub — only clean our own artifacts.
  if (typeof document !== 'undefined' && document.body) {
    // Remove any fake menus left in DOM.
    const children = (document.body as any).children
    if (children) {
      const toRemove: unknown[] = []
      for (const child of children as any) {
        if (child.style?.position === 'fixed' && child.style?.zIndex === '11000') {
          toRemove.push(child)
        }
      }
      for (const m of toRemove) {
        document.body.removeChild(m)
      }
    }
    // Reset lastElementChild tracking.
    if ((document.body as any).lastElementChild !== undefined) {
      ;(document.body as any).lastElementChild = null
    }
  }
}

// =====================================================================
// I1: isConfigureTabsInterceptActive lifecycle
// =====================================================================
{
  cleanup()
  assert(!isConfigureTabsInterceptActive(), 'I1: not active initially')

  startConfigureTabsIntercept()
  assert(isConfigureTabsInterceptActive(), 'I1: active after start')

  // Starting again should be idempotent.
  startConfigureTabsIntercept()
  assert(isConfigureTabsInterceptActive(), 'I1: still active after duplicate start')

  stopConfigureTabsIntercept()
  assert(!isConfigureTabsInterceptActive(), 'I1: inactive after stop')

  // Stopping again should be idempotent.
  stopConfigureTabsIntercept()
  assert(!isConfigureTabsInterceptActive(), 'I1: still inactive after duplicate stop')
}

// =====================================================================
// I2: Intercept fires on second context menu button
// =====================================================================
{
  cleanup()
  let escapeDispatched = false
  let defaultPrevented = false

  // Listen for the Escape keydown that dismissHostContextMenu dispatches.
  const escapeHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') escapeDispatched = true
  }
  document.addEventListener('keydown', escapeHandler)

  startConfigureTabsIntercept()

  // Create fake menu with 2 buttons.
  const menu = createFakeContextMenu(2)
  const configureBtn = menu.querySelectorAll('button')[1]

  // Dispatch a click event on document with target set to the configure button.
  const clickEvent = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    composed: true,
  })
  Object.defineProperty(clickEvent, 'target', { value: configureBtn })
  document.dispatchEvent(clickEvent)

  // Allow microtasks to settle (for the lazy import).
  await new Promise<void>(r => setTimeout(r, 0))

  assert(clickEvent._propagationStopped, 'I2: stopPropagation was called')
  assert(clickEvent._defaultPrevented, 'I2: preventDefault was called')
  assert(escapeDispatched, 'I2: Escape event dispatched (dismissHostContextMenu)')

  // Cleanup.
  document.removeEventListener('keydown', escapeHandler)
  menu.remove()
  stopConfigureTabsIntercept()
}

// =====================================================================
// I3: Intercept fires on first context menu button (Hide/Show tab labels)
// =====================================================================
{
  cleanup()
  let escapeDispatched = false
  _mockIsShowTabLabels = true
  _mockPatchOk = true
  _mockPatchPartial = null
  _mockSyncCallCount = 0
  _mockSyncForceShow = undefined
  patchHostDrawerSettingsSpy.mockClear()
  syncSecondaryTabLabelsSpy.mockClear()
  openConfigureTabsModalSpy.mockClear()

  const escapeHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') escapeDispatched = true
  }
  document.addEventListener('keydown', escapeHandler)

  startConfigureTabsIntercept()

  const menu = createFakeContextMenu(2)
  // Click the FIRST button (Hide/Show tab labels).
  const firstBtn = menu.querySelectorAll('button')[0]

  const clickEvent = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    composed: true,
  })
  Object.defineProperty(clickEvent, 'target', { value: firstBtn })
  document.dispatchEvent(clickEvent)

  await new Promise<void>(r => setTimeout(r, 0))

  assert(clickEvent._propagationStopped, 'I3: stopPropagation called for labels button')
  assert(escapeDispatched, 'I3: Escape dispatched to dismiss host menu')
  assertEqual(patchHostDrawerSettingsSpy.mock.calls.length, 1, 'I3: patchHostDrawerSettings called once')
  assertEqual(
    (_mockPatchPartial as { showTabLabels?: boolean } | null)?.showTabLabels,
    false,
    'I3: patch writes showTabLabels: false (was showing)',
  )
  assert(_mockSyncCallCount >= 1, 'I3: syncSecondaryTabLabels called so second drawer follows')
  assertEqual(_mockSyncForceShow, false, 'I3: sync force-stamps next=false')
  assertEqual(openConfigureTabsModalSpy.mock.calls.length, 0, 'I3: Configure modal not opened')

  document.removeEventListener('keydown', escapeHandler)
  menu.remove()
  stopConfigureTabsIntercept()
}

// =====================================================================
// I4: Intercept does NOT fire after stopConfigureTabsIntercept
// =====================================================================
{
  cleanup()
  let escapeDispatched = false

  const escapeHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') escapeDispatched = true
  }
  document.addEventListener('keydown', escapeHandler)

  startConfigureTabsIntercept()
  stopConfigureTabsIntercept()

  const menu = createFakeContextMenu(2)
  const configureBtn = menu.querySelectorAll('button')[1]

  const clickEvent = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    composed: true,
  })
  Object.defineProperty(clickEvent, 'target', { value: configureBtn })
  document.dispatchEvent(clickEvent)

  await new Promise<void>(r => setTimeout(r, 0))

  // After stop, the intercept should not fire.
  assert(!escapeDispatched, 'I4: Escape NOT dispatched after stop')

  document.removeEventListener('keydown', escapeHandler)
  menu.remove()
}

// =====================================================================
// I5: Single-button host menu still intercepts labels (button[0])
// =====================================================================
{
  cleanup()
  let escapeDispatched = false
  _mockIsShowTabLabels = false // currently hidden → next = true (Show)
  _mockPatchOk = true
  _mockPatchPartial = null
  _mockSyncCallCount = 0
  _mockSyncForceShow = undefined
  patchHostDrawerSettingsSpy.mockClear()
  syncSecondaryTabLabelsSpy.mockClear()

  const escapeHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') escapeDispatched = true
  }
  document.addEventListener('keydown', escapeHandler)

  startConfigureTabsIntercept()

  // Menu with only 1 button (labels only — still Canvas's concern).
  const menu = createFakeContextMenu(1)
  const onlyBtn = menu.querySelectorAll('button')[0]

  const clickEvent = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    composed: true,
  })
  Object.defineProperty(clickEvent, 'target', { value: onlyBtn })
  document.dispatchEvent(clickEvent)

  await new Promise<void>(r => setTimeout(r, 0))

  assert(escapeDispatched, 'I5: Escape dispatched for single-button labels menu')
  assertEqual(
    (_mockPatchPartial as { showTabLabels?: boolean } | null)?.showTabLabels,
    true,
    'I5: patch writes showTabLabels: true (was hidden)',
  )
  assertEqual(_mockSyncForceShow, true, 'I5: sync force-stamps next=true')

  document.removeEventListener('keydown', escapeHandler)
  menu.remove()
  stopConfigureTabsIntercept()
}

// =====================================================================
// I6: stopConfigureTabsIntercept does NOT force-close an open modal
//
// Design property: stopping the intercept only detaches the click listener.
// The modal lifecycle is owned by settings/second-drawer-mode.ts (which
// refreshes any still-open modal from live on mode switches, but does not
// close it). Asserting that closeConfigureTabsModal is NOT called on stop
// guards against accidental regressions where stop starts closing the modal.
// =====================================================================
{
  cleanup()
  // Reset the spy counters from any prior tests in this run.
  closeConfigureTabsModalSpy.mockClear()
  openConfigureTabsModalSpy.mockClear()
  refreshConfigureDraftFromLiveSpy.mockClear()

  // The "modal" is "open" while intercept is active (mock state).
  isConfigureTabsModalOpenSpy.mockReturnValue(true)

  startConfigureTabsIntercept()
  assert(isConfigureTabsInterceptActive(), 'I6: intercept active after start')

  // Simulate a click before stop — the open spy should fire (positive control).
  {
    const menu = createFakeContextMenu(2)
    const configureBtn = menu.querySelectorAll('button')[1]
    const clickEvent = new MouseEvent('click', {
      bubbles: true, cancelable: true, composed: true,
    })
    Object.defineProperty(clickEvent, 'target', { value: configureBtn })
    document.dispatchEvent(clickEvent)
    await new Promise<void>(r => setTimeout(r, 0))
    menu.remove()
  }
  assert(openConfigureTabsModalSpy.mock.calls.length >= 1,
    'I6: openConfigureTabsModal was called on click before stop (positive control)')
  assertEqual(closeConfigureTabsModalSpy.mock.calls.length, 0,
    'I6: closeConfigureTabsModal NOT called on click before stop')

  // Now stop. The modal is "still open" per our mock.
  stopConfigureTabsIntercept()
  assert(!isConfigureTabsInterceptActive(), 'I6: intercept inactive after stop')

  // The core property: stop does not force-close the modal.
  assertEqual(closeConfigureTabsModalSpy.mock.calls.length, 0,
    'I6: closeConfigureTabsModal NOT called on stop (modal stays open)')

  // Stop should also not refresh or re-open the modal.
  assertEqual(refreshConfigureDraftFromLiveSpy.mock.calls.length, 0,
    'I6: refreshConfigureDraftFromLive NOT called on stop')
  assertEqual(openConfigureTabsModalSpy.mock.calls.length, 1,
    'I6: openConfigureTabsModal call count unchanged by stop (1 from positive control)')

  // Click after stop: nothing should happen (no open, no close).
  {
    const menu = createFakeContextMenu(2)
    const configureBtn = menu.querySelectorAll('button')[1]
    const clickEvent = new MouseEvent('click', {
      bubbles: true, cancelable: true, composed: true,
    })
    Object.defineProperty(clickEvent, 'target', { value: configureBtn })
    document.dispatchEvent(clickEvent)
    await new Promise<void>(r => setTimeout(r, 0))
    menu.remove()
  }
  assertEqual(openConfigureTabsModalSpy.mock.calls.length, 1,
    'I6: openConfigureTabsModal NOT called on click after stop')
  assertEqual(closeConfigureTabsModalSpy.mock.calls.length, 0,
    'I6: closeConfigureTabsModal NOT called on click after stop')

  cleanup()
}

// =====================================================================
// Summary
// =====================================================================
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}/${passed + failed}`)
