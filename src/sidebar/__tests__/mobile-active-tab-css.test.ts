// Test that SECONDARY_MOBILE_CSS contains the correct mobile active tab
// overrides — bottom underline (not side border), with !important and
// side-left/right selectors to match desktop specificity.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertIncludes(haystack: string, needle: string, msg: string) {
  if (haystack.includes(needle)) {
    passed++
  } else {
    console.error(`FAIL: ${msg} — expected to find "${needle}"`)
    failed++
  }
}

import { SECONDARY_MOBILE_CSS } from '../styles'

// 1. Bottom underline (not side border)
assertIncludes(SECONDARY_MOBILE_CSS, 'inset 0 -3px 0',
  'mobile active box-shadow should be bottom underline')

// 2. !important on the box-shadow
assertIncludes(SECONDARY_MOBILE_CSS, 'inset 0 -3px 0 var(--lumiverse-primary) !important',
  'mobile active box-shadow must have !important')

// 3. .sidebar-ux-side-left in the mobile active override (matches desktop specificity)
assertIncludes(SECONDARY_MOBILE_CSS, '.sidebar-ux-side-left',
  'mobile active override must include .sidebar-ux-side-left selector')

// 4. .sidebar-ux-side-right in the mobile active override
assertIncludes(SECONDARY_MOBILE_CSS, '.sidebar-ux-side-right',
  'mobile active override must include .sidebar-ux-side-right selector')

// 5. border-radius: 8px 8px 0 0 with !important
assertIncludes(SECONDARY_MOBILE_CSS, 'border-radius: 8px 8px 0 0 !important',
  'mobile active border-radius must have !important')

// 6. The CSS rule property (not the comment) must use bottom underline, not side.
// Find the last `.sidebar-ux-tab-active {` (the rule opening brace) and check
// that the box-shadow value on the next line is the bottom underline variant.
const ruleStart = SECONDARY_MOBILE_CSS.lastIndexOf('.sidebar-ux-tab-active {')
assert(ruleStart !== -1, 'should find .sidebar-ux-tab-active { in mobile CSS')
const afterRule = SECONDARY_MOBILE_CSS.substring(ruleStart)
assertIncludes(afterRule, 'inset 0 -3px 0',
  'the box-shadow right after the selector must be bottom underline')
// Ensure the box-shadow line doesn't use inset 3px (side indicator)
const shadowLineEnd = afterRule.indexOf(';', afterRule.indexOf('box-shadow'))
const shadowLine = afterRule.substring(0, shadowLineEnd)
assert(!shadowLine.includes('inset 3px'),
  'the active box-shadow rule must not use inset 3px (side indicator)')

// 7. Verify all three selectors are present (no regressing to a single weak selector)
const sideLeftEl =
  '.sidebar-ux-secondary-wrapper.sidebar-ux-side-left .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active'
assertIncludes(SECONDARY_MOBILE_CSS, sideLeftEl,
  'mobile CSS must include side-left variant selector')

const sideRightEl =
  '.sidebar-ux-secondary-wrapper.sidebar-ux-side-right .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active'
assertIncludes(SECONDARY_MOBILE_CSS, sideRightEl,
  'mobile CSS must include side-right variant selector')

const defaultEl =
  '.sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active'
assertIncludes(SECONDARY_MOBILE_CSS, defaultEl,
  'mobile CSS must include default (no side) variant selector')

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
