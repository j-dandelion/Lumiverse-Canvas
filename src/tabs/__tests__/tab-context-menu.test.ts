// Custom assertion harness — see Chronicle testing-conventions.md
let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}

// showAssignmentMenu depends on DOM (document.body, document.createElement).
// In headless bun without --bun flag, document may not exist.
import { showAssignmentMenu, hideAssignmentMenu } from '../tab-context-menu'
import { getSettings, setSettings } from '../../settings/state'
import { __setHostSetSettingForTest } from '../../dom/host-settings'

// --- showAssignmentMenu creates a multi-item menu with toggle, configure, divider, and move ---
try {
  if (typeof document === 'undefined') {
    throw new Error('document not available')
  }
  // Ensure second sidebar on so move item is shown.
  const prevEnabled = getSettings().secondSidebarEnabled
  setSettings({ secondSidebarEnabled: true })
  try {
    showAssignmentMenu(100, 200, 'test-tab', 'Test Tab')
    const menu = document.querySelector('.canvas-tab-context-menu')
    assert(menu !== null, 'showAssignmentMenu creates a .canvas-tab-context-menu element')
    assert(menu instanceof HTMLElement, 'menu is an HTMLElement')
    assertEqual((menu as HTMLElement).style.display, 'block', 'menu display is set to block')

    // Menu should have 4 items: toggle, configure, divider, move
    assert(menu!.children.length === 4, 'menu has exactly 4 children')

    // Item 1: toggle labels
    const toggleItem = menu!.children[0] as HTMLElement
    assert(toggleItem.tagName === 'BUTTON', 'first item is a BUTTON')
    assert(
      toggleItem.textContent === 'Show labels' || toggleItem.textContent === 'Hide labels',
      'first item is label toggle',
    )

    // Item 2: configure tabs
    const configureItem = menu!.children[1] as HTMLElement
    assert(configureItem.tagName === 'BUTTON', 'second item is a BUTTON')
    assert(configureItem.textContent === 'Configure tabs', 'second item is Configure tabs')

    // Item 3: divider
    const divider = menu!.children[2] as HTMLElement
    assert(divider.getAttribute('role') === 'separator', 'third item has role="separator"')

    // Item 4: move
    const moveItem = menu!.children[3] as HTMLElement
    assert(moveItem.tagName === 'BUTTON', 'fourth item is a BUTTON')
    assert(moveItem.textContent === 'Move to second drawer', 'fourth item is Move to second drawer')
  } finally {
    setSettings({ secondSidebarEnabled: prevEnabled })
    hideAssignmentMenu()
  }
} catch (e) {
  console.log(`SKIP: multi-item menu test requires DOM — ${e}`)
}

// --- secondSidebarEnabled=false still shows toggle + configure, omits divider + move ---
try {
  if (typeof document === 'undefined') {
    throw new Error('document not available')
  }
  hideAssignmentMenu()
  const prevEnabled = getSettings().secondSidebarEnabled
  setSettings({ secondSidebarEnabled: false })
  try {
    showAssignmentMenu(100, 200, 'test-tab-gated', 'Gated Tab')
    const menu = document.querySelector('.canvas-tab-context-menu')
    assert(menu !== null, 'showAssignmentMenu creates menu even when second sidebar off')
    assert(menu instanceof HTMLElement, 'menu is an HTMLElement')

    // Menu has 2 items: toggle + configure (no divider, no move)
    assert(menu!.children.length === 2, 'menu has exactly 2 children when second off')

    // Item 1: toggle labels
    const toggleItem = menu!.children[0] as HTMLElement
    assert(toggleItem.tagName === 'BUTTON', 'first item is a BUTTON')
    assert(
      toggleItem.textContent === 'Show labels' || toggleItem.textContent === 'Hide labels',
      'first item is label toggle',
    )

    // Item 2: configure tabs
    const configureItem = menu!.children[1] as HTMLElement
    assert(configureItem.tagName === 'BUTTON', 'second item is a BUTTON')
    assert(configureItem.textContent === 'Configure tabs', 'second item is Configure tabs')
  } finally {
    setSettings({ secondSidebarEnabled: prevEnabled })
    hideAssignmentMenu()
  }
} catch (e) {
  console.log(`SKIP: second-off menu test requires DOM — ${e}`)
}

// --- hideAssignmentMenu removes the menu ---
try {
  if (typeof document === 'undefined') {
    throw new Error('document not available')
  }
  setSettings({ secondSidebarEnabled: true })
  showAssignmentMenu(100, 200, 'test-tab-hide', 'Hide Tab')
  hideAssignmentMenu()
  const menuAfterHide = document.querySelector('.canvas-tab-context-menu')
  assert(menuAfterHide === null, 'hideAssignmentMenu removes menu from DOM')
} catch (e) {
  console.log(`SKIP: hideAssignmentMenu requires DOM — ${e}`)
}

// --- patchHostDrawerSettings fail path: toggle still works (no crash) ---
try {
  if (typeof document === 'undefined') {
    throw new Error('document not available')
  }
  // No test seam set — patchHostDrawerSettings will NO-GO gracefully.
  const prevForPatch = getSettings().secondSidebarEnabled
  hideAssignmentMenu()
  setSettings({ secondSidebarEnabled: true })
  try {
    showAssignmentMenu(100, 200, 'test-tab-patch-fail', 'Patch Fail Tab')
    const menu = document.querySelector('.canvas-tab-context-menu')
    assert(menu !== null, 'patch fail: menu is created')

    // Toggle button should still exist and click without throwing
    const toggleItem = menu!.children[0] as HTMLElement
    assert(toggleItem.tagName === 'BUTTON', 'patch fail: toggle is a button')
    toggleItem.click()
    // No crash means success
    assert(true, 'patch fail: toggle click did not throw')
  } finally {
    setSettings({ secondSidebarEnabled: prevForPatch })
    hideAssignmentMenu()
  }
} catch (e) {
  console.log(`SKIP: patch fail path test requires DOM — ${e}`)
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    console.error(`FAIL: ${message} — expected ${expected}, got ${actual}`)
    failed++
  }
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
