// Regression wiring: built-ins prefer host tabLocations; DOM reparent is
// last-resort only (via=dom) when bridge+store fail.
import { readFileSync } from 'fs'
import { join } from 'path'

let passed = 0, failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) passed++
  else {
    failed++
    console.error('FAIL:', msg)
  }
}

const secSrc = readFileSync(join(process.cwd(), 'src/sidebar/secondary-drawer.ts'), 'utf8')
const helperSrc = readFileSync(join(process.cwd(), 'src/tabs/builtin-move.ts'), 'utf8')
const assignSrc = readFileSync(join(process.cwd(), 'src/tabs/assignment.ts'), 'utf8')

assert(
  !/textContent\?\.includes\(tab\.title/.test(secSrc),
  'T-WIRE: no panelContent textContent title scrape (Profile crash class)',
)
assert(
  secSrc.includes('moveBuiltInTabToSecondaryContainer'),
  'T-WIRE: secondary-drawer uses moveBuiltInTabToSecondaryContainer',
)
assert(
  secSrc.includes('STORE_ROOT') || secSrc.includes('_storeTab?.root'),
  'T-WIRE: store-root fallback still present for non-host roots',
)
assert(
  helperSrc.includes('requestHostTabToSecondary') || helperSrc.includes('requestTabLocation'),
  'T-WIRE: builtin-move calls host location API',
)
assert(
  helperSrc.includes('tryDomPlaceRoot') || helperSrc.includes('via=dom'),
  'T-WIRE: builtin-move has DOM last-resort path',
)
assert(
  assignSrc.includes('moveBuiltInTabToSecondaryContainer'),
  'T-WIRE: assignTab uses shared helper',
)
assert(
  assignSrc.includes('no empty secondary handoff') ||
    assignSrc.includes('place failed; aborting'),
  'T-WIRE: assignTab fail-closes built-in place without handoff',
)
assert(
  !secSrc.includes("textContent?.includes(tab.title"),
  'T-WIRE: no loose textContent title match for built-in roots',
)

// Behavioral (no document): host move API contract
async function behavioral() {
  const calls: string[] = []
  const locations: Record<string, { kind: string; containerId?: string }> = {}
  const { setHostBridgeContext } = await import('../../dom/host-bridge')
  const { __setHostMoveTabToForTest } = await import('../../tabs/host-tab-location')
  const { __clearDomPlacedForTest } = await import('../../tabs/dom-placed-builtin')

  setHostBridgeContext({
    ui: {
      getBuiltInTabRoot: () => undefined,
      requestTabLocation: (tabId: string, loc: any) => {
        calls.push(`request:${tabId}:${JSON.stringify(loc)}`)
        locations[tabId] = loc
      },
      getTabLocation: (tabId: string) =>
        locations[tabId] ?? { kind: 'main-drawer' },
    },
    containers: {},
  } as any)
  __setHostMoveTabToForTest(null)
  __clearDomPlacedForTest()

  const origRaf = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    queueMicrotask(() => cb(0))
    return 0
  }) as typeof requestAnimationFrame

  try {
    const { moveBuiltInTabToSecondaryContainer } = await import('../../tabs/builtin-move')
    const root = {
      setAttribute() {},
      removeAttribute() {},
      querySelector() { return null },
      hasAttribute() { return false },
      parentElement: null as any,
    } as any
    const moved = await moveBuiltInTabToSecondaryContainer({ tabId: 'profile', root })
    assert(!!moved, 'T-BEH: returns root when provided')
    assert(
      calls.some(c => c.startsWith('request:profile:')),
      'T-BEH: requestTabLocation for profile',
    )
    assert(
      calls.some(c => c.includes('canvas-secondary-drawer')),
      'T-BEH: secondary container id',
    )

    // Non-CORE silent no-op without store and without secondary shell → fail closed
    calls.length = 0
    setHostBridgeContext({
      ui: {
        getBuiltInTabRoot: () => root,
        requestTabLocation: () => {
          calls.push('noop')
        },
        getTabLocation: () => ({ kind: 'main-drawer' }),
      },
      containers: {},
    } as any)
    __setHostMoveTabToForTest(null)
    __clearDomPlacedForTest()
    const empty = await moveBuiltInTabToSecondaryContainer({ tabId: 'imagegen', root })
    assert(empty === undefined, 'T-BEH: non-CORE no-op without store/shell → undefined (no empty panel)')

    // Non-CORE silent no-op with store fallback → success
    const storeLocs: Record<string, any> = {}
    setHostBridgeContext({
      ui: {
        getBuiltInTabRoot: () => root,
        requestTabLocation: () => {},
        getTabLocation: (id: string) => storeLocs[id] ?? { kind: 'main-drawer' },
      },
      containers: {},
    } as any)
    __setHostMoveTabToForTest((id, loc) => {
      storeLocs[id] = loc
    })
    const viaStore = await moveBuiltInTabToSecondaryContainer({ tabId: 'wallpaper', root })
    assert(!!viaStore, 'T-BEH: non-CORE with store.moveTabTo → root')
    assertEqualish(
      storeLocs.wallpaper?.containerId,
      'canvas-secondary-drawer',
      'T-BEH: store wrote secondary container',
    )

    setHostBridgeContext(null)
    __setHostMoveTabToForTest(null)
    __clearDomPlacedForTest()
    const none = await moveBuiltInTabToSecondaryContainer({ tabId: 'profile' })
    assert(none === undefined, 'T-BEH: no bridge → undefined')
  } finally {
    globalThis.requestAnimationFrame = origRaf
    setHostBridgeContext(null)
    __setHostMoveTabToForTest(null)
    __clearDomPlacedForTest()
  }
}

function assertEqualish(actual: unknown, expected: unknown, msg: string) {
  assert(actual === expected, `${msg} (got ${String(actual)})`)
}

behavioral().then(() => {
  console.log(`secondary-drawer-builtin-no-raw-reparent: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}).catch((e) => {
  console.error(e)
  process.exit(1)
})
