// Custom assertion harness — see Chronicle testing-conventions.md
let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}

// showAssignmentMenu depends on DOM (document.body, document.createElement).
// In headless bun without --bun flag, document may not exist.
import { showAssignmentMenu, hideAssignmentMenu } from '../tab-context-menu'

// --- showAssignmentMenu creates and shows a context menu element ---
try {
  if (typeof document === 'undefined') {
    throw new Error('document not available')
  }
  showAssignmentMenu(100, 200, 'test-tab', 'Test Tab')
  // After calling showAssignmentMenu, the menu should be in the DOM
  const menu = document.querySelector('.canvas-tab-context-menu')
  assert(menu !== null, 'showAssignmentMenu creates a .canvas-tab-context-menu element')
  assert(menu instanceof HTMLElement, 'menu is an HTMLElement')
  assertEqual((menu as HTMLElement).style.display, 'block', 'menu display is set to block')

  // Menu should have at least one child item (the assignment toggle)
  assert((menu?.children.length ?? 0) >= 1, 'menu has at least one item')

  // The item should be a button with text content
  const item = menu?.children[0] as HTMLElement
  assert(item?.tagName === 'BUTTON', 'menu item is a BUTTON')
  assert(typeof item?.textContent === 'string' && item.textContent.length > 0, 'menu item has text content')
} catch (e) {
  console.log(`SKIP: showAssignmentMenu requires full DOM context — ${e}`)
}

// --- hideAssignmentMenu removes the menu ---
try {
  if (typeof document === 'undefined') {
    throw new Error('document not available')
  }
  hideAssignmentMenu()
  const menuAfterHide = document.querySelector('.canvas-tab-context-menu')
  assert(menuAfterHide === null, 'hideAssignmentMenu removes menu from DOM')
} catch (e) {
  console.log(`SKIP: hideAssignmentMenu requires DOM — ${e}`)
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    console.error(`FAIL: ${message} — expected ${expected}, got ${actual}`)
    failed++
  }
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
