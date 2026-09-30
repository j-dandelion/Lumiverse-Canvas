// Feature registry — every Canvas setting is owned by exactly one feature.
//
// A feature is a settings-gated unit of behavior. The feature owns its own
// mount/unmount and is the single source of truth for its lifecycle. The
// orchestrator (setup.ts) iterates FEATURES to:
//   1. Call init() once after hydrateSettings — for one-time setup that
//      must run before mount regardless of toggle state (e.g. injecting
//      disable-CSS for inverted features like shadows).
//   2. Call mount() after loadSavedLayout resolves, gated on the feature's
//      own setting being truthy. The returned teardown is added to the
//      global cleanup chain.
//   3. Call apply() on every settings diff, gated on the feature's setting
//      having changed.
//
// Adding a new setting is a one-liner: append a new CanvasFeature to FEATURES.
// The orchestrator, the diff dispatcher, and the cleanup chain pick it up
// automatically.
//
// The contract is intentionally small. Features can grow extra methods
// (e.g. a "preview" hook) when needed; the registry stays simple.
//
// Tab-assignment persistence is always-on (built-in). The
// persistTabAssignments setting and its feature have been removed —
// secondary tab assignments (+ activeTabId) are always saved and restored.
//
// showTabLabels was removed from Canvas — the second drawer always follows
// the host main-drawer showTabLabels setting (no tri-state override). The
// drawerSyncFeature no longer has a showTabLabels apply branch.

import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import type { FullCanvasSettings } from '../settings/state'
import { getSettings, getLastLoadedLayout, getDualLayoutSlot, isDragAndDropDrawerTabsEnabled, isTaskbarModeEnabled, isOsModeEnabled } from '../settings/state'
import { installTabListDnd, tearDownTabListDnd } from '../tabs/tab-list-dnd'
import { setDebug, dlog, dwarn } from '../debug/log'
import { applyOsModeChange, syncOsMobileDrawerMode } from '../os/os-mode'
import { trackModeRevealWork } from '../settings/mode-reveal'
import { mountPanelChrome, teardownPanelChrome, applyOsWindowControlsChange } from '../os/panel-chrome'
import { applyStartButtonLocationChange, hideStartMenu, mountStartMenu, teardownStartMenu } from '../os/start-menu'
import { activateChromeLocations, reconcileChromeLocations, teardownChromeLocations } from '../os/chrome-locations'
import { cancelAllWrapperAnimations } from '../sidebar/animation'
import { installDebugEscapeHatch } from '../debug/fiber-scan'
import { injectReflowStyles, startReflowObserver, updateChatReflow, clearChatMargins, clearWelcomeReflow } from '../chat/reflow'
import { registerCleanup } from '../sidebar/cleanup'
import { getMainDrawer } from '../dom/lumiverse'
import { injectStyles } from '../debug/styles'
import { mountSecondarySidebar, tearDownSecondarySidebar, getSecondaryWrapper } from '../sidebar/secondary'
import { mountResizeHandles, refreshResizeHandles } from '../resize/handles'
import { syncDrawerTabSettings } from '../sidebar/drawer-sync'
import { cancelLayoutSave } from '../persist/layout-load'
import { attachSlashRuntime } from '../slash/runtime'
import { unmountToastSurface } from '../slash/toast'
import { applyTabListPosition, applyTabListPin, clearTabListPosition, reconcileTabListPin, syncHorizontalSplit } from '../sidebar/tab-position'
import { applyMainTabListPin, reconcileMainTabListPin, teardownMainPin } from '../sidebar/main-tab-pin'
import {
  clearDrawerLocation,
  initDrawerLocation,
  mountDrawerLocation,
  reconcileDrawerLocation,
} from '../sidebar/drawer-location'
import { updateStripGutters, clearStripGutters } from '../sidebar/strip-gutter'
import { updateDrawerTabVisibility } from '../tabs/buttons'
import { updateMainMirrorDrawerTabVisibility } from '../sidebar/main-mirror-drawer'
import { getModel, dispatchBatch } from '../recon/dispatch'
import { parseBuiltinKey } from '../core/model'
import { isCoreTabId } from '../tabs/core-tabs'
import { startUnhideVanillaTabs } from '../tabs/unhide-vanilla'
import { drawerTabDragFeature } from './drawer-tab-position'

/** A teardown returned by mount(). */
export type Teardown = () => void

