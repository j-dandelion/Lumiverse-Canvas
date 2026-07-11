// Tests for host-settings.ts with mock setter injection.
// In jsdom/headless, the fiber walker can't find a real Zustand store,
// so we use __setHostSetSettingForTest to simulate the GO path.

import {
  getHostDrawerSettings,
  patchHostDrawerSettings,
  isHostDrawerSettingsWritable,
  clearHostSettingsCache,
  __setHostSetSettingForTest,
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
}

// =====================================================================
// Summary
// =====================================================================
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}/${passed + failed}`)
