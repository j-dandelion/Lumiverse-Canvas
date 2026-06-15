// Tests for src/slash/intent.ts — slash command intent module.
// Uses the repo's custom assertion harness (no Jest/Vitest):
//   let passed/failed
//   function assert(cond, msg)

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}

import {
  setIntent,
  getIntent,
  clearIntent,
  reconcileWithTextarea,
  __resetIntentForTest,
} from '../intent'
import type { ParsedCommand } from '../parse'

// Clean state at the start
__resetIntentForTest()

// --- setIntent + getIntent round-trip ---

{
  const cmd: ParsedCommand = { name: 'select', args: 'all' }
  setIntent(cmd, 'click')
  const intent = getIntent()
  assert(intent !== null, 'getIntent returns non-null after setIntent')
  assert(intent!.command.name === 'select', 'command.name is "select"')
  assert(intent!.command.args === 'all', 'command.args is "all"')
  assert(intent!.source === 'click', 'source is "click"')
  assert(typeof intent!.committedAt === 'number', 'committedAt is a number')
  __resetIntentForTest()
}

// --- clearIntent clears ---

{
  const cmd: ParsedCommand = { name: 'help', args: '' }
  setIntent(cmd, 'enter-direct')
  assert(getIntent() !== null, 'getIntent returns non-null after setIntent')
  clearIntent()
  assert(getIntent() === null, 'getIntent returns null after clearIntent')
  __resetIntentForTest()
}

// --- getIntent returns null when no intent set ---

{
  assert(getIntent() === null, 'getIntent returns null when no intent set')
  __resetIntentForTest()
}

// --- reconcileWithTextarea keeps intent when textarea starts with command name ---

{
  const cmd: ParsedCommand = { name: 'select', args: '' }
  setIntent(cmd, 'click')
  reconcileWithTextarea('/select all')
  const intent = getIntent()
  assert(intent !== null, 'reconcileWithTextarea keeps intent when textarea starts with /select')
  assert(intent!.command.name === 'select', 'command.name still "select"')
  __resetIntentForTest()
}

// --- reconcileWithTextarea keeps intent when textarea is bare command ---

{
  const cmd: ParsedCommand = { name: 'select', args: '' }
  setIntent(cmd, 'click')
  reconcileWithTextarea('/select')
  assert(getIntent() !== null, 'reconcileWithTextarea keeps intent when textarea is bare /select')
  __resetIntentForTest()
}

// --- reconcileWithTextarea clears intent when textarea is empty ---

{
  const cmd: ParsedCommand = { name: 'select', args: '' }
  setIntent(cmd, 'click')
  reconcileWithTextarea('')
  assert(getIntent() === null, 'reconcileWithTextarea clears intent when textarea is empty')
  __resetIntentForTest()
}

// --- reconcileWithTextarea clears intent when textarea is different command ---

{
  const cmd: ParsedCommand = { name: 'select', args: '' }
  setIntent(cmd, 'click')
  reconcileWithTextarea('/help')
  assert(getIntent() === null, 'reconcileWithTextarea clears intent when textarea is /help (different command)')
  __resetIntentForTest()
}

// --- reconcileWithTextarea clears intent when textarea is plain text ---

{
  const cmd: ParsedCommand = { name: 'select', args: '' }
  setIntent(cmd, 'click')
  reconcileWithTextarea('hello world')
  assert(getIntent() === null, 'reconcileWithTextarea clears intent when textarea is plain text')
  __resetIntentForTest()
}

// --- reconcileWithTextarea is a no-op when no intent ---

{
  // Should not throw
  reconcileWithTextarea('/select all')
  assert(getIntent() === null, 'reconcileWithTextarea is no-op when no intent set')
  __resetIntentForTest()
}

// --- __resetIntentForTest resets state ---

{
  const cmd: ParsedCommand = { name: 'select', args: '' }
  setIntent(cmd, 'click')
  assert(getIntent() !== null, 'getIntent returns non-null before reset')
  __resetIntentForTest()
  assert(getIntent() === null, 'getIntent returns null after __resetIntentForTest')
}

// --- Multiple set/get cycles (state is clean between resets) ---

{
  const cmd1: ParsedCommand = { name: 'select', args: 'all' }
  const cmd2: ParsedCommand = { name: 'help', args: '' }
  setIntent(cmd1, 'click')
  assert(getIntent()!.command.name === 'select', 'first set: name is "select"')
  clearIntent()
  setIntent(cmd2, 'tab')
  assert(getIntent()!.command.name === 'help', 'second set: name is "help"')
  assert(getIntent()!.source === 'tab', 'second set: source is "tab"')
  __resetIntentForTest()
}

// --- Intent with various sources ---

{
  const cmd: ParsedCommand = { name: 'select', args: '' }
  setIntent(cmd, 'enter-popup')
  assert(getIntent()!.source === 'enter-popup', 'source "enter-popup" round-trips')
  __resetIntentForTest()

  setIntent(cmd, 'enter-direct')
  assert(getIntent()!.source === 'enter-direct', 'source "enter-direct" round-trips')
  __resetIntentForTest()

  setIntent(cmd, 'tab')
  assert(getIntent()!.source === 'tab', 'source "tab" round-trips')
  __resetIntentForTest()

  setIntent(cmd, 'setText')
  assert(getIntent()!.source === 'setText', 'source "setText" round-trips')
  __resetIntentForTest()
}

// --- reconcileWithTextarea with empty command name (edge case) ---

{
  // parseCommand won't produce an empty name, but let's verify the reconcile
  // function handles it gracefully.
  __resetIntentForTest()
  const cmd: ParsedCommand = { name: '', args: '' }
  setIntent(cmd, 'click')
  // text.startsWith('/' + '') === text.startsWith('/')
  reconcileWithTextarea('/ anything')
  // The empty name means the command is '/', so '/ anything' starts with '/' → keep
  assert(getIntent() !== null, 'reconcileWithTextarea keeps intent when command name is empty and text starts with /')
  __resetIntentForTest()
}

if (failed > 0) { console.error(`FAILED: ${failed}`); throw new Error(`${failed} test failures`) }
console.log(`PASS: ${passed}`)
