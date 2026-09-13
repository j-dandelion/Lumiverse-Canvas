// Test that SECONDARY_MOBILE_CSS contains the correct mobile active tab
// overrides — bottom underline (not side border), with !important and
// side-left/right selectors to match desktop specificity.
//
// Also pins MAIN_MIRROR_MOBILE_CSS horizontalization of the S7 host-shaped
// strip: the renderer builds [.sidebar-ux-tab-list-main,
// .sidebar-ux-tab-list-bottom] inside the list with inline
// `flex-direction: column`, so the outer-list `row` alone leaves the buttons
// vertical on mobile.

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

import { SECONDARY_MOBILE_CSS, MAIN_MIRROR_MOBILE_CSS } from '../styles'

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

// =====================================================================
// MAIN_MIRROR_MOBILE_CSS — S7 host-shaped strip must flip horizontally.
// =====================================================================

// 8. Outer list stays a row.
assertIncludes(MAIN_MIRROR_MOBILE_CSS,
  '.sidebar-ux-main-mirror-wrapper > .sidebar-ux-drawer > .sidebar-ux-tab-list',
  'main mobile CSS must target the outer tab list')
assertIncludes(MAIN_MIRROR_MOBILE_CSS, 'flex-direction: row !important',
  'main mobile CSS must set a row direction')

// 9. Inner main section (renderer inline column) flips to a row scroller.
const mainSectionRule = MAIN_MIRROR_MOBILE_CSS.substring(
  MAIN_MIRROR_MOBILE_CSS.indexOf('.sidebar-ux-tab-list-main {'),
)
assert(mainSectionRule.length > 0, 'main mobile CSS must target .sidebar-ux-tab-list-main')
{
  const blockEnd = mainSectionRule.indexOf('}')
  const block = mainSectionRule.substring(0, blockEnd)
  assertIncludes(block, 'flex-direction: row !important',
    '.sidebar-ux-tab-list-main must flip to row (renderer writes inline column)')
  assertIncludes(block, 'min-width: 0 !important',
    '.sidebar-ux-tab-list-main must be shrinkable in the row')
  assertIncludes(block, 'overflow-x: auto !important',
    '.sidebar-ux-tab-list-main must scroll horizontally')
}

// 10. Settings dock section becomes an inline row at the end.
assertIncludes(MAIN_MIRROR_MOBILE_CSS, '.sidebar-ux-tab-list-bottom {',
  'main mobile CSS must target .sidebar-ux-tab-list-bottom')
{
  const bottomRule = MAIN_MIRROR_MOBILE_CSS.substring(
    MAIN_MIRROR_MOBILE_CSS.indexOf('.sidebar-ux-tab-list-bottom {'),
  )
  const block = bottomRule.substring(0, bottomRule.indexOf('}'))
  assertIncludes(block, 'display: flex !important',
    '.sidebar-ux-tab-list-bottom must stay a flex row on mobile')
  assertIncludes(block, 'flex-direction: row !important',
    '.sidebar-ux-tab-list-bottom must flip to row')
  assertIncludes(block, 'border-top: none !important',
    '.sidebar-ux-tab-list-bottom must drop the desktop top separator')
}

// 11. Mirror buttons must not keep inline `width: 100%` (stretches the row).
{
  const btnRule = MAIN_MIRROR_MOBILE_CSS.substring(
    MAIN_MIRROR_MOBILE_CSS.indexOf('button.sidebar-ux-main-tab-mirror-btn {'),
  )
  assert(btnRule.length > 0, 'main mobile CSS must size mirror buttons')
  const block = btnRule.substring(0, btnRule.indexOf('}'))
  assertIncludes(block, 'width: 52px !important',
    'mirror buttons must be pinned to host mobile width on mobile')
  assertIncludes(block, 'flex-shrink: 0 !important',
    'mirror buttons must not shrink in the row')
}

// 12. Secondary-open exclusion must hide the Canvas shell's edge toggle:
// `.sidebar-ux-drawer-tab` (hyphenated) does NOT contain the host camelCase
// `drawerTab`, so the [class*="drawerTab"] selector alone misses the main
// handle and it stays visible over the open secondary (live report).
assertIncludes(SECONDARY_MOBILE_CSS,
  'body.canvas-ux-mobile-secondary-open .sidebar-ux-drawer-tab',
  'secondary-open exclusion must explicitly hide the Canvas drawer-tab class')

// 13. Exclusion must also be interactive: the covered Canvas shell (drawer
// re-enables pointer-events:auto inline) is made fully inert while the other
// drawer is open — otherwise taps on the covered shell open the drawer
// behind the open one (live report).
assertIncludes(SECONDARY_MOBILE_CSS,
  'body.canvas-ux-mobile-secondary-open .sidebar-ux-main-mirror-wrapper *',
  'secondary-open exclusion must make the whole main shell inert')
assertIncludes(SECONDARY_MOBILE_CSS,
  'body.canvas-ux-mobile-primary-open .sidebar-ux-secondary-wrapper *',
  'primary-open exclusion must make the whole secondary shell inert')

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
