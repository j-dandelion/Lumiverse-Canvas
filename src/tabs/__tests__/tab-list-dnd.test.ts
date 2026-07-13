// Tests for tab-list-dnd.ts — index convention + policy documentation.
//
// The hit-test in tab-list-dnd.ts excludes the dragged tab's button from
// midpoint math, producing a post-removal insertion index. This is the same
// convention used by configure-modal's hitTestDropTarget and by
// reorderWithin (configure-model.ts), which first splices the source out
// then inserts at toIndex. No ±1 adjustment is needed.
//
// Drop / restore policy (pointerup → performDrop):
//   - Same-list reorder: keep mid-drag DOM through successful commit
//     (primary stick; host+mirror reordered in configure-commit).
//   - Cross-list move: restoreSourceButtonDOM() BEFORE commit so mirror
//     nodes are not parked in the secondary list (would block
//     addSecondaryTabButton via data-tab-id match).
//   - Fail / cancel / tearDown while dragging: restore source DOM.
//
// Settings (isSettingsButton) is never long-press installed.
//
// Live drawer DnD also uses reorderVisibleInList so hidden tabs do not skew
// hit-test indices (would otherwise animate mid-drag then snap back).
//
// First-drop shuffle fix: buildDraftAndBase aligns primary/secondary ids to
// live strip order (alignDraftToLiveVisibleOrder) so commit does not rewrite
// both drawers to stale host tabOrder / catalog append order.
//
// Click after release: capture suppressors stay installed for the whole drag;
// removal is scheduled only on pointerup (setTimeout 0). Scheduling removal
// at drag-start cleared the listener mid-drag → every drop activated the tab.

// Verify reorderWithin takes a post-removal toIndex (integration safe-check):
// configure-model.ts reorderWithin: splices fromIndex first, then inserts at
// toIndex. This matches the hit-test convention (post-removal, insert at).
// No cross-boundary index adjustment is needed — pass the visual index as-is.
//
import {
  reorderWithin,
  reorderVisibleInList,
  insertAtVisibleIndex,
  reorderWithinVisible,
} from '../configure-model'
import type { ConfigureDraft } from '../configure-model'
import { isSettingsButton } from '../buttons'

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

// ── reorderVisibleInList: hidden tabs must not make visible reorder a no-op ──
//
// full = [a, H, b, c], H hidden. Drag a after b among visible [a,b,c]:
// post-removal visible = [b,c], insert before c → visible index 1 → [b,a,c]
// Full list must become [b, H, a, c] (H stays in its slot).
// Full-list reorderWithin(from=0,to=1) would give [H,a,b,c] — visible still
// a,b,c → snap-back class of bug.
;(() => {
  const full = ['a', 'H', 'b', 'c']
  const hidden = new Set(['H'])
  const next = reorderVisibleInList(full, 'a', 1, hidden)
  assertEqual(
    next.join(','),
    'b,H,a,c',
    'reorderVisibleInList: move a before c with hidden H → b,H,a,c',
  )
})()

// Drag last visible c to front among [a,b,c] with H hidden between a and b.
// toVisibleIndex=0 → [c,a,b] visible → full [c,H,a,b]
;(() => {
  const full = ['a', 'H', 'b', 'c']
  const hidden = new Set(['H'])
  const next = reorderVisibleInList(full, 'c', 0, hidden)
  assertEqual(
    next.join(','),
    'c,H,a,b',
    'reorderVisibleInList: move c to front with hidden H → c,H,a,b',
  )
})()

// insertAtVisibleIndex: append when toVisibleIndex past last visible
;(() => {
  const full = ['a', 'H', 'b']
  const hidden = new Set(['H'])
  const next = insertAtVisibleIndex(full, 'x', 2, hidden)
  assertEqual(
    next.join(','),
    'a,H,b,x',
    'insertAtVisibleIndex: append x at visible end',
  )
})()

// insertAtVisibleIndex: insert before first visible
;(() => {
  const full = ['H', 'a', 'b']
  const hidden = new Set(['H'])
  const next = insertAtVisibleIndex(full, 'x', 0, hidden)
  assertEqual(
    next.join(','),
    'H,x,a,b',
    'insertAtVisibleIndex: insert x before first visible (after leading hidden)',
  )
})()

// reorderWithinVisible integrates hidden-aware reorder into a draft
;(() => {
  const draft: ConfigureDraft = {
    drawerSide: 'left',
    primaryIds: ['a', 'H', 'b', 'c'],
    secondaryIds: [],
    builtinOrder: ['a', 'H', 'b', 'c'],
    extensionOrder: [],
    hiddenIds: new Set(['H']),
  }
  // Visible [a,b,c]; move a after b → visible index 1 post-removal [b,c]
  const result = reorderWithinVisible(draft, 'primaryIds', 'a', 1)
  assertEqual(
    result.primaryIds.join(','),
    'b,H,a,c',
    'reorderWithinVisible: primary with hidden → b,H,a,c',
  )
})()

// Naive full-list index on same data would snap visible order (document the bug)
;(() => {
  const draft: ConfigureDraft = {
    drawerSide: 'left',
    primaryIds: ['a', 'H', 'b', 'c'],
    secondaryIds: [],
    builtinOrder: ['a', 'H', 'b', 'c'],
    extensionOrder: [],
    hiddenIds: new Set(['H']),
  }
  // Wrong: treat visible index 1 as full-list fromIndex=0 toIndex=1
  const naive = reorderWithin(draft, 'left', 0, 1)
  assertEqual(
    naive.primaryIds.join(','),
    'H,a,b,c',
    'document naive reorderWithin(0,1) with hidden → H,a,b,c (visible a,b,c unchanged)',
  )
})()

// Settings host chrome is excluded from live DnD long-press (isSettingsButton).
;(() => {
  const settings = {
    className: 'tabBtn tabBtnSettings',
    getAttribute(name: string) {
      if (name === 'title') return 'Settings'
      if (name === 'aria-label') return 'Settings'
      return null
    },
  } as unknown as HTMLElement
  assertEqual(
    isSettingsButton(settings),
    true,
    'isSettingsButton: tabBtnSettings → true (DnD must skip)',
  )
  const normal = {
    className: 'tabBtn',
    getAttribute(name: string) {
      if (name === 'title') return 'Profile'
      if (name === 'aria-label') return 'Profile'
      return null
    },
  } as unknown as HTMLElement
  assertEqual(
    isSettingsButton(normal),
    false,
    'isSettingsButton: normal tab → false (DnD may install)',
  )
})()

// Report
const total = passed + failed
console.log(`\nTab-list-DnD convention tests: ${passed}/${total} passed${failed > 0 ? `, ${failed} FAILED` : ''}`)
if (failed > 0) process.exit(1)
