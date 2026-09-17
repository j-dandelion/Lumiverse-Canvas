// Tab-list position: moves the column of tab buttons to the screen-edge
// side of both the main and secondary sidebars when enabled.
//
// When the toggle is off (default), the tab list sits on the
// chat-facing edge (the inner side of the drawer). When on, the drawer's
// flex-direction flips so the tab list moves to the screen-edge (outer
// side), and the border on the tab list switches to the
// panel-facing edge.
//
// The resize handle position is screen-side-invariant — it's always on
// the inner edge (the edge facing the content area), regardless of the
// toggle. The handle is position:absolute and outside the flex flow, so
// the flex-direction flip doesn't move it.
//
// No-op on mobile: mobile CSS forces column layout + bottom border via
// !important, so inline-style overrides are invisible there.

import { getMainDrawerSide } from '../store'
import { getMainDrawer, getMainSidebar, getMainPanel } from '../dom/lumiverse'
import {
  getDrawerLocation,
  getSettings,
  getStripEdge,
  isHorizontalStrip,
  isTaskbarModeEnabled,
  setSettings,
} from '../settings/state'
import { hasSecondaryAssignedTabs } from '../tabs/assignment'
import { isMobileViewport } from './mobile-exclusion'
import {
  getSecondaryDrawer,
  getSecondaryTabList,
  getSecondaryPanel,
  isSecondaryShellLive,
} from './secondary'
import { TAB_LIST_WIDTH_PX } from './styles'
import { updateDockOffsets } from './dock-offset'
import { syncSpacerForLocation } from './drawer-shell'

/** Re-export for callers that already import pin helpers from this module. */
export { TAB_LIST_WIDTH_PX }

/** Runtime flag on the tab list while taskbarMode is applied.
 *  Also a CSS hook (see styles under pin host / secondary wrapper). */
export const TAB_LIST_PINNED_CLASS = 'sidebar-ux-tab-list--pinned'

/** Body-level host that holds the tab list while pinned. Must not live
 *  under the secondary wrapper — that wrapper always has a non-none
 *  transform, which would become the containing block for position:fixed
 *  and slide the strip off-screen when the drawer closes. */
export const TAB_LIST_PIN_HOST_CLASS = 'sidebar-ux-tab-list-pin-host'

/** data-pin-owner attribute values for dual pin hosts (main + secondary). */
export const PIN_OWNER_SECONDARY = 'secondary'
export const PIN_OWNER_MAIN = 'main'

/** In-flow placeholder left in the drawer while the tab list is reparented. */
export const TAB_LIST_SPACER_CLASS = 'sidebar-ux-tab-list-spacer'

/** Host state attrs (S8): written in the same className assignment as the
 *  pin-host classes — applyPinHostChrome's assignment is wholesale. */
export const STRIP_AXIS_ATTR = 'data-strip-axis'
export const STRIP_EDGE_ATTR = 'data-strip-edge'
export const STRIP_AXIS_HORIZONTAL = 'horizontal'
export const STRIP_AXIS_VERTICAL = 'vertical'

const PIN_Z_INDEX = '10000'
/** Horizontal dual mode: the secondary host is a transparent overlay that
 *  must paint above the main host's full-width strip surface. */
const PIN_Z_INDEX_SECONDARY = '10001'
const SAFE_TOP = 'env(safe-area-inset-top, 0px)'
const SAFE_BOTTOM = 'env(safe-area-inset-bottom, 0px)'
const SAFE_LEFT = 'env(safe-area-inset-left, 0px)'
const SAFE_RIGHT = 'env(safe-area-inset-right, 0px)'
const INNER_BORDER = '1px solid var(--lumiverse-primary-020)'
/** Panel edge facing the chat column (outer-edge / taskbar mode visible).
 *  Same primary-020 token as INNER_BORDER (tab-list ↔ panel chrome). */
const CHAT_FACING_BORDER = '1px solid var(--lumiverse-primary-020)'

/**
 * CSS custom property carrying the Top/Bottom drawer-split position as a
 * percentage of the strip width, measured from the SECONDARY drawer's
 * screen edge. Sole writer: `syncHorizontalSplit` / `setHorizontalSplitPct`.
 * Consumers: the secondary pin host width (inline, this module) and the
 * main list's lane padding (`HORIZONTAL_STRIP_CSS`). Percentage basis is
 * the same for both (the fixed host's containing block = the viewport), so
 * the two edges land on the same pixel at every split value.
 */
export const SPLIT_VAR = '--sidebar-ux-hsplit'

/** Runtime class for the draggable boundary handle (child of the secondary
 *  pin host, sibling of the tab list). CSS-hides itself outside horizontal. */
export const SPLIT_HANDLE_CLASS = 'sidebar-ux-hsplit-handle'

/** Adjacent class toggled by the proximity tracker: the divider line fades
 *  in only while the pointer is inside the strip and near the boundary. */
export const SPLIT_HANDLE_NEAR_CLASS = 'sidebar-ux-hsplit-handle--near'

/** Reveal radius (CSS px) around the boundary. The line is hidden unless the
 *  pointer is inside the strip band and within this distance of it. */
export const SPLIT_REVEAL_RADIUS_PX = 100

/** Minimum strip width reserved for each drawer's zone (dock + a tab). */
const SPLIT_MIN_SIDE_PX = 64

/** Module state for secondary pin reparent / restore. Cleared on unpin. */
let _pinHost: HTMLElement | null = null
let _pinSpacer: HTMLElement | null = null
let _restoreParent: HTMLElement | null = null
let _restoreNext: ChildNode | null = null

/** Draggable split handle (secondary pin host child), if live. */
let _splitHandle: HTMLElement | null = null
/** True while a split drag owns the var (reconciles must not clobber it). */
let _splitDragging = false
/** Active drag's cancel routine (host teardown mid-drag). */
let _splitDragCancel: (() => void) | null = null
/** Document-level listener teardown for the handle's proximity tracker. */
let _splitProximityCleanup: (() => void) | null = null

/** Body-level host for the main-drawer mirror strip (never reparents host React nodes). */
let _mainPinHost: HTMLElement | null = null

/**
 * Live tab list currently under the module-owned pin host, if any.
 * Prefer this over document.querySelector — dual/orphan lists under a
 * host make document-first-match return the wrong (stale) strip.
 *
 * When multiple tab lists sit under the host (orphan bug), return the
 * **last** one — that is the most recently pinned (live) list; earlier
 * siblings are orphans from incomplete tearDown.
 */
export function getPinnedTabList(): HTMLElement | null {
  if (!_pinHost) return null
  // Walk children — works with partial test stubs and avoids :scope.
  const kids = _pinHost.children
  if (kids && kids.length) {
    let last: HTMLElement | null = null
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i] as HTMLElement
      if (isTabListElement(c)) last = c
    }
    if (last) return last
  }
  return (_pinHost.querySelector?.('.sidebar-ux-tab-list') as HTMLElement | null) ?? null
}

