// Tests for configure-catalog.ts
import {
  BUILTIN_CATALOG_VERSION,
  BUILTIN_TAB_IDS,
  CORE_HIDE_LOCKED,
  getBuiltinCatalog,
  getExtensionCatalog,
  getFullCatalog,
  filterCatalogToLive,
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
// humanizeTabId — host title parity
// =====================================================================
assertEqual(humanizeTabId('profile'), 'Profile', 'humanize profile')
assertEqual(humanizeTabId('presets'), 'Reasoning', 'humanize presets')
assertEqual(humanizeTabId('worldinfo'), 'World Info', 'humanize worldinfo')
assertEqual(humanizeTabId('imagegen'), 'Image Generation', 'humanize imagegen')
assertEqual(humanizeTabId('databank'), 'Databank', 'humanize databank')
assertEqual(humanizeTabId('ooc'), 'OOC', 'humanize ooc preserves acronym')
assertEqual(humanizeTabId('multiplayer'), 'Multiplayer', 'humanize multiplayer')
assertEqual(humanizeTabId('browser'), 'Pack Browser', 'humanize browser')
assertEqual(humanizeTabId('cortex'), 'Memory Cortex', 'humanize cortex')
assertEqual(humanizeTabId('create'), 'Creator Workshop', 'humanize create')
assertEqual(humanizeTabId('prompt'), 'Composition', 'humanize prompt')
assertEqual(humanizeTabId('feedback'), 'Council Feedback', 'humanize feedback')
assertEqual(humanizeTabId('regex'), 'Regex Scripts', 'humanize regex')
assertEqual(humanizeTabId('branches'), 'Branch Tree', 'humanize branches')
assertEqual(humanizeTabId('spindle'), 'Extensions', 'humanize spindle')

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
  assertEqual(profileTab.title, 'Profile', 'profile title is Profile')
  assert(profileTab.description === 'View and edit the active character', 'profile has description')

  const presetsTab = catalog.find(t => t.id === 'presets')!
  assertEqual(presetsTab.title, 'Reasoning', 'presets title is Reasoning')
  assert(presetsTab.description === 'Configure reasoning, chain-of-thought, and prompt behavior', 'presets has description')

  const browserTab = catalog.find(t => t.id === 'browser')!
  assertEqual(browserTab.title, 'Pack Browser', 'browser title is Pack Browser')

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
     { id: 'my-ext', extensionId: 'ext1', title: 'My Extension', description: 'My extension description', root: STUB_ROOT },
    { id: 'ext2', extensionId: 'ext2', title: 'Second Ext', root: STUB_ROOT },
  ])
  const extCatalog = getExtensionCatalog()
  assertEqual(extCatalog.length, 2, 'extension catalog has 2 entries')

  assertEqual(extCatalog[0].id, 'my-ext', 'first ext id')
  assertEqual(extCatalog[0].kind, 'extension', 'first ext kind')
  assertEqual(extCatalog[0].title, 'My Extension', 'first ext title')
  assertEqual(extCatalog[0].description, 'My extension description', 'first ext description')
  assertEqual(extCatalog[0].extensionId, 'ext1', 'first ext extensionId')
  assert(!extCatalog[0].hideLocked, 'extension tabs are never hideLocked')

  assertEqual(extCatalog[1].id, 'ext2', 'second ext id')
  assertEqual(extCatalog[1].title, 'Second Ext', 'second ext title')
}

