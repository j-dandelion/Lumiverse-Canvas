/**
 * OS-mode window-state derivation (spec §3.1, ruling F1: derivation, not a
 * parallel store).
 *
 * A tab's window state is DERIVED from exactly two inputs:
 *   - the model's closed set (`model.closed` — the only OS-specific stored
 *     state), and
 *   - the drawer's active tab (the "open" window is the displayed one).
 * `minimized` is the residual: in-drawer ∧ not closed ∧ not active. This
 * mirrors how Lumiverse drawers already work — inactive tabs have visible
 * strip buttons and parked panels — so OS mode adds no second source of
 * truth for what is active, only the closed-set on top (which lives in the
 * model alongside `hidden`, keyed by TabKey; chrome callers resolve keys
 * to live ids exactly like the hiddenTabIds flow does).
 *
 * All functions here are pure: the closed-set lives in the model and is
 * mutated only through dispatch intents (`setClosed`), the same ownership
 * rule as every other placement state (pitfalls §2).
 *
 * Hidden × closed matrix (ruling F7): eye-hidden wins — callers must filter
 * Configure-Tabs-hidden tabs BEFORE consulting these helpers; a hidden tab
 * is invisible everywhere regardless of closed-set membership, and unhiding
 * a closed tab leaves it minimized (the caller drops its closed membership).
 */

export type { TabKey } from '../core/model'

/** The three OS-mode window states. `open` == the drawer's active tab. */
export type WindowState = 'open' | 'minimized' | 'closed'

/**
 * Derive one tab's window state. Callers pass their drawer-side's active
 * id (`null` = drawer has no displayed window) — the caller is the
 * authority on active-tab truth, this module never re-reads it (F1).
 *
 *   closed    — closed-set membership (wins over everything, F7)
 *   open      — the drawer's active tab
 *   minimized — in-drawer, not closed, not active
 */
export function deriveWindowState(
  tabId: string,
  activeTabId: string | null,
  closedIds: readonly string[],
): WindowState {
  if (closedIds.includes(tabId)) return 'closed'
  if (activeTabId != null && tabId === activeTabId) return 'open'
  return 'minimized'
}

/**
 * Derive the window-state map for one drawer's tabs. Hidden tabs are NOT
 * this function's concern (callers filter them — F7). The returned map
 * covers exactly the input ids.
 */
export function deriveDrawerWindowStates(
  tabIds: readonly string[],
  activeTabId: string | null,
  closedIds: readonly string[],
): Map<string, WindowState> {
  const out = new Map<string, WindowState>()
  for (const id of tabIds) out.set(id, deriveWindowState(id, activeTabId, closedIds))
  return out
}

/**
 * True when the drawer has a displayed window (its body should be
 * expanded). `false` collapses the drawer to the strip (D7 revised) —
 * the shared predicate chat reflow / dock-offset consume.
 */
export function hasDisplayedWindow(activeTabId: string | null): boolean {
  return activeTabId != null
}
