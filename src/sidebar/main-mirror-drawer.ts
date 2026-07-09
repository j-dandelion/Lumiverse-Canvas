// Canvas-owned main drawer when keepTabListVisible is on (desktop).
//
// Headless host + Canvas shell:
//   - Host React main wrapper is visibility:hidden (never used as the
//     visible chrome while mode is active).
//   - Canvas shell (shared drawer-shell factory) provides full drawer UI
//     identical to secondary: tab list, panel, header, open/close animation.
//   - Tab list is pinned to a body-level host (always visible).
//   - Host panel content is reparented into the Canvas panel (portal).
//   - Mirror tab buttons forward .click() to host buttons for activation.
//
// Canvas-only — no Lumiverse source changes.

import { getMainPanelContent, getMainWrapper, getMainDrawerWidth } from '../dom/lumiverse'
import { clampSidebarWidth } from '../dom/clamp'
import { getMainDrawerSide, isMainDrawerOpen } from '../store'
import { getSettings } from '../settings/state'
import { animateWrapper } from './animation'
import {
  closedTransformPx,
  createDrawerShell,
  readWidthCssVar,
  type DrawerShell,
} from './drawer-shell'
import { isMobileViewport } from './mobile-exclusion'
import {
  applyTabListPosition,
  destroyMainPinHost,
  ensureMainPinHost,
  TAB_LIST_PINNED_CLASS,
  TAB_LIST_SPACER_CLASS,
  TAB_LIST_WIDTH_PX,
} from './tab-position'
import { injectStyles } from '../debug/styles'
import { MAIN_MIRROR_WIDTH_VAR, HOST_MAIN_HIDDEN_CLASS, CANVAS_MAIN_ACTIVE_CLASS } from './styles'

export { MAIN_MIRROR_WIDTH_VAR }

let _active = false
let _open = false
let _shell: DrawerShell | null = null
let _hiddenWrapper: HTMLElement | null = null
let _portalNode: HTMLElement | null = null
let _portalRestoreParent: HTMLElement | null = null
let _portalRestoreNext: ChildNode | null = null
let _pinSpacer: HTMLElement | null = null
let _tabListRestoreParent: HTMLElement | null = null
let _tabListRestoreNext: ChildNode | null = null
let _portalObserver: MutationObserver | null = null
let _wrapperObserver: MutationObserver | null = null
let _portalRaf: number | null = null
let _observedWrapper: HTMLElement | null = null

/** CSS width var for the Canvas main mirror drawer. */
export function getMainMirrorWidthVar(): string {
  return MAIN_MIRROR_WIDTH_VAR
}

export function isMainMirrorActive(): boolean {
  return _active && !isMobileViewport()
}

export function isCanvasMainOpen(): boolean {
  return _open && isMainMirrorActive()
}

export function getMainMirrorWrapper(): HTMLElement | null {
  return _shell?.wrapper ?? null
}

export function getMainMirrorDrawer(): HTMLElement | null {
  return _shell?.drawer ?? null
}

export function getMainMirrorTabList(): HTMLElement | null {
  if (!_shell) return null
  // Prefer pinned list on main pin host when reparented.
  const host = ensureMainPinHost(getMainDrawerSide())
  if (host) {
    const pinned = host.querySelector('.sidebar-ux-tab-list') as HTMLElement | null
    if (pinned) return pinned
  }
  return _shell.tabList
}

export function getMainMirrorPanelContent(): HTMLElement | null {
  return _shell?.content ?? null
}

export function getMainMirrorTitleEl(): HTMLElement | null {
  return _shell?.title ?? null
}

/**
 * Enable/disable Canvas main mirror mode.
 * When on (desktop): hide host drawer, mount shell, pin tab list.
 * When off / mobile: full teardown and host restore.
 */
export function applyMainMirrorDrawer(
  enabled: boolean,
  opts?: { force?: boolean; initialOpen?: boolean },
): void {
  if (isMobileViewport()) {
    if (_active || opts?.force) teardownMainMirror()
    return
  }

  if (!enabled) {
    teardownMainMirror()
    return
  }

  if (_active && !opts?.force) {
    ensureHostHidden()
    return
  }

  // Remount cleanly when force-reapplying.
  if (_active && opts?.force) {
    const wasOpen = _open
    teardownMainMirror({ keepWidthVar: true })
    mountMainMirror({ initialOpen: opts.initialOpen ?? wasOpen })
    return
  }

  mountMainMirror({
    initialOpen: opts?.initialOpen ?? false,
  })
}

