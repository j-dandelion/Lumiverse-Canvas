// Tests for configure-catalog.ts
import {
  BUILTIN_CATALOG_VERSION,
  BUILTIN_TAB_IDS,
  CORE_HIDE_LOCKED,
  getBuiltinCatalog,
  getExtensionCatalog,
  getFullCatalog,
  isHideLocked,
  humanizeTabId,
  type CatalogTab,
} from '../configure-catalog'
import { __setDrawerTabsForTest, __setStoreSnapshotForTest } from '../../store'

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed++ }
}

// Stub root — the cache never accesses it.
const STUB_ROOT = {} as any

// Before each test group that calls getExtensionCatalog/getFullCatalog,
// set a store snapshot so findStoreData() returns early without hitting DOM.
function setupStore() {
  __setStoreSnapshotForTest({ drawerOpen: true, drawerTabs: [] })
}

// =====================================================================
// BUILTIN_CATALOG_VERSION is a stable string
// =====================================================================
assertEqual(BUILTIN_CATALOG_VERSION, 'lumiverse-drawer-tabs-2026-07', 'BUILTIN_CATALOG_VERSION string')

// =====================================================================
// BUILTIN_TAB_IDS has the expected count and first/last entries
// =====================================================================
assert(BUILTIN_TAB_IDS.length > 0, 'builtin tab ids is non-empty')
assertEqual(BUILTIN_TAB_IDS[0], 'profile', 'first builtin tab is profile')
assertEqual(BUILTIN_TAB_IDS[BUILTIN_TAB_IDS.length - 1], 'spindle', 'last builtin tab is spindle')

// =====================================================================
// CORE_HIDE_LOCKED has exactly 9 entries
// =====================================================================
assertEqual(CORE_HIDE_LOCKED.size, 9, 'CORE_HIDE_LOCKED size is 9')
assert(CORE_HIDE_LOCKED.has('profile'), 'profile is hide-locked')
assert(CORE_HIDE_LOCKED.has('presets'), 'presets is hide-locked')
assert(CORE_HIDE_LOCKED.has('loom'), 'loom is hide-locked')
assert(CORE_HIDE_LOCKED.has('characters'), 'characters is hide-locked')
assert(CORE_HIDE_LOCKED.has('personas'), 'personas is hide-locked')
assert(CORE_HIDE_LOCKED.has('branches'), 'branches is hide-locked')
assert(CORE_HIDE_LOCKED.has('spindle'), 'spindle is hide-locked')
assert(CORE_HIDE_LOCKED.has('theme'), 'theme is hide-locked')
assert(CORE_HIDE_LOCKED.has('lorebook'), 'lorebook is hide-locked')

assert(!CORE_HIDE_LOCKED.has('weaver'), 'weaver is NOT hide-locked')
assert(!CORE_HIDE_LOCKED.has('browser'), 'browser is NOT hide-locked')
assert(!CORE_HIDE_LOCKED.has('multiplayer'), 'multiplayer is NOT hide-locked')
assert(!CORE_HIDE_LOCKED.has('cortex'), 'cortex is NOT hide-locked')

// =====================================================================
// isHideLocked
// =====================================================================
assert(isHideLocked('profile'), 'isHideLocked profile')
assert(isHideLocked('spindle'), 'isHideLocked spindle')
assert(!isHideLocked('databank'), 'isHideLocked databank is false')
assert(!isHideLocked('imagegen'), 'isHideLocked imagegen is false')
assert(!isHideLocked('nonexistent'), 'isHideLocked nonexistent is false')

// =====================================================================
// humanizeTabId
// =====================================================================
assertEqual(humanizeTabId('profile'), 'Profile', 'humanize profile')
assertEqual(humanizeTabId('presets'), 'Presets', 'humanize presets')
assertEqual(humanizeTabId('worldinfo'), 'World Info', 'humanize worldinfo')
assertEqual(humanizeTabId('imagegen'), 'Image Gen', 'humanize imagegen')
assertEqual(humanizeTabId('databank'), 'Data Bank', 'humanize databank')
assertEqual(humanizeTabId('ooc'), 'OOC', 'humanize ooc preserves acronym')
assertEqual(humanizeTabId('multiplayer'), 'Multiplayer', 'humanize multiplayer')

