// Canvas-owned main drawer when keepTabListVisible is on (desktop).
//
// Headless host + Canvas shell (no React reparenting):
//   - Host main wrapper is hidden via document-level CSS (no class fight
//     with React on the host node).
//   - Canvas shell provides visible chrome (tab list, panel frame, header).
//   - Host panel *content* is revealed with visibility:visible under a
//     hidden ancestor and positioned over the Canvas panel — React keeps
//     owning those nodes; we never appendChild them out of the host tree
//     (reparenting caused freezes from React↔Canvas thrash).
//   - Mirror tab buttons forward .click() for activation.
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
import {
  MAIN_MIRROR_WIDTH_VAR,
  CANVAS_MAIN_ACTIVE_CLASS,
  CANVAS_MAIN_OPEN_CLASS,
} from './styles'

export { MAIN_MIRROR_WIDTH_VAR }

let _active = false
let _open = false
let _shell: DrawerShell | null = null
let _pinSpacer: HTMLElement | null = null
let _tabListRestoreParent: HTMLElement | null = null
let _tabListRestoreNext: ChildNode | null = null
let _layoutRaf: number | null = null
let _contentEl: HTMLElement | null = null
/** Last side we mounted for — skip full remount when unchanged. */
let _mountedSide: 'left' | 'right' | null = null

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
 * When on (desktop): hide host drawer chrome, mount shell, pin tab list.
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

  const side = getMainDrawerSide()

  // Already mounted on the correct side — light touch only.
  if (_active && _shell && _mountedSide === side && !opts?.force) {
    return
  }

  // Side change or force: remount shell.
  if (_active && (_mountedSide !== side || opts?.force)) {
    const wasOpen = _open
    teardownMainMirror({ keepWidthVar: true })
    mountMainMirror({ initialOpen: opts?.initialOpen ?? wasOpen })
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
  if (!on) {
    applyMainMirrorDrawer(false, { force: true })
    return
  }
  // Prefer soft apply — only remount on side mismatch.
  applyMainMirrorDrawer(true, {
    force: false,
    initialOpen: opts?.initialOpen,
  })
  // If force remount requested via initialOpen after side change:
  if (opts?.initialOpen !== undefined && _active && !_open && opts.initialOpen) {
    openCanvasMainDrawer()
  }
}

function bumpReflow(): void {
  void import('../chat/reflow').then((m) => m.updateChatReflow())
}

function bumpResizeHandles(): void {
  void import('../resize/handles').then((m) => m.mountResizeHandles())
}

export function openCanvasMainDrawer(): void {
  if (!_shell || !_active) return
  if (_open) {
    scheduleContentLayout()
    return
  }
  animateWrapper(_shell.wrapper, 0)
  _open = true
  document.documentElement.classList.add(CANVAS_MAIN_OPEN_CLASS)
  scheduleContentLayout()
  bumpReflow()
}

export function closeCanvasMainDrawer(): void {
  if (!_shell || !_active) return
  if (!_open) return
  const side = _shell.side
  const w = readWidthCssVar(MAIN_MIRROR_WIDTH_VAR, 420)
  animateWrapper(_shell.wrapper, closedTransformPx(side, w))
  _open = false
  document.documentElement.classList.remove(CANVAS_MAIN_OPEN_CLASS)
  clearContentLayout()
  bumpReflow()
}

export function setCanvasMainTitle(text: string): void {
  if (_shell?.title) _shell.title.textContent = text || 'Drawer'
}

/** Called after mirror tab click to open + layout content + title. */
export function onMainMirrorTabActivated(title?: string): void {
  if (!_active) return
  if (title) setCanvasMainTitle(title)
  openCanvasMainDrawer()
  // Host React may commit new panel content a frame later.
  scheduleContentLayout()
  requestAnimationFrame(() => scheduleContentLayout())
}

export function __resetMainMirrorForTest(): void {
  teardownMainMirror()
  _layoutRaf = null
}

