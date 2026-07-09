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
import { getSettings } from '../settings/state'
import { isMobileViewport } from './mobile-exclusion'
import { getSecondaryDrawer, getSecondaryTabList, getSecondaryPanel } from './secondary'
import { TAB_LIST_WIDTH_PX } from './styles'

/** Re-export for callers that already import pin helpers from this module. */
export { TAB_LIST_WIDTH_PX }

/** Runtime flag on the tab list while keepTabListVisible is applied.
 *  Also a CSS hook (see styles under pin host / secondary wrapper). */
export const TAB_LIST_PINNED_CLASS = 'sidebar-ux-tab-list--pinned'

/** Body-level host that holds the tab list while pinned. Must not live
 *  under the secondary wrapper — that wrapper always has a non-none
 *  transform, which would become the containing block for position:fixed
 *  and slide the strip off-screen when the drawer closes. */
export const TAB_LIST_PIN_HOST_CLASS = 'sidebar-ux-tab-list-pin-host'

/** In-flow placeholder left in the drawer while the tab list is reparented. */
export const TAB_LIST_SPACER_CLASS = 'sidebar-ux-tab-list-spacer'

const PIN_Z_INDEX = '10000'
const SAFE_TOP = 'env(safe-area-inset-top, 0px)'
const SAFE_BOTTOM = 'env(safe-area-inset-bottom, 0px)'
const INNER_BORDER = '1px solid var(--lumiverse-primary-020)'

/** Module state for pin reparent / restore. Cleared on unpin. */
let _pinHost: HTMLElement | null = null
let _pinSpacer: HTMLElement | null = null
let _restoreParent: HTMLElement | null = null
let _restoreNext: ChildNode | null = null

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

