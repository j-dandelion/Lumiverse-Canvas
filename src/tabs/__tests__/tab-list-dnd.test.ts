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
//   - Cross secondary→primary: settle with placeholder in mirror, then
//     spacer + restore before commit (clean secondary list; hold mirror slot).
//   - Cross primary→secondary: settle with mirror btn still in secondary;
//     do NOT restore (would flash tab back on main-mirror + rearrange both
//     strips). addSecondaryTabButton replaces foreign node in-place.
//     Hide host button before commit (no dual rematerialize) but do NOT
//     reconcileMainTabListPin first — heal would clear _activeMainMirrorKey
//     and skip quiet handoff neighbor (empty panel / no strip switch).
//   - Fail / cancel / tearDown while dragging: restore source DOM.
//
// Settings (isSettingsButton) is never drag-arm installed.
// Activation: mouse = ~6px Euclidean distance; touch/pen = ~200ms long-press
// (movement past threshold cancels long-press arming).
//
// Live drawer DnD uses reorderVisibleInList on commit AND visible-only
// hit-test / mid-drag insert (domInsertIndexFromVisibleIndex). Counting
// display:none hidden buttons in mid-drag (zero rects) while commit used
// visible indices caused post-settle icon shuffle after Configure hide.
//
// First-drop shuffle fix: buildDraftAndBase aligns primary/secondary ids to
// live strip order (alignDraftToLiveVisibleOrder) so commit does not rewrite
// both drawers to stale host tabOrder / catalog append order.
//
// Configure modal sync (performDrop after successful commitConfigureDraft):
//   - Cross-drawer and within-drawer success paths dynamic-import
//     configure-modal and call refreshConfigureDraftFromLive() (no-op if
//     modal closed). Failed commits do NOT refresh. Clean no-op drops
//     (no commit) also skip refresh. Refresh is not inside configure-commit.
//
// Click after release: capture suppressors stay installed for the whole drag;
// removal is scheduled only on pointerup (setTimeout 0). Scheduling removal
// at drag-start cleared the listener mid-drag → every drop activated the tab.
//
// Hit-test uses floating *tab* geometry (overlay center + bounds), not raw
// pointer — grab offset on narrow strips otherwise swapped neighbors early.

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
import {
  dragHitGeometry,
  overlayOverlapsContainer,
  insertIndexFromMidpoints,
  settleDestFromButtonRects,
  isLiveTabListDndAllowed,
  shouldActivateDragFromDistance,
  DRAG_ACTIVATE_DISTANCE_PX,
  domInsertIndexFromVisibleIndex,
  isDisplayedTabButton,
} from '../tab-list-dnd'
import { readVisibleTabIdsFromList } from '../live-tab-order'

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

// ── domInsertIndexFromVisibleIndex: mid-drag must park like commit ──
//
// Siblings after removing drag source, with H display:none:
//   [H, b, c] — insert visible index 1 (before c among [b,c]) → DOM idx 2 (c)
//   [a, H, b] — insert at end of visible (idx 2) → after last visible b (DOM 3)
//   [a, H, b] not append after trailing H when target is "end of visibles"
;(() => {
  // Post-removal siblings: H hidden, b, c visible. Move a before c → vis 1.
  assertEqual(
    domInsertIndexFromVisibleIndex([true, false, false], 1),
    2,
    'domInsert: before 2nd visible with leading hidden → index of that visible',
  )
  assertEqual(
    domInsertIndexFromVisibleIndex([true, false, false], 0),
    1,
    'domInsert: before first visible with leading hidden → skip leading H',
  )
  // Trailing hidden: visibles [a,b] then H. End of visible → insert before H.
  assertEqual(
    domInsertIndexFromVisibleIndex([false, false, true], 2),
    2,
    'domInsert: append after last visible leaves trailing H after insert',
  )
  assertEqual(
    domInsertIndexFromVisibleIndex([false, false, true], 99),
    2,
    'domInsert: oversized visible index clamps like end-after-last-visible',
  )
  // All hidden — treat as empty visible list → insert at 0 (before all).
  assertEqual(
    domInsertIndexFromVisibleIndex([true, true], 0),
    0,
    'domInsert: all-hidden siblings → insert at 0',
  )
  assertEqual(
    domInsertIndexFromVisibleIndex([], 0),
    0,
    'domInsert: empty siblings → 0 (append)',
  )
  // Middle hidden between visibles: [a, H, b], insert before b (vis 1) → idx 2
  assertEqual(
    domInsertIndexFromVisibleIndex([false, true, false], 1),
    2,
    'domInsert: middle hidden — before 2nd visible → index of b',
  )
})()

