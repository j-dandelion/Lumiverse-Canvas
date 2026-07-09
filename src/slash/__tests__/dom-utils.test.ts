// Tests for src/slash/dom-utils.ts — autocomplete helper + skip flag.
// Uses the repo's custom assertion harness (no Jest/Vitest):
//   let passed/failed
//   function assert(cond, msg)
//
// Bun's test runner (v1.3.14) does NOT provide browser globals like
// `document` in `bun test` mode. We mock just enough of HTMLTextAreaElement
// to exercise the helper's contract:
//   - read+write `value`
//   - `setSelectionRange(n, n)` (we record the call, don't need real cursor)
//   - `dispatchEvent` (a no-op stub; we don't assert it directly)
//
// `applySuggestion` only touches these three, so a typed mock is sufficient.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}

import {
  applySuggestion,
  consumeSkipNextTextChange,
  findCompletionCandidateIndex,
  isValidSlashContext,
  resolveActiveIndex,
  resetSkipNextTextChange,
  shouldHideForNonMatchingArgs,
  suggestionLabel,
  textareaHasUsage,
} from '../dom-utils'

/** Minimal textarea mock — only the surface area applySuggestion uses. */
function mockTa(initial = ''): HTMLTextAreaElement {
  const ta: Partial<HTMLTextAreaElement> = {
    value: initial,
    selectionStart: initial.length,
    selectionEnd: initial.length,
    setSelectionRange(start: number, end: number) {
      this.selectionStart = start
      this.selectionEnd = end
    },
    dispatchEvent(_event: Event): boolean {
      return true
    },
  }
  return ta as HTMLTextAreaElement
}

// Clean state at the start (defensive — in case another test file in the
// same bun test process left the flag set).
resetSkipNextTextChange()

// --- applySuggestion basics ---

{
  const ta = mockTa('/se')
  applySuggestion(ta, '/select')

  assert(ta.value === '/select ', 'value is label + trailing space')
  assert(ta.selectionStart === ta.value.length, 'cursor at end of value')
  assert(ta.selectionEnd === ta.value.length, 'selectionEnd at end of value')
  assert(consumeSkipNextTextChange() === true, 'skip flag set by applySuggestion')
  // consume cleared it
  assert(consumeSkipNextTextChange() === false, 'skip flag cleared after consume')
}

// --- Defensive label normalization (reviewer concern #5) ---

{
  const ta = mockTa('')
  applySuggestion(ta, 'select')
  assert(ta.value === '/select ', 'label without leading / gets / prepended')
}

// --- resetSkipNextTextChange ---

{
  const ta = mockTa('')
  applySuggestion(ta, '/help')
  assert(consumeSkipNextTextChange() === true, 'flag set after apply')
  resetSkipNextTextChange()
  assert(consumeSkipNextTextChange() === false, 'reset clears flag')
}

// --- Multiple applies (last write wins, flag is single-shot) ---

{
  const ta = mockTa('')
  applySuggestion(ta, '/a')
  applySuggestion(ta, '/b')
  assert(ta.value === '/b ', 'second call overwrites first')
  assert(consumeSkipNextTextChange() === true, 'flag set (single consume for two applies)')
  assert(consumeSkipNextTextChange() === false, 'flag consumed and cleared')
}

// --- Existing content is overwritten (the bug fix) ---

{
  const ta = mockTa('hello /sel')
  applySuggestion(ta, '/select')
  assert(ta.value === '/select ', 'overwrites arbitrary existing content')
}

// --- isValidSlashContext (the slash-at-column-0 rule) ---

