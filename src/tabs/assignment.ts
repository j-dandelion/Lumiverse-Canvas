// Tab assignment system: which tabId is on which sidebar, and the pure
// DOM move (repositionTab) + React-reclaim guard (installNodeGuard) +
// policy layer (applyAssignment) on top.
//
// v1.3.0 tabId-keyed identification: the previous Node-keyed guard
// had a 3s-TTL timing window where a React re-mount could land in
// the gap and let React reclaim the moved node. Now the authoritative
// key is the stable `tabId`, with the node resolved on demand via a
// forced `findStoreData(true)` walk (~1-2ms) when guards fire.
//
// v1.4.0 policy layer: `applyAssignment` wraps the pure DOM move with
// state updates, button affordances, optional drawer open/close, optional
// active-tab switching, and optional save. `assignTab` is the stable
// public API for "move this tab to that sidebar" with default options.
import { getMainSidebar, getMainPanelContent } from '../dom/lumiverse'
import { findStoreData, getDrawerTabs } from '../store'
import { dlog, dwarn } from '../debug/log'
// FIXME-decomp(step 9): getSecondaryWrapper will be in sidebar/secondary.tsx.
import { getSecondaryWrapper, isSecondarySidebarOpen, openSecondarySidebar, closeSecondarySidebar, restoreOverflow } from '../sidebar/secondary'
// FIXME-decomp(step 6): hideMainTabButton, showMainTabButton,
// addSecondaryTabButton, removeSecondaryTabButton, updateDrawerTabVisibility,
// showSecondaryTab, cssEscape live in tabs/buttons.ts.
import {
  hideMainTabButton, showMainTabButton,
  addSecondaryTabButton, removeSecondaryTabButton, updateDrawerTabVisibility, showSecondaryTab,
  cssEscape,
} from '../tabs/buttons'
// FIXME-decomp(step 12): persistLayout will be in layout/persist.ts.
import { persistLayout } from '../frontend'  // re-point to '../layout/persist'

// (clearOriginalParents is now defined locally in this file; sidebar/cleanup
// re-imports it in Step 14.)

// Maps tab ID → which sidebar it belongs to
const _tabAssignments: Map<string, 'primary' | 'secondary'> = new Map()

// Accessors used by other modules (sidebar/secondary, sidebar/polish,
// context-menu, layout/persist).
export function getTabAssignments(): Map<string, 'primary' | 'secondary'> { return _tabAssignments }
export function hasTabAssignment(tabId: string): boolean { return _tabAssignments.has(tabId) }
export function clearTabAssignments(): void { _tabAssignments.clear() }

export function getTabSidebar(tabId: string): 'primary' | 'secondary' {
  return _tabAssignments.get(tabId) || 'primary'
}

// v1.3.0: tabId-keyed Map tracking each tab's original parent in the main
// sidebar, replacing the previous Node-keyed WeakMap. The tabId is stable
// across React re-mounts of ExtensionTabContent; the DOM Node is not.
const _originalParents: Map<string, HTMLElement> = new Map()
export function clearOriginalParents(): void { _originalParents.clear() }

/**
 * Discriminated union describing the active-tab state of the main drawer.
 * Replaces the 3-deep nested-if + DOM-fallthrough of the old `isTabActiveInMainDrawer`.
 *
 * - `closed`   — drawer is not open
 * - `active`   — drawer is open, and the active tab is `id`
 * - `other`    — drawer is open, but a different tab (`id`) is active
 * - `unknown`  — store is unreachable AND DOM is unreachable (defensive)
 */
export type ActiveTabState =
  | { state: 'closed' }
  | { state: 'active'; id: string }
  | { state: 'other'; id: string }
  | { state: 'unknown' }

