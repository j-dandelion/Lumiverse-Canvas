// Tests for getHostBridge() edge cases.
// Verifies null-safety paths and partial/malformed spindle objects.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { failed++; console.error(`FAIL: ${msg} — expected ${String(expected)}, got ${String(actual)}`) }
}

import { getHostBridge } from '../host-bridge'

// Save original window
const _origWindow = (globalThis as any).window

function setSpindle(spindle: any) {
  ;(globalThis as any).window = { spindle }
}

function clearWindow() {
  ;(globalThis as any).window = undefined
}

function restore() {
  ;(globalThis as any).window = _origWindow
}

// =====================================================================
// T1: window.spindle is undefined → returns null
// =====================================================================
{
  setSpindle(undefined)
  assertEqual(getHostBridge(), null, 'T1: returns null when spindle is undefined')
  restore()
}

// =====================================================================
// T2: window.spindle is null → returns null
// =====================================================================
{
  setSpindle(null)
  assertEqual(getHostBridge(), null, 'T2: returns null when spindle is null')
  restore()
}

// =====================================================================
// T3: window.spindle is well-formed → returns bridge with ui/containers
// =====================================================================
{
  const getBuiltInTabRoot = (_tabId: string) => undefined
  const registerContainer = (_entry: any) => {}
  setSpindle({
    ui: { getBuiltInTabRoot },
    containers: { registerContainer },
  })
  const bridge = getHostBridge()
  assert(bridge !== null, 'T3: returns non-null for well-formed spindle')
  assertEqual(typeof bridge!.ui.getBuiltInTabRoot, 'function', 'T3: bridge.ui.getBuiltInTabRoot is the provided function')
  assertEqual(typeof bridge!.containers.registerContainer, 'function', 'T3: bridge.containers.registerContainer is the provided function')
  restore()
}

// =====================================================================
// T4: Partial spindle (missing ui) → bridge.ui is undefined
// =====================================================================
{
  setSpindle({ containers: { registerContainer: () => {} } })
  const bridge = getHostBridge()
  assert(bridge !== null, 'T4: returns non-null (cast is unchecked)')
  assertEqual(bridge!.ui, undefined, 'T4: bridge.ui is undefined when spindle has no ui')
  assert(bridge!.containers !== undefined, 'T4: bridge.containers is defined')
  restore()
}

// =====================================================================
// T5: Partial spindle (missing containers) → bridge.containers is undefined
// =====================================================================
{
  setSpindle({ ui: { getBuiltInTabRoot: () => undefined } })
  const bridge = getHostBridge()
  assert(bridge !== null, 'T5: returns non-null (cast is unchecked)')
  assertEqual(bridge!.containers, undefined, 'T5: bridge.containers is undefined when spindle has no containers')
  assert(bridge!.ui !== undefined, 'T5: bridge.ui is defined')
  restore()
}

// =====================================================================
// T6: Non-object spindle (primitive) → bridge.ui/containers are undefined
// =====================================================================
{
  // Truthy non-object — the !ctx check passes, but ctx.ui/containers
  // are undefined because primitives don't have those properties.
  setSpindle(true)
  const bridge = getHostBridge()
  assert(bridge !== null, 'T6: returns non-null for truthy non-object spindle')
  assertEqual(bridge!.ui, undefined, 'T6: bridge.ui is undefined for truthy non-object')
  assertEqual(bridge!.containers, undefined, 'T6: bridge.containers is undefined for truthy non-object')
  restore()
}

// =====================================================================
// T7: Falsy spindle values (0, '', false) → returns null
// =====================================================================
{
  setSpindle(0)
  assertEqual(getHostBridge(), null, 'T7a: returns null for spindle=0')

  setSpindle('')
  assertEqual(getHostBridge(), null, 'T7b: returns null for spindle=""')

  setSpindle(false)
  assertEqual(getHostBridge(), null, 'T7c: returns null for spindle=false')
  restore()
}

// =====================================================================
// T8: Method on ui is missing → bridge.ui.method is undefined
// =====================================================================
{
  setSpindle({ ui: {}, containers: {} })
  const bridge = getHostBridge()
  assert(bridge !== null, 'T8: returns non-null for empty ui/containers')
  assertEqual(bridge!.ui.getBuiltInTabRoot, undefined, 'T8: missing getBuiltInTabRoot is undefined')
  assertEqual(bridge!.ui.requestTabLocation, undefined, 'T8: missing requestTabLocation is undefined')
  assertEqual(bridge!.ui.getTabLocation, undefined, 'T8: missing getTabLocation is undefined')
  restore()
}

// =====================================================================
// Summary
// =====================================================================
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
