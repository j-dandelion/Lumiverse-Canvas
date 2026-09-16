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
import { getSettings, isHorizontalStrip, isTaskbarModeEnabled } from '../settings/state'
import { TAB_LIST_WIDTH_PX, MAIN_MIRROR_WIDTH_VAR } from '../sidebar/styles'
import { isMainMirrorActive, isCanvasMainOpen } from '../sidebar/main-mirror-drawer'
import { isMainTabListPinActive } from '../sidebar/main-tab-pin'

/**
 * Root attribute carrying the chat-owned drawer shadow sides ("left",
 * "right", or "left right"). Set by updateChatReflow while a reflow lane is
 * active; the injected CSS suppresses the shells' real (above-chat) shadow
 * and paints an inset shadow on the chat column instead — inset shadows live
 * in the element's background layer, so chat content covers them.
 */
export const CHAT_SHADOW_ATTR = 'data-canvas-chat-shadow'

/**
 * Panel-motion DOM hook (set by `sidebar/animation.ts`): present on a shell
 * wrapper while a Top/Bottom rail bloom runs. Top/Bottom shadow policy: during
 * the bloom the drawer's real box-shadow is what the user sees — it fades and
 * micro-scales in place with the panel (`data-canvas-panel-animating` is the
 * literal mirrored from animation.ts / styles.ts). The chat-owned inset is
 * attached to the chat reflow edge and would ride the margin transition,
 * which reads as the shadow sliding in from the screen edge (live report
 * 2026-09-15, Chrome); it is therefore only painted once the panel settles.
 */
const PANEL_ANIMATING_ATTR = 'data-canvas-panel-animating'

/** Window event fired by animation.ts when the panel-animating state flips
 *  (bloom start / settle). Literal mirror of `CANVAS_PANEL_MOTION_EVENT`
 *  in sidebar/animation.ts (reflow deliberately does not import the motion
 *  module's runtime graph). */
const CANVAS_PANEL_MOTION_EVENT = 'canvas:panel-motion-changed'

/** One-shot chat-column attr that suppresses the margin transition for the
 *  FIRST margin application of a given chat element (boot restore / late chat
 *  mount) so the shadow never rides a load-time margin transition. Exported
 *  for tests. */
export const REFLOW_INSTANT_ATTR = 'data-canvas-reflow-instant'

/** The chat element the margins were last applied to. A different element
 *  means a fresh mount → the first application snaps. */
