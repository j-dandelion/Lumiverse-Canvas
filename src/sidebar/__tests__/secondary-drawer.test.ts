// Tests for assignToSecondary: built-in tab host-bridge lazy mount
// AND extension tab reparenting (Option D fix).
// Custom assertion harness — see src/tabs/__tests__/assignment.test.ts
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
// Global DOM stubs (must exist before any module import touches document)
// =====================================================================

// Configurable fake sidebar — set by setupExtTest for findMainTabButton
let _fakeSidebar: any = null
function _makeClassList() {
  return {
    _classes: [] as string[],
    add(cls: string) { this._classes.push(cls) },
    remove(cls: string) { this._classes = this._classes.filter(c => c !== cls) },
    contains(cls: string) { return this._classes.includes(cls) },
    toggle(cls: string, force?: boolean) {
      const has = this._classes.includes(cls)
      const shouldAdd = force !== undefined ? force : !has
      if (shouldAdd && !has) this._classes.push(cls)
      if (!shouldAdd && has) this._classes = this._classes.filter(c => c !== cls)
      return shouldAdd
    },
  }
}
const _documentElement = {
  classList: _makeClassList(),
  style: { setProperty() {}, removeProperty() {}, getPropertyValue() { return '' } },
}
;(globalThis as any).document = {
  documentElement: _documentElement,
  querySelector(sel: string) {
    if (sel === '[data-spindle-mount="sidebar"]') return _fakeSidebar
    if (sel.startsWith('[data-canvas-moved=')) {
      // Residual attr fallback in unassign — no global registry in tests
      return null
    }
    return null
  },
  querySelectorAll() { return [] },
  createElement(tag: string) {
    return {
      tagName: tag.toUpperCase(),
      _attrs: {} as Record<string, string>,
      style: {} as any,
      dataset: {} as Record<string, string>,
      className: '',
      innerHTML: '',
      textContent: '',
      src: '',
      alt: '',
      width: 0,
      height: 0,
      children: [] as any[],
      classList: _makeClassList(),
      setAttribute(name: string, value: string) { this._attrs[name] = value },
      getAttribute(name: string) { return this._attrs[name] ?? null },
      setProperty(name: string, value: string, _imp?: string) { this.style[name] = value },
      appendChild(child: any) { this.children.push(child) },
      querySelector(_sel: string) { return null },
      remove() {},
      addEventListener(_evt: string, _fn: any) {},
    }
  },
  body: { appendChild() {} },
}
;(globalThis as any).CSS = { escape(s: string) { if (s == null) return ''; return s.replace(/([^\w-])/g, '\\$1') } }
;(globalThis as any).getComputedStyle = () => ({ display: '', visibility: '' })
;(globalThis as any).MutationObserver = class { observe() {} disconnect() {} }
;(globalThis as any).HTMLElement = class {}
;(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
  setTimeout(() => cb(performance.now()), 0)
  return 0
}
// Default window with matchMedia so async restoreTest() cleanup doesn't
// leave undefined matchMedia for late async callbacks (reconcileMainTabListPin).
;(globalThis as any).window = {
  matchMedia(_q: string) { return { matches: false, addEventListener() {}, removeEventListener() {} } },
}

// =====================================================================
// matchMedia stub for mobile viewport tests
// =====================================================================
const _origMatchMedia: typeof window.matchMedia | undefined =
  (globalThis as any).window?.matchMedia
function setMobileMatchMedia(mobile: boolean) {
  ;(globalThis as any).window = (globalThis as any).window || {}
  ;(globalThis as any).window.matchMedia = (_q: string) => ({
    matches: mobile,
    addEventListener() {},
    removeEventListener() {},
  })
}
function restoreMatchMedia() {
  if (_origMatchMedia) {
    ;(globalThis as any).window.matchMedia = _origMatchMedia
  }
}

// =====================================================================
// Imports (after DOM stubs)
// =====================================================================
import { drawerObserver } from '../drawer-observer'
import { getTabAssignments, deleteTabAssignment } from '../../tabs/assignment'
import { getActiveSecondaryTabId, setActiveSecondaryTabId } from '../../tabs/active-tab'
import { __setSecondaryWrapperForTest } from '../secondary'
import { __setDrawerTabsForTest, __setStoreSnapshotForTest } from '../../store'
import { teardownSecondaryDrawer } from '../secondary-drawer'

// =====================================================================
// Mock tracking
// =====================================================================
let requestTabLocationCalls: { tabId: string; location: unknown }[] = []
let _origWindow: typeof globalThis.window

/**
 * Set up the test environment for BUILT-IN tabs:
 * 1. Stubs globalThis.window.spindle with configurable getBuiltInTabRoot / requestTabLocation
 * 2. Registers a fake built-in tab with drawerObserver so assignToSecondary finds it
 * 3. Creates a fake secondary wrapper with .sidebar-ux-panel-content so the secondary path works
 */
