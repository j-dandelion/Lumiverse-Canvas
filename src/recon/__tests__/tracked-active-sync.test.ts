// Unified tracked-active → owned-model sync (2026-08-16).
//
// Both drawers' user activations funnel through tracked-active WRITERS, and
// those writers are the unified persistence choke points:
//
//   - secondary: setActiveSecondaryTabId (tabs/active-tab.ts) — every
//     secondary activation path (clicks, reopen, placement-with-activation,
//     handoff) writes here. The wrapper lives on document.body, outside the
//     observed subtree, so these never produce host-syncs on their own.
//   - primary (taskbar): the main-mirror activeKey commitState
//     (sidebar/main-tab-pin.ts) — mirror activations don't reliably mutate
//     the observed world, so the model's primary active lags the mirror key.
//
// Each writer fires dispatchTrackedActiveSync(), which reads BOTH tracked
// actives and dispatches ONE syncActive intent — a single round converges
// both drawers. This test drives the REAL hooks + REAL dispatch against the
// FakeHost and asserts the persisted layout follows the tracked actives
// (that is the disk value a hard refresh restores).

;(globalThis as any).document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({}),
  getElementById: () => null,
  documentElement: {
    classList: { add() {}, remove() {}, contains() { return false } },
    style: { setProperty() {}, removeProperty() {}, getPropertyValue() { return '' } },
  },
  body: { appendChild() {}, removeChild() {} },
}
;(globalThis as any).window = {
  matchMedia: () => ({ matches: false }),
  addEventListener: () => {},
  removeEventListener: () => {},
}
;(globalThis as any).requestAnimationFrame = (cb: any) => { cb(1); return 1 }
;(globalThis as any).cancelAnimationFrame = () => {}
;(globalThis as any).CSS = { escape: (s: string) => s }
;(globalThis as any).getComputedStyle = () => ({})

import { FakeHost, type LiveTab } from '../../host/fake/implementation'
import { bootstrap, shutdown, flush, getModel } from '../dispatch'
import { serializeModelToLayout } from '../../persist/layout-model'
import { createEmptyModel, builtinKey, extensionKey, type LayoutModel, type TabKey, type Side } from '../../core/model'

const PROFILE = builtinKey('profile')
const PRESETS = builtinKey('presets')
const A = extensionKey('ext', 'a')
const B = extensionKey('ext', 'b')

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

// The tracked-active hooks fire-and-forget: they await a dynamic import of
// recon/dispatch BEFORE enqueueing the sync intent, so flush() called
// immediately would drain the pre-hook queue. Give the import chain a tick,
// then drain the queue the hook enqueued onto.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function settle(): Promise<void> {
  await sleep(5)
  await flush()
  await sleep(5)
  await flush()
}

