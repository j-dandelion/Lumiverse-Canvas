// Regression: "Enable second drawer" toggled on from Configure Tabs must
// persist across a hard refresh.
//
// requestSecondDrawerMode(true) cancels the debounced settings save armed by
// setSettings (so the mid-restore empty layout never reaches the snapshot),
// but it MUST re-arm the save after the restore — layout.json carries no
// settings, so without the re-arm the enable only lives in memory and
// reverts on reload. This test drives the real enable path with mocked
// DOM-heavy deps and asserts the settings save actually reaches the backend.

// Headless document stub. createElement returns a MiniEl rich enough for
// the A4 mode-switch dialog tree (setAttribute / appendChild / listeners);
// every created element is recorded so tests can find and click dialog
// buttons without a real DOM.
type AnyEl = any
const createdEls: AnyEl[] = []
function makeEl(tag: string): AnyEl {
  const listeners: Record<string, Array<(e: any) => void>> = {}
  const attrs: Record<string, string> = {}
  const classes = new Set<string>()
  const el: AnyEl = {
    tagName: tag.toUpperCase(),
    id: '',
    textContent: '',
    className: '',
    type: '',
    disabled: false,
    children: [] as AnyEl[],
    parentElement: null as AnyEl | null,
    removed: false,
    style: {
      setProperty() {},
      removeProperty() {},
      getPropertyValue() { return '' },
    },
    classList: {
      add: (...cs: string[]) => { for (const c of cs) classes.add(c) },
      remove: (...cs: string[]) => { for (const c of cs) classes.delete(c) },
      toggle: (c: string, force?: boolean) => {
        if (force === undefined) force = !classes.has(c)
        if (force) classes.add(c); else classes.delete(c)
        return force
      },
      contains: (c: string) => classes.has(c),
    },
    attrs,
    listeners,
    appendChild(child: AnyEl) {
      el.children.push(child)
      child.parentElement = el
      return child
    },
    removeChild(child: AnyEl) {
      el.children = el.children.filter((c: AnyEl) => c !== child)
      return child
    },
    replaceChildren(...kids: AnyEl[]) { el.children = kids },
    remove() {
      el.removed = true
      if (el.parentElement) el.parentElement.removeChild(el)
    },
    setAttribute(k: string, v: string) { attrs[k] = String(v) },
    getAttribute(k: string) { return attrs[k] ?? null },
    removeAttribute(k: string) { delete attrs[k] },
    addEventListener(type: string, fn: (e: any) => void) {
      (listeners[type] ||= []).push(fn)
    },
    removeEventListener() {},
    focus() {},
    click() {
      if (el.disabled) return
      for (const fn of listeners['click'] ?? []) fn({})
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  }
  createdEls.push(el)
  return el
}
function clearCreated(): void { createdEls.length = 0 }
function findDialogButton(label: string): AnyEl | null {
  for (const el of createdEls) {
    if (el.tagName === 'BUTTON' && el.children?.[0]?.textContent === label) return el
  }
  return null
}
;(globalThis as any).document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: (tag: string) => makeEl(tag),
  getElementById: () => null,
  documentElement: makeEl('html'),
  body: makeEl('body'),
  addEventListener() {},
  removeEventListener() {},
}
;(globalThis as any).requestAnimationFrame = (cb: any) => { cb(1); return 1 }
;(globalThis as any).cancelAnimationFrame = () => {}
;(globalThis as any).CSS = { escape: (s: string) => s }
;(globalThis as any).getComputedStyle = () => ({})

import { mock } from 'bun:test'
// Spread the real module so newly-imported exports keep linking; the test's
// overrides below only neutralize the calls it isolates.
import * as actualDispatch from '../../recon/dispatch'

// ── Mock transitive deps of settings/second-drawer-mode.ts ──
// (real modules: settings/state, persist/layout-load, persist/settings-repo,
//  persist/backend-ctx, debug/persist-debug)

const calls = {
  bootstrapFromLayout: 0,
  // Controllable live-model serialization for finishDisable's dual-slot
  // capture (null = no model, as in the persistence scenarios above).
  ownedModelSnapshot: null as any,
  // F5: one-shot throw at finishDisable's FIRST uncaught step (the dual
  // snapshot) — the mode-switch run explodes before the setting flips.
  snapshotShouldThrow: false,
}

