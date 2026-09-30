// Settings (Canvas user preferences).
//
// Every user-togglable Canvas behavior reads from `_settings` instead of a
// hard-coded constant. `_settings` is hydrated in `setup()` from the settings
// payload (with defaults filled in by `mergeCanvasSettings`), and updated at
// runtime via `setSettings()` from the settings panel. `applySettings()`
// is the single live-update entry point.
//
// Settings are persisted independently via persist/settings-repo.ts.
// Layout state is persisted via persist/layout-repo.ts.
//

import {
  DEFAULT_CANVAS_SETTINGS,
  mergeCanvasSettings,
  normalizeCanvasSettingsFields,
  type CanvasSettings,
  type DrawerLocation,
} from '../types'
import { setDebug, dlog } from '../debug/log'
import {
  logPersistSave,
  syncPersistDebugToBackend,
} from '../debug/persist-debug'
import { applySettings } from './panel'
import { buildPersistedLayout } from '../layout/snapshot'
import { isLoadInProgress } from '../persist/layout-load'
import { saveSettingsToDisk, isSettingsRepoArmed } from '../persist/settings-repo'
import { getBackendCtx } from '../persist/backend-ctx'

type FullCanvasSettings = Required<CanvasSettings>
export type { FullCanvasSettings }
let _settings: FullCanvasSettings = mergeCanvasSettings(null)
let _lastLoadedLayout: any = null
let _saveSettingsTimer: ReturnType<typeof setTimeout> | null = null
/** True once hydrateSettings ran (real settings load completed). The settings
 *  panel's pre-hydration locks key on this — the legacy layout-load
 *  `isLoadInProgress()` flag has no writer and was always false (L6
 *  2026-09-19). */
let _hydrated = false
/** Current strict mobile viewport state. setup() seeds this before settings
 * hydration and the mobile-cross listener keeps it current afterwards. */
let _mobileViewportActive = false
/** A debounced/failed save is owed to disk; retried on failure and flushed on
 *  unload/teardown (N2 2026-09-19). */
let _settingsDirty = false
let _settingsRetryTimer: ReturnType<typeof setTimeout> | null = null
let _settingsRetryCount = 0
/** Cap on automatic save retries: a permanently failing backend must not spin
 *  a retry timer forever (test runners / teardown would never settle). The
 *  write stays dirty and is retried on the next change or the unload flush. */
let _maxSettingsSaveRetries = 2
const SETTINGS_RETRY_MS = 1000

// ── Mode layout profiles (2026-08-16) ──
//
// The user can switch between single-drawer mode and dual-drawer mode. Each
// mode keeps its OWN saved layout so switching never destroys the other:
//   - `_singleLayout` — the layout to show when the second drawer is off.
//   - `_dualLayout`   — the layout to show when the second drawer is on.
//
// These slots are persisted inside the layout blob (top-level `singleLayout`
// / `dualLayout` fields) by the owned-model persist path, and hydrated back
// at boot from the loaded blob. The mode-switch path (second-drawer-mode.ts)
// writes the slot of the mode being LEFT, then restores the slot of the mode
// being ENTERED into the owned model.
//
// OS mode (2026-09-14, spec §3.2) adds the OS variants of the same slots:
//   - `_osSingleLayout` — the layout while OS mode is on, second drawer off.
//   - `_osDualLayout`   — the layout while OS mode is on, second drawer on.
// While OS mode is on, the non-OS slots are FROZEN (OS edits never touch
// them; disable restores the saved non-OS slot — D12 slot-wins) and the
// active mode's OS slot receives the live serialization. Symmetrically,
// while OS is off the OS slots stay frozen from the last OS session.
// The OS closed-set lives in the model (`model.closed`, re-keyed from the
// blob's `closedTabIds` by buildModelFromLayout) — no separate hydration.
let _singleLayout: any = null
let _dualLayout: any = null
let _osSingleLayout: any = null
let _osDualLayout: any = null

export function getSettings(): FullCanvasSettings { return _settings }
export function setLastLoadedLayout(layout: any): void { _lastLoadedLayout = layout }
export function getLastLoadedLayout(): any { return _lastLoadedLayout }

