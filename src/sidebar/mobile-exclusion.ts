// Mobile exclusion logic for the secondary sidebar.
//
// On mobile (≤600px viewport) only one sidebar can be open at a time.
// This module handles:
//   - Viewport-based mobile detection (distinct from pointer-based isPointerResizeActive())
//   - Mutual exclusion: opening one sidebar silently closes the other
//   - Body-level CSS classes that hide the inactive sidebar's drawerTab
//   - Viewport-cross detection: when the user resizes across the 600px boundary
//
// CSS rules in secondary.tsx use these body classes:
//   body.canvas-ux-mobile-primary-open  → hides secondary's drawerTab
//   body.canvas-ux-mobile-secondary-open → hides main's drawerTab

import { getMainWrapper, getMainDrawer } from '../dom/lumiverse'
import { getMainDrawerSide } from '../store'
import { dlog } from '../debug/log'
import { findDrawerToggleButton } from './main-persist'
import { isSecondarySidebarOpen, closeSecondarySidebar, getSecondaryWrapper, getSecondaryDrawer, getClosedTransformPx, SECONDARY_WIDTH_VAR } from './secondary'
import { cancelWrapperAnimation } from './animation'

// Saved desktop value of --sidebar-ux-secondary-w.  On mobile, the CSS
// variable is overwritten to match the (scaled) viewport width so the
// close-transform matches the full-viewport drawer width.  Without
// save/restore, crossing back to desktop reads the mobile value, sets the
// drawer's inline width to it, and the stale wrapper translateX no longer
// matches → 30-60px peek.
let _desktopCssVarValue: number | null = null

// Resize coalescing + diagnostics — see startMobileExclusion()
let _resizeRafId: number | null = null
let _lastDiagLog = 0

/**
 * Sync --sidebar-ux-secondary-w to match the drawer's actual rendered width.
 *
 * On mobile the drawer is forced to a host-aligned viewport width via CSS
 * (var(--app-scaled-viewport-width, ...)), but getClosedTransformPx() reads
 * the CSS variable to compute the close offset.  If the variable still holds
 * the desktop-saved width (e.g. 249px), the transform is 249px while the
 * drawer is 360px → 111px "peek" on the right.
 *
 * Fix: measure the rendered drawer and overwrite the variable on mobile so
 * both values agree.  On desktop, restore the saved value so the persisted
 * width takes effect again.
 */
