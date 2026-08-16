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

export function getSettings(): FullCanvasSettings { return _settings }
export function setLastLoadedLayout(layout: any): void { _lastLoadedLayout = layout }
export function getLastLoadedLayout(): any { return _lastLoadedLayout }

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
