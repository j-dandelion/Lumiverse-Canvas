// Canvas extension orchestrator.
//
// setup(ctx) is the Spindle loader's entry point — it wires every feature
// into the host, hydrates the persisted layout, and returns the teardown
// to run when the extension is disabled.
//
// The feature-specific wiring lives in `features/registry.ts`. This file
// is the orchestrator: it knows the lifecycle (init → load → mount → apply),
// not the features. Adding a new setting is a one-liner in registry.ts.
//
// Order matters here:
//   1. setBackendCtx — must run before any *Layout call.
//   2. Unconditional unload flush + style cleanup registrations.
//   3. mountSettingsPanel — must come before applySettings can be called
//      on a runtime settings change (it captures the ctx for the live-apply
//      dispatch path).
//   4. feature init() — runs after hydrateSettings, before mount. Injects
//      disable-CSS for inverted features (e.g. shadows when off) so the
//      visual state is correct on first paint.
//   5. loadSavedLayout — single IPC roundtrip. Hydrates settings, installs
//      the debug escape hatch, and conditionally mounts every gated
//      feature via feature.mount().
//   6. applyMainDrawer + applyLayout — restore the persisted drawer state.
//
// The Phase 3 (finding #13) ordering — load the layout BEFORE mounting the
// secondary sidebar — is what makes the drawer render at the right width on
// first paint (no 68px sliver, no 500ms flicker).
//
// Tab-assignment persistence is always-on (built-in). The
// persistTabAssignments setting was removed — secondary tab assignments
// (+ activeTabId) are always saved and restored.

import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import { mountSettingsPanel } from './settings/panel'
import { setBackendCtx, applyMainDrawer, loadSavedLayout, CANVAS_VERSION, flushPendingSaves, persistLayout, cancelLayoutSave } from './layout/persist'
import { getTabAssignments, deleteTabAssignment } from './tabs/assignment'
import { removeSecondaryTabButton } from './tabs/buttons'
import { tagMainSidebarButtons } from './chat/tag-buttons'
import { applyLayout } from './layout/apply'
import {
  getSettings, setLastLoadedLayout, refreshSettingsPanel, hydrateSettings,
  resetHydrationGuard,
} from './settings/state'
import { FEATURES, alwaysCleanups } from './features/registry'
import { registerCleanup, cleanupAll } from './sidebar/cleanup'
import { startMainDrawerPersistence, stopMainDrawerPersistence, beginMainDrawerRestoreGuard, unsuppressMainDrawer } from './sidebar/main-persist'
import { startMobileExclusion } from './sidebar/mobile-exclusion'
import { startSideChangeWatcher } from './sidebar/drawer-sync'
import { drawerObserver } from './sidebar/drawer-observer'
import { initSecondaryDrawer, teardownSecondaryDrawer, isRestoringFromLayout } from './sidebar/secondary-drawer'
import { startContextMenuListener, stopContextMenuListener } from './context-menu'
import { setDebug, dwarn } from './debug/log'
import { installDebugEscapeHatch } from './debug/fiber-scan'
import { startConfigureTabsIntercept, stopConfigureTabsIntercept } from './tabs/configure-intercept'
import { startWeaverLane } from './modals/weaver-lane'

