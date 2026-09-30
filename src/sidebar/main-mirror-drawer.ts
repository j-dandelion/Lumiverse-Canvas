// Canvas-owned main drawer (desktop AND mobile — S6).
//
// Same shape as the secondary drawer (shared createDrawerShell):
//   - Hide host main chrome via document-level CSS (no class fight with React).
//   - Canvas shell = visible chrome (tab list, panel frame, header, open/close).
//   - Host panelContent is soft-reparented into shell.content (like secondary
//     parks extension roots) for the whole time mode is active — open/close
//     transform and resize are free (content lives in the flex/transform tree).
//   - No body overlay, no per-frame fixed-position layout, no MutationObserver.
//   - Mirror tab buttons forward .click() for activation.
//   - Mobile (≤600px): shell = full-bleed main surface, horizontal tab list
//     (@media CSS), mutual exclusion with the secondary (S6). Restyle-in-place
//     on viewport crossing — no remount (content stays parked).
//
// Canvas-only — no Lumiverse source changes.

import { getMainPanelContent, getMainWrapper, getMainDrawerWidth } from '../dom/lumiverse'
import { clampSidebarWidth } from '../dom/clamp'
import { getMainDrawerSide, isMainDrawerOpen } from '../store'
import {
  getDrawerLocation,
  getSettings,
  getStripEdge,
  isHideDrawerOpenCloseButtonsEnabled,
  isHorizontalStrip,
  isTaskbarModeEnabled,
} from '../settings/state'
import { dlog, dwarn } from '../debug/log'
import { cancelWrapperAnimation } from './animation'
import { animateDrawerClose, animateDrawerOpen } from './panel-motion'
import {
  closedTransformPx,
  createDrawerShell,
  FULL_BLEED_WIDTH_EXPR,
  readUiScale,
  readWidthCssVar,
  restyleShellSide,
  syncSpacerForLocation,
  type DrawerShell,
} from './drawer-shell'
import {
  enforceExclusionOnOpen,
  isMobileViewport,
  isHostMobileDrawerViewport,
  setMobileOpenClass,
} from './mobile-exclusion'
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
  MAIN_MIRROR_MOBILE_CSS,
  CANVAS_MAIN_ACTIVE_CLASS,
  CANVAS_MAIN_OPEN_CLASS,
} from './styles'
import { injectStyles } from '../debug/styles'
import { updateChatReflow } from '../chat/reflow'
import { mountResizeHandles } from '../resize/handles'
import { syncDrawerTabSettings } from './drawer-sync'
import { resetPanelHeaderSyncCache, syncPanelHeaderFromMain } from './panel-header-sync'
import { handlePanelHeaderClose } from '../os/header-close'
import { setDrawerCommandHandler } from '../os/drawer-command'
import { isInstanceActive } from '../lifecycle/instance'

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
/** S6: desktop width captured on cross-down so cross-up can restore it
 *  (the mobile full-bleed width overwrites MAIN_MIRROR_WIDTH_VAR). */
let _desktopWidth: number | null = null
export function getMainMirrorWidthVar(): string {
  return MAIN_MIRROR_WIDTH_VAR
}

export function isMainMirrorActive(): boolean {
  // S6: platform-neutral — the shell owns the main surface on desktop AND
  // mobile (full-bleed, horizontal list). No mobile gate.
  return _active
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
  // The shell's tabList is THE list — when taskbar chrome is on it is
  // reparented into the body-level pin host (same node), otherwise it rides
  // inside the drawer. Never call ensureMainPinHost here (S1: pin-host
  // creation is gated on taskbar visual at the pin sites).
  return _shell?.tabList ?? null
}

/** The shell's panel frame (tab list + panel flex parent). Used by the
 *  side-swap geometry pass so `applyTabListPosition` targets the VISIBLE
 *  Canvas shell, not the hidden host main drawer. */
export function getMainMirrorPanel(): HTMLElement | null {
  return _shell?.panel ?? null
}

export function getMainMirrorPanelContent(): HTMLElement | null {
  return _shell?.content ?? null
}

export function getMainMirrorTitleEl(): HTMLElement | null {
  return _shell?.title ?? null
}

/**
 * Enable/disable Canvas main mirror mode (desktop AND mobile — S6: the
 * shell owns the main surface on both).
 * When on: hide host drawer chrome, mount shell, pin tab list (desktop
 * taskbar chrome only), park host panelContent into the shell.
 */
