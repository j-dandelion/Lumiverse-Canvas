// Tests for configure-model.ts
import {
  baseSnapshotFromDraft,
  createDraft,
  encodeHostTabOrder,
  isDraftDirty,
  rebaseBaseIfEpochUnchanged,
  swapDrawerSide,
  moveTab,
  reorderWithin,
  setHidden,
  partitionDisplayLists,
  leftColumnIsSecondary,
  alignIdsToLiveVisibleOrder,
  alignDraftToLiveVisibleOrder,
  type ConfigureDraft,
  type BaseSnapshot,
} from '../configure-model'
import {
  BUILTIN_TAB_IDS,
  CORE_HIDE_LOCKED,
  getBuiltinCatalog,
  getFullCatalog,
  type CatalogTab,
} from '../configure-catalog'
import { __setDrawerTabsForTest } from '../../store'

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed++ }
}
function assertArraysEqual(actual: readonly string[], expected: readonly string[], msg: string) {
  if (actual.length !== expected.length) {
    console.error(`FAIL: ${msg} — length mismatch (expected ${expected.length}, got ${actual.length})`)
    console.error(`  expected: ${JSON.stringify(expected)}`)
    console.error(`  actual:   ${JSON.stringify(actual)}`)
    failed++
    return
  }
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) {
      console.error(`FAIL: ${msg} — diff at index ${i}: expected "${expected[i]}", got "${actual[i]}"`)
      console.error(`  expected: ${JSON.stringify(expected)}`)
      console.error(`  actual:   ${JSON.stringify(actual)}`)
      failed++
      return
    }
  }
  passed++
}
function assertSetEqual(actual: Set<string>, expected: string[], msg: string) {
  const sorted = [...actual].sort()
  const expSorted = [...expected].sort()
  if (sorted.length !== expSorted.length) {
    console.error(`FAIL: ${msg} — size mismatch`)
    failed++; return
  }
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== expSorted[i]) {
      console.error(`FAIL: ${msg} — set mismatch`)
      failed++; return
    }
  }
  passed++
}

// Helper: build a simple catalog with a few entries for test isolation.
const TEST_BUILTIN_IDS = ['profile', 'presets', 'loom', 'weaver', 'connections']
const TEST_EXT_IDS = ['ext-a', 'ext-b']

function makeTestCatalog(): CatalogTab[] {
  const builtins = TEST_BUILTIN_IDS.map(id => ({
    id,
    kind: 'builtin' as const,
    title: id.charAt(0).toUpperCase() + id.slice(1),
    hideLocked: CORE_HIDE_LOCKED.has(id),
  }))
  const extensions = TEST_EXT_IDS.map(id => ({
    id,
    kind: 'extension' as const,
    title: `Ext ${id}`,
    hideLocked: false,
    extensionId: id,
  }))
  return [...builtins, ...extensions]
}

// =====================================================================
// createDraft — basic creation
// =====================================================================
{
  const catalog = makeTestCatalog()
  const tabOrder = [...TEST_BUILTIN_IDS, ...TEST_EXT_IDS]
  const draft = createDraft({
    catalog,
    tabOrder,
    hiddenTabIds: [],
    drawerSide: 'right',
    assignments: new Map(),
  })

  assertEqual(draft.drawerSide, 'right', 'drawerSide is right')
  assertEqual(draft.primaryIds.length, TEST_BUILTIN_IDS.length + TEST_EXT_IDS.length, 'all tabs default to primary')
  assertEqual(draft.secondaryIds.length, 0, 'no secondary tabs')
  assertArraysEqual(draft.builtinOrder, TEST_BUILTIN_IDS, 'builtinOrder matches input')
  assertArraysEqual(draft.extensionOrder, TEST_EXT_IDS, 'extensionOrder matches input')
  assertEqual(draft.hiddenIds.size, 0, 'no hidden tabs')
}

// =====================================================================
// createDraft — with assignments
// =====================================================================
{
  const catalog = makeTestCatalog()
  const tabOrder = [...TEST_BUILTIN_IDS, ...TEST_EXT_IDS]
  const draft = createDraft({
    catalog,
    tabOrder,
    hiddenTabIds: [],
    drawerSide: 'left',
    assignments: new Map([
      ['weaver', 'secondary'],
      ['ext-a', 'secondary'],
    ]),
  })

  assert(draft.primaryIds.includes('profile'), 'profile stays primary')
  assert(draft.primaryIds.includes('presets'), 'presets stays primary')
  assert(draft.primaryIds.includes('loom'), 'loom stays primary')
  assert(draft.primaryIds.includes('connections'), 'connections stays primary')
  assert(draft.primaryIds.includes('ext-b'), 'ext-b stays primary')
  assert(draft.secondaryIds.includes('weaver'), 'weaver moved to secondary')
  assert(draft.secondaryIds.includes('ext-a'), 'ext-a moved to secondary')
  assertEqual(draft.secondaryIds.length, 2, 'exactly 2 secondary tabs')
}

// =====================================================================
// createDraft — with hidden tabs
// =====================================================================
{
  const catalog = makeTestCatalog()
  const tabOrder = [...TEST_BUILTIN_IDS, ...TEST_EXT_IDS]
  const draft = createDraft({
    catalog,
    tabOrder,
    hiddenTabIds: ['loom', 'ext-b'],
    drawerSide: 'right',
    assignments: new Map(),
  })

  assert(draft.hiddenIds.has('loom'), 'loom is hidden')
  assert(draft.hiddenIds.has('ext-b'), 'ext-b is hidden')
  assertEqual(draft.hiddenIds.size, 2, '2 hidden tabs')
}

