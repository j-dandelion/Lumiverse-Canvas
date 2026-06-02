// Salvaged from Chronicle v1.1.0 working tree, 2026-06-02.
// Source: ~/chronicle_ext/src/select-range.ts (git diff against HEAD @ 06fa097)
//
// Status at salvage time: never committed, uncommitted 244-line modification
// on top of the v1.1.0 release commit. The diff added the mobile send-button
// intercept path (click + touchend) and shared debouncing between the keydown
// and pointer entry points. This file preserves the FULL working-tree version
// (575 lines), not just the diff — the surrounding orchestrator context is
// needed to understand the intercept call sites.
//
// Purpose: preserve the mobile send-button intercept + debouncing pattern
// for adaptation into Canvas's slash runtime (intercept.ts).
//
// Functions to adapt (not import verbatim):
//   - installSendButtonInterceptor  → use in intercept.ts
//   - isSendButtonClick / isSendButtonTouch → keep as-is
//   - matchesSendButtonContract → keep as-is
//   - findChatMessageTextarea → keep as-is
//   - tryInvokeSlashCommand → adapt; remove the debounce (not needed
//     once we have a unified intercept path that owns both keydown and
//     send-button click)
//
// Functions to discard (Chronicle-specific):
//   - /select-specific parsing, dispatch, and select-mode logic
//     (parseSelectArgs, handleSelectArgs, applyRangeReplace,
//     clearSelectionInDom, selectAllLoaded, ensureSelectMode, etc.)
//   - The pending observer (installPendingObserver) — Canvas's /select
//     command will own its own pending strategy
//   - resolveActiveChatId — Canvas resolves the chat ID via runtime
//   - toast() — Canvas dispatches its own 'canvas:slash-toast' CustomEvent
//   - localStorage 'chronicle_*' references (none in this file, but watch
//     for them if you copy adjacent files)
//
// Pitfalls documented in the source (preserve these comments in the
// Canvas adaptation):
//   - Lumiverse's send button selector is button[class*="sendBtn"]
//     (CSS-module hash; "sendBtn" prefix is stable across builds)
//   - The send button is type="button", NOT type="submit"
//     (InputArea.tsx:2961)
//   - Mobile browsers dispatch click ~300ms after touchend (the
//     "fastclick" delay); listen for BOTH and debounce
//   - touchend's e.target is whatever was under the finger at touchstart;
//     use document.elementFromPoint(t.clientX, t.clientY) on
//     e.changedTouches[0] to find the actual release target
//   - Long-press (touchstart → 2s hold) queues the message instead of
//     sending; do NOT intercept that path — let the queued message
//     through and the user can re-send manually
//   - enterToSend defaults to FALSE on mobile, so mobile Enter just
//     inserts a newline — the send button is the canonical mobile
//     submit action
//   - SLASH_DEBOUNCE_MS = 500 was Chronicle's choice; tune for Canvas
//     once the unified intercept owns both paths
//
// --- original 575-line working-tree file follows ---
//
/**
 * Chronicle — `/select <range>` slash command orchestrator
 *
 * Pure-extension feature. No Lumiverse core changes. Intercepts the chat
 * input's `keydown` to detect `/select <range>` patterns, parses the range
 * (via select-range-parser), dispatches bubble-phase clicks on loaded
 * message rows (to feed `selectedMessageIds` via Lumiverse's
 * `MessageCard.handleSelectClick` → `toggleMessageSelect`), and tracks
 * unloaded indices in a "pending" set that resolves when the user scrolls
 * up and the messages render.
 *
 * Bulk actions (hide/unhide/delete) on selections that include pending
 * indices issue a direct HTTP call to the bulk endpoint with the resolved
 * IDs. (See `select-range-bridge.ts`.) Lumiverse's existing select bar
 * reads `selectedMessageIds` directly — it will only act on loaded IDs.
 * Our bulk-action observer (below) issues a SECOND bulk call for the
 * pending IDs after Lumiverse's first one completes.
 *
 * Out of scope: Command Palette integration, progressive auto-loading,
 * Lumiverse core changes.
 *
 * Visual message number: `Message.index_in_chat` (server-assigned, stable
 * across scroll/load). Not exposed as a data-attribute in Lumiverse's DOM
 * — we scrape it from `class*="metaPill"` text (with a React fiber fallback).
 * See `select-range-extract.ts`.
 */