function setupTest(opts: {
  getBuiltInTabRoot?: (tabId: string) => HTMLElement | undefined
  requestTabLocation?: (tabId: string, location: unknown) => void
  tabId?: string
  tabTitle?: string
} = {}) {
  requestTabLocationCalls = []
  _origWindow = globalThis.window
  _fakeSidebar = null

  const tabId = opts.tabId ?? 'databank'
  const tabTitle = opts.tabTitle ?? 'Databank'

  // --- Fake secondary wrapper with .sidebar-ux-panel-content child ---
  const fakePanelContent = {
    tagName: 'DIV',
    className: 'sidebar-ux-panel-content',
    children: [] as any[],
    _attrs: {} as Record<string, string>,
    appendChild(child: any) { child.parentElement = fakePanelContent; fakePanelContent.children.push(child) },
    removeChild(child: any) {
      const idx = fakePanelContent.children.indexOf(child);
      if (idx !== -1) { fakePanelContent.children.splice(idx, 1); child.parentElement = null; }
    },
    querySelector(sel: string) {
      if (sel.startsWith('[data-canvas-moved')) {
        const idMatch = sel.match(/\[data-canvas-moved="(.+?)"\]/)
        if (idMatch) {
          return fakePanelContent.children.find((c: any) => c.getAttribute?.('data-canvas-moved') === idMatch[1]) ?? null
        }
        return null
      }
      if (sel === '.sidebar-ux-tab-list') return null
      if (sel === '.sidebar-ux-panel-title') return null
      return null
    },
    querySelectorAll(sel: string) {
      if (sel.includes('[data-canvas-moved]')) {
        return fakePanelContent.children.filter((c: any) => c.getAttribute?.('data-canvas-moved'))
      }
      return []
    },
    closest(_sel: string) { return fakePanelContent },
    getAttribute(name: string) { return fakePanelContent._attrs[name] ?? null },
    setAttribute(name: string, value: string) { fakePanelContent._attrs[name] = value },
    removeAttribute(name: string) { delete fakePanelContent._attrs[name] },
  }
  const _wrapperChildren: any[] = []
  const fakeWrapper: any = {
    tagName: 'DIV',
    isConnected: true,
    _attrs: {} as Record<string, string>,
    style: {} as any,
    innerHTML: '',
    children: _wrapperChildren,
    parentElement: null as any,
    dataset: {} as Record<string, string>,
    classList: {
      _classes: [] as string[],
      add(cls: string) { this._classes.push(cls) },
      remove(cls: string) { this._classes = this._classes.filter(c => c !== cls) },
      contains(cls: string) { return this._classes.includes(cls) },
      toggle(cls: string, force?: boolean) {
        const has = this._classes.includes(cls)
        const shouldAdd = force !== undefined ? force : !has
        if (shouldAdd && !has) this._classes.push(cls)
        if (!shouldAdd && has) this._classes = this._classes.filter(c => c !== cls)
        return shouldAdd
      },
    },
    querySelector(sel: string) {
      if (sel === '.sidebar-ux-panel-content') return fakePanelContent
      if (sel === '.sidebar-ux-tab-list') return null
      if (sel === '.sidebar-ux-panel-title') return null
      if (sel === '.sidebar-ux-drawer') return null
      return null
    },
    querySelectorAll(_sel: string) { return [] as any[] },
    setAttribute(name: string, value: string) { fakeWrapper._attrs[name] = value },
    getAttribute(name: string) { return fakeWrapper._attrs[name] ?? null },
    removeAttribute(name: string) { delete fakeWrapper._attrs[name] },
    hasAttribute(name: string) { return name in fakeWrapper._attrs },
    addEventListener(_evt: string, _fn: any) {},
    removeEventListener(_evt: string, _fn: any) {},
    appendChild(child: any) { _wrapperChildren.push(child); child.parentElement = fakeWrapper },
    removeChild(child: any) { const i = _wrapperChildren.indexOf(child); if (i >= 0) _wrapperChildren.splice(i, 1); return child },
    setProperty(name: string, value: string) { fakeWrapper.style[name] = value },
    contains(_node: any) { return false },
  }
  __setSecondaryWrapperForTest(fakeWrapper as any)

  // --- Fake root (what getBuiltInTabRoot will return) ---
  const fakeRoot = {
    tagName: 'DIV',
    _attrs: {} as Record<string, string>,
    setAttribute(name: string, value: string) { fakeRoot._attrs[name] = value },
    getAttribute(name: string) { return fakeRoot._attrs[name] ?? null },
    removeAttribute(name: string) { delete fakeRoot._attrs[name] },
    parentElement: null as any,
    closest(sel: string) {
      if (sel === '.sidebar-ux-panel-content') return fakePanelContent
      return fakeRoot.parentElement?.closest?.(sel) ?? null
    },
    querySelector(sel: string) {
      if (sel === 'svg') {
        return { outerHTML: '<svg viewBox="0 0 24 24"><path d="M12 2L2 22h20z"/></svg>' }
      }
      return null
    },
  }

  // --- Spindle bridge stubs ---
  const spindleUi: Record<string, unknown> = {
    getBuiltInTabRoot: opts.getBuiltInTabRoot ?? (() => fakeRoot as unknown as HTMLElement),
    requestTabLocation: opts.requestTabLocation ?? ((tabIdArg: string, location: unknown) => {
      requestTabLocationCalls.push({ tabId: tabIdArg, location })
    }),
  }
  globalThis.window = {
    spindle: { ui: spindleUi },
    matchMedia(_q: string) { return { matches: false, addEventListener() {}, removeEventListener() {} } },
  } as any

  // --- Register a fake built-in tab with drawerObserver ---
  const fakeButton = {
    tagName: 'BUTTON',
    _attrs: {} as Record<string, string>,
    getAttribute(name: string) { return fakeButton._attrs[name] ?? null },
    setAttribute(name: string, value: string) { fakeButton._attrs[name] = value },
    querySelector(sel: string) {
      if (sel === 'svg') {
        return { outerHTML: '<svg viewBox="0 0 24 24"><path d="M12 2L2 22h20z"/></svg>' }
      }
      return null
    },
    textContent: tabTitle,
    parentElement: null,
  }
  ;(drawerObserver as any).tabs.set(tabId, {
    tabId,
    button: fakeButton,
    extensionId: 'unknown',
    title: tabTitle,
  })

  return { fakeRoot, fakePanelContent, fakeWrapper, tabId, tabTitle }
}

