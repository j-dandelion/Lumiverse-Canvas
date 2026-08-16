// Headless persistence contract for the rewrite model.
// Covers invariant 13 through the legacy-compatible v2 layout seam.
import { builtinKey, createEmptyModel, extensionKey, type LayoutModel } from '../../core/model'
import { buildModelFromLayout, serializeModelToLayout } from '../layout-model'

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

function assertArray(actual: readonly string[], expected: readonly string[], message: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

const PROFILE = builtinKey('profile')
const PRESETS = builtinKey('presets')
const LOOM = extensionKey('loom', 'main')
const WEAVER = extensionKey('weaver', 'main')

const liveIds = new Map([
  [PROFILE, 'profile:2'],
  [PRESETS, 'presets:2'],
  [LOOM, 'loom:2'],
  [WEAVER, 'weaver:2'],
])

function model(): LayoutModel {
  const base = createEmptyModel('right')
  return {
    ...base,
    primary: [PROFILE, PRESETS, LOOM],
    secondary: [WEAVER],
    hidden: [PRESETS],
    active: { primary: PROFILE, secondary: WEAVER },
    drawers: {
      primary: { open: true, width: 512 },
      secondary: { open: false, width: 348 },
    },
  }
}

function testSerializeAndBuildRoundTrip(): void {
  const original = model()
  const layout = serializeModelToLayout(original, key => liveIds.get(key) ?? null, '2.0.0')

  assertEqual(layout.version, '2.0.0', '13a: serializer keeps version')
  assertArray(layout.tabOrder ?? [], ['profile:2', 'presets:2', 'loom:2', 'weaver:2'], '13b: serializer keeps full order')
  assertEqual(layout.detachedTabs?.[0]?.tabId, 'weaver:2', '13c: serializer keeps secondary membership')
  assertArray(layout.hiddenTabIds ?? [], ['presets:2'], '13d: serializer keeps hidden keys')
  assertEqual(layout.primary?.tabId, 'profile:2', '13e: serializer keeps primary active')
  assertEqual(layout.secondary?.activeTabId, 'weaver:2', '13f: serializer keeps secondary active')

  const rebuilt = buildModelFromLayout(layout, id => {
    for (const [key, liveId] of liveIds) if (liveId === id) return key
    return null
  })

  assertArray(rebuilt.primary, original.primary, '13g: round-trip primary order')
  assertArray(rebuilt.secondary, original.secondary, '13h: round-trip secondary order')
  assertArray(rebuilt.hidden, original.hidden, '13i: round-trip hidden set')
  assertEqual(rebuilt.active.primary, original.active.primary, '13j: round-trip primary active')
  assertEqual(rebuilt.active.secondary, original.active.secondary, '13k: round-trip secondary active')
  assertEqual(rebuilt.drawers.primary.open, original.drawers.primary.open, '13l: round-trip primary open')
  assertEqual(rebuilt.drawers.primary.width, original.drawers.primary.width, '13m: round-trip primary width')
  assertEqual(rebuilt.drawers.secondary.open, original.drawers.secondary.open, '13n: round-trip secondary open')
  assertEqual(rebuilt.drawers.secondary.width, original.drawers.secondary.width, '13o: round-trip secondary width')
  assertEqual(rebuilt.side, original.side, '13p: round-trip drawer side')
}

function testSuffixDriftRoundTrip(): void {
  const original = model()
  const layout = serializeModelToLayout(original, key => liveIds.get(key) ?? null, '2.0.0')
  const currentIds = new Map([
    [PROFILE, 'profile:9'],
    [PRESETS, 'presets:9'],
    [LOOM, 'loom:9'],
    [WEAVER, 'weaver:9'],
  ])
  const rebuilt = buildModelFromLayout(layout, id => {
    const storedBase = id.replace(/:\d+$/, '')
    for (const [key, liveId] of currentIds) {
      if (liveId.replace(/:\d+$/, '') === storedBase) return key
    }
    return null
  })

  assertArray(rebuilt.primary, original.primary, '13q: suffix drift preserves primary order')
  assertArray(rebuilt.secondary, original.secondary, '13r: suffix drift preserves secondary order')
  assertArray(rebuilt.hidden, original.hidden, '13s: suffix drift preserves hidden set')
  assertEqual(rebuilt.active.primary, original.active.primary, '13t: suffix drift preserves primary active')
  assertEqual(rebuilt.active.secondary, original.active.secondary, '13u: suffix drift preserves secondary active')
}

function testMalformedLayoutPreservesModelInvariants(): void {
  const rebuilt = buildModelFromLayout({
    tabOrder: ['profile:2', 'profile:2', 'loom:2'],
    detachedTabs: [{ tabId: 'profile:2', tabTitle: 'Profile', sidebar: 'secondary' }],
    hiddenTabIds: ['unknown:2', 'loom:2'],
    primary: { tabId: 'loom:2' },
    secondary: { activeTabId: 'profile:2' },
  }, id => [...liveIds.entries()].find(([, liveId]) => liveId === id)?.[0] ?? null)

  assertArray(rebuilt.primary, [LOOM], '13v: malformed layout deduplicates placement')
  assertArray(rebuilt.secondary, [PROFILE], '13w: malformed cross-side duplicate is not duplicated')
  assertArray(rebuilt.hidden, [LOOM], '13x: hidden set is limited to known placed tabs')
  assertEqual(rebuilt.active.primary, null, '13y: hidden primary active is cleared')
  assertEqual(rebuilt.active.secondary, PROFILE, '13z: valid secondary active is preserved')
}

function testPartialResolutionDropsOnlyUnavailableTabs(): void {
  const rebuilt = buildModelFromLayout({
    tabOrder: ['profile:2', 'missing:2', 'loom:2'],
    detachedTabs: [{ tabId: 'weaver:2', tabTitle: 'Weaver', sidebar: 'secondary' }],
    hiddenTabIds: ['missing:2', 'loom:2'],
    primary: { tabId: 'missing:2' },
    secondary: { activeTabId: 'weaver:2' },
  }, id => [...liveIds.entries()].find(([, liveId]) => liveId === id)?.[0] ?? null)

  assertArray(rebuilt.primary, [PROFILE, LOOM], '13aa: unresolved tab is omitted from primary')
  assertArray(rebuilt.secondary, [WEAVER], '13ab: resolved detached tab is retained')
  assertArray(rebuilt.hidden, [LOOM], '13ac: hidden set omits unresolved tab')
  assertEqual(rebuilt.active.primary, null, '13ad: unresolved primary active is cleared')
  assertEqual(rebuilt.active.secondary, WEAVER, '13ae: resolved secondary active is retained')
}

function testPartialResolutionSerializerOmitsUnresolvedIds(): void {
  const original = model()
  const layout = serializeModelToLayout(original, key => {
    if (key === PRESETS || key === WEAVER) return null
    return liveIds.get(key) ?? null
  }, '2.0.0')

  assertArray(layout.tabOrder ?? [], ['profile:2', 'loom:2'], '13af: unresolved order ids are omitted')
  assertEqual(layout.detachedTabs?.length, 0, '13ag: unresolved detached tab is omitted')
  assertArray(layout.hiddenTabIds ?? [], [], '13ah: unresolved hidden id is omitted')
  assertEqual(layout.primary?.tabId, 'profile:2', '13ai: resolved active id is serialized')
  assertEqual(layout.secondary?.activeTabId, undefined, '13aj: unresolved active id is omitted')
}

function testNullLayoutBuildsEmptyModel(): void {
  const findKey = (_id: string) => null
  const fromNull = buildModelFromLayout(null as any, findKey)
  const fromUndefined = buildModelFromLayout(undefined as any, findKey)
  assertArray(fromNull.primary, [], '13ak: null layout has empty primary')
  assertArray(fromNull.secondary, [], '13al: null layout has empty secondary')
  assertEqual(fromNull.active.primary, null, '13am: null layout has no primary active')
  assertArray(fromUndefined.primary, [], '13an: undefined layout has empty primary')
}

testSerializeAndBuildRoundTrip()
testSuffixDriftRoundTrip()
testMalformedLayoutPreservesModelInvariants()
testPartialResolutionDropsOnlyUnavailableTabs()
testPartialResolutionSerializerOmitsUnresolvedIds()
testNullLayoutBuildsEmptyModel()

console.log(`persist/layout-model: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exitCode = 1
  process.exit(1)
}