let _lastReflowedChat: Element | null = null

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
  // The chat-owned drawer shadow only exists while a lane is active.
  root.removeAttribute(CHAT_SHADOW_ATTR)
  // A future re-application (cross-up / re-enable) should snap, not animate
  // from the cleared state.
  _lastReflowedChat = null
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
       navigation into a chat) — an animated first application would carry the
       chat-owned inset from x=0 to the drawer edge, i.e. the shadow "sliding
       in" on refresh / first load (live report 2026-09-15). The attr is set by
       updateChatReflow's first pass for a new chat element and dropped a
       painted frame later (double rAF), so user open/close margins still
       animate. */
    [class*="_chatColumn_"][data-canvas-reflow-instant] {
      transition: none !important;
    }
    /* Top/Bottom: match the 270ms rail bloom (PANEL_OPEN_MS/PANEL_CLOSE_MS) so
       the chat edge arrives exactly when the panel settles. chat/reflow swaps
       the visible shadow then (real bloom-fading box-shadow -> settled
       under-content inset) — with the longer 350ms margin the inset would
       still be ~7% short of the edge at swap time and read as a small slide. */
    html.sidebar-ux-location-top [class*="_chatColumn_"],
    html.sidebar-ux-location-bottom [class*="_chatColumn_"] {
      transition-duration: 0.27s !important;
    }
    /* Open-drawer shadow, chat-owned (2026-09-15). The Canvas shells are
       body-level fixed layers above the whole app subtree (z-index 9990; the
       host .app is isolated), so their real box-shadow paints over chat
       content and can never be z-ordered underneath it. While a reflow lane
       is active the real shadow is suppressed and an inset box-shadow is
       painted on the chat column instead: inset shadows render in the
       element's background layer, BELOW its content, so bubbles/composer
       cover the shadow — underneath on the z axis. The 60px/-60px inset form
       mirrors --lumiverse-shadow-xl (0 20px 60px rgba(0,0,0,.5)) edge
       falloff. The attr is set by updateChatReflow only on desktop,
       drawerShadowsDesktop on, chat column present, drawer open on that side
       (all drawer locations — Top/Bottom keeps the side panel geometry);
       clearChatMargins drops it (mobile / feature off / disable). */
    @media (min-width: 601px) {
      /* Side-aware real-shadow suppression: a drawer whose chat-owned inset is
         active (settled-open, the chat-shadow attr carries its side) must not
         also paint its real box-shadow over chat content. Side-scoped so a
         closing/animating drawer next to a settled one keeps its real
         (bloom-fading) shadow. */
      html[data-canvas-chat-shadow~="left"] .sidebar-ux-shell.sidebar-ux-side-left[data-drawer-open="true"] > .sidebar-ux-drawer {
        box-shadow: none !important;
      }
      html[data-canvas-chat-shadow~="right"] .sidebar-ux-shell.sidebar-ux-side-right[data-drawer-open="true"] > .sidebar-ux-drawer {
        box-shadow: none !important;
      }
      html[data-canvas-chat-shadow~="left"] [class*="_chatColumn_"] {
        box-shadow: inset 60px 0 60px -60px rgba(0, 0, 0, 0.5) !important;
      }
      html[data-canvas-chat-shadow~="right"] [class*="_chatColumn_"] {
        box-shadow: inset -60px 0 60px -60px rgba(0, 0, 0, 0.5) !important;
      }
      html[data-canvas-chat-shadow~="left"][data-canvas-chat-shadow~="right"] [class*="_chatColumn_"] {
        box-shadow: inset 60px 0 60px -60px rgba(0, 0, 0, 0.5),
                    inset -60px 0 60px -60px rgba(0, 0, 0, 0.5) !important;
      }
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

/**
 * Screen sides whose shell wrapper is currently running a panel bloom
 * (`data-canvas-panel-animating`). During the bloom the real drawer shadow is
 * the visible one — it fades/micro-scales in place with the panel — so the
 * chat-owned inset must stay off for that side (it would ride the chat reflow
 * margin and read as a slide from the screen edge).
 */
function collectAnimatingShellSides(): { left: boolean; right: boolean } {
  let left = false
  let right = false
  try {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') {
      return { left, right }
    }
    for (const el of Array.from(document.querySelectorAll('.sidebar-ux-shell'))) {
      if ((el as Element).getAttribute?.(PANEL_ANIMATING_ATTR) == null) continue
      const cl = (el as Element).classList
      if (cl?.contains?.('sidebar-ux-side-left')) left = true
      else if (cl?.contains?.('sidebar-ux-side-right')) right = true
    }
  } catch {
    /* stub DOM */
  }
  return { left, right }
}

/**
 * main-persist's boot/reveal guard classes (mirrored literals — reflow must
 * not import main-persist: that module reaches `sidebar/secondary`, which
 * imports this one). While a guard class is present a shell is hidden or
 * fading via CSS `animation` (NOT the panel bloom), so the chat-owned inset
 * must stay off for that side: the real shadow is inside the shell and fades
 * with it, while the inset is on the chat column and would pop in before the
 * panel (live report 2026-09-15: shadow visible before the panels faded in on
 * refresh/first load). The `<html>` class observer re-runs the reflow when a
 * guard lifts, so the inset appears right after the fade.
 */
const MAIN_REVEAL_GUARD_CLASSES = [
  'sidebar-ux-main-restore-pending', // boot restore guard (shells hidden)
  'sidebar-ux-main-reveal-hold', // mid-session mode-switch hold
  'sidebar-ux-main-reveal-in', // one-shot reveal fade (both shells)
] as const
const SECONDARY_REVEAL_GUARD_CLASSES = [
  'sidebar-ux-secondary-placement-hold', // boot placement gate
  'sidebar-ux-secondary-reveal-in', // late secondary reveal fade
] as const

