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
//   5. loadLayoutFromDisk + loadSettingsFromDisk — separate IPC roundtrips
//      for the split layout/settings repos. Hydrates settings, installs
//      the debug escape hatch, and conditionally mounts every gated
//      feature via feature.mount().
//   6. applyMainDrawer + owned model bootstrap — restore the persisted state.
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
import { getBackendCtx, setBackendCtx, CANVAS_VERSION } from './persist/backend-ctx'
import { applyMainDrawer } from './layout/main-restore'
import { flushPendingSaves, cancelLayoutSave, cancelLoadSavedLayout } from './persist/layout-load'
import { loadLayoutFromDisk, armLayoutRepo, setLayoutRepoBackendCtx, disarmLayoutRepo, bindLayoutSaveResultBridge } from './persist/layout-repo'
import { loadSettingsFromDisk, armSettingsRepo, setSettingsRepoBackendCtx, disarmSettingsRepo, bindSettingsSaveResultBridge } from './persist/settings-repo'
import {
  setHostBridgeContext,
  ensureUiPanelsPermission,
} from './dom/host-bridge'
import { tagMainSidebarButtons } from './chat/tag-buttons'
import {
  getSettings, setLastLoadedLayout, refreshSettingsPanel, hydrateSettings,
} from './settings/state'
import { FEATURES, alwaysCleanups } from './features/registry'
import { registerCleanup, cleanupAll } from './sidebar/cleanup'
import { startMainDrawerPersistence, stopMainDrawerPersistence, beginMainDrawerRestoreGuard, unsuppressMainDrawer } from './sidebar/main-persist'
import { startMobileExclusion } from './sidebar/mobile-exclusion'
import { startSideChangeWatcher } from './sidebar/drawer-sync'
import { drawerObserver } from './sidebar/drawer-observer'
import { initSecondaryDrawer, teardownSecondaryDrawer } from './sidebar/secondary-drawer'
import { startContextMenuListener, stopContextMenuListener } from './context-menu'
import { setDebug, dlog, dwarn } from './debug/log'
import { logPersistLoad, plog, syncPersistDebugToBackend } from './debug/persist-debug'
import { installDebugEscapeHatch } from './debug/fiber-scan'
import { startConfigureTabsIntercept, stopConfigureTabsIntercept } from './tabs/configure-intercept'
import { startWeaverLane } from './modals/weaver-lane'
import { LumiverseHost } from './host/lumiverse/implementation'
import { bootstrapFromLayout, shutdown as shutdownCore } from './recon/dispatch'

let _setupGeneration = 0

