// Custom assertion harness — see Chronicle testing-conventions.md
let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}

import {
  getSettings,
  normalizeCanvasSettings,
  isTaskbarModeEnabled,
  isHideDrawerOpenCloseButtonsEnabled,
  isDragAndDropDrawerTabsEnabled,
} from '../state'
import { mergeCanvasSettings } from '../../types'

// --- getSettings returns default settings ---
const settings = getSettings()
assert(settings !== null && settings !== undefined, 'getSettings returns a value')
assert(typeof settings === 'object', 'getSettings returns an object')

// Verify all default fields exist
assert(typeof settings.secondSidebarEnabled === 'boolean', 'secondSidebarEnabled is boolean')
assert(typeof settings.resizeSidebars === 'boolean', 'resizeSidebars is boolean')
assert(typeof settings.mirrorCompactPosition === 'boolean', 'mirrorCompactPosition is boolean')
assert(typeof settings.chatReflow === 'boolean', 'chatReflow is boolean')
assert(typeof settings.persistDrawerOpenState === 'boolean', 'persistDrawerOpenState is boolean')
assert(typeof settings.persistDrawerWidth === 'boolean', 'persistDrawerWidth is boolean')
assert(typeof settings.slashCommandsEnabled === 'boolean', 'slashCommandsEnabled is boolean')
assert(typeof settings.debugMode === 'boolean', 'debugMode is boolean')
assert(typeof settings.drawerShadowsDesktop === 'boolean', 'drawerShadowsDesktop is boolean')
assert(typeof settings.drawerShadowsMobile === 'boolean', 'drawerShadowsMobile is boolean')
assert(typeof settings.hideDrawerOpenCloseButtons === 'boolean', 'hideDrawerOpenCloseButtons is boolean')
assert(typeof settings.dragAndDropDrawerTabs === 'boolean', 'dragAndDropDrawerTabs is boolean')

// Check specific defaults
assertEqual(settings.secondSidebarEnabled, true, 'secondSidebarEnabled defaults to true')
assertEqual(settings.debugMode, false, 'debugMode defaults to false')
assertEqual(settings.drawerShadowsDesktop, true, 'drawerShadowsDesktop defaults to true')
assertEqual(settings.drawerShadowsMobile, false, 'drawerShadowsMobile defaults to false')
assertEqual(settings.slashCommandsEnabled, true, 'slashCommandsEnabled defaults to true')
assertEqual(settings.hideDrawerOpenCloseButtons, false, 'hideDrawerOpenCloseButtons defaults to false')
// Default true in DEFAULT_CANVAS_SETTINGS and stays on after normalize
// (S7 removed the taskbar cascade — the toggle is the only gate).
assertEqual(settings.dragAndDropDrawerTabs, true, 'dragAndDropDrawerTabs defaults to true (S7 toggle-only gate)')

// --- mergeCanvasSettings merges correctly ---
// null input → all defaults
const fromNull = mergeCanvasSettings(null)
assertEqual(fromNull.secondSidebarEnabled, true, 'mergeCanvasSettings(null) keeps default secondSidebarEnabled')
assertEqual(fromNull.debugMode, false, 'mergeCanvasSettings(null) keeps default debugMode')
assertEqual(fromNull.hideDrawerOpenCloseButtons, false, 'mergeCanvasSettings(null) keeps default hideDrawerOpenCloseButtons')

// Partial input overrides matching keys
const partial = mergeCanvasSettings({ debugMode: true, chatReflow: false })
assertEqual(partial.debugMode, true, 'mergeCanvasSettings overrides debugMode')
assertEqual(partial.chatReflow, false, 'mergeCanvasSettings overrides chatReflow')
// Non-specified keys keep defaults
assertEqual(partial.secondSidebarEnabled, true, 'mergeCanvasSettings preserves unmentioned keys')

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

