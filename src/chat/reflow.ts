// Chat-margin reflow + main-sidebar button tagging.
//
// Two related concerns share a single startReflowObserver lifecycle:
//   1. Chat + Welcome reflow — watch the main wrapper's class/style mutations
//      and recompute the consumer's margin CSS variables (--sidebar-ux-chat-ml/mr
//      on the chat column, --sidebar-ux-welcome-ml/mr on the Landing screen)
//      so both stay centered in the visible area when the main and/or secondary
//      drawer is open (or pin strips under taskbar mode). Chat and Welcome are
//      independent settings (chatReflow / welcomeReflow) sharing one sheet +
//      observer; the L/R margins compose with the static strip-gutter rules
//      (sidebar/strip-gutter.ts) and the Top/Bottom strip reserve.
//   2. Main-sidebar button tagging — watch the main sidebar for child-list
//      changes (tab add/replace) and tag each extension tab button with a
//      stable `data-tab-id` attribute. The id-based match is what
//      findMainTabButton relies on; the previous title-match was the bug
//      class v1.3.0 closed.
//
// Both observers are gated on this function being called, which in setup()
// only happens when CanvasSettings.chatReflow or CanvasSettings.welcomeReflow
// is on.
//
// Policy vs taskbar mode (see docs/chat-reflow.md):
//   - taskbarMode OFF → classic host open-drawer widths on chat + Welcome.
//   - taskbarMode ON → main-mirror open width / closed pin-strip
//     reserve; secondary open width / strip reserve. The strip gutter rules
//     are overridden while a drawer is open (the reflow rule carries the TS
//     authority guards so it wins the tie), so Welcome uses the same
//     open-drawer geometry as chat.
//
// On mobile (≤600px) the reflow is a complete no-op — updateChatReflow
// early-returns after clearing any stale inline vars, the injected CSS
// overrides the margin rule at the same breakpoint, and a matchMedia
// change listener drops vars on cross-down and re-runs the reflow on
// cross-up. The listener is registered in startReflowObserver and torn
// down by the returned cleanup, mirroring the secondary drawer's
// viewport-cross pattern in sidebar/mobile-exclusion.ts.
import { getChatColumn, getLandingPage, getMainWrapper, getMainDrawerWidth } from '../dom/lumiverse'
import { getMainDrawerSide, isMainDrawerOpen } from '../store'
import { isSecondarySidebarOpen, SECONDARY_WIDTH_VAR, getSecondaryTabList } from '../sidebar/secondary'
import { startTagObserver } from './tag-buttons'
import { injectStyles } from '../debug/styles'
import { getDockInsets } from '../sidebar/dock-offset'

// CSS variable names for content lane insets (published on documentElement).
export const CONTENT_INSET_L_VAR = '--sidebar-ux-content-inset-l'
export const CONTENT_INSET_R_VAR = '--sidebar-ux-content-inset-r'

import { waitForElement } from '../dom/wait-for'
import { isMobileViewport } from '../sidebar/mobile-exclusion'
import { isHorizontalStrip, isTaskbarModeEnabled, getSettings } from '../settings/state'
import { TAB_LIST_WIDTH_PX, MAIN_MIRROR_WIDTH_VAR } from '../sidebar/styles'
import { isMainMirrorActive, isCanvasMainOpen } from '../sidebar/main-mirror-drawer'
import { isMainTabListPinActive } from '../sidebar/main-tab-pin'

/** One-shot chat-column attr that suppresses the margin transition for the
 *  FIRST margin application of a given chat element (boot restore / late chat
 *  mount), so load never animates the chat reflow. Exported for tests. */
export const REFLOW_INSTANT_ATTR = 'data-canvas-reflow-instant'

/** Root class enabling the Welcome/Landing margin rules. Added/removed by
 *  `applyWelcomeReflow` from the `welcomeReflow` setting, so the sheet can be
 *  shared with chat without touching the Landing screen when welcome reflow is
 *  off. */
export const WELCOME_REFLOW_CLASS = 'sidebar-ux-welcome-reflow'

/** The chat element the margins were last applied to. A different element
 *  means a fresh mount → the first application snaps. */
let _lastReflowedChat: Element | null = null

/** The Landing element the welcome margins were last applied to. The Landing
 *  route unmounts on navigation, so a remount must snap (not slide in). */
let _lastReflowedLanding: Element | null = null

