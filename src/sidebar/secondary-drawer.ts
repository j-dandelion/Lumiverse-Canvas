// SecondaryDrawer: state machine for secondary drawer lifecycle.
//
// Manages tab assignment to the secondary, coordinates with DrawerObserver
// for DOM-based tab discovery, and owns the showSecondaryTab display-toggle
// path. Extension tabs are moved via DOM reparenting (appendChild) to
// preserve state; built-in tabs (Characters, History) use the display-toggle
// path directly.

import { drawerObserver, type ObservedTab } from './drawer-observer'
import {
  showSecondaryTab as showSecondaryTabDisplay,
  addSecondaryTabButton,
  removeSecondaryTabButton,
  findMainTabButton,
  hideMainTabButton,
  showMainTabButton,
  updateDrawerTabVisibility,
  readMainButtonShortName,
} from '../tabs/buttons'
import {
  getTabAssignments, setTabAssignment, deleteTabAssignment,
} from '../tabs/assignment'
import { getActiveSecondaryTabId, setActiveSecondaryTabId } from '../tabs/active-tab'
import { persistLayout } from '../layout/persist'
import { getSecondaryWrapper, openSecondarySidebar, isSecondarySidebarOpen, closeSecondarySidebar } from './secondary'
import { findStoreData, getDrawerTabs, type DrawerTab } from '../store'
import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import { dlog, dwarn } from '../debug/log'
import { getHostBridge } from '../dom/host-bridge'
import { isMobileViewport } from './mobile-exclusion'

export type SecondaryDrawerState = 'closed' | 'open' | 'tab_active'

let _state: SecondaryDrawerState = 'closed'
let _activeTabId: string | null = null

// Guard flag: when true, the onTabUnregistered handlers (in this file and
// in src/setup.ts) skip ALL their work — assignment deletion, button removal,
// layout persistence, active-tab reset, and auto-close. The layout restore
// flow can fire onTabUnregistered spuriously as Lumiverse re-renders the
// main sidebar (extensions finish loading, React re-commits the button
// tree, the wrapper's activateFn() flips state). Without this guard:
//   1. The composite id assignment is wiped mid-restore.
//   2. The MutationObserver-driven restore pass would re-run
//      assignToSecondary, racing with the restore's end-of-restore
//      block (which is the authoritative state-setter).
//   3. The auto-close would race with the restore's end-of-restore
//      block.
// The restore's end-of-restore block in src/layout/apply.ts is the
// authoritative state-setter during restore. setRestoringFromLayout(true)
// is called before the observer attaches; setRestoringFromLayout(false)
// is called when finishRestore() runs. After the flag is cleared, the
// handlers resume normal behavior for user-initiated move-back and
// extension uninstall.
let _restoringFromLayout = false
export function setRestoringFromLayout(value: boolean): void {
  _restoringFromLayout = value
}
export function isRestoringFromLayout(): boolean {
  return _restoringFromLayout
}

// Guard flag: when true, assignToSecondary skips the showSecondaryTabDisplay
// call at the end of its run. openSecondarySidebar fires a re-assignment
// loop that calls assignToSecondary for every assigned tab — each call
// currently calls showSecondaryTabDisplay(resolvedId), and the last one
// wins. When the user clicks a tab button while the drawer is closed, the
// click handler calls showSecondaryTab(clickedTabId) synchronously, but the
// async re-assignment loop then overwrites the highlight with the last tab
// in the list. Setting this flag during that loop prevents the overwrite.
let _suppressAutoActivation = false
export function setSuppressAutoActivation(value: boolean): void {
  _suppressAutoActivation = value
}
export function isSuppressAutoActivation(): boolean {
  return _suppressAutoActivation
}

/**
 * Resolve a tab in Lumiverse's Zustand store by id (canonical) or title
 * (fallback for when the context-menu's store lookup missed and the
 * tabId we received is actually the human-readable title). Force-walks
 * the fiber tree to bypass the 3s store cache, so callers always see
 * the current state.
 */
