// Secondary sidebar — the mirror of Lumiverse's main drawer, anchored to
// the opposite edge. Hosts the moved extension tab roots + their
// per-tab buttons.
//
// Animation: a single `translateX` on the wrapper; both the drawerTab
// and the drawer are children, so they move as one unit. The wrapper
// animates with requestAnimationFrame + easeOutCubic (350ms); no CSS
// transitions, no counter-translate.
//
// Direction-aware: when the main drawer is on the LEFT, the secondary
// is anchored at `right: 0` (close transform is +width). When the main
// is on the RIGHT, the secondary is anchored at `left: 0` (close
// transform is -width). getClosedTransformPx() centralizes this.
import { getMainSidebar, getMainPanelContent } from '../dom/lumiverse'
import { getHostBridge } from '../dom/host-bridge'
import { getDrawerTabs, getMainDrawerSide } from '../store'
import { updateChatReflow } from '../chat/reflow'
// NOTE: drawer-sync.ts imports from this module (bidirectional). Both modules
// only call each other from inside function bodies — never at module init time.
// Keep it that way to avoid initialization races.
import { syncDrawerTabSettings } from './drawer-sync'
import { mountResizeHandles } from '../resize/handles'
import { isTabActiveInMainDrawer, clearTabAssignments, getTabAssignments } from '../tabs/assignment'
import { showMainTabButton, findSafeFallbackButton, updateDrawerTabVisibility } from '../tabs/buttons'
import { requestHostTabToMain } from '../tabs/host-tab-location'
import { restoreDomPlacedBuiltInToMain } from '../tabs/dom-placed-builtin'
import { isMobileViewport, enforceExclusionOnOpen, setMobileOpenClass } from './mobile-exclusion'
import { animateWrapper } from './animation'
import { SECONDARY_WIDTH_VAR } from './styles'
import {
  applyTabListPin,
  applyTabListPosition,
  getPinnedTabList,
  reconcileTabListPin,
} from './tab-position'
import { getSettings } from '../settings/state'
import { dlog, dwarn } from '../debug/log'
import { liveIdForKey } from '../tabs/identity'
import type { TabKey } from '../core/model'
import { drawerObserver } from './drawer-observer'
import { syncPanelHeaderFromMain as _syncPanelHeaderImpl, stopPanelHeaderObservers as _stopPanelHeaderObservers, resetPanelHeaderSyncCache } from './panel-header-sync'
import { setSuppressAutoActivation, markDrawerOpenState } from './secondary-drawer'
import { setActiveSecondaryTabId } from '../tabs/active-tab'
import {
  closedTransformPx,
  createDrawerShell,
  readWidthCssVar,
} from './drawer-shell'

// Re-export for backward compatibility — the test file imports these
// from secondary.tsx.
export { _stopPanelHeaderObservers as stopPanelHeaderObservers }

/**
 * Wrapper that passes the secondary wrapper accessor to the panel-header
 * sync module. Preserves the public API so callers don't need to change.
 */
export function syncPanelHeaderFromMain(): void {
  _syncPanelHeaderImpl(() => _secondaryWrapper)
}

// Re-export for backward compatibility
export { SECONDARY_WIDTH_VAR, injectDrawerTabStyles } from './styles'
export { animateWrapper } from './animation'

// Standalone Puzzle icon SVG (lucide-react fallback for extensions without icons)
export const PUZZLE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"/></svg>`

let _secondarySidebarOpen = false
let _secondaryWrapper: HTMLElement | null = null
let _secondaryDrawer: HTMLElement | null = null

// Cross-drawer panel-header sync state. Mirrors the same coalescing/cache
// pattern used in sidebar/drawer-sync.ts for the main drawer's tab button.
// The main drawer's panel header is owned by Lumiverse (its class is
// hashed in production builds, e.g. "_panelHeader_abc123") — we read its
// rendered height, padding, title font-size, border, and background, and
// expose them as CSS variables on the secondary wrapper. The secondary
// header's inline `style.cssText` references these variables, falling
// back to the 48px / 12px / 15px defaults when the main header is not
// yet mounted.

// Accessors used by other modules (resize/handles, sidebar/drawer-sync,
// tabs/buttons, context-menu, layout/persist). All read; setSecondarySidebarOpen
// and unmountSecondarySidebar mutate.
export function getSecondaryWrapper(): HTMLElement | null { return _secondaryWrapper }
export function getSecondaryDrawer(): HTMLElement | null {
  return _secondaryWrapper?.querySelector('.sidebar-ux-drawer') as HTMLElement | null
}

