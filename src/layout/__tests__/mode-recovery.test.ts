// Boot-recovery tests (plan C / F5) — `src/layout/mode-recovery.ts`.
//
// Proves the decision/apply split for the mode/slot mismatch:
//   C-1  anomaly fixture (setting dual + single-shaped top-level + single
//        model + resolvable dual slot) → planModeRecovery returns the slot;
//        recoverModeLayoutAtBoot calls restoreSingleModeLayout with
//        facet-derived opts AND the real restore lands the dual model.
//   C-2  dual top-level (detachedTabs present) → plan returns null (a
//        late-re-resolving dual boot must never enter recovery, R2-2).
//   C-3  single-shaped top-level + stale non-empty dual slot → recovery still
//        returns the slot for interrupted switches and legacy layouts saved
//        before explicit final-tab moves began refreshing that slot.
//   C-4  facets off → opts forwarded false (+ geometry gated off).
//   C-5  nulls: setting single, OS+mobile, empty/unresolvable slot, no model.
//   C-6  secondary geometry: width var written + openSecondarySidebar called
//        when facet on + shell live; gated off when shell not live.
//
// Mocking convention (repo standard): mock.module BEFORE dynamic imports of
// the module under test. Two mocks only:
//   - layout/mode-profiles — records restore opts, CALLS THROUGH to the real
//     implementation (so model effect is real);
//   - sidebar/secondary — spread-real (full export surface) + spy
//     openSecondarySidebar + controllable isSecondaryShellLive.
// Everything else is real: settings/state (hydrate/get), recon/dispatch,
// persist/layout-model, host/fake, core. Routed to `bun test` via bun:test.

import { mock } from 'bun:test'

// ── Environment stubs (statements run after the hoisted bun:test import,
//    before any dynamic import of the module under test) ──
let mobileViewport = false
;(globalThis as any).window = {
  innerWidth: 1200,
  matchMedia: () => ({
    matches: mobileViewport,
    addEventListener() {},
    removeEventListener() {},
  }),
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() { return true },
}
const styleProps = new Map<string, string>()
;(globalThis as any).document = {
  documentElement: {
    classList: {
      _classes: new Set<string>(),
      contains(c: string) { return this._classes.has(c) },
      add(c: string) { this._classes.add(c) },
      remove(c: string) { this._classes.delete(c) },
      toggle(c: string) { this._classes.has(c) ? this._classes.delete(c) : this._classes.add(c) },
    },
    style: {
      getPropertyValue(k: string) { return styleProps.get(k) ?? '' },
      setProperty(k: string, v: string) { styleProps.set(k, v) },
      removeProperty(k: string) { styleProps.delete(k) },
    },
  },
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  body: {
    querySelector: () => null,
    appendChild() {},
    removeChild() {},
    classList: { add() {}, remove() {}, contains: () => false },
  },
}
;(globalThis as any).requestAnimationFrame = (cb: any) => { cb(1); return 1 }
;(globalThis as any).cancelAnimationFrame = () => {}
;(globalThis as any).CSS = { escape: (s: string) => s }
;(globalThis as any).getComputedStyle = () => ({})

// ── Custom assertion harness (repo convention) ──
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

// ── Load the REAL main-persist FIRST (spread-real for the full export
//    surface), then mock it with an unsuppress spy — F3 failure paths call
//    unsuppress via DYNAMIC import, which resolves to this mock; internal
//    calls inside the real restoreMainDrawerFromDom are NOT spied. ──
const realMainPersist = await import('../../sidebar/main-persist')
let unsuppressCalls = 0
mock.module('../../sidebar/main-persist', () => ({
  ...realMainPersist,
  unsuppressMainDrawer: () => { unsuppressCalls++ },
}))

// ── Load the REAL mode-profiles first (captures the real restore fn before
//    the mock swaps the module record), then mock it with call-through spy ──
const realProfiles = await import('../mode-profiles')
const realRestoreSingleModeLayout = realProfiles.restoreSingleModeLayout
const restoreCalls: Array<{ slot: any; opts: any }> = []
// F3 failure injection: 'throw' rejects, 'partial' resolves {ok:false}
// (bootstrap-failure shape — restoreMainDrawerFromDom never runs).
let restoreFailure: 'throw' | 'partial' | null = null
mock.module('../mode-profiles', () => ({
  ...realProfiles,
  restoreSingleModeLayout: (slot: any, host: any, opts?: any) => {
    restoreCalls.push({ slot, opts })
    if (restoreFailure === 'throw') return Promise.reject(new Error('restore exploded'))
    if (restoreFailure === 'partial') {
      return Promise.resolve({ ok: false, reason: 'bootstrap: fixture failure' })
    }
    return realRestoreSingleModeLayout(slot, host, opts)
  },
}))

