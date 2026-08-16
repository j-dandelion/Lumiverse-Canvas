// Regression: the secondary drawer's open/close state must reach the owned
// model (and layout.json). The secondary wrapper lives on document.body —
// OUTSIDE the host sidebar subtree — so its open/close never fires the
// world-changed observers (sidebar/mirror MutationObservers + DrawerObserver)
// that keep the main drawer's state in sync. persistSecondaryDrawerOpen
// dispatches the setDrawer intent explicitly from the shell's open/close
// choke points; without it a hard refresh mounts the drawer closed again.

;(globalThis as any).document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({}),
  documentElement: {
    classList: { add() {}, remove() {}, contains() { return false } },
    style: { setProperty() {}, removeProperty() {}, getPropertyValue() { return '' } },
  },
  body: { appendChild() {}, removeChild() {} },
}
;(globalThis as any).requestAnimationFrame = (cb: any) => { cb(1); return 1 }
;(globalThis as any).cancelAnimationFrame = () => {}
;(globalThis as any).CSS = { escape: (s: string) => s }
;(globalThis as any).getComputedStyle = () => ({})

import { mock } from 'bun:test'

// Mock recon/dispatch with a recording dispatch. Must include the exports
// that secondary.tsx's STATIC import chain needs (tabs/assignment imports
// getModel/getHost) or the import fails.
const dispatched: Array<{ t: string; [key: string]: unknown }> = []
mock.module('../../recon/dispatch', () => ({
  dispatch: async (intent: any) => { dispatched.push(intent) },
  dispatchBatch: async () => {},
  getModel: () => null,
  getHost: () => null,
  flush: async () => {},
  bootstrap: () => {},
  bootstrapFromLayout: () => {},
  shutdown: () => {},
  dispatchMoveByLiveId: async () => {},
  captureMainMirrorMoveChrome: async () => ({ neighborBtn: null }),
  applyMainMirrorMoveChrome: async () => {},
  captureSecondaryNeighborForMove: async () => ({ neighborBtn: null }),
  applySecondaryNeighborHandoff: async () => {},
  placementFirstMoveByLiveId: async () => {},
}))

// ── Dynamic import (must be AFTER mock.module calls) ──
const { persistSecondaryDrawerOpen } = await import('../secondary')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ── Custom assertion harness (repo convention) ──
let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual === expected) { passed++ }
  else {
    console.error(`FAIL: ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    failed++
  }
}

// ── Open persists ──
persistSecondaryDrawerOpen(true)
await sleep(10)
assertEqual(dispatched.length, 1, 'open dispatches exactly one intent')
assertEqual(dispatched[0]?.t, 'setDrawer', 'open dispatches setDrawer')
assertEqual(dispatched[0]?.side, 'secondary', 'open targets the secondary drawer')
assertEqual(dispatched[0]?.open, true, 'open dispatches open: true')

// ── Close persists ──
persistSecondaryDrawerOpen(false)
await sleep(10)
assertEqual(dispatched.length, 2, 'close dispatches exactly one intent')
assertEqual(dispatched[1]?.t, 'setDrawer', 'close dispatches setDrawer')
assertEqual(dispatched[1]?.side, 'secondary', 'close targets the secondary drawer')
assertEqual(dispatched[1]?.open, false, 'close dispatches open: false')

// ── Summary ──
console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
if (failed > 0) process.exit(1)
