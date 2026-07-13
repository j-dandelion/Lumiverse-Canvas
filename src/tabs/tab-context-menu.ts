// Secondary sidebar context menu (Canvas-owned DOM menu).
//
// This menu appears when right-clicking a tab in the secondary sidebar.
// The main sidebar's context menu is now handled by injection into
// Lumiverse's built-in ContextMenu (context-menu/index.ts).
//
// Menu items (in order):
//   1. Toggle labels — toggle showTabLabels on the host drawer
//   2. Configure tabs — open the Canvas Configure Tabs modal
//   3. Divider
//   4. Move to … — reassign tab between main/second drawer (gated)
//
// Extracted from buttons.ts to isolate the context menu DOM construction,
// menu item creation, positioning, and event handlers from the tab button
// management logic.

import { getTabSidebar } from '../tabs/assignment'
import { getSettings } from '../settings/state'
import { injectStyles } from '../debug/styles'
import { isShowTabLabels, syncSecondaryTabLabels } from '../sidebar/drawer-sync'
import { patchHostDrawerSettings } from '../dom/host-settings'
import { openConfigureTabsModal } from './configure-modal'

// Test seam for showAssignmentMenu — allows tests to override the real implementation
let _showAssignmentMenuOverride: ((x: number, y: number, tabId: string, tabTitle: string, originatingTarget?: HTMLElement | null) => void) | null = null
export function __setShowAssignmentMenuForTest(fn: typeof _showAssignmentMenuOverride): void {
  _showAssignmentMenuOverride = fn
}

let _contextMenu: HTMLElement | null = null
// Tracks the element that originated the currently-open menu. Used to
// ignore the synthesized click that browsers dispatch at the end of a
// long-press — when that click lands on the same element that opened
// the menu, it would otherwise immediately close it.
let _lastContextMenuTarget: HTMLElement | null = null

export function hideAssignmentMenu(): void {
  if (_contextMenu) {
    _contextMenu.remove()
    _contextMenu = null
  }
  _lastContextMenuTarget = null
}

export function showAssignmentMenu(
  x: number, y: number, tabId: string, tabTitle: string,
  originatingTarget?: HTMLElement | null,
) {
  if (_showAssignmentMenuOverride) {
    _showAssignmentMenuOverride(x, y, tabId, tabTitle, originatingTarget)
    return
  }

  const secondEnabled = getSettings().secondSidebarEnabled
  const currentSidebar = getTabSidebar(tabId)
  const onSecondary = currentSidebar === 'secondary'

  // Build label state for "Move to ..." item.
  const moveLabel = onSecondary ? 'Move to main drawer' : 'Move to second drawer'
  const moveSidebar: 'primary' | 'secondary' = onSecondary ? 'primary' : 'secondary'

  // Gate: omit "Move to second drawer" when second drawer is disabled,
  // but always allow "Move to main drawer" for secondary-assigned tabs.
  const canShowMove = moveSidebar === 'primary' || secondEnabled

  if (!_contextMenu) {
    _contextMenu = createAssignmentContextMenu()
    document.body.appendChild(_contextMenu)
  }

  _contextMenu.innerHTML = ''

  // 1. Toggle labels
  const showLabels = isShowTabLabels()
  const toggleLabel = showLabels ? 'Hide labels' : 'Show labels'
  const toggleItem = createAssignmentContextMenuItem(toggleLabel, () => {
    const next = !showLabels
    const ok = patchHostDrawerSettings({ showTabLabels: next })
    if (ok) {
      // Sync labels on both ON and OFF — the CSS toggle (opacity/height)
      // on secondary/mirror buttons only runs inside syncSecondaryTabLabels,
      // not in the observer path.
      syncSecondaryTabLabels()
    }
  })
  _contextMenu.appendChild(toggleItem)

  // 2. Configure tabs
  const configureItem = createAssignmentContextMenuItem('Configure tabs', () => {
    openConfigureTabsModal()
  })
  _contextMenu.appendChild(configureItem)

  // 3. Divider
  if (canShowMove) {
    const divider = createDivider()
    _contextMenu.appendChild(divider)

    // 4. Move to …
    const moveItem = createAssignmentContextMenuItem(moveLabel, () => {
      // Lazy-import assignTab to avoid circular dependency at module load time.
      import('../tabs/assignment').then(m => m.assignTab(tabId, moveSidebar))
    })
    _contextMenu.appendChild(moveItem)
  }

  _contextMenu.style.left = `${x}px`
  _contextMenu.style.top = `${y}px`
  _contextMenu.style.display = 'block'
  _lastContextMenuTarget = originatingTarget ?? null

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

function createAssignmentContextMenu(): HTMLElement {
  injectAssignmentContextMenuStyles()
  const menu = document.createElement('div')
  menu.className = 'canvas-tab-context-menu'
  menu.style.cssText = `
    position: fixed;
    z-index: 11000;
    min-width: 180px;
    padding: 4px;
    background: var(--lumiverse-bg-deep);
    border: 1px solid var(--lumiverse-border);
    border-radius: 10px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.04);
    animation: contextMenuIn 120ms ease-out forwards;
    transform-origin: top left;
    display: none;
  `
  return menu
}

/** Create a visual divider (role="separator") for the context menu. */
function createDivider(): HTMLElement {
  const div = document.createElement('div')
  div.setAttribute('role', 'separator')
  div.style.cssText = `
    height: 1px;
    margin: 4px 8px;
    background: var(--lumiverse-border);
    flex-shrink: 0;
  `
  return div
}

/**
 * Idempotent: creates <style id="canvas-ux-context-menu-styles"> in <head>
 * exactly once. Holds the `contextMenuIn` keyframe (which can't be declared
 * inline) and the body[data-glass] glass variant.
 */
function injectAssignmentContextMenuStyles(): void {
  injectStyles('canvas-ux-context-menu-styles', `
    @keyframes contextMenuIn {
      from { opacity: 0; transform: scale(0.92); }
      to   { opacity: 1; transform: scale(1); }
    }
    @media not (pointer: coarse) {
      body[data-glass] .canvas-tab-context-menu {
        background: color-mix(in srgb, var(--lumiverse-bg-deep) 80%, transparent) !important;
        backdrop-filter: blur(var(--lcs-glass-blur, 8px));
      }
    }
  `)
}

function createAssignmentContextMenuItem(label: string, onClick: () => void, opts?: { danger?: boolean }): HTMLElement {
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
    hideAssignmentMenu()
  })
  return item
}