// ── Secondary shell: spread-real for the full export surface (dispatch's
//    placement pass dynamically imports this module too) + controllable
//    shell-liveness + open spy for geometry assertions (C-6) ──
const realSecondary = await import('../../sidebar/secondary')
let shellLive = false
let openCalls = 0
mock.module('../../sidebar/secondary', () => ({
  ...realSecondary,
  isSecondaryShellLive: () => shellLive,
  openSecondarySidebar: () => { openCalls++ },
  // Quiet the headless placement pass: DOM placement is not under test here
  // (model shape is restored by bootstrapFromLayout, not by the DOM pass).
  reassignSecondaryTabsFromModel: async () => {},
  unassignSecondaryTabsNotInModel: async () => {},
}))

// ── Module under test + real deps (AFTER mock.module calls) ──
const { planModeRecovery, recoverModeLayoutAtBoot } = await import('../mode-recovery')
const {
  getSettings,
  hydrateSettings,
  getDualLayoutSlot,
  setDualLayoutSlot,
  setOsDualLayoutSlot,
} = await import('../../settings/state')
const { bootstrap, shutdown, getModel, flush, bootPlacementDone, __getPendingRestoreFlagsForTest } =
  await import('../../recon/dispatch')
const { FakeHost } = await import('../../host/fake/implementation')
const { builtinKey, createEmptyModel } = await import('../../core/model')
const { buildModelFromLayout } = await import('../../persist/layout-model')
const { SECONDARY_WIDTH_VAR } = await import('../../sidebar/styles')

const PROFILE = builtinKey('profile')
const REGEX = builtinKey('regex')
const LOOM = builtinKey('loom')

const host = new FakeHost([
  { key: PROFILE, liveId: 'profile', location: 'primary', hidden: false, activeInPrimary: true, activeInSecondary: false, hasContentRoot: true, isBuiltin: true },
  { key: REGEX, liveId: 'regex', location: 'primary', hidden: false, activeInPrimary: false, activeInSecondary: false, hasContentRoot: true, isBuiltin: true },
  { key: LOOM, liveId: 'loom', location: 'primary', hidden: false, activeInPrimary: false, activeInSecondary: false, hasContentRoot: true, isBuiltin: true },
])

