// Pitfall regression tests for tabs/assignment.ts facade (Task 10.3).
//
// The legacy tabs/assignment.ts module used to own a private
// `_tabAssignments` Map as the source of truth for tab placement. The
// owned model (LayoutModel in src/core/model.ts) replaces it. This
// test suite proves the facade behavior:
//
// 1. When the owned model is active, reads derive from the model.
// 2. When the owned model is active, writes are no-ops (the model
//    handles placement via dispatch).
// 3. When the owned model is NOT active (tests, setup before
//    bootstrap), the legacy in-memory map is used as before.
//
// This eliminates the dual-writer risk: the owned model is the only
// writer in production.
import {
  builtinKey,
  extensionKey,
  createEmptyModel,
  type LayoutModel,
  type TabKey,
} from '../../core/model'
import { bootstrap, shutdown, getModel } from '../../recon/dispatch'
import type { HostPort, LiveTabId, ObservedWorld } from '../../host/port'
import type { LiveTab, DrawerSide } from '../../core/model'
import {
  getTabAssignments,
  setTabAssignment,
  deleteTabAssignment,
  hasTabAssignment,
  clearTabAssignments,
  getTabSidebar,
  getLiveIdAssignments,
  hasSecondaryAssignedTabs,
} from '../assignment'

let passed = 0
let failed = 0

