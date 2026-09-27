// syncHiddenTabsFromHost: re-apply hide after restore + heal.
// S2: no host write-back — the model owns `hidden`; the Canvas
// layout.hiddenTabIds copy is the durable hydrate/converge bridge.

import { mock } from 'bun:test'

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { failed++; console.error(`FAIL: ${msg} — expected ${String(expected)}, got ${String(actual)}`) }
}

// ── Host settings mock ──
let _hostSettings: any = { side: 'right', tabOrder: [], hiddenTabIds: [] as string[] }
let _patchCalls: any[] = []
let _appliedSecondary: string[] = []
let _appliedMirror: string[] = []

mock.module('../../dom/host-settings', () => ({
  getHostDrawerSettings: () => _hostSettings,
  patchHostDrawerSettings: (partial: any) => {
    _patchCalls.push(partial)
    _hostSettings = { ..._hostSettings, ...partial }
    return true
  },
  clearHostSettingsCache: () => {},
  isHostDrawerSettingsWritable: () => true,
  __setHostSetSettingForTest: () => {},
}))

mock.module('../../store', () => ({
  getDrawerTabs: () => [
    {
      id: 'spindle:uuid:tab:prompt-viewer:1',
      title: 'Prompt Viewer',
      extensionId: 'uuid',
      root: {},
    },
  ],
  findStoreData: () => {},
  getStoreSnapshot: () => null,
  getMainDrawerSide: () => 'right',
  isMainDrawerOpen: () => true,
}))

// Avoid pulling real secondary / buttons DOM graph: mock apply only.
mock.module('../buttons', () => ({
  applyHiddenTabIdsToSecondary: (ids: ReadonlySet<string>) => {
    _appliedSecondary = [...ids]
  },
  applyHiddenTabIdsToMirror: (ids: ReadonlySet<string>) => {
    _appliedMirror = [...ids]
  },
  applyHiddenTabIdsToHostMain: () => {},
  hideMainTabButton: () => {},
  showMainTabButton: () => {},
  updateDrawerTabVisibility: () => {},
  addSecondaryTabButton: () => {},
  removeSecondaryTabButton: () => {},
  showSecondaryTab: () => {},
  findMainTabButton: () => null,
  clearSecondaryTabButtonActive: () => {},
  reorderSecondaryTabButtons: () => {},
  reorderMainMirrorTabButtons: () => {},
  reorderHostMainTabButtons: () => {},
  cssEscape: (s: string) => s,
  readMainButtonShortName: () => '',
}))

mock.module('../../sidebar/secondary', () => ({
  getSecondaryTabList: () => null,
  getSecondaryWrapper: () => null,
  getSecondaryPanel: () => null,
  isSecondarySidebarOpen: () => false,
  openSecondarySidebar: () => {},
  closeSecondarySidebar: () => {},
  PUZZLE_ICON_SVG: '',
  SECONDARY_WIDTH_VAR: '--x',
  animateWrapper: () => {},
  getClosedTransformPx: () => 0,
}))

// Dispatch seam (lazy-imported by syncHiddenTabsFromHost for the OS closed∧
// unhidden suppression pass). Default: no model → merge is a no-op.
let _dispatchModel: { hidden: Set<string>; closed: string[] } | null = null
let _resolveMap = new Map<string, string>()
mock.module('../../recon/dispatch', () => ({
  getModel: () => _dispatchModel,
  getHost: () => ({ resolve: (key: string) => _resolveMap.get(key) ?? null }),
}))

const {
  syncHiddenTabsFromHost,
  resolveHiddenTabIdsForDraft,
  setCanvasHiddenTabIds,
  getCanvasHiddenTabIds,
  hydrateCanvasHiddenFromLayout,
  __resetCanvasHiddenTabIdsForTest,
  mergeHiddenTabIdLists,
} = await import('../hidden-tabs')

function resetCanvas() {
  __resetCanvasHiddenTabIdsForTest()
}

// H1: after hard refresh, stored :2 heals to live :1 and write-backs + applies
resetCanvas()
_hostSettings = {
  side: 'right',
  tabOrder: [],
  hiddenTabIds: ['spindle:uuid:tab:prompt-viewer:2', 'weaver'],
}
_patchCalls = []
_appliedSecondary = []
_appliedMirror = []

