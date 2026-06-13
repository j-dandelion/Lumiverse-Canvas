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
import { getSecondaryWrapper, isSecondarySidebarOpen, openSecondarySidebar, closeSecondarySidebar, PUZZLE_ICON_SVG } from '../sidebar/secondary'
import {
  hideMainTabButton, showMainTabButton, findMainTabButton,
  addSecondaryTabButton, removeSecondaryTabButton, updateDrawerTabVisibility, showSecondaryTab,
  cssEscape, findSafeFallbackButton, isSettingsButton,
} from '../tabs/buttons'
import { persistLayout } from '../layout/persist'
import {
  _setTabAssignmentsGetter,
  getActiveTabId,
  isTabActiveInMainDrawer,
  getActiveSecondaryTabId,
  setActiveSecondaryTabId,
} from './active-tab'
import { installNodeGuard, ensureNodeGuard } from './node-guard'

// Wire the active-tab getter so isMovedTabId can read the assignments
// without a circular import.
_setTabAssignmentsGetter(() => _tabAssignments)

// Re-export for backward compatibility — callers that import from
// tabs/assignment still get the same symbols.
export { isTabActiveInMainDrawer, getActiveSecondaryTabId, setActiveSecondaryTabId }
export { isMovedTabNode, type ActiveTabState } from './active-tab'
export { installNodeGuard, ensureNodeGuard } from './node-guard'

// Maps tab ID → which sidebar it belongs to
const _tabAssignments: Map<string, 'primary' | 'secondary'> = new Map()

// Accessors used by other modules (sidebar/secondary, sidebar/drawer-sync,
// context-menu, layout/persist).
export function getTabAssignments(): Map<string, 'primary' | 'secondary'> { return _tabAssignments }
export function hasTabAssignment(tabId: string): boolean { return _tabAssignments.has(tabId) }
export function clearTabAssignments(): void { _tabAssignments.clear() }

/** Encapsulated mutation: set a tab assignment without exposing the mutable Map. */
export function setTabAssignment(tabId: string, panelId: 'primary' | 'secondary'): void {
  _tabAssignments.set(tabId, panelId)
}

/** Encapsulated mutation: delete a tab assignment without exposing the mutable Map. */
export function deleteTabAssignment(tabId: string): void {
  _tabAssignments.delete(tabId)
}

export function getTabSidebar(tabId: string): 'primary' | 'secondary' {
  return _tabAssignments.get(tabId) || 'primary'
}