export function getSingleLayoutSlot(): any { return _singleLayout }
export function setSingleLayoutSlot(layout: any): void { _singleLayout = layout }
export function getDualLayoutSlot(): any { return _dualLayout }
export function setDualLayoutSlot(layout: any): void { _dualLayout = layout }
export function getOsSingleLayoutSlot(): any { return _osSingleLayout }
export function setOsSingleLayoutSlot(layout: any): void { _osSingleLayout = layout }
export function getOsDualLayoutSlot(): any { return _osDualLayout }
export function setOsDualLayoutSlot(layout: any): void { _osDualLayout = layout }

/**
 * Read the persisted `singleLayout` / `dualLayout` profile slots out of a
 * loaded layout blob. Called at boot (setup.ts) after hydration so mode
 * switches restore the layout of the other mode even across reloads.
 *
 * Disk is authoritative (plan B2): ALL four slots reset to null
 * UNCONDITIONALLY at entry — including for null / non-object input — then
 * present keys are applied. A slot lost to a failed/late write on hot
 * reload is accepted; an absent key clears (stale-slot preservation across
 * partial hydrates is intentionally dropped).
 *
 * OS slots hydrate the same way. The OS closed-set is model state
 * (`model.closed`) and re-keys from the blob inside buildModelFromLayout —
 * nothing to hydrate separately here.
 */
export function hydrateModeLayoutSlots(layout: any): void {
  _singleLayout = null
  _dualLayout = null
  _osSingleLayout = null
  _osDualLayout = null
  if (layout && typeof layout === 'object') {
    if (layout.dualLayout !== undefined) _dualLayout = layout.dualLayout
    if (layout.singleLayout !== undefined) _singleLayout = layout.singleLayout
    if (layout.osDualLayout !== undefined) _osDualLayout = layout.osDualLayout
    if (layout.osSingleLayout !== undefined) _osSingleLayout = layout.osSingleLayout
    // Note: the OS closed-set is NOT hydrated here — it lives in the model
    // (`model.closed`) and is re-keyed from the blob's `closedTabIds` by
    // buildModelFromLayout when the model bootstraps from the slot.
    // Diagnostic: which mode profiles survived the load — the durable
    // single/dual layouts that mode toggles restore across hard refresh
    // and server restart.
    dlog('[settings] mode layout slots hydrated', {
      singleSlot: _singleLayout != null,
      singleTabs: Array.isArray(_singleLayout?.tabOrder) ? _singleLayout.tabOrder.length : 0,
      dualSlot: _dualLayout != null,
      dualTabs: Array.isArray(_dualLayout?.detachedTabs) ? _dualLayout.detachedTabs.length : 0,
      osSingleSlot: _osSingleLayout != null,
      osDualSlot: _osDualLayout != null,
      drawerSide: layout.drawerSide ?? null,
    })
  }
}

let _panelRefresh: (() => void) | null = null
export function setPanelRefresh(fn: (() => void) | null): void { _panelRefresh = fn }

export function normalizeCanvasSettings(s: FullCanvasSettings): FullCanvasSettings {
  return normalizeCanvasSettingsFields(s)
}

export function isTaskbarModeEnabled(
  s: FullCanvasSettings = _settings,
): boolean {
  return !!s.taskbarMode && !!s.moveControlsToOuterEdge
}

/**
 * OS-mode gate (spec §3.4). This is the DATA gate — the OS state model
 * (closed-set persistence, slot writing) keys off `osMode` alone, because
 * the normalization invariant keeps taskbarMode forced on while osMode is
 * on. Chrome consumers compose this with `isTaskbarModeEnabled()` and the
 * mobile check themselves (chrome gating ≠ data gating).
 */
export function isOsModeEnabled(s: FullCanvasSettings = _settings): boolean {
  return !!s.osMode
}

export function isHideDrawerOpenCloseButtonsEnabled(
  s: FullCanvasSettings = _settings,
): boolean {
  return !!s.hideDrawerOpenCloseButtons && isTaskbarModeEnabled(s)
}