/** Lifecycle hooks for a settings-gated feature. */
export interface CanvasFeature {
  /** Stable id; matches a key in FullCanvasSettings. */
  id: keyof FullCanvasSettings
  /** One-time setup after hydrateSettings, before mount. Optional. */
  init?(ctx: SpindleFrontendContext): void
  /** Mount when the feature's setting is truthy on initial load. Returns a
   *  teardown that the orchestrator adds to the global cleanup chain. */
  mount?(ctx: SpindleFrontendContext, layout: any): Teardown | void
  /** Apply a settings diff. Optional. The orchestrator only calls this
   *  when prev[id] !== next[id]. */
  apply?(prev: FullCanvasSettings, next: FullCanvasSettings, ctx: SpindleFrontendContext): void
  /** Mount even when the feature's setting is falsy (S1: main-drawer
   *  ownership is unconditional — the feature self-gates its chrome). */
  unconditional?: boolean
}

// --- Shadow CSS constants (shared by desktop + mobile features) ---
const SHADOW_DISABLE_DESKTOP_ID = 'sidebar-ux-shadow-disable-desktop'
const SHADOW_DISABLE_MOBILE_ID = 'sidebar-ux-shadow-disable-mobile'
const shadowDisableCss = (media: 'min' | 'max', width: number): string => `
  @media (${media}-width: ${width}px) {
    .sidebar-ux-drawer, :has(> [data-spindle-mount="sidebar"]) {
      box-shadow: none !important;
    }
  }
`

// --- Features ---

let _unhideVanillaTabsTeardown: Teardown | null = null

function mountUnhideVanillaTabs(): Teardown {
  if (_unhideVanillaTabsTeardown) return _unhideVanillaTabsTeardown
  const stop = startUnhideVanillaTabs()
  const teardown = () => {
    stop()
    if (_unhideVanillaTabsTeardown === teardown) {
      _unhideVanillaTabsTeardown = null
    }
  }
  _unhideVanillaTabsTeardown = teardown
  return teardown
}

/** Keep Lumiverse's own hidden-tab list clear while Canvas owns the opt-in. */
const unhideVanillaTabsFeature: CanvasFeature = {
  id: 'unhideVanillaTabs',
  mount() {
    return mountUnhideVanillaTabs()
  },
  apply(_prev, next) {
    if (next.unhideVanillaTabs) {
      if (!_unhideVanillaTabsTeardown) {
        registerCleanup(mountUnhideVanillaTabs())
      }
      return
    }
    _unhideVanillaTabsTeardown?.()
  },
}

/** Debug mode: enables [Canvas] console output + installs the escape hatch. */
const debugFeature: CanvasFeature = {
  id: 'debugMode',
  apply(prev, next) {
    if (prev.debugMode === next.debugMode) return
    setDebug(next.debugMode)
    if (next.debugMode) {
      installDebugEscapeHatch()
    } else {
      delete window.__canvasDebug
    }
  },
}

/** Chat reflow: shifts the chat column so neither drawer covers it.
 *  The MutationObserver on the main wrapper (in startReflowObserver) is
 *  the only path that catches the *main sidebar's* open/close events —
 *  the secondary sidebar calls updateChatReflow() directly from its
 *  own open/close handlers, but the main sidebar only signals via
 *  class mutations on the wrapper. Without the observer, opening the
 *  main sidebar leaves the chat covered by the drawer.
 *
 *  The feature holds the observer teardown so apply() can re-wire
 *  observers when the user toggles the setting at runtime. The
 *  orchestrator's cleanup chain only fires on extension disable, so
 *  per-toggle lifecycle lives here. The teardown is registered with
 *  the global cleanup registry so extension disable still tears
 *  down a runtime-mounted observer. */
let _chatReflowTeardown: (() => void) | null = null
const chatReflowFeature: CanvasFeature = {
  id: 'chatReflow',
  mount() {
    if (!getSettings().chatReflow) return
    if (_chatReflowTeardown) return _chatReflowTeardown
    _chatReflowTeardown = startReflowObserver()
    return _chatReflowTeardown
  },
  apply(prev, next) {
    if (prev.chatReflow === next.chatReflow) return
    if (next.chatReflow) {
      // Off → on at runtime. mount() was skipped at boot (setting
      // was falsy then), so the observer is not yet attached.
      injectReflowStyles()  // idempotent; re-injects style tag if on→off removed it
      // Synchronous reflow: populate --sidebar-ux-chat-ml/mr immediately
      // so the reflow CSS takes effect on the next paint, with no need
      // to close/reopen the sidebar. The async observer in startReflowObserver
      // would otherwise only fire on a future DOM mutation.
      updateChatReflow()
      if (!_chatReflowTeardown) {
        _chatReflowTeardown = startReflowObserver()
        // Runtime-attached teardowns need to be in the cleanup chain
        // so extension disable still tears them down.
        registerCleanup(_chatReflowTeardown)
      }
    } else {
      // On → off: reset chat margins. The observer stays attached but the
      // chat write is gated inside updateChatReflow, so subsequent
      // scheduleReflow calls leave the chat alone. We don't disconnect the
      // observer — the cleanup chain handles that on extension disable (and
      // welcomeReflow may still need the shared observer + sheet).
      clearChatMargins()
      if (!getSettings().welcomeReflow) {
        document.getElementById('sidebar-ux-reflow')?.remove()
      }
    }
  },
}

