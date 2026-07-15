// syncHiddenTabsFromHost: re-apply hide after restore + heal write-back.
// Canvas-owned layout.hiddenTabIds is the durable source when host DB is empty.

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

const r1 = syncHiddenTabsFromHost({ writeBack: true })
assert(r1.hiddenIds.includes('spindle:uuid:tab:prompt-viewer:1'), 'H1: healed to :1')
assert(r1.hiddenIds.includes('weaver'), 'H1: weaver stays hidden')
assert(r1.wroteBack, 'H1: write-back when ids changed')
assertEqual(
  (_patchCalls[0]?.hiddenTabIds as string[])?.includes('spindle:uuid:tab:prompt-viewer:1'),
  true,
  'H1: patch wrote healed id',
)
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
const r2 = syncHiddenTabsFromHost({ writeBack: true })
assert(!r2.wroteBack, 'H2: no write-back when ids match live')
assertEqual(_patchCalls.length, 0, 'H2: no patch calls')

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
const r6 = syncHiddenTabsFromHost({ writeBack: true })
assert(r6.hiddenIds.includes('council'), 'H6: council from canvas layout')
assert(r6.hiddenIds.includes('cortex'), 'H6: cortex from canvas layout')
assert(r6.hiddenIds.includes('create'), 'H6: create from canvas layout')
assert(_appliedSecondary.includes('council'), 'H6: apply secondary council')
assert(_appliedMirror.includes('create'), 'H6: apply mirror create')
assert(r6.wroteBack, 'H6: write-back host when canvas has ids host lacks')
assertEqual(
  (_patchCalls[0]?.hiddenTabIds as string[])?.includes('council'),
  true,
  'H6: host patch includes council',
)
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

console.log(`PASS: ${passed}`)
if (failed) {
  console.log(`FAILED: ${failed}`)
  process.exit(1)
}
