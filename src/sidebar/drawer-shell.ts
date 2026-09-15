// Shared drawer shell factory for Canvas-owned drawers (secondary + main mirror).
//
// Produces the same DOM structure secondary has always used:
//   wrapper > drawerTab + drawer > tabList + panel > header + content
//
// Open/close animation and lifecycle stay in the owning modules; this module
// only builds chrome. Host/Lumiverse source is never modified.

import { clampSidebarWidth } from '../dom/clamp'
import {
  injectDrawerTabStyles,
  LOCATION_CLASS_BOTTOM,
  LOCATION_CLASS_TOP,
} from './styles'
import type { DrawerLocation } from '../types'

export type DrawerShellOwner = 'main' | 'secondary'

/** Horizontal strip edge while Drawer location is Top/Bottom. */
export type StripEdge = 'top' | 'bottom'

/**
 * Panel-header actions cluster (flex row holding the close button + any
 * injected OS chrome). Without it, a third direct child of the header would
 * be centered by the header's `justify-content: space-between`.
 */
export const HEADER_ACTIONS_CLASS = 'sidebar-ux-panel-header-actions'

/**
 * Dispatched on `window` when a shell is constructed. OS panel chrome
 * (os/panel-chrome.ts) re-ensures on it: a shell remount (viewport cross,
 * taskbar toggle, drawer enable) replaces the header with no model change
 * to piggyback on. The rAF-deferred ensure runs after the owner's
 * appendChild (same task), so the header is connected by then.
 */
export const DRAWER_SHELL_CREATED_EVENT = 'canvas:drawer-shell-created'

export interface DrawerShellOptions {
  /** Which Canvas drawer this shell belongs to. */
  owner: DrawerShellOwner
  /** Viewport edge this shell is anchored to. */
  side: 'left' | 'right'
  /** CSS custom property for width (e.g. --sidebar-ux-secondary-w). */
  widthCssVar: string
  /** Fallback width when CSS var and initialWidth are unset. */
  defaultWidth?: number
  /** Preferred width on first paint (layout restore). */
  initialWidth?: number
  /** If true, wrapper starts at translateX(0). */
  initialOpen?: boolean
  /** Force full-viewport width (mobile secondary). */
  fullViewportWidth?: boolean
  /** Panel header title text. */
  title?: string
  /** Initial drawer-tab display (secondary starts as 'none'). */
  drawerTabDisplay?: string
  /**
   * S8 Drawer location: reserve the horizontal strip height at this wrapper
   * edge (top/bottom). Callers resolve it from getDrawerLocation() so this
   * leaf never imports settings.
   */
  stripEdge?: StripEdge | null
  onDrawerTabClick?: () => void
  onHeaderClose?: () => void
}

export interface DrawerShell {
  wrapper: HTMLElement
  drawerTab: HTMLElement
  drawer: HTMLElement
  tabList: HTMLElement
  panel: HTMLElement
  header: HTMLElement
  title: HTMLElement
  /** Flex cluster holding the close button (+ injected OS minimize). */
  headerActions: HTMLElement
  closeBtn: HTMLElement
  content: HTMLElement
  side: 'left' | 'right'
  widthCssVar: string
  owner: DrawerShellOwner
}

/**
 * Closed-state translateX for a shell anchored on `side` with width `w`.
 * - left anchor → slide further left (−w)
 * - right anchor → slide further right (+w)
 *
 * +1px overshoot: kills subpixel / hairline peeks at the closed edge under
 * device-pixel zoom or AA.  Host uses CSS % for its closed transform (always
 * matches rendered size) so it doesn't need this; Canvas uses JS px so even
 * when `widthPx` is an integer the browser may raster the edge 1px into the
 * viewport under fractional device-pixel ratios.
 */
export function closedTransformPx(side: 'left' | 'right', widthPx: number): number {
  const w = Math.ceil(widthPx) + 1
  return side === 'left' ? -w : w
}

/**
 * S8 Drawer location: wrapper top/bottom offsets. Sides = plain safe-area
 * insets; Top/Bottom reserve `--sidebar-ux-strip-h` at that edge so the
 * strip never covers the panel header. Shared by shell construction and the
 * runtime flip (drawer-location.restyleShellLocation).
 */
export function applyWrapperStripEdge(
  wrapper: HTMLElement | null,
  edge: StripEdge | null,
): void {
  if (!wrapper) return
  const safeTop = 'env(safe-area-inset-top, 0px)'
  const safeBottom = 'env(safe-area-inset-bottom, 0px)'
  const strip = 'var(--sidebar-ux-strip-h, 56px)'
  const top = edge === 'top' ? `calc(${safeTop} + ${strip})` : safeTop
  const bottom = edge === 'bottom' ? `calc(${safeBottom} + ${strip})` : safeBottom
  if (wrapper.style.top !== top) wrapper.style.top = top
  if (wrapper.style.bottom !== bottom) wrapper.style.bottom = bottom
}