function injectHostHideStyles(): void {
  // Document-level markers only — never mutate host wrapper className
  // (React owns it; fighting className caused observer loops).
  injectStyles('sidebar-ux-host-main-hide', `
    /* Hide entire host main drawer chrome while Canvas owns main UX. */
    html.${CANVAS_MAIN_ACTIVE_CLASS} [class*="_wrapper_"]:has([data-spindle-mount="sidebar"]) {
      visibility: hidden !important;
      pointer-events: none !important;
    }
    /*
     * visibility:hidden is inherited; a child can opt back in with
     * visibility:visible. When Canvas main is open, reveal host panel
     * content only and park it over the Canvas panel rect (inline styles
     * set by layoutHostPanelContent). React keeps the node in the host tree.
     */
    html.${CANVAS_MAIN_ACTIVE_CLASS}.${CANVAS_MAIN_OPEN_CLASS} [class*="_wrapper_"]:has([data-spindle-mount="sidebar"]) [class*="_panelContent_"] {
      visibility: visible !important;
      pointer-events: auto !important;
      position: fixed !important;
      z-index: 9995 !important;
      margin: 0 !important;
      box-sizing: border-box !important;
      overflow: auto !important;
    }
    /* Hide host drawer tab (edge toggle) so it does not double with Canvas. */
    html.${CANVAS_MAIN_ACTIVE_CLASS} [class*="_wrapper_"]:has([data-spindle-mount="sidebar"]) [class*="drawerTab"] {
      visibility: hidden !important;
      pointer-events: none !important;
    }
  `)
}

function mountMainMirror(opts: { initialOpen: boolean }): void {
  injectHostHideStyles()
  document.documentElement.classList.add(CANVAS_MAIN_ACTIVE_CLASS)

  const side = getMainDrawerSide()
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

  // Panel content area is a positioning target only — host content is
  // overlaid via fixed layout, not reparented into this node.
  _shell.content.style.background = 'transparent'
  _shell.content.setAttribute('data-canvas-main-content-slot', '1')

  document.body.appendChild(_shell.wrapper)
  _active = true
  _open = opts.initialOpen
  _mountedSide = side

  if (_open) {
    document.documentElement.classList.add(CANVAS_MAIN_OPEN_CLASS)
  } else {
    document.documentElement.classList.remove(CANVAS_MAIN_OPEN_CLASS)
  }

  pinShellTabList(side)

  applyTabListPosition(getSettings().moveControlsToOuterEdge, {
    drawer: _shell.drawer,
    tabList: getMainMirrorTabList(),
    handle: _shell.drawer.querySelector('.sidebar-ux-resize-handle') as HTMLElement | null,
  })

  if (_open) scheduleContentLayout()

  // If host was already open when mode enabled, open Canvas shell once.
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

function scheduleContentLayout(): void {
  if (_layoutRaf !== null) return
  _layoutRaf = requestAnimationFrame(() => {
    _layoutRaf = null
    layoutHostPanelContent()
  })
}

/**
 * Position host panel content over the Canvas panel content slot.
 * Does NOT reparent — React keeps ownership of the node tree.
 */
function layoutHostPanelContent(): void {
  if (!_shell || !_active || !_open) return
  const slot = _shell.content
  const hostContent = getMainPanelContent()
  if (!hostContent || !slot.isConnected) return

  _contentEl = hostContent
  const rect = slot.getBoundingClientRect()
  // Skip zero-size (closed / not laid out yet).
  if (rect.width < 1 || rect.height < 1) return

  const s = hostContent.style
  s.setProperty('top', `${Math.round(rect.top)}px`, 'important')
  s.setProperty('left', `${Math.round(rect.left)}px`, 'important')
  s.setProperty('width', `${Math.round(rect.width)}px`, 'important')
  s.setProperty('height', `${Math.round(rect.height)}px`, 'important')
}

function clearContentLayout(): void {
  if (_contentEl) {
    const s = _contentEl.style
    s.removeProperty('top')
    s.removeProperty('left')
    s.removeProperty('width')
    s.removeProperty('height')
    // position/visibility come from CSS when open class is on; leaving
    // residual fixed top/left would stick content after close.
  }
  _contentEl = null
}

function teardownMainMirror(opts?: { keepWidthVar?: boolean }): void {
  if (_layoutRaf !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(_layoutRaf)
    _layoutRaf = null
  }
  clearContentLayout()
  unpinShellTabList()

  if (_shell) {
    const handles = _shell.drawer.querySelectorAll('.sidebar-ux-resize-handle')
    for (const h of Array.from(handles)) h.remove()
    _shell.wrapper.remove()
    _shell = null
  }

  if (!opts?.keepWidthVar) {
    const w = readWidthCssVar(MAIN_MIRROR_WIDTH_VAR, 0)
    if (w > 0) {
      const wrapper = getMainWrapper()
      if (wrapper) {
        wrapper.style.setProperty(
          '--drawer-panel-w',
          `${Math.ceil(clampSidebarWidth(w))}px`,
          'important',
        )
      }
    }
    document.documentElement.style.removeProperty(MAIN_MIRROR_WIDTH_VAR)
  }

  document.documentElement.classList.remove(CANVAS_MAIN_ACTIVE_CLASS)
  document.documentElement.classList.remove(CANVAS_MAIN_OPEN_CLASS)
  _active = false
  _open = false
  _mountedSide = null
  bumpReflow()
}
