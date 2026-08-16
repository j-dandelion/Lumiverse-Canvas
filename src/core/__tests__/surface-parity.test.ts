// Invariant 18: DnD, Configure, and right-click share one move reduction.
//
// 2026-07-30 decision: right-click is intentionally **quiet** like DnD and
// Configure. `activateDest` is `false` for all three surfaces; the
// destination does not get auto-activated. The original plan (rewrite §4.2
// and invariant 18) said right-click should set `activateDest: true`; that
// was reverted in
// docs/compose/plans/2026-07-29-canvas-rewrite-fixes.md §1. This file
// documents the new contract.
//
// Task 8 rewrite: instead of calling `reduce()` three times with only
// `activateDest` varying, we now exercise the three producer call sites
// end-to-end (right-click → `dispatchMoveByLiveId`, DnD and Configure →
// `commitDraftToOwnedModel`) against a shared host/model fixture. The
// resulting owned models must be identical across all three surfaces for
// the same logical move.
import { builtinKey, createEmptyModel, type LayoutModel, type TabKey, type Side } from '../model'
import { reduce } from '../reduce'
import type { LiveTab, ObservedWorld, DrawerSide } from '../model'
import type { Intent } from '../intents'
import type { HostPort, LiveTabId } from '../../host/port'
import { bootstrap, shutdown, dispatchMoveByLiveId, getModel } from '../../recon/dispatch'
import { commitDraftToOwnedModel } from '../../tabs/owned-commit'
import type { ConfigureDraft } from '../../tabs/configure-model'

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

// ── Shared host/model fixture ──────────────────────────────────────────
//
// Hosts are stateful in the dispatch layer (bootstrap pins _host, then
// _model is mutated by dispatch). Each test that calls `bootstrap` must
// call `shutdown` first to bump the generation and clear references, so
// successive tests start from a clean slate.

interface LiveTabSeed {
  key: TabKey
  liveId: string
  location: Side
  activeInPrimary?: boolean
  activeInSecondary?: boolean
  hidden?: boolean
}

function makeLiveTab(seed: LiveTabSeed): LiveTab {
  return {
    key: seed.key,
    liveId: seed.liveId as LiveTabId,
    isBuiltin: true,
    location: seed.location,
    isHidden: seed.hidden ?? false,
    isActiveInPrimary: seed.activeInPrimary ?? false,
    isActiveInSecondary: seed.activeInSecondary ?? false,
    hasContentRoot: true,
  }
}

class ParityHost implements HostPort {
  tabs: LiveTab[]
  resolveMap: Map<TabKey, LiveTabId>
  findKeyMap: Map<LiveTabId, TabKey>

  constructor(seeds: LiveTabSeed[]) {
    this.tabs = seeds.map(makeLiveTab)
    this.resolveMap = new Map(seeds.map(s => [s.key, s.liveId as LiveTabId]))
    this.findKeyMap = new Map(seeds.map(s => [s.liveId as LiveTabId, s.key]))
  }