{
  const ta = mockTa('/sel')
  assert(isValidSlashContext(ta) === true, '/sel: starts with / → valid')
}
{
  const ta = mockTa('hello /sel')
  assert(isValidSlashContext(ta) === false, 'hello /sel: mid-text / → invalid (forbidden case)')
}
{
  const ta = mockTa('')
  assert(isValidSlashContext(ta) === false, 'empty: invalid')
}
{
  const ta = mockTa('/')
  assert(isValidSlashContext(ta) === true, '/: single slash → valid (parseCommand rejects, but rule is just startsWith)')
}
{
  const ta = mockTa(' /sel')
  assert(isValidSlashContext(ta) === false, 'leading whitespace: invalid (mirrors parseCommand)')
}

// --- findCompletionCandidateIndex ---

{
  // Synthetic multi-token usage exercises promotion; real select-clear is hyphenated.
  const matches = [
    { name: 'select', usage: '/select' },
    { name: 'select-all', usage: '/select-all' },
    { name: 'select-clear', usage: '/select-clear' },
    { name: 'foo', usage: '/foo bar' },
  ]
  // /foo b: typed text is a prefix of /foo bar → completion
  assert(
    findCompletionCandidateIndex(matches, '/foo b') === 3,
    '/foo b: /foo bar is the completion candidate (index 3)',
  )
  // /select 1-3: no usage extends it → -1
  assert(
    findCompletionCandidateIndex(matches, '/select 1-3') === -1,
    '/select 1-3: no completion candidate',
  )
  // /sel (no space, partial name): no completion candidate.
  // The user is still in the command-name portion — no space yet.
  assert(
    findCompletionCandidateIndex(matches, '/sel') === -1,
    '/sel (no space): no completion candidate',
  )
  // /select  (trailing space, whitespace-only arg): no promotion — user
  // hasn't typed a single arg char yet. Promoting is presumptuous.
  assert(
    findCompletionCandidateIndex(matches, '/select ') === -1,
    '/select  (trailing space, whitespace-only arg): -1 — no promotion',
  )
  // /select   (multiple trailing spaces): also whitespace-only arg → -1
  assert(
    findCompletionCandidateIndex(matches, '/select  ') === -1,
    '/select   (multiple trailing spaces): -1',
  )
  // /select\t (tab as whitespace): also whitespace-only arg → -1
  assert(
    findCompletionCandidateIndex(matches, '/select\t') === -1,
    '/select\\t (tab as whitespace): -1',
  )
  // /help: matches.length === 0 in the prefix filter; but the function
  // itself only checks usage.startsWith. /help usage is /help; /help
  // starts with /help and is same length → not strictly longer → -1.
  assert(
    findCompletionCandidateIndex([{ name: 'help', usage: '/help' }], '/help') === -1,
    '/help: usage is not strictly longer than text',
  )
  // Case-insensitive multi-token
  assert(
    findCompletionCandidateIndex(matches, '/FOO B') === 3,
    '/FOO B: case-insensitive match for /foo bar',
  )
  // No matches
  assert(
    findCompletionCandidateIndex([], '/select') === -1,
    'empty matches: -1',
  )
  // /select (no space, command name complete): no completion candidate.
  // The bare /select should stay active, not /select-all.
  assert(
    findCompletionCandidateIndex(matches, '/select') === -1,
    '/select (no space): no completion candidate, bare /select stays active',
  )
  // /selec (no space, partial name): no completion candidate.
  assert(
    findCompletionCandidateIndex(matches, '/selec') === -1,
    '/selec (no space): no completion candidate',
  )
  // /sel (no space, partial name): no completion candidate.
  assert(
    findCompletionCandidateIndex(matches, '/sel') === -1,
    '/sel (no space): no completion candidate',
  )
  // /foo bar (complete multi-token usage): no usage strictly extends it.
  assert(
    findCompletionCandidateIndex(matches, '/foo bar') === -1,
    '/foo bar: no candidate (usage same length, not strictly longer)',
  )
  // /select-clear (no space): still command-name mode for findCompletion
  assert(
    findCompletionCandidateIndex(matches, '/select-clear') === -1,
    '/select-clear (no space): no completion candidate',
  )
  // /select-all (no space): still command-name mode for findCompletion
  assert(
    findCompletionCandidateIndex(matches, '/select-all') === -1,
    '/select-all (no space): no completion candidate',
  )
}