export function isDragAndDropDrawerTabsEnabled(
  s: FullCanvasSettings = _settings,
): boolean {
  // S7: taskbar-agnostic — the Canvas main shell is always mounted (S1), so
  // the mirror strip is always the primary mid-drag surface; mobile is a
  // no-op inside tab-list-dnd (≤600px). The toggle is the only gate.
  return !!s.dragAndDropDrawerTabs
}

/** Where the drawer tab lists live ('sides' | 'top' | 'bottom'). */
export function getDrawerLocation(
  s: FullCanvasSettings = _settings,
): DrawerLocation {
  return s.drawerLocation
}

/** True when the tab lists are pinned to the top/bottom viewport edge. */
export function isHorizontalStrip(
  s: FullCanvasSettings = _settings,
): boolean {
  return getDrawerLocation(s) !== 'sides'
}

/** Strip edge while horizontal ('top' | 'bottom'), null on Sides. */
export function getStripEdge(
  s: FullCanvasSettings = _settings,
): 'top' | 'bottom' | null {
  const loc = getDrawerLocation(s)
  return loc === 'top' ? 'top' : loc === 'bottom' ? 'bottom' : null
}

/** True after hydrateSettings applied the loaded settings payload. */
export function isSettingsHydrated(): boolean { return _hydrated }

export function hydrateSettings(raw: Partial<CanvasSettings> | null | undefined): void {
  const merged = mergeCanvasSettings(raw ?? null)
  if (_mobileViewportActive && merged.drawerLocation === 'sides') {
    merged.drawerLocation = merged.lastHorizontalDrawerLocation
  }
  _settings = normalizeCanvasSettings(merged)
  _hydrated = true
}

/** Keep the settings invariant synchronized with the strict ≤600px mobile
 * viewport. Entering mobile resolves Sides to the remembered horizontal mode;
 * leaving mobile deliberately keeps that resolved mode until Sides is
 * explicitly selected again on desktop. */
export function setMobileViewportActive(active: boolean): void {
  _mobileViewportActive = active
  if (!active || !_hydrated || _settings.drawerLocation !== 'sides') return
  setSettings({ drawerLocation: _settings.lastHorizontalDrawerLocation })
}

