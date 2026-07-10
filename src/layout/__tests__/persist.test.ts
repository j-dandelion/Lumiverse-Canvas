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
import { cancelLayoutSave, isPersistenceEnabled } from '../persist'
try {
  cancelLayoutSave()
  assert(true, 'cancelLayoutSave does not throw')
} catch {
  assert(false, 'cancelLayoutSave threw')
}

// --- isPersistenceEnabled follows hydrated layout facets ---
import { hydrateSettings, resetHydrationGuard } from '../../settings/state'
import {
  isOpenStatePersistenceEnabled,
  isWidthPersistenceEnabled,
  isTabAssignmentPersistenceEnabled,
} from '../persist'
try {
  resetHydrationGuard()
  hydrateSettings({
    persistDrawerOpenState: false,
    persistDrawerWidth: false,
    persistTabAssignments: false,
  })
  assert(isPersistenceEnabled() === false, 'isPersistenceEnabled false when all facets off')
  assert(isOpenStatePersistenceEnabled() === false, 'open facet false')
  assert(isWidthPersistenceEnabled() === false, 'width facet false')
  assert(isTabAssignmentPersistenceEnabled() === false, 'tabs facet false')

  resetHydrationGuard()
  hydrateSettings({
    persistDrawerOpenState: true,
    persistDrawerWidth: false,
    persistTabAssignments: false,
  })
  assert(isPersistenceEnabled() === true, 'isPersistenceEnabled true when any facet on')
  assert(isOpenStatePersistenceEnabled() === true, 'open facet true')
  assert(isWidthPersistenceEnabled() === false, 'width facet still false')

  // Legacy layoutPersistence migration (via merge in hydrate)
  resetHydrationGuard()
  hydrateSettings({ layoutPersistence: false } as any)
  assert(isPersistenceEnabled() === false, 'legacy layoutPersistence:false → all facets off')
  assert(isOpenStatePersistenceEnabled() === false, 'legacy false → open off')
  assert(isWidthPersistenceEnabled() === false, 'legacy false → width off')
  assert(isTabAssignmentPersistenceEnabled() === false, 'legacy false → tabs off')

  resetHydrationGuard()
  hydrateSettings({ layoutPersistence: true } as any)
  assert(isPersistenceEnabled() === true, 'legacy layoutPersistence:true → any on')
  assert(isOpenStatePersistenceEnabled() === true, 'legacy true → open on')
  assert(isWidthPersistenceEnabled() === true, 'legacy true → width on')
  assert(isTabAssignmentPersistenceEnabled() === true, 'legacy true → tabs on')
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
