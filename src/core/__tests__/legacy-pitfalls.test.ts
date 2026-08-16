// Regression coverage for legacy handoff and quiet-move pitfalls.
import { builtinKey, createEmptyModel, extensionKey, type LayoutModel } from '../model'
import { reduce } from '../reduce'

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) passed++
  else { console.error('FAIL:', msg); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) passed++
  else {
    console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    failed++
  }
}
function assertArraysEqual(actual: readonly string[], expected: readonly string[], msg: string) {
  const same = actual.length === expected.length && actual.every((value, index) => value === expected[index])
  if (same) passed++
  else {
    console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    failed++
  }
}

const A = builtinKey('a')
const B = builtinKey('b')
const C = builtinKey('c')
const D = extensionKey('ext', 'd')

function model(primary: LayoutModel['primary'], secondary: LayoutModel['secondary'], hidden: LayoutModel['hidden'] = [], activePrimary: string | null = null, activeSecondary: string | null = null): LayoutModel {
  return {
    ...createEmptyModel(),
    primary,
    secondary,
    hidden,
    active: { primary: activePrimary, secondary: activeSecondary },
  }
}

// Active primary moves choose the nearest selectable neighbor, not the first tab.
const activeMove = reduce(
  model([A, B, C, D], [], [C], B),
  { t: 'move', key: B, to: 'secondary', index: 0, activateDest: false },
)
assertEqual(activeMove.active.primary, A, 'active move chooses the visible neighbor above')
assertArraysEqual(activeMove.primary, [A, C, D], 'active move keeps hidden tab in its source slot')

// If there is no selectable tab above, handoff chooses the first visible tab below.
const firstMove = reduce(
  model([A, B, C], [], [B], A),
  { t: 'move', key: A, to: 'secondary', index: 0, activateDest: false },
)
assertEqual(firstMove.active.primary, C, 'first active move skips hidden tab and chooses below')

// Quiet moves must not steal the existing destination selection.
const quietInactive = reduce(
  model([A, B], [C], [], A, C),
  { t: 'move', key: B, to: 'secondary', index: 0, activateDest: false },
)
assertEqual(quietInactive.active.primary, A, 'quiet inactive move preserves source active tab')
assertEqual(quietInactive.active.secondary, C, 'quiet inactive move preserves destination active tab')

// Right-click is the only surface that activates the destination explicitly.
const activated = reduce(
  model([A, B], [C], [], A, C),
  { t: 'move', key: B, to: 'secondary', index: 1, activateDest: true },
)
assertEqual(activated.active.secondary, B, 'destination activation is explicit')

// Moving an already-active tab within one side is a reorder, not a handoff.
const sameSide = reduce(
  model([A, B, C], [], [], B),
  { t: 'move', key: B, to: 'primary', index: 2, activateDest: false },
)
assertArraysEqual(sameSide.primary, [A, C, B], 'same-side move reorders without changing membership')
assertEqual(sameSide.active.primary, B, 'same-side quiet move preserves active tab')

// A handoff chain always chooses the nearest remaining visible neighbour.
// This captures repeated active moves rather than only the first transition.
const chainFirst = reduce(
  model([A, B, C, D], [ ], [C], B),
  { t: 'move', key: B, to: 'secondary', index: 0, activateDest: false },
)
assertEqual(chainFirst.active.primary, A, 'handoff chain first move selects the neighbour above')
const chainSecond = reduce(
  chainFirst,
  { t: 'move', key: A, to: 'secondary', index: 1, activateDest: false },
)
assertEqual(chainSecond.active.primary, D, 'handoff chain second move skips hidden tabs and selects below')
assertArraysEqual(chainSecond.primary, [C, D], 'handoff chain preserves source order around hidden tabs')

// Removing the last secondary tab clears its active key instead of leaving
// stale mirror state behind.
const lastSecondary = reduce(
  model([A], [B], [], A, B),
  { t: 'move', key: B, to: 'primary', index: 1, activateDest: false },
)
assertEqual(lastSecondary.active.secondary, null, 'moving the last secondary tab clears secondary active')
assertArraysEqual(lastSecondary.secondary, [], 'moving the last secondary tab leaves no ghost entry')

// If every source neighbour is hidden, an active move must park the source
// side rather than activating a hidden tab.
const allHiddenSource = reduce(
  model([A, B, C], [], [A, C], B),
  { t: 'move', key: B, to: 'secondary', index: 0, activateDest: false },
)
assertEqual(allHiddenSource.active.primary, null, 'all-hidden source parks without selecting a hidden tab')

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}/${passed + failed}`)
