// Tests for the activation-handoff module — T-ACT-1a through T-ACT-4c
// plus T-ACT-5 regression (see orchestrator plan test_matrix).
//
// Custom assertion harness — matches src/sidebar/__tests__/secondary-drawer.test.ts
// Uses _testHooks on HandoffArgs to stub external dependencies instead of
// bun:test mock.module() (which doesn't work in Bun for ES modules).

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
// Import the module under test (after DOM stubs — no mock.module needed)
// =====================================================================

import { runHandoff, captureSourceList } from '../activation-handoff'
import type { TestHooks } from '../activation-handoff'

// =====================================================================
// Fake element factory
// =====================================================================

function fakeElement(opts: { tabId: string; className?: string }) {
  const el: any = {
    _tabId: opts.tabId,
    className: opts.className || '',
    style: { display: '' },
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
// Test helpers — build _testHooks with tracked state
// =====================================================================

function buildHooks(opts: {
  mobile?: boolean
  activePrimary?: (tabId: string) => boolean
  activeSecondary?: string | null
  mainBtnTabId?: string
  mainSidebar?: HTMLElement | null
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
    getDrawerTabs: () => [],
    getMainPanelContent: () => ({ contains() { return false }, appendChild() {} }) as any as HTMLElement,
    getMainSidebar: () => opts.mainSidebar ?? null,
    getTabLocation: opts.getTabLocation,
  }

  return { hooks, state, mainBtn: fakeMainBtn }
}

// =====================================================================
// T-ACT-1a: Active primary tab (middle) moved to secondary on desktop
// =====================================================================
async function testT_ACT_1a() {
  const { hooks, state } = buildHooks({
    activePrimary: (tabId) => tabId === 'tab-C',
    mainBtnTabId: 'tab-B',
  })
  await runHandoff({
    tabId: 'tab-C',
    source: 'primary',
    destination: 'secondary',
    sourceList: ['tab-A', 'tab-B', 'tab-C', 'tab-D'],
    _testHooks: hooks,
  })
  // Source: tab above (tab-B) becomes active — activateInPrimary was called with tab-B
  assertEqual(state.activatePrimaryCalls[0], 'tab-B', 'T-ACT-1a: source replacement = tab-B (above tab-C)')
  // Destination: moved tab IS active in secondary
  assertEqual(state.secondaryTabIdSetTo, 'tab-C', 'T-ACT-1a: destination active = tab-C')
}

// =====================================================================
// T-ACT-1b: Active primary tab (middle) moved to secondary on mobile
// =====================================================================
async function testT_ACT_1b() {
  const { hooks, state } = buildHooks({
    mobile: true,
    activePrimary: (tabId) => tabId === 'tab-C',
    mainBtnTabId: 'tab-B',
  })
  await runHandoff({
    tabId: 'tab-C',
    source: 'primary',
    destination: 'secondary',
    sourceList: ['tab-A', 'tab-B', 'tab-C', 'tab-D'],
    _testHooks: hooks,
  })
  // Source: tab above (tab-B) becomes active (Part B fires on mobile)
  assertEqual(state.activatePrimaryCalls[0], 'tab-B', 'T-ACT-1b: source replacement = tab-B')
  // Destination: moved tab NOT active (mobile skip)
  assertEqual(state.secondaryTabIdSetTo, null, 'T-ACT-1b: destination NOT active (mobile skip)')
}

// =====================================================================
// T-ACT-1c: Active secondary tab (middle) moved to primary on desktop
// =====================================================================
async function testT_ACT_1c() {
  const { hooks, state } = buildHooks({
    activeSecondary: 'tab-C',
    mainBtnTabId: 'tab-C',
  })
  await runHandoff({
    tabId: 'tab-C',
    source: 'secondary',
    destination: 'primary',
    sourceList: ['tab-A', 'tab-B', 'tab-C', 'tab-D'],
    _testHooks: hooks,
  })
  // Source: tab above (tab-B) becomes active in secondary
  assertEqual(state.secondaryTabIdSetTo, 'tab-B', 'T-ACT-1c: source replacement = tab-B in secondary')
  // Destination: moved tab IS active in primary
  assertEqual(state.activatePrimaryCalls[0], 'tab-C', 'T-ACT-1c: destination active = tab-C in primary')
}

// =====================================================================
// T-ACT-1d: Active secondary tab (middle) moved to primary on mobile
// =====================================================================
async function testT_ACT_1d() {
  const { hooks, state } = buildHooks({
    mobile: true,
    activeSecondary: 'tab-C',
    mainBtnTabId: 'tab-C',
  })
  await runHandoff({
    tabId: 'tab-C',
    source: 'secondary',
    destination: 'primary',
    sourceList: ['tab-A', 'tab-B', 'tab-C', 'tab-D'],
    _testHooks: hooks,
  })
  // Source: tab above (tab-B) becomes active in secondary (Part B fires on mobile)
  assertEqual(state.secondaryTabIdSetTo, 'tab-B', 'T-ACT-1d: source replacement = tab-B in secondary')
  // Destination: moved tab NOT active in primary (mobile skip)
  assertEqual(state.activatePrimaryCalls.length, 0, 'T-ACT-1d: destination NOT active in primary (mobile skip)')
}

// =====================================================================
// T-ACT-2a: Non-active primary tab moved to secondary on desktop
// =====================================================================
async function testT_ACT_2a() {
  const { hooks, state } = buildHooks({
    activePrimary: (tabId) => tabId === 'tab-A', // tab-A active, tab-C moved (non-active)
  })
  await runHandoff({
    tabId: 'tab-C',
    source: 'primary',
    destination: 'secondary',
    sourceList: ['tab-A', 'tab-B', 'tab-C', 'tab-D'],
    _testHooks: hooks,
  })
  // Source: active tab stays (no change — wasActive is false)
  assertEqual(state.activatePrimaryCalls.length, 0, 'T-ACT-2a: source NOT activated (was not active)')
  // Destination: moved tab IS active (unconditional, not mobile)
  assertEqual(state.secondaryTabIdSetTo, 'tab-C', 'T-ACT-2a: destination active = tab-C')
}

// =====================================================================
// T-ACT-2b: Non-active primary tab moved to secondary on mobile
// =====================================================================
async function testT_ACT_2b() {
  const { hooks, state } = buildHooks({
    mobile: true,
    activePrimary: (tabId) => tabId === 'tab-A',
  })
  await runHandoff({
    tabId: 'tab-C',
    source: 'primary',
    destination: 'secondary',
    sourceList: ['tab-A', 'tab-B', 'tab-C', 'tab-D'],
    _testHooks: hooks,
  })
  // Source: active tab stays (no change — wasActive is false)
  assertEqual(state.activatePrimaryCalls.length, 0, 'T-ACT-2b: source NOT activated (was not active)')
  // Destination: moved tab NOT active (mobile skip)
  assertEqual(state.secondaryTabIdSetTo, null, 'T-ACT-2b: destination NOT active (mobile skip)')
}

// =====================================================================
// T-ACT-2c: Non-active secondary tab moved to primary on desktop
// =====================================================================
async function testT_ACT_2c() {
  const { hooks, state } = buildHooks({
    activeSecondary: 'tab-A', // tab-A active, tab-C moved (non-active)
    mainBtnTabId: 'tab-C',
  })
  await runHandoff({
    tabId: 'tab-C',
    source: 'secondary',
    destination: 'primary',
    sourceList: ['tab-A', 'tab-B', 'tab-C', 'tab-D'],
    _testHooks: hooks,
  })
  // Source: active stays in secondary (wasActive is false)
  assertEqual(state.secondaryTabIdSetTo, null, 'T-ACT-2c: source NOT activated (was not active)')
  // Destination: moved tab IS active in primary
  assertEqual(state.activatePrimaryCalls[0], 'tab-C', 'T-ACT-2c: destination active = tab-C in primary')
}

// =====================================================================
// T-ACT-2d: Non-active secondary tab moved to primary on mobile
// =====================================================================
async function testT_ACT_2d() {
  const { hooks, state } = buildHooks({
    mobile: true,
    activeSecondary: 'tab-A',
    mainBtnTabId: 'tab-C',
  })
  await runHandoff({
    tabId: 'tab-C',
    source: 'secondary',
    destination: 'primary',
    sourceList: ['tab-A', 'tab-B', 'tab-C', 'tab-D'],
    _testHooks: hooks,
  })
  // Source: active stays in secondary (wasActive is false)
  assertEqual(state.secondaryTabIdSetTo, null, 'T-ACT-2d: source NOT activated (was not active)')
  // Destination: moved tab NOT active in primary (mobile skip)
  assertEqual(state.activatePrimaryCalls.length, 0, 'T-ACT-2d: destination NOT active in primary (mobile skip)')
}

// =====================================================================
// T-ACT-3a: Active primary tab (topmost) moved to secondary on desktop
// =====================================================================
async function testT_ACT_3a() {
  const { hooks, state } = buildHooks({
    activePrimary: (tabId) => tabId === 'tab-A',
    mainBtnTabId: 'tab-B',
  })
  await runHandoff({
    tabId: 'tab-A',
    source: 'primary',
    destination: 'secondary',
    sourceList: ['tab-A', 'tab-B', 'tab-C'],
    _testHooks: hooks,
  })
  // Source: tab below (tab-B) becomes active (no above)
  assertEqual(state.activatePrimaryCalls[0], 'tab-B', 'T-ACT-3a: source replacement = tab-B (below tab-A, no above)')
  // Destination: moved tab IS active in secondary
  assertEqual(state.secondaryTabIdSetTo, 'tab-A', 'T-ACT-3a: destination active = tab-A')
}

// =====================================================================
// T-ACT-3b: Active secondary tab (topmost) moved to primary on desktop
// =====================================================================
async function testT_ACT_3b() {
  const { hooks, state } = buildHooks({
    activeSecondary: 'tab-A',
    mainBtnTabId: 'tab-A',
  })
  await runHandoff({
    tabId: 'tab-A',
    source: 'secondary',
    destination: 'primary',
    sourceList: ['tab-A', 'tab-B', 'tab-C'],
    _testHooks: hooks,
  })
  // Source: tab below (tab-B) becomes active in secondary
  assertEqual(state.secondaryTabIdSetTo, 'tab-B', 'T-ACT-3b: source replacement = tab-B in secondary (below tab-A)')
  // Destination: moved tab IS active in primary
  assertEqual(state.activatePrimaryCalls[0], 'tab-A', 'T-ACT-3b: destination active = tab-A in primary')
}

// =====================================================================
// T-ACT-3c: Active primary tab (topmost) moved to secondary on mobile
// =====================================================================
async function testT_ACT_3c() {
  const { hooks, state } = buildHooks({
    mobile: true,
    activePrimary: (tabId) => tabId === 'tab-A',
    mainBtnTabId: 'tab-B',
  })
  await runHandoff({
    tabId: 'tab-A',
    source: 'primary',
    destination: 'secondary',
    sourceList: ['tab-A', 'tab-B', 'tab-C'],
    _testHooks: hooks,
  })
  // Source: tab below (tab-B) becomes active (Part B fires on mobile)
  assertEqual(state.activatePrimaryCalls[0], 'tab-B', 'T-ACT-3c: source replacement = tab-B (below tab-A, no above)')
  // Destination: moved tab NOT active (mobile skip)
  assertEqual(state.secondaryTabIdSetTo, null, 'T-ACT-3c: destination NOT active (mobile skip)')
}

// =====================================================================
// T-ACT-4a: Active primary tab (only tab) moved to secondary on desktop
// =====================================================================
async function testT_ACT_4a() {
  const { hooks, state } = buildHooks({
    activePrimary: (tabId) => tabId === 'tab-A',
  })
  await runHandoff({
    tabId: 'tab-A',
    source: 'primary',
    destination: 'secondary',
    sourceList: ['tab-A'],
    _testHooks: hooks,
  })
  // Source: drawer ends empty (pickSourceReplacement returns null)
  assertEqual(state.activatePrimaryCalls.length, 0, 'T-ACT-4a: source NOT activated (only tab, no replacement)')
  // Destination: moved tab IS active in secondary
  assertEqual(state.secondaryTabIdSetTo, 'tab-A', 'T-ACT-4a: destination active = tab-A')
}

// =====================================================================
// T-ACT-4b: Active secondary tab (only tab) moved to primary on desktop
// =====================================================================
async function testT_ACT_4b() {
  const { hooks, state } = buildHooks({
    activeSecondary: 'tab-A',
    mainBtnTabId: 'tab-A',
  })
  await runHandoff({
    tabId: 'tab-A',
    source: 'secondary',
    destination: 'primary',
    sourceList: ['tab-A'],
    _testHooks: hooks,
  })
  // Source: drawer ends empty
  assertEqual(state.secondaryTabIdSetTo, null, 'T-ACT-4b: source NOT activated (only tab, no replacement)')
  // Destination: moved tab IS active in primary
  assertEqual(state.activatePrimaryCalls[0], 'tab-A', 'T-ACT-4b: destination active = tab-A in primary')
}

// =====================================================================
// T-ACT-4c: Active secondary tab (only tab) moved to primary on mobile
// =====================================================================
async function testT_ACT_4c() {
  const { hooks, state } = buildHooks({
    mobile: true,
    activeSecondary: 'tab-A',
    mainBtnTabId: 'tab-A',
  })
  await runHandoff({
    tabId: 'tab-A',
    source: 'secondary',
    destination: 'primary',
    sourceList: ['tab-A'],
    _testHooks: hooks,
  })
  // Source: drawer ends empty (Part A fires, replacement=null)
  assertEqual(state.secondaryTabIdSetTo, null, 'T-ACT-4c: source NOT activated (only tab, no replacement)')
  // Destination: moved tab NOT active in primary (mobile skip)
  assertEqual(state.activatePrimaryCalls.length, 0, 'T-ACT-4c: destination NOT active in primary (mobile skip)')
}

// =====================================================================
// T-BI-1: primary->secondary, was active (preMoveSourceActiveTab=true),
// sourceList=[Profile, Library, Notes], tabId=Library, desktop.
// Expect: source replacement = Profile (above), dest = Library.
// =====================================================================
async function testT_BI_1() {
  const { hooks, state } = buildHooks({
    mainBtnTabId: 'Profile',
  })
  await runHandoff({
    tabId: 'Library',
    source: 'primary',
    destination: 'secondary',
    sourceList: ['Profile', 'Library', 'Notes'],
    preMoveSourceActiveTab: true,
    _testHooks: hooks,
  })
  assertEqual(state.activatePrimaryCalls[0], 'Profile', 'T-BI-1: source replacement = Profile (above Library)')
  assertEqual(state.secondaryTabIdSetTo, 'Library', 'T-BI-1: destination active = Library')
}

// =====================================================================
// T-BI-2: primary->secondary, was active, sourceList=[Library, Notes, Calendar],
// tabId=Library (topmost), desktop.
// Expect: source replacement = Notes (below), dest = Library.
// =====================================================================
async function testT_BI_2() {
  const { hooks, state } = buildHooks({
    mainBtnTabId: 'Notes',
  })
  await runHandoff({
    tabId: 'Library',
    source: 'primary',
    destination: 'secondary',
    sourceList: ['Library', 'Notes', 'Calendar'],
    preMoveSourceActiveTab: true,
    _testHooks: hooks,
  })
  assertEqual(state.activatePrimaryCalls[0], 'Notes', 'T-BI-2: source replacement = Notes (below Library, topmost)')
  assertEqual(state.secondaryTabIdSetTo, 'Library', 'T-BI-2: destination active = Library')
}

// =====================================================================
// T-BI-3: primary->secondary, was NOT active (preMoveSourceActiveTab=false),
// sourceList=[Profile, Library, Notes], tabId=Library, desktop.
// Expect: no source activation, dest = Library.
// =====================================================================
async function testT_BI_3() {
  const { hooks, state } = buildHooks({})
  await runHandoff({
    tabId: 'Library',
    source: 'primary',
    destination: 'secondary',
    sourceList: ['Profile', 'Library', 'Notes'],
    preMoveSourceActiveTab: false,
    _testHooks: hooks,
  })
  assertEqual(state.activatePrimaryCalls.length, 0, 'T-BI-3: source NOT activated (was not active)')
  assertEqual(state.secondaryTabIdSetTo, 'Library', 'T-BI-3: destination active = Library')
}

// =====================================================================
// T-BI-4: primary->secondary, was active, tabId=Library, isMobile=true.
// Expect: source replacement = Profile (above fires on mobile per Part B),
// dest = undefined (mobile-skipped per Part C).
// =====================================================================
async function testT_BI_4() {
  const { hooks, state } = buildHooks({
    mobile: true,
    mainBtnTabId: 'Profile',
  })
  await runHandoff({
    tabId: 'Library',
    source: 'primary',
    destination: 'secondary',
    sourceList: ['Profile', 'Library', 'Notes'],
    preMoveSourceActiveTab: true,
    _testHooks: hooks,
  })
  assertEqual(state.activatePrimaryCalls[0], 'Profile', 'T-BI-4: source replacement = Profile (above fires on mobile)')
  assertEqual(state.secondaryTabIdSetTo, null, 'T-BI-4: destination NOT active (mobile skip)')
}

// =====================================================================
// T-BI-5: secondary->primary, was active (preMoveSourceActiveTab=true),
// sourceList=[Profile, Library, Notes], tabId=Library, desktop.
// Verifies Bug 3 fix: sourceList passed directly (pre-move snapshot) so
// pickSourceReplacement finds Library at index 1 and returns Profile.
// Expect: source replacement = Profile (above), dest = Library.
// =====================================================================
async function testT_BI_5() {
  const { hooks, state } = buildHooks({
    activeSecondary: 'Library',
    mainBtnTabId: 'Library',
  })
  await runHandoff({
    tabId: 'Library',
    source: 'secondary',
    destination: 'primary',
    sourceList: ['Profile', 'Library', 'Notes'],
    preMoveSourceActiveTab: true,
    _testHooks: hooks,
  })
  assertEqual(state.secondaryTabIdSetTo, 'Profile', 'T-BI-5: source replacement = Profile (above Library in secondary)')
  assertEqual(state.activatePrimaryCalls[0], 'Library', 'T-BI-5: destination active = Library in primary')
}

// =====================================================================
// T-BI-6: secondary->primary, pre-move active override.
//
// Regression test for the production bug: preMoveSourceActiveTab MUST
// override the post-move getActiveSecondaryTabId check, because
// unassignFromSecondary resets the active tab to the first remaining
// secondary tab BEFORE runHandoff runs. Simulates this by mocking
// getActiveSecondaryTabId to return null (the post-unassign value) but
// passing preMoveSourceActiveTab=true (the correct pre-move value).
//
// Old code (preMoveSourceActiveTab only honored for source='primary'):
// would fail — wasActive=false, no source replacement activated.
// New code: passes — wasActive=true via the pre-move override.
// =====================================================================
async function testT_BI_6() {
  const { hooks, state } = buildHooks({
    activeSecondary: null,  // post-unassign: getActiveSecondaryTabId returns null
    mainBtnTabId: 'Library',
  })
  await runHandoff({
    tabId: 'Library',
    source: 'secondary',
    destination: 'primary',
    sourceList: ['Profile', 'Library', 'Notes'],
    preMoveSourceActiveTab: true,  // pre-move: Library was active in secondary
    _testHooks: hooks,
  })
  // preMoveSourceActiveTab MUST override the post-unassign active=null
  assertEqual(state.secondaryTabIdSetTo, 'Profile', 'T-BI-6: pre-move active override -> source replacement = Profile')
  assertEqual(state.activatePrimaryCalls[0], 'Library', 'T-BI-6: destination active = Library in primary')
}

// =====================================================================
// T-BI-7: primary->secondary, host overrides source-replacement click.
//
// Regression test for the production bug: when the moved tab is ACTIVE in
// primary, the host's ViewportDrawer useEffect fires after the canvas's
// activateInPrimary click and resets drawerTab to the first non-moved
// (topmost) tab. The canvas's 100ms verification then sees mainBtn.className
// WITHOUT 'tabBtnActive' and must RE-CLICK the replacement to counter the
// host's reset. By 100ms, the host's useEffect has cleared
// pendingActiveTabReset, so the re-click sticks.
//
// Simulates this by passing a fake mainBtn whose className is '' (no
// tabBtnActive) — i.e. the host has cleared the active state. The
// 100ms post-click verification will see !active and re-click. We verify
// _clickCount === 2 (initial click + re-click).
//
// Old code (no re-click): would fail — _clickCount=1, replacement not
// activated, host's reset wins.
// New code: passes — _clickCount=2, re-click counters the host's reset.
// =====================================================================
async function testT_BI_7() {
  const { hooks, mainBtn } = buildHooks({
    mainBtnTabId: 'Library',  // the replacement (above the moved tab)
  })
  await runHandoff({
    tabId: 'Notes',           // the moved tab
    source: 'primary',
    destination: 'secondary',
    sourceList: ['Library', 'Notes', 'Calendar'],
    preMoveSourceActiveTab: true,  // Notes was the active tab
    _testHooks: hooks,
  })
  assertEqual(mainBtn._clickCount, 2, 'T-BI-7: re-click after host override (click count = 2)')
  assertEqual(mainBtn._tabId, 'Library', 'T-BI-7: re-click was on the replacement button (Library)')
}

// =====================================================================
// T-BI-8: captureSourceList('primary') must include built-in tabs from
// the main sidebar DOM.
//
// Regression test for the production bug: the previous
// captureSourceList('primary') only read from getDrawerTabs() (extension
// tabs only), so a built-in move produced an empty source list.
// pickSourceReplacement('notes', []) returned null, Gate A was skipped,
// activateInPrimary was never called, and the host's
// pendingActiveTabReset useEffect activated 'profile' as the first
// non-moved tab. The user saw "always Profile" for every built-in move.
//
// New code reads the main sidebar DOM (button[data-tab-id] = built-in
// tab buttons, set by ViewportDrawer.tsx:226) AND the store (extension
// tabs), merging DOM-first (visual order) then store IDs not in DOM.
// =====================================================================
function fakeMainSidebar(builtInIds: string[]): any {
  return {
    querySelectorAll: (sel: string) => {
      if (sel === 'button[data-tab-id]') {
        return builtInIds.map(id => ({
          getAttribute: (n: string) => n === 'data-tab-id' ? id : null,
        }))
      }
      return []
    },
    // No-op querySelector for the v8 button-display filter: returns
    // null (no button found), which means the tab is NOT filtered out
    // (defensive — T-BI-8 expects all tabs in the source list).
    querySelector: (_sel: string) => null,
  }
}

async function testT_BI_8() {
  const fakeSidebar = fakeMainSidebar(['profile', 'library', 'notes', 'calendar'])
  const { hooks } = buildHooks({
    mainSidebar: fakeSidebar,
  })
  // Default buildHooks returns getDrawerTabs = () => [], so no extension tabs.
  // This simulates a primary drawer with only built-in tabs (no extensions).
  const result = await captureSourceList('primary', hooks)
  assertEqual(result.length, 4, 'T-BI-8: source list has 4 built-in tabs (was: 0)')
  assertEqual(result[0], 'profile', 'T-BI-8: first tab is profile (visual order preserved)')
  assertEqual(result[1], 'library', 'T-BI-8: second tab is library')
  assertEqual(result[2], 'notes', 'T-BI-8: third tab is notes (the moved built-in is included)')
  assertEqual(result[3], 'calendar', 'T-BI-8: fourth tab is calendar')
}

// =====================================================================
// T-BI-9: captureSourceList('primary') must FILTER OUT tabs that are
// currently in the secondary drawer.
//
// Regression test for the production bug: the main sidebar DOM
// includes built-in tab buttons regardless of location (Lumiverse
// still renders them in main even when the tab's root is in
// secondary), and the store includes extension tabs regardless of
// location. Without filtering, pickSourceReplacement could pick a
// tab-in-secondary as the replacement, which activates a tab with
// empty content in main (the root is in secondary, so the main panel
// is blank with just the tab's header showing). This is the "Memory
// (cortex) header with empty content" / "personas picked from
// secondary" bug.
//
// v8 fix: use the main sidebar button's CSS display as the
// authoritative signal. When canvas moves a tab to secondary, it sets
// btn.style.display = 'none' on the corresponding main sidebar
// button. The filter excludes tabs whose button has display=none.
// This is reliable because it directly reflects canvas's own
// state-management, with no dependency on Lumiverse's host bridge
// (unreliable) or on the main-panel DOM (only contains the active
// tab's root, so checking root-in-main-panel filtered out ALL
// non-active tabs in main — a previous over-filter regression).
//
// The pickSourceReplacement unit test (T-BI-9) verifies:
//   1. Tabs with visible buttons (display='') are included
//   2. Tabs with hidden buttons (display='none') are filtered out
//   3. Visual order is preserved
//   4. Tabs whose button is not found in the sidebar are included
//      (defensive — could be a tab not yet rendered)
// =====================================================================
function fakeMainSidebarWithDisplay(tabs: Array<{ id: string; display: string }>): any {
  return {
    querySelectorAll: (sel: string) => {
      if (sel === 'button[data-tab-id]') {
        return tabs.map(t => ({
          getAttribute: (n: string) => n === 'data-tab-id' ? t.id : null,
        }))
      }
      return []
    },
    querySelector: (sel: string) => {
      // Extract tabId from selector like 'button[data-tab-id="notes"]'
      const match = sel.match(/data-tab-id="([^"]+)"/)
      if (!match) return null
      const tabId = match[1]
      const tab = tabs.find(t => t.id === tabId)
      if (!tab) return null
      return {
        getAttribute: (n: string) => n === 'data-tab-id' ? tab.id : null,
        style: { display: tab.display },
      }
    },
  }
}

async function testT_BI_9() {
  // Simulate main sidebar DOM with 5 built-in tabs. Notes and memory
  // have display='none' (their buttons are hidden because they are in
  // secondary). The rest have display='' (visible, in main).
  const fakeSidebar = fakeMainSidebarWithDisplay([
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
  // Expected: profile, library, calendar (notes and memory filtered out)
  assertEqual(result.length, 3, 'T-BI-9: source list has 3 tabs (notes + memory filtered out)')
  assertEqual(result[0], 'profile',  'T-BI-9: first tab is profile')
  assertEqual(result[1], 'library',  'T-BI-9: second tab is library')
  assertEqual(result[2], 'calendar', 'T-BI-9: third tab is calendar (notes was in position 2, memory in position 4 — both filtered)')
  assert(result.indexOf('notes') === -1,  'T-BI-9: notes (display=none) is filtered out of source list')
  assert(result.indexOf('memory') === -1, 'T-BI-9: memory (display=none) is filtered out of source list')
}

// =====================================================================
// T-ACT-drag: activateDestination=false skips Part C; source neighbor still runs
// =====================================================================
async function testT_ACT_drag_skip_dest() {
  const { hooks, state } = buildHooks({
    activePrimary: (tabId) => tabId === 'tab-C',
    mainBtnTabId: 'tab-B',
  })
  await runHandoff({
    tabId: 'tab-C',
    source: 'primary',
    destination: 'secondary',
    sourceList: ['tab-A', 'tab-B', 'tab-C', 'tab-D'],
    activateDestination: false,
    _testHooks: hooks,
  })
  assertEqual(state.activatePrimaryCalls[0], 'tab-B', 'T-ACT-drag: source neighbor still activated')
  assertEqual(state.secondaryTabIdSetTo, null, 'T-ACT-drag: destination NOT activated (drag path)')
  assertEqual(state.activatePrimaryCalls.length, 1, 'T-ACT-drag: only source activate, not dest in primary')
}

// =====================================================================
// Run all tests
// =====================================================================

async function main() {
  await testT_ACT_1a()
  await testT_ACT_1b()
  await testT_ACT_1c()
  await testT_ACT_1d()
  await testT_ACT_2a()
  await testT_ACT_2b()
  await testT_ACT_2c()
  await testT_ACT_2d()
  await testT_ACT_3a()
  await testT_ACT_3b()
  await testT_ACT_3c()
  await testT_ACT_4a()
  await testT_ACT_4b()
  await testT_ACT_4c()
  await testT_BI_1()
  await testT_BI_2()
  await testT_BI_3()
  await testT_BI_4()
  await testT_BI_5()
  await testT_BI_6()
  await testT_BI_7()
  await testT_BI_8()
  await testT_BI_9()
  await testT_ACT_drag_skip_dest()

  if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
  console.log(`PASS: ${passed}`)
}

main()