/**
 * S8: sync a pin spacer's in-flow size to the drawer location. Sides keeps
 * the 56px column placeholder (node kept as restore anchor); horizontal
 * neutralizes it to 0×0 (the list is absolutely positioned inside the strip
 * host, so no in-flow width may remain). Called unconditionally from both
 * pin paths on every reconcile/flip.
 */
export function syncSpacerForLocation(
  spacer: HTMLElement | null,
  location: DrawerLocation,
): void {
  if (!spacer) return
  if (location === 'sides') {
    if (spacer.style.width !== '56px') spacer.style.width = '56px'
    if (spacer.style.height !== 'auto') spacer.style.height = 'auto'
  } else {
    if (spacer.style.width !== '0px') spacer.style.width = '0px'
    if (spacer.style.height !== '0px') spacer.style.height = '0px'
  }
}

/** Read width from a CSS var with fallback. */
export function readWidthCssVar(varName: string, fallback = 420): number {
  try {
    const style = document.documentElement?.style
    if (!style?.getPropertyValue) return fallback
    const n = parseFloat(style.getPropertyValue(varName))
    return isFinite(n) && n > 0 ? n : fallback
  } catch {
    return fallback
  }
}

/** S6: full-viewport width expression for mobile shells (+1px oversize —
 *  under fractional zoom/AA the scaled viewport resolves ~1px short).
 *  Shared by createDrawerShell's mobile branch, the main shell's
 *  restyle-in-place sync, and the mobile CSS blocks. */
export const FULL_BLEED_WIDTH_EXPR =
  'calc(var(--app-scaled-viewport-width, calc(100vw / var(--lumiverse-ui-scale, 1))) + 1px)'

/** Read the Lumiverse UI zoom scale (1 if undefined / unparseable). */
export function readUiScale(): number {
  try {
    return parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--lumiverse-ui-scale')
    ) || 1
  } catch {
    return 1
  }
}

/**
 * Edge-handle glyphs. The MAIN shell must keep the vanilla Lumiverse
 * main-drawer handle icon (lucide `Sparkles` v0.468.0 — ViewportDrawer.tsx
 * renders `<Sparkles size={16}/>` inside its drawerTab button); only the
 * SECONDARY drawer uses Canvas's own panel glyph. Regression (live-verify
 * #10): both shells hardcoded the panel glyph, so swapping in the main
 * mirror restyled the vanilla handle.
 */
const CANVAS_DRAWER_TAB_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>`
const VANILLA_MAIN_DRAWER_TAB_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>`

/**
 * Build a full Canvas drawer shell (wrapper + drawer tab + drawer chrome).
 * Does not append to the document — caller mounts.
 */