export function setup(ctx: SpindleFrontendContext) {
  setBackendCtx(ctx)

  // Hide host main (and later main-mirror) immediately — do not wait for
  // LOAD_LAYOUT. Host defaults the open drawer to "profile"; without this
  // the default paints for the whole IPC round-trip.
  beginMainDrawerRestoreGuard()

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

  // Clean up injected <style> elements on teardown. Without these,
  // the styles persist in <head> after disable — orphaned but inert.
  registerCleanup(() => {
    document.getElementById('canvas-ux-context-menu-styles')?.remove()
    document.getElementById('sidebar-ux-reflow')?.remove()
    document.getElementById('canvas-ux-secondary-mobile')?.remove()
    document.getElementById('sidebar-ux-shadow-disable-desktop')?.remove()
    document.getElementById('sidebar-ux-shadow-disable-mobile')?.remove()
  })

  // Cancel any pending debounced layout save on teardown so the timer
  // doesn't fire after _backendCtx is nulled.
  registerCleanup(cancelLayoutSave)

  // Mount the settings panel immediately. The host may not be in the DOM yet
  // (the user hasn't opened Settings → Extensions), but ctx.ui.mount sets up
  // a MutationObserver that reparents the host as soon as it appears.
  mountSettingsPanel(ctx)

  // Always-on teardowns: toast surface, applyLayout polling interval, and
  // the slash runtime. These fire on extension disable regardless of the
  // user's current toggle state (e.g. even if slash was never mounted,
  // its alwaysCleanup is a no-op, but the toast + interval are real).
  for (const teardown of alwaysCleanups()) {
    registerCleanup(teardown)
  }

  // Phase 3 (finding #13): load the persisted layout BEFORE mounting the
  // secondary sidebar so its initial position matches the saved state on the
  // first paint — no 68px sliver, no 500ms flicker. We also hydrate the
  // settings from the same blob so every feature mount downstream sees the
  // correct gate.
  loadSavedLayout().then(async (layout) => {
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
    // mergeCanvasSettings inside hydrateSettings). Reset the guard first
    // so a module re-evaluation (page reload) does not leave the old
    // "user has touched" flag stuck at true, which would skip hydration.
    resetHydrationGuard()
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

    // Hide host main + main-mirror before feature mounts (taskbar mode can
    // open the mirror with the host default "profile" tab). Lifted after
    // applyMainDrawer activates the persisted primary.tabId.
    beginMainDrawerRestoreGuard()

    // Run feature init() hooks. These run after hydrateSettings so they
    // can read the persisted toggle state, but before mount() so they
    // can inject CSS (e.g. shadow-disable) that must be present on the
    // first paint regardless of the feature's mount gate.
    for (const feature of FEATURES) {
      feature.init?.(ctx)
    }

    // Mount every feature whose setting is currently truthy. The feature
    // owns its own mount logic; the orchestrator just runs them in order
    // and collects teardowns. Sub-features (resize handles, side-change
    // watcher, etc.) are gated at their own mount sites rather than via
    // the master toggle, so a non-master-gated sub-feature is a one-liner
    // addition to the registry.
    for (const feature of FEATURES) {
      if (!feature.mount) continue
      if (!getSettings()[feature.id]) continue
      const teardown = feature.mount(ctx, layout)
      if (typeof teardown === 'function') registerCleanup(teardown)
    }

    // Side-change watcher runs unconditionally (no longer gated behind
    // the autoMirrorOnSideSwap setting). drawer-sync.ts:200 already registers
    // stopSideChangeWatcher with the cleanup chain.
    startSideChangeWatcher()

    // Main-drawer persistence runs whenever the master toggle is on,
    // independent of resizeSidebars — the open/close watcher (via
    // spindle.ui.onDrawerChange) captures state even when Canvas isn't
    // mounting its own resize handle. Stops on teardown.
    startMainDrawerPersistence()
    registerCleanup(stopMainDrawerPersistence)
    // Mobile exclusion: mutual exclusion + viewport-cross detection
    registerCleanup(startMobileExclusion())
    // Wire DrawerObserver to handle tab registration/unregistration
    drawerObserver.onTabRegistered(() => {
      tagMainSidebarButtons()
    })
    drawerObserver.onTabUnregistered((tabId) => {
      if (getTabAssignments().has(tabId)) {
        // Skip during layout restore. The restore's end-of-interval logic
        // in src/layout/apply.ts is the authoritative state-setter; any
        // mutation here (especially the assignment delete) would race with
        // the restore and cause a cascade that hides the user's tabs.
        // See _restoringFromLayout in src/sidebar/secondary-drawer.ts
        // for the full failure mode.
        if (isRestoringFromLayout()) return
        deleteTabAssignment(tabId)
        removeSecondaryTabButton(tabId)
        persistLayout()
      }
    })
    drawerObserver.start()
    // Initialize the SecondaryDrawer state machine after DrawerObserver is
    // running. This wires up tab unregistration cleanup and prepares the
    // state machine for assignToSecondary / unassignFromSecondary calls.
    initSecondaryDrawer(ctx)
    // Context menu is always on for now (no panel toggle). Could become a
    // setting later if requested.
    startContextMenuListener()
    registerCleanup(stopContextMenuListener)

    // Configure Tabs intercept is always on while Canvas is loaded, so
    // right-click → "Configure tabs" routes to Canvas's modal regardless
    // of second-drawer state. This lets users enable the second drawer
    // from the footer toggle inside the modal.
    startConfigureTabsIntercept()
    registerCleanup(stopConfigureTabsIntercept)

    // Weaver Studio content-lane containment is always on while Canvas is
    // loaded, independent of chatReflow setting. It constrains the weaver
    // dialog to the visible content lane between drawer/strip insets.
    registerCleanup(startWeaverLane())

    // Drawer overhaul cleanup: tear down the SecondaryDrawer state machine
    // on extension disable.
    registerCleanup(() => {
      teardownSecondaryDrawer()
    })

    // Layout geometry restore is gated per facet (open/width/tabs).
    // Tab-assignment persistence is always-on (built-in), so tabs always
    // contribute to the restore-any check.
    // loadSavedLayout + hydrateSettings still run so settings toggles are
    // correct. Main-drawer restore (open and/or width) is independent of
    // secondSidebarEnabled (host-owned drawer). applyLayout is also gated
    // on secondSidebarEnabled because it touches the secondary wrapper.
    //
    // applyLayout moves tabs to the secondary sidebar, which can reset the
    // host active tab to "profile". Fire it first; panel bodies stay hidden
    // until primary.tabId is active. finishRestore re-asserts primary after
    // late assigns — no fixed wait needed here.
    const s = getSettings()
    const restoreOpen = !!s.persistDrawerOpenState
    const restoreWidth = !!s.persistDrawerWidth
    // Tab-assignment persistence is always-on (built-in).
    const restoreAny = restoreOpen || restoreWidth || true

    if (layout && restoreAny && s.secondSidebarEnabled) {
      void applyLayout(layout).catch((err) => {
        dwarn('Canvas: applyLayout failed:', err)
      })
    }

    if (restoreOpen || restoreWidth) {
      applyMainDrawer(layout)
    } else {
      // beginMainDrawerRestoreGuard already ran; do not leave drawer suppressed.
      unsuppressMainDrawer()
    }
  }).catch((err) => {
    dwarn('Canvas: loadSavedLayout failed, mounting with defaults:', err)
    // If the restore guard was never lifted (or load failed before
    // beginMainDrawerRestoreGuard), ensure the drawer is visible.
    try { unsuppressMainDrawer() } catch { /* ignore */ }
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