export function setSettings(patch: Partial<CanvasSettings>): void {
  const prev = _settings
  const next: FullCanvasSettings = { ...prev }
  for (const key of Object.keys(patch) as Array<keyof CanvasSettings>) {
    const v = patch[key]
    if (v !== undefined) (next as Record<string, unknown>)[key] = v
  }

  // Keep the last explicit horizontal choice independent of Sides. While
  // mobile, coerce any requested/restored Sides value before feature apply so
  // the disallowed geometry can never become the active overall mode.
  if (patch.drawerLocation === 'top' || patch.drawerLocation === 'bottom') {
    next.lastHorizontalDrawerLocation = patch.drawerLocation
  }
  if (_mobileViewportActive && next.drawerLocation === 'sides') {
    next.drawerLocation = next.lastHorizontalDrawerLocation
  }

  // S8 (Drawer location): Top/Bottom force taskbar chrome on via the
  // normalize invariant, which would otherwise bake the forced values in.
  // Keep the user's actual Sides values in `sidesChromePrefs` and restore
  // them on the way back:
  //   - explicit chrome toggle while on Sides → record the new values
  //   - horizontal → sides → restore the record (defaults when none exists,
  //     e.g. a legacy blob last saved while horizontal)
  const chromeTouched =
    patch.taskbarMode !== undefined || patch.moveControlsToOuterEdge !== undefined
  if (next.drawerLocation === 'sides' && chromeTouched) {
    next.sidesChromePrefs = {
      taskbarMode: !!next.taskbarMode,
      moveControlsToOuterEdge: !!next.moveControlsToOuterEdge,
    }
  }
  if (prev.drawerLocation !== 'sides' && next.drawerLocation === 'sides') {
    const prefs = next.sidesChromePrefs ?? {
      taskbarMode: DEFAULT_CANVAS_SETTINGS.taskbarMode,
      moveControlsToOuterEdge: DEFAULT_CANVAS_SETTINGS.moveControlsToOuterEdge,
    }
    next.taskbarMode = prefs.taskbarMode
    next.moveControlsToOuterEdge = prefs.moveControlsToOuterEdge
    next.sidesChromePrefs = { ...prefs }
  }

  // OS mode: snapshot the pre-OS chrome values on enable, restore them on
  // disable. Same pattern as sidesChromePrefs: the normalize invariant
  // (osMode forces taskbarMode + moveControlsToOuterEdge + coreTabsHidden on)
  // would otherwise bake the forced values in, so the user's prior choices
  // live in `osChromePrefs`. Restore happens BEFORE normalization — a
  // top/bottom `drawerLocation` re-forces taskbar on afterwards, which is
  // correct.
  if (patch.osMode === true && prev.osMode !== true) {
    next.osChromePrefs = {
      taskbarMode: !!prev.taskbarMode,
      moveControlsToOuterEdge: !!prev.moveControlsToOuterEdge,
      coreTabsHidden: !!prev.coreTabsHidden,
    }
  }
  if (patch.osMode === false && prev.osMode === true) {
    const prefs = next.osChromePrefs ?? {
      taskbarMode: DEFAULT_CANVAS_SETTINGS.taskbarMode,
      moveControlsToOuterEdge: DEFAULT_CANVAS_SETTINGS.moveControlsToOuterEdge,
      coreTabsHidden: DEFAULT_CANVAS_SETTINGS.coreTabsHidden,
    }
    // M7: an OS enable from a Top/Bottom location snapshots the
    // location-forced chrome pair, not a user choice. Back on Sides the
    // Sides snapshot (or, for legacy blobs without one, the pre-OS pair)
    // is the trustworthy source; `coreTabsHidden` still comes from the OS
    // snapshot. Non-Sides keeps the plain OS snapshot — normalization
    // re-forces the pair there anyway.
    const chromePrefs = next.drawerLocation === 'sides'
      ? next.sidesChromePrefs ?? prefs
      : prefs
    next.taskbarMode = chromePrefs.taskbarMode
    next.moveControlsToOuterEdge = chromePrefs.moveControlsToOuterEdge
    next.coreTabsHidden = prefs.coreTabsHidden ?? DEFAULT_CANVAS_SETTINGS.coreTabsHidden
    next.osChromePrefs = { ...prefs }
  }

  _settings = normalizeCanvasSettings(next)
  setDebug(_settings.debugMode)
  // A throwing feature apply must not strand the panel or the save: refresh
  // and persist still run (N3 2026-09-19). applySettings itself also guards
  // each feature, so this is belt-and-braces.
  try {
    applySettings(prev, _settings)
  } finally {
    refreshSettingsPanel()
    persistSettings()
  }
}

export function refreshSettingsPanel() {
  if (_panelRefresh) _panelRefresh()
}

/**
 * Perform the settings save. Guards the armed state at fire time, exactly
 * like the original debounce body. Used by persistSettings (debounced) and
 * flushSettingsSave (immediate, on unload/teardown).
 */
