// Host main-drawer context menu interception.
//
// When the user right-clicks a main-drawer (or main-mirror) tab, Lumiverse
// renders its own ContextMenu with items like "Hide/Show tab labels",
// "Configure tabs". This module intercepts those clicks:
//
//   button[0] = Hide/Show tab labels — patch host showTabLabels + stamp
//               Canvas secondary/mirror labels so both drawers stay synced
//               (host alone only updates the main strip; secondary is Canvas).
//   button[1] = Configure tabs — open the Canvas Configure Tabs modal
//
// Design: capture-phase click listener that detects Lumiverse's context menu
// via `findLumiverseContextMenu`, then checks if the click landed on a known
// host menu button. If so, it intercepts: dismisses the host menu and runs
// the Canvas path (so host does not double-toggle labels).
//
// Active whenever Canvas is loaded: started from setup.ts on boot, stopped
// on extension cleanup. This guarantees "Configure tabs" always routes to
// Canvas's modal even when the second drawer is disabled, so the user can
// use the footer toggle to enable it.
//
// Note: stopping the intercept does NOT close the modal. The second-drawer
// mode controller (settings/second-drawer-mode.ts) owns modal lifecycle on
// mode switches and refreshes any still-open modal from live. Intercept stop
// only detaches the click listener.

import { findLumiverseContextMenu } from '../context-menu/index'
import { patchHostDrawerSettings } from '../dom/host-settings'
import { isShowTabLabels, syncSecondaryTabLabels } from '../sidebar/drawer-sync'
import { dlog, dwarn } from '../debug/log'

let _interceptActive = false
let _clickHandler: ((e: MouseEvent) => void) | null = null

/**
 * Start intercepting host context-menu clicks (labels + Configure tabs).
 * Safe to call multiple times — idempotent.
 */
export function startConfigureTabsIntercept(): void {
  if (_interceptActive) return
  _interceptActive = true

  _clickHandler = (e: MouseEvent) => {
    if (!_interceptActive) return

    // Check if a Lumiverse context menu is currently visible.
    const menu = findLumiverseContextMenu()
    if (!menu) return

    // Lumiverse's context menu buttons are rendered in DOM order.
    // The menu typically has:
    //   button[0] = "Hide/Show tab labels" (first item)
    //   button[1] = "Configure tabs" (second item)
    // Canvas may inject "Move to …" after that — ignore it (own handler).
    const buttons = menu.querySelectorAll('button')
    const target = e.target as HTMLElement | null
    if (!target) return

    const labelsBtn = buttons.length >= 1 ? buttons[0] : null
    const configureBtn = buttons.length >= 2 ? buttons[1] : null

    // ── Hide / Show tab labels (main + main-mirror path) ──
    if (labelsBtn && (labelsBtn.contains(target) || labelsBtn === target)) {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      dismissHostContextMenu()

      const showLabels = isShowTabLabels()
      const next = !showLabels
      // Same path as secondary tab-context-menu: host write + force-stamp
      // Canvas labels so secondary/mirror follow immediately.
      const ok = patchHostDrawerSettings({ showTabLabels: next })
      syncSecondaryTabLabels(next)
      if (ok) {
        requestAnimationFrame(() => syncSecondaryTabLabels(next))
      }
      dlog('[configure-intercept] intercepted Hide/Show tab labels', { next, ok })
      return
    }

    // ── Configure tabs ──
    if (!configureBtn) return
    const clickedConfigureBtn = configureBtn.contains(target) || configureBtn === target
    if (!clickedConfigureBtn) return

    // Intercept: prevent default + stop propagation so Lumiverse doesn't process the click.
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()

    // Dismiss the host context menu.
    dismissHostContextMenu()

    dlog('[configure-intercept] intercepted Configure Tabs click, opening modal')

    // Open our configure modal.
    // Lazy-import to avoid circular dependency at module load time.
    void import('./configure-modal').then((m) => {
      m.openConfigureTabsModal()
    }).catch((err) => {
      dwarn('[configure-intercept] Failed to open configure modal:', err)
    })
  }

  // Use capture phase so we fire before React's event system.
  document.addEventListener('click', _clickHandler, true)
}

/**
 * Stop intercepting. Safe to call when already stopped — idempotent.
 *
 * This function only detaches the click listener. It does NOT own modal
 * lifecycle: the second-drawer mode controller (settings/second-drawer-mode.ts)
 * refreshes any still-open Configure Tabs modal from live on mode switches.
 */
export function stopConfigureTabsIntercept(): void {
  if (!_interceptActive) return
  _interceptActive = false

  if (_clickHandler) {
    document.removeEventListener('click', _clickHandler, true)
    _clickHandler = null
  }
}

/**
 * Dismiss the Lumiverse context menu by sending Escape keydown.
 * Matches the pattern in context-menu/index.ts injectCanvasItem.
 */
function dismissHostContextMenu(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  }))
}

/** True when the intercept is currently active. */
export function isConfigureTabsInterceptActive(): boolean {
  return _interceptActive
}