// --- textareaHasUsage ---

// No-op when textarea extends past the usage with at least one whitespace
// char (the "user has the full command plus args" case).
{
  const ta = mockTa('/select 1-3')
  assert(
    textareaHasUsage(ta, { name: 'select', usage: '/select' }) === true,
    '/select 1-3 + select(usage=/select): no-op (textarea extends past usage with space)',
  )
  assert(
    textareaHasUsage(ta, { name: 'select-all', usage: '/select-all' }) === false,
    '/select 1-3 + select-all: not no-op (different usage)',
  )
  assert(
    textareaHasUsage(ta, { name: 'help', usage: '/help' }) === false,
    '/select 1-3 + help: not no-op (different usage)',
  )
}
{
  const ta = mockTa('/select a')
  assert(
    textareaHasUsage(ta, { name: 'select', usage: '/select' }) === true,
    '/select a + select(usage=/select): no-op (textarea extends past usage with space)',
  )
  assert(
    textareaHasUsage(ta, { name: 'select-all', usage: '/select-all' }) === false,
    '/select a + select-all: not no-op (different usage)',
  )
}

// Equality (textarea == usage) is NOT a no-op — autocomplete should
// add the trailing space. This is the "first Enter after the bare
// command" case the user reported.
{
  const ta = mockTa('/select')
  assert(
    textareaHasUsage(ta, { name: 'select', usage: '/select' }) === false,
    '/select + select: textarea == usage, NOT no-op (autocomplete adds space)',
  )
}

// Trailing-space variant: textarea extends past usage with whitespace.
{
  const ta = mockTa('/select ')
  assert(
    textareaHasUsage(ta, { name: 'select', usage: '/select' }) === true,
    '/select  + select: no-op (already has trailing space)',
  )
}

// /select-all (no trailing space) — equality with select-all usage, NOT no-op.
{
  const ta = mockTa('/select-all')
  assert(
    textareaHasUsage(ta, { name: 'select-all', usage: '/select-all' }) === false,
    '/select-all + select-all: textarea == usage, NOT no-op (autocomplete adds space)',
  )
}

// Empty textarea
{
  const ta = mockTa('')
  assert(
    textareaHasUsage(ta, { name: 'select', usage: '/select' }) === false,
    'empty + select: not no-op',
  )
}

// Different first word — textarea does not start with usage
{
  const ta = mockTa('hello /sel')
  assert(
    textareaHasUsage(ta, { name: 'select', usage: '/select' }) === false,
    'hello /sel + select: not no-op (textarea does not start with usage)',
  )
}

// No `usage` field — falls back to `/${name}`
{
  const ta = mockTa('/help')
  assert(
    textareaHasUsage(ta, { name: 'help' }) === false,
    '/help + help(no usage field): textarea == fallback /help, NOT no-op',
  )
  const ta2 = mockTa('/help ')
  assert(
    textareaHasUsage(ta2, { name: 'help' }) === true,
    '/help  + help: no-op (extends past fallback usage with space)',
  )
}

// Textarea has /select followed by digit (no whitespace separator): not no-op.
// Clobbering `/select25` to `/select ` is acceptable — the user is mid-typing
// and will type a space next.
{
  const ta = mockTa('/select25')
  assert(
    textareaHasUsage(ta, { name: 'select', usage: '/select' }) === false,
    '/select25 + select: not no-op (no whitespace after usage)',
  )
}

// Case-insensitive prefix match
{
  const ta = mockTa('/SELECT 1')
  assert(
    textareaHasUsage(ta, { name: 'select', usage: '/select' }) === true,
    '/SELECT 1 + select(usage=/select): no-op (case-insensitive prefix)',
  )
}
{
  const ta = mockTa('/SELECT')
  assert(
    textareaHasUsage(ta, { name: 'select', usage: '/select' }) === false,
    '/SELECT + select: textarea == usage (case-insensitive), NOT no-op (autocomplete adds space)',
  )
}