// =====================================================================
// createDraft — with tabOrder that has builtins after extensions
// (should still partition correctly)
// =====================================================================
{
  const catalog = makeTestCatalog()
  // Mixed order
  const tabOrder = ['ext-a', 'profile', 'presets', 'ext-b', 'loom', 'weaver', 'connections']
  const draft = createDraft({
    catalog,
    tabOrder,
    hiddenTabIds: [],
    drawerSide: 'right',
    assignments: new Map(),
  })

  assertArraysEqual(draft.builtinOrder, ['profile', 'presets', 'loom', 'weaver', 'connections'],
    'builtinOrder extracted in input order')
  assertArraysEqual(draft.extensionOrder, ['ext-a', 'ext-b'],
    'extensionOrder extracted in input order')
  assertArraysEqual(draft.primaryIds, ['profile', 'presets', 'loom', 'weaver', 'connections', 'ext-a', 'ext-b'],
    'primaryIds is builtins then extensions')
}

// =====================================================================
// createDraft — catalog entries not in tabOrder are appended
// =====================================================================
{
  const catalog = makeTestCatalog()
  const tabOrder = ['profile', 'presets'] // only 2 builtins, missing the rest
  const draft = createDraft({
    catalog,
    tabOrder,
    hiddenTabIds: [],
    drawerSide: 'right',
    assignments: new Map(),
  })

  assert(draft.builtinOrder.includes('profile'), 'profile in builtinOrder')
  assert(draft.builtinOrder.includes('presets'), 'presets in builtinOrder')
  assert(draft.builtinOrder.includes('loom'), 'loom appended')
  assert(draft.builtinOrder.includes('weaver'), 'weaver appended')
  assert(draft.builtinOrder.includes('connections'), 'connections appended')
  assert(draft.extensionOrder.includes('ext-a'), 'ext-a appended')
  assert(draft.extensionOrder.includes('ext-b'), 'ext-b appended')
}

// =====================================================================
// encodeHostTabOrder
// =====================================================================
{
  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['profile', 'presets', 'ext-a'],
    secondaryIds: ['weaver', 'ext-b'],
    builtinOrder: ['profile', 'presets', 'weaver'],
    extensionOrder: ['ext-a', 'ext-b'],
    hiddenIds: new Set(),
  }
  const encoded = encodeHostTabOrder(draft)
  assertArraysEqual(encoded, ['profile', 'presets', 'weaver', 'ext-a', 'ext-b'],
    'encodeHostTabOrder: builtins then extensions')
}

// =====================================================================
// isDraftDirty — not dirty when unchanged
// =====================================================================
{
  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['profile', 'presets', 'ext-a'],
    secondaryIds: ['weaver'],
    builtinOrder: ['profile', 'presets', 'weaver'],
    extensionOrder: ['ext-a'],
    hiddenIds: new Set(),
  }
  const base: BaseSnapshot = {
    tabOrder: ['profile', 'presets', 'weaver', 'ext-a'],
    hiddenTabIds: [],
    drawerSide: 'right',
    assignments: new Map([
      ['profile', 'primary'],
      ['presets', 'primary'],
      ['weaver', 'secondary'],
      ['ext-a', 'primary'],
    ]),
  }
  assert(!isDraftDirty(draft, base), 'not dirty when unchanged')
}

// =====================================================================
// isDraftDirty — dirty when tabOrder changes
// =====================================================================
{
  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['presets', 'profile', 'ext-a'],
    secondaryIds: ['weaver'],
    builtinOrder: ['presets', 'profile', 'weaver'],
    extensionOrder: ['ext-a'],
    hiddenIds: new Set(),
  }
  const base: BaseSnapshot = {
    tabOrder: ['profile', 'presets', 'weaver', 'ext-a'],
    hiddenTabIds: [],
    drawerSide: 'right',
    assignments: new Map([
      ['profile', 'primary'],
      ['presets', 'primary'],
      ['weaver', 'secondary'],
      ['ext-a', 'primary'],
    ]),
  }
  assert(isDraftDirty(draft, base), 'dirty when order changes')
}

// =====================================================================
// isDraftDirty — dirty when hidden changes
// =====================================================================
{
  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['profile', 'presets', 'ext-a'],
    secondaryIds: ['weaver'],
    builtinOrder: ['profile', 'presets', 'weaver'],
    extensionOrder: ['ext-a'],
    hiddenIds: new Set(['ext-a']),
  }
  const base: BaseSnapshot = {
    tabOrder: ['profile', 'presets', 'weaver', 'ext-a'],
    hiddenTabIds: [],
    drawerSide: 'right',
    assignments: new Map([
      ['profile', 'primary'],
      ['presets', 'primary'],
      ['weaver', 'secondary'],
      ['ext-a', 'primary'],
    ]),
  }
  assert(isDraftDirty(draft, base), 'dirty when hidden changes')
}

// =====================================================================
// isDraftDirty — dirty when drawerSide changes
// =====================================================================
{
  const draft: ConfigureDraft = {
    drawerSide: 'left',
    primaryIds: ['profile', 'presets', 'ext-a'],
    secondaryIds: ['weaver'],
    builtinOrder: ['profile', 'presets', 'weaver'],
    extensionOrder: ['ext-a'],
    hiddenIds: new Set(),
  }
  const base: BaseSnapshot = {
    tabOrder: ['profile', 'presets', 'weaver', 'ext-a'],
    hiddenTabIds: [],
    drawerSide: 'right',
    assignments: new Map([
      ['profile', 'primary'],
      ['presets', 'primary'],
      ['weaver', 'secondary'],
      ['ext-a', 'primary'],
    ]),
  }
  assert(isDraftDirty(draft, base), 'dirty when drawerSide changes')
}