export function getActiveTabId(): ActiveTabState {
  // Primary: store snapshot
  findStoreData(true)
  const store = getStoreSnapshot() as { drawerTab?: string | null; drawerOpen?: boolean } | null
  if (store && typeof store.drawerOpen === 'boolean') {
    if (!store.drawerOpen) return { state: 'closed' }
    if (typeof store.drawerTab === 'string') {
      return { state: 'active', id: store.drawerTab }
    }
    // drawerOpen is true but drawerTab is null/undefined — store is in a
    // transitional state. Fall through to the DOM check rather than
    // reporting "unknown" prematurely; DOM is usually in sync here.
  }

  // Fallback: DOM-based check
  const sidebar = getMainSidebar()
  if (!sidebar) return { state: 'unknown' }
  const activeBtn = sidebar.querySelector('button[class*="tabBtnActive"]') as HTMLElement | null
  if (!activeBtn) return { state: 'unknown' }
  const activeTitle = activeBtn.getAttribute('title') || ''
  if (!activeTitle) return { state: 'unknown' }

  // Resolve the title back to a tabId via the store
  const tabs = getDrawerTabs()
  const tab = tabs.find((t: any) => t.title === activeTitle)
  if (tab) return { state: 'active', id: tab.id }
  // Active button is a built-in (no matching extension tab). Report the title
  // as the active id so callers can compare against built-in tab keys if needed.
  return { state: 'active', id: activeTitle }
}

/**
 * Thin boolean wrapper over getActiveTabId() for callers that only need
 * a yes/no. Prefer getActiveTabId() for new code — the sentinel shape is
 * the authoritative contract.
 */
export function isTabActiveInMainDrawer(tabId: string): boolean {
  const active = getActiveTabId()
  if (active.state === 'active') return active.id === tabId
  return false
}

/**
 * Switch the main drawer to a fallback tab before moving the active extension
 * tab to the secondary sidebar. Without this, the previous ExtensionTabContent
 * stays mounted with an empty container (its useEffect dep [tab] is unchanged
 * after a DOM-move, so it doesn't re-fire), and the main panel renders a
 * stale header + empty body.
 *
 * Strategy: find the button immediately before the moved tab's button in the
 * main sidebar DOM, and click it. This is the user's expected behavior —
 * "the next panel whose tab was above or beneath" — and triggers Lumiverse's
 * real onClick → setDrawerTab + openDrawer flow.
 *
 * If the moved tab is the FIRST tab in the sidebar, fall back to the button
 * immediately after. If no neighbor exists (degenerate case), fall back to
 * the first built-in tab button. If even that fails, proceed without
 * switching (preserves the original buggy behavior rather than dead-locking).
 */
/**
 * Phase 4 (finding #10): unified drawer-fallback switcher. Replaces the
 * separate `switchMainDrawerToFallback` and the (as-yet-unwritten) secondary
 * counterpart. The two-RAF wait is only needed for `'main'` because React
 * unmounts the old `ExtensionTabContent` asynchronously there. For `'secondary'`
 * the call is synchronous — the moved tab's node guard and the panel's
 * synchronous state update are enough to detach the node.
 */
export function switchDrawerToFallback(side: 'main' | 'secondary', tabId: string, then: () => void): void {
  if (side === 'secondary') {
    // Phase 4 (finding #2): when the moved tab is the active secondary tab,
    // there is no fallback drawer to switch — restoreTabToPrimary already
    // handles the neighbor-tab fall-through via _activeSecondaryTabId.
    // Just invoke then() synchronously.
    then()
    return
  }
  // side === 'main' — legacy logic, preserved verbatim from the previous
  // switchMainDrawerToFallback implementation.
  const sidebar = getMainSidebar()
  if (!sidebar) {
    dwarn('switchDrawerToFallback(main): no main sidebar found')
    then()
    return
  }

  const allButtons = Array.from(sidebar.querySelectorAll('button[class*="tabBtn"]')) as HTMLElement[]

  let movedBtnIdx = allButtons.findIndex((b) => b.getAttribute('data-tab-id') === tabId)
  if (movedBtnIdx === -1) {
    const movedTab = getDrawerTabs().find((t: any) => t.id === tabId)
    const movedTitle = movedTab?.title
    if (movedTitle) {
      movedBtnIdx = allButtons.findIndex((b) => b.getAttribute('title') === movedTitle)
      if (movedBtnIdx === -1) {
        dwarn(`switchDrawerToFallback(main): no button for id="${tabId}" (title="${movedTitle}") found, proceeding without switching`)
        then()
        return
      }
      dwarn(`switchDrawerToFallback(main): id-match missed for ${tabId}, fell back to title-match — tagMainSidebarButtons may not have run yet`)
    } else {
      dwarn(`switchDrawerToFallback(main): no tab in store for id=${tabId}, proceeding without switching`)
      then()
      return
    }
  }

  // Prefer the previous button (the one rendered immediately above the moved
  // tab in the tab list). If the moved tab is the first, use the next button.
  let fallbackBtn: HTMLElement | undefined = allButtons[movedBtnIdx - 1]
  if (!fallbackBtn || fallbackBtn.style.display === 'none') {
    fallbackBtn = allButtons[movedBtnIdx + 1]
  }
  if (!fallbackBtn || fallbackBtn.style.display === 'none') {
    fallbackBtn = allButtons.find(
      (b) => b.style.display !== 'none' && b.className.includes('tabBtn') && !b.className.includes('tabBtnExtension')
    )
  }
  if (!fallbackBtn) {
    dwarn('switchDrawerToFallback(main): no fallback button found, proceeding without switching')
    then()
    return
  }

  fallbackBtn.click()

  // Wait two animation frames before performing the move. The first RAF lets
  // React commit the setState (drawerTab change). The second RAF lets the
  // ExtensionTabContent unmount complete and detach tab.root from the DOM.
  // In rare cases React's commit is batched/deferred — if the node is still
  // attached to the main panel after two RAFs, the repositionTab call will
  // see parentElement !== secondaryContent and appendChild will still move
  // it (appendChild implicitly removes from previous parent). The triple
  // guard is what prevents the old container from reclaiming it.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      then()
    })
  })
}

