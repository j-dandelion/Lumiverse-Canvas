import type { LayoutModel, TabKey, Side, ObservedWorld, HostTabEntry } from '../../core/model'
import { createEmptyModel, builtinKey, extensionKey } from '../../core/model'
import { type Intent } from '../../core/intents'
import { visibleKeys } from '../../core/select'
import { FakeHost, type LiveTab } from '../../host/fake/implementation'
import { bootstrap, bootstrapFromLayout, shutdown, dispatch, dispatchBatch, flush, getModel, getHost, dispatchMoveByLiveId, dispatchActivateByLiveId } from '../../recon/dispatch'
import { serializeModelToLayout, buildModelFromLayout } from '../../persist/layout-model'
import {
  armLayoutRepo,
  __resetLayoutRepoForTest,
  setLayoutRepoBackendCtx,
} from '../../persist/layout-repo'

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
const B = extensionKey('ext', 'b')

// ============================================================================
// D1 — Bootstrap + right-click move (primary → secondary)
// ============================================================================
async function testRightClickMovePrimaryToSecondary() {
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'primary'),
    makeLiveTab(B, 'h:b', 'primary'),
  ])

  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A, B],
    secondary: [],
    hidden: [],
    active: { primary: PROFILE, secondary: null },
  }

  shutdown()
  bootstrap(model, host)

  // Right-click B → move to secondary, activateDest: true
  // B is at visible index 2 (0=PROFILE, 1=A, 2=B) on primary
  const visibleIndex = visibleKeys(model, 'primary').indexOf(B)
  assert(visibleIndex >= 0, 'D1a: B found in visible primary keys')

  const intent: Intent = {
    t: 'move',
    key: B,
    to: 'secondary',
    index: 0,
    activateDest: true,
  }
  await dispatch(intent)
  await flush()

  const newModel = getModel()
  assert(newModel != null, 'D1b: model present after dispatch')
  if (newModel) {
    assert(!newModel.primary.includes(B), 'D1c: B gone from primary')
    assert(newModel.secondary.includes(B), 'D1d: B in secondary')
    assertEqual(newModel.active.secondary, B, 'D1e: B is active in secondary (activateDest)')
    const secOrder = visibleKeys(newModel, 'secondary')
    assert(secOrder[0] === B, `D1f: B is first in secondary visible order, got ${JSON.stringify(secOrder)}`)
  }

  const world = host.observe()
  const bObs = world.tabs.find(t => t.key === B)
  assert(bObs != null, 'D1g: B observed')
  assert(bObs!.location === 'secondary', `D1h: B is in secondary (host), got ${bObs!.location}`)
  assert(bObs!.isActiveInSecondary === true, 'D1i: B is active in secondary (host)')
  shutdown()
}

// ============================================================================
// D2 — Right-click move secondary → primary (quiet, not activateDest)
// ============================================================================
async function testRightClickMoveSecondaryToPrimary() {
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'primary'),
    makeLiveTab(B, 'h:b', 'secondary', { activeInSecondary: true }),
  ])

  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A],
    secondary: [B],
    hidden: [],
    active: { primary: PROFILE, secondary: B },
  }

  shutdown()
  bootstrap(model, host)

  // Right-click B → move to primary (activateDest: true for right-click)
  const intent: Intent = {
    t: 'move',
    key: B,
    to: 'primary',
    index: 1, // after PROFILE, before A
    activateDest: true,
  }
  await dispatch(intent)
  await flush()

  const newModel = getModel()
  assert(newModel != null, 'D2a: model present')
  if (newModel) {
    assert(newModel.primary.includes(B), 'D2b: B in primary')
    assert(!newModel.secondary.includes(B), 'D2c: B gone from secondary')
    assertEqual(newModel.active.primary, B, 'D2d: B active in primary (activateDest)')
    assertEqual(newModel.active.secondary, null, 'D2e: secondary active is null (no tabs left)')
  }

  const world = host.observe()
  const bObs = world.tabs.find(t => t.key === B)
  assert(bObs!.isActiveInPrimary === true, 'D2f: B active in primary (host)')
  assert(bObs!.isActiveInSecondary === false, 'D2g: B NOT active in secondary')
  shutdown()
}