// =====================================================================
// isDraftDirty — dirty when assignment changes
// =====================================================================
{
  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['profile', 'presets', 'weaver', 'ext-a'],
    secondaryIds: [],
    builtinOrder: ['profile', 'presets', 'weaver'],
    extensionOrder: ['ext-a'],
    hiddenIds: new Set(),
  }
  const base: BaseSnapshot = {
    tabOrder: ['profile', 'presets', 'weaver', 'ext-a'],
    hiddenTabIds: [],
    drawerSide: 'right',
    assignments: new Map([
      ['profile', 'primary'],
      ['presets', 'primary'],
      ['weaver', 'secondary'], // draft has weaver on primary now
      ['ext-a', 'primary'],
    ]),
  }
  assert(isDraftDirty(draft, base), 'dirty when assignment changes (weaver back to primary)')
}

// =====================================================================
// swapDrawerSide
// =====================================================================
{
  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: [],
    secondaryIds: [],
    builtinOrder: ['profile'],
    extensionOrder: [],
    hiddenIds: new Set(),
  }
  const swapped = swapDrawerSide(draft)
  assertEqual(swapped.drawerSide, 'left', 'swap right -> left')
  assertEqual(draft.drawerSide, 'right', 'original unchanged')
}

// =====================================================================
// moveTab — from primary to secondary
// =====================================================================
{
  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['profile', 'presets', 'weaver'],
    secondaryIds: ['loom'],
    builtinOrder: ['profile', 'presets', 'loom', 'weaver'],
    extensionOrder: [],
    hiddenIds: new Set(),
  }
  const moved = moveTab(draft, 'weaver', 'secondary', 0)
  assert(!moved.primaryIds.includes('weaver'), 'weaver removed from primary')
  assertArraysEqual(moved.secondaryIds, ['weaver', 'loom'], 'weaver inserted at index 0 in secondary')
  assertArraysEqual(moved.primaryIds, ['profile', 'presets'], 'primaryIds reduced')
}

// =====================================================================
// moveTab — from secondary to primary (append)
// =====================================================================
{
  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['profile', 'presets'],
    secondaryIds: ['loom', 'weaver'],
    builtinOrder: ['profile', 'presets', 'loom', 'weaver'],
    extensionOrder: [],
    hiddenIds: new Set(),
  }
  const moved = moveTab(draft, 'loom', 'primary', -1)
  assert(!moved.secondaryIds.includes('loom'), 'loom removed from secondary')
  assertArraysEqual(moved.primaryIds, ['profile', 'presets', 'loom'], 'loom appended to primary')
  assertArraysEqual(moved.secondaryIds, ['weaver'], 'secondary reduced')
}

// =====================================================================
// moveTab — tab not found returns original draft
// =====================================================================
{
  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['profile'],
    secondaryIds: [],
    builtinOrder: ['profile'],
    extensionOrder: [],
    hiddenIds: new Set(),
  }
  const moved = moveTab(draft, 'nonexistent', 'secondary', 0)
  assertEqual(moved, draft, 'returns same draft when tab not found')
}

// =====================================================================
// reorderWithin — within primary (spatial left when drawerSide=right)
// =====================================================================
{
  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['profile', 'presets', 'loom', 'weaver'],
    secondaryIds: [],
    builtinOrder: ['profile', 'presets', 'loom', 'weaver'],
    extensionOrder: [],
    hiddenIds: new Set(),
  }
  // When drawerSide is 'right', spatial 'right' column = primary
  const reordered = reorderWithin(draft, 'right', 0, 2)
  assertArraysEqual(reordered.primaryIds, ['presets', 'loom', 'profile', 'weaver'],
    'profile moved from index 0 to index 2 in primary')
}

// =====================================================================
// reorderWithin — within secondary (spatial left when drawerSide=right)
// =====================================================================
{
  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: [],
    secondaryIds: ['profile', 'presets', 'loom'],
    builtinOrder: ['profile', 'presets', 'loom'],
    extensionOrder: [],
    hiddenIds: new Set(),
  }
  // When drawerSide is 'right', spatial 'left' column = secondary
  const reordered = reorderWithin(draft, 'left', 2, 0)
  assertArraysEqual(reordered.secondaryIds, ['loom', 'profile', 'presets'],
    'loom moved from index 2 to index 0 in secondary')
}

// =====================================================================
// setHidden — sets hidden on non-locked tab
// =====================================================================
{
  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: [],
    secondaryIds: [],
    builtinOrder: ['weaver'],
    extensionOrder: [],
    hiddenIds: new Set(),
  }
  const hidden = setHidden(draft, 'weaver', true)
  assert(hidden.hiddenIds.has('weaver'), 'weaver is hidden')
}

// =====================================================================
// setHidden — no-op on hide-locked
// =====================================================================
{
  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: [],
    secondaryIds: [],
    builtinOrder: ['profile'],
    extensionOrder: [],
    hiddenIds: new Set(),
  }
  const hidden = setHidden(draft, 'profile', true)
  assert(!hidden.hiddenIds.has('profile'), 'profile is NOT hidden (hide-locked)')
  assertEqual(hidden.hiddenIds.size, 0, 'hiddenIds unchanged')
}