import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import { parseSelectArgs, type SelectArgs } from './select-range-parser'
import { readIndexInChat } from './select-range-extract'
import { getApiBase } from './select-range-bridge'
// (getApiBase is re-exported below for diagnostics / debugging)

// ── Constants ───────────────────────────────────────────────────────

/** Selector for the main chat input textarea. `name="chat-message"` is stable. */
const SELECTOR_TEXTAREA = 'textarea[name="chat-message"]'

/** Selector for Lumiverse's message rows. Stable attribute. */
const SELECTOR_ROW = '[data-message-id]'

/** Attribute on the chat column that signals select mode is active. */
const SELECT_MODE_ATTR = 'data-select-mode'

/** Custom DOM event for the orchestrator → main.tsx toast channel. */
const TOAST_EVENT = 'chronicle:select-range-toast'

/** Selector for Lumiverse's send button. CSS-module class is hashed
 *  (e.g. "sendBtn_x7y2z"); the prefix is stable across builds. The
 *  send button is `type="button"` (NOT `submit`) at InputArea.tsx:2961. */
const SELECTOR_SEND_BTN = 'button[class*="sendBtn"]'

/** Debounce window for slash command invocations. Covers the desktop
 *  case where a user types `/select 25-100`, presses Enter (keydown
 *  fires), then taps the send button (click fires) within ~200ms. The
 *  textarea is cleared after the first invocation so the second one
 *  would no-op anyway; this debounce is defensive insurance. */
const SLASH_DEBOUNCE_MS = 500

// ── State (module-scoped — single Chronicle instance) ──────────────

interface SelectRangeState {
  /** Indices in `index_in_chat` that are pending (scrolled away, not in DOM) */
  pendingVisualIndices: Set<number>
  /** Chat ID we last operated on (reset on navigation) */
  chatId: string | null
}

const state: SelectRangeState = {
  pendingVisualIndices: new Set(),
  chatId: null,
}

/** Timestamp (ms since epoch) of the last successful slash command
 *  invocation. Used to debounce keydown + click double-fires. */
let lastSlashInvocationAt = 0

// ── Public API ─────────────────────────────────────────────────────

export interface SelectRangeStatus {
  loadedSelected: number
  pendingCount: number
}

export function getSelectRangeStatus(): SelectRangeStatus {
  return {
    loadedSelected: getLoadedSelectedCount(),
    pendingCount: state.pendingVisualIndices.size,
  }
}

export function clearPending(): void {
  state.pendingVisualIndices.clear()
}

/**
 * Install the slash command interceptor and pending observer. Returns a
 * cleanup function for teardown.
 *
 * The bulk-action followup (auto-resolve pending before hide/delete) is
 * NOT installed by default — it requires a more robust detection
 * mechanism (see `installBulkActionObserver` below). Call it explicitly
 * from setup() if you want the followup behavior.
 */
export function attachSelectInterceptor(spindleCtx: SpindleFrontendContext): () => void {
  const detachTextarea = installTextareaInterceptor(spindleCtx)
  const detachSendButton = installSendButtonInterceptor(spindleCtx)
  const observer = installPendingObserver()

  return function detach() {
    detachTextarea()
    detachSendButton()
    observer.disconnect()
    state.pendingVisualIndices.clear()
    state.chatId = null
  }
}

// ── Textarea intercept ─────────────────────────────────────────────