/**
 * @deprecated Use switchDrawerToFallback('main', tabId, then) instead.
 * Thin alias kept so any out-of-tree caller (or future debug code) still works.
 */
export function switchMainDrawerToFallback(tabId: string, then: () => void): void {
  switchDrawerToFallback('main', tabId, then)
}

/**
 * Phase 4 (finding #1): the policy layer for tab assignment. Wraps the pure
 * DOM move (repositionTab) with state updates, button affordances, optional
 * drawer open/close, optional active-tab switching, and optional save.
 *
 * Defaults are tuned for the context-menu call site (user-initiated move):
 *   open: true, switchActive: true, save: true
 * applyLayout uses different defaults (open: false, switchActive: false, save: false)
 * to avoid double-animating the drawer or rewriting a layout we just loaded.
 */
export function applyAssignment(tabId: string, target: 'primary' | 'secondary', options: {
  open?: boolean
  switchActive?: boolean
  save?: boolean
} = {}): void {
  const opts = { open: true, switchActive: true, save: true, ...options }
  dlog(`applyAssignment: ${tabId} → ${target} (open=${opts.open}, switchActive=${opts.switchActive}, save=${opts.save})`)

  // 1. State: record the assignment
  _tabAssignments.set(tabId, target)

  // 2. Button affordances: hide in main / show in secondary
  if (target === 'secondary') {
    hideMainTabButton(tabId)
    const tabs = getDrawerTabs()
    const tab = tabs.find(t => t.id === tabId)
    if (tab) addSecondaryTabButton(tab)
  } else {
    showMainTabButton(tabId)
    removeSecondaryTabButton(tabId)
  }
  updateDrawerTabVisibility()

  // 3. The main-drawer-fallback trick: if we're moving a tab that's
  // currently rendered in the main drawer, switch the drawer to a
  // neighboring tab first (after two RAFs) so React unmounts the old
  // ExtensionTabContent and tab.root detaches from the main panel.
  // Otherwise the main panel would render a header with the moved tab's
  // name and an empty body (the bug Solution C fixed).
  const doMove = () => {
    repositionTab(tabId, target)
    if (target === 'secondary') {
      if (opts.switchActive) {
        showSecondaryTab(tabId)
      }
    }
  }

  if (target === 'secondary' && opts.switchActive && isTabActiveInMainDrawer(tabId)) {
    switchDrawerToFallback('main', tabId, doMove)
  } else if (target === 'primary' && opts.switchActive) {
    // For 'primary', the chain is: reposition → if was active, neighbor
    // fall-through happens in restoreTabToPrimary.
    restoreTabToPrimary(tabId)
    // If no more tabs in secondary, close it
    const hasRemaining = [...getTabAssignments().values()].some(v => v === 'secondary')
    if (!hasRemaining && isSecondarySidebarOpen()) {
      closeSecondarySidebar()
    }
  } else {
    // Direct call: no active-tab dance needed. For primary, still need
    // restoreTabToPrimary to clean up saved styles + overflow.
    if (target === 'primary') {
      restoreTabToPrimary(tabId)
    } else {
      doMove()
    }
  }

  // 4. Open the drawer if requested. Skip if the drawer is already open
  // or the user is closing it.
  if (target === 'secondary' && opts.open && !isSecondarySidebarOpen()) {
    openSecondarySidebar()
  }

  // 5. Save (debounced via persistLayout).
  if (opts.save) {
    persistLayout()
  }
}

