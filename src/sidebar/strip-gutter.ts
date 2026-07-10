// Keep-tabs strip gutters — permanent page bounds between pin strips.
//
// When keepTabListVisible is on (desktop), content (chat + Welcome) is inset
// by pin-strip width only (TAB_LIST_WIDTH_PX). Open drawers overlay that area;
// they do not expand page bounds. This is stable CSS chrome owned by keep-tabs,
// not chat reflow (no open/close rAF margin dance for Welcome).
//
// Consumers use static CSS (no transition). Prefer a single host shell when a
// safe common parent exists; until then dual leaf selectors match chat column
// and LandingPage so both routes share the same strip bounds.

import { injectStyles } from '../debug/styles'
import { getMainDrawerSide } from '../store'
import { isKeepTabListVisibleEnabled } from '../settings/state'
import { isMobileViewport } from './mobile-exclusion'
import { getSecondaryTabList } from './secondary'
import { TAB_LIST_WIDTH_PX } from './styles'

/** html class while strip gutters are active. */
export const STRIP_GUTTER_CLASS = 'sidebar-ux-strip-gutters'

export const STRIP_L_VAR = '--sidebar-ux-strip-l'
export const STRIP_R_VAR = '--sidebar-ux-strip-r'

const STYLE_ID = 'sidebar-ux-strip-gutter'

let _dockObserver: MutationObserver | null = null
let _mediaQuery: MediaQueryList | null = null
let _onMediaChange: ((e: MediaQueryListEvent) => void) | null = null

/** Read Spindle dock insets from the App element (same model as chat reflow). */
function getDockInsets(): { left: number; right: number } {
  const appEl = document.querySelector('[data-app-root]') as HTMLElement | null
  if (!appEl) return { left: 0, right: 0 }
  const left = parseFloat(appEl.style.getPropertyValue('--spindle-dock-left')) || 0
  const right = parseFloat(appEl.style.getPropertyValue('--spindle-dock-right')) || 0
  return { left, right }
}

export function injectStripGutterStyles(): void {
  injectStyles(
    STYLE_ID,
    `
    /* Static keep-tabs chrome — no transition (not chat reflow). */
    html.${STRIP_GUTTER_CLASS} [class*="_chatColumn_"],
    html.${STRIP_GUTTER_CLASS} [data-component="LandingPage"] {
      margin-left: var(${STRIP_L_VAR}, 0px) !important;
      margin-right: var(${STRIP_R_VAR}, 0px) !important;
    }
    @media (max-width: 600px) {
      html.${STRIP_GUTTER_CLASS} [class*="_chatColumn_"],
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

/** Compute left/right strip extras after dock overlap (for tests + apply). */
export function computeStripGutters(): { left: number; right: number } {
  const mainSide = getMainDrawerSide()
  const mainBase = TAB_LIST_WIDTH_PX
  const secondaryBase = getSecondaryTabList() ? TAB_LIST_WIDTH_PX : 0

  let leftBase = 0
  let rightBase = 0
  if (mainSide === 'left') {
    leftBase = mainBase
    rightBase = secondaryBase
  } else {
    rightBase = mainBase
    leftBase = secondaryBase
  }

  const dock = getDockInsets()
  return {
    left: Math.max(0, leftBase - dock.left),
    right: Math.max(0, rightBase - dock.right),
  }
}

/** Full clear: vars + class + observers (keep-tabs off / feature teardown). */
export function clearStripGutters(): void {
  clearStripGutterVars()
  stopStripGutterObservers()
}

/**
 * Apply or clear strip gutters from current keep-tabs + side + secondary
 * presence. Does not read open-drawer widths.
 */
export function updateStripGutters(): void {
  if (isMobileViewport()) {
    clearStripGutterVars()
    return
  }
  if (!isKeepTabListVisibleEnabled()) {
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
}