// =====================================================================
// getBuiltinCatalog
// =====================================================================
{
  const catalog = getBuiltinCatalog()
  assertEqual(catalog.length, BUILTIN_TAB_IDS.length, 'builtin catalog length matches BUILTIN_TAB_IDS')

  for (const tab of catalog) {
    assertEqual(tab.kind, 'builtin', `tab "${tab.id}" is kind=builtin`)
    assert(typeof tab.title === 'string' && tab.title.length > 0, `tab "${tab.id}" has a non-empty title`)
    assertEqual(tab.extensionId, undefined, `tab "${tab.id}" has no extensionId`)
  }

  for (let i = 0; i < catalog.length; i++) {
    assertEqual(catalog[i].id, BUILTIN_TAB_IDS[i], `builtin catalog order at index ${i}`)
  }

  const profileTab = catalog.find(t => t.id === 'profile')!
  assert(profileTab.hideLocked, 'profile is hideLocked in catalog')

  const weaverTab = catalog.find(t => t.id === 'weaver')!
  assert(!weaverTab.hideLocked, 'weaver is not hideLocked in catalog')
}

// =====================================================================
// getExtensionCatalog — returns empty when no drawer tabs
// =====================================================================
{
  setupStore()
  __setDrawerTabsForTest(null)
  const extCatalog = getExtensionCatalog()
  assertEqual(extCatalog.length, 0, 'extension catalog is empty when no drawer tabs')
}

// =====================================================================
// getExtensionCatalog — with injected tabs
// =====================================================================
{
  setupStore()
  __setDrawerTabsForTest([
    { id: 'my-ext', extensionId: 'ext1', title: 'My Extension', root: STUB_ROOT },
    { id: 'ext2', extensionId: 'ext2', title: 'Second Ext', root: STUB_ROOT },
  ])
  const extCatalog = getExtensionCatalog()
  assertEqual(extCatalog.length, 2, 'extension catalog has 2 entries')

  assertEqual(extCatalog[0].id, 'my-ext', 'first ext id')
  assertEqual(extCatalog[0].kind, 'extension', 'first ext kind')
  assertEqual(extCatalog[0].title, 'My Extension', 'first ext title')
  assertEqual(extCatalog[0].extensionId, 'ext1', 'first ext extensionId')
  assert(!extCatalog[0].hideLocked, 'extension tabs are never hideLocked')

  assertEqual(extCatalog[1].id, 'ext2', 'second ext id')
  assertEqual(extCatalog[1].title, 'Second Ext', 'second ext title')
}

// =====================================================================
// getFullCatalog — builtins first, then extensions
// =====================================================================
{
  setupStore()
  __setDrawerTabsForTest([
    { id: 'ext-a', extensionId: 'ext-a', title: 'Ext A', root: STUB_ROOT },
  ])
  const full = getFullCatalog()
  for (let i = 0; i < BUILTIN_TAB_IDS.length; i++) {
    assertEqual(full[i].kind, 'builtin', `full[${i}] is builtin`)
  }
  assertEqual(full[full.length - 1].kind, 'extension', 'last entry is extension')
  assertEqual(full[full.length - 1].id, 'ext-a', 'last entry id')
}

// =====================================================================
// getFullCatalog with no extensions
// =====================================================================
{
  setupStore()
  __setDrawerTabsForTest(null)
  const full = getFullCatalog()
  assertEqual(full.length, BUILTIN_TAB_IDS.length, 'full catalog has only builtins when no extensions')
}

// =====================================================================
// Summary
// =====================================================================
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}/${passed + failed}`)