export function setChatMargin(side: 'left' | 'right', px: number): void {
  const chat = getChatColumn()
  if (!chat) return
  const varName = side === 'left' ? '--sidebar-ux-chat-ml' : '--sidebar-ux-chat-mr'
  chat.style.setProperty(varName, `${px}px`)
}

/** Inline margin var on the Landing screen. No-op while the route (and thus
 *  the element) is unmounted — the root class stays, and the next apply after
 *  the remount writes the vars. */
export function setWelcomeMargin(side: 'left' | 'right', px: number): void {
  const landing = getLandingPage()
  if (!landing) return
  const varName = side === 'left' ? '--sidebar-ux-welcome-ml' : '--sidebar-ux-welcome-mr'
  landing.style.setProperty(varName, `${px}px`)
}

/** Remove the two reflow margin vars from the chat column (if present)
 *  and any leftover documentElement props from the former Welcome-reflow
 *  path. Centralized so the on→off path in features/registry.ts and the
 *  mobile no-op path share one source of truth. */
export function clearChatMargins(): void {
  const chat = getChatColumn()
  if (chat) {
    chat.style.removeProperty('--sidebar-ux-chat-ml')
    chat.style.removeProperty('--sidebar-ux-chat-mr')
  }
  // Migration: drop root vars if an older session left them on <html>.
  const root = document.documentElement
  root.style.removeProperty('--sidebar-ux-chat-ml')
  root.style.removeProperty('--sidebar-ux-chat-mr')
  // A future re-application (cross-up / re-enable) should snap, not animate
  // from the cleared state.
  _lastReflowedChat = null
}

/** Remove the welcome root class + margin vars and forget the last-applied
 *  element. Shared by the setting on→off path, the mobile no-op path, the
 *  observer teardown and the extension disable sweep. */
export function clearWelcomeReflow(): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.remove(WELCOME_REFLOW_CLASS)
  const landing = getLandingPage()
  if (landing) {
    landing.style.removeProperty('--sidebar-ux-welcome-ml')
    landing.style.removeProperty('--sidebar-ux-welcome-mr')
    landing.removeAttribute(REFLOW_INSTANT_ATTR)
  }
  _lastReflowedLanding = null
}

/**
 * Apply (or clear) the Landing margins for the current setting + geometry.
 * Landing and chat share the computed insets; each is written only when its
 * own setting is on. A fresh Landing element snaps on its first application
 * (the route unmounts/remounts), later margins animate.
 */
function applyWelcomeReflow(insets: { left: number; right: number }): void {
  if (!getSettings().welcomeReflow) {
    clearWelcomeReflow()
    return
  }
  document.documentElement.classList.add(WELCOME_REFLOW_CLASS)
  const landing = getLandingPage()
  if (!landing) return
  const instant = landing !== _lastReflowedLanding
  if (instant) landing.setAttribute(REFLOW_INSTANT_ATTR, '1')
  setWelcomeMargin('right', insets.right)
  setWelcomeMargin('left', insets.left)
  if (instant) {
    _lastReflowedLanding = landing
    const dropInstant = () => landing.removeAttribute(REFLOW_INSTANT_ATTR)
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(dropInstant))
    } else {
      dropInstant()
    }
  }
}