/** Re-apply from settings (mount, side-change, viewport cross-up). */
export function reconcileMainMirrorDrawer(opts?: { initialOpen?: boolean }): void {
  if (isMobileViewport()) {
    applyMainMirrorDrawer(false, { force: true })
    return
  }
  const on = !!getSettings().keepTabListVisible
  applyMainMirrorDrawer(on, {
    force: true,
    initialOpen: opts?.initialOpen,
  })
}

function bumpReflow(): void {
  // Lazy import avoids reflow ↔ main-mirror circular init.
  void import('../chat/reflow').then((m) => m.updateChatReflow())
}

function bumpResizeHandles(): void {
  void import('../resize/handles').then((m) => m.mountResizeHandles())
}

export function openCanvasMainDrawer(): void {
  if (!_shell || !_active) return
  if (_open) {
    schedulePortalSync()
    return
  }
  animateWrapper(_shell.wrapper, 0)
  _open = true
  schedulePortalSync()
  bumpReflow()
}

export function closeCanvasMainDrawer(): void {
  if (!_shell || !_active) return
  if (!_open) return
  const side = _shell.side
  const w = readWidthCssVar(MAIN_MIRROR_WIDTH_VAR, 420)
  animateWrapper(_shell.wrapper, closedTransformPx(side, w))
  _open = false
  bumpReflow()
}

/** Set header title text on the Canvas main shell. */
export function setCanvasMainTitle(text: string): void {
  if (_shell?.title) _shell.title.textContent = text || 'Drawer'
}

/** Called after mirror tab click to open + portal + title. */
export function onMainMirrorTabActivated(title?: string): void {
  if (!_active) return
  if (title) setCanvasMainTitle(title)
  openCanvasMainDrawer()
  schedulePortalSync()
}

export function __resetMainMirrorForTest(): void {
  teardownMainMirror()
  _portalRaf = null
}

function injectHostHideStyles(): void {
  injectStyles('sidebar-ux-host-main-hide', `
    .${HOST_MAIN_HIDDEN_CLASS} {
      visibility: hidden !important;
      pointer-events: none !important;
    }
    /* Mirror shell reuses secondary tab chrome via shared pin-host rules +
       its own wrapper selector. */
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button[data-tab-id],
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn {
      color: var(--lumiverse-text-muted);
      border-radius: 8px;
      background: transparent;
      border: none;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 100%;
      padding: 8px 4px;
      box-sizing: border-box;
    }
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn:hover {
      background: var(--lumiverse-primary-015);
      color: var(--lumiverse-text);
    }
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn.sidebar-ux-tab-active {
      background: var(--lumiverse-primary-020);
      color: var(--lumiverse-primary);
      box-shadow: inset 3px 0 0 var(--lumiverse-primary);
      border-radius: 0 8px 8px 0;
    }
    .sidebar-ux-main-mirror-wrapper.sidebar-ux-side-left .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn.sidebar-ux-tab-active {
      box-shadow: inset -3px 0 0 var(--lumiverse-primary);
      border-radius: 8px 0 0 8px;
    }
  `)
}

function mountMainMirror(opts: { initialOpen: boolean }): void {
  injectHostHideStyles()
  document.documentElement.classList.add(CANVAS_MAIN_ACTIVE_CLASS)

  const side = getMainDrawerSide()
  // Seed width from host drawer if available so first open matches.
  let seedW: number | undefined
  try {
    const hostW = getMainDrawerWidth()
    seedW = hostW > 0 ? hostW : undefined
  } catch {
    seedW = undefined
  }

  _shell = createDrawerShell({
    owner: 'main',
    side,
    widthCssVar: MAIN_MIRROR_WIDTH_VAR,
    defaultWidth: 420,
    initialWidth: seedW,
    initialOpen: opts.initialOpen,
    title: 'Drawer',
    drawerTabDisplay: 'none',
    onDrawerTabClick: () => {
      if (_open) closeCanvasMainDrawer()
      else openCanvasMainDrawer()
    },
    onHeaderClose: () => closeCanvasMainDrawer(),
  })

  document.body.appendChild(_shell.wrapper)
  _active = true
  _open = opts.initialOpen

  pinShellTabList(side)
  ensureHostHidden()
  ensureWrapperObserver()
  ensurePortalObserver()

  applyTabListPosition(getSettings().moveControlsToOuterEdge, {
    drawer: _shell.drawer,
    tabList: getMainMirrorTabList(),
    handle: _shell.drawer.querySelector('.sidebar-ux-resize-handle') as HTMLElement | null,
  })

  // Host may have been "open" — Canvas owns open state now.
  // If layout asked for open, portal immediately.
  if (_open) schedulePortalSync()

  // If host is open (user had main open before toggle), open Canvas shell.
  if (!_open && isMainDrawerOpen()) {
    openCanvasMainDrawer()
  }

  bumpResizeHandles()
  bumpReflow()
}