/** Welcome/Landing reflow (default on): the Landing route gets the same
 *  open-drawer margins as the chat. Independent of chatReflow but shares its
 *  observer + injected sheet (one MutationObserver watches the main wrapper
 *  for both consumers). mount()/apply() therefore only start the shared
 *  observer when it is not already running, and never remove the sheet while
 *  chat still needs it. */
const welcomeReflowFeature: CanvasFeature = {
  id: 'welcomeReflow',
  mount() {
    if (!getSettings().welcomeReflow) return
    if (_chatReflowTeardown) {
      // The shared observer is already running (chatReflow on, or a runtime
      // enable): reuse it and just make the sheet + current geometry apply.
      injectReflowStyles()
      updateChatReflow()
      return
    }
    _chatReflowTeardown = startReflowObserver()
    return _chatReflowTeardown
  },
  apply(prev, next) {
    if (prev.welcomeReflow === next.welcomeReflow) return
    if (next.welcomeReflow) {
      // Off → on at runtime: same lazy-mount contract as chatReflowFeature.
      injectReflowStyles()
      updateChatReflow()
      if (!_chatReflowTeardown) {
        _chatReflowTeardown = startReflowObserver()
        registerCleanup(_chatReflowTeardown)
      }
    } else {
      // On → off: drop the Landing margins/class + snap gate. The shared
      // sheet must survive while chat still needs it.
      clearWelcomeReflow()
      if (!getSettings().chatReflow) {
        document.getElementById('sidebar-ux-reflow')?.remove()
      }
    }
  },
}

/** Second sidebar: the master toggle for the entire mirror-drawer feature.
 *  Initial mount reads the layout's saved width/open so the wrapper renders
 *  at the right size on the first paint (gated per layout facet).
 *  Runtime re-apply mounts the shell when missing; tab restore is owned by
 *  requestSecondDrawerMode (awaited owned-model restore) or setup cold-load.
 *
 *  The Configure Tabs intercept lifecycle is now owned by setup.ts (always-on
 *  while Canvas is loaded), not tied to second-drawer state.
 *
 *  Tab-assignment persistence is always-on (built-in), so hasTabsToRestore
 *  only checks for layout detachedTabs (no longer gated on a setting). */
const secondSidebarFeature: CanvasFeature = {
  id: 'secondSidebarEnabled',
  mount(_ctx, layout) {
    const s = getSettings()
    const initialWidth = s.persistDrawerWidth ? layout?.secondary?.width : undefined
    // hasTabsToRestore: tab-assignment persistence is always-on, so we only
    // check whether the layout actually has tabs to restore.
    const hasTabsToRestore = (layout?.detachedTabs?.length ?? 0) > 0
    const initialOpen = !!(
      s.persistDrawerOpenState &&
      layout?.secondary?.open === true &&
      hasTabsToRestore
    )
    mountSecondarySidebar({ initialWidth, initialOpen })

    const teardown = () => {
      tearDownSecondarySidebar()
    }
    return teardown
  },
  apply(prev, next) {
    if (prev.secondSidebarEnabled === next.secondSidebarEnabled) return
    if (next.secondSidebarEnabled) {
      if (!getSecondaryWrapper()) {
        const s = getSettings()
        // Tab-assignment persistence is always-on, so anyFacet is always true.
        // Runtime enable reads the persisted dualLayout slot (the freshest
        // dual state; lastLoaded is the pre-enable single-era snapshot).
        // The cold-load path receives the loaded layout as the mount arg.
        const layout = getDualLayoutSlot() ?? getLastLoadedLayout()
        const initialWidth = s.persistDrawerWidth ? layout?.secondary?.width : undefined
        const hasTabsToRestore = (layout?.detachedTabs?.length ?? 0) > 0
        const initialOpen = !!(
          s.persistDrawerOpenState &&
          layout?.secondary?.open === true &&
          hasTabsToRestore
        )
        // Mount only — requestSecondDrawerMode awaits owned-model restore after
        // setSettings; cold-load restore is owned by setup.ts dispatcher bootstrap.
        // Calling restore here races the awaited path and can drop layout.
        mountSecondarySidebar({ initialWidth, initialOpen })
      }
    } else {
      tearDownSecondarySidebar()
    }
  },
}

/** Resize handles: drag-to-resize on both drawers. Idempotent — mount is safe
 *  to call multiple times. */