function isTabListElement(el: Element | null | undefined): el is HTMLElement {
  if (!el) return false
  // Prefer className token check — some test stubs only track add()'d tokens
  // in classList.contains, so 'sidebar-ux-tab-list' may be missing from the
  // Set even though it remains in the className string. Also treat the
  // pinned flag alone as a tab list (orphan stubs may only carry that).
  const cn = (el as HTMLElement).className
  if (typeof cn === 'string') {
    const tokens = cn.split(/\s+/).filter(Boolean)
    if (tokens.includes('sidebar-ux-tab-list') || tokens.includes(TAB_LIST_PINNED_CLASS)) {
      return true
    }
  }
  const cls = (el as HTMLElement).classList
  if (typeof cls?.contains === 'function') {
    return cls.contains('sidebar-ux-tab-list') || cls.contains(TAB_LIST_PINNED_CLASS)
  }
  return false
}

/** Test-only: expose module pin host for dual-list / teardown assertions. */
export function __getPinHostForTest(): HTMLElement | null {
  return _pinHost
}

/** Test-only: inject a pin host so getPinnedTabList / getters can resolve. */
export function __setPinHostForTest(host: HTMLElement | null): void {
  _pinHost = host
}

/** Test-only: expose main pin host. */
export function __getMainPinHostForTest(): HTMLElement | null {
  return _mainPinHost
}

/** Test-only: inject main pin host. */
export function __setMainPinHostForTest(host: HTMLElement | null): void {
  _mainPinHost = host
}

/** Test-only: reset module pin state without touching a live document. */
export function __resetPinStateForTest(): void {
  teardownSplitProximityTracker()
  _pinHost = null
  _pinSpacer = null
  _restoreParent = null
  _restoreNext = null
  _mainPinHost = null
  _splitHandle = null
  _splitDragging = false
  _splitDragCancel = null
}

/** Live body-level host for the main-drawer mirror pin, if any. */
export function getMainPinHost(): HTMLElement | null {
  return _mainPinHost
}

/**
 * Ensure a body-level pin host for the main-drawer mirror strip on `side`.
 * Does not reparent host React nodes — callers own the mirror children.
 */
export function ensureMainPinHost(side: 'left' | 'right'): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null
  if (!_mainPinHost) {
    _mainPinHost = document.createElement('div')
    document.body.appendChild(_mainPinHost)
  }
  sweepStrayPinHosts()
  applyPinHostChrome(_mainPinHost, side, PIN_OWNER_MAIN)
  return _mainPinHost
}

/** Remove the main pin host and its children. Safe if already absent. */
export function destroyMainPinHost(): void {
  if (_mainPinHost) {
    while (_mainPinHost.firstChild) {
      _mainPinHost.removeChild(_mainPinHost.firstChild)
    }
    _mainPinHost.remove()
    _mainPinHost = null
  }
  sweepStrayPinHosts()
}

/**
 * S8 zone presence: the secondary zone exists only when the second drawer is
 * enabled, its shell is live AND it has assigned tabs (the list node itself
 * must exist too — during a mode-switch window the model may still report
 * presence while the list is absent; the next presence pass re-adds it).
 *
 * Strict predicate for the split overlay: while false, the split var is
 * removed (main lane back to its default gutter) and no secondary host is
 * pinned.
 */
function secondaryZonePresent(): boolean {
  if (!getSettings().secondSidebarEnabled) return false
  if (!isSecondaryShellLive()) return false
  if (!hasSecondaryAssignedTabs()) return false
  return !!getSecondaryTabList()
}

// ── Horizontal split (Top/Bottom dual drawers) ──
//
// One full-width painted surface (the main host) with a transparent
// secondary overlay anchored to its screen edge. The split var positions the
// overlay's inner edge; HORIZONTAL_STRIP_CSS pads the main list's
// leading/trailing inline side by the same value, so the main lane begins
// exactly at the boundary. Percentage basis is identical for both consumers
// (a fixed host's containing block is the viewport) — a margin on the inner
// section would resolve against the list's padded content box and drift by
// up to 8px at non-50% splits.

/** Viewport-width basis for the split math (the main host is 100% wide). */
function currentStripWidthPx(): number {
  const rect = _mainPinHost?.getBoundingClientRect?.()
  if (rect && Number.isFinite(rect.width) && rect.width > 0) return rect.width
  if (typeof document !== 'undefined' && document.documentElement) {
    return document.documentElement.clientWidth || 0
  }
  return 0
}

/**
 * Fraction (0..1) → clamped split percentage. The live drag domain is a
 * subset of the persisted [10, 90] domain: SPLIT_MIN_SIDE_PX per side is
 * enforced as a 10% floor, raised further when 64px exceeds 10% of the strip
 * (narrow viewports) so both docks stay reachable and a release never snaps.
 */
export function computeSplitPct(
  fraction: number,
  stripWidthPx: number = currentStripWidthPx(),
): number {
  const f = Number.isFinite(fraction) ? fraction : 0.5
  const px = Number.isFinite(stripWidthPx) && stripWidthPx > 0 ? stripWidthPx : 0
  const minPct = px > 0 ? Math.max(10, (SPLIT_MIN_SIDE_PX / px) * 100) : 10
  const maxPct = 100 - minPct
  const pct = Math.min(maxPct, Math.max(minPct, f * 100))
  return Math.round(pct * 100) / 100
}

/**
 * Sole writer of SPLIT_VAR. Recomputes from settings unless a drag owns the
 * value; removes the var whenever the strip is not horizontal or the
 * secondary zone is absent (main lane back to its default gutter).
 *
 * Call sites: `runReconcile` (before its skip-cache), boot init, the
 * `drawerLocationFeature.apply` split branch, and the drag's pointerup.
 */
export function syncHorizontalSplit(): void {
  if (_splitDragging) return
  if (typeof document === 'undefined' || !document.documentElement?.style) return
  if (!isHorizontalStrip() || !secondaryZonePresent()) {
    clearSplitVar()
    return
  }
  writeSplitVar(`${computeSplitPct(getSettings().horizontalSplit)}%`)
}

/** Live write for the drag (no settings mutation; the drag persists on release). */
export function setHorizontalSplitPct(pct: number): void {
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) return
  writeSplitVar(`${Math.round(pct * 100) / 100}%`)
}

/** Drag ownership flag: reconciles must not overwrite the live value. */
export function setHorizontalSplitDragging(dragging: boolean): void {
  _splitDragging = dragging
}

/** Test helper: current live value of the split var ('' when unset). */
export function getHorizontalSplitVar(): string {
  if (typeof document === 'undefined' || !document.documentElement?.style) return ''
  return document.documentElement.style.getPropertyValue(SPLIT_VAR)
}