/** Test-only: reset module pin state without touching a live document. */
export function __resetPinStateForTest(): void {
  _pinHost = null
  _pinSpacer = null
  _restoreParent = null
  _restoreNext = null
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
 *  - Toggle ON: write the bg-070 border on the chat-facing side.
 *  - Toggle OFF: clear the border (the existing primary-020 border
 *    between tab list and panel is the only divider needed when
 *    controls are on the inner edge). */
function applyPanelChatBorder(
  panel: StyledElement,
  drawerSide: 'left' | 'right',
  enabled: boolean,
): void {
  const chatSide: 'left' | 'right' = drawerSide === 'left' ? 'right' : 'left'
  const borderVal = '1px solid var(--lumiverse-bg-070)'
  if (enabled) {
    if (chatSide === 'right') {
      setIfDifferent(panel.style, 'borderRight', borderVal)
      setIfDifferent(panel.style, 'borderLeft', 'none')
    } else {
      setIfDifferent(panel.style, 'borderLeft', borderVal)
      setIfDifferent(panel.style, 'borderRight', 'none')
    }
  } else {
    setIfDifferent(panel.style, 'borderRight', 'none')
    setIfDifferent(panel.style, 'borderLeft', 'none')
  }
  setIfDifferent(panel.style, 'borderTop', 'none')
  setIfDifferent(panel.style, 'borderBottom', 'none')
}

export function applyTabListPosition(
  enabled: boolean,
  opts?: ElementOpts,
): void {
  if (isMobileViewport()) return

  const side = getMainDrawerSide()

  // --- Secondary drawer ---
  // Secondary is on the opposite side of the main.
  const drawer = opts?.drawer ?? getSecondaryDrawer()
  const tabList = opts?.tabList ?? getSecondaryTabList()
  const panel = opts?.panel ?? getSecondaryPanel()

  if (drawer && tabList) {
    // Pin owns secondary chrome while active — skip flex/border writes that
    // would fight the pinned strip (still apply main-drawer half below).
    // StyledElement test stubs may omit classList; treat that as unpinned.
    const pinned =
      typeof (tabList as HTMLElement).classList?.contains === 'function' &&
      (tabList as HTMLElement).classList.contains(TAB_LIST_PINNED_CLASS)
    if (!pinned) {
      // drawerSide for secondary is opposite of main.
      const secondaryDrawerSide = side === 'left' ? 'right' : 'left'
      const defaultFlex = secondaryDrawerSide === 'left' ? 'row-reverse' : 'row'
      const toggledFlex = secondaryDrawerSide === 'left' ? 'row' : 'row-reverse'
      const wantFlex = enabled ? toggledFlex : defaultFlex
      applyFlexAndBorder(drawer, tabList, wantFlex)
      if (panel) applyPanelChatBorder(panel, secondaryDrawerSide, enabled)
    }
  }

  // --- Main drawer ---
  // Main drawer is always on the `side` parameter side.
  const mainDrawer = opts?.mainDrawer ?? getMainDrawer()
  const mainTabList = opts?.mainTabList ?? getMainSidebar()
  const mainPanel = opts?.mainPanel ?? getMainPanel()

  if (mainDrawer && mainTabList) {
    const mainDefaultFlex = side === 'left' ? 'row-reverse' : 'row'
    const mainToggledFlex = side === 'left' ? 'row' : 'row-reverse'
    const mainWantFlex = enabled ? mainToggledFlex : mainDefaultFlex
    applyFlexAndBorder(mainDrawer, mainTabList, mainWantFlex)
    if (mainPanel) applyPanelChatBorder(mainPanel, side, enabled)
  }
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
  if (isMobileViewport()) {
    applyTabListPin(false, { force: true })
    return
  }
  applyTabListPin(!!getSettings().keepTabListVisible, { force: true })
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
  if (isMobileViewport()) {
    // Never pin on mobile; still clear pin if present (viewport cross-down).
    if (enabled && !opts?.force) return
    const el = getSecondaryTabList() ?? getPinnedTabList()
    if (el?.classList.contains(TAB_LIST_PINNED_CLASS) || _pinHost || _pinSpacer) {
      unpinTabList(el)
    }
    return
  }

  if (!enabled) {
    const el = getSecondaryTabList() ?? getPinnedTabList()
    const hasPinState =
      !!el?.classList.contains(TAB_LIST_PINNED_CLASS) || !!_pinHost || !!_pinSpacer
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
  _pinHost.className = `${TAB_LIST_PIN_HOST_CLASS} sidebar-ux-side-${side}`
  // Host is a non-transformed positioning shell; children take pointer events.
  setIfDifferent(_pinHost.style, 'position', 'fixed')
  setIfDifferent(_pinHost.style, 'top', SAFE_TOP)
  setIfDifferent(_pinHost.style, 'bottom', SAFE_BOTTOM)
  setIfDifferent(_pinHost.style, 'zIndex', PIN_Z_INDEX)
  setIfDifferent(_pinHost.style, 'width', `${TAB_LIST_WIDTH_PX}px`)
  setIfDifferent(_pinHost.style, 'pointerEvents', 'none')
  if (side === 'right') {
    setIfDifferent(_pinHost.style, 'right', '0')
    setIfDifferent(_pinHost.style, 'left', '')
  } else {
    setIfDifferent(_pinHost.style, 'left', '0')
    setIfDifferent(_pinHost.style, 'right', '')
  }
  return _pinHost
}

/** Remove document pin hosts that are not the module-owned `_pinHost`. */
function sweepStrayPinHosts(): void {
  if (typeof document === 'undefined' || !document.querySelectorAll) return
  const hosts = document.querySelectorAll(`.${TAB_LIST_PIN_HOST_CLASS}`)
  for (const host of Array.from(hosts)) {
    if (host !== _pinHost) {
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

function pinTabList(tabList: HTMLElement): void {
  const drawer = getSecondaryDrawer()
  const panel = getSecondaryPanel()
  const side = secondarySide()
  const innerBorderSide: 'left' | 'right' = side === 'right' ? 'left' : 'right'

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
      setIfDifferent(_pinSpacer.style, 'width', `${TAB_LIST_WIDTH_PX}px`)
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
    _pinHost.className = `${TAB_LIST_PIN_HOST_CLASS} sidebar-ux-side-${side}`
    if (side === 'right') {
      setIfDifferent(_pinHost.style, 'right', '0')
      setIfDifferent(_pinHost.style, 'left', '')
    } else {
      setIfDifferent(_pinHost.style, 'left', '0')
      setIfDifferent(_pinHost.style, 'right', '')
    }
    removeOrphanTabListsFromHost(tabList)
  }

  tabList.classList.add(TAB_LIST_PINNED_CLASS)

  // Fill the pin host (or viewport edge if no reparent in stub tests).
  setIfDifferent(tabList.style, 'position', 'fixed')
  setIfDifferent(tabList.style, 'top', SAFE_TOP)
  setIfDifferent(tabList.style, 'bottom', SAFE_BOTTOM)
  setIfDifferent(tabList.style, 'zIndex', PIN_Z_INDEX)
  setIfDifferent(tabList.style, 'width', `${TAB_LIST_WIDTH_PX}px`)
  setIfDifferent(tabList.style, 'pointerEvents', 'auto')
  if (side === 'right') {
    setIfDifferent(tabList.style, 'right', '0')
    setIfDifferent(tabList.style, 'left', '')
  } else {
    setIfDifferent(tabList.style, 'left', '0')
    setIfDifferent(tabList.style, 'right', '')
  }

  if (innerBorderSide === 'right') {
    setIfDifferent(tabList.style, 'borderRight', INNER_BORDER)
    setIfDifferent(tabList.style, 'borderLeft', 'none')
  } else {
    setIfDifferent(tabList.style, 'borderLeft', INNER_BORDER)
    setIfDifferent(tabList.style, 'borderRight', 'none')
  }

  // Out of flex flow while pinned — flex-direction no longer affects layout.
  if (drawer) {
    setIfDifferent(drawer.style, 'flexDirection', '')
  }
  if (panel) {
    setIfDifferent(panel.style, 'borderRight', 'none')
    setIfDifferent(panel.style, 'borderLeft', 'none')
  }
}

function unpinTabList(tabList: HTMLElement | null): void {
  if (tabList) {
    tabList.classList.remove(TAB_LIST_PINNED_CLASS)
    setIfDifferent(tabList.style, 'position', '')
    setIfDifferent(tabList.style, 'top', '')
    setIfDifferent(tabList.style, 'bottom', '')
    setIfDifferent(tabList.style, 'left', '')
    setIfDifferent(tabList.style, 'right', '')
    setIfDifferent(tabList.style, 'zIndex', '')
    setIfDifferent(tabList.style, 'pointerEvents', '')
    // Restore construction width — do not blank it.
    setIfDifferent(tabList.style, 'width', `${TAB_LIST_WIDTH_PX}px`)
    // Borders restored via applyTabListPosition below.
    setIfDifferent(tabList.style, 'borderLeft', '')
    setIfDifferent(tabList.style, 'borderRight', '')

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
  // Defensive: clear any stray hosts that module state no longer tracks.
  sweepStrayPinHosts()
}
