// Settings (Canvas user preferences).
//
// Every user-togglable Canvas behavior reads from `_settings` instead of a
// hard-coded constant. `_settings` is hydrated in `setup()` from the layout
// blob (with defaults filled in by `mergeCanvasSettings`), and updated at
// runtime via `setSettings()` from the settings panel. `applySettings()`
// is the single live-update entry point — it diffs the previous and next
// state and mounts/unmounts the relevant features.
//
// State owners in this module:
//   - `_settings`            — the in-memory CanvasSettings (full defaults)
//   - `_lastLoadedLayout`    — most recent layout snapshot, for re-apply
//   - `_saveSettingsTimer`   — debounced SAVE_LAYOUT IPC timer
//   - `_panelRefresh`        — registered closure from settings/panel
//
// `setSettings` and `persistSettings` import `applySettings`,
// `getBackendCtx`, and `snapshotLayout` from `../frontend` as transient
// exports. Those functions move to settings/panel (Task #2) and
// layout/persist (Task #4) respectively.

import { mergeCanvasSettings, type CanvasSettings } from '../types'
import { setDebug, dlog } from '../debug/log'
import { applySettings } from './panel'
import { getBackendCtx, snapshotLayout, isLoadInProgress } from '../layout/persist'

type FullCanvasSettings = Required<CanvasSettings>
export type { FullCanvasSettings }
let _settings: FullCanvasSettings = mergeCanvasSettings(null)
// Reference to the most recently loaded layout snapshot, used by
// applySettings to re-apply tab assignments after a master toggle re-creates
// the secondary wrapper.
let _lastLoadedLayout: any = null
// Persist debounce timer (separate from _saveLayoutTimer so a settings flip
// doesn't race with an in-flight open/close save).
let _saveSettingsTimer: ReturnType<typeof setTimeout> | null = null

// Set to true the first time setSettings runs. After that, hydrateSettings
// becomes a no-op so a late-arriving loadSavedLayout() cannot clobber a
// setting the user toggled during the load window.
let _userHasTouchedSettings = false

/**
 * Reset the hydration guard before a fresh loadSavedLayout cycle. Called
 * from setup() so that a page reload (module re-evaluation) does not
 * leave the guard stuck at true from a prior session — which would
 * silently skip hydrating saved settings and leave the user on defaults.
 */
export function resetHydrationGuard(): void {
  _userHasTouchedSettings = false
}

// Panel refresh registry — set by settings/panel.ts on mount, called by
// setSettings so the panel re-renders to reflect the new value. Replaces
// the legacy window.__canvasPanelRefresh indirection.
let _panelRefresh: (() => void) | null = null

export function getSettings(): FullCanvasSettings { return _settings }
export function setLastLoadedLayout(layout: any): void { _lastLoadedLayout = layout }
export function getLastLoadedLayout(): any { return _lastLoadedLayout }
export function setPanelRefresh(fn: (() => void) | null): void { _panelRefresh = fn }

/**
 * keepTabListVisible only makes sense with tab lists on the screen edge.
 * Clear it whenever moveControlsToOuterEdge is off (UI gate + load safety).
 */
export function normalizeCanvasSettings(s: FullCanvasSettings): FullCanvasSettings {
  if (s.keepTabListVisible && !s.moveControlsToOuterEdge) {
    return { ...s, keepTabListVisible: false }
  }
  return s
}

/** Effective keep-tabs flag after the outer-edge dependency. */
export function isKeepTabListVisibleEnabled(
  s: FullCanvasSettings = _settings,
): boolean {
  return !!s.keepTabListVisible && !!s.moveControlsToOuterEdge
}

/**
 * One-shot hydration at setup time. Replaces the in-memory state with the
 * value merged from the loaded layout blob (defaults filled in by
 * mergeCanvasSettings). Does NOT call applySettings / refresh / persist —
 * the caller is the orchestrator and will do all of those itself.
 */
export function hydrateSettings(raw: Partial<CanvasSettings> | null | undefined): void {
  if (_userHasTouchedSettings) return
  _settings = normalizeCanvasSettings(mergeCanvasSettings(raw ?? null))
}

/**
 * Update one or more settings, persist the new state, and live-apply the diff.
 * Safe to call from the settings panel on every toggle change.
 */
export function setSettings(patch: Partial<CanvasSettings>): void {
  _userHasTouchedSettings = true
  const prev = _settings
  const next: FullCanvasSettings = { ...prev }
  for (const key of Object.keys(patch) as Array<keyof CanvasSettings>) {
    const v = patch[key]
    if (v !== undefined) (next as Record<string, unknown>)[key] = v
  }
  _settings = normalizeCanvasSettings(next)
  // Update the in-memory DEBUG flag immediately — applySettings also does
  // this, but we want dlog() calls inside the same tick to see the new value.
  setDebug(_settings.debugMode)
  applySettings(prev, _settings)
  refreshSettingsPanel()
  persistSettings()
}

/**
 * Refresh the settings panel UI in-place after a settings change. Public so
 * setSettings can call it via the registered panel refresh closure, AND
 * setup() can re-render the panel after the saved-layout hydration
 * supersedes the defaults baked in at mount time.
 */
export function refreshSettingsPanel() {
  if (_panelRefresh) _panelRefresh()
}

/** Debounced persistence of the current settings (merged into the layout blob). */
export function persistSettings(): void {
  const backendCtx = getBackendCtx()
  if (!backendCtx) { dlog('persistSettings: no backendCtx, skipping'); return }
  if (isLoadInProgress()) { dlog('persistSettings: load in progress, skipping'); return }
  if (_saveSettingsTimer !== null) {
    clearTimeout(_saveSettingsTimer)
  }
  _saveSettingsTimer = setTimeout(() => {
    _saveSettingsTimer = null
    // Persist via the same SAVE_LAYOUT IPC; the settings field rides on the
    // existing layout blob. When layoutPersistence is ON, we snapshot the
    // live drawer state. When OFF, we preserve the last loaded layout so
    // toggling persistence off then on again does not lose the user's
    // layout — only the settings field is updated.
    const layoutSnapshot = _settings.layoutPersistence
      ? snapshotLayout()
      : (_lastLoadedLayout ?? { primary: { open: false, width: 420 }, secondary: { open: false, width: 420 }, detachedTabs: [] })
    const layout = { ...layoutSnapshot, settings: _settings }
    dlog(`persistSettings: debounced firing (layoutPersistence=${_settings.layoutPersistence}, snapshot.primary.open=${layout.primary.open}, snapshot.secondary.open=${layout.secondary.open})`)
    backendCtx.sendToBackend({ type: 'SAVE_LAYOUT', layout })
  }, 100)
}

// Cancel a pending settings save (used by teardown to flush or drop in-flight debounces).
export function cancelSettingsSave(): void {
  if (_saveSettingsTimer !== null) {
    clearTimeout(_saveSettingsTimer)
    _saveSettingsTimer = null
  }
}
