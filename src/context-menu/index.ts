// Canvas tab context menu — injection into Lumiverse's built-in menu.
//
// Instead of maintaining a separate DOM menu for extension tabs in the
// main sidebar, we inject a "Move to second sidebar" / "Move to Main"
// Sidebar" item into Lumiverse's own ContextMenu (rendered via React
// portal to document.body).
//
// The secondary sidebar keeps its own Canvas-owned context menu
// (showAssignmentMenu in tabs/buttons.ts) since Lumiverse doesn't
// render tabs there.
//
// Event flow:
//   1. User right-clicks extension tab → contextmenu event fires
//   2. docCtxCapture (capture phase) detects the extension tab, sets
//      _pendingTabInfo. Does NOT call stopPropagation() — Lumiverse's
//      handler fires normally.
//   3. Lumiverse renders ContextMenu portal to document.body
//   4. MutationObserver detects the new menu element
//   5. requestAnimationFrame (ensures React committed the DOM)
//   6. Canvas appends divider + move button into the menu

import { getMainSidebar } from '../dom/lumiverse'
import { findStoreData, getDrawerTabs } from '../store'
import { getTabSidebar, assignTab } from '../tabs/assignment'
import { isSecondarySidebarOpen } from '../sidebar/secondary'
import { getSettings } from '../settings/state'
import { hideAssignmentMenu } from '../tabs/tab-context-menu'

/**
 * Re-clamp the Lumiverse context menu position after Canvas has injected
 * additional items that increased its height. Mirrors the clamping logic
 * in Lumiverse's ContextMenu.tsx useLayoutEffect (lines 152-167).
 */
function clampMenuToViewport(menu: HTMLElement): void {
  const uiScale = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--lumiverse-ui-scale'),
  ) || 1
  const rect = menu.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  if (rect.right > vw - 8) {
    menu.style.left = `${(vw - rect.width - 8) / uiScale}px`
  }
  if (rect.bottom > vh - 8) {
    menu.style.top = `${(vh - rect.height - 8) / uiScale}px`
  }
}

// --- Main sidebar injection state ---

interface PendingTabInfo {
  tabId: string
  currentSidebar: 'primary' | 'secondary'
  btn: HTMLElement
}

let _pendingTabInfo: PendingTabInfo | null = null
let _injected = false
let _observer: MutationObserver | null = null

// --- MutationObserver: detect Lumiverse's ContextMenu portal ---

// Detection uses 5 heuristics (last child of body + DIV + position:fixed +
// z-index:11000 + contains button). Canvas's own menus are removed synchronously
// before this observer fires, so false positives are not a practical concern.
function findLumiverseContextMenu(): HTMLElement | null {
  // Lumiverse's ContextMenu component portals to document.body.
  // It's a div with position:fixed and z-index:11000 (ContextMenu.module.css).
  // The class name is CSS-module-hashed in production, so we match by
  // DOM position (last child of body) + computed style.
  const last = document.body.lastElementChild as HTMLElement | null
  if (!last || last.tagName !== 'DIV') return null
  const style = getComputedStyle(last)
  if (style.position !== 'fixed') return null
  if (style.zIndex !== '11000') return null
  // Sanity: must contain at least one button (Lumiverse's menu items)
  if (!last.querySelector('button')) return null
  return last
}

function startObserver(): void {
  if (_observer) return
  _observer = new MutationObserver(() => {
    if (_injected || !_pendingTabInfo) return
    // Give React one frame to commit the DOM after state update.
    requestAnimationFrame(() => {
      if (_injected || !_pendingTabInfo) return
      const menu = findLumiverseContextMenu()
      if (!menu) return
      injectCanvasItem(menu, _pendingTabInfo)
      _injected = true
      _pendingTabInfo = null
      stopObserver()
    })
  })
  _observer.observe(document.body, { childList: true })
}

function stopObserver(): void {
  if (_observer) {
    _observer.disconnect()
    _observer = null
  }
}

// --- Injection: append Canvas item into Lumiverse's rendered menu ---

