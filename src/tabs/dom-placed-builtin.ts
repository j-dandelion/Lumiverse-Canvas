// Tracking + restore for built-in registry roots placed via Canvas DOM
// reparent when host tabLocations (bridge + store.moveTabTo) are unavailable.
// Kept free of sidebar/secondary imports so teardown can call sync restore.

import { dlog } from '../debug/log'
import { getMainPanelContent } from '../dom/lumiverse'

export const CANVAS_DOM_PLACED_ATTR = 'data-canvas-dom-placed'

/** Session set of tabIds placed via DOM fallback (not host tabLocations). */
const _domPlacedIds = new Set<string>()

export function isDomPlacedBuiltIn(tabId: string): boolean {
  if (_domPlacedIds.has(tabId)) return true
  if (typeof document === 'undefined') return false
  try {
    return !!document.querySelector(
      `[data-canvas-moved="${CSS.escape(tabId)}"][${CANVAS_DOM_PLACED_ATTR}]`,
    )
  } catch {
    return false
  }
}

export function markDomPlacedBuiltIn(tabId: string): void {
  _domPlacedIds.add(tabId)
}

export function clearDomPlacedBuiltIn(tabId: string): void {
  _domPlacedIds.delete(tabId)
}

/** Test seam: clear all DOM-placed tracking. */
export function __clearDomPlacedForTest(): void {
  _domPlacedIds.clear()
}

/**
 * Resolve main panelContent even when main-mirror has parked it in the shell.
 */
export function resolveMainPanelContentForRestore(): HTMLElement | null {
  const fromHost = getMainPanelContent()
  if (fromHost) return fromHost
  if (typeof document === 'undefined') return null
  return document.querySelector('[data-canvas-main-panel-content]') as HTMLElement | null
}

/**
 * Restore a DOM-placed built-in root to host ownership and clear Canvas
 * placement attrs + tracking.
 *
 * 2026-08-17: this used to `mainContent.appendChild(el)` — putting the root
 * DIRECTLY into the main panelContent node. That node is the node the
 * main-mirror PARKS in its shell, so every restored root became a visible
 * child of the parked content area: stacked/orphan panels (e.g. a fixed
 * "Summary" panel) stayed on screen no matter which tab was activated —
 * the "content remains on the old tab" bug after Configure → Enable second
 * drawer OFF. The HOST owns root placement: TabPanelContent's effect moves
 * the root into its containerRef when the tab activates (and
 * ContainerTabContent Pass 3 heals stale tabLocations), so the correct
 * restore is to DETACH the root and let the host re-attach it on demand.
 */
export function restoreDomPlacedBuiltInToMain(
  tabId: string,
  root?: HTMLElement | null,
): boolean {
  let el = root ?? null
  if (!el && typeof document !== 'undefined') {
    try {
      el = document.querySelector(
        `[data-canvas-moved="${CSS.escape(tabId)}"][${CANVAS_DOM_PLACED_ATTR}]`,
      ) as HTMLElement | null
      if (!el) {
        el = document.querySelector(
          `[data-canvas-moved="${CSS.escape(tabId)}"]:not([data-canvas-secondary])`,
        ) as HTMLElement | null
      }
    } catch {
      el = null
    }
  }

  if (el) {
    // Detach from wherever Canvas parked it (secondary content / any
    // parent). The host re-attaches via TabPanelContent/ContainerTabContent.
    if (el.parentElement) {
      try {
        el.parentElement.removeChild(el)
      } catch {
        /* host may have removed it already */
      }
    }
    el.removeAttribute('data-canvas-moved')
    el.removeAttribute('data-canvas-active')
    el.removeAttribute(CANVAS_DOM_PLACED_ATTR)
    // Clear placement styles so a later host attach renders cleanly.
    el.style.removeProperty('position')
    el.style.removeProperty('inset')
    el.style.removeProperty('display')
  }
  _domPlacedIds.delete(tabId)
  dlog(`[tabmove] restoreDomPlacedBuiltInToMain tab=${tabId} restored=${!!el} (detached — host re-attaches on activation)`)
  return !!el
}
