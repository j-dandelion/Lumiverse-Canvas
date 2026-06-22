// Tests for secondary-drawer spec violation fix — verifies that
// unassignFromSecondary no longer double-activates neighbors.
//
// Custom assertion harness. Run with: bun run src/tabs/__tests__/secondary-drawer-wiring.test.ts

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

import { getTabAssignments } from '../assignment'
import { __setSecondaryWrapperForTest } from '../../sidebar/secondary'
import { getActiveSecondaryTabId, setActiveSecondaryTabId } from '../active-tab'

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
  const { unassignFromSecondary } = await import('../../sidebar/secondary-drawer')
  await unassignFromSecondary('tab-B')
  assertEqual(getActiveSecondaryTabId(), 'tab-A',
    'T1: active secondary tab unchanged after non-active removal')
  assert(!getTabAssignments().has('tab-B'),
    'T1: tab-B removed from assignments')
}

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
  setActiveSecondaryTabId('tab-Y')
  const { unassignFromSecondary } = await import('../../sidebar/secondary-drawer')
  await unassignFromSecondary('tab-Y')
  assertEqual(getActiveSecondaryTabId(), null,
    'T2: active tab set to null after active removal')
  setActiveSecondaryTabId('tab-X')
  await unassignFromSecondary('tab-Z')
  assertEqual(getActiveSecondaryTabId(), 'tab-X',
    'T2: active tab unchanged after non-active removal')
}

async function main() {
  await testT1()
  await testT2()
  if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
  console.log(`PASS: ${passed}`)
}

main()
