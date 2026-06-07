// Mobile exclusion logic for the secondary sidebar.
//
// On mobile (≤600px viewport) only one sidebar can be open at a time.
// This module handles:
//   - Viewport-based mobile detection (distinct from pointer-based isMobile())
//   - Mutual exclusion: opening one sidebar silently closes the other
//   - Body-level CSS classes that hide the inactive sidebar's drawerTab
//   - Viewport-cross detection: when the user resizes across the 600px boundary
//
// CSS rules in secondary.tsx use these body classes:
//   body.canvas-ux-mobile-primary-open  → hides secondary's drawerTab
//   body.canvas-ux-mobile-secondary-open → hides main's drawerTab

import { getMainWrapper } from '../dom/lumiverse'
import { getMainDrawerSide } from '../store'
import { findDrawerToggleButton } from './main-persist'
import { isSecondarySidebarOpen, closeSecondarySidebar, getSecondaryWrapper, getClosedTransformPx, SECONDARY_WIDTH_VAR } from './secondary'

// Saved desktop value of --sidebar-ux-secondary-w.  On mobile, the CSS
// variable is overwritten with `window.innerWidth` so the close-transform
// matches the 100vw drawer.  Without save/restore, crossing back to
// desktop reads the mobile value, sets the drawer's inline width to it,
// and the stale wrapper translateX no longer matches → 30-60px peek.
let _desktopCssVarValue: number | null = null

/**
 * Sync --sidebar-ux-secondary-w to match the drawer's actual rendered width.
 *
 * On mobile the drawer is forced to 100vw (inline !important, which beats
 * stylesheet !important), but getClosedTransformPx() reads the CSS variable
 * to compute the close offset.  If the variable still holds the
 * desktop-saved width (e.g. 249px), the transform is 249px while the
 * drawer is 360px → 111px "peek" on the right.
 *
 * Fix: overwrite the variable on mobile so both values agree.
 * On desktop, restore the saved value so the persisted width takes effect
 * again (clearing the override would leave the drawer's inline width
 * pointing at a removed variable → fallback 420px instead of the actual
 * saved width).
 */
function syncCssVarToDrawerWidth(): void {
  const el = document.documentElement
  if (isMobileViewport()) {
    // Save the current value before overwriting — it holds the desktop width.
    const current = parseFloat(el.style.getPropertyValue(SECONDARY_WIDTH_VAR))
    if (isFinite(current) && _desktopCssVarValue === null) {
      _desktopCssVarValue = current
    }
    el.style.setProperty(SECONDARY_WIDTH_VAR, `${window.innerWidth}px`)
  } else {
    // Desktop: restore the saved value so the drawer width and close
    // transform stay in sync.  If nothing was saved (e.g. extension
    // mounted directly on desktop), fall back to clearing the override.
    if (_desktopCssVarValue !== null) {
      el.style.setProperty(SECONDARY_WIDTH_VAR, `${_desktopCssVarValue}px`)
      _desktopCssVarValue = null
    } else {
      el.style.removeProperty(SECONDARY_WIDTH_VAR)
    }
  }
}

/** Viewport-based mobile detection — ≤600px width. Distinct from the
 *  pointer-based isMobile() in resize/handles.ts (which uses
 *  matchMedia('(pointer: coarse)') and is correct for resize-handle
 *  suppression, not layout decisions). */
export function isMobileViewport(): boolean {
  return window.matchMedia('(max-width: 600px)').matches
}

// Body-class constants
const BODY_CLASS_PRIMARY = 'canvas-ux-mobile-primary-open'
const BODY_CLASS_SECONDARY = 'canvas-ux-mobile-secondary-open'

/** Toggle a body class reflecting which sidebar is open on mobile.
 *  Called from open/close paths in secondary.tsx and from the
 *  classObserver hook in main-persist.ts. */
export function setMobileOpenClass(which: 'primary' | 'secondary', open: boolean): void {
  if (!isMobileViewport()) {
    // On desktop, always clear both classes so desktop CSS isn't affected
    document.body.classList.remove(BODY_CLASS_PRIMARY, BODY_CLASS_SECONDARY)
    return
  }
  if (open) {
    document.body.classList.add(which === 'primary' ? BODY_CLASS_PRIMARY : BODY_CLASS_SECONDARY)
  } else {
    document.body.classList.remove(which === 'primary' ? BODY_CLASS_PRIMARY : BODY_CLASS_SECONDARY)
  }
}

/** Close the main drawer (host-owned) by clicking its toggle button.
 *  Scoped to the host's main wrapper via getMainWrapper() — never a
 *  global query that could accidentally match the secondary wrapper. */
function _closeMainDrawer(): void {
  const wrapper = getMainWrapper()
  if (!wrapper) return
  // Don't toggle the main drawer if it's already closed — on hard-refresh
  // at mobile the main may have been initialized closed, and clicking the
  // toggle would reopen it instead of closing it.
  if (!wrapper.classList.toString().includes('wrapperOpen')) return
  const btn = findDrawerToggleButton(wrapper)
  if (btn) {
    try { btn.click() } catch { /* swallow */ }
  }
}

