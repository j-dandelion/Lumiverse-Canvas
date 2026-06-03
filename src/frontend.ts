import { mergeCanvasSettings, type CanvasSettings } from './types'
import {
  getMainSidebar,
  getMainDrawer,
  getMainPanel,
  getMainPanelContent,
  getMainWrapper,
  getAppElement,
  getChatColumn,
  getMainDrawerWidth,
} from './dom/lumiverse'
import { dlog, dwarn, getDebug, setDebug } from './debug/log'
import { findStoreData, getDrawerTabs, getStoreSnapshot, isMainDrawerOpen, getMainDrawerSide, clearStoreCache } from './store'
import { setChatMargin, injectReflowStyles, updateChatReflow, scheduleReflow, startReflowObserver } from './chat/reflow'
import { tagMainSidebarButtons, scheduleTagMainSidebarButtons } from './chat/tag-buttons'
import { hideMainTabButton, showMainTabButton, findMainTabButton, cssEscape, addSecondaryTabButton, removeSecondaryTabButton, updateDrawerTabVisibility, showSecondaryTab, deriveShortName } from './tabs/buttons'
import {
  createSecondarySidebar, mountSecondarySidebar, tearDownSecondarySidebar, openSecondarySidebar, closeSecondarySidebar,
  getSecondaryWrapper, isSecondarySidebarOpen, setSecondarySidebarOpen, unmountSecondarySidebar,
  injectDrawerTabStyles, animateWrapper, getClosedTransformPx, restoreOverflow, SECONDARY_WIDTH_VAR, PUZZLE_ICON_SVG,
} from './sidebar/secondary'
import { isMobile, createResizeHandle, mountResizeHandles, refreshResizeHandles, persistMainWidth, persistSecondaryWidth } from './resize/handles'
import { isShowTabLabels, syncDrawerTabSettings, syncSecondaryTabLabels, checkSideChanged, restoreSecondaryTabButtons, startSideChangeWatcher, stopSideChangeWatcher, startTabRegistrationWatcher, stopTabRegistrationWatcher, clearDrawerTabLayoutCache } from './sidebar/polish'

// --- Debug Logging ---
// See src/debug/log.ts for the dlog/dwarn/DEBUG implementation.
// This section is intentionally a stub after Step 2 of the decomposition.

// --- Settings (Canvas user preferences) ---
//
// Every user-togglable Canvas behavior reads from `_settings` instead of a
// hard-coded constant. `_settings` is hydrated in `setup()` from the layout
// blob (with defaults filled in by `mergeCanvasSettings`), and updated at
// runtime via `setSettings()` from the settings panel. `applySettings()`
// is the single live-update entry point — it diffs the previous and next
// state and mounts/unmounts the relevant features.
type FullCanvasSettings = Required<CanvasSettings>
let _settings: FullCanvasSettings = mergeCanvasSettings(null)
// Reference to the most recently loaded layout snapshot, used by
// applySettings to re-apply tab assignments after a master toggle re-creates
// the secondary wrapper.
let _lastLoadedLayout: any = null
// Persist debounce timer (separate from _saveLayoutTimer so a settings flip
// doesn't race with an in-flight open/close save).
let _saveSettingsTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Update one or more settings, persist the new state, and live-apply the diff.
 * Safe to call from the settings panel on every toggle change.
 */
function setSettings(patch: Partial<CanvasSettings>): void {
  const prev = _settings
  const next: FullCanvasSettings = { ...prev }
  for (const key of Object.keys(patch) as Array<keyof CanvasSettings>) {
    const v = patch[key]
    if (v !== undefined) (next as any)[key] = v
  }
  _settings = next
  // Update the in-memory DEBUG flag immediately — applySettings also does
  // this, but we want dlog() calls inside the same tick to see the new value.
  DEBUG = next.debugMode
  applySettings(prev, next)
  refreshSettingsPanel()
  persistSettings()
}

// Accessors (Step 0) — to be exported when settings/state.ts is extracted.
export function getSettings(): FullCanvasSettings { return _settings }
export function setLastLoadedLayout(layout: any): void { _lastLoadedLayout = layout }
export function getLastLoadedLayout(): any { return _lastLoadedLayout }

// Panel refresh registry (Step 0) — replaces window.__canvasPanelRefresh indirection.
let _panelRefresh: (() => void) | null = null
export function setPanelRefresh(fn: (() => void) | null): void { _panelRefresh = fn }

/**
 * Diff previous and next settings, applying live effects for any that
 * changed. Idempotent: calling with prev === next is a no-op.
 */
function applySettings(prev: FullCanvasSettings, next: FullCanvasSettings): void {
  // 1. Debug mode — flip the global flag and install/uninstall the escape hatch.
  if (prev.debugMode !== next.debugMode) {
    setDebug(next.debugMode)
    if (next.debugMode) {
      installDebugEscapeHatch()
    } else {
      delete (window as any).__canvasDebug
    }
  }

  // 2. Chat reflow — toggle the injected style block + recompute margins.
  if (prev.chatReflow !== next.chatReflow) {
    if (next.chatReflow) {
      injectReflowStyles()
      updateChatReflow()
    } else {
      const el = document.getElementById('sidebar-ux-reflow')
      if (el) el.remove()
      // Clear any leftover chat margins so columns stop being pushed.
      const chat = getChatColumn()
      if (chat) {
        chat.style.removeProperty('--sidebar-ux-chat-ml')
        chat.style.removeProperty('--sidebar-ux-chat-mr')
      }
    }
  }

  // 3. Second Sidebar master — mount/unmount the wrapper + restore layout.
  if (prev.secondSidebarEnabled !== next.secondSidebarEnabled) {
    if (next.secondSidebarEnabled) {
      if (!getSecondaryWrapper()) {
        const initialWidth = getLastLoadedLayout()?.secondary?.width
        const initialOpen = getLastLoadedLayout()?.secondary?.open === true
        mountSecondarySidebar({ initialWidth, initialOpen })
        if (getLastLoadedLayout()) applyLayout(getLastLoadedLayout())
      }
    } else {
      tearDownSecondarySidebar()
    }
  }

  // 4. Resize handles — both drawers, single toggle.
  if (prev.resizeSidebars !== next.resizeSidebars) {
    refreshResizeHandles()
  }

  // 5. Auto-mirror on side swap — start/stop the side watcher.
  if (prev.autoMirrorOnSideSwap !== next.autoMirrorOnSideSwap) {
    if (next.autoMirrorOnSideSwap) {
      startSideChangeWatcher()
    } else {
      stopSideChangeWatcher()
    }
  }

  // 6. Mirror compact position — re-sync after a flip.
  if (prev.mirrorCompactPosition !== next.mirrorCompactPosition) {
    if (next.mirrorCompactPosition) {
      syncDrawerTabSettings()
    } else {
      const drawerTab = getSecondaryWrapper()?.querySelector('.sidebar-ux-drawer-tab') as HTMLElement
      if (drawerTab) {
        drawerTab.style.marginTop = ''
        clearDrawerTabLayoutCache()
      }
    }
  }

  // 7. Tab labels — re-sync secondary tab button labels.
  if (prev.showTabLabels !== next.showTabLabels) {
    syncSecondaryTabLabels()
  }

  // 8. Consistent icon size — toggle the CSS rule.
  if (prev.consistentIconSize !== next.consistentIconSize) {
    if (!next.consistentIconSize) {
      const el = document.getElementById('sidebar-ux-drawer-tab-styles')
      if (el) el.remove()
    } else {
      injectDrawerTabStyles()
    }
  }

  // 9. Smooth transitions — toggle the chat-column transition rule.
  if (prev.smoothTransitions !== next.smoothTransitions) {
    const reflow = document.getElementById('sidebar-ux-reflow')
    if (reflow) {
      reflow.textContent = next.smoothTransitions
        ? `
          [class*="_chatColumn_"] {
            margin-left: var(--sidebar-ux-chat-ml, 0px) !important;
            margin-right: var(--sidebar-ux-chat-mr, 0px) !important;
            transition: margin 0.35s cubic-bezier(0.4, 0, 0.2, 1) !important;
          }
        `
        : `
          [class*="_chatColumn_"] {
            margin-left: var(--sidebar-ux-chat-ml, 0px) !important;
            margin-right: var(--sidebar-ux-chat-mr, 0px) !important;
            transition: none !important;
          }
        `
    }
  }

  // 10. Settings that don't need live effects (apply on next reload):
  //   - layoutPersistence: read by persistLayout/persistOpenState
  //   - autoCleanupOnUninstall: read by startTabRegistrationWatcher's check
  // The settings panel re-renders to reflect the new value, and the next
  // mount/load cycle reads the updated value from _settings.
}

