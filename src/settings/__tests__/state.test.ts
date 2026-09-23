// Custom assertion harness — see Chronicle testing-conventions.md
let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}

import {
  getSettings,
  hydrateSettings,
  setSettings,
  normalizeCanvasSettings,
  isTaskbarModeEnabled,
  isHideDrawerOpenCloseButtonsEnabled,
  isDragAndDropDrawerTabsEnabled,
  getDrawerLocation,
  isHorizontalStrip,
  hydrateModeLayoutSlots,
  getSingleLayoutSlot,
  setSingleLayoutSlot,
  getDualLayoutSlot,
  setDualLayoutSlot,
  getOsSingleLayoutSlot,
  setOsSingleLayoutSlot,
  getOsDualLayoutSlot,
  setOsDualLayoutSlot,
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

// horizontalSplit (2026-09-16) — default 0.5, passthrough, numeric clamp.
assertEqual(fromNull.horizontalSplit, 0.5, 'mergeCanvasSettings(null) defaults horizontalSplit=0.5')
assertEqual(mergeCanvasSettings({ horizontalSplit: 0.3 }).horizontalSplit, 0.3, 'merge keeps explicit horizontalSplit')
assertEqual(mergeCanvasSettings({ horizontalSplit: 0.05 }).horizontalSplit, 0.1, 'merge clamps low horizontalSplit to 0.1')
assertEqual(mergeCanvasSettings({ horizontalSplit: 5 }).horizontalSplit, 0.9, 'merge clamps high horizontalSplit to 0.9')
assertEqual(mergeCanvasSettings({ horizontalSplit: -1 }).horizontalSplit, 0.1, 'merge clamps negative horizontalSplit')
assertEqual(mergeCanvasSettings({ horizontalSplit: Number.NaN }).horizontalSplit, 0.5, 'merge coerces NaN horizontalSplit to 0.5')
assertEqual(
  mergeCanvasSettings({ horizontalSplit: 'nope' as unknown as number }).horizontalSplit,
  0.5,
  'merge coerces non-number horizontalSplit to 0.5',
)

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
  if (actual === expected) {
    passed++
  } else {
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

// --- S8: Drawer location — coercion, invariant, ordering ---
{
  const defaults = mergeCanvasSettings({})
  assertEqual(defaults.drawerLocation, 'sides', 'drawerLocation defaults to sides')
  assertEqual(getDrawerLocation(defaults), 'sides', 'getDrawerLocation returns sides by default')
  assertEqual(isHorizontalStrip(defaults), false, 'isHorizontalStrip false by default')

  // Corrupt values coerce to sides (enum coercion is the first cascade).
  for (const bad of ['TOp', 'TOP', 'left', 'right', '', 42, null, true, {}]) {
    const coerced = normalizeCanvasSettings(
      mergeCanvasSettings({ drawerLocation: bad } as any),
    )
    assertEqual(
      coerced.drawerLocation,
      'sides',
      `corrupt drawerLocation ${JSON.stringify(bad)} coerces to sides`,
    )
  }

  // top/bottom force taskbar chrome on.
  const top = normalizeCanvasSettings(mergeCanvasSettings({ drawerLocation: 'top' }))
  assertEqual(top.drawerLocation, 'top', 'top is kept')
  assertEqual(top.taskbarMode, true, 'top forces taskbarMode on')
  assertEqual(top.moveControlsToOuterEdge, true, 'top forces moveControlsToOuterEdge on')
  assertEqual(isTaskbarModeEnabled(top), true, 'top → effective taskbar gate on')
  assertEqual(isHorizontalStrip(top), true, 'isHorizontalStrip true for top')

  const bottom = normalizeCanvasSettings(mergeCanvasSettings({ drawerLocation: 'bottom' }))
  assertEqual(bottom.drawerLocation, 'bottom', 'bottom is kept')
  assertEqual(bottom.taskbarMode, true, 'bottom forces taskbarMode on')
  assertEqual(bottom.moveControlsToOuterEdge, true, 'bottom forces outer-edge on')
  assertEqual(isHorizontalStrip(bottom), true, 'isHorizontalStrip true for bottom')

  // Ordering: the location invariant runs BEFORE the hide cascade, so a
  // hide:true + taskbar:false + location:top blob keeps hide (the invariant
  // turns taskbar on first).
  const ordering = normalizeCanvasSettings(mergeCanvasSettings({
    drawerLocation: 'top',
    hideDrawerOpenCloseButtons: true,
    taskbarMode: false,
    moveControlsToOuterEdge: false,
  }))
  assertEqual(ordering.hideDrawerOpenCloseButtons, true, 'hide survives the location invariant (ordering)')
  assertEqual(ordering.taskbarMode, true, 'ordering: taskbar forced on')
  assertEqual(isHideDrawerOpenCloseButtonsEnabled(ordering), true, 'ordering: effective hide gate on')

  // Normalize alone never forces the flags off on Sides (setSettings owns the
  // restore — see the S8 excursion block below).
  const back = normalizeCanvasSettings(mergeCanvasSettings({
    drawerLocation: 'sides',
    taskbarMode: true,
    moveControlsToOuterEdge: true,
  }))
  assertEqual(back.drawerLocation, 'sides', 'sides kept')
  assertEqual(back.taskbarMode, true, 'sides leaves taskbarMode on')
  assertEqual(back.moveControlsToOuterEdge, true, 'sides leaves moveControlsToOuterEdge on')
  assertEqual(isHorizontalStrip(back), false, 'isHorizontalStrip false after returning to sides')

  // Explicit sides never turns an existing taskbar choice off.
  const sidesOnly = normalizeCanvasSettings(mergeCanvasSettings({ drawerLocation: 'sides' }))
  assertEqual(sidesOnly.taskbarMode, false, 'sides alone does not force taskbarMode')
  assertEqual(sidesOnly.moveControlsToOuterEdge, false, 'sides alone does not force outer-edge')
}

// --- S8: Sides taskbar/outer-edge prefs survive a Top/Bottom excursion ---
// Top/Bottom force both flags on (normalize invariant). setSettings records
// the user's Sides values in `sidesChromePrefs` on an explicit toggle and
// restores them when the location returns to sides.
{
  // Explicit on/on while on Sides, round-tripped through Top.
  hydrateSettings(null)
  assertEqual(getSettings().drawerLocation, 'sides', 'excursion: starts on sides')
  assertEqual(getSettings().sidesChromePrefs, null, 'excursion: no snapshot until an explicit toggle')
  setSettings({ taskbarMode: true, moveControlsToOuterEdge: true })
  const snap = getSettings().sidesChromePrefs
  assertEqual(snap?.taskbarMode, true, 'excursion: on/on toggle recorded')
  assertEqual(snap?.moveControlsToOuterEdge, true, 'excursion: on/on toggle recorded (outer)')
  setSettings({ drawerLocation: 'top' })
  assertEqual(getSettings().taskbarMode, true, 'excursion: top forces taskbar on')
  assertEqual(getSettings().moveControlsToOuterEdge, true, 'excursion: top forces outer on')
  setSettings({ drawerLocation: 'sides' })
  assertEqual(getSettings().drawerLocation, 'sides', 'excursion: back on sides')
  assertEqual(getSettings().taskbarMode, true, 'excursion: restores taskbar on')
  assertEqual(getSettings().moveControlsToOuterEdge, true, 'excursion: restores outer on')

  // Explicit off/off while on Sides, round-tripped through Bottom.
  hydrateSettings(null)
  setSettings({ taskbarMode: false, moveControlsToOuterEdge: false })
  setSettings({ drawerLocation: 'bottom' })
  assertEqual(getSettings().taskbarMode, true, 'excursion: bottom forces taskbar on')
  setSettings({ drawerLocation: 'sides' })
  assertEqual(getSettings().taskbarMode, false, 'excursion: restores taskbar off')
  assertEqual(getSettings().moveControlsToOuterEdge, false, 'excursion: restores outer off')

  // Legacy blob (no snapshot) last saved while horizontal: the forced values
  // are not trustworthy, so the return to Sides falls back to the defaults
  // instead of leaving them on (the reported bug).
  hydrateSettings({ drawerLocation: 'top', taskbarMode: true, moveControlsToOuterEdge: true })
  assertEqual(getSettings().sidesChromePrefs, null, 'legacy: no snapshot')
  setSettings({ drawerLocation: 'sides' })
  assertEqual(getSettings().taskbarMode, false, 'legacy: falls back to default taskbar off')
  assertEqual(getSettings().moveControlsToOuterEdge, false, 'legacy: falls back to default outer off')
  assertEqual(getSettings().sidesChromePrefs?.taskbarMode, false, 'legacy: fallback recorded')

  // Persisted snapshot (reload while horizontal) is honored over defaults.
  hydrateSettings({
    drawerLocation: 'bottom',
    taskbarMode: true,
    moveControlsToOuterEdge: true,
    sidesChromePrefs: { taskbarMode: false, moveControlsToOuterEdge: true },
  })
  setSettings({ drawerLocation: 'sides' })
  assertEqual(getSettings().taskbarMode, false, 'persisted snapshot: restores taskbar off')
  assertEqual(getSettings().moveControlsToOuterEdge, true, 'persisted snapshot: restores outer on')

  // Corrupt snapshot shape is dropped by normalize → defaults fallback.
  const corrupt = normalizeCanvasSettings(mergeCanvasSettings({
    drawerLocation: 'top',
    sidesChromePrefs: { taskbarMode: 'yes', moveControlsToOuterEdge: 1 } as unknown as { taskbarMode: boolean; moveControlsToOuterEdge: boolean },
  }))
  assertEqual(corrupt.sidesChromePrefs, null, 'corrupt snapshot dropped to null')
  const corrupt2 = normalizeCanvasSettings(mergeCanvasSettings({
    drawerLocation: 'top',
    sidesChromePrefs: 'nope' as unknown as { taskbarMode: boolean; moveControlsToOuterEdge: boolean },
  }))
  assertEqual(corrupt2.sidesChromePrefs, null, 'non-object snapshot dropped to null')

  // A plain explicit toggle on Sides alone (without a location change)
  // keeps the record current for the next excursion.
  hydrateSettings(null)
  setSettings({ moveControlsToOuterEdge: true })
  assertEqual(getSettings().sidesChromePrefs?.moveControlsToOuterEdge, true, 'toggle records outer on')
  assertEqual(getSettings().sidesChromePrefs?.taskbarMode, false, 'toggle records taskbar default off')
}

// --- OS mode (cascade 2c/2d + osChromePrefs bookkeeping) ---
{
  // Defaults.
  assertEqual(settings.osMode, false, 'osMode defaults to false')
  assertEqual(settings.osChromePrefs, null, 'osChromePrefs defaults to null')

  // Cascade 2c: osMode forces the full taskbar chrome pair on (same pattern
  // as top/bottom drawerLocation).
  const osForced = normalizeCanvasSettings(mergeCanvasSettings({
    osMode: true,
    taskbarMode: false,
    moveControlsToOuterEdge: false,
  }))
  assertEqual(osForced.taskbarMode, true, 'osMode forces taskbarMode on')
  assertEqual(osForced.moveControlsToOuterEdge, true, 'osMode forces outer-edge on')

  // Cascade 3 order: hide stays valid when OS mode forced taskbar on.
  const osHide = normalizeCanvasSettings(mergeCanvasSettings({
    osMode: true,
    hideDrawerOpenCloseButtons: true,
    taskbarMode: false,
  }))
  assertEqual(osHide.hideDrawerOpenCloseButtons, true, 'hide survives OS-forced taskbar')

  // Cascade 2d: corrupt osChromePrefs shapes drop to null.
  const osCorrupt = normalizeCanvasSettings(mergeCanvasSettings({
    osMode: true,
    osChromePrefs: { taskbarMode: 'yes' } as unknown as { taskbarMode: boolean; moveControlsToOuterEdge: boolean },
  }))
  assertEqual(osCorrupt.osChromePrefs, null, 'corrupt osChromePrefs dropped to null')
  const osCorrupt2 = normalizeCanvasSettings(mergeCanvasSettings({
    osChromePrefs: 'nope' as unknown as { taskbarMode: boolean; moveControlsToOuterEdge: boolean },
  }))
  assertEqual(osCorrupt2.osChromePrefs, null, 'non-object osChromePrefs dropped to null')

  // setSettings: enable snapshots the pre-OS chrome values, then the
  // normalize invariant forces them on.
  hydrateSettings(null)
  setSettings({ osMode: true })
  assertEqual(getSettings().osMode, true, 'osMode enabled')
  assertEqual(getSettings().taskbarMode, true, 'enable forces taskbar on')
  assertEqual(getSettings().moveControlsToOuterEdge, true, 'enable forces outer on')
  assertEqual(getSettings().osChromePrefs?.taskbarMode, false, 'enable snapshots pre-OS taskbar (false)')
  assertEqual(getSettings().osChromePrefs?.moveControlsToOuterEdge, false, 'enable snapshots pre-OS outer (false)')

  // Disable restores the pre-OS values (recorded, like sidesChromePrefs).
  setSettings({ osMode: false })
  assertEqual(getSettings().taskbarMode, false, 'disable restores pre-OS taskbar off')
  assertEqual(getSettings().moveControlsToOuterEdge, false, 'disable restores pre-OS outer off')
  assertEqual(getSettings().osChromePrefs?.taskbarMode, false, 'disable keeps the snapshot recorded')

  // Disable while horizontal re-forces taskbar on (location invariant wins).
  hydrateSettings({ drawerLocation: 'top', taskbarMode: true, moveControlsToOuterEdge: true })
  setSettings({ osMode: true })
  assertEqual(getSettings().osChromePrefs?.taskbarMode, true, 'enable on top/bottom snapshots forced-true')
  setSettings({ osMode: false })
  assertEqual(getSettings().taskbarMode, true, 'disable while horizontal: location keeps taskbar on')

  // Enable with a real user choice to restore: taskbar on, outer off (valid
  // S1 state) is preserved through the OS excursion.
  hydrateSettings({ taskbarMode: true, moveControlsToOuterEdge: false })
  setSettings({ osMode: true })
  assertEqual(getSettings().moveControlsToOuterEdge, true, 'enable forces outer on from S1 state')
  setSettings({ osMode: false })
  assertEqual(getSettings().taskbarMode, true, 'S1 restore: taskbar back on')
  assertEqual(getSettings().moveControlsToOuterEdge, false, 'S1 state: outer back off')

  // M7: after an OS excursion started from Top, the location-forced pair must
  // not stick when the user is back on Sides — the Sides snapshot wins.
  hydrateSettings(null)
  setSettings({ taskbarMode: false, moveControlsToOuterEdge: false })
  assertEqual(getSettings().sidesChromePrefs?.taskbarMode, false, 'M7: sides chrome-off recorded')
  setSettings({ drawerLocation: 'top' })
  setSettings({ osMode: true })
  assertEqual(getSettings().osChromePrefs?.taskbarMode, true, 'M7: OS enable from top snapshots forced-true')
  setSettings({ drawerLocation: 'sides' })
  assertEqual(getSettings().taskbarMode, true, 'M7: OS still forces chrome on while on sides')
  setSettings({ osMode: false })
  assertEqual(getSettings().taskbarMode, false, 'M7: sides snapshot restores taskbar off')
  assertEqual(getSettings().moveControlsToOuterEdge, false, 'M7: sides snapshot restores outer off')

  // M7 legacy: no Sides snapshot yet — returning to Sides materializes one
  // from the defaults, and that snapshot is what the OS disable restores.
  hydrateSettings({ taskbarMode: false, moveControlsToOuterEdge: false })
  assertEqual(getSettings().sidesChromePrefs, null, 'M7 legacy: no snapshot yet')
  setSettings({ drawerLocation: 'top' })
  setSettings({ osMode: true })
  setSettings({ drawerLocation: 'sides' })
  assertEqual(getSettings().sidesChromePrefs?.taskbarMode, false, 'M7 legacy: return to sides materializes snapshot')
  setSettings({ osMode: false })
  assertEqual(getSettings().taskbarMode, false, 'M7 legacy: materialized snapshot restores taskbar off')
  assertEqual(getSettings().moveControlsToOuterEdge, false, 'M7 legacy: materialized snapshot restores outer off')

  // M7 fallback chain: sidesChromePrefs null on a legacy Sides blob → the
  // osChromePrefs pair is used, not the defaults.
  hydrateSettings({ taskbarMode: true, moveControlsToOuterEdge: false })
  setSettings({ osMode: true })
  setSettings({ osMode: false })
  assertEqual(getSettings().sidesChromePrefs, null, 'M7 fallback: still no sides snapshot')
  assertEqual(getSettings().taskbarMode, true, 'M7 fallback: osChromePrefs pair supplies taskbar on')
  assertEqual(getSettings().moveControlsToOuterEdge, false, 'M7 fallback: osChromePrefs pair supplies outer off')

  // M7: an OS disable while still on Top keeps the forced pair (the location
  // invariant owns it) even with a false Sides snapshot on record.
  hydrateSettings({
    drawerLocation: 'top',
    sidesChromePrefs: { taskbarMode: false, moveControlsToOuterEdge: false },
  })
  setSettings({ osMode: true })
  setSettings({ osMode: false })
  assertEqual(getSettings().taskbarMode, true, 'M7 top: disable keeps forced taskbar on')
  assertEqual(getSettings().moveControlsToOuterEdge, true, 'M7 top: disable keeps forced outer on')
  assertEqual(getSettings().sidesChromePrefs?.taskbarMode, false, 'M7 top: sides snapshot untouched')
}

// --- B2-1: hydrateModeLayoutSlots resets ALL FOUR slots unconditionally
// (disk is authoritative; absent/null clears) ---
{
  const single = { version: 'v', tabOrder: ['a'], detachedTabs: [] }
  const dual = { version: 'v', tabOrder: [], detachedTabs: [{ tabId: 's' }] }
  const osSingle = { version: 'v', tabOrder: ['os-a'], detachedTabs: [] }
  const osDual = { version: 'v', tabOrder: [], detachedTabs: [{ tabId: 'os-s' }] }

  // Object blob with all four keys → all four apply.
  hydrateModeLayoutSlots({ singleLayout: single, dualLayout: dual, osSingleLayout: osSingle, osDualLayout: osDual })
  assertEqual(getSingleLayoutSlot(), single, 'B2: present singleLayout applies')
  assertEqual(getDualLayoutSlot(), dual, 'B2: present dualLayout applies')
  assertEqual(getOsSingleLayoutSlot(), osSingle, 'B2: present osSingleLayout applies')
  assertEqual(getOsDualLayoutSlot(), osDual, 'B2: present osDualLayout applies')

  // Missing keys clear the previous values (hot-reload stale-slot
  // preservation is intentionally dropped).
  hydrateModeLayoutSlots({ singleLayout: single })
  assertEqual(getSingleLayoutSlot(), single, 'B2: present key re-applies')
  assert(getDualLayoutSlot() == null, 'B2: absent dualLayout key clears')
  assert(getOsSingleLayoutSlot() == null, 'B2: absent osSingleLayout key clears')
  assert(getOsDualLayoutSlot() == null, 'B2: absent osDualLayout key clears')

  // hydrate(null) clears everything too — the reset runs BEFORE the object
  // guard.
  setDualLayoutSlot(dual)
  setOsSingleLayoutSlot(osSingle)
  setOsDualLayoutSlot(osDual)
  hydrateModeLayoutSlots(null)
  assert(getSingleLayoutSlot() == null, 'B2: hydrate(null) clears singleLayout')
  assert(getDualLayoutSlot() == null, 'B2: hydrate(null) clears dualLayout')
  assert(getOsSingleLayoutSlot() == null, 'B2: hydrate(null) clears osSingleLayout')
  assert(getOsDualLayoutSlot() == null, 'B2: hydrate(null) clears osDualLayout')

  // Explicit null values on an object blob clear those slots as well.
  hydrateModeLayoutSlots({ singleLayout: single, dualLayout: null, osSingleLayout: null, osDualLayout: null })
  assertEqual(getSingleLayoutSlot(), single, 'B2: explicit present key applies')
  assert(getDualLayoutSlot() == null, 'B2: explicit null dualLayout clears')
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
