import {
  getMainSidebar,
  getMainDrawer,
  getMainPanel,
  getMainPanelContent,
  getMainWrapper,
  getAppElement,
  getChatColumn,
} from './dom/lumiverse'
import { dlog, dwarn, getDebug, setDebug } from './debug/log'
import { installDebugEscapeHatch } from './debug/fiber-scan'
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
import { registerCleanup, cleanupAll } from './sidebar/cleanup'
import { startContextMenuListener } from './context-menu'
import { setBackendCtx, applyLayout, loadSavedLayout } from './layout/persist'
import { mountSettingsPanel } from './settings/panel'
import { getSettings, setSettings, setLastLoadedLayout, getLastLoadedLayout, setPanelRefresh, refreshSettingsPanel, hydrateSettings, type FullCanvasSettings } from './settings/state'

// --- Debug Logging ---
// See src/debug/log.ts for the dlog/dwarn/DEBUG implementation.
// This section is intentionally a stub after Step 2 of the decomposition.

// --- Settings (Canvas user preferences) ---

// All settings state + accessors + setSettings + persistSettings +
// hydrateSettings live in src/settings/state.ts (Step 1 of the decomposition).
// This section is intentionally empty after Step 1. The setSettings transient
// re-exports (getSettings, setLastLoadedLayout, getLastLoadedLayout,
// setPanelRefresh) are imported at the top of this file. applySettings
// (the diff/live-apply dispatcher) stays here until Task #2 extracts the
// settings panel.

/**
 * Diff previous and next settings, applying live effects for any that
 * changed. Idempotent: calling with prev === next is a no-op.
 */
// FIXME-decomp(step 2): applySettings will live in settings/panel.ts. Until
// then, settings/state.ts imports it as a transient.
export function applySettings(prev: FullCanvasSettings, next: FullCanvasSettings): void {
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
  // mount/load cycle reads the updated value from getSettings().
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

// All context menu code (createContextMenu, injectContextMenuStyles,
// createContextMenuItem, _contextMenu, disposeContextMenu,
// showAssignmentMenu, hideContextMenu, startContextMenuListener,
// stopContextMenuListener) lives in src/context-menu/index.ts (Step 11 of
// the decomposition). This section is intentionally empty.

// --- Drag-to-Resize ---

// All drag-to-resize code lives in src/resize/handles.ts (Step 7 of the
// decomposition). This section is intentionally empty.

// --- Backend Persistence ---

// All layout persistence (getBackendCtx, setBackendCtx, cancelLayoutSave,
// snapshotLayout, persistOpenState, persistLayout, saveLayout,
// loadSavedLayout, applyLayout) lives in src/layout/persist.ts (Step 12
// of the decomposition). This section is intentionally empty.

// --- Polish & Cleanup ---

// All sidebar polish code (syncDrawerTabSettings, isShowTabLabels,
// checkSideChanged, side/registration watchers) lives in
// src/sidebar/polish.ts (Step 8 of the decomposition). The cleanup
// registry and cleanupAll live in src/sidebar/cleanup.ts (Step 14).

// --- Slash Runtime ---

import { attachSlashRuntime } from './slash/runtime'

// --- Settings Panel ---

// All settings panel code (injectPanelStyles, buildSettingRow,
// buildToggleControl, buildShowLabelsControl, buildSettingsPanelDOM,
// mountSettingsPanel) lives in src/settings/panel.ts (Step 2 of the
// decomposition). This section is intentionally empty.

/**
 * Install `window.__canvasDebug()` — a console-invokable function that
 * scans the React fiber tree from the main sidebar to find the Zustand
 * store's drawerTabs / drawerOpen state. Pure debug aid; intentionally
 * unminified and console.log-heavy. The user can toggle it from the
 * Canvas settings panel.
 */
// All debug escape hatch code lives in src/debug/fiber-scan.ts. This
// section is intentionally empty.

// --- Setup ---

// The Spindle loader's entry point is exported from src/setup.ts. Re-export
// here so the bundle's entry (dist/frontend.js, built from src/frontend.ts)
// keeps the same surface the manifest references.
export { setup } from './setup'

// All setup orchestrator code lives in src/setup.ts. This section is
// intentionally empty.
