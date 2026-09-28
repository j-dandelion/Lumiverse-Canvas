// Custom assertion harness — see Chronicle testing-conventions.md
//
// B1 (layout-mode fixes, 2026-09-19): boot closed-set backstop (F2).
//
// B1-1: a boot blob carrying `closedTabIds` while OS mode is OFF hydrates
// model.closed with no Start menu to reopen those windows — the gate in
// `bootstrapFromLayout` must clear it. OS mode ON keeps it. The gate keys on
// the LIVE setting at boot (no opts.osActive supplied).
//
// B1-2: the cleared set must be stable through the pending window —
// `mergeResolvedInto` carries `closed` via `...current`, so a late
// pending-key resolve (enqueueHostSync merge) must NOT resurrect closed
// membership from a rebuild of the original blob.
let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    console.error(`FAIL: ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    failed++
  } else {
    passed++
  }
}

import { mock } from 'bun:test'

mock.module('../../sidebar/secondary', () => ({
  reassignSecondaryTabsFromModel: async () => {},
  unassignSecondaryTabsNotInModel: async () => {},
}))
mock.module('../../sidebar/main-persist', () => ({
  holdSecondaryPlacementReveal: () => {},
  releaseSecondaryPlacementReveal: () => {},
  ensureRestoredPrimaryTab: () => {},
  ensureHostContentParkedPublic: () => {},
}))
mock.module('../../sidebar/main-mirror-drawer', () => ({
  isMainMirrorActive: () => false,
  ensureHostContentParkedPublic: () => {},
}))

import { bootstrapFromLayout, flush, shutdown, getModel } from '../dispatch'
import { FakeHost, type LiveTab } from '../../host/fake/implementation'
import { builtinKey, extensionKey, type TabKey, type Side } from '../../core/model'
import { hydrateSettings } from '../../settings/state'

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

const LOOM = builtinKey('loom')
const WEAVER = builtinKey('weaver')
const HONE = builtinKey('Hone')

// ── B1-1: closedTabIds + osMode off → cleared; osMode on → kept ──
{
  const host = new FakeHost([
    makeLiveTab(LOOM, 'loom', 'primary', { activeInPrimary: true }),
    makeLiveTab(WEAVER, 'weaver', 'primary'),
  ])
  const layout = {
    version: 't',
    primary: { open: false, width: 420, tabId: 'loom' },
    secondary: { open: false, width: 420, activeTabId: null },
    tabOrder: ['loom', 'weaver'],
    detachedTabs: [],
    hiddenTabIds: [],
    closedTabIds: ['weaver'],
    drawerSide: 'left' as const,
  }

  // osMode off (patched explicitly so the gate does not depend on defaults).
  hydrateSettings({ osMode: false })
  shutdown()
  bootstrapFromLayout(layout, host, 't')
  await flush()
  let model = getModel()
  assert(model != null, 'B1-1a: model present after boot')
  assertEqual(
    model!.closed.length, 0,
    'B1-1b: osMode off → OS closed-set dropped on boot (F2 backstop)',
  )
  shutdown()

  // osMode on → the same blob keeps its closed set.
  hydrateSettings({ osMode: true })
  shutdown()
  bootstrapFromLayout(layout, host, 't')
  await flush()
  model = getModel()
  assert(model != null, 'B1-1c: model present after OS-mode boot')
  assert(
    model!.closed.includes(WEAVER),
    'B1-1d: osMode on → closed set kept (WEAVER in model.closed)',
  )
  shutdown()
  hydrateSettings(null)
}

// ── B1-2: after the F2 clear, a late pending-key resolve does not resurrect closed ──
{
  // Host knows loom + weaver only — Hone's button has NOT registered yet,
  // so the restore arms _pendingLayout and converges via enqueueHostSync.
  const host = new FakeHost([
    makeLiveTab(LOOM, 'loom', 'primary', { activeInPrimary: true }),
    makeLiveTab(WEAVER, 'weaver', 'primary'),
  ])
  const layout = {
    version: 't',
    primary: { open: false, width: 420, tabId: 'loom' },
    secondary: { open: false, width: 420, activeTabId: 'Hone' },
    tabOrder: ['loom', 'weaver', 'Hone'],
    detachedTabs: [{ tabId: 'Hone', tabTitle: 'Hone', sidebar: 'secondary' as const }],
    hiddenTabIds: [],
    closedTabIds: ['weaver'],
    drawerSide: 'left' as const,
  }

  hydrateSettings({ osMode: false })
  shutdown()
  bootstrapFromLayout(layout, host, 't')
  await flush()
  let model = getModel()
  assert(model != null, 'B1-2a: model present after partial boot')
  assertEqual(
    model!.closed.length, 0,
    'B1-2b: F2 gate cleared closed on the pending boot',
  )
  assert(
    model!.primary.includes(WEAVER) && model!.secondary.length === 0,
    'B1-2c: partial restore armed — Hone unresolved, weaver resolved',
  )

  // Late key registers → world change → enqueueHostSync rebuilds from the
  // ORIGINAL blob (closedTabIds: ['weaver']) and merges. The rebuild's
  // closed set must not leak: mergeResolvedInto carries closed via ...current.
  host.addTab(HONE, 'Hone', 'secondary')
  await flush()
  model = getModel()
  assert(model != null, 'B1-2d: model present after the late resolve')
  assert(
    model!.secondary.includes(HONE),
    'B1-2e: late key merged into secondary (merge ran)',
  )
  assertEqual(
    model!.closed.length, 0,
    'B1-2f: late-key resolve does NOT resurrect closed membership (closed carried via ...current)',
  )
  shutdown()
  hydrateSettings(null)
}

// ── B1-3 (LUMI-16b): the START-MENU-only menuHidden set follows the same
// backstop — dropped on a non-OS boot, kept while OS mode is on, and never
// resurrected by a late pending-key resolve. ──
{
  const host = new FakeHost([
    makeLiveTab(LOOM, 'loom', 'primary', { activeInPrimary: true }),
    makeLiveTab(WEAVER, 'weaver', 'primary'),
  ])
  const layout = {
    version: 't',
    primary: { open: false, width: 420, tabId: 'loom' },
    secondary: { open: false, width: 420, activeTabId: null },
    tabOrder: ['loom', 'weaver'],
    detachedTabs: [],
    hiddenTabIds: [],
    menuHiddenTabIds: ['weaver'],
    drawerSide: 'left' as const,
  }

  hydrateSettings({ osMode: false })
  shutdown()
  bootstrapFromLayout(layout, host, 't')
  await flush()
  let model = getModel()
  assert(model != null, 'B1-3a: model present after non-OS boot')
  assertEqual(
    model!.menuHidden.length, 0,
    'B1-3b: osMode off → menu-hidden set dropped on boot (Start menu is OS chrome)',
  )
  shutdown()

  hydrateSettings({ osMode: true })
  shutdown()
  bootstrapFromLayout(layout, host, 't')
  await flush()
  model = getModel()
  assert(model != null, 'B1-3c: model present after OS-mode boot')
  assert(
    model!.menuHidden.includes(WEAVER),
    'B1-3d: osMode on → menu-hidden set kept (WEAVER menu-hidden in the Start menu)',
  )
  assertEqual(
    model!.hidden.length, 0,
    'B1-3e: menu-hidden hydration never touches the strip hidden set',
  )
  shutdown()
  hydrateSettings(null)
}

if (failed > 0) {
  console.error(`FAILED: ${failed}`)
  process.exitCode = 1
}
console.log(`PASS: ${passed}/${passed + failed}`)