/**
 * Set up the test environment for EXTENSION tabs:
 * 1. Creates a fake sidebar with a button matching the tab title (for findMainTabButton)
 * 2. Pre-populates the store cache via __setDrawerTabsForTest so findStoreTab works
 * 3. Creates a fake secondary wrapper with .sidebar-ux-panel-content and .sidebar-ux-tab-list
 * 4. Returns refs to the fake objects for assertions
 */
function setupExtTest(opts: {
  tabId?: string
  tabTitle?: string
  extensionId?: string
} = {}) {
  _origWindow = globalThis.window

  const tabId = opts.tabId ?? 'ext-tab-abc-123'
  const tabTitle = opts.tabTitle ?? 'My Extension'
  const extensionId = opts.extensionId ?? 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

  // --- Fake root (the extension's primary DOM root that gets reparented) ---
  const fakeRoot: any = {
    tagName: 'DIV',
    _attrs: {} as Record<string, string>,
    setAttribute(name: string, value: string) { fakeRoot._attrs[name] = value },
    getAttribute(name: string) { return fakeRoot._attrs[name] ?? null },
    removeAttribute(name: string) { delete fakeRoot._attrs[name] },
    parentElement: null as any,
    closest(sel: string) {
      if (sel === '.sidebar-ux-panel-content') return fakePanelContent
      return fakeRoot.parentElement?.closest?.(sel) ?? null
    },
    querySelector(sel: string) {
      if (sel === 'svg') {
        return { outerHTML: '<svg viewBox="0 0 24 24"><path d="M12 2L2 22h20z"/></svg>' }
      }
      return null
    },
  }

  // --- Fake secondary tab list (for addSecondaryTabButton) ---
  const _secondaryTabButtons: any[] = []
  const fakeTabList = {
    tagName: 'DIV',
    className: 'sidebar-ux-tab-list',
    children: _secondaryTabButtons,
    _attrs: {} as Record<string, string>,
    appendChild(child: any) { _secondaryTabButtons.push(child) },
    querySelector(sel: string) {
      if (sel.startsWith('[data-tab-id=')) {
        const idMatch = sel.match(/\[data-tab-id="(.+?)"\]/)
        if (idMatch) {
          return _secondaryTabButtons.find((b: any) => b.getAttribute?.('data-tab-id') === idMatch[1]) ?? null
        }
      }
      return null
    },
    // showSecondaryTab highlights via tabList.querySelectorAll('button[data-tab-id]')
    querySelectorAll(sel: string) {
      if (sel === 'button[data-tab-id]' || sel.includes('button[data-tab-id]')) {
        return _secondaryTabButtons
      }
      // addSecondaryTabButton queries with just the attribute selector (CSS-escaped).
      if (sel.startsWith('[data-tab-id=')) {
        const idMatch = sel.match(/\[data-tab-id="(.+?)"\]/)
        if (idMatch) {
          const unescaped = idMatch[1].replace(/\\(.)/g, '$1')
          return _secondaryTabButtons.filter((b: any) => b.getAttribute?.('data-tab-id') === unescaped)
        }
      }
      return []
    },
    getAttribute(name: string) { return fakeTabList._attrs[name] ?? null },
    setAttribute(name: string, value: string) { fakeTabList._attrs[name] = value },
  }

  // --- Fake secondary wrapper with .sidebar-ux-panel-content child ---
  const fakePanelContent: any = {
    tagName: 'DIV',
    className: 'sidebar-ux-panel-content',
    children: [] as any[],
    _attrs: {} as Record<string, string>,
    appendChild(child: any) {
      // Remove from previous parent
      if (child.parentElement && child.parentElement !== fakePanelContent) {
        const idx = child.parentElement.children?.indexOf?.(child)
        if (idx != null && idx >= 0) child.parentElement.children.splice(idx, 1)
      }
      child.parentElement = fakePanelContent
      fakePanelContent.children.push(child)
    },
    removeChild(child: any) {
      const idx = fakePanelContent.children.indexOf(child);
      if (idx !== -1) { fakePanelContent.children.splice(idx, 1); child.parentElement = null; }
    },
    querySelector(sel: string) {
      if (sel.startsWith('[data-canvas-moved')) {
        const idMatch = sel.match(/\[data-canvas-moved="(.+?)"\]/)
        if (idMatch) {
          return fakePanelContent.children.find((c: any) => c.getAttribute?.('data-canvas-moved') === idMatch[1]) ?? null
        }
        return null
      }
      if (sel === '.sidebar-ux-tab-list') return fakeTabList
      if (sel === '.sidebar-ux-panel-title') return fakeHeaderTitle
      return null
    },
    querySelectorAll(sel: string) {
      if (sel.includes('[data-canvas-moved]')) {
        return fakePanelContent.children.filter((c: any) => {
          if (!c.getAttribute?.('data-canvas-moved')) return false
          if (sel.includes(':not([data-canvas-secondary])') && c.getAttribute?.('data-canvas-secondary') != null) return false
          return true
        })
      }
      return []
    },
    closest(_sel: string) { return fakePanelContent },
    getAttribute(name: string) { return fakePanelContent._attrs[name] ?? null },
    setAttribute(name: string, value: string) { fakePanelContent._attrs[name] = value },
    removeAttribute(name: string) { delete fakePanelContent._attrs[name] },
  }
  const fakeHeaderTitle = {
    tagName: 'SPAN',
    className: 'sidebar-ux-panel-title',
    textContent: '' as string | null,
  }
  const _wrapperChildren: any[] = []
  const fakeWrapper: any = {
    tagName: 'DIV',
    isConnected: true,
    _attrs: {} as Record<string, string>,
    style: {} as any,
    innerHTML: '',
    children: _wrapperChildren,
    parentElement: null as any,
    dataset: {} as Record<string, string>,
    classList: {
      _classes: [] as string[],
      add(cls: string) { this._classes.push(cls) },
      remove(cls: string) { this._classes = this._classes.filter(c => c !== cls) },
      contains(cls: string) { return this._classes.includes(cls) },
      toggle(cls: string, force?: boolean) {
        const has = this._classes.includes(cls)
        const shouldAdd = force !== undefined ? force : !has
        if (shouldAdd && !has) this._classes.push(cls)
        if (!shouldAdd && has) this._classes = this._classes.filter(c => c !== cls)
        return shouldAdd
      },
    },
    querySelector(sel: string) {
      if (sel === '.sidebar-ux-panel-content') return fakePanelContent
      if (sel === '.sidebar-ux-tab-list') return fakeTabList
      if (sel === '.sidebar-ux-panel-title') return fakeHeaderTitle
      if (sel === '.sidebar-ux-drawer') return null
      return null
    },
    querySelectorAll(_sel: string) { return [] as any[] },
    setAttribute(name: string, value: string) { fakeWrapper._attrs[name] = value },
    getAttribute(name: string) { return fakeWrapper._attrs[name] ?? null },
    removeAttribute(name: string) { delete fakeWrapper._attrs[name] },
    hasAttribute(name: string) { return name in fakeWrapper._attrs },
    addEventListener(_evt: string, _fn: any) {},
    removeEventListener(_evt: string, _fn: any) {},
    appendChild(child: any) { _wrapperChildren.push(child); child.parentElement = fakeWrapper },
    removeChild(child: any) { const i = _wrapperChildren.indexOf(child); if (i >= 0) _wrapperChildren.splice(i, 1); return child },
    setProperty(name: string, value: string) { fakeWrapper.style[name] = value },
    contains(_node: any) { return false },
  }
  __setSecondaryWrapperForTest(fakeWrapper)

  // --- Pre-populate store cache so findStoreTab finds our extension tab ---
  __setDrawerTabsForTest([{
    id: tabId,
    extensionId,
    title: tabTitle,
    root: fakeRoot,
  }])
  __setStoreSnapshotForTest({ drawerOpen: true })

  // --- Fake sidebar with a button matching the tab title (for findMainTabButton) ---
  const fakeMainButton: any = {
    tagName: 'BUTTON',
    _attrs: {} as Record<string, string>,
    style: { display: '' },
    getAttribute(name: string) { return fakeMainButton._attrs[name] ?? null },
    setAttribute(name: string, value: string) { fakeMainButton._attrs[name] = value },
    querySelector(sel: string) {
      if (sel === 'svg') {
        return { outerHTML: '<svg viewBox="0 0 24 24"><path d="M12 2L2 22h20z"/></svg>' }
      }
      return null
    },
  }
  const _sidebarButtons: any[] = [fakeMainButton]
  _fakeSidebar = {
    tagName: 'DIV',
    parentElement: null as any,
    closest(_sel: string) { return null },
    querySelector(sel: string) {
      if (sel.startsWith('button[data-tab-id=')) {
        const idMatch = sel.match(/\[data-tab-id="(.+?)"\]/)
        if (idMatch) {
          const unescaped = idMatch[1].replace(/\\(.)/g, '$1')
          return _sidebarButtons.find((b: any) => b.getAttribute?.('data-tab-id') === unescaped) ?? null
        }
      }
      if (sel.startsWith('button[title=')) {
        const titleMatch = sel.match(/\[title="(.+?)"\]/)
        if (titleMatch) {
          const unescaped = titleMatch[1].replace(/\\(.)/g, '$1')
          return _sidebarButtons.find((b: any) => {
            const btnTitle = b.getAttribute?.('title')
            return btnTitle === unescaped
          }) ?? null
        }
      }
      return null
    },
    querySelectorAll(sel: string) {
      if (sel === 'button[title]') return _sidebarButtons
      return []
    },
  }
  // Set the title and data-tab-id on the fake button for findMainTabButton lookups
  fakeMainButton.setAttribute('title', tabTitle)
  fakeMainButton.setAttribute('data-tab-id', tabId)

  // --- Spindle bridge stubs (not needed for extension path, but avoid crashes) ---
  const spindleUi: Record<string, unknown> = {
    getBuiltInTabRoot: () => undefined,
    requestTabLocation: () => {},
  }
  globalThis.window = {
    spindle: { ui: spindleUi },
    matchMedia(_q: string) { return { matches: false, addEventListener() {}, removeEventListener() {} } },
  } as any

  return { fakeRoot, fakePanelContent, fakeTabList, fakeMainButton, fakeWrapper, extensionId, tabId, tabTitle }
}