// =====================================================================
// setHidden — unhide
// =====================================================================
{
  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: [],
    secondaryIds: [],
    builtinOrder: ['weaver'],
    extensionOrder: [],
    hiddenIds: new Set(['weaver']),
  }
  const unhidden = setHidden(draft, 'weaver', false)
  assert(!unhidden.hiddenIds.has('weaver'), 'weaver is unhidden')
  assertEqual(unhidden.hiddenIds.size, 0, 'hiddenIds empty')
}

// =====================================================================
// partitionDisplayLists — basic
// =====================================================================
{
  const catalog = makeTestCatalog()
  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['profile', 'presets', 'ext-a'],
    secondaryIds: ['weaver', 'ext-b'],
    builtinOrder: ['profile', 'presets', 'weaver'],
    extensionOrder: ['ext-a', 'ext-b'],
    hiddenIds: new Set(),
  }

  const { primary, secondary } = partitionDisplayLists(draft, catalog)

  assertEqual(primary.length, 3, '3 primary tabs')
  assertEqual(primary[0].id, 'profile', 'primary[0] = profile')
  assertEqual(primary[1].id, 'presets', 'primary[1] = presets')
  assertEqual(primary[2].id, 'ext-a', 'primary[2] = ext-a')

  assertEqual(secondary.length, 2, '2 secondary tabs')
  assertEqual(secondary[0].id, 'weaver', 'secondary[0] = weaver')
  assertEqual(secondary[1].id, 'ext-b', 'secondary[1] = ext-b')
}

// =====================================================================
// partitionDisplayLists — hidden tabs still appear in correct columns
// =====================================================================
{
  const catalog = makeTestCatalog()
  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['profile', 'presets', 'ext-a'],
    secondaryIds: ['weaver', 'ext-b'],
    builtinOrder: ['profile', 'presets', 'weaver'],
    extensionOrder: ['ext-a', 'ext-b'],
    hiddenIds: new Set(['presets', 'ext-b']),
  }

  const { primary, secondary } = partitionDisplayLists(draft, catalog)

  // Hidden tabs still appear — the modal needs them for the unhide toggle.
  assertEqual(primary.length, 3, '3 primary tabs (including hidden presets)')
  assertEqual(primary[0].id, 'profile', 'primary[0] = profile')
  assertEqual(primary[1].id, 'presets', 'primary[1] = presets (hidden but included)')
  assertEqual(primary[2].id, 'ext-a', 'primary[2] = ext-a')

  assertEqual(secondary.length, 2, '2 secondary tabs (including hidden ext-b)')
  assertEqual(secondary[0].id, 'weaver', 'secondary[0] = weaver')
  assertEqual(secondary[1].id, 'ext-b', 'secondary[1] = ext-b (hidden but included)')
}

// =====================================================================
// partitionDisplayLists — all hidden, all still appear
// =====================================================================
{
  const catalog = makeTestCatalog()
  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['profile'],
    secondaryIds: [],
    builtinOrder: ['profile'],
    extensionOrder: [],
    hiddenIds: new Set(['profile']),
  }

  const { primary, secondary } = partitionDisplayLists(draft, catalog)
  assertEqual(primary.length, 1, 'profile still appears even when hidden')
  assertEqual(primary[0].id, 'profile', 'primary[0] = profile')
  assertEqual(secondary.length, 0, 'no secondary tabs')
}

// =====================================================================
// leftColumnIsSecondary
// =====================================================================
assert(leftColumnIsSecondary('right'), 'leftColumnIsSecondary is true when drawerSide=right')
assert(!leftColumnIsSecondary('left'), 'leftColumnIsSecondary is false when drawerSide=left')

// =====================================================================
// partitionDisplayLists respects primaryIds order (not builtinOrder)
// =====================================================================
{
  const catalog = makeTestCatalog()
  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['ext-b', 'profile', 'ext-a', 'presets'],
    secondaryIds: ['weaver'],
    builtinOrder: ['profile', 'presets', 'weaver'],
    extensionOrder: ['ext-a', 'ext-b'],
    hiddenIds: new Set(),
  }

  const { primary } = partitionDisplayLists(draft, catalog)

  assertEqual(primary.length, 4, '4 visible primary tabs')
  assertEqual(primary[0].id, 'ext-b', 'primary[0] = ext-b (respects primaryIds order)')
  assertEqual(primary[1].id, 'profile', 'primary[1] = profile')
  assertEqual(primary[2].id, 'ext-a', 'primary[2] = ext-a')
  assertEqual(primary[3].id, 'presets', 'primary[3] = presets')
}

// =====================================================================
// partitionDisplayLists respects secondaryIds order
// =====================================================================
{
  const catalog = makeTestCatalog()
  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['profile', 'presets'],
    secondaryIds: ['ext-b', 'ext-a', 'weaver', 'loom'],
    builtinOrder: ['profile', 'presets', 'loom', 'weaver'],
    extensionOrder: ['ext-a', 'ext-b'],
    hiddenIds: new Set(),
  }

  const { secondary } = partitionDisplayLists(draft, catalog)

  assertEqual(secondary.length, 4, '4 visible secondary tabs')
  assertEqual(secondary[0].id, 'ext-b', 'secondary[0] = ext-b (respects secondaryIds order)')
  assertEqual(secondary[1].id, 'ext-a', 'secondary[1] = ext-a')
  assertEqual(secondary[2].id, 'weaver', 'secondary[2] = weaver')
  assertEqual(secondary[3].id, 'loom', 'secondary[3] = loom')
}

