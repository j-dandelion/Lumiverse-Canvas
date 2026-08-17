// Regression: moving a tab to the OTHER drawer on mobile must NOT open the
// destination drawer.
//
// The right-click "Move to second drawer" path (placementFirstMoveByLiveId,
// used by both context menus) explicitly opened the secondary drawer after
// placement with NO mobile guard — on mobile that opened the destination
// drawer (and enforceExclusionOnOpen then closed the MAIN drawer). All other
// move surfaces already gate auto-open on !isMobileViewport(): assignTab
// (tabs/assignment.ts), assignToSecondary (sidebar/secondary-drawer.ts), and
// the Configure/live-DnD quiet placement pass (openOnClosed: false).
//
// This test drives the REAL placementFirstMoveByLiveId with a FakeHost +
// real dispatch; only the dynamic-imported drawer modules are mocked so the
// open/close decision is observable.

import { mock } from 'bun:test'
// Type-only: erased at runtime, no module execution (kept separate from the
// runtime imports below so mock.module ordering is unambiguous).
import type { LiveTab } from '../../host/fake/implementation'
import type { LayoutModel, TabKey, Side } from '../../core/model'

// ── Mock state + recording spies ──
let _mobile = false
let _secondaryOpen = false
const calls: string[] = []

mock.module('../../sidebar/secondary', () => ({
  isSecondarySidebarOpen: () => _secondaryOpen,
  openSecondarySidebar: () => { calls.push('openSecondarySidebar') },
  closeSecondarySidebar: () => { calls.push('closeSecondarySidebar') },
  liveIdForFacadeKey: (k: string) => k,
  getSecondaryWrapper: () => null,
  getSecondaryTabList: () => null,
  getSecondaryDrawer: () => null,
  getSecondaryPanel: () => null,
  getClosedTransformPx: () => 0,
  SECONDARY_WIDTH_VAR: '--sidebar-ux-secondary-w',
  ensureSecondaryShellMounted: () => true,
  isSecondaryShellLive: () => true,
}))

mock.module('../../sidebar/secondary-drawer', () => ({
  assignToSecondary: async () => { calls.push('assignToSecondary') },
  unassignFromSecondary: async () => { calls.push('unassignFromSecondary') },
  activateSecondaryTab: () => { calls.push('activateSecondaryTab') },
  getActiveSecondaryTab: () => null,
  getSecondaryDrawerState: () => 'closed',
  markDrawerOpenState: () => {},
}))

mock.module('../../sidebar/mobile-exclusion', () => ({
  isMobileViewport: () => _mobile,
  isHostMobileDrawerViewport: () => _mobile,
}))

// Main-mirror pin: keep the chrome capture/apply no-ops so the test stays
// focused on the drawer-open decision (taskbar pin is desktop chrome).
mock.module('../../sidebar/main-tab-pin', () => ({
  isMainTabPinEnabled: () => false,
  getActiveMainMirrorKey: () => null,
  findNeighborHostButtonFor: () => null,
  adoptMainMirrorNeighbor: () => {},
  reconcileMainTabListPin: () => {},
}))

// No tracked secondary active → no neighbor handoff on moves out.
mock.module('../../tabs/active-tab', () => ({
  getActiveSecondaryTabId: () => null,
  setActiveSecondaryTabId: () => {},
}))

// settings/state pulls the whole feature graph (panel → registry →
// drawer-sync/tab-position/secondary). dispatch.ts only needs the mode
// layout slots — stub them so the test stays on the placement path.
mock.module('../../settings/state', () => ({
  getSingleLayoutSlot: () => null,
  getDualLayoutSlot: () => null,
  getSettings: () => ({ secondSidebarEnabled: true }),
}))

// ── Module under test (dynamic import AFTER mock.module calls) ──
const { bootstrap, shutdown, flush, getModel, placementFirstMoveByLiveId } =
  await import('../../recon/dispatch')
const { FakeHost } = await import('../../host/fake/implementation')
const { createEmptyModel, builtinKey, extensionKey } =
  await import('../../core/model')

// ── Custom assertion harness (repo convention) ──
let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed++ }
}

function makeLiveTab(key: TabKey, liveId: string, location: Side, overrides?: Partial<LiveTab>): LiveTab {
  return {
    key, liveId, location,
    hidden: false,
    activeInPrimary: false,
    activeInSecondary: false,
    hasContentRoot: true,
    isBuiltin: key.startsWith('builtin:'),
    ...overrides,
  }
}

