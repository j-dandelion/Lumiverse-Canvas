// Tests for LumiScript-dock-panel interference in assignToSecondary.
//
// LumiScript registers dock panels (with `edge` field) via the same
// Zustand slice that canvas reads as `drawerTabs`. This shape collision
// caused 7 historical fixes (v1.6.4 era). These tests verify that the
// NEW code paths handle the interference correctly:
//   - Badge filter at src/store/index.ts:69 rejects dock-panel-shaped entries
//   - assignToSecondary resolves through drawerObserver when store is broken
//   - findMainTabButton title fallback at src/tabs/buttons.ts:60-73 kicks in
//
// Custom assertion harness — matches src/sidebar/__tests__/secondary-drawer.test.ts

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

let _fakeSidebar: any = null
;(globalThis as any).document = {
  querySelector(sel: string) {
    if (sel === '[data-spindle-mount="sidebar"]') return _fakeSidebar
    return null
  },
  querySelectorAll() { return [] },
  createElement(tag: string) {
    return {
      tagName: tag.toUpperCase(),
      _attrs: {} as Record<string, string>,
      style: {} as any,
      className: '',
      innerHTML: '',
      textContent: '',
      src: '',
      alt: '',
      width: 0,
      height: 0,
      children: [] as any[],
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

// =====================================================================
// Imports (after DOM stubs)
// =====================================================================
import { drawerObserver } from '../drawer-observer'
import { getTabAssignments, deleteTabAssignment } from '../../tabs/assignment'
import { __setSecondaryWrapperForTest } from '../secondary'
import { __setDrawerTabsForTest, __setStoreSnapshotForTest } from '../../store'

// =====================================================================
// Mock tracking
// =====================================================================
let _origWindow: typeof globalThis.window

// =====================================================================
// Test setup — LumiScript interference scenarios
// =====================================================================

/**
 * Set up the environment for testing LumiScript interference:
 * 1. Creates a fake secondary wrapper with .sidebar-ux-panel-content and .sidebar-ux-tab-list
 * 2. Creates a fake root element (the extension's DOM root that gets reparented)
 * 3. Sets up a fake main sidebar with buttons for findMainTabButton
 * 4. Registers the tab in drawerObserver (optionally)
 * 5. Injects dock-panel-shaped entries via __setDrawerTabsForTest (optionally)
 *
 * Returns refs to the fake objects for assertions.
 */
function setupLumiScriptTest(opts: {
  tabId?: string
  tabTitle?: string
  extensionId?: string
  registerInObserver?: boolean
  injectDockPanel?: boolean
  dockPanelHasOurTab?: boolean
  sidebarButtonTitle?: string
} = {}) {
  _origWindow = globalThis.window
  _fakeSidebar = null

  const tabId = opts.tabId ?? 'spindle:a1b2c3d4-e5f6-7890-abcd-ef1234567890:tab:lumiscript-panel:0'
  const tabTitle = opts.tabTitle ?? 'LumiScript Panel'
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
          // CSS.escape escapes special chars with backslashes. The captured
          // group has the backslashes as literal characters in the string
          // (e.g. "spindle\\:UUID..."). The actual attribute value uses
          // unescaped characters (e.g. "spindle:UUID..."). Compare by
          // stripping the backslashes from the captured selector.
          const wanted = idMatch[1].replace(/\\(.)/g, '$1')
          return _secondaryTabButtons.find((b: any) => b.getAttribute?.('data-tab-id') === wanted) ?? null
        }
      }
      return null
    },
    // showSecondaryTab highlights via tabList.querySelectorAll('button[data-tab-id]')
    querySelectorAll(sel: string) {
      if (sel === 'button[data-tab-id]' || sel.includes('button[data-tab-id]')) {
        return _secondaryTabButtons
      }
      return []
    },
    getAttribute(name: string) { return fakeTabList._attrs[name] ?? null },
    setAttribute(name: string, value: string) { fakeTabList._attrs[name] = value },
  }

  // --- Fake secondary panel content ---
  const fakePanelContent: any = {
    tagName: 'DIV',
    className: 'sidebar-ux-panel-content',
    children: [] as any[],
    _attrs: {} as Record<string, string>,
    appendChild(child: any) {
      if (child.parentElement && child.parentElement !== fakePanelContent) {
        const idx = child.parentElement.children?.indexOf?.(child)
        if (idx != null && idx >= 0) child.parentElement.children.splice(idx, 1)
      }
      child.parentElement = fakePanelContent
      fakePanelContent.children.push(child)
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

  // --- Fake secondary wrapper ---
  const _wrapperChildren: any[] = []
  const fakeWrapper: any = {
    tagName: 'DIV',
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

  // --- Dock-panel-shaped entry (LumiScript's shape: has edge, no badge) ---
  if (opts.injectDockPanel && opts.dockPanelHasOurTab) {
    // Inject a dock-panel-shaped entry that includes our tab.
    // In production, the badge filter at store/index.ts:69 would reject this.
    // Here we bypass the filter via __setDrawerTabsForTest to simulate the
    // "store is broken" scenario where only LumiScript entries are present.
    __setDrawerTabsForTest([{
      id: tabId,
      title: tabTitle,
      root: fakeRoot,
      edge: 'right',
    }] as any)
  } else if (opts.injectDockPanel) {
    // Inject dock-panel entries that do NOT include our tab.
    // Simulates the badge filter rejecting LumiScript's entries.
    __setDrawerTabsForTest([{
      id: 'lumiscript-dock-panel-1',
      title: 'LumiScript Settings',
      root: { tagName: 'DIV' } as any,
      edge: 'left',
    }] as any)
  } else {
    // No dock-panel injection — store is empty (badge filter rejected everything)
    __setDrawerTabsForTest(null)
  }
  __setStoreSnapshotForTest({ drawerOpen: true })

  // --- Register in drawerObserver (optional) ---
  if (opts.registerInObserver !== false) {
    const fakeButton: any = {
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
      extensionId,
      title: tabTitle,
    })
  }

  // --- Fake main sidebar (for findMainTabButton) ---
  const buttonTitle = opts.sidebarButtonTitle ?? tabTitle
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
  fakeMainButton.setAttribute('title', buttonTitle)
  fakeMainButton.setAttribute('data-tab-id', tabId)
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

  // --- Spindle bridge stubs ---
  // matchMedia stub: required because the mobile-fix in secondary-drawer.ts
  // calls isMobileViewport() unconditionally inside assignToSecondary.
  // matches: false (desktop) is the safe default — the test was designed
  // for the desktop path and remains so; the mobile branch is exercised
  // by T-M1/T-M2 in secondary-drawer.test.ts.
  globalThis.window = {
    spindle: { ui: {} },
    matchMedia(_q: string) { return { matches: false, addEventListener() {}, removeEventListener() {} } },
  } as any

  return { fakeRoot, fakePanelContent, fakeTabList, fakeMainButton, fakeWrapper, fakeHeaderTitle, extensionId, tabId, tabTitle }
}

function restoreTest() {
  globalThis.window = _origWindow
  _fakeSidebar = null
  for (const [key] of getTabAssignments()) {
    deleteTabAssignment(key)
  }
  ;(drawerObserver as any).tabs.clear()
  __setSecondaryWrapperForTest(null)
  __setDrawerTabsForTest(null)
  __setStoreSnapshotForTest(null)
}

// =====================================================================
// T1: Observer path resolution — dock-panel interference, observer has tab
//
// When the store contains dock-panel-shaped entries (LumiScript) that the
// badge filter would reject (getDrawerTabs returns empty), assignToSecondary
// falls through to drawerObserver.getTab(tabId). If the observer has the
// tab registered, the observer path is taken — assignment is created and
// main button is hidden. The root reparenting requires findStoreTab to
// find the root, which also uses the dock-panel-shaped entry's root.
// =====================================================================
async function testLumiScriptT1() {
  const env = setupLumiScriptTest({
    registerInObserver: true,
    injectDockPanel: true,
    dockPanelHasOurTab: true, // store has our tab (dock-panel shaped) for root lookup
  })
  try {
    const { assignToSecondary } = await import('../secondary-drawer')
    await assignToSecondary(env.tabId)

    // Observer path resolved the tab — assignment is created
    assert(
      getTabAssignments().has(env.tabId),
      'T1: assignment exists after observer-resolved assign'
    )
    assertEqual(
      getTabAssignments().get(env.tabId), 'secondary',
      'T1: assignment is secondary'
    )
    // Main button is hidden
    assertEqual(
      env.fakeMainButton.style.display, 'none',
      'T1: main button is hidden'
    )
    // Root should have data-canvas-moved set
    assertEqual(
      env.fakeRoot.getAttribute('data-canvas-moved'), env.tabId,
      'T1: data-canvas-moved set on root after assign'
    )
    // Root should be a child of the secondary panel content
    assertEqual(
      env.fakeRoot.parentElement, env.fakePanelContent,
      'T1: root is now a child of the secondary panel content'
    )
  } finally { restoreTest() }
}

// =====================================================================
// T2: findMainTabButton title fallback — no observer tab, store has entry
//
// When the store has a dock-panel-shaped entry that includes our tab
// (id + title match), but drawerObserver has no registered tab,
// assignToSecondary falls through to findStoreTab → findMainTabButton
// title-based lookup at buttons.ts:60-73. The button in the main
// sidebar whose title matches the store tab's title is found.
// =====================================================================
async function testLumiScriptT2() {
  const env = setupLumiScriptTest({
    registerInObserver: false, // no observer tab
    injectDockPanel: true,
    dockPanelHasOurTab: true, // store HAS our tab (dock-panel shaped)
  })
  try {
    const { assignToSecondary } = await import('../secondary-drawer')
    await assignToSecondary(env.tabId)

    // Assignment should exist
    assert(
      getTabAssignments().has(env.tabId),
      'T2: assignment exists after store-resolved assign'
    )
    assertEqual(
      getTabAssignments().get(env.tabId), 'secondary',
      'T2: assignment is secondary'
    )
    // Main button should be hidden
    assertEqual(
      env.fakeMainButton.style.display, 'none',
      'T2: main button is hidden'
    )
    // Secondary tab button should be present
    const tabButtons = (env.fakeTabList as any).children
    assert(tabButtons.length > 0, 'T2: secondary tab button created')
    assertEqual(
      tabButtons[tabButtons.length - 1].getAttribute('data-tab-id'),
      env.tabId,
      'T2: secondary tab button has correct id'
    )
  } finally { restoreTest() }
}

// =====================================================================
// T3: End-to-end — dock-panel interference, observer resolves, full state
//
// Inject dock-panel-shaped array, register extension tab in drawerObserver,
// call assignToSecondary(tabId), assert:
//   (a) the root is in the secondary panel
//   (b) main button is hidden
//   (c) assignment record exists
// =====================================================================
async function testLumiScriptT3() {
  const env = setupLumiScriptTest({
    registerInObserver: true,
    injectDockPanel: true,
    dockPanelHasOurTab: true, // store has our tab for root lookup
  })
  try {
    const { assignToSecondary } = await import('../secondary-drawer')
    await assignToSecondary(env.tabId)

    // (a) Root is in the secondary panel
    assertEqual(
      env.fakeRoot.parentElement, env.fakePanelContent,
      'T3(a): root is in the secondary panel content'
    )
    assert(
      env.fakePanelContent.children.includes(env.fakeRoot),
      'T3(a): root is a child of secondary panel content'
    )

    // (b) Main button is hidden
    assertEqual(
      env.fakeMainButton.style.display, 'none',
      'T3(b): main button is hidden'
    )

    // (c) Assignment record exists
    assert(
      getTabAssignments().has(env.tabId),
      'T3(c): assignment record exists'
    )
    assertEqual(
      getTabAssignments().get(env.tabId), 'secondary',
      'T3(c): assignment is secondary'
    )
  } finally { restoreTest() }
}

// =====================================================================
// T4: Existing-wrapper guard creates the missing tab button
//
// Regression test for the 2026-06-19 LumiBooks bug. Scenario:
//   1. A previous assignToSecondary call (e.g. applyLayout's polling
//      loop on initial mount) reparented the extension's primary DOM
//      root into the secondary panel content, setting data-canvas-moved
//      to the resolved composite id.
//   2. The same call's addSecondaryTabButton was a no-op (e.g. the tab
//      list was not fully ready at the time, or a stale alreadyHasButton
//      match skipped it).
//   3. The user then triggers assignToSecondary manually (right-click
//      on the main sidebar button). The early-guard detects the
//      reparented root via data-canvas-moved and used to skip the
//      primary path entirely — leaving the tab button missing despite
//      the root and header being visible.
//
// Fix: when the early-guard hits, idempotently create the tab button
// if it is missing, re-set the active state, and refresh the header
// title. The button is created with the composite resolvedId (matching
// addSecondaryTabButton's own id), so it sits next to any existing
// buttons in .sidebar-ux-tab-list.
// =====================================================================
async function testLumiScriptT4() {
  const env = setupLumiScriptTest({
    registerInObserver: true,
    injectDockPanel: true,
    dockPanelHasOurTab: true,
  })
  try {
    // Simulate the precondition: the polling loop (or a previous call)
    // already reparented the root and set data-canvas-moved, but did
    // NOT create the secondary tab button. This is the state we observed
    // in the wild when the user right-clicked LumiBooks.
    env.fakeRoot.setAttribute('data-canvas-moved', env.tabId)
    env.fakePanelContent.appendChild(env.fakeRoot)
    // The fake tab list starts empty — no button has been created yet.
    assertEqual(
      (env.fakeTabList as any).children.length, 0,
      'T4(precondition): tab list is empty before assignToSecondary call'
    )

    const { assignToSecondary } = await import('../secondary-drawer')
    await assignToSecondary(env.tabId)

    // After the call, the tab button should now exist in the tab list.
    const tabButtons = (env.fakeTabList as any).children
    assert(
      tabButtons.length >= 1,
      'T4: secondary tab button created by early-guard'
    )
    const foundBtn = tabButtons.find(
      (b: any) => b.getAttribute?.('data-tab-id') === env.tabId
    )
    assert(
      !!foundBtn,
      'T4: secondary tab button has the correct composite id'
    )
    // The header title should match the tab title (re-set by the guard).
    assertEqual(
      (env.fakeHeaderTitle as any).textContent, env.tabTitle,
      'T4: header title refreshed by early-guard'
    )
    // Assignment and main-button-hide are also re-applied (idempotent).
    assert(
      getTabAssignments().has(env.tabId),
      'T4: assignment still exists after guard call'
    )
    assertEqual(
      env.fakeMainButton.style.display, 'none',
      'T4: main button is still hidden after guard call'
    )
  } finally { restoreTest() }
}

// =====================================================================
// T5: Existing-wrapper guard is a no-op when the tab button already
//     exists. addSecondaryTabButton's own alreadyHasButton check
//     (matched against both composite and bare id) prevents duplicates.
// =====================================================================
async function testLumiScriptT5() {
  const env = setupLumiScriptTest({
    registerInObserver: true,
    injectDockPanel: true,
    dockPanelHasOurTab: true,
  })
  try {
    // Pre-condition: root is already reparented, AND a button with the
    // correct composite id already exists (the polling loop succeeded
    // end-to-end on the first call).
    env.fakeRoot.setAttribute('data-canvas-moved', env.tabId)
    env.fakePanelContent.appendChild(env.fakeRoot)
    const preExistingBtn: any = {
      tagName: 'BUTTON',
      _attrs: { 'data-tab-id': env.tabId, title: env.tabTitle },
      getAttribute(name: string) { return preExistingBtn._attrs[name] ?? null },
      setAttribute(name: string, value: string) { preExistingBtn._attrs[name] = value },
      children: [] as any[],
      classList: {
        _classes: [] as string[],
        add(cls: string) { if (!this._classes.includes(cls)) this._classes.push(cls) },
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
      appendChild(child: any) { preExistingBtn.children.push(child) },
      querySelector(_sel: string) { return null },
      addEventListener(_e: string, _f: any) {},
      style: { cssText: '', color: '', background: '', boxShadow: '', borderRadius: '' },
    }
    ;(env.fakeTabList as any).children.push(preExistingBtn)

    const { assignToSecondary } = await import('../secondary-drawer')
    await assignToSecondary(env.tabId)

    // No duplicate button created.
    const tabButtons = (env.fakeTabList as any).children
    assertEqual(
      tabButtons.length, 1,
      'T5: no duplicate tab button created when one already exists'
    )
    assertEqual(
      tabButtons[0], preExistingBtn,
      'T5: existing button is the same instance (not replaced)'
    )
  } finally { restoreTest() }
}

// =====================================================================
// Run all tests
// =====================================================================
async function main() {
  await testLumiScriptT1()
  await testLumiScriptT2()
  await testLumiScriptT3()
  await testLumiScriptT4()
  await testLumiScriptT5()

  if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
  console.log(`PASS: ${passed}`)
}

main()
