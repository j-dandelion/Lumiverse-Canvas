// Debug-mode diagnostics for the Configure ↔ main-UI ↔ persistence sync
// (2026-08-17). These tests turn debug mode ON and assert that the new
// dlog diagnostics actually fire with the expected content:
//
//   [dispatch] persist layout            — every actual disk write summary
//   [dispatch] host drawer side adopted  — Lumiverse "Drawer side" toggled
//   [dispatch] boot restore              — saved layout → model at boot
//
// The flows driven here are the REAL dispatch + REAL model reduction
// against the FakeHost — same harness as tracked-active-sync.test.ts.

;(globalThis as any).document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({}),
  getElementById: () => null,
  documentElement: {
    classList: { add() {}, remove() {}, contains() { return false } },
    style: { setProperty() {}, removeProperty() {}, getPropertyValue() { return '' } },
  },
  body: { appendChild() {}, removeChild() {} },
}
;(globalThis as any).window = {
  matchMedia: () => ({ matches: false }),
  addEventListener: () => {},
  removeEventListener: () => {},
}
;(globalThis as any).requestAnimationFrame = (cb: any) => { cb(1); return 1 }
;(globalThis as any).cancelAnimationFrame = () => {}
;(globalThis as any).CSS = { escape: (s: string) => s }
;(globalThis as any).getComputedStyle = () => ({})

import { FakeHost, type LiveTab } from '../../host/fake/implementation'
import { bootstrap, shutdown, flush, dispatchBatch, bootstrapFromLayout, getModel } from '../../recon/dispatch'
import { serializeModelToLayout } from '../../persist/layout-model'
import {
  createEmptyModel,
  builtinKey,
  extensionKey,
  type LayoutModel,
  type TabKey,
  type Side,
  type DrawerSide,
} from '../../core/model'
import { setDebug } from '../log'

const PROFILE = builtinKey('profile')
const PRESETS = builtinKey('presets')
const A = extensionKey('ext', 'a')
const B = extensionKey('ext', 'b')

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertIncludes(haystack: string, needle: string, msg: string) {
  if (haystack.includes(needle)) { passed++ }
  else {
    console.error(`FAIL: ${msg} — log does not include: ${needle}`)
    console.error(`  log excerpt: ${haystack.slice(0, 800)}`)
    failed++
  }
}

