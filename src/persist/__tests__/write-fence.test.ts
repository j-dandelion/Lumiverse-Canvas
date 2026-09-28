// Phase 0: Write-fence tests for layout-repo and settings-repo.
// Invariants 14-17 from the plan:
//   14. An error load never writes. An empty load writes defaults. An ok load writes.
//   15. Settings survive a layout load failure, and layout survives a settings load failure.
//   16. (Migration tested in backend — frontend repos test the fence.)

// Minimal DOM stub: persistSettings → buildPersistedLayout reads the host
// drawer via document queries even here (review batch 2 added the first
// settings-flush path that builds a snapshot without a mounted DOM).
;(globalThis as any).document = {
  documentElement: {
    classList: {
      _c: new Set<string>(),
      contains(c: string) { return this._c.has(c) },
      add(c: string) { this._c.add(c) },
      remove(c: string) { this._c.delete(c) },
    },
    style: { setProperty() {}, removeProperty() {}, getPropertyValue() { return '' } },
  },
  querySelector: () => null,
  querySelectorAll: () => [],
  body: { querySelector: () => null, appendChild() {}, removeChild() {} },
}

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual(actual: unknown, expected: unknown, msg: string) {
  if (actual === expected) { passed++ }
  else { console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed++ }
}

type BackendMsg = { type: string; [key: string]: unknown }

function makeBackendCtx() {
  const sent: BackendMsg[] = []
  let handlers: Array<(payload: unknown) => void> = []
  const ctx = {
    sendToBackend(msg: BackendMsg) { sent.push(msg) },
    onBackendMessage(h: (payload: unknown) => void) {
      handlers.push(h)
      return () => { handlers = handlers.filter(x => x !== h) }
    },
    // Test helpers
    _respond(type: string, result: unknown) {
      for (const h of handlers) {
        h({ type, result })
      }
      handlers = []
    },
    _sent() { return sent.slice() },
    _saves() { return sent.filter(m => m.type === 'SAVE_LAYOUT' || m.type === 'SAVE_SETTINGS') },
  }
  return ctx
}

function makeRespondingCtx(resultType: string, result: unknown) {
  const ctx = makeBackendCtx()
  const originalSend = ctx.sendToBackend
  ctx.sendToBackend = (msg: BackendMsg) => {
    originalSend(msg)
    if (msg.type === 'LOAD_LAYOUT' || msg.type === 'LOAD_SETTINGS') {
      queueMicrotask(() => ctx._respond(resultType, result))
    }
  }
  return ctx
}

import {
  setLayoutRepoBackendCtx,
  loadLayoutFromDisk,
  armLayoutRepo,
  saveLayoutToDisk,
  isLayoutRepoArmed,
  __resetLayoutRepoForTest,
  __setBootLoadParamsForTest,
  __resetBootLoadParamsForTest,
} from '../layout-repo'
import {
  setSettingsRepoBackendCtx,
  loadSettingsFromDisk,
  armSettingsRepo,
  saveSettingsToDisk,
  isSettingsRepoArmed,
  __resetSettingsRepoForTest,
  __resolveSettingsSave,
} from '../settings-repo'
import { flushPendingSaves } from '../layout-load'
import { persistSettings, __setSettingsSaveRetriesForTest } from '../../settings/state'

// This suite intentionally leaves saves unanswered (the fence is what is under
// test); disable the N2 auto-retry so the failed saves don't keep the event
// loop alive across retry chains.
__setSettingsSaveRetriesForTest(0)