// Stateful Configure-modal + commit stand-ins (plan A4 scenarios).
const modalState = {
  open: false,
  draft: null as any,
  base: null as any,
  dirty: false,
  flushShouldThrow: false,
  flushCalls: 0,
  refreshCalls: 0,
}
const commitState = {
  result: { ok: true } as { ok: boolean; error?: string },
  shouldThrow: false,
}
function resetModalState() {
  modalState.open = false
  modalState.draft = null
  modalState.base = null
  modalState.dirty = false
  modalState.flushShouldThrow = false
  modalState.flushCalls = 0
  modalState.refreshCalls = 0
  commitState.result = { ok: true }
  commitState.shouldThrow = false
}

// features/registry: mock to empty so setSettings → applySettings iterates
// nothing (no React / secondary.tsx mount) — same as tab-context-menu.test.ts.
mock.module('../../features/registry', () => ({
  FEATURES: [],
}))

mock.module('../../debug/log', () => ({
  dlog: () => {},
  dwarn: () => {},
  setDebug: () => {},
}))

// layout/snapshot: buildPersistedLayout is called by the settings debounce
// (via state.ts) — mock it so no DOM snapshot is taken headless.
mock.module('../../layout/snapshot', () => ({
  hasDetachedTabs: (l: any) => Array.isArray(l?.detachedTabs) && l.detachedTabs.length > 0,
  seedDualLayoutFromLive: () => {},
  buildPersistedLayout: () => ({
    version: 2,
    primary: { open: false, width: 420, tabId: null },
    secondary: { open: false, width: 420, activeTabId: null },
    detachedTabs: [],
    hiddenTabIds: [],
  }),
}))

mock.module('../../recon/dispatch', () => ({
  ...actualDispatch,
  bootstrapFromLayout: () => { calls.bootstrapFromLayout++ },
  flush: async () => {},
  getHost: () => ({ resolve: (k: string) => k }),
  getModel: () => null,
  snapshotOwnedModelLayout: () => {
    if (calls.snapshotShouldThrow) {
      calls.snapshotShouldThrow = false // one-shot
      throw new Error('snapshot boom')
    }
    return calls.ownedModelSnapshot
  },
  onModelChanged: () => () => {},
  dispatchActivateByLiveId: async () => {},
  dispatch: async () => {},
  dispatchBatch: async () => {},
  dispatchMoveByLiveId: async () => {},
  placementFirstMoveByLiveId: async () => {},
  captureMainMirrorMoveChrome: async () => ({ neighborBtn: null, reassertId: null }),
  applyMainMirrorMoveChrome: async () => {},
  captureSecondaryNeighborForMove: async () => ({ neighborBtn: null }),
  applySecondaryNeighborHandoff: async () => {},
  shutdown: () => {},
  bootstrap: () => {},
}))

mock.module('../../tabs/owned-commit', () => ({
  commitDraftToOwnedModel: async () => {
    if (commitState.shouldThrow) throw new Error('commit boom')
    return commitState.result
  },
}))

mock.module('../../sidebar/drawer-sync', () => ({
  resetSideRemountStateAfterDisable: () => {},
  isShowTabLabels: () => false,
  syncDrawerTabSettings: () => {},
  applyMainDrawerSideChange: async () => {},
  syncSecondaryTabLabels: () => {},
}))

mock.module('../../debug/styles', () => ({
  injectStyles: () => {},
}))

// Dynamic import in the enable path + the A4 dirty guard — controllable.
mock.module('../../tabs/configure-modal', () => ({
  isConfigureTabsModalOpen: () => modalState.open,
  flushConfigureCommits: async () => {
    modalState.flushCalls++
    if (modalState.flushShouldThrow) throw new Error('flush boom')
  },
  refreshConfigureDraftFromLive: () => { modalState.refreshCalls++ },
  getConfigureDraftRef: () => modalState.draft,
  getConfigureBaseRef: () => modalState.base,
}))
mock.module('../../tabs/configure-model', () => ({
  isDraftDirty: () => modalState.dirty,
}))

// ── Dynamic imports (must be AFTER mock.module calls) ──
const [{ requestSecondDrawerMode, guardConfigureDirty }] = await Promise.all([
  import('../second-drawer-mode'),
])
// Real leaf arbiter (imports nothing) — F4/F5 hold the drawer chain with it.
const { runOsTransition } = await import('../mode-transition')
const [{ getSettings, setSettings, getDualLayoutSlot, setDualLayoutSlot }] = await Promise.all([
  import('../state'),
])
const [
  { setSettingsRepoBackendCtx, armSettingsRepo, __resetSettingsRepoForTest, bindSettingsSaveResultBridge },
] = await Promise.all([
  import('../../persist/settings-repo'),
])

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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

