// Canvas-owned main drawer when keepTabListVisible is on (desktop).
//
// Same shape as the secondary drawer (shared createDrawerShell):
//   - Hide host main chrome via document-level CSS (no class fight with React).
//   - Canvas shell = visible chrome (tab list, panel frame, header, open/close).
//   - Host panelContent is soft-reparented into shell.content (like secondary
//     parks extension roots) for the whole time mode is active — open/close
//     transform and resize are free (content lives in the flex/transform tree).
//   - No body overlay, no per-frame fixed-position layout, no MutationObserver.
//   - Mirror tab buttons forward .click() for activation.
//
// Canvas-only — no Lumiverse source changes.

import { getMainPanelContent, getMainWrapper, getMainDrawerWidth } from '../dom/lumiverse'
import { clampSidebarWidth } from '../dom/clamp'
import { getMainDrawerSide, isMainDrawerOpen } from '../store'
import { getSettings } from '../settings/state'
import { dlog, dwarn } from '../debug/log'
import { animateWrapper } from './animation'
import {
  closedTransformPx,
  createDrawerShell,
  readWidthCssVar,
  type DrawerShell,
} from './drawer-shell'
import { isMobileViewport } from './mobile-exclusion'
import {
  applyPinnedTabListChrome,
  applyTabListPosition,
  clearPinnedTabListChrome,
  destroyMainPinHost,
  ensureMainPinHost,
  TAB_LIST_SPACER_CLASS,
  TAB_LIST_WIDTH_PX,
} from './tab-position'
import {
  MAIN_MIRROR_WIDTH_VAR,
  CANVAS_MAIN_ACTIVE_CLASS,
  CANVAS_MAIN_OPEN_CLASS,
} from './styles'

export { MAIN_MIRROR_WIDTH_VAR }

/** Marks the host panelContent node while it lives in the Canvas shell. */
const CONTENT_MARK_ATTR = 'data-canvas-main-panel-content'

