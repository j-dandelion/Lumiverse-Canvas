// Chat-margin reflow + main-sidebar button tagging.
//
// Two related concerns share a single startReflowObserver lifecycle:
//   1. Chat reflow — watch the main wrapper's class/style mutations and
//      recompute the chat column's --sidebar-ux-chat-ml/mr CSS variables
//      so the chat stays centered in the visible area when the main and/or
//      secondary drawer is open.
//   2. Main-sidebar button tagging — watch the main sidebar for child-list
//      changes (tab add/replace) and tag each extension tab button with a
//      stable `data-tab-id` attribute. The id-based match is what
//      findMainTabButton relies on; the previous title-match was the bug
//      class v1.3.0 closed.
//
// Both observers are gated on this function being called, which in setup()
// only happens when CanvasSettings.chatReflow is on.
//
// The tagger is currently co-located here. After the v1.4.0 refactor the
// tagger will move to its own chat/tag-buttons.ts module; the function
// bodies are independent — the tagger does not read or write any of the
// reflow state.
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

import { waitForElement } from '../dom/wait-for'
import { isMobileViewport } from '../sidebar/mobile-exclusion'
import { getSettings } from '../settings/state'
import { TAB_LIST_WIDTH_PX } from '../sidebar/styles'

export function setChatMargin(side: 'left' | 'right', px: number): void {
  const chat = getChatColumn()
  if (!chat) return
  const varName = side === 'left' ? '--sidebar-ux-chat-ml' : '--sidebar-ux-chat-mr'
  chat.style.setProperty(varName, `${px}px`)
}

/** Remove the two inline margin vars on the chat column. Centralized
 *  so the on→off path in features/registry.ts and the mobile no-op /
 *  cross-down path in this module share one source of truth. Safe to
 *  call with null. */
export function clearChatMargins(chat: HTMLElement | null): void {
  if (!chat) return
  chat.style.removeProperty('--sidebar-ux-chat-ml')
  chat.style.removeProperty('--sidebar-ux-chat-mr')
}

export function injectReflowStyles(): void {
  injectStyles('sidebar-ux-reflow', `
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
  `)
}

let _reflowRaf: number | null = null

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
    clearChatMargins(getChatColumn())
    return
  }

  const mainSide = getMainDrawerSide()
  const mainOpen = isMainDrawerOpen()
  const mainWidth = mainOpen ? getMainDrawerWidth() : 0

  // Secondary sidebar is on the opposite side. When closed but the tab
  // list is pinned visible, still reserve the strip width so chat does
  // not sit under the fixed tab buttons.
  let secondaryWidth = isSecondarySidebarOpen()
    ? parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)) || 420
    : 0
  if (
    secondaryWidth === 0 &&
    getSettings().keepTabListVisible &&
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

  setChatMargin('right', rightMargin)
  setChatMargin('left', leftMargin)
}

/** MatchMedia change handler. On cross-down, drop any stale inline
 *  margin vars. On cross-up, re-run the desktop reflow. */
function _onMediaChangeImpl(e: MediaQueryListEvent): void {
  if (e.matches) {
    // Cross-down into mobile: clear any stale inline vars from a
    // prior desktop state. The injected mobile CSS rule (see
    // injectReflowStyles) keeps the chat column at margin: 0 on
    // mobile; this ensures we don't leave our own inline vars in
    // place that the host CSS would otherwise re-apply on the
    // next toggle.
    clearChatMargins(getChatColumn())
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
  const observer = new MutationObserver((mutations) => {
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
  // (e.g. clicks drawers first, then a character on the welcome screen)
  // never got a reflow — the margins stayed at whatever values were set
  // on the very first mount, which is often stale by the time the chat
  // actually loads. A MutationObserver on the App element fires
  // immediately on child add/remove, so the reflow runs the moment the
  // chat column enters the DOM, regardless of how long the user took.
  // We also observe the chat column itself for attribute changes (its
  // style is what the reflow mutates — if the host re-renders and resets
  // the margins, we re-apply).
  const _appElForChat = document.querySelector('[data-app-root]') as HTMLElement | null
  if (_appElForChat && !cancelled) {
    const _chatObserver = new MutationObserver(() => {
      const _chat = getChatColumn()
      if (_chat && !cancelled) {
        scheduleReflow()
      }
    })
    _chatObserver.observe(_appElForChat, { childList: true, subtree: true })
    // If the chat column is already in the DOM at observer-mount time
    // (e.g. setup runs after a re-enable), trigger immediately.
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