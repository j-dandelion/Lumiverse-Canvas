// Tests for syncPanelHeaderFromMain: the cross-drawer panel-header
// synchronization that keeps the secondary drawer's header height,
// padding, title font-size, border, and background in step with the
// main drawer's header. Mirrors the testing pattern in
// syncDrawerTabSettings.test.ts (StubElement + StubStyle + rAF queue +
// captured MutationObserver/ResizeObserver stubs).

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { failed++; console.error(`FAIL: ${msg} — expected ${String(expected)}, got ${String(actual)}`) }
}

// --- rAF queue (coalescing tests) ---
const _rafQueue: Array<() => void> = []
;(globalThis as any).requestAnimationFrame = (fn: () => void) => { _rafQueue.push(fn); return 0 }
function _flushRaf() {
  const fns = [..._rafQueue]
  _rafQueue.length = 0
  for (const fn of fns) fn()
}

// --- Captured ResizeObserver stub ---
interface CapturedResizeObserver {
  cb: () => void
  target: any
}
const _capturedResizeObservers: CapturedResizeObserver[] = []
;(globalThis as any).ResizeObserver = class {
  private _cb: () => void
  constructor(cb: () => void) { this._cb = cb }
  observe(target: any) { _capturedResizeObservers.push({ cb: this._cb, target }) }
  unobserve() {}
  disconnect() {}
}

// --- Captured MutationObserver stub ---
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

// --- StubStyle: captures setProperty calls + holds the values the
// production code reads via getComputedStyle ---
class StubStyle {
  _setPropertyLog: Array<{ name: string; value: string }> = []
  private _props: Record<string, string> = {}
  setProperty(name: string, value: string) {
    this._setPropertyLog.push({ name, value })
    this._props[name] = value
  }
  getPropertyValue(name: string): string {
    return this._props[name] ?? ''
  }
  // Defaults that getComputedStyle consumers (syncPanelHeaderFromMain) read
  get paddingTop() { return this._props['paddingTop'] ?? '12px' }
  get paddingBottom() { return this._props['paddingBottom'] ?? '12px' }
  get borderBottomWidth() { return this._props['borderBottomWidth'] ?? '1px' }
  get borderBottomStyle() { return this._props['borderBottomStyle'] ?? 'solid' }
  get borderBottomColor() { return this._props['borderBottomColor'] ?? 'rgb(0, 0, 0)' }
  get backgroundColor() { return this._props['backgroundColor'] ?? 'rgba(0, 0, 0, 0)' }
  get fontSize() { return this._props['fontSize'] ?? '15px' }
}

// --- StubElement: minimal DOM stand-in ---
class StubElement {
  style = new StubStyle()
  offsetHeight = 56
  children: StubElement[] = []
  className = ''
  constructor(className = '') { this.className = className }
  querySelector(sel: string): StubElement | null {
    // Mimic querySelector('[class*="title"], [class*="Title"]') for title lookup
    if (sel.includes('title') || sel.includes('Title')) {
      for (const c of this.children) {
        if (c.className && /title|Title/.test(String(c.className))) return c
      }
      return null
    }
    if (sel === 'H1' || sel === 'H2' || sel === 'H3') {
      for (const c of this.children) {
        if (c.className?.toUpperCase() === sel) return c
      }
      return null
    }
    return null
  }
  get firstElementChild(): StubElement | null { return this.children[0] ?? null }
}

// --- getComputedStyle stub: returns values from the element's StubStyle ---
;(globalThis as any).getComputedStyle = (el: StubElement) => el.style

// --- document.querySelector stub for getMainPanel / getMainPanelHeader ---
// We control what's "in the DOM" by replacing the mainSidebar stub's
// parent chain with a panel stub that has a panelHeader child.

// Main sidebar (data-spindle-mount="sidebar") — required by getMainSidebar()
// and getMainPanel() to navigate to the main panel.
const mainSidebar = new StubElement('_sidebar_abc')
mainSidebar.className = '_sidebar_abc'

// Main panel — direct parent of the panel content + panel header.
const mainPanel = new StubElement('_panel_xyz')
mainPanel.className = '_panel_xyz'

// Main panel content (sibling of the header).
const mainPanelContent = new StubElement('_panelContent_pqr')
mainPanelContent.className = '_panelContent_pqr'

// Main panel header — the element we want to mirror.
const mainHeader = new StubElement('_panelHeader_abc')
mainHeader.className = '_panelHeader_abc'
mainHeader.offsetHeight = 56
mainHeader.style.setProperty('paddingTop', '12px')
mainHeader.style.setProperty('paddingBottom', '12px')
mainHeader.style.setProperty('borderBottomWidth', '1px')
mainHeader.style.setProperty('borderBottomStyle', 'solid')
mainHeader.style.setProperty('borderBottomColor', 'rgb(50, 50, 50)')
mainHeader.style.setProperty('backgroundColor', 'rgb(20, 20, 20)')