function syncCssVarToDrawerWidth(): void {
  const el = document.documentElement
  if (isMobileViewport()) {
    // Save the current value before overwriting — it holds the desktop width.
    const current = parseFloat(el.style.getPropertyValue(SECONDARY_WIDTH_VAR))
    if (isFinite(current) && _desktopCssVarValue === null) {
      _desktopCssVarValue = current
    }
    // Prefer measured offsetWidth (reflects the actual rendered size after
    // CSS host-aligned width resolves).  Fall back to un-scaled innerWidth
    // if the drawer isn't mounted yet.
    const drawer = getSecondaryDrawer()
    const measured = drawer?.offsetWidth ?? 0
    if (measured > 0) {
      el.style.setProperty(SECONDARY_WIDTH_VAR, `${measured}px`)
    } else {
      const uiScale = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--lumiverse-ui-scale')
      ) || 1
      el.style.setProperty(SECONDARY_WIDTH_VAR, `${Math.round(window.innerWidth / uiScale)}px`)
    }
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
 *  pointer-based isPointerResizeActive() in resize/handles.ts (which uses
 *  matchMedia('(pointer: coarse)') and is correct for resize-handle
 *  suppression, not layout decisions). */
export function isMobileViewport(): boolean {
  return window.matchMedia('(max-width: 600px)').matches
}

/**
 * True when the host would treat the viewport as "mobile" for drawer
 * layout. Matches Lumiverse's useIsMobile hook: coarse pointer OR ≤600px.
 *
 * Used ONLY for host main drawer full-width forcing — NOT for
 * layout/exclusion decisions (which use isMobileViewport()). This is
 * deliberately separate so main-mirror, secondary layout, and other
 * call sites that depend on the strict ≤600px check stay unchanged.
 */
export function isHostMobileDrawerViewport(): boolean {
  if (isMobileViewport()) return true
  return window.matchMedia('(pointer: coarse)').matches
}

/**
 * Sync the host main drawer width for mobile awareness.
 *
 * On ≤600px: remove any inline width / --drawer-panel-w !important that
 *   restoreMainDrawerFromDom may have stamped, so the host mobile CSS
 *   (and Canvas SECONDARY_MOBILE_CSS +1px override) can enforce
 *   full-viewport width.
 *
 * On larger mobile (coarse pointer, >600px, e.g. tablet landscape): the
 *   host treats the viewport as mobile (backdrop, etc.) but its media
 *   query does not force full-width. Set --drawer-panel-w to the scaled
 *   full-viewport +1px expression (same oversize used by secondary).
 *
 * On fine-pointer desktop: clear any full-bleed override we set, so the
 *   saved restored width takes effect.
 *
 * Safe to call repeatedly; designed for viewport-cross, resize, and
 * one-shot init reconciliation.
 */
export function syncHostMainDrawerToMobileWidth(): void {
  const wrapper = getMainWrapper()
  const drawer = getMainDrawer()
  if (!wrapper || !drawer) return

  if (isMobileViewport()) {
    // ≤600px: host CSS + Canvas SECONDARY_MOBILE_CSS already force
    // full-bleed. Our restore inline width must not override that.
    drawer.style.removeProperty('width')
    wrapper.style.removeProperty('--drawer-panel-w')
  } else if (window.matchMedia('(pointer: coarse)').matches) {
    // Larger touch mobile (e.g. tablet landscape >600px): force
    // full-viewport width via the host-aligned scaled viewport
    // expression (same +1px oversize used by secondary).
    const fullWidth = 'calc(var(--app-scaled-viewport-width, calc(100vw / var(--lumiverse-ui-scale, 1))) + 1px)'
    drawer.style.removeProperty('width')
    wrapper.style.setProperty('--drawer-panel-w', fullWidth, 'important')
  } else {
    // Fine-pointer desktop: clear any full-bleed override we might
    // have set during a larger-mobile phase. Value-sniff: only remove
    // if the current inline --drawer-panel-w is our calc() expression.
    // This must NOT wipe a legitimate px width set by
    // restoreMainDrawerFromDom or resize handles (e.g. "420px").
    const current = wrapper.style.getPropertyValue('--drawer-panel-w')
    if (current && current.includes('app-scaled-viewport-width')) {
      wrapper.style.removeProperty('--drawer-panel-w')
    }
  }
}

const DIAG_THROTTLE_MS = 500

function _logDiag(event: string): void {
  const now = Date.now()
  if (now - _lastDiagLog < DIAG_THROTTLE_MS) return
  _lastDiagLog = now
  dlog(
    `mobile-exclusion ${event} | innerWidth=${window.innerWidth} ` +
    `isMobile=${isMobileViewport()} ` +
    `sidebarOpen=${isSecondarySidebarOpen()} ` +
    `cssVar=${document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)} ` +
    `transform=${getSecondaryWrapper()?.style.transform ?? 'null'}`
  )
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
   *  On mobile, force the host-aligned scaled viewport width via CSS var
   *  (not raw window.innerWidth px — the host zooms Canvas shells appended
   *  to body, so innerWidth is already in device-px and must be un-scaled).
   *  On desktop, restore the CSS-variable-based width so the drawer matches
   *  the persisted value.  Also syncs --sidebar-ux-secondary-w so
   *  getClosedTransformPx() matches, and updates the wrapper's translateX
   *  to match the new CSS var so the closed transform stays in sync with
   *  the drawer's actual width. */
  function _updateDrawerWidth(): void {
   // Stop any in-flight rAF so it can't overwrite the transform we're about to set
   cancelWrapperAnimation()
   const wrapper = getSecondaryWrapper()
   const drawer = wrapper?.querySelector('.sidebar-ux-drawer') as HTMLElement | null
   if (!drawer) return
   if (isMobileViewport()) {
     // Host-aligned scaled viewport width — matches Lumiverse's own
     // ViewportDrawer mobile width.  NOT raw window.innerWidth px,
     // because the host applies zoom to body children.
     drawer.style.width = 'calc(var(--app-scaled-viewport-width, calc(100vw / var(--lumiverse-ui-scale, 1))) + 1px)'
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
    if (wrapper) {
      const closedPx = getClosedTransformPx()
      wrapper.style.transform = isSecondarySidebarOpen()
        ? 'translateX(0)'
        : `translateX(${closedPx}px)`
    }
    // Also sync host main drawer width for mobile full-bleed.
    syncHostMainDrawerToMobileWidth()
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
      // Clear desktop tab-list pins so mobile horizontal layout is not fought.
      // Dynamic import avoids a static cycle (tab-position imports isMobileViewport).
      void import('./tab-position').then((m) => m.reconcileTabListPin())
      void import('./main-tab-pin').then((m) => m.reconcileMainTabListPin())
    } else {
      // Cross-up to desktop: clear both body classes, don't auto-reopen
      _updateDrawerWidth()
      document.body.classList.remove(BODY_CLASS_PRIMARY, BODY_CLASS_SECONDARY)
      // Restore pins if keepTabListVisible is still true.
      void import('./tab-position').then((m) => m.reconcileTabListPin())
      void import('./main-tab-pin').then((m) => m.reconcileMainTabListPin())
    }
    // Re-evaluate drawer-tab visibility on viewport cross so desktop↔mobile
    // transitions clear any stale inline display:none from the hide setting.
    void import('../tabs/buttons').then((m) => m.updateDrawerTabVisibility())
    void import('./main-mirror-drawer').then((m) => m.updateMainMirrorDrawerTabVisibility())
  }
  _mediaQuery.addEventListener('change', _onMediaChange)

  // --- Resize listener: keeps CSS var + wrapper transform in sync on
  //     mobile when the user drags the viewport. The matchMedia 'change'
  //     event fires only once per 600px boundary crossing; without a
  //     resize listener, the CSS var and transform freeze at the
  //     innerWidth at crossing time.
  // Also syncs host main drawer width for mobile full-bleed on every
  // resize (covers ≤600px + larger touch mobile).
  const _onResize = () => {
    syncHostMainDrawerToMobileWidth()           // host main full-bleed sync
    if (!isMobileViewport()) return             // desktop / larger mobile: no secondary work
    if (_resizeRafId !== null) return            // already coalesced for this frame
    _resizeRafId = requestAnimationFrame(() => {
      _resizeRafId = null
      _logDiag('resize-tick')
      _updateDrawerWidth()                       // cancelWrapperAnimation + syncCssVar + transform
    })
  }
  window.addEventListener('resize', _onResize)

  // One-shot reconciliation on mount: sync drawer width and CSS variable
  // to match the viewport. On mobile, this overwrites the CSS var (which
  // still holds the desktop-saved value from createSecondarySidebar) with
  // the measured/host-aligned width so getClosedTransformPx() matches the
  // drawer width — preventing the 60-100px peek on hard-refresh at mobile.
  // Always sync host main drawer for mobile full-bleed (covers both ≤600px
  // and larger touch mobile).
  syncHostMainDrawerToMobileWidth()
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
    // Cancel any pending resize rAF
    if (_resizeRafId !== null) {
      cancelAnimationFrame(_resizeRafId)
      _resizeRafId = null
    }
    window.removeEventListener('resize', _onResize)
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