function fireSettingsSave(): void {
  _saveSettingsTimer = null
  if (_settingsRetryTimer !== null) {
    clearTimeout(_settingsRetryTimer)
    _settingsRetryTimer = null
  }
  if (!isSettingsRepoArmed()) {
    dlog('persistSettings: not armed at debounce fire, skipping')
    logPersistSave('persistSettings:debounce', null, { skipped: 'not-armed' })
    return
  }
  const layoutSnapshot = buildPersistedLayout()
  dlog(`persistSettings: debounced firing (open=${_settings.persistDrawerOpenState}, width=${_settings.persistDrawerWidth}, snapshot.primary.open=${layoutSnapshot.primary.open}, snapshot.secondary.open=${layoutSnapshot.secondary.open})`)
  const backendCtx = getBackendCtx()
  if (backendCtx) {
    syncPersistDebugToBackend((msg) => backendCtx.sendToBackend(msg))
  }
  logPersistSave('persistSettings:debounce', { settings: _settings }, {
    loadInProgress: isLoadInProgress(),
  })
  // saveSettingsToDisk now returns Promise<LoadResult<void>> (Task 11.2).
  // The debounced path is fire-and-forget; surface errors via console.warn
  // so a failed save is not silently swallowed.
  saveSettingsToDisk(_settings).then((r) => {
    if (r.status === 'error') {
      // eslint-disable-next-line no-console
      console.warn('[canvas] saveSettingsToDisk failed:', r.reason)
      scheduleSettingsRetry()
    } else {
      _settingsDirty = false
      _settingsRetryCount = 0
    }
  }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('[canvas] saveSettingsToDisk rejected:', err)
    scheduleSettingsRetry()
  })
  setLastLoadedLayout({ ...layoutSnapshot, settings: _settings })
}

/** Re-arm the save after a failure so a transient backend error does not drop
 *  the setting forever (N2 2026-09-19). Bounded: after
 *  MAX_SETTINGS_SAVE_RETRIES the write stays dirty for the next change /
 *  unload flush instead of retrying indefinitely. */
function scheduleSettingsRetry(): void {
  if (_settingsRetryTimer !== null) return
  if (!isSettingsRepoArmed()) return
  if (_settingsRetryCount >= _maxSettingsSaveRetries) {
    // eslint-disable-next-line no-console
    console.warn('[canvas] settings save keeps failing; will retry on the next change or unload')
    return
  }
  _settingsRetryCount++
  const timer = setTimeout(() => {
    _settingsRetryTimer = null
    fireSettingsSave()
  }, SETTINGS_RETRY_MS)
  // Never hold the host process open on a retry timer.
  ;(timer as unknown as { unref?: () => void }).unref?.()
  _settingsRetryTimer = timer
}

/** Test hook: cap/disable automatic save retries (0 = no retry). */
export function __setSettingsSaveRetriesForTest(max: number): void {
  _maxSettingsSaveRetries = Math.max(0, max)
}

export function persistSettings(): void {
  if (!isSettingsRepoArmed()) {
    dlog('persistSettings: not armed, skipping')
    logPersistSave('persistSettings', null, { skipped: 'not-armed' })
    return
  }
  if (isLoadInProgress()) {
    dlog('persistSettings: load in progress, skipping')
    logPersistSave('persistSettings', null, { skipped: 'load-in-progress', loadInProgress: true })
    return
  }
  _settingsDirty = true
  // A fresh user change gets a fresh retry budget.
  _settingsRetryCount = 0
  if (_saveSettingsTimer !== null) {
    clearTimeout(_saveSettingsTimer)
  }
  _saveSettingsTimer = setTimeout(fireSettingsSave, 100)
}

/**
 * Flush a pending (debounced) settings save immediately. Called on
 * pagehide/beforeunload/visibilitychange/teardown so a settings toggle made
 * less than 100ms before the page closes is not silently dropped
 * (previously flushPendingSaves cancelled the debounce without saving).
 * No-op when no save is pending.
 */
export function flushSettingsSave(): void {
  if (_saveSettingsTimer !== null) {
    clearTimeout(_saveSettingsTimer)
    _saveSettingsTimer = null
  }
  if (_settingsRetryTimer !== null) {
    clearTimeout(_settingsRetryTimer)
    _settingsRetryTimer = null
  }
  // Fire whenever a write is owed — pending debounce OR a failed save whose
  // retries are exhausted (N2 2026-09-19).
  if (_settingsDirty) fireSettingsSave()
}

export function cancelSettingsSave(): void {
  if (_saveSettingsTimer !== null) {
    clearTimeout(_saveSettingsTimer)
    _saveSettingsTimer = null
  }
  if (_settingsRetryTimer !== null) {
    clearTimeout(_settingsRetryTimer)
    _settingsRetryTimer = null
  }
  _settingsDirty = false
  _settingsRetryCount = 0
}