// Title inside the header.
const mainHeaderTitle = new StubElement('_title_zzz')
mainHeaderTitle.className = '_title_zzz'
mainHeaderTitle.style.setProperty('fontSize', '16px')
mainHeader.children.push(mainHeaderTitle)

// Wire panel's children: [header, content] — header first, content second.
mainPanel.children.push(mainHeader, mainPanelContent)

// Wire mainSidebar.parentElement so getMainPanel's querySelector('[class*="_panel_"]')
// hits our panel stub. We model this as: mainSidebar.parentElement is a
// parent whose querySelector returns mainPanel.
const mainSidebarParent: any = {
  querySelector(sel: string): StubElement | null {
    if (sel.includes('_panel_')) return mainPanel
    return null
  },
  get children(): StubElement[] { return [mainPanel] },
}
Object.defineProperty(mainSidebar, 'parentElement', {
  get: () => mainSidebarParent,
  configurable: true,
})

;(globalThis as any).document = {
  querySelector(sel: string): any {
    if (sel === '[data-spindle-mount="sidebar"]') return mainSidebar
    if (sel.includes('_drawerTab_')) return null
    return null
  },
}

// --- Secondary wrapper stub: what the production code writes CSS vars on ---
const secondaryWrapper = new StubElement('sidebar-ux-secondary-wrapper')

// --- Import after stubs are in place ---
import {
  __setSecondaryWrapperForTest,
  syncPanelHeaderFromMain,
  stopPanelHeaderObservers,
} from '../secondary'

// --- Reset state between test blocks ---
function _resetState() {
  _rafQueue.length = 0
  _capturedResizeObservers.length = 0
  _capturedMutationObservers.length = 0
  secondaryWrapper.style = new StubStyle()
  // Re-attach to the secondary wrapper (stub reset replaces the style object)
  __setSecondaryWrapperForTest(secondaryWrapper as any)
  stopPanelHeaderObservers()
}

// =====================================================================
// T1: initial sync writes all 6 CSS vars to the secondary wrapper
// =====================================================================
{
  _resetState()
  syncPanelHeaderFromMain()
  _flushRaf()

  // Verify the secondary wrapper has all 6 vars set
  assertEqual(
    secondaryWrapper.style.getPropertyValue('--sidebar-ux-panel-header-h'),
    '56px',
    'T1: --sidebar-ux-panel-header-h = "56px" (mirrors main offsetHeight)',
  )
  assertEqual(
    secondaryWrapper.style.getPropertyValue('--sidebar-ux-panel-header-pt'),
    '12px',
    'T1: --sidebar-ux-panel-header-pt = "12px" (mirrors main paddingTop)',
  )
  assertEqual(
    secondaryWrapper.style.getPropertyValue('--sidebar-ux-panel-header-pb'),
    '12px',
    'T1: --sidebar-ux-panel-header-pb = "12px" (mirrors main paddingBottom)',
  )
  assertEqual(
    secondaryWrapper.style.getPropertyValue('--sidebar-ux-panel-header-font-size'),
    '16px',
    'T1: --sidebar-ux-panel-header-font-size = "16px" (mirrors main title fontSize)',
  )
  assertEqual(
    secondaryWrapper.style.getPropertyValue('--sidebar-ux-panel-header-border-bottom'),
    '1px solid rgb(50, 50, 50)',
    'T1: --sidebar-ux-panel-header-border-bottom = "1px solid rgb(50, 50, 50)" (mirrors main border-bottom)',
  )
  assertEqual(
    secondaryWrapper.style.getPropertyValue('--sidebar-ux-panel-header-bg'),
    'rgb(20, 20, 20)',
    'T1: --sidebar-ux-panel-header-bg = "rgb(20, 20, 20)" (mirrors main background-color)',
  )
}

// =====================================================================
// T2: observers are attached after first successful sync
// =====================================================================
{
  _resetState()
  syncPanelHeaderFromMain()
  _flushRaf()

  assertEqual(
    _capturedResizeObservers.length,
    1,
    'T2: ResizeObserver attached to main header after first sync',
  )
  if (_capturedResizeObservers.length === 1) {
    assertEqual(
      _capturedResizeObservers[0].target,
      mainHeader,
      'T2: ResizeObserver.observe() called with the main header element',
    )
  }

  const classOrStyleObs = _capturedMutationObservers.filter(
    (o) => o.options?.attributeFilter?.includes('class') || o.options?.attributeFilter?.includes('style'),
  )
  assertEqual(
    classOrStyleObs.length,
    1,
    'T2: one MutationObserver (class|style) attached to main header',
  )
  if (classOrStyleObs.length === 1) {
    const filter = classOrStyleObs[0].options?.attributeFilter
    assert(
      filter && filter.includes('class') && filter.includes('style'),
      'T2: MutationObserver attributeFilter = ["class", "style"]',
    )
  }
}