const PROFILE = builtinKey('profile')
const A = extensionKey('ext', 'a')

function freshModel(secondary: TabKey[] = []): LayoutModel {
  return {
    ...createEmptyModel(),
    primary: [PROFILE, A],
    secondary,
    hidden: [],
    active: { primary: PROFILE, secondary: secondary[0] ?? null },
  }
}

function freshHost(secondary: boolean) {
  return new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', secondary ? 'secondary' : 'primary'),
  ])
}

// ============================================================================
// M1 — mobile, move to secondary: placement happens, drawer does NOT open
// ============================================================================
async function testMobileMoveToSecondaryDoesNotOpen() {
  _mobile = true
  _secondaryOpen = false
  calls.length = 0
  const host = freshHost(false)
  shutdown()
  bootstrap(freshModel(), host)
  await flush()

  await placementFirstMoveByLiveId('h:a', 'secondary')
  await flush()

  assert(calls.includes('assignToSecondary'), 'M1a: tab placed into the secondary drawer')
  assert(!calls.includes('openSecondarySidebar'), 'M1b: mobile — destination drawer stays closed')
  const model = getModel()
  assert(model?.secondary.includes(A) ?? false, 'M1c: model converges — A in secondary')
  assert(host.tabInSide('h:a', 'secondary'), 'M1d: host world converges — A in secondary')
  shutdown()
}

// ============================================================================
// M2 — desktop, move to secondary: placement happens AND drawer opens
// (desktop rClick behavior is preserved — the moved tab must be visible)
// ============================================================================
async function testDesktopMoveToSecondaryStillOpens() {
  _mobile = false
  _secondaryOpen = false
  calls.length = 0
  const host = freshHost(false)
  shutdown()
  bootstrap(freshModel(), host)
  await flush()

  await placementFirstMoveByLiveId('h:a', 'secondary')
  await flush()

  assert(calls.includes('assignToSecondary'), 'M2a: tab placed into the secondary drawer')
  assert(calls.includes('openSecondarySidebar'), 'M2b: desktop — drawer opens so the move is visible')
  const model = getModel()
  assert(model?.secondary.includes(A) ?? false, 'M2c: model converges — A in secondary')
  shutdown()
}

// ============================================================================
// M3 — mobile, move to secondary while the drawer is ALREADY open:
// no open call (nothing to open), move still lands
// ============================================================================
async function testMobileMoveToAlreadyOpenSecondary() {
  _mobile = true
  _secondaryOpen = true
  calls.length = 0
  const host = freshHost(false)
  shutdown()
  bootstrap(freshModel(), host)
  await flush()

  await placementFirstMoveByLiveId('h:a', 'secondary')
  await flush()

  assert(calls.includes('assignToSecondary'), 'M3a: tab placed into the secondary drawer')
  assert(!calls.includes('openSecondarySidebar'), 'M3b: already-open drawer is not re-opened')
  const model = getModel()
  assert(model?.secondary.includes(A) ?? false, 'M3c: model converges — A in secondary')
  shutdown()
}

// ============================================================================
// M4 — mobile, move to PRIMARY (out of the secondary): no drawer opens at all
// ============================================================================
async function testMobileMoveToPrimaryOpensNothing() {
  _mobile = true
  _secondaryOpen = true
  calls.length = 0
  const host = freshHost(true)
  shutdown()
  bootstrap(freshModel([A]), host)
  await flush()

  await placementFirstMoveByLiveId('h:a', 'primary')
  await flush()

  assert(calls.includes('unassignFromSecondary'), 'M4a: tab removed from the secondary drawer')
  assert(!calls.includes('openSecondarySidebar'), 'M4b: moving to primary opens nothing')
  const model = getModel()
  assert(model?.primary.includes(A) ?? false, 'M4c: model converges — A back in primary')
  assert(host.tabInSide('h:a', 'primary'), 'M4d: host world converges — A in primary')
  shutdown()
}

// ============================================================================
// Run all tests
// ============================================================================
await testMobileMoveToSecondaryDoesNotOpen()
await testDesktopMoveToSecondaryStillOpens()
await testMobileMoveToAlreadyOpenSecondary()
await testMobileMoveToPrimaryOpensNothing()

if (failed > 0) {
  console.error(`FAILED: ${failed}`)
  process.exitCode = 1
}
console.log(`PASS: ${passed}/${passed + failed}`)