/** Teardown: drop the split var and any drag ownership (idempotent). The
 *  boundary handle is owned by the pin path (`destroyPinChrome`). */
export function clearHorizontalSplit(): void {
  const cancel = _splitDragCancel
  _splitDragCancel = null
  _splitDragging = false
  cancel?.()
  clearSplitVar()
}

function writeSplitVar(value: string): void {
  if (typeof document === 'undefined' || !document.documentElement?.style) return
  const root = document.documentElement
  if (root.style.getPropertyValue(SPLIT_VAR) !== value) {
    root.style.setProperty(SPLIT_VAR, value)
  }
}

function clearSplitVar(): void {
  if (typeof document === 'undefined' || !document.documentElement?.style) return
  document.documentElement.style.removeProperty?.(SPLIT_VAR)
}

/**
 * Sole authority for pin-host geometry (S8 single-writer rule). Complete and
 * idempotent per call: every property this function owns is written or
 * cleared on every pass (the className assignment is wholesale — any token
 * not included is wiped).
 *
 * Vertical (Sides): fixed 56px edge column at the drawer's side.
 *
 * Horizontal (Top/Bottom): the strip is ONE full-width painted surface. The
 * main host always spans 100% (its list paints TAB_STRIP_BACKGROUND across
 * the whole strip) and the secondary host is a transparent overlay anchored
 * to its own screen edge, width = the split var, z-above-main so its
 * floating buttons paint over the shared surface. No seam overlap is needed
 * because there is only one painted layer. The list inside is absolutely
 * positioned by the list writer; HORIZONTAL_STRIP_CSS owns orientation, the
 * lane padding and the overlay's transparency.
 */
function applyPinHostChrome(
  host: HTMLElement,
  side: 'left' | 'right',
  owner: typeof PIN_OWNER_SECONDARY | typeof PIN_OWNER_MAIN,
): void {
  const loc = getDrawerLocation()
  const horizontal = loc !== 'sides'
  const edge = horizontal ? getStripEdge() : side

  host.className = `${TAB_LIST_PIN_HOST_CLASS} sidebar-ux-side-${side}`
  host.setAttribute('data-pin-owner', owner)
  host.setAttribute(STRIP_AXIS_ATTR, horizontal ? STRIP_AXIS_HORIZONTAL : STRIP_AXIS_VERTICAL)
  if (edge) host.setAttribute(STRIP_EDGE_ATTR, edge)

  const s = host.style
  setIfDifferent(s, 'position', 'fixed')
  setIfDifferent(
    s,
    'zIndex',
    owner === PIN_OWNER_SECONDARY && horizontal ? PIN_Z_INDEX_SECONDARY : PIN_Z_INDEX,
  )
  setIfDifferent(s, 'pointerEvents', 'none')

  if (horizontal) {
    setIfDifferent(s, 'height', 'var(--sidebar-ux-strip-h, 56px)')
    if (edge === 'top') {
      setIfDifferent(s, 'top', SAFE_TOP)
      setIfDifferent(s, 'bottom', '')
    } else {
      setIfDifferent(s, 'bottom', SAFE_BOTTOM)
      setIfDifferent(s, 'top', '')
    }
    // Main: the full-width base surface, always (presence must never
    // re-chrome it — the overlay just appears on top). Secondary: the
    // transparent overlay zone ending at the split boundary. The var
    // fallback only applies if the host is chromed before the first sync.
    // `!important` inline: functional split geometry must outrank stale
    // theme CSS (live bug 2026-09-16 — see setImportant).
    if (owner === PIN_OWNER_MAIN) {
      setImportant(s, 'width', '100%')
    } else {
      setImportant(s, 'width', `var(${SPLIT_VAR}, 50%)`)
    }
    if (side === 'right') {
      setIfDifferent(s, 'right', SAFE_RIGHT)
      setIfDifferent(s, 'left', '')
    } else {
      setIfDifferent(s, 'left', SAFE_LEFT)
      setIfDifferent(s, 'right', '')
    }
  } else {
    setIfDifferent(s, 'top', SAFE_TOP)
    setIfDifferent(s, 'bottom', SAFE_BOTTOM)
    setIfDifferent(s, 'height', '')
    setImportant(s, 'width', `${TAB_LIST_WIDTH_PX}px`)
    if (side === 'right') {
      setIfDifferent(s, 'right', '0')
      setIfDifferent(s, 'left', '')
    } else {
      setIfDifferent(s, 'left', '0')
      setIfDifferent(s, 'right', '')
    }
  }
}

// Structural element type — only the inline `style` is touched, so any
// object exposing a `CSSStyleDeclaration` works. Real HTMLElements in
// production; test stubs in unit tests.
type StyledElement = { style: CSSStyleDeclaration }

type ElementOpts = {
  drawer?: StyledElement | null
  tabList?: StyledElement | null
  handle?: StyledElement | null
  mainDrawer?: StyledElement | null
  mainTabList?: StyledElement | null
  mainPanel?: StyledElement | null
  panel?: StyledElement | null
}

/** Write `val` to `el[prop]` only if it differs (avoids layout thrash). */
function setIfDifferent(
  el: CSSStyleDeclaration,
  prop: keyof CSSStyleDeclaration,
  val: string,
): void {
  if ((el as any)[prop] !== val) {
    (el as any)[prop] = val
  }
}

/**
 * Write a functional-geometry property with `!important` priority. An inline
 * `!important` sits at the top of the author cascade (it beats even another
 * sheet `!important`), so stale theme CSS cannot freeze Canvas geometry.
 * Live bug 2026-09-16: a Theme Studio custom rule
 * `[class="sidebar-ux-tab-list-pin-host sidebar-ux-side-right"] { width: 50% !important }`
 * (written for the old 50/50 zone model) overrode the plain inline
 * `width: var(--sidebar-ux-hsplit, 50%)`, pinning the secondary host at the
 * fallback while the main lane tracked the var — the functional split moved
 * but the divider/handle (host's inner edge) stood still.
 */
function setImportant(
  el: CSSStyleDeclaration,
  prop: string,
  val: string,
): void {
  // Partial test stubs may lack setProperty — fall back to plain assignment.
  if (typeof el.setProperty !== 'function') {
    if ((el as any)[prop] !== val) (el as any)[prop] = val
    return
  }
  if ((el as any)[prop] !== val || el.getPropertyPriority?.(prop) !== 'important') {
    el.setProperty(prop, val, 'important')
  }
}