function installTextareaInterceptor(
  _spindleCtx: SpindleFrontendContext
): () => void {
  const handler = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.ctrlKey || e.metaKey) {
      return
    }
    const ta = e.target as HTMLTextAreaElement | null
    if (!ta || ta.tagName !== 'TEXTAREA') return
    // Only intercept the main chat input
    if (ta.getAttribute('name') !== 'chat-message') return
    const value = ta.value
    if (!/\/select\b/i.test(value)) return

    tryInvokeSlashCommand(e, ta, value, _spindleCtx, 'keydown')
  }
  // Capture phase so we see the event before Lumiverse's bubble-phase handler.
  document.addEventListener('keydown', handler, true)

  return () => document.removeEventListener('keydown', handler, true)
}

// ── Send-button intercept (mobile) ────────────────────────────────
//
// The chat input's canonical mobile submit action is the send button
// (InputArea.tsx:2960), not the Enter key. `enterToSend` defaults to
// false, so mobile Enter just inserts a newline. This listener captures
// taps on the send button and routes them through the same orchestrator.
//
// We also listen for `touchend` because mobile browsers dispatch
// `click` ~300ms after `touchend` (the "fastclick" delay), and some
// users notice a visible delay. We debounce so a single user tap only
// triggers the orchestrator once regardless of which event fires first.
//
// Long-press (touchstart → 2s hold) queues the message instead of
// sending. We do NOT intercept that path; if the user explicitly
// queues a slash command, treat it as a queued message (preserves
// the user's intent). They can press send normally afterward to retry.
function installSendButtonInterceptor(
  _spindleCtx: SpindleFrontendContext
): () => void {
  const clickHandler = (e: MouseEvent) => {
    if (!isSendButtonClick(e)) return
    const ta = findChatMessageTextarea()
    if (!ta) return
    const value = ta.value
    if (!/\/select\b/i.test(value)) return
    tryInvokeSlashCommand(e, ta, value, _spindleCtx, 'click')
  }
  const touchEndHandler = (e: TouchEvent) => {
    if (!isSendButtonTouch(e)) return
    const ta = findChatMessageTextarea()
    if (!ta) return
    const value = ta.value
    if (!/\/select\b/i.test(value)) return
    // The synthetic click will follow ~300ms later. Mark the slash
    // command as already-invoked so the click handler no-ops.
    if (Date.now() - lastSlashInvocationAt < SLASH_DEBOUNCE_MS) return
    tryInvokeSlashCommand(e, ta, value, _spindleCtx, 'touchend')
  }

  // Capture phase so we see the event before Lumiverse's React onClick.
  document.addEventListener('click', clickHandler, true)
  document.addEventListener('touchend', touchEndHandler, true)

  return () => {
    document.removeEventListener('click', clickHandler, true)
    document.removeEventListener('touchend', touchEndHandler, true)
  }
}

/**
 * Check whether a mouse click event landed on Lumiverse's send button.
 * The send button is the textarea's container's `button[class*="sendBtn"]`.
 * Walks up from `e.target` to the nearest button, then checks the
 * send button contract.
 */
function isSendButtonClick(e: MouseEvent): boolean {
  const target = e.target as HTMLElement | null
  if (!target) return false
  const btn = target.closest('button')
  if (!btn || btn.disabled) return false
  return matchesSendButtonContract(btn)
}

/**
 * Check whether a touchend event landed on Lumiverse's send button.
 * `touchend` doesn't have a useful `target` for elements under the
 * finger (it's whatever was under the finger at touchstart). We
 * `document.elementFromPoint` the touch's last known coordinates.
 */
function isSendButtonTouch(e: TouchEvent): boolean {
  const t = e.changedTouches[0]
  if (!t) return false
  // After the touch ends, the element under the touch point is the
  // send button. Use elementFromPoint at the touch coordinates.
  const el = document.elementFromPoint(t.clientX, t.clientY)
  if (!el) return false
  const btn = (el as HTMLElement).closest('button')
  if (!btn || btn.disabled) return false
  return matchesSendButtonContract(btn)
}

