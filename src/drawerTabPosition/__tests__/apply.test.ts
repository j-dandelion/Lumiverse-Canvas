// Tests for src/drawerTabPosition/apply.ts
//
// Verifies applyDrawerTabPosition behavior:
// - Defined mainDrawerTabOverrideVh writes mainTab.style.marginTop
// - Defined secondaryDrawerTabOverrideVh writes secondaryTab.style.marginTop
// - Both fields defined writes both tabs
// - Neither field defined does NOT clear existing inline styles
// - Null elements are a no-op (no throw)

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { failed++; console.error(`FAIL: ${msg} — expected ${String(expected)}, got ${String(actual)}`) }
}

class StubStyle {
  private _props: Record<string, string> = {}
  get marginTop() { return this._props['marginTop'] ?? '' }
  set marginTop(v: string) { this._props['marginTop'] = v }
}

class StubElement {
  style = new StubStyle()
}

const mainTab = new StubElement()
const secondaryTab = new StubElement()

import { applyDrawerTabPosition } from '../apply'
import type { FullCanvasSettings } from '../../settings/state'

// Minimal settings object — only the fields applyDrawerTabPosition reads matter
function makeSettings(overrides: Partial<FullCanvasSettings> = {}): FullCanvasSettings {
  return {
    secondSidebarEnabled: true,
    resizeSidebars: true,
    mirrorCompactPosition: true,
    showTabLabels: 'follow',
    moveControlsToOuterEdge: false,
    drawerShadowsDesktop: true,
    drawerShadowsMobile: false,
    chatReflow: true,
    persistDrawerOpenState: true,
    persistDrawerWidth: true,
    persistTabAssignments: true,
    slashCommandsEnabled: true,
    debugMode: false,
    drawerTabDrag: true,
    mainDrawerTabOverrideVh: undefined,
    secondaryDrawerTabOverrideVh: undefined,
    ...overrides,
  } as FullCanvasSettings
}

// ============================================================
// Case 1: mainDrawerTabOverrideVh defined writes mainTab
// ============================================================
{
  mainTab.style = new StubStyle()
  secondaryTab.style = new StubStyle()
  const settings = makeSettings({ mainDrawerTabOverrideVh: 35 })
  applyDrawerTabPosition(settings, mainTab as any, secondaryTab as any)
  assertEqual(mainTab.style.marginTop, '35vh', 'C1: main override writes mainTab marginTop')
  assertEqual(secondaryTab.style.marginTop, '', 'C1: no secondary override leaves secondary untouched')
}

// ============================================================
// Case 2: secondaryDrawerTabOverrideVh defined writes secondaryTab
// ============================================================
{
  mainTab.style = new StubStyle()
  secondaryTab.style = new StubStyle()
  const settings = makeSettings({ secondaryDrawerTabOverrideVh: 50 })
  applyDrawerTabPosition(settings, mainTab as any, secondaryTab as any)
  assertEqual(mainTab.style.marginTop, '', 'C2: no main override leaves main untouched')
  assertEqual(secondaryTab.style.marginTop, '50vh', 'C2: secondary override writes secondaryTab marginTop')
}

// ============================================================
// Case 3: both fields defined writes both tabs
// ============================================================
{
  mainTab.style = new StubStyle()
  secondaryTab.style = new StubStyle()
  const settings = makeSettings({ mainDrawerTabOverrideVh: 20, secondaryDrawerTabOverrideVh: 45 })
  applyDrawerTabPosition(settings, mainTab as any, secondaryTab as any)
  assertEqual(mainTab.style.marginTop, '20vh', 'C3: main override writes mainTab')
  assertEqual(secondaryTab.style.marginTop, '45vh', 'C3: secondary override writes secondaryTab (independent of main)')
}

// ============================================================
// Case 4: neither field defined does NOT clear existing inline styles
// ============================================================
{
  mainTab.style = new StubStyle()
  mainTab.style.marginTop = '17vh'  // pre-existing value
  secondaryTab.style = new StubStyle()
  secondaryTab.style.marginTop = '23vh'  // pre-existing value
  const settings = makeSettings()
  applyDrawerTabPosition(settings, mainTab as any, secondaryTab as any)
  assertEqual(mainTab.style.marginTop, '17vh', 'C4: no main override preserves existing main marginTop')
  assertEqual(secondaryTab.style.marginTop, '23vh', 'C4: no secondary override preserves existing secondary marginTop')
}

// ============================================================
// Case 5: null elements is a no-op (no throw)
// ============================================================
{
  const settings = makeSettings({ mainDrawerTabOverrideVh: 30, secondaryDrawerTabOverrideVh: 40 })
  // Should not throw
  let threw = false
  try {
    applyDrawerTabPosition(settings, null, null)
  } catch {
    threw = true
  }
  assert(!threw, 'C5: null main + null secondary does not throw')

  // Also test one null, one present
  mainTab.style = new StubStyle()
  secondaryTab.style = new StubStyle()
  threw = false
  try {
    applyDrawerTabPosition(settings, null, secondaryTab as any)
  } catch {
    threw = true
  }
  assert(!threw, 'C5: null main, present secondary does not throw')
  assertEqual(secondaryTab.style.marginTop, '40vh', 'C5: secondary written even when main is null')
}

console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
process.exit(failed > 0 ? 1 : 0)