// Whitespace check is on the original-case char, not the lowercased one.
// /SELECT\r\n: lowercase is /select\r\n; \r is whitespace → no-op.
{
  const ta = mockTa('/select\rfoo')
  assert(
    textareaHasUsage(ta, { name: 'select', usage: '/select' }) === true,
    '/select\\rfoo + select: no-op (\\r is whitespace)',
  )
}

// --- shouldHideForNonMatchingArgs ---

// Space present + no candidate → hide
assert(
  shouldHideForNonMatchingArgs('/select 1', false) === true,
  '/select 1 (space, no candidate): hide',
)
assert(
  shouldHideForNonMatchingArgs('/select 1-3', false) === true,
  '/select 1-3 (space, no candidate): hide',
)
assert(
  shouldHideForNonMatchingArgs('/select 1,5,10-12', false) === true,
  '/select 1,5,10-12 (space, no candidate): hide',
)
assert(
  shouldHideForNonMatchingArgs('/select all', false) === true,
  '/select all (space, no candidate — usage same length): hide',
)
assert(
  shouldHideForNonMatchingArgs('/select clear', false) === true,
  '/select clear (space, free-form args, no candidate): hide',
)
assert(
  shouldHideForNonMatchingArgs('/select all ', false) === true,
  '/select all  (trailing space, no candidate): hide',
)

// Whitespace-only arg + no candidate → show (user hasn't typed any arg char)
assert(
  shouldHideForNonMatchingArgs('/select ', false) === false,
  '/select  (space but whitespace-only arg, no candidate): show with default active',
)

// Space present + candidate → show (don't hide)
assert(
  shouldHideForNonMatchingArgs('/select ', true) === false,
  '/select  (space, candidate): show',
)
assert(
  shouldHideForNonMatchingArgs('/select a', true) === false,
  '/select a (space, candidate): show',
)
assert(
  shouldHideForNonMatchingArgs('/select c', true) === false,
  '/select c (space, candidate): show',
)
assert(
  shouldHideForNonMatchingArgs('/select cl', true) === false,
  '/select cl (space, candidate): show',
)

// No space (command-name mode) → show regardless of candidate
assert(
  shouldHideForNonMatchingArgs('/sel', false) === false,
  '/sel (no space, no candidate): show — command-name mode',
)
assert(
  shouldHideForNonMatchingArgs('/sel', true) === false,
  '/sel (no space, candidate): show — command-name mode',
)
assert(
  shouldHideForNonMatchingArgs('/select', false) === false,
  '/select (no space): show — command-name mode',
)

// --- resolveActiveIndex ---

const MATCHES = [
  { name: 'select', usage: '/select' },
  { name: 'select-all', usage: '/select-all' },
  { name: 'select-clear', usage: '/select-clear' },
  { name: 'foo', usage: '/foo bar' },
]

