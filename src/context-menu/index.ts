// Canvas tab context menu.
//
// A single shared context menu element for right-clicks on extension tabs
// in the main sidebar. Listens for contextmenu events on the main sidebar
// (gated to extension-tab buttons) and shows a "Move to Second Sidebar" /
// "Open in Second Sidebar" / "Move to Main Sidebar" entry that drives
// assignTab from tabs/assignment.
//
// CSS mirrors ~/Lumiverse/frontend/src/components/shared/ContextMenu.module.css
// exactly — z-index 11000, 12px/32px shadow, 1px white-tinted inner ring,
// contextMenuIn entrance animation. The keyframe and body[data-glass] glass
// variant live in injectContextMenuStyles() (can't be declared inline).
//
// Invariants:
//   - At most one menu in the DOM at a time. hideContextMenu removes the
//     element (not just hides it) so the next showAssignmentMenu creates a
//     fresh element and the contextMenuIn animation re-runs cleanly.
//     Matches Lumiverse's openMenus registry invariant
//     (ContextMenu.tsx:52, 68-78).
//   - Any new contextmenu (Lumiverse's shared menu, canvas's own handler on
//     a different tab, or the browser's default) closes the canvas menu
//     first. Enforced by a capture-phase document-level contextmenu listener.

import { getMainSidebar } from '../dom/lumiverse'
import { findStoreData, getDrawerTabs } from '../store'
import { getTabSidebar, assignTab } from '../tabs/assignment'
import { isSecondarySidebarOpen } from '../sidebar/secondary'

let _contextMenu: HTMLElement | null = null
// Called by sidebar/cleanup.cleanupAll on teardown.
export function disposeContextMenu(): void {
  if (_contextMenu) {
    _contextMenu.remove()
    _contextMenu = null
  }
}

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

function createContextMenu(): HTMLElement {
  injectContextMenuStyles()
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
    /* forwards keeps opacity:1 + transform:none applied after the 120ms
       entrance finishes, so the keyframe end state sticks and DevTools
       inspection of the live element does not catch it at the 0%/0.92 start. */
    animation: contextMenuIn 120ms ease-out forwards;
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

export function startContextMenuListener() {
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

export function stopContextMenuListener() {
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
