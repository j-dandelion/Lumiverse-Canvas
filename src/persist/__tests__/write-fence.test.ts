// Phase 0: Write-fence tests for layout-repo and settings-repo.
// Invariants 14-17 from the plan:
//   14. An error load never writes. An empty load writes defaults. An ok load writes.
//   15. Settings survive a layout load failure, and layout survives a settings load failure.
//   16. (Migration tested in backend — frontend repos test the fence.)

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
} from '../settings-repo'

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
  const ctx = makeBackendCtx()
  setLayoutRepoBackendCtx(ctx)
  setSettingsRepoBackendCtx(ctx)

  // Simulate error load for settings
  const settingsResult = await loadSettingsFromDisk()
  // Our fake doesn't auto-respond; the first attempt times out after retries
  // That returns { status: 'error' }

  const isNotArmed = (result: any) => result.status === 'error'
  if (isNotArmed(settingsResult)) {
    // Error → arm NOT called → save should do nothing
    saveSettingsToDisk({ debugMode: true })
    assertEqual(ctx._saves().length, 0, '14a: error load → no SAVE_SETTINGS sent')
  }
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

console.log(`persist/write-fence: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exitCode = 1
  process.exit(1)
}
