// Test closedTransformPx — pure function, no DOM required.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected) {
    console.error(`FAIL: ${msg} — expected ${expected}, got ${actual}`)
    failed++
  } else {
    passed++
  }
}

import { closedTransformPx } from '../drawer-shell'

// left-anchored drawer: closed = -width (slide left)
// +1 overshoot: Math.ceil(420)+1 = 421
assertEqual(closedTransformPx('left', 420), -421, 'closedTransformPx left 420')
assertEqual(closedTransformPx('left', 360), -361, 'closedTransformPx left 360')
assertEqual(closedTransformPx('left', 0), -1, 'closedTransformPx left 0 → +1 overshoot')

// right-anchored drawer: closed = +width (slide right)
assertEqual(closedTransformPx('right', 420), 421, 'closedTransformPx right 420')
assertEqual(closedTransformPx('right', 360), 361, 'closedTransformPx right 360')
assertEqual(closedTransformPx('right', 0), 1, 'closedTransformPx right 0 → +1 overshoot')

// Ceiling (Math.ceil) behavior for fractional widths + 1px overshoot
assertEqual(closedTransformPx('left', 419.1), -421, 'closedTransformPx left 419.1 → ceil to 420 + 1')
assertEqual(closedTransformPx('right', 419.1), 421, 'closedTransformPx right 419.1 → ceil to 420 + 1')
assertEqual(closedTransformPx('left', 419.9), -421, 'closedTransformPx left 419.9 → ceil to 420 + 1')

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
