// Tests for host-settings.ts with mock setter injection.
// In jsdom/headless, the fiber walker can't find a real Zustand store,
// so we use __setHostSetSettingForTest to simulate the GO path.

import {
  getHostDrawerSettings,
  patchHostDrawerSettings,
  isHostDrawerSettingsWritable,
  clearHostSettingsCache,
  __setHostSetSettingForTest,
  __setSettingsApiFetchForTest,
  writeHostDrawerSettingsViaApi,
} from '../host-settings'

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed++ }
}
function assertArraysEqual(actual: readonly string[], expected: readonly string[], msg: string) {
  if (actual.length !== expected.length) {
    console.error(`FAIL: ${msg} — length mismatch (expected ${expected.length}, got ${actual.length})`)
    console.error(`  expected: ${JSON.stringify(expected)}`)
    console.error(`  actual:   ${JSON.stringify(actual)}`)
    failed++; return
  }
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) {
      console.error(`FAIL: ${msg} — diff at index ${i}: expected "${expected[i]}", got "${actual[i]}"`)
      console.error(`  expected: ${JSON.stringify(expected)}`)
      console.error(`  actual:   ${JSON.stringify(actual)}`)
      failed++; return
    }
  }
  passed++
}

// Cleanup between tests
function reset() {
  clearHostSettingsCache()
}

// =====================================================================
// Initial state: no setter injected → unwritable, null settings
// =====================================================================
{
  reset()
  assert(!isHostDrawerSettingsWritable(), 'initially not writable')
  assertEqual(getHostDrawerSettings(), null, 'getHostDrawerSettings returns null without mock')
  assert(!patchHostDrawerSettings({ side: 'left' }), 'patch returns false without mock')
}

// =====================================================================
// With mock setter injected → writable, patch succeeds
// =====================================================================
{
  reset()
  const written: Array<{ key: string; value: unknown }> = []
  __setHostSetSettingForTest(
    (key: string, value: unknown) => { written.push({ key, value }) },
    { side: 'right', tabOrder: ['profile', 'presets'], hiddenTabIds: [] },
  )

  assert(isHostDrawerSettingsWritable(), 'writable after mock injection')
  assertEqual(getHostDrawerSettings()?.side, 'right', 'drawerSettings side is right')

  const result = patchHostDrawerSettings({ side: 'left', showTabLabels: true })
  assert(result, 'patch returns true')

  // Check what was passed to the mock setter
  assertEqual(written.length, 1, 'setSetting called exactly once')
  assertEqual(written[0].key, 'drawerSettings', 'setSetting key is drawerSettings')

  const merged = written[0].value as Record<string, unknown>
  assertEqual(merged.side, 'left', 'merged side is left')
  assertEqual(merged.showTabLabels, true, 'merged showTabLabels is true')
  // Original fields preserved
  assertArraysEqual(merged.tabOrder as string[], ['profile', 'presets'], 'merged tabOrder preserved')
  assertArraysEqual(merged.hiddenTabIds as string[], [], 'merged hiddenTabIds preserved')

  // getHostDrawerSettings reflects the write immediately
  const readBack = getHostDrawerSettings()
  assertEqual(readBack?.side, 'left', 'getHostDrawerSettings side is left after patch')
  assertEqual(readBack?.showTabLabels, true, 'getHostDrawerSettings showTabLabels after patch')
  assertArraysEqual(readBack?.tabOrder ?? [], ['profile', 'presets'], 'getHostDrawerSettings tabOrder preserved')
  assertArraysEqual(readBack?.hiddenTabIds ?? [], [], 'getHostDrawerSettings hiddenTabIds preserved')
}

