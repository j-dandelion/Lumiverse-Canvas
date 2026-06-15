// Slash command "intent" — the authoritative source for dispatch, owned by
// canvas-ext (not the DOM, not React state). Set whenever a slash command is
// "committed" (clicked, Enter'd, Tab'd) and consumed on dispatch. Survives
// the React controlled-component reconciliation race on mobile send because
// it's a module-level variable, not a DOM/React state.
import type { ParsedCommand } from './parse'

export type IntentSource = 'click' | 'enter-popup' | 'enter-direct' | 'tab' | 'setText'

export interface SlashIntent {
  command: ParsedCommand
  committedAt: number
  source: IntentSource
}

let _intent: SlashIntent | null = null
// Safety-net TTL: a stale intent should not survive a walk-away-and-come-back.
// 5 min is well over any reasonable user flow. The intent is consumed on
// dispatch, so this is only a backstop, not a race participant.
const INTENT_TTL_MS = 5 * 60 * 1000

export function setIntent(command: ParsedCommand, source: IntentSource): void {
  _intent = { command, committedAt: Date.now(), source }
}

export function getIntent(): SlashIntent | null {
  if (!_intent) return null
  if (Date.now() - _intent.committedAt > INTENT_TTL_MS) {
    _intent = null
    return null
  }
  return _intent
}

export function clearIntent(): void {
  _intent = null
}

/**
 * Reconcile the intent with the textarea's current value. Called from the
 * intercept's inputHandler on every text change.
 *
 * - If the textarea still begins with the intent's command name, keep the
 *   intent (the user may be typing args after it).
 * - If the user has moved on (different command, cleared textarea, etc.),
 *   clear the intent so a future send-tap doesn't dispatch a stale command.
 */
export function reconcileWithTextarea(text: string): void {
  if (!_intent) return
  if (text.startsWith('/' + _intent.command.name)) return
  _intent = null
}

/** Test seam: reset module state. Called by intercept teardown and tests. */
export function __resetIntentForTest(): void {
  _intent = null
}