function dualHost() {
  // Builtin live ids are BARE in the real host (data-tab-id = 'profile',
  // 'presets') — the main-mirror key resolves to exactly that form.
  return new FakeHost([
    makeLiveTab(PROFILE, 'profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(PRESETS, 'presets', 'primary'),
    makeLiveTab(A, 'h:a', 'secondary', { activeInSecondary: true }),
    makeLiveTab(B, 'h:b', 'secondary'),
  ])
}

function dualModel(): LayoutModel {
  return {
    ...createEmptyModel(),
    primary: [PROFILE, PRESETS],
    secondary: [A, B],
    hidden: [],
    active: { primary: PROFILE, secondary: A },
  }
}

// ============================================================================
// T1 — the secondary tracked-active setter converges BOTH drawers
// ============================================================================
async function testSecondarySetterSync() {
  const host = dualHost()
  shutdown()
  bootstrap(dualModel(), host)
  await flush()

  // User clicks tab B in the secondary drawer: showSecondaryTab →
  // setActiveSecondaryTabId('h:b') → the hook dispatches the unified sync.
  const { setActiveSecondaryTabId } = await import('../../tabs/active-tab')
  setActiveSecondaryTabId('h:b')
  await settle()

  const after = getModel()
  assert(after != null, 'T1a: model present')
  if (after) {
    assertEqual(after.active.secondary, B, 'T1b: secondary tracked active adopted')
    assertEqual(after.active.primary, PROFILE, 'T1c: primary tracked active kept')

    // The persisted layout must carry the CLICKED tab.
    const blob = serializeModelToLayout(after, (k) => host.resolve(k), 'test-v1.0')
    assertEqual(blob.secondary!.activeTabId, 'h:b', 'T1d: persisted secondary active follows the click')
    assertEqual(blob.primary!.tabId, 'profile', 'T1e: persisted primary active unchanged')
  }

  // Same-id re-assert: no redundant round (hook gates on change).
  const ref = getModel()
  setActiveSecondaryTabId('h:b')
  await settle()
  assert(getModel() === ref, 'T1f: same-id re-assert keeps the model reference')

  // Null clears (unassign paths) are handled by the move flows — the hook
  // must not fire for them.
  setActiveSecondaryTabId(null)
  await settle()
  assert(getModel() === ref, 'T1g: null clear does not touch the model')

  shutdown()
}

// ============================================================================
// T2 — the main-mirror activeKey write (taskbar) converges the primary side
// ============================================================================
async function testMirrorKeySync() {
  const host = dualHost()
  shutdown()
  bootstrap(dualModel(), host)
  await flush()

  const {
    __setMainTabPinEnabledForTest,
    __resetMainTabPinForTest,
    adoptMainMirrorHostActivation,
  } = await import('../../sidebar/main-tab-pin')
  __setMainTabPinEnabledForTest(true)

  // User clicks the PRESETS mirror button (host twin carries data-tab-id).
  // The commitState activeKey write fires the unified sync.
  const hostBtn = {
    isConnected: true,
    getAttribute: (k: string) => (k === 'data-tab-id' ? 'presets' : 'Presets'),
  } as unknown as HTMLElement
  adoptMainMirrorHostActivation(hostBtn, 'Presets')
  await settle()

  const after = getModel()
  assert(after != null, 'T2a: model present')
  if (after) {
    assertEqual(after.active.primary, PRESETS, 'T2b: mirror tracked active adopted into primary')
    assertEqual(after.active.secondary, A, 'T2c: secondary tracked active kept')

    // The persisted layout must carry the CLICKED mirror tab.
    const blob = serializeModelToLayout(after, (k) => host.resolve(k), 'test-v1.0')
    assertEqual(blob.primary!.tabId, 'presets', 'T2d: persisted primary active follows the mirror click')
    assertEqual(blob.secondary!.activeTabId, 'h:a', 'T2e: persisted secondary active unchanged')
  }

  // Same-key write (restore echo): no redundant round.
  const ref = getModel()
  adoptMainMirrorHostActivation(hostBtn, 'Presets')
  await settle()
  assert(getModel() === ref, 'T2f: same-key mirror write keeps the model reference')

  __resetMainTabPinForTest()
  shutdown()
}

// ============================================================================
// T3 — Configure Tabs composes with the unified sync (no revert fight)
//
// Configure's commit (owned-commit) dispatches the activation batch itself:
// quiet cross-side moves (activateDest: false) + explicit neighbor handoff
// intents. The tracked-active writers don't change during the commit, so no
// sync fires mid-commit — and when the user's NEXT activation does fire the
// unified sync, it must adopt only the new click, never revert the
// Configure-chosen actives (the same guards that make stale tracked actives
// harmless).
// ============================================================================
async function testConfigureBatchComposesWithSync() {
  const host = dualHost()
  shutdown()
  bootstrap(dualModel(), host)
  await flush()

  // What Configure emits when the user moves the ACTIVE tab (PROFILE) to the
  // secondary drawer: quiet move + the source side handed to its neighbor.
  const { dispatchBatch } = await import('../dispatch')
  await dispatchBatch([
    { t: 'move', key: PROFILE, to: 'secondary', index: 1, activateDest: false },
    { t: 'activate', key: PRESETS, side: 'primary' },
  ])
  await flush()

  const afterCommit = getModel()
  assert(afterCommit != null, 'T3a: model present after Configure commit')
  if (afterCommit) {
    assertEqual(afterCommit.active.primary, PRESETS, 'T3b: Configure handed the source side to the neighbor')
    assertEqual(afterCommit.active.secondary, A, 'T3c: Configure preserved the destination active')
  }

  // The user's NEXT activation (click a secondary tab) fires the unified
  // sync: it must adopt the new click only, leaving the Configure choices.
  const { setActiveSecondaryTabId } = await import('../../tabs/active-tab')
  setActiveSecondaryTabId('h:b')
  await settle()

  const after = getModel()
  assert(after != null, 'T3d: model present after the follow-up click')
  if (after) {
    assertEqual(after.active.secondary, B, 'T3e: follow-up click adopted into secondary')
    assertEqual(after.active.primary, PRESETS, 'T3f: Configure neighbor choice survives the sync')

    const blob = serializeModelToLayout(after, (k) => host.resolve(k), 'test-v1.0')
    assertEqual(blob.primary!.tabId, 'presets', 'T3g: persisted primary active stays the Configure neighbor')
    assertEqual(blob.secondary!.activeTabId, 'h:b', 'T3h: persisted secondary active follows the follow-up click')
  }

  shutdown()
}

// ============================================================================
// T4 — drawer side flip composes with the unified active sync
//
// A side flip ("Swap drawer locations" in Configure / the Lumiverse "Drawer
// side" setting) is GEOMETRY only: `applySwapSides` flips model.side, the
// drawers move to the opposite edges, and the shell/mirror chrome remounts
// (checkSideChanged) re-asserts the SAME tracked active — no tracked-active
// CHANGE, so no sync fires and nothing can leak stale actives into a later
// round. The persisted drawerSide must follow, and the next user activation
// must still converge both drawers.
// ============================================================================
async function testSideFlipComposesWithSync() {
  const host = dualHost()
  shutdown()
  bootstrap(dualModel(), host)
  await flush()

  // Configure "Swap drawer locations": model side flips; actives untouched.
  const { dispatchBatch } = await import('../dispatch')
  await dispatchBatch([{ t: 'swapSides' }])
  await flush()

  const afterFlip = getModel()
  assert(afterFlip != null, 'T4a: model present after side flip')
  if (afterFlip) {
    assertEqual(afterFlip.side, 'right', 'T4b: drawer side flipped')
    assertEqual(afterFlip.active.primary, PROFILE, 'T4c: primary active survives the flip')
    assertEqual(afterFlip.active.secondary, A, 'T4d: secondary active survives the flip')
    const blob = serializeModelToLayout(afterFlip, (k) => host.resolve(k), 'test-v1.0')
    assertEqual(blob.drawerSide, 'right', 'T4e: persisted drawerSide follows the flip')
  }

  // A follow-up user activation still converges (the flip wrote no tracked
  // actives, so no stale state can leak into the next sync). Reset the
  // tracked secondary first — T3 left it at 'h:b', which would make this
  // "click" a same-value no-op.
  const { setActiveSecondaryTabId } = await import('../../tabs/active-tab')
  setActiveSecondaryTabId(null)
  setActiveSecondaryTabId('h:b')
  await settle()

  const after = getModel()
  assert(after != null, 'T4f: model present after follow-up click')
  if (after) {
    assertEqual(after.active.secondary, B, 'T4g: follow-up click adopted after the flip')
    assertEqual(after.active.primary, PROFILE, 'T4h: primary active kept after the flip')
  }

  shutdown()
}

await testSecondarySetterSync()
await testMirrorKeySync()
await testConfigureBatchComposesWithSync()
await testSideFlipComposesWithSync()

console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
if (failed > 0) process.exit(1)