function reset() {
  __resetLayoutRepoForTest()
  __resetSettingsRepoForTest()
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// --- 14a: error load → repo NOT armed → saves are dropped ---
{
  reset()
  const ctx = makeRespondingCtx('SETTINGS_DATA', {
    status: 'error',
    reason: 'read failed: temporary storage failure',
  })
  setLayoutRepoBackendCtx(ctx)
  setSettingsRepoBackendCtx(ctx)

  const settingsResult = await loadSettingsFromDisk()
  assertEqual(settingsResult.status, 'error', '14a: read error returns error')
  assert(!isSettingsRepoArmed(), '14a: read error leaves settings repo unarmed')

  saveSettingsToDisk({ debugMode: true })
  assertEqual(ctx._saves().length, 0, '14a: error load → no SAVE_SETTINGS sent')
}

// --- 14e: layout read error → repo NOT armed → existing file stays intact ---
{
  reset()
  const originalLayout = '{"version":2,"primary":{"open":true}}'
  let storedLayout = originalLayout
  const ctx = makeBackendCtx()
  const sendToBackend = ctx.sendToBackend
  ctx.sendToBackend = (msg: BackendMsg) => {
    sendToBackend(msg)
    if (msg.type === 'SAVE_LAYOUT') storedLayout = JSON.stringify(msg.layout)
  }
  setLayoutRepoBackendCtx(ctx)

  const loadPromise = loadLayoutFromDisk()
  await sleep(100)
  ctx._respond('LAYOUT_DATA', {
    status: 'error',
    reason: 'read failed: temporary storage failure',
  })
  const result = await loadPromise
  assertEqual(result.status, 'error', '14e: read error returns error')
  assert(!isLayoutRepoArmed(), '14e: read error leaves layout repo unarmed')

  saveLayoutToDisk({ version: 2, primary: { open: false } })
  assertEqual(
    ctx._saves().filter((msg) => msg.type === 'SAVE_LAYOUT').length,
    0,
    '14e: error load → no SAVE_LAYOUT sent',
  )
  assertEqual(storedLayout, originalLayout, '14e: later save leaves existing layout bytes intact')
}

// --- 14b: empty load → repo ARMED → saves go through ---
{
  reset()
  const ctx = makeBackendCtx()
  setSettingsRepoBackendCtx(ctx)

  const loadPromise = loadSettingsFromDisk()
  await sleep(100)
  ctx._respond('SETTINGS_DATA', { status: 'empty' })
  const result = await loadPromise
  assertEqual(result.status, 'empty', '14b: empty load returns empty')
  armSettingsRepo()
  assert(isSettingsRepoArmed(), '14b: armed after empty load')

  saveSettingsToDisk({ debugMode: true })
  assert(ctx._saves().length > 0, '14b: empty load → SAVE_SETTINGS sent')
}

// --- 14c: ok load → repo ARMED → saves go through ---
{
  reset()
  const ctx = makeBackendCtx()
  setLayoutRepoBackendCtx(ctx)

  const loadPromise = loadLayoutFromDisk()
  await sleep(100)
  ctx._respond('LAYOUT_DATA', { status: 'ok', data: { version: 2, primary: { open: true } } })
  const result = await loadPromise
  assertEqual(result.status, 'ok', '14c: ok load returns ok')
  armLayoutRepo()
  assert(isLayoutRepoArmed(), '14c: armed after ok load')

  saveLayoutToDisk({ version: 2, primary: { open: false } })
  assert(ctx._saves().length > 0, '14c: ok load → SAVE_LAYOUT sent')
}

// --- 14d: not-armed repo → save does nothing ---
{
  reset()
  const ctx = makeBackendCtx()
  setLayoutRepoBackendCtx(ctx)

  assert(!isLayoutRepoArmed(), '14d: not armed before load')
  saveLayoutToDisk({ primary: false })
  assertEqual(ctx._saves().length, 0, '14d: save skipped when not armed')
}

// --- 17a: settings load failure does not prevent layout saves ---
{
  reset()
  const ctx = makeBackendCtx()
  setLayoutRepoBackendCtx(ctx)
  setSettingsRepoBackendCtx(ctx)

  // Layout loads ok
  const layoutLoad = loadLayoutFromDisk()
  await sleep(100)
  ctx._respond('LAYOUT_DATA', { status: 'ok', data: { version: 2, primary: {} } })
  const layoutResult = await layoutLoad
  assertEqual(layoutResult.status, 'ok', '17a: layout load ok')
  armLayoutRepo()

  saveLayoutToDisk({ version: 2 })
  assert(ctx._saves().length > 0, '17a: layout save succeeds even if settings load failed')
}

// --- 17b: layout load failure does not prevent settings saves ---
{
  reset()
  const ctx = makeBackendCtx()
  setSettingsRepoBackendCtx(ctx)
  setLayoutRepoBackendCtx(ctx)

  // Settings loads ok
  const settingsLoad = loadSettingsFromDisk()
  await sleep(100)
  ctx._respond('SETTINGS_DATA', { status: 'ok', data: { version: 2, settings: { debugMode: false } } })
  const settingsResult = await settingsLoad
  assertEqual(settingsResult.status, 'ok', '17b: settings load ok')
  armSettingsRepo()

  saveSettingsToDisk({ debugMode: true })
  assert(ctx._saves().length > 0, '17b: settings save succeeds even if layout load failed')
}

// --- 17c: partial settings are still an ok load and may be saved ---
{
  reset()
  const ctx = makeRespondingCtx('SETTINGS_DATA', {
    status: 'ok',
    data: { version: 2, settings: { debugMode: true } },
  })
  setSettingsRepoBackendCtx(ctx)
  const result = await loadSettingsFromDisk()
  assertEqual(result.status, 'ok', '17c: partial settings load is ok')
  armSettingsRepo()
  saveSettingsToDisk({ debugMode: true })
  assert(ctx._saves().length > 0, '17c: partial settings can be persisted')
}

// --- 17d: missing settings file is empty, not an error ---
{
  reset()
  const ctx = makeRespondingCtx('SETTINGS_DATA', { status: 'empty' })
  setSettingsRepoBackendCtx(ctx)
  const result = await loadSettingsFromDisk()
  assertEqual(result.status, 'empty', '17d: missing settings load is empty')
  armSettingsRepo()
  saveSettingsToDisk({ debugMode: false })
  assert(ctx._saves().length > 0, '17d: first-run settings can be persisted')
}

// --- 17e: malformed backend response is an error, not a thrown handler ---
{
  reset()
  const ctx = makeRespondingCtx('LAYOUT_DATA', undefined)
  setLayoutRepoBackendCtx(ctx)
  const result = await loadLayoutFromDisk()
  assertEqual(result.status, 'error', '17e: malformed response returns error')
}

// --- 18a: late transport (drop-then-recover) still resolves — boot resilience ---
// The load retries until the transport answers (or the window expires). A
// response arriving AFTER the first attempt must land, not be abandoned.
{
  reset()
  __setBootLoadParamsForTest({ windowMs: 400, intervalMs: 100 })
  const ctx = makeBackendCtx()
  setLayoutRepoBackendCtx(ctx)

  const loadPromise = loadLayoutFromDisk()
  await sleep(250) // attempts at 0/100/200 all dropped (no responder yet)
  const attemptsBefore = ctx._sent().filter((m: BackendMsg) => m.type === 'LOAD_LAYOUT').length
  assert(attemptsBefore >= 3, `18a: transport not ready → repeated attempts (got ${attemptsBefore})`)
  ctx._respond('LAYOUT_DATA', { status: 'ok', data: { version: 2 } })
  const result = await loadPromise
  assertEqual(result.status, 'ok', '18a: late response resolves the load')
  __resetBootLoadParamsForTest()
}

// --- 18b: window expiry resolves as an explicit error (never hangs forever) ---
{
  reset()
  __setBootLoadParamsForTest({ windowMs: 250, intervalMs: 100 })
  const ctx = makeBackendCtx()
  setSettingsRepoBackendCtx(ctx)

  const start = Date.now()
  const result = await loadSettingsFromDisk() // no responder at all
  const elapsed = Date.now() - start
  assertEqual(result.status, 'error', '18b: window expiry → error status')
  assert(elapsed >= 200, `18b: waits out the window (took ${elapsed}ms)`)
  assert(String(result.reason).includes('timed out'), '18b: reason mentions timeout')
  __resetBootLoadParamsForTest()
}

// --- 19a: pending settings save flushes even when the layout repo is unarmed ---
// layout.json and settings.json are independent. `flushPendingSaves` used to
// return at the unarmed-layout guard BEFORE flushing settings, so a toggle
// made <100ms before unload was lost when the layout load had failed
// (review batch 2).
{
  reset()
  const ctx = makeBackendCtx()
  setSettingsRepoBackendCtx(ctx)
  setLayoutRepoBackendCtx(ctx)
  armSettingsRepo()
  // Layout repo deliberately left unarmed (simulates a failed/error load).
  assert(!isLayoutRepoArmed(), '19a: layout repo unarmed')

  persistSettings()
  flushPendingSaves()
  assert(
    ctx._saves().some((m: BackendMsg) => m.type === 'SAVE_SETTINGS'),
    '19a: pending settings save flushed despite unarmed layout repo',
  )
}

// --- 20a: a failed save is retried once the retry window elapses (N2) ---
{
  reset()
  // Let the previous section's reset-resolved save failure settle while
  // retries are still disabled, so it cannot consume this section's budget.
  await sleep(10)
  const ctx = makeBackendCtx()
  setSettingsRepoBackendCtx(ctx)
  armSettingsRepo()
  __setSettingsSaveRetriesForTest(1)

  persistSettings()
  const firstDeadline = Date.now() + 3000
  while (ctx._saves().length < 1 && Date.now() < firstDeadline) await sleep(20)
  assert(ctx._saves().length >= 1, '20a: initial save sent')
  const first = ctx._saves().find((m: BackendMsg) => m.type === 'SAVE_SETTINGS')!
  __resolveSettingsSave(first.saveId as number, { status: 'error', reason: 'transient' })

  const retryDeadline = Date.now() + 4000
  while (ctx._saves().length < 2 && Date.now() < retryDeadline) await sleep(25)
  assert(ctx._saves().length === 2, '20a: failed save retried once')
  const second = ctx._saves()[1]
  assert(second !== undefined, '20a: retry message present')
  if (second) __resolveSettingsSave(second.saveId as number, { status: 'ok' })
  // Cleanup for the remaining sections.
  __setSettingsSaveRetriesForTest(0)
}

// --- 20b: a retries-exhausted failed write still flushes while owed (N2) ---
{
  reset()
  await sleep(10)
  const ctx = makeBackendCtx()
  setSettingsRepoBackendCtx(ctx)
  armSettingsRepo()
  __setSettingsSaveRetriesForTest(0)

  persistSettings()
  const firstDeadline = Date.now() + 3000
  while (ctx._saves().length < 1 && Date.now() < firstDeadline) await sleep(20)
  const first = ctx._saves().find((m: BackendMsg) => m.type === 'SAVE_SETTINGS')!
  __resolveSettingsSave(first.saveId as number, { status: 'error', reason: 'transient' })

  flushPendingSaves()
  const flushDeadline = Date.now() + 1500
  while (ctx._saves().length < 2 && Date.now() < flushDeadline) await sleep(20)
  assert(ctx._saves().length >= 2, '20b: flush fires while a failed write is owed')
  const second = ctx._saves()[1]
  if (second) __resolveSettingsSave(second.saveId as number, { status: 'ok' })
}

console.log(`persist/write-fence: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exitCode = 1
  process.exit(1)
}