let _active = false
let _open = false
let _shell: DrawerShell | null = null
let _pinSpacer: HTMLElement | null = null
let _tabListRestoreParent: HTMLElement | null = null
let _tabListRestoreNext: ChildNode | null = null
let _contentEl: HTMLElement | null = null
let _contentRestoreParent: HTMLElement | null = null
let _contentRestoreNext: ChildNode | null = null
/** Last side we mounted for — skip full remount when unchanged. */
let _mountedSide: 'left' | 'right' | null = null
/** Soft re-park if React pulls content back into the host tree. */
let _reparkTimer: ReturnType<typeof setTimeout> | null = null

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
 * When on (desktop): hide host drawer chrome, mount shell, pin tab list,
 * park host panelContent into the shell (secondary-style).
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

  // Already mounted on the correct side — keep content parked.
  if (_active && _shell && _mountedSide === side && !opts?.force) {
    ensureHostContentParked()
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
  applyMainMirrorDrawer(true, {
    force: false,
    initialOpen: opts?.initialOpen,
  })
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

function persistCanvasMainOpenState(): void {
  // Same write path as secondary open/close — snapshot reads open class +
  // MAIN_MIRROR_WIDTH_VAR while canvas-main mode is active.
  void import('../layout/persist').then((m) => m.persistOpenState())
}

/**
 * Apply a restored primary width to the mirror CSS var and, if closed,
 * recompute the off-screen transform so the shell fully hides at the new width.
 */
export function applyMainMirrorRestoredWidth(widthPx: number): void {
  const w = Math.ceil(clampSidebarWidth(widthPx))
  if (!(w > 0)) return
  document.documentElement.style.setProperty(MAIN_MIRROR_WIDTH_VAR, `${w}px`)
  if (_shell && !_open) {
    _shell.wrapper.style.transform = `translateX(${closedTransformPx(_shell.side, w)}px)`
  }
}

export function openCanvasMainDrawer(): void {
  if (!_shell || !_active) return
  ensureHostContentParked()
  if (_open) {
    dlog('[main-mirror] open (already open)')
    _shell.wrapper.style.transform = 'translateX(0)'
    return
  }
  dlog(`[main-mirror] open side=${_shell.side}`)
  _open = true
  document.documentElement.classList.add(CANVAS_MAIN_OPEN_CLASS)
  _shell.drawerTab.classList.add('sidebar-ux-drawer-tab--active')
  // Content is a child of the shell — one animateWrapper moves chrome + content.
  animateWrapper(_shell.wrapper, 0)
  void import('./main-tab-pin').then((m) => m.reconcileMainTabListPin())
  bumpReflow()
  persistCanvasMainOpenState()
}

export function closeCanvasMainDrawer(): void {
  if (!_shell || !_active) return
  if (!_open) return
  const side = _shell.side
  const w = readWidthCssVar(MAIN_MIRROR_WIDTH_VAR, 420)
  dlog(`[main-mirror] close side=${side} closedTx=${closedTransformPx(side, w)}`)
  animateWrapper(_shell.wrapper, closedTransformPx(side, w))
  _open = false
  document.documentElement.classList.remove(CANVAS_MAIN_OPEN_CLASS)
  _shell.drawerTab.classList.remove('sidebar-ux-drawer-tab--active')
  clearMainMirrorActiveHighlights()
  // Content stays parked in the shell while mode is active (secondary parity).
  bumpReflow()
  persistCanvasMainOpenState()
}

/** Clear active highlight on main mirror tab buttons (secondary close parity). */
function clearMainMirrorActiveHighlights(): void {
  const list = getMainMirrorTabList()
  if (!list) return
  for (const btn of list.querySelectorAll('button.sidebar-ux-tab-active')) {
    btn.classList.remove('sidebar-ux-tab-active')
  }
}

export function setCanvasMainTitle(text: string): void {
  if (_shell?.title) _shell.title.textContent = text || 'Drawer'
}

/** Called after mirror tab click to open + title. Content already in shell. */
export function onMainMirrorTabActivated(title?: string): void {
  if (!_active) return
  if (title) setCanvasMainTitle(title)
  // Host React may swap panel children a frame later — re-park if needed.
  ensureHostContentParked()
  openCanvasMainDrawer()
  requestAnimationFrame(() => ensureHostContentParked())
}

export function __resetMainMirrorForTest(): void {
  teardownMainMirror()
}

function injectHostHideStyles(): void {
  const id = 'sidebar-ux-host-main-hide'
  const css = `
    /* Hide host main drawer chrome while Canvas owns main UX.
     * opacity:0 is required: host panelContent often has
     * visibility:visible and would paint through visibility:hidden alone. */
    html.${CANVAS_MAIN_ACTIVE_CLASS} [class*="_wrapper_"]:has([data-spindle-mount="sidebar"]) {
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
      /* Avoid transform trapping any leftover fixed descendants. */
      transform: none !important;
      transition: none !important;
    }
    html.${CANVAS_MAIN_ACTIVE_CLASS} [class*="_wrapper_"]:has([data-spindle-mount="sidebar"]) [class*="drawerTab"] {
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    /* Any host panel body still under the host tree (mid tab-switch
     * remount before repark) must not paint through. */
    html.${CANVAS_MAIN_ACTIVE_CLASS} [class*="_wrapper_"]:has([data-spindle-mount="sidebar"]) [class*="_panelContent_"] {
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    /*
     * Host panelContent parked in the Canvas shell fills the content slot
     * like a secondary-drawer tab root — in normal flow, not position:fixed.
     *
     * Skip visibility/opacity force while html.sidebar-ux-main-restore-pending
     * (see main-persist restore guard). Otherwise visibility:visible !important
     * paints profile content through a parent with visibility:hidden.
     */
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content > [${CONTENT_MARK_ATTR}] {
      flex: 1 1 auto;
      min-height: 0;
      min-width: 0;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      overflow: auto;
      position: relative !important;
      top: auto !important;
      left: auto !important;
      right: auto !important;
      bottom: auto !important;
    }
    html:not(.sidebar-ux-main-restore-pending)
      .sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content > [${CONTENT_MARK_ATTR}] {
      visibility: visible !important;
      pointer-events: auto !important;
      opacity: 1 !important;
    }
  `
  if (typeof document === 'undefined' || !document.head) return
  let el = document.getElementById(id) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = id
    document.head.appendChild(el)
  }
  el.textContent = css
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
    // keepTabListVisible: pinned tab strip is the open/close chrome — no edge toggle.
    drawerTabDisplay: 'none',
    onDrawerTabClick: () => {
      if (_open) closeCanvasMainDrawer()
      else openCanvasMainDrawer()
    },
    onHeaderClose: () => closeCanvasMainDrawer(),
  })

  // Shell content is a flex column host for reparented host panelContent
  // (same role as secondary panel content for extension roots).
  _shell.content.style.display = 'flex'
  _shell.content.style.flexDirection = 'column'
  _shell.content.style.padding = '0'
  _shell.content.setAttribute('data-canvas-main-content-slot', '1')

  document.body.appendChild(_shell.wrapper)
  _active = true
  _open = opts.initialOpen
  _mountedSide = side

  if (_open) {
    document.documentElement.classList.add(CANVAS_MAIN_OPEN_CLASS)
    _shell.drawerTab.classList.add('sidebar-ux-drawer-tab--active')
  } else {
    document.documentElement.classList.remove(CANVAS_MAIN_OPEN_CLASS)
    _shell.drawerTab.classList.remove('sidebar-ux-drawer-tab--active')
  }

  pinShellTabList(side)

  applyTabListPosition(getSettings().moveControlsToOuterEdge, {
    mainDrawer: _shell.drawer,
    mainTabList: getMainMirrorTabList() ?? _shell.tabList,
    mainPanel: _shell.panel,
  })

  // Park host panelContent into the shell for the whole mode lifetime.
  ensureHostContentParked()
  startReparkWatch()

  if (!_open && isMainDrawerOpen()) {
    openCanvasMainDrawer()
  }

  void import('./drawer-sync').then((m) => m.syncDrawerTabSettings())
  // Stamp host panel-header metrics onto this shell (secondary + main-mirror).
  void import('./panel-header-sync').then((m) => {
    m.resetPanelHeaderSyncCache()
    m.syncPanelHeaderFromMain(() => _shell?.wrapper ?? null)
  })
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
      _pinSpacer.setAttribute('aria-hidden', 'true')
      _pinSpacer.style.width = `${TAB_LIST_WIDTH_PX}px`
      _pinSpacer.style.flexShrink = '0'
      _tabListRestoreParent.insertBefore(_pinSpacer, _tabListRestoreNext)
    }
    host.appendChild(tabList)
  }

  applyPinnedTabListChrome(tabList, side)
}