// isDisplayedTabButton: style.display === 'none' is Configure-hide
;(() => {
  assertEqual(
    isDisplayedTabButton({ style: { display: 'none' } } as HTMLElement),
    false,
    'isDisplayedTabButton: display none → false',
  )
  assertEqual(
    isDisplayedTabButton({ style: { display: '' } } as HTMLElement),
    true,
    'isDisplayedTabButton: empty display → true',
  )
})()

// Settings host chrome is excluded from live DnD install (isSettingsButton).
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

// Distance-based mouse activation (~6px Euclidean).
;(() => {
  assertEqual(
    DRAG_ACTIVATE_DISTANCE_PX,
    6,
    'DRAG_ACTIVATE_DISTANCE_PX = 6',
  )
  assertEqual(
    shouldActivateDragFromDistance(0, 0),
    false,
    'distance: no movement → no activate',
  )
  assertEqual(
    shouldActivateDragFromDistance(5, 0),
    false,
    'distance: 5px axis < 6 → no activate',
  )
  assertEqual(
    shouldActivateDragFromDistance(6, 0),
    true,
    'distance: 6px axis ≥ 6 → activate',
  )
  assertEqual(
    shouldActivateDragFromDistance(4, 4),
    false,
    'distance: sqrt(32)≈5.66 < 6 → no activate',
  )
  assertEqual(
    shouldActivateDragFromDistance(5, 5),
    true,
    'distance: sqrt(50)≈7.07 ≥ 6 → activate',
  )
  assertEqual(
    shouldActivateDragFromDistance(4, 0, 4),
    true,
    'distance: custom threshold inclusive',
  )
  assertEqual(
    shouldActivateDragFromDistance(3.9, 0, 4),
    false,
    'distance: just under custom threshold',
  )
})()

// Tab-position hit geometry: center is overlay mid, not grab/pointer offset.
;(() => {
  const g = dragHitGeometry(100, 200, 48, 56)
  assertEqual(g.centerX, 124, 'dragHitGeometry: centerX = left + w/2')
  assertEqual(g.centerY, 228, 'dragHitGeometry: centerY = top + h/2')
  assertEqual(g.right, 148, 'dragHitGeometry: right edge')
  assertEqual(g.bottom, 256, 'dragHitGeometry: bottom edge')
})()

// Container match uses overlay overlap (tab body), not a single pointer point.
// Default padX=80 lets the float drift sideways off a narrow strip and still reorder.
;(() => {
  const tab = { left: 10, top: 50, right: 58, bottom: 106 }
  const strip = { left: 0, top: 0, right: 48, bottom: 400 }
  // Tab mostly over strip (center still in strip)
  assertEqual(
    overlayOverlapsContainer(tab, strip),
    true,
    'overlayOverlapsContainer: tab overlapping strip → true',
  )
  // ~152px gap from strip right (48) to tab left (200) — outside padX 80
  const far = { left: 200, top: 50, right: 248, bottom: 106 }
  assertEqual(
    overlayOverlapsContainer(far, strip),
    false,
    'overlayOverlapsContainer: tab far from strip → false',
  )
  // Pointer would be in the chat gap, but tab still overlaps strip:
  // right edge of tab (58) past strip right (48) and left (10) still in strip.
  const halfOut = { left: 20, top: 50, right: 68, bottom: 106 }
  assertEqual(
    overlayOverlapsContainer(halfOut, strip),
    true,
    'overlayOverlapsContainer: half-over strip still hits (tab position)',
  )
  // Fully beside strip but within default padX (~42px past strip right)
  const beside = { left: 90, top: 50, right: 138, bottom: 106 }
  assertEqual(
    overlayOverlapsContainer(beside, strip),
    true,
    'overlayOverlapsContainer: ~80px horizontal leeway → still hits',
  )
  assertEqual(
    overlayOverlapsContainer(beside, strip, 8, 0),
    false,
    'overlayOverlapsContainer: padX=0 → beside strip misses',
  )
})()