{
  // /select (no space, no candidate) → activeIndex 0, sticky null
  const r = resolveActiveIndex(MATCHES, '/select', null)
  assert(r.activeIndex === 0, '/select: activeIndex 0')
  assert(r.nextSticky === null, '/select: sticky null')
}
{
  // /select  (space, whitespace-only arg, no candidate) → activeIndex 0, sticky null
  const r = resolveActiveIndex(MATCHES, '/select ', null)
  assert(r.activeIndex === 0, '/select  (whitespace arg): activeIndex 0')
  assert(r.nextSticky === null, '/select  (whitespace arg): sticky null')
}
{
  // /foo b (candidate idx 3 = /foo bar) → activeIndex 3, sticky 3
  const r = resolveActiveIndex(MATCHES, '/foo b', null)
  assert(r.activeIndex === 3, '/foo b: activeIndex 3')
  assert(r.nextSticky === 3, '/foo b: sticky 3')
}
{
  // /foo ba (still candidate idx 3) → activeIndex 3, sticky 3
  const r = resolveActiveIndex(MATCHES, '/foo ba', null)
  assert(r.activeIndex === 3, '/foo ba: activeIndex 3')
  assert(r.nextSticky === 3, '/foo ba: sticky 3')
}
{
  // /foo bar (no candidate, arg non-whitespace, sticky was 3) → keep sticky
  const r = resolveActiveIndex(MATCHES, '/foo bar', 3)
  assert(r.activeIndex === 3, '/foo bar: activeIndex kept 3')
  assert(r.nextSticky === 3, '/foo bar: sticky kept 3')
}
{
  // /foo bar  (trailing space after completed arg) — arg is non-whitespace
  // so sticky is preserved. (In the real runtime, shouldHideForNonMatchingArgs
  // would hide the popup before reaching resolveActiveIndex, but this tests
  // the pure function's behavior directly.)
  const r = resolveActiveIndex(MATCHES, '/foo bar ', 3)
  assert(r.activeIndex === 3, '/foo bar  (trailing space): sticky kept (arg non-whitespace)')
  assert(r.nextSticky === 3, '/foo bar  (trailing space): sticky 3')
}
{
  // /select (no space, no candidate, lastSticky = 3) → activeIndex 0, sticky null
  const r = resolveActiveIndex(MATCHES, '/select', 3)
  assert(r.activeIndex === 0, '/select (backspace): activeIndex 0')
  assert(r.nextSticky === null, '/select (backspace): sticky null')
}
{
  // Empty matches array → activeIndex 0, sticky null
  const r = resolveActiveIndex([], '/foo b', 3)
  assert(r.activeIndex === 0, 'empty matches: activeIndex 0')
  assert(r.nextSticky === null, 'empty matches: sticky null')
}
{
  // lastSticky out of range (e.g., 5, matches.length = 2) → activeIndex 0, sticky null
  const r = resolveActiveIndex(MATCHES.slice(0, 2), '/foo bar', 5)
  assert(r.activeIndex === 0, 'out-of-range sticky: activeIndex 0')
  assert(r.nextSticky === null, 'out-of-range sticky: sticky null')
}
{
  // Case-insensitive: /FOO B should still resolve to the candidate
  const r = resolveActiveIndex(MATCHES, '/FOO B', null)
  assert(r.activeIndex === 3, '/FOO B: activeIndex 3 (case-insensitive)')
  assert(r.nextSticky === 3, '/FOO B: sticky 3')
}
{
  // lastSticky = null, text = '/foo b' (no prior sticky) → activeIndex 3, sticky 3
  const r = resolveActiveIndex(MATCHES, '/foo b', null)
  assert(r.activeIndex === 3, '/foo b (null sticky): activeIndex 3')
  assert(r.nextSticky === 3, '/foo b (null sticky): sticky 3 (not null)')
}

// --- suggestionLabel (smoke; full coverage in suggestion-label.test.ts) ---

{
  assert(
    suggestionLabel({ name: 'select-all', usage: '/select-all' }) === '/select-all',
    'suggestionLabel prefers concrete hyphenated usage',
  )
  assert(
    suggestionLabel({ name: 'select-clear', usage: '/select-clear' }) === '/select-clear',
    'suggestionLabel prefers select-clear hyphenated usage',
  )
  assert(
    suggestionLabel({ name: 'foo', usage: '/foo bar' }) === '/foo bar',
    'suggestionLabel prefers concrete multi-token usage',
  )
  assert(
    suggestionLabel({ name: 'select', usage: '/select <range>' }) === '/select',
    'suggestionLabel falls back when usage has placeholders',
  )
}

if (failed > 0) { console.error(`FAILED: ${failed}`); throw new Error(`${failed} test failures`) }
console.log(`PASS: ${passed}`)