// v1.3.0: tabId-keyed Map tracking each tab's original parent in the main
// sidebar, replacing the previous Node-keyed WeakMap. The tabId is stable
// across React re-mounts of ExtensionTabContent; the DOM Node is not.
const _originalParents: Map<string, HTMLElement> = new Map()
export function clearOriginalParents(): void { _originalParents.clear() }

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

  // Pick a safe fallback: prefer the visible built-in tab immediately
  // adjacent to the moved tab. Skip non-visible buttons, extension tabs,
  // and the Lumiverse Settings tab. The Settings tab is excluded because
  // clicking it opens the Settings panel AND fails to swap the drawer's
  // drawerTab — after the 2-RAF wait, repositionTab physically moves
  // the tab's DOM node out of the main panel content, leaving a stale
  // header with an empty body (the "ghost panel" reported when the
  // only extension tab is moved out while focused).
  //
  // First walk backward from the moved tab: the button immediately
  // before the moved tab is the user's expected "next panel" when
  // removing a tab. If no safe candidate is found before the start of
  // the list, walk forward. The final fallback (no neighbor at all)
  // uses findSafeFallbackButton to pick the first safe built-in tab
  // anywhere in the sidebar.
  const isSafeCandidate = (b: HTMLElement | undefined): b is HTMLElement => {
    if (!b) return false
    if (b.style.display === 'none') return false
    if (!b.className.includes('tabBtn')) return false
    if (b.className.includes('tabBtnExtension')) return false
    return !isSettingsButton(b)
  }
  let fallbackBtn: HTMLElement | null = null
  for (let offset = -1; offset >= -(movedBtnIdx) && !fallbackBtn; offset--) {
    fallbackBtn = isSafeCandidate(allButtons[movedBtnIdx + offset]) ? allButtons[movedBtnIdx + offset] : null
  }
  if (!fallbackBtn) {
    for (let offset = 1; offset < allButtons.length - movedBtnIdx && !fallbackBtn; offset++) {
      fallbackBtn = isSafeCandidate(allButtons[movedBtnIdx + offset]) ? allButtons[movedBtnIdx + offset] : null
    }
  }
  if (!fallbackBtn) {
    fallbackBtn = findSafeFallbackButton(sidebar)
  }
  if (!fallbackBtn) {
    dwarn('switchDrawerToFallback(main): no safe fallback button found, proceeding without switching')
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
  const activeState = getActiveTabId()
  const originalActiveTabId = activeState.state === 'active' ? activeState.id : null
  const wasActive = isTabActiveInMainDrawer(tabId)
  // Capture the restore-target button reference BEFORE any DOM changes.
  // findMainTabButton reads getMainSidebar() which uses a [data-spindle-mount="sidebar"]
  // selector; if React is mid-render or the main drawer was temporarily affected by
  // the move, that selector can return null and the restore click would silently fail.
  const originalActiveTabButton = (originalActiveTabId && originalActiveTabId !== tabId)
    ? findMainTabButton(originalActiveTabId)
    : null

  // 1. State: record the assignment
  _tabAssignments.set(tabId, target)

  // 2. Button affordances: hide in main / show in secondary
  if (target === 'secondary') {
    hideMainTabButton(tabId)
    const tabs = getDrawerTabs()
    let tab = tabs.find(t => t.id === tabId)
    if (!tab) {
      // LumiScript interference: store returns only the dock panel. Build a
      // synthetic descriptor from the button so the secondary button can be added.
      const btn = findMainTabButton(tabId)
      if (btn) {
        // Read the icon from the main button's inner <svg> (Lumiverse renders
        // the extension's iconSvg there). Fall back to PUZZLE_ICON_SVG if
        // the button has no inner svg (e.g. icon is a CSS background image
        // or the tab has no icon).
        const btnSvg = btn.querySelector('svg')
        const iconSvg = btnSvg ? btnSvg.outerHTML : PUZZLE_ICON_SVG
        // Derive shortName from the main button's visible text. When the
        // extension registered with `shortName: 'Books'`, Lumiverse renders
        // the short name as the button's visible text and the full title
        // in the `title` attribute. For tabs without a shortName, the
        // visible text equals the title, so shortName stays empty and
        // deriveShortName falls through to the title-truncation rule.
        const title = btn.getAttribute('title') || ''
        const btnText = (btn.textContent || '').trim()
        const shortName = btnText && btnText !== title ? btnText : ''
        tab = {
          id: tabId,
          title,
          root: null as any,
          iconSvg,
          shortName,
        } as any
      }
    }
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

  if (target === 'secondary' && opts.switchActive) {
    if (wasActive) {
      // Active case: doMove first (while content is in the main panel), then click a fallback.
      doMove()
      setTimeout(() => switchDrawerToFallback('main', tabId, () => {}), 16)
    } else {
      // Non-active case: activate, wait for content to mount, move, then restore original.
      const btn = findMainTabButton(tabId)
      if (btn) {
        ;(btn as HTMLElement).click()
        // 80ms setTimeout + rAF. 2-RAF alone was too short — React needs more time
        // to commit the drawerTab state change, render the new ExtensionTabContent,
        // and have the LumiBooks content fully mount in the main panel. The DOM-walk
        // fallback in repositionTab needs the new content to be present, otherwise
        // it finds the empty-state placeholder (_empty_*) and moves that instead.
        setTimeout(() => {
          requestAnimationFrame(() => {
            doMove()
            if (originalActiveTabButton) {
              (originalActiveTabButton as HTMLElement).click()
            } else if (originalActiveTabId && originalActiveTabId !== tabId) {
              // Fallback: re-resolve the button if the early capture returned null
              // (e.g., the original active tab was also an extension tab and the
              // store was broken when we captured the reference).
              const origBtn = findMainTabButton(originalActiveTabId)
              if (origBtn) (origBtn as HTMLElement).click()
            }
          })
        }, 80)
      } else {
        doMove()
      }
    }
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
  let tab = tabs.find(t => t.id === tabId)
  // LumiScript interference: getDrawerTabs() returns the dock panel.
  // Fall back to walking the DOM for the active content. Safe because
  // applyAssignment activates the tab (non-active case) or moves it while
  // still active (active case) before reaching this function.
  if (!tab?.root) {
    let fallbackRoot: HTMLElement | undefined
    if (target === 'secondary') {
      // Forward move: content is in the main panel (we activated the tab
      // before calling repositionTab). Look there.
      const mainPanel = getMainPanelContent()
      if (mainPanel) {
        // Build a candidate list with diagnostics so we can see what the
        // main panel contains at decision time. After a round-trip move
        // (secondary→primary→secondary) the panel has TWO wrappers: an
        // empty orphan (the moved-back root, emptied by React's
        // ExtensionTabContent useEffect replaceChildren) and the
        // React-managed wrapper (which holds tab.root). We must pick the
        // one with content, never the empty orphan.
        const allChildren = Array.from(mainPanel.children) as HTMLElement[]
        const candidates = allChildren.map((c, i) => `i${i}:cls="${c.className.slice(0, 30)}":cc=${c.childElementCount}`).join(', ')
        // First pass: skip _empty_* placeholders AND empty wrappers.
        let realContent = allChildren.find(c => !c.className.toLowerCase().includes('_empty_') && c.childElementCount > 0)
        // Second pass (fallback): if the strict filter rejects everything,
        // pick ANY child with content (might be an _empty_* wrapper with
        // children — the original LumiScript-recovery path). NEVER fall
        // back to children[0] unconditionally — that's the bug that picks
        // the empty orphan on round-trips.
        if (!realContent) {
          realContent = allChildren.find(c => c.childElementCount > 0)
        }
        fallbackRoot = realContent
      }
    } else {
      // Reverse move (restore-to-primary): content is in the secondary panel.
      // Look there by the `data-canvas-moved` attribute set by the forward
      // move. This works even when getDrawerTabs is broken (LumiScript
      // interference: store returns only the dock panel).
      const secondaryContent = getSecondaryWrapper()?.querySelector('.sidebar-ux-panel-content') as HTMLElement | null
      if (secondaryContent) {
        const movedRoot = secondaryContent.querySelector(`[data-canvas-moved="${cssEscape(tabId)}"]`) as HTMLElement | null
        if (movedRoot) fallbackRoot = movedRoot
      }
    }
    if (fallbackRoot) {
      tab = { id: tabId, title: '', root: fallbackRoot } as any
    }
  }
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
    // Position absolutely so the moved root overlaps the secondary content
    // area at top:0. With `position: relative` on the secondary content
    // container (added in sidebar/secondary.tsx), `inset: 0` anchors the
    // root to the padding box of the container — so the moved root fills
    // the content area regardless of how many other moved roots exist.
    // Inactive tabs are hidden via `display: none` in showSecondaryTab,
    // so only the active one is visible. This prevents the round-trip
    // bug where the second tab in a stack is positioned below the
    // visible area and appears empty until the user scrolls.
    tab.root.style.setProperty('position', 'absolute', 'important')
    tab.root.style.setProperty('inset', '0', 'important')
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
      // Remove the move marker BEFORE appendChild so installNodeGuard on
      // panelContent doesn't block this explicit restore. The guard exists
      // to prevent React's reconciliation from re-attaching a moved tab; an
      // explicit restore should bypass it. After this move the root is no
      // longer a "moved tab" so the second removeAttribute is a no-op.
      tab.root.removeAttribute('data-canvas-moved')
      targetEl.appendChild(tab.root)
    }
    // Clear the tabId-keyed entry — the tab is back home, no need to
    // remember the original parent. The next move-to-secondary will
    // record the (possibly new) parent again.
    _originalParents.delete(tabId)
    // Remove the move tag — the tab is back in primary and should not
    // participate in future secondary sweeps. If a re-mount later
    // produces a new Node, the next move will re-tag it.
    tab.root.removeAttribute('data-canvas-moved')  // keep this as a safety no-op
    return true
  }
}


