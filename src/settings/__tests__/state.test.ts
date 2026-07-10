// Custom assertion harness — see Chronicle testing-conventions.md
let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}

import { getSettings, normalizeCanvasSettings, isKeepTabListVisibleEnabled } from '../state'
import { mergeCanvasSettings } from '../../types'

// --- getSettings returns default settings ---
const settings = getSettings()
assert(settings !== null && settings !== undefined, 'getSettings returns a value')
assert(typeof settings === 'object', 'getSettings returns an object')

// Verify all default fields exist
assert(typeof settings.secondSidebarEnabled === 'boolean', 'secondSidebarEnabled is boolean')
assert(typeof settings.resizeSidebars === 'boolean', 'resizeSidebars is boolean')
assert(typeof settings.mirrorCompactPosition === 'boolean', 'mirrorCompactPosition is boolean')
assert(typeof settings.showTabLabels === 'string', 'showTabLabels is string')
assert(typeof settings.chatReflow === 'boolean', 'chatReflow is boolean')
assert(typeof settings.persistDrawerOpenState === 'boolean', 'persistDrawerOpenState is boolean')
assert(typeof settings.persistDrawerWidth === 'boolean', 'persistDrawerWidth is boolean')
assert(typeof settings.persistTabAssignments === 'boolean', 'persistTabAssignments is boolean')
assert(typeof settings.slashCommandsEnabled === 'boolean', 'slashCommandsEnabled is boolean')
assert(typeof settings.debugMode === 'boolean', 'debugMode is boolean')
assert(typeof settings.drawerShadowsDesktop === 'boolean', 'drawerShadowsDesktop is boolean')
assert(typeof settings.drawerShadowsMobile === 'boolean', 'drawerShadowsMobile is boolean')

// Check specific defaults
assertEqual(settings.secondSidebarEnabled, true, 'secondSidebarEnabled defaults to true')
assertEqual(settings.debugMode, false, 'debugMode defaults to false')
assertEqual(settings.showTabLabels, 'follow', 'showTabLabels defaults to follow')
assertEqual(settings.drawerShadowsDesktop, true, 'drawerShadowsDesktop defaults to true')
assertEqual(settings.drawerShadowsMobile, false, 'drawerShadowsMobile defaults to false')
assertEqual(settings.slashCommandsEnabled, true, 'slashCommandsEnabled defaults to true')

// --- mergeCanvasSettings merges correctly ---
// null input → all defaults
const fromNull = mergeCanvasSettings(null)
assertEqual(fromNull.secondSidebarEnabled, true, 'mergeCanvasSettings(null) keeps default secondSidebarEnabled')
assertEqual(fromNull.debugMode, false, 'mergeCanvasSettings(null) keeps default debugMode')

// Partial input overrides matching keys
const partial = mergeCanvasSettings({ debugMode: true, chatReflow: false })
assertEqual(partial.debugMode, true, 'mergeCanvasSettings overrides debugMode')
assertEqual(partial.chatReflow, false, 'mergeCanvasSettings overrides chatReflow')
// Non-specified keys keep defaults
assertEqual(partial.secondSidebarEnabled, true, 'mergeCanvasSettings preserves unmentioned keys')
assertEqual(partial.showTabLabels, 'follow', 'mergeCanvasSettings preserves showTabLabels')

// Undefined values in saved object are ignored (keep defaults)
const withUndefined = mergeCanvasSettings({ debugMode: undefined })
assertEqual(withUndefined.debugMode, false, 'mergeCanvasSettings ignores undefined values')

// Empty object → all defaults
const fromEmpty = mergeCanvasSettings({})
assertEqual(fromEmpty.secondSidebarEnabled, true, 'mergeCanvasSettings({}) keeps all defaults')

// slashCommandsEnabled — must merge with default (true) and accept an explicit false
const slashDefault = mergeCanvasSettings({})
assertEqual(slashDefault.slashCommandsEnabled, true, 'mergeCanvasSettings default slashCommandsEnabled=true')
assert(slashDefault.slashCommandsEnabled === true, 'mergeCanvasSettings default slashCommandsEnabled=true (assert)')
const slashOff = mergeCanvasSettings({ slashCommandsEnabled: false })
assertEqual(slashOff.slashCommandsEnabled, false, 'mergeCanvasSettings respects explicit slashCommandsEnabled=false')
assert(slashOff.slashCommandsEnabled === false, 'mergeCanvasSettings respects explicit slashCommandsEnabled=false (assert)')