/** Which sides are currently hidden/fading by a main-persist reveal guard. */
function collectRevealGuardSides(): { main: boolean; secondary: boolean } {
  let main = false
  let secondary = false
  try {
    const cl = typeof document !== 'undefined' ? document.documentElement?.classList : null
    if (cl?.contains) {
      main = MAIN_REVEAL_GUARD_CLASSES.some((c) => cl.contains(c))
      secondary = main || SECONDARY_REVEAL_GUARD_CLASSES.some((c) => cl.contains(c))
    }
  } catch {
    /* stub DOM */
  }
  return { main, secondary }
}

/**
 * Publish the chat-owned drawer-shadow sides (see CHAT_SHADOW_ATTR + the
 * injected CSS). Requires: desktop (caller guarantees), drawerShadowsDesktop
 * on, a chat column present, and a drawer actually open on that side **and
 * settled** (no rail bloom or reveal guard in flight). Top/Bottom blooms keep
 * the drawer's real box-shadow — it fades in place with the panel — and only
 * swap to the under-content inset once the panel is settled; the inset is
 * attached to the chat edge and would otherwise slide in from the screen edge
 * (live report 2026-09-15). Sides has no such swap: its wrapper translate and
 * the chat margin are synced, so the inset riding the edge is the intended
 * motion.
 *
 * Drawer location is deliberately NOT a gate for the geometry: Top/Bottom
 * only moves the tab strip to the top/bottom edge — the panel itself stays a
 * left/right column (S8: panels keep the side geometry), so the open-drawer
 * overhang margin and the shadow lane are still horizontal there. Gating the
 * shadow on Sides was the 2026-09-15 "#2 didn't work" live report (Bottom
 * location).
 */
function syncChatShadowAttr(insets: { openLeft: boolean; openRight: boolean }): void {
  const root = document.documentElement
  const sides: string[] = []
  if (getChatColumn() && getSettings().drawerShadowsDesktop) {
    const animating = isHorizontalStrip()
      ? collectAnimatingShellSides()
      : { left: false, right: false }
    const guard = collectRevealGuardSides()
    const mainSide = getMainDrawerSide()
    const guarded = (side: 'left' | 'right'): boolean =>
      side === mainSide ? guard.main : guard.secondary
    if (insets.openLeft && !animating.left && !guarded('left')) sides.push('left')
    if (insets.openRight && !animating.right && !guarded('right')) sides.push('right')
  }
  if (sides.length > 0) root.setAttribute(CHAT_SHADOW_ATTR, sides.join(' '))
  else root.removeAttribute(CHAT_SHADOW_ATTR)
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
  // Fresh chat mount (boot restore, SPA navigation): the first margin
  // application must SNAP. Applying it with the transition would carry the
  // chat-owned inset from the screen edge to the drawer edge — the shadow
  // "sliding in" on refresh / first load (live report 2026-09-15). Drop the
  // suppressor after one painted frame (double rAF: the first rAF still runs
  // before the frame's style recalc, so removing it there would let the
  // transition start) and let later margins animate.
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
  syncChatShadowAttr(insets)
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
  // Panel-motion edges (bloom start / settle): re-render the shadow attr so
  // the Top/Bottom bloom uses the real drawer shadow and the settled state
  // swaps to the chat-owned inset.
  const onPanelMotionChange = () => scheduleReflow()
  if (typeof window !== 'undefined') {
    window.addEventListener(CANVAS_PANEL_MOTION_EVENT, onPanelMotionChange)
  }
  const observer = new MutationObserver(() => {
    scheduleReflow()
  })
  // main-persist's reveal guards flip on <html> (boot restore guard, mid-session
  // reveal hold/fade, secondary placement gate). Those phases hide/fade the
  // shells via CSS animation, not the panel bloom, so the shadow attr must be
  // recomputed when they lift.
  const rootObserver = new MutationObserver(() => {
    scheduleReflow()
  })
  if (typeof document !== 'undefined' && document.documentElement && !cancelled) {
    rootObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
  }
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
    rootObserver.disconnect()
    if (typeof window !== 'undefined') {
      window.removeEventListener(CANVAS_PANEL_MOTION_EVENT, onPanelMotionChange)
    }
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
