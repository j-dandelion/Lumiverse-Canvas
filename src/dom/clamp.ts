// Shared sidebar width clamp. The 200px minimum and 80%-of-viewport maximum
// are used by resize handles, applyLayout, createSecondarySidebar, and
// restoreMainDrawerFromDom. Centralizing avoids sign-inversion bugs when
// the bounds change.
const MIN_SIDEBAR_WIDTH = 200
const MAX_SIDEBAR_WIDTH_FRAC = 0.8

export function clampSidebarWidth(px: number): number {
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(window.innerWidth * MAX_SIDEBAR_WIDTH_FRAC, px))
}
