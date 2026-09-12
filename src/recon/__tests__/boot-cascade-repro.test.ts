// Boot-cascade repro (2026-08-17): the tracked-active hooks must not turn the
// boot/restore window into a SAVE_LAYOUT cascade.
//
// During a hard refresh the restore machinery writes the tracked actives
// (the secondary setter re-assert) WHILE the observed
// world is still flip-flopping (facade lag: the placement pass runs after
// the first host-syncs; React re-renders re-show hidden host buttons). Each
// tracked write now dispatches syncActive → reconcileAndPersist. If those
// rounds persist while the world settles, every permutation of the same tab
// list serializes to the SAME byte count (order swaps / same-length id
// swaps) — the dedup cannot catch it, and layout.json gets rewritten in a
// tight loop (the user's constant-bytes SAVE_LAYOUT log).

;(globalThis as any).document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({}),
  getElementById: () => null,
  documentElement: {
    classList: { add() {}, remove() {}, contains() { return false } },
    style: { setProperty() {}, removeProperty() {}, getPropertyValue() { return '' } },
  },
  body: { appendChild() {}, removeChild() {} },
}
;(globalThis as any).window = {
  matchMedia: () => ({ matches: false }),
  addEventListener: () => {},
  removeEventListener: () => {},
}
;(globalThis as any).requestAnimationFrame = (cb: any) => { cb(1); return 1 }
;(globalThis as any).cancelAnimationFrame = () => {}
;(globalThis as any).CSS = { escape: (s: string) => s }
;(globalThis as any).getComputedStyle = () => ({})

import { FakeHost, type LiveTab } from '../../host/fake/implementation'
import { bootstrapFromLayout, shutdown, dispatch, flush, getModel } from '../dispatch'
import { serializeModelToLayout } from '../../persist/layout-model'
import {
  armLayoutRepo,
  __resetLayoutRepoForTest,
  setLayoutRepoBackendCtx,
} from '../../persist/layout-repo'
import { createEmptyModel, builtinKey, extensionKey, type LayoutModel, type TabKey, type Side, type ObservedWorld } from '../../core/model'

const PROFILE = builtinKey('profile')
const A = extensionKey('ext', 'a')
const B = extensionKey('ext', 'b')

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertEqualLoose(actual: unknown, expected: unknown, msg: string) {
  if (actual === expected) { passed++ }
  else { console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed++ }
}

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function settle(): Promise<void> {
  await sleep(5)
  await flush()
  await sleep(5)
  await flush()
}

// The dual layout as the user's disk has it: two secondary tabs, primary
// active PROFILE, secondary active A.
const USER_LAYOUT: any = {
  version: 'test-v1.0',
  primary: { open: true, width: 414, tabId: 'profile' },
  secondary: { open: true, width: 420, activeTabId: 'h:a' },
  tabOrder: ['profile', 'h:a', 'h:b'],
  detachedTabs: [
    { tabId: 'h:a', tabTitle: 'A', sidebar: 'secondary' },
    { tabId: 'h:b', tabTitle: 'B', sidebar: 'secondary' },
  ],
  hiddenTabIds: [],
  drawerSide: 'left',
}

function bootHost(): FakeHost {
  return new FakeHost([
    makeLiveTab(PROFILE, 'profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'secondary', { activeInSecondary: true }),
    makeLiveTab(B, 'h:b', 'secondary'),
  ])
}

// ============================================================================
// C1 — boot storm: restore-driven tracked writes + alternating observed world
//
// Model of the hard-refresh window: bootstrapFromLayout arms the pending
// restore; the mirror heal/restore writes the mirror key; the secondary
// restore re-asserts its tracked active; meanwhile the observed world keeps
// flipping (placement lag — B observed on primary in one round, secondary in
// the next). Count the SAVE_LAYOUT writes the whole window produces.
// ============================================================================
async function testBootStormPersistCount() {
  const writes: any[] = []
  const backend = {
    sendToBackend(message: { type: string; [key: string]: unknown }) {
      if (message.type === 'SAVE_LAYOUT') writes.push(message.layout)
    },
    onBackendMessage() { return () => {} },
  }
  __resetLayoutRepoForTest()
  setLayoutRepoBackendCtx(backend)
  armLayoutRepo()

  const host = bootHost()
  shutdown()
  bootstrapFromLayout(USER_LAYOUT, host, 'test-v1.0')
  await settle()

  // Restore-driven tracked-active write (the secondary restore re-assert)
  // fires the unified sync. The old mirror-key half of this repro died with
  // the S2 parity layer: the model's adoptActive location guard is what
  // refuses a secondary-assigned tab as the primary active now.
  const { setActiveSecondaryTabId } = await import('../../tabs/active-tab')
  setActiveSecondaryTabId('h:b')
  await settle()

  // The storm: the host's tabBtnActive flip-flops between PROFILE and B (B's
  // host button momentarily re-shown by a React re-render). B stays on the
  // SECONDARY drawer in the observed world (the facade/placement has run);
  // adoptActive must refuse B because its observed location is not primary.
  const base = host.observe()
  const worldFlip = (bActive: boolean): ObservedWorld => ({
    ...base,
    tabs: base.tabs.map((t) =>
      t.key === B
        ? { ...t, location: 'secondary', isActiveInPrimary: bActive }
        : t.key === PROFILE
          ? { ...t, isActiveInPrimary: !bActive }
          : t,
    ),
  })
  for (let i = 0; i < 8; i++) {
    await dispatch({ t: 'syncFromHost', observed: worldFlip(i % 2 === 0) })
    await settle()
    console.log(`[C1] round ${i}: primary active = ${String(getModel()?.active.primary)}`)
  }

  const model = getModel()
  assert(model != null, 'C1a: model present after storm')
  if (model) {
    assert(model.secondary.includes(B), 'C1b: B settled in secondary')
    // The mirror key must NEVER land on a secondary-assigned tab (the
    // location guard) — that adoption was the flip that cascaded writes.
    assertEqualLoose(model.active.primary, PROFILE, 'C1c: primary active stayed on the primary tab')
  }

  // The storm must not cascade: content-equal sync rounds short-circuit on
  // identity — only the boot convergence writes (bootstrap + tracked write)
  // may land.
  console.log(`[C1] SAVE_LAYOUT writes during storm: ${writes.length}`)
  assert(writes.length <= 4, `C1d: storm produces at most 4 convergence writes, got ${writes.length}`)

  __resetLayoutRepoForTest()
  shutdown()
}

await testBootStormPersistCount()

console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
if (failed > 0) process.exit(1)
