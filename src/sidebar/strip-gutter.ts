// Taskbar-mode strip gutters — permanent Welcome/Landing bounds between pin strips.
//
// When taskbarMode is on (desktop), Welcome/Landing is inset by pin-strip
// width only (TAB_LIST_WIDTH_PX). Open drawers overlay Welcome; they do not
// expand Landing page bounds. Chat column margins are owned by chat reflow
// (open-drawer + closed-strip reserve under taskbar mode) — see chat/reflow.ts.
//
// Consumers use static CSS (no transition) on LandingPage only.

import { injectStyles } from '../debug/styles'
import { getMainDrawerSide } from '../store'
import { isTaskbarModeEnabled } from '../settings/state'
import { hasSecondaryAssignedTabs } from '../tabs/assignment'
import { isMobileViewport } from './mobile-exclusion'
import { TAB_LIST_WIDTH_PX } from './styles'
import { updateDockOffsets } from './dock-offset'

/** html class while strip gutters are active. */
export const STRIP_GUTTER_CLASS = 'sidebar-ux-strip-gutters'

export const STRIP_L_VAR = '--sidebar-ux-strip-l'
export const STRIP_R_VAR = '--sidebar-ux-strip-r'

const STYLE_ID = 'sidebar-ux-strip-gutter'

let _dockObserver: MutationObserver | null = null
let _mediaQuery: MediaQueryList | null = null
let _onMediaChange: ((e: MediaQueryListEvent) => void) | null = null

export function injectStripGutterStyles(): void {
  injectStyles(
    STYLE_ID,
    `
    /* Static taskbar-mode chrome for Welcome only — no transition.
       Chat column is owned by chat reflow (higher-churn open/close margins). */
    html.${STRIP_GUTTER_CLASS} [data-component="LandingPage"] {
      margin-left: var(${STRIP_L_VAR}, 0px) !important;
      margin-right: var(${STRIP_R_VAR}, 0px) !important;
    }
    @media (max-width: 600px) {
      html.${STRIP_GUTTER_CLASS} [data-component="LandingPage"] {
        margin-left: 0 !important;
        margin-right: 0 !important;
      }
    }
  `,
  )
}

function stopStripGutterObservers(): void {
  if (_dockObserver) {
    _dockObserver.disconnect()
    _dockObserver = null
  }
  if (_mediaQuery && _onMediaChange) {
    _mediaQuery.removeEventListener('change', _onMediaChange)
  }
  _mediaQuery = null
  _onMediaChange = null
}

/** Clear class + CSS vars only (keeps dock/media observers for cross-up). */
function clearStripGutterVars(): void {
  const root = document.documentElement
  root.classList.remove(STRIP_GUTTER_CLASS)
  root.style.removeProperty(STRIP_L_VAR)
  root.style.removeProperty(STRIP_R_VAR)
}

function ensureStripGutterObservers(): void {
  if (!_dockObserver) {
    const appEl = document.querySelector('[data-app-root]') as HTMLElement | null
    if (appEl) {
      _dockObserver = new MutationObserver(() => {
        updateStripGutters()
        // Dock expand/collapse/resize/add/remove changes the edge inset and
        // the dock's node geometry → re-apply the dock's strip offset.
        updateDockOffsets()
      })
      _dockObserver.observe(appEl, { attributes: true, attributeFilter: ['style'] })
    }
  }
  if (!_mediaQuery) {
    _mediaQuery = window.matchMedia('(max-width: 600px)')
    _onMediaChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        // Cross-down: drop visual gutters but keep this listener so
        // cross-up can re-apply.
        clearStripGutterVars()
      } else {
        updateStripGutters()
      }
    }
    _mediaQuery.addEventListener('change', _onMediaChange)
  }
}

/** Compute left/right strip gutters (for tests + apply).
 *  The dock panel on a strip's edge is offset to sit just inside the strip
 *  (dock-offset.ts), so the gutter is the strip width — the App's own padding
 *  already reserves the dock inset. */
export function computeStripGutters(): { left: number; right: number } {
  const mainSide = getMainDrawerSide()
  const mainBase = TAB_LIST_WIDTH_PX
  // List node always exists once secondary is mounted; only reserve when tabs exist.
  const secondaryBase = hasSecondaryAssignedTabs() ? TAB_LIST_WIDTH_PX : 0

  let leftBase = 0
  let rightBase = 0
  if (mainSide === 'left') {
    leftBase = mainBase
    rightBase = secondaryBase
  } else {
    rightBase = mainBase
    leftBase = secondaryBase
  }

  return { left: leftBase, right: rightBase }
}

/** Full clear: vars + class + observers (taskbar mode off / feature teardown). */
export function clearStripGutters(): void {
  clearStripGutterVars()
  stopStripGutterObservers()
}

/**
 * Apply or clear strip gutters from current taskbar + side + secondary
 * presence. Does not read open-drawer widths.
 */
export function updateStripGutters(): void {
  if (isMobileViewport()) {
    clearStripGutterVars()
    return
  }
  if (!isTaskbarModeEnabled()) {
    clearStripGutters()
    return
  }

  injectStripGutterStyles()
  ensureStripGutterObservers()

  const { left, right } = computeStripGutters()
  const root = document.documentElement
  root.classList.add(STRIP_GUTTER_CLASS)
  root.style.setProperty(STRIP_L_VAR, `${left}px`)
  root.style.setProperty(STRIP_R_VAR, `${right}px`)
  // Re-apply the dock's strip offset whenever taskbar gutters are recomputed
  // (taskbar enable, side change, secondary presence change).
  updateDockOffsets()
}