// =====================================================================
// moveTab updates builtinOrder/extensionOrder via syncKindOrders
// =====================================================================
{
  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['profile', 'ext-a', 'presets'],
    secondaryIds: ['weaver'],
    builtinOrder: ['profile', 'presets', 'weaver'],
    extensionOrder: ['ext-a'],
    hiddenIds: new Set(),
  }
  const moved = moveTab(draft, 'ext-a', 'secondary', 0)

  // ext-a moved from primary to secondary (index 0, before weaver)
  assert(!moved.primaryIds.includes('ext-a'), 'ext-a removed from primary')
  assertArraysEqual(moved.secondaryIds, ['ext-a', 'weaver'], 'ext-a inserted at index 0 in secondary')

  // builtinOrder includes all builtins from primaryIds + secondaryIds in order
  const allBuiltins = [...moved.primaryIds, ...moved.secondaryIds].filter(
    id => TEST_BUILTIN_IDS.includes(id),
  )
  assertArraysEqual(allBuiltins, ['profile', 'presets', 'weaver'],
    'all builtins in right order across both lists')

  // extensionOrder includes all extensions from primaryIds + secondaryIds in order
  const allExtensions = [...moved.primaryIds, ...moved.secondaryIds].filter(
    id => TEST_EXT_IDS.includes(id),
  )
  assertArraysEqual(allExtensions, ['ext-a'],
    'all extensions in right order across both lists')

  // encodeHostTabOrder reflects the changes
  const encoded = encodeHostTabOrder(moved)
  // builtins first: profile, presets, weaver | then extensions: ext-a
  assertArraysEqual(encoded, ['profile', 'presets', 'weaver', 'ext-a'],
    'encodeHostTabOrder after moveTab includes weaver before ext-a')
}

// =====================================================================
// reorderWithin updates builtinOrder/extensionOrder via syncKindOrders
// =====================================================================
{
  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['ext-a', 'profile', 'presets', 'ext-b'],
    secondaryIds: [],
    builtinOrder: ['profile', 'presets'],
    extensionOrder: ['ext-a', 'ext-b'],
    hiddenIds: new Set(),
  }
  // Spatial 'right' column = primary when drawerSide=right
  // Move ext-b from index 3 to index 1 (between ext-a and profile)
  const reordered = reorderWithin(draft, 'right', 3, 1)

  assertArraysEqual(reordered.primaryIds, ['ext-a', 'ext-b', 'profile', 'presets'],
    'ext-b moved from index 3 to index 1 in primary')

  // builtinOrder should still have profile, presets (just in the order they appear in primaryIds)
  assertArraysEqual(reordered.builtinOrder, ['profile', 'presets'],
    'builtinOrder after reorder preserves builtin sequence from primaryIds')

  // extensionOrder should have ext-a first, then ext-b (matching primaryIds order for extensions)
  assertArraysEqual(reordered.extensionOrder, ['ext-a', 'ext-b'],
    'extensionOrder after reorder reflects ext-b moved after ext-a')

  // encodeHostTabOrder matches
  const encoded = encodeHostTabOrder(reordered)
  assertArraysEqual(encoded, ['profile', 'presets', 'ext-a', 'ext-b'],
    'encodeHostTabOrder after reorderWithin reflects kind-synced order')
}

// =====================================================================
// encodeHostTabOrder reflects syncKindOrders after mixed moves
// =====================================================================
{
  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['ext-a', 'profile'],
    secondaryIds: ['presets', 'ext-b'],
    builtinOrder: ['profile', 'presets'],
    extensionOrder: ['ext-a', 'ext-b'],
    hiddenIds: new Set(),
  }

  // Move ext-a from primary to secondary (append)
  const moved = moveTab(draft, 'ext-a', 'secondary', -1)

  // After move: primaryIds = [profile], secondaryIds = [presets, ext-b, ext-a]
  // builtinOrder should be [profile, presets] (order they appear in primaryIds + secondaryIds)
  // extensionOrder should be [ext-b, ext-a] (order they appear)
  assertArraysEqual(moved.builtinOrder, ['profile', 'presets'],
    'builtinOrder after move keeps builtins in scan order')

  // Extension order: ext-b then ext-a (from secondaryIds)
  assertArraysEqual(moved.extensionOrder, ['ext-b', 'ext-a'],
    'extensionOrder after move reflects ext-b before ext-a from secondaryIds order')

  // encodeHostTabOrder: builtins first, then extensions, in kind-synced order
  const encoded = encodeHostTabOrder(moved)
  assertArraysEqual(encoded, ['profile', 'presets', 'ext-b', 'ext-a'],
    'encodeHostTabOrder after mixed move: builtins then extensions in kind-synced order')
}

// =====================================================================
// createDraft — post-disable-style state: empty assignments Map
// (mirrors what the Configure Tabs modal sees after the user disables
// the second drawer: all tabs back on primary, no secondary tabs).
// =====================================================================
{
  const catalog = makeTestCatalog()
  const tabOrder = [...TEST_BUILTIN_IDS, ...TEST_EXT_IDS]
  const draft = createDraft({
    catalog,
    tabOrder,
    hiddenTabIds: [],
    drawerSide: 'left',
    assignments: new Map(), // empty — no second drawer
  })

  // Every catalog id is on primary.
  assertEqual(draft.secondaryIds.length, 0, 'post-disable: secondaryIds empty')
  assertEqual(draft.primaryIds.length, catalog.length, 'post-disable: primaryIds == all catalog ids')
  for (const tab of catalog) {
    assert(draft.primaryIds.includes(tab.id), `post-disable: ${tab.id} on primary`)
  }

  // builtinOrder + extensionOrder still partition the catalog.
  assertArraysEqual(draft.builtinOrder, TEST_BUILTIN_IDS, 'post-disable: builtinOrder is the catalog builtins in order')
  assertArraysEqual(draft.extensionOrder, TEST_EXT_IDS, 'post-disable: extensionOrder is the catalog extensions in order')

  // encodeHostTabOrder returns builtins then extensions (host order).
  const encoded = encodeHostTabOrder(draft)
  assertArraysEqual(encoded, [...TEST_BUILTIN_IDS, ...TEST_EXT_IDS],
    'post-disable: encodeHostTabOrder returns builtins then extensions')
}