/** Debounced persistence of the current settings (merged into the layout blob). */
function persistSettings(): void {
  const backendCtx = getBackendCtx()
  if (!backendCtx) return
  if (_saveSettingsTimer !== null) {
    clearTimeout(_saveSettingsTimer)
  }
  _saveSettingsTimer = setTimeout(() => {
    _saveSettingsTimer = null
    // Persist via the same SAVE_LAYOUT IPC; the settings field rides on the
    // existing layout blob. The other layout fields (primary, secondary,
    // detachedTabs) come from snapshotLayout() so we don't drop them.
    const layout = { ...snapshotLayout(), settings: _settings }
    backendCtx.sendToBackend({ type: 'SAVE_LAYOUT', layout })
  }, 300)
}

// --- DOM Helpers ---

// --- Store Access ---

// All Zustand store access lives in src/store/index.ts (findStoreData,
// getDrawerTabs, getStoreSnapshot, isMainDrawerOpen, getMainDrawerSide,
// clearStoreCache). This section is intentionally empty after Step 3 of
// the decomposition.

// --- Secondary Sidebar ---

// All secondary-sidebar code lives in src/sidebar/secondary.tsx (Step 9 of
// the decomposition). This section is intentionally empty.// --- Chat Reflow ---

// All chat reflow + main-sidebar button tagging code lives in
// src/chat/reflow.ts (Step 4 of the decomposition).
// injectDrawerTabStyles is still defined here and will move to
// sidebar/secondary.tsx in Step 9.

function injectDrawerTabStyles() {
  if (document.getElementById('sidebar-ux-drawer-tab-styles')) return
  const style = document.createElement('style')
  style.id = 'sidebar-ux-drawer-tab-styles'
  style.textContent = `
    .sidebar-ux-drawer-tab {
      flex-shrink: 0;
      align-self: flex-start;
      width: 48px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 16px 8px 20px;
      background: var(--lcs-glass-bg, var(--lumiverse-bg));
      border: 1px solid var(--lumiverse-border-hover);
      color: var(--lumiverse-text-muted);
      cursor: pointer;
      pointer-events: auto;
      transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease;
    }
    .sidebar-ux-drawer-tab:hover {
      background: var(--lumiverse-bg-hover, var(--lumiverse-bg));
      border-color: var(--lumiverse-primary-050);
      color: var(--lumiverse-text);
    }
    .sidebar-ux-drawer-tab--active {
      background: var(--lumiverse-bg-hover, var(--lumiverse-bg));
      border-color: var(--lumiverse-primary-050);
      color: var(--lumiverse-text);
    }
    .sidebar-ux-drawer-tab--active:hover {
      background: var(--lumiverse-bg-hover, var(--lumiverse-bg));
      border-color: var(--lumiverse-primary-050);
      color: var(--lumiverse-text);
    }
    .sidebar-ux-drawer-tab--compact {
      width: 32px;
      padding: 8px 6px;
      gap: 0;
    }
    .sidebar-ux-drawer-tab-icon {
      color: var(--lumiverse-primary);
    }
    /* Force a 20×20 size on the tab-list SVG icons. Extensions that
       provide iconSvg without intrinsic width/height attributes (e.g. Hone)
       render at 0×0 by default — Lumiverse's main sidebar gets around this
       via its own CSS, but Canvas's tab list doesn't inherit that rule.
       Sizing via CSS catches all current and future extensions, and matches
       the existing CSS-injection pattern. */
    .sidebar-ux-tab-list button[data-tab-id] > span > svg {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }
  `
  document.head.appendChild(style)
}

// --- Tab Assignment System (CSS Transform Approach) ---

// Maps tab ID → which sidebar it belongs to
const _tabAssignments: Map<string, 'primary' | 'secondary'> = new Map()
// Accessors (Step 0) — to be exported when tabs/assignment.ts is extracted.
export function getTabAssignments(): ReadonlyMap<string, 'primary' | 'secondary'> { return _tabAssignments }
export function hasTabAssignment(tabId: string): boolean { return _tabAssignments.has(tabId) }
export function clearTabAssignments(): void { _tabAssignments.clear() }

function getTabSidebar(tabId: string): 'primary' | 'secondary' {
  return _tabAssignments.get(tabId) || 'primary'
}

/**
 * Detect whether `tabId` is the currently-active tab in the main drawer.
 *
 * The store's `drawerTab` value is the source of truth, but the Zustand store
 * is not always reachable via fiber walk (the spinner race or the way the
 * store is referenced from the active component tree). Fall back to a
 * DOM-based check: find the main sidebar button with the `tabBtnActive` class
 * and compare its `title` attribute to the moved tab's title.
 *
 * For extension tabs, the title is the extension tab's `title` from the store
 * (e.g. "LumiBooks"), NOT the internal `tabId`. For built-in tabs, the title
 * is the translated `tabName` (also discoverable via the store).
 */
/**
 * Discriminated union describing the active-tab state of the main drawer.
 * Replaces the 3-deep nested-if + DOM-fallthrough of the old `isTabActiveInMainDrawer`.
 *
 * - `closed`   — drawer is not open
 * - `active`   — drawer is open, and the active tab is `id`
 * - `other`    — drawer is open, but a different tab (`id`) is active
 * - `unknown`  — store is unreachable AND DOM is unreachable (defensive)
 */
type ActiveTabState =
  | { state: 'closed' }
  | { state: 'active'; id: string }
  | { state: 'other'; id: string }
  | { state: 'unknown' }