function pinShellTabList(side: 'left' | 'right'): void {
  if (!_shell) return
  const tabList = _shell.tabList
  const host = ensureMainPinHost(side)
  if (!host) return

  // Spacer in drawer so flex layout still reserves strip width when open.
  if (tabList.parentElement && tabList.parentElement !== host) {
    _tabListRestoreParent = tabList.parentElement
    _tabListRestoreNext = tabList.nextSibling
    if (!_pinSpacer) {
      _pinSpacer = document.createElement('div')
      _pinSpacer.className = TAB_LIST_SPACER_CLASS
      _pinSpacer.style.width = `${TAB_LIST_WIDTH_PX}px`
      _pinSpacer.style.flexShrink = '0'
      _tabListRestoreParent.insertBefore(_pinSpacer, _tabListRestoreNext)
    }
    host.appendChild(tabList)
  }

  tabList.classList.add(TAB_LIST_PINNED_CLASS)
  // Fixed chrome on the list itself (same as prior main-tab-pin strip).
  tabList.style.position = 'fixed'
  tabList.style.top = 'env(safe-area-inset-top, 0px)'
  tabList.style.bottom = 'env(safe-area-inset-bottom, 0px)'
  tabList.style.zIndex = '10000'
  tabList.style.width = `${TAB_LIST_WIDTH_PX}px`
  tabList.style.pointerEvents = 'auto'
  tabList.style.display = 'flex'
  tabList.style.flexDirection = 'column'
  tabList.style.alignItems = 'center'
  tabList.style.overflowY = 'auto'
  tabList.style.overflowX = 'hidden'
  tabList.style.boxSizing = 'border-box'
  tabList.style.background = 'var(--lumiverse-bg-panel, var(--lumiverse-bg, #1a1a1a))'
  if (side === 'right') {
    tabList.style.right = '0'
    tabList.style.left = ''
    tabList.style.borderLeft = '1px solid var(--lumiverse-primary-020)'
    tabList.style.borderRight = 'none'
  } else {
    tabList.style.left = '0'
    tabList.style.right = ''
    tabList.style.borderRight = '1px solid var(--lumiverse-primary-020)'
    tabList.style.borderLeft = 'none'
  }
}

function unpinShellTabList(): void {
  if (!_shell) return
  const tabList = _shell.tabList
  tabList.classList.remove(TAB_LIST_PINNED_CLASS)
  tabList.style.position = ''
  tabList.style.top = ''
  tabList.style.bottom = ''
  tabList.style.left = ''
  tabList.style.right = ''
  tabList.style.zIndex = ''
  tabList.style.pointerEvents = ''
  // Restore into drawer if we still have a parent pointer.
  if (_tabListRestoreParent && tabList.parentElement !== _tabListRestoreParent) {
    _tabListRestoreParent.insertBefore(tabList, _tabListRestoreNext)
  }
  if (_pinSpacer) {
    _pinSpacer.remove()
    _pinSpacer = null
  }
  _tabListRestoreParent = null
  _tabListRestoreNext = null
  destroyMainPinHost()
}

function ensureHostHidden(): void {
  const wrapper = getMainWrapper()
  if (!wrapper) return
  if (_hiddenWrapper && _hiddenWrapper !== wrapper) {
    _hiddenWrapper.classList.remove(HOST_MAIN_HIDDEN_CLASS)
  }
  wrapper.classList.add(HOST_MAIN_HIDDEN_CLASS)
  _hiddenWrapper = wrapper
  if (wrapper !== _observedWrapper) {
    attachWrapperObserver(wrapper)
  }
}

function unhideHost(): void {
  if (_hiddenWrapper) {
    _hiddenWrapper.classList.remove(HOST_MAIN_HIDDEN_CLASS)
    _hiddenWrapper = null
  }
  // Also clear any leftover class if wrapper was replaced.
  const live = getMainWrapper()
  if (live) live.classList.remove(HOST_MAIN_HIDDEN_CLASS)
  document.documentElement.classList.remove(CANVAS_MAIN_ACTIVE_CLASS)
}