/** Apply flex-direction and border to a drawer/tab-list pair. */
function applyFlexAndBorder(
  drawer: StyledElement,
  tabList: StyledElement,
  wantFlex: 'row' | 'row-reverse',
): void {
  setIfDifferent(drawer.style, 'flexDirection', wantFlex)

  // Border goes on the panel-facing side of the tab list.
  // row → tab list on left, panel on right → border on right
  // row-reverse → tab list on right, panel on left → border on left
  const wantBorder: 'left' | 'right' = wantFlex === 'row' ? 'right' : 'left'
  setIfDifferent(tabList.style, 'borderTop', 'none')
  setIfDifferent(tabList.style, 'borderBottom', 'none')
  if (wantBorder === 'right') {
    setIfDifferent(tabList.style, 'borderRight', '1px solid var(--lumiverse-primary-020)')
    setIfDifferent(tabList.style, 'borderLeft', 'none')
  } else {
    setIfDifferent(tabList.style, 'borderLeft', '1px solid var(--lumiverse-primary-020)')
    setIfDifferent(tabList.style, 'borderRight', 'none')
  }
}

/** Write a one-sided border on the panel's chat-facing edge.
 *  The chat-facing side depends only on which side of the screen the
 *  drawer is on, NOT on the toggle: a drawer on the left of the screen
 *  has chat to its right, so the panel's chat-facing edge is always its
 *  right side (and vice versa).
 *  - Enabled (moveControlsToOuterEdge and/or taskbarMode): write
 *    CHAT_FACING_BORDER on the chat-facing side.
 *  - Disabled: clear the border (the primary-020 border between tab list
 *    and panel is the only divider needed when controls are on the inner edge). */
function applyPanelChatBorder(
  panel: StyledElement,
  drawerSide: 'left' | 'right',
  enabled: boolean,
): void {
  const chatSide: 'left' | 'right' = drawerSide === 'left' ? 'right' : 'left'
  if (enabled) {
    if (chatSide === 'right') {
      setIfDifferent(panel.style, 'borderRight', CHAT_FACING_BORDER)
      setIfDifferent(panel.style, 'borderLeft', 'none')
    } else {
      setIfDifferent(panel.style, 'borderLeft', CHAT_FACING_BORDER)
      setIfDifferent(panel.style, 'borderRight', 'none')
    }
  } else {
    setIfDifferent(panel.style, 'borderRight', 'none')
    setIfDifferent(panel.style, 'borderLeft', 'none')
  }
  setIfDifferent(panel.style, 'borderTop', 'none')
  setIfDifferent(panel.style, 'borderBottom', 'none')
}

/** Chat-facing panel border when tabs sit on the outer edge (explicit toggle
 *  or taskbar mode pin, which always parks the strip at the screen edge). */
function wantsChatFacingPanelBorder(outerEdgeEnabled: boolean): boolean {
  return outerEdgeEnabled || !!getSettings().taskbarMode
}

export function applyTabListPosition(
  enabled: boolean,
  opts?: ElementOpts,
): void {
  if (isMobileViewport()) return

  const side = getMainDrawerSide()
  const chatBorder = wantsChatFacingPanelBorder(enabled)

  // --- Secondary drawer ---
  // Secondary is on the opposite side of the main.
  const drawer = opts?.drawer ?? getSecondaryDrawer()
  const tabList = opts?.tabList ?? getSecondaryTabList()
  const panel = opts?.panel ?? getSecondaryPanel()

  if (drawer && tabList) {
    // Pin owns secondary tab-list flex/chrome while active — skip those
    // writes (would fight the pinned strip). Panel chat-facing border is
    // still applied: pin used to clear it and left secondary without an
    // edge against the chat column.
    // StyledElement test stubs may omit classList; treat that as unpinned.
    const pinned =
      typeof (tabList as HTMLElement).classList?.contains === 'function' &&
      (tabList as HTMLElement).classList.contains(TAB_LIST_PINNED_CLASS)
    // drawerSide for secondary is opposite of main.
    const secondaryDrawerSide = side === 'left' ? 'right' : 'left'
    if (!pinned) {
      const defaultFlex = secondaryDrawerSide === 'left' ? 'row-reverse' : 'row'
      const toggledFlex = secondaryDrawerSide === 'left' ? 'row' : 'row-reverse'
      const wantFlex = enabled ? toggledFlex : defaultFlex
      applyFlexAndBorder(drawer, tabList, wantFlex)
    }
    if (panel) applyPanelChatBorder(panel, secondaryDrawerSide, chatBorder)
  }

  // --- Main drawer ---
  // Main drawer is always on the `side` parameter side.
  const mainDrawer = opts?.mainDrawer ?? getMainDrawer()
  const mainTabList = opts?.mainTabList ?? getMainSidebar()
  const mainPanel = opts?.mainPanel ?? getMainPanel()

  if (mainDrawer && mainTabList) {
    // Pin owns main tab-list flex/chrome while active — skip those writes
    // (the old main branch was unguarded; S8 horizontal + vertical pin both
    // need the same guard as the secondary branch).
    const mainPinned =
      typeof (mainTabList as HTMLElement).classList?.contains === 'function' &&
      (mainTabList as HTMLElement).classList.contains(TAB_LIST_PINNED_CLASS)
    if (!mainPinned) {
      const mainDefaultFlex = side === 'left' ? 'row-reverse' : 'row'
      const mainToggledFlex = side === 'left' ? 'row' : 'row-reverse'
      const mainWantFlex = enabled ? mainToggledFlex : mainDefaultFlex
      applyFlexAndBorder(mainDrawer, mainTabList, mainWantFlex)
    }
    if (mainPanel) applyPanelChatBorder(mainPanel, side, chatBorder)
  }
}

/**
 * Remove Canvas's inline position/chrome writes from the drawer elements,
 * restoring the vanilla host layout. Called from the always-cleanups chain on
 * extension disable: the outer-edge toggle writes inline flex-direction /
 * borders on the HOST main drawer + sidebar (+ panel), and nothing else
 * reverses them — the disabled Vanilla drawer came back with its tab strip
 * flipped to the outer edge (2026-09-12 teardown report). The Canvas shells
 * are removed by their own teardowns, so this only needs the host elements
 * (secondary entries are belt & suspenders while the wrapper is still up).
 */
export function clearTabListPosition(): void {
  const clearProps = (
    el: StyledElement | null | undefined,
    props: readonly string[],
  ): void => {
    if (!el?.style) return
    for (const p of props) (el.style as any)[p] = ''
  }
  clearProps(getSecondaryDrawer(), ['flexDirection'])
  clearProps(getSecondaryTabList(), ['borderTop', 'borderBottom', 'borderLeft', 'borderRight'])
  clearProps(getSecondaryPanel(), ['borderLeft', 'borderRight'])
  clearProps(getMainDrawer(), ['flexDirection'])
  clearProps(getMainSidebar(), ['borderTop', 'borderBottom', 'borderLeft', 'borderRight'])
  clearProps(getMainPanel(), ['borderLeft', 'borderRight'])
}

/** Read the current inline style state of the elements. Returns
 *  empty strings for any element that is null. */