function assert(condition: unknown, message: string): void {
  if (condition) passed++
  else {
    failed++
    console.error('FAIL:', message)
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  assert(actual === expected, `${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

const A = builtinKey('a')
const B = builtinKey('b')
const C = builtinKey('c')
const D = builtinKey('d')

// ── Legacy map behavior (no owned model) ───────────────────────────────

function testLegacyMapWithoutModel(): void {
  // Without bootstrap, the facade falls back to the in-memory map.
  // This is the path used by tests that set up legacy state before
  // bootstrap.
  setTabAssignment('legacy-1', 'secondary')
  setTabAssignment('legacy-2', 'primary')
  assertEqual(getTabSidebar('legacy-1'), 'secondary', 'L1: legacy set→get round-trip')
  assertEqual(getTabSidebar('legacy-2'), 'primary', 'L2: legacy primary round-trip')
  assert(hasTabAssignment('legacy-1'), 'L3: hasTabAssignment after legacy set')
  assert(hasSecondaryAssignedTabs(), 'L4: hasSecondaryAssignedTabs true with secondary')
  deleteTabAssignment('legacy-1')
  assert(!hasTabAssignment('legacy-1'), 'L5: deleteTabAssignment removes entry')
  clearTabAssignments()
  assert(!hasTabAssignment('legacy-2'), 'L6: clearTabAssignments removes all')
  assert(!hasSecondaryAssignedTabs(), 'L7: hasSecondaryAssignedTabs false after clear')
}

// ── Facade behavior with owned model active ────────────────────────────

class TestHost implements HostPort {
  private _tabs: LiveTab[]

  constructor(tabs: LiveTab[]) {
    this._tabs = tabs
  }

  observe(): ObservedWorld {
    return {
      tabs: this._tabs.map(t => ({
        key: t.key,
        liveId: t.liveId,
        isBuiltin: t.isBuiltin,
        location: t.location,
        isHidden: t.isHidden,
        isActiveInPrimary: t.isActiveInPrimary,
        isActiveInSecondary: t.isActiveInSecondary,
        hasContentRoot: t.hasContentRoot,
      })),
      drawerSide: 'left' as DrawerSide,
      primaryOpen: true,
      primaryWidth: 320,
      secondaryOpen: true,
      secondaryWidth: 320,
    }
  }

  resolve(key: TabKey): LiveTabId | null { return key }
  findKey(id: LiveTabId): TabKey | null { return id }
  async placeTab(): Promise<{ placed: boolean }> { return { placed: true } }
  async setOrder(): Promise<'ok'> { return 'ok' }
  async setHidden(): Promise<'ok'> { return 'ok' }
  async activate(): Promise<'ok'> { return 'ok' }
  async setDrawer(): Promise<'ok'> { return 'ok' }
  async setSide(): Promise<'ok'> { return 'ok' }
  onWorldChanged(): () => void { return () => {} }
}

function makeTab(key: TabKey, liveId: string, location: 'primary' | 'secondary'): LiveTab {
  return {
    key,
    liveId: liveId as LiveTabId,
    isBuiltin: true,
    location,
    isHidden: false,
    isActiveInPrimary: false,
    isActiveInSecondary: false,
    hasContentRoot: true,
  }
}

function makeModel(primary: TabKey[], secondary: TabKey[]): LayoutModel {
  return {
    ...createEmptyModel(),
    primary,
    secondary,
    hidden: [],
    active: { primary: primary[0] ?? null, secondary: secondary[0] ?? null },
  }
}

function testFacadeReadsFromModel(): void {
  shutdown()
  const host = new TestHost([
    makeTab(A, 'a', 'primary'),
    makeTab(B, 'b', 'primary'),
    makeTab(C, 'c', 'secondary'),
  ])
  bootstrap(makeModel([A, B], [C]), host)

  // Reads derive from the owned model.
  const assignments = getTabAssignments()
  assertEqual(assignments.get(A), 'primary', 'M1: primary tab in model → primary in facade')
  assertEqual(assignments.get(B), 'primary', 'M2: second primary tab in facade')
  assertEqual(assignments.get(C), 'secondary', 'M3: secondary tab in model → secondary in facade')
  assertEqual(assignments.size, 3, 'M4: facade map has exactly the model tabs')
  assert(hasTabAssignment(A), 'M5: hasTabAssignment true for model tab')
  assertEqual(getTabSidebar(A), 'primary', 'M6: getTabSidebar reads from model')
  assertEqual(getTabSidebar(C), 'secondary', 'M7: getTabSidebar secondary from model')
  assert(hasSecondaryAssignedTabs(), 'M8: hasSecondaryAssignedTabs true when model has secondary')
  assert(getModel() !== null, 'M9: model is active during test')
}

function testFacadeWritesAreNoOps(): void {
  shutdown()
  const host = new TestHost([
    makeTab(A, 'a', 'primary'),
    makeTab(B, 'b', 'primary'),
  ])
  bootstrap(makeModel([A, B], []), host)

  // Writes to the facade are no-ops when the model is active.
  setTabAssignment(A, 'secondary')
  setTabAssignment(D, 'secondary')
  deleteTabAssignment(A)
  clearTabAssignments()

  // Model is unchanged.
  const model = getModel()
  assert(model !== null, 'N1: model still active after facade writes')
  if (model) {
    assertEqual(model.primary.length, 2, 'N2: model primary unchanged after setTabAssignment')
    assertEqual(model.secondary.length, 0, 'N3: model secondary unchanged after setTabAssignment')
    assert(model.primary.includes(A), 'N4: A still in primary after deleteTabAssignment')
    assert(!model.primary.includes(D), 'N5: D not added to model after setTabAssignment')
  }
  // Reads still reflect the model, not the no-op writes.
  assertEqual(getTabSidebar(A), 'primary', 'N6: getTabSidebar still reads from model')
  assert(!hasSecondaryAssignedTabs(), 'N7: hasSecondaryAssignedTabs false (model has no secondary)')
}

function testFacadeIsSnapshot(): void {
  // The Map returned by getTabAssignments is a snapshot — mutations
  // to it do not affect the model.
  shutdown()
  const host = new TestHost([makeTab(A, 'a', 'primary')])
  bootstrap(makeModel([A], []), host)
  const map = getTabAssignments()
  map.set(A, 'secondary')
  map.set('rogue', 'secondary')
  // Re-read: model is unchanged.
  const map2 = getTabAssignments()
  assertEqual(map2.get(A), 'primary', 'S1: model unchanged after mutating facade snapshot')
  assert(!map2.has('rogue'), 'S2: rogue entry not persisted')
}

testLegacyMapWithoutModel()
testFacadeReadsFromModel()
testFacadeWritesAreNoOps()
testFacadeIsSnapshot()

// ── LiveId resolution (2026-07-31) ─────────────────────────────────────
// The facade is TabKey-keyed, but callers hold LIVE ids: the secondary
// context menu (getTabSidebar) and the DnD/Configure draft builders.
// Without liveId → TabKey resolution, secondary tabs reported 'primary':
// the menu offered "Move to second drawer" for tabs already in the second
// drawer, and draft.secondaryIds came back empty (DnD snap-back).

class LiveIdHost implements HostPort {
  private _tabs: LiveTab[]
  private _find: Map<LiveTabId, TabKey>

  constructor(tabs: LiveTab[]) {
    this._tabs = tabs
    this._find = new Map(tabs.map(t => [t.liveId, t.key]))
  }

  observe(): ObservedWorld {
    return {
      tabs: this._tabs.map(t => ({
        key: t.key,
        liveId: t.liveId,
        isBuiltin: t.isBuiltin,
        location: t.location,
        isHidden: t.isHidden,
        isActiveInPrimary: t.isActiveInPrimary,
        isActiveInSecondary: t.isActiveInSecondary,
        hasContentRoot: t.hasContentRoot,
      })),
      drawerSide: 'left' as DrawerSide,
      primaryOpen: true,
      primaryWidth: 320,
      secondaryOpen: true,
      secondaryWidth: 320,
    }
  }

  resolve(key: TabKey): LiveTabId | null {
    return this._tabs.find(t => t.key === key)?.liveId ?? null
  }

  findKey(id: LiveTabId): TabKey | null {
    return this._find.get(id) ?? null
  }

  async placeTab(): Promise<{ placed: boolean }> { return { placed: true } }
  async setOrder(): Promise<'ok'> { return 'ok' }
  async setHidden(): Promise<'ok'> { return 'ok' }
  async activate(): Promise<'ok'> { return 'ok' }
  async setDrawer(): Promise<'ok'> { return 'ok' }
  async setSide(): Promise<'ok'> { return 'ok' }
  onWorldChanged(): () => void { return () => {} }
}

const LOOM = builtinKey('loom')
const REGEX = builtinKey('regex')
const BAR = extensionKey('foo', 'Bar')

const liveTabs = [
  { tabId: 'loom', extensionId: '', title: 'Loom' },
  { tabId: 'regex', extensionId: '', title: 'Regex' },
  { tabId: 'spindle:foo:tab:Bar:0', extensionId: 'foo', title: 'Bar' },
]

function testLiveIdResolution(): void {
  shutdown()
  const host = new LiveIdHost([
    makeTab(LOOM, 'loom', 'primary'),
    makeTab(REGEX, 'regex', 'secondary'),
    makeTab(BAR, 'spindle:foo:tab:Bar:0', 'secondary'),
  ])
  bootstrap(makeModel([LOOM], [REGEX, BAR]), host)

  // Bare builtin liveId resolves via the host adapter.
  assertEqual(getTabSidebar('regex'), 'secondary', 'R1: bare builtin liveId → secondary')
  assertEqual(getTabSidebar('loom'), 'primary', 'R2: bare builtin liveId → primary')
  assert(hasTabAssignment('regex'), 'R3: hasTabAssignment bare builtin liveId')
  // Extension liveId resolves via the host adapter (title lookup).
  assertEqual(getTabSidebar('spindle:foo:tab:Bar:0'), 'secondary', 'R4: extension liveId → secondary')
  assert(hasTabAssignment('spindle:foo:tab:Bar:0'), 'R5: hasTabAssignment extension liveId')
  // Suffix-drift builtin liveId the host cannot resolve → builtin: prefix
  // heuristic still lands.
  assertEqual(getTabSidebar('regex:7'), 'secondary', 'R6: suffix-drift builtin liveId → secondary')
  assert(hasTabAssignment('regex:7'), 'R7: hasTabAssignment suffix-drift liveId')
  // Unknown liveId falls back to primary (documented default).
  assertEqual(getTabSidebar('nope'), 'primary', 'R8: unknown liveId → primary')
}

function testLiveIdAssignmentsProjection(): void {
  shutdown()
  const host = new LiveIdHost([
    makeTab(LOOM, 'loom', 'primary'),
    makeTab(REGEX, 'regex', 'secondary'),
    makeTab(BAR, 'spindle:foo:tab:Bar:0', 'secondary'),
  ])
  bootstrap(makeModel([LOOM], [REGEX, BAR]), host)

  // Pass the live tab list explicitly (drawerObserver is empty headless).
  const byLiveId = getLiveIdAssignments(liveTabs)
  assertEqual(byLiveId.get('regex'), 'secondary', 'A1: builtin key → bare live id side')
  assertEqual(byLiveId.get('loom'), 'primary', 'A2: primary bare live id')
  assertEqual(byLiveId.get('spindle:foo:tab:Bar:0'), 'secondary', 'A3: extension key → live id')
  assertEqual(byLiveId.size, 3, 'A4: one entry per model tab (no TabKey keys leaked)')
  assert(!byLiveId.has(REGEX), 'A5: TabKey keys not present in liveId projection')
}

testLiveIdResolution()
testLiveIdAssignmentsProjection()

console.log(`tabs/assignment-facade: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exitCode = 1
  process.exit(1)
}
