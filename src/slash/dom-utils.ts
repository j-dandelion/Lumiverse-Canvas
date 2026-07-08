// Pure-DOM autocomplete helper + skip-flag state for slash-suggestion
// keyboard handlers. Zero imports from other canvas modules so intercept.ts
// and suggest.ts can both depend on this file without forming an import
// cycle (intercept.ts → suggest.ts already exists; adding the reverse would
// create a cycle).

let _skipNextTextChange = false

/**
 * Normalize a slash-command label, write it into the textarea with a
 * trailing space, fire a synthetic `input` event, and park the cursor
 * at the end. The input handler in intercept.ts reads + clears the
 * skip flag via consumeSkipNextTextChange() so the runtime's
 * onTextChange doesn't re-show the popup with the freshly-committed
 * command.
 *
 * Used by all three selection paths — Enter, Tab, and click — to
 * guarantee a single, consistent contract:
 *   - textarea contents become `${label} ` (always trailing space)
 *   - cursor lands after the space (ready for args or Enter-again)
 *   - the next onTextChange is suppressed
 */
export function applySuggestion(
  ta: HTMLTextAreaElement,
  label: string,
): void {
  // Defensive: ensure label starts with '/' even if a future command
  // sets `usage` to a string without a leading slash. All current
  // commands do, but parseCommand rejects strings that don't start
  // with '/', and the user contract is "press Enter twice to send,"
  // so the label MUST be parseable on the second Enter.
  const normalized = label.startsWith('/') ? label : `/${label}`
  _skipNextTextChange = true
  setControlledValue(ta, `${normalized} `)
  ta.setSelectionRange(ta.value.length, ta.value.length)
}

/**
 * Set a controlled-input value in a way that keeps React's state in sync.
 * Uses the prototype's native value setter (bypasses any installed setter
 * for proper _valueTracker behavior), then dispatches a synthetic input
 * event so React's onChange handler runs.
 *
 * This is the standard React 16-18 controlled-input workaround. Without
 * it, `ta.value = "..."` can leave React's _valueTracker stale, causing
 * the next render to overwrite the DOM value with the previous React state.
 *
 * Use this for ALL canvas-ext writes to the chat textarea — applySuggestion,
 * the SlashContext.setText helper exposed to slash command handlers, and
 * any future code that needs to programmatically set the chat input.
 */
export function setControlledValue(ta: HTMLTextAreaElement, value: string): void {
  const proto = Object.getPrototypeOf(ta)
  const desc = Object.getOwnPropertyDescriptor(proto, 'value')
  if (desc?.set) {
    desc.set.call(ta, value)
  } else {
    ta.value = value
  }
  ta.dispatchEvent(new Event('input', { bubbles: true }))
}

/**
 * Set the skip flag so the next onTextChange is suppressed. Used by
 * intercept.ts when clearing the textarea synchronously — the synthetic
 * input event would otherwise re-trigger the popup.
 */
export function setSkipNextTextChange(): void {
  _skipNextTextChange = true
}

/**
 * Read and clear the skip flag. Called by intercept.ts's inputHandler;
 * returns true if the next onTextChange should be suppressed.
 */
export function consumeSkipNextTextChange(): boolean {
  if (_skipNextTextChange) {
    _skipNextTextChange = false
    return true
  }
  return false
}

/** Reset the flag to false (called on teardown). */
export function resetSkipNextTextChange(): void {
  _skipNextTextChange = false
}

/**
 * True iff the textarea's current value starts with '/'.
 *
 * Slash-suggestion autocomplete is only valid when the slash token is at
 * column 0 — this mirrors the parseCommand contract (parse.ts requires
 * `input.startsWith('/')` and matches `^/...$`). The "hello /sel" case
 * (slash mid-text) is forbidden: the popup is dismissed without modifying
 * the value, and the key event falls through to default behavior.
 *
 * Used by all three selection paths — Enter, Tab, and click — to enforce
 * the rule consistently. Centralizing it here keeps the call sites in
 * sync; a future change to the rule (e.g., relax to "first non-whitespace
 * token is /") is a one-line edit.
 */
export function isValidSlashContext(ta: HTMLTextAreaElement): boolean {
  return ta.value.startsWith('/')
}

/**
 * Index of the first command in `matches` whose usage strictly extends
 * `text` (i.e., `text` is a prefix of the usage, and the usage is
 * longer). Returns -1 if no such command exists.
 *
 * Used by the runtime to promote a completion candidate to the active
 * row when the user has typed past the command name into the args
 * (e.g., typing `/select a` should highlight `/select all`).
 *
 * Pure function — testable without a DOM.
 */
export function findCompletionCandidateIndex(
  matches: { usage?: string; name: string }[],
  text: string,
): number {
  // Completion candidates only apply once the user has typed past the
  // command name into the args. The space is the delimiter between the
  // command name and the args, so a typed text with no space is still
  // in the command-name portion — the bare command should stay active
  // (e.g., typing `/select` keeps `/select` highlighted, not
  // `/select all`).
  if (!text.includes(' ')) return -1
  // No candidate when the arg part is whitespace-only. The user hasn't
  // typed a single arg char yet — promoting `/select ` to `/select all`
  // is presumptuous. Promotion requires a non-whitespace arg char.
  const argPart = text.slice(text.indexOf(' ') + 1)
  if (argPart.trim().length === 0) return -1
  const textLower = text.toLowerCase()
  for (let i = 0; i < matches.length; i++) {
    const usage = (matches[i].usage ?? `/${matches[i].name}`).toLowerCase()
    if (usage.length > textLower.length && usage.startsWith(textLower)) {
      return i
    }
  }
  return -1
}