function findStoreTab(tabIdOrTitle: string): DrawerTab | null {
  findStoreData(true)
  const tabs = getDrawerTabs()
  return tabs.find((t) => t.id === tabIdOrTitle)
    || tabs.find((t) => t.title === tabIdOrTitle)
    || null
}

/**
 * Initialize the SecondaryDrawer state machine. Wires up DrawerObserver
 * handlers for tab unregistration cleanup.
 */
export function initSecondaryDrawer(_ctx: SpindleFrontendContext): void {
  // The ctx param is kept for API compatibility; the subsystem that
  // consumed it was deleted in the Phase 2 cleanup.
  void _ctx
  // Watch for tabs being unregistered — if we have an assignment, clean it up.
  // Note: setup.ts also registers an onTabUnregistered handler; this is the
  // SecondaryDrawer-specific one that also handles state machine transitions.
  drawerObserver.onTabUnregistered((tabId) => {
    if (getTabAssignments().has(tabId)) {
      // Skip ALL work during layout restore. The restore's end-of-interval
      // logic in src/layout/apply.ts is the authoritative state-setter; any
      // mutation here would race with it. See _restoringFromLayout comment
      // above for the full failure mode this prevents.
      if (_restoringFromLayout) return
      deleteTabAssignment(tabId)
      removeSecondaryTabButton(tabId)
      persistLayout()
      if (_activeTabId === tabId) {
        _activeTabId = null
        _state = getTabAssignments().size > 0 ? 'open' : 'closed'
        // Auto-close if the unregistered tab was the last one.
        // Same rationale as the unassignFromSecondary path above.
        if (_state === 'closed') {
          closeSecondarySidebar()
          updateDrawerTabVisibility()
        }
      }
    }
  })
}

/**
 * Shared post-placement finalize for assignToSecondary branches.
 * Consolidates setTabAssignment → hideMainTabButton → addSecondaryTabButton →
 * updateDrawerTabVisibility → (optional open) → header → showSecondaryTab →
 * persistLayout that used to be copy-pasted across extension/built-in paths.
 *
 * Extension path wires assignment *before* open (and may open first), then
 * calls this with `wireAssignment: false` and `openOnClosed: false`.
 * Built-in path places root first, then calls this with defaults.
 */
async function finalizeAssignToSecondary(opts: {
  resolvedId: string
  title: string
  root: HTMLElement
  iconSvg?: string
  shortName?: string
  deferActivation: boolean
  /** When true (default), setTabAssignment + hideMainTabButton. */
  wireAssignment?: boolean
  /**
   * When true (default), open secondary if closed (subject to mobile/restore).
   * Extension path opens earlier and passes false.
   */
  openOnClosed?: boolean
  /**
   * When true (default for extension semantics), set drawer active state when
   * !mobile && !defer even if already open. Built-in only sets active on open
   * (pass false); showSecondaryTab still runs via showActive.
   */
  setActiveWhenReady?: boolean
  /**
   * When true (default), paint showSecondaryTab + persistLayout.
   * Built-in early-return uses true; leave true for all current callers.
   */
  showAndPersist?: boolean
}): Promise<void> {
  const {
    resolvedId,
    title,
    root,
    iconSvg,
    shortName,
    deferActivation,
    wireAssignment = true,
    openOnClosed = true,
    setActiveWhenReady = true,
    showAndPersist = true,
  } = opts

  addSecondaryTabButton({
    id: resolvedId,
    title,
    root,
    iconSvg,
    shortName,
  })
  updateDrawerTabVisibility()

  if (wireAssignment) {
    setTabAssignment(resolvedId, 'secondary')
    hideMainTabButton(resolvedId)
  }

  if (
    openOnClosed
    && _state === 'closed'
    && !isSecondarySidebarOpen()
    && !isMobileViewport()
    && !isRestoringFromLayout()
  ) {
    await openSecondarySidebar()
    // Built-in: only promote to tab_active when not deferring.
    // Extension open path sets `_state = 'open'` earlier (openOnClosed false).
    if (!deferActivation) {
      _state = 'tab_active'
      _activeTabId = resolvedId
      setActiveSecondaryTabId(resolvedId)
    }
  } else if (setActiveWhenReady && !isMobileViewport() && !deferActivation) {
    _activeTabId = resolvedId
    _state = 'tab_active'
    setActiveSecondaryTabId(resolvedId)
  }

  const headerTitle = getSecondaryWrapper()?.querySelector('.sidebar-ux-panel-title')
  if (headerTitle && !deferActivation) {
    headerTitle.textContent = title
  }

  if (showAndPersist) {
    // showSecondaryTab applies sidebar-ux-tab-active; suppressed during restore
    // so finishRestore remains authoritative for the active tab.
    if (!isMobileViewport() && !deferActivation) {
      showSecondaryTabDisplay(resolvedId)
    }
    persistLayout()
  }
}