const resizeSidebarsFeature: CanvasFeature = {
  id: 'resizeSidebars',
  mount() {
    mountResizeHandles()
    return () => {
      getMainDrawer()?.querySelector('.sidebar-ux-resize-handle')?.remove()
      const sec = getSecondaryWrapper()?.querySelector('.sidebar-ux-drawer') as HTMLElement | null
      sec?.querySelector('.sidebar-ux-resize-handle')?.remove()
    }
  },
  apply() {
    // Toggling on/off at runtime walks both drawers and adds handles
    // idempotently. No diff check needed — refreshResizeHandles is cheap
    // and is the canonical "make the resize state match the current
    // settings" call.
    refreshResizeHandles()
  },
}

/** Drawer-sync bundle: mirror compact position + tab-label visibility.
 *  Both are owned by sidebar/drawer-sync.ts. The feature id is the master
 *  (mirrorCompactPosition). Label visibility sync lives in
 *  syncDrawerTabSettings which is called on mount/apply. The Canvas
 *  showTabLabels tri-state override has been removed — the second drawer
 *  always follows the host main-drawer setting. */
const drawerSyncFeature: CanvasFeature = {
  id: 'mirrorCompactPosition',
  mount() {
    if (getSettings().mirrorCompactPosition) syncDrawerTabSettings()
  },
  apply(prev, next) {
    if (prev.mirrorCompactPosition !== next.mirrorCompactPosition) {
      if (next.mirrorCompactPosition) {
        syncDrawerTabSettings()
      } else {
        const drawerTab = getSecondaryWrapper()?.querySelector('.sidebar-ux-drawer-tab') as HTMLElement
        if (drawerTab) drawerTab.style.marginTop = ''
      }
    }
  },
}

/** Drawer shadows: desktop variant (>=601px). */
const shadowsDesktopFeature: CanvasFeature = {
  id: 'drawerShadowsDesktop',
  init() {
    if (!getSettings().drawerShadowsDesktop) {
      injectStyles(SHADOW_DISABLE_DESKTOP_ID, shadowDisableCss('min', 601))
    }
  },
  apply(prev, next) {
    if (prev.drawerShadowsDesktop === next.drawerShadowsDesktop) return
    if (next.drawerShadowsDesktop) {
      document.getElementById(SHADOW_DISABLE_DESKTOP_ID)?.remove()
    } else {
      injectStyles(SHADOW_DISABLE_DESKTOP_ID, shadowDisableCss('min', 601))
    }
  },
}

/** Drawer shadows: mobile variant (<=600px). */
const shadowsMobileFeature: CanvasFeature = {
  id: 'drawerShadowsMobile',
  init() {
    if (!getSettings().drawerShadowsMobile) {
      injectStyles(SHADOW_DISABLE_MOBILE_ID, shadowDisableCss('max', 600))
    }
  },
  apply(prev, next) {
    if (prev.drawerShadowsMobile === next.drawerShadowsMobile) return
    if (next.drawerShadowsMobile) {
      document.getElementById(SHADOW_DISABLE_MOBILE_ID)?.remove()
    } else {
      injectStyles(SHADOW_DISABLE_MOBILE_ID, shadowDisableCss('max', 600))
    }
  },
}

/**
 * Layout facet feature factory: cancels in-flight debounced save when a facet
 * turns off so a queued mutation doesn't write live values for a disabled
 * facet. persistTabAssignments was removed (always-on), so this factory is
 * now only used for persistDrawerOpenState and persistDrawerWidth.
 */
function makeLayoutFacetFeature(
  id: 'persistDrawerOpenState' | 'persistDrawerWidth',
): CanvasFeature {
  return {
    id,
    apply(prev, next) {
      if (prev[id] === true && next[id] === false) {
        cancelLayoutSave()
      }
    },
  }
}
const persistDrawerOpenStateFeature = makeLayoutFacetFeature('persistDrawerOpenState')
const persistDrawerWidthFeature = makeLayoutFacetFeature('persistDrawerWidth')

/** Slash commands: mount/unmount the entire runtime. Owns its own
 *  always-on teardown (slashAlwaysCleanup) so a runtime-mounted slash
 *  runtime is detached on extension disable, regardless of whether
 *  setup.ts or the live-apply path did the mounting.
 *
 * The attach function is injected via makeSlashFeature so the test
 * (and any future alternative runtime) can swap implementations
 * without touching production code. The active-teardown reference
 * lives in a closure inside the factory, not in module state, so each
 * call to makeSlashFeature produces an isolated feature instance. */
