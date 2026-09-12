// Canvas teardown seam tests (2026-09-12 disable report).
//
// Two independent restore gaps were found when disabling Canvas while the
// second drawer held tabs and outer-edge was ON:
//
// 1. The vanilla drawer came back with NO tab buttons: feature teardowns run
//    in the FIFO cleanup chain, but setup.ts registered the host-bridge clear
//    EARLY — so `tearDownSecondarySidebar` resolved `getHostBridge()` to null,
//    classified every built-in as an extension root, and never called
//    `requestHostTabToMain`. Host `tabLocations` stayed on the removed
//    secondary container and the host never re-rendered its buttons.
//    Fix: clear the bridge at the END of the returned teardown, after
//    `cleanupAll()` (source-pinned below).
//
// 2. The vanilla tab strip stayed on the outer edge: `applyTabListPosition`
//    writes inline flex/borders on the HOST drawer elements (no-opts path) and
//    no teardown reversed them. Fix: `clearTabListPosition` is registered in
//    `alwaysCleanups()` (asserted here; behavior covered in
//    `sidebar/__tests__/tab-position.test.ts` C14).

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}

// --- Minimal DOM stubs (chat-reflow-lifecycle pattern) ---
class StubElement {
  tagName = 'DIV'
  id = ''
  className = ''
  textContent = ''
  _style: Record<string, string> = {}
  _children: StubElement[] = []
  appendChild(c: any) { this._children.push(c) }
  remove() {}
  setAttribute(_n: string, _v: string) {}
  get style(): any {
    const s = this._style
    return {
      setProperty: (n: string, v: string) => { s[n] = v },
      removeProperty: (n: string) => { delete s[n] },
      getPropertyValue: (n: string) => s[n] ?? '',
      marginTop: s['margin-top'] ?? '',
    }
  }
  get classList() { return { add: () => {}, remove: () => {}, contains: () => false } }
  get children() { return this._children as any[] }
  get firstChild() { return this._children[0] ?? null }
  get childNodes() { return this._children as any[] }
  get offsetWidth() { return 100 }
  get offsetHeight() { return 30 }
  get parentElement() { return null }
  querySelector(_sel: string) { return null }
  querySelectorAll(_sel: string): any[] { return [] }
  removeChild(_child: any) {}
  getAttribute(_n: string) { return null }
  addEventListener(_e: string, _h: any) {}
  removeEventListener(_e: string, _h: any) {}
}

const stubDocument: any = {
  getElementById(_id: string) { return null },
  createElement(_tag: string) { return new StubElement() },
  documentElement: new StubElement(),
  body: new StubElement(),
  visibilityState: 'visible',
  addEventListener(_e: string, _h: any) {},
  removeEventListener(_e: string, _h: any) {},
  head: { appendChild() {}, removeChild() {} },
  querySelector(_sel: string) { return null },
  querySelectorAll(_sel: string) { return [] },
}

const stubWindow: any = {
  addEventListener() {},
  removeEventListener() {},
  innerWidth: 1280,
  innerHeight: 800,
  matchMedia: (_q: string) => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }),
  requestAnimationFrame: (cb: any) => { setTimeout(cb, 0); return 1 },
  cancelAnimationFrame: () => {},
}

;(globalThis as any).document = stubDocument
;(globalThis as any).window = stubWindow
;(globalThis as any).HTMLElement = StubElement
;(globalThis as any).Element = StubElement
;(globalThis as any).getComputedStyle = () => ({})
;(globalThis as any).MutationObserver = class { observe() {} disconnect() {} }
;(globalThis as any).ResizeObserver = class { observe() {} disconnect() {} }

// ── 1: alwaysCleanups() wires the outer-edge position reset ──
{
  const { alwaysCleanups } = await import('../registry')
  const { clearTabListPosition } = await import('../../sidebar/tab-position')
  const fns = alwaysCleanups()
  assert(fns.includes(clearTabListPosition), 'alwaysCleanups() includes clearTabListPosition')
  assert(fns.every((f) => typeof f === 'function'), 'every always-cleanup entry is a function')
}

// ── 2: setup.ts clears the host bridge only AFTER cleanupAll() ──
{
  const { readFileSync } = await import('fs')
  const { join } = await import('path')
  const src = readFileSync(join(process.cwd(), 'src/setup.ts'), 'utf8')

  // No early registration may clear the bridge (the old `registerCleanup`
  // block that ran before feature teardowns).
  const earlyClear = /registerCleanup\(\(\) => \{[^}]*setHostBridgeContext\(null\)/s.test(src)
  assert(!earlyClear, 'setup.ts has no early setHostBridgeContext(null) registration')

  // The returned teardown must call cleanupAll() and only then clear it.
  const teardownIdx = src.lastIndexOf('return () => {')
  assert(teardownIdx >= 0, 'setup.ts has a returned teardown')
  const cleanupIdx = src.indexOf('cleanupAll()', teardownIdx)
  const clearIdx = src.indexOf('setHostBridgeContext(null)', teardownIdx)
  assert(cleanupIdx > teardownIdx, 'setup.ts teardown calls cleanupAll()')
  assert(clearIdx > cleanupIdx, 'setup.ts clears the host bridge AFTER cleanupAll()')
}

// ── 3: the post-teardown mirror reconcile is gated on mirror liveness ──
// tearDownSecondarySidebar's trailing reconcile exists to refresh the mirror
// strip when the second drawer is toggled OFF mid-session. On extension
// disable the mirror is already gone and reconcileMainTabListPin would
// REMOUNT it (ownership is unconditional) — leaving a post-disable Canvas
// shell with an empty tab list at the outer edge.
{
  const { readFileSync } = await import('fs')
  const { join } = await import('path')
  const src = readFileSync(join(process.cwd(), 'src/sidebar/secondary.tsx'), 'utf8')
  const guarded =
    /const mirror = await import\('\.\/main-mirror-drawer'\)[\s\S]*?if \(mirror\.isMainMirrorActive\(\)\) m\.reconcileMainTabListPin\(\)/.test(src)
  assert(guarded, 'tearDownSecondarySidebar only reconciles the mirror while it is active')
}

console.log(`PASS: ${passed}`)
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exit(1) }