type AssignCtx = {
  tabId: string
  tab: ObservedTab
  resolvedId: string
  iconSvg?: string
  shortName?: string
  deferActivation: boolean
}

/**
 * Extension tabs: reparent store root via appendChild (preserves instance state).
 * Assignment is wired before open so a failed reparent still records secondary.
 */
async function assignExtensionTabToSecondary(ctx: AssignCtx): Promise<void> {
  const { tabId, tab, resolvedId, iconSvg, shortName, deferActivation } = ctx

  setTabAssignment(resolvedId, 'secondary')
  hideMainTabButton(resolvedId)
  // On mobile, do not auto-open during assign (would enforceExclusionOnOpen).
  // During layout restore, skip auto-open so finishRestore decides open state.
  if (_state === 'closed' && !isSecondarySidebarOpen() && !isMobileViewport() && !isRestoringFromLayout()) {
    await openSecondarySidebar()
    _state = 'open'
  }

  // Scope to secondary wrapper — shared class also exists on main-mirror.
  const secondaryContent =
    getSecondaryWrapper()?.querySelector('.sidebar-ux-panel-content') ?? null
  const bareId = resolvedId.includes(':')
    ? (resolvedId.replace(/:\d+$/, '').split(':').pop() ?? resolvedId)
    : resolvedId
  const existingRoot = (secondaryContent?.querySelector(
    `[data-canvas-moved="${CSS.escape(resolvedId)}"]`,
  ) ?? secondaryContent?.querySelector(
    `[data-canvas-moved="${CSS.escape(bareId)}"]`,
  )) as HTMLElement | null

  if (existingRoot) {
    const storeTabForButton = findStoreTab(resolvedId) || findStoreTab(tabId) || findStoreTab(tab.title)
    await finalizeAssignToSecondary({
      resolvedId,
      title: tab.title || storeTabForButton?.title || resolvedId,
      root: existingRoot,
      iconSvg: iconSvg
        || (tab.button as HTMLElement | undefined)?.querySelector('svg')?.outerHTML
        || storeTabForButton?.iconSvg,
      shortName: shortName || readMainButtonShortName(tab.button as Element) || storeTabForButton?.shortName,
      deferActivation,
      wireAssignment: false,
      openOnClosed: false,
      setActiveWhenReady: true,
    })
    return
  }

  // PRIMARY PATH: reparent the extension's primary DOM root into secondary.
  const secondaryWrapper = getSecondaryWrapper()
  const secondaryContentMain = secondaryWrapper?.querySelector('.sidebar-ux-panel-content')
  const storeTab = findStoreTab(resolvedId) || findStoreTab(tabId) || findStoreTab(tab.title)
  if (storeTab?.root && secondaryContentMain) {
    const root = storeTab.root
    if (root.parentElement !== secondaryContentMain) {
      secondaryContentMain.appendChild(root)
    }
    root.setAttribute('data-canvas-moved', resolvedId)
    // During restore / suppress, leave data-canvas-active alone so
    // finishRestore → showSecondaryTab is the sole content switcher.
    if (!deferActivation) {
      for (const child of Array.from(secondaryContentMain.children)) {
        if (child instanceof HTMLElement) {
          if (child === root) {
            child.setAttribute('data-canvas-active', '')
          } else {
            child.removeAttribute('data-canvas-active')
          }
        }
      }
    }
    await finalizeAssignToSecondary({
      resolvedId,
      title: tab.title || storeTab.title || resolvedId,
      root,
      iconSvg: (tab.button as HTMLElement | undefined)?.querySelector('svg')?.outerHTML || storeTab.iconSvg,
      shortName: readMainButtonShortName(tab.button as Element) || storeTab.shortName,
      deferActivation,
      wireAssignment: false,
      openOnClosed: false,
      setActiveWhenReady: true,
    })
    return
  }

  // Placement failed (no root) — still paint active/header/persist for assignment.
  if (!isMobileViewport() && !deferActivation) {
    _activeTabId = resolvedId
    _state = 'tab_active'
    setActiveSecondaryTabId(resolvedId)
  }
  const headerTitle = getSecondaryWrapper()?.querySelector('.sidebar-ux-panel-title')
  if (headerTitle && !deferActivation) {
    headerTitle.textContent = tab.title || resolvedId
  }
  if (!isMobileViewport() && !deferActivation) {
    showSecondaryTabDisplay(resolvedId)
  }
  persistLayout()
}

