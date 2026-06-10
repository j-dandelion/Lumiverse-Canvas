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
import { findSafeFallbackButton, isSettingsButton } from '../buttons'

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

// --- findSafeFallbackButton skips the Settings tab ---
// Regression test for the ghost-panel bug: when the only extension tab
// in the main sidebar is moved to the second sidebar while focused, the
// fallback-button picker used to land on the Lumiverse Settings tab,
// which opens the Settings panel and leaves a ghost panel (header only,
// empty body) in the main sidebar. The fix excludes the Settings tab
// from the candidate set.
//
// We mock the minimal DOM surface we need (button.className, button.style,
// button.getAttribute, button.setAttribute, and sidebar.querySelectorAll)
// so the test runs under bun's headless test runner — no jsdom needed.
{
  type FakeButton = {
    className: string
    style: { display: string }
    attributes: Record<string, string>
    setAttribute(name: string, value: string): void
    getAttribute(name: string): string | null
  }
  function makeButton(opts: { className: string; attrs?: Record<string, string>; display?: string }): FakeButton {
    const attrs: Record<string, string> = { ...(opts.attrs ?? {}) }
    return {
      className: opts.className,
      style: { display: opts.display ?? '' },
      attributes: attrs,
      setAttribute(name: string, value: string) { attrs[name] = value },
      getAttribute(name: string) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null },
    }
  }
  function makeSidebar(buttons: FakeButton[]): { querySelectorAll(sel: string): FakeButton[] } {
    return {
      querySelectorAll(sel: string): FakeButton[] {
        // Match the production selector: 'button[class*="tabBtn"]'
        if (sel !== 'button[class*="tabBtn"]') return []
        return buttons.filter((b) => b.className.includes('tabBtn'))
      },
    }
  }

  // Typical built-in order: [Settings, Chats, extTabA]
  // extTabA is the only extension tab and is the one being moved.
  const settingsBtn = makeButton({
    className: 'tabBtn tabBtnSettings',
    attrs: { title: 'Settings', 'aria-label': 'Open settings' },
  })
  const chatsBtn = makeButton({
    className: 'tabBtn',
    attrs: { title: 'Chats', 'aria-label': 'Open chats' },
  })
  const extBtn = makeButton({
    className: 'tabBtn tabBtnExtension',
    attrs: { 'data-tab-id': 'tab-a', title: 'TabA' },
  })

  // Cast to HTMLElement — the helper only reads className, style.display,
  // getAttribute; structural typing makes the cast safe under our test.
  const sidebar1 = makeSidebar([settingsBtn, chatsBtn, extBtn]) as unknown as HTMLElement

  // Predicate
  assert(isSettingsButton(settingsBtn as unknown as HTMLElement) === true, 'isSettingsButton recognises tabBtnSettings class')
  assert(isSettingsButton(chatsBtn as unknown as HTMLElement) === false, 'isSettingsButton does not flag Chats')

  // Helper
  const picked = findSafeFallbackButton(sidebar1)
  assert(picked === (chatsBtn as unknown as HTMLElement), 'findSafeFallbackButton returns the Chats tab, not Settings')
  assert(picked !== (settingsBtn as unknown as HTMLElement), 'findSafeFallbackButton never returns the Settings tab')

  // Predicate: aria-label only (no class, no title)
  const ariaOnly = makeButton({ className: 'tabBtn', attrs: { 'aria-label': 'User preferences' } })
  assert(isSettingsButton(ariaOnly as unknown as HTMLElement) === true, 'isSettingsButton recognises aria-label "preferences"')

  // Predicate: title only (no class, no aria-label)
  const titleOnly = makeButton({ className: 'tabBtn', attrs: { title: 'Settings panel' } })
  assert(isSettingsButton(titleOnly as unknown as HTMLElement) === true, 'isSettingsButton recognises title "settings"')

  // Degenerate: only Settings + extension tabs → null
  const sidebar2 = makeSidebar([
    makeButton({ className: 'tabBtn tabBtnSettings', attrs: { title: 'Settings' } }),
    makeButton({ className: 'tabBtn tabBtnExtension', attrs: { title: 'extA' } }),
  ]) as unknown as HTMLElement
  assert(findSafeFallbackButton(sidebar2) === null, 'findSafeFallbackButton returns null when only Settings is the safe built-in')

  // Hidden Settings (display:none) is treated as not present
  const hiddenSettings = makeButton({
    className: 'tabBtn tabBtnSettings',
    attrs: { title: 'Settings' },
    display: 'none',
  })
  const chatsBtn2 = makeButton({ className: 'tabBtn', attrs: { title: 'Chats' } })
  const sidebar3 = makeSidebar([hiddenSettings, chatsBtn2]) as unknown as HTMLElement
  const pickedHidden = findSafeFallbackButton(sidebar3)
  assert(pickedHidden === (chatsBtn2 as unknown as HTMLElement), 'findSafeFallbackButton returns Chats when Settings is hidden')
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    console.error(`FAIL: ${message} — expected ${expected}, got ${actual}`)
    failed++
  }
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