function injectCanvasItem(menu: HTMLElement, info: PendingTabInfo): void {
  // Derive the move label from the tab's current sidebar position.
  let label: string
  let targetSidebar: 'primary' | 'secondary'
  if (info.currentSidebar === 'secondary' && isSecondarySidebarOpen()) {
    label = 'Move to Main Sidebar'
    targetSidebar = 'primary'
  } else if (info.currentSidebar === 'secondary' && !isSecondarySidebarOpen()) {
    label = 'Open in second sidebar'
    targetSidebar = 'secondary'
  } else {
    label = 'Move to second sidebar'
    targetSidebar = 'secondary'
  }

  // Don't show the move option when the second sidebar is disabled —
  // there's nothing to move to.
  if (targetSidebar === 'secondary' && !getSettings().secondSidebarEnabled) return

  // Divider — matches Lumiverse's ContextMenu.module.css .divider
  const divider = document.createElement('div')
  divider.style.cssText = 'height:1px;margin:4px 8px;background:var(--lumiverse-border)'
  menu.appendChild(divider)

  // Button — copy styles from Lumiverse's first existing menu button
  // to ensure visual consistency across themes and UI scales.
  const refBtn = menu.querySelector('button') as HTMLElement | null
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = label

  if (refBtn) {
    // Copy computed styles from an existing Lumiverse menu item.
    const rs = getComputedStyle(refBtn)
    btn.style.cssText = [
      'display', 'alignItems', 'gap', 'width', 'padding',
      'border', 'borderRadius', 'background', 'fontFamily',
      'cursor', 'transition', 'textAlign',
    ].map(p => `${p.replace(/([A-Z])/g, '-$1').toLowerCase()}:${rs.getPropertyValue(p.replace(/([A-Z])/g, '-$1').toLowerCase())}`).join(';')
    // Override color and font-size to match .item (not .itemDanger / .itemActive)
    btn.style.color = 'var(--lumiverse-text)'
    btn.style.fontSize = 'calc(12.5px * var(--lumiverse-font-scale, 1))'
  } else {
    // Fallback if no reference button found (shouldn't happen).
    btn.style.cssText = `
      display:flex;align-items:center;gap:8px;width:100%;
      padding:8px 12px;border:none;border-radius:6px;background:none;
      color:var(--lumiverse-text);
      font-size:calc(12.5px * var(--lumiverse-font-scale, 1));
      font-family:inherit;cursor:pointer;transition:background 120ms ease;
      text-align:left;
    `
  }

  btn.addEventListener('mouseenter', () => {
    btn.style.background = 'var(--lumiverse-fill, rgba(255, 255, 255, 0.06))'
  })
  btn.addEventListener('mouseleave', () => {
    btn.style.background = 'none'
  })
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    assignTab(info.tabId, targetSidebar)
    // Close Lumiverse's context menu — click its backdrop or trigger Escape.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  })

  menu.appendChild(btn)

  // Re-clamp after injection: the added items may have pushed the menu
  // below the viewport. Lumiverse's initial clamp ran before we injected.
  // No rAF needed — getBoundingClientRect() forces synchronous layout.
  clampMenuToViewport(menu)
}

// --- Document-level listeners ---

let _contextMenuListenersActive = false
let _handlers: {
  docCtxCapture: ((e: Event) => void) | null
  docClick: ((e: Event) => void) | null
  docScroll: ((e: Event) => void) | null
  docKey: ((e: KeyboardEvent) => void) | null
} = { docCtxCapture: null, docClick: null, docScroll: null, docKey: null }

export function startContextMenuListener(): void {
  if (_contextMenuListenersActive) return

  const docCtxCapture = (e: Event) => {
    const evt = e as MouseEvent

    // Close any open Canvas context menu (from secondary sidebar).
    hideAssignmentMenu()

    // Capture _pendingTabInfo for main sidebar injection.
    // Must run in capture phase because Lumiverse's useLongPress.onContextMenu
    // calls stopPropagation() in the bubble phase, preventing bubble-phase
    // document listeners from firing.
    const target = evt.target as HTMLElement
    const tabBtn = target?.closest?.('button[title]') as HTMLElement | null
    if (!tabBtn) { _pendingTabInfo = null; return }

    // Only for extension tabs (after .tabDivider)
    const isExtension = tabBtn.classList.toString().includes('Extension')
      || tabBtn.previousElementSibling?.classList.toString().includes('Divider')
    if (!isExtension) { _pendingTabInfo = null; return }

    // Only for main sidebar — findStoreData + getDrawerTabs resolves the tab.
    const sidebar = getMainSidebar()
    if (!sidebar || !sidebar.contains(tabBtn)) { _pendingTabInfo = null; return }

    const title = tabBtn.getAttribute('title') || ''
    findStoreData(true)
    const tabs = getDrawerTabs()
    const matchedTab = tabs.find(t => t.title === title)
    const tabId = matchedTab?.id || title
    const currentSidebar = getTabSidebar(tabId)

    _pendingTabInfo = { tabId, currentSidebar, btn: tabBtn }
    _injected = false
    startObserver()
  }

  const docClick = (e: Event) => {
    // Close Canvas menu (secondary sidebar) on outside click.
    hideAssignmentMenu()
  }
  const docScroll = () => hideAssignmentMenu()
  const docKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') hideAssignmentMenu()
  }

  document.addEventListener('contextmenu', docCtxCapture, true)
  document.addEventListener('click', docClick)
  document.addEventListener('scroll', docScroll, true)
  document.addEventListener('keydown', docKey)

  _handlers = { docCtxCapture, docClick, docScroll, docKey }
  _contextMenuListenersActive = true
}

export function stopContextMenuListener(): void {
  if (!_contextMenuListenersActive) return
  const h = _handlers
  if (h.docCtxCapture) document.removeEventListener('contextmenu', h.docCtxCapture, true)
  if (h.docClick) document.removeEventListener('click', h.docClick)
  if (h.docScroll) document.removeEventListener('scroll', h.docScroll, true)
  if (h.docKey) document.removeEventListener('keydown', h.docKey)
  _handlers = { docCtxCapture: null, docClick: null, docScroll: null, docKey: null }
  _contextMenuListenersActive = false
  stopObserver()
  _pendingTabInfo = null
  _injected = false
  hideAssignmentMenu()
}