/**
 * Built-in tabs: host React-managed roots — place via requestTabLocation
 * (moveBuiltInTabToSecondaryContainer). Never raw-appendChild out of main
 * panelContent (main-mirror parks that node).
 */
async function assignBuiltInTabToSecondary(ctx: AssignCtx): Promise<void> {
  const { tabId, tab, resolvedId, deferActivation } = ctx
  const secondaryWrapper = getSecondaryWrapper()
  const secondaryContent = secondaryWrapper?.querySelector('.sidebar-ux-panel-content')
  const storeTab = findStoreTab(resolvedId) || findStoreTab(tabId) || findStoreTab(tab.title)
  const wSpindle = getHostBridge()
  const wSpindleUi = wSpindle?.ui
  dlog(
    `[canvas-debug] ASSIGN_SEC_BUILTIN_ENTER tab=${resolvedId} hasStoreTab=${!!storeTab} ` +
    `hasSecondaryContent=${!!secondaryContent}`,
  )

  // Early exit: already reparented — dual-id (bare vs composite tags).
  let alreadyInSecondary: HTMLElement | null = null
  if (secondaryContent) {
    const idsToTry = resolvedId !== tabId ? [resolvedId, tabId] : [resolvedId]
    for (const id of idsToTry) {
      alreadyInSecondary = secondaryContent.querySelector(
        `[data-canvas-moved="${CSS.escape(id)}"]`,
      ) as HTMLElement | null
      if (alreadyInSecondary) break
    }
  }
  if (alreadyInSecondary) {
    dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_EARLY_RETURN tab=${resolvedId} branch=ALREADY_IN_SECONDARY`)
    const title = wSpindleUi?.getBuiltInTabTitle?.(tabId) || tab.title || storeTab?.title || resolvedId
    await finalizeAssignToSecondary({
      resolvedId,
      title,
      root: alreadyInSecondary,
      iconSvg: tab.button?.querySelector('svg')?.outerHTML || alreadyInSecondary.querySelector('svg')?.outerHTML,
      shortName: readMainButtonShortName(tab.button as Element) || storeTab?.shortName,
      deferActivation,
      wireAssignment: true,
      openOnClosed: true,
      // Built-in: only set tab_active when we open; otherwise show path only.
      setActiveWhenReady: false,
    })
    return
  }

  if (!secondaryContent) {
    dwarn('[SecondaryDrawer] assignToSecondary: secondary content missing; cannot place built-in.', {
      tabId,
      resolvedId,
    })
    return
  }

  const bridgeRoot = wSpindleUi?.getBuiltInTabRoot?.(tabId) as HTMLElement | undefined
  dlog(
    `[canvas-debug] ASSIGN_SEC_BUILTIN_AFTER_DOM_LOOKUP tab=${resolvedId} ` +
    `rootFound=${!!bridgeRoot} rootTagId=${bridgeRoot?.getAttribute('data-tab-id') ?? 'null'} via=getBuiltInTabRoot`,
  )

  let root: HTMLElement | undefined
  let placedViaHost = false

  if (wSpindleUi?.getBuiltInTabRoot && wSpindleUi?.requestTabLocation) {
    const { moveBuiltInTabToSecondaryContainer } = await import('../tabs/builtin-move')
    root = await moveBuiltInTabToSecondaryContainer({
      tabId,
      deferActivation,
      root: bridgeRoot,
    })
    placedViaHost = !!root
  }

  if (!root && storeTab?.root) {
    root = storeTab.root
    if (root.parentElement !== secondaryContent) {
      secondaryContent.appendChild(root)
    }
    root.setAttribute('data-canvas-moved', resolvedId)
    dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_STORE_REPARENT tab=${resolvedId} branch=STORE_ROOT`)
  }

  if (!root) {
    if (!wSpindleUi?.getBuiltInTabRoot || !wSpindleUi?.requestTabLocation) {
      dwarn('[SecondaryDrawer] assignToSecondary: built-in tab cannot be auto-restored (host bridge missing, no store root).', {
        tabId,
        resolvedId,
      })
    }
    return
  }

  // During restore, leave data-canvas-active alone so finishRestore wins.
  if (!deferActivation) {
    for (const child of Array.from(secondaryContent.children)) {
      if (child instanceof HTMLElement) {
        if (child === root || child.getAttribute('data-canvas-moved') === resolvedId) {
          child.setAttribute('data-canvas-active', '')
        } else if (child.hasAttribute('data-canvas-moved')) {
          child.removeAttribute('data-canvas-active')
        }
      }
    }
  }

  const title = wSpindleUi?.getBuiltInTabTitle?.(tabId) || tab.title || storeTab?.title || resolvedId
  const iconSvg = tab.button?.querySelector('svg')?.outerHTML || root.querySelector('svg')?.outerHTML
  const shortName = readMainButtonShortName(tab.button as Element) || storeTab?.shortName

  // Host may remount panelContent under the hidden wrapper after host move.
  if (placedViaHost) {
    try {
      const m = await import('./main-mirror-drawer')
      if (m.isMainMirrorActive()) m.ensureHostContentParkedPublic()
    } catch { /* ignore */ }
  }

  await finalizeAssignToSecondary({
    resolvedId,
    title,
    root,
    iconSvg,
    shortName,
    deferActivation,
    wireAssignment: true,
    openOnClosed: true,
    setActiveWhenReady: false,
  })
}

