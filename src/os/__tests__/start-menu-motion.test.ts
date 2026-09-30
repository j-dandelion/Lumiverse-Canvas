// Start-menu motion (src/os/start-menu-motion.ts) — tokens, growth-origin
// geometry and the WAAPI runner contracts. The module is a leaf (no imports,
// no import-time DOM), so every browser API is stubbed per test.
//
// Custom assertion harness — run by scripts/test-runner.sh via `bun run`
// (no bun:test here on purpose; run its native runner only for bun:test files).
let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual === expected) {
    passed++
  } else {
    console.error(`FAIL: ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    failed++
  }
}

import {
  START_MENU_OPEN_MS,
  START_MENU_CLOSE_MS,
  START_MENU_SCALE,
  canAnimateMenu,
  captureMenuVisualState,
  computeGrowthOrigin,
  getUiScale,
  playMenuIn,
  playMenuOut,
  prefersReducedMotion,
} from '../start-menu-motion'

// ── Env stubs (restored at the end) ──
const g = globalThis as any
const realWindow = g.window
const realDocument = g.document
const realGcs = g.getComputedStyle
function setWindow(v: unknown) { g.window = v }
function setDocument(v: unknown) { g.document = v }
function setGcs(fn: unknown) {
  if (fn === undefined) delete g.getComputedStyle
  else g.getComputedStyle = fn
}

interface FakeAnimation {
  onfinish: (() => void) | null
  oncancel: (() => void) | null
  cancel: () => void
}
function makeFakeAnimation(): FakeAnimation {
  const a: FakeAnimation = {
    onfinish: null,
    oncancel: null,
    cancel() { a.oncancel?.() },
  }
  return a
}

// ── 1. Motion tokens (spec §4.4.3: ~120–150 ms, subtle scale) ──
assertEqual(START_MENU_OPEN_MS, 150, 'open duration token')
assertEqual(START_MENU_CLOSE_MS, 120, 'close duration token')
assertEqual(START_MENU_SCALE, 0.92, 'start/end scale token (contextMenuIn precedent)')
assert(START_MENU_CLOSE_MS <= START_MENU_OPEN_MS, 'dismiss never slower than open')
assert(START_MENU_SCALE > 0 && START_MENU_SCALE < 1, 'scale must be a subtle shrink')

// ── 2. computeGrowthOrigin — external anchor below/left of the menu ──
{
  const button = { left: 100, top: 500, width: 48, height: 48 }
  const menu = { left: 80, top: 200, width: 220, height: 260 }
  const o = computeGrowthOrigin(button, menu, 1)
  assertEqual(o.x, 44, 'origin x = button center − menu left')
  assertEqual(o.y, 324, 'origin y = button center − menu top')
  assert(o.y > menu.height, 'upward menu: origin sits BELOW the box (external anchor)')

  const leftOfMenu = computeGrowthOrigin({ left: 20, top: 500, width: 48, height: 48 }, menu, 1)
  assert(leftOfMenu.x < 0, 'button left of the menu → negative origin x')

  // Rendered deltas → layout px (body zoom): rendered / scale.
  assertEqual(computeGrowthOrigin(button, menu, 1.5).x, 44 / 1.5, 'uiScale converts rendered → layout')
  assertEqual(computeGrowthOrigin(button, menu, 0).x, 44, 'invalid scale falls back to 1')
}

// ── 3. getUiScale ──
{
  setDocument({ documentElement: {} })
  setGcs(() => ({ getPropertyValue: () => '1.25' }))
  assertEqual(getUiScale(), 1.25, 'parses --lumiverse-ui-scale')
  setGcs(() => ({ getPropertyValue: () => '' }))
  assertEqual(getUiScale(), 1, 'empty var → 1')
  setGcs(() => ({ getPropertyValue: () => 'nope' }))
  assertEqual(getUiScale(), 1, 'NaN var → 1')
  setGcs(() => ({ getPropertyValue: () => '0' }))
  assertEqual(getUiScale(), 1, 'zero scale → 1')
  setDocument(undefined)
  assertEqual(getUiScale(), 1, 'no document → 1')
  setGcs(undefined)
  setDocument({ documentElement: {} })
  assertEqual(getUiScale(), 1, 'no getComputedStyle → 1')
}

// ── 4. prefersReducedMotion ──
{
  setWindow({ matchMedia: () => ({ matches: true }) })
  assertEqual(prefersReducedMotion(), true, 'reduce → true')
  setWindow({ matchMedia: () => ({ matches: false }) })
  assertEqual(prefersReducedMotion(), false, 'no-preference → false')
  setWindow({})
  assertEqual(prefersReducedMotion(), false, 'matchMedia absent → false')
  setWindow(undefined)
  assertEqual(prefersReducedMotion(), false, 'window absent → false')
}

// ── 5. canAnimateMenu + captureMenuVisualState ──
{
  assertEqual(canAnimateMenu({} as unknown as HTMLElement), false, 'no animate() → cannot animate')
  assertEqual(
    canAnimateMenu({ animate: () => null } as unknown as HTMLElement),
    true,
    'animate() present → can animate',
  )

  setGcs(() => ({ opacity: '0.4', transform: 'none' }))
  const s1 = captureMenuVisualState({} as unknown as HTMLElement)
  assertEqual(s1.opacity, '0.4', 'captures current opacity')
  assertEqual(s1.transform, 'scale(1)', 'none transform → settled scale')

  setGcs(() => ({ opacity: '', transform: 'matrix(0.9, 0, 0, 0.9, 0, 0)' }))
  const s2 = captureMenuVisualState({} as unknown as HTMLElement)
  assertEqual(s2.opacity, '1', 'empty opacity → 1')
  assertEqual(s2.transform, 'matrix(0.9, 0, 0, 0.9, 0, 0)', 'mid-flight matrix preserved')

  setGcs(() => { throw new Error('boom') })
  assertEqual(
    captureMenuVisualState({} as unknown as HTMLElement).transform,
    'scale(1)',
    'computed-style failure → settled state',
  )
}

// ── 6. playMenuIn — WAAPI keyframes at the button-anchored origin ──
{
  setWindow({ matchMedia: () => ({ matches: false }) })
  const calls: any[][] = []
  const fake = makeFakeAnimation()
  const menu: any = {
    style: {},
    animate: (...args: any[]) => { calls.push(args); return fake },
  }
  const anim = playMenuIn(menu as HTMLElement, { x: 10, y: 20 })
  assertEqual(anim, fake, 'returns the in-flight animation')
  assertEqual(menu.style.transformOrigin, '10px 20px', 'origin set on the element')
  const [frames, options] = calls[0]!
  assertEqual(frames[0].opacity, 0, 'open starts transparent')
  assertEqual(frames[0].transform, 'scale(0.92)', 'open starts shrunk')
  assertEqual(frames[1].opacity, 1, 'open ends opaque')
  assertEqual(frames[1].transform, 'scale(1)', 'open ends settled')
  assertEqual(options.duration, START_MENU_OPEN_MS, 'open duration')
  assertEqual(options.fill, 'both', 'open fill')
}

// ── 7. playMenuOut — continues from the captured state, fires onDone once ──
{
  setWindow({ matchMedia: () => ({ matches: false }) })
  let done = 0
  const calls: any[][] = []
  const fake = makeFakeAnimation()
  const menu: any = {
    style: {},
    animate: (...args: any[]) => { calls.push(args); return fake },
  }
  const from = { opacity: '0.5', transform: 'matrix(0.95, 0, 0, 0.95, 0, 0)' }
  const anim = playMenuOut(menu as HTMLElement, { x: 3, y: 4 }, from, () => done++)
  assertEqual(anim, fake, 'returns the in-flight animation')
  assertEqual(menu.style.transformOrigin, '3px 4px', 'close reuses the button origin')
  const [closeFrames, closeOptions] = calls[0]!
  assertEqual(closeFrames[0].opacity, '0.5', 'close starts from the captured opacity')
  assertEqual(closeFrames[0].transform, from.transform, 'close starts from the captured transform')
  assertEqual(closeFrames[1].opacity, 0, 'close ends transparent')
  assertEqual(closeFrames[1].transform, 'scale(0.92)', 'close ends shrunk toward the button')
  assertEqual(closeOptions.duration, START_MENU_CLOSE_MS, 'close duration')
  assertEqual(done, 0, 'onDone not fired before finish')
  const handler = fake.onfinish!
  handler()
  handler() // captured ref re-entry must be idempotent
  assertEqual(done, 1, 'onDone fires exactly once')

  let cancelDone = 0
  const fake2 = makeFakeAnimation()
  const menu2: any = { style: {}, animate: () => fake2 }
  playMenuOut(menu2 as HTMLElement, { x: 0, y: 0 }, from, () => cancelDone++)
  fake2.cancel()
  assertEqual(cancelDone, 0, 'cancel never fires onDone (immediate disposal owns removal)')
}

// ── 8. Skipped motion (reduced-motion / no WAAPI) is synchronous and safe ──
{
  setWindow({ matchMedia: () => ({ matches: true }) })
  let doneReduce = 0
  const menuReduce: any = {
    style: {},
    animate: () => { throw new Error('animate must not run under reduced motion') },
  }
  const r1 = playMenuOut(
    menuReduce as HTMLElement,
    { x: 0, y: 0 },
    { opacity: '1', transform: 'scale(1)' },
    () => doneReduce++,
  )
  assertEqual(r1, null, 'reduced motion → no animation')
  assertEqual(doneReduce, 1, 'reduced motion → immediate removal callback')

  setWindow({ matchMedia: () => ({ matches: false }) })
  let doneNoApi = 0
  const menuNoApi: any = { style: {} }
  const r2 = playMenuOut(
    menuNoApi as HTMLElement,
    { x: 0, y: 0 },
    { opacity: '1', transform: 'scale(1)' },
    () => doneNoApi++,
  )
  assertEqual(r2, null, 'no WAAPI → no animation')
  assertEqual(doneNoApi, 1, 'no WAAPI → immediate removal callback')

  const r3 = playMenuIn({ style: {} } as HTMLElement, { x: 0, y: 0 })
  assertEqual(r3, null, 'playMenuIn no WAAPI → null (instant show)')
}

// ── Cleanup ──
setWindow(realWindow)
setDocument(realDocument)
setGcs(realGcs)

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