export function injectReflowStyles(): void {
  injectStyles(
    'sidebar-ux-reflow',
    `
    [class*="_chatColumn_"] {
      margin-left: var(--sidebar-ux-chat-ml, 0px) !important;
      margin-right: var(--sidebar-ux-chat-mr, 0px) !important;
      transition: margin 0.35s cubic-bezier(0.4, 0, 0.2, 1) !important;
    }
    /* First application for a given chat element: snap the margins. The chat
       column can mount AFTER the drawer is already open (boot restore / SPA
       navigation into a chat); an animated first application reads as a
       load-time layout slide. The attr is set by updateChatReflow's first pass
       for a new chat element and dropped a painted frame later (double rAF),
       so user open/close margins still animate. */
    [class*="_chatColumn_"][data-canvas-reflow-instant] {
      transition: none !important;
    }
    /* Top/Bottom: match the 270ms rail bloom (PANEL_OPEN_MS/PANEL_CLOSE_MS) so
       the chat edge settles with the panel instead of lingering. */
    html.sidebar-ux-location-top [class*="_chatColumn_"],
    html.sidebar-ux-location-bottom [class*="_chatColumn_"] {
      transition-duration: 0.27s !important;
    }
    /* Welcome/Landing: same insets, independent setting. The two ID guards are
       the TS-authority specificity tier — the strip-gutter sheet
       (html.sidebar-ux-strip-gutters [data-component="LandingPage"], same
       class+attr weight and possibly injected later) and Theme Studio's
       ":where(...) !important" overrides would otherwise beat this rule on
       ties. Do not remove them. */
    html.sidebar-ux-welcome-reflow [data-component="LandingPage"]:not(#__theme_studio_authority_a__):not(#__theme_studio_authority_b__) {
      margin-left: var(--sidebar-ux-welcome-ml, 0px) !important;
      margin-right: var(--sidebar-ux-welcome-mr, 0px) !important;
      transition: margin 0.35s cubic-bezier(0.4, 0, 0.2, 1) !important;
    }
    html.sidebar-ux-welcome-reflow [data-component="LandingPage"]:not(#__theme_studio_authority_a__):not(#__theme_studio_authority_b__)[data-canvas-reflow-instant] {
      transition: none !important;
    }
    html.sidebar-ux-welcome-reflow.sidebar-ux-location-top [data-component="LandingPage"]:not(#__theme_studio_authority_a__):not(#__theme_studio_authority_b__),
    html.sidebar-ux-welcome-reflow.sidebar-ux-location-bottom [data-component="LandingPage"]:not(#__theme_studio_authority_a__):not(#__theme_studio_authority_b__) {
      transition-duration: 0.27s !important;
    }
    @media (max-width: 600px) {
      [class*="_chatColumn_"] {
        margin-left: 0 !important;
        margin-right: 0 !important;
        transition: none !important;
      }
      html.sidebar-ux-welcome-reflow [data-component="LandingPage"]:not(#__theme_studio_authority_a__):not(#__theme_studio_authority_b__) {
        margin-left: 0 !important;
        margin-right: 0 !important;
        transition: none !important;
      }
    }
  `,
  )
}

let _reflowRaf: number | null = null

/**
 * Compute the content lane insets — the left/right visual margin that
 * remains visible between the drawer chrome and the viewport edge.
 * Returns {left, right} in pixels plus the open-drawer sides (Sides truth
 * for the chat-owned shadow; each is true only while that side's drawer is
 * actually open — strip reserves do not count).
 *
 * Exact same math as the chat-reflow margins: main mirror OR host drawer
 * on one side, secondary open / pin strip on the other, dock-panel clamp,
 * mobile → {0, 0}. Extracted so the weaver-lane module and other always-on
 * consumers can position content without duplicating the geometry logic.
 *
 * Dock panels (e.g. LumiScript) are edge-anchored; the App's own padding
 * already reserves the dock's width. When a dock sits on the same edge as a
 * pinned tab strip, the dock is offset to sit just INSIDE the strip
 * (sidebar/dock-offset.ts), so the strip's full width is reserved on top of
 * the dock inset. An OPEN drawer overlaps the dock (drawer z > dock z), so the
 * margin there is the drawer width minus the dock inset (the drawer covers
 * the dock; only the overhang past the dock needs reserving).
 */