/** When a sidebar opens on mobile, close the other one. If the other
 *  is the secondary sidebar, use silent close so the desktop-saved
 *  `secondary.open = true` survives in layout.json. */
export function enforceExclusionOnOpen(which: 'primary' | 'secondary'): void {
  if (!isMobileViewport()) return
  if (which === 'secondary') {
    // Close the main drawer
    _closeMainDrawer()
  } else {
    // Before closing the secondary, sync the CSS variable to the
    // drawer's actual mobile width so the close transform is correct.
    syncCssVarToDrawerWidth()
    // Close the secondary sidebar silently (skip persistOpenState)
    if (isSecondarySidebarOpen()) {
      closeSecondarySidebar({ silent: true })
    }
  }
}

// --- Viewport-cross handler ---

let _mediaQuery: MediaQueryList | null = null
let _onMediaChange: ((e: MediaQueryListEvent) => void) | null = null

/** Register the matchMedia listener for viewport-cross detection.
 *  Returns a cleanup function that removes listeners and the
 *  injected <style> element. */
export function startMobileExclusion(): () => void {
  _mediaQuery = window.matchMedia('(max-width: 600px)')

  /** Update the secondary drawer's inline width based on viewport.
  *  On mobile, force 100vw (CSS can't override inline !important).
  *  On desktop, restore the CSS-variable-based width so the drawer
  *  matches the persisted value (syncCssVarToDrawerWidth restores the
  *  saved desktop var, so var(--sidebar-ux-secondary-w) resolves correctly).
  *  Also syncs --sidebar-ux-secondary-w so getClosedTransformPx() matches,
  *  and updates the wrapper's translateX to match the new CSS var so the
  *  closed transform stays in sync with the drawer's actual width. */
  function _updateDrawerWidth(): void {
   const wrapper = getSecondaryWrapper()
   const drawer = wrapper?.querySelector('.sidebar-ux-drawer') as HTMLElement | null
   if (!drawer) return
   if (isMobileViewport()) {
     drawer.style.width = '100vw'
   } else {
     // Restore the CSS-variable-based width.  syncCssVarToDrawerWidth()
     // (called below) restores the saved desktop value to the CSS var,
     // so this resolves to the correct persisted width — not the mobile
     // viewport width that was stored there during the mobile phase.
     drawer.style.width = `var(${SECONDARY_WIDTH_VAR}, 420px)`
   }
   // Keep the CSS variable in sync with the actual drawer width
   syncCssVarToDrawerWidth()
   // Sync the wrapper's translateX to match the updated CSS var.
   // Without this, a viewport cross changes the CSS var (e.g. 420px →
   // 480px on mobile) but the wrapper transform stays at the old value,
   // leaving a visible peek when the sidebar is closed.
   const closedPx = getClosedTransformPx()
   wrapper.style.transform = isSecondarySidebarOpen()
     ? 'translateX(0)'
     : `translateX(${closedPx}px)`
  }

  _onMediaChange = (e: MediaQueryListEvent) => {
    if (e.matches) {
      // Cross-down into mobile: if both sidebars are open, close secondary silently
       _updateDrawerWidth()
      if (isSecondarySidebarOpen()) {
        closeSecondarySidebar({ silent: true })
        setMobileOpenClass('secondary', false)
      }
      // Update primary class from DOM state
      const wrapper = getMainWrapper()
      if (wrapper) {
        const isOpen = wrapper.classList.toString().includes('wrapperOpen')
        setMobileOpenClass('primary', isOpen)
      }
    } else {
      // Cross-up to desktop: clear both body classes, don't auto-reopen
      _updateDrawerWidth()
      document.body.classList.remove(BODY_CLASS_PRIMARY, BODY_CLASS_SECONDARY)
    }
  }
  _mediaQuery.addEventListener('change', _onMediaChange)

  // One-shot reconciliation on mount: sync drawer width and CSS variable
  // to match the viewport. On mobile, this overwrites the CSS var (which
  // still holds the desktop-saved value from createSecondarySidebar) with
  // window.innerWidth so getClosedTransformPx() matches the 100vw drawer —
  // preventing the 60-100px peek on hard-refresh at mobile.
  if (isMobileViewport()) {
    _updateDrawerWidth()
  }
  // One-shot reconciliation on mount: if both are open at init time,
  // close secondary silently.
  if (isMobileViewport() && isSecondarySidebarOpen()) {
    closeSecondarySidebar({ silent: true })
    setMobileOpenClass('secondary', false)
  }
  // Seed primary body class if main is open
  const wrapper = getMainWrapper()
  if (wrapper) {
    const isOpen = wrapper.classList.toString().includes('wrapperOpen')
    setMobileOpenClass('primary', isOpen)
  }

  return () => {
    // Remove matchMedia listener
    if (_mediaQuery && _onMediaChange) {
      _mediaQuery.removeEventListener('change', _onMediaChange)
    }
    _mediaQuery = null
    _onMediaChange = null
    // Remove injected <style> element (injected by injectStyles in secondary.tsx)
    document.getElementById('canvas-ux-secondary-mobile')?.remove()
    // Clear body classes
    document.body.classList.remove(BODY_CLASS_PRIMARY, BODY_CLASS_SECONDARY)
  }
}