// ============================================================================
// D3 — Right-click with active neighbor handoff
// ============================================================================
async function testRightClickNeighborHandoff() {
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'primary'),
    makeLiveTab(B, 'h:b', 'primary'),
  ])

  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A, B],
    secondary: [],
    hidden: [],
    active: { primary: PROFILE, secondary: null },
  }

  shutdown()
  bootstrap(model, host)

  // Move the ACTIVE tab (PROFILE) to secondary
  // Neighbor above (none) → should activate A (below)
  const intent: Intent = {
    t: 'move',
    key: PROFILE,
    to: 'secondary',
    index: 0,
    activateDest: true,
  }
  await dispatch(intent)
  await flush()

  const newModel = getModel()
  assert(newModel != null, 'D3a: model present')
  if (newModel) {
    assertEqual(newModel.active.primary, A, 'D3b: A is new primary active (neighbor below)')
    assertEqual(newModel.active.secondary, PROFILE, 'D3c: PROFILE active in secondary')
  }

  const world = host.observe()
  const aObs = world.tabs.find(t => t.key === A)
  assert(aObs!.isActiveInPrimary === true, 'D3d: A active in primary (host)')
  shutdown()
}

// ============================================================================
// D4 — setHidden intent
// ============================================================================
async function testSetHidden() {
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'primary'),
  ])

  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A],
    secondary: [],
    hidden: [],
    active: { primary: PROFILE, secondary: null },
  }

  shutdown()
  bootstrap(model, host)

  await dispatch({ t: 'setHidden', key: A, hidden: true })
  await flush()

  const newModel = getModel()
  assert(newModel != null, 'D4a: model present')
  if (newModel) {
    assert(newModel.hidden.includes(A), 'D4b: A is hidden')
  }

  const world = host.observe()
  const aObs = world.tabs.find(t => t.key === A)
  assert(aObs!.isHidden === true, 'D4c: A hidden in host')
  shutdown()
}

// ============================================================================
// D5 — reorder intent
// ============================================================================
async function testReorder() {
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'primary'),
    makeLiveTab(B, 'h:b', 'primary'),
  ])

  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A, B],
    secondary: [],
    hidden: [],
    active: { primary: PROFILE, secondary: null },
  }

  shutdown()
  bootstrap(model, host)

  // Reorder B to position 0 (visible) → B then PROFILE then A
  await dispatch({ t: 'reorder', key: B, side: 'primary', index: 0 })
  await flush()

  const newModel = getModel()
  assert(newModel != null, 'D5a: model present')
  if (newModel) {
    assertEqual(newModel.primary[0], B, 'D5b: B is first in primary')
    assertEqual(newModel.primary[1], PROFILE, 'D5c: PROFILE is second')
    assertEqual(newModel.primary[2], A, 'D5d: A is third')
  }

  shutdown()
}

// ============================================================================
// D6 — dispatchBatch (fold multiple intents)
// ============================================================================
async function testDispatchBatch() {
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'primary'),
    makeLiveTab(B, 'h:b', 'primary'),
  ])

  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A, B],
    secondary: [],
    hidden: [],
    active: { primary: PROFILE, secondary: null },
  }

  shutdown()
  bootstrap(model, host)

  // Batch: hide A + move B to secondary
  await dispatchBatch([
    { t: 'setHidden', key: A, hidden: true },
    { t: 'move', key: B, to: 'secondary', index: 0, activateDest: false },
  ])
  await flush()

  const newModel = getModel()
  assert(newModel != null, 'D6a: model present')
  if (newModel) {
    assert(newModel.hidden.includes(A), 'D6b: A hidden')
    assert(newModel.secondary.includes(B), 'D6c: B in secondary')
    assertEqual(newModel.active.primary, PROFILE, 'D6d: PROFILE still active (no activateDest)')
  }

  shutdown()
}