export function createDrawerShell(options: DrawerShellOptions): DrawerShell {
  const {
    owner,
    side,
    widthCssVar,
    defaultWidth = 420,
    initialWidth,
    initialOpen = false,
    fullViewportWidth = false,
    title: titleText = 'Drawer',
    drawerTabDisplay = 'none',
    stripEdge = null,
    onDrawerTabClick,
    onHeaderClose,
  } = options

  const wrapperClass =
    owner === 'secondary'
      ? 'sidebar-ux-secondary-wrapper'
      : 'sidebar-ux-main-mirror-wrapper'

  const wrapper = document.createElement('div')
  // sidebar-ux-shell: public stable hook for user/theme CSS (both Canvas drawers).
  wrapper.className = `${wrapperClass} sidebar-ux-shell sidebar-ux-side-${side}`
  wrapper.setAttribute('data-drawer-owner', owner)
  wrapper.dataset.drawerOpen = initialOpen ? 'true' : 'false'

  const cssVarWidth = parseFloat(document.documentElement.style.getPropertyValue(widthCssVar))
  const rawWidth =
    initialWidth && initialWidth > 0
      ? initialWidth
      : isFinite(cssVarWidth) && cssVarWidth > 0
        ? cssVarWidth
        : defaultWidth

  // On mobile (fullViewportWidth) the host zooms its children, so raw
  // window.innerWidth is already in device-px and must be un-scaled to
  // CSS px.  Use the host-aligned CSS var for the drawer width; for the
  // CSS var (used by JS transform) compute a px approximation.
  const initWidth = fullViewportWidth
    ? Math.round(window.innerWidth / readUiScale())
    : Math.ceil(clampSidebarWidth(rawWidth))

  document.documentElement.style.setProperty(widthCssVar, `${initWidth}px`)

  const initWrapperTransform = initialOpen
    ? 'translateX(0)'
    : `translateX(${closedTransformPx(side, initWidth)}px)`

  wrapper.style.cssText = `
    position: fixed;
    top: env(safe-area-inset-top, 0px); bottom: env(safe-area-inset-bottom, 0px);
    z-index: 9990;
    display: flex;
    align-items: stretch;
    pointer-events: none;
    transform: ${initWrapperTransform};
    ${side === 'left'
      ? `left: 0; flex-direction: row-reverse;`
      : `right: 0; flex-direction: row;`};
  `
  // S8: resolve the strip reserve at construction (no boot flash when the
  // persisted location is Top/Bottom). Runtime flips restyle in place.
  applyWrapperStripEdge(wrapper, stripEdge)

  injectDrawerTabStyles()

  const drawerTab = document.createElement('button')
  drawerTab.className = 'sidebar-ux-drawer-tab'
  drawerTab.style.cssText = `
    display: ${drawerTabDisplay};
    border-${side === 'left' ? 'left' : 'right'}: none;
    border-radius: ${side === 'left' ? '0 12px 12px 0' : '12px 0 0 12px'};
  `
  const iconWrapper = document.createElement('div')
  iconWrapper.className = 'sidebar-ux-drawer-tab-icon'
  iconWrapper.innerHTML = owner === 'main' ? VANILLA_MAIN_DRAWER_TAB_ICON : CANVAS_DRAWER_TAB_ICON
  drawerTab.appendChild(iconWrapper)
  if (onDrawerTabClick) {
    drawerTab.addEventListener('click', onDrawerTabClick)
  }

  const drawer = document.createElement('div')
  drawer.className = 'sidebar-ux-drawer'
  drawer.style.cssText = `
    width: ${fullViewportWidth
      ? FULL_BLEED_WIDTH_EXPR
      : `var(${widthCssVar}, ${defaultWidth}px)`};
    height: 100%;
    position: relative;
    display: flex;
    background: var(--lumiverse-bg-deep);
    box-shadow: var(--lumiverse-shadow-xl);
    pointer-events: auto;
    isolation: isolate;
    flex-direction: ${side === 'right' ? 'row' : 'row-reverse'};
  `

  const tabList = document.createElement('div')
  tabList.className = 'sidebar-ux-tab-list'
  tabList.style.cssText = `
    width: 56px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    padding: 6px 0;
    gap: 4px;
    overflow-y: auto;
    scrollbar-width: none;
    border-${side === 'right' ? 'right' : 'left'}: 1px solid var(--lumiverse-primary-020);
    background: color-mix(in srgb, var(--lumiverse-primary) 6%, var(--lumiverse-bg-deep));
  `

  const panel = document.createElement('div')
  panel.className = 'sidebar-ux-panel'
  panel.style.cssText = `
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  `

  const header = document.createElement('div')
  header.className = 'sidebar-ux-panel-header'
  header.style.cssText = `
    min-height: var(--sidebar-ux-panel-header-h, 48px);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sidebar-ux-panel-header-pt, 12px) 16px var(--sidebar-ux-panel-header-pb, 12px);
    border-bottom: var(--sidebar-ux-panel-header-border-bottom, 1px solid var(--lumiverse-primary-015));
    background: var(--sidebar-ux-panel-header-bg, var(--lumiverse-primary-008, rgba(255, 255, 255, 0.02)));
    flex-shrink: 0;
  `

  const title = document.createElement('h2')
  title.className = 'sidebar-ux-panel-title'
  title.style.cssText = `
    margin: 0;
    font-size: var(--sidebar-ux-panel-header-font-size, calc(15px * var(--lumiverse-font-scale, 1)));
    font-weight: 600;
    color: var(--lumiverse-text);
  `
  title.textContent = titleText

  // Match Lumiverse CloseButton size="md" (32×32, icon 16) so panel header
  // height matches host (padding 12+12 + 32 ≈ 56px, not a short 24px X).
  const closeBtn = document.createElement('button')
  closeBtn.className = 'sidebar-ux-close-btn'
  closeBtn.type = 'button'
  closeBtn.setAttribute('aria-label', 'Close')
  closeBtn.style.cssText = `
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    background: transparent;
    border: none;
    border-radius: 8px;
    color: var(--lumiverse-text-muted);
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s ease, color 0.15s ease;
  `
  closeBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`
  if (onHeaderClose) {
    closeBtn.addEventListener('click', onHeaderClose)
  }

  // Actions cluster: header keeps `space-between` (title ↔ cluster) while
  // OS chrome (os/panel-chrome.ts) can insert a minimize button adjacent to
  // the X without landing in the center gap.
  const headerActions = document.createElement('div')
  headerActions.className = HEADER_ACTIONS_CLASS
  headerActions.appendChild(closeBtn)

  header.appendChild(title)
  header.appendChild(headerActions)

  const content = document.createElement('div')
  content.className = 'sidebar-ux-panel-content'
  content.style.cssText = `
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior-y: contain;
    --sidebar-ux-content-pt: 12px;
    --sidebar-ux-content-pr: 12px;
    --sidebar-ux-content-pb: 40px;
    --sidebar-ux-content-pl: 12px;
    padding: var(--sidebar-ux-content-pt) var(--sidebar-ux-content-pr) var(--sidebar-ux-content-pb) var(--sidebar-ux-content-pl);
    position: relative;
  `

  panel.appendChild(header)
  panel.appendChild(content)
  drawer.appendChild(tabList)
  drawer.appendChild(panel)
  wrapper.appendChild(drawerTab)
  wrapper.appendChild(drawer)

  // OS panel chrome re-ensures on this signal (shell remounts replace the
  // header without a model change). Guarded — test shims may not provide
  // window/CustomEvent.
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    try {
      window.dispatchEvent(
        new CustomEvent(DRAWER_SHELL_CREATED_EVENT, { detail: { owner } }),
      )
    } catch {
      /* non-browser environment */
    }
  }

  return {
    wrapper,
    drawerTab,
    drawer,
    tabList,
    panel,
    header,
    title,
    headerActions,
    closeBtn,
    content,
    side,
    widthCssVar,
    owner,
  }
}

/**
 * S4 CSS-only side swap: restyle an EXISTING Canvas shell for a new anchor
 * side, in place (no teardown/remount, no container churn). Mirrors the
 * side-specific inline styles set at construction (createDrawerShell):
 * wrapper anchor + flex-direction + `sidebar-ux-side-*` class, drawerTab
 * border/radius, drawer flex-direction, tabList border side.
 *
 * Transforms are NOT set here — callers recompute open/closed transforms
 * from their own state (open flag + width var) since only they know both.
 * Idempotent: restyling with the current side is a no-op.
 */
export function restyleShellSide(
  wrapper: HTMLElement | null,
  side: 'left' | 'right',
): void {
  if (!wrapper) return
  wrapper.classList.toggle('sidebar-ux-side-left', side === 'left')
  wrapper.classList.toggle('sidebar-ux-side-right', side === 'right')
  const ws = wrapper.style
  if (side === 'left') {
    ws.setProperty('left', '0')
    ws.removeProperty('right')
    ws.setProperty('flex-direction', 'row-reverse')
  } else {
    ws.setProperty('right', '0')
    ws.removeProperty('left')
    ws.setProperty('flex-direction', 'row')
  }

  const tabList = wrapper.querySelector('.sidebar-ux-tab-list') as HTMLElement | null
  // Pin detection without a settings import (this module is a leaf): while
  // pinned, the tab list is reparented to the body-level pin host, so the
  // wrapper no longer contains it and the 56px spacer sits in the drawer's
  // DOM order ([spacer, panel]). The flex direction that parks the spacer on
  // the screen-edge side is the OPPOSITE of the in-flow (unpinned) default.
  const pinned = tabList === null

  // S8: while Top/Bottom, the pin spacer is 0×0 and the drawer flex write
  // would fight the horizontal layout — skip it (the panel fills either way).
  const horizontalLocation =
    typeof document !== 'undefined'
    && !!document.documentElement?.classList
    && (document.documentElement.classList.contains(LOCATION_CLASS_TOP)
      || document.documentElement.classList.contains(LOCATION_CLASS_BOTTOM))

  const drawer = wrapper.querySelector('.sidebar-ux-drawer') as HTMLElement | null
  if (drawer && !horizontalLocation) {
    const wantFlex =
      side === 'right'
        ? pinned
          ? 'row-reverse'
          : 'row'
        : pinned
          ? 'row'
          : 'row-reverse'
    drawer.style.setProperty('flex-direction', wantFlex)
  }

  const drawerTab = wrapper.querySelector('.sidebar-ux-drawer-tab') as HTMLElement | null
  if (drawerTab) {
    if (side === 'left') {
      drawerTab.style.setProperty('border-left', 'none')
      drawerTab.style.removeProperty('border-right')
      drawerTab.style.setProperty('border-radius', '0 12px 12px 0')
    } else {
      drawerTab.style.setProperty('border-right', 'none')
      drawerTab.style.removeProperty('border-left')
      drawerTab.style.setProperty('border-radius', '12px 0 0 12px')
    }
  }

  if (tabList) {
    if (side === 'right') {
      tabList.style.setProperty('border-right', '1px solid var(--lumiverse-primary-020)')
      tabList.style.removeProperty('border-left')
    } else {
      tabList.style.setProperty('border-left', '1px solid var(--lumiverse-primary-020)')
      tabList.style.removeProperty('border-right')
    }
  }
}