export function applyMainMirrorDrawer(
  enabled: boolean,
  opts?: { force?: boolean; initialOpen?: boolean },
): void {
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

  // S4: side change without force = CSS-only restyle in place. No
  // teardown/remount mid-session (container churn, content re-park and
  // boot-flash risk all disappear with the remount path).
  if (_active && _shell && !opts?.force) {
    restyleMainShellSide(side)
    ensureHostContentParked()
    syncDrawerTabSettings()
    return
  }

  // Force: full remount (explicit rebuild / mobile viewport transitions).
  if (_active && opts?.force) {
    const wasOpen = _open
    teardownMainMirror({ keepWidthVar: true })
    mountMainMirror({ initialOpen: opts?.initialOpen ?? wasOpen })
    return
  }

  mountMainMirror({
    initialOpen: opts?.initialOpen ?? false,
  })
}

/** Re-apply from settings (mount, side-change, viewport cross). S6: no
 *  platform gate — the shell owns both desktop and mobile; crossings
 *  restyle in place via syncMainMirrorToViewport (called from
 *  mobile-exclusion's cross handlers). */
export function reconcileMainMirrorDrawer(opts?: { initialOpen?: boolean }): void {
  // S1 gate inversion: the main drawer shell is Canvas-owned unconditionally
  // — taskbarMode no longer gates ownership (it only controls the pin
  // chrome, applied at the pin sites in main-tab-pin / tab-position).
  applyMainMirrorDrawer(true, {
    force: false,
    initialOpen: opts?.initialOpen,
  })
  if (opts?.initialOpen !== undefined && _active && !_open && opts.initialOpen) {
    openCanvasMainDrawer()
  }
}

function bumpReflow(): void {
  updateChatReflow()
}

function bumpResizeHandles(): void {
  mountResizeHandles()
}

/**
 * Persist the shell's current open/width into the owned model (S5 write path).
 * Exported for `restoreMainDrawerFromDom`: after the restore guard lifts, the
 * layout's target state is re-asserted so a boot-window host-truth sync cannot
 * leave the model/disk stale-true for a persisted-closed drawer.
 */
export function persistCanvasMainOpenState(): void {
  // S5: same write path as secondary open/close — dispatch setDrawer(primary)
  // through the owned model (recon/dispatch). With observe() reading SHELL
  // truth (CANVAS_MAIN_OPEN_CLASS + MAIN_MIRROR_WIDTH_VAR, restore-gated),
  // reconcile sees world==model after adoption → no drift, no host writes,
  // no loop. This makes close-the-shell persist IMMEDIATELY (secondary
  // parity) instead of waiting for the next host-sync. Dynamic import keeps
  // the module graph cycle-free; a failed dispatch is swallowed — the next
  // host-sync re-converges the model from the shell via observe().
  void import('../recon/dispatch')
    .then((m) => m.dispatch({
      t: 'setDrawer',
      side: 'primary',
      open: _open,
      width: readWidthCssVar(MAIN_MIRROR_WIDTH_VAR, 420),
    }))
    .catch((err: unknown) => {
      dwarn(`[main-mirror] setDrawer(primary) dispatch failed: ${err}`)
    })
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
    // A settling close would write the OLD width's closed transform after us.
    cancelWrapperAnimation(_shell.wrapper)
    _shell.wrapper.style.transform = `translateX(${closedTransformPx(_shell.side, w)}px)`
  }
}

/**
 * S4 CSS-only side swap: restyle the mounted main shell for a new anchor
 * side, in place — no teardown/remount, content stays parked. Stamps
 * `_shell.side` + `_mountedSide` (closeCanvasMainDrawer /
 * applyMainMirrorRestoredWidth read `_shell.side` for the closed
 * transform) and recomputes the wrapper transform for the open state.
 */
export function restyleMainShellSide(side: 'left' | 'right'): void {
  if (!_shell || !_active) return
  const w = readWidthCssVar(MAIN_MIRROR_WIDTH_VAR, 420)
  // An in-flight bloom carries the OLD origin/closed transform — settle it
  // before restyling (spec: side swap is a hard geometry change).
  cancelWrapperAnimation(_shell.wrapper)
  restyleShellSide(_shell.wrapper, side)
  _shell.side = side
  _mountedSide = side
  _shell.wrapper.style.transform = _open
    ? 'translateX(0)'
    : `translateX(${closedTransformPx(side, w)}px)`
  bumpReflow()
}