// ── Recording backend (acks saves like the real bridge so no timeouts) ──
const sent: Array<{ type: string; [key: string]: unknown }> = []
const backendHandlers = new Set<(payload: unknown) => void>()
const backendCtx = {
  sendToBackend: (msg: any) => {
    sent.push(msg)
    if (msg.type === 'SAVE_SETTINGS') {
      backendHandlers.forEach((h) =>
        h({ type: 'SAVE_SETTINGS_RESULT', saveId: msg.saveId, result: { status: 'ok' } }))
    }
  },
  onBackendMessage: (handler: (payload: unknown) => void) => {
    backendHandlers.add(handler)
    return () => backendHandlers.delete(handler)
  },
}

__resetSettingsRepoForTest()
setSettingsRepoBackendCtx(backendCtx)
armSettingsRepo()
bindSettingsSaveResultBridge()

// ── Scenario: re-enable from OFF with a persisted dual layout ──
// (the state finishDisable leaves on disk: the dualLayout slot)

// Start from OFF (default is ON). Drain the OFF save so it does not
// pollute later assertions.
setSettings({ secondSidebarEnabled: false })
await sleep(150)
sent.length = 0

// Seed the persisted dual layout (re-enable restore source — the slot, not
// lastLoaded; REFACTOR-PLAN v2 §4.6 retired lastLoaded's mode-restore role).
setDualLayoutSlot({
  version: 2,
  primary: { open: false, width: 420, tabId: null },
  secondary: { open: false, width: 420, activeTabId: 'builtin:loom' },
  detachedTabs: [{ tabId: 'builtin:loom', tabTitle: 'builtin:loom', sidebar: 'secondary' }],
  hiddenTabIds: [],
})

calls.bootstrapFromLayout = 0
await requestSecondDrawerMode(true)

assert(getSettings().secondSidebarEnabled === true, 'enable is live in memory')
assertEqual(calls.bootstrapFromLayout, 1, 'owned-model restore ran on enable')

// The re-armed debounced save fires ~100ms after the enable returns.
await sleep(250)

const settingsSaves = sent.filter((m) => m.type === 'SAVE_SETTINGS')
assert(settingsSaves.length >= 1, 'settings save reached the backend after enable')
assertEqual(
  ((settingsSaves[settingsSaves.length - 1].settings as any)?.settings as any)?.secondSidebarEnabled,
  true,
  'persisted settings carry secondSidebarEnabled: true',
)

// ── Disable path parity: disable must also persist (regression guard) ──
sent.length = 0
await requestSecondDrawerMode(false)
await sleep(250)

const disableSaves = sent.filter((m) => m.type === 'SAVE_SETTINGS')
assert(disableSaves.length >= 1, 'settings save reached the backend after disable')
assertEqual(
  ((disableSaves[disableSaves.length - 1].settings as any)?.settings as any)?.secondSidebarEnabled,
  false,
  'persisted settings carry secondSidebarEnabled: false',
)

// ── H4: boot anomaly — a single-shaped live model must not downgrade a real
// stored dual slot ──
// Re-enable so the setting says dual while the live owned model is
// single-shaped (detachedTabs: []). Disable must leave a non-empty stored
// slot untouched instead of overwriting it with the empty snapshot.
await requestSecondDrawerMode(true)
assert(getSettings().secondSidebarEnabled === true, 'H4 setup: dual mode live')

const anomalyStored = {
  version: 2,
  primary: { open: false, width: 420, tabId: null },
  secondary: { open: false, width: 420, activeTabId: 'builtin:loom' },
  detachedTabs: [{ tabId: 'builtin:loom', tabTitle: 'builtin:loom', sidebar: 'secondary' }],
  hiddenTabIds: [],
}
setDualLayoutSlot(anomalyStored)
calls.ownedModelSnapshot = {
  version: 2,
  primary: { open: false, width: 420, tabId: null },
  secondary: { open: false, width: 420, activeTabId: null },
  detachedTabs: [],
  hiddenTabIds: [],
}
await requestSecondDrawerMode(false)

assert(getDualLayoutSlot() === anomalyStored, 'H4: single-shaped live model did not overwrite the stored dual slot')
assertEqual(getDualLayoutSlot().detachedTabs.length, 1, 'H4: stored slot still has its 1 detached tab')

