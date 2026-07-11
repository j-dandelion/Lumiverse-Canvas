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

import { pairStoredToLiveIds, stripTabIdSuffix, pickSingleHealCandidate } from '../tab-id-heal'

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

console.log(`PASS: ${passed}`)
if (failed) { console.log(`FAILED: ${failed}`); process.exit(1) }
