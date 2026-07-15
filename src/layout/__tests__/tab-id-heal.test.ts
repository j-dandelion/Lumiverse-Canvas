// Pure unit tests for suffix-drift bipartite pairing.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { failed++; console.error(`FAIL: ${msg} — expected ${String(expected)}, got ${String(actual)}`) }
}

import {
  pairStoredToLiveIds,
  stripTabIdSuffix,
  pickSingleHealCandidate,
  healHiddenTabIds,
  isTabIdHidden,
} from '../tab-id-heal'

assertEqual(stripTabIdSuffix('tab:ext:0'), 'tab:ext', 'strip :0')
assertEqual(stripTabIdSuffix('tab:ext:12'), 'tab:ext', 'strip :12')
assertEqual(stripTabIdSuffix('plain'), 'plain', 'no suffix')

// Exact match wins
{
  const m = pairStoredToLiveIds(['a:1', 'b:2'], ['a:1', 'b:2'])
  assertEqual(m.get('a:1'), 'a:1', 'exact a')
  assertEqual(m.get('b:2'), 'b:2', 'exact b')
}

// Sibling re-register: exact match first, then leftover pairs remaining live
{
  const m = pairStoredToLiveIds(['ext:0', 'ext:1'], ['ext:1', 'ext:2'])
  assertEqual(m.get('ext:1'), 'ext:1', 'exact match for ext:1')
  assertEqual(m.get('ext:0'), 'ext:2', 'leftover stored pairs remaining live')
}
// No exact overlap: pure bipartite by sorted order
{
  const m = pairStoredToLiveIds(['ext:0', 'ext:1'], ['ext:2', 'ext:3'])
  assertEqual(m.get('ext:0'), 'ext:2', 'no-exact pair first')
  assertEqual(m.get('ext:1'), 'ext:3', 'no-exact pair second')
}

// Single stored, one live different suffix
{
  const m = pairStoredToLiveIds(['tab:ext:0'], ['tab:ext:1'])
  assertEqual(m.get('tab:ext:0'), 'tab:ext:1', 'single heal')
}

// Unequal: two live one stored → one paired one leftover live unused
{
  const m = pairStoredToLiveIds(['x:1'], ['x:2', 'x:3'])
  assert(m.get('x:1') === 'x:2' || m.get('x:1') === 'x:3', 'one of two live')
}

assertEqual(pickSingleHealCandidate('a:0', ['a:1']), 'a:1', 'pick unique')
assertEqual(pickSingleHealCandidate('a:0', ['a:1', 'a:2']), null, 'pick ambiguous null')

// healHiddenTabIds: extension suffix drift after hard refresh
{
  const stored = ['spindle:uuid:tab:prompt-viewer:2', 'weaver']
  const live = ['spindle:uuid:tab:prompt-viewer:1', 'weaver', 'browser']
  const healed = healHiddenTabIds(stored, live)
  assertEqual(healed.length, 2, 'heal keeps two live targets')
  assert(healed.includes('spindle:uuid:tab:prompt-viewer:1'), 'heal maps :2 → :1')
  assert(healed.includes('weaver'), 'heal keeps bare builtin')
}

// healHiddenTabIds: drop ghosts with no live match (DOM apply)
{
  const healed = healHiddenTabIds(['gone:1', 'browser'], ['browser'])
  assertEqual(healed.length, 1, 'ghost dropped')
  assertEqual(healed[0], 'browser', 'only browser remains')
}

// healHiddenTabIds keepUnmatched: preserve for write-back before extensions load
{
  const healed = healHiddenTabIds(
    ['spindle:uuid:tab:prompt-viewer:2', 'weaver'],
    ['weaver'],
    { keepUnmatched: true },
  )
  assertEqual(healed.length, 2, 'keepUnmatched retains extension id')
  assert(healed.includes('spindle:uuid:tab:prompt-viewer:2'), 'unmatched preserved')
  assert(healed.includes('weaver'), 'live builtin kept')
}

// isTabIdHidden: exact; suffix only via pairing against live pool
assert(isTabIdHidden('weaver', ['weaver']), 'exact hidden')
assert(
  isTabIdHidden('spindle:x:tab:y:1', ['spindle:x:tab:y:2'], ['spindle:x:tab:y:1']),
  'suffix-hidden with live pool',
)
assert(
  !isTabIdHidden('spindle:x:tab:y:1', ['spindle:x:tab:y:2']),
  'no broad prefix without live pool',
)
assert(!isTabIdHidden('browser', ['weaver']), 'not hidden')
// Multi-instance: only the paired live id is hidden
{
  const hidden = ['spindle:x:tab:y:1']
  const live = ['spindle:x:tab:y:1', 'spindle:x:tab:y:2']
  assert(isTabIdHidden('spindle:x:tab:y:1', hidden, live), 'instance 1 hidden')
  assert(!isTabIdHidden('spindle:x:tab:y:2', hidden, live), 'instance 2 not hidden')
}

console.log(`PASS: ${passed}`)
if (failed) { console.log(`FAILED: ${failed}`); process.exit(1) }