export function getSecondaryTabList(): HTMLElement | null {
  if (!_secondaryWrapper) return null
  // 1) In-wrapper list wins when present — covers unpinned layout and the
  //    remount window where a fresh empty list sits in the drawer while an
  //    orphan may still linger on the pin host (pin will reparent + drop
  //    orphans).
  const inWrapper = _secondaryWrapper.querySelector('.sidebar-ux-tab-list') as HTMLElement | null
  if (inWrapper) return inWrapper
  // 2) Module-owned pin list (not document.querySelector first-match, which
  //    returns a stale orphan when dual lists exist under the host).
  return getPinnedTabList()
}

export function getSecondaryPanel(): HTMLElement | null {
  return _secondaryWrapper?.querySelector('.sidebar-ux-panel') as HTMLElement | null
}

/** Test-only: set the cached secondary wrapper so getters can return non-null in unit tests. */
export function __setSecondaryWrapperForTest(wrapper: HTMLElement | null): void {
  _secondaryWrapper = wrapper
}

export function isSecondarySidebarOpen(): boolean { return _secondarySidebarOpen }
export function setSecondarySidebarOpen(open: boolean): void { _secondarySidebarOpen = open }
// Consolidates the "remove + null + open=false" pattern used by
// tearDownSecondarySidebar, checkSideChanged, and cleanupAll.
export function unmountSecondarySidebar(): void {
  // Unpin first so a reparented tab list is restored (or cleaned) before
  // the wrapper is removed — otherwise the pin host keeps an orphan strip.
  applyTabListPin(false, { force: true })
  if (_secondaryWrapper) {
    _secondaryWrapper.remove()
    _secondaryWrapper = null
  }
  // Clear drawer cache too — a stale detached drawer made
  // openSecondarySidebar's `!_secondaryDrawer` check pass while the
  // wrapper was null (or the reverse after a partial teardown).
  _secondaryDrawer = null
  _secondarySidebarOpen = false
  // Drop the panel-header observers so a future remount rebuilds them
  // (the underlying main-drawer header may have been replaced too).
  // Safe to call when the observers were never attached.
  _stopPanelHeaderObservers()
  // Invalidate the value cache so the next remount does a real read
  // instead of skipping based on a stale serialized key.
  resetPanelHeaderSyncCache()
}

export function createSecondarySidebar(options?: { initialWidth?: number; initialOpen?: boolean }): HTMLElement {
  // Secondary anchors opposite the main drawer.
  const side = getMainDrawerSide() === 'left' ? 'right' : 'left'
  const onMobile = isMobileViewport()

  const shell = createDrawerShell({
    owner: 'secondary',
    side,
    widthCssVar: SECONDARY_WIDTH_VAR,
    defaultWidth: 420,
    initialWidth: options?.initialWidth,
    initialOpen: options?.initialOpen === true,
    fullViewportWidth: onMobile,
    title: 'Second drawer',
    drawerTabDisplay: 'none',
    onDrawerTabClick: () => {
      if (_secondarySidebarOpen) closeSecondarySidebar()
      else openSecondarySidebar()
    },
    onHeaderClose: () => closeSecondarySidebar(),
  })

  // Register the secondary drawer content area with Spindle so built-in
  // tabs can use requestTabLocation to move into this container.
  // System-level registration — not gated by extension permissions.
  // Unregister first on remount so a stale container entry cannot conflict
  // with the new shell content element (only when the API exists).
  try {
    const wSpindle = getHostBridge()
    const wContainers = wSpindle?.containers

    if (wContainers?.registerContainer) {
      try {
        wContainers.unregisterContainer?.('canvas-secondary-drawer')
      } catch {
        /* ignore — host may not have had a prior registration */
      }
      wContainers.registerContainer({
        id: 'canvas-secondary-drawer',
        side,
        element: shell.content,
      })
    } else {
      dwarn(
        `[tabmove] createSecondarySidebar: registerContainer SKIPPED — ` +
        `host bridge containers.registerContainer not available ` +
        `(setup ctx / window.spindle missing). Built-in tab moves will ` +
        `silently fail (ContainerTabContent Pass 3 resets to main-drawer).`
      )
    }
  } catch (err) {
    dwarn(`[tabmove] createSecondarySidebar: registerContainer THREW:`, err)
  }

  _secondaryDrawer = shell.drawer
  return shell.wrapper
}

