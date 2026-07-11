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

import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import type { FullCanvasSettings } from '../settings/state'
import { getSettings, getLastLoadedLayout } from '../settings/state'
import { setDebug } from '../debug/log'
import { installDebugEscapeHatch } from '../debug/fiber-scan'
import { injectReflowStyles, startReflowObserver, updateChatReflow, clearChatMargins } from '../chat/reflow'
import { registerCleanup } from '../sidebar/cleanup'
import { getMainDrawer } from '../dom/lumiverse'
import { injectStyles } from '../debug/styles'
import { mountSecondarySidebar, tearDownSecondarySidebar, getSecondaryWrapper } from '../sidebar/secondary'
import { mountResizeHandles, refreshResizeHandles } from '../resize/handles'
import { syncDrawerTabSettings, syncSecondaryTabLabels } from '../sidebar/drawer-sync'
import { cancelLayoutSave } from '../layout/persist'
import { applyLayout, cancelApplyLayoutInterval } from '../layout/apply'
import { attachSlashRuntime } from '../slash/runtime'
import { unmountToastSurface } from '../slash/toast'
import { applyTabListPosition, applyTabListPin, reconcileTabListPin } from '../sidebar/tab-position'
import { applyMainTabListPin, reconcileMainTabListPin } from '../sidebar/main-tab-pin'
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
 *  Runtime re-apply re-uses the last loaded layout to restore tab assignments. */
const secondSidebarFeature: CanvasFeature = {
  id: 'secondSidebarEnabled',
  mount(_ctx, layout) {
    const s = getSettings()
    const initialWidth = s.persistDrawerWidth ? layout?.secondary?.width : undefined
    // Do not first-paint open when tab assignments will not be restored (empty drawer).
    const hasTabsToRestore =
      !!s.persistTabAssignments && (layout?.detachedTabs?.length ?? 0) > 0
    const initialOpen = !!(
      s.persistDrawerOpenState &&
      layout?.secondary?.open === true &&
      hasTabsToRestore
    )
    mountSecondarySidebar({ initialWidth, initialOpen })
    return tearDownSecondarySidebar
  },
  apply(prev, next) {
    if (prev.secondSidebarEnabled === next.secondSidebarEnabled) return
    if (next.secondSidebarEnabled) {
      if (!getSecondaryWrapper()) {
        const s = getSettings()
        const anyFacet = !!(s.persistDrawerOpenState || s.persistDrawerWidth || s.persistTabAssignments)
        const layout = anyFacet ? getLastLoadedLayout() : null
        const initialWidth = s.persistDrawerWidth ? layout?.secondary?.width : undefined
        const hasTabsToRestore =
          !!s.persistTabAssignments && (layout?.detachedTabs?.length ?? 0) > 0
        const initialOpen = !!(
          s.persistDrawerOpenState &&
          layout?.secondary?.open === true &&
          hasTabsToRestore
        )
        mountSecondarySidebar({ initialWidth, initialOpen })
        if (layout && anyFacet) applyLayout(layout)
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

/** Drawer-sync bundle: mirror compact position + tab-label visibility. Both
 *  toggles are owned by sidebar/drawer-sync.ts, so the feature id is the master
 *  (mirrorCompactPosition) and the showTabLabels hook rides along in
 *  apply(). The orchestrator still iterates by id, but the drawer-sync module
 *  is the single owner of both effects. */
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
    if (prev.showTabLabels !== next.showTabLabels) {
      syncSecondaryTabLabels()
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

/** Layout facet: cancel in-flight debounced save when a facet turns off so
 *  a queued mutation doesn't write live values for a disabled facet. */
function makeLayoutFacetFeature(
  id: 'persistDrawerOpenState' | 'persistDrawerWidth' | 'persistTabAssignments',
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
const persistTabAssignmentsFeature = makeLayoutFacetFeature('persistTabAssignments')

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
    applyTabListPosition(next.moveControlsToOuterEdge)
  },
}

/** Keep tab controls visible (requires moveControlsToOuterEdge):
 *  - Secondary: reparents Canvas-owned tab list onto a body-level pin host.
 *  - Main: Canvas-owned *mirror* strip (host React nodes stay put); clicks
 *    forward to host tab buttons. Hidden while main drawer is open.
 *  - Strip gutters: permanent Welcome/Landing bounds (strip width only);
 *    open drawers overlay Welcome. Chat margins stay with chat reflow.
 *  Secondary remount also calls reconcileTabListPin(); side-change calls
 *  reconcileMainTabListPin() (Canvas main shell + host hide + portal).
 *  No-op on mobile (force-unpins / tears down main mirror). */
const keepTabListVisibleFeature: CanvasFeature = {
  id: 'keepTabListVisible',
  mount(_ctx, _layout) {
    // mount() only runs when keepTabListVisible is truthy at setup, but still
    // require outer-edge (settings normalize + apply also enforce this).
    const on = !!getSettings().keepTabListVisible && !!getSettings().moveControlsToOuterEdge
    if (on) {
      reconcileTabListPin()
      reconcileMainTabListPin()
    } else {
      applyTabListPin(false, { force: true })
      applyMainTabListPin(false, { force: true })
    }
    updateDrawerTabVisibility()
    updateStripGutters()
    // Recompute chat reflow (mirror open width / closed strip reserve).
    updateChatReflow()
    return () => {
      applyTabListPin(false, { force: true })
      applyMainTabListPin(false, { force: true })
      updateDrawerTabVisibility()
      clearStripGutters()
      updateChatReflow()
    }
  },
  apply(_prev, next) {
    const on = !!next.keepTabListVisible && !!next.moveControlsToOuterEdge
    applyTabListPin(on, { force: true })
    applyMainTabListPin(on, { force: true })
    updateDrawerTabVisibility()
    if (on) {
      updateStripGutters()
    } else {
      clearStripGutters()
    }
    updateChatReflow()
  },
}

/** Hide drawer open/close buttons: independent of keep-tabs.
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
  persistTabAssignmentsFeature,
  slashFeature,
  tabPositionFeature,
  keepTabListVisibleFeature,
  hideDrawerOpenCloseButtonsFeature,
  drawerTabDragFeature,
]

/** Unconditional cleanup registrations that fire on extension disable
 *  regardless of toggle state. setup.ts adds each to its cleanup chain
 *  before loadSavedLayout resolves. */
export function alwaysCleanups(): Teardown[] {
  return [
    unmountToastSurface,
    cancelApplyLayoutInterval,
    slashAlwaysCleanup,
  ]
}
