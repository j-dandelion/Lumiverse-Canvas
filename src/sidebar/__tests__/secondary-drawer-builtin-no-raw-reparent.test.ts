// Regression wiring: built-ins never raw-reparent host roots.
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
  helperSrc.includes('requestTabLocation'),
  'T-WIRE: builtin-move calls requestTabLocation',
)
assert(
  !/\.appendChild\s*\(/.test(helperSrc),
  'T-WIRE: builtin-move has no .appendChild( calls',
)
assert(
  assignSrc.includes('moveBuiltInTabToSecondaryContainer'),
  'T-WIRE: assignTab uses shared helper',
)
assert(
  !secSrc.includes("textContent?.includes(tab.title"),
  'T-WIRE: no loose textContent title match for built-in roots',
)

// Behavioral (no document): host move API contract
async function behavioral() {
  const calls: string[] = []
  ;(globalThis as any).window = {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true },
    matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} } },
    spindle: {
      ui: {
        getBuiltInTabRoot: () => undefined,
        requestTabLocation: (tabId: string, loc: unknown) => {
          calls.push(`request:${tabId}:${JSON.stringify(loc)}`)
        },
        getTabLocation: () => ({ kind: 'container', containerId: 'canvas-secondary-drawer' }),
      },
    },
  }
  const origRaf = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    queueMicrotask(() => cb(0))
    return 0
  }) as typeof requestAnimationFrame

  try {
    const { moveBuiltInTabToSecondaryContainer } = await import('../../tabs/builtin-move')
    const root = { setAttribute() {}, querySelector() { return null } } as any
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

    ;(globalThis as any).window = { spindle: undefined }
    const none = await moveBuiltInTabToSecondaryContainer({ tabId: 'profile' })
    assert(none === undefined, 'T-BEH: no bridge → undefined')
  } finally {
    globalThis.requestAnimationFrame = origRaf
  }
}

behavioral().then(() => {
  console.log(`secondary-drawer-builtin-no-raw-reparent: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}).catch((e) => {
  console.error(e)
  process.exit(1)
})