export function getTabListPosition(opts?: ElementOpts): {
  drawerDir: string
  tabListBorderLeft: string
  tabListBorderRight: string
  handleLeft: string
  handleRight: string
  mainDrawerDir: string
  mainTabListBorderLeft: string
  mainTabListBorderRight: string
} {
  const empty = {
    drawerDir: '', tabListBorderLeft: '', tabListBorderRight: '',
    handleLeft: '', handleRight: '',
    mainDrawerDir: '', mainTabListBorderLeft: '', mainTabListBorderRight: '',
  }
  const drawer = opts?.drawer ?? null
  const tabList = opts?.tabList ?? null
  const handle = opts?.handle ?? null
  const mainDrawer = opts?.mainDrawer ?? getMainDrawer()
  const mainTabList = opts?.mainTabList ?? getMainSidebar()
  return {
    drawerDir: drawer?.style.flexDirection || '',
    tabListBorderLeft: tabList?.style.borderLeft || '',
    tabListBorderRight: tabList?.style.borderRight || '',
    handleLeft: handle?.style.left || '',
    handleRight: handle?.style.right || '',
    mainDrawerDir: mainDrawer?.style.flexDirection || '',
    mainTabListBorderLeft: mainTabList?.style.borderLeft || '',
    mainTabListBorderRight: mainTabList?.style.borderRight || '',
  }
}

/** True when the secondary tab list is currently in the pinned state. */
export function isTabListPinned(tabList?: Element | null): boolean {
  const el = tabList ?? getSecondaryTabList() ?? getPinnedTabList()
  return !!el?.classList.contains(TAB_LIST_PINNED_CLASS)
}

/**
 * Re-apply pin from current settings + live DOM. Safe anytime (mount,
 * side-change remount, viewport cross-up, settings apply).
 *
 * On mobile, always force-unpins (clears styles + restores parent).
 */
export function reconcileTabListPin(): void {
  // S8: mobile keeps the Sides force-unpin (byte-for-byte S6 behavior); a
  // horizontal strip PINS on mobile too (the strip is the tab surface).
  if (isMobileViewport() && !isHorizontalStrip()) {
    applyTabListPin(false, { force: true })
    void import('./strip-gutter').then((m) => m.updateStripGutters())
    return
  }
  // Taskbar mode only pins secondary when it has tabs — empty strip must not
  // show. Effective gate (taskbarMode && moveControlsToOuterEdge) — matches
  // every other pin/effective site; an outer-edge OFF toggle must unpin even
  // though the raw taskbarMode setting survives (S1 dropped the cascade).
  const want =
    isTaskbarModeEnabled() && hasSecondaryAssignedTabs()
  applyTabListPin(want, { force: true })
  // Side-change / remount: remap strip gutters to the current main side.
  void import('./strip-gutter').then((m) => m.updateStripGutters())
}

/**
 * Pin the secondary drawer's tab-button-list to the viewport edge so it
 * remains visible even when the drawer is closed.
 *
 * Implementation note: `position: fixed` alone is not enough. The secondary
 * wrapper always has `transform: translateX(...)`, which becomes the
 * containing block for fixed descendants. While pinned we therefore
 * **reparent** the tab list onto a body-level pin host (no transform) and
 * leave a 56px spacer in the drawer so the panel does not draw under the
 * strip when open.
 *
 * `force: true` re-applies even when the class already matches (remount /
 * side flip). On mobile, enable is a no-op and disable still clears any
 * leftover pin state.
 */
export function applyTabListPin(
  enabled: boolean,
  opts?: { force?: boolean },
): void {
  // S8: on mobile, Sides never pins (still clears pin state on cross-down);
  // horizontal mobile pins like desktop.
  if (isMobileViewport() && !isHorizontalStrip()) {
    if (enabled && !opts?.force) return
    const el = getSecondaryTabList() ?? getPinnedTabList()
    if (el?.classList?.contains(TAB_LIST_PINNED_CLASS) || _pinHost || _pinSpacer) {
      unpinTabList(el)
    }
    return
  }

  // Empty secondary: never pin (would show a blank 56px edge strip).
  const wantPin = enabled && hasSecondaryAssignedTabs()

  if (!wantPin) {
    const el = getSecondaryTabList() ?? getPinnedTabList()
    const hasPinState =
      !!el?.classList?.contains(TAB_LIST_PINNED_CLASS) || !!_pinHost || !!_pinSpacer
    if (!hasPinState) {
      if (opts?.force) destroyPinChrome()
      return
    }
    unpinTabList(el)
    return
  }

  const tabList = getSecondaryTabList()
  if (!tabList) return

  const isPinned = tabList.classList.contains(TAB_LIST_PINNED_CLASS)
  if (isPinned && !opts?.force) return

  pinTabList(tabList)
}

function secondarySide(): 'left' | 'right' {
  return getMainDrawerSide() === 'left' ? 'right' : 'left'
}

function ensurePinHost(side: 'left' | 'right'): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null
  if (!_pinHost) {
    _pinHost = document.createElement('div')
    document.body.appendChild(_pinHost)
  }
  // Drop any stray pin hosts left by lost module state / incomplete teardown.
  sweepStrayPinHosts()
  applyPinHostChrome(_pinHost, side, PIN_OWNER_SECONDARY)
  // A direct pin call (assignment change without a location reconcile) must
  // not leave the host at the var fallback while the main lane is unpadded.
  syncHorizontalSplit()
  return _pinHost
}

/** Remove document pin hosts that are not the module-owned secondary or main hosts. */
function sweepStrayPinHosts(): void {
  if (typeof document === 'undefined' || !document.querySelectorAll) return
  const hosts = document.querySelectorAll(`.${TAB_LIST_PIN_HOST_CLASS}`)
  for (const host of Array.from(hosts)) {
    if (host !== _pinHost && host !== _mainPinHost) {
      host.remove()
    }
  }
}

/**
 * Ensure the pin host holds only `keep` as its tab list. Orphan lists from
 * incomplete tearDown + remount would otherwise sit first in DOM order and
 * poison document.querySelector / highlight writes.
 */
function removeOrphanTabListsFromHost(keep: HTMLElement): void {
  if (!_pinHost) return
  // Prefer children (Element list) — childNodes may include text nodes and
  // test stubs often omit nodeType.
  const kids = _pinHost.children
    ? Array.from(_pinHost.children)
    : Array.from(_pinHost.childNodes).filter(
        (c) => (c as Node).nodeType === 1 || isTabListElement(c as Element),
      )
  for (const child of kids) {
    if (child === keep) continue
    if (isTabListElement(child as Element)) {
      _pinHost.removeChild(child)
    }
  }
}