export function makeSlashFeature(
  attach: (ctx: SpindleFrontendContext) => () => void,
): { feature: CanvasFeature; alwaysCleanup: () => void; getActiveDetach: () => (() => void) | null } {
  let active: (() => void) | null = null
  const slashFeature: CanvasFeature = {
    id: 'slashCommandsEnabled',
    mount(ctx) {
      // Skip if the standalone slash-commands extension is active
      if (typeof window !== 'undefined' && (window as any).__slashCommandsActive) return
      if (active) return active
      active = attach(ctx)
      return active
    },
    apply(_prev, next, ctx) {
      // Skip if the standalone slash-commands extension is active
      if (typeof window !== 'undefined' && (window as any).__slashCommandsActive) return
      if (next.slashCommandsEnabled) {
        if (!active) {
          active = attach(ctx)
        }
      } else {
        if (active) {
          const detach = active
          active = null
          detach()
        }
      }
    },
  }
  // Listen for canvas:slash-disable to tear down an already-mounted runtime
  const disableListener = () => {
    if (active) {
      const detach = active
      active = null
      detach()
    }
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('canvas:slash-disable', disableListener)
  }
  return {
    feature: slashFeature,
    alwaysCleanup() {
      if (active) {
        active()
        active = null
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('canvas:slash-disable', disableListener)
      }
    },
    getActiveDetach: () => active,
  }
}

const _slashImpl = makeSlashFeature(attachSlashRuntime)
const slashFeature: CanvasFeature = _slashImpl.feature

/** Always-on teardown for the slash feature. setup.ts adds this to its
 *  cleanup chain via alwaysCleanups(). */
export function slashAlwaysCleanup(): void { _slashImpl.alwaysCleanup() }

/**
 * S8 Drawer location (Sides | Top | Bottom).
 *
 * Registered immediately BEFORE tabPositionFeature so the html location
 * classes + --sidebar-ux-strip-h exist before any pin chrome in the same
 * settings diff. `unconditional`: the classes/var must be right before any
 * mount, even at the default 'sides'.
 *
 * On a location-changed diff the legacy geometry features STAND DOWN (they
 * compare prev/next.drawerLocation) so reconcileDrawerLocation is the only
 * geometry pass — this is what keeps the taskbar auto-enable from
 * force-remounting the shells.
 */
const drawerLocationFeature: CanvasFeature = {
  id: 'drawerLocation',
  unconditional: true,
  init() {
    // Classes + strip-height var + HORIZONTAL_STRIP_CSS before any mount.
    initDrawerLocation()
  },
  mount() {
    // Presentation + presence subscription; the returned teardown
    // unsubscribes (clearDrawerLocation also handles it idempotently).
    return mountDrawerLocation()
  },
  apply(prev, next) {
    if (prev.drawerLocation === next.drawerLocation) return
    // A live drawer animation targets the old rail/geometry — settle it before
    // the new layout lands (mixed-axis motion otherwise).
    cancelAllWrapperAnimations()
    // Authoritative pass for the diff (sync + coalesced).
    reconcileDrawerLocation({ force: true })
    // Spec §4.5: a floating Start menu cannot survive the strip moving
    // underneath it — dismiss before the geometry settles.
    hideStartMenu({ immediate: true })
    // Location changes recreate the pin hosts (which carry the Start-edge
    // attr) — re-resolve all location-dependent chrome.
    reconcileChromeLocations()
  },
}

/**
 * Top/Bottom dual-drawer split (`CanvasSettings.horizontalSplit`). The
 * boundary drag persists on release; this apply keeps external setting
 * changes (settings.json edits, future UI controls) in sync with the
 * `--sidebar-ux-hsplit` CSS var. Geometry/presence passes stay in
 * `drawerLocationFeature` + `drawer-location.reconcileDrawerLocation`.
 */
const horizontalSplitFeature: CanvasFeature = {
  id: 'horizontalSplit',
  apply() {
    syncHorizontalSplit()
  },
}

/** Tab list position: moves the column of tab buttons to the screen-edge
 *  side of the secondary sidebar when enabled. No mount needed — the
 *  effect is applied by createSecondarySidebar / mountSecondarySidebar /
 *  mountResizeHandles at construction time, and re-applied on toggle
 *  flip via apply(). */
const tabPositionFeature: CanvasFeature = {
  id: 'moveControlsToOuterEdge',
  init() {
    // Apply once at boot so the main sidebar gets its initial
    // flex-direction/border even when the secondary is disabled.
    applyTabListPosition(getSettings().moveControlsToOuterEdge)
  },
  apply(prev, next) {
    if (prev.moveControlsToOuterEdge === next.moveControlsToOuterEdge) return
    // The taskbar feature handles pair changes when its own field changed;
    // OS changes use the nested sync inside the serialized OS transition.
    if (prev.taskbarMode === next.taskbarMode && prev.osMode === next.osMode
        && isTaskbarModeEnabled(prev) !== isTaskbarModeEnabled(next)) {
      trackModeRevealWork(syncOsMobileDrawerMode().catch((err) => dwarn('[taskbar] mobile drawer sync failed:', err)))
    }
    // S8: a location flip auto-enables outer-edge in the same diff — stand
    // down; drawerLocationFeature.reconcileDrawerLocation owns that pass.
    if (prev.drawerLocation !== next.drawerLocation) return
    applyTabListPosition(next.moveControlsToOuterEdge)
    // S1 gate inversion: outer-edge is an input to the taskbar-chrome gate
    // (isTaskbarModeEnabled = taskbarMode && outer-edge). The taskbarMode
    // setting itself did not change, so the taskbar feature's apply() won't
    // fire — re-apply pin state + reflow here.
    reconcileTabListPin()
    reconcileMainTabListPin()
    updateChatReflow()
  },
}

