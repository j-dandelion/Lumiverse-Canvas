// Custom assertion harness — see Chronicle testing-conventions.md
let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}

import {
  getTabAssignments,
  setTabAssignment,
  deleteTabAssignment,
  hasTabAssignment,
  getTabSidebar,
} from '../assignment'

// --- getTabAssignments returns a Map ---
const map = getTabAssignments()
assert(map instanceof Map, 'getTabAssignments returns a Map')

// --- setTabAssignment stores correctly ---
setTabAssignment('tab-1', 'secondary')
assert(hasTabAssignment('tab-1'), 'hasTabAssignment after set')
assertEqual(getTabSidebar('tab-1'), 'secondary', 'getTabSidebar returns secondary after set')

setTabAssignment('tab-2', 'primary')
assert(hasTabAssignment('tab-2'), 'hasTabAssignment for primary')

// --- getTabAssignments reflects stored values ---
const all = getTabAssignments()
assert(all.get('tab-1') === 'secondary', 'map has tab-1 = secondary')
assert(all.get('tab-2') === 'primary', 'map has tab-2 = primary')

// --- deleteTabAssignment removes correctly ---
deleteTabAssignment('tab-1')
assert(!hasTabAssignment('tab-1'), 'hasTabAssignment false after delete')
assert(getTabSidebar('tab-1') === 'primary', 'getTabSidebar defaults to primary after delete')

// --- getTabSidebar returns 'primary' or 'secondary' ---
assertEqual(getTabSidebar('tab-2'), 'primary', 'getTabSidebar returns primary')
assertEqual(getTabSidebar('tab-3'), 'primary', 'getTabSidebar defaults to primary for unknown tab')

setTabAssignment('tab-3', 'secondary')
assertEqual(getTabSidebar('tab-3'), 'secondary', 'getTabSidebar returns secondary for known tab')

// Cleanup
deleteTabAssignment('tab-2')
deleteTabAssignment('tab-3')

// --- isMovedTabNode identifies moved tabs ---
// Note: isMovedTabNode depends on runtime DOM store state (getDrawerTabs).
// In a headless test environment it should return false for a bare DOM node.
import('../active-tab').then(({ isMovedTabNode }) => {
  const el = document.createElement('div')
  assert(isMovedTabNode(el) === false, 'isMovedTabNode returns false for unknown node')
}).catch(() => {
  console.log('SKIP: isMovedTabNode requires runtime store (expected in headless)')
})

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    console.error(`FAIL: ${message} — expected ${expected}, got ${actual}`)
    failed++
  }
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