/**
 * True iff the textarea already contains the active command's full
 * `usage` (with possible trailing whitespace) — i.e., the user has the
 * complete command in place, possibly followed by extra args. In that
 * case Enter/Tab/click should be a no-op: don't overwrite the user's
 * typed args or re-insert the trailing space.
 *
 * Equality (textarea == usage) is NOT a no-op — autocomplete should
 * add the trailing space and park the cursor there, so the user can
 * type args or press Enter-again-to-send. This is the "first Enter
 * after the bare command" case.
 *
 * Case-insensitive on the usage prefix (mirrors the prefix filter in
 * runtime.ts: `c.name.toLowerCase().startsWith(prefix)`), but the
 * whitespace check is on the original-case character so that e.g.
 * `/SELECT\r\n` (carriage return/linefeed) is still recognized as
 * whitespace.
 *
 * Pure function — testable without a DOM.
 */
export function textareaHasUsage(
  ta: HTMLTextAreaElement,
  activeCmd: { name: string; usage?: string },
): boolean {
  const usage = (activeCmd.usage ?? `/${activeCmd.name}`).toLowerCase()
  const value = ta.value.toLowerCase()
  // No-op only when the textarea extends past the usage with at least
  // one trailing whitespace char (so the usage is a complete token,
  // not e.g. `/select` embedded in `/selection`). Equality is excluded
  // — autocomplete should add the trailing space.
  if (value.length > usage.length && value.startsWith(usage)) {
    const nextChar = ta.value[usage.length]
    return /\s/.test(nextChar)
  }
  return false
}

/**
 * True iff the slash-suggestion popup should be hidden because the user
 * has typed past the command name into the args, but no command's usage
 * extends the typed text.
 *
 * Covers:
 *   - `/select 1`     — user typing a range, not a keyword → hide
 *   - `/select 1-3`   — same
 *   - `/select all`   — complete command, no suggestions needed → hide
 *   - `/select all `  — same, with trailing space
 *
 * When the typed text has no space (user is still in command-name mode),
 * this returns false — the popup should show with the default active row
 * (the user is browsing command names).
 *
 * The caller passes `hasCompletionCandidate` — the result of
 * `findCompletionCandidateIndex(...) >= 0` — so this function stays
 * a pure decision over (text, candidate-exists).
 */
export function shouldHideForNonMatchingArgs(
  text: string,
  hasCompletionCandidate: boolean,
): boolean {
  // No hide in command-name mode (no space) — the user is browsing.
  const spaceIdx = text.indexOf(' ')
  if (spaceIdx < 0) return false
  // No hide when the arg part is whitespace-only — the user hasn't
  // typed a single arg char yet. Mirrors findCompletionCandidateIndex.
  const argPart = text.slice(spaceIdx + 1)
  if (argPart.trim().length === 0) return false
  return !hasCompletionCandidate
}

// --- resolveActiveIndex ---

export interface ActiveIndexResolution {
  /** Index into matches to pass to showSuggest. Always >= 0. */
  activeIndex: number
  /** New value for the runtime's lastActiveIndex closure. null = reset sticky. */
  nextSticky: number | null
}

/**
 * Pure decision: given the typed text, the candidate matches, and the
 * previous sticky index, return the index that should be highlighted in
 * the popup AND the next sticky value.
 *
 * Rules (must preserve existing behavior):
 *   1. If a completion candidate exists (findCompletionCandidateIndex >= 0),
 *      promote it: activeIndex = completionIdx, nextSticky = completionIdx.
 *   2. Else if lastSticky is in-range, the typed text has a space, AND the
 *      arg part has at least one non-whitespace char: keep the sticky index.
 *      (Backspacing/typing within a partial non-whitespace arg must not
 *      snap back to row 0.)
 *   3. Else: reset to defaults — activeIndex = 0, nextSticky = null.
 *
 * This is the testable core of the runtime's onTextChange active-index
 * decision. Extracted so we can assert the keystroke sequence in tests
 * without spinning up a fake DOM.
 */
export function resolveActiveIndex(
  matches: { name: string; usage?: string }[],
  text: string,
  lastSticky: number | null,
): ActiveIndexResolution {
  const completionIdx = findCompletionCandidateIndex(matches, text)
  if (completionIdx >= 0) {
    return { activeIndex: completionIdx, nextSticky: completionIdx }
  }
  if (
    lastSticky != null &&
    lastSticky >= 0 &&
    lastSticky < matches.length &&
    text.includes(' ') &&
    text.slice(text.indexOf(' ') + 1).trim().length > 0
  ) {
    return { activeIndex: lastSticky, nextSticky: lastSticky }
  }
  return { activeIndex: 0, nextSticky: null }
}