// =====================================================================
// createDraft — post-disable: hidden tabs remain hidden, partition
// preserved
// =====================================================================
{
  const catalog = makeTestCatalog()
  const tabOrder = [...TEST_BUILTIN_IDS, ...TEST_EXT_IDS]
  const draft = createDraft({
    catalog,
    tabOrder,
    hiddenTabIds: ['loom', 'ext-a'],
    drawerSide: 'left',
    assignments: new Map(), // empty — post-disable
  })

  assertEqual(draft.secondaryIds.length, 0, 'post-disable+hidden: secondaryIds empty')
  assertEqual(draft.primaryIds.length, catalog.length, 'post-disable+hidden: primaryIds == all catalog ids')
  assertSetEqual(draft.hiddenIds, ['loom', 'ext-a'], 'post-disable+hidden: hiddenIds match input')

  // Hidden tabs are still in primaryIds (they live in the list; UI shows them muted).
  assert(draft.primaryIds.includes('loom'), 'post-disable+hidden: loom in primaryIds (hidden but listed)')
  assert(draft.primaryIds.includes('ext-a'), 'post-disable+hidden: ext-a in primaryIds (hidden but listed)')

  // encodeHostTabOrder still returns builtins then extensions.
  const encoded = encodeHostTabOrder(draft)
  assertArraysEqual(encoded, [...TEST_BUILTIN_IDS, ...TEST_EXT_IDS],
    'post-disable+hidden: encodeHostTabOrder returns builtins then extensions')
}

// =====================================================================
// isDraftDirty — post-disable: not dirty when base matches the
// all-primary state (i.e. closing the disable-confirm dialog without
// changing anything leaves the draft clean).
// =====================================================================
{
  const catalog = makeTestCatalog()
  const tabOrder = [...TEST_BUILTIN_IDS, ...TEST_EXT_IDS]
  const draft = createDraft({
    catalog,
    tabOrder,
    hiddenTabIds: [],
    drawerSide: 'left',
    assignments: new Map(), // post-disable
  })
  const base: BaseSnapshot = {
    tabOrder: [...TEST_BUILTIN_IDS, ...TEST_EXT_IDS],
    hiddenTabIds: [],
    drawerSide: 'left',
    // All assignments default to 'primary' when key missing → matches draft.
    assignments: new Map(),
  }
  assert(!isDraftDirty(draft, base), 'post-disable: draft is not dirty when base matches (no per-tab entries)')
}

// =====================================================================
// isDraftDirty — post-disable: dirty when an assignment was just flipped
// to secondary (e.g. before the disable, user moved weaver to secondary;
// now base shows the old dual and draft shows all-primary after disable).
// =====================================================================
{
  const catalog = makeTestCatalog()
  const tabOrder = [...TEST_BUILTIN_IDS, ...TEST_EXT_IDS]
  // Post-disable draft: all on primary.
  const draft = createDraft({
    catalog,
    tabOrder,
    hiddenTabIds: [],
    drawerSide: 'left',
    assignments: new Map(),
  })
  // Base still has the pre-disable assignment (weaver was on secondary).
  const base: BaseSnapshot = {
    tabOrder: [...TEST_BUILTIN_IDS, ...TEST_EXT_IDS],
    hiddenTabIds: [],
    drawerSide: 'left',
    assignments: new Map([
      ['weaver', 'secondary'],
    ]),
  }
  assert(isDraftDirty(draft, base), 'post-disable: draft is dirty when base has secondary tabs that draft no longer has')
}

// =====================================================================
// baseSnapshotFromDraft — returns correct BaseSnapshot from draft
// =====================================================================
{
  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['profile', 'presets', 'ext-a'],
    secondaryIds: ['weaver', 'ext-b'],
    builtinOrder: ['profile', 'presets', 'weaver'],
    extensionOrder: ['ext-a', 'ext-b'],
    hiddenIds: new Set(['ext-b']),
  }
  const base = baseSnapshotFromDraft(draft)

  assertArraysEqual(base.tabOrder, ['profile', 'presets', 'weaver', 'ext-a', 'ext-b'],
    'baseSnapshotFromDraft: tabOrder = encodeHostTabOrder(draft)')
  assertArraysEqual(base.hiddenTabIds, ['ext-b'],
    'baseSnapshotFromDraft: hiddenTabIds from draft.hiddenIds')
  assertEqual(base.drawerSide, 'right', 'baseSnapshotFromDraft: drawerSide matches')
  assertEqual(base.assignments.get('profile'), 'primary', 'baseSnapshotFromDraft: profile assigned primary')
  assertEqual(base.assignments.get('presets'), 'primary', 'baseSnapshotFromDraft: presets assigned primary')
  assertEqual(base.assignments.get('ext-a'), 'primary', 'baseSnapshotFromDraft: ext-a assigned primary')
  assertEqual(base.assignments.get('weaver'), 'secondary', 'baseSnapshotFromDraft: weaver assigned secondary')
  assertEqual(base.assignments.get('ext-b'), 'secondary', 'baseSnapshotFromDraft: ext-b assigned secondary')
  assertEqual(base.assignments.size, 5, 'baseSnapshotFromDraft: 5 assignment entries')
}

