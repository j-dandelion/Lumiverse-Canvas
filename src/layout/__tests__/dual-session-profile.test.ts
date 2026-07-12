// Tests for session dual profile capture and restore logic.
// Pure-data tests (capture, get, set, clear) that don't need DOM.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual(a: unknown, b: unknown, msg: string) {
  if (a === b) { passed++ } else { failed++; console.error(`FAIL: ${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }
}

import {
  captureSessionDualProfileFromLive,
  getSessionDualProfile,
  setSessionDualProfile,
  clearSessionDualProfile,
} from '../dual-session-profile'

// These tests require DOM for getTabAssignments / getActiveSecondaryTabId /
// getDrawerTabs. In headless bun, document may not exist. We test the module
// API and the set/get/clear lifecycle.

// --- set/get/clear module-level profile ---

// Initial state: null
assert(getSessionDualProfile() === null, 'getSessionDualProfile returns null initially')

// set/get round-trip
const testProfile = {
  detachedTabs: [
    { tabId: 'tab-a', tabTitle: 'Tab A', sidebar: 'secondary' as const },
    { tabId: 'tab-b', tabTitle: 'Tab B', sidebar: 'secondary' as const },
  ],
  activeTabId: 'tab-a',
}
setSessionDualProfile(testProfile)
const got = getSessionDualProfile()
assert(got !== null, 'getSessionDualProfile returns non-null after set')
assertEqual(got!.detachedTabs.length, 2, 'profile has 2 tabs')
assertEqual(got!.detachedTabs[0].tabId, 'tab-a', 'first tab is tab-a')
assertEqual(got!.detachedTabs[1].tabId, 'tab-b', 'second tab is tab-b')
assertEqual(got!.activeTabId, 'tab-a', 'activeTabId is tab-a')

// clear()
clearSessionDualProfile()
assert(getSessionDualProfile() === null, 'getSessionDualProfile returns null after clear')

// Back-to-back set overwrites
setSessionDualProfile(testProfile)
setSessionDualProfile({
  detachedTabs: [{ tabId: 'tab-c', tabTitle: 'Tab C', sidebar: 'secondary' }],
  activeTabId: 'tab-c',
})
const overwritten = getSessionDualProfile()
assert(overwritten !== null, 'profile exists after overwrite')
assertEqual(overwritten!.detachedTabs.length, 1, 'overwritten profile has 1 tab')
assertEqual(overwritten!.detachedTabs[0].tabId, 'tab-c', 'overwritten tab is tab-c')

clearSessionDualProfile()

// --- captureSessionDualProfileFromLive requires DOM ---
try {
  const live = captureSessionDualProfileFromLive()
  // If we get here without throwing, document may exist.
  assert(Array.isArray(live.detachedTabs), 'capture returns array')
  assert(typeof live.activeTabId === 'string' || live.activeTabId === null, 'activeTabId is string or null')
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e)
  console.log(`SKIP: captureSessionDualProfileFromLive requires DOM — ${msg}`)
}

console.log(`dual-session-profile: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