/**
 * Shared chrome for a pinned tab list (secondary reparent + main mirror),
 * axis-aware (S8).
 *
 * Horizontal: JS writes ONLY `position: absolute` and clears the vertical
 * set (top/bottom/left/right/width/height/flex/overflow/borders). The list is
 * never `fixed` here — a fixed element's containing block is the viewport,
 * which would span a half-zone list across the whole screen.
 * HORIZONTAL_STRIP_CSS owns orientation/size/overflow with !important.
 *
 * Vertical (Sides): the classic 56px edge column; re-asserts the construction
 * values (column/56/overflow/borders) so a horizontal → Sides flip is fully
 * reversible.
 *
 * Does NOT touch background/padding/gap — those stay at construction values
 * from createDrawerShell so main and secondary look identical.
 */
export function applyPinnedTabListChrome(
  tabList: HTMLElement,
  side: 'left' | 'right',
): void {
  const loc = getDrawerLocation()
  const horizontal = loc !== 'sides'
  const innerBorderSide: 'left' | 'right' = side === 'right' ? 'left' : 'right'

  tabList.classList.add(TAB_LIST_PINNED_CLASS)
  setIfDifferent(tabList.style, 'pointerEvents', 'auto')

  if (horizontal) {
    setIfDifferent(tabList.style, 'position', 'absolute')
    // Closed set: clear the vertical chrome (CSS re-asserts inset/orientation).
    setIfDifferent(tabList.style, 'top', '')
    setIfDifferent(tabList.style, 'bottom', '')
    setIfDifferent(tabList.style, 'left', '')
    setIfDifferent(tabList.style, 'right', '')
    setIfDifferent(tabList.style, 'width', '')
    setIfDifferent(tabList.style, 'height', '')
    setIfDifferent(tabList.style, 'zIndex', '')
    setIfDifferent(tabList.style, 'flexDirection', '')
    setIfDifferent(tabList.style, 'overflow', '')
    setIfDifferent(tabList.style, 'overflowX', '')
    setIfDifferent(tabList.style, 'overflowY', '')
    setIfDifferent(tabList.style, 'borderTop', '')
    setIfDifferent(tabList.style, 'borderRight', '')
    setIfDifferent(tabList.style, 'borderBottom', '')
    setIfDifferent(tabList.style, 'borderLeft', '')
    // Dock offsets are a vertical-edge concept; the horizontal host is
    // full-width and must not shift docks.
    return
  }

  // Fill the pin host (or viewport edge if no reparent in stub tests).
  setIfDifferent(tabList.style, 'position', 'fixed')
  setIfDifferent(tabList.style, 'top', SAFE_TOP)
  setIfDifferent(tabList.style, 'bottom', SAFE_BOTTOM)
  setIfDifferent(tabList.style, 'height', '')
  setIfDifferent(tabList.style, 'zIndex', PIN_Z_INDEX)
  setIfDifferent(tabList.style, 'width', `${TAB_LIST_WIDTH_PX}px`)
  if (side === 'right') {
    setIfDifferent(tabList.style, 'right', '0')
    setIfDifferent(tabList.style, 'left', '')
  } else {
    setIfDifferent(tabList.style, 'left', '0')
    setIfDifferent(tabList.style, 'right', '')
  }
  // Construction values (needed after a horizontal phase cleared them).
  setIfDifferent(tabList.style, 'flexDirection', 'column')
  setIfDifferent(tabList.style, 'overflowY', 'auto')
  setIfDifferent(tabList.style, 'overflowX', 'hidden')

  if (innerBorderSide === 'right') {
    setIfDifferent(tabList.style, 'borderRight', INNER_BORDER)
    setIfDifferent(tabList.style, 'borderLeft', 'none')
  } else {
    setIfDifferent(tabList.style, 'borderLeft', INNER_BORDER)
    setIfDifferent(tabList.style, 'borderRight', 'none')
  }

  // Re-apply the dock-aware layout: a Spindle dock panel on the same edge as
  // this strip is shifted to sit just inside it (see dock-offset.ts) so the
  // strip stays topmost on the screen edge without covering the dock.
  updateDockOffsets()
}

/**
 * Clear pinned edge chrome (position/edges/z-index/pointer-events).
 * Restores construction width; borders are reapplied by applyTabListPosition.
 */
export function clearPinnedTabListChrome(tabList: HTMLElement): void {
  tabList.classList.remove(TAB_LIST_PINNED_CLASS)
  setIfDifferent(tabList.style, 'position', '')
  setIfDifferent(tabList.style, 'top', '')
  setIfDifferent(tabList.style, 'bottom', '')
  setIfDifferent(tabList.style, 'left', '')
  setIfDifferent(tabList.style, 'right', '')
  setIfDifferent(tabList.style, 'height', '')
  setIfDifferent(tabList.style, 'zIndex', '')
  setIfDifferent(tabList.style, 'pointerEvents', '')
  // Restore construction width/orientation — do not blank them (a horizontal
  // phase cleared the vertical set; the in-drawer list must come back as a
  // 56px column).
  setIfDifferent(tabList.style, 'width', `${TAB_LIST_WIDTH_PX}px`)
  setIfDifferent(tabList.style, 'flexDirection', 'column')
  setIfDifferent(tabList.style, 'overflowY', 'auto')
  setIfDifferent(tabList.style, 'overflowX', 'hidden')
  setIfDifferent(tabList.style, 'borderTop', '')
  setIfDifferent(tabList.style, 'borderBottom', '')
  setIfDifferent(tabList.style, 'borderLeft', '')
  setIfDifferent(tabList.style, 'borderRight', '')
}

// ── Split handle (Top/Bottom dual drawers) ──

/** Coarse-pointer gate (same policy as DnD and the resize handles). */
function isCoarsePointer(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)')?.matches
  } catch {
    return false
  }
}

/**
 * Pure proximity predicate for the divider reveal (unit-tested). True when
 * the pointer is inside the strip band [top, bottom] and within
 * `SPLIT_REVEAL_RADIUS_PX` of the boundary line. Unknown geometry (NaN
 * rect, no divider) is "not near" — the line stays hidden.
 */
export function shouldRevealSplitHandle(opts: {
  x: number
  y: number
  stripTop: number
  stripBottom: number
  dividerX: number | null
}): boolean {
  const { x, y, stripTop, stripBottom, dividerX } = opts
  if (!Number.isFinite(stripTop) || !Number.isFinite(stripBottom)) return false
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false
  if (y < stripTop || y > stripBottom) return false
  if (dividerX === null || !Number.isFinite(dividerX)) return false
  return Math.abs(x - dividerX) <= SPLIT_REVEAL_RADIUS_PX
}

/**
 * Document-level pointer tracker for the divider reveal. Proximity is
 * measured in JS: a CSS :hover zone wide enough for the 100px radius would
 * swallow tab clicks. rAF-coalesced so `getBoundingClientRect` runs at most
 * once per frame; bound to the handle and torn down with it.
 *
 * Exit is handled in two places because drawer panels are iframes: a
 * pointermove from the strip into a panel never reaches the parent document,
 * so the capture-phase pointerout (which does fire on the way out) hides the
 * line when the leaving coordinates are outside the strip band; window
 * leave/blur covers the remaining edges.
 */