export function restoreTabToPrimary(tabId: string) {
  let tabs = getDrawerTabs()
  let tab = tabs.find(t => t.id === tabId)
  if (!tab || !tab.root) {
    // LumiScript interference: getDrawerTabs() returns only the dock panel,
    // so the store never has extension tabs (LumiBooks, Hone). Build a
    // synthetic descriptor from the moved root in the secondary content
    // area (tagged with `data-canvas-moved` by repositionTab on the
    // forward move). The Canvas-owned attribute is the authoritative
    // source of truth here, more reliable than the store. If no moved
    // root is found, the tab is genuinely not in the secondary and we
    // bail out as before.
    const secondaryContent = getSecondaryWrapper()?.querySelector('.sidebar-ux-panel-content') as HTMLElement | null
    const movedRoot = secondaryContent?.querySelector(`[data-canvas-moved="${cssEscape(tabId)}"]`) as HTMLElement | null
    if (!movedRoot) {
      dwarn(`restoreTabToPrimary: tabId=${tabId} not found in store and no moved root in secondary`)
      return
    }
    tab = { id: tabId, title: '', root: movedRoot } as any
  }

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

  // Activate the restored tab in the main drawer with a guaranteed remount.
  // switchDrawerToFallback first switches to a safe neighbor (or does nothing
  // if the tab wasn't active), which changes main.drawerTab and forces
  // ExtensionTabContent to unmount/remount. Then we click the restored tab
  // to make it the active one. The remount is critical: if the tab was
  // already active in main (single-tab edge case where switchDrawerToFallback
  // failed during the forward move), a plain click would be a no-op and
  // the useEffect that re-attaches the root to containerRef would not run.
  switchDrawerToFallback('main', tabId, () => {
    const btn = findMainTabButton(tabId)
    if (btn) (btn as HTMLElement).click()
  })

  // Phase 4 (finding #2): if the restored tab was the active secondary tab,
  // fall through to a neighbor so the secondary panel doesn't end up
  // showing the moved tab's name in an empty content area.
  if (getActiveSecondaryTabId() === tabId) {
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
  // Hide tab roots that are in the secondary content area.
  // Target the container directly instead of iterating all store tabs —
  // the previous loop hid every root in the store when only the
  // secondary-assigned ones needed hiding.
  const content = secondaryWrapper?.querySelector('.sidebar-ux-panel-content') as HTMLElement
  if (content) {
    for (const child of Array.from(content.children) as HTMLElement[]) {
      child.style.setProperty('display', 'none', 'important')
    }
  }
  setActiveSecondaryTabId(null)
}

/**
 * Reposition all assigned tabs (called after secondary sidebar opens/resizes).
 */
export function repositionAssignedTabs() {
  for (const [tabId, sidebar] of _tabAssignments) {
    if (sidebar === 'secondary') {
      repositionTab(tabId, 'secondary')
    }
  }
}

// Re-export of the cleanup accessor for callers that need to reset the
// _originalParents map. sidebar/cleanup imports it.