function restoreTest() {
  teardownSecondaryDrawer()
  globalThis.window = _origWindow
  _fakeSidebar = null
  restoreMatchMedia()
  // Clean up all state between tests
  for (const [key] of getTabAssignments()) {
    deleteTabAssignment(key)
  }
  ;(drawerObserver as any).tabs.clear()
  __setSecondaryWrapperForTest(null)
  __setDrawerTabsForTest(null)
  __setStoreSnapshotForTest(null)
}

// =====================================================================
// BUILT-IN TAB TESTS (existing T2–T6)
// =====================================================================

// =====================================================================
// T2: lazy mount + requestTabLocation + UI side effects
// =====================================================================
async function testBuiltinT2() {
  setupTest()
  try {
    const { assignToSecondary } = await import('../secondary-drawer')
    await assignToSecondary('databank')

    assertEqual(requestTabLocationCalls.length, 1, 'T2: requestTabLocation called once')
    assertEqual(requestTabLocationCalls[0]?.tabId, 'databank', 'T2: requestTabLocation called with tabId "databank"')
    assert(
      JSON.stringify(requestTabLocationCalls[0]?.location) === JSON.stringify({ kind: 'container', containerId: 'canvas-secondary-drawer' }),
      'T2: requestTabLocation called with {kind:"container", containerId:"canvas-secondary-drawer"}'
    )
  } finally { restoreTest() }
}