function installSplitProximityTracker(handle: HTMLElement): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  if (typeof document.addEventListener !== 'function') return
  if (typeof window.addEventListener !== 'function') return
  if (typeof handle.addEventListener !== 'function') return
  if (typeof handle.getBoundingClientRect !== 'function') return
  teardownSplitProximityTracker()

  let near = false
  let frame = 0
  let lastX = 0
  let lastY = 0
  const schedule: (cb: () => void) => number =
    typeof requestAnimationFrame === 'function'
      ? (cb) => requestAnimationFrame(cb)
      : (cb) => {
          cb()
          return 0
        }

  const setNear = (on: boolean): void => {
    if (near === on) return
    near = on
    if (on) handle.classList?.add?.(SPLIT_HANDLE_NEAR_CLASS)
    else handle.classList?.remove?.(SPLIT_HANDLE_NEAR_CLASS)
  }

  const stripBand = (): { top: number; bottom: number } | null => {
    const rect = handle.parentElement?.getBoundingClientRect?.()
    if (!rect) return null
    return { top: rect.top, bottom: rect.bottom }
  }

  const apply = (): void => {
    frame = 0
    if (!handle.isConnected) {
      teardownSplitProximityTracker()
      return
    }
    // A live drag owns the boundary; keep the line revealed.
    if (_splitDragging) {
      setNear(true)
      return
    }
    if (!isHorizontalStrip() || isMobileViewport() || isCoarsePointer()) {
      setNear(false)
      return
    }
    const band = stripBand()
    const rect = handle.getBoundingClientRect()
    setNear(
      shouldRevealSplitHandle({
        x: lastX,
        y: lastY,
        stripTop: band ? band.top : NaN,
        stripBottom: band ? band.bottom : NaN,
        dividerX: rect ? rect.left + rect.width / 2 : null,
      }),
    )
  }

  const onMove = (e: PointerEvent): void => {
    lastX = e.clientX
    lastY = e.clientY
    if (!frame) frame = schedule(apply)
  }

  const onOut = (e: PointerEvent): void => {
    if (!near || _splitDragging) return
    const band = stripBand()
    if (band && e.clientY >= band.top && e.clientY <= band.bottom) return
    setNear(false)
  }

  const hide = (): void => {
    setNear(false)
  }

  document.addEventListener('pointermove', onMove, { passive: true })
  document.addEventListener('pointerout', onOut, true)
  document.addEventListener('pointerleave', hide, true)
  document.addEventListener('mouseleave', hide, true)
  window.addEventListener('blur', hide)

  _splitProximityCleanup = () => {
    if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
    frame = 0
    document.removeEventListener('pointermove', onMove)
    document.removeEventListener('pointerout', onOut, true)
    document.removeEventListener('pointerleave', hide, true)
    document.removeEventListener('mouseleave', hide, true)
    window.removeEventListener('blur', hide)
  }
}

function teardownSplitProximityTracker(): void {
  const cleanup = _splitProximityCleanup
  _splitProximityCleanup = null
  cleanup?.()
}

/**
 * Create (idempotently) the draggable boundary handle on the secondary pin
 * host. The handle is a HOST child (sibling of the tab list), never a list
 * child: the dock must stay the tab list's LAST child for
 * `appendSecondaryTabNode`. CSS hides it outside horizontal; `destroyPinChrome`
 * must remove it BEFORE its child-reparent loop or it would land inside the
 * drawer as an invisible 12px click-eater.
 */
function ensureSplitHandle(host: HTMLElement): HTMLElement | null {
  if (typeof document === 'undefined') return null
  if (_splitHandle?.isConnected && _splitHandle.parentElement === host) {
    return _splitHandle
  }
  _splitHandle?.remove()
  const handle = document.createElement('div')
  handle.className = SPLIT_HANDLE_CLASS
  handle.setAttribute('data-canvas-hsplit', '')
  handle.setAttribute('role', 'separator')
  handle.setAttribute('aria-orientation', 'vertical')
  handle.setAttribute('aria-label', 'Resize drawer split')
  if ('tabIndex' in handle) handle.tabIndex = 0
  installSplitHandleInteraction(handle)
  host.appendChild(handle)
  _splitHandle = handle
  return handle
}

/** Remove the split handle and cancel any live drag on it. */
function removeSplitHandle(): void {
  teardownSplitProximityTracker()
  _splitDragCancel?.()
  _splitHandle?.remove()
  _splitHandle = null
}

function installSplitHandleInteraction(handle: HTMLElement): void {
  // Unit tests use partial element stubs — no listeners to install there.
  if (typeof handle.addEventListener !== 'function') return
  handle.addEventListener('pointerdown', (e: PointerEvent) => {
    if (!isHorizontalStrip()) return
    if (isMobileViewport() || isCoarsePointer()) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    startSplitDrag(handle)
  })
  handle.addEventListener('dblclick', (e: MouseEvent) => {
    if (!isHorizontalStrip()) return
    if (isMobileViewport() || isCoarsePointer()) return
    e.preventDefault()
    e.stopPropagation()
    setHorizontalSplitPct(computeSplitPct(0.5))
    setSettings({ horizontalSplit: 0.5 })
  })
  // Divider reveal: hidden until the pointer is in the strip and near the
  // boundary (the 12px handle itself cannot express a 100px proximity).
  installSplitProximityTracker(handle)
}

/**
 * Pointer drag for the split boundary. The live value goes through
 * `setHorizontalSplitPct` (var only); the setting persists on a clean
 * release. Cancel paths (`pointercancel`, window blur, host teardown,
 * release outside the window) restore the pre-drag value. A full-viewport
 * overlay keeps iframes in the drawers from swallowing pointermove — the
 * resize-handle overlay pattern cannot be reused because a pin-host child
 * has no `.sidebar-ux-drawer` ancestor.
 */
