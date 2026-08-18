// Chat-margin reflow + main-sidebar button tagging.
//
// Two related concerns share a single startReflowObserver lifecycle:
//   1. Chat reflow — watch the main wrapper's class/style mutations and
//      recompute the chat column's --sidebar-ux-chat-ml/mr CSS variables
//      so the chat stays centered in the visible area when the main and/or
//      secondary drawer is open (or pin strips under taskbar mode). Welcome/
//      Landing is NOT a reflow consumer; taskbar mode Welcome bounds live in
//      sidebar/strip-gutter.ts (strip width only, static CSS on LandingPage).
//   2. Main-sidebar button tagging — watch the main sidebar for child-list
//      changes (tab add/replace) and tag each extension tab button with a
//      stable `data-tab-id` attribute. The id-based match is what
//      findMainTabButton relies on; the previous title-match was the bug
//      class v1.3.0 closed.
//
// Both observers are gated on this function being called, which in setup()
// only happens when CanvasSettings.chatReflow is on.
//
// Policy vs taskbar mode (see docs/chat-reflow.md):
//   - taskbarMode OFF → classic host open-drawer widths on chat.
//   - taskbarMode ON → main-mirror open width / closed pin-strip
//     reserve; secondary open width / strip reserve. Strip gutters own
//     Welcome only (do not override chat margins).
//
// On mobile (≤600px) the reflow is a complete no-op — updateChatReflow
// early-returns after clearing any stale inline vars, the injected CSS
// overrides the margin rule at the same breakpoint, and a matchMedia
// change listener drops vars on cross-down and re-runs the reflow on
// cross-up. The listener is registered in startReflowObserver and torn
// down by the returned cleanup, mirroring the secondary drawer's
// viewport-cross pattern in sidebar/mobile-exclusion.ts.
import { getChatColumn, getMainWrapper, getMainDrawerWidth } from '../dom/lumiverse'
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
import { isTaskbarModeEnabled } from '../settings/state'
import { TAB_LIST_WIDTH_PX, MAIN_MIRROR_WIDTH_VAR } from '../sidebar/styles'
import { isMainMirrorActive, isCanvasMainOpen } from '../sidebar/main-mirror-drawer'

export function setChatMargin(side: 'left' | 'right', px: number): void {
  const chat = getChatColumn()
  if (!chat) return
  const varName = side === 'left' ? '--sidebar-ux-chat-ml' : '--sidebar-ux-chat-mr'
  chat.style.setProperty(varName, `${px}px`)
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
    @media (max-width: 600px) {
      [class*="_chatColumn_"] {
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
 * Returns {left, right} in pixels.
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
export function computeContentLaneInsets(): { left: number; right: number } {
  if (isMobileViewport()) {
    return { left: 0, right: 0 }
  }

  const mainSide = getMainDrawerSide()
  const dock = getDockInsets()

  // When Canvas owns main chrome (taskbarMode desktop), reflow follows the
  // Canvas main shell — not host wrapperOpen.
  const mirrorActive = isMainMirrorActive()
  const mainOpen = mirrorActive ? isCanvasMainOpen() : isMainDrawerOpen()
  const mainDrawerW = mainOpen
    ? mirrorActive
      ? parseFloat(document.documentElement.style.getPropertyValue(MAIN_MIRROR_WIDTH_VAR)) || 420
      : getMainDrawerWidth()
    : 0
  // Closed mirror / legacy pin path: the permanent pin strip still occupies
  // the edge (a dock on the same edge is offset just inside it).
  const mainStrip =
    !mainOpen && (mirrorActive || isTaskbarModeEnabled()) ? TAB_LIST_WIDTH_PX : 0

  // Secondary is opposite main. Open → live width; taskbar mode closed with
  // a secondary pin strip → reserve strip so content does not sit under buttons.
  const secOpen = isSecondarySidebarOpen()
  const secDrawerW = secOpen
    ? parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)) || 420
    : 0
  const secStrip =
    !secOpen && isTaskbarModeEnabled() && getSecondaryTabList() ? TAB_LIST_WIDTH_PX : 0

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

  return { left: leftMargin, right: rightMargin }
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
  // state, drop it before returning.
  if (isMobileViewport()) {
    clearChatMargins()
    publishContentLaneInsets()
    return
  }

  const insets = computeContentLaneInsets()
  setChatMargin('right', insets.right)
  setChatMargin('left', insets.left)
  publishContentLaneInsets()
}

/** MatchMedia change handler. On cross-down, drop any stale inline
 *  margin vars. On cross-up, re-run the desktop reflow. */
function _onMediaChangeImpl(e: MediaQueryListEvent): void {
  if (e.matches) {
    // Cross-down into mobile: clear margins + content insets.
    clearChatMargins()
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

  // Watch for the chat column to appear (SPA navigation adds it after
  // initial load). The previous waitForElement approach polled for 5
  // seconds and gave up, so a user who takes >5s to navigate to a chat
  // never got a reflow. A MutationObserver on the App element fires
  // immediately on child add/remove, so the reflow runs the moment the
  // chat column enters the DOM. We only schedule when the chat column
  // is present (Welcome is not a reflow consumer).
  let _chatObserver: MutationObserver | null = null
  const _appElForChat = document.querySelector('[data-app-root]') as HTMLElement | null
  if (_appElForChat && !cancelled) {
    _chatObserver = new MutationObserver(() => {
      if (!cancelled && getChatColumn()) {
        scheduleReflow()
      }
    })
    _chatObserver.observe(_appElForChat, { childList: true, subtree: true })
    if (getChatColumn()) {
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