// Legacy sidebarShadows* → drawerShadows* migration
{
  const legacyOnly = mergeCanvasSettings({
    sidebarShadowsDesktop: false,
    sidebarShadowsMobile: true,
  } as any)
  assertEqual(legacyOnly.drawerShadowsDesktop, false, 'legacy sidebarShadowsDesktop maps to drawerShadowsDesktop')
  assertEqual(legacyOnly.drawerShadowsMobile, true, 'legacy sidebarShadowsMobile maps to drawerShadowsMobile')

  const newOnly = mergeCanvasSettings({ drawerShadowsDesktop: false })
  assertEqual(newOnly.drawerShadowsDesktop, false, 'new key drawerShadowsDesktop is used as-is')
  assertEqual(newOnly.drawerShadowsMobile, false, 'unmentioned drawerShadowsMobile keeps default')

  const newWins = mergeCanvasSettings({
    drawerShadowsDesktop: true,
    drawerShadowsMobile: false,
    sidebarShadowsDesktop: false,
    sidebarShadowsMobile: true,
  } as any)
  assertEqual(newWins.drawerShadowsDesktop, true, 'new key wins over legacy sidebarShadowsDesktop')
  assertEqual(newWins.drawerShadowsMobile, false, 'new key wins over legacy sidebarShadowsMobile')
}

// Legacy layoutPersistence → three layout facets
{
  const fromNull = mergeCanvasSettings(null)
  assertEqual(fromNull.persistDrawerOpenState, true, 'default persistDrawerOpenState true')
  assertEqual(fromNull.persistDrawerWidth, true, 'default persistDrawerWidth true')
  assertEqual(fromNull.persistTabAssignments, true, 'default persistTabAssignments true')

  const legacyOff = mergeCanvasSettings({ layoutPersistence: false } as any)
  assertEqual(legacyOff.persistDrawerOpenState, false, 'legacy layoutPersistence:false → open false')
  assertEqual(legacyOff.persistDrawerWidth, false, 'legacy layoutPersistence:false → width false')
  assertEqual(legacyOff.persistTabAssignments, false, 'legacy layoutPersistence:false → tabs false')

  const legacyOn = mergeCanvasSettings({ layoutPersistence: true } as any)
  assertEqual(legacyOn.persistDrawerOpenState, true, 'legacy layoutPersistence:true → open true')
  assertEqual(legacyOn.persistDrawerWidth, true, 'legacy layoutPersistence:true → width true')
  assertEqual(legacyOn.persistTabAssignments, true, 'legacy layoutPersistence:true → tabs true')

  const newOnly = mergeCanvasSettings({ persistDrawerWidth: false })
  assertEqual(newOnly.persistDrawerWidth, false, 'new key persistDrawerWidth false')
  assertEqual(newOnly.persistDrawerOpenState, true, 'missing new keys keep default open true')
  assertEqual(newOnly.persistTabAssignments, true, 'missing new keys keep default tabs true')

  const newWins = mergeCanvasSettings({
    persistDrawerOpenState: false,
    persistDrawerWidth: true,
    layoutPersistence: true,
  } as any)
  assertEqual(newWins.persistDrawerOpenState, false, 'new open key wins over legacy')
  assertEqual(newWins.persistDrawerWidth, true, 'new width key used')
  assertEqual(newWins.persistTabAssignments, true, 'missing new tab key keeps default (legacy ignored when any new present)')
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    console.error(`FAIL: ${message} — expected ${expected}, got ${actual}`)
    failed++
  }
}

// --- keepTabListVisible requires moveControlsToOuterEdge ---
{
  const cleared = normalizeCanvasSettings(
    mergeCanvasSettings({ keepTabListVisible: true, moveControlsToOuterEdge: false }),
  )
  assertEqual(cleared.keepTabListVisible, false, 'normalize: keep off when outer edge off')
  assertEqual(cleared.moveControlsToOuterEdge, false, 'normalize: outer edge stays off')
  assertEqual(
    isKeepTabListVisibleEnabled(cleared),
    false,
    'isKeepTabListVisibleEnabled false when outer off',
  )

  const both = normalizeCanvasSettings(
    mergeCanvasSettings({ keepTabListVisible: true, moveControlsToOuterEdge: true }),
  )
  assertEqual(both.keepTabListVisible, true, 'normalize: keep stays on when outer on')
  assertEqual(
    isKeepTabListVisibleEnabled(both),
    true,
    'isKeepTabListVisibleEnabled true when both on',
  )
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