// =====================================================================
// baseSnapshotFromDraft — isDraftDirty is false when baseSnapshot from draft
// =====================================================================
{
  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['profile', 'presets', 'ext-a'],
    secondaryIds: ['weaver'],
    builtinOrder: ['profile', 'presets', 'weaver'],
    extensionOrder: ['ext-a'],
    hiddenIds: new Set(),
  }
  const base = baseSnapshotFromDraft(draft)
  assert(!isDraftDirty(draft, base), 'baseSnapshotFromDraft: not dirty when base built from draft')
}

// =====================================================================
// rebaseBaseIfEpochUnchanged — autoCommit rapid-swap cancel-out contract
//
// Repro: base.side=right; Swap→left (commit A); Swap→right mid-flight.
// A must still rebase base to left so B sees dirty (right vs left).
// Old bug: only rebased when _draftRef === draftToCommit → base stayed
// right → B isDraftDirty(right, right)=false → no-op while drawers left.
// =====================================================================
{
  const mk = (side: 'left' | 'right'): ConfigureDraft => ({
    drawerSide: side,
    primaryIds: ['profile', 'presets'],
    secondaryIds: ['weaver'],
    builtinOrder: ['profile', 'presets', 'weaver'],
    extensionOrder: [],
    hiddenIds: new Set(),
  })
  const baseRight = baseSnapshotFromDraft(mk('right'))
  const draftA = mk('left') // what commit A wrote
  const liveDraftAfterSecondSwap = mk('right') // user swapped back mid-await

  // Epoch unchanged → always rebase from draftToCommit, even when live draft moved on.
  const rebased = rebaseBaseIfEpochUnchanged(draftA, 1, 1)
  assert(rebased !== null, 'rebase: epoch unchanged returns base')
  assertEqual(rebased!.drawerSide, 'left', 'rebase: base advances to committed left')
  assert(
    isDraftDirty(liveDraftAfterSecondSwap, rebased!),
    'rebase: second swap is dirty vs rebased base (right vs left)',
  )
  // Contrast: if we skipped rebase (old identity-only guard), base stays right → not dirty.
  assert(
    !isDraftDirty(liveDraftAfterSecondSwap, baseRight),
    'rebase: without rebase, cancel-out would falsely look clean',
  )

  // Epoch advanced (open/refresh) → skip rebase so live baseline is not stomped.
  const skipped = rebaseBaseIfEpochUnchanged(draftA, 1, 2)
  assertEqual(skipped, null, 'rebase: epoch advanced → skip')
}

// =====================================================================
// baseSnapshotFromDraft — isDraftDirty is false after reorderWithin + rebase
// (simulates autoCommit rebase contract)
// =====================================================================
{
  let draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['profile', 'presets', 'ext-a', 'loom'],
    secondaryIds: ['weaver'],
    builtinOrder: ['profile', 'presets', 'loom', 'weaver'],
    extensionOrder: ['ext-a'],
    hiddenIds: new Set(),
  }
  // Reorder: move preset from index 1 to index 3 in primary
  draft = reorderWithin(draft, 'right', 1, 3)
  // Rebase base from the reordered draft (autoCommit's happy path)
  const base = baseSnapshotFromDraft(draft)
  assert(!isDraftDirty(draft, base), 'baseSnapshotFromDraft: not dirty after reorderWithin + rebase')
  assertArraysEqual(draft.primaryIds, ['profile', 'ext-a', 'loom', 'presets'],
    'baseSnapshotFromDraft: reorderWithin preserved through rebase')
}

// =====================================================================
// baseSnapshotFromDraft — isDraftDirty is false after moveTab + rebase
// =====================================================================
{
  let draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['profile', 'presets', 'ext-a'],
    secondaryIds: ['weaver'],
    builtinOrder: ['profile', 'presets', 'weaver'],
    extensionOrder: ['ext-a'],
    hiddenIds: new Set(),
  }
  // Move ext-a to secondary
  draft = moveTab(draft, 'ext-a', 'secondary', 0)
  // Rebase base from the moved draft
  const base = baseSnapshotFromDraft(draft)
  assert(!isDraftDirty(draft, base), 'baseSnapshotFromDraft: not dirty after moveTab + rebase')
  assertArraysEqual(draft.secondaryIds, ['ext-a', 'weaver'],
    'baseSnapshotFromDraft: moveTab result preserved through rebase')
  assertArraysEqual(draft.primaryIds, ['profile', 'presets'],
    'baseSnapshotFromDraft: moveTab primary reduced through rebase')
}

// =====================================================================
// baseSnapshotFromDraft — isDraftDirty is false after setHidden + rebase
// =====================================================================
{
  let draft: ConfigureDraft = {
    drawerSide: 'left',
    primaryIds: ['profile', 'presets', 'ext-a'],
    secondaryIds: ['weaver'],
    builtinOrder: ['profile', 'presets', 'weaver'],
    extensionOrder: ['ext-a'],
    hiddenIds: new Set(),
  }
  draft = setHidden(draft, 'ext-a', true)
  const base = baseSnapshotFromDraft(draft)
  assert(!isDraftDirty(draft, base), 'baseSnapshotFromDraft: not dirty after setHidden + rebase')
  assert(draft.hiddenIds.has('ext-a'), 'baseSnapshotFromDraft: hidden state preserved through rebase')
}