export function setup(ctx: SpindleFrontendContext) {
  const generation = ++_setupGeneration
  dlog(`start gen=${generation}`)
  // Cancel the previous instance's IPC listener before its global cancel
  // handle can be overwritten by this instance's load.
  // The legacy loader is no longer used by setup, but cancel any in-flight
  // compatibility call before replacing the shared backend context.
  cancelLoadSavedLayout({ preserveGuard: true })
  // A host update normally tears down the old bundle first, but do not depend
  // on that ordering. This also clears a partially mounted prior instance.
  cleanupAll()
  setBackendCtx(ctx)
  // Wire both persistence repos to the same backend context.
  setLayoutRepoBackendCtx(ctx)
  setSettingsRepoBackendCtx(ctx)
  // Bridge SAVE_*_RESULT messages so each save promise correlates with
  // its matching backend ack (or error). Tear down on cleanup.
  const unsubLayoutSaveResults = bindLayoutSaveResultBridge()
  const unsubSettingsSaveResults = bindSettingsSaveResultBridge()
  registerCleanup(() => { unsubLayoutSaveResults(); unsubSettingsSaveResults() })
  // Host never assigns window.spindle — wire the setup context so
  // getHostBridge() can reach ui / containers (built-in tab moves).
  setHostBridgeContext(ctx)
  syncPersistDebugToBackend((msg) => ctx.sendToBackend(msg))
  plog(`setup start gen=${generation}`)
  let active = true
  const isCurrent = () => active && generation === _setupGeneration

  // Hide host main (and later main-mirror) immediately — do not wait for
  // LOAD_LAYOUT. Host defaults the open drawer to "profile"; without this
  // the default paints for the whole IPC round-trip.
  beginMainDrawerRestoreGuard()
  // A hot extension replacement can happen before the async layout load
  // finishes. Always lift the guard when the old bundle is torn down.
  registerCleanup(unsuppressMainDrawer)
  registerCleanup(() => {
    // Only clear if we still own this generation's ctx (replacement setup
    // already installed a newer context).
    if (generation === _setupGeneration) setHostBridgeContext(null)
  })

  // Force-flush any pending debounced save before the page unloads.
  // Without these, a settings change made <100ms before close is lost.
  // Listeners are registered immediately (before the async
  // loadLayoutFromDisk window) so a close-during-hydration still forces
  // a flush of whatever
  // debounced timer is armed at that moment.
  // Force-flush any pending debounced save before the page unloads.
  const flushOnUnload = () => {
    try {
      flushPendingSaves()
    } catch (err) { dwarn('flushPendingSaves on unload failed:', err) }
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

  // Extension updates call the old setup teardown without a page unload. Flush
  // here as well; page lifecycle events are not guaranteed during hot reload.
  registerCleanup(() => {
    try { flushPendingSaves() } catch (err) { dwarn('flushPendingSaves on teardown failed:', err) }
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

  // Always-on teardowns: toast surface and the
  // the slash runtime. These fire on extension disable regardless of the
  // user's current toggle state (e.g. even if slash was never mounted,
  // its alwaysCleanup is a no-op, but the toast + interval are real).
  for (const teardown of alwaysCleanups()) {
    registerCleanup(teardown)
  }

  // Load the split repositories before mounting the secondary sidebar so its
  // initial position matches the saved state on first paint. Each repository
  // owns its load status and write fence; an error in one file must not make
  // the other file look empty or arm its save path.
  Promise.all([
    loadLayoutFromDisk().catch((err) => {
      dwarn('Canvas: loadLayoutFromDisk failed:', err)
      return { status: 'error' as const, reason: String(err) }
    }),
    loadSettingsFromDisk().catch((err) => {
      dwarn('Canvas: loadSettingsFromDisk failed:', err)
      return { status: 'error' as const, reason: String(err) }
    }),
  ]).then(async ([layoutResult, settingsResult]) => {
    dlog(`load resolved gen=${generation} layoutStatus=${layoutResult.status} settingsStatus=${settingsResult.status}`)
    if (!isCurrent()) {
      plog(`setup load ignored stale gen=${generation} current=${_setupGeneration}`)
      return
    }

    // Arm the write fence: layout repo on ok or empty, settings repo similarly.
    // An error load means the file is corrupt — never arm, never write.
    if (settingsResult.status === 'ok' || settingsResult.status === 'empty') {
      armSettingsRepo()
    } else {
      dwarn(`Canvas: settings load ${settingsResult.status}: ${(settingsResult as any).reason ?? 'unknown'}`)
    }
    if (layoutResult.status === 'ok' || layoutResult.status === 'empty') {
      armLayoutRepo()
    } else {
      dwarn(`Canvas: layout load ${layoutResult.status}: ${(layoutResult as any).reason ?? 'unknown'}`)
    }
    const layout = layoutResult.status === 'ok' ? layoutResult.data : null

    // Version check: if the layout was saved by a different Canvas version,
    // the user is running a stale frontend bundle. Log a warning so they
    // know to hard-refresh. This is a visibility mechanism, not auto-reload.
    if (layout?.version && layout.version !== CANVAS_VERSION) {
      dwarn(
        `Layout was saved by v${layout.version}, running v${CANVAS_VERSION}. ` +
        `Hard-refresh (Ctrl+F5) to load the updated extension.`
      )
    }
    // Hydrate settings from the settings payload. Defaults filled by
    // mergeCanvasSettings.
    const settingsPayload = settingsResult.status === 'ok' ? settingsResult.data : null
    hydrateSettings(settingsPayload?.settings ?? null)
    setDebug(getSettings().debugMode)
    setLastLoadedLayout(layout)
    logPersistLoad('hydrate', {
      layout: layout ?? null,
      generation,
      reason: layout == null ? 'null-layout→defaults' : 'from-disk',
    })
    if (layout == null) {
      plog(`hydrate applied in-memory defaults (disk layout was null)`)
    }

    // Layout hydration is authoritative. The layout repo was loaded above,
    // so there is no second legacy LOAD_LAYOUT request here.
    // Canvas-owned Configure hide (layout.hiddenTabIds) — host DB often never
    // persisted drawerSettings.hiddenTabIds for builtins. Hydrate before
    // owned-model sync so secondary/mirror re-apply after hard refresh.
    try {
      const { hydrateCanvasHiddenFromLayout } = await import('./tabs/hidden-tabs')
      hydrateCanvasHiddenFromLayout(layout)
    } catch {
      // non-fatal
    }
    // The settings panel was mounted earlier in setup() with the default
    // getSettings(). Now that we've hydrated from the saved layout, re-render
    // the panel so the toggles reflect the loaded values rather than the
    // defaults baked in at mount time. refreshSettingsPanel (in
    // settings/state.ts) fires the closure registered by mountSettingsPanel.
    refreshSettingsPanel()

    if (getSettings().debugMode) installDebugEscapeHatch()

    // ui_panels is required for built-in tab mobility (getBuiltInTabRoot +
    // requestTabLocation). Declared in spindle.json; request if not yet
    // granted (e.g. upgrade from a empty-permissions install).
    try {
      const ok = await ensureUiPanelsPermission()
      if (!ok) {
        dwarn(
          'Canvas: ui_panels permission not granted — built-in tab moves to ' +
          'the second drawer will fail until the user grants panel access.',
        )
      }
    } catch (err) {
      dwarn('Canvas: ensureUiPanelsPermission failed:', err)
    }
    if (!isCurrent()) return

    // Hide host main + main-mirror before feature mounts (taskbar mode can
    // open the mirror with the host default "profile" tab). Lifted after
    // applyMainDrawer activates the persisted primary.tabId.
    beginMainDrawerRestoreGuard()

    // Run feature init() hooks. These run after hydrateSettings so they
    // can read the persisted toggle state, but before mount() so they
    // can inject CSS (e.g. shadow-disable) that must be present on the
    // first paint regardless of the feature's mount gate.
    for (const feature of FEATURES) {
      if (!isCurrent()) return
      feature.init?.(ctx)
    }

    // Mount every feature whose setting is currently truthy. The feature
    // owns its own mount logic; the orchestrator just runs them in order
    // and collects teardowns. Sub-features (resize handles, side-change
    // watcher, etc.) are gated at their own mount sites rather than via
    // the master toggle, so a non-master-gated sub-feature is a one-liner
    // addition to the registry.
    for (const feature of FEATURES) {
      if (!isCurrent()) return
      if (!feature.mount) continue
      if (!getSettings()[feature.id]) continue
      dlog(`mounting feature ${String(feature.id)}`)
      const teardown = feature.mount(ctx, layout)
      if (typeof teardown === 'function') registerCleanup(teardown)
      dlog(`mounted feature ${String(feature.id)}`)
    }
    dlog(`all features mounted`)

    // Side-change watcher runs unconditionally (no longer gated behind
    // the autoMirrorOnSideSwap setting). drawer-sync.ts:200 already registers
    // stopSideChangeWatcher with the cleanup chain.
    dlog(`startSideChangeWatcher`)
    startSideChangeWatcher()
    dlog(`startSideChangeWatcher done`)

    // Main-drawer persistence runs whenever the master toggle is on,
    // independent of resizeSidebars — the open/close watcher (via
    // spindle.ui.onDrawerChange) captures state even when Canvas isn't
    // mounting its own resize handle. Stops on teardown.
    dlog(`startMainDrawerPersistence`)
    startMainDrawerPersistence()
    dlog(`startMainDrawerPersistence done`)
    registerCleanup(stopMainDrawerPersistence)
    // Mobile exclusion: mutual exclusion + viewport-cross detection
    dlog(`startMobileExclusion`)
    registerCleanup(startMobileExclusion())
    dlog(`startMobileExclusion done`)
    // Wire DrawerObserver to handle tab registration/unregistration
    dlog(`drawerObserver.onTabRegistered`)
    drawerObserver.onTabRegistered(() => {
      tagMainSidebarButtons()
      // Late extension tabs re-register with a new :N suffix. Heal host
      // hiddenTabIds and re-apply to secondary/mirror so Configure hide
      // still sticks after hard refresh. Debounced: many tabs register
      // in a burst at boot.
      void import('./tabs/hidden-tabs').then((m) => {
        m.scheduleSyncHiddenTabsFromHost({ writeBack: true })
      }).catch(() => { /* ignore */ })
      // When a new tab button appears (late extension registration), refresh
      // the open Configure Tabs modal so the user sees the new tab immediately
      // rather than needing to close + reopen. No-op when modal is closed.
      void import('./tabs/configure-modal').then((m) => {
        m.refreshConfigureDraftFromLive()
      }).catch(() => { /* ignore */ })
    })
    dlog(`drawerObserver.start`)
    drawerObserver.start()
    dlog(`drawerObserver.start done`)
    // Initialize the SecondaryDrawer state machine after DrawerObserver is
    // running. This wires up tab unregistration cleanup and prepares the
    // state machine for assignToSecondary / unassignFromSecondary calls.
    dlog(`initSecondaryDrawer`)
    initSecondaryDrawer(ctx)
    dlog(`initSecondaryDrawer done`)
    // Context menu is always on for now (no panel toggle). Could become a
    // setting later if requested.
    dlog(`startContextMenuListener`)
    startContextMenuListener()
    dlog(`startContextMenuListener done`)
    registerCleanup(stopContextMenuListener)

    // Configure Tabs intercept is always on while Canvas is loaded, so
    // right-click → "Configure tabs" routes to Canvas's modal regardless
    // of second-drawer state. This lets users enable the second drawer
    // from the footer toggle inside the modal.
    dlog(`startConfigureTabsIntercept`)
    startConfigureTabsIntercept()
    dlog(`startConfigureTabsIntercept done`)
    registerCleanup(stopConfigureTabsIntercept)

    // Tab-list drag-and-drop is settings-gated (dragAndDropDrawerTabs feature;
    // requires taskbar mode). Mounted via FEATURES when enabled.

    // Weaver Studio content-lane containment is always on while Canvas is
    // loaded, independent of chatReflow setting. It constrains the weaver
    // dialog to the visible content lane between drawer/strip insets.
    dlog(`startWeaverLane`)
    registerCleanup(startWeaverLane())
    dlog(`startWeaverLane done`)

    // Drawer overhaul cleanup: tear down the SecondaryDrawer state machine
    // on extension disable.
    registerCleanup(() => {
      teardownSecondaryDrawer()
    })

    // The owned model is the sole tab placement/ordering state owner.
    dlog(`new LumiverseHost`)
    const coreHost = new LumiverseHost()
    // Wrap in try/catch: a synchronous throw from bootstrapFromLayout
    // (e.g. a malformed layout) would otherwise leave all the
    // registerCleanup handlers above registered but unrun, leaking
    // observers and state on extension disable.
    try {
      dlog(`bootstrapFromLayout:start`)
      bootstrapFromLayout(layout, coreHost, CANVAS_VERSION)
      dlog(`bootstrapFromLayout:returned (async reconcile still in flight)`)
    } catch (bootstrapErr) {
      dlog(`bootstrapFromLayout:threw`, bootstrapErr)
      dwarn('Canvas: bootstrapFromLayout threw synchronously:', bootstrapErr)
      throw bootstrapErr
    }
    // dispatch.shutdown() must run first so _unsubscribeWorldChanged fires
    // before the host's observers are torn down — otherwise a late
    // onWorldChanged callback could enqueue a syncFromHost against a
    // torn-down host.
    registerCleanup(() => {
      shutdownCore()
      coreHost.shutdown()
    })

    // Restore drawer geometry separately. Tab placement, order, hidden state,
    // active tabs, and drawer metadata are restored by the owned model above.
    dlog(`applyMainDrawer:pre`)
    const s = getSettings()
    const restoreOpen = !!s.persistDrawerOpenState
    const restoreWidth = !!s.persistDrawerWidth

    if (restoreOpen || restoreWidth) {
      dlog(`applyMainDrawer:call`)
      applyMainDrawer(layout)
      dlog(`applyMainDrawer:returned (async restore in flight)`)
    } else {
      dlog(`applyMainDrawer:skipped (no restore flags)`)
      // beginMainDrawerRestoreGuard already ran; do not leave drawer suppressed.
      unsuppressMainDrawer()
    }
    dlog(`setup():.then end gen=${generation}`)
  }).catch((err) => {
    dlog(`setup():.then caught error gen=${generation}`, err)
    if (!isCurrent()) return
    dwarn('Canvas: split persistence load failed, mounting with defaults:', err)
    logPersistLoad('null-response', {
      reason: 'load-promise-reject',
      generation,
      layout: null,
    })
    // If the load succeeded but bootstrap failed, the repos may already
    // be armed. Disarm them so a broken setup doesn't keep writing
    // layout/settings to disk from a torn-down state.
    disarmLayoutRepo()
    disarmSettingsRepo()
    // If the restore guard was never lifted (or load failed before
    // beginMainDrawerRestoreGuard), ensure the drawer is visible.
    try { unsuppressMainDrawer() } catch { /* ignore */ }
  })

  // The split repositories own their temporary backend listeners. There is no
  // permanent listener here, so duplicate or late responses cannot hydrate a
  // newer setup generation.

  // Return teardown — called when extension is disabled
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    active = false
    // A newer setup owns the shared cleanup registry and backend context.
    if (generation !== _setupGeneration) return
    plog(`setup teardown gen=${generation}`)
    cleanupAll()
    // Keep the load guard active while cleanup tears down observers. This
    // prevents stopMainDrawerPersistence from saving host defaults during
    // hydration; cancellation is the final teardown step.
    cancelLoadSavedLayout()
    if (getBackendCtx() === ctx) setBackendCtx(null)
  }
}