function getActiveTabId(): ActiveTabState {
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
function isTabActiveInMainDrawer(tabId: string): boolean {
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
function switchDrawerToFallback(side: 'main' | 'secondary', tabId: string, then: () => void): void {
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
function switchMainDrawerToFallback(tabId: string, then: () => void): void {
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
function applyAssignment(tabId: string, target: 'primary' | 'secondary', options: {
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
  if (target === 'secondary' && opts.open && !_secondarySidebarOpen) {
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
function assignTab(tabId: string, sidebar: 'primary' | 'secondary') {
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

function isMovedTabId(tabId: string): boolean {
  return _tabAssignments.get(tabId) === 'secondary'
}

function isMovedTabNode(node: Node): boolean {
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
function repositionTab(tabId: string, target: 'primary' | 'secondary'): boolean {
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
    const secondaryContent = _secondaryWrapper?.querySelector('.sidebar-ux-panel-content') as HTMLElement
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
function repositionTabToSecondary(tabId: string) {
  repositionTab(tabId, 'secondary')
}

// Phase 4 (finding #2): state tracking which secondary tab is currently
// visible in the secondary panel content area. Updated by showSecondaryTab.
// Used by restoreTabToPrimary to fall through to a neighbor tab when the
// active secondary tab is moved back to primary, preventing the "ghost tab"
// (header still showing the moved tab's name with an empty body).
let _activeSecondaryTabId: string | null = null
// Accessor (Step 0) — to be exported when tabs/assignment.ts is extracted.
export function getActiveSecondaryTabId(): string | null { return _activeSecondaryTabId }

/**
 * Restore a tab's root element to its original parent in the primary sidebar.
 */
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
  const title = _secondaryWrapper?.querySelector('.sidebar-ux-panel-title')
  if (title) title.textContent = ''
  const allBtns = _secondaryWrapper?.querySelectorAll('.sidebar-ux-tab-list button[data-tab-id]') as NodeListOf<HTMLElement>
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
// FIXME-decomp(step 10): note — this function will be re-exported from tabs/assignment after Step 10
  for (const [tabId, sidebar] of _tabAssignments) {
    if (sidebar === 'secondary') {
      repositionTabToSecondary(tabId)
    }
  }
}

// --- Tab Button Management ---

// All tab button management code lives in src/tabs/buttons.ts (Step 6 of
// the decomposition). This section is intentionally empty.

// --- Context Menu ---

function createContextMenu(): HTMLElement {
  injectContextMenuStyles()
  const menu = document.createElement('div')
  menu.className = 'canvas-tab-context-menu'
  // Mirrors ~/Lumiverse/frontend/src/components/shared/ContextMenu.module.css:1-13
  // exactly. Differences from this Lumiverse baseline are visible as "this
  // menu doesn't match the others" — the z-index, shadow, and entrance
  // animation need to track Lumiverse precisely.
  // - z-index 11000 = Lumiverse's topmost tier (see variables.css's z-index
  //   landscape; 11000 is reserved for the topmost system surfaces).
  // - box-shadow: hardcoded 12px/32px elevation + a 1px white-tinted inner
  //   ring (not primary-tinted). The white ring is the Lumiverse default.
  // - animation + transform-origin: same as Lumiverse's contextMenuIn.
  // The keyframe itself is defined in injectContextMenuStyles() (can't be
  // declared inline). The glass variant also lives there, gated on
  // body[data-glass] to match the Lumiverse pattern.
  menu.style.cssText = `
    position: fixed;
    z-index: 11000;
    min-width: 180px;
    padding: 4px;
    background: var(--lumiverse-bg-deep);
    border: 1px solid var(--lumiverse-border);
    border-radius: 10px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.04);
    animation: contextMenuIn 120ms ease-out;
    transform-origin: top left;
    display: none;
  `
  return menu
}

/**
 * Idempotent: creates <style id="canvas-ux-context-menu-styles"> in <head>
 * exactly once. Holds the `contextMenuIn` keyframe (which can't be declared
 * inline) and the body[data-glass] glass variant. The variant matches
 * ~/Lumiverse/frontend/src/components/shared/ContextMenu.module.css:15-18.
 */
function injectContextMenuStyles(): void {
  if (document.getElementById('canvas-ux-context-menu-styles')) return
  const style = document.createElement('style')
  style.id = 'canvas-ux-context-menu-styles'
  style.textContent = `
    @keyframes contextMenuIn {
      from { opacity: 0; transform: scale(0.92); }
      to   { opacity: 1; transform: scale(1); }
    }
    body[data-glass] .canvas-tab-context-menu {
      background: color-mix(in srgb, var(--lumiverse-bg-deep) 80%, transparent) !important;
      backdrop-filter: blur(var(--lcs-glass-blur, 8px));
    }
  `
  document.head.appendChild(style)
}

function createContextMenuItem(label: string, onClick: () => void, opts?: { danger?: boolean }): HTMLElement {
  const item = document.createElement('button')
  item.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    border: none;
    border-radius: 6px;
    background: none;
    color: ${opts?.danger ? 'var(--lumiverse-error, #e54545)' : 'var(--lumiverse-text)'};
    font-size: calc(12.5px * var(--lumiverse-font-scale, 1));
    font-family: inherit;
    cursor: pointer;
    transition: background 120ms ease;
    text-align: left;
  `
  item.textContent = label
  item.addEventListener('mouseenter', () => {
    item.style.background = opts?.danger ? 'var(--lumiverse-danger-015)' : 'var(--lumiverse-fill, rgba(255, 255, 255, 0.06))'
  })
  item.addEventListener('mouseleave', () => {
    item.style.background = 'none'
  })
  item.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick()
    hideContextMenu()
  })
  return item
}

let _contextMenu: HTMLElement | null = null
// Accessor (Step 0) — to be exported when context-menu/index.ts is extracted.
// Called by sidebar/cleanup.cleanupAll on teardown.
export function disposeContextMenu(): void {
  if (_contextMenu) {
    _contextMenu.remove()
    _contextMenu = null
  }
}

// FIXME-decomp(step 11): transient export — context-menu/index.ts will own
// this after Step 11; callers re-point.
export function showAssignmentMenu(x: number, y: number, tabId: string, tabTitle: string) {
  if (!_contextMenu) {
    _contextMenu = createContextMenu()
    document.body.appendChild(_contextMenu)
  }

  _contextMenu.innerHTML = ''
  const currentSidebar = getTabSidebar(tabId)
  let label: string
  let targetSidebar: 'primary' | 'secondary'
  if (currentSidebar === 'secondary' && _secondarySidebarOpen) {
    label = 'Move to Main Sidebar'
    targetSidebar = 'primary'
  } else if (currentSidebar === 'secondary' && !_secondarySidebarOpen) {
    label = 'Open in Second Sidebar'
    targetSidebar = 'secondary'
  } else {
    label = 'Move to Second Sidebar'
    targetSidebar = 'secondary'
  }

  const item = createContextMenuItem(label, () => assignTab(tabId, targetSidebar))
  _contextMenu.appendChild(item)
  _contextMenu.style.left = `${x}px`
  _contextMenu.style.top = `${y}px`
  _contextMenu.style.display = 'block'

  // Adjust if off-screen
  requestAnimationFrame(() => {
    const rect = _contextMenu!.getBoundingClientRect()
    if (rect.right > window.innerWidth) {
      _contextMenu!.style.left = `${window.innerWidth - rect.width - 8}px`
    }
    if (rect.bottom > window.innerHeight) {
      _contextMenu!.style.top = `${window.innerHeight - rect.height - 8}px`
    }
  })
}

function hideContextMenu() {
  if (_contextMenu) {
    // Remove the element from the DOM (don't just hide it). Two reasons:
    //   1. The next showAssignmentMenu creates a brand-new element, which
    //      guarantees the `contextMenuIn` animation re-runs cleanly on
    //      every open — a reused display:none → display:block element may
    //      not re-trigger the animation in some browsers.
    //   2. Keeps only one menu in the DOM at a time, matching Lumiverse's
    //      openMenus registry invariant (ContextMenu.tsx:52, 68-78).
    _contextMenu.remove()
    _contextMenu = null
  }
}

// Context menu listener state — tracked for idempotent start/stop.
let _contextMenuListenersActive = false
let _contextMenuHandlers: {
  sidebarCtx: ((e: Event) => void) | null
  sidebarEl: HTMLElement | null
  docCtxCapture: ((e: Event) => void) | null
  docClick: ((e: Event) => void) | null
  docScroll: ((e: Event) => void) | null
  docKey: ((e: KeyboardEvent) => void) | null
} = { sidebarCtx: null, sidebarEl: null, docCtxCapture: null, docClick: null, docScroll: null, docKey: null }

function startContextMenuListener() {
  if (_contextMenuListenersActive) return
  const sidebar = getMainSidebar()
  if (!sidebar) return

  const sidebarCtx = (e: Event) => {
    const evt = e as MouseEvent
    const target = evt.target as HTMLElement
    const tabBtn = target.closest('button[title]') as HTMLElement
    if (!tabBtn) return

    // Only for extension tabs (after .tabDivider)
    const isExtension = tabBtn.classList.toString().includes('Extension')
      || tabBtn.previousElementSibling?.classList.toString().includes('Divider')
    if (!isExtension) return

    e.preventDefault()
    e.stopPropagation()

    const title = tabBtn.getAttribute('title') || ''
    // Force fresh fiber walk — cache may be stale from Zustand state changes
    findStoreData(true)
    const tabs = getDrawerTabs()
    const matchedTab = tabs.find(t => t.title === title)
    const tabId = matchedTab?.id || title

    showAssignmentMenu(evt.clientX, evt.clientY, tabId, title)
  }
  // Capture-phase contextmenu listener: when ANY new contextmenu fires
  // (Lumiverse's shared ContextMenu opening on a built-in tab, canvas's
  // own sidebar handler opening on a different extension tab, or the
  // browser's default menu on empty space), close the canvas menu first.
  // This enforces the same single-menu invariant that Lumiverse's
  // shared ContextMenu enforces via its module-level openMenus registry.
  const docCtxCapture = () => {
    if (_contextMenu) hideContextMenu()
  }
  const docClick = () => hideContextMenu()
  const docScroll = () => hideContextMenu()
  const docKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') hideContextMenu()
  }

  sidebar.addEventListener('contextmenu', sidebarCtx)
  document.addEventListener('contextmenu', docCtxCapture, true)
  document.addEventListener('click', docClick)
  document.addEventListener('scroll', docScroll, true)
  document.addEventListener('keydown', docKey)

  _contextMenuHandlers = { sidebarCtx, sidebarEl: sidebar, docCtxCapture, docClick, docScroll, docKey }
  _contextMenuListenersActive = true
}

function stopContextMenuListener() {
  if (!_contextMenuListenersActive) return
  const h = _contextMenuHandlers
  if (h.sidebarEl && h.sidebarCtx) h.sidebarEl.removeEventListener('contextmenu', h.sidebarCtx)
  if (h.docCtxCapture) document.removeEventListener('contextmenu', h.docCtxCapture, true)
  if (h.docClick) document.removeEventListener('click', h.docClick)
  if (h.docScroll) document.removeEventListener('scroll', h.docScroll, true)
  if (h.docKey) document.removeEventListener('keydown', h.docKey)
  _contextMenuHandlers = { sidebarCtx: null, sidebarEl: null, docCtxCapture: null, docClick: null, docScroll: null, docKey: null }
  _contextMenuListenersActive = false
  hideContextMenu()
}

// --- Drag-to-Resize ---

// All drag-to-resize code lives in src/resize/handles.ts (Step 7 of the
// decomposition). This section is intentionally empty.

// --- Backend Persistence ---

let _backendCtx: any = null
// Accessors (Step 0) — to be exported when layout/persist.ts is extracted.
export function getBackendCtx(): any { return _backendCtx }
export function setBackendCtx(ctx: any): void { _backendCtx = ctx }

// Debounce timer for persistLayout (tab assignments, width)
let _saveLayoutTimer: ReturnType<typeof setTimeout> | null = null
// Accessor (Step 0) — called by sidebar/cleanup.cleanupAll after M14 extraction.
export function cancelLayoutSave(): void {
  if (_saveLayoutTimer !== null) {
    clearTimeout(_saveLayoutTimer)
    _saveLayoutTimer = null
  }
}

/**
 * Build the current layout snapshot from in-memory state. Pure — no side effects.
 */
function snapshotLayout(): any {
  return {
    primary: {
      open: isMainDrawerOpen(),
      width: getMainDrawerWidth(),
    },
    secondary: {
      open: _secondarySidebarOpen,
      width: parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)) || 420,
    },
    detachedTabs: Array.from(_tabAssignments.entries())
      .filter(([_, side]) => side === 'secondary')
      .map(([tabId, side]) => {
        const tabs = getDrawerTabs()
        const tab = tabs.find(t => t.id === tabId)
        return { tabId, tabTitle: tab?.title || tabId, sidebar: side }
      }),
  }
}

/**
 * Persist the drawer's open/closed state + width synchronously. No debounce —
 * called from openSecondarySidebar / closeSecondarySidebar / the resize handle,
 * so a user opening then immediately closing the drawer (within the 500ms
 * debounce window of persistLayout) still records the final state. The
 * verification case from the plan: "open, immediately close within 100ms —
 * final state on hard-refresh is closed."
 */
export function persistOpenState(): void {
  const backendCtx = getBackendCtx()
  if (!backendCtx) return
  if (!isPersistenceEnabled()) return
  if (_saveLayoutTimer !== null) {
    // A debounced persistLayout is in flight; cancel it so we don't double-write.
    clearTimeout(_saveLayoutTimer)
    _saveLayoutTimer = null
  }
  backendCtx.sendToBackend({ type: 'SAVE_LAYOUT', layout: snapshotLayout() })
}

/**
 * Persist the tab-assignment list + drawer width, debounced 500ms. Called
 * from assignTab and from the resize handle (the width change is frequent
 * during drag; the debounce coalesces to a single write at drag end).
 */
// FIXME-decomp(step 12): transient export — layout/persist.ts will own this
// after Step 12; callers re-point.
export function persistLayout(): void {
  const backendCtx = getBackendCtx()
  if (!backendCtx) return
  if (!isPersistenceEnabled()) return
  if (_saveLayoutTimer !== null) {
    clearTimeout(_saveLayoutTimer)
  }
  _saveLayoutTimer = setTimeout(() => {
    _saveLayoutTimer = null
    backendCtx.sendToBackend({ type: 'SAVE_LAYOUT', layout: snapshotLayout() })
  }, 500)
}

/**
 * @deprecated Use persistOpenState() for open/close events and persistLayout()
 * for tab-assignment / width changes. Kept as a single-call alias for any
 * code path that genuinely needs to save the whole layout synchronously.
 */
function saveLayout() {
  persistLayout()
}

function loadSavedLayout(): Promise<any> {
  const backendCtx = getBackendCtx()
  if (!backendCtx) return Promise.resolve(null)
  return new Promise((resolve) => {
    // Phase 3 (finding #13): register a one-shot handler that resolves the
    // promise when LAYOUT_DATA arrives. The handler is replaced by the
    // permanent ctx.onBackendMessage listener in setup() before any other
    // LAYOUT_DATA could come through.
    const handler = (payload: any) => {
      if (payload.type === 'LAYOUT_DATA') {
        resolve(payload.layout)
      }
    }
    backendCtx.onBackendMessage(handler)
    backendCtx.sendToBackend({ type: 'LOAD_LAYOUT' })
    // Safety timeout: if the backend never responds (e.g. corrupt storage),
    // resolve with null so the mount proceeds with defaults rather than
    // hanging the extension. 2s is enough for the file I/O round-trip on
    // a warm cache; longer waits mask real bugs.
    setTimeout(() => resolve(null), 2000)
  })
}

function applyLayout(layout: any) {
  if (!layout) return

  // Restore secondary sidebar width
  if (layout.secondary?.width) {
    document.documentElement.style.setProperty(SECONDARY_WIDTH_VAR, `${layout.secondary.width}px`)
    // Phase 3 (finding #13): createSecondarySidebar already initialized the
    // wrapper transform with the right width on mount (see the options
    // parameter). No animateWrapper call needed here — that would re-trigger
    // the close animation and cause a flicker. The conditional animateWrapper
    // below is kept as a safety net for the case where applyLayout is called
    // without a prior mountSecondarySidebar(layout) (e.g. from a future
    // "reload layout" debug action that runs after setup).
    if (_secondaryWrapper && !_secondarySidebarOpen) {
      const currentTransform = _secondaryWrapper.style.transform?.match(/-?[\d.]+/)?.[0]
      // Compare against the sign-aware closed transform. The saved width is
      // always positive, but the rendered transform carries a sign
      // (+width when sec is on the right, -width when sec is on the left),
      // so a direct string match against the saved width would always
      // differ when the secondary is on the left. Use the same sign logic
      // as getClosedTransformPx to compute the desired closed value.
      const desiredClosed = getMainDrawerSide() === 'right'
        ? -layout.secondary.width
        : layout.secondary.width
      if (currentTransform !== String(desiredClosed)) {
        animateWrapper(desiredClosed)
      }
    }
  }

  // Restore tab assignments
  if (layout.detachedTabs?.length) {
    // Wait for extension tabs to register, then restore.
    // Phase 2: match by stable tabId only. Title fallback was removed because
    // tabTitle can drift across sessions (e.g. "LumiBooks" → "LumiBooks v2")
    // and was the source of the "Hone / Prompt Inspector unreliable" symptom.
    // If a stored tabId is no longer in the store (extension uninstalled or
    // id schema changed), we warn and skip — the user can clean up via the
    // future "reset layout" action.
    //
    // Phase 3 (finding #5): polling loop now calls the lighter restore path
    // (set state + update buttons + DOM move) directly, NOT assignTab. This
    // avoids the policy-layer side effects: assignTab would call
    // switchMainDrawerToFallback (which manipulates the main drawer that's
    // already in its saved state) and persistLayout (we just LOADED this
    // layout, no need to write it back).
    //
    // Phase 4.0 (suffix-drift fallback): Lumiverse assigns a session-variant
    // suffix (`:1`, `:2`, `:3`) to extension tab ids in the order they're
    // registered. The suffix in the live DOM is NOT the same as the one in
    // layout.json after a session restart — e.g. layout says
    // `prompt-viewer:2` but live is `prompt-viewer:1`. An exact-match-only
    // restore leaves the user with empty secondary panels after a restart.
    // Fix: if an exact match fails, strip the last `:N` from both the stored
    // id and each live id, and match by the stripped prefix. If exactly one
    // live id matches, use it AND rewrite the stored id in the in-memory
    // layout (so the next persistLayout write self-heals). If multiple live
    // ids match, the stripped prefix is too coarse — warn and skip.
    const stripSuffix = (id: string): string => {
      const lastColon = id.lastIndexOf(':')
      if (lastColon <= 0) return id
      const tail = id.slice(lastColon + 1)
      return /^\d+$/.test(tail) ? id.slice(0, lastColon) : id
    }
    let attempts = 0
    const interval = setInterval(() => {
      attempts++
      const tabs = getDrawerTabs()
      for (let i = 0; i < layout.detachedTabs.length; i++) {
        const dt = layout.detachedTabs[i]
        if (_tabAssignments.has(dt.tabId)) continue
        // Try exact match first
        let tab = tabs.find(t => t.id === dt.tabId)
        let usedFallback = false
        if (!tab) {
          // Exact match missed — try stripped-suffix match
          const storedPrefix = stripSuffix(dt.tabId)
          const candidates = tabs.filter(t => stripSuffix(t.id) === storedPrefix)
          if (candidates.length === 1) {
            tab = candidates[0]
            usedFallback = true
            dlog(`applyLayout: suffix-drift fallback matched stored "${dt.tabId}" → live "${tab.id}"`)
            // Self-heal: rewrite the in-memory layout so the next persistLayout
            // call stores the live id. No additional save here — the rewrite
            // only takes effect when the user makes another change that
            // triggers persistLayout (open/close, move another tab, etc.).
            layout.detachedTabs[i] = { ...dt, tabId: tab.id }
          } else if (candidates.length > 1) {
            // Ambiguous — multiple live tabs share this stripped prefix.
            // This shouldn't happen in practice (the prefix includes the
            // extension uuid), but log defensively.
            dwarn(`applyLayout: stripped-suffix match for "${dt.tabId}" is ambiguous (${candidates.length} candidates). Skipping.`)
          }
        }
        if (tab) {
          // Lightweight restore: state + button affordances + DOM move.
          // No save (we just loaded). No open/close cascade (mount handled it).
          _tabAssignments.set(tab.id, 'secondary')
          hideMainTabButton(tab.id)
          addSecondaryTabButton(tab)
          updateDrawerTabVisibility()
          repositionTabToSecondary(tab.id)
        } else if (!usedFallback) {
          // Once we've tried a few times and the id is still missing, surface
          // a visible warning. The first few attempts may simply be racing
          // the store's tab registration.
          if (attempts === 5) {
            const knownIds = tabs.map(t => t.id)
            dwarn(`applyLayout: stored detached tabId "${dt.tabId}" not found in store (and no suffix-drift match). Known ids: ${knownIds.join(', ')}. Layout may be stale.`)
          }
        }
      }
      if (attempts > 20 || layout.detachedTabs.every((dt: any) => _tabAssignments.has(dt.tabId))) {
        clearInterval(interval)
        // Phase 4 (finding #2): if at least one tab was restored, pick the
        // first one as the active secondary tab. Without this, the
        // secondary panel header stays empty when the user opens the
        // drawer (showSecondaryTab was never called from the lightweight
        // restore path to avoid double-animating the active tab).
        // The first-tab pick is a reasonable default — the user can click
        // any tab button to switch. Future work: persist the active
        // secondary tab id in layout.json so we restore the exact one.
        const restored = layout.detachedTabs.find((dt: any) => _tabAssignments.has(dt.tabId))
        if (restored) {
          showSecondaryTab(restored.tabId)
        }
        // Phase 3 (finding #5): the end-of-interval open/close block is gone.
        // The drawer's open/closed state was set at mount time via the
        // initialOpen option on createSecondarySidebar, so by the time we get
        // here the wrapper is already in the correct position. This is the
        // "fully open from the first paint" requirement.
        //
        // Safety net kept for the case where applyLayout is called WITHOUT a
        // prior mountSecondarySidebar(layout) — e.g. a future "reload layout"
        // debug action that re-applies after a session tweak.
        if (layout.secondary?.open === true && !_secondarySidebarOpen) {
          openSecondarySidebar()
        } else if (layout.secondary?.open === false && _secondarySidebarOpen) {
          closeSecondarySidebar()
        }
      }
    }, 500)
  }
}

// --- Polish & Cleanup ---

// All sidebar polish code (syncDrawerTabSettings, isShowTabLabels,
// checkSideChanged, side/registration watchers) lives in
// src/sidebar/polish.ts (Step 8 of the decomposition). The cleanup
// registry and cleanupAll live in src/sidebar/cleanup.ts (Step 14).
// Until Step 14, registerCleanup/cleanupAll are re-exported below as
// transient exports so sidebar/polish.ts can register watch teardowns.

// Cleanup registry — transient (Step 14 will move to src/sidebar/cleanup.ts).
const _cleanupFns: Array<() => void> = []
export function registerCleanup(fn: () => void) { _cleanupFns.push(fn) }
export function cleanupAll() {
  for (const fn of _cleanupFns) {
    try { fn() } catch (err: unknown) {
      console.error('[SidebarUX] Cleanup error:', err)
    }
  }
  _cleanupFns.length = 0
  // (cleanupAll in the final module will also reset state; for now
  // this matches the v1.4.2 behavior of the registered teardowns.)
}

// --- Slash Runtime ---

import { attachSlashRuntime } from './slash/runtime'

// --- Settings Panel ---

// CSS class names are namespaced (sidebar-ux-*) to avoid colliding with
// Lumiverse's own CSS modules. The class definitions are injected once
// when the panel is first built.
const PANEL_STYLE_ID = 'sidebar-ux-panel-styles'
function injectPanelStyles() {
  if (document.getElementById(PANEL_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = PANEL_STYLE_ID
  style.textContent = `
    .sidebar-ux-panel-root {
      font-family: var(--lumiverse-font-family, sans-serif);
      color: var(--lumiverse-text);
      padding: 4px 0 24px;
    }
    .sidebar-ux-panel-header {
      padding: 4px 0 12px;
      margin: 0;
    }
    .sidebar-ux-panel-header-title {
      margin: 0;
      font-size: calc(18px * var(--lumiverse-font-scale, 1));
      font-weight: 600;
      line-height: 1.2;
      color: var(--lumiverse-text);
    }
    .sidebar-ux-panel-section {
      margin-top: 18px;
    }
    .sidebar-ux-panel-section-title {
      margin: 0 0 8px;
      font-size: calc(12px * var(--lumiverse-font-scale, 1));
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--lumiverse-text-muted);
    }
    .sidebar-ux-panel-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border: 1px solid var(--lumiverse-border);
      border-radius: 8px;
      background: var(--lumiverse-bg-050);
      margin-bottom: 6px;
      transition: opacity 0.15s ease;
    }
    .sidebar-ux-panel-row-disabled {
      opacity: 0.45;
    }
    .sidebar-ux-panel-row-text { flex: 1; min-width: 0; }
    .sidebar-ux-panel-row-label {
      font-size: calc(13px * var(--lumiverse-font-scale, 1));
      font-weight: 500;
      line-height: 1.3;
      color: var(--lumiverse-text);
    }
    .sidebar-ux-panel-row-hint {
      margin-top: 2px;
      font-size: calc(11.5px * var(--lumiverse-font-scale, 1));
      line-height: 1.35;
      color: var(--lumiverse-text-muted);
    }
    .sidebar-ux-panel-toggle {
      flex-shrink: 0;
      position: relative;
      width: 36px;
      height: 20px;
      border-radius: 999px;
      background: var(--lumiverse-fill-strong, rgba(0,0,0,0.3));
      border: 1px solid var(--lumiverse-border);
      cursor: pointer;
      padding: 0;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .sidebar-ux-panel-toggle-knob {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--lumiverse-text);
      transition: transform 0.15s ease, background 0.15s ease;
    }
    .sidebar-ux-panel-toggle-on {
      background: var(--lumiverse-primary);
      border-color: var(--lumiverse-primary);
    }
    .sidebar-ux-panel-toggle-on .sidebar-ux-panel-toggle-knob {
      transform: translateX(16px);
      background: white;
    }
    .sidebar-ux-panel-toggle:focus-visible {
      outline: 2px solid var(--lumiverse-primary);
      outline-offset: 2px;
    }
    .sidebar-ux-panel-segmented {
      display: inline-flex;
      flex-shrink: 0;
      border: 1px solid var(--lumiverse-border);
      border-radius: 6px;
      overflow: hidden;
      background: var(--lumiverse-fill, rgba(0,0,0,0.15));
    }
    .sidebar-ux-panel-segmented-btn {
      padding: 4px 10px;
      font-size: calc(11.5px * var(--lumiverse-font-scale, 1));
      font-family: inherit;
      color: var(--lumiverse-text-muted);
      background: transparent;
      border: none;
      cursor: pointer;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .sidebar-ux-panel-segmented-btn:not(:last-child) {
      border-right: 1px solid var(--lumiverse-border);
    }
    .sidebar-ux-panel-segmented-btn-active {
      background: var(--lumiverse-primary);
      color: white;
    }
    .sidebar-ux-panel-footer {
      margin-top: 18px;
      font-size: calc(11px * var(--lumiverse-font-scale, 1));
      color: var(--lumiverse-text-dim);
      text-align: center;
    }
  `
  document.head.appendChild(style)
}

/**
 * Render a single setting row. `control` is the right-hand element
 * (toggle button, segmented control, etc.) — caller builds it.
 */
function buildSettingRow(args: {
  label: string
  hint?: string
  control: HTMLElement
  disabled?: boolean
}): HTMLElement {
  const row = document.createElement('div')
  row.className = 'sidebar-ux-panel-row'
  if (args.disabled) row.classList.add('sidebar-ux-panel-row-disabled')

  const text = document.createElement('div')
  text.className = 'sidebar-ux-panel-row-text'
  const label = document.createElement('div')
  label.className = 'sidebar-ux-panel-row-label'
  label.textContent = args.label
  text.appendChild(label)
  if (args.hint) {
    const hint = document.createElement('div')
    hint.className = 'sidebar-ux-panel-row-hint'
    hint.textContent = args.hint
    text.appendChild(hint)
  }

  row.appendChild(text)
  row.appendChild(args.control)
  return row
}

/** Build a CSS-only toggle switch matching Lumiverse's Toggle.Switch look. */
function buildToggleControl(value: boolean, onChange: (next: boolean) => void, disabled?: () => boolean): HTMLElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'sidebar-ux-panel-toggle' + (value ? ' sidebar-ux-panel-toggle-on' : '')
  btn.setAttribute('role', 'switch')
  btn.setAttribute('aria-checked', String(value))
  const knob = document.createElement('span')
  knob.className = 'sidebar-ux-panel-toggle-knob'
  btn.appendChild(knob)
  btn.addEventListener('click', () => {
    if (disabled && disabled()) return
    onChange(!value)
  })
  return btn
}

/** Build a 3-button segmented control (Follow / Show / Hide). */
function buildShowLabelsControl(value: 'follow' | 'show' | 'hide', onChange: (next: 'follow' | 'show' | 'hide') => void): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'sidebar-ux-panel-segmented'
  const opts: Array<{ value: 'follow' | 'show' | 'hide'; label: string }> = [
    { value: 'follow', label: 'Follow' },
    { value: 'show', label: 'Show' },
    { value: 'hide', label: 'Hide' },
  ]
  for (const o of opts) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'sidebar-ux-panel-segmented-btn' + (value === o.value ? ' sidebar-ux-panel-segmented-btn-active' : '')
    btn.textContent = o.label
    btn.addEventListener('click', () => onChange(o.value))
    wrap.appendChild(btn)
  }
  return wrap
}

/**
 * Build the Canvas settings panel DOM. Pure — caller appends to a host.
 * The panel re-renders its visual state in-place via `refreshPanel` after
 * each `setSettings` call, so the toggles always reflect the current
 * `_settings` value.
 */
function buildSettingsPanelDOM(): HTMLElement {
  injectPanelStyles()

  const root = document.createElement('div')
  root.className = 'sidebar-ux-panel-root'

  // --- Header ---
  const header = document.createElement('div')
  header.className = 'sidebar-ux-panel-header'
  const headerTitle = document.createElement('h2')
  headerTitle.className = 'sidebar-ux-panel-header-title'
  headerTitle.textContent = 'Canvas - Enhanced UI'
  header.appendChild(headerTitle)
  root.appendChild(header)

  // Each toggle is a small object that knows how to refresh its own visual
  // state. The buildToggleControl factory returns a button; the caller
  // wraps it in this helper to track it for re-rendering.
  const makeToggle = (
    getValue: () => boolean,
    setValue: (next: boolean) => void,
    opts: { disabled?: () => boolean } = {}
  ): { btn: HTMLButtonElement; refresh: () => void } => {
    const btn = buildToggleControl(getValue(), (next) => setValue(next), opts.disabled)
    const refresh = () => {
      const v = getValue()
      btn.classList.toggle('sidebar-ux-panel-toggle-on', v)
      btn.setAttribute('aria-checked', String(v))
    }
    return { btn, refresh }
  }

  // Section helper
  const section = (title: string) => {
    const sec = document.createElement('div')
    sec.className = 'sidebar-ux-panel-section'
    const h = document.createElement('h4')
    h.className = 'sidebar-ux-panel-section-title'
    h.textContent = title
    sec.appendChild(h)
    return sec
  }

  // --- Section: Chat & Layout (now at the top) ---
  const sec1 = section('Chat & Layout')

  const chat = makeToggle(
    () => _settings.chatReflow,
    (v) => setSettings({ chatReflow: v })
  )
  sec1.appendChild(buildSettingRow({
    label: 'Center the chat in the visible area',
    hint: 'Shifts the chat column by the open-drawer widths so neither sidebar covers it.',
    control: chat.btn,
  }))

  const persist = makeToggle(
    () => _settings.layoutPersistence,
    (v) => setSettings({ layoutPersistence: v })
  )
  sec1.appendChild(buildSettingRow({
    label: 'Remember layout across sessions',
    hint: 'Persists open/closed state, widths, and tab assignments to layout.json.',
    control: persist.btn,
  }))

  const smooth = makeToggle(
    () => _settings.smoothTransitions,
    (v) => setSettings({ smoothTransitions: v })
  )
  sec1.appendChild(buildSettingRow({
    label: 'Smooth transitions',
    hint: 'Animates drawer open/close and the chat margin transition.',
    control: smooth.btn,
  }))

  // --- Section: Second Sidebar ---
  const sec2 = section('Second Sidebar')

  const master = makeToggle(
    () => _settings.secondSidebarEnabled,
    (v) => setSettings({ secondSidebarEnabled: v })
  )
  sec2.appendChild(buildSettingRow({
    label: 'Enable Second Sidebar',
    hint: 'Adds a second drawer to the opposite side of the main one. Master switch for all sub-features below.',
    control: master.btn,
  }))

  const resizeSidebars = makeToggle(
    () => _settings.resizeSidebars,
    (v) => setSettings({ resizeSidebars: v }),
    { disabled: () => !_settings.secondSidebarEnabled }
  )
  sec2.appendChild(buildSettingRow({
    label: 'Drag to resize sidebars',
    hint: 'Adds a 4px grab handle on the inner edge of both drawers.',
    control: resizeSidebars.btn,
    disabled: !_settings.secondSidebarEnabled,
  }))

  const mirror = makeToggle(
    () => _settings.autoMirrorOnSideSwap,
    (v) => setSettings({ autoMirrorOnSideSwap: v }),
    { disabled: () => !_settings.secondSidebarEnabled }
  )
  sec2.appendChild(buildSettingRow({
    label: 'Auto-mirror when the main sidebar switches side',
    hint: 'Rebuilds the secondary drawer on the opposite edge when the user moves the main one.',
    control: mirror.btn,
    disabled: !_settings.secondSidebarEnabled,
  }))

  const compact = makeToggle(
    () => _settings.mirrorCompactPosition,
    (v) => setSettings({ mirrorCompactPosition: v }),
    { disabled: () => !_settings.secondSidebarEnabled }
  )
  sec2.appendChild(buildSettingRow({
    label: 'Mirror compact mode + vertical position',
    hint: "Matches the main drawer's compact/vertical tab position on the secondary drawer.",
    control: compact.btn,
    disabled: !_settings.secondSidebarEnabled,
  }))

  // Tab labels — tri-state segmented control. We keep a reference so refresh
  // can rebuild the inner buttons (a segmented control needs DOM
  // replacement when the active value changes, since each button carries
  // its own click handler bound to the current value).
  let showLabelsWrap: HTMLElement
  let showLabelsRow: HTMLElement
  const buildShowLabelsSeg = () => buildShowLabelsControl(
    _settings.showTabLabels,
    (v) => setSettings({ showTabLabels: v })
  )
  showLabelsWrap = buildShowLabelsSeg()
  showLabelsRow = buildSettingRow({
    label: 'Tab labels in the second sidebar',
    hint: "\"Follow\" mirrors Lumiverse's main sidebar setting. \"Show\" / \"Hide\" override it.",
    control: showLabelsWrap,
    disabled: !_settings.secondSidebarEnabled,
  })
  sec2.appendChild(showLabelsRow)

  const iconSize = makeToggle(
    () => _settings.consistentIconSize,
    (v) => setSettings({ consistentIconSize: v })
  )
  sec2.appendChild(buildSettingRow({
    label: 'Force 20×20 icon size on tab buttons',
    hint: 'Fixes tabs that ship icons without intrinsic dimensions (some extensions render at 0×0 by default).',
    control: iconSize.btn,
  }))

  // --- Section: Behavior ---
  const sec3 = section('Behavior')

  const cleanup = makeToggle(
    () => _settings.autoCleanupOnUninstall,
    (v) => setSettings({ autoCleanupOnUninstall: v })
  )
  sec3.appendChild(buildSettingRow({
    label: 'Auto-cleanup when an extension is uninstalled',
    hint: 'Removes the tab from the secondary sidebar if its source extension disappears.',
    control: cleanup.btn,
  }))

  // --- Section: Debug ---
  const sec4 = section('Debug')

  const debugMode = makeToggle(
    () => _settings.debugMode,
    (v) => setSettings({ debugMode: v })
  )
  sec4.appendChild(buildSettingRow({
    label: 'Debug mode',
    hint: 'Enables [Canvas] console output and installs window.__canvasDebug() for in-browser fiber tree inspection. Useful when filing a bug report.',
    control: debugMode.btn,
  }))

  // Footer
  const footer = document.createElement('div')
  footer.className = 'sidebar-ux-panel-footer'
  footer.textContent = 'Canvas settings persist to layout.json (300ms debounce).'

  root.appendChild(sec1)
  root.appendChild(sec2)
  root.appendChild(sec3)
  root.appendChild(sec4)
  root.appendChild(footer)

  // Live-update wiring: setSettings calls this via the registered panel
  // refresh closure (setPanelRefresh in settings/state) so we don't have to
  // thread the refresh closure through every toggle's onChange.
  const refresh = () => {
    master.refresh()
    resizeSidebars.refresh()
    mirror.refresh()
    compact.refresh()
    iconSize.refresh()
    chat.refresh()
    persist.refresh()
    smooth.refresh()
    cleanup.refresh()
    debugMode.refresh()
    // Update disabled visual state for sub-features gated by the master toggle.
    for (const row of [resizeSidebars, mirror, compact]) {
      const d = !_settings.secondSidebarEnabled
      row.btn.disabled = d
      row.btn.style.cursor = d ? 'not-allowed' : 'pointer'
      ;(row.btn.parentElement as HTMLElement)?.classList.toggle('sidebar-ux-panel-row-disabled', d)
    }
    showLabelsRow.classList.toggle('sidebar-ux-panel-row-disabled', !_settings.secondSidebarEnabled)
    // Rebuild the showTabLabels segmented control (each button captures the
    // current value in its handler).
    const newSeg = buildShowLabelsSeg()
    showLabelsWrap.replaceWith(newSeg)
    showLabelsWrap = newSeg
  }

  return { root, refresh }
}

/**
 * Mount the Canvas settings panel into Lumiverse's per-extension settings
 * host (`[data-spindle-mount="settings_extensions"]`). Called from setup()
 * once the ctx is available. The host is managed by the Spindle loader's
 * mount API; we just append our DOM to the root it returns.
 */
function mountSettingsPanel(ctx: any) {
  try {
    if (!ctx?.ui?.mount) {
      dwarn('mountSettingsPanel: ctx.ui.mount unavailable; settings panel will not be registered')
      return
    }
    const host = ctx.ui.mount('settings_extensions')
    if (!host) return
    // Clear any previous render so a re-mount (e.g. after extension reload)
    // doesn't stack panels.
    host.replaceChildren()
    const { root, refresh } = buildSettingsPanelDOM()
    host.appendChild(root)
    // Wire the panel's refresh closure so setSettings can drive in-place
    // re-rendering. Replaces the legacy window.__canvasPanelRefresh hook.
    setPanelRefresh(refresh)
    dlog('Settings panel mounted into data-spindle-mount="settings_extensions"')
  } catch (err) {
    console.error('[Canvas] mountSettingsPanel failed:', err)
  }
}

/**
 * Refresh the settings panel UI in-place after a settings change. Public so
 * setSettings can call it via the registered panel refresh closure.
 */
function refreshSettingsPanel() {
  if (_panelRefresh) _panelRefresh()
}

/**
 * Install `window.__canvasDebug()` — a console-invokable function that
 * scans the React fiber tree from the main sidebar to find the Zustand
 * store's drawerTabs / drawerOpen state. Pure debug aid; intentionally
 * unminified and console.log-heavy. The user can toggle it from the
 * Canvas settings panel.
 */
function installDebugEscapeHatch() {
  ;(window as any).__canvasDebug = function() {
    console.log('=== Canvas Fiber Scan ===')

    const sidebar = document.querySelector('[data-spindle-mount="sidebar"]')
    if (!sidebar) { console.log('No sidebar found'); return }

    const fiberKey = Object.keys(sidebar).find(k => k.startsWith('__reactFiber$'))
    if (!fiberKey) { console.log('No fiber key'); return }

    const visited = new Set<any>()
    function scan(fiber: any, depth: number, maxDepth: number): void {
      if (!fiber || depth > maxDepth || visited.has(fiber)) return
      visited.add(fiber)

      let hook = fiber.memoizedState
      let hookIdx = 0
      while (hook && hookIdx < 30) {
        const state = hook.memoizedState

        // Check for drawerTabs array (array of objects with id+title+root)
        if (Array.isArray(state) && state.length > 0 && state[0] && typeof state[0] === 'object') {
          const firstKeys = Object.keys(state[0])
          if (firstKeys.includes('id') && firstKeys.includes('title') && firstKeys.includes('root')) {
            console.log(`*** FOUND drawerTabs at depth=${depth} hook=${hookIdx}: ${state.length} tabs ***`)
            state.forEach((t: any, i: number) => console.log(`  [${i}] id=${t.id} title=${t.title}`))
          }
        }

        // Check for objects with drawerOpen/drawerTab (full store snapshot)
        if (state && typeof state === 'object' && !Array.isArray(state)) {
          const keys = Object.keys(state)
          if (keys.includes('drawerOpen') || keys.includes('drawerTabs')) {
            console.log(`*** FOUND store snapshot at depth=${depth} hook=${hookIdx}: ${keys.length} keys ***`)
            console.log(keys.slice(0, 25))
          }
        }

        hook = hook.next
        hookIdx++
      }

      scan(fiber.child, depth + 1, maxDepth)
      scan(fiber.sibling, depth, maxDepth)
    }

    // Strategy: walk UP from sidebar to find common ancestor, then DOWN into all children
    console.log('Walking UP from sidebar to find ancestors...')
    let fiber: any = (sidebar as any)[fiberKey]
    const ancestors: any[] = []
    while (fiber) {
      ancestors.push(fiber)
      fiber = fiber.return
    }
    console.log(`Found ${ancestors.length} ancestors`)

    // Now walk DOWN from each ancestor (the higher ones cover more tree)
    for (let i = ancestors.length - 1; i >= Math.max(0, ancestors.length - 5); i--) {
      console.log(`Scanning down from ancestor at position ${i}...`)
      scan(ancestors[i], 0, 30)
    }
    console.log('Done')
  }
}

// --- Setup ---

export function setup(ctx: any) {
  setBackendCtx(ctx)

  // Mount the settings panel immediately. The host may not be in the DOM yet
  // (the user hasn't opened Settings → Extensions), but ctx.ui.mount sets up
  // a MutationObserver that reparents the host as soon as it appears.
  mountSettingsPanel(ctx)

  // Slash runtime — wired into the canvas cleanup chain so the intercept
  // listeners are detached when the extension is disabled.
  const detachSlash = attachSlashRuntime(ctx)
  registerCleanup(detachSlash)

  // Phase 3 (finding #13): load the persisted layout BEFORE mounting the
  // secondary sidebar so its initial position matches the saved state on the
  // first paint — no 68px sliver, no 500ms flicker. We also hydrate the
  // settings from the same blob so every feature mount downstream sees the
  // correct gate.
  loadSavedLayout().then((layout) => {
    // Hydrate settings from the loaded layout (defaults filled by mergeCanvasSettings).
    _settings = mergeCanvasSettings(layout?.settings)
    DEBUG = _settings.debugMode
    setLastLoadedLayout(layout)

    if (_settings.debugMode) installDebugEscapeHatch()

    const initialWidth = layout?.secondary?.width
    const initialOpen = layout?.secondary?.open === true

    // Mount features gated by settings. The master toggle is the only one
    // that gates other mounts; sub-features are gated at their own mount
    // sites so a future change to add a non-master-gated sub-feature is
    // a one-liner.
    if (_settings.secondSidebarEnabled) {
      mountSecondarySidebar({ initialWidth, initialOpen })
    }
    if (_settings.chatReflow) {
      startReflowObserver()
    }
    if (_settings.resizeSidebars) {
      mountResizeHandles()
    }
    if (_settings.autoMirrorOnSideSwap) {
      startSideChangeWatcher()
    }
    if (_settings.autoCleanupOnUninstall) {
      startTabRegistrationWatcher()
    }
    // Context menu is always on for now (no panel toggle). Could become a
    // setting later if requested.
    startContextMenuListener()

    // Always inject the consistent-icon-size CSS if it's enabled — it
    // doesn't need a wrapper to apply.
    if (_settings.consistentIconSize) {
      injectDrawerTabStyles()
    }

    // Apply the rest of the layout (tab assignments + width delta if any).
    // Safe to call after mount: it won't double-animate the wrapper.
    if (layout && _settings.secondSidebarEnabled) {
      applyLayout(layout)
    }
  })

  // v1.3.0: removed the permanent ctx.onBackendMessage no-op. The previous
  // comment noted it was a "safety belt" for late LAYOUT_DATA, but the
  // one-shot handler in loadSavedLayout resolves on the first LAYOUT_DATA
  // and that is the only one the backend ever sends. Carrying a permanent
  // listener that never fires adds no value and would only mask a real bug
  // (a duplicate LAYOUT_DATA send) if the backend ever started sending one.

  // Return teardown — called when extension is disabled
  return cleanupAll
}