  observe(): ObservedWorld {
    return {
      tabs: this.tabs.map(t => ({
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
    return this.resolveMap.get(key) ?? null
  }

  findKey(id: LiveTabId): TabKey | null {
    return this.findKeyMap.get(id) ?? null
  }

  async placeTab(id: LiveTabId, to: Side): Promise<{ placed: boolean }> {
    const tab = this.tabs.find(t => t.liveId === id)
    if (tab) {
      tab.location = to
      tab.isActiveInPrimary = to === 'primary' ? tab.isActiveInPrimary : false
      tab.isActiveInSecondary = to === 'secondary' ? tab.isActiveInSecondary : false
    }
    return { placed: true }
  }

  async setOrder(side: Side, ids: LiveTabId[]): Promise<'ok'> {
    const order = new Set(ids)
    const filtered = this.tabs.filter(t => t.location === side)
    for (const t of filtered) {
      if (!order.has(t.liveId)) t.location = side === 'primary' ? 'secondary' : 'primary'
    }
    return 'ok'
  }

  async setHidden(_side: Side, _ids: LiveTabId[]): Promise<'ok'> {
    return 'ok'
  }

  async activate(side: Side, id: LiveTabId): Promise<'ok'> {
    for (const t of this.tabs) {
      if (side === 'primary') t.isActiveInPrimary = t.liveId === id
      else t.isActiveInSecondary = t.liveId === id
    }
    return 'ok'
  }

  async setDrawer(_side: Side, _state: { open: boolean; width: number }): Promise<'ok'> {
    return 'ok'
  }

  async setSide(_side: DrawerSide): Promise<'ok'> {
    return 'ok'
  }

  onWorldChanged(_cb: () => void): () => void {
    return () => {}
  }
}

function baseSeeds(): LiveTabSeed[] {
  return [
    { key: A, liveId: 'h:a', location: 'primary' },
    { key: B, liveId: 'h:b', location: 'primary', activeInPrimary: true },
    { key: C, liveId: 'h:c', location: 'primary' },
    { key: D, liveId: 'h:d', location: 'secondary', activeInSecondary: true },
  ]
}

function baseModel(): LayoutModel {
  return {
    ...createEmptyModel(),
    primary: [A, B, C],
    secondary: [D],
    hidden: [],
    active: { primary: B, secondary: D },
  }
}

function project(model: LayoutModel | null): string {
  if (!model) return 'null'
  return JSON.stringify({
    primary: model.primary,
    secondary: model.secondary,
    hidden: model.hidden,
    activePrimary: model.active.primary,
    activeSecondary: model.active.secondary,
  })
}

// ── Pure reducer parity (regression for the original test) ──────────────

function testReducerParity(): void {
  const base = baseModel()
  const dnd = reduce(base, { t: 'move', key: B, to: 'secondary', index: 0, activateDest: false })
  const configure = reduce(base, { t: 'move', key: B, to: 'secondary', index: 0, activateDest: false })
  const rightClick = reduce(base, { t: 'move', key: B, to: 'secondary', index: 0, activateDest: false })

  assertEqual(project(dnd), project(configure), '18a: DnD and Configure reducer models are identical')
  assertEqual(project(dnd), project(rightClick), '18a-rclick: right-click reducer is also quiet (matches DnD/Configure)')
  assertEqual(dnd.active.secondary, D, '18b: quiet move preserves destination active tab')
  assertEqual(rightClick.active.secondary, D, '18b-rclick: right-click (quiet) also preserves destination active')
  assertEqual(dnd.active.primary, A, '18d: all surfaces use the same source handoff')
  assertEqual(configure.active.primary, dnd.active.primary, '18e: Configure uses the same source handoff')
  assertEqual(rightClick.active.primary, dnd.active.primary, '18f: right-click uses the same source handoff')
}

function testReducerInactiveParity(): void {
  const base = baseModel()
  const quiet = reduce(base, { t: 'move', key: A, to: 'secondary', index: 1, activateDest: false })
  const rightClick = reduce(base, { t: 'move', key: A, to: 'secondary', index: 1, activateDest: false })

  assertEqual(quiet.active.primary, B, '18g: quiet inactive move preserves source active')
  assertEqual(quiet.active.secondary, D, '18h: quiet inactive move preserves destination active')
  assertEqual(rightClick.active.primary, B, '18i: right-click (quiet) inactive move preserves source active')
  assertEqual(rightClick.active.secondary, D, '18j: right-click (quiet) inactive move does NOT activate destination')
  assertEqual(JSON.stringify(quiet.primary), JSON.stringify(rightClick.primary), '18k: inactive surfaces preserve source order')
  assertEqual(JSON.stringify(quiet.secondary), JSON.stringify(quiet.secondary), '18l: inactive surfaces preserve destination order')
}

// ── Producer parity (Task 8) ───────────────────────────────────────────
//
// These tests drive the three producer call sites end-to-end. The host
// starts in a state matching `baseModel()`; after each producer runs the
// same logical move ("move B from primary to secondary at visible index
// 0"), the owned models must match.

function makeDraftAfterMoveB(seeds: LiveTabSeed[]): ConfigureDraft {
  return {
    drawerSide: 'left',
    primaryIds: seeds.filter(s => s.location === 'primary' && s.key !== B).map(s => s.liveId),
    secondaryIds: [...seeds.filter(s => s.location === 'secondary').map(s => s.liveId), 'h:b'],
    builtinOrder: ['h:a', 'h:b', 'h:c'],
    extensionOrder: [],
    hiddenIds: new Set(),
  }
}

async function testRightClickMove(): Promise<void> {
  shutdown()
  const seeds = baseSeeds()
  const host = new ParityHost(seeds)
  bootstrap(baseModel(), host)
  await dispatchMoveByLiveId('h:b', false)
  const result = getModel()
  assert(result !== null, '18p-rclick: right-click produced a model')
  if (result) {
    assertEqual(result.primary.join(','), [A, C].join(','), '18p-rclick.a: B removed from primary')
    assertEqual(result.secondary.join(','), [D, B].join(','), '18p-rclick.b: B appended to secondary')
    assertEqual(result.active.primary, A, '18p-rclick.c: source active handoff to A')
    assertEqual(result.active.secondary, D, '18p-rclick.d: destination active unchanged (quiet)')
  }
}

async function testDndMove(): Promise<void> {
  shutdown()
  const seeds = baseSeeds()
  const host = new ParityHost(seeds)
  bootstrap(baseModel(), host)
  const draft = makeDraftAfterMoveB(seeds)
  const result = await commitDraftToOwnedModel(draft)
  assertEqual(result.ok, true, '18p-dnd: DnD commit returned ok')
  const model = getModel()
  assert(model !== null, '18p-dnd: DnD produced a model')
  if (model) {
    assertEqual(model.primary.join(','), [A, C].join(','), '18p-dnd.a: B removed from primary')
    assertEqual(model.secondary.join(','), [D, B].join(','), '18p-dnd.b: B appended to secondary')
    assertEqual(model.active.primary, A, '18p-dnd.c: source active handoff to A')
    assertEqual(model.active.secondary, D, '18p-dnd.d: destination active unchanged (quiet)')
  }
}

async function testConfigureMove(): Promise<void> {
  shutdown()
  const seeds = baseSeeds()
  const host = new ParityHost(seeds)
  bootstrap(baseModel(), host)
  const draft = makeDraftAfterMoveB(seeds)
  const result = await commitDraftToOwnedModel(draft)
  assertEqual(result.ok, true, '18p-cfg: Configure commit returned ok')
  const model = getModel()
  assert(model !== null, '18p-cfg: Configure produced a model')
  if (model) {
    assertEqual(model.primary.join(','), [A, C].join(','), '18p-cfg.a: B removed from primary')
    assertEqual(model.secondary.join(','), [D, B].join(','), '18p-cfg.b: B appended to secondary')
    assertEqual(model.active.primary, A, '18p-cfg.c: source active handoff to A')
    assertEqual(model.active.secondary, D, '18p-cfg.d: destination active unchanged (quiet)')
  }
}

async function testProducerParity(): Promise<void> {
  // Run all three producers against the same fixture and compare the
  // resulting owned models. This is the headline assertion the old
  // test could not make: the three producer call sites emit the same
  // final state for the same logical move.
  shutdown()
  const seedsRclick = baseSeeds()
  const rclickHost = new ParityHost(seedsRclick)
  bootstrap(baseModel(), rclickHost)
  await dispatchMoveByLiveId('h:b', false)
  const rclickModel = getModel()

  shutdown()
  const seedsDnd = baseSeeds()
  const dndHost = new ParityHost(seedsDnd)
  bootstrap(baseModel(), dndHost)
  await commitDraftToOwnedModel(makeDraftAfterMoveB(seedsDnd))
  const dndModel = getModel()

  shutdown()
  const seedsCfg = baseSeeds()
  const cfgHost = new ParityHost(seedsCfg)
  bootstrap(baseModel(), cfgHost)
  await commitDraftToOwnedModel(makeDraftAfterMoveB(seedsCfg))
  const cfgModel = getModel()

  assertEqual(project(rclickModel), project(dndModel), '18p: right-click and DnD produce identical models')
  assertEqual(project(dndModel), project(cfgModel), '18p: DnD and Configure produce identical models')
  assertEqual(project(rclickModel), project(cfgModel), '18p: right-click and Configure produce identical models')
}

async function testReorderCommitPreservesSecondary(): Promise<void> {
  // 2026-07-31: the draft layer built secondaryIds from the TabKey-keyed
  // assignment facade, which misses every liveId lookup — the list came
  // back EMPTY, so every DnD/Configure commit swept the model's secondary
  // tabs back into primary (and same-list secondary reorders aborted with
  // "tab not found in draft"). With the liveId projection (getLiveId
  // Assignments) the draft carries the secondary tabs; committing a
  // reorder-only draft must leave the model untouched.
  shutdown()
  const seeds = baseSeeds()
  const host = new ParityHost(seeds)
  bootstrap(baseModel(), host)
  const draft: ConfigureDraft = {
    drawerSide: 'left',
    primaryIds: ['h:a', 'h:b', 'h:c'],
    secondaryIds: ['h:d'],
    builtinOrder: ['h:a', 'h:b', 'h:c', 'h:d'],
    extensionOrder: [],
    hiddenIds: new Set(),
  }
  const result = await commitDraftToOwnedModel(draft)
  assertEqual(result.ok, true, '18q: reorder-only commit succeeds')
  const model = getModel()
  assert(model !== null, '18q: model present after commit')
  if (model) {
    assertEqual(model.secondary.join(','), [D].join(','), '18q.a: secondary tab preserved through reorder commit')
    assertEqual(model.primary.join(','), [A, B, C].join(','), '18q.b: primary order preserved')
  }
}

async function testSecondaryActiveHandoffCommit(): Promise<void> {
  // 2026-07-31: moving the second drawer's ACTIVE tab out (Configure / DnD)
  // must converge model.active.secondary to the replacement — nearest
  // visible neighbor — even when the model's active.secondary lags the
  // drawer's tracked active (secondary clicks don't produce host-syncs; the
  // commit uses the OBSERVED active, passed as activeAtGestureStart). The
  // drawer chrome side (activation of the replacement) is live-verified;
  // the model convergence is proven here.
  shutdown()
  const B = builtinKey('b')
  const seeds: LiveTabSeed[] = [
    { key: A, liveId: 'h:a', location: 'primary', activeInPrimary: true },
    { key: B, liveId: 'h:b', location: 'secondary' },
    { key: D, liveId: 'h:d', location: 'secondary', activeInSecondary: true },
  ]
  const host = new ParityHost(seeds)
  // Stale model active (A, a primary tab) — the drawer's tracked active is
  // D, which is what the gesture captures.
  bootstrap({
    ...createEmptyModel(),
    primary: [A],
    secondary: [B, D],
    hidden: [],
    active: { primary: A, secondary: A },
  }, host)
  const draft: ConfigureDraft = {
    drawerSide: 'left',
    primaryIds: ['h:a', 'h:d'],
    secondaryIds: ['h:b'],
    builtinOrder: ['h:a', 'h:d', 'h:b'],
    extensionOrder: [],
    hiddenIds: new Set(),
  }
  const result = await commitDraftToOwnedModel(draft, { primary: A, secondary: D })
  assertEqual(result.ok, true, '18r: secondary-active commit succeeds')
  const model = getModel()
  assert(model !== null, '18r: model present after commit')
  if (model) {
    assertEqual(model.secondary.join(','), [B].join(','), '18r.a: moved tab removed from secondary')
    assertEqual(model.active.secondary, B, '18r.b: secondary active converges to the neighbor above (even with a stale model)')
    assertEqual(model.primary.join(','), [A, D].join(','), '18r.c: moved tab appended to primary')
  }
}

testReducerParity()
testReducerInactiveParity()
await testRightClickMove()
await testDndMove()
await testConfigureMove()
await testProducerParity()
await testReorderCommitPreservesSecondary()
await testSecondaryActiveHandoffCommit()

console.log(`core/surface-parity: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exitCode = 1
  process.exit(1)
}