/**
 * Assign a tab to the secondary drawer. Extension tabs are reparented
 * via DOM appendChild (preserving state); built-in tabs (Characters,
 * History) use host requestTabLocation / store-root placement.
 *
 * Tab resolution: DrawerObserver first (built-in path), then Lumiverse's
 * store (extension path). Extension tab buttons in Lumiverse's
 * ViewportDrawer.tsx:247-273 don't carry `data-tab-id`, so DrawerObserver
 * can't register them — we fall back to the Zustand store snapshot.
 *
 * Public entry is a thin resolver + dispatcher; placement lives in
 * assignExtensionTabToSecondary / assignBuiltInTabToSecondary with shared
 * finalizeAssignToSecondary for the post-placement tail.
 */
export async function assignToSecondary(tabId: string): Promise<void> {
  // Snapshot at entry so fire-and-forget async tails still defer activation
  // after finishRestore / openSecondarySidebar clear the live flags.
  // Only "become the active secondary tab" side effects are gated — assignment,
  // button create, reparent, and hideMainTabButton always proceed.
  const deferActivation =
    isRestoringFromLayout() || isSuppressAutoActivation()

  let tab = drawerObserver.getTab(tabId)
  let iconSvg: string | undefined
  let shortName: string | undefined

  if (!tab) {
    const storeTab = findStoreTab(tabId)
    if (!storeTab) {
      dwarn(`[SecondaryDrawer] assignToSecondary: tab ${tabId} not found in DrawerObserver or store`)
      return
    }
    // findMainTabButton resolves by id first, then by title (buttons.ts:35-83).
    // For extension tabs without data-tab-id, the title-based path is what hits.
    const button = findMainTabButton(storeTab.title)
    if (!button) {
      dwarn(`[SecondaryDrawer] assignToSecondary: tab ${tabId} found in store but no main sidebar button (title="${storeTab.title}")`)
      return
    }
    tab = {
      tabId: storeTab.id,
      button: button as HTMLElement,
      extensionId: storeTab.extensionId,
      title: storeTab.title,
    }
    iconSvg = storeTab.iconSvg
    shortName = storeTab.shortName
  } else {
    iconSvg = tab.button.querySelector('svg')?.outerHTML
  }

  const resolvedId = tab.tabId
  dlog(`[SecondaryDrawer] assigning ${resolvedId} to secondary (ext=${tab.extensionId})`)

  const ctx: AssignCtx = { tabId, tab, resolvedId, iconSvg, shortName, deferActivation }
  const isExtensionTab = !!tab.extensionId && tab.extensionId !== 'unknown'
  if (isExtensionTab) {
    await assignExtensionTabToSecondary(ctx)
  } else {
    await assignBuiltInTabToSecondary(ctx)
  }
}