// ── Normal dual disable: a live snapshot WITH detached tabs refreshes the
// stored slot (the H4 guard must not block real writes) ──
await requestSecondDrawerMode(true)
const refreshedLive = {
  version: 2,
  primary: { open: false, width: 420, tabId: null },
  secondary: { open: false, width: 420, activeTabId: 'builtin:loom' },
  detachedTabs: [
    { tabId: 'builtin:loom', tabTitle: 'builtin:loom', sidebar: 'secondary' },
    { tabId: 'builtin:regex', tabTitle: 'builtin:regex', sidebar: 'secondary' },
  ],
  hiddenTabIds: [],
}
calls.ownedModelSnapshot = refreshedLive
await requestSecondDrawerMode(false)

assert(getDualLayoutSlot() === refreshedLive, 'normal dual disable: stored slot refreshed to the live snapshot')
assertEqual(getDualLayoutSlot().detachedTabs.length, 2, 'normal dual disable: refreshed slot carries both detached tabs')

// ── M6: OS+mobile enable guard (stale Configure toggle) ──
// The module-local helper reads window.matchMedia; stub the viewport here
// (controllable per scenario) since no other test in this file defines it.
let mobileViewport = false
;(globalThis as any).window = {
  matchMedia: (query: string) => ({
    matches: mobileViewport,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }),
}

setSettings({ secondSidebarEnabled: false })
setSettings({ osMode: true })
await sleep(150)
sent.length = 0

// Mobile + OS mode: the enable must be refused with no state mutation and
// no mode-switch side effects (no dual mount/restore, no settings save).
mobileViewport = true
calls.bootstrapFromLayout = 0
await requestSecondDrawerMode(true)
assert(getSettings().secondSidebarEnabled === false, 'M6 mobile: enable refused while OS mode on')
assertEqual(getSettings().osMode, true, 'M6 mobile: osMode untouched')
assertEqual(calls.bootstrapFromLayout, 0, 'M6 mobile: no dual mount/restore ran')
await sleep(250)
assertEqual(
  sent.filter((m) => m.type === 'SAVE_SETTINGS').length,
  0,
  'M6 mobile: no settings save side effect',
)

// Desktop + OS mode: behavior unchanged — the enable proceeds normally.
// (No bootstrapFromLayout assertion here: with OS mode on, the active dual
// slot is the OS variant, which is empty in this scenario.)
mobileViewport = false
sent.length = 0
await requestSecondDrawerMode(true)
assert(getSettings().secondSidebarEnabled === true, 'M6 desktop: enable still works with OS mode on')
await sleep(250)
assert(
  sent.filter((m) => m.type === 'SAVE_SETTINGS').length >= 1,
  'M6 desktop: enable proceeded through the persist path',
)

// ── A4: guardConfigureDirty exact contract ──
{
  resetModalState()
  clearCreated()

  // 1. silent → proceed (no modal work, no dialog).
  assertEqual(await guardConfigureDirty({ silent: true }), 'proceed', 'A4: silent → proceed')
  assertEqual(modalState.flushCalls, 0, 'A4: silent does no modal work')

  // 2. modal closed → proceed.
  assertEqual(await guardConfigureDirty(), 'proceed', 'A4: closed modal → proceed')

  // 3. flush throw → dwarn + proceed (no dialog).
  modalState.open = true
  modalState.flushShouldThrow = true
  assertEqual(await guardConfigureDirty(), 'proceed', 'A4: flush throw → proceed')
  assertEqual(findDialogButton('Apply and switch'), null, 'A4: flush throw shows no dialog')
  modalState.flushShouldThrow = false

  // 4. clean (no draft/base, or not dirty) → proceed.
  modalState.draft = { x: 1 }
  modalState.base = { x: 1 }
  modalState.dirty = false
  assertEqual(await guardConfigureDirty(), 'proceed', 'A4: clean draft → proceed')

  // 5. dirty + dialog cancel → cancel.
  modalState.dirty = true
  clearCreated()
  const pCancel = guardConfigureDirty()
  await sleep(20)
  const cancelBtn = findDialogButton('Cancel')
  assert(cancelBtn != null, 'A4: dirty draft shows the 3-way dialog')
  cancelBtn?.click()
  assertEqual(await pCancel, 'cancel', 'A4: dialog cancel → cancel')

  // 6. dirty + apply success → proceed.
  clearCreated()
  commitState.result = { ok: true }
  const pApply = guardConfigureDirty()
  await sleep(20)
  findDialogButton('Apply and switch')?.click()
  assertEqual(await pApply, 'proceed', 'A4: apply success → proceed')

  // 7. dirty + apply failure → cancel (stay in old mode).
  clearCreated()
  commitState.result = { ok: false, error: 'nope' }
  const pApplyFail = guardConfigureDirty()
  await sleep(20)
  findDialogButton('Apply and switch')?.click()
  assertEqual(await pApplyFail, 'cancel', 'A4: apply failure → cancel')

  // 8. reentrancy: concurrent guards share ONE promise + ONE dialog, and
  //    both callers resolve with the SAME choice.
  clearCreated()
  commitState.result = { ok: true }
  const p1 = guardConfigureDirty()
  const p2 = guardConfigureDirty()
  assert(p1 === p2, 'A4: concurrent guards return the SAME promise')
  await sleep(20)
  assertEqual(
    createdEls.filter((el) => el.tagName === 'DIV' && el.id === 'canvas-mode-switch-dialog').length,
    1,
    'A4: single-flight opens exactly one dialog',
  )
  findDialogButton('Discard and switch')?.click()
  const [c1, c2] = await Promise.all([p1, p2])
  assertEqual(c1, 'proceed', 'A4: discard → proceed (caller 1)')
  assertEqual(c2, 'proceed', 'A4: concurrent callers resolve identically')

  resetModalState()
  clearCreated()
}

