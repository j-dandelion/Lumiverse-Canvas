// Shared gate for the Sides strip-top Start variant (startButtonAtStripTop).
//
// Leaf-ish module: three imports. `os/start-menu.ts` owns the DOM move (the
// lift in `ensureStartButtonForSide`), `sidebar/main-renderer.ts` must treat
// the lifted button as a pinned first child so its structure/sweep passes
// cannot displace it (the strip-top flicker, LUMI-14) — a shared module keeps
// the two predicates in lockstep without an os→sidebar or sidebar→os import
// cycle (the renderer already avoids that seam with its dynamic
// chrome-locations import).
//
// The gate mirrors `isStartAtStripTop()`'s try/fallback in os/start-menu.ts:
// matchMedia/state unavailable → trust the setting plus the drawer location
// so the reconcile still converges. Sides desktop only — mobile Sides turns
// the strip into a horizontal row (`@media (min-width: 601px)` boundary),
// and Top/Bottom placement is owned by HORIZONTAL_STRIP_CSS.

import { getSettings, isHorizontalStrip } from '../settings/state'
import { isMobileViewport } from '../sidebar/mobile-exclusion'

/** True when the Start button should ride the TOP of the vertical tab strip
 *  (startButtonAtStripTop). Sides desktop only. */
export function isStartAtStripTopGate(): boolean {
  try {
    if (!getSettings().startButtonAtStripTop) return false
    if (isHorizontalStrip()) return false
    return !isMobileViewport()
  } catch {
    // matchMedia/state unavailable in some harnesses — trust the setting plus
    // the drawer location alone so the reconcile still converges.
    return !!getSettings().startButtonAtStripTop && getSettings().drawerLocation === 'sides'
  }
}