// ============================================================================
// D7 — syncFromHost (late registration)
// ============================================================================
async function testSyncFromHost() {
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'primary'),
  ])

  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A],
    secondary: [],
    hidden: [],
    active: { primary: PROFILE, secondary: null },
  }

  shutdown()
  bootstrap(model, host)

  // Simulate late registration: add tab B to host
  host.addTab(B, 'h:b', 'primary')

  await dispatch({ t: 'syncFromHost', observed: host.observe() })
  await flush()

  const newModel = getModel()
  assert(newModel != null, 'D7a: model present')
  if (newModel) {
    assert(newModel.primary.includes(B), 'D7b: B adopted into primary')
  }
  shutdown()
}

// D12 — host notifications enter the owned queue, including tabs registered
// after the initial bootstrap snapshot.
async function testHostNotificationSync() {
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
  ])
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE],
    active: { primary: PROFILE, secondary: null },
  }

  shutdown()
  bootstrap(model, host)
  await flush()

  host.addTab(A, 'h:a', 'primary')
  await flush()

  assert(getModel()?.primary.includes(A) === true, 'D12a: late host tab enters model through world subscription')

  shutdown()
  host.addTab(B, 'h:b', 'primary')
  await flush()
  assert(getModel() === null, 'D12b: shutdown removes the world subscription')
}

// D16 — a host echo followed by an explicit sync must not rewrite owned state.
async function testDispatchSyncRoundTripIsStable() {
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'primary'),
  ])
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A],
    active: { primary: PROFILE, secondary: null },
  }

  shutdown()
  bootstrap(model, host)
  await flush()
  await dispatch({ t: 'move', key: A, to: 'secondary', index: 0, activateDest: true })
  await flush()

  const before = getModel()
  assert(before != null, 'D16a: model exists before explicit host sync')
  await dispatch({ t: 'syncFromHost', observed: host.observe() })
  await flush()
  const after = getModel()
  assert(after != null, 'D16b: model exists after explicit host sync')
  if (before && after) {
    assertEqual(JSON.stringify(after.primary), JSON.stringify(before.primary), 'D16c: sync preserves primary order')
    assertEqual(JSON.stringify(after.secondary), JSON.stringify(before.secondary), 'D16d: sync preserves secondary order')
    assertEqual(after.active.primary, before.active.primary, 'D16e: sync preserves primary active')
    assertEqual(after.active.secondary, before.active.secondary, 'D16f: sync preserves secondary active')
  }
  shutdown()
}

// D17 — an empty batch is a harmless queue no-op.
async function testEmptyDispatchBatch() {
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
  ])
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE],
    active: { primary: PROFILE, secondary: null },
  }

  shutdown()
  bootstrap(model, host)
  await flush()
  const before = JSON.stringify(getModel())
  await dispatchBatch([])
  await flush()
  assertEqual(JSON.stringify(getModel()), before, 'D17a: empty batch leaves model unchanged')
  shutdown()
}

// ============================================================================
// Shutdown guard — dispatch after shutdown is a no-op
// ============================================================================
async function testShutdownGuard() {
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
  ])

  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE],
    active: { primary: PROFILE, secondary: null },
  }

  bootstrap(model, host)
  const initialModel = getModel()

  shutdown()

  await dispatch({ t: 'setHidden', key: PROFILE, hidden: true })
  await flush()

  // Model should be unchanged (null after shutdown)
  assert(getModel() === null, 'D8a: model null after shutdown')
  assert(getHost() === null, 'D8b: host null after shutdown')
}