// Entering dual slot: non-empty, resolvable, second drawer open at width 500.
const dualSlot: any = {
  version: 't',
  primary: { open: false, width: 420, tabId: 'profile' },
  secondary: { open: true, width: 500, activeTabId: 'loom' },
  detachedTabs: [{ tabId: 'loom', tabTitle: 'Loom', sidebar: 'secondary' }],
  tabOrder: ['profile', 'regex', 'loom'],
  hiddenTabIds: [],
  drawerSide: 'left',
}
// The F5 anomaly top-level: setting says dual, blob is single-shaped.
const anomalyTop: any = {
  version: 't',
  primary: { open: false, width: 420, tabId: 'profile' },
  secondary: { open: false, width: 420, activeTabId: undefined },
  detachedTabs: [],
  tabOrder: ['profile', 'regex', 'loom'],
  hiddenTabIds: [],
  drawerSide: 'left',
}
// Dual-shaped top-level (late-resolving dual boot) — must never recover.
const dualTop: any = {
  ...anomalyTop,
  detachedTabs: [{ tabId: 'loom', tabTitle: 'Loom', sidebar: 'secondary' }],
}
// C-3 fixture: single-shaped top-level paired with a stale dual slot, matching
// an interrupted transition or a legacy save from before the dispatch fix.
const singleShapedTop: any = {
  version: 't',
  primary: { open: false, width: 420, tabId: 'profile' },
  secondary: { open: false, width: 420, activeTabId: undefined },
  detachedTabs: [],
  tabOrder: ['profile', 'regex', 'loom'],
  hiddenTabIds: [],
  drawerSide: 'left',
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function bootSingleModel() {
  shutdown()
  const fresh = buildModelFromLayout(anomalyTop, (id: string) => host.findKey(id))
  assert(fresh.secondary.length === 0, 'fixture: single-shaped model boots single')
  bootstrap(fresh, host, 't')
  await flush()
}

// ══ Setup: dual on, facets on, dual slot set, single model booted ══
hydrateSettings({
  secondSidebarEnabled: true,
  persistDrawerOpenState: true,
  persistDrawerWidth: true,
  osMode: false,
})
setDualLayoutSlot(dualSlot)
setOsDualLayoutSlot(null)
await bootSingleModel()
assertEqual(getSettings().secondSidebarEnabled, true, 'setup: second drawer enabled')
assertEqual(getModel()!.secondary.length, 0, 'setup: model boots single-shaped')

// ══ C-1 (plan half): anomaly fixture → plan returns the dual slot ══
assertEqual(planModeRecovery(anomalyTop), dualSlot, 'C-1: plan returns the dual slot for the anomaly fixture')

// ══ C-2: dual top-level → plan null (late-resolving dual never recovers) ══
assertEqual(planModeRecovery(dualTop), null, 'C-2: dual-shaped top-level → plan null')

// ══ C-3: stale dual profile remains recoverable for interrupted/legacy state ══
assertEqual(
  planModeRecovery(singleShapedTop),
  dualSlot,
  'C-3: stale dual profile still plans recovery for interrupted/legacy state',
)

// ══ C-5: null cases (model stays single throughout this block) ══
hydrateSettings({ secondSidebarEnabled: false })
assertEqual(planModeRecovery(anomalyTop), null, 'C-5a: secondSidebarEnabled false → null')

// OS + mobile: preconditions 1–4 hold (osDual set + resolvable), only the
// mobile guard kills it; desktop control proves the slot itself was fine.
hydrateSettings({ secondSidebarEnabled: true, osMode: true })
setOsDualLayoutSlot(dualSlot)
mobileViewport = true
assertEqual(planModeRecovery(anomalyTop), null, 'C-5b: OS+mobile → null (R2-11 local matchMedia)')
mobileViewport = false
assertEqual(planModeRecovery(anomalyTop), dualSlot, 'C-5b control: OS desktop → osDual slot')
hydrateSettings({ secondSidebarEnabled: true, osMode: false })
setOsDualLayoutSlot(null)

setDualLayoutSlot(null)
assertEqual(planModeRecovery(anomalyTop), null, 'C-5c: empty (null) dual slot → null')
setDualLayoutSlot({ version: 't', tabOrder: [], detachedTabs: [] })
assertEqual(planModeRecovery(anomalyTop), null, 'C-5c: zero-tab dual slot → null')

setDualLayoutSlot({ version: 't', tabOrder: ['ghost-live-id'], detachedTabs: [], drawerSide: 'left' })
assertEqual(planModeRecovery(anomalyTop), null, 'C-5d: all-unresolvable dual slot → null')
setDualLayoutSlot(dualSlot)

shutdown()
assertEqual(planModeRecovery(anomalyTop), null, 'C-5e: no model → null')
await bootSingleModel()

// ══ C-1 (apply half): recovery calls restore with facet opts + real model
//        effect. Shell not live → geometry skipped (openCalls stays 0). ══
restoreCalls.length = 0
shellLive = false
openCalls = 0
styleProps.delete(SECONDARY_WIDTH_VAR)
await recoverModeLayoutAtBoot(dualSlot)
await flush()
await bootPlacementDone()
assertEqual(restoreCalls.length, 1, 'C-1: recovery calls restoreSingleModeLayout once')
assertEqual(restoreCalls[0]?.slot, dualSlot, 'C-1: restores THE entering slot (identity)')
assertEqual(restoreCalls[0]?.opts?.restoreOpen, true, 'C-1: restoreOpen facet forwarded true')
assertEqual(restoreCalls[0]?.opts?.restoreWidth, true, 'C-1: restoreWidth facet forwarded true')
assertEqual(restoreCalls[0]?.opts?.osActive, false, 'C-1: osActive follows live OS setting (off)')
// L3 (2026-09-23): boot recovery must use the plain retry window — never
// arm persistWhilePending, or an early reload can durably persist a
// resolved-only dual blob.
assertEqual(
  restoreCalls[0]?.opts?.persistWhilePending,
  false,
  'C-1: boot recovery forwards persistWhilePending:false (L3)',
)
const afterC1 = getModel()
assert(afterC1 != null, 'C-1: model present after recovery')
assertEqual(afterC1!.secondary.length, 1, 'C-1: real restore lands the dual model (secondary non-empty)')
assert(afterC1!.secondary.includes(LOOM), 'C-1: loom restored into secondary')
assertEqual(openCalls, 0, 'C-1: geometry skipped while shell not live')
assert(!styleProps.has(SECONDARY_WIDTH_VAR), 'C-1: no width write while shell not live')

// ══ C-4: facets off → opts forwarded false + geometry gated off even with
//        the shell live ══
hydrateSettings({
  secondSidebarEnabled: true,
  persistDrawerOpenState: false,
  persistDrawerWidth: false,
})
restoreCalls.length = 0
shellLive = true
openCalls = 0
styleProps.delete(SECONDARY_WIDTH_VAR)
await recoverModeLayoutAtBoot(dualSlot)
await flush()
await bootPlacementDone()
assertEqual(restoreCalls.length, 1, 'C-4: recovery still routes through the spy')
assertEqual(restoreCalls[0]?.opts?.restoreOpen, false, 'C-4: restoreOpen facet forwarded false')
assertEqual(restoreCalls[0]?.opts?.restoreWidth, false, 'C-4: restoreWidth facet forwarded false')
assertEqual(restoreCalls[0]?.opts?.osActive, false, 'C-4: osActive forwarded false')
assertEqual(openCalls, 0, 'C-4: secondary open NOT applied when open facet off')
assert(!styleProps.has(SECONDARY_WIDTH_VAR), 'C-4: secondary width NOT written when width facet off')

// ══ C-6: facets on + shell live → width var written + open API called ══
hydrateSettings({
  secondSidebarEnabled: true,
  persistDrawerOpenState: true,
  persistDrawerWidth: true,
})
restoreCalls.length = 0
shellLive = true
openCalls = 0
styleProps.delete(SECONDARY_WIDTH_VAR)
await recoverModeLayoutAtBoot(dualSlot)
await flush()
await bootPlacementDone()
assertEqual(restoreCalls.length, 1, 'C-6: recovery ran')
assertEqual(
  styleProps.get(SECONDARY_WIDTH_VAR),
  '500px',
  'C-6: slot secondary width (500, clamped) applied to SECONDARY_WIDTH_VAR',
)
assert(openCalls >= 1, 'C-6: openSecondarySidebar called to apply slot open state')

// ══ F3 (adversarial): every failure/early-return path best-effort
//    unsuppresses the main drawer — otherwise it stays suppressed until the
//    3s watchdog when the success-path unsuppress (inside
//    restoreMainDrawerFromDom) never runs. unsuppressMainDrawer is
//    idempotent (restore-poll T3), so partial outcomes may double-call. ══
{
  // F3a: restoreSingleModeLayout throws.
  restoreFailure = 'throw'
  unsuppressCalls = 0
  await recoverModeLayoutAtBoot(dualSlot)
  assertEqual(unsuppressCalls, 1, 'F3a: thrown restore → best-effort unsuppress')

  // F3b: restore returns ok:false (bootstrap failure — no DOM restore ran).
  restoreFailure = 'partial'
  unsuppressCalls = 0
  await recoverModeLayoutAtBoot(dualSlot)
  assertEqual(unsuppressCalls, 1, 'F3b: failed restore (ok:false) → best-effort unsuppress')
  restoreFailure = null

  // F3c: host/model gone → early return also unsuppresses.
  shutdown()
  unsuppressCalls = 0
  await recoverModeLayoutAtBoot(dualSlot)
  assertEqual(unsuppressCalls, 1, 'F3c: host/model-gone early return → best-effort unsuppress')
  await bootSingleModel() // restore a live model for hygiene
}

// ══ L3 (2026-09-23): boot recovery with 1 resolvable + 1 never-resolving
//    id must arm the PLAIN retry window (persistWhilePending:false) — a
//    warm-persist flag would let an early reload durably write a
//    resolved-only dual blob while the unresolvable entry is still pending. ══
{
  hydrateSettings({
    secondSidebarEnabled: true,
    persistDrawerOpenState: true,
    persistDrawerWidth: true,
    osMode: false,
  })
  const partialDualSlot: any = {
    version: 't',
    primary: { open: false, width: 420, tabId: 'profile' },
    secondary: { open: true, width: 500, activeTabId: 'loom' },
    // loom resolves against the fixture host; ghost never will.
    detachedTabs: [{ tabId: 'loom', tabTitle: 'Loom', sidebar: 'secondary' }],
    tabOrder: ['profile', 'regex', 'loom', 'ghost-never-resolves'],
    hiddenTabIds: [],
    drawerSide: 'left',
  }
  setDualLayoutSlot(partialDualSlot)
  await bootSingleModel()
  restoreCalls.length = 0
  await recoverModeLayoutAtBoot(partialDualSlot)
  await flush()
  // The restore is still pending (ghost never resolves) — the warm-persist
  // flag must NOT be armed on the boot-recovery path.
  const l3flags = __getPendingRestoreFlagsForTest()
  assertEqual(
    l3flags.persistResolvedWhilePending,
    false,
    'L3: boot recovery leaves persistWhilePending unarmed (plain retry window)',
  )
  // Restore hygiene for the F3 block below.
  setDualLayoutSlot(dualSlot)
  await bootSingleModel()
}

// ── Summary ──
console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
if (failed > 0) process.exit(1)
