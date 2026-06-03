// Canvas extension orchestrator.
//
// setup(ctx) is the Spindle loader's entry point — it wires every feature
// into the host, hydrates the persisted layout, and returns the teardown
// to run when the extension is disabled.
//
// Order matters here:
//   1. setBackendCtx — must run before any *Layout call.
//   2. mountSettingsPanel — mounts the panel host; the panel reads defaults
//      from getSettings() and re-renders on every setSettings call.
//   3. Slash runtime — register its teardown in the cleanup chain BEFORE
//      the persisted layout load (which can be slow on a cold cache).
//   4. loadSavedLayout — single IPC roundtrip. Hydrates settings, installs
//      the debug escape hatch, and conditionally mounts every gated feature.
//
// The Phase 3 (finding #13) ordering — load the layout BEFORE mounting
// the secondary sidebar — is what makes the drawer render at the right
// width on first paint (no 68px sliver, no 500ms flicker).
//
// The sub-feature toggles (resize handles, side-change watcher,
// tab-registration watcher, consistent-icon-size CSS) are gated at
// their own mount sites rather than via the master toggle, so adding a
// non-master-gated sub-feature later is a one-liner.

import { mountSecondarySidebar, injectDrawerTabStyles } from './sidebar/secondary'
import { startReflowObserver } from './chat/reflow'
import { mountResizeHandles } from './resize/handles'
import { startSideChangeWatcher, startTabRegistrationWatcher } from './sidebar/polish'
import { attachSlashRuntime } from './slash/runtime'
import { registerCleanup, cleanupAll } from './sidebar/cleanup'
import { startContextMenuListener } from './context-menu'
import { installDebugEscapeHatch } from './debug/fiber-scan'
import { mountSettingsPanel } from './settings/panel'
import { setBackendCtx, applyLayout, loadSavedLayout } from './layout/persist'
import {
  getSettings, setLastLoadedLayout, refreshSettingsPanel, hydrateSettings,
} from './settings/state'
import { dlog, setDebug } from './debug/log'

export function setup(ctx: any) {
  setBackendCtx(ctx)

  // Mount the settings panel immediately. The host may not be in the DOM yet
  // (the user hasn't opened Settings → Extensions), but ctx.ui.mount sets up
  // a MutationObserver that reparents the host as soon as it appears.
  mountSettingsPanel(ctx)

  // Slash runtime — wired into the canvas cleanup chain so the intercept
  // listeners are detached when the extension is disabled.
  const detachSlash = attachSlashRuntime(ctx)
  registerCleanup(detachSlash)

  // Phase 3 (finding #13): load the persisted layout BEFORE mounting the
  // secondary sidebar so its initial position matches the saved state on the
  // first paint — no 68px sliver, no 500ms flicker. We also hydrate the
  // settings from the same blob so every feature mount downstream sees the
  // correct gate.
  loadSavedLayout().then((layout) => {
    // Hydrate settings from the loaded layout (defaults filled by
    // mergeCanvasSettings inside hydrateSettings).
    hydrateSettings(layout?.settings)
    setDebug(getSettings().debugMode)
    setLastLoadedLayout(layout)
    // The settings panel was mounted earlier in setup() with the default
    // getSettings(). Now that we've hydrated from the saved layout, re-render
    // the panel so the toggles reflect the loaded values rather than the
    // defaults baked in at mount time. refreshSettingsPanel (in
    // settings/state.ts) fires the closure registered by mountSettingsPanel.
    refreshSettingsPanel()

    if (getSettings().debugMode) installDebugEscapeHatch()

    const initialWidth = layout?.secondary?.width
    const initialOpen = layout?.secondary?.open === true

    // Mount features gated by settings. The master toggle is the only one
    // that gates other mounts; sub-features are gated at their own mount
    // sites so a future change to add a non-master-gated sub-feature is
    // a one-liner.
    if (getSettings().secondSidebarEnabled) {
      mountSecondarySidebar({ initialWidth, initialOpen })
    }
    if (getSettings().chatReflow) {
      startReflowObserver()
    }
    if (getSettings().resizeSidebars) {
      mountResizeHandles()
    }
    if (getSettings().autoMirrorOnSideSwap) {
      startSideChangeWatcher()
    }
    if (getSettings().autoCleanupOnUninstall) {
      startTabRegistrationWatcher()
    }
    // Context menu is always on for now (no panel toggle). Could become a
    // setting later if requested.
    startContextMenuListener()

    // Always inject the consistent-icon-size CSS if it's enabled — it
    // doesn't need a wrapper to apply.
    if (getSettings().consistentIconSize) {
      injectDrawerTabStyles()
    }

    // Apply the rest of the layout (tab assignments + width delta if any).
    // Safe to call after mount: it won't double-animate the wrapper.
    if (layout && getSettings().secondSidebarEnabled) {
      applyLayout(layout)
    }
  })

  // v1.3.0: removed the permanent ctx.onBackendMessage no-op. The previous
  // comment noted it was a "safety belt" for late LAYOUT_DATA, but the
  // one-shot handler in loadSavedLayout resolves on the first LAYOUT_DATA
  // and that is the only one the backend ever sends. Carrying a permanent
  // listener that never fires adds no value and would only mask a real bug
  // (a duplicate LAYOUT_DATA send) if the backend ever started sending one.

  // Return teardown — called when extension is disabled
  return cleanupAll
}