export function openCanvasMainDrawer(): void {
  if (!_shell || !_active) return
  // Shadow suppression key: the inline box-shadow on .sidebar-ux-drawer must
  // die whenever the shell is closed (the closed translate leaves the drawer
  // edge at ~-1px, and the shadow spreads 60px into the viewport). Written
  // BEFORE the already-open early return so a stale attr can never survive a
  // repeated call (secondary parity, secondary.tsx open/close).
  _shell.wrapper.dataset.drawerOpen = 'true'
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
  // Content is a child of the shell — the panel motion moves chrome + content.
  animateDrawerOpen(_shell.wrapper, _shell.drawer, 'primary')
  void import('./main-tab-pin').then((m) => m.reconcileMainTabListPin()).catch((err) => { dwarn(`[main-mirror] reconcileMainTabListPin failed: ${err}`) })
  bumpReflow()
  persistCanvasMainOpenState()
  mobileExclusionAfterToggle(true)
}

export function closeCanvasMainDrawer(): void {
  if (!_shell || !_active) return
  // Written before the already-closed early return (drift defense) — see
  // openCanvasMainDrawer.
  _shell.wrapper.dataset.drawerOpen = 'false'
  if (!_open) return
  const side = _shell.side
  const w = readWidthCssVar(MAIN_MIRROR_WIDTH_VAR, 420)
  dlog(`[main-mirror] close side=${side} closedTx=${closedTransformPx(side, w)}`)
  animateDrawerClose(_shell.wrapper, _shell.drawer, closedTransformPx(side, w), 'primary')
  _open = false
  document.documentElement.classList.remove(CANVAS_MAIN_OPEN_CLASS)
  _shell.drawerTab.classList.remove('sidebar-ux-drawer-tab--active')
  clearMainMirrorActiveHighlights()
  // Content stays parked in the shell while mode is active (secondary parity).
  bumpReflow()
  persistCanvasMainOpenState()
  mobileExclusionAfterToggle(false)
}

/** S6 mobile exclusion: mirror the shell open state into the mobile body
 *  class and, when OPENING on mobile, close the secondary silently (same
 *  semantics the host-side classObserver hook provided while the host
 *  wrapper was the surface — secondary.open=true survives in layout.json).
 *  Desktop: no-op. Secondary-open → shell-close runs the other direction
 *  via mobile-exclusion's enforceExclusionOnOpen('secondary'). */