function unpinShellTabList(): void {
  if (!_shell) return
  const tabList = _shell.tabList
  clearPinnedTabListChrome(tabList)
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

/**
 * Resolve host panelContent even after it has been moved into the shell
 * (getMainPanelContent only walks the host panel tree).
 */
function resolveHostPanelContent(): HTMLElement | null {
  if (_contentEl?.isConnected) return _contentEl
  const fromHost = getMainPanelContent()
  if (fromHost) return fromHost
  if (typeof document === 'undefined') return null
  return document.querySelector(`[${CONTENT_MARK_ATTR}]`) as HTMLElement | null
}

/**
 * Soft-reparent host panelContent into shell.content — same pattern as
 * secondary assignToSecondary parking extension roots. No fixed overlay,
 * no layout ticker: content is in the shell's flex + transform tree.
 */
function ensureHostContentParked(): void {
  if (!_shell || !_active) return
  const slot = _shell.content
  const hostContent = resolveHostPanelContent()
  if (!hostContent || !slot.isConnected) {
    dlog(
      `[main-mirror] park skip hostContent=${!!hostContent} slot=${!!slot?.isConnected}`,
    )
    return
  }

  _contentEl = hostContent
  hostContent.setAttribute(CONTENT_MARK_ATTR, '1')

  const restorePending =
    typeof document !== 'undefined'
    && document.documentElement.classList.contains('sidebar-ux-main-restore-pending')

  if (hostContent.parentElement !== slot) {
    if (!_contentRestoreParent) {
      _contentRestoreParent = hostContent.parentElement
      _contentRestoreNext = hostContent.nextSibling
    }
    // Clear any leftover fixed-overlay styles from earlier approaches.
    // During restore-pending, do NOT clear visibility/opacity — main-persist
    // stamps those so the profile body never paints mid-tab-switch.
    const s = hostContent.style
    for (const prop of [
      'top', 'left', 'right', 'bottom', 'width', 'height',
      'position', 'z-index',
      'margin', 'box-sizing', 'overflow', 'background',
    ]) {
      s.removeProperty(prop)
    }
    if (!restorePending) {
      for (const prop of ['visibility', 'opacity', 'pointer-events']) {
        s.removeProperty(prop)
      }
    }
    slot.appendChild(hostContent)
    dlog('[main-mirror] parked panelContent in shell.content (secondary-style)')
  }

  // Keep host chrome suppressed (React may re-apply transform).
  const wrap = getMainWrapper()
  if (wrap) {
    wrap.style.setProperty('transform', 'none', 'important')
    wrap.style.setProperty('transition', 'none', 'important')
    wrap.style.setProperty('visibility', 'hidden', 'important')
    wrap.style.setProperty('pointer-events', 'none', 'important')
  }

  // Re-apply restore hide after park (new nodes / cleared styles).
  if (restorePending) {
    void import('./main-persist').then((m) => {
      m.stampPanelBodyHide()
    }).catch(() => { /* ignore */ })
  }
}

/** Public repark for restore path (tab click remounts host panelContent). */
export function ensureHostContentParkedPublic(): void {
  ensureHostContentParked()
}

function restoreHostContent(): void {
  if (_contentEl) {
    const s = _contentEl.style
    for (const prop of [
      'top', 'left', 'right', 'bottom', 'width', 'height',
      'position', 'z-index', 'visibility', 'opacity', 'pointer-events',
      'margin', 'box-sizing', 'overflow', 'background',
    ]) {
      s.removeProperty(prop)
    }
    if (
      _contentRestoreParent &&
      _contentEl.parentElement !== _contentRestoreParent
    ) {
      try {
        _contentRestoreParent.insertBefore(_contentEl, _contentRestoreNext)
      } catch {
        try {
          _contentRestoreParent.appendChild(_contentEl)
        } catch {
          /* host panel may have been unmounted */
        }
      }
    }
    _contentEl.removeAttribute(CONTENT_MARK_ATTR)
  }
  _contentEl = null
  _contentRestoreParent = null
  _contentRestoreNext = null
}

function startReparkWatch(): void {
  stopReparkWatch()
  // Lightweight poll — no MutationObserver (that fought React). If host
  // React re-inserts panelContent under the hidden wrapper, put it back.
  // Faster interval while restore-pending so tab-switch remounts don't
  // paint profile under the host for a frame.
  const tickMs = () =>
    (typeof document !== 'undefined'
      && document.documentElement.classList.contains('sidebar-ux-main-restore-pending'))
      ? 50
      : 500
  const tick = () => {
    _reparkTimer = null
    if (!_active || !_shell) return
    const el = resolveHostPanelContent()
    if (el && el.parentElement !== _shell.content) {
      dlog('[main-mirror] re-park: React moved panelContent back to host')
      ensureHostContentParked()
    }
    _reparkTimer = setTimeout(tick, tickMs())
  }
  _reparkTimer = setTimeout(tick, tickMs())
}

function stopReparkWatch(): void {
  if (_reparkTimer !== null) {
    clearTimeout(_reparkTimer)
    _reparkTimer = null
  }
}

function clearHostWrapperInline(): void {
  const wrap = getMainWrapper()
  if (!wrap) return
  for (const prop of ['transform', 'transition', 'visibility', 'pointer-events', 'z-index']) {
    wrap.style.removeProperty(prop)
  }
}

function teardownMainMirror(opts?: { keepWidthVar?: boolean }): void {
  stopReparkWatch()
  restoreHostContent()
  clearHostWrapperInline()
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