const r1 = syncHiddenTabsFromHost()
assert(r1.hiddenIds.includes('spindle:uuid:tab:prompt-viewer:1'), 'H1: healed to :1')
assert(r1.hiddenIds.includes('weaver'), 'H1: weaver stays hidden')
// S2: no host write-back — the healed ids land on the Canvas bridge copy.
assertEqual(_patchCalls.length, 0, 'H1: no host patch (write-back deleted)')
assert(getCanvasHiddenTabIds().includes('spindle:uuid:tab:prompt-viewer:1'), 'H1: canvas bridge copy keeps healed id')
assert(getCanvasHiddenTabIds().includes('weaver'), 'H1: canvas bridge copy keeps weaver')
assert(_appliedSecondary.includes('spindle:uuid:tab:prompt-viewer:1'), 'H1: apply secondary healed')
assert(_appliedMirror.includes('weaver'), 'H1: apply mirror weaver')

// H2: no write-back when already healed (and canvas matches host)
resetCanvas()
_patchCalls = []
_hostSettings = {
  side: 'right',
  tabOrder: [],
  hiddenTabIds: ['spindle:uuid:tab:prompt-viewer:1', 'weaver'],
}
setCanvasHiddenTabIds(['spindle:uuid:tab:prompt-viewer:1', 'weaver'])
const r2 = syncHiddenTabsFromHost()
assertEqual(_patchCalls.length, 0, 'H2: no write-back when ids match live')
assertEqual(r2.hiddenIds.includes('spindle:uuid:tab:prompt-viewer:1'), true, 'H2: canvas copy unchanged')

// H3: resolveHiddenTabIdsForDraft for Configure open
{
  const healed = resolveHiddenTabIdsForDraft(
    ['spindle:uuid:tab:prompt-viewer:2'],
    ['spindle:uuid:tab:prompt-viewer:1', 'browser'],
  )
  assertEqual(healed[0], 'spindle:uuid:tab:prompt-viewer:1', 'H3: draft heal')
}

// H4: empty host + empty canvas → empty apply sets
resetCanvas()
_hostSettings = { side: 'right', tabOrder: [], hiddenTabIds: [] }
_appliedSecondary = ['stale']
const r4 = syncHiddenTabsFromHost()
assertEqual(r4.hiddenIds.length, 0, 'H4: empty hidden')
assertEqual(_appliedSecondary.length, 0, 'H4: apply empty secondary set')

// H5: incomplete live set must NOT wipe unmatched extension hides (draft/write)
{
  const healedDraft = resolveHiddenTabIdsForDraft(
    ['spindle:missing:tab:x:9', 'weaver'],
    ['weaver'],
  )
  assert(healedDraft.includes('spindle:missing:tab:x:9'), 'H5: draft keeps unmatched')
  assert(healedDraft.includes('weaver'), 'H5: draft keeps weaver')
}

// H6: host empty but Canvas layout has builtins → apply + host write-back
// (the live user bug: council/cortex/create reappear after hard refresh)
resetCanvas()
_hostSettings = { side: 'right', tabOrder: [], hiddenTabIds: [] }
_patchCalls = []
_appliedSecondary = []
_appliedMirror = []
hydrateCanvasHiddenFromLayout({ hiddenTabIds: ['council', 'cortex', 'create'] })
const r6 = syncHiddenTabsFromHost()
assert(r6.hiddenIds.includes('council'), 'H6: council from canvas layout')
assert(r6.hiddenIds.includes('cortex'), 'H6: cortex from canvas layout')
assert(r6.hiddenIds.includes('create'), 'H6: create from canvas layout')
assert(_appliedSecondary.includes('council'), 'H6: apply secondary council')
assert(_appliedMirror.includes('create'), 'H6: apply mirror create')
// S2: no host write-back — the Canvas bridge copy carries the hides.
assertEqual(_patchCalls.length, 0, 'H6: no host patch (write-back deleted)')
assertEqual(getCanvasHiddenTabIds().includes('council'), true, 'H6: canvas retains after sync')

