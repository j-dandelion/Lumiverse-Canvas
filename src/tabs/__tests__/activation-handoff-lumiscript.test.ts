// Tests for LumiScript-dock-panel interference in activation-handoff.
//
// LumiScript registers dock panels (with `edge` field) via the same
// Zustand slice that canvas reads as `drawerTabs`. This shape collision
// caused 7 historical fixes (v1.6.4 era). These tests verify that the
// NEW code paths in activation-handoff handle the interference:
//   - captureSourceList merges DOM + store correctly when store has dock panels
//   - v8 display filter excludes tabs in secondary (btn.style.display === 'none')
//   - preMoveSourceActiveTab override bypasses isTabActiveInMainDrawer check
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

;(globalThis as any).window = {
  matchMedia(q: string) {
    if (q === '(max-width: 600px)') return { matches: false }
    return { matches: false }
  },
}
;(globalThis as any).getComputedStyle = () => ({ display: '' })
;(globalThis as any).document = {
  querySelector(_sel: string) { return null },
  querySelectorAll(_sel: string) { return [] },
}
;(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => { setTimeout(() => cb(performance.now()), 0); return 0 }

// =====================================================================
// Import the module under test (after DOM stubs)
// =====================================================================

import { runHandoff, captureSourceList } from '../activation-handoff'
import type { TestHooks } from '../activation-handoff'

// =====================================================================
// Fake element factory
// =====================================================================

function fakeElement(opts: { tabId: string; className?: string; display?: string }) {
  const el: any = {
    _tabId: opts.tabId,
    className: opts.className || '',
    style: { display: opts.display ?? '' },
    _attrs: {} as Record<string, string>,
    setAttribute(name: string, value: string) { el._attrs[name] = value },
    getAttribute(name: string) { return el._attrs[name] ?? null },
    removeAttribute(name: string) { delete el._attrs[name] },
    _clickCount: 0,
    querySelector(sel: string) {
      if (sel === `button[data-tab-id="${opts.tabId}"]`) return el
      if (sel === `button[title="${opts.tabId}"]`) return el
      if (sel.startsWith('svg')) return { outerHTML: '<svg />' }
      return null
    },
    contains(_child: any) { return true },
    appendChild(_child: any) {},
    getBoundingClientRect() { return { width: 100, height: 100 } },
    children: [] as any[],
  }
  el.click = () => { el._clickCount++ }
  return el
}

// =====================================================================
// Fake main sidebar for captureSourceList tests
// =====================================================================

function fakeMainSidebarWithButtons(tabs: Array<{ id: string; display?: string }>): any {
  const buttons = tabs.map(t => ({
    getAttribute: (n: string) => n === 'data-tab-id' ? t.id : null,
    style: { display: t.display ?? '' },
  }))
  return {
    querySelectorAll: (sel: string) => {
      if (sel === 'button[data-tab-id]') return buttons
      return []
    },
    querySelector: (sel: string) => {
      const match = sel.match(/data-tab-id="([^"]+)"/)
      if (!match) return null
      const tabId = match[1]
      const tab = tabs.find(t => t.id === tabId)
      if (!tab) return null
      return {
        getAttribute: (n: string) => n === 'data-tab-id' ? tab.id : null,
        style: { display: tab.display ?? '' },
      }
    },
  }
}

// =====================================================================
// Test helpers — build _testHooks with tracked state
// =====================================================================

function buildHooks(opts: {
  mobile?: boolean
  activePrimary?: (tabId: string) => boolean
  activeSecondary?: string | null
  mainBtnTabId?: string
  mainSidebar?: HTMLElement | null
  drawerTabs?: Array<{ id: string; title?: string; edge?: string }>
  getTabLocation?: (tabId: string) => { kind: string; containerId?: string } | null
}): { hooks: TestHooks; state: { secondaryTabIdSetTo: string | null; activatePrimaryCalls: string[] }; mainBtn: any | null } {
  const state = {
    secondaryTabIdSetTo: null as string | null,
    activatePrimaryCalls: [] as string[],
  }

  const fakeMainBtn = opts.mainBtnTabId ? fakeElement({ tabId: opts.mainBtnTabId }) : null

  const hooks: TestHooks = {
    isMobileViewport: () => opts.mobile ?? false,
    isTabActiveInMainDrawer: opts.activePrimary ?? (() => false),
    getActiveSecondaryTabId: () => opts.activeSecondary ?? null,
    setActiveSecondaryTabId: (tabId: string | null) => { state.secondaryTabIdSetTo = tabId },
    findMainTabButton: (tabId: string) => {
      state.activatePrimaryCalls.push(tabId)
      if (fakeMainBtn && fakeMainBtn._tabId === tabId) return fakeMainBtn
      return null
    },
    findStoreData: () => {},
    getDrawerTabs: () => (opts.drawerTabs ?? []) as any[],
    getMainPanelContent: () => ({ contains() { return false }, appendChild() {} }) as any as HTMLElement,
    getMainSidebar: () => opts.mainSidebar ?? null,
    getTabLocation: opts.getTabLocation,
  }

  return { hooks, state, mainBtn: fakeMainBtn }
}

