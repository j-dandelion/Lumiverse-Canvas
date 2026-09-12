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
  clearSpuriousActiveTabReset,
  __setHostMoveTabToForTest,
  __setHostActiveTabIdForTest,
  __setClearPendingActiveTabResetForTest,
  CANVAS_SECONDARY_CONTAINER_ID,
} from '../host-tab-location'
import { setHostBridgeContext } from '../../dom/host-bridge'

const _origWindow = (globalThis as any).window

function restore() {
  setHostBridgeContext(null)
  __setHostMoveTabToForTest(null)
  __setHostActiveTabIdForTest(undefined)
  __setClearPendingActiveTabResetForTest(null)
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
// T6 (live-verify #13): a NON-active move-out clears the host's spurious
// pendingActiveTabReset — the flag ViewportDrawer's effect turns into
// "switch active to the first remaining tab", which repainted the active
// tab's content on every main→second drag.
// =====================================================================
{
  let cleared = 0
  __setHostActiveTabIdForTest('profile')
  __setClearPendingActiveTabResetForTest(() => { cleared++ })

  assertEqual(clearSpuriousActiveTabReset('personas'), true, 'T6a: cleared for a non-active move')
  assertEqual(cleared, 1, 'T6b: clear action called exactly once')
  restore()
}

// =====================================================================
// T7: an ACTIVE move keeps the reset — the host must pick a replacement and
// Canvas's neighbor handoff owns the convergence.
// =====================================================================
{
  let cleared = 0
  __setHostActiveTabIdForTest('profile')
  __setClearPendingActiveTabResetForTest(() => { cleared++ })

  assertEqual(clearSpuriousActiveTabReset('profile'), false, 'T7a: not cleared for an active move')
  assertEqual(
    clearSpuriousActiveTabReset('spindle:profile:tab:profile:1'),
    false,
    'T7b: composite id still matches the host active (tolerant match)',
  )
  assertEqual(cleared, 0, 'T7c: clear action never called')
  restore()
}

// =====================================================================
// T8: the guard rides the real move-out path (requestHostTabToSecondary),
// so extension + built-in placement both get it.
// =====================================================================
{
  let cleared = 0
  __setHostActiveTabIdForTest('profile')
  __setClearPendingActiveTabResetForTest(() => { cleared++ })
  const locations: Record<string, { kind: string; containerId?: string }> = {
    personas: { kind: 'main-drawer' },
  }
  setHostBridgeContext({
    ui: {
      requestTabLocation: (id: string, loc: any) => { locations[id] = loc },
      getTabLocation: (id: string) => locations[id] ?? { kind: 'main-drawer' },
    },
    containers: {},
  } as any)

  const r = requestHostTabToSecondary('personas')
  assertEqual(r.ok, true, 'T8a: move-out still reports ok')
  assertEqual(cleared, 1, 'T8b: move-out ran the spurious-reset guard')
  restore()
}

// =====================================================================
// T9 (review batch 1): an UNKNOWN host active must keep the reset. We cannot
// distinguish an active-tab move (which the host's reset must drive) from a
// non-active one when neither the DOM nor the store exposes the active, so
// clearing here would suppress a legitimate replacement.
// =====================================================================
{
  let cleared = 0
  __setHostActiveTabIdForTest(null)
  __setClearPendingActiveTabResetForTest(() => { cleared++ })

  assertEqual(clearSpuriousActiveTabReset('personas'), false, 'T9a: unknown active → not cleared')
  assertEqual(cleared, 0, 'T9b: clear action never called')
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
