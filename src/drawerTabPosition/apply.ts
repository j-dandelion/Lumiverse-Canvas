// Apply drawer-tab vertical-position overrides from Canvas settings.
//
// When the user drags a drawer tab to reposition it vertically, the
// Canvas-side override (mainDrawerTabOverrideVh / secondaryDrawerTabOverrideVh)
// takes precedence over the Lumiverse display setting. This module is the
// single writer of those inline styles from settings — the drag handler
// writes to the DOM directly for instant feedback, then persists to settings
// on drag-end so this function can re-apply on settings diff.
//
// Undefined override fields are intentionally ignored (no inline-style
// clear) — the polish mirror and side-flip remount paths own their own
// clearing.

import type { FullCanvasSettings } from '../settings/state'

/**
 * Apply drawer-tab vertical-position overrides to the given tab elements.
 *
 * If `settings.mainDrawerTabOverrideVh` is defined, write `${value}vh`
 * to `mainTab.style.marginTop`. Same for `secondaryDrawerTabOverrideVh`
 * on `secondaryTab`. Null tabs are no-op. Undefined override fields do
 * NOT clear the inline style.
 */
export function applyDrawerTabPosition(
  settings: FullCanvasSettings,
  mainTab: HTMLElement | null,
  secondaryTab: HTMLElement | null,
): void {
  if (mainTab && settings.mainDrawerTabOverrideVh !== undefined) {
    mainTab.style.marginTop = `${settings.mainDrawerTabOverrideVh}vh`
  }
  if (secondaryTab && settings.secondaryDrawerTabOverrideVh !== undefined) {
    secondaryTab.style.marginTop = `${settings.secondaryDrawerTabOverrideVh}vh`
  }
}
