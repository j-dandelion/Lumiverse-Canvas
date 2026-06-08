// Secondary sidebar context menu (Canvas-owned DOM menu).
//
// This menu appears when right-clicking a tab in the secondary sidebar.
// The main sidebar's context menu is now handled by injection into
// Lumiverse's built-in ContextMenu (context-menu/index.ts).
//
// Extracted from buttons.ts to isolate the context menu DOM construction,
// menu item creation, positioning, and event handlers from the tab button
// management logic.

import { getTabSidebar } from '../tabs/assignment'
import { isSecondarySidebarOpen } from '../sidebar/secondary'
import { injectStyles } from '../debug/styles'

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
  if (!_contextMenu) {
    _contextMenu = createAssignmentContextMenu()
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
    label = 'Open in second sidebar'
    targetSidebar = 'secondary'
  } else {
    label = 'Move to second sidebar'
    targetSidebar = 'secondary'
  }

  const item = createAssignmentContextMenuItem(label, () => {
    // Lazy-import assignTab to avoid circular dependency at module load time.
    import('../tabs/assignment').then(m => m.assignTab(tabId, targetSidebar))
  })
  _contextMenu.appendChild(item)
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