export function computeContentLaneInsets(): {
  left: number
  right: number
  openLeft: boolean
  openRight: boolean
} {
  if (isMobileViewport()) {
    return { left: 0, right: 0, openLeft: false, openRight: false }
  }

  const mainSide = getMainDrawerSide()
  const dock = getDockInsets()

  // When Canvas owns main chrome (desktop), reflow follows the
  // Canvas main shell — not host wrapperOpen.
  const mirrorActive = isMainMirrorActive()
  const mainOpen = mirrorActive ? isCanvasMainOpen() : isMainDrawerOpen()
  const mainDrawerW = mainOpen
    ? mirrorActive
      ? parseFloat(document.documentElement.style.getPropertyValue(MAIN_MIRROR_WIDTH_VAR)) || 420
      : getMainDrawerWidth()
    : 0
  // Strip reserve ONLY while the tab list is actually pinned to the edge
  // (taskbar chrome). S1: the mirror shell is active unconditionally on
  // desktop — a closed unpinned shell leaves only its edge tab button, which
  // overlays content like the secondary drawerTab (no reserve). Keying on
  // mirrorActive (the old gate) would phantom-reserve 56px for every closed
  // drawer with taskbarMode off.
  // S8: Top/Bottom reserves the strip on the top/bottom edge (CSS-owned) —
  // never as a left/right margin.
  const mainStrip =
    !isHorizontalStrip() && !mainOpen && isMainTabListPinActive() ? TAB_LIST_WIDTH_PX : 0

  // Secondary is opposite main. Open → live width; taskbar mode closed with
  // a secondary pin strip → reserve strip so content does not sit under buttons.
  const secOpen = isSecondarySidebarOpen()
  const secDrawerW = secOpen
    ? parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)) || 420
    : 0
  const secStrip =
    !isHorizontalStrip() && !secOpen && isTaskbarModeEnabled() && getSecondaryTabList()
      ? TAB_LIST_WIDTH_PX
      : 0

  // Per side: reserve the pinned strip (if any) plus any open-drawer overhang
  // past the dock inset. The App's padding already reserves the dock width.
  const leftMargin = Math.max(
    mainSide === 'left' ? mainStrip : secStrip,
    mainSide === 'left'
      ? mainOpen
        ? Math.max(0, mainDrawerW - dock.left)
        : 0
      : secOpen
        ? Math.max(0, secDrawerW - dock.left)
        : 0,
  )
  const rightMargin = Math.max(
    mainSide === 'right' ? mainStrip : secStrip,
    mainSide === 'right'
      ? mainOpen
        ? Math.max(0, mainDrawerW - dock.right)
        : 0
      : secOpen
        ? Math.max(0, secDrawerW - dock.right)
        : 0,
  )

  // Sides truth for the chat-owned shadow: the drawer (not the strip) must be
  // open on that side. Secondary is always opposite the main side.
  const mainOnLeft = mainSide === 'left'
  return {
    left: leftMargin,
    right: rightMargin,
    openLeft: (mainOpen && mainOnLeft) || (secOpen && !mainOnLeft),
    openRight: (mainOpen && !mainOnLeft) || (secOpen && mainOnLeft),
  }
}

/**
 * Publish the content lane insets as CSS variables on document.documentElement.
 * These vars are read by the weaver-lane module and any other always-on
 * consumer that needs to position content within the visible lane.
 * Always safe to call (no-op in mobile viewport). Not gated on chatReflow.
 */
export function publishContentLaneInsets(): void {
  const insets = computeContentLaneInsets()
  const root = document.documentElement
  root.style.setProperty(CONTENT_INSET_L_VAR, `${insets.left}px`)
  root.style.setProperty(CONTENT_INSET_R_VAR, `${insets.right}px`)
}

// --- Viewport-cross state (mirrors the pattern in mobile-exclusion.ts) ---
// MatchMedia 'change' fires once per 600px boundary crossing. The
// reflow MutationObserver on the main wrapper only fires on class
// mutations, so a pure resize that crosses the breakpoint (without
// any drawer open/close) would otherwise leave stale desktop vars
// on the chat column.
let _mediaQuery: MediaQueryList | null = null
let _onMediaChange: ((e: MediaQueryListEvent) => void) | null = null

export function scheduleReflow(): void {
  if (_reflowRaf !== null) {
    return
  }
  _reflowRaf = requestAnimationFrame(() => {
    _reflowRaf = null
    updateChatReflow()
  })
}

export function updateChatReflow(): void {
  // Mobile: reflow is a complete no-op. The host CSS controls the
  // chat column layout at ≤600px (the drawer overlays the chat),
  // and writing margins here would shift the column. clearChatMargins
  // is defense in depth: if a stale var exists from a prior desktop
  // state, drop it before returning. Same for the landing margins.
  if (isMobileViewport()) {
    clearChatMargins()
    clearWelcomeReflow()
    publishContentLaneInsets()
    return
  }

  const insets = computeContentLaneInsets()
  // Fresh chat mount (boot restore, SPA navigation): the first margin
  // application must SNAP, not animate — the chat would otherwise slide into
  // place on load. Drop the suppressor after one painted frame (double rAF:
  // the first rAF still runs before the frame's style recalc, so removing it
  // there would let the transition start) and let later margins animate.
  // Chat and Welcome are independent consumers sharing this pass + sheet, so
  // the chat write is gated on its own setting: `welcomeReflow` can keep the
  // sheet injected while `chatReflow` is off (and vice versa).
  if (getSettings().chatReflow) {
    const chat = getChatColumn()
    const instant = !!chat && chat !== _lastReflowedChat
    if (instant && chat) {
      chat.setAttribute(REFLOW_INSTANT_ATTR, '1')
    }
    setChatMargin('right', insets.right)
    setChatMargin('left', insets.left)
    if (instant && chat) {
      _lastReflowedChat = chat
      const dropInstant = () => chat.removeAttribute(REFLOW_INSTANT_ATTR)
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => requestAnimationFrame(dropInstant))
      } else {
        dropInstant()
      }
    }
  } else {
    clearChatMargins()
  }
  applyWelcomeReflow(insets)
  publishContentLaneInsets()
}