/** Main-drawer ownership + taskbar chrome.
 *
 * S1 ("Canvas owns the drawers"): the main mirror IS the main drawer and is
 * ALWAYS mounted on desktop when Canvas is enabled — `taskbarMode` no longer
 * gates ownership (the host main drawer is hidden and never used on desktop).
 * `taskbarMode` (+ moveControlsToOuterEdge) now only controls the extra
 * taskbar CHROME: pinning the main/secondary tab strips to the screen edge,
 * strip gutters, hidden open/close buttons, and DnD. No-op on mobile (mirror
 * force-tears-down; host drawer remains the mobile surface until the mobile
 * task lands).
 *
 * User contract (2026-08-25):
 *   taskbarMode ON  → tabs pinned to screen edge, only panel slides.
 *   taskbarMode OFF → tabs ride with panel; the shell still owns the drawer.
 */
const taskbarModeFeature: CanvasFeature = {
  id: 'taskbarMode',
  // S1: mount unconditionally — the feature is the mount point for main
  // drawer ownership; the pin chrome is self-gated inside.
  unconditional: true,
  mount(_ctx, _layout) {
    // Secondary pin is chrome-gated; main mirror ownership is unconditional
    // but its PIN is chrome-gated.
    reconcileTabListPin()
    reconcileMainTabListPin()
    updateDrawerTabVisibility()
    updateStripGutters()
    // Recompute chat reflow (mirror open width / closed strip reserve).
    updateChatReflow()
    return () => {
      applyTabListPin(false, { force: true })
      // Full main teardown on disable (applyMainTabListPin(false) only
      // unpins — the unconditional shell teardown in setup.ts also runs).
      teardownMainPin()
      updateDrawerTabVisibility()
      clearStripGutters()
      updateChatReflow()
    }
  },
  apply(prev, next) {
    // Register before the location-change stand-down: mobile mode switches
    // often change the edge and chrome together. Wait for the real layout
    // fold/restore before exposing the new strip. OS changes own this sync.
    if (prev.osMode === next.osMode && isTaskbarModeEnabled(prev) !== isTaskbarModeEnabled(next)) {
      trackModeRevealWork(syncOsMobileDrawerMode().catch((err) => dwarn('[taskbar] mobile drawer sync failed:', err)))
    }
    // S8: a location flip auto-enables taskbar chrome in the same diff —
    // stand down (no force remount); drawerLocationFeature reconciles.
    if (prev.drawerLocation !== next.drawerLocation) return
    const chrome = isTaskbarModeEnabled(next)
    // Main mirror PIN is taskbar chrome (tabs pinned vs riding with panel).
    // Ownership (drawer shell + host hide) is unconditional — applyMainTabListPin
    // keeps the shell when chrome is off and only tears down the pin.
    // S8: no {force:true} on the apply path — a chrome toggle must not
    // remount the shell (auto-enable already avoids it via stand-down).
    applyMainTabListPin(chrome)
    // Secondary edge-strip pin + gutters are also taskbar chrome.
    applyTabListPin(chrome)
    updateDrawerTabVisibility()
    if (chrome) {
      updateStripGutters()
    } else {
      clearStripGutters()
    }
    updateChatReflow()
  },
}

/** Hide drawer open/close buttons: requires taskbar mode (normalize cascade).
 *  Updates both secondary and main mirror drawer-tab visibility on mount
 *  and on every settings change. */
const hideDrawerOpenCloseButtonsFeature: CanvasFeature = {
  id: 'hideDrawerOpenCloseButtons',
  mount() {
    updateDrawerTabVisibility()
    updateMainMirrorDrawerTabVisibility()
    return () => {
      updateDrawerTabVisibility()
      updateMainMirrorDrawerTabVisibility()
    }
  },
  apply() {
    updateDrawerTabVisibility()
    updateMainMirrorDrawerTabVisibility()
  },
}

