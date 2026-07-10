// Behavioral: ROOT_READY path defers with rAF then requestTabLocation.
// Lazy path covered by source-order warm-boot-builtin wiring test.

let passed = 0, failed = 0
const ok = (c: unknown, m: string) =>
  c ? passed++ : (failed++, console.error('FAIL:', m))

async function main(): Promise<void> {
  const calls: { name: string; t: number }[] = []
  let virtualT = 0

  const origRaf = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    calls.push({ name: 'rAF', t: virtualT })
    virtualT += 16
    queueMicrotask(() => cb(virtualT))
    return 0
  }) as typeof requestAnimationFrame

  ;(globalThis as any).window = {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true },
    matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} } },
    spindle: {
      ui: {
        getBuiltInTabRoot: () => undefined,
        requestTabLocation: () => {
          calls.push({ name: 'requestTabLocation', t: virtualT })
        },
        getTabLocation: () => ({ kind: 'container', containerId: 'canvas-secondary-drawer' }),
      },
    },
  }

  try {
    const { moveBuiltInTabToSecondaryContainer } = await import('../../tabs/builtin-move')
    const fakeRoot = {
      setAttribute() {},
      querySelector() { return null },
    } as any

    calls.length = 0
    virtualT = 0
    const moved = await moveBuiltInTabToSecondaryContainer({
      tabId: 'profile',
      root: fakeRoot,
    })
    ok(!!moved, 'T-WARM-DEFER-1: ROOT_READY returns root')
    const rafs = calls.filter(c => c.name === 'rAF')
    const reqs = calls.filter(c => c.name === 'requestTabLocation')
    ok(rafs.length >= 1, `T-WARM-DEFER-2: ≥1 rAF before move (got ${rafs.length})`)
    ok(reqs.length === 1, 'T-WARM-DEFER-3: requestTabLocation once')
    if (rafs[0] && reqs[0]) {
      ok(reqs[0].t >= rafs[0].t, 'T-WARM-DEFER-4: request after rAF clock advance')
    }
  } finally {
    globalThis.requestAnimationFrame = origRaf
  }

  console.log(`secondary-drawer-warm-boot-builtin-defer: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