function schedulePortalSync(): void {
  if (_portalRaf !== null) return
  _portalRaf = requestAnimationFrame(() => {
    _portalRaf = null
    // Double-rAF so host React can commit after hostBtn.click().
    requestAnimationFrame(() => portalHostContent())
  })
}

function portalHostContent(): void {
  if (!_shell || !_active || !_open) return
  const hostContent = getMainPanelContent()
  if (!hostContent) return

  // Already under our content.
  if (hostContent.parentElement === _shell.content) {
    _portalNode = hostContent
    return
  }

  // Host recreated content — restore previous if still in our panel.
  if (_portalNode && _portalNode !== hostContent && _portalNode.parentElement === _shell.content) {
    // Leave old node; host owns the new one. Restore old if we can.
    restorePortalNode(_portalNode)
  }

  if (!_portalRestoreParent) {
    _portalRestoreParent = hostContent.parentElement
    _portalRestoreNext = hostContent.nextSibling
  }
  _shell.content.appendChild(hostContent)
  _portalNode = hostContent
}

function restorePortalNode(node: HTMLElement | null): void {
  if (!node) return
  if (_portalRestoreParent && node.parentElement !== _portalRestoreParent) {
    try {
      _portalRestoreParent.insertBefore(node, _portalRestoreNext)
    } catch {
      try {
        _portalRestoreParent.appendChild(node)
      } catch {
        /* host may have gone away */
      }
    }
  }
}

function restorePortal(): void {
  if (_portalNode) {
    restorePortalNode(_portalNode)
  }
  _portalNode = null
  _portalRestoreParent = null
  _portalRestoreNext = null
}

function ensurePortalObserver(): void {
  if (typeof MutationObserver === 'undefined') return
  if (_portalObserver) return
  // Watch host panel area for content replacement after tab activation.
  const drawer = getMainWrapper()
  if (!drawer) return
  _portalObserver = new MutationObserver(() => {
    if (_active && _open) schedulePortalSync()
    // Host open intent while mirror active → open Canvas shell.
    if (_active && !_open && isMainDrawerOpen()) {
      openCanvasMainDrawer()
    }
    ensureHostHidden()
  })
  _portalObserver.observe(drawer, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
}

function ensureWrapperObserver(): void {
  const wrapper = getMainWrapper()
  if (wrapper) attachWrapperObserver(wrapper)
}

function attachWrapperObserver(wrapper: HTMLElement): void {
  if (typeof MutationObserver === 'undefined') return
  if (_wrapperObserver && _observedWrapper === wrapper) return
  if (_wrapperObserver) {
    _wrapperObserver.disconnect()
    _wrapperObserver = null
  }
  _observedWrapper = wrapper
  _wrapperObserver = new MutationObserver(() => {
    if (!_active) return
    ensureHostHidden()
    if (!_open && isMainDrawerOpen()) {
      openCanvasMainDrawer()
    }
  })
  _wrapperObserver.observe(wrapper, { attributes: true, attributeFilter: ['class'] })
}

function stopObservers(): void {
  if (_portalObserver) {
    _portalObserver.disconnect()
    _portalObserver = null
  }
  if (_wrapperObserver) {
    _wrapperObserver.disconnect()
    _wrapperObserver = null
  }
  _observedWrapper = null
  if (_portalRaf !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(_portalRaf)
    _portalRaf = null
  }
}

function teardownMainMirror(opts?: { keepWidthVar?: boolean }): void {
  stopObservers()
  restorePortal()
  unpinShellTabList()

  if (_shell) {
    // Remove resize handle on this drawer.
    const handles = _shell.drawer.querySelectorAll('.sidebar-ux-resize-handle')
    for (const h of Array.from(handles)) h.remove()
    _shell.wrapper.remove()
    _shell = null
  }

  // Copy Canvas width onto host so toggle-off keeps similar size.
  if (!opts?.keepWidthVar) {
    const w = readWidthCssVar(MAIN_MIRROR_WIDTH_VAR, 0)
    if (w > 0) {
      const hostDrawer = getMainWrapper()?.querySelector?.('[class*="_drawer_"]') as HTMLElement | null
        ?? null
      // Prefer lumiverse helpers via width var on host wrapper.
      const wrapper = getMainWrapper()
      if (wrapper) {
        wrapper.style.setProperty('--drawer-panel-w', `${Math.ceil(clampSidebarWidth(w))}px`, 'important')
      }
      void hostDrawer
    }
    document.documentElement.style.removeProperty(MAIN_MIRROR_WIDTH_VAR)
  }

  unhideHost()
  _active = false
  _open = false
  bumpReflow()
}