function startSplitDrag(handle: HTMLElement): void {
  if (typeof document === 'undefined' || _splitDragging) return
  const root = document.documentElement
  if (!root?.style) return
  const side = secondarySide()
  const vw = currentStripWidthPx()
  if (!(vw > 0)) return
  const preDrag = root.style.getPropertyValue(SPLIT_VAR)

  _splitDragging = true
  handle.classList?.add('sidebar-ux-hsplit-handle--active')
  if (document.body?.style) {
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  let overlay: HTMLElement | null = null
  if (document.body) {
    overlay = document.createElement('div')
    overlay.setAttribute('data-canvas-hsplit-overlay', '')
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:13000;cursor:col-resize;background:transparent;pointer-events:auto;touch-action:none;'
    document.body.appendChild(overlay)
  }

  const finish = (persist: boolean): void => {
    document.removeEventListener('pointermove', onMove)
    document.removeEventListener('pointerup', onUp)
    document.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('blur', onCancel)
    overlay?.remove()
    handle.classList?.remove('sidebar-ux-hsplit-handle--active')
    if (document.body?.style) {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    _splitDragging = false
    _splitDragCancel = null
    if (persist && handle.isConnected) {
      const pct = parseFloat(root.style.getPropertyValue(SPLIT_VAR))
      if (Number.isFinite(pct)) {
        setSettings({ horizontalSplit: pct / 100 })
        syncHorizontalSplit()
        return
      }
    }
    // Cancelled (or host gone): restore the pre-drag value. A zone that
    // disappeared is cleared by the next sync/reconcile.
    if (preDrag) root.style.setProperty(SPLIT_VAR, preDrag)
    else root.style.removeProperty(SPLIT_VAR)
  }

  const onMove = (e: PointerEvent): void => {
    if (!handle.isConnected) {
      finish(false)
      return
    }
    const rect = _mainPinHost?.getBoundingClientRect?.()
    const left = rect && Number.isFinite(rect.left) ? rect.left : 0
    const right = rect && Number.isFinite(rect.right) ? rect.right : left + vw
    const boundaryPx = side === 'left' ? e.clientX - left : right - e.clientX
    setHorizontalSplitPct(computeSplitPct(boundaryPx / vw, vw))
  }

  const onUp = (): void => finish(true)
  const onCancel = (): void => finish(false)

  _splitDragCancel = onCancel
  document.addEventListener('pointermove', onMove)
  document.addEventListener('pointerup', onUp)
  document.addEventListener('pointercancel', onCancel)
  window.addEventListener('blur', onCancel)
}

function pinTabList(tabList: HTMLElement): void {
  const drawer = getSecondaryDrawer()
  const panel = getSecondaryPanel()
  const side = secondarySide()

  // Reparent out of the transformed wrapper when a real parent exists.
  // Unit tests often pass parent-less stubs — styles still apply.
  const parent = tabList.parentElement
  if (parent && parent !== _pinHost) {
    _restoreParent = parent
    _restoreNext = tabList.nextSibling
    if (!_pinSpacer) {
      _pinSpacer = document.createElement('div')
      _pinSpacer.className = TAB_LIST_SPACER_CLASS
      _pinSpacer.setAttribute('aria-hidden', 'true')
      setIfDifferent(_pinSpacer.style, 'flexShrink', '0')
    }
    if (_pinSpacer.parentElement !== parent) {
      parent.insertBefore(_pinSpacer, _restoreNext)
    }
    const host = ensurePinHost(side)
    if (host && tabList.parentElement !== host) {
      // Drop any stale list still sitting on the host before we append.
      removeOrphanTabListsFromHost(tabList)
      host.appendChild(tabList)
    }
    // After append, guarantee exclusive ownership (covers re-pin force path).
    removeOrphanTabListsFromHost(tabList)
  } else if (_pinHost) {
    applyPinHostChrome(_pinHost, side, PIN_OWNER_SECONDARY)
    removeOrphanTabListsFromHost(tabList)
  }

  // S8: 56px column placeholder on Sides, 0×0 horizontal — UNCONDITIONAL
  // (covers force re-pins where the list is already on the host, i.e.
  // location flips while pinned).
  syncSpacerForLocation(_pinSpacer, getDrawerLocation())
  applyPinnedTabListChrome(tabList, side)

  // Boundary handle is a HOST child (sibling of the list) — created with the
  // pin, removed by destroyPinChrome before its child-reparent loop.
  if (_pinHost) ensureSplitHandle(_pinHost)

  // Tab list is out of flex flow while pinned, but the 56px spacer stays in
  // flow. Orient the drawer so the spacer sits under the outer-edge pin strip
  // (DOM order is always [spacer, panel]). S8: horizontal neutralizes the
  // spacer to 0×0, so the drawer flex write is skipped (it would otherwise
  // fight the horizontal layout).
  if (drawer && !isHorizontalStrip()) {
    const flexDirection = side === 'right' ? 'row-reverse' : 'row'
    setIfDifferent(drawer.style, 'flexDirection', flexDirection)
  }
  // Keep chat-facing panel border while pin owns the tab strip (same edge
  // as moveControlsToOuterEdge). applyTabListPosition skips flex on pinned
  // lists but still reapplies this; set here so first pin is correct.
  if (panel) {
    applyPanelChatBorder(panel, side, true)
  }
}

function unpinTabList(tabList: HTMLElement | null): void {
  if (tabList) {
    clearPinnedTabListChrome(tabList)

    // Restore into the drawer if we reparented.
    if (_restoreParent && tabList.parentElement === _pinHost) {
      if (_pinSpacer?.parentElement === _restoreParent) {
        _restoreParent.insertBefore(tabList, _pinSpacer)
      } else if (_restoreNext && _restoreNext.parentNode === _restoreParent) {
        _restoreParent.insertBefore(tabList, _restoreNext)
      } else {
        const panel = getSecondaryPanel()
        if (panel && panel.parentElement === _restoreParent) {
          _restoreParent.insertBefore(tabList, panel)
        } else {
          _restoreParent.appendChild(tabList)
        }
      }
    }
  }

  destroyPinChrome()
  applyTabListPosition(getSettings().moveControlsToOuterEdge)
}

function destroyPinChrome(): void {
  // Handle FIRST: it is a host child, and the reparent loop below would move
  // it into the drawer as an invisible 12px pointer-events:auto strip.
  removeSplitHandle()
  if (_pinSpacer) {
    _pinSpacer.remove()
    _pinSpacer = null
  }
  _restoreParent = null
  _restoreNext = null
  if (_pinHost) {
    // Best-effort: reparent remaining children into the live drawer so the
    // tab list is not left as a body-level orphan strip. If the drawer is
    // already gone (teardown mid-flight), drop the children — assignment
    // restore recreates buttons on the next mount.
    if (_pinHost.childNodes.length > 0) {
      const drawer = getSecondaryDrawer()
      const panel = getSecondaryPanel()
      while (_pinHost.firstChild) {
        const child = _pinHost.removeChild(_pinHost.firstChild)
        if (drawer && panel) {
          drawer.insertBefore(child, panel)
        } else if (drawer) {
          drawer.appendChild(child)
        }
        // else: drop — no live drawer to attach to
      }
    }
    _pinHost.remove()
    _pinHost = null
  }
  // No pin ⇒ no split overlay; the next sync would also clear it, but a
  // direct unpin call (buttons/drawer-sync) may not be followed by one.
  clearSplitVar()
  // Defensive: clear any stray hosts that module state no longer tracks.
  sweepStrayPinHosts()
}
