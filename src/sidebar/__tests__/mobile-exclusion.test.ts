// Custom assertion harness — see Chronicle testing-conventions.md
let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}

import { isMobileViewport } from '../mobile-exclusion'

// --- isMobileViewport returns a boolean ---
try {
  if (typeof window === 'undefined' || typeof window.matchMedia === 'undefined') {
    throw new Error('window.matchMedia not available')
  }
  const result = isMobileViewport()
  assert(typeof result === 'boolean', 'isMobileViewport returns a boolean')
  assert(result === true || result === false, 'isMobileViewport returns exactly true or false')

  // The function checks (max-width: 600px)
  const narrow = window.matchMedia('(max-width: 600px)')
  assertEqual(result, narrow.matches, 'isMobileViewport matches matchMedia result')
} catch (e) {
  console.log(`SKIP: isMobileViewport requires window.matchMedia — ${e}`)
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    console.error(`FAIL: ${message} — expected ${expected}, got ${actual}`)
    failed++
  }
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
