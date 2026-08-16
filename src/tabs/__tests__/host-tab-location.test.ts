// Tests for requestHostTabLocation: bridge verify + store.moveTabTo fallback.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { failed++; console.error(`FAIL: ${msg} — expected ${String(expected)}, got ${String(actual)}`) }
}

import {
  locationMatches,
  requestHostTabLocation,
  requestHostTabToSecondary,
  __setHostMoveTabToForTest,
  CANVAS_SECONDARY_CONTAINER_ID,
} from '../host-tab-location'
import { setHostBridgeContext } from '../../dom/host-bridge'

const _origWindow = (globalThis as any).window

function restore() {
  setHostBridgeContext(null)
  __setHostMoveTabToForTest(null)
  ;(globalThis as any).window = _origWindow
}

// =====================================================================
// T1: locationMatches
// =====================================================================
{
  assert(locationMatches(null, { kind: 'main-drawer' }), 'T1a: null ≡ main-drawer')
  assert(!locationMatches(null, { kind: 'container', containerId: 'x' }), 'T1b: null ≠ container')
  assert(
    locationMatches(
      { kind: 'container', containerId: CANVAS_SECONDARY_CONTAINER_ID },
      { kind: 'container', containerId: CANVAS_SECONDARY_CONTAINER_ID },
    ),
    'T1c: matching container',
  )
  assert(
    !locationMatches(
      { kind: 'container', containerId: 'other' },
      { kind: 'container', containerId: CANVAS_SECONDARY_CONTAINER_ID },
    ),
    'T1d: wrong containerId',
  )
}

// =====================================================================
// T2: bridge sticks → ok via=bridge
// =====================================================================
{
  const locations: Record<string, { kind: string; containerId?: string }> = {
    lorebook: { kind: 'main-drawer' },
  }
  setHostBridgeContext({
    ui: {
      requestTabLocation: (id: string, loc: any) => {
        locations[id] = loc
      },
      getTabLocation: (id: string) => locations[id] ?? { kind: 'main-drawer' },
    },
    containers: {},
  } as any)
  __setHostMoveTabToForTest(null)

  const r = requestHostTabToSecondary('lorebook')
  assertEqual(r.ok, true, 'T2: ok')
  assertEqual(r.via, 'bridge', 'T2: via bridge')
  assertEqual(locations.lorebook.kind, 'container', 'T2: location written')
  restore()
}

// =====================================================================
// T3: bridge silent no-op (non-CORE) → store fallback succeeds
// =====================================================================
{
  const locations: Record<string, { kind: string; containerId?: string }> = {
    imagegen: { kind: 'main-drawer' },
  }
  setHostBridgeContext({
    ui: {
      // Host allowlist: accept call but do nothing
      requestTabLocation: () => {},
      getTabLocation: (id: string) => locations[id] ?? { kind: 'main-drawer' },
    },
    containers: {},
  } as any)
  __setHostMoveTabToForTest((id, loc) => {
    locations[id] = loc as any
  })

  const r = requestHostTabLocation('imagegen', {
    kind: 'container',
    containerId: CANVAS_SECONDARY_CONTAINER_ID,
  })
  assertEqual(r.ok, true, 'T3: ok via store')
  assertEqual(r.via, 'store', 'T3: via store')
  assertEqual(
    (locations.imagegen as any).containerId,
    CANVAS_SECONDARY_CONTAINER_ID,
    'T3: store wrote container',
  )
  restore()
}

// =====================================================================
// T4: bridge no-op + no store → fail closed
// =====================================================================
{
  setHostBridgeContext({
    ui: {
      requestTabLocation: () => {},
      getTabLocation: () => ({ kind: 'main-drawer' }),
    },
    containers: {},
  } as any)
  __setHostMoveTabToForTest(null)

  const r = requestHostTabToSecondary('wallpaper')
  assertEqual(r.ok, false, 'T4: fails when nothing sticks')
  assertEqual(r.via, 'none', 'T4: via none')
  restore()
}

// =====================================================================
// T5: restore to main via store when bridge no-ops
// =====================================================================
{
  const locations: Record<string, { kind: string; containerId?: string }> = {
    connections: { kind: 'container', containerId: CANVAS_SECONDARY_CONTAINER_ID },
  }
  setHostBridgeContext({
    ui: {
      requestTabLocation: () => {},
      getTabLocation: (id: string) => locations[id] ?? { kind: 'main-drawer' },
    },
    containers: {},
  } as any)
  __setHostMoveTabToForTest((id, loc) => {
    locations[id] = loc as any
  })

  const r = requestHostTabLocation('connections', { kind: 'main-drawer' })
  assertEqual(r.ok, true, 'T5: main restore ok')
  assertEqual(r.via, 'store', 'T5: via store')
  assertEqual(locations.connections.kind, 'main-drawer', 'T5: location main-drawer')
  restore()
}

// =====================================================================
// Summary
// =====================================================================
if (failed > 0) {
  console.error(`host-tab-location: FAILED ${failed}`)
  process.exitCode = 1
} else {
  console.log(`host-tab-location: PASS ${passed}`)
}