/** Long-press drag-and-drop reorder/move on drawer tab buttons.
 *  Taskbar-agnostic (S7: toggle-only gate — the main shell is always mounted,
 *  so main-mirror is always the primary surface; ≤600px is a no-op).
 *  Commit still reorders host React buttons. */
const dragAndDropDrawerTabsFeature: CanvasFeature = {
  id: 'dragAndDropDrawerTabs',
  mount() {
    if (!isDragAndDropDrawerTabsEnabled()) return
    return installTabListDnd() ?? undefined
  },
  apply(_prev, next) {
    if (isDragAndDropDrawerTabsEnabled(next)) {
      // Off → on at runtime (mount skipped at boot). Register teardown so
      // extension disable still cleans up.
      const teardown = installTabListDnd()
      if (teardown) registerCleanup(teardown)
    } else {
      tearDownTabListDnd()
    }
  },
}

/** OS mode (2026-09-14, spec §4.8): registered AFTER the taskbar chrome
 *  features so its apply() runs downstream of the chrome it builds on.
 *  Layer scope so far: the enable/disable slot orchestration (seed on
 *  first enable, slot-wins non-OS restore on disable) + the panel-header
 *  chrome (minimize button injection + X→close-window interception).
 *  The Start menu mounts in a later step — this feature's hooks extend
 *  in place. */
const osModeFeature: CanvasFeature = {
  id: 'osMode',
  mount() {
    // Boot with osMode on: hydrate ran in setup; mount the chrome.
    if (!isOsModeEnabled()) return
    mountPanelChrome()
    mountStartMenu()
    return () => {
      teardownPanelChrome()
      teardownStartMenu()
    }
  },
  apply(prev, next) {
    if (prev.osMode !== next.osMode) {
      void applyOsModeChange(prev, next).catch((err) => {
        dwarn('[os] apply change failed:', err instanceof Error ? err.message : err)
      })
    }
    // Chrome follows the OS gate (both directions; idempotent).
    if (isOsModeEnabled(next)) {
      if (!isOsModeEnabled(prev)) {
        mountPanelChrome()
        mountStartMenu()
      }
    } else {
      teardownPanelChrome()
      teardownStartMenu()
    }
  },
}

/** CoreTabsHidden (M8): when the user turns `coreTabsHidden` off, any core
 *  built-in tab still in the model's hidden set would be stranded — with OS
 *  off the Configure eye re-locks (`hideLocked && !coreUnlocked`), so no UI
 *  path can un-hide it even though the copy claims core tabs stay visible.
 *  Sweep those keys back to visible as model intents.
 *
 *  Registered AFTER osModeFeature: the OS-off diff flips `osMode` and
 *  `coreTabsHidden` in one setSettings, and feature apply order is FEATURES
 *  order. `applyOsModeChange` is fire-and-forget async, but the frozen
 *  non-OS slots cannot contain core-hidden ids, so the sweep is safe
 *  regardless of which half lands first. */
const coreTabsHiddenFeature: CanvasFeature = {
  id: 'coreTabsHidden',
  apply(prev, next) {
    if (!prev.coreTabsHidden || next.coreTabsHidden) return
    const model = getModel()
    if (!model || model.hidden.length === 0) return
    // Same resolution as os/actions.ts shouldHideOnClose: model keys may
    // carry live-id suffix drift, so map through parseBuiltinKey before the
    // core-set check — never string-match raw model keys.
    const stranded = model.hidden.filter((key) => {
      const coreId = parseBuiltinKey(key)
      return !!coreId && isCoreTabId(coreId)
    })
    if (stranded.length === 0) return
    void dispatchBatch(
      stranded.map((key) => ({ t: 'setHidden' as const, key, hidden: false })),
    )
      .then(() => {
        // Keep an open Configure modal consistent with the sweep — the eye
        // renders from live state. Dynamic import avoids the state cycle
        // (configure-modal -> settings/state -> panel -> registry).
        void import('../tabs/configure-modal')
          .then((m) => {
            if (m.isConfigureTabsModalOpen()) m.refreshConfigureDraftFromLive()
          })
          .catch(() => { /* modal module may not be loaded */ })
      })
      .catch(() => { /* dispatch reports its own failures */ })
  },
}

/** Chrome locations (settings overhaul 2026-09-19): options/Start gear
 *  placement + the Top/Bottom Start-edge anchor.
 *
 *  All three features are `unconditional`: their defaults include falsy values
 *  (`null`, and the `startButtonAlwaysOnScreenEdge:false` case), so the
 *  orchestrator's truthiness gate would skip the boot reconcile exactly when
 *  chrome must be shown/hidden/stamped. Each mount/apply funnels into the one
 *  idempotent `reconcileChromeLocations` (os/chrome-locations.ts), which is
 *  also called from every shell/side lifecycle event.
 *
 *  `applySettings` keys on `feature.id`, so each new setting needs its own
 *  feature entry even though the work is shared. */