/**
 * Verify a button is Lumiverse's send button. Strategy:
 *  1. className contains "sendBtn" (CSS-module hashed, stable prefix)
 *  2. OR it's a child of the same container as the textarea and is
 *     the last non-disabled button in that container (defensive
 *     fallback if the class name is ever refactored)
 */
function matchesSendButtonContract(btn: HTMLElement): boolean {
  if ((btn.className ?? '').toString().includes('sendBtn')) return true
  // Fallback: same container as the textarea, last button
  const ta = findChatMessageTextarea()
  if (!ta) return false
  const container = ta.closest('[class*="inputWrapper"]') ?? ta.parentElement
  if (!container) return false
  if (btn.closest('[class*="inputWrapper"]') !== container &&
      btn.parentElement !== container.parentElement) {
    return false
  }
  const buttons = Array.from(
    container.querySelectorAll<HTMLButtonElement>('button:not([disabled])')
  )
  return buttons.length > 0 && buttons[buttons.length - 1] === btn
}

function findChatMessageTextarea(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>(SELECTOR_TEXTAREA)
}

/**
 * Shared slash command invocation. Returns true if the event was
 * claimed (caller should stop propagation); false if it was a no-op
 * (debounce, missing context, etc).
 *
 * Used by both the keydown and click/touchend handlers to keep their
 * post-match behavior identical.
 */
function tryInvokeSlashCommand(
  e: Event,
  ta: HTMLTextAreaElement,
  value: string,
  spindleCtx: SpindleFrontendContext,
  source: 'keydown' | 'click' | 'touchend'
): void {
  // Debounce: if a slash command ran very recently, drop this one.
  // This catches desktop cases where the keydown handler fires first,
  // then the user also taps the send button within the same gesture.
  const now = Date.now()
  if (now - lastSlashInvocationAt < SLASH_DEBOUNCE_MS) {
    // Still claim the event so Lumiverse's handler doesn't fire either.
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
    return
  }
  lastSlashInvocationAt = now

  // Match confirmed — prevent Lumiverse from sending.
  e.preventDefault()
  e.stopPropagation()
  e.stopImmediatePropagation()

  // Clear the textarea (Lumiverse's handler hasn't run, so we own this).
  // Use rAF to avoid race with any synchronous handler.
  requestAnimationFrame(() => {
    ta.value = ''
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })

  const chatId = resolveActiveChatId(spindleCtx)
  if (!chatId) {
    toast(spindleCtx, 'error', 'Could not determine active chat.')
    return
  }
  state.chatId = chatId
  const args = parseSelectArgs(value)
  // Source is captured for future telemetry / debugging. Currently unused.
  void source
  void handleSelectArgs(spindleCtx, args)
}

// ── Argument handling ──────────────────────────────────────────────

async function handleSelectArgs(
  ctx: SpindleFrontendContext,
  args: SelectArgs
): Promise<void> {
  if (args.kind === 'error') {
    toast(ctx, 'error', `Invalid /select: ${args.reason}`)
    return
  }
  const chatId = state.chatId
  if (!chatId) return

  if (args.kind === 'clear') {
    clearSelectionInDom()
    state.pendingVisualIndices.clear()
    toast(ctx, 'info', 'Selection cleared.')
    return
  }

  if (args.kind === 'all') {
    selectAllLoaded()
    state.pendingVisualIndices.clear()
    const count = getLoadedSelectedCount()
    toast(ctx, 'success', `Selected ${count} loaded message${count === 1 ? '' : 's'}.`)
    return
  }

  // args.kind === 'range'
  applyRangeReplace(ctx, args.indices)
}

/**
 * Replace the current selection with the given range.
 *
 * 1. Clear existing loaded selection.
 * 2. Enter select mode if not already.
 * 3. For each requested index: dispatch a click on the loaded row whose
 *    visual number matches (if present in DOM). Otherwise, add to pending.
 * 4. Show toast: "N loaded (M pending — scroll up to load)".
 */