// Legacy layoutPersistence → two layout facets (persistTabAssignments is always-on,
// so legacy only maps to open + width).
{
  const fromNull = mergeCanvasSettings(null)
  assertEqual(fromNull.persistDrawerOpenState, true, 'default persistDrawerOpenState true')
  assertEqual(fromNull.persistDrawerWidth, true, 'default persistDrawerWidth true')

  const legacyOff = mergeCanvasSettings({ layoutPersistence: false } as any)
  assertEqual(legacyOff.persistDrawerOpenState, false, 'legacy layoutPersistence:false → open false')
  assertEqual(legacyOff.persistDrawerWidth, false, 'legacy layoutPersistence:false → width false')

  const legacyOn = mergeCanvasSettings({ layoutPersistence: true } as any)
  assertEqual(legacyOn.persistDrawerOpenState, true, 'legacy layoutPersistence:true → open true')
  assertEqual(legacyOn.persistDrawerWidth, true, 'legacy layoutPersistence:true → width true')

  const newOnly = mergeCanvasSettings({ persistDrawerWidth: false })
  assertEqual(newOnly.persistDrawerWidth, false, 'new key persistDrawerWidth false')
  assertEqual(newOnly.persistDrawerOpenState, true, 'missing new keys keep default open true')

  const newWins = mergeCanvasSettings({
    persistDrawerOpenState: false,
    persistDrawerWidth: true,
    layoutPersistence: true,
  } as any)
  assertEqual(newWins.persistDrawerOpenState, false, 'new open key wins over legacy')
  assertEqual(newWins.persistDrawerWidth, true, 'new width key used')
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    console.error(`FAIL: ${message} — expected ${expected}, got ${actual}`)
    failed++
  }
}

// --- S1: taskbarMode no longer requires moveControlsToOuterEdge (cascade
// dropped — ownership is unconditional; the effective pin gate
// isTaskbarModeEnabled still requires both). ---
{
  const kept = normalizeCanvasSettings(
    mergeCanvasSettings({ taskbarMode: true, moveControlsToOuterEdge: false }),
  )
  assertEqual(kept.taskbarMode, true, 'normalize: taskbar stays on when outer edge off (S1)')
  assertEqual(kept.moveControlsToOuterEdge, false, 'normalize: outer edge stays off')
  assertEqual(
    isTaskbarModeEnabled(kept),
    false,
    'isTaskbarModeEnabled false when outer off (effective gate)',
  )

  const both = normalizeCanvasSettings(
    mergeCanvasSettings({ taskbarMode: true, moveControlsToOuterEdge: true }),
  )
  assertEqual(both.taskbarMode, true, 'normalize: taskbar stays on when outer on')
  assertEqual(
    isTaskbarModeEnabled(both),
    true,
    'isTaskbarModeEnabled true when both on',
  )
}

// --- hideDrawerOpenCloseButtons requires taskbarMode ---
// hide alone (no taskbar mode) → clear hide
{
  const normalized = normalizeCanvasSettings(
    mergeCanvasSettings({
      hideDrawerOpenCloseButtons: true,
      moveControlsToOuterEdge: false,
      taskbarMode: false,
    }),
  )
  assertEqual(
    normalized.hideDrawerOpenCloseButtons,
    false,
    'hide cleared when taskbar mode is off (independent not enough)',
  )
  assertEqual(
    normalized.moveControlsToOuterEdge,
    false,
    'hide: outer edge stays off',
  )
  assertEqual(
    normalized.taskbarMode,
    false,
    'hide: taskbar stays off',
  )
  assertEqual(
    isHideDrawerOpenCloseButtonsEnabled(normalized),
    false,
    'isHideDrawerOpenCloseButtonsEnabled false when hide cleared',
  )
}

// hide + taskbar + outer-edge → stays on
{
  const both = normalizeCanvasSettings(
    mergeCanvasSettings({
      hideDrawerOpenCloseButtons: true,
      taskbarMode: true,
      moveControlsToOuterEdge: true,
    }),
  )
  assertEqual(both.hideDrawerOpenCloseButtons, true, 'hide stays on when taskbar + outer-edge on')
  assertEqual(
    isHideDrawerOpenCloseButtonsEnabled(both),
    true,
    'isHideDrawerOpenCloseButtonsEnabled true when all three on',
  )
}

// S1: outer-edge off no longer cascades taskbar off — taskbar + hide keep
// their settings (inert while the effective pin gate is off); hide stays
// cleared only when taskbarMode itself is off.
{
  const cascade = normalizeCanvasSettings(
    mergeCanvasSettings({
      hideDrawerOpenCloseButtons: true,
      taskbarMode: true,
      moveControlsToOuterEdge: false,
    }),
  )
  assertEqual(cascade.moveControlsToOuterEdge, false, 'cascade: outer-edge off')
  assertEqual(cascade.taskbarMode, true, 'cascade: taskbar kept (S1 — no clearing)')
  assertEqual(cascade.hideDrawerOpenCloseButtons, true, 'cascade: hide kept (taskbar still on)')
  assertEqual(
    isTaskbarModeEnabled(cascade),
    false,
    'cascade: isTaskbarModeEnabled false (effective gate)',
  )
  assertEqual(
    isHideDrawerOpenCloseButtonsEnabled(cascade),
    false,
    'cascade: isHideDrawerOpenCloseButtonsEnabled false',
  )
}