function mobileExclusionAfterToggle(open: boolean): void {
  if (!isMobileViewport()) return
  try {
    setMobileOpenClass('primary', open)
    if (open) enforceExclusionOnOpen('primary')
  } catch (err) {
    dwarn(`[main-mirror] mobile exclusion failed: ${err}`)
  }
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

/**
 * D17 parking: no displayed window → no header title, no stale parked
 * content. The attribute (sheet rule, `display:none !important`) hides the
 * content slot without touching the parked host DOM; the title is cleared
 * directly because the renderer only ever writes titles for an active key.
 * The next activation render restores the title; clearing the attribute
 * never restores it (the renderer owns it).
 */
export function setCanvasMainNoActive(noActive: boolean): void {
  if (!_shell) return
  if (noActive) {
    _shell.wrapper.setAttribute('data-canvas-os-no-active', '1')
    _shell.title.textContent = ''
  } else {
    _shell.wrapper.removeAttribute('data-canvas-os-no-active')
  }
}

/** Called after mirror tab click to open + title. Content already in shell. */
export function onMainMirrorTabActivated(
  title?: string,
  opts?: { open?: boolean },
): void {
  if (!_active) return
  if (title) setCanvasMainTitle(title)

  // Diagnostic: the parked content state at every activation. Children of
  // the parked panelContent should be ONLY the host's TabPanelContent
  // container(s) — orphan roots (e.g. restored DOM-placed roots with
  // data-canvas-moved) render as stacked panels and freeze the content
  // area on the wrong tab (2026-08-17 disable flow).
  try {
    dlog('[main-mirror] content state', {
      parked: _contentEl?.parentElement === _shell?.content,
      children: _contentEl
        ? Array.from(_contentEl.children).map((c) => {
            const cls = (c as HTMLElement).className
            return `${c.tagName}.${String(cls ?? '').slice(0, 60)}`
          })
        : null,
      movedAttrs: _contentEl
        ? Array.from(_contentEl.children).filter((c) => c.hasAttribute?.('data-canvas-moved')).length
        : null,
    })
  } catch {
    /* diagnostic only */
  }

  // Host React may swap panel children a frame later — re-park if needed.
  ensureHostContentParked()
  if (opts?.open === false) {
    // Content re-assert only (boot placement pass): the persisted layout owns
    // open/close. Without this, the pass's re-assert (and its +500ms retry)
    // reopened the shell after restoreMainDrawerFromDom had honored a
    // persisted `primary.open: false` (live-verify: main drawer opens on
    // refresh despite "Remember drawer open/close state").
    dlog('[main-mirror] activation without open (restore re-assert)')
  } else {
    openCanvasMainDrawer()
  }
  requestAnimationFrame(() => ensureHostContentParked())
}

export function __resetMainMirrorForTest(): void {
  teardownMainMirror()
}

/** Update the main mirror's drawer edge toggle visibility based on settings.
 *  No-op when no shell.
 *
 *  Mobile parity with the secondary (`tabs/buttons.ts`
 *  updateDrawerTabVisibility): the hide setting is DESKTOP-ONLY. On mobile the
 *  taskbar pin strip is never mounted (mountMainMirror skips pinShellTabList;
 *  reconcileMainTabListPin unpins), so this edge toggle is the only reopen
 *  affordance for the main drawer — hiding it strands the drawer. The
 *  body-class CSS in SECONDARY_MOBILE_CSS/MAIN_MIRROR_MOBILE_CSS still hides
 *  the toggle while the OTHER drawer is open. Desktop behavior unchanged. */
export function updateMainMirrorDrawerTabVisibility(): void {
  if (!_shell || !_active) return
  // S8: horizontal strips hide the edge handle on both platforms (the strip
  // is the reopen affordance); otherwise S6 mobile keeps it visible.
  const horizontal = isHorizontalStrip()
  _shell.drawerTab.style.display =
    horizontal || (!isMobileViewport() && isHideDrawerOpenCloseButtonsEnabled())
      ? 'none'
      : 'flex'
}

/** S6: mobile horizontal-tab-list + full-bleed CSS for the main shell
 *  (mirror of the secondary's SECONDARY_MOBILE_CSS). Idempotent by id. */
function injectMainMirrorMobileStyles(): void {
  injectStyles('sidebar-ux-main-mirror-mobile', MAIN_MIRROR_MOBILE_CSS)
}

/**
 * S6 restyle-in-place: swap the shell between desktop (var-driven width)
 * and mobile (full-bleed) presentation WITHOUT remounting — content stays
 * parked (S4 invariant). Called from mobile-exclusion's matchMedia cross
 * handler and rAF-coalesced resize path.
 *
 * Width bookkeeping: on cross-down the current desktop width is captured
 * into _desktopWidth BEFORE the full-bleed approx overwrites the var; on
 * cross-up it is restored (fallback: whatever the var holds, clamped).
 */
export function syncMainMirrorToViewport(): void {
  if (!_shell || !_active) return
  // Viewport crossing rewrites width + transform; a live motion would settle
  // against the old geometry (or fight the new transform).
  cancelWrapperAnimation(_shell.wrapper)
  try {
    if (isMobileViewport()) {
      // A desktop shell crossing down needs the mobile stylesheet: it is
      // media-scoped and safe on desktop, but mount only injects it when the
      // shell was BORN mobile. Idempotent (injectStyles dedups by id).
      injectMainMirrorMobileStyles()
      if (_desktopWidth == null) {
        const cur = readWidthCssVar(MAIN_MIRROR_WIDTH_VAR, 0)
        _desktopWidth = cur > 0 ? cur : null
      }
      // Host zooms its children — innerWidth is device-px; un-scale to CSS px
      // (same approximation createDrawerShell uses for the transform var).
      const w = Math.round(window.innerWidth / readUiScale())
      document.documentElement.style.setProperty(MAIN_MIRROR_WIDTH_VAR, `${w}px`)
      _shell.drawer.style.width = FULL_BLEED_WIDTH_EXPR
      _shell.wrapper.style.transform = _open
        ? 'translateX(0)'
        : `translateX(${closedTransformPx(_shell.side, w)}px)`
      // S6: full-bleed shell has no resize affordance — sweep any handles
      // a desktop phase left behind (narrow fine-pointer windows).
      const handles = _shell.drawer.querySelectorAll('.sidebar-ux-resize-handle')
      for (const h of Array.from(handles)) (h as HTMLElement).remove()
    } else {
      const w = _desktopWidth != null
        ? Math.ceil(clampSidebarWidth(_desktopWidth))
        : readWidthCssVar(MAIN_MIRROR_WIDTH_VAR, 420)
      _desktopWidth = null
      document.documentElement.style.setProperty(MAIN_MIRROR_WIDTH_VAR, `${w}px`)
      _shell.drawer.style.width = `var(${MAIN_MIRROR_WIDTH_VAR}, 420px)`
      _shell.wrapper.style.transform = _open
        ? 'translateX(0)'
        : `translateX(${closedTransformPx(_shell.side, w)}px)`
      // Pin chrome may need re-asserting after a mobile phase (the list
      // rode in the drawer; taskbar pin re-applies on desktop).
      void import('./main-tab-pin').then((m) => m.reconcileMainTabListPin()).catch(() => {})
      // Re-assert resize handles (a mobile phase swept them).
      bumpResizeHandles()
    }
  } catch (err) {
    dwarn(`[main-mirror] syncMainMirrorToViewport failed: ${err}`)
  }
  bumpReflow()
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
     * Host mobile backdrop: ViewportDrawer renders a full-screen backdrop as
     * a SIBLING of the wrapper while its drawer state is open (z 9991 > the
     * Canvas shells' 9990), so the wrapper-hide rules above never covered it.
     * Canvas's pre-activation clicks (hostBtn.click() → host
     * handleTabClick → openDrawer()) open the headless host drawer as a
     * side effect, and the backdrop then sat OVER the Canvas drawers,
     * swallowing every tap (live-verify follow-up 2026-09-12). Hide it,
     * scoped through the parent that also holds the real main wrapper so
     * unrelated _backdrop_ modal layers are untouched.
     */
    html.${CANVAS_MAIN_ACTIVE_CLASS} div:has(> [class*="_wrapper_"] [data-spindle-mount="sidebar"]) > [class*="_backdrop_"] {
      display: none !important;
      pointer-events: none !important;
    }
    /*
     * Host panelContent parked in the Canvas shell fills the content slot
     * like a secondary-drawer tab root — in normal flow, not position:fixed.
     *
     * Skip visibility/opacity force while a main-persist visual guard is up:
     * html.sidebar-ux-main-restore-pending (boot restore) or
     * html.sidebar-ux-main-reveal-hold (mid-session mode-switch reveal).
     * Otherwise visibility:visible !important paints profile content through
     * a parent with visibility:hidden.
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
    html:not(.sidebar-ux-main-restore-pending):not(.sidebar-ux-main-reveal-hold)
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
  // LUMI-21 rework (review AC1/AC2): the single choke point for shell
  // mounts. A post-teardown continuation (the traced
  // reconcileDrawerLocation → reconcileMainTabListPin →
  // applyMainMirrorDrawer(true) fan-out) or a stale-instance call must not
  // re-inject the host-hide style + html classes or recreate the shell over
  // the restored vanilla drawer / the next boot's chrome. Teardown goes
  // through teardownMainMirror (never mounts).
  if (!isInstanceActive()) return
  injectHostHideStyles()
  document.documentElement.classList.add(CANVAS_MAIN_ACTIVE_CLASS)

  const side = getMainDrawerSide()
  const mobile = isMobileViewport()
  let seedW: number | undefined
  if (!mobile) {
    try {
      // A keepWidthVar remount (taskbar-chrome toggle) already carries the
      // user's Canvas width in MAIN_MIRROR_WIDTH_VAR — prefer it over the
      // hidden host drawer's width, which Canvas does not keep in sync
      // (review batch 4: enabling taskbar mode used to snap the width back).
      const existing = readWidthCssVar(MAIN_MIRROR_WIDTH_VAR, 0)
      if (existing > 0) {
        seedW = existing
      } else {
        const hostW = getMainDrawerWidth()
        seedW = hostW > 0 ? hostW : undefined
      }
    } catch {
      seedW = undefined
    }
  }

  // Compute initial drawer-tab display: hide is desktop-only. It requires
  // taskbar mode (without the pinned strip the edge toggle is the only reopen
  // affordance) — and mobile never mounts the strip, so the setting must not
  // hide the toggle there either (secondary parity: updateDrawerTabVisibility
  // ignores the setting on mobile).
  const hideTab = !mobile && isHideDrawerOpenCloseButtonsEnabled()

  _shell = createDrawerShell({
    owner: 'main',
    side,
    widthCssVar: MAIN_MIRROR_WIDTH_VAR,
    defaultWidth: 420,
    initialWidth: seedW,
    // S6: mobile = full-bleed main surface (scaled viewport +1px; the px
    // approximation lands in MAIN_MIRROR_WIDTH_VAR for transforms).
    fullViewportWidth: mobile,
    initialOpen: opts.initialOpen,
    title: 'Drawer',
    // S8: reserve the horizontal strip edge at construction (no boot flash).
    stripEdge: getStripEdge(),
    // When hide is on, show the edge toggle only for reopening (none = no chrome).
    drawerTabDisplay: hideTab ? 'none' : 'flex',
    onDrawerTabClick: () => {
      if (_open) closeCanvasMainDrawer()
      else openCanvasMainDrawer()
    },
    onHeaderClose: () => {
      // OS mode (D2/D9): the X closes the displayed window. The OS policy
      // is installed by os/panel-chrome; when unset/OS off, plain close.
      if (!handlePanelHeaderClose('primary')) closeCanvasMainDrawer()
    },
  })

  // Shell content is a flex column host for reparented host panelContent
  // (same role as secondary panel content for extension roots).
  _shell.content.style.display = 'flex'
  _shell.content.style.flexDirection = 'column'
  _shell.content.style.padding = '0'
  _shell.content.setAttribute('data-canvas-main-content-slot', '1')

  if (mobile) injectMainMirrorMobileStyles()

  document.body.appendChild(_shell.wrapper)
  // Drop orphan main-mirror shells left by incomplete teardown / rapid
  // side remounts. Keep only the module-owned wrapper.
  sweepOrphanMainMirrorWrappers()
  _active = true
  _open = opts.initialOpen
  _mountedSide = side

  // Shell command seam (os/drawer-command.ts): OS actions (X/minimize/D19
  // open) must command the shell directly — the model→host setDrawer write
  // for primary is suppressed while the shell owns the surface.
  setDrawerCommandHandler((commandSide, open) => {
    if (commandSide !== 'primary' || !_active || !_shell) return false
    if (open) openCanvasMainDrawer()
    else closeCanvasMainDrawer()
    return true
  })

  if (_open) {
    document.documentElement.classList.add(CANVAS_MAIN_OPEN_CLASS)
    _shell.drawerTab.classList.add('sidebar-ux-drawer-tab--active')
  } else {
    document.documentElement.classList.remove(CANVAS_MAIN_OPEN_CLASS)
    _shell.drawerTab.classList.remove('sidebar-ux-drawer-tab--active')
  }

  // S6: pin chrome is desktop taskbar visual only — on mobile the list
  // rides inside the full-bleed drawer (horizontal @media CSS).
  // S8: Top/Bottom pins on mobile too (the strip is the tab surface).
  if (!mobile || isHorizontalStrip()) pinShellTabList(side)

  applyTabListPosition(getSettings().moveControlsToOuterEdge, {
    mainDrawer: _shell.drawer,
    mainTabList: getMainMirrorTabList() ?? _shell.tabList,
    mainPanel: _shell.panel,
  })

  // Park host panelContent into the shell for the whole mode lifetime.
  ensureHostContentParked()

  if (!_open && isMainDrawerOpen()) {
    openCanvasMainDrawer()
  }

  syncDrawerTabSettings()
  // Stamp host panel-header metrics onto this shell (secondary + main-mirror).
  resetPanelHeaderSyncCache()
  syncPanelHeaderFromMain(() => _shell?.wrapper ?? null)
  // S6: no resize handles on a full-bleed shell (crossing sweeps/re-mounts
  // them via syncMainMirrorToViewport).
  if (!mobile) bumpResizeHandles()
  bumpReflow()
}

/** S1 gate: reparent the shell tab list into the body-level pin host ONLY
 *  when taskbar chrome is on (tabs pinned to the screen edge). Off → the
 *  list rides inside the drawer (mount-time; runtime flips go through
 *  pinMainMirrorShellTabList / unpinMainMirrorShellTabList). */
function pinShellTabList(side: 'left' | 'right'): void {
  if (!_shell) return
  if (!isTaskbarModeEnabled()) return
  pinMainMirrorShellTabList(side)
}

/** Reparent the shell tab list into the pin host (idempotent). Returns the
 *  host, or null when no shell / no body. Pin callers gate on their own
 *  pin state — this helper never checks settings. */
export function pinMainMirrorShellTabList(side: 'left' | 'right'): HTMLElement | null {
  // LUMI-21 rework (review AC2): a stale instance's pin pass must not
  // reparent tab lists into a (new) pin host or restyle a shell it no
  // longer owns. Own-instance teardown unpins via unpinShellTabList.
  if (!isInstanceActive()) return null
  if (!_shell) return null
  const tabList = _shell.tabList
  const host = ensureMainPinHost(side)
  if (!host) return null

  if (tabList.parentElement && tabList.parentElement !== host) {
    _tabListRestoreParent = tabList.parentElement
    _tabListRestoreNext = tabList.nextSibling
    if (!_pinSpacer) {
      _pinSpacer = document.createElement('div')
      _pinSpacer.className = TAB_LIST_SPACER_CLASS
      _pinSpacer.setAttribute('aria-hidden', 'true')
      _pinSpacer.style.flexShrink = '0'
      _tabListRestoreParent.insertBefore(_pinSpacer, _tabListRestoreNext)
    }
    host.appendChild(tabList)
  }

  // S8: 56px column placeholder on Sides, 0×0 horizontal (unconditional —
  // covers location flips while already pinned).
  syncSpacerForLocation(_pinSpacer, getDrawerLocation())
  applyPinnedTabListChrome(tabList, side)

  // S8: Sides pinned — the 56px spacer is in flow and must sit on the outer
  // (screen-edge) side: side-right → row-reverse, side-left → row. Same
  // contract as the secondary pinTabList / restyleShellSide. Horizontal
  // neutralizes the spacer to 0×0, so skip the write there (it would fight
  // the horizontal layout). Without this a location flip (Top→Sides) left
  // the drawer at its unpinned flex — the panel rode 56px under the pin
  // strip with a gap on the inner side (live report 2026-09-14; toggling
  // outer-edge off/on masked it by running applyTabListPosition unpinned).
  if (!isHorizontalStrip()) {
    const wantFlex = side === 'right' ? 'row-reverse' : 'row'
    if (_shell.drawer.style.flexDirection !== wantFlex) {
      _shell.drawer.style.flexDirection = wantFlex
    }
  }
  return host
}

/** S1: move the (possibly pinned) shell tab list back inside the drawer and
 *  destroy the pin host. Safe when never pinned (no-op). */
export function unpinMainMirrorShellTabList(): void {
  unpinShellTabList()
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
 *
 * CONTENT-DRIFT WARNING (2026-07-31): this is the host's single panel
 * content node — its inner content is whatever Lumiverse renders. After a
 * container move (`requestTabLocation ok via=bridge`) the host remounts
 * the drawer content area and can re-resolve the panel to the FIRST
 * remaining tab while `tabBtnActive` stays on the real active — the mirror
 * then shows another tab's content with the wrong header. The observed
 * world has no panel-content signal, so reconcile cannot detect it. The
 * remedy is the re-assert in placementFirstMoveByLiveId (re-click the
 * active key's host button). See docs/pitfalls.md §6.
 *
 * STALE-NODE GUARD (2026-08-17): the cached parked node (`_contentEl`) is
 * only a FALLBACK now. If the host's React tree re-creates panelContent
 * (drawer content-area remount) while the old node is still parked and
 * connected in the shell, returning the cached node would freeze the
 * mirror on the old content forever — every tab click updates the mirror
 * chrome but the content never follows (Configure → "Enable second drawer"
 * OFF → activation stops switching content). The host's own panel node is
 * authoritative whenever it exists; the parked copy is only used while the
 * host tree is empty (mid-park, early boot).
 */
function resolveHostPanelContent(): HTMLElement | null {
  const fromHost = getMainPanelContent()
  if (fromHost) return fromHost
  if (_contentEl?.isConnected) return _contentEl
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

  // Diagnostic + eviction: if the host's React tree replaced panelContent
  // (drawer content-area remount after container moves / mode switches),
  // the old parked node is STALE — the host renders into the new node and
  // the mirror would show frozen content. Evict the stale node from the
  // shell slot and log the identity change so a "content stuck" report can
  // be traced to a host-side remount.
  if (_contentEl && _contentEl !== hostContent) {
    dlog('[main-mirror] parked content node replaced by host (re-parking)', {
      hadMark: _contentEl.hasAttribute?.(CONTENT_MARK_ATTR) ?? false,
    })
    if (_contentEl.parentElement === slot) {
      slot.removeChild(_contentEl)
    }
    _contentEl.removeAttribute?.(CONTENT_MARK_ATTR)
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
    // During a visual guard (boot restore-pending / mid-session reveal hold),
    // do NOT clear visibility/opacity — main-persist stamps those so the
    // profile body never paints mid-tab-switch.
    const s = hostContent.style
    for (const prop of [
      'top', 'left', 'right', 'bottom', 'width', 'height',
      'position', 'z-index',
      'margin', 'box-sizing', 'overflow', 'background',
    ]) {
      s.removeProperty(prop)
    }
    const visualGuard =
      restorePending
      || (typeof document !== 'undefined'
        && document.documentElement.classList.contains('sidebar-ux-main-reveal-hold'))
    if (!visualGuard) {
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
    }).catch((err) => { dwarn(`[main-mirror] stampPanelBodyHide failed: ${err}`) })
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

function clearHostWrapperInline(): void {
  const wrap = getMainWrapper()
  if (!wrap) return
  for (const prop of ['transform', 'transition', 'visibility', 'pointer-events', 'z-index']) {
    wrap.style.removeProperty(prop)
  }
}

/**
 * Remove document main-mirror wrappers that are not the module-owned shell.
 * Mirrors secondary sweepOrphanSecondaryWrappers / tab-position sweepStrayPinHosts.
 */
function sweepOrphanMainMirrorWrappers(): void {
  if (typeof document === 'undefined' || !document.querySelectorAll) return
  const keep = _shell?.wrapper ?? null
  const all = document.querySelectorAll('.sidebar-ux-main-mirror-wrapper')
  for (const el of Array.from(all)) {
    if (el !== keep) {
      try {
        el.remove()
      } catch {
        /* ignore */
      }
    }
  }
}

/** Full teardown of the main mirror shell (content restore, unpin, wrapper
 *  removal, host-hide style + classes, width var). Public so setup.ts can
 *  register it as the unconditional shell teardown ahead of
 *  unsuppressMainDrawer (S1 FIFO fix) and features can full-teardown. */
export function teardownMainMirror(opts?: { keepWidthVar?: boolean }): void {
  restoreHostContent()
  clearHostWrapperInline()
  unpinShellTabList()

  if (_shell) {
    const handles = _shell.drawer.querySelectorAll('.sidebar-ux-resize-handle')
    for (const h of Array.from(handles)) h.remove()
    // S8 reliability: a mid-flight open/close animation must not keep
    // writing transforms to a detached wrapper.
    cancelWrapperAnimation(_shell.wrapper)
    _shell.wrapper.remove()
    _shell = null
  }
  // Also sweep any residual orphans (e.g. body-level duplicates without
  // module ownership after a partial failure).
  sweepOrphanMainMirrorWrappers()

  if (!opts?.keepWidthVar) {
    const w = readWidthCssVar(MAIN_MIRROR_WIDTH_VAR, 0)
    if (w > 0) {
      const wrapper = getMainWrapper()
      // On mobile (≤600px or larger touch) the host CSS or our JS
      // full-bleed force owns the drawer width. Do NOT stamp the
      // desktop mirror width onto the host — it would underfill.
      if (wrapper && !isHostMobileDrawerViewport()) {
        wrapper.style.setProperty(
          '--drawer-panel-w',
          `${Math.ceil(clampSidebarWidth(w))}px`,
          'important',
        )
      }
    }
    document.documentElement.style.removeProperty(MAIN_MIRROR_WIDTH_VAR)
  }

  // Leak fix (2026-08-27): the host-hide <style> element was never removed.
  // The rules are inert without CANVAS_MAIN_ACTIVE_CLASS, but the element
  // lingered in <head> after disable.
  document.getElementById('sidebar-ux-host-main-hide')?.remove()
  // S6: the mobile horizontal-list CSS element too.
  document.getElementById('sidebar-ux-main-mirror-mobile')?.remove()
  document.documentElement.classList.remove(CANVAS_MAIN_ACTIVE_CLASS)
  document.documentElement.classList.remove(CANVAS_MAIN_OPEN_CLASS)
  setDrawerCommandHandler(null)
  _active = false
  _open = false
  // A desktop width captured for a cross-up must not survive teardown: the
  // next desktop resize would restore it over the new shell's width.
  _desktopWidth = null
  _mountedSide = null
  bumpReflow()
}