/** MatchMedia change handler. On cross-down, drop any stale inline
 *  margin vars. On cross-up, re-run the desktop reflow. */
function _onMediaChangeImpl(e: MediaQueryListEvent): void {
  if (e.matches) {
    // Cross-down into mobile: clear margins + content insets.
    clearChatMargins()
    clearWelcomeReflow()
    publishContentLaneInsets()
  } else {
    // Cross-up to desktop: recompute margins. updateChatReflow
    // reads isMobileViewport() fresh, so this is safe to call
    // unconditionally — the desktop case does real work, the
    // (already-on-desktop) no-op case is idempotent.
    updateChatReflow()
  }
}

export function startReflowObserver(): () => void {
  injectReflowStyles()

  let cancelled = false
  const observer = new MutationObserver(() => {
    scheduleReflow()
  })
  waitForElement(getMainWrapper, 'main wrapper').then((wrapper) => {
    if (wrapper && !cancelled) {
      observer.observe(wrapper, { attributes: true, attributeFilter: ['class', 'style'] })
      updateChatReflow()
    }
  })

  // Also observe the App element for style changes — the dock panel
  // insets (--spindle-dock-{left,right,top,bottom}) are set as inline
  // style on it by Lumiverse's App.tsx. Without this, adding/removing a
  // dock panel wouldn't trigger a chat reflow.
  const appEl = document.querySelector('[data-app-root]') as HTMLElement | null
  if (appEl && !cancelled) {
    observer.observe(appEl, { attributes: true, attributeFilter: ['style'] })
  }

  // Watch for a reflow consumer to appear (SPA navigation adds the chat
  // column or the Landing screen after initial load). The previous
  // waitForElement approach polled for 5 seconds and gave up, so a user who
  // takes >5s to navigate never got a reflow. A MutationObserver on the App
  // element fires immediately on child add/remove, so the reflow runs the
  // moment a consumer enters the DOM. We only schedule when one of them is
  // present (an unrelated route has neither).
  let _chatObserver: MutationObserver | null = null
  const _appElForChat = document.querySelector('[data-app-root]') as HTMLElement | null
  if (_appElForChat && !cancelled) {
    _chatObserver = new MutationObserver(() => {
      if (!cancelled && (getChatColumn() || getLandingPage())) {
        scheduleReflow()
      }
    })
    _chatObserver.observe(_appElForChat, { childList: true, subtree: true })
    if (getChatColumn() || getLandingPage()) {
      scheduleReflow()
    }
  }

  // Tagger observer: bundled with the reflow observer so the v1.4.2 lifecycle
  // (gated on CanvasSettings.chatReflow) is preserved. The tagger is exported
  // as its own startTagObserver() in chat/tag-buttons.ts and can be wired
  // independently when setup() is decomposed.
  const stopTagObserver = startTagObserver()

  // Viewport-cross listener: separate matchMedia instance from the one
  // in mobile-exclusion.ts. Both target the same query, each observes
  // for its own concern. This one re-runs the chat reflow on cross-up
  // and clears stale vars on cross-down. Without this, a drag-resize
  // across 600px leaves stale desktop margins in place.
  _mediaQuery = window.matchMedia('(max-width: 600px)')
  _onMediaChange = _onMediaChangeImpl
  _mediaQuery.addEventListener('change', _onMediaChange)

  return () => {
    cancelled = true
    observer.disconnect()
    _chatObserver?.disconnect()
    _chatObserver = null
    if (_reflowRaf !== null) {
      cancelAnimationFrame(_reflowRaf)
      _reflowRaf = null
    }
    stopTagObserver()
    if (_mediaQuery && _onMediaChange) {
      _mediaQuery.removeEventListener('change', _onMediaChange)
    }
    _mediaQuery = null
    _onMediaChange = null
  }
}
