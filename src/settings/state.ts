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
  mergeCanvasSettings,
  normalizeCanvasSettingsFields,
  type CanvasSettings,
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
let _singleLayout: any = null
let _dualLayout: any = null

export function getSettings(): FullCanvasSettings { return _settings }
export function setLastLoadedLayout(layout: any): void { _lastLoadedLayout = layout }
export function getLastLoadedLayout(): any { return _lastLoadedLayout }

export function getSingleLayoutSlot(): any { return _singleLayout }
export function setSingleLayoutSlot(layout: any): void { _singleLayout = layout }
export function getDualLayoutSlot(): any { return _dualLayout }
export function setDualLayoutSlot(layout: any): void { _dualLayout = layout }

/**
 * Read the persisted `singleLayout` / `dualLayout` profile slots out of a
 * loaded layout blob. Called at boot (setup.ts) after hydration so mode
 * switches restore the layout of the other mode even across reloads.
 */
export function hydrateModeLayoutSlots(layout: any): void {
  if (layout && typeof layout === 'object') {
    if (layout.dualLayout !== undefined) _dualLayout = layout.dualLayout
    if (layout.singleLayout !== undefined) _singleLayout = layout.singleLayout
    // Diagnostic: which mode profiles survived the load — the durable
    // single/dual layouts that mode toggles restore across hard refresh
    // and server restart.
    dlog('[settings] mode layout slots hydrated', {
      singleSlot: _singleLayout != null,
      singleTabs: Array.isArray(_singleLayout?.tabOrder) ? _singleLayout.tabOrder.length : 0,
      dualSlot: _dualLayout != null,
      dualTabs: Array.isArray(_dualLayout?.detachedTabs) ? _dualLayout.detachedTabs.length : 0,
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

export function isHideDrawerOpenCloseButtonsEnabled(
  s: FullCanvasSettings = _settings,
): boolean {
  return !!s.hideDrawerOpenCloseButtons && isTaskbarModeEnabled(s)
}

export function isDragAndDropDrawerTabsEnabled(
  s: FullCanvasSettings = _settings,
): boolean {
  return !!s.dragAndDropDrawerTabs && isTaskbarModeEnabled(s)
}

export function hydrateSettings(raw: Partial<CanvasSettings> | null | undefined): void {
  _settings = normalizeCanvasSettings(mergeCanvasSettings(raw ?? null))
}

export function setSettings(patch: Partial<CanvasSettings>): void {
  const prev = _settings
  const next: FullCanvasSettings = { ...prev }
  for (const key of Object.keys(patch) as Array<keyof CanvasSettings>) {
    const v = patch[key]
    if (v !== undefined) (next as Record<string, unknown>)[key] = v
  }
  _settings = normalizeCanvasSettings(next)
  setDebug(_settings.debugMode)
  applySettings(prev, _settings)
  refreshSettingsPanel()
  persistSettings()
}

export function refreshSettingsPanel() {
  if (_panelRefresh) _panelRefresh()
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
  if (_saveSettingsTimer !== null) {
    clearTimeout(_saveSettingsTimer)
  }
  _saveSettingsTimer = setTimeout(() => {
    _saveSettingsTimer = null
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
      }
    }).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('[canvas] saveSettingsToDisk rejected:', err)
    })
    setLastLoadedLayout({ ...layoutSnapshot, settings: _settings })
  }, 100)
}

export function cancelSettingsSave(): void {
  if (_saveSettingsTimer !== null) {
    clearTimeout(_saveSettingsTimer)
    _saveSettingsTimer = null
  }
}