// Insert index from midpoints (post-removal convention).
;(() => {
  // Neighbors at mid Y 100, 200, 300
  const mids = [100, 200, 300]
  assertEqual(insertIndexFromMidpoints(50, mids), 0, 'insertIndex: above first → 0')
  assertEqual(insertIndexFromMidpoints(150, mids), 1, 'insertIndex: between 0 and 1 → 1')
  assertEqual(insertIndexFromMidpoints(250, mids), 2, 'insertIndex: between 1 and 2 → 2')
  assertEqual(insertIndexFromMidpoints(350, mids), 3, 'insertIndex: below last → length')
  assertEqual(insertIndexFromMidpoints(0, []), 0, 'insertIndex: empty list → 0')
})()

// Drop-settle destination from sibling rects (predicted slot when source is
// NOT already parked in the list). If the invisible placeholder is mid-drag
// in the target, resolveSettleDestination uses its live rect instead —
// sibling-predict after exclude is one slot too low (neighbors already shifted).
;(() => {
  const rects = [
    { left: 10, top: 0, width: 48, height: 48 },
    { left: 10, top: 48, width: 48, height: 48 },
    { left: 10, top: 96, width: 48, height: 48 },
  ]
  const empty = { left: 10, top: 0 }
  assertEqual(
    settleDestFromButtonRects(0, rects, empty).top,
    0,
    'settleDest: index 0 → first rect top',
  )
  assertEqual(
    settleDestFromButtonRects(1, rects, empty).top,
    48,
    'settleDest: index 1 → second rect top (list without placeholder)',
  )
  assertEqual(
    settleDestFromButtonRects(3, rects, empty).top,
    144,
    'settleDest: append past last → last.bottom',
  )
  assertEqual(
    settleDestFromButtonRects(0, [], empty).top,
    0,
    'settleDest: empty list → fallback',
  )
})()

// Live strip DnD is desktop-only (≤600px = no-op; Configure Tabs only).
;(() => {
  const g = globalThis as any
  const prevWindow = g.window
  const prevMatchMedia = g.window?.matchMedia ?? g.matchMedia

  const withViewport = (mobile: boolean) => {
    const mm = (q: string) => ({
      matches: mobile && String(q).includes('max-width'),
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    })
    g.window = { ...(g.window || {}), matchMedia: mm }
    g.matchMedia = mm
  }

  try {
    withViewport(true)
    assertEqual(
      isLiveTabListDndAllowed(),
      false,
      'isLiveTabListDndAllowed: false on mobile (≤600px)',
    )
    withViewport(false)
    assertEqual(
      isLiveTabListDndAllowed(),
      true,
      'isLiveTabListDndAllowed: true on desktop',
    )
  } finally {
    if (prevWindow === undefined) delete g.window
    else g.window = prevWindow
    if (prevMatchMedia) {
      g.matchMedia = prevMatchMedia
      if (g.window) g.window.matchMedia = prevMatchMedia
    }
  }
})()

// ── live-tab-order: readVisibleTabIdsFromList skips Settings + display:none ──
// Uses a minimal list mock (no full DOM) so the filter contract is pure-testable.
;(() => {
  const mk = (
    id: string,
    opts?: { settings?: boolean; hidden?: boolean },
  ): HTMLElement => {
    const attrs: Record<string, string> = { 'data-tab-id': id }
    if (opts?.settings) {
      attrs['aria-label'] = 'Settings'
    }
    return {
      className: opts?.settings ? 'tabBtnSettings' : '',
      style: { display: opts?.hidden ? 'none' : '' },
      getAttribute: (k: string) => attrs[k] ?? null,
    } as unknown as HTMLElement
  }
  const buttons = [
    mk('a'),
    mk('settings', { settings: true }),
    mk('b', { hidden: true }),
    mk('c'),
  ]
  const list = {
    querySelectorAll: (_sel: string) => buttons,
  } as unknown as HTMLElement
  const ids = readVisibleTabIdsFromList(list)
  assertEqual(
    ids.join(','),
    'a,c',
    'readVisibleTabIdsFromList: skips Settings + display:none',
  )
  assertEqual(
    readVisibleTabIdsFromList(null).length,
    0,
    'readVisibleTabIdsFromList: null list → []',
  )
})()

// Report
const total = passed + failed
console.log(`\nTab-list-DnD convention tests: ${passed}/${total} passed${failed > 0 ? `, ${failed} FAILED` : ''}`)
if (failed > 0) process.exit(1)
