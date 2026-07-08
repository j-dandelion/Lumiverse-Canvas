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

/** Class added to .sidebar-ux-tab-list when keepTabListVisible pins it to
 *  the viewport edge. Used both as a runtime flag (idempotency check) and
 *  as a CSS hook for any pinned-specific rules in sidebar/styles.ts. */
export const TAB_LIST_PINNED_CLASS = 'sidebar-ux-tab-list--pinned'

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
    // drawerSide for secondary is opposite of main.
    const secondaryDrawerSide = side === 'left' ? 'right' : 'left'
    const defaultFlex = secondaryDrawerSide === 'left' ? 'row-reverse' : 'row'
    const toggledFlex = secondaryDrawerSide === 'left' ? 'row' : 'row-reverse'
    const wantFlex = enabled ? toggledFlex : defaultFlex
    applyFlexAndBorder(drawer, tabList, wantFlex)
    if (panel) applyPanelChatBorder(panel, secondaryDrawerSide, enabled)
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

/** Pin the secondary drawer's tab-button-list to the viewport edge so it
 *  remains visible even when the drawer is closed. The panel (the drawer's
 *  only remaining flex child) slides in/out from behind the pinned tab
 *  list. The drawer toggle (`.sidebar-ux-drawer-tab`) is unchanged — it
 *  still slides with the wrapper, hidden behind the tab list when closed
 *  and visible to the left of the drawer when open.
 *
 *  Idempotent. No-op on mobile (the drawer's mobile layout already handles
 *  the tab list differently via media queries). No-op if the secondary
 *  wrapper doesn't exist (master toggle off or before mount). */
export function applyTabListPin(enabled: boolean): void {
  if (isMobileViewport()) return

  const tabList = getSecondaryTabList()
  if (!tabList) return
  const drawer = getSecondaryDrawer()
  const panel = getSecondaryPanel()

  const isPinned = tabList.classList.contains(TAB_LIST_PINNED_CLASS)
  if (enabled === isPinned) return  // already in target state

  // Secondary is on the opposite side of the main.
  const side: 'left' | 'right' = getMainDrawerSide() === 'left' ? 'right' : 'left'
  const innerBorderSide: 'left' | 'right' = side === 'right' ? 'left' : 'right'
  const borderVal = '1px solid var(--lumiverse-primary-020)'

  if (enabled) {
    tabList.classList.add(TAB_LIST_PINNED_CLASS)
    // Position the tab list at the viewport edge.
    ;(tabList as any).style.position = 'fixed'
    ;(tabList as any).style.top = '0'
    ;(tabList as any).style.bottom = '0'
    ;(tabList as any).style[side] = '0'
    ;(tabList as any).style.zIndex = '10000'
    ;(tabList as any).style.width = '56px'
    ;(tabList as any).style.pointerEvents = 'auto'
    // Border on the inner (panel-facing) side.
    if (innerBorderSide === 'right') {
      ;(tabList as any).style.borderRight = borderVal
      ;(tabList as any).style.borderLeft = 'none'
    } else {
      ;(tabList as any).style.borderLeft = borderVal
      ;(tabList as any).style.borderRight = 'none'
    }
    // Reset the drawer's flex direction — the tab list is no longer a
    // flex child, so the direction has no effect.
    if (drawer) {
      ;(drawer as any).style.flexDirection = ''
    }
    // Clear the panel's chat-facing border — the tab list no longer
    // sits next to the panel inside the drawer.
    if (panel) {
      ;(panel as any).style.borderRight = 'none'
      ;(panel as any).style.borderLeft = 'none'
    }
  } else {
    tabList.classList.remove(TAB_LIST_PINNED_CLASS)
    // Clear the pinning styles on the tab list.
    ;(tabList as any).style.position = ''
    ;(tabList as any).style.top = ''
    ;(tabList as any).style.bottom = ''
    ;(tabList as any).style.left = ''
    ;(tabList as any).style.right = ''
    ;(tabList as any).style.zIndex = ''
    ;(tabList as any).style.width = ''
    ;(tabList as any).style.pointerEvents = ''
    // Clear the borders we set — applyTabListPosition will set them
    // based on moveControlsToOuterEdge.
    ;(tabList as any).style.borderLeft = ''
    ;(tabList as any).style.borderRight = ''
    // Restore the drawer's flex direction and the panel's border.
    applyTabListPosition(getSettings().moveControlsToOuterEdge)
  }
}
