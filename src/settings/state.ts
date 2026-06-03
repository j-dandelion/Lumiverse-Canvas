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
import { setDebug } from '../debug/log'
// FIXME-decomp(step 2): applySettings will live in settings/panel.ts.
// FIXME-decomp(step 4): getBackendCtx + snapshotLayout will live in layout/persist.ts.
import { applySettings, getBackendCtx, snapshotLayout } from '../frontend'

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

// Panel refresh registry — set by settings/panel.ts on mount, called by
// setSettings so the panel re-renders to reflect the new value. Replaces
// the legacy window.__canvasPanelRefresh indirection.
let _panelRefresh: (() => void) | null = null

export function getSettings(): FullCanvasSettings { return _settings }
export function setLastLoadedLayout(layout: any): void { _lastLoadedLayout = layout }
export function getLastLoadedLayout(): any { return _lastLoadedLayout }
export function setPanelRefresh(fn: (() => void) | null): void { _panelRefresh = fn }

/**
 * One-shot hydration at setup time. Replaces the in-memory state with the
 * value merged from the loaded layout blob (defaults filled in by
 * mergeCanvasSettings). Does NOT call applySettings / refresh / persist —
 * the caller is the orchestrator and will do all of those itself.
 */
export function hydrateSettings(raw: Partial<CanvasSettings> | null | undefined): void {
  _settings = mergeCanvasSettings(raw ?? null)
}

/**
 * Update one or more settings, persist the new state, and live-apply the diff.
 * Safe to call from the settings panel on every toggle change.
 */
export function setSettings(patch: Partial<CanvasSettings>): void {
  const prev = _settings
  const next: FullCanvasSettings = { ...prev }
  for (const key of Object.keys(patch) as Array<keyof CanvasSettings>) {
    const v = patch[key]
    if (v !== undefined) (next as any)[key] = v
  }
  _settings = next
  // Update the in-memory DEBUG flag immediately — applySettings also does
  // this, but we want dlog() calls inside the same tick to see the new value.
  setDebug(next.debugMode)
  applySettings(prev, next)
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
  if (!backendCtx) return
  if (_saveSettingsTimer !== null) {
    clearTimeout(_saveSettingsTimer)
  }
  _saveSettingsTimer = setTimeout(() => {
    _saveSettingsTimer = null
    // Persist via the same SAVE_LAYOUT IPC; the settings field rides on the
    // existing layout blob. The other layout fields (primary, secondary,
    // detachedTabs) come from snapshotLayout() so we don't drop them.
    const layout = { ...snapshotLayout(), settings: _settings }
    backendCtx.sendToBackend({ type: 'SAVE_LAYOUT', layout })
  }, 300)
}
