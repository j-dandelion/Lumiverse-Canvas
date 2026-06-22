// Tests for tab mobility wiring changes — verifies the spec violation fix
// in unassignFromSecondary and the extension-path wiring in assignTab.
//
// Custom assertion harness — matches src/tabs/__tests__/activation-handoff.test.ts
// Run with: bun run src/tabs/__tests__/assign-tab-wiring.test.ts
//
// Scope: This file tests behaviors that can be verified in isolation.
// Full end-to-end integration tests (assignTab → assignToSecondary →
// runHandoff, and the double-activation race) would require extensive DOM
// stubs (contains, querySelector, querySelectorAll, MutationObserver, etc.)
// and are deferred until a more robust test harness is available.

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
;(globalThis as any).getComputedStyle = () => ({ display: '' })
;(globalThis as any).document = {
  querySelector(_sel: string) { return null },
  querySelectorAll(_sel: string) { return [] },
  body: { appendChild(_child: unknown) {} },
}
;(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
  setTimeout(() => cb(performance.now()), 0)
  return 0
}
;(globalThis as any).MutationObserver = class {
  observe() {}
  disconnect() {}
}
;(globalThis as any).HTMLElement = class {}
;(globalThis as any).CSS = {
  escape(s: string) { return s.replace(/([^\w-])/g, '\\$1') },
}

// =====================================================================
// Imports (after DOM stubs)
// =====================================================================

import { getTabAssignments } from '../assignment'
import { __setSecondaryWrapperForTest } from '../../sidebar/secondary'
import { getActiveSecondaryTabId, setActiveSecondaryTabId } from '../active-tab'

// =====================================================================
// Fake secondary wrapper
// =====================================================================

let _tabListButtons: Array<{ tabId: string; title: string }> = []

function buildFakeSecondaryWrapper() {
  const buttonObjs = _tabListButtons.map(b => {
    const classes = new Set<string>()
    return {
      _attrs: { 'data-tab-id': b.tabId, title: b.title } as Record<string, string>,
      getAttribute(name: string) { return this._attrs[name] ?? null },
      setAttribute(name: string, value: string) { this._attrs[name] = value },
      removeAttribute(name: string) { delete this._attrs[name] },
      style: { display: '', color: '', background: '', boxShadow: '', borderRadius: '' },
      classList: {
        toggle(cls: string, force?: boolean) {
          if (force === undefined ? !classes.has(cls) : force) classes.add(cls)
          else classes.delete(cls)
        },
        contains(cls: string) { return classes.has(cls) },
      },
      click() {},
      textContent: b.title,
      parentElement: null,
      querySelector(_sel: string) { return null },
    }
  })
  return {
    querySelectorAll(sel: string): any {
      if (sel === '.sidebar-ux-tab-list button[data-tab-id]') return buttonObjs
      if (sel === '.sidebar-ux-tab-list') return buttonObjs
      return []
    },
    querySelector(sel: string): any {
      if (sel === '.sidebar-ux-tab-list') return {
        querySelectorAll(_s: string) { return buttonObjs },
      }
      return null
    },
  }
}

// =====================================================================
// T1: unassignFromSecondary does NOT activate neighbor when moved tab
//     was non-active (spec violation fix — removed else block)
// =====================================================================
//
// Before the fix, unassignFromSecondary unconditionally called
// showSecondaryTab(nextTabId) when there were remaining secondary
// tabs, regardless of whether the moved tab was active. This violated the
// spec: non-active source moves should leave the source unchanged.
//
// After the fix, the unconditional activation is removed. The caller
// (assignment.ts) passes preMoveSourceActiveTab to runHandoff, which
// decides via Gate A whether to activate a neighbor.
async function testT1() {
  _tabListButtons = [
    { tabId: 'tab-A', title: 'Tab A' },
    { tabId: 'tab-B', title: 'Tab B' },
    { tabId: 'tab-C', title: 'Tab C' },
  ]
  __setSecondaryWrapperForTest(buildFakeSecondaryWrapper() as any)

  const { setTabAssignment } = await import('../assignment')
  setTabAssignment('tab-A', 'secondary')
  setTabAssignment('tab-B', 'secondary')
  setTabAssignment('tab-C', 'secondary')
  setActiveSecondaryTabId('tab-A')

  // Move tab-B (non-active) to primary
  const { unassignFromSecondary } = await import('../../sidebar/secondary-drawer')
  await unassignFromSecondary('tab-B')

  // After removal: tab-A should STILL be active (no neighbor activation)
  assertEqual(getActiveSecondaryTabId(), 'tab-A',
    'T1: active secondary tab unchanged after non-active removal')

  // tab-B should no longer be in assignments
  assert(!getTabAssignments().has('tab-B'),
    'T1: tab-B removed from assignments')
}