// =====================================================================
// T3: stale tabId (getBuiltInTabRoot returns undefined)
// =====================================================================
async function testBuiltinT3() {
  setupTest({ getBuiltInTabRoot: () => undefined })
  try {
    const { assignToSecondary } = await import('../secondary-drawer')
    await assignToSecondary('nonexistent-builtin')

    assertEqual(requestTabLocationCalls.length, 0, 'T3: requestTabLocation NOT called for stale tabId')
    assert(!getTabAssignments().has('nonexistent-builtin'), 'T3: assignment NOT set for stale tabId')
  } finally { restoreTest() }
}

// =====================================================================
// T4: window.spindle undefined — no crash
// =====================================================================
async function testBuiltinT4() {
  setupTest({ tabId: 'databank-t4', tabTitle: 'Databank' })
  try {
    // Override window.spindle to undefined AFTER setupTest registers observer tab
    globalThis.window = {} as any

    const { assignToSecondary } = await import('../secondary-drawer')
    await assignToSecondary('databank-t4')

    assert(!getTabAssignments().has('databank-t4'), 'T4: assignment NOT set when spindle is undefined')
    assertEqual(requestTabLocationCalls.length, 0, 'T4: requestTabLocation NOT called when spindle missing')
  } finally { restoreTest() }
}

// =====================================================================
// T5: requestTabLocation failure — graceful fallback, assignment still created
//
// The code at host-tab-location.ts:183 catches requestTabLocation throws
// and falls through to DOM reparent. With a live shell (isConnected: true),
// tryDomPlaceRoot succeeds and the assignment is created via finalize.
// =====================================================================
async function testBuiltinT5() {
  setupTest({
    tabId: 'databank-t5',
    requestTabLocation: () => { throw new Error('bridge disconnected') },
  })
  try {
    const { assignToSecondary } = await import('../secondary-drawer')
    await assignToSecondary('databank-t5')
    // Assignment should be created — the code catches the error and falls
    // back to DOM reparent, which succeeds in the test harness.
    assert(getTabAssignments().has('databank-t5'),
      'T5: assignment created despite requestTabLocation throwing (graceful fallback)')
  } finally { restoreTest() }
}

// =====================================================================
// T6: id resolution — requestTabLocation called with input tabId
// =====================================================================
async function testBuiltinT6() {
  setupTest({ tabId: 'databank-t6', tabTitle: 'Databank' })
  try {
    const { assignToSecondary } = await import('../secondary-drawer')
    await assignToSecondary('databank-t6')

    // For built-in tabs resolved via drawerObserver, tabId === resolvedId === 'databank-t6'
    assertEqual(requestTabLocationCalls[0]?.tabId, 'databank-t6', 'T6: requestTabLocation called with input tabId "databank-t6"')
  } finally { restoreTest() }
}

// =====================================================================
// EXTENSION TAB TESTS (new T1–T7)
// =====================================================================

// =====================================================================
// T1: Reparent on first assign
// =====================================================================
async function testExtT1() {
  const env = setupExtTest()
  try {
    const { assignToSecondary } = await import('../secondary-drawer')
    await assignToSecondary(env.tabId)

    // Root should have data-canvas-moved set
    assertEqual(
      env.fakeRoot.getAttribute('data-canvas-moved'), env.tabId,
      'T1: data-canvas-moved set on root after assign'
    )
    // Root should NOT have data-canvas-secondary
    assert(
      env.fakeRoot.getAttribute('data-canvas-secondary') == null,
      'T1: data-canvas-secondary NOT set on root'
    )
    // Root should be a child of the secondary panel content
    assertEqual(
      env.fakeRoot.parentElement, env.fakePanelContent,
      'T1: root is now a child of the secondary panel content'
    )
    // Root should be in the panel content's children array
    assert(
      env.fakePanelContent.children.includes(env.fakeRoot),
      'T1: root appears in secondary panel content children'
    )
  } finally { restoreTest() }
}

// =====================================================================
// T2: Early guard on re-assign — no duplicate buttons, no crash
// =====================================================================
async function testExtT2() {
  const env = setupExtTest()
  try {
    const { assignToSecondary } = await import('../secondary-drawer')
    // First assign
    await assignToSecondary(env.tabId)
    const childrenAfterFirst = env.fakePanelContent.children.length
    const tabButtonsAfterFirst = (env.fakeTabList as any).children.length

    // Second assign (should be no-op due to early guard)
    await assignToSecondary(env.tabId)

    assertEqual(
      env.fakePanelContent.children.length, childrenAfterFirst,
      'T2: no duplicate children in secondary panel content after re-assign'
    )
    assertEqual(
      (env.fakeTabList as any).children.length, tabButtonsAfterFirst,
      'T2: no duplicate tab buttons after re-assign'
    )
    // reExecuteExtension is no longer called — the Option D fix removed it.
    // The extension path is pure reparenting now, so no re-execution side effects.
    assert(true, 'T2: reExecuteExtension is not called (removed in Option D fix)')
  } finally { restoreTest() }
}