function applyRangeReplace(
  ctx: SpindleFrontendContext,
  indices: Set<number>
): void {
  // 1. Clear existing selection
  clearSelectionInDom()

  // 2. Enter select mode if not already
  if (!isSelectModeActive()) {
    ensureSelectMode()
  }

  // 3. Walk the DOM and dispatch clicks for matches; defer the rest to pending
  const loadedRows = document.querySelectorAll<HTMLElement>(SELECTOR_ROW)
  const foundIndices = new Set<number>()

  for (const row of Array.from(loadedRows)) {
    const idx = readIndexInChat(row)
    if (idx === null) continue
    if (!indices.has(idx)) continue
    foundIndices.add(idx)
    dispatchClick(row)
  }

  // Pending = original indices minus the ones we found a row for
  state.pendingVisualIndices.clear()
  for (const i of indices) {
    if (!foundIndices.has(i)) state.pendingVisualIndices.add(i)
  }

  const loadedCount = foundIndices.size
  const pendingCount = state.pendingVisualIndices.size
  if (loadedCount === 0 && pendingCount === 0) {
    toast(ctx, 'error', 'No messages matched the range.')
    return
  }
  if (pendingCount === 0) {
    toast(
      ctx,
      'success',
      `Selected ${loadedCount} message${loadedCount === 1 ? '' : 's'}.`
    )
  } else {
    toast(
      ctx,
      'success',
      `Selected ${loadedCount} (${pendingCount} pending — scroll up to load).`
    )
  }
}

// ── DOM click dispatch ─────────────────────────────────────────────

function dispatchClick(row: HTMLElement): void {
  // Bubble-phase click on the row. Lumiverse's MessageCard onClick (or
  // MinimalMessageDefault onClick) fires in the bubble phase and calls
  // `toggleMessageSelect(message.id)`. We do NOT stopPropagation, so all
  // other Lumiverse behavior (range, mobile, context menu guards) continues
  // to work normally.
  row.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, view: window })
  )
}

// ── Selection state mutations (best-effort, DOM-driven) ────────────

/**
 * Clear the current loaded selection by clicking every selected row.
 * Lumiverse's `toggleMessageSelect` flips the bit, so clicking a selected
 * row deselects it.
 */
function clearSelectionInDom(): void {
  const rows = document.querySelectorAll<HTMLElement>(SELECTOR_ROW)
  for (const row of Array.from(rows)) {
    // The "selected" class is applied to the message card (a child of the
    // row) in select mode. Walk the row's descendants to find it.
    if (rowHasSelectedClass(row)) {
      dispatchClick(row)
    }
  }
}

function selectAllLoaded(): void {
  const rows = document.querySelectorAll<HTMLElement>(SELECTOR_ROW)
  for (const row of Array.from(rows)) {
    dispatchClick(row)
  }
}

function getLoadedSelectedCount(): number {
  // Count rows that have a descendant with the "selected" class.
  const rows = document.querySelectorAll<HTMLElement>(SELECTOR_ROW)
  let n = 0
  for (const row of Array.from(rows)) {
    if (rowHasSelectedClass(row)) n++
  }
  return n
}

/**
 * Check whether a [data-message-id] row currently has the "selected" class
 * applied (either on itself or any descendant).
 *
 * The "selected" class is hashed by CSS modules (e.g. "selected_x7y2z"), so
 * we match via [class*="selected"].
 */
function rowHasSelectedClass(row: HTMLElement): boolean {
  if ((row.className ?? '').toString().includes('selected')) return true
  return row.querySelector('[class*="selected"]') !== null
}

// ── Select mode detection & toggle ─────────────────────────────────

function isSelectModeActive(): boolean {
  return document.querySelector(`[${SELECT_MODE_ATTR}="true"]`) !== null
}

function ensureSelectMode(): void {
  if (isSelectModeActive()) return
  const btn = findSelectModeToggle()
  if (btn) {
    btn.click()
  }
  // Note: we don't await the state change. Lumiverse will flip
  // data-select-mode="true" on the next tick; our subsequent click
  // dispatches will work because `MessageCard.handleSelectClick` only
  // runs when `messageSelectMode` is true, but the click handler will
  // queue the action in React's event system until the next render.
}