// =====================================================================
// NO-GO side patch must NOT stamp the cache — a phantom side makes every
// side read (Configure draft, single-layout fallback) disagree with
// reality, so Configure re-attempts the swap on every Apply (2026-08-17).
// Non-side patches keep their optimistic stamp for Canvas chrome.
// =====================================================================
{
  reset()
  assert(!patchHostDrawerSettings({ side: 'right' }), 'NO-GO side patch returns false')
  assertEqual((getHostDrawerSettings() as any)?.side, undefined, 'NO-GO side patch does not stamp the cache (no phantom side)')

  assert(!patchHostDrawerSettings({ tabOrder: ['a', 'b'] }), 'NO-GO tabOrder patch returns false')
  assertArraysEqual((getHostDrawerSettings() as any)?.tabOrder ?? [], ['a', 'b'], 'NO-GO non-side patch still stamps the cache for Canvas chrome')
}

// =====================================================================
// Patch with no current settings → starts from empty object
// =====================================================================
{
  reset()
  const written: Array<{ key: string; value: unknown }> = []
  __setHostSetSettingForTest(
    (key: string, value: unknown) => { written.push({ key, value }) },
    null, // null drawerSettings
  )

  const result = patchHostDrawerSettings({ tabOrder: ['profile'] })
  assert(result, 'patch returns true with null current settings')

  const merged = written[0].value as Record<string, unknown>
  assertArraysEqual(merged.tabOrder as string[], ['profile'], 'merged tabOrder set')

  // getHostDrawerSettings reflects the write
  const readBack = getHostDrawerSettings()
  assertArraysEqual(readBack?.tabOrder ?? [], ['profile'], 'getHostDrawerSettings tabOrder after no-current patch')
}

// =====================================================================
// Clear mock → falls back to unwritable
// =====================================================================
{
  reset()
  __setHostSetSettingForTest((key: string, value: unknown) => {}, { side: 'left' })
  assert(isHostDrawerSettingsWritable(), 'writable while mock active')

  clearHostSettingsCache()
  assert(!isHostDrawerSettingsWritable(), 'not writable after clear')
  assertEqual(getHostDrawerSettings(), null, 'settings null after clear')
}

// =====================================================================
// Failed write (no setter) still stamps optimistic cache
// =====================================================================
{
  reset()
  const written: Array<{ key: string; value: unknown }> = []
  __setHostSetSettingForTest(
    (key: string, value: unknown) => { written.push({ key, value }) },
    { side: 'right', tabOrder: ['a', 'b'], hiddenTabIds: [] },
  )

  // Successful write populates cache
  assert(patchHostDrawerSettings({ side: 'left' }), 'first patch succeeds')
  assertEqual(getHostDrawerSettings()?.side, 'left', 'cache reflects first patch')

  // Clear mock setter but keep cached settings
  __setHostSetSettingForTest(null)

  // Without a setter, write should fail — but cache still merges so
  // isShowTabLabels / secondary menu wording follow the intentional click.
  // The SIDE is the exception: it can never be optimistic (the drawer
  // cannot move without the host store), so it is dropped — a phantom
  // cache side makes Configure re-attempt the swap on every Apply
  // (2026-08-17).
  const result = patchHostDrawerSettings({ side: 'right', showTabLabels: false })
  assert(!result, 'patch returns false without setter')
  assertEqual(written.length, 1, 'no setSetting call after mock cleared')

  const settings = getHostDrawerSettings()
  assertEqual(settings?.side, undefined, 'NO-GO side patch does not merge (no phantom side)')
  assertEqual(settings?.showTabLabels, false, 'cache merges showTabLabels on NO-GO')
  assertArraysEqual(settings?.tabOrder ?? [], ['a', 'b'], 'tabOrder preserved after NO-GO merge')
}