// =====================================================================
// getExtensionCatalog — live inventory mixes built-ins + extensions
// (2026-08-16): the observer-based getDrawerTabs() returns host built-ins
// (bare data-tab-id) alongside extension tabs. Built-ins must NOT be
// labeled as extensions in the Configure Tabs UI.
// =====================================================================
{
  setupStore()
  __setDrawerTabsForTest([
    // Host built-in observed via data-tab-id: bare id, no extension
    // class, empty extensionId → excluded.
    { id: 'profile', extensionId: '', title: 'Profile', root: { className: 'sidebar-ux-tab-btn' } as any },
    { id: 'presets', extensionId: '', title: 'Reasoning', root: { className: '' } as any },
    // Tagged spindle extension → included.
    { id: 'spindle:foo:tab:Bar:0', extensionId: 'foo', title: 'Bar', root: { className: '' } as any },
    // Untagged host extension button (title id + extension class) → included.
    { id: 'LumiBooks', extensionId: '', title: 'LumiBooks', root: { className: '_tabBtn_1 _tabBtnExtension_2' } as any },
  ])
  const extCatalog = getExtensionCatalog()
  assertEqual(extCatalog.length, 2, 'builtins excluded from extension catalog')
  assertEqual(extCatalog[0].id, 'spindle:foo:tab:Bar:0', 'tagged ext id')
  assertEqual(extCatalog[0].kind, 'extension', 'tagged ext kind')
  assertEqual(extCatalog[1].id, 'LumiBooks', 'untagged ext id (class match)')
  assertEqual(extCatalog[1].kind, 'extension', 'untagged ext kind')
}

// =====================================================================
// getFullCatalog — no builtin duplication when the live inventory
// contains the same builtin ids (regression: the modal previously showed
// every tab as an Extension because the extension-kinded duplicate
// overwrote the builtin entry in the display map).
// =====================================================================
{
  setupStore()
  __setDrawerTabsForTest([
    { id: 'profile', extensionId: '', title: 'Profile', root: { className: 'sidebar-ux-tab-btn' } as any },
    { id: 'spindle:foo:tab:Bar:0', extensionId: 'foo', title: 'Bar', root: { className: '' } as any },
  ])
  const full = getFullCatalog()
  assertEqual(full.length, BUILTIN_TAB_IDS.length + 1, 'full catalog: builtins once + extensions once')
  const ids = full.map(t => t.id)
  assertEqual(ids.filter(id => id === 'profile').length, 1, 'profile appears exactly once')
  assertEqual(ids.filter(id => id === 'spindle:foo:tab:Bar:0').length, 1, 'extension appears exactly once')

  const profileTab = full.find(t => t.id === 'profile')!
  assertEqual(profileTab.kind, 'builtin', 'observed builtin stays kind=builtin')
  assert(profileTab.hideLocked, 'observed builtin keeps hideLocked (not overwritten)')
  assertEqual(profileTab.title, 'Profile', 'observed builtin keeps builtin title')
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
// filterCatalogToLive (2026-07-31)
// =====================================================================
// The static builtin catalog can contain tabs absent from a given Lumiverse
// instance. A draft carrying such phantom ids fails the commit resolution
// guard and blocks ALL Configure/DnD commits. The filter keeps entries the
// host can resolve (live inventory) or the owned model knows (liveId
// projection — covers DOM-placed builtins whose host button was removed).
{
  const catalog: CatalogTab[] = [
    { id: 'loom', kind: 'builtin', title: 'Loom', description: '', hideLocked: false },
    { id: 'create', kind: 'builtin', title: 'Create', description: '', hideLocked: false },
    { id: 'spindle:foo:tab:Bar:0', kind: 'extension', title: 'Bar', description: '', hideLocked: false },
  ]
  const host = { findKey: (id: string) => (id === 'loom' || id === 'spindle:foo:tab:Bar:0' ? id : null) }

  // Phantom 'create' kept only via the model's liveId projection (order
  // preserved); live-resolvable ids kept.
  const filtered = filterCatalogToLive(catalog, host, new Set(['create']))
  assertEqual(filtered.map(t => t.id).join(','), 'loom,create,spindle:foo:tab:Bar:0', 'FL1: phantom dropped, live + model-known kept')

  // No host → unchanged (pre-bootstrap legacy behavior).
  assertEqual(filterCatalogToLive(catalog, null, new Set()).length, 3, 'FL2: no host → catalog unchanged')

  // Empty projection → only live-resolvable ids remain.
  const onlyLive = filterCatalogToLive(catalog, host, new Set())
  assertEqual(onlyLive.map(t => t.id).join(','), 'loom,spindle:foo:tab:Bar:0', 'FL3: no model projection → live only')
}

// =====================================================================
// Summary
// =====================================================================
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}/${passed + failed}`)