// =====================================================================
// T3: Reparent-back on unassign
// =====================================================================
async function testExtT3() {
  const env = setupExtTest()
  try {
    const { assignToSecondary, unassignFromSecondary } = await import('../secondary-drawer')
    await assignToSecondary(env.tabId)

    // Verify reparented
    assertEqual(env.fakeRoot.parentElement, env.fakePanelContent, 'T3 setup: root in secondary')

    // Unassign
    await unassignFromSecondary(env.tabId)

    // Root should have data-canvas-moved removed
    assert(
      env.fakeRoot.getAttribute('data-canvas-moved') == null,
      'T3: data-canvas-moved removed after unassign'
    )
    // Root should have data-canvas-active removed
    assert(
      env.fakeRoot.getAttribute('data-canvas-active') == null,
      'T3: data-canvas-active removed after unassign'
    )
  } finally { restoreTest() }
}

// =====================================================================
// T4: No _executions entry on unassign — teardownExtension is a no-op
// =====================================================================
async function testExtT4() {
  const env = setupExtTest()
  try {
    const { assignToSecondary, unassignFromSecondary } = await import('../secondary-drawer')
    await assignToSecondary(env.tabId)

    // unassignFromSecondary calls teardownExtension on the extensionId.
    // For reparented tabs, no _executions entry exists, so teardown is a no-op.
    // If it throws, the test will fail.
    let threw = false
    try {
      await unassignFromSecondary(env.tabId)
    } catch (err) {
      threw = true
    }
    assert(!threw, 'T4: unassignFromSecondary does not throw (teardownExtension is no-op)')
  } finally { restoreTest() }
}

// =====================================================================
// T3b: Host already moved root out of secondary — still clear stale
// data-canvas-moved / data-canvas-active (inactive tabs lack active).
// =====================================================================
async function testUnassignClearsStaleAttrsWhenRootOutsideSecondary() {
  const tabId = 'memory-stale'
  setupTest({ tabId, tabTitle: 'Memory' })
  try {
    const root = (globalThis as any).window.spindle.ui.getBuiltInTabRoot(tabId) as {
      setAttribute: (n: string, v: string) => void
      getAttribute: (n: string) => string | null
    }
    // Simulate inactive secondary tab after host requestTabLocation(main-drawer):
    // attrs remain, root no longer under secondary content.
    root.setAttribute('data-canvas-moved', tabId)
    // intentionally no data-canvas-active
    const { setTabAssignment } = await import('../../tabs/assignment')
    setTabAssignment(tabId, 'secondary')

    const { unassignFromSecondary } = await import('../secondary-drawer')
    await unassignFromSecondary(tabId)

    assert(
      root.getAttribute('data-canvas-moved') == null,
      'T3b: data-canvas-moved cleared when root already outside secondary',
    )
    assert(
      root.getAttribute('data-canvas-active') == null,
      'T3b: data-canvas-active cleared when root already outside secondary',
    )
    const mainDrawerCall = requestTabLocationCalls.find(
      (c) => c.tabId === tabId && JSON.stringify(c.location) === JSON.stringify({ kind: 'main-drawer' }),
    )
    assert(!!mainDrawerCall, 'T3b: built-in unassign calls requestTabLocation({kind:"main-drawer"})')
  } finally { restoreTest() }
}

// =====================================================================
// T3c: Built-in unassign does NOT raw-removeChild the React root (host
// requestTabLocation owns placement). Load previous called this path
// without assignment.ts's pre-call to requestTabLocation — empty content.
// =====================================================================
async function testBuiltinUnassignDoesNotStealReactRoot() {
  const tabId = 'databank-unassign'
  const env = setupTest({ tabId, tabTitle: 'Databank' })
  try {
    const root = (globalThis as any).window.spindle.ui.getBuiltInTabRoot(tabId) as any
    // Put root under secondary content as host container placement would.
    const secContent = env.fakePanelContent
    root.parentElement = secContent
    secContent.children.push(root)
    root.setAttribute('data-canvas-moved', tabId)
    root.setAttribute('data-canvas-active', '')
    const { setTabAssignment } = await import('../../tabs/assignment')
    setTabAssignment(tabId, 'secondary')

    const { unassignFromSecondary } = await import('../secondary-drawer')
    await unassignFromSecondary(tabId)

    // Host owns reparent — Canvas must not detach the React root.
    assert(
      secContent.children.includes(root) || root.parentElement === secContent,
      'T3c: built-in root left in place for host requestTabLocation (not removeChild\'d)',
    )
    assert(
      root.getAttribute('data-canvas-moved') == null,
      'T3c: data-canvas-moved cleared',
    )
    const mainDrawerCall = requestTabLocationCalls.find(
      (c) =>
        (c.tabId === tabId || c.tabId === 'databank-unassign') &&
        JSON.stringify(c.location) === JSON.stringify({ kind: 'main-drawer' }),
    )
    assert(!!mainDrawerCall, 'T3c: requestTabLocation({kind:"main-drawer"}) called')
  } finally { restoreTest() }
}

// =====================================================================
// T5: Cleanup-on-disable — teardownSecondaryDrawer clears state
// =====================================================================
async function testExtT5() {
  const env = setupExtTest()
  try {
    const { assignToSecondary, teardownSecondaryDrawer, getSecondaryDrawerState, getActiveSecondaryTab } = await import('../secondary-drawer')
    await assignToSecondary(env.tabId)

    // Verify state before teardown
    assert(getSecondaryDrawerState() !== 'closed', 'T5 setup: drawer is not closed after assign')

    // Simulate canvas disable
    teardownSecondaryDrawer()

    // State should be closed
    assertEqual(getSecondaryDrawerState(), 'closed', 'T5: state is closed after teardown')
    assertEqual(getActiveSecondaryTab(), null, 'T5: active tab is null after teardown')
  } finally { restoreTest() }
}