// =====================================================================
// T2: unassignFromSecondary with active moved tab does not double-activate
//     (verifies the showSecondaryTab(null) guard)
// =====================================================================
//
// After the fix, showSecondaryTab(null) is only called when the
// moved tab WAS the active secondary tab. For non-active moves, the
// active tab is preserved. This test verifies both branches.
async function testT2() {
  _tabListButtons = [
    { tabId: 'tab-X', title: 'Tab X' },
    { tabId: 'tab-Y', title: 'Tab Y' },
    { tabId: 'tab-Z', title: 'Tab Z' },
  ]
  __setSecondaryWrapperForTest(buildFakeSecondaryWrapper() as any)

  const { setTabAssignment } = await import('../assignment')
  setTabAssignment('tab-X', 'secondary')
  setTabAssignment('tab-Y', 'secondary')
  setTabAssignment('tab-Z', 'secondary')
  setActiveSecondaryTabId('tab-Y') // tab-Y is active

  const { unassignFromSecondary } = await import('../../sidebar/secondary-drawer')

  // Move tab-Y (active) to primary — showSecondaryTab(null) is called
  // (the guard allows it when moved tab === active tab)
  await unassignFromSecondary('tab-Y')
  assertEqual(getActiveSecondaryTabId(), null,
    'T2: active tab set to null after active removal (caller will set neighbor via runHandoff)')

  // Reset for second sub-test
  setActiveSecondaryTabId('tab-X')
  await unassignFromSecondary('tab-Z') // tab-Z is non-active

  // tab-X should STILL be active (non-active removal doesn't touch active)
  assertEqual(getActiveSecondaryTabId(), 'tab-X',
    'T2: active tab unchanged after non-active removal (no double-activation)')
}

// =====================================================================
// T3: Extension path calls runHandoff (structural verification)
// =====================================================================
//
// This test verifies that the extension branch in assignTab includes
// the runHandoff call. We read the file and check for the expected
// code structure. This is a structural test, not a runtime test —
// runtime testing requires extensive DOM stubs (deferred).
async function testT3() {
  const { readFileSync } = await import('fs')
  const { join } = await import('path')
  const assignmentPath = join(process.cwd(), 'src/tabs/assignment.ts')
  const src = readFileSync(assignmentPath, 'utf-8')

  // The extension branch (after the built-in if block) should capture
  // preMoveSourceList and preMoveActiveTab, then call runHandoff.
  const hasCaptureSourceList = src.includes("captureSourceList('primary')") &&
    src.match(/captureSourceList\('primary'\)/g)!.length >= 2 // built-in + extension
  const hasIsTabActiveInMainDrawer = src.includes('isTabActiveInMainDrawer(tabId)') &&
    src.match(/isTabActiveInMainDrawer\(tabId\)/g)!.length >= 2 // built-in + extension
  const hasRunHandoffExtension = src.includes("source: 'primary', destination: 'secondary'") &&
    src.match(/source: 'primary', destination: 'secondary'/g)!.length >= 2 // built-in + extension

  assert(hasCaptureSourceList,
    'T3: extension path captures preMoveSourceList via captureSourceList("primary")')
  assert(hasIsTabActiveInMainDrawer,
    'T3: extension path captures preMoveActiveTab via isTabActiveInMainDrawer(tabId)')
  assert(hasRunHandoffExtension,
    'T3: extension path calls runHandoff with source=primary, destination=secondary')
}

// =====================================================================
// T4: Spec violation block is removed from unassignFromSecondary
// =====================================================================
//
// The unconditional neighbor activation block (the `else` clause that
// walked _tabAssignments and called showSecondaryTab) should be
// gone. We verify by reading the file.
async function testT4() {
  const { readFileSync } = await import('fs')
  const { join } = await import('path')
  const path = join(process.cwd(), 'src/sidebar/secondary-drawer.ts')
  const src = readFileSync(path, 'utf-8')

  // The old block had: "for (const [assignedId] of _tabAssignments)"
  // walking the map and calling showSecondaryTab unconditionally.
  // After the fix, this block is removed. The showSecondaryTab
  // call is now guarded by getActiveSecondaryTabId() === tabId.
  const hasUnconditionalWalk = src.includes('for (const [assignedId] of _tabAssignments)') &&
    src.match(/showSecondaryTabDisplay\(assignedId\)/g) !== null
  assert(!hasUnconditionalWalk,
    'T4: unconditional _tabAssignments walk + showSecondaryTabDisplay is removed')

  // The new guard should exist
  const hasGuardedCall = src.includes('if (getActiveSecondaryTabId() === tabId)') &&
    src.includes('showSecondaryTabDisplay(null as any)')
  assert(hasGuardedCall,
    'T4: showSecondaryTabDisplay(null) is guarded by getActiveSecondaryTabId() === tabId')
}

// =====================================================================
// Run all tests
// =====================================================================
async function main() {
  await testT1()
  await testT2()
  await testT3()
  await testT4()

  if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
  console.log(`PASS: ${passed}`)
}

main()