/**
 * Phase 4 (finding #1): one-line wrapper around applyAssignment with the
 * defaults for a user-initiated context-menu move. Kept as a stable public
 * API — any caller (current or future) that just wants "move this tab to
 * that sidebar" doesn't need to know about the options.
 */
export function assignTab(tabId: string, sidebar: 'primary' | 'secondary') {
  return applyAssignment(tabId, sidebar, { open: true, switchActive: true, save: true })
}

// v1.3.0: tabId-keyed identification replaces the previous Node-keyed
// guard. The old `isTabMovedToSecondary(node)` compared a Node reference
// against the cached `tab.root` field — and the cache has a 3s TTL, so a
// React re-mount that produced a new `tab.root` would land in the gap and
// the guard would let React reclaim the new Node. The new layer:
//
//   1. `isMovedTabId(tabId)` — pure: returns true iff this tabId is currently
//      assigned to the secondary sidebar. No DOM lookup, no cache dependency.
//   2. `isMovedTabNode(node)` — what the wrapped container methods call.
//      Forces a fresh store read (findStoreData(true)) and reverse-resolves
//      the Node to a tabId via the live store's `tab.root`. Then delegates
//      to `isMovedTabId`. The forced refresh closes the 3s TTL window.
//
// The reverse-resolution still goes through `_drawerTabsCache` because React
// hands us a Node and we have no other way to ask "which tab is this?".
// But the *authoritative* key in `_tabAssignments` is the stable tabId, so
// the timing window is bounded to a single forced fiber walk (~1-2ms), not
// the 3s TTL.

export function isMovedTabId(tabId: string): boolean {
  return _tabAssignments.get(tabId) === 'secondary'
}

export function isMovedTabNode(node: Node): boolean {
  // Force a fresh store read so the Node → tabId mapping is current.
  // Guards fire on React DOM mutations, which can happen many times per
  // re-render but only briefly during a move — total overhead is small.
  findStoreData(true)
  const tabs = getDrawerTabs()
  const tab = tabs.find((t: any) => t.root === node)
  if (!tab) return false
  return isMovedTabId(tab.id)
}

// Tracks which container currently has the guard installed. If React
// replaces the main panel content element (e.g. on a drawer re-render), the
// guard's `__sidebarUxGuarded` marker is on the old (detached) container
// and the new container is unguarded. `ensureNodeGuard` detects this and
// re-installs the guard on the current container.
let _guardedContainer: HTMLElement | null = null

/**
 * Install (or re-install) the React-reclaim guard on the current main panel
 * content container. Idempotent: no-op if the guard is already on the
 * current container. Re-installs (and forgets the old container) if the
 * container has been replaced since the last install.
 */
function ensureNodeGuard(): void {
  const mainContent = getMainPanelContent()
  if (!mainContent) return
  if (mainContent === _guardedContainer) return
  // Container changed (or first install). The old container (if any) is
  // detached and will be GC'd along with its guard methods. We don't
  // attempt to restore the originals — the container is gone.
  _guardedContainer = null
  installNodeGuard(mainContent)
  _guardedContainer = mainContent
}

function installNodeGuard(container: Node) {
  if ((container as any).__sidebarUxGuarded) return
  ;(container as any).__sidebarUxGuarded = true

  const origRemoveChild = container.removeChild.bind(container)
  container.removeChild = function(child: Node) {
    if (isMovedTabNode(child)) return child as any
    return origRemoveChild(child)
  } as any

  // Guard replaceChildren — this is what ExtensionTabContent.useEffect calls
  const origReplaceChildren = (container as any).replaceChildren?.bind(container)
  if (origReplaceChildren) {
    ;(container as any).replaceChildren = function(...nodes: Node[]) {
      const filtered = nodes.filter(n => !isMovedTabNode(n))
      return origReplaceChildren(...filtered)
    }
  }

  // Guard appendChild — React may also use this to re-add nodes
  const origAppendChild = container.appendChild.bind(container)
  container.appendChild = function(child: Node) {
    if (isMovedTabNode(child)) return child
    return origAppendChild(child)
  } as any
}

