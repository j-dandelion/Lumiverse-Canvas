// Custom assertion harness — see Chronicle testing-conventions.md
// Pure-derivation tests for os/window-set.ts (the closed-set lives in the
// model; every function here takes its inputs explicitly).
let passed = 0
let failed = 0
function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    console.error(`FAIL: ${message} — expected ${expected}, got ${actual}`)
    failed++
  }
}

import {
  deriveDrawerWindowStates,
  deriveWindowState,
  hasDisplayedWindow,
} from '../window-set'

// --- deriveWindowState (F1 derivation) ---
const CLOSED = ['c']
assertEqual(deriveWindowState('t', null, CLOSED), 'minimized', 'null active: inactive tab is minimized')
assertEqual(deriveWindowState('t', 't', CLOSED), 'open', 'active tab is open')
assertEqual(deriveWindowState('c', 'c', CLOSED), 'closed', 'closed wins over active (F7: closed wins)')
assertEqual(deriveWindowState('c', null, CLOSED), 'closed', 'closed wins over inactive')
assertEqual(deriveWindowState('t', 'other', CLOSED), 'minimized', 'non-active non-closed is minimized')
assertEqual(deriveWindowState('t', 't', []), 'open', 'empty closed-set: active is open')
assertEqual(deriveWindowState('t', null, []), 'minimized', 'empty closed-set: inactive is minimized')

// --- deriveDrawerWindowStates ---
const states = deriveDrawerWindowStates(['open1', 'c', 'mini1'], 'open1', CLOSED)
assertEqual(states.size, 3, 'state map covers exactly the input ids')
assertEqual(states.get('open1'), 'open', 'map: active → open')
assertEqual(states.get('c'), 'closed', 'map: closed-set → closed')
assertEqual(states.get('mini1'), 'minimized', 'map: residual → minimized')
assertEqual(deriveDrawerWindowStates([], null, CLOSED).size, 0, 'empty drawer: empty map')
assertEqual(deriveDrawerWindowStates(['a', 'b'], null, []).get('b'), 'minimized', 'all-inactive drawer: every tab minimized')

// --- hasDisplayedWindow (D7 collapse predicate) ---
assertEqual(hasDisplayedWindow('t'), true, 'active id → displayed')
assertEqual(hasDisplayedWindow(null), false, 'null active → collapsed')

console.log('---')
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
