// Mode-layout profile tests (2026-08-16).
//
// Proves two things about the single/dual mode layout preservation:
//   1. THE POISON: buildModelFromLayout CANNOT restore a secondary layout
//      whose detachedTabs are TabKeys ('builtin:loom') — host.findKey's
//      assignment-map fallback turns them into garbage 'ext:…' keys, so the
//      model's secondary ends up empty/garbage and the dual layout is lost.
//      A layout keyed by LIVE ids ('loom') restores cleanly. This is why the
//      disable-path snapshots were fixed to store live ids.
//   2. The mode-profile builders (buildSingleLayoutFromBaseline /
//      buildSingleLayoutFromLiveHost) produce valid single-drawer layouts
//      that restore into an all-primary model.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else {
    console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    failed++
  }
}

import { builtinKey, createEmptyModel } from '../../core/model'
import { buildModelFromLayout } from '../../persist/layout-model'
import { FakeHost } from '../../host/fake/implementation'

const PROFILE = builtinKey('profile')
const REGEX = builtinKey('regex')
const LOOM = builtinKey('loom')

const host = new FakeHost([
  { key: PROFILE, liveId: 'profile', location: 'primary', hidden: false, activeInPrimary: true, activeInSecondary: false, hasContentRoot: true, isBuiltin: true },
  { key: REGEX, liveId: 'regex', location: 'primary', hidden: false, activeInPrimary: false, activeInSecondary: false, hasContentRoot: true, isBuiltin: true },
  { key: LOOM, liveId: 'loom', location: 'primary', hidden: false, activeInPrimary: false, activeInSecondary: false, hasContentRoot: true, isBuiltin: true },
])

// ── Poison regression: TabKey-keyed detachedTabs cannot restore ──
{
  const tabKeyPoisoned: any = {
    version: 't',
    primary: { open: false, width: 420, tabId: 'profile' },
    secondary: { open: false, width: 420, activeTabId: 'builtin:loom' },
    detachedTabs: [{ tabId: 'builtin:loom', tabTitle: 'Loom', sidebar: 'secondary' }],
    tabOrder: ['profile', 'regex', 'builtin:loom'],
    hiddenTabIds: [],
    drawerSide: 'left',
  }
  const poisoned = buildModelFromLayout(tabKeyPoisoned, (id) => host.findKey(id))
  // The real key must NOT land in secondary via the TabKey (the pre-fix
  // behavior: every TabKey resolved to a garbage 'ext:…' key).
  assert(!poisoned.secondary.includes(LOOM), 'poisoned layout does NOT put the real loom key in secondary')
  assert(poisoned.secondary.every((k) => k !== LOOM), 'poisoned secondary holds no real keys (all garbage)')
}

// ── Live-id layout restores cleanly (the fix) ──
{
  const liveIdLayout: any = {
    version: 't',
    primary: { open: false, width: 420, tabId: 'profile' },
    secondary: { open: false, width: 420, activeTabId: 'loom' },
    detachedTabs: [{ tabId: 'loom', tabTitle: 'Loom', sidebar: 'secondary' }],
    tabOrder: ['profile', 'regex', 'loom'],
    hiddenTabIds: [],
    drawerSide: 'left',
  }
  const restored = buildModelFromLayout(liveIdLayout, (id) => host.findKey(id))
  assert(restored.secondary.includes(LOOM), 'live-id layout restores loom into secondary')
  assert(!restored.primary.includes(LOOM), 'live-id layout keeps loom out of primary')
  assertEqual(restored.active.secondary, LOOM, 'live-id layout restores the secondary active')
}

// ── Mode-profile builders ──
{
  const { buildSingleLayoutFromBaseline, buildSingleLayoutFromLiveHost } = await import('../mode-profiles')

  const baseline = {
    host: { side: 'right' as const, tabOrder: ['profile', 'regex', 'loom'], hiddenTabIds: ['regex'], showTabLabels: false },
    mainOpen: true,
    mainActiveTabId: 'profile',
    capturedAt: 0,
  }
  const fromBaseline = buildSingleLayoutFromBaseline(baseline)
  assert((fromBaseline.detachedTabs?.length ?? 0) === 0, 'baseline single layout has no detached tabs')
  assertEqual(fromBaseline.primary?.tabId, 'profile', 'baseline single layout active tab')
  assertEqual(fromBaseline.primary?.open, true, 'baseline single layout main open')
  assertEqual(fromBaseline.drawerSide, 'right', 'baseline single layout side')
  assertEqual(fromBaseline.hiddenTabIds?.length, 1, 'baseline single layout hidden set carried over')
  assertEqual(fromBaseline.tabOrder?.length, 3, 'baseline single layout tab order carried over')

  const singleModel = buildModelFromLayout(fromBaseline, (id) => host.findKey(id))
  assert(singleModel.secondary.length === 0, 'baseline single layout restores to all-primary model')
  assert(singleModel.primary.includes(LOOM), 'baseline single layout includes the formerly-secondary tab in primary')

  const fromLive = buildSingleLayoutFromLiveHost()
  assert(fromLive != null, 'live-host single layout builder returns a layout')
  assert(Array.isArray(fromLive.tabOrder), 'live-host single layout has a tab order array')
  assert((fromLive.detachedTabs?.length ?? 0) === 0, 'live-host single layout has no detached tabs')
}

console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
if (failed > 0) process.exit(1)