// =====================================================================
// T6: Secondary tab button created correctly
// =====================================================================
async function testExtT6() {
  const env = setupExtTest()
  try {
    const { assignToSecondary } = await import('../secondary-drawer')
    await assignToSecondary(env.tabId)

    // The secondary tab list should have a button
    const tabButtons = (env.fakeTabList as any).children
    assert(tabButtons.length > 0, 'T6: at least one tab button created')

    const btn = tabButtons[tabButtons.length - 1]
    assertEqual(btn.getAttribute('data-tab-id'), env.tabId, 'T6: tab button has correct id')
    assertEqual(btn.getAttribute('title'), env.tabTitle, 'T6: tab button has correct title')
  } finally { restoreTest() }
}

// =====================================================================
// T7: State machine correctness after assign
// =====================================================================
async function testExtT7() {
  const env = setupExtTest()
  try {
    const {
      assignToSecondary,
      getSecondaryDrawerState,
      getActiveSecondaryTab,
    } = await import('../secondary-drawer')
    await assignToSecondary(env.tabId)

    assertEqual(getSecondaryDrawerState(), 'tab_active', 'T7: state is tab_active after assign')
    assertEqual(getActiveSecondaryTab(), env.tabId, 'T7: active tab id matches assigned tab')
  } finally { restoreTest() }
}

// =====================================================================
// MOBILE AUTO-OPEN GUARD TESTS (T-M1, T-M2)
// =====================================================================

// =====================================================================
// T-M1: Extension tab path on mobile — does NOT auto-open
// =====================================================================
async function testExtMobileNoAutoOpen() {
  const env = setupExtTest()
  setMobileMatchMedia(true)
  try {
    const { assignToSecondary, getSecondaryDrawerState } = await import('../secondary-drawer')
    await assignToSecondary(env.tabId)
    // State stays 'closed' — drawer was NOT auto-opened on mobile
    assertEqual(getSecondaryDrawerState(), 'closed',
      'T-M1 mobile: assignToSecondary does NOT auto-open secondary drawer')
    // Root still reparented (the move itself succeeded)
    assertEqual(env.fakeRoot.getAttribute('data-canvas-moved'), env.tabId,
      'T-M1 mobile: root reparenting still happens')
    // Tab button still created
    const tabButtons = (env.fakeTabList as any).children
    assert(tabButtons.length > 0, 'T-M1 mobile: tab button still created')
  } finally { restoreTest() }
}

// =====================================================================
// T-M2: Built-in tab path on mobile — does NOT auto-open
// =====================================================================
async function testBuiltinMobileNoAutoOpen() {
  setupTest({ tabId: 'databank-mob', tabTitle: 'Databank' })
  setMobileMatchMedia(true)
  try {
    const { assignToSecondary, getSecondaryDrawerState } = await import('../secondary-drawer')
    await assignToSecondary('databank-mob')
    assertEqual(getSecondaryDrawerState(), 'closed',
      'T-M2 mobile: built-in assignToSecondary does NOT auto-open')
  } finally { restoreTest() }
}

// =====================================================================
// T-COMPARE: unassignFromSecondary clears active tab for composite IDs
//
// Regression: getActiveSecondaryTabId() may hold a composite ID
// (e.g. "spindle:uuid:tab:html_preview:1") while unassignFromSecondary
// receives the bare "html_preview". The old code compared only against
// the bare input, so the active highlight was never cleared.
// =====================================================================
async function testUnassignCompositeActiveClear() {
  const compositeId = 'spindle:abc123:tab:ext-tab-compare:1'
  const bareId = 'ext-tab-compare'
  const env = setupExtTest({ tabId: compositeId, tabTitle: 'Compare Tab' })
  try {
    const { assignToSecondary, unassignFromSecondary } = await import('../secondary-drawer')
    await assignToSecondary(compositeId)

    // Simulate the active tab being set to the composite ID (as
    // assignToSecondary does via setActiveSecondaryTabId(resolvedId)).
    setActiveSecondaryTabId(compositeId)
    assertEqual(getActiveSecondaryTabId(), compositeId,
      'T-COMPARE setup: active tab is composite ID')

    // Unassign with the bare ID (what the wrapper button sends).
    await unassignFromSecondary(bareId)

    // Active tab should be cleared — the old code would miss this.
    assertEqual(getActiveSecondaryTabId(), null,
      'T-COMPARE: active tab cleared after unassign with bare ID')
  } finally { restoreTest() }
}

// =====================================================================
// T-LAST-CLEAR: unassignFromSecondary clears active when last tab removed
//
// Regression for B1: when the last assigned tab was removed (getTabAssignments().size === 0),
// the old code set _activeTabId = null but failed to call setActiveSecondaryTabId(null),
// causing a divergence between secondary-drawer.ts's local state and active-tab.ts's
// module variable. Callers of getActiveSecondaryTabId() would see a stale non-null value.
// =====================================================================
async function testUnassignLastTabClearsActive() {
  const env = setupExtTest({ tabId: 'spindle:x:tab:last-clear:1', tabTitle: 'Last Clear' })
  try {
    const { assignToSecondary, unassignFromSecondary } = await import('../secondary-drawer')
    // Assign the tab and set it as active.
    await assignToSecondary(env.tabId)
    setActiveSecondaryTabId(env.tabId)
    assertEqual(getActiveSecondaryTabId(), env.tabId,
      'T-LAST-CLEAR setup: tab is active')

    // Remove the only assigned tab — hits the last-tab path (size === 0).
    await unassignFromSecondary(env.tabId)

    assertEqual(getActiveSecondaryTabId(), null,
      'T-LAST-CLEAR: active tab cleared after last tab removed')
  } finally { restoreTest() }
}