// ==========================================================================
// D10 — a failed reconcile must not poison later queued dispatches
// ==========================================================================
async function testQueueRecoversAfterFailure() {
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'primary'),
  ])
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A],
    active: { primary: PROFILE, secondary: null },
  }

  shutdown()
  bootstrap(model, host)
  await flush()
  host._failureConfig.setOrder = 'throw'

  const failedDispatch = dispatch({ t: 'reorder', key: A, side: 'primary', index: 0 })
  let rejected = false
  try {
    await failedDispatch
  } catch {
    rejected = true
  }
  assert(rejected, 'D10a: failed dispatch rejects its own promise')

  host._failureConfig.setOrder = undefined
  await dispatch({ t: 'setHidden', key: A, hidden: true })
  await flush()
  assert(getModel()?.hidden.includes(A) === true, 'D10b: later dispatch runs after failure')
  shutdown()
}

// ==========================================================================
// D11 — bootstrap reconciliation cannot restore state after shutdown
// ==========================================================================
async function testBootstrapShutdownRace() {
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
  ])
  host._failureConfig.commitLagTicks = 2
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE],
    active: { primary: PROFILE, secondary: null },
  }

  shutdown()
  bootstrap(model, host)
  shutdown()
  await flush()
  assert(getModel() === null, 'D11a: shutdown clears model after bootstrap starts')
  assert(getHost() === null, 'D11b: shutdown clears host after bootstrap starts')
}

// ============================================================================
// D9 — dispatchMoveByLiveId when tab is not yet in the model
// ============================================================================
async function testMoveWhenTabNotInModel() {
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'primary'),
    makeLiveTab(B, 'h:b', 'secondary', { activeInSecondary: true }),
  ])
  host.setOrder('primary', ['h:profile', 'h:a'])

  // Model doesn't include B (simulates tab moved by legacy path)
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A],
    secondary: [],
    hidden: [],
    active: { primary: PROFILE, secondary: null },
  }

  shutdown()
  bootstrap(model, host)

  // Move B (secondary) to primary via right-click
  await dispatchMoveByLiveId('h:b')
  await flush()

  const newModel = getModel()
  assert(newModel != null, 'D9a: model present')
  if (newModel) {
    // B should now be in primary (synced from host, then moved)
    assert(newModel.primary.includes(B), 'D9b: B in primary after move')
    assert(!newModel.secondary.includes(B), 'D9c: B not in secondary')
  }

  shutdown()
}

// ============================================================================
// D13 — dispatchMoveByLiveId for a tab already in the model
// ============================================================================
async function testMoveWhenTabIsInModel() {
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'secondary', { activeInSecondary: true }),
    makeLiveTab(B, 'h:b', 'primary'),
  ])
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, B],
    secondary: [A],
    hidden: [],
    active: { primary: PROFILE, secondary: A },
  }

  shutdown()
  bootstrap(model, host)

  // The normal right-click path resolves the live id, toggles the side, and
  // appends to the destination rather than relying on a caller-supplied index.
  await dispatchMoveByLiveId('h:b')
  await flush()

  const newModel = getModel()
  assert(newModel != null, 'D13a: model present')
  if (newModel) {
    assert(!newModel.primary.includes(B), 'D13b: B gone from primary')
    assertEqual(newModel.secondary[newModel.secondary.length - 1], B,
      'D13c: B appended to secondary')
    assertEqual(newModel.active.secondary, B,
      'D13d: B active in secondary (activateDest)')
  }

  const bObs = host.observe().tabs.find(t => t.key === B)
  assert(bObs?.location === 'secondary', 'D13e: B moved to secondary in host')
  assert(bObs?.isActiveInSecondary === true, 'D13f: B active in secondary in host')
  shutdown()
}