function makeLiveTab(key: TabKey, liveId: string, location: Side, overrides?: Partial<LiveTab>): LiveTab {
  return {
    key, liveId, location,
    hidden: false,
    activeInPrimary: false,
    activeInSecondary: false,
    hasContentRoot: true,
    isBuiltin: key.startsWith('builtin:'),
    ...overrides,
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function settle(): Promise<void> {
  await sleep(5)
  await flush()
  await sleep(5)
  await flush()
}

function dualHost(side: DrawerSide = 'left') {
  return new FakeHost([
    makeLiveTab(PROFILE, 'profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(PRESETS, 'presets', 'primary'),
    makeLiveTab(A, 'h:a', 'secondary', { activeInSecondary: true }),
    makeLiveTab(B, 'h:b', 'secondary'),
  ], side)
}

function dualModel(side: DrawerSide = 'left'): LayoutModel {
  return {
    ...createEmptyModel(),
    primary: [PROFILE, PRESETS],
    secondary: [A, B],
    hidden: [],
    active: { primary: PROFILE, secondary: A },
    side,
  }
}

// ── log capture ──
let capturedLog = ''
const origLog = console.log
function startCapture() {
  capturedLog = ''
  console.log = (...args: unknown[]) => {
    capturedLog += args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n'
  }
  setDebug(true)
}
function stopCapture() {
  setDebug(false)
  console.log = origLog
}

// ============================================================================
// D1 — a swap dispatches AND the persisted layout summary carries the new side
// ============================================================================
async function testSwapPersistDiagnostic() {
  shutdown()
  startCapture()
  try {
    const host = dualHost('left')
    bootstrap(dualModel('left'), host)
    await flush()

    // Configure "Swap drawer locations": the commit's swapSides intent.
    await dispatchBatch([{ t: 'swapSides' }])
    await settle()

    const model = getModel()
    assert(model != null, 'D1a: model present after swap')
    if (model) {
      assert(model.side === 'right', 'D1b: model side flipped to right')
      const blob = serializeModelToLayout(model, (k) => host.resolve(k), 'test-v1.0')
      assert(blob.drawerSide === 'right', 'D1c: persisted drawerSide follows the swap')
    }

    // The persist diagnostic must show the swapped side + the split counts.
    assertIncludes(capturedLog, '[dispatch] persist layout', 'D1d: persist layout diagnostic fired')
    assertIncludes(capturedLog, '"drawerSide":"right"', 'D1e: persisted summary carries the new side')
    assertIncludes(capturedLog, '"primary":2', 'D1f: persisted summary primary count')
    assertIncludes(capturedLog, '"secondary":2', 'D1g: persisted summary secondary count')
  } finally {
    stopCapture()
    shutdown()
  }
}

// ============================================================================
// D2 — host-initiated side flip (Lumiverse "Drawer side" setting toggled)
// ============================================================================
async function testHostSideFlipDiagnostic() {
  shutdown()
  startCapture()
  try {
    const host = dualHost('left')
    bootstrap(dualModel('left'), host)
    await flush()

    // The HOST moves the drawer (Lumiverse Settings modal "Drawer side"
    // toggle → store → React wrapper flip). FakeHost.setSide is the
    // host-side write; the world observer then fires a host-sync.
    await host.setSide('right')
    await settle()

    const model = getModel()
    assert(model != null, 'D2a: model present')
    if (model) {
      assert(model.side === 'right', 'D2b: model converged on the host side')
    }
    assertIncludes(capturedLog, '[dispatch] host drawer side adopted', 'D2c: side-adoption diagnostic fired')
    assertIncludes(capturedLog, '"modelBefore":"left"', 'D2d: adoption log has before side')
    assertIncludes(capturedLog, '"modelAfter":"right"', 'D2e: adoption log has after side')
    assertIncludes(capturedLog, '[dispatch] persist layout', 'D2f: the flip persisted')
    assertIncludes(capturedLog, '"drawerSide":"right"', 'D2g: persisted blob carries the real side')
  } finally {
    stopCapture()
    shutdown()
  }
}

// ============================================================================
// D3 — boot restore summary (hard refresh / server restart path)
// ============================================================================
async function testBootRestoreDiagnostic() {
  shutdown()
  startCapture()
  try {
    const host = dualHost('right')
    const saved = serializeModelToLayout(
      dualModel('right'),
      (k) => host.resolve(k),
      'test-v1.0',
    )
    bootstrapFromLayout(saved, host, 'test-v1.0')
    await settle()

    const model = getModel()
    assert(model != null, 'D3a: model present after restore')
    if (model) {
      assert(model.side === 'right', 'D3b: saved side restored')
      assert(model.primary.length === 2, 'D3c: primary tabs restored')
      assert(model.secondary.length === 2, 'D3d: secondary tabs restored')
    }
    assertIncludes(capturedLog, '[dispatch] boot restore', 'D3e: boot restore diagnostic fired')
    assertIncludes(capturedLog, '"expectedTabs":4', 'D3f: expected tab count')
    assertIncludes(capturedLog, '"resolvedTabs":4', 'D3g: resolved tab count')
    assertIncludes(capturedLog, '"savedDrawerSide":"right"', 'D3h: saved drawer side')
    assertIncludes(capturedLog, '"modelSecondary":2', 'D3i: model secondary restored')
  } finally {
    stopCapture()
    shutdown()
  }
}

// ── run ──
await testSwapPersistDiagnostic()
await testHostSideFlipDiagnostic()
await testBootRestoreDiagnostic()

if (failed > 0) {
  console.error(`sync-diagnostics: ${passed} passed, ${failed} failed`)
  process.exit(1)
} else {
  console.log(`sync-diagnostics: ${passed} passed, 0 failed`)
}
