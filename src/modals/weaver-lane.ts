// Weaver Studio content-lane containment.
//
// When the Weaver Studio modal is open, constrain its dialog element to the
// visible content lane (between drawer/strip insets on each side) so it
// doesn't overlap with pinned tab strips or drawer chrome.
//
// Detection: reads `activeModal` from the Lumiverse store snapshot (see
// src/store/index.ts getActiveModal). If the field is not present (older
// Lumiverse), the weaver dialog is not constrained — no fuzzy-match fallback.
//
// The module injects CSS targeting `[data-canvas-weaver-lane="1"]` and tags
// the matching dialog element when weaver is detected. A body childList
// observer re-checks on DOM changes (SPA navigation, dialog open/close) and
// re-applies via RAF-dedupe.

import { getActiveModal } from '../store'
import { publishContentLaneInsets } from '../chat/reflow'
import { injectStyles } from '../debug/styles'
import { dwarn } from '../debug/log'

const WEAVER_LANE_STYLE_ID = 'canvas-weaver-lane-styles'
const WEAVER_LANE_ATTR = 'data-canvas-weaver-lane'

let _observer: MutationObserver | null = null
let _rafId: number | null = null
let _active = false

function injectWeaverLaneStyles(): void {
  injectStyles(WEAVER_LANE_STYLE_ID, `
    [${WEAVER_LANE_ATTR}="1"] {
      inset: unset !important;
      top: 0 !important;
      bottom: 0 !important;
      left: var(--sidebar-ux-content-inset-l, 0px) !important;
      right: var(--sidebar-ux-content-inset-r, 0px) !important;
      width: auto !important;
    }
  `)
}

/**
 * Tag the weaver dialog with data-canvas-weaver-lane="1" if weaver is active.
 * Removes the attribute when weaver is no longer active.
 * Also publishes fresh content lane insets so the CSS vars are current.
 */
function applyWeaverLane(): void {
  if (!_active) return
  const modal = getActiveModal()

  // Publish fresh content lane insets every time we re-check.
  // This ensures the CSS vars reflect current drawer/chrome geometry.
  try {
    publishContentLaneInsets()
  } catch (err) {
    dwarn('[weaver-lane] publishContentLaneInsets failed:', err)
  }

  if (modal === 'weaver') {
    // Find the weaver dialog. Tag it so the CSS rule applies.
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')
    if (dialog && !dialog.hasAttribute(WEAVER_LANE_ATTR)) {
      dialog.setAttribute(WEAVER_LANE_ATTR, '1')
    }
  } else {
    // Weaver not active — remove tag from any previously tagged element.
    const tagged = document.querySelector(`[${WEAVER_LANE_ATTR}="1"]`)
    if (tagged) {
      tagged.removeAttribute(WEAVER_LANE_ATTR)
    }
  }
}

/** RAF-deduplicated re-apply. Idempotent; safe to call multiple times per frame. */
function scheduleApply(): void {
  if (_rafId !== null) return
  _rafId = requestAnimationFrame(() => {
    _rafId = null
    applyWeaverLane()
  })
}

/**
 * Start the weaver-lane containment module.
 * Injects CSS, observes body childList for dialog mount/unmount, and
 * runs an initial apply. Returns a teardown function.
 */
export function startWeaverLane(): () => void {
  if (_observer) {
    // Already running; return a no-op teardown.
    return () => { /* no-op */ }
  }

  injectWeaverLaneStyles()
  _active = true

  // Initial application
  scheduleApply()

  // Body childList observer: catches dialog add/remove (SPA nav,
  // modal open/close). RAF-dedupe to avoid redundant reflow work.
  _observer = new MutationObserver((mutations) => {
    if (!_active) return
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        scheduleApply()
        break
      }
    }
  })
  _observer.observe(document.body, { childList: true, subtree: true })

  return () => {
    _active = false
    if (_rafId !== null) {
      cancelAnimationFrame(_rafId)
      _rafId = null
    }
    if (_observer) {
      _observer.disconnect()
      _observer = null
    }
    // Remove the attribute from any tagged element
    const tagged = document.querySelector(`[${WEAVER_LANE_ATTR}="1"]`)
    if (tagged) {
      tagged.removeAttribute(WEAVER_LANE_ATTR)
    }
  }
}