// ==========================================================================
// D14 — owned dispatch persists the resulting model
// ==========================================================================
async function testDispatchPersistsModel() {
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'primary'),
  ])
  const writes: any[] = []
  const backend = {
    sendToBackend(message: { type: string; [key: string]: unknown }) {
      if (message.type === 'SAVE_LAYOUT') writes.push(message.layout)
    },
    onBackendMessage() { return () => {} },
  }

  __resetLayoutRepoForTest()
  setLayoutRepoBackendCtx(backend)
  armLayoutRepo()
  shutdown()
  bootstrap({
    ...createEmptyModel(),
    primary: [PROFILE, A],
    active: { primary: PROFILE, secondary: null },
  }, host, 'test-v1.0')
  await flush()
  writes.length = 0

  await dispatchMoveByLiveId('h:a')
  await flush()

  assert(writes.length > 0, 'D14a: dispatch writes the model to layout storage')
  const saved = writes[writes.length - 1]
  assert(saved?.detachedTabs?.some((tab: any) => tab.tabId === 'h:a'),
    'D14b: saved layout contains the moved tab')
  assert(saved?.tabOrder?.includes('h:profile') && saved?.tabOrder?.includes('h:a'),
    'D14c: saved layout contains the complete tab order')
  shutdown()
  __resetLayoutRepoForTest()
}

// ==========================================================================
// D15 — unknown live ids do not mutate the owned model
// ==========================================================================
async function testUnknownLiveIdIsNoOp() {
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
  ])
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE],
    active: { primary: PROFILE, secondary: null },
  }

  shutdown()
  bootstrap(model, host)
  await flush()
  await dispatchMoveByLiveId('h:missing')
  await flush()

  assertEqual(getModel()?.primary[0], PROFILE, 'D15a: unknown live id leaves model unchanged')
  assertEqual(getModel()?.secondary.length, 0, 'D15b: unknown live id does not create placement')
  shutdown()
}

// ============================================================================
// R1 — Layout model round-trip serialization (invariant 13)
// ============================================================================
async function testRoundTripSerialization() {
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'primary'),
    makeLiveTab(B, 'h:b', 'secondary', { activeInSecondary: true }),
  ])

  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE, A],
    secondary: [B],
    hidden: [A],
    active: { primary: PROFILE, secondary: B },
    drawers: {
      primary: { open: true, width: 500 },
      secondary: { open: false, width: 420 },
    },
    side: 'right',
  }

  shutdown()
  bootstrap(model, host, 'test-v1.0')
  await flush()

  // Serialize
  const blob = serializeModelToLayout(
    model, (k) => host.resolve(k), 'test-v1.0',
  )

  // Build from serialized blob
  const reconstructed = buildModelFromLayout(
    blob, (id) => host.findKey(id), 'right',
  )

  // Verify reconstructed model matches original
  assertEqual(reconstructed.primary.length, 2, 'RT1a: primary count')
  assertEqual(reconstructed.secondary.length, 1, 'RT1b: secondary count')
  assertEqual(reconstructed.hidden.length, 1, 'RT1c: hidden count')
  assert(reconstructed.hidden.includes(A), 'RT1d: A hidden')
  assertEqual(reconstructed.active.primary, PROFILE, 'RT1e: primary active')
  assertEqual(reconstructed.active.secondary, B, 'RT1f: secondary active')
  assert(reconstructed.drawers.primary.open, 'RT1g: primary open')
  assertEqual(reconstructed.drawers.primary.width, 500, 'RT1h: primary width')
  assert(!reconstructed.drawers.secondary.open, 'RT1i: secondary closed')
  assertEqual(reconstructed.side, 'right', 'RT1j: side')

  shutdown()
}

// ============================================================================
// R2 — Empty model round-trip
// ============================================================================
async function testEmptyModelRoundTrip() {
  const host = new FakeHost([])
  const model = createEmptyModel('left')

  shutdown()
  bootstrap(model, host, 'test-v1.0')
  await flush()

  const blob = serializeModelToLayout(
    model, (k) => null, 'test-v1.0',
  )
  const reconstructed = buildModelFromLayout(
    blob, (id) => null, 'left',
  )

  assertEqual(reconstructed.primary.length, 0, 'RT2a: empty primary')
  assertEqual(reconstructed.secondary.length, 0, 'RT2b: empty secondary')
  assertEqual(reconstructed.hidden.length, 0, 'RT2c: empty hidden')
  assertEqual(reconstructed.active.primary, null, 'RT2d: no primary active')
  assertEqual(reconstructed.active.secondary, null, 'RT2e: no secondary active')
  assertEqual(reconstructed.side, 'left', 'RT2f: side')

  shutdown()
}

