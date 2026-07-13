// Chat-margin reflow + main-sidebar button tagging.
//
// Two related concerns share a single startReflowObserver lifecycle:
//   1. Chat reflow — watch the main wrapper's class/style mutations and
//      recompute the chat column's --sidebar-ux-chat-ml/mr CSS variables
//      so the chat stays centered in the visible area when the main and/or
//      secondary drawer is open (or pin strips under keep-tabs). Welcome/
//      Landing is NOT a reflow consumer; keep-tabs Welcome bounds live in
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
// Policy vs keep-tabs (see docs/chat-reflow.md):
//   - keepTabListVisible OFF → classic host open-drawer widths on chat.
//   - keepTabListVisible ON → main-mirror open width / closed pin-strip
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

// CSS variable names for content lane insets (published on documentElement).
export const CONTENT_INSET_L_VAR = '--sidebar-ux-content-inset-l'
export const CONTENT_INSET_R_VAR = '--sidebar-ux-content-inset-r'

import { waitForElement } from '../dom/wait-for'
import { isMobileViewport } from '../sidebar/mobile-exclusion'
import { isKeepTabListVisibleEnabled } from '../settings/state'
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
 */
export function computeContentLaneInsets(): { left: number; right: number } {
  if (isMobileViewport()) {
    return { left: 0, right: 0 }
  }

  const mainSide = getMainDrawerSide()
  // When Canvas owns main chrome (keepTabListVisible desktop), reflow
  // follows the Canvas main shell — not host wrapperOpen.
  let mainWidth: number
  if (isMainMirrorActive()) {
    if (isCanvasMainOpen()) {
      mainWidth =
        parseFloat(document.documentElement.style.getPropertyValue(MAIN_MIRROR_WIDTH_VAR)) ||
        420
    } else {
      // Closed mirror: permanent pin strip still occupies the edge.
      mainWidth = TAB_LIST_WIDTH_PX
    }
  } else {
    const mainOpen = isMainDrawerOpen()
    mainWidth = mainOpen ? getMainDrawerWidth() : 0
    // Legacy pin path: closed host drawer but strip still visible.
    if (mainWidth === 0 && isKeepTabListVisibleEnabled()) {
      mainWidth = TAB_LIST_WIDTH_PX
    }
  }

  // Secondary is opposite main. Open → live width; keep-tabs closed with
  // a secondary pin strip → reserve strip so content does not sit under buttons.
  let secondaryWidth = isSecondarySidebarOpen()
    ? parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)) || 420
    : 0
  if (
    secondaryWidth === 0 &&
    isKeepTabListVisibleEnabled() &&
    getSecondaryTabList()
  ) {
    secondaryWidth = TAB_LIST_WIDTH_PX
  }

  // Account for the LumiScript dock panel widths. The dock panel and the
  // drawer on the same side OVERLAP (both at `right: 0` / `left: 0` with
  // `position: fixed`; the drawer has higher z-index). The App's padding
  // already pushes the chat by the dock panel's width, so we subtract it
  // from the drawer's width to avoid double-counting. If the dock panel
  // is wider than the drawer, the result is clamped to 0.
  const dockInsets = getDockInsets()
  let rightMargin: number
  let leftMargin: number
  if (mainSide === 'left') {
    rightMargin = secondaryWidth
    leftMargin = mainWidth
  } else {
    rightMargin = mainWidth
    leftMargin = secondaryWidth
  }
  rightMargin = Math.max(0, rightMargin - dockInsets.right)
  leftMargin = Math.max(0, leftMargin - dockInsets.left)

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

/** Read the LumiScript (Spindle) dock panel widths from the App's inline
 *  CSS variables. These are set by Lumiverse's App.tsx based on
 *  `dockInsets` (the max dock panel width per edge). Returns 0 for any
 *  side where the App element isn't found or the variable isn't set. */
function getDockInsets(): { left: number; right: number } {
  const appEl = document.querySelector('[data-app-root]') as HTMLElement | null
  if (!appEl) return { left: 0, right: 0 }
  const left = parseFloat(appEl.style.getPropertyValue('--spindle-dock-left')) || 0
  const right = parseFloat(appEl.style.getPropertyValue('--spindle-dock-right')) || 0
  return { left, right }
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
