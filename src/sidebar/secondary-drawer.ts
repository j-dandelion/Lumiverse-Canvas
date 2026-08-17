// SecondaryDrawer: state machine for secondary drawer lifecycle.
//
// Manages tab assignment to the secondary, coordinates with DrawerObserver
// for DOM-based tab discovery, and owns the showSecondaryTab display-toggle
// path. Extension tabs are moved via DOM reparenting (appendChild) to
// preserve state; built-in tabs (Characters, History) use the display-toggle
// path directly.

import { drawerObserver, keyForTabShape, type ObservedTab } from './drawer-observer'
import {
  showSecondaryTab as showSecondaryTabDisplay,
  addSecondaryTabButton,
  removeSecondaryTabButton,
  findMainTabButton,
  hideMainTabButton,
  showMainTabButton,
  clearSecondaryTabButtonActive,
  updateDrawerTabVisibility,
  readMainButtonShortName,
} from '../tabs/buttons'
import {
  getTabAssignments, setTabAssignment, deleteTabAssignment,
} from '../tabs/assignment'
import { getActiveSecondaryTabId, setActiveSecondaryTabId } from '../tabs/active-tab'
import {
  ensureSecondaryShellMounted,
  getSecondaryWrapper,
  openSecondarySidebar,
  isSecondarySidebarOpen,
  closeSecondarySidebar,
} from './secondary'
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
// The owned model's restore boundary is the
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
      // logic in the owned dispatcher is the authoritative state-setter; any
      // mutation here would race with it. See _restoringFromLayout comment
      // above for the full failure mode this prevents.
      if (_restoringFromLayout) return
      deleteTabAssignment(tabId)
      removeSecondaryTabButton(tabId)
      // Persist via the owned model; no-op persistLayout was retired.
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

  dlog('[SecondaryDrawer] finalize open-gate', {
    resolvedId,
    openOnClosed,
    state: _state,
    sidebarOpen: isSecondarySidebarOpen(),
    mobile: isMobileViewport(),
    restoring: isRestoringFromLayout(),
    deferActivation,
    setActiveWhenReady,
  })
  if (
    openOnClosed
    && _state === 'closed'
    && !isSecondarySidebarOpen()
    && !isMobileViewport()
    && !isRestoringFromLayout()
  ) {
    await openSecondarySidebar()
    dlog('[SecondaryDrawer] finalize open-gate:BRANCH open+tab_active', { resolvedId })
    // Built-in: only promote to tab_active when not deferring.
    // Extension open path sets `_state = 'open'` earlier (openOnClosed false).
    if (!deferActivation) {
      _state = 'tab_active'
      _activeTabId = resolvedId
      setActiveSecondaryTabId(resolvedId)
    }
  } else if (setActiveWhenReady && !isMobileViewport() && !deferActivation) {
    dlog('[SecondaryDrawer] finalize open-gate:BRANCH tab_active-only', { resolvedId })
    _activeTabId = resolvedId
    _state = 'tab_active'
    setActiveSecondaryTabId(resolvedId)
  } else {
    dlog('[SecondaryDrawer] finalize open-gate:BRANCH none', { resolvedId })
  }

  const headerTitle = getSecondaryWrapper()?.querySelector('.sidebar-ux-panel-title')
  if (headerTitle && !deferActivation) {
    headerTitle.textContent = title
  }

  if (showAndPersist) {
    // showSecondaryTab applies sidebar-ux-tab-active; suppressed during restore
    // so finishRestore remains authoritative for the active tab.
    //
    // EMPTY-CONTENT TRAP (2026-07-31): this display call is gated on
    // !deferActivation, and deferActivation is forced true whenever
    // setSuppressAutoActivation is on — i.e. during the whole
    // reassignSecondaryTabsFromModel loop. The loop therefore creates
    // buttons + reparents roots but displays nothing. Callers that run the
    // loop must show a tab themselves afterwards (reassignSecondaryTabsFromModel
    // activates the persisted active.secondary or the first placed tab).
    if (!isMobileViewport() && !deferActivation) {
      showSecondaryTabDisplay(resolvedId)
    }
    // Persist via the owned model; no-op persistLayout was retired.
  }

  // Mirror of unassignFromSecondary: host hide does not trigger the pin
  // MutationObserver (style not watched). Force strip rebuild under taskbar mode.
  if (wireAssignment) {
    try {
      const m = await import('./main-tab-pin')
      m.reconcileMainTabListPin()
    } catch { /* pin optional during teardown */ }
  }
}