// =====================================================================
// Multiple patches merge incrementally
// =====================================================================
{
  reset()
  const written: Array<{ key: string; value: unknown }> = []
  __setHostSetSettingForTest(
    (key: string, value: unknown) => { written.push({ key, value }) },
    { side: 'right', tabOrder: ['a', 'b'], hiddenTabIds: [] },
  )

  patchHostDrawerSettings({ hiddenTabIds: ['b'] })
  patchHostDrawerSettings({ side: 'left' })

  assertEqual(written.length, 2, 'two patches recorded')

  const firstMerge = written[0].value as Record<string, unknown>
  assertArraysEqual(firstMerge.hiddenTabIds as string[], ['b'], 'first patch: hiddenTabIds set')
  assertEqual(firstMerge.side as string, 'right', 'first patch: side preserved from current')

  const secondMerge = written[1].value as Record<string, unknown>
  assertEqual(secondMerge.side as string, 'left', 'second patch: side updated')

  // getHostDrawerSettings reflects cumulative changes
  const readBack = getHostDrawerSettings()
  assertArraysEqual(readBack?.hiddenTabIds ?? [], ['b'], 'getHostDrawerSettings hiddenTabIds after multi-patch')
  assertEqual(readBack?.side, 'left', 'getHostDrawerSettings side after multi-patch')
  assertArraysEqual(readBack?.tabOrder ?? [], ['a', 'b'], 'getHostDrawerSettings tabOrder after multi-patch')
}

// =====================================================================
// writeHostDrawerSettingsViaApi — Lumiverse's own settings API fallback
// (the PUT the Settings modal's setSetting flush performs). GETs the
// current row, merges the patch, PUTs it back — never clobbers fields the
// page owns. Success → true; unreachable/rejected → false.
// =====================================================================
{
  reset()
  const calls: Array<{ method: string; url: string; body?: unknown }> = []
  const fakeFetch = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body })
    if ((init?.method ?? 'GET') === 'GET') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          key: 'drawerSettings',
          value: { side: 'left', showTabLabels: true, panelWidthMode: 'custom', customPanelWidth: 32, tabOrder: ['a', 'b'] },
          updated_at: 123,
        }),
      } as unknown as Response
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response
  }
  __setSettingsApiFetchForTest(fakeFetch as typeof fetch)

  const ok = await writeHostDrawerSettingsViaApi({ side: 'right' })
  assert(ok, 'API fallback returns true on success')

  assertEqual(calls.length, 2, 'GET then PUT')
  assertEqual(calls[0].method, 'GET', 'first call is GET (read current row)')
  assertEqual(calls[1].method, 'PUT', 'second call is PUT')
  assertEqual(calls[0].url, '/api/v1/settings/drawerSettings', 'GET url is the drawerSettings row')

  const putBody = JSON.parse(calls[1].body as string) as { value: Record<string, unknown> }
  assertEqual(putBody.value.side, 'right', 'PUT carries the patched side')
  assertEqual(putBody.value.showTabLabels, true, 'PUT preserves page-owned fields (showTabLabels)')
  assertEqual(putBody.value.customPanelWidth, 32, 'PUT preserves page-owned fields (customPanelWidth)')
  assertArraysEqual(putBody.value.tabOrder as string[], ['a', 'b'], 'PUT preserves tabOrder')

  // Failure: PUT rejected → false (caller converges on the real side).
  const rejectingFetch = async (url: string, init?: RequestInit): Promise<Response> => {
    if ((init?.method ?? 'GET') === 'GET') {
      return { ok: true, status: 200, json: async () => ({ value: { side: 'left' } }) } as unknown as Response
    }
    return { ok: false, status: 500, json: async () => ({}) } as unknown as Response
  }
  __setSettingsApiFetchForTest(rejectingFetch)
  const bad = await writeHostDrawerSettingsViaApi({ side: 'right' })
  assert(!bad, 'API fallback returns false when the PUT is rejected')

  // Failure: fetch throws (offline) → false.
  const offlineFetch = async () => { throw new Error('offline') }
  __setSettingsApiFetchForTest(offlineFetch)
  const offline = await writeHostDrawerSettingsViaApi({ side: 'right' })
  assert(!offline, 'API fallback returns false when fetch throws')

  __setSettingsApiFetchForTest(null)
}

// =====================================================================
// Summary
// =====================================================================
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}/${passed + failed}`)
