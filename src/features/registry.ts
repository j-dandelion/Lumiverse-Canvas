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
import { applyOsModeChange } from '../os/os-mode'
import { mountPanelChrome, teardownPanelChrome } from '../os/panel-chrome'
import { mountStartMenu, teardownStartMenu } from '../os/start-menu'
import { installDebugEscapeHatch } from '../debug/fiber-scan'
import { injectReflowStyles, startReflowObserver, updateChatReflow, clearChatMargins } from '../chat/reflow'
import { registerCleanup } from '../sidebar/cleanup'
import { getMainDrawer } from '../dom/lumiverse'
import { injectStyles } from '../debug/styles'
import { mountSecondarySidebar, tearDownSecondarySidebar, getSecondaryWrapper } from '../sidebar/secondary'
import { mountResizeHandles, refreshResizeHandles } from '../resize/handles'
import { syncDrawerTabSettings } from '../sidebar/drawer-sync'
import { cancelLayoutSave } from '../persist/layout-load'
import { attachSlashRuntime } from '../slash/runtime'
import { unmountToastSurface } from '../slash/toast'
import { applyTabListPosition, applyTabListPin, clearTabListPosition, reconcileTabListPin } from '../sidebar/tab-position'
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
      // On → off: remove the injected CSS and reset chat margins.
      // The observer stays attached but its CSS rule is gone, so
      // subsequent scheduleReflow calls have no visual effect.
      // We don't disconnect the observer — the cleanup chain handles
      // that on extension disable.
      document.getElementById('sidebar-ux-reflow')?.remove()
      clearChatMargins()
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
    // Authoritative pass for the diff (sync + coalesced).
    reconcileDrawerLocation({ force: true })
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

// --- Registry ---

export const FEATURES: readonly CanvasFeature[] = [
  debugFeature,
  chatReflowFeature,
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
  tabPositionFeature,
  taskbarModeFeature,
  hideDrawerOpenCloseButtonsFeature,
  // OS mode depends on the taskbar chrome being applied first (§4.8).
  osModeFeature,
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