// ==========================================================================
// R3 — suffix drift keeps detached placement on reload
// ==========================================================================
async function testSuffixDriftDetachedPlacement() {
  const findKey = (id: string): TabKey | null =>
    id === 'ext:tool:2' ? extensionKey('ext', 'tool') : null
  const reconstructed = buildModelFromLayout(
    {
      tabOrder: ['h:profile', 'ext:tool:1'],
      detachedTabs: [{ tabId: 'ext:tool:2', tabTitle: 'Tool', sidebar: 'secondary' }],
    },
    findKey,
  )

  assert(reconstructed.secondary.includes(extensionKey('ext', 'tool')), 'RT3a: suffix-drift detached tab stays secondary')
  assert(!reconstructed.primary.includes(extensionKey('ext', 'tool')), 'RT3b: suffix-drift tab is not also primary')
}

// ============================================================================
// R4 — bootstrapFromLayout restores the model before reconciliation
// ============================================================================
async function testBootstrapFromLayout() {
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'primary'),
    makeLiveTab(B, 'h:b', 'primary'),
  ])
  const layout = {
    version: 'test-v1.0',
    primary: { open: true, width: 500, tabId: 'h:profile' },
    secondary: { open: false, width: 430, activeTabId: 'h:b' },
    tabOrder: ['h:profile', 'h:a', 'h:b'],
    detachedTabs: [{ tabId: 'h:b', tabTitle: 'B', sidebar: 'secondary' as const }],
    hiddenTabIds: ['h:a'],
    drawerSide: 'right' as const,
  }

  shutdown()
  bootstrapFromLayout(layout, host, 'test-v1.0')
  await flush()

  const model = getModel()
  assert(model != null, 'R4a: model restored')
  if (model) {
    assertEqual(model.primary[0], PROFILE, 'R4b: primary order restored')
    assertEqual(model.secondary[0], B, 'R4c: secondary placement restored')
    assert(model.hidden.includes(A), 'R4d: hidden tab restored')
    assertEqual(model.active.primary, PROFILE, 'R4e: primary active restored')
    assertEqual(model.active.secondary, B, 'R4f: secondary active restored')
    assertEqual(model.drawers.primary.width, 500, 'R4g: primary width restored')
    assertEqual(model.drawers.secondary.width, 430, 'R4h: secondary width restored')
    assertEqual(model.side, 'right', 'R4i: drawer side restored')
  }

  const world = host.observe()
  const bObs = world.tabs.find(t => t.key === B)
  assert(bObs?.location === 'secondary', 'R4j: restored placement converges in host')
  assert(bObs?.isActiveInSecondary === true, 'R4k: restored active tab converges in host')
  shutdown()
}

// R5 — an empty initial host must defer persisted restore until React commits
async function testDeferredBootstrapFromLayout() {
  const host = new FakeHost([])
  const layout = {
    version: 'test-v1.0',
    primary: { open: true, width: 500, tabId: 'h:profile' },
    secondary: { open: true, width: 430, activeTabId: 'h:b' },
    tabOrder: ['h:profile', 'h:a', 'h:b'],
    detachedTabs: [{ tabId: 'h:b', tabTitle: 'B', sidebar: 'secondary' as const }],
    hiddenTabIds: ['h:a'],
    drawerSide: 'right' as const,
  }

  shutdown()
  bootstrapFromLayout(layout, host, 'test-v1.0')
  host.addTab(PROFILE, 'h:profile', 'primary')
  host.addTab(A, 'h:a', 'primary')
  host.addTab(B, 'h:b', 'primary')
  await flush()
  await flush()

  const model = getModel()
  assert(model != null, 'R5a: deferred model present')
  if (model) {
    assertEqual(model.primary[0], PROFILE, 'R5b: deferred primary order restored')
    assertEqual(model.secondary[0], B, 'R5c: deferred secondary placement restored')
    assert(model.hidden.includes(A), 'R5d: deferred hidden state restored')
    assertEqual(model.active.primary, PROFILE, 'R5e: deferred primary active restored')
    assertEqual(model.active.secondary, B, 'R5f: deferred secondary active restored')
  }
  assert(host.tabInSide('h:b', 'secondary'), 'R5g: deferred host placement converges')
  assert(host.tabActive('secondary', 'h:b'), 'R5h: deferred host activation converges')
  shutdown()
}

