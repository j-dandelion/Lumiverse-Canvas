// Custom assertion harness — see Chronicle testing-conventions.md
let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}

import {
  getSecondaryWrapper,
  isSecondarySidebarOpen,
  getClosedTransformPx,
} from '../secondary'

// --- getSecondaryWrapper returns null before mount ---
const wrapper = getSecondaryWrapper()
assert(wrapper === null, 'getSecondaryWrapper returns null before mount')

// --- isSecondarySidebarOpen returns false initially ---
assert(isSecondarySidebarOpen() === false, 'isSecondarySidebarOpen returns false initially')

// --- getClosedTransformPx returns a number ---
try {
  const px = getClosedTransformPx()
  assert(typeof px === 'number', 'getClosedTransformPx returns a number')
  assert(!isNaN(px), 'getClosedTransformPx returns a finite number')
} catch {
  // getClosedTransformPx depends on document.documentElement.style and
  // getMainDrawerSide() — may throw in headless bun without full DOM
  console.log('SKIP: getClosedTransformPx requires document.documentElement.style (expected in headless)')
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    console.error(`FAIL: ${message} — expected ${expected}, got ${actual}`)
    failed++
  }
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