// =====================================================================
// alignIdsToLiveVisibleOrder — first live DnD must not reshuffle to host order
// =====================================================================
{
  // Host/catalog order vs live strip order (classic first-drop shuffle).
  assertArraysEqual(
    alignIdsToLiveVisibleOrder(
      ['a', 'b', 'c', 'd'],
      ['c', 'a', 'd', 'b'],
      new Set(),
    ),
    ['c', 'a', 'd', 'b'],
    'alignIds: full visible reorder matches live',
  )

  // Hidden slot stays put while visible order follows live.
  assertArraysEqual(
    alignIdsToLiveVisibleOrder(
      ['a', 'hidden', 'b', 'c'],
      ['c', 'a', 'b'],
      new Set(['hidden']),
    ),
    ['c', 'hidden', 'a', 'b'],
    'alignIds: hidden slot preserved between live-visible order',
  )

  // Live ids not on this side ignored; missing visible appended.
  assertArraysEqual(
    alignIdsToLiveVisibleOrder(
      ['a', 'b'],
      ['x', 'b', 'a'],
      new Set(),
    ),
    ['b', 'a'],
    'alignIds: ignore foreign live ids',
  )

  assertArraysEqual(
    alignIdsToLiveVisibleOrder(
      ['a', 'b', 'c'],
      ['b'],
      new Set(),
    ),
    ['b', 'a', 'c'],
    'alignIds: missing live visibles append in prior relative order',
  )
}

// =====================================================================
// alignDraftToLiveVisibleOrder — both sides + kind sync
// =====================================================================
{
  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['profile', 'presets', 'ext-a'],
    secondaryIds: ['weaver', 'ext-b'],
    builtinOrder: ['profile', 'presets', 'weaver'],
    extensionOrder: ['ext-a', 'ext-b'],
    hiddenIds: new Set(),
  }
  const aligned = alignDraftToLiveVisibleOrder(
    draft,
    ['ext-a', 'profile', 'presets'],
    ['ext-b', 'weaver'],
  )
  assertArraysEqual(
    aligned.primaryIds,
    ['ext-a', 'profile', 'presets'],
    'alignDraft: primary follows live',
  )
  assertArraysEqual(
    aligned.secondaryIds,
    ['ext-b', 'weaver'],
    'alignDraft: secondary follows live',
  )
  // Kind orders resynced from primary+secondary walk.
  assertArraysEqual(
    aligned.builtinOrder,
    ['profile', 'presets', 'weaver'],
    'alignDraft: builtinOrder from side walk',
  )
  assertArraysEqual(
    aligned.extensionOrder,
    ['ext-a', 'ext-b'],
    'alignDraft: extensionOrder from side walk',
  )

  // Identity when live already matches.
  const same = alignDraftToLiveVisibleOrder(
    draft,
    draft.primaryIds,
    draft.secondaryIds,
  )
  assert(same === draft, 'alignDraft: returns same ref when already aligned')
}

// =====================================================================
// Open-alignment sequence (Configure modal buildLiveDraftAndBase contract)
// createDraft → alignDraftToLiveVisibleOrder(live ids) → baseSnapshotFromDraft
// Open/refresh must match live strip order and not be spuriously dirty.
// =====================================================================
{
  // Host tabOrder disagrees with live strips (stale host after strip-only
  // reorders / mid-session DnD before host settles).
  const catalog = makeTestCatalog()
  const draftFromHost = createDraft({
    catalog,
    tabOrder: [...TEST_BUILTIN_IDS, ...TEST_EXT_IDS],
    hiddenTabIds: [],
    drawerSide: 'right',
    assignments: new Map([
      ['weaver', 'secondary'],
      ['ext-b', 'secondary'],
    ]),
  })
  // Live strips: primary reordered (subset of visibles), secondary swapped.
  // Missing primary visibles (loom, connections) append in prior relative order.
  const livePrimary = ['ext-a', 'profile', 'presets']
  const liveSecondary = ['ext-b', 'weaver']
  const aligned = alignDraftToLiveVisibleOrder(
    draftFromHost,
    livePrimary,
    liveSecondary,
  )
  assertArraysEqual(
    aligned.primaryIds,
    ['ext-a', 'profile', 'presets', 'loom', 'connections'],
    'open-align: primaryIds = live prefix + missing visibles',
  )
  assertArraysEqual(
    aligned.secondaryIds,
    ['ext-b', 'weaver'],
    'open-align: secondaryIds match live strip order',
  )
  // Modal open uses baseSnapshotFromDraft(aligned) — not raw host base.
  const base = baseSnapshotFromDraft(aligned)
  assert(
    !isDraftDirty(aligned, base),
    'open-align: aligned draft + baseSnapshotFromDraft is not dirty',
  )
  // Contrast: raw host base would be dirty after alignment.
  const hostBase: BaseSnapshot = {
    tabOrder: [...TEST_BUILTIN_IDS, ...TEST_EXT_IDS],
    hiddenTabIds: [],
    drawerSide: 'right',
    assignments: new Map([
      ['profile', 'primary'],
      ['presets', 'primary'],
      ['loom', 'primary'],
      ['connections', 'primary'],
      ['ext-a', 'primary'],
      ['weaver', 'secondary'],
      ['ext-b', 'secondary'],
    ]),
  }
  assert(
    isDraftDirty(aligned, hostBase),
    'open-align: aligned draft IS dirty vs stale host base (why we rebase)',
  )
}

// =====================================================================
// Summary
// =====================================================================
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}/${passed + failed}`)
