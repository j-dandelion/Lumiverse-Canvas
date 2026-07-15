// syncHiddenTabsFromHost: re-apply host hide after restore + heal write-back.
//
// Mocks host-settings + store + buttons apply; pure heal is covered in
// tab-id-heal.test.ts.

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
  // re-exports unused by hidden-tabs but may be demanded if other imports load
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
} = await import('../hidden-tabs')

// H1: after hard refresh, stored :2 heals to live :1 and write-backs + applies
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

// H2: no write-back when already healed
_patchCalls = []
_hostSettings = {
  side: 'right',
  tabOrder: [],
  hiddenTabIds: ['spindle:uuid:tab:prompt-viewer:1', 'weaver'],
}
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

// H4: empty host hidden → empty apply sets
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

console.log(`PASS: ${passed}`)
if (failed) {
  console.log(`FAILED: ${failed}`)
  process.exit(1)
}
