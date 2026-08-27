// Tracked-active setter contract (2026-08-27 swap-freeze regression):
//
// The swap freeze was a feedback loop: reconcile's host.activate('secondary')
// echoes the model's active into the chrome via showSecondaryTab →
// setActiveSecondaryTabId → dispatchTrackedActiveSync → syncActive dispatch →
// model change → next reconcile activates the other key → ... forever
// (SAVE_LAYOUT cascade, main thread saturation).
//
// Fixed by:
//   1. reconcile-issued activations are SILENT — the model is already the
//      source, so re-dispatching syncActive is a loop by construction.
//   2. dispatchTrackedActiveSync coalesces concurrent triggers.
//
// These tests pin the setter contract that the fix relies on:
//   - silent writes still RECORD the tracked value (chrome parity) but must
//     not re-enter the dispatch queue — covered by the live swap-spam gate
//     (the freeze is a full-pipeline behavior; the setter itself is unit-
//     observable here).
//   - same-value writes are no-ops (no re-entry).
//
// Run with: bun run src/tabs/__tests__/active-tab-sync.test.ts

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

// =====================================================================
// Mocks — must be installed before importing active-tab (main-tab-pin
// import chain is heavy; only the exports active-tab uses are needed).
// =====================================================================

const { mock } = await import('bun:test')

mock.module('../sidebar/main-tab-pin', () => ({
  isMainMirrorActive: () => false,
  getMirrorActiveKey: () => null,
  getMainMirrorTabList: () => null,
  resolveMirrorActiveTabId: () => null,
  resolvePrimaryActiveTabIdFromMirror: () => null,
  startMirrorStateSync: () => {},
}))

// =====================================================================
// Import the module under test
// =====================================================================

const { setActiveSecondaryTabId, getActiveSecondaryTabId } = await import('../active-tab')

// ---------------------------------------------------------------------
// T1: silent write records the value (reconcile echo keeps chrome parity)
// ---------------------------------------------------------------------

{
  setActiveSecondaryTabId('loom', { silent: true })
  assertEqual(getActiveSecondaryTabId(), 'loom', 'T1: silent write still records the tracked active')
}

// ---------------------------------------------------------------------
// T2: silent write can change the value (echo follows the model)
// ---------------------------------------------------------------------

{
  setActiveSecondaryTabId('branches', { silent: true })
  assertEqual(getActiveSecondaryTabId(), 'branches', 'T2: silent write updates the tracked active')
}

// ---------------------------------------------------------------------
// T3: same-value write is a no-op (changed gate — no dispatch re-entry)
// ---------------------------------------------------------------------

{
  setActiveSecondaryTabId('branches')
  assertEqual(getActiveSecondaryTabId(), 'branches', 'T3: same-value write keeps the tracked active')
}

// ---------------------------------------------------------------------
// T4: non-silent write records and does not throw (user path)
// ---------------------------------------------------------------------

{
  setActiveSecondaryTabId('lorebook')
  assertEqual(getActiveSecondaryTabId(), 'lorebook', 'T4: non-silent write records the tracked active')
  setActiveSecondaryTabId('lorebook', { silent: true })
  assertEqual(getActiveSecondaryTabId(), 'lorebook', 'T4b: silent same-value write keeps it')
}

// ---------------------------------------------------------------------
// T5: null clears (unassign paths) — both modes
// ---------------------------------------------------------------------

{
  setActiveSecondaryTabId(null)
  assertEqual(getActiveSecondaryTabId(), null, 'T5: null clears the tracked active')
  setActiveSecondaryTabId(null, { silent: true })
  assertEqual(getActiveSecondaryTabId(), null, 'T5b: silent null stays cleared')
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)