// =====================================================================
// T-LUMI-H1: captureSourceList merges DOM + store (dock-panel in store)
//
// Regression test: when the store contains dock-panel-shaped entries
// (LumiScript), captureSourceList('primary') must merge DOM button ids
// with store ids. The dock-panel entries have the same ids as the DOM
// buttons, so deduplication produces just the DOM ids.
//
// The badge filter at store/index.ts:69 rejects dock-panel entries in
// production, so getDrawerTabs() returns empty. Here we simulate the
// store returning dock-panel entries (bypassing the filter) to verify
// that captureSourceList handles them correctly.
// =====================================================================
async function testLumiLumiH1() {
  // Sidebar has 3 buttons with data-tab-id
  const fakeSidebar = fakeMainSidebarWithButtons([
    { id: 'tab-A' },
    { id: 'tab-B' },
    { id: 'tab-C' },
  ])
  // Store returns dock-panel-shaped entries with the same ids (dedup → same 3)
  const { hooks } = buildHooks({
    mainSidebar: fakeSidebar,
    drawerTabs: [
      { id: 'tab-A', title: 'Tab A', edge: 'right' } as any,
      { id: 'tab-B', title: 'Tab B', edge: 'left' } as any,
      { id: 'tab-C', title: 'Tab C', edge: 'right' } as any,
    ],
  })
  const result = await captureSourceList('primary', hooks)
  assertEqual(result.length, 3, 'T-LUMI-H1: merged list has 3 ids (DOM + store deduped)')
  assert(result.includes('tab-A'), 'T-LUMI-H1: tab-A present')
  assert(result.includes('tab-B'), 'T-LUMI-H1: tab-B present')
  assert(result.includes('tab-C'), 'T-LUMI-H1: tab-C present')
}

// =====================================================================
// T-LUMI-H2: v8 display filter excludes hidden buttons
//
// When canvas moves a tab to secondary, it sets btn.style.display='none'
// on the corresponding main sidebar button. captureSourceList must filter
// out tabs whose button has display=none (v8 fix at activation-handoff.ts:153).
//
// Inject a sidebar with 5 buttons (2 with display='none'). Verify the 2
// hidden buttons are filtered out, 3 visible remain.
// =====================================================================
async function testLumiLumiH2() {
  const fakeSidebar = fakeMainSidebarWithButtons([
    { id: 'profile',  display: '' },
    { id: 'library',  display: '' },
    { id: 'notes',    display: 'none' },  // in secondary
    { id: 'calendar', display: '' },
    { id: 'memory',   display: 'none' },  // in secondary
  ])
  const { hooks } = buildHooks({
    mainSidebar: fakeSidebar,
  })
  const result = await captureSourceList('primary', hooks)
  assertEqual(result.length, 3, 'T-LUMI-H2: source list has 3 tabs (notes + memory filtered out)')
  assertEqual(result[0], 'profile',  'T-LUMI-H2: first tab is profile')
  assertEqual(result[1], 'library',  'T-LUMI-H2: second tab is library')
  assertEqual(result[2], 'calendar', 'T-LUMI-H2: third tab is calendar')
  assert(result.indexOf('notes') === -1,  'T-LUMI-H2: notes (display=none) is filtered out')
  assert(result.indexOf('memory') === -1, 'T-LUMI-H2: memory (display=none) is filtered out')
}

// =====================================================================
// T-LUMI-H3: preMoveSourceActiveTab override bypasses isTabActiveInMainDrawer
//
// When preMoveSourceActiveTab: true is passed to runHandoff, the
// store-based isTabActiveInMainDrawer check is bypassed. Use
// _testHooks.isTabActiveInMainDrawer returning false to confirm the
// override wins — source replacement is activated even though the hook
// says the tab is NOT active.
// =====================================================================
async function testLumiLumiH3() {
  const { hooks, state } = buildHooks({
    activePrimary: () => false, // hook says tab is NOT active
    mainBtnTabId: 'Profile',
  })
  await runHandoff({
    tabId: 'Library',
    source: 'primary',
    destination: 'secondary',
    sourceList: ['Profile', 'Library', 'Notes'],
    preMoveSourceActiveTab: true, // override: tab WAS active
    _testHooks: hooks,
  })
  // Source replacement = Profile (above Library) — override won
  assertEqual(state.activatePrimaryCalls[0], 'Profile', 'T-LUMI-H3: source replacement = Profile (override wins)')
  assertEqual(state.secondaryTabIdSetTo, 'Library', 'T-LUMI-H3: destination active = Library')
}

// =====================================================================
// Run all tests
// =====================================================================
async function main() {
  await testLumiLumiH1()
  await testLumiLumiH2()
  await testLumiLumiH3()

  if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
  console.log(`PASS: ${passed}`)
}

main()
