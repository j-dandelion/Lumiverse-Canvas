// src/tabs/__tests__/ensure-builtin-active.test.ts
// Polyfill rAF — Bun's test runner doesn't expose requestAnimationFrame
// outside a browser context. Matches the convention used in
// secondary-drawer-wiring.test.ts and activation-handoff.test.ts.
;(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
  setTimeout(() => cb(performance.now()), 0)
  return 0
}

// Stub minimal DOM globals — Bun's test runner doesn't expose `document`
// outside a browser context. Tests don't need a real DOM; the helper only
// needs `getBuiltInTabRoot` to return a non-null HTMLElement (or undefined).
if (typeof (globalThis as any).document === 'undefined') {
  ;(globalThis as any).document = {
    createElement(_tag: string) {
      return { tagName: _tag.toUpperCase() } as unknown as HTMLElement
    },
  }
}

import {
  ensureBuiltInTabActiveInMain,
  type EnsureActiveHooks,
} from '../assignment'

let passed = 0, failed = 0
const ok = (c: unknown, m: string) =>
  c ? passed++ : (failed++, console.error('FAIL:', m))

async function main() {
  // T1: no-op when isTabActiveInMainDrawer says true
  {
    let clicks = 0
    await ensureBuiltInTabActiveInMain('lorebook', {
      isTabActiveInMainDrawer: () => true,
      findMainTabButton: () =>
        ({ click() { clicks++ } }) as unknown as Element | null,
      isMobileViewport: () => false,
      getBuiltInTabRoot: () => document.createElement('div'),
    })
    ok(clicks === 0, 'T1: no click when tab already active')
  }

  // T2: clicks once when not active and not mobile
  {
    let clicks = 0
    await ensureBuiltInTabActiveInMain('lorebook', {
      isTabActiveInMainDrawer: () => false,
      findMainTabButton: () =>
        ({ click() { clicks++ } }) as unknown as Element | null,
      isMobileViewport: () => false,
      getBuiltInTabRoot: () => document.createElement('div'),
    })
    ok(clicks === 1, 'T2: clicks once when not active and not mobile')
  }

  // T3: skips click on mobile even when not active
  {
    let clicks = 0
    await ensureBuiltInTabActiveInMain('lorebook', {
      isTabActiveInMainDrawer: () => false,
      findMainTabButton: () =>
        ({ click() { clicks++ } }) as unknown as Element | null,
      isMobileViewport: () => true,
      getBuiltInTabRoot: () => document.createElement('div'),
    })
    ok(clicks === 0, 'T3: no click on mobile')
  }

  // T4: emits dlog breadcrumb when main button not found (defensive)
  {
    let clicks = 0
    let logged: string[] = []
    await ensureBuiltInTabActiveInMain('lorebook', {
      isTabActiveInMainDrawer: () => false,
      findMainTabButton: () => null,
      isMobileViewport: () => false,
      getBuiltInTabRoot: () => undefined,
      dlog: (...a) => logged.push(a.join(' ')),
    })
    ok(clicks === 0, 'T4: no click when main button not found')
    ok(
      logged.some(l => l.includes('button-not-found')),
      'T4: emits dlog breadcrumb when button not found',
    )
  }

  console.log(`ensure-builtin-active: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main()