/**
 * Remove document secondary wrappers that are not the module-owned one.
 * Rapid remount / incomplete teardown can leave orphan shells stacked on
 * the same edge. Mirrors sweepStrayPinHosts in tab-position.ts.
 */
function sweepOrphanSecondaryWrappers(): void {
  if (typeof document === 'undefined' || !document.querySelectorAll) return
  const all = document.querySelectorAll('.sidebar-ux-secondary-wrapper')
  for (const el of Array.from(all)) {
    if (el !== _secondaryWrapper) {
      try {
        el.remove()
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Resolve a facade TabKey to the live drawer tab id that the placement
 * functions expect. The assignment facade is TabKey-keyed ('builtin:loom',
 * 'ext:foo/Bar'); assignToSecondary/unassignFromSecondary work on liveIds.
 * Passing a TabKey made every restored secondary tab fail with "not found
 * in DrawerObserver or store" (2026-07-31 — restore placement was broken).
 *
 * Body delegated to tabs/identity.liveIdForKey (the single resolver).
 */
export function liveIdForFacadeKey(
  key: string,
  tabs: { tabId: string; extensionId: string; title: string }[],
): string | null {
  return liveIdForKey(key as TabKey, tabs.map((t) => ({
    id: t.tabId,
    extensionId: t.extensionId,
    title: t.title,
  })))
}

/**
 * Re-attach every model-assigned secondary tab to the secondary shell
 * (button + root reparent). Idempotent — assignToSecondary early-returns
 * for already-placed tabs.
 *
 * Runs when the drawer opens, and also when it is ALREADY open: with the
 * drawer open at boot, openSecondarySidebar bails before the loop and
 * restored tabs stay visible in the main drawer until the first move
 * (2026-07-31). The bootstrap path calls this with openOnClosed:false so a
 * closed drawer is never force-opened.
 *
 * The loop suppresses auto-activation (deferActivation), so no tab content
 * is displayed during placement. When the drawer is open and nothing is
 * active afterwards, the preferred tab (activateKey — the layout's
 * persisted active.secondary) or the first placed tab is shown — otherwise
 * the drawer stays empty until a click.
 */
/**
 * Pure guard for reassignSecondaryTabsFromModel: are all model-secondary
 * tabs already placed in the secondary list? A key whose live id cannot be
 * resolved (extension keys with no matching live tab) counts as placed — it
 * cannot be placed either. Builtin keys always parse to a bare id, so a
 * missing builtin button fails the guard (the loop runs and no-ops per
 * tab). Redundant reassign calls — bootstrapFromLayout plus
 * openSecondarySidebar's BAIL and opening paths run back-to-back at boot —
 * become cheap no-ops instead of re-running every placement. Buttons and
 * roots live in the same wrapper, so a list holding every button implies
 * nothing needs re-attaching; a re-created wrapper has neither and fails
 * the guard (recovery preserved).
 */
export function secondaryTabsAllPlaced(
  modelSecondaryKeys: readonly string[],
  tabs: { tabId: string; extensionId: string; title: string }[],
  listIds: readonly string[],
): boolean {
  const present = new Set(listIds)
  return modelSecondaryKeys.every((key) => {
    const liveId = liveIdForFacadeKey(key, tabs)
    return liveId === null || present.has(liveId)
  })
}

export function reassignSecondaryTabsFromModel(opts?: {
  openOnClosed?: boolean
  setActiveWhenReady?: boolean
  /** Preferred tab to show after placement (model TabKey, e.g. the layout's active.secondary). */
  activateKey?: string | null
}): void {
  import('../sidebar/secondary-drawer').then(
    async ({ assignToSecondary, activateSecondaryTab, getActiveSecondaryTab }) => {
      setSuppressAutoActivation(true)
      const tabs = drawerObserver.getAllTabs()

      // Idempotency guard (2026-07-31): several callers run this loop
      // back-to-back at boot (bootstrapFromLayout + openSecondarySidebar
      // BAIL/opening paths). Skip the placement loop when every
      // model-secondary tab already has a live button in the list — but
      // STILL run the activation tail when the drawer is open with no
      // active tab (a skipped redundant call must not leave the v1.8.0.22
      // empty-content state behind).
      const modelSecondaryKeys = Array.from(getTabAssignments())
        .filter(([, side]) => side === 'secondary')
        .map(([key]) => key)
      const listIds = getSecondaryTabList()
        ? Array.from(getSecondaryTabList()!.querySelectorAll('button[data-tab-id]'))
            .map((el) => el.getAttribute('data-tab-id'))
            .filter((id): id is string => !!id)
        : []
      if (secondaryTabsAllPlaced(modelSecondaryKeys, tabs, listIds)) {
        dlog(`[secondary] open loop: all ${modelSecondaryKeys.length} secondary tabs already placed; skipping`)
        if (isSecondarySidebarOpen() && !getActiveSecondaryTab() && listIds.length > 0) {
          const preferred = opts?.activateKey ? liveIdForFacadeKey(opts.activateKey, tabs) : null
          const target = preferred && listIds.includes(preferred) ? preferred : listIds[0]!
          dlog(`[secondary] open loop: showing "${target}" (placed, no active)`)
          setActiveSecondaryTabId(target)
          activateSecondaryTab(target)
        }
        setSuppressAutoActivation(false)
        return
      }

      const placed: string[] = []
      const promises = Array.from(getTabAssignments())
        .filter(([, side]) => side === 'secondary')
        .map(async ([tabKey]) => {
          // The facade is TabKey-keyed; placement functions need liveIds.
          const liveId = liveIdForFacadeKey(tabKey, tabs)
          if (!liveId) {
            dlog(`[secondary] open loop: no live tab for facade key "${tabKey}"`)
            return
          }
          const ok = await assignToSecondary(liveId, opts)
            .then(() => true)
            .catch(() => false)
          if (ok) placed.push(liveId)
        })
      await Promise.all(promises)
      setSuppressAutoActivation(false)

      // Content restore (2026-07-31): nothing was displayed above — the
      // finalize's showSecondaryTabDisplay is gated on !deferActivation.
      if (isSecondarySidebarOpen() && !getActiveSecondaryTab() && placed.length > 0) {
        const preferred = opts?.activateKey ? liveIdForFacadeKey(opts.activateKey, tabs) : null
        const target = preferred && placed.includes(preferred) ? preferred : placed[0]!
        dlog(`[secondary] open loop: showing "${target}"${preferred && preferred !== target ? ' (preferred missing)' : ''}`)
        setActiveSecondaryTabId(target)
        activateSecondaryTab(target)
      }
    },
  )
}

/**
 * Persist the secondary drawer's open state through the owned model.
 *
 * The secondary wrapper lives on document.body — OUTSIDE the host sidebar
 * subtree — so its open/close never fires the world-changed observers
 * (sidebar/mirror MutationObservers + DrawerObserver) that keep the model's
 * drawer state in sync for the main drawer. Without this explicit
 * setDrawer intent, model.drawers.secondary.open (and therefore
 * layout.json) never learns the drawer opened, and a hard refresh mounts
 * it closed again (2026-08-16). dispatch() no-ops when the dispatcher is
 * not bootstrapped, and the reducer is identity-preserving for no-op
 * setDrawers (host.setDrawer restore echo), so this is safe on every path.
 */
export function persistSecondaryDrawerOpen(open: boolean): void {
  void import('../recon/dispatch').then((m) => {
    m.dispatch({ t: 'setDrawer', side: 'secondary', open }).catch((err: unknown) => {
      dwarn('[secondary] persist secondary open state failed:', err)
    })
  })
}

export function openSecondarySidebar() {
  dlog('[secondary] openSecondarySidebar:enter', {
    shellLive: isSecondaryShellLive(),
    drawerConnected: !!_secondaryDrawer?.isConnected,
    alreadyOpen: _secondarySidebarOpen,
    hasWrapper: !!_secondaryWrapper,
    enabled: getSettings().secondSidebarEnabled,
  })
  // Heal detached shell before open so rClick/Configure moves cannot
  // "succeed" against a ghost node (translateX on a removed element).
  if (!isSecondaryShellLive() || !_secondaryDrawer?.isConnected) {
    if (getSettings().secondSidebarEnabled) {
      ensureSecondaryShellMounted({ initialOpen: false })
    }
  }
  if (!isSecondaryShellLive() || !_secondaryDrawer?.isConnected) {
    dlog('[secondary] openSecondarySidebar:BAIL shell-not-live', {
      shellLive: isSecondaryShellLive(),
      drawerConnected: !!_secondaryDrawer?.isConnected,
    })
    return
  }
  if (_secondarySidebarOpen) {
    dlog('[secondary] openSecondarySidebar:BAIL already-open')
    // Still re-attach restored tabs — with the drawer already open the open
    // path below never ran (2026-07-31: all tabs stayed in the main drawer
    // until the first move).
    reassignSecondaryTabsFromModel()
    return
  }
  const wrapper = _secondaryWrapper
  if (!wrapper) {
    dlog('[secondary] openSecondarySidebar:BAIL no-wrapper')
    return
  }
  dlog('[secondary] openSecondarySidebar:opening', { mobile: isMobileViewport() })
  // On mobile, close the other sidebar first
  enforceExclusionOnOpen('secondary')
  // Animate wrapper to translateX(0) — both drawerTab and drawer slide in as one unit
  animateWrapper(wrapper, 0)
  _secondarySidebarOpen = true
  wrapper.dataset.drawerOpen = 'true'
  markDrawerOpenState(true)
  syncDrawerTabSettings()
  updateDrawerTabVisibility()
  // Re-sync the panel header in case the main header changed since the
  // secondary was last open (e.g. user toggled compact mode in Lumiverse
  // settings while the secondary was closed). The ResizeObserver attached
  // by syncPanelHeaderFromMain also catches this, but observers don't
  // fire while the main panel is hidden via display:none, so an explicit
  // call here guarantees the secondary matches on the very next open.
  syncPanelHeaderFromMain()
  updateChatReflow()
  // Re-attach any moved tab roots to the (possibly fresh) wrapper.
  // assignToSecondary is idempotent — for a tab already in the wrapper
  // it hits the early-guard and just refreshes button + active state.
  // Suppress auto-activation during the re-assignment loop so that if
  // the user clicked a tab button to open the drawer, their clicked
  // tab stays highlighted instead of being overwritten by the last
  // tab in the loop.
  reassignSecondaryTabsFromModel()
  // Persist the open state via the owned model (see persistSecondaryDrawerOpen).
  persistSecondaryDrawerOpen(true)
  setMobileOpenClass('secondary', true)
}

export function closeSecondarySidebar(options?: { silent?: boolean }): void {
  dlog('[secondary] closeSecondarySidebar', {
    silent: options?.silent,
    alreadyClosed: !_secondarySidebarOpen,
    caller: new Error('close callstack').stack?.split('\n').slice(1, 4).join(' | '),
  })
  if (!_secondaryWrapper || !_secondaryDrawer) return
  // Animate wrapper back to its closed transform — direction-aware via
  // getClosedTransformPx: secondary on the right closes at +width, on the
  // left at -width.
  animateWrapper(_secondaryWrapper!, getClosedTransformPx())
  _secondarySidebarOpen = false
  _secondaryWrapper.dataset.drawerOpen = 'false'
  markDrawerOpenState(false)
  syncDrawerTabSettings()
  updateDrawerTabVisibility()
  // Mirror the open-path sync: in case the main header changed while the
  // drawer is mid-close animation, the variables stay current. Cheap
  // (rAF-coalesced + cache-key skip), so calling on every close is fine.
  syncPanelHeaderFromMain()
  updateChatReflow()

  for (const [tabId, sidebar] of getTabAssignments()) {
    if (sidebar === 'secondary') {
      const tabs = getDrawerTabs()
      const tab = tabs.find(t => t.id === tabId)
      if (tab?.root) tab.root.removeAttribute('data-canvas-active')
    }
  }

  // Clear the active highlight from all tab buttons so no tab appears
  // selected while the drawer is closed. activeTabId is kept for reopen.
  // (Inline — buttons.ts imports closeSecondarySidebar; avoid circular import.)
  const tabList = getSecondaryTabList()
  if (tabList) {
    for (const btn of tabList.querySelectorAll('button.sidebar-ux-tab-active')) {
      btn.classList.remove('sidebar-ux-tab-active')
    }
  }

  if (!options?.silent) {
    // Persist the closed state via the owned model (see persistSecondaryDrawerOpen).
    // silent closes (teardown / exclusion) skip persistence.
    persistSecondaryDrawerOpen(false)
  }
  setMobileOpenClass('secondary', false)
}

/**
 * Return the wrapper's `translateX` value (in px) that fully hides the
 * secondary sidebar, accounting for which edge it's anchored to.
 *
 * The secondary wrapper is anchored to one edge of the viewport (the edge
 * opposite the main drawer). Closing the sidebar slides the wrapper off
 * its anchor edge so only the drawerTab remains visible. The sign of the
 * translation depends on which edge the wrapper is anchored to:
 *   - main on the LEFT, secondary on the RIGHT (anchored at `right: 0`)
 *     → close transform is +width (pushes wrapper right, off the right edge)
 *   - main on the RIGHT, secondary on the LEFT (anchored at `left: 0`)
 *     → close transform is -width (pushes wrapper left, off the left edge)
 *
 * Centralizing this in one helper avoids the sign-inversion bug that
 * recurred when the close transform was hardcoded at multiple call sites
 * (the open-source repo was developed with the main on the left, so
 * `+width` worked by accident for the dev case but flipped the wrong way
 * when the user moved the main to the right).
 */
export function getClosedTransformPx(): number {
  const secondarySide: 'left' | 'right' =
    getMainDrawerSide() === 'left' ? 'right' : 'left'
  // Prefer measured drawer width when available — the CSS var may lag
  // behind the actual rendered width after viewport or dimension changes
  // (especially on mobile where we use a host-aligned CSS var for width).
  const measured = getSecondaryDrawer()?.offsetWidth ?? 0
  const fromVar = Math.ceil(readWidthCssVar(SECONDARY_WIDTH_VAR, 420))
  const w = Math.max(measured, fromVar)
  return closedTransformPx(secondarySide, w)
}

/**
 * True when the module-owned secondary shell is in the live document.
 * A non-null but detached `_secondaryWrapper` (DOM purged without tearDown,
 * or partial unmount) is treated as missing so callers remount instead of
 * animating/querying a ghost node — which looks like "Move to second
 * drawer does nothing".
 */
export function isSecondaryShellLive(): boolean {
  return !!(_secondaryWrapper && _secondaryWrapper.isConnected)
}

/**
 * Ensure the secondary shell exists when the second drawer is enabled.
 * Heals a detached module ref and mounts if needed. Returns true when a
 * live wrapper is available for place/open/button work.
 */
export function ensureSecondaryShellMounted(options?: {
  initialWidth?: number
  initialOpen?: boolean
}): boolean {
  if (!getSettings().secondSidebarEnabled) return false
  if (isSecondaryShellLive()) return true
  // Drop stale refs so mountSecondarySidebar does not early-return on a
  // detached node (would leave getSecondaryWrapper non-null but invisible).
  if (_secondaryWrapper && !_secondaryWrapper.isConnected) {
    _secondaryWrapper = null
    _secondaryDrawer = null
    _secondarySidebarOpen = false
  }
  mountSecondarySidebar({
    initialWidth: options?.initialWidth,
    initialOpen: options?.initialOpen === true,
  })
  return isSecondaryShellLive()
}

export function mountSecondarySidebar(options?: { initialWidth?: number; initialOpen?: boolean }) {
  // Treat detached wrappers as absent — early-return only when live in DOM.
  if (_secondaryWrapper?.isConnected) return
  if (_secondaryWrapper && !_secondaryWrapper.isConnected) {
    _secondaryWrapper = null
    _secondaryDrawer = null
    _secondarySidebarOpen = false
  }
  _secondaryWrapper = createSecondarySidebar(options)
  document.body.appendChild(_secondaryWrapper)
  // Drop any orphan wrappers left by lost module state / failed unmount
  // before a prior remount (rapid side flips). Keep only module-owned.
  sweepOrphanSecondaryWrappers()
  applyTabListPosition(getSettings().moveControlsToOuterEdge, {
    drawer: _secondaryWrapper.querySelector('.sidebar-ux-drawer') as HTMLElement,
    tabList: _secondaryWrapper.querySelector('.sidebar-ux-tab-list') as HTMLElement,
    handle: _secondaryWrapper.querySelector('.sidebar-ux-resize-handle') as HTMLElement | null,
  })
  // Re-apply pin after construction/remount. Setting can stay true across a
  // side-change remount while the fresh DOM is unpinned.
  reconcileTabListPin()
  // Secondary list presence affects opposite-edge taskbar-mode strip gutter.
  void import('./strip-gutter').then((m) => m.updateStripGutters())
  // Phase 3: sync the in-flight state to the initial layout so a hard-refresh
  // with secondary open doesn't trip the "no transition needed" check inside
  // openSecondarySidebar() on the first user click.
  if (options?.initialOpen === true) {
    _secondarySidebarOpen = true
    // Keep the drawer state machine in sync — the mount-open path bypasses
    // openSecondarySidebar, so without this `_state` stays 'closed' while
    // the drawer is visibly open (seen in the 2026-07-31 finalize gate logs).
    markDrawerOpenState(true)
  } else {
    markDrawerOpenState(false)
  }
  syncDrawerTabSettings()
  // Initial panel-header sync: covers first mount and the side-flip
  // remount path in checkSideChanged. The ResizeObserver attached inside
  // syncPanelHeaderFromMain keeps the values current after this.
  syncPanelHeaderFromMain()
  // Mount the resize handles. The main handle is short-circuited by its
  // own querySelector check inside mountResizeHandles, so this is safe to
  // call from both the initial setup path (which already calls it once via
  // setup()) and from checkSideChanged()'s wrapper-remount path. Without
  // this, the secondary handle disappears for the rest of the session
  // whenever the wrapper is recreated (e.g. after a drawer-side flip).
  mountResizeHandles()
}

/**
 * Tear down the secondary sidebar wrapper, restoring every assigned tab to
 * the primary drawer first so we don't leak DOM nodes. Used by the master
 * toggle's "off" path. Does NOT touch the layout blob — that's a separate
 * decision (the user may flip the master back on and want the layout back).
 */
export function tearDownSecondarySidebar(): void {
  // Unpin first (same as unmountSecondarySidebar). While pinned the tab
  // list lives on a body-level host outside the wrapper — removing the
  // wrapper without unpin leaves an orphan strip that poisons remount
  // (dual lists; highlight / restore write to the wrong one).
  applyTabListPin(false, { force: true })

  if (_secondaryWrapper) {
    // If the main drawer is currently showing a tab that lives in the
    // secondary sidebar, switch to a built-in fallback first. Otherwise
    // the DOM node that was physically in the secondary sidebar won't
    // re-render React (it was never unmounted from the main drawer's
    // perspective).
    // Use findSafeFallbackButton so we never click the Lumiverse Settings
    // tab (which would open the Settings panel and leave a ghost panel
    // behind — same root cause as the move-to-secondary bug fixed in
    // tabs/assignment.ts).
    const sidebar = getMainSidebar()
    if (sidebar) {
      const fallbackBtn = findSafeFallbackButton(sidebar)
      if (fallbackBtn) {
        // Check if any secondary tab is currently active in the main drawer.
        for (const [tabId, side] of getTabAssignments()) {
          if (side === 'secondary' && isTabActiveInMainDrawer(tabId)) {
            fallbackBtn.click()
            break
          }
        }
      }
    }
    // Restore all secondary tabs to primary — just reposition the DOM
    // nodes back, don't activate them (the fallback above handles that).
    //
    // Bug fix (2026-06-19): for built-in tabs, also call
    // requestTabLocation({kind:'main-drawer'}) BEFORE removing the
    // secondary wrapper. Without this, Lumiverse's internal
    // `tabLocations` store still says the tab is in the
    // 'canvas-secondary-drawer' container. When the wrapper is removed,
    // the container is gone. When the user clicks the tab button,
    // ContainerTabContent checks tabLocations, sees the missing
    // container, and fails to render the content — the "tabs return to
    // main drawer but do not display their content when activated"
    // symptom reported on Canvas disable. Extension tabs are not
    // tracked in tabLocations (they use raw DOM reparenting), so they
    // don't need this call.
    const _wSpindleUi = getHostBridge()?.ui
    // The assignment facade is TabKey-keyed ('builtin:weaver'); every
    // DOM/bridge call below (getBuiltInTabRoot, data-canvas-moved lookup,
    // requestHostTabToMain, showMainTabButton) works on LIVE ids
    // ('weaver'). Convert each key once at the loop head — without this
    // every tab was classified non-built-in (the duplicate-root race the
    // host-owned skip guards against), the moved-root lookup missed, and
    // showMainTabButton flooded "no tab in store for id=builtin:..." while
    // leaving the button hidden (2026-08-17).
    const _liveTabs = getDrawerTabs().map((t) => ({
      tabId: t.id,
      extensionId: t.extensionId,
      title: t.title,
    }))
    for (const [assignedKey] of Array.from(getTabAssignments())) {
      const tabId = liveIdForFacadeKey(assignedKey, _liveTabs) ?? assignedKey
      // Built-in detection: the host bridge can lazy-resolve a root for
      // built-in tab IDs. Extension tab IDs return undefined.
      const _isBuiltIn = _wSpindleUi?.getBuiltInTabRoot?.(tabId) != null
      const _movedRoot = _secondaryWrapper?.querySelector(
        `.sidebar-ux-panel-content [data-canvas-moved="${CSS.escape(tabId)}"]:not([data-canvas-secondary])`
      ) as HTMLElement | null
      const _domPlaced = !!_movedRoot?.hasAttribute('data-canvas-dom-placed')

      if (_isBuiltIn) {
        // Prefer verified host reset (bridge + store.moveTabTo fallback).
        try {
          requestHostTabToMain(tabId)
        } catch (err) {
          if (_wSpindleUi?.requestTabLocation) {
            try {
              _wSpindleUi.requestTabLocation(tabId, { kind: 'main-drawer' })
            } catch (err2) {
              dwarn(`[tabmove] teardown: requestTabLocation failed for tabId=${tabId}:`, err2)
            }
          } else {
            dwarn(`[tabmove] teardown: requestHostTabToMain failed for tabId=${tabId}:`, err)
          }
        }
      }

      // Extension roots and DOM-placed non-CORE built-ins: Canvas owns the
      // node — DETACH it back to host ownership. The host re-attaches the
      // root into TabPanelContent's containerRef when the tab activates
      // (and ContainerTabContent Pass 3 heals stale tabLocations). Do NOT
      // append into main panelContent: that node is the node the main-mirror
      // parks in its shell, so orphan roots there render as stacked panels
      // inside the mirror — the "content stays on a previous tab" bug after
      // Configure → Enable second drawer OFF (2026-08-17). Host-owned CORE
      // roots skip this so React reconciliation is not raced (duplicate
      // stack bug).
      if (!_isBuiltIn || _domPlaced) {
        if (_domPlaced) {
          restoreDomPlacedBuiltInToMain(tabId, _movedRoot)
        } else {
          if (_movedRoot && _movedRoot.parentElement) {
            try {
              _movedRoot.parentElement.removeChild(_movedRoot)
            } catch {
              /* host may have removed it already */
            }
          }
          if (_movedRoot) {
            _movedRoot.removeAttribute('data-canvas-moved')
            _movedRoot.removeAttribute('data-canvas-active')
            _movedRoot.removeAttribute('data-canvas-dom-placed')
            _movedRoot.style.removeProperty('position')
            _movedRoot.style.removeProperty('inset')
            _movedRoot.style.removeProperty('display')
          }
        }
      }
      showMainTabButton(tabId)
    }
    // Unregister the container from the host bridge so re-enabling
    // (mount → registerContainer) doesn't conflict with a stale entry.
    try {
      const wContainers = getHostBridge()?.containers
      wContainers?.unregisterContainer?.('canvas-secondary-drawer')
    } catch (err) {
      dwarn('[tabmove] teardown: unregisterContainer failed:', err)
    }
    _secondaryWrapper.remove()
    _secondaryWrapper = null
  }
  _secondaryDrawer = null
  // Always clear assignments after the restore loop (or when the wrapper was
  // already null). Leaving stale secondary entries with no wrapper poisons
  // re-enable / side remount restore paths.
  clearTabAssignments()
  _secondarySidebarOpen = false
  setMobileOpenClass('secondary', false)
  // Clear stale chat margins left by the now-removed secondary drawer.
  updateChatReflow()
  // Opposite-edge strip gutter drops when secondary list is gone.
  void import('./strip-gutter').then((m) => m.updateStripGutters())
  // Main-mirror filters display:none host buttons and only rebuilds on its
  // own reconcile (observer does not watch style). Teardown unhides secondary
  // tabs via showMainTabButton — force pin strip to pick them up.
  void import('./main-tab-pin').then((m) => m.reconcileMainTabListPin()).catch((err) => {
    dwarn('[tabmove] teardown: reconcileMainTabListPin failed:', err)
  })
  // Drop any in-flight resize handle bound to the wrapper, so a re-mount
  // creates a fresh one.
  const handles = document.querySelectorAll('.sidebar-ux-resize-handle')
  for (const h of Array.from(handles)) {
    if (h.parentElement && h.parentElement.classList.contains('sidebar-ux-drawer')) {
      h.remove()
    }
  }
  // Disconnect the panel-header observers (tearDownSecondarySidebar is
  // used by the master "second drawer" toggle's off path; the observers
  // would otherwise leak across the on→off→on cycle).
  _stopPanelHeaderObservers()
  resetPanelHeaderSyncCache()
}
