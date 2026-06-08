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

import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import { mountSecondarySidebar, tearDownSecondarySidebar, getSecondaryWrapper, injectDrawerTabStyles } from './sidebar/secondary'
import { startReflowObserver } from './chat/reflow'
import { mountResizeHandles } from './resize/handles'
import { startSideChangeWatcher, startTabRegistrationWatcher } from './sidebar/polish'
import { startMainDrawerPersistence, stopMainDrawerPersistence } from './sidebar/main-persist'
import { startMobileExclusion } from './sidebar/mobile-exclusion'
import { attachSlashRuntime } from './slash/runtime'
import { unmountToastSurface } from './slash/toast'
import { registerCleanup, cleanupAll } from './sidebar/cleanup'
import { startContextMenuListener, stopContextMenuListener } from './context-menu'
import { installDebugEscapeHatch } from './debug/fiber-scan'
import { mountSettingsPanel } from './settings/panel'
import { setBackendCtx, applyLayout, applyMainDrawer, loadSavedLayout, CANVAS_VERSION, flushPendingSaves, cancelApplyLayoutInterval } from './layout/persist'
import {
  getSettings, setLastLoadedLayout, refreshSettingsPanel, hydrateSettings,
} from './settings/state'
import { getMainDrawer } from './dom/lumiverse'
import { setDebug, dwarn } from './debug/log'

export function setup(ctx: SpindleFrontendContext) {
  setBackendCtx(ctx)

  // Force-flush any pending debounced save before the page unloads.
  // Without these, a settings change made <100ms before close is lost.
  // Listeners are registered immediately (before the async loadSavedLayout
  // window) so a close-during-hydration still forces a flush of whatever
  // debounced timer is armed at that moment.
  const flushOnUnload = () => {
    try { flushPendingSaves() } catch (err) { dwarn('flushPendingSaves on unload failed:', err) }
  }
  window.addEventListener('pagehide', flushOnUnload)
  window.addEventListener('beforeunload', flushOnUnload)
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') flushOnUnload()
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  registerCleanup(() => {
    window.removeEventListener('pagehide', flushOnUnload)
    window.removeEventListener('beforeunload', flushOnUnload)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  // Clean up injected <style> elements on teardown. Without this,
  // the styles persist in <head> after disable — orphaned but inert.
  registerCleanup(() => {
    document.getElementById('canvas-ux-context-menu-styles')?.remove()
    document.getElementById('sidebar-ux-reflow')?.remove()
    document.getElementById('canvas-ux-secondary-mobile')?.remove()
  })

  // Mount the settings panel immediately. The host may not be in the DOM yet
  // (the user hasn't opened Settings → Extensions), but ctx.ui.mount sets up
  // a MutationObserver that reparents the host as soon as it appears.
  mountSettingsPanel(ctx)

  // Slash runtime — wired into the canvas cleanup chain so the intercept
  // listeners are detached when the extension is disabled.
  const detachSlash = attachSlashRuntime(ctx)
  registerCleanup(detachSlash)
  registerCleanup(unmountToastSurface)
  registerCleanup(cancelApplyLayoutInterval)

  // Phase 3 (finding #13): load the persisted layout BEFORE mounting the
  // secondary sidebar so its initial position matches the saved state on the
  // first paint — no 68px sliver, no 500ms flicker. We also hydrate the
  // settings from the same blob so every feature mount downstream sees the
  // correct gate.
  loadSavedLayout().then((layout) => {
    // Version check: if the layout was saved by a different Canvas version,
    // the user is running a stale frontend bundle. Log a warning so they
    // know to hard-refresh. This is a visibility mechanism, not auto-reload.
    if (layout?.version && layout.version !== CANVAS_VERSION) {
      dwarn(
        `Layout was saved by v${layout.version}, running v${CANVAS_VERSION}. ` +
        `Hard-refresh (Ctrl+F5) to load the updated extension.`
      )
    }
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
      registerCleanup(tearDownSecondarySidebar)
    }
    if (getSettings().chatReflow) {
      const detachReflow = startReflowObserver()
      registerCleanup(detachReflow)
    }
    if (getSettings().resizeSidebars) {
      mountResizeHandles()
      registerCleanup(() => {
        const mainDrawer = getMainDrawer()
        mainDrawer?.querySelector('.sidebar-ux-resize-handle')?.remove()
        const secondaryWrapper = getSecondaryWrapper()
        const secondaryDrawer = secondaryWrapper?.querySelector('.sidebar-ux-drawer') as HTMLElement | null
        secondaryDrawer?.querySelector('.sidebar-ux-resize-handle')?.remove()
      })
    }
    if (getSettings().autoMirrorOnSideSwap) {
      startSideChangeWatcher()
    }
    // Main-drawer persistence runs whenever the master toggle is on,
    // independent of resizeSidebars — the open/close watcher (via
    // spindle.ui.onDrawerChange) captures state even when Canvas isn't
    // mounting its own resize handle. Stops on teardown.
    startMainDrawerPersistence()
    registerCleanup(stopMainDrawerPersistence)
    // Mobile exclusion: mutual exclusion + viewport-cross detection
    const stopMobileExclusion = startMobileExclusion()
    registerCleanup(stopMobileExclusion)
    startTabRegistrationWatcher()
    // Context menu is always on for now (no panel toggle). Could become a
    // setting later if requested.
    startContextMenuListener()
    registerCleanup(stopContextMenuListener)

    // Always inject the consistent-icon-size CSS if it's enabled — it
    // doesn't need a wrapper to apply.
    if (getSettings().consistentIconSize) {
      injectDrawerTabStyles()
    }

    // Main-drawer restore — independent of secondSidebarEnabled. The
    // main drawer is host-owned and its open/close state is captured
    // by snapshotLayout() on every save, so a user who has the
    // secondary sidebar disabled but layoutPersistence on still
    // expects the main drawer to reopen. applyLayout (below) is
    // gated on secondSidebarEnabled because it touches the secondary
    // wrapper; applyMainDrawer has no such dependency.
    applyMainDrawer(layout)

    // Apply the rest of the layout (tab assignments + width delta if any).
    // Safe to call after mount: it won't double-animate the wrapper.
    if (layout && getSettings().secondSidebarEnabled) {
      applyLayout(layout)
    }
  }).catch((err) => {
    dwarn('Canvas: loadSavedLayout failed, mounting with defaults:', err)
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
