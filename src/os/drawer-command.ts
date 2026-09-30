/**
 * OS-mode drawer chrome command seam (D7/D19) — a leaf.
 *
 * Primary-drawer open/close is SHELL-owned: while the Canvas main mirror is
 * the visible surface, `observe()` reads primary open from the shell and
 * reconcile's model→host `setDrawer` write for primary is deliberately
 * suppressed (host/lumiverse/implementation.ts `setDrawer` "stale echo"
 * guard — live-verify #1 SAVE_LAYOUT freeze). A model write alone therefore
 * cannot open or collapse the main drawer; an OS action (X close, minimize,
 * Start launch into a closed drawer) must command the shell directly. The
 * shell's own persist writes the same open state the action already
 * dispatched, so the duplicate folds as an identity no-op in the reducer —
 * no ping-pong.
 *
 * The main mirror registers its handler on mount and clears it on teardown.
 * With no handler the model→host path is all there is (secondary drawer, or
 * no mirror): `commandDrawerOpen` returns false and callers do nothing.
 *
 * KEEP THIS MODULE RUNTIME-IMPORT-FREE (same cycle rationale as
 * `os/header-close.ts`).
 */

import type { Side } from '../core/model'

type DrawerCommandHandler = (side: Side, open: boolean) => boolean

let _handler: DrawerCommandHandler | null = null

/** Install the shell command handler (main mirror mount) or clear it. */
export function setDrawerCommandHandler(
  handler: DrawerCommandHandler | null,
): void {
  _handler = handler
}

/**
 * Ask the shell chrome to apply an open/close. Returns `true` when a shell
 * handled it; `false` when the model→host `setDrawer` path is the only route
 * (secondary, or no shell mounted).
 */
export function commandDrawerOpen(side: Side, open: boolean): boolean {
  if (!_handler) return false
  try {
    return _handler(side, open)
  } catch {
    return false
  }
}