/**
 * Remove a tab from the secondary drawer. Reparented roots are moved back
 * to the main panel. Built-in tabs have no extensionId (or an empty one),
 * so no extension teardown is required.
 */
export async function unassignFromSecondary(tabId: string): Promise<void> {
  dlog(`[SecondaryDrawer] unassigning ${tabId} from secondary`)

  // Resolve the bare id to the store's composite id. The wrapper button's
  // data-tab-id is the bare options.id, but the main sidebar button was
  // hidden with the composite id (assignToSecondary:125 used the store's
  // resolvedId). Without resolution, findMainTabButton returns null and
  // the button stays hidden. The segment match works for extensions;
  // built-ins fall through to findStoreTab.
  let resolvedShowId = tabId
  let resolvedExtId: string | undefined
  findStoreData(true)  // force-walk the fiber tree to bypass 3s store cache
  const _tabs = getDrawerTabs()
  const _bySegment = _tabs.find(t => t.id.includes(`:tab:${tabId}:`) || t.id === tabId)
  if (_bySegment) {
    resolvedShowId = _bySegment.id
    resolvedExtId = _bySegment.extensionId
  } else {
    const storeTab = findStoreTab(tabId)
    if (storeTab) {
      resolvedShowId = storeTab.id
      resolvedExtId = storeTab.extensionId
    } else {
      dwarn(`[SecondaryDrawer] unassign: could not resolve bare id "${tabId}" to composite id; known tabs=`, _tabs.map(t => ({ id: t.id, title: t.title })))
    }
  }

  // Move reparented root back to the main panel and clear Canvas markers.
  // The selector :not([data-canvas-secondary]) excludes wrapper-owned roots
  // (legacy); reparented extension roots have data-canvas-moved but NOT
  // data-canvas-secondary, so they match correctly.
  //
  // Dual-id lookup: built-ins often tag with bare tabId (builtin-move) while
  // resolvedShowId may be a composite store id. Host requestTabLocation may
  // also reparent out of secondary before we run — still clear residual
  // data-canvas-moved / data-canvas-active so main-mirror CSS cannot hide
  // the panel body (inactive tabs lack data-canvas-active).
  const _secondaryContentForUnassign = getSecondaryWrapper()?.querySelector('.sidebar-ux-panel-content')
  let _movedRoot: HTMLElement | null = null
  if (_secondaryContentForUnassign) {
    const idsToTry = resolvedShowId !== tabId
      ? [resolvedShowId, tabId]
      : [resolvedShowId]
    for (const id of idsToTry) {
      _movedRoot = _secondaryContentForUnassign.querySelector(
        `[data-canvas-moved="${CSS.escape(id)}"]:not([data-canvas-secondary])`,
      ) as HTMLElement | null
      if (_movedRoot) break
    }
    if (_movedRoot) {
      // Extension reparent path only: root still under secondary content.
      const _mainContent = document.querySelector('[class*="_panelContent_"]') as HTMLElement | null
      if (_mainContent && _movedRoot.parentElement !== _mainContent) {
        _mainContent.appendChild(_movedRoot)
      }
      _movedRoot.removeAttribute('data-canvas-moved')
      _movedRoot.removeAttribute('data-canvas-active')
    }
  }

  // Fallback: host already moved the root (or id mismatch left it outside
  // secondary). Clear Canvas attrs only — never raw-reparent built-ins.
  if (!_movedRoot) {
    const bridgeRoot =
      (getHostBridge()?.ui.getBuiltInTabRoot?.(tabId) as HTMLElement | undefined) ||
      (resolvedShowId !== tabId
        ? (getHostBridge()?.ui.getBuiltInTabRoot?.(resolvedShowId) as HTMLElement | undefined)
        : undefined)
    let residual: HTMLElement | null =
      bridgeRoot && bridgeRoot.getAttribute?.('data-canvas-moved') != null
        ? bridgeRoot
        : null
    if (!residual && typeof document !== 'undefined') {
      const idsToTry = resolvedShowId !== tabId
        ? [resolvedShowId, tabId]
        : [resolvedShowId]
      for (const id of idsToTry) {
        residual = document.querySelector(
          `[data-canvas-moved="${CSS.escape(id)}"]:not([data-canvas-secondary])`,
        ) as HTMLElement | null
        if (residual) break
      }
    }
    if (residual) {
      residual.removeAttribute('data-canvas-moved')
      residual.removeAttribute('data-canvas-active')
    }
  }

  // Clean up _tabAssignments for both the bare id (registered by the
  // wrapper) and the composite id (registered by assignToSecondary).
  deleteTabAssignment(tabId)
  if (resolvedShowId !== tabId) {
    deleteTabAssignment(resolvedShowId)
  }
  removeSecondaryTabButton(tabId)
  if (getActiveSecondaryTabId() === tabId) {
    showSecondaryTabDisplay(null as any)
  }
  showMainTabButton(resolvedShowId)

  if (getTabAssignments().size === 0) {
    _state = 'closed'
    _activeTabId = null
    // Auto-close the secondary drawer when the last tab is moved out.
    // Default behavior (no silent flag) persists the closed state via
    // persistOpenState() so the next reload starts with the drawer
    // closed. closeSecondarySidebar is idempotent — safe on already-closed.
    // Also hide the drawer tab button itself (display:none inline) so
    // it can't be clicked to reopen an empty drawer.
    closeSecondarySidebar()
    updateDrawerTabVisibility()
  }
  persistLayout()
}

/**
 * Activate a tab in the secondary drawer (display-toggle path).
 * This is the showSecondaryTab path — all content is pre-mounted.
 */
export function activateSecondaryTab(tabId: string): void {
  _activeTabId = tabId
  _state = 'tab_active'
  showSecondaryTabDisplay(tabId)
}

/**
 * Get the current active secondary tab ID.
 */
export function getActiveSecondaryTab(): string | null {
  return _activeTabId
}

/**
 * Get the current state.
 */
export function getSecondaryDrawerState(): SecondaryDrawerState {
  return _state
}

/**
 * Tear down the secondary drawer state machine. Called on Canvas disable.
 */
export function teardownSecondaryDrawer(): void {
  _state = 'closed'
  _activeTabId = null
}
