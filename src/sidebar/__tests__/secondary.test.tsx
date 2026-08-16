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

// ── secondaryTabsAllPlaced (2026-07-31) ─────────────────────────────────
// Pure idempotency guard for reassignSecondaryTabsFromModel: redundant
// callers (bootstrapFromLayout + openSecondarySidebar BAIL/opening paths)
// skip the placement loop when every model-secondary tab already has a
// live button in the list.
import { secondaryTabsAllPlaced } from '../secondary'

const tabs = [
  { tabId: 'weaver', extensionId: '', title: 'Weaver' },
  { tabId: 'spindle:ext:foo:tab:Bar:0', extensionId: 'ext:foo', title: 'Bar' },
]

assert(
  secondaryTabsAllPlaced(['builtin:weaver'], tabs, ['weaver']),
  'S1: builtin placed → all placed',
)
assert(
  secondaryTabsAllPlaced(['builtin:weaver', 'ext:ext:foo/Bar'], tabs, ['weaver', 'spindle:ext:foo:tab:Bar:0']),
  'S2: builtin + extension placed → all placed',
)
assert(
  !secondaryTabsAllPlaced(['builtin:weaver'], tabs, []),
  'S3: button missing → not all placed (loop must run)',
)
assert(
  !secondaryTabsAllPlaced(['builtin:weaver', 'ext:ext:foo/Bar'], tabs, ['weaver']),
  'S4: one button missing → not all placed',
)
assert(
  !secondaryTabsAllPlaced(['builtin:weaver', 'builtin:ghost'], tabs, ['weaver']),
  'S5: builtin key always resolves to a bare id — missing button → not all placed (loop runs, per-tab no-op)',
)
assert(
  secondaryTabsAllPlaced(['builtin:weaver', 'ext:ext:ghost/None'], tabs, ['weaver']),
  'S6: unresolvable EXTENSION key (no matching tab) counts as placed (cannot be placed either)',
)

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