// ── H1: guardConfigureDirty covers the ENABLE path (deep-review H1 / audit
//    F4 residual) — a dirty Configure draft must not survive into the dual
//    restore window. Cancel: dialog BEFORE any restore, no state mutation.
//    Discard: enable lands, exactly one post-restore refresh. ──
{
  setSettings({ osMode: false, secondSidebarEnabled: false })
  await sleep(150)
  resetModalState()
  clearCreated()
  setDualLayoutSlot({
    version: 2,
    primary: { open: false, width: 420, tabId: null },
    secondary: { open: false, width: 420, activeTabId: 'builtin:loom' },
    detachedTabs: [{ tabId: 'builtin:loom', tabTitle: 'builtin:loom', sidebar: 'secondary' }],
    hiddenTabIds: [],
  })
  modalState.open = true
  modalState.draft = { x: 1 }
  modalState.base = { x: 2 }
  modalState.dirty = true

  // 1. Cancel: the 3-way dialog opens BEFORE any restore; enable does not land.
  calls.bootstrapFromLayout = 0
  modalState.flushCalls = 0
  modalState.refreshCalls = 0
  const pCancelEnable = requestSecondDrawerMode(true)
  await sleep(20)
  const h1CancelBtn = findDialogButton('Cancel')
  assert(h1CancelBtn != null, 'H1: enable with dirty draft shows the 3-way dialog before restore')
  assertEqual(calls.bootstrapFromLayout, 0, 'H1: no restore ran while the dialog is up')
  h1CancelBtn?.click()
  await pCancelEnable
  assertEqual(getSettings().secondSidebarEnabled, false, 'H1: cancel leaves the mode off')
  assertEqual(calls.bootstrapFromLayout, 0, 'H1: cancel runs no dual restore')
  assertEqual(modalState.refreshCalls, 0, 'H1: cancel refreshes nothing')

  // 2. Discard and switch: enable proceeds; exactly one post-restore refresh.
  clearCreated()
  modalState.flushCalls = 0
  modalState.refreshCalls = 0
  calls.bootstrapFromLayout = 0
  const pDiscardEnable = requestSecondDrawerMode(true)
  await sleep(20)
  findDialogButton('Discard and switch')?.click()
  await pDiscardEnable
  assertEqual(getSettings().secondSidebarEnabled, true, 'H1: discard lands the enable')
  assertEqual(calls.bootstrapFromLayout, 1, 'H1: dual restore ran after discard')
  assertEqual(modalState.refreshCalls, 1, 'H1: exactly one post-restore refresh')

  resetModalState()
  clearCreated()
}

