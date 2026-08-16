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
  const { buildSingleLayoutFromLiveHost, restoreSingleModeLayout } = await import('../mode-profiles')

  const fromLive = buildSingleLayoutFromLiveHost()
  assert(fromLive != null, 'live-host single layout builder returns a layout')
  assert(Array.isArray(fromLive.tabOrder), 'live-host single layout has a tab order array')
  assert((fromLive.detachedTabs?.length ?? 0) === 0, 'live-host single layout has no detached tabs')

  // restoreSingleModeLayout: the single slot (all-primary) boots the owned
  // model into an all-primary state and converges the host (the disable
  // path — REFACTOR-PLAN v2 §4.6).
  const { bootstrap, shutdown, getModel, flush } = await import('../../recon/dispatch')
  shutdown()
  bootstrap(createEmptyModel(), host, 't')
  const singleSlot: any = {
    version: 't',
    primary: { open: false, width: 420, tabId: 'profile' },
    secondary: { open: false, width: 420, activeTabId: null },
    detachedTabs: [],
    tabOrder: ['profile', 'regex', 'loom'],
    hiddenTabIds: [],
    drawerSide: 'left',
  }
  const result = await restoreSingleModeLayout(singleSlot, host)
  await flush()
  assert(result.ok === true, 'restoreSingleModeLayout completes ok')
  const model = getModel()
  assert(model != null, 'model present after restoreSingleModeLayout')
  assert(model!.secondary.length === 0, 'single slot restores to an all-primary model')
  assert(model!.primary.includes(LOOM), 'single slot includes the formerly-secondary tab in primary')
  const world = host.observe()
  assert(world.tabs.every((t) => t.location === 'primary'), 'host converges to all-primary after single restore')
}

console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
if (failed > 0) process.exit(1)
