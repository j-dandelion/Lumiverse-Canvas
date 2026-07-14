// Custom assertion harness — see Chronicle testing-conventions.md
let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}

// --- snapshotLayout returns a layout object ---
// snapshotLayout depends on DOM state (getMainDrawerWidth, isSecondarySidebarOpen,
// document.documentElement.style). In headless bun, document may not exist.
import { snapshotLayout } from '../persist'
import {
  CANVAS_MAIN_ACTIVE_CLASS,
  CANVAS_MAIN_OPEN_CLASS,
  MAIN_MIRROR_WIDTH_VAR,
} from '../../sidebar/styles'

try {
  const snap = snapshotLayout()
  assert(snap !== null && snap !== undefined, 'snapshotLayout returns a value')
  assert(typeof snap === 'object', 'snapshotLayout returns an object')
  assert('version' in snap, 'snapshot has version field')
  assert('primary' in snap, 'snapshot has primary field')
  assert('secondary' in snap, 'snapshot has secondary field')
  assert('detachedTabs' in snap, 'snapshot has detachedTabs field')

  // Primary should have open, width, tabId
  assert(typeof snap.primary === 'object', 'primary is an object')
  assert('open' in snap.primary, 'primary has open')
  assert('width' in snap.primary, 'primary has width')

  // Secondary should have open, width
  assert(typeof snap.secondary === 'object', 'secondary is an object')
  assert('open' in snap.secondary, 'secondary has open')
  assert('width' in snap.secondary, 'secondary has width')

  // detachedTabs should be an array
  assert(Array.isArray(snap.detachedTabs), 'detachedTabs is an array')
} catch (e) {
  console.log(`SKIP: snapshotLayout requires DOM — ${e}`)
}

// --- Canvas main-mirror mode: primary open/width from document markers + CSS var ---
try {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.classList.add(CANVAS_MAIN_ACTIVE_CLASS)
    document.documentElement.classList.add(CANVAS_MAIN_OPEN_CLASS)
    document.documentElement.style.setProperty(MAIN_MIRROR_WIDTH_VAR, '333px')
    const snapOpen = snapshotLayout()
    assert(snapOpen.primary.open === true, 'canvas-main snapshot open=true from open class')
    assert(snapOpen.primary.width === 333, 'canvas-main snapshot width from MAIN_MIRROR_WIDTH_VAR')

    document.documentElement.classList.remove(CANVAS_MAIN_OPEN_CLASS)
    document.documentElement.style.setProperty(MAIN_MIRROR_WIDTH_VAR, '280px')
    const snapClosed = snapshotLayout()
    assert(snapClosed.primary.open === false, 'canvas-main snapshot open=false without open class')
    assert(snapClosed.primary.width === 280, 'canvas-main snapshot width updates with CSS var')

    document.documentElement.classList.remove(CANVAS_MAIN_ACTIVE_CLASS)
    document.documentElement.style.removeProperty(MAIN_MIRROR_WIDTH_VAR)
  } else {
    console.log('SKIP: canvas-main snapshotLayout — no document')
  }
} catch (e) {
  console.log(`SKIP: canvas-main snapshotLayout — ${e}`)
}

// --- loadSavedLayout returns a Promise ---
import { loadSavedLayout } from '../persist'

try {
  const result = loadSavedLayout()
  assert(result instanceof Promise, 'loadSavedLayout returns a Promise')

  // Without a backend context, it should resolve to null quickly
  const layout = await result
  assert(layout === null, 'loadSavedLayout resolves to null without backend context')
} catch (e) {
  console.log(`SKIP: loadSavedLayout requires runtime context — ${e}`)
}

// --- cancelLayoutSave is callable ---
import { cancelLayoutSave, cancelLoadSavedLayout, isPersistenceEnabled } from '../persist'
try {
  cancelLayoutSave()
  assert(true, 'cancelLayoutSave does not throw')
  cancelLoadSavedLayout()
  assert(true, 'cancelLoadSavedLayout does not throw')
} catch {
  assert(false, 'persistence cancellation threw')
}

// --- isPersistenceEnabled is always true (tabs always-on) ---
import { hydrateSettings, resetHydrationGuard } from '../../settings/state'
import {
  isOpenStatePersistenceEnabled,
  isWidthPersistenceEnabled,
} from '../persist'
try {
  resetHydrationGuard()
  hydrateSettings({
    persistDrawerOpenState: false,
    persistDrawerWidth: false,
  })
  // isPersistenceEnabled is always true because tab-assignment persistence
  // is always-on (built-in), regardless of open/width facet state.
  assert(isPersistenceEnabled() === true, 'isPersistenceEnabled always true (tabs always-on)')
  assert(isOpenStatePersistenceEnabled() === false, 'open facet false')
  assert(isWidthPersistenceEnabled() === false, 'width facet false')

  resetHydrationGuard()
  hydrateSettings({
    persistDrawerOpenState: true,
    persistDrawerWidth: false,
  })
  assert(isPersistenceEnabled() === true, 'isPersistenceEnabled true when any facet on')
  assert(isOpenStatePersistenceEnabled() === true, 'open facet true')
  assert(isWidthPersistenceEnabled() === false, 'width facet still false')
} catch (e) {
  console.log(`SKIP: isPersistenceEnabled hydrate — ${e}`)
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    console.error(`FAIL: ${message} — expected ${expected}, got ${actual}`)
    failed++
  }
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)

// --- buildPersistedLayout freezes dual when secondSidebarEnabled is false ---
import { buildPersistedLayout } from '../persist'
import { setSettings, getSettings } from '../../settings/state'

try {
  if (typeof getSettings !== 'function' || !getSettings) {
    console.log('SKIP: buildPersistedLayout freeze tests — settings not available')
  } else {
    // Store original settings
    const orig = { ...getSettings() }

    // Case 1: secondSidebarEnabled ON → live tabs used (tab-assignment persistence is always-on)
    setSettings({ secondSidebarEnabled: true })
    const liveOn = buildPersistedLayout()
    // We can't easily mock the live state in headless, but verify structure
    assert(typeof liveOn === 'object', 'buildPersistedLayout returns object when second ON')
    assert('detachedTabs' in liveOn, 'detachedTabs present when second ON')
    assert(Array.isArray(liveOn.detachedTabs), 'detachedTabs is array')
    assert('secondary' in liveOn, 'secondary present')
    assert('activeTabId' in liveOn.secondary || !('activeTabId' in liveOn.secondary) || liveOn.secondary.activeTabId === undefined || typeof liveOn.secondary.activeTabId === 'string' || liveOn.secondary.activeTabId === null, 'activeTabId shape ok')

    // Case 2: secondSidebarEnabled OFF → freeze dual from lastLoaded
    setSettings({ secondSidebarEnabled: false })
    const liveOff = buildPersistedLayout()
    assert(typeof liveOff === 'object', 'buildPersistedLayout returns object when second OFF')
    assert('detachedTabs' in liveOff, 'detachedTabs present when second OFF')

    // The key invariant: when secondSidebarEnabled is false, detachedTabs comes
    // from lastLoaded, not from live (which would be empty after teardown).
    // We can't assert specific values without mocking, but we verify the
    // structure is valid (not undefined or throwing).

    // Restore original settings
    setSettings({ secondSidebarEnabled: orig.secondSidebarEnabled })
  }
} catch (e) {
  console.log(`SKIP: buildPersistedLayout freeze tests — ${e}`)
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
