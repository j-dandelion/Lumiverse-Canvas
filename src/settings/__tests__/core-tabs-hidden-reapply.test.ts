// M8 regression: `coreTabsHidden` off must sweep hidden CORE ids back to
// visible. With OS off the Configure eye re-locks (`hideLocked && !coreUnlocked`),
// so a core tab left hidden is stranded with no UI path back.
//
// Harness: fake model + dispatch capture. The real registry is imported so the
// actual feature under test runs; recon/dispatch is mocked (spread of the real
// module keeps the rest of the registry graph linking) and the Configure modal
// is mocked so the dynamic post-sweep refresh is observable.

import { mock } from 'bun:test'
import * as actualDispatch from '../../recon/dispatch'

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) passed++
  else {
    failed++
    console.error('FAIL:', msg)
  }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) passed++
  else {
    failed++
    console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

// ── Dispatch capture + fake model ──
const dispatched: Array<{ t: string; key: string; hidden: boolean }> = []
let fakeModel: { hidden: string[] } | null = null
let modalOpen = false
let refreshCalls = 0

mock.module('../../recon/dispatch', () => ({
  ...actualDispatch,
  dispatch: (intent: any) => {
    dispatched.push(intent)
    return Promise.resolve()
  },
  dispatchBatch: (intents: readonly any[]) => {
    dispatched.push(...intents)
    return Promise.resolve()
  },
  getModel: () => fakeModel,
  getHost: () => null,
}))

mock.module('../../tabs/configure-modal', () => ({
  isConfigureTabsModalOpen: () => modalOpen,
  refreshConfigureDraftFromLive: () => {
    refreshCalls++
  },
}))

const { FEATURES } = await import('../../features/registry')

const osIdx = FEATURES.findIndex((f) => f.id === 'osMode')
const coreIdx = FEATURES.findIndex((f) => f.id === 'coreTabsHidden')
assert(coreIdx >= 0, 'precondition: FEATURES registers the coreTabsHidden feature')
assert(osIdx >= 0 && coreIdx > osIdx, 'coreTabsHiddenFeature registers AFTER osModeFeature')

const feature = FEATURES.find((f) => f.id === 'coreTabsHidden')!
const apply = (prev: boolean, next: boolean) =>
  feature.apply!(
    { coreTabsHidden: prev } as any,
    { coreTabsHidden: next } as any,
    {} as any,
  )
const flush = async (ticks = 4) => {
  for (let i = 0; i < ticks; i++) await new Promise((r) => setTimeout(r, 0))
}

// ── 1. on→off with hidden core keys ⇒ setHidden(false) per key ──
{
  dispatched.length = 0
  refreshCalls = 0
  modalOpen = false
  fakeModel = { hidden: ['builtin:profile', 'builtin:presets'] }
  apply(true, false)
  await flush()
  assertEqual(dispatched.length, 2, 'on→off sweeps each hidden core key')
  assertEqual(dispatched[0]?.t, 'setHidden', 'sweep uses the setHidden model intent')
  assertEqual(dispatched[0]?.key, 'builtin:profile', 'first core key swept')
  assertEqual(dispatched[0]?.hidden, false, 'hidden intent is false (unhide)')
  assertEqual(dispatched[1]?.key, 'builtin:presets', 'second core key swept')
  assertEqual(dispatched[1]?.hidden, false, 'second hidden intent is false')
  assertEqual(refreshCalls, 0, 'closed Configure modal ⇒ no refresh')
}

// ── 2. on→off with nothing hidden ⇒ identity (no dispatch) ──
{
  dispatched.length = 0
  fakeModel = { hidden: [] }
  apply(true, false)
  await flush()
  assertEqual(dispatched.length, 0, 'nothing hidden ⇒ no dispatch (identity)')
}

// ── 3. hidden NON-core key is untouched by the sweep ──
{
  dispatched.length = 0
  fakeModel = { hidden: ['ext:other/panel', 'builtin:loom'] }
  apply(true, false)
  await flush()
  assertEqual(dispatched.length, 1, 'only core hidden keys are swept')
  assertEqual(dispatched[0]?.key, 'builtin:loom', 'non-core key untouched')
  assertEqual(dispatched[0]?.hidden, false, 'swept core key un-hidden')
}

// ── 4. enable direction (off→on) does not sweep ──
{
  dispatched.length = 0
  fakeModel = { hidden: ['builtin:profile'] }
  apply(false, true)
  await flush()
  assertEqual(dispatched.length, 0, 'off→on is not the sweep direction')
}

// ── 5. open Configure modal refreshes after the sweep ──
{
  dispatched.length = 0
  refreshCalls = 0
  modalOpen = true
  fakeModel = { hidden: ['builtin:theme'] }
  apply(true, false)
  await flush()
  assertEqual(dispatched.length, 1, 'modal case still sweeps')
  assertEqual(refreshCalls, 1, 'open Configure modal refreshes after the sweep')
  modalOpen = false
}

// ── Summary ──
if (failed > 0) {
  console.error(`FAILED: ${failed}`)
  process.exitCode = 1
}
console.log(`PASS: ${passed}`)