const optionsButtonLocationFeature: CanvasFeature = {
  id: 'optionsButtonLocation',
  unconditional: true,
  mount() {
    // activate (not reconcile): clears the teardown tombstone on a
    // disable → enable cycle (L7 2026-09-19).
    activateChromeLocations()
    return () => teardownChromeLocations()
  },
  apply() {
    reconcileChromeLocations()
  },
}

/** OS Start button location (literal sides; defaults to main-drawer only).
 *  Registered after osModeFeature (chrome exists only while OS mode is on). */
const startButtonLocationFeature: CanvasFeature = {
  id: 'startButtonLocation',
  unconditional: true,
  mount() {
    activateChromeLocations()
  },
  apply() {
    applyStartButtonLocationChange()
  },
}

/** Top/Bottom only: anchor Start at the outer strip end (default) vs the
 *  tab-facing side. The pin hosts carry the attr; CSS owns the order. */
const startButtonAlwaysOnScreenEdgeFeature: CanvasFeature = {
  id: 'startButtonAlwaysOnScreenEdge',
  unconditional: true,
  mount() {
    activateChromeLocations()
  },
  apply() {
    reconcileChromeLocations()
  },
}

/** Sides only: lift the Start button to the top of the vertical tab strip
 *  (default off = the shared bottom dock). The root class carries the CSS
 *  variant; ensureStartButtonForSide owns the DOM move. Unconditional like
 *  the other chrome-location features (default false would be skipped by
 *  setup's truthiness gate). */
const startButtonAtStripTopFeature: CanvasFeature = {
  id: 'startButtonAtStripTop',
  unconditional: true,
  mount() {
    activateChromeLocations()
  },
  apply() {
    reconcileChromeLocations()
  },
}

/** OS panel-header controls (default on): "- minimizes, X closes" vs the
 *  vanilla single X that minimizes. OS chrome only — the feature id must stay
 *  distinct (`applySettings` keys on `feature.id`, so `osModeFeature` never
 *  sees this diff). Live-apply just re-runs the chrome pass; the X branch
 *  reads the setting at click time. */
const osWindowControlsFeature: CanvasFeature = {
  id: 'osWindowControls',
  apply(prev, next) {
    if (prev.osWindowControls === next.osWindowControls) return
    applyOsWindowControlsChange()
  },
}

// --- Registry ---

export const FEATURES: readonly CanvasFeature[] = [
  unhideVanillaTabsFeature,
  debugFeature,
  chatReflowFeature,
  welcomeReflowFeature,
  secondSidebarFeature,
  resizeSidebarsFeature,
  drawerSyncFeature,
  shadowsDesktopFeature,
  shadowsMobileFeature,
  persistDrawerOpenStateFeature,
  persistDrawerWidthFeature,
  slashFeature,
  // S8: location presentation must run before any pin chrome in the same diff
  // (html classes + strip var + HORIZONTAL_STRIP_CSS), and it reconciles the
  // whole strip geometry on a location change.
  drawerLocationFeature,
  horizontalSplitFeature,
  tabPositionFeature,
  taskbarModeFeature,
  hideDrawerOpenCloseButtonsFeature,
  // OS mode depends on the taskbar chrome being applied first (§4.8).
  osModeFeature,
  // M8: coreTabsHidden must apply AFTER osModeFeature (OS-off flips both
  // settings in one diff; feature apply order is FEATURES order).
  coreTabsHiddenFeature,
  // Chrome locations: downstream of the OS mount pipeline (Start chrome) and
  // the drawer-location geometry pass. Unconditional — see feature docs.
  startButtonLocationFeature,
  optionsButtonLocationFeature,
  startButtonAlwaysOnScreenEdgeFeature,
  startButtonAtStripTopFeature,
  // OS header controls: same downstream placement (chrome pass only).
  osWindowControlsFeature,
  dragAndDropDrawerTabsFeature,
  drawerTabDragFeature,
]

/** Unconditional cleanup registrations that fire on extension disable
 *  regardless of toggle state. setup.ts adds each to its cleanup chain
 *  before loadSavedLayout resolves. */
export function alwaysCleanups(): Teardown[] {
  return [
    unmountToastSurface,
    slashAlwaysCleanup,
    // Outer-edge writes inline flex/borders on the HOST drawer elements;
    // without this reset a disable while outer-edge was on left the vanilla
    // tab strip flipped to the outer edge (2026-09-12 teardown report).
    clearTabListPosition,
    // S8: location classes/var + shell edge offsets must reset even when the
    // drawer-location feature never mounted. Idempotent (also in the feature
    // teardown) — runs before feature teardowns in the FIFO chain.
    clearDrawerLocation,
  ]
}