// ============================================================================
// D18 — dispatchActivateByLiveId (secondary click path)
//
// Secondary clicks never fire host-syncs (the wrapper is outside the
// observed subtree), so the click handler dispatches an explicit activate
// intent. This test proves the intent resolves the live id, converges the
// model's secondary active, and — critically — that the value written to
// the persisted layout follows the click (that is the disk value a hard
// refresh restores; the bug: it carried the stale pre-click key).
// ============================================================================
async function testDispatchActivateByLiveId() {
  const host = new FakeHost([
    makeLiveTab(PROFILE, 'h:profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'secondary', { activeInSecondary: true }),
    makeLiveTab(B, 'h:b', 'secondary'),
  ])
  const model: LayoutModel = {
    ...createEmptyModel(),
    primary: [PROFILE],
    secondary: [A, B],
    hidden: [],
    active: { primary: PROFILE, secondary: A },
  }
  shutdown()
  bootstrap(model, host)
  await flush()

  // User clicks tab B in the secondary drawer (its live id is 'h:b').
  await dispatchActivateByLiveId('h:b', 'secondary')
  await flush()

  const after = getModel()
  assert(after != null, 'D18a: model present')
  if (after) {
    assertEqual(after.active.secondary, B, 'D18b: secondary active converges to the clicked tab')

    // The persisted layout must carry the CLICKED tab.
    const blob = serializeModelToLayout(after, (k) => host.resolve(k), 'test-v1.0')
    assertEqual(blob.secondary.activeTabId, 'h:b', 'D18c: persisted secondary active follows the click')
  }

  // Unresolvable live id: resolves without dispatch, model unchanged.
  const before = JSON.stringify(getModel())
  await dispatchActivateByLiveId('h:nope', 'secondary')
  await flush()
  assertEqual(JSON.stringify(getModel()), before, 'D18d: unresolvable live id is a no-op')

  // Already-active key: identity-preserving no-op (no reconcile/persist).
  const refBefore = getModel()
  await dispatchActivateByLiveId('h:b', 'secondary')
  await flush()
  assert(getModel() === refBefore, 'D18e: re-activating the active tab keeps the model reference')

  shutdown()
}

// ============================================================================
// Run all tests
// ============================================================================
await testRightClickMovePrimaryToSecondary()
await testRightClickMoveSecondaryToPrimary()
await testRightClickNeighborHandoff()
await testSetHidden()
await testReorder()
await testDispatchBatch()
await testSyncFromHost()
await testHostNotificationSync()
await testDispatchSyncRoundTripIsStable()
await testEmptyDispatchBatch()
await testShutdownGuard()
await testQueueRecoversAfterFailure()
await testBootstrapShutdownRace()

// Move when tab not yet in model
await testMoveWhenTabNotInModel()
await testMoveWhenTabIsInModel()
await testDispatchPersistsModel()
await testUnknownLiveIdIsNoOp()
await testDispatchActivateByLiveId()

// Round-trip serialization
await testRoundTripSerialization()
await testEmptyModelRoundTrip()
await testSuffixDriftDetachedPlacement()
await testBootstrapFromLayout()
await testDeferredBootstrapFromLayout()

if (failed > 0) {
  console.error(`FAILED: ${failed}`)
  process.exitCode = 1
}
console.log(`PASS: ${passed}/${passed + failed}`)