// =====================================================================
// T3: ResizeObserver fire → re-sync runs and updates the wrapper
// =====================================================================
{
  _resetState()
  syncPanelHeaderFromMain()
  _flushRaf()
  const writesBefore = secondaryWrapper.style._setPropertyLog.length

  // Simulate a main-header resize: the height grows from 56 to 72.
  mainHeader.offsetHeight = 72
  // Fire the captured ResizeObserver callback (the real one is async).
  if (_capturedResizeObservers.length > 0) {
    _capturedResizeObservers[0].cb()
  }
  _flushRaf()

  assertEqual(
    secondaryWrapper.style.getPropertyValue('--sidebar-ux-panel-header-h'),
    '72px',
    'T3: --sidebar-ux-panel-header-h updated to "72px" after ResizeObserver fire',
  )
  assert(
    secondaryWrapper.style._setPropertyLog.length > writesBefore,
    'T3: a write occurred after the observer fired',
  )
}

// =====================================================================
// T4: MutationObserver (style) fire → re-sync runs
// =====================================================================
{
  _resetState()
  syncPanelHeaderFromMain()
  _flushRaf()

  // Mutate a tracked style property and fire the class|style observer.
  mainHeader.style.setProperty('paddingTop', '20px')
  const styleObs = _capturedMutationObservers.find(
    (o) => o.options?.attributeFilter?.includes('style'),
  )
  assert(styleObs !== undefined, 'T4: a style observer was attached')
  if (styleObs) {
    styleObs.cb()
    _flushRaf()
  }
  assertEqual(
    secondaryWrapper.style.getPropertyValue('--sidebar-ux-panel-header-pt'),
    '20px',
    'T4: --sidebar-ux-panel-header-pt updated after MutationObserver fire',
  )
}

// =====================================================================
// T5: cache skips redundant writes when the value hasn't changed
// =====================================================================
{
  _resetState()
  syncPanelHeaderFromMain()
  _flushRaf()
  const writesAfterFirst = secondaryWrapper.style._setPropertyLog.length

  // Call again with no changes — the cache should short-circuit.
  syncPanelHeaderFromMain()
  _flushRaf()
  const writesAfterSecond = secondaryWrapper.style._setPropertyLog.length

  assertEqual(
    writesAfterSecond,
    writesAfterFirst,
    'T5: second sync with identical values writes nothing (cache hit)',
  )

  // Now change a value and call again — should write.
  mainHeader.style.setProperty('paddingBottom', '24px')
  syncPanelHeaderFromMain()
  _flushRaf()
  const writesAfterThird = secondaryWrapper.style._setPropertyLog.length
  assert(
    writesAfterThird > writesAfterSecond,
    'T5: third sync with a changed value writes (cache miss)',
  )
}

// =====================================================================
// T6: rAF coalesces rapid back-to-back sync calls
// =====================================================================
{
  _resetState()
  syncPanelHeaderFromMain()
  syncPanelHeaderFromMain()
  syncPanelHeaderFromMain()
  // Only ONE entry should be queued
  assertEqual(_rafQueue.length, 1, 'T6: three rapid sync calls coalesce to 1 rAF entry')
  _flushRaf()
  assertEqual(_rafQueue.length, 0, 'T6: rAF queue drained after flush')
}

// =====================================================================
// T7: stopPanelHeaderObservers disconnects both observers
// =====================================================================
{
  _resetState()
  syncPanelHeaderFromMain()
  _flushRaf()
  // Two observers were attached (one ResizeObserver, one MutationObserver)
  assert(_capturedResizeObservers.length >= 1, 'T7: precondition — ResizeObserver attached')
  assert(_capturedMutationObservers.length >= 1, 'T7: precondition — MutationObserver attached')

  stopPanelHeaderObservers()

  // Both handles should be null — re-sync should reattach.
  _capturedResizeObservers.length = 0
  _capturedMutationObservers.length = 0
  syncPanelHeaderFromMain()
  _flushRaf()
  assertEqual(
    _capturedResizeObservers.length,
    1,
    'T7: ResizeObserver reattached after stop+sync cycle',
  )
  assertEqual(
    _capturedMutationObservers.length,
    1,
    'T7: MutationObserver reattached after stop+sync cycle',
  )
}

// =====================================================================
// T8: missing main header is a no-op (no writes, no observers)
// =====================================================================
{
  _resetState()
  // Hide the main header by emptying the panel's children. getMainPanelHeader
  // will fall back to the structural selector, which also won't find it.
  const savedChildren = mainPanel.children
  mainPanel.children = []

  syncPanelHeaderFromMain()
  _flushRaf()

  assertEqual(
    secondaryWrapper.style._setPropertyLog.length,
    0,
    'T8: no CSS-var writes when main header is missing',
  )
  assertEqual(
    _capturedResizeObservers.length,
    0,
    'T8: no ResizeObserver attached when main header is missing',
  )
  assertEqual(
    _capturedMutationObservers.length,
    0,
    'T8: no MutationObserver attached when main header is missing',
  )

  // Restore for any subsequent tests
  mainPanel.children = savedChildren
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