/**
 * Phase 4 (finding #1) + v1.3.0: pure DOM move — moves a tab's root element
 * between sidebars WITHOUT touching state, buttons, save, or open/close.
 * The policy layer (applyAssignment) wraps this with the side effects.
 *
 * v1.3.0 changes:
 *   - Forces a fresh store read at the top so we operate on the current
 *     `tab.root`, not a cached reference from a re-mount in flight.
 *   - Re-installs the React-reclaim guard on the main panel content
 *     container if it has been replaced since the last move.
 *   - Sweeps the destination container for any prior copy of this tabId
 *     (tagged with `data-canvas-moved`) and removes it, closing the
 *     "two copies" symptom when a stale orphan exists.
 *   - Tags the moved Node with `data-canvas-moved="${tabId}"` so the next
 *     move can find and remove it. The attribute is preserved by React's
 *     reconciler (Lumiverse's `ExtensionTabContent` does not manage it).
 *   - `_originalParents` is keyed on `tabId` (stable across re-mounts),
 *     not on `tab.root`.
 *
 * Returns true on success, false if the tab or target container is missing.
 */
export function repositionTab(tabId: string, target: 'primary' | 'secondary'): boolean {
  // Force a fresh store read so we operate on the current `tab.root`, not
  // a stale cached reference from a re-mount in flight. This is the
  // single change that closes the 3s-TTL timing window.
  findStoreData(true)
  const tabs = getDrawerTabs()
  const tab = tabs.find(t => t.id === tabId)
  if (!tab?.root) {
    dwarn(`repositionTab: tab not found for id=${tabId}`)
    return false
  }

  if (target === 'secondary') {
    const secondaryWrapper = getSecondaryWrapper()
    const secondaryContent = secondaryWrapper?.querySelector('.sidebar-ux-panel-content') as HTMLElement
    if (!secondaryContent) {
      dwarn('repositionTab: no secondary content area')
      return false
    }
    // Re-install the React-reclaim guard if the main panel content
    // container has been replaced. installNodeGuard itself is idempotent;
    // ensureNodeGuard adds the container-swap detection on top.
    ensureNodeGuard()
    // Record the original parent by tabId. If a prior entry exists (e.g.
    // tab was moved away, restored, moved again), keep the first
    // recording so the next restore still finds the right target.
    if (!_originalParents.has(tabId)) {
      _originalParents.set(tabId, tab.root.parentElement as HTMLElement)
    }
    if (tab.root.parentElement !== secondaryContent) {
      // Sweep: remove any prior copy of this tabId that is already in the
      // secondary content area. The `data-canvas-moved` attribute is set
      // by an earlier move and is preserved by React's reconciler. If
      // there is no prior copy, this is a no-op query.
      secondaryContent.querySelectorAll(`[data-canvas-moved="${cssEscape(tabId)}"]`)
        .forEach(n => n.remove())
      secondaryContent.appendChild(tab.root)
      tab.root.setAttribute('data-canvas-moved', tabId)
    }
    tab.root.style.setProperty('width', '100%', 'important')
    tab.root.style.setProperty('height', '100%', 'important')
    tab.root.style.setProperty('display', '', 'important')
    return true
  } else {
    // target === 'primary' — restore from secondary back to the original
    // parent in the main sidebar. If the recorded parent has been detached
    // (React re-mounted the tab while it was in secondary), fall back to
    // the current main panel content so the tab is still reachable.
    const orig = _originalParents.get(tabId)
    const targetEl = (orig && orig.isConnected) ? orig : getMainPanelContent()
    if (!targetEl) {
      dlog(`repositionTab: no original parent and no main panel content for tabId=${tabId} — tab will be detached`)
      return false
    }
    if (tab.root.parentElement !== targetEl) {
      targetEl.appendChild(tab.root)
    }
    // Clear the tabId-keyed entry — the tab is back home, no need to
    // remember the original parent. The next move-to-secondary will
    // record the (possibly new) parent again.
    _originalParents.delete(tabId)
    // Remove the move tag — the tab is back in primary and should not
    // participate in future secondary sweeps. If a re-mount later
    // produces a new Node, the next move will re-tag it.
    tab.root.removeAttribute('data-canvas-moved')
    return true
  }
}

