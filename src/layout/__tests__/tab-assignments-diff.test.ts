// Custom assertion harness — see other layout tests
let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}

import {
  extractSecondaryTabIds,
  normalizeActiveTabId,
  tabAssignmentsEqual,
} from '../tab-assignments-diff'

// --- normalizeActiveTabId ---
assert(normalizeActiveTabId(null) === null, 'null → null')
assert(normalizeActiveTabId(undefined) === null, 'undefined → null')
assert(normalizeActiveTabId('tab-a') === 'tab-a', 'string preserved')

// --- extractSecondaryTabIds ---
assert(
  JSON.stringify(extractSecondaryTabIds(null)) === '[]',
  'null slice → empty ids',
)
assert(
  JSON.stringify(extractSecondaryTabIds({ detachedTabs: [] })) === '[]',
  'empty detached → empty ids',
)
assert(
  JSON.stringify(extractSecondaryTabIds({
    detachedTabs: [
      { tabId: 'a' },
      { tabId: 'b' },
    ],
  })) === JSON.stringify(['a', 'b']),
  'order preserved',
)

// --- tabAssignmentsEqual: match ---
assert(
  tabAssignmentsEqual(
    { detachedTabs: [{ tabId: 'a' }, { tabId: 'b' }], secondary: { activeTabId: 'a' } },
    { detachedTabs: [{ tabId: 'a' }, { tabId: 'b' }], secondary: { activeTabId: 'a' } },
  ),
  'same ids/order/active → equal',
)

assert(
  tabAssignmentsEqual(
    { detachedTabs: [], secondary: { activeTabId: null } },
    { detachedTabs: [], secondary: {} },
  ),
  'empty + null/missing active → equal',
)

assert(
  tabAssignmentsEqual(
    { detachedTabs: [{ tabId: 'x' }], secondary: { activeTabId: undefined } },
    { detachedTabs: [{ tabId: 'x' }], secondary: { activeTabId: null } },
  ),
  'undefined vs null active → equal',
)

assert(
  tabAssignmentsEqual(
    { detachedTabs: [{ tabId: 'a', tabTitle: 'Alpha' } as { tabId: string }], secondary: { activeTabId: 'a' } },
    { detachedTabs: [{ tabId: 'a', tabTitle: 'Other' } as { tabId: string }], secondary: { activeTabId: 'a' } },
  ),
  'tabTitle ignored',
)

// --- tabAssignmentsEqual: differ ---
assert(
  tabAssignmentsEqual(
    { detachedTabs: [{ tabId: 'a' }, { tabId: 'b' }], secondary: { activeTabId: 'a' } },
    { detachedTabs: [{ tabId: 'b' }, { tabId: 'a' }], secondary: { activeTabId: 'a' } },
  ),
  'order swap → equal (set membership)',
)

assert(
  !tabAssignmentsEqual(
    { detachedTabs: [{ tabId: 'a' }], secondary: { activeTabId: 'a' } },
    { detachedTabs: [{ tabId: 'a' }, { tabId: 'b' }], secondary: { activeTabId: 'a' } },
  ),
  'extra id → not equal',
)

assert(
  !tabAssignmentsEqual(
    { detachedTabs: [{ tabId: 'a' }, { tabId: 'b' }], secondary: { activeTabId: 'a' } },
    { detachedTabs: [{ tabId: 'a' }], secondary: { activeTabId: 'a' } },
  ),
  'missing id → not equal',
)

assert(
  !tabAssignmentsEqual(
    { detachedTabs: [{ tabId: 'a' }], secondary: { activeTabId: 'a' } },
    { detachedTabs: [{ tabId: 'a' }], secondary: { activeTabId: 'b' } },
  ),
  'active-only change → not equal',
)

assert(
  !tabAssignmentsEqual(
    { detachedTabs: [], secondary: { activeTabId: null } },
    { detachedTabs: [{ tabId: 'a' }], secondary: { activeTabId: 'a' } },
  ),
  'empty vs non-empty → not equal',
)

// Open/width-only differences must not matter (fields not compared)
assert(
  tabAssignmentsEqual(
    {
      detachedTabs: [{ tabId: 'a' }],
      secondary: { activeTabId: 'a', open: true, width: 300 } as { activeTabId?: string | null },
    },
    {
      detachedTabs: [{ tabId: 'a' }],
      secondary: { activeTabId: 'a', open: false, width: 500 } as { activeTabId?: string | null },
    },
  ),
  'open/width fields ignored when active+ids match',
)

console.log(`tab-assignments-diff: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
