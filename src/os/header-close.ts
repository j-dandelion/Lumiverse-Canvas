/**
 * OS-mode panel-header close policy (spec D2/D9) — a leaf seam.
 *
 * The panel-header X buttons live on Canvas-owned headers, so the shells own
 * their click wiring (the `drawer-shell` listeners registered at construction
 * time). A document-level capture listener cannot preempt those: listeners on
 * the event TARGET run in registration order regardless of capture flag, and
 * the shell registered first. Instead the shells ask this leaf "does OS mode
 * own the X?" — `os/panel-chrome.ts` installs the implementation on mount and
 * clears it on teardown. With no handler installed (OS off / chrome
 * unmounted) callers run their plain drawer close.
 *
 * KEEP THIS MODULE RUNTIME-IMPORT-FREE: `sidebar/main-mirror-drawer.ts` and
 * `sidebar/secondary.tsx` import it, and an `os/actions` / dispatch import
 * here would close a module cycle (shell → dispatch → active-tab → shell).
 */

import type { Side } from '../core/model'

type PanelHeaderCloseHandler = (side: Side) => boolean

let _handler: PanelHeaderCloseHandler | null = null

/** Install the OS close policy (panel-chrome mount) or clear it (teardown). */
export function setPanelHeaderCloseHandler(
  handler: PanelHeaderCloseHandler | null,
): void {
  _handler = handler
}

/**
 * Ask the OS policy to close the side's displayed window.
 *
 * Returns `true` when OS mode handled the click — the caller must skip its
 * plain drawer close. Returns `false` when the caller should run its own
 * default (OS off, no installed handler, no displayed window, or a failed
 * handler).
 */
export function handlePanelHeaderClose(side: Side): boolean {
  if (!_handler) return false
  try {
    return _handler(side)
  } catch {
    return false
  }
}
