// Tests for repositionTab primary case bug fix (2026-06-19):
// repositionTab moved the tab root back to the main panel content
// and cleared data-canvas-moved/data-canvas-active/position/inset,
// but did NOT clear inline `display`. If a tab's root had inline
// `display: none !important` set while in secondary (e.g., by a
// future showSecondaryTab change or by the user via dev tools), it
// would remain hidden after moving back to primary — the "tabs return
// to main but content doesn't display" symptom.
//
// Run with: bun run src/tabs/__tests__/reposition-tab-clears-display.test.ts

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    console.error(`FAIL: ${message} — expected ${expected}, got ${actual}`)
    failed++
  } else {
    passed++
  }
}

// =====================================================================
// Global DOM stubs
// =====================================================================

;(globalThis as any).window = {
  matchMedia(_q: string) { return { matches: false, addEventListener() {}, removeEventListener() {} } },
}
;(globalThis as any).getComputedStyle = () => ({ display: '', visibility: '' })
;(globalThis as any).document = {
  querySelector(sel: string) {
    if (sel === '[data-spindle-mount="sidebar"]') return _fakeMainSidebar
    if (sel === '[class*="_panelContent_"]') return _fakePanelContent
    return null
  },
  querySelectorAll(_sel: string) { return [] },
  body: { appendChild() {} },
  createElement(tag: string) {
    return {
      tagName: tag.toUpperCase(),
      _attrs: {} as Record<string, string>,
      style: {} as any,
      className: '',
      innerHTML: '',
      children: [] as any[],
      setAttribute(name: string, value: string) { this._attrs[name] = value },
      getAttribute(name: string) { return this._attrs[name] ?? null },
      appendChild() {},
    }
  },
}
;(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => { setTimeout(() => cb(performance.now()), 0); return 0 }
;(globalThis as any).MutationObserver = class { observe() {} disconnect() {} }
;(globalThis as any).ResizeObserver = class { observe() {} disconnect() {} }
;(globalThis as any).HTMLElement = class {}
;(globalThis as any).CSS = { escape(s: string) { return s.replace(/([^\w-])/g, '\\$1') } }

// =====================================================================
// Imports
// =====================================================================

import { __setDrawerTabsForTest, __setStoreSnapshotForTest } from '../../store'
import { setTabAssignment, clearTabAssignments } from '../assignment'

// =====================================================================
// Test helpers
// =====================================================================

let _fakePanelContent: any = null
let _fakeMainSidebar: any = null
let _origWindow: typeof globalThis.window

function setupEnv(opts: {
  tabId: string
  tabTitle?: string
  initialDisplay?: string
  initialPosition?: string
  initialInset?: string
  hasMovedAttr?: boolean
  hasActiveAttr?: boolean
}) {
  _origWindow = globalThis.window
  const tabId = opts.tabId
  const tabTitle = opts.tabTitle ?? 'Test Tab'

  // Fake main panel (parent of panel content) and main panel content
  // (the target of repositionTab primary). The main sidebar must
  // resolve via getMainSidebar() → getMainPanel() → panelContent query.
  const _mainPanelContentChildren: any[] = []
  _fakePanelContent = {
    tagName: 'DIV',
    className: '_panelContent_abc',
    children: _mainPanelContentChildren,
    appendChild(child: any) {
      if (child.parentElement && child.parentElement !== _fakePanelContent) {
        const oldChildren = child.parentElement.children
        const idx = oldChildren ? Array.from(oldChildren).indexOf(child) : -1
        if (idx >= 0 && oldChildren) oldChildren.splice(idx, 1)
      }
      child.parentElement = _fakePanelContent
      _mainPanelContentChildren.push(child)
    },
    querySelector(_sel: string) { return null },
    querySelectorAll(_sel: string) { return [] },
  }
  const _fakeMainPanel = {
    tagName: 'DIV',
    className: '_panel_abc',
    children: [_fakePanelContent],
    querySelector(sel: string) {
      if (sel === '[class*="_panelContent_"]') return _fakePanelContent
      return null
    },
  }
  // The tab's root — start in the secondary content area with optional
  // inline styles mimicking a tab that was in secondary.
  const fakeRoot: any = {
    tagName: 'DIV',
    _attrs: {} as Record<string, string>,
    parentElement: null, // will be set when appended
    _styleProps: new Map<string, string>(),
    setAttribute(name: string, value: string) { fakeRoot._attrs[name] = value },
    getAttribute(name: string) { return fakeRoot._attrs[name] ?? null },
    removeAttribute(name: string) { delete fakeRoot._attrs[name] },
    setProperty(name: string, value: string) { fakeRoot._styleProps.set(name, value) },
    removeProperty(name: string) { fakeRoot._styleProps.delete(name) },
    get style(): any {
      return {
        setProperty: (n: string, v: string) => fakeRoot._styleProps.set(n, v),
        removeProperty: (n: string) => fakeRoot._styleProps.delete(n),
        get display() { return fakeRoot._styleProps.get('display') || '' },
        get position() { return fakeRoot._styleProps.get('position') || '' },
        get inset() { return fakeRoot._styleProps.get('inset') || '' },
      }
    },
  }
  // Set initial state
  if (opts.initialDisplay !== undefined) fakeRoot._styleProps.set('display', opts.initialDisplay)
  if (opts.initialPosition !== undefined) fakeRoot._styleProps.set('position', opts.initialPosition)
  if (opts.initialInset !== undefined) fakeRoot._styleProps.set('inset', opts.initialInset)
  if (opts.hasMovedAttr) fakeRoot._attrs['data-canvas-moved'] = tabId
  if (opts.hasActiveAttr) fakeRoot._attrs['data-canvas-active'] = ''

  // Fake secondary content area (current parent of root)
  const _secondaryChildren: any[] = [fakeRoot]
  fakeRoot.parentElement = { tagName: 'DIV', className: 'sidebar-ux-panel-content', children: _secondaryChildren }
  const _fakeSecondaryContent = fakeRoot.parentElement

  // Fake main sidebar — getMainSidebar uses [data-spindle-mount="sidebar"]
  // getMainPanel uses sidebar.parentElement.querySelector('[class*="_panel_"]')
  _fakeMainSidebar = {
    tagName: 'DIV',
    parentElement: {
      querySelector(sel: string) {
        if (sel === '[class*="_panel_"]') return _fakeMainPanel
        return null
      },
    },
    querySelector(_sel: string) { return null },
    querySelectorAll(_sel: string) { return [] },
  }

  // Pre-populate store so findStoreData(true) → getDrawerTabs finds our tab
  __setDrawerTabsForTest([{
    id: tabId,
    extensionId: 'test-ext-uuid',
    title: tabTitle,
    root: fakeRoot,
  }])
  __setStoreSnapshotForTest({ drawerOpen: true })

  return { fakeRoot, _fakeSecondaryContent, _fakePanelContent }
}

function restoreEnv() {
  globalThis.window = _origWindow
  _fakePanelContent = null
  _fakeMainSidebar = null
  clearTabAssignments()
  __setDrawerTabsForTest(null)
  __setStoreSnapshotForTest(null)
}

// =====================================================================
// T1: Inline `display: none !important` is cleared on primary move
// =====================================================================
async function testT1_DisplayCleared() {
  const env = setupEnv({
    tabId: 'ext-tab-1',
    initialDisplay: 'none',
    hasMovedAttr: true,
  })
  try {
    const { repositionTab } = await import('../assignment')
    const result = repositionTab('ext-tab-1', 'primary')
    assert(result === true, 'T1: repositionTab returns true for valid tab')

    // display should be removed
    assert(!env.fakeRoot._styleProps.has('display'), 'T1: inline display is cleared after primary move')
    // position/inset should also be cleared (pre-existing behavior)
    assert(!env.fakeRoot._styleProps.has('position'), 'T1: inline position is cleared (pre-existing)')
    assert(!env.fakeRoot._styleProps.has('inset'), 'T1: inline inset is cleared (pre-existing)')
    // data-canvas-moved should be removed
    assert(env.fakeRoot._attrs['data-canvas-moved'] === undefined, 'T1: data-canvas-moved attribute removed')
    // Root should now be in main panel content
    assert(env.fakeRoot.parentElement === env._fakePanelContent, 'T1: root is now in main panel content')
  } finally { restoreEnv() }
}

// =====================================================================
// T2: Tab without inline display works normally
// =====================================================================
async function testT2_NoDisplayToClear() {
  const env = setupEnv({
    tabId: 'ext-tab-2',
    initialDisplay: '',
    initialPosition: 'absolute',
    initialInset: '0',
  })
  try {
    const { repositionTab } = await import('../assignment')
    const result = repositionTab('ext-tab-2', 'primary')
    assert(result === true, 'T2: repositionTab returns true')

    // No display to clear — no error
    assert(!env.fakeRoot._styleProps.has('display'), 'T2: no display to clear')
    // position/inset cleared
    assert(!env.fakeRoot._styleProps.has('position'), 'T2: position cleared')
    assert(!env.fakeRoot._styleProps.has('inset'), 'T2: inset cleared')
  } finally { restoreEnv() }
}

// =====================================================================
// T3: Tab in main panel already (idempotent) — no errors
// =====================================================================
async function testT3_AlreadyInMain() {
  const env = setupEnv({
    tabId: 'ext-tab-3',
  })
  try {
    // Manually move root to main panel content first
    env._fakePanelContent.appendChild(env.fakeRoot)
    env.fakeRoot._attrs['data-canvas-moved'] = 'ext-tab-3'
    env.fakeRoot._styleProps.set('display', 'none')
    env.fakeRoot._styleProps.set('position', 'absolute')

    const { repositionTab } = await import('../assignment')
    const result = repositionTab('ext-tab-3', 'primary')
    assert(result === true, 'T3: repositionTab returns true even when already in main')

    // display should be cleared (the new fix)
    assert(!env.fakeRoot._styleProps.has('display'), 'T3: display cleared even when already in main')
    assert(!env.fakeRoot._styleProps.has('position'), 'T3: position cleared even when already in main')
    // data-canvas-moved removed
    assert(env.fakeRoot._attrs['data-canvas-moved'] === undefined, 'T3: data-canvas-moved removed')
  } finally { restoreEnv() }
}

// =====================================================================
// Run all tests
// =====================================================================

async function main() {
  await testT1_DisplayCleared()
  await testT2_NoDisplayToClear()
  await testT3_AlreadyInMain()

  if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
  console.log(`PASS: ${passed}`)
}

main()
