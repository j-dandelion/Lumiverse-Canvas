// Canvas — `/select` selection injection.
//
// Translates a set of visual `index_in_chat` values into a Lumiverse
// selection by:
//   1. Ensuring select mode is active (toolbar toggle, NOT the store
//      action — see pitfall #10).
//   2. Reading each message row's `index_in_chat` via DOM scrape
//      (with a React/Preact fiber fallback).
//   3. Dispatching a bubble-phase click on the row if its index is in
//      the target set.
//
// Pitfalls preserved from Chronicle skill (verified 2026-06-02):
// 1. `setMessageSelectMode(true)` ALWAYS clears `selectedMessageIds`.
//    Use the toolbar button click instead. (Pitfall #10)
// 2. Bubble-phase click dispatch — Lumiverse's onClick fires from
//    inside the row, our dispatch is the bubble, we do NOT
//    stopPropagation. (Pure-extension reference)
// 3. Visual `index_in_chat` is NOT array position. We don't walk
//    `state.messages`; we scrape the rendered number (with a fiber
//    fallback). (Pitfall #11)
// 4. Deleted messages create gaps. Out-of-range indices in the
//    target set simply don't match any row — surfaced as `missing`
//    in the result so the orchestrator can toast a warning.
//
// Adaptations for Canvas:
//   - Consumes `readIndexInChat` from the salvaged `./extract` module
//     instead of duplicating the metaPill-scrape + fiber-walk logic.
//   - Reuses the same Lumiverse DOM contract Chronicle used
//     (`[data-message-id]` rows, `button[title*="select" i]` toggle,
//     `data-select-mode` on a wrapper element). No selectors needed
//     adapting.

import { readIndexInChat } from './extract'

const SELECTOR_SELECT_TOGGLE = 'button[title*="select" i]'
const SELECTOR_MESSAGE_ROW = '[data-message-id]'
const SELECT_MODE_ATTR = 'data-select-mode'

/** Result of a `selectByVisualIndices` call. */
export type SelectionResult = {
  /** Rows whose click was dispatched (index matched AND was in the target set). */
  matched: number
  /** Rows we could not read an index from (e.g. transient render state). */
  unreadable: number
  /** Indices in the target set that did not match any rendered row. */
  missingIndices: number[]
}

/** True if the chat is currently in Lumiverse's message-select mode. */
export function isSelectModeActive(): boolean {
  return document.querySelector(`[${SELECT_MODE_ATTR}="true"]`) !== null
}

/**
 * Ensure select mode is active. Clicks the toolbar toggle if it isn't.
 *
 * Why not call `setMessageSelectMode(true)` directly? Per pitfall #10,
 * BOTH `setMessageSelectMode(true)` and `setMessageSelectMode(false)`
 * reset `selectedMessageIds` to `[]`. The toolbar click preserves
 * the selection state. Also, as a pure extension, we have no store
 * access — we drive Lumiverse via the DOM regardless.
 */
export function ensureSelectMode(): void {
  if (isSelectModeActive()) return

  const candidates = document.querySelectorAll<HTMLButtonElement>(SELECTOR_SELECT_TOGGLE)
  if (candidates.length === 0) return

  // Prefer the toggle that's inside a `data-select-mode` wrapper
  // (the toolbar root). Fall back to the first match.
  for (const btn of Array.from(candidates)) {
    if (btn.closest(`[${SELECT_MODE_ATTR}]`)) {
      btn.click()
      return
    }
  }
  candidates[0].click()
}

/**
 * Clear the current selection by toggling select mode off. Per
 * pitfall #10, clicking the toolbar toggle while select mode is
 * active deactivates it AND clears `selectedMessageIds`.
 *
 * If select mode is not active, this is a no-op.
 */
export function clearSelection(): void {
  if (!isSelectModeActive()) return
  const candidates = document.querySelectorAll<HTMLButtonElement>(SELECTOR_SELECT_TOGGLE)
  for (const btn of Array.from(candidates)) {
    if (btn.closest(`[${SELECT_MODE_ATTR}]`)) {
      btn.click()
      return
    }
  }
  candidates[0]?.click()
}

/**
 * Select every message whose visual `index_in_chat` is in `indices`.
 *
 * The orchestrator (Task 3.4) calls this after `parseSelectArgs` +
 * `extractIndices` have produced a normalized set.
 *
 * Note: this dispatches one click per matching row. Lumiverse's
 * bubble-phase handler toggles that row's selection. If the row
 * was already selected, this will DESELECT it. The orchestrator
 * should call `clearSelection()` first when the user wants a
 * fresh selection.
 */
export function selectByVisualIndices(indices: Set<number>): SelectionResult {
  if (indices.size === 0) {
    return { matched: 0, unreadable: 0, missingIndices: [] }
  }

  ensureSelectMode()

  let matched = 0
  let unreadable = 0
  const matchedIndices = new Set<number>()
  const rows = document.querySelectorAll<HTMLElement>(SELECTOR_MESSAGE_ROW)

  for (const row of Array.from(rows)) {
    const idx = readIndexInChat(row)
    if (idx === null) {
      unreadable++
      continue
    }
    if (indices.has(idx)) {
      row.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, view: window })
      )
      matched++
      matchedIndices.add(idx)
    }
  }

  const missingIndices: number[] = []
  for (const i of indices) {
    if (!matchedIndices.has(i)) missingIndices.push(i)
  }

  return { matched, unreadable, missingIndices }
}
