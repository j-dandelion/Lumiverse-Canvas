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
  ensureBuiltInTabActiveInMain,
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

export type SecondaryDrawerState = 'closed' | 'mounting' | 'open' | 'tab_active'

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
 * Assign a tab to the secondary drawer. Extension tabs are reparented
 * via DOM appendChild (preserving state); built-in tabs (Characters,
 * History) use the display-toggle path directly.
 *
 * Tab resolution: DrawerObserver first (built-in path), then Lumiverse's
 * store (extension path). Extension tab buttons in Lumiverse's
 * ViewportDrawer.tsx:247-273 don't carry `data-tab-id`, so DrawerObserver
 * can't register them — we fall back to the Zustand store snapshot, which
 * has all tabs. The store's DrawerTab carries `iconSvg`/`iconUrl` and a
 * `root` content element directly, so the secondary tab button can use
 * those without re-querying the DOM.
 */
export async function assignToSecondary(tabId: string): Promise<void> {
  let tab = drawerObserver.getTab(tabId)
  let iconSvg: string | undefined
  let iconUrl: string | undefined
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
    iconUrl = storeTab.iconUrl
    shortName = storeTab.shortName
  } else {
    iconSvg = tab.button.querySelector('svg')?.outerHTML
  }

  // Use the resolved tabId (real id, not the title fallback) for all
  // state/button operations so persistence and id resolution are keyed
  // consistently across move-loops.
  const resolvedId = tab.tabId
  dlog(`[SecondaryDrawer] assigning ${resolvedId} to secondary (ext=${tab.extensionId})`)

  // Determine if this is an extension tab (has a UUID extensionId) vs a
  // built-in tab (extensionId is 'unknown' or empty, parsed from composite
  // id parts[2] when the id has no UUID prefix).
  const _isExtensionTab = !!tab.extensionId && tab.extensionId !== 'unknown'

  if (_isExtensionTab) {
    // === EXTENSION TAB PATH ===
    setTabAssignment(resolvedId, 'secondary')
    hideMainTabButton(resolvedId)
    // On mobile, do not auto-open the drawer during assignToSecondary.
    // This is invoked from assignTab's extension path; auto-opening
    // would trigger enforceExclusionOnOpen and close the source drawer.
    // (See assignment.ts:172 for the built-in-path equivalent.)
    if (_state === 'closed' && !isSecondarySidebarOpen() && !isMobileViewport()) {
      await openSecondarySidebar()
      _state = 'open'
    }

    // Check if root is already reparented (data-canvas-moved set).
    // applyLayout's restore pass or a duplicate call can hit this.
    const _secondaryContentEarly = document.querySelector('.sidebar-ux-panel-content')
    const _bareIdEarly = resolvedId.includes(':')
      ? (resolvedId.replace(/:\d+$/, '').split(':').pop() ?? resolvedId)
      : resolvedId
    const _existingRoot = (_secondaryContentEarly?.querySelector(
      `[data-canvas-moved="${CSS.escape(resolvedId)}"]`
    ) ?? _secondaryContentEarly?.querySelector(
      `[data-canvas-moved="${CSS.escape(_bareIdEarly)}"]`
    )) as HTMLElement | null

    if (_existingRoot) {
      // Root already reparented — just create the button if missing and
      // refresh state. addSecondaryTabButton is idempotent.
      const _storeTabForButton = findStoreTab(resolvedId) || findStoreTab(tabId) || findStoreTab(tab.title)
      addSecondaryTabButton({
        id: resolvedId,
        title: tab.title || _storeTabForButton?.title || resolvedId,
        root: _existingRoot,
        iconSvg: iconSvg
          || (tab.button as HTMLElement | undefined)?.querySelector('svg')?.outerHTML
          || _storeTabForButton?.iconSvg,
        shortName: shortName || readMainButtonShortName(tab.button as Element) || _storeTabForButton?.shortName,
      })
      updateDrawerTabVisibility()
    } else {
      // PRIMARY PATH: reparent the extension's primary DOM root into
      // the secondary drawer. Preserves state, avoids duplicate instances.
      const _secondaryWrapper = getSecondaryWrapper()
      const _secondaryContent = _secondaryWrapper?.querySelector('.sidebar-ux-panel-content')
      const _storeTab = findStoreTab(resolvedId) || findStoreTab(tabId) || findStoreTab(tab.title)
      if (_storeTab?.root && _secondaryContent) {
        const _root = _storeTab.root
        if (_root.parentElement !== _secondaryContent) {
          _secondaryContent.appendChild(_root)
        }
        _root.setAttribute('data-canvas-moved', resolvedId)
        for (const _child of Array.from(_secondaryContent.children)) {
          if (_child instanceof HTMLElement) {
            if (_child === _root) {
              _child.setAttribute('data-canvas-active', '')
            } else {
              _child.removeAttribute('data-canvas-active')
            }
          }
        }
        addSecondaryTabButton({
          id: resolvedId,
          title: tab.title || _storeTab.title || resolvedId,
          root: _root,
          iconSvg: (tab.button as HTMLElement | undefined)?.querySelector('svg')?.outerHTML || _storeTab.iconSvg,
          shortName: readMainButtonShortName(tab.button as Element) || _storeTab.shortName,
        })
        updateDrawerTabVisibility()
      }
    }

    // Refresh active state and header (idempotent — safe on both paths).
    // On mobile, skip state activation when the drawer wasn't opened —
    // the user stays in the source drawer; destination opens manually.
    if (!isMobileViewport()) {
      _activeTabId = resolvedId
      _state = 'tab_active'
      setActiveSecondaryTabId(resolvedId)
    }
    const _headerTitle = getSecondaryWrapper()?.querySelector('.sidebar-ux-panel-title')
    if (_headerTitle) {
      _headerTitle.textContent = tab.title || _existingRoot?.getAttribute('data-tab-title') || resolvedId
    }
  } else {
    // === BUILT-IN TAB PATH ===
    // Try the fallback FIRST. If it fails (store not ready, root not found,
    // wrapper not ready), return without setting the assignment. The polling
    // loop's hasTabAssignment check will return false, and the loop will
    // retry on the next tick when the store is more likely to be loaded.
    const _secondaryWrapper = getSecondaryWrapper()
    const _secondaryContent = _secondaryWrapper?.querySelector('.sidebar-ux-panel-content')
    const _storeTab = findStoreTab(resolvedId) || findStoreTab(tabId) || findStoreTab(tab.title)
    dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_ENTER tab=${resolvedId} hasStoreTab=${!!_storeTab} hasSecondaryContent=${!!_secondaryContent}`)

    // DOM-based root lookup fallback. The Zustand store may not have loaded
    // the tab yet (Lumiverse populates the store asynchronously — the main
    // button is created first, the store entry is added later). Search the
    // main panel content for the root directly. Match by data-tab-id,
    // data-tab-title, or text content containing the tab title.
    //
    // BUILT-IN TAB LIMITATION (pre-fix history, now obsolete):
    //   Lumiverse only renders the ACTIVE tab's root in the main panel
    //   content. For built-in tabs (extensionId="unknown"), the only
    //   way to get a mounted root is to make the tab active — which
    //   used to require clicking the main button. Clicking was
    //   destructive: it triggered a Lumiverse re-render that destroyed
    //   the main sidebar, which cascaded into the 2s checkSideChanged
    //   watcher re-creating the secondary on the wrong side. So we
    //   originally did NOT click, and built-in tabs that were not
    //   currently-active could not be restored on hard-refresh.
    //
    // Current approach: a built-in tab is "mounted" via the host bridge's
    //   getBuiltInTabRoot(tabId) which calls ensureRegistryRoot(tabId)
    //   (frontend/src/lib/drawer-tab-registry.tsx:409). That lazily
    //   mounts the panel on first request — without requiring it to be
    //   active in the main drawer. The LAZY_MOUNT_OK branch below
    //   calls ensureBuiltInTabActiveInMain (the same helper used by
    //   the cold-boot right-click path) to trigger the panel's data
    //   fetch before requestTabLocation moves the root into the
    //   secondary container. End state matches the cold-boot case
    //   the user already accepts: main drawer open with empty
    //   content, secondary drawer open with the built-in populated.
    //   Extension tabs use storeTab.root which is populated
    //   independently of the DOM.
    let _root: HTMLElement | undefined = _storeTab?.root
    if (!_root && !_isExtensionTab) {
      // For built-in tabs, try the DOM as a last resort. This will only
      // succeed if the tab happens to be the currently-active tab (e.g.,
      // when the user activates it in main first, then we move it).
      const _mainContent = document.querySelector('[class*="_panelContent_"]') as HTMLElement | null
      const _firstChild = _mainContent?.children[0] as HTMLElement | undefined
      if (_mainContent) {
        // Match by data attributes (works only for the currently-active tab)
        for (const _child of Array.from(_mainContent.children)) {
          if (_child.getAttribute('data-tab-id') === resolvedId ||
              _child.getAttribute('data-tab-title') === tab.title ||
              (_child.textContent?.includes(tab.title ?? '') ?? false)) {
            _root = _child as HTMLElement
            break
          }
        }
        // If the first child IS the tab we're looking for (rare — only when
        // the user happened to leave this tab active in main), take it.
        if (!_root && _mainContent.children.length > 0 &&
            (_firstChild?.getAttribute('data-tab-id') === resolvedId ||
             _firstChild?.getAttribute('data-tab-title') === tab.title)) {
          _root = _firstChild
        }
      }
    }
    dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_AFTER_DOM_LOOKUP tab=${resolvedId} rootFound=${!!_root} rootTagId=${_root?.getAttribute('data-tab-id') ?? 'null'}`)

    const wSpindle = getHostBridge();
    const wSpindleUi = wSpindle?.ui;

    if (!_root || !_secondaryContent) {
      // For built-in tabs with a host bridge available, attempt a lazy
      // mount via the host's drawer-tab-registry and then request
      // placement into the secondary drawer. This mirrors the runtime
      // move pattern in src/tabs/assignment.ts:273-411.
      if (_secondaryContent && !_root && wSpindleUi?.getBuiltInTabRoot && wSpindleUi?.requestTabLocation) {
        // Warm-boot fix: trigger the Lorebook panel's data fetch
        // (loadBooks) before the root is moved to the container. The
        // panel's useEffect (frontend/src/components/panels/world-book/
        // WorldBookPanel.tsx:165-178) is gated on
        //   isVisible = drawerOpen && drawerTab === 'lorebook'
        // and the Lumiverse store starts at drawerOpen=false on every
        // page load (Lumiverse doesn't persist drawer state).
        // Without this pre-activation, the panel mounts via
        // ensureRegistryRoot with isVisible=false and the dropdown
        // stays empty.
        //
        // The cold-boot right-click "Move to second drawer" path
        // (src/tabs/assignment.ts) does the same pre-activation and
        // it works because the synthetic click on the main drawer
        // button triggers Lumiverse's React onClick handler, which
        // sets drawerOpen=true and mounts the panel as the active
        // tab. We use the same helper here on warm-boot for symmetry.
        // End state matches the cold-boot case the user already
        // accepts: main drawer open with empty content, secondary
        // drawer open with Lorebook populated.
        // Extra rAF: ensureBuiltInTabActiveInMain only awaits one rAF
        // for Lumiverse's React onClick handler to commit drawerOpen=
        // true + drawerTab='lorebook' on the main app's React tree.
        // WorldBookPanel mounts via ensureRegistryRoot on a SEPARATE
        // detached React root (Lumiverse frontend/src/lib/drawer-tab-
        // registry.tsx:105-116) whose commit is scheduled async by the
        // React 18 scheduler (~1-5ms typical). One extra rAF (~16ms)
        // gives that detached root time to commit and run its first
        // useEffect WITH isVisible=true, so loadBooks() fires (panel
        // gate: drawerOpen && drawerTab === 'lorebook', see
        // Lumiverse frontend/src/components/panels/world-book/
        // WorldBookPanel.tsx:165-178).
        await ensureBuiltInTabActiveInMain(resolvedId)
        await new Promise<void>((r) => requestAnimationFrame(() => r()))
        const _lazyRoot = wSpindleUi.getBuiltInTabRoot(tabId) as HTMLElement | undefined;
        if (!_lazyRoot) {
          dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_LAZY_MOUNT tab=${resolvedId} branch=EARLY_RETURN getBuiltInTabRootReturned=undefined`)
          dwarn('[SecondaryDrawer] assignToSecondary: built-in tabId not registered (stale or renamed). Skipping restore.', { tabId, resolvedId });
          return
        }
        dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_LAZY_MOUNT tab=${resolvedId} branch=LAZY_MOUNT_OK getBuiltInTabRootReturned=element`)
        _root = _lazyRoot;
        // Second rAF: defer requestTabLocation (which calls moveTabTo
        // → pendingActiveTabReset → ViewportDrawer resets drawerTab
        // to a fallback, see Lumiverse frontend/src/store/slices/
        // spindle-placement.ts:389-401 and components/panels/
        // ViewportDrawer.tsx:117-123) until AFTER the panel's first
        // useEffect has already run. If loadBooks() fires once with
        // isVisible=true, then the reset to drawerTab='profile' flips
        // isVisible=false but wasVisibleRef.current is now true, so
        // no refetch (no duplicate XHR). The dropdown stays populated
        // from the first fetch.
        await new Promise<void>((r) => requestAnimationFrame(() => r()))
        wSpindleUi.requestTabLocation(tabId, { kind: 'container', containerId: 'canvas-secondary-drawer' });
      } else {
        dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_LAZY_MOUNT tab=${resolvedId} branch=BRIDGE_MISSING hasGetBuiltInTabRoot=${!!wSpindleUi?.getBuiltInTabRoot} hasRequestTabLocation=${!!wSpindleUi?.requestTabLocation} hasSecondaryContent=${!!_secondaryContent}`)
        if (!_isExtensionTab) {
          dwarn('[SecondaryDrawer] assignToSecondary: built-in tab cannot be auto-restored (root not in DOM, not in store, host bridge missing).', {
            tabId,
            resolvedId,
          })
        }
        return
      }
    }

    // Move root to secondary panel (no-op if already there)
    if (_root.parentElement !== _secondaryContent) {
      _secondaryContent.appendChild(_root)
    }
    _root.setAttribute('data-canvas-moved', resolvedId)

    // Set this root active, deactivate all other moved roots
    for (const _child of Array.from(_secondaryContent.children)) {
      if (_child instanceof HTMLElement) {
        if (_child === _root) {
          _child.setAttribute('data-canvas-active', '')
        } else {
          _child.removeAttribute('data-canvas-active')
        }
      }
    }

    // Add a secondary tab button
    const _title = wSpindleUi?.getBuiltInTabTitle?.(tabId) || tab.title || _storeTab?.title || resolvedId;
    const _iconSvg = tab.button?.querySelector('svg')?.outerHTML || _root?.querySelector('svg')?.outerHTML
    const _shortName = readMainButtonShortName(tab.button as Element) || _storeTab?.shortName
    addSecondaryTabButton({
      id: resolvedId,
      title: _title,
      root: _root,
      iconSvg: _iconSvg,
      shortName: _shortName,
    })
    updateDrawerTabVisibility()

    // No "hide main panel content" or "click another tab" code here.
    // We don't click anything in the built-in path (clicking is destructive —
    // it triggers a re-render cascade). The main panel just shows whatever
    // was already there (usually Profile), which is fine.

    // Set assignment AFTER successful fallback
    setTabAssignment(resolvedId, 'secondary')
    hideMainTabButton(resolvedId)
    if (_state === 'closed' && !isSecondarySidebarOpen() && !isMobileViewport()) {
      await openSecondarySidebar()
      _state = 'tab_active'
      _activeTabId = resolvedId
      setActiveSecondaryTabId(resolvedId)
    }

    // Update panel header title
    const _headerTitle = _secondaryWrapper?.querySelector('.sidebar-ux-panel-title')
    if (_headerTitle) _headerTitle.textContent = _title
  }

  // Ensure the tab button is visually highlighted. addSecondaryTabButton
  // creates the button without the active class — only showSecondaryTab
  // applies sidebar-ux-tab-active. Called here rather than relying on
  // finishRestore (apply.ts) because that path may run before the button
  // exists (assignToSecondary is async) or may not run at all if the
  // observer never fires (extensions already registered).
  if (!isMobileViewport()) {
    showSecondaryTabDisplay(resolvedId)
  }

  persistLayout()
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

  // Move reparented root back to the main panel. The selector
  // :not([data-canvas-secondary]) excludes wrapper-owned roots (legacy);
  // reparented extension roots have data-canvas-moved but NOT
  // data-canvas-secondary, so they match correctly.
  const _secondaryContentForUnassign = getSecondaryWrapper()?.querySelector('.sidebar-ux-panel-content')
  if (_secondaryContentForUnassign) {
    const _movedRoot = _secondaryContentForUnassign.querySelector(
      `[data-canvas-moved="${CSS.escape(resolvedShowId)}"]:not([data-canvas-secondary])`
    ) as HTMLElement | null
    if (_movedRoot) {
      // Find the main panel content and move the root back
      const _mainContent = document.querySelector('[class*="_panelContent_"]') as HTMLElement | null
      if (_mainContent && _movedRoot.parentElement !== _mainContent) {
        _mainContent.appendChild(_movedRoot)
      }
      _movedRoot.removeAttribute('data-canvas-moved')
      _movedRoot.removeAttribute('data-canvas-active')
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
