// Tests for tab-list-dnd.ts — index convention documentation.
//
// The hit-test in tab-list-dnd.ts excludes the dragged tab's button from
// midpoint math, producing a post-removal insertion index. This is the same
// convention used by configure-modal's hitTestDropTarget and by
// reorderWithin (configure-model.ts), which first splices the source out
// then inserts at toIndex. No ±1 adjustment is needed.
//
// Since the pure helper visualIndexToReorderIndex was removed (it
// incorrectly added +1 for the after-source case), there are no exported
// pure functions from tab-list-dnd.ts to test. The drag interaction logic
// (pointer events, MutationObserver, overlay, hit-test, draft commit)
// requires a live browser DOM and is exercised via integration testing.
//
// This file exists as a placeholder for any future pure helpers extracted
// from the drag logic. If none are needed, it remains empty to document
// the convention and prevent accidental re-introduction of the off-by-one.

// Verify reorderWithin takes a post-removal toIndex (integration safe-check):
// configure-model.ts reorderWithin: splices fromIndex first, then inserts at
// toIndex. This matches the hit-test convention (post-removal, insert at).
// No cross-boundary index adjustment is needed — pass the visual index as-is.
import { reorderWithin } from '../configure-model'
import type { ConfigureDraft } from '../configure-model'

let passed = 0
let failed = 0

function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else {
    console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    failed++
  }
}

// ── Verify reorderWithin takes post-removal toIndex ──
//
// Create a draft: primary = [a,b,c,d,e], secondary = []
// Move tab at index 0 (a) to after index 3 (d).
// Visual (post-removal) list = [b,c,d,e]. Insert before index 3 = position of d.
// reorderWithin(toIndex=3) should splice b,c,d in front, then insert a after d: [b,c,d,a,e]
;(() => {
  const draft: ConfigureDraft = {
    drawerSide: 'left',
    primaryIds: ['a', 'b', 'c', 'd', 'e'],
    secondaryIds: [],
    builtinOrder: ['a', 'b', 'c', 'd', 'e'],
    extensionOrder: [],
    hiddenIds: new Set(),
  }
  const result = reorderWithin(draft, 'left', 0, 3)
  assertEqual(
    result.primaryIds.join(','),
    'b,c,d,a,e',
    'reorderWithin(left, from=0, toIndex=3) → b,c,d,a,e  (post-removal toIndex matches hit-test)',
  )
})()

// Same source tab (index 0), drag to before index 0 (first position).
// Visual (post-removal) = [b,c,d,e]. Insert before index 0 = before b.
// reorderWithin(toIndex=0) should keep a first: [a,b,c,d,e] (no-op).
;(() => {
  const draft: ConfigureDraft = {
    drawerSide: 'left',
    primaryIds: ['a', 'b', 'c', 'd', 'e'],
    secondaryIds: [],
    builtinOrder: ['a', 'b', 'c', 'd', 'e'],
    extensionOrder: [],
    hiddenIds: new Set(),
  }
  // Dropping before the first remaining button = index 0 = before b = position 0 in post-removal
  const result = reorderWithin(draft, 'left', 0, 0)
  assertEqual(
    result.primaryIds.join(','),
    'a,b,c,d,e',
    'reorderWithin(left, from=0, toIndex=0) → a,b,c,d,e  (drag before self = no-op)',
  )
})()

// Source at index 3 (d), drag to after last.
// Visual (post-removal) = [a,b,c,e] (length 4). Hit-test returns index=4
// when pointer is past the last button. reorderWithin(toIndex=4) should
// insert d after position 4 (i.e., end of post-removal list) → [a,b,c,e,d].
;(() => {
  const draft: ConfigureDraft = {
    drawerSide: 'left',
    primaryIds: ['a', 'b', 'c', 'd', 'e'],
    secondaryIds: [],
    builtinOrder: ['a', 'b', 'c', 'd', 'e'],
    extensionOrder: [],
    hiddenIds: new Set(),
  }
  const result = reorderWithin(draft, 'left', 3, 4)
  assertEqual(
    result.primaryIds.join(','),
    'a,b,c,e,d',
    'reorderWithin(left, from=3, toIndex=4) → a,b,c,e,d  (drag d after last; post-removal index=4)',
  )
})()

// Report
const total = passed + failed
console.log(`\nTab-list-DnD convention tests: ${passed}/${total} passed${failed > 0 ? `, ${failed} FAILED` : ''}`)
if (failed > 0) process.exit(1)
