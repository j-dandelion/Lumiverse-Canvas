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
import { getTabAssignments, hasTabAssignment } from './tabs/assignment'
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
  setDebug(next.debugMode)
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
  if (currentSidebar === 'secondary' && isSecondarySidebarOpen()) {
    label = 'Move to Main Sidebar'
    targetSidebar = 'primary'
  } else if (currentSidebar === 'secondary' && !isSecondarySidebarOpen()) {
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
      open: isSecondarySidebarOpen(),
      width: parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)) || 420,
    },
    detachedTabs: Array.from(getTabAssignments().entries())
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
    if (getSecondaryWrapper() && !isSecondarySidebarOpen()) {
      const currentTransform = getSecondaryWrapper()!.style.transform?.match(/-?[\d.]+/)?.[0]
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
        if (hasTabAssignment(dt.tabId)) continue
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
          getTabAssignments().set(tab.id, 'secondary')
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
      if (attempts > 20 || layout.detachedTabs.every((dt: any) => hasTabAssignment(dt.tabId))) {
        clearInterval(interval)
        // Phase 4 (finding #2): if at least one tab was restored, pick the
        // first one as the active secondary tab. Without this, the
        // secondary panel header stays empty when the user opens the
        // drawer (showSecondaryTab was never called from the lightweight
        // restore path to avoid double-animating the active tab).
        // The first-tab pick is a reasonable default — the user can click
        // any tab button to switch. Future work: persist the active
        // secondary tab id in layout.json so we restore the exact one.
        const restored = layout.detachedTabs.find((dt: any) => hasTabAssignment(dt.tabId))
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
        if (layout.secondary?.open === true && !isSecondarySidebarOpen()) {
          openSecondarySidebar()
        } else if (layout.secondary?.open === false && isSecondarySidebarOpen()) {
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
    // Read current state from the DOM rather than the closure-captured `value`
    // parameter. `value` is the build-time initial; refresh() updates
    // aria-checked whenever setSettings runs, so the DOM is the live source
    // of truth and the toggle can always flip both directions.
    const current = btn.getAttribute('aria-checked') === 'true'
    onChange(!current)
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
    setDebug(_settings.debugMode)
    setLastLoadedLayout(layout)
    // The settings panel was mounted earlier in setup() with the default
    // _settings. Now that we've hydrated from the saved layout, re-render
    // the panel so the toggles reflect the loaded values rather than the
    // defaults baked in at mount time.
    refreshSettingsPanel()

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