// H7: hydrate ignores missing field (does not wipe)
resetCanvas()
setCanvasHiddenTabIds(['council'])
hydrateCanvasHiddenFromLayout({ detachedTabs: [] })
assertEqual(getCanvasHiddenTabIds()[0], 'council', 'H7: missing field does not wipe')

// H8: hydrate empty array clears
hydrateCanvasHiddenFromLayout({ hiddenTabIds: [] })
assertEqual(getCanvasHiddenTabIds().length, 0, 'H8: empty array clears canvas hide')

// H9: merge lists de-dupes
{
  const m = mergeHiddenTabIdLists(['a', 'b'], ['b', 'c'])
  assertEqual(m.join(','), 'a,b,c', 'H9: merge de-dupes')
}

// H10/H11: OS closed∧unhidden suppression (D3). The dispatch-driven async
// pass re-applies with the closed set merged into the DOM applies only —
// the Canvas copy (returned hiddenIds) stays pure hidden-list truth.
const flushAsync = () => new Promise<void>((r) => setTimeout(r, 0))

// H10: closed∧unhidden live id is suppressed on strips, NOT added to canvas.
resetCanvas()
_dispatchModel = { hidden: new Set<string>(), closed: ['ext:ec535e94/Hone'] }
_resolveMap = new Map([['ext:ec535e94/Hone', 'spindle:uuid:tab:prompt-viewer:1']])
_appliedSecondary = []
_appliedMirror = []
_hostSettings = { side: 'right', tabOrder: [], hiddenTabIds: [] }
{
  const r = syncHiddenTabsFromHost()
  assertEqual(r.hiddenIds.includes('spindle:uuid:tab:prompt-viewer:1'), false, 'H10: canvas copy has NO closed residue (immediate pass, pre-merge)')
  await flushAsync()
  assert(_appliedSecondary.includes('spindle:uuid:tab:prompt-viewer:1'), 'H10: secondary strip suppresses closed∧unhidden id')
  assert(_appliedMirror.includes('spindle:uuid:tab:prompt-viewer:1'), 'H10b: mirror strip suppresses closed∧unhidden id')
  assertEqual(getCanvasHiddenTabIds().includes('spindle:uuid:tab:prompt-viewer:1'), false, 'H10c: canvas copy stays PURE after the async merge pass (no hiddenTabIds persist leak)')
}

// H11: closed∧hidden keys are skipped by the merge (hidden-set apply covers
// them) — and with an empty closed set the merge pass is a plain re-apply.
resetCanvas()
_dispatchModel = { hidden: new Set<string>(['ext:ec535e94/Hone']), closed: ['ext:ec535e94/Hone'] }
_resolveMap = new Map([['ext:ec535e94/Hone', 'spindle:uuid:tab:prompt-viewer:1']])
setCanvasHiddenTabIds(['spindle:uuid:tab:prompt-viewer:1'])
await flushAsync()
_appliedSecondary = []
_appliedMirror = []
{
  const r = syncHiddenTabsFromHost()
  assert(r.hiddenIds.includes('spindle:uuid:tab:prompt-viewer:1'), 'H11: hidden∧closed id stays in the canvas copy via the hidden list')
  await flushAsync()
  assert(_appliedSecondary.includes('spindle:uuid:tab:prompt-viewer:1'), 'H11b: hidden∧closed id still applied (via hidden list, not double-added)')
}

// H12: getModel() throwing / unavailable → plain apply already ran, no crash.
resetCanvas()
_dispatchModel = null
_resolveMap = new Map()
_hostSettings = { side: 'right', tabOrder: [], hiddenTabIds: ['weaver'] }
await flushAsync()
{
  const r = syncHiddenTabsFromHost()
  assert(r.hiddenIds.includes('weaver'), 'H12: no model → merge no-op, canvas copy unaffected')
  await flushAsync()
}

_dispatchModel = null
_resolveMap = new Map()

console.log(`PASS: ${passed}`)
if (failed) {
  console.log(`FAILED: ${failed}`)
  process.exit(1)
}
