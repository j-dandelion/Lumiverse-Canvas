// Tracking + restore for built-in registry roots placed via Canvas DOM
// reparent when host tabLocations (bridge + store.moveTabTo) are unavailable.
// Kept free of sidebar/secondary imports so teardown can call sync restore.

import { dlog, dwarn } from '../debug/log'
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
 * Put a DOM-placed built-in root back under main panel content and clear
 * Canvas placement attrs + tracking.
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

  const mainContent = resolveMainPanelContentForRestore()
  if (el && mainContent && el.parentElement !== mainContent) {
    try {
      mainContent.appendChild(el)
    } catch (err) {
      dwarn(`[tabmove] restoreDomPlaced appendChild failed for "${tabId}":`, err)
    }
  }

  if (el) {
    el.removeAttribute('data-canvas-moved')
    el.removeAttribute('data-canvas-active')
    el.removeAttribute(CANVAS_DOM_PLACED_ATTR)
  }
  _domPlacedIds.delete(tabId)
  dlog(`[tabmove] restoreDomPlacedBuiltInToMain tab=${tabId} restored=${!!el}`)
  return !!el
}