type AssignCtx = {
  tabId: string
  tab: ObservedTab
  resolvedId: string
  iconSvg?: string
  shortName?: string
  deferActivation: boolean
  /** Boot placement (drawer closed) must not force-open — defaults to true. */
  openOnClosed?: boolean
  /** Boot placement must not activate a tab in a closed drawer. */
  setActiveWhenReady?: boolean
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
      // DnD cross-drawer placement passes setActiveWhenReady:false so the
      // dropped tab is NOT activated in the destination (quiet DnD contract).
      setActiveWhenReady: ctx.setActiveWhenReady ?? true,
    })
    return
  }

  // PRIMARY PATH: ask the host to move the extension tab into the Canvas
  // secondary container. This updates `tabLocations[tabId]` so the host's
  // own `ContainerTabContent` effect places the root in the registered
  // container — and the host's `TabPanelContent` for the MAIN drawer sees
  // `isMatch = false` and does NOT move the root back. Without this, the
  // DOM-only reparent leaves `tabLocations` at `main-drawer`, and any
  // subsequent `TabPanelContent` effect re-run (active tab switch, store
  // re-render) moves the root back to the main container — the "Configure
  // drag doesn't actually move the extension tab in the main UI" bug.
  //
  // If the host can't move it (allowlist deny + store.moveTabTo missing),
  // fall back to the DOM reparent that worked before.
  const secondaryWrapper = getSecondaryWrapper()
  const secondaryContentMain = secondaryWrapper?.querySelector('.sidebar-ux-panel-content')
  const storeTab = findStoreTab(resolvedId) || findStoreTab(tabId) || findStoreTab(tab.title)

  // Root sourcing (2026-08-17): the observer-derived facade
  // (findStoreTab → getDrawerTabs) returns `root: tab.button` — the HOST
  // BUTTON, NOT the content root. Reparenting it rips the button out of
  // the sidebar (the mirror loses the tab, findMainTabButton misses, and
  // moving the tab back to primary cannot restore it). Only a REAL content
  // root from the fiber store may be reparented; a lazily-mounted
  // extension (root null) falls through to the no-root wiring below.
  const { getHostStoreTabs } = await import('../store')
  const hostStoreTabs = getHostStoreTabs()
  const fiberTab = hostStoreTabs.find((t) => t.id === resolvedId)
    || hostStoreTabs.find((t) => t.title === tab.title)
  const realRoot = fiberTab?.root && fiberTab.root !== tab.button
    ? (fiberTab.root as HTMLElement)
    : null

  if (realRoot && secondaryContentMain) {
    const root = realRoot

    // Tag before host move so `data-canvas-moved` travels with the root
    // (ContainerTabContent appends the same node; showSecondaryTab looks
    // for [data-canvas-moved] to toggle `data-canvas-active`).
    root.setAttribute('data-canvas-moved', resolvedId)

    // Try host-managed placement first (updates tabLocations → host's
    // ContainerTabContent moves the root into the canvas-secondary-drawer
    // container). Dynamic import to avoid the secondary-drawer →
    // host-tab-location → ... circular dep.
    let placedViaHost = false
    try {
      const { requestHostTabToSecondary } = await import('../tabs/host-tab-location')
      const placed = requestHostTabToSecondary(resolvedId)
      dlog('[SecondaryDrawer] assignExtensionTab: requestHostTabToSecondary', {
        tabId: resolvedId, ok: placed.ok, via: placed.via,
      })
      placedViaHost = placed.ok
    } catch (err) {
      dwarn('[SecondaryDrawer] assignExtensionTab: requestHostTabToSecondary threw:', err)
    }

    if (!placedViaHost) {
      // Fallback: DOM reparent (the previous behavior). The host's
      // tabLocations still says main-drawer, so this is race-prone if the
      // host's TabPanelContent effect re-runs, but it's the best we can do
      // when the host can't manage the placement.
      if (root.parentElement !== secondaryContentMain) {
        secondaryContentMain.appendChild(root)
      }
    }

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
      title: tab.title || storeTab?.title || resolvedId,
      root,
      iconSvg: (tab.button as HTMLElement | undefined)?.querySelector('svg')?.outerHTML || storeTab?.iconSvg,
      shortName: readMainButtonShortName(tab.button as Element) || storeTab?.shortName,
      deferActivation,
      wireAssignment: false,
      openOnClosed: false,
      // Quiet DnD: see existingRoot branch above.
      setActiveWhenReady: ctx.setActiveWhenReady ?? true,
    })
    return
  }

  // No real content root (lazily-mounted extension) — wire the assignment
  // and the secondary button anyway; the content root attaches when the
  // host mounts the tab. The `root` passed to finalize is only used for the
  // button descriptor (never reparented), so the host button is safe.
  await finalizeAssignToSecondary({
    resolvedId,
    title: tab.title || storeTab?.title || resolvedId,
    root: tab.button,
    iconSvg: (tab.button as HTMLElement | undefined)?.querySelector('svg')?.outerHTML || storeTab?.iconSvg,
    shortName: readMainButtonShortName(tab.button as Element) || storeTab?.shortName,
    deferActivation,
    wireAssignment: false,
    openOnClosed: false,
    // Quiet DnD: see existingRoot branch above.
    setActiveWhenReady: ctx.setActiveWhenReady ?? true,
  })
  return
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
      openOnClosed: ctx.openOnClosed ?? true,
      // Built-in: only set tab_active when we open; otherwise show path only.
      setActiveWhenReady: ctx.setActiveWhenReady ?? false,
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

  let bridgeRoot: HTMLElement | undefined
  try {
    bridgeRoot = wSpindleUi?.getBuiltInTabRoot?.(tabId) as HTMLElement | undefined
  } catch (err) {
    dwarn(`[SecondaryDrawer] getBuiltInTabRoot threw for "${tabId}":`, err)
    bridgeRoot = undefined
  }
  dlog(
    `[canvas-debug] ASSIGN_SEC_BUILTIN_AFTER_DOM_LOOKUP tab=${resolvedId} ` +
    `rootFound=${!!bridgeRoot} rootTagId=${bridgeRoot?.getAttribute('data-tab-id') ?? 'null'} via=getBuiltInTabRoot`,
  )

  let root: HTMLElement | undefined
  let placedViaHost = false

  // Prefer host tabLocations (bridge + store.moveTabTo), then DOM reparent
  // inside moveBuiltInTabToSecondaryContainer. Do not treat "got a registry
  // root" alone as success — that produced empty secondary panels.
  if (wSpindleUi?.getBuiltInTabRoot) {
    const { moveBuiltInTabToSecondaryContainer } = await import('../tabs/builtin-move')
    root = await moveBuiltInTabToSecondaryContainer({
      tabId,
      deferActivation,
      root: bridgeRoot,
    })
    placedViaHost = !!root
  }

  // Extension-style store roots only (not DRAWER_TABS registry roots).
  // Built-in registry roots go through moveBuiltIn (host or DOM fallback).
  if (!root && storeTab?.root && storeTab.extensionId) {
    root = storeTab.root
    if (root.parentElement !== secondaryContent) {
      secondaryContent.appendChild(root)
    }
    root.setAttribute('data-canvas-moved', resolvedId)
    dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_STORE_REPARENT tab=${resolvedId} branch=STORE_ROOT`)
  }

  if (!root) {
    dwarn(
      '[SecondaryDrawer] assignToSecondary: built-in tab not placed ' +
      '(host location write failed, DOM reparent failed, or root missing).',
      { tabId, resolvedId, hasBridgeRoot: !!bridgeRoot, hasGetRoot: !!wSpindleUi?.getBuiltInTabRoot },
    )
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

  // Host may remount panelContent under the hidden wrapper after host/DOM move.
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
    openOnClosed: ctx.openOnClosed ?? true,
    setActiveWhenReady: ctx.setActiveWhenReady ?? false,
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
export async function assignToSecondary(
  tabId: string,
  opts?: { openOnClosed?: boolean; setActiveWhenReady?: boolean },
): Promise<void> {
  // Snapshot at entry so fire-and-forget async tails still defer activation
  // after finishRestore / openSecondarySidebar clear the live flags.
  // Only "become the active secondary tab" side effects are gated — assignment,
  // button create, reparent, and hideMainTabButton always proceed.
  const deferActivation =
    isRestoringFromLayout() || isSuppressAutoActivation()

  // Without a live shell, built-in place and extension reparent no-op (content
  // missing / tab list missing). Heal detached or never-mounted wrappers first.
  if (!ensureSecondaryShellMounted({ initialOpen: false })) {
    dwarn(`[SecondaryDrawer] assignToSecondary: secondary shell unavailable; skip "${tabId}"`)
    return
  }

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
      key: keyForTabShape(storeTab.id, storeTab.extensionId, storeTab.title),
      titles: new Set([storeTab.title]),
    }
    iconSvg = storeTab.iconSvg
    shortName = storeTab.shortName
  } else {
    iconSvg = tab.button.querySelector('svg')?.outerHTML
  }

  const resolvedId = tab.tabId
  dlog(`[SecondaryDrawer] assigning ${resolvedId} to secondary (ext=${tab.extensionId})`)

  let isExtensionTab = !!tab.extensionId && tab.extensionId !== 'unknown'
  if (!isExtensionTab) {
    // Stale-entry upgrade (2026-08-17): the observer entry may still be
    // title-keyed with extensionId 'unknown' — the tagger's data-tab-id
    // write happened during the observer's initial scan, before it was
    // observing, so the entry never upgraded to the composite spindle id.
    // The REAL host store (fiber walk) has the composite id + extensionId;
    // re-classify from it so the extension placement path runs. (NOT
    // findStoreTab/getDrawerTabs — that facade prefers the observer
    // inventory and would serve the same stale entry.) Otherwise the boot
    // restore treats the extension tab as a built-in, its placement fails,
    // and the model ends up ahead of the DOM ("drag an extension tab to
    // another drawer → it doesn't move in the main UI / activation lands on
    // the old drawer").
    // unreachable (resolved above) — TS cannot narrow `tab` past the await
    if (!tab) return
    const t = tab
    const { getHostStoreTabs } = await import('../store')
    const hostStoreTabs = getHostStoreTabs()
    const storeTab = hostStoreTabs.find((x) => x.id === tabId)
      || hostStoreTabs.find((x) => x.id === t.tabId)
      || hostStoreTabs.find((x) => x.title === t.title)
    if (storeTab?.extensionId && storeTab.extensionId !== 'unknown') {
      dlog('[SecondaryDrawer] assignToSecondary: observer entry stale — upgraded from store', {
        fromId: t.tabId,
        toId: storeTab.id,
        extFrom: t.extensionId,
        extTo: storeTab.extensionId,
      })
      tab = {
        ...tab,
        tabId: storeTab.id,
        extensionId: storeTab.extensionId,
        title: storeTab.title,
        titles: new Set([storeTab.title]),
      }
      iconSvg = iconSvg ?? storeTab.iconSvg
      shortName = shortName ?? storeTab.shortName
      isExtensionTab = true
    }
  }

  const ctx: AssignCtx = {
    tabId,
    tab,
    resolvedId: tab.tabId,
    iconSvg,
    shortName,
    deferActivation,
    openOnClosed: opts?.openOnClosed,
    setActiveWhenReady: opts?.setActiveWhenReady,
  }
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

  // Built-in vs extension placement is different (see secondary.tsx teardown
  // and tabs/assignment.ts primary restore):
  //   - Built-in: host owns tabLocations. Must requestTabLocation({kind:
  //     'main-drawer'}) so ContainerTabContent renders on activate. Never
  //     raw-removeChild/appendChild React roots (orphans → empty/wrong content).
  //   - Extension: Canvas reparented the store root into secondary; put it
  //     back into main panel content via appendChild so instance state survives.
  // Owned-model restore → unassignUnwantedSecondary calls this directly (skips
  // assignment.ts), so the host reset must live here, not only in assignTab.
  const bridge = getHostBridge()
  const bridgeUi = bridge?.ui
  let bridgeRoot: HTMLElement | undefined
  try {
    bridgeRoot =
      (bridgeUi?.getBuiltInTabRoot?.(tabId) as HTMLElement | undefined) ||
      (resolvedShowId !== tabId
        ? (bridgeUi?.getBuiltInTabRoot?.(resolvedShowId) as HTMLElement | undefined)
        : undefined)
  } catch {
    bridgeRoot = undefined
  }
  // Built-in if registry root present, or host title resolves (getBuiltInTabTitle
  // is free / no ui_panels). Avoid treating unknown extension ids as built-in.
  const isBuiltIn =
    bridgeRoot != null ||
    !!(
      bridgeUi?.getBuiltInTabTitle?.(tabId) ||
      (resolvedShowId !== tabId ? bridgeUi?.getBuiltInTabTitle?.(resolvedShowId) : undefined)
    )

  // Dual-id lookup: built-ins often tag with bare tabId (builtin-move) while
  // resolvedShowId may be a composite store id.
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
  }

  if (isBuiltIn) {
    // Prefer the bare id the host registered (tabId / bridge root tag).
    // Non-CORE: requestTabLocation allowlist may no-op; store.moveTabTo may be
    // missing. DOM-placed tabs need appendChild back to main panelContent.
    const hostTabId =
      bridgeRoot?.getAttribute?.('data-tab-id') ||
      tabId
    let hostResetOk = false
    try {
      const { requestHostTabToMain } = await import('../tabs/host-tab-location')
      const result = requestHostTabToMain(hostTabId)
      hostResetOk = result.ok
      if (!result.ok) {
        dwarn(
          `[SecondaryDrawer] unassign: could not reset tabLocations for ${hostTabId} (via=${result.via})`,
        )
      }
    } catch (err) {
      dwarn(`[SecondaryDrawer] unassign: requestHostTabToMain failed for ${hostTabId}:`, err)
    }

    const {
      isDomPlacedBuiltIn,
      restoreDomPlacedBuiltInToMain,
      CANVAS_DOM_PLACED_ATTR,
    } = await import('../tabs/builtin-move')
    const domPlaced =
      isDomPlacedBuiltIn(hostTabId) ||
      isDomPlacedBuiltIn(tabId) ||
      !!_movedRoot?.hasAttribute?.(CANVAS_DOM_PLACED_ATTR) ||
      !!bridgeRoot?.hasAttribute?.(CANVAS_DOM_PLACED_ATTR)

    if (domPlaced || (!hostResetOk && _movedRoot)) {
      // DOM fallback path (or host reset failed with residual secondary root).
      restoreDomPlacedBuiltInToMain(hostTabId, _movedRoot || bridgeRoot)
      if (tabId !== hostTabId) {
        const { clearDomPlacedBuiltIn } = await import('../tabs/builtin-move')
        clearDomPlacedBuiltIn(tabId)
      }
    } else {
      // Host-owned move: only clear Canvas attrs — never steal the React root.
      const clearAttrs = (el: HTMLElement | null | undefined) => {
        if (!el) return
        el.removeAttribute('data-canvas-moved')
        el.removeAttribute('data-canvas-active')
        el.removeAttribute(CANVAS_DOM_PLACED_ATTR)
      }
      clearAttrs(_movedRoot)
      clearAttrs(bridgeRoot)
      if (!_movedRoot && typeof document !== 'undefined') {
        const idsToTry = resolvedShowId !== tabId
          ? [resolvedShowId, tabId]
          : [resolvedShowId]
        for (const id of idsToTry) {
          const residual = document.querySelector(
            `[data-canvas-moved="${CSS.escape(id)}"]:not([data-canvas-secondary])`,
          ) as HTMLElement | null
          if (residual) {
            clearAttrs(residual)
            break
          }
        }
      }
    }
  } else if (_movedRoot) {
    // Extension reparent path: ask the host to move the tab back to the
    // main drawer first (updates tabLocations → ContainerTabContent Pass 2
    // removes the root from the canvas-secondary-drawer container, and the
    // main drawer's TabPanelContent will mount it on activation). If the
    // host can't move it (allowlist deny + store.moveTabTo missing), DETACH
    // the store root — the host owns placement (TabPanelContent moves the
    // root into its containerRef when the tab activates).
    // 2026-08-17: this used to append the root into getMainPanelContent() —
    // the node the main-mirror parks in its shell — leaving orphan roots as
    // visible children of the parked content area (stacked panels; "content
    // stays on a previous tab" after moves / mode switches).
    let hostResetOk = false
    try {
      const { requestHostTabToMain } = await import('../tabs/host-tab-location')
      const result = requestHostTabToMain(resolvedShowId)
      hostResetOk = result.ok
      dlog('[SecondaryDrawer] unassignExtensionTab: requestHostTabToMain', {
        tabId: resolvedShowId, ok: result.ok, via: result.via,
      })
    } catch (err) {
      dwarn(`[SecondaryDrawer] unassignExtensionTab: requestHostTabToMain failed for ${resolvedShowId}:`, err)
    }

    if (!hostResetOk) {
      // Fallback: detach the root so the host re-attaches it on activation.
      if (_movedRoot.parentElement) {
        try {
          _movedRoot.parentElement.removeChild(_movedRoot)
        } catch {
          /* host may have removed it already */
        }
      }
    }
    _movedRoot.removeAttribute('data-canvas-moved')
    _movedRoot.removeAttribute('data-canvas-active')
    _movedRoot.style?.removeProperty?.('position')
    _movedRoot.style?.removeProperty?.('inset')
    _movedRoot.style?.removeProperty?.('display')
  } else if (typeof document !== 'undefined') {
    // Fallback: root already outside secondary — clear residual attrs only.
    const idsToTry = resolvedShowId !== tabId
      ? [resolvedShowId, tabId]
      : [resolvedShowId]
    for (const id of idsToTry) {
      const residual = document.querySelector(
        `[data-canvas-moved="${CSS.escape(id)}"]:not([data-canvas-secondary])`,
      ) as HTMLElement | null
      if (residual) {
        residual.removeAttribute('data-canvas-moved')
        residual.removeAttribute('data-canvas-active')
        break
      }
    }
  }

  // Clean up _tabAssignments for both the bare id (registered by the
  // wrapper) and the composite id (registered by assignToSecondary).
  deleteTabAssignment(tabId)
  if (resolvedShowId !== tabId) {
    deleteTabAssignment(resolvedShowId)
  }
  removeSecondaryTabButton(tabId)
  const activeId = getActiveSecondaryTabId()
  if (activeId === tabId || activeId === resolvedShowId) {
    _activeTabId = null
    setActiveSecondaryTabId(null)
    clearSecondaryTabButtonActive()
  }
  showMainTabButton(resolvedShowId)
  // Main-mirror strip filters display:none host buttons and only rebuilds
  // on its own reconcile. Without this, the unhidden host button stays
  // invisible in the pin strip until some other host mutation.
  try {
    const m = await import('./main-tab-pin')
    m.reconcileMainTabListPin()
  } catch { /* pin module optional during early teardown */ }

  if (getTabAssignments().size === 0) {
    _state = 'closed'
    _activeTabId = null
    setActiveSecondaryTabId(null)
    // Auto-close the secondary drawer when the last tab is moved out.
    // Default behavior (no silent flag) persists the closed state via
    // persistOpenState() so the next reload starts with the drawer
    // closed. closeSecondarySidebar is idempotent — safe on already-closed.
    // Also hide the drawer tab button itself (display:none inline) so
    // it can't be clicked to reopen an empty drawer.
    closeSecondarySidebar()
    updateDrawerTabVisibility()
  }
  // Persist via the owned model; no-op persistLayout was retired.
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
 * Keep the drawer state machine in sync with the shell's physical open
 * state. `openSecondarySidebar`/`closeSecondarySidebar` live in the shell
 * module and don't own `_state`, so the finalize gate (which checks
 * `_state === 'closed'`) can read a stale 'closed' while the drawer is
 * visibly open — the observed drift in the 2026-07-31 rClick session.
 * Called by the shell when the drawer actually opens/closes.
 */
export function markDrawerOpenState(open: boolean): void {
  if (open) {
    _state = _activeTabId ? 'tab_active' : 'open'
  } else {
    _state = 'closed'
  }
}

/**
 * Tear down the secondary drawer state machine. Called on Canvas disable.
 */
export function teardownSecondaryDrawer(): void {
  _state = 'closed'
  _activeTabId = null
  setActiveSecondaryTabId(null)
}