/**
 * @deprecated Use repositionTab(tabId, 'secondary') instead. Kept as a
 * thin wrapper for callers that haven't been migrated yet.
 */
export function repositionTabToSecondary(tabId: string) {
  repositionTab(tabId, 'secondary')
}

// Phase 4 (finding #2): state tracking which secondary tab is currently
// visible in the secondary panel content area. Updated by showSecondaryTab.
// Used by restoreTabToPrimary to fall through to a neighbor tab when the
// active secondary tab is moved back to primary, preventing the "ghost tab"
// (header still showing the moved tab's name with an empty body).
let _activeSecondaryTabId: string | null = null
export function getActiveSecondaryTabId(): string | null { return _activeSecondaryTabId }

export function restoreTabToPrimary(tabId: string) {
  const tabs = getDrawerTabs()
  const tab = tabs.find(t => t.id === tabId)
  if (!tab || !tab.root) return

  // v1.3.0: previously this function cleared `__sidebarUxResizeHandler` and
  // `__sidebarUxPositionUpdate` properties hung off `tab.root`, plus read
  // from an always-empty `_savedStyles` Map. Both paths were dead code
  // (the properties were never assigned, the Map was never populated) and
  // are removed. Original styles on the moved Node are now cleared by
  // `repositionTab` via `removeAttribute('data-canvas-moved')`.

  // Phase 4 (finding #2): use the centralized repositionTab which now also
  // handles the tabId-keyed original parent tracking. Falls back to
  // getMainPanelContent() if the recorded parent was detached.
  repositionTab(tabId, 'primary')

  // Phase 4 (finding #2): if the restored tab was the active secondary tab,
  // fall through to a neighbor so the secondary panel doesn't end up
  // showing the moved tab's name in an empty content area.
  if (_activeSecondaryTabId === tabId) {
    // Find the next visible secondary tab in the assignment list, skipping
    // the one we just moved. Iterate _tabAssignments in insertion order to
    // keep a stable "next" pick.
    let neighborId: string | null = null
    for (const [tid, side] of _tabAssignments) {
      if (side === 'secondary' && tid !== tabId) {
        neighborId = tid
        break
      }
    }
    if (neighborId) {
      dlog(`restoreTabToPrimary: falling through to neighbor tab ${neighborId}`)
      showSecondaryTab(neighborId)
    } else {
      dlog('restoreTabToPrimary: no neighbor tab in secondary; clearing panel header')
      clearSecondaryTab()
    }
  }

  // Restore overflow on ancestors
  restoreOverflow(tab.root)
}

/**
 * Phase 4 (finding #2): hide the secondary panel header and content when
 * no tab is assigned. Used by restoreTabToPrimary when the last secondary
 * tab is moved out. Mirrors the empty-state behavior of Lumiverse's
 * main drawer when no tab is active.
 */
function clearSecondaryTab() {
  const secondaryWrapper = getSecondaryWrapper()
  const title = secondaryWrapper?.querySelector('.sidebar-ux-panel-title')
  if (title) title.textContent = ''
  const allBtns = secondaryWrapper?.querySelectorAll('.sidebar-ux-tab-list button[data-tab-id]') as NodeListOf<HTMLElement>
  if (allBtns) {
    for (const btn of allBtns) {
      btn.classList.remove('sidebar-ux-tab-active')
      btn.style.color = ''
      btn.style.background = ''
      btn.style.boxShadow = ''
      btn.style.borderRadius = ''
      const label = btn.querySelector('.sidebar-ux-tab-label') as HTMLElement
      if (label) label.style.color = ''
    }
  }
  // Hide all tab roots in the panel content
  for (const [, sidebar] of _tabAssignments) {
    if (sidebar !== 'secondary') continue
    const tabs = getDrawerTabs()
    for (const t of tabs) {
      if (t.root) t.root.style.setProperty('display', 'none', 'important')
    }
  }
  _activeSecondaryTabId = null
}

/**
 * Reposition all assigned tabs (called after secondary sidebar opens/resizes).
 */
export function repositionAssignedTabs() {
  for (const [tabId, sidebar] of _tabAssignments) {
    if (sidebar === 'secondary') {
      repositionTabToSecondary(tabId)
    }
  }
}

// Re-export of the cleanup accessor for callers that need to reset the
// _originalParents map. sidebar/cleanup imports it in Step 14.