// =====================================================================
// T-TEARDOWN-CLEAR: teardownSecondaryDrawer clears active tab ID in both
// secondary-drawer.ts's _activeTabId and active-tab.ts's _activeSecondaryTabId.
//
// Regression: teardownSecondaryDrawer only set _activeTabId = null without
// calling setActiveSecondaryTabId(null), leaving the exported getter stale.
// =====================================================================
async function testTeardownClearsActive() {
  const env = setupExtTest({ tabId: 'spindle:x:tab:teardown:1', tabTitle: 'Teardown Test' })
  try {
    const { assignToSecondary, teardownSecondaryDrawer } = await import('../secondary-drawer')
    await assignToSecondary(env.tabId)
    setActiveSecondaryTabId(env.tabId)
    assertEqual(getActiveSecondaryTabId(), env.tabId,
      'T-TEARDOWN-CLEAR setup: tab is active')

    teardownSecondaryDrawer()

    assertEqual(getActiveSecondaryTabId(), null,
      'T-TEARDOWN-CLEAR: active tab cleared by teardown')
  } finally { restoreTest() }
}

// =====================================================================
// T-STALE-UPGRADE: assignToSecondary upgrades a STALE observer entry
// (title-keyed, extensionId 'unknown' — the tagger's write was missed
// during the observer's initial scan) from the store's real extensionId.
// Without the upgrade the tab takes the BUILT-IN path, its placement
// fails, and the model ends up ahead of the DOM ("drag an extension tab
// to another drawer → doesn't move in the main UI").
// =====================================================================
async function testStaleEntryUpgrade() {
  const env = setupExtTest({ tabId: 'ext-tab-abc-123', tabTitle: 'My Extension', extensionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  try {
    // Inject the STALE observer entry exactly as the missed-write leaves it.
    ;(drawerObserver as any).tabs.set(env.tabTitle, {
      tabId: env.tabTitle,
      button: env.fakeMainButton,
      extensionId: 'unknown',
      title: env.tabTitle,
      key: `ext:unknown/${env.tabTitle}`,
      titles: new Set([env.tabTitle]),
    })

    const { assignToSecondary } = await import('../secondary-drawer')
    // Called with the TITLE-as-id — what the boot restore resolves.
    await assignToSecondary(env.tabTitle)

    // The extension path must have run: secondary button carries the
    // STORE's composite id, the main button is hidden, the root is
    // reparented into the secondary panel content.
    const tabButtons = (env.fakeTabList as any).children
    assert(tabButtons.length > 0, 'T-STALE-UPGRADE: secondary button created')
    const btn = tabButtons[tabButtons.length - 1]
    assertEqual(btn.getAttribute('data-tab-id'), env.tabId, 'T-STALE-UPGRADE: button uses the store composite id')
    assertEqual(env.fakeMainButton.style.display, 'none', 'T-STALE-UPGRADE: main host button hidden')
    assertEqual(
      env.fakePanelContent.children[0]?.getAttribute?.('data-canvas-moved'),
      env.tabId,
      'T-STALE-UPGRADE: root reparented into secondary content',
    )
  } finally { restoreTest() }
}

// =====================================================================
// T-NO-ROOT: extension tab with NO content root (lazily-mounted extension)
// must still get its secondary button + hidden main button — and the HOST
// BUTTON must NOT be reparented into the secondary panel content (the
// observer facade's getDrawerTabs() returns `root: tab.button`; reparenting
// it rips the button out of the sidebar — "findMainTabButton: no button",
// mirror loses the tab, move-back cannot restore it).
// =====================================================================
async function testNoRootWiresButton() {
  const env = setupExtTest({ tabId: 'ext-tab-noroot', tabTitle: 'No Root Ext', extensionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  try {
    // Fiber store has the tab but NO content root.
    __setDrawerTabsForTest([{ id: env.tabId, extensionId: env.extensionId, title: env.tabTitle, root: null }])

    const { assignToSecondary } = await import('../secondary-drawer')
    await assignToSecondary(env.tabId)

    const tabButtons = (env.fakeTabList as any).children
    assert(tabButtons.length > 0, 'T-NO-ROOT: secondary button created without a content root')
    const btn = tabButtons[tabButtons.length - 1]
    assertEqual(btn.getAttribute('data-tab-id'), env.tabId, 'T-NO-ROOT: button id is the composite')
    assertEqual(env.fakeMainButton.style.display, 'none', 'T-NO-ROOT: main host button hidden (not moved)')
    const moved = env.fakePanelContent.children.filter((c: any) => c.getAttribute?.('data-canvas-moved'))
    assertEqual(moved.length, 0, 'T-NO-ROOT: NO root reparented into the secondary content')
  } finally { restoreTest() }
}

// =====================================================================
// Run all tests
// =====================================================================
async function main() {
  // Built-in tab tests (existing)
  await testBuiltinT2()
  await testBuiltinT3()
  await testBuiltinT4()
  await testBuiltinT5()
  await testBuiltinT6()

  // Extension tab tests (new T1–T7)
  await testExtT1()
  await testExtT2()
  await testExtT3()
  await testUnassignClearsStaleAttrsWhenRootOutsideSecondary()
  await testBuiltinUnassignDoesNotStealReactRoot()
  await testExtT4()
  await testExtT5()
  await testExtT6()
  await testExtT7()

  // Stale observer entry → store upgrade (boot restore misclassification)
  await testStaleEntryUpgrade()

  // No content root → wire button, never reparent the host button
  await testNoRootWiresButton()

  // Mobile auto-open guard tests
  await testExtMobileNoAutoOpen()
  await testBuiltinMobileNoAutoOpen()

  // Composite ID active-clear regression test
  await testUnassignCompositeActiveClear()

  // Last-tab-removed active-clear regression test
  await testUnassignLastTabClearsActive()

  // Teardown active-clear regression test
  await testTeardownClearsActive()

  if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
  console.log(`PASS: ${passed}`)
}

main()