// taskbar off, outer-edge on, hide on → hide cleared (direct dependency)
{
  const direct = normalizeCanvasSettings(
    mergeCanvasSettings({
      hideDrawerOpenCloseButtons: true,
      taskbarMode: false,
      moveControlsToOuterEdge: true,
    }),
  )
  assertEqual(direct.taskbarMode, false, 'direct: taskbar stays off')
  assertEqual(direct.moveControlsToOuterEdge, true, 'direct: outer-edge stays on')
  assertEqual(direct.hideDrawerOpenCloseButtons, false, 'direct: hide cleared when taskbar off')
}

// --- dragAndDropDrawerTabs: toggle-only gate (S7 — taskbar cascade removed) ---
{
  // Toggle on + taskbar OFF → kept by normalize AND effectively enabled.
  const onTaskbarOff = normalizeCanvasSettings(
    mergeCanvasSettings({
      dragAndDropDrawerTabs: true,
      taskbarMode: false,
      moveControlsToOuterEdge: true,
    }),
  )
  assertEqual(
    onTaskbarOff.dragAndDropDrawerTabs,
    true,
    'dnd S7: drag kept when taskbar mode is off (cascade removed)',
  )
  assertEqual(
    isDragAndDropDrawerTabsEnabled(onTaskbarOff),
    true,
    'dnd S7: isDragAndDropDrawerTabsEnabled true with taskbar off (toggle-only gate)',
  )

  const both = normalizeCanvasSettings(
    mergeCanvasSettings({
      dragAndDropDrawerTabs: true,
      taskbarMode: true,
      moveControlsToOuterEdge: true,
    }),
  )
  assertEqual(both.dragAndDropDrawerTabs, true, 'dragAndDrop stays on when taskbar + outer-edge on')
  assertEqual(
    isDragAndDropDrawerTabsEnabled(both),
    true,
    'isDragAndDropDrawerTabsEnabled true when taskbar + outer-edge on',
  )

  // Toggle off → disabled regardless of taskbar mode.
  const offTaskbarOn = normalizeCanvasSettings(
    mergeCanvasSettings({
      dragAndDropDrawerTabs: false,
      taskbarMode: true,
      moveControlsToOuterEdge: true,
    }),
  )
  assertEqual(
    isDragAndDropDrawerTabsEnabled(offTaskbarOn),
    false,
    'dnd S7: toggle off → disabled even with taskbar on',
  )

  // hide still cascades (unchanged) while drag no longer does.
  const cascade = normalizeCanvasSettings(
    mergeCanvasSettings({
      dragAndDropDrawerTabs: true,
      hideDrawerOpenCloseButtons: true,
      taskbarMode: true,
      moveControlsToOuterEdge: false,
    }),
  )
  assertEqual(cascade.taskbarMode, true, 'dnd cascade: taskbar kept (S1 — outer-edge off does not clear)')
  assertEqual(cascade.dragAndDropDrawerTabs, true, 'dnd cascade: drag kept (S7 — no clearing)')
  assertEqual(cascade.hideDrawerOpenCloseButtons, true, 'dnd cascade: hide kept (taskbar on)')
  assertEqual(
    isDragAndDropDrawerTabsEnabled(cascade),
    true,
    'dnd cascade: isDragAndDropDrawerTabsEnabled true (S7 — outer-edge off no longer disables)',
  )

  // Raw default true survives merge before normalize with taskbar off too.
  const rawDefault = mergeCanvasSettings({
    taskbarMode: false,
    moveControlsToOuterEdge: true,
  })
  assertEqual(
    rawDefault.dragAndDropDrawerTabs,
    true,
    'merge default dragAndDropDrawerTabs true with taskbar off (S7)',
  )
}

// Legacy keepTabListVisible → taskbarMode migration
{
  const migrated = mergeCanvasSettings({ keepTabListVisible: true, moveControlsToOuterEdge: true } as any)
  assertEqual(migrated.taskbarMode, true, 'migration: legacy keepTabListVisible maps to taskbarMode')
  assertEqual((migrated as any).keepTabListVisible, undefined, 'migration: zombie keepTabListVisible is dropped')

  const newKeyWins = mergeCanvasSettings({ taskbarMode: false, keepTabListVisible: true } as any)
  assertEqual(newKeyWins.taskbarMode, false, 'migration: new key taskbarMode wins over legacy')

  const noLegacy = mergeCanvasSettings({ taskbarMode: true, moveControlsToOuterEdge: true })
  assertEqual(noLegacy.taskbarMode, true, 'migration: new key alone works')
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
