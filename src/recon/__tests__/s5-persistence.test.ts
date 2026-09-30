// S5: persistence single-path — the shell-owned model blob carries SHELL
// drawer truth, and snapshotLayout sources tabOrder from the model.
//
// 1. close-persists: dispatching setDrawer(primary,{open:false,width}) (the
//    new write path wired into openCanvasMainDrawer/closeCanvasMainDrawer)
//    must make serializeModelToLayout emit primary.open=false. Pre-S5 the
//    model's drawers.primary was fed from the HOST wrapper (store-open
//    forever), so a closed shell never persisted.
// 2. tabOrder: snapshotOwnedModelLayout()'s tabOrder is the combined
//    primary+secondary resolved list; snapshotLayout() must source it from
//    the model when one is live (host tabOrder writes stopped in S2), and
//    fall back to the host settings copy pre-bootstrap.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else {
    console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    failed++
  }
}

// ── Minimal DOM stub (snapshotLayout reads documentElement in canvas-main
//    mode only; the fallback paths query host DOM → null) ──
;(globalThis as any).HTMLElement = class HTMLElement {
  hasAttribute(_n: string) { return false }
  getAttribute(_n: string) { return null }
  querySelectorAll(_s: string) { return [] as any[] }
  textContent: string | null = null
}
;(globalThis as any).document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  documentElement: {
    classList: {
      _classes: new Set<string>(),
      contains(c: string) { return this._classes.has(c) },
      add(c: string) { this._classes.add(c) },
      remove(c: string) { this._classes.delete(c) },
    },
    style: {
      _props: new Map<string, string>(),
      getPropertyValue(k: string) { return this._props.get(k) ?? '' },
      setProperty(k: string, v: string) { this._props.set(k, v) },
      removeProperty(k: string) { this._props.delete(k) },
    },
  },
  body: { querySelector: () => null },
}

import { builtinKey, extensionKey, createEmptyModel, type LayoutModel } from '../../core/model'
import { FakeHost, type LiveTab } from '../../host/fake/implementation'
import {
  bootstrap,
  shutdown,
  dispatch,
  flush,
  getModel,
  snapshotOwnedModelLayout,
} from '../../recon/dispatch'
import { serializeModelToLayout } from '../../persist/layout-model'
import { snapshotLayout } from '../../layout/snapshot'
import { CANVAS_VERSION } from '../../persist/backend-ctx'

function makeLiveTab(key: string, liveId: string, location: 'primary' | 'secondary', overrides?: Partial<LiveTab>): LiveTab {
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

const A = builtinKey('a')
const B = builtinKey('b')
const C = extensionKey('ext', 'c')

// ── Boot: A, B primary (A active), C secondary ──
shutdown()
const host = new FakeHost([
  makeLiveTab(A, 'h:a', 'primary', { activeInPrimary: true }),
  makeLiveTab(B, 'h:b', 'primary'),
  makeLiveTab(C, 'h:c', 'secondary', { activeInSecondary: true }),
])
const bootModel: LayoutModel = {
  ...createEmptyModel(),
  primary: [A, B],
  secondary: [C],
  hidden: [],
  active: { primary: A, secondary: C },
}
bootstrap(bootModel, host)
await flush()

const model = getModel()
assert(model != null, 'boot: model live')
assertEqual(model!.primary.join(','), [A, B].join(','), 'boot: primary order')
assertEqual(model!.secondary.join(','), [C].join(','), 'boot: secondary order')

// ══ 1. close-persists: setDrawer(primary, closed) → serialized open=false ══
{
  await dispatch({ t: 'setDrawer', side: 'primary', open: false, width: 380 })
  await flush()
  const layout = serializeModelToLayout(
    getModel()!,
    (key) => host.resolve(key as never) as never,
    CANVAS_VERSION,
  )
  assertEqual(layout.primary.open, false, '1a: closed shell persists primary.open=false')
  assertEqual(layout.primary.width, 380, '1b: shell width persists')
  // The blob is the SAME serialization snapshotOwnedModelLayout exposes.
  assertEqual(snapshotOwnedModelLayout()!.primary.open, false, '1c: snapshotOwnedModelLayout agrees')
  // Reopen → true again (no one-way ratchet).
  await dispatch({ t: 'setDrawer', side: 'primary', open: true, width: 420 })
  await flush()
  assertEqual(snapshotOwnedModelLayout()!.primary.open, true, '1d: reopen persists open=true')
}

// ══ 2. tabOrder: model-sourced while the model is live ══
{
  const owned = snapshotOwnedModelLayout()!
  const snap = snapshotLayout()
  assertEqual(
    snap.tabOrder.join(','),
    owned.tabOrder.join(','),
    '2a: snapshotLayout.tabOrder = model serialization (combined primary+secondary, live-id resolved)',
  )
  assertEqual(owned.tabOrder.join(','), ['h:a', 'h:b', 'h:c'].join(','), '2b: combined order is primary then secondary')
  assertEqual(
    snap.detachedTabs.map((t: any) => t.tabTitle).join(','),
    C,
    '2c: detachedTabs still model-keyed (tabTitle = TabKey)',
  )
}

// ══ 3. Secondary drawer fields stay shell-fed (unchanged by S5) ══
{
  const owned = snapshotOwnedModelLayout()!
  assertEqual(owned.secondary.activeTabId, 'h:c', '3a: secondary active resolved from model')
  assertEqual(owned.drawerSide, 'left', '3b: drawerSide stays a persisted model field')
}

shutdown()
console.log(`s5-persistence tests: ${passed} passed, ${failed} failed`)
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exit(1) }
