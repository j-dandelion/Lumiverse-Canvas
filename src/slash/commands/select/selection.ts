// Canvas — `/select` selection injection.
//
// Translates a set of visual `index_in_chat` values into a Lumiverse
// selection by:
//   1. Ensuring select mode is active (toolbar toggle, NOT the store
//      action — see pitfall #10).
//   2. Waiting for React to re-render with select mode on, so the
//      row's onClick prop is `onToggleSelect` (not `undefined`).
//   3. Reading each message row's `index_in_chat` via DOM scrape
//      (with a React/Preact fiber fallback).
//   4. Dispatching a bubble-phase click on the row if its index is in
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
// 5. rAF-before-row-clicks: React batches state updates; if we
//    dispatch row clicks synchronously after the toolbar toggle
//    click, the row's onClick prop is still `undefined` (the
//    `data-select-mode` attribute hasn't been re-rendered yet, so
//    `isSelectMode` in the row is still false). We must wait one
//    rAF for React to commit before dispatching row clicks.
//
// Adaptations for Canvas:
//   - Consumes `readIndexInChat` from the salvaged `./extract` module
//     instead of duplicating the metaPill-scrape + fiber-walk logic.
//   - Tightened selectors that were too broad in the Chronicle-era
//     contract:
//       * Toolbar toggle: `button[class*="toolbarBtn"]` (was
//         `button[title*="select" i]`, which also matched
//         MessageSelectBar's "Select all" button).
//       * Message row: `[data-component="BubbleMessage"]` (was
//         `[data-message-id]`, which also matched the virtualRow
//         wrapper — 2 elements per message, only the bubble has
//         the metaPill the index scrape reads).

import { readIndexInChat } from './extract'

const SELECTOR_SELECT_TOGGLE = 'button[class*="toolbarBtn"]'
const SELECTOR_MESSAGE_ROW = '[data-component="BubbleMessage"]'
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
 * Wait until `data-select-mode="true"` is on the wrapper, or
 * `timeoutMs` elapses. Returns true if select mode is active.
 *
 * Used after `ensureSelectMode()` to let React commit the state
 * update and re-render the rows with `onClick={onToggleSelect}`.
 * Without this wait, the dispatched row clicks are no-ops (onClick
 * prop is still `undefined`).
 */
function waitForSelectModeActive(timeoutMs = 200): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now()
    const tick = () => {
      if (isSelectModeActive()) {
        resolve(true)
        return
      }
      if (Date.now() - start > timeoutMs) {
        resolve(false)
        return
      }
      requestAnimationFrame(tick)
    }
    tick()
  })
}

/**
 * Select every message whose visual `index_in_chat` is in `indices`.
 *
 * Async: returns a Promise that resolves AFTER the row clicks have
 * been dispatched and React has had a chance to process them. The
 * orchestrator (Task 3.4) awaits this before reading the result.
 *
 * The orchestrator should call `clearSelection()` first when the
 * user wants a fresh selection.
 */
export async function selectByVisualIndices(
  indices: Set<number>,
): Promise<SelectionResult> {
  if (indices.size === 0) {
    return { matched: 0, unreadable: 0, missingIndices: [] }
  }

  ensureSelectMode()

  // Wait for React to commit the select-mode state change and
  // re-render the rows with `onClick={onToggleSelect}` before
  // dispatching row clicks. Without this, the clicks are no-ops.
  const ready = await waitForSelectModeActive()
  if (!ready) {
    console.warn('[canvas-slash] selectByVisualIndices: select mode did not activate within timeout')
    return { matched: 0, unreadable: 0, missingIndices: Array.from(indices) }
  }

  const matchedIndices = new Set<number>()
  let unreadable = 0
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
      matchedIndices.add(idx)
    }
  }

  const missingIndices: number[] = []
  for (const i of indices) {
    if (!matchedIndices.has(i)) missingIndices.push(i)
  }

  return { matched: matchedIndices.size, unreadable, missingIndices }
}