function findSelectModeToggle(): HTMLButtonElement | null {
  // Heuristic: a button whose title contains "select" (case-insensitive)
  // and lives near [data-select-mode] (i.e. in the chat toolbar).
  const candidates = document.querySelectorAll<HTMLButtonElement>(
    'button[title*="select" i]'
  )
  for (const btn of Array.from(candidates)) {
    if (btn.closest(`[${SELECT_MODE_ATTR}]`)) return btn
  }
  // Fallback: any button with select in title
  return candidates[0] ?? null
}

// ── Pending observer ───────────────────────────────────────────────

function installPendingObserver(): MutationObserver {
  const observer = new MutationObserver((mutations) => {
    if (state.pendingVisualIndices.size === 0) return
    for (const m of mutations) {
      for (const node of Array.from(m.addedNodes)) {
        if (!(node instanceof HTMLElement)) continue
        // The observer fires for the row and its descendants. We only care
        // about [data-message-id] elements.
        const rows = node.matches(SELECTOR_ROW)
          ? [node]
          : Array.from(node.querySelectorAll<HTMLElement>(SELECTOR_ROW))
        for (const row of rows) {
          const idx = readIndexInChat(row)
          if (idx === null) continue
          if (!state.pendingVisualIndices.has(idx)) continue
          state.pendingVisualIndices.delete(idx)
          dispatchClick(row)
        }
      }
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
  return observer
}

// ── Bulk-action observer (auto-resolve pending) ────────────────────
//
// Not installed by default. Lumiverse's Delete button opens a confirmation
// modal, so the "click → bulk action" chain isn't a single DOM event we
// can observe reliably. The user accepts the trade-off: scroll up to
// load pending messages before issuing bulk-hide/delete, or call
// `installBulkActionObserver` from setup() to opt in.
//
// Kept here for future use. Not exported to keep the public surface small.
//
// (Implementation removed in commit 35d620e — see plan Task 7.)

// ── Chat ID resolution ─────────────────────────────────────────────

/**
 * Resolve the active chat ID from the Spindle frontend context. Falls back
 * to URL scraping if the context doesn't expose it.
 */
function resolveActiveChatId(ctx: SpindleFrontendContext): string | null {
  // Preferred: use the built-in Spindle helper (clean, but not always available)
  const chat = (ctx as unknown as { getActiveChat?: () => { chatId: string | null } })
    .getActiveChat?.()
  if (chat && typeof chat.chatId === 'string' && chat.chatId.length > 0) {
    return chat.chatId
  }
  // Fallback: URL pattern /chat/:chatId
  const m = window.location.pathname.match(/\/chat\/([^/]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

// ── Toasts ─────────────────────────────────────────────────────────

/**
 * Show a toast to the user. The Spindle frontend context doesn't expose
 * a direct toast API (the `spindle.toast` lives in the backend context).
 * We dispatch a custom DOM event that main.tsx can listen to and render
 * via the existing Chronicle SummaryToast component.
 *
 * When called without a context (e.g. unit tests), falls back to console.
 */
function toast(
  ctx: SpindleFrontendContext | null,
  kind: 'success' | 'error' | 'info' | 'warning',
  message: string
): void {
  // Best-effort: check if the Spindle runtime injected a global toast helper
  // (some Lumiverse versions expose one on the global scope).
  const g = globalThis as unknown as { __spindleToast?: (k: string, m: string) => void }
  if (g.__spindleToast) {
    g.__spindleToast(kind, message)
    return
  }
  // Dispatch a custom event for main.tsx to pick up
  window.dispatchEvent(
    new CustomEvent(TOAST_EVENT, { detail: { kind, message, source: 'select-range' } })
  )
  // Reference ctx to keep it in the signature (and for potential future use)
  void ctx
}

// Re-export API base for diagnostics / debugging
export { getApiBase }