// ── A5-1: rapid dual→single→dual / single→dual→single → last wins ──
{
  setSettings({ osMode: false, secondSidebarEnabled: true })
  await sleep(150)

  // dual → single → dual, fired without awaiting the first request.
  const p1 = requestSecondDrawerMode(false)
  const p2 = requestSecondDrawerMode(true)
  await Promise.all([p1, p2])
  assertEqual(
    getSettings().secondSidebarEnabled,
    true,
    'A5-1: rapid dual→single→dual ends dual (last request wins)',
  )

  // single → dual → single (p3 is a no-op re-request of the live state;
  // p4 supersedes).
  const p3 = requestSecondDrawerMode(true)
  const p4 = requestSecondDrawerMode(false)
  await Promise.all([p3, p4])
  assertEqual(
    getSettings().secondSidebarEnabled,
    false,
    'A5-1: rapid single→dual→single ends single (last request wins)',
  )
}

// ── F4 (adversarial): per-request opts — a nested silent request must not
//    steal a QUEUED non-silent request's opts (A4: the plain drawer toggle
//    still guards) ──
// Sequence: hold the drawer chain with an OS run → queue a non-silent
// drawer-off behind it → fire a nested SILENT request (same direction the
// OS-mobile force issues; no-op on the live state at this instant, but it
// overwrites module-level opts in the OLD code) → release. The queued
// non-silent run must consult the dirty guard with ITS OWN opts (dialog),
// not the stolen silent ones (guard short-circuited to 'proceed').
{
  setSettings({ osMode: false, secondSidebarEnabled: true })
  await sleep(150)
  resetModalState()
  clearCreated()
  modalState.open = true
  modalState.draft = { x: 1 }
  modalState.base = { x: 2 }
  modalState.dirty = true

  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  let userP: Promise<void> | null = null
  const osP = runOsTransition(async () => {
    // User's plain (non-silent) drawer-off queues BEHIND this OS run.
    userP = requestSecondDrawerMode(false)
    await sleep(20) // parked on the drawer chain
    // The OS run's nested silent request (production shape: issued with
    // opts.nested from inside runOsTransition). Same-direction no-op on the
    // live state — but in the OLD code it overwrites _lastOpts while the
    // user's request waits, so the queued run would read silent:true.
    await requestSecondDrawerMode(true, { silent: true, nested: true })
    release()
  })
  const osWinner = await Promise.race([osP.then(() => 'done'), sleep(2000).then(() => 'timeout')])
  assertEqual(osWinner, 'done', 'F4: OS run + nested silent request complete (no deadlock)')

  // The queued non-silent run now executes — dirty guard must open the
  // dialog (OLD code: stolen silent:true → guard skipped → no dialog).
  await sleep(50)
  const discardBtn = findDialogButton('Discard and switch')
  assert(
    discardBtn != null,
    'F4: queued non-silent run still consults the dirty guard (dialog shown despite the nested silent request)',
  )
  discardBtn?.click()
  const userWinner = await Promise.race([
    (userP ?? Promise.resolve()).then(() => 'done'),
    sleep(2000).then(() => 'timeout'),
  ])
  assertEqual(userWinner, 'done', 'F4: queued non-silent request resolves after the dialog')
  assertEqual(
    getSettings().secondSidebarEnabled,
    false,
    'F4: discard → disable landed after the queued run',
  )
  resetModalState()
  clearCreated()
}

// ── F5 (adversarial): a throwing drain run still lets the subsequent
//    queued request execute (per-iteration catch → dwarn → continue,
//    matching the OS drain / plan A3) ──
{
  setSettings({ osMode: false, secondSidebarEnabled: true })
  await sleep(150)
  resetModalState() // modal closed → dirty guard proceeds without a dialog

  // One-shot throw inside finishDisable BEFORE the setting flips (the dual
  // snapshot is its first uncaught step): p1's drain run explodes.
  calls.snapshotShouldThrow = true
  const p1 = requestSecondDrawerMode(false)
  const p2 = requestSecondDrawerMode(false)
  const r1 = await Promise.race([p1.then(() => 'done'), sleep(2000).then(() => 'timeout')])
  assertEqual(r1, 'done', 'F5: throwing run resolves without wedging the drawer chain')
  const r2 = await Promise.race([p2.then(() => 'done'), sleep(2000).then(() => 'timeout')])
  assertEqual(r2, 'done', 'F5: subsequent queued request still executes after the throw')
  assertEqual(calls.snapshotShouldThrow, false, 'F5: the one-shot throw fired during p1')
  assertEqual(
    getSettings().secondSidebarEnabled,
    false,
    'F5: the subsequent request completed the disable',
  )
}

// ── Summary ──
console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
if (failed > 0) process.exit(1)
