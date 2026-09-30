// Start-menu shell-created wiring (2026-09-15).
//
// Live bug: enabling the second drawer while OS mode is already on created the
// secondary shell but never re-ran the Start-button ensure — `mountStartMenu`
// only runs on the OS toggle. The secondary strip had no Start button until
// the next OS enable/disable cycle. The menu now subscribes to
// `canvas:drawer-shell-created` (the signal panel-chrome already consumes) and
// re-runs the rAF-coalesced ensure pass; the listener must stay single across
// repeated mounts and be removed on teardown.

import {
  installShellCreatedListener,
  removeShellCreatedListener,
} from '../start-menu'

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) passed++
  else {
    failed++
    console.error('FAIL:', msg)
  }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) passed++
  else {
    failed++
    console.error(`FAIL: ${msg} — expected ${String(expected)}, got ${String(actual)}`)
  }
}

const SHELL_EVENT = 'canvas:drawer-shell-created'
const added: Array<{ type: string; fn: unknown }> = []
const removed: Array<{ type: string; fn: unknown }> = []
;(globalThis as any).window = {
  addEventListener: (type: string, fn: unknown) => { added.push({ type, fn }) },
  removeEventListener: (type: string, fn: unknown) => { removed.push({ type, fn }) },
  innerWidth: 1200,
  innerHeight: 900,
}

// ── W1: install registers exactly one listener for the shell event ──
{
  installShellCreatedListener()
  installShellCreatedListener() // idempotent — repeat mount must not duplicate
  const shellAdds = added.filter((e) => e.type === SHELL_EVENT)
  assertEqual(shellAdds.length, 1, 'W1: one shell-created listener')
  assert(typeof shellAdds[0]?.fn === 'function', 'W1: listener is callable')
}

// ── W2: teardown removes the registered listener ──
{
  const fn = added.find((e) => e.type === SHELL_EVENT)?.fn
  removeShellCreatedListener()
  const shellRemoves = removed.filter((e) => e.type === SHELL_EVENT)
  assertEqual(shellRemoves.length, 1, 'W2: listener removed')
  assert(shellRemoves[0]?.fn === fn, 'W2: same handler reference removed')

  // Re-install after teardown works (OS enable/disable cycles).
  installShellCreatedListener()
  assertEqual(added.filter((e) => e.type === SHELL_EVENT).length, 2, 'W2: re-install after teardown')
  removeShellCreatedListener()
}

console.log(`start-menu shell-event tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
export {}
