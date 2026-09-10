// Tests for main-mirror-drawer.ts (src/sidebar/main-mirror-drawer.ts)
//
// Verifies:
// - Module exports exist and can be imported
// - Reset clears state (isMainMirrorActive, isCanvasMainOpen)
// - Basic no-op paths when not active
// - S3 content single-path: event-driven park — stale-node eviction,
//   idempotent parking, and NO repark-poll exports (poll removed)

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { failed++; console.error(`FAIL: ${msg} — expected ${String(expected)}, got ${String(actual)}`) }
}

// =====================================================================
// Minimal stub element — enough for createDrawerShell
// =====================================================================

class StubStyle {
  private _props: Record<string, string> = {}
  get display() { return this._props['display'] ?? '' }
  set display(v: string) { this._props['display'] = v }
  get flexDirection() { return this._props['flexDirection'] ?? '' }
  set flexDirection(v: string) { this._props['flexDirection'] = v }
  // S6 harness: createDrawerShell writes drawer chrome via cssText — parse
  // the width declaration so full-bleed/var-driven assertions can read it.
  set cssText(v: string) {
    this._props = {}
    for (const decl of String(v).split(';')) {
      const i = decl.indexOf(':')
      if (i > 0) this._props[decl.slice(0, i).trim()] = decl.slice(i + 1).trim()
    }
  }
  get cssText() {
    return Object.entries(this._props).map(([k, v]) => `${k}: ${v};`).join(' ')
  }
  get width() { return this._props['width'] ?? '' }
  set width(v: string) { this._props['width'] = v }
  setProperty(k: string, v: string, _p?: string) { this._props[k] = v }
  removeProperty(k: string) { delete this._props[k] }
  getPropertyValue(k: string) { return this._props[k] ?? '' }
}

class StubElement {
  style = new StubStyle()
  className = ''
  tagName = 'DIV'
  id = ''
  innerHTML = ''
  textContent: string | null = null
  parentElement: StubElement | null = null
  nextSibling: StubElement | null = null
  children: StubElement[] = []
  isConnected = true
  dataset: Record<string, string> = {}
  private _classSet = new Set<string>()
  private _attrs: Record<string, string> = {}

  classList = {
    add: (c: string) => {
      for (const t of this.className.split(/\s+/).filter(Boolean)) this._classSet.add(t)
      this._classSet.add(c)
      this.className = Array.from(this._classSet).join(' ')
    },
    remove: (c: string) => {
      for (const t of this.className.split(/\s+/).filter(Boolean)) this._classSet.add(t)
      this._classSet.delete(c)
      this.className = Array.from(this._classSet).join(' ')
    },
    contains: (c: string) => {
      for (const t of this.className.split(/\s+/).filter(Boolean)) this._classSet.add(t)
      return this._classSet.has(c)
    },
    toggle: (c: string, force?: boolean) => {
      for (const t of this.className.split(/\s+/).filter(Boolean)) this._classSet.add(t)
      const on = force !== undefined ? force : !this._classSet.has(c)
      if (on) this.classList.add(c)
      else this.classList.remove(c)
      return on
    },
    toString: () => this.className,
  }

  setAttribute(k: string, v: string) { this._attrs[k] = v }
  getAttribute(k: string) { return this._attrs[k] ?? null }
  removeAttribute(k: string) { delete this._attrs[k] }
  /** DOM move semantics: detach from the previous parent first. */
  private _reparent(child: StubElement) {
    if (child.parentElement && child.parentElement !== this) {
      child.parentElement.children = child.parentElement.children.filter(c => c !== child)
    }
  }
  appendChild(child: StubElement) {
    this._reparent(child)
    child.parentElement = this as any
    if (!this.children.includes(child)) this.children.push(child)
    return child
  }
  insertBefore(child: StubElement, _ref: StubElement | null) {
    this._reparent(child)
    child.parentElement = this as any
    if (!this.children.includes(child)) this.children.push(child)
    return child
  }
  removeChild(child: StubElement) {
    this.children = this.children.filter(c => c !== child)
    child.parentElement = null
    return child
  }
  remove() {
    if (this.parentElement) {
      (this.parentElement as any).children = (this.parentElement as any).children.filter(
        (c: StubElement) => c !== this,
      )
    }
  }
  querySelector(sel: string): StubElement | null {
    if (sel.includes('sidebar-ux-tab-list')) {
      for (const c of this.children) {
        if (c.className.includes('sidebar-ux-tab-list')) return c
      }
    }
    if (sel.includes('_panel_')) {
      return this.children.find(c => c.className.includes('_panel_')) ?? null
    }
    if (sel.includes('_panelContent_')) {
      return this.children.find(c => c.className.includes('_panelContent_')) ?? null
    }
    return null
  }
  querySelectorAll(sel: string): StubElement[] {
    if (sel.includes('sidebar-ux-resize-handle')) {
      return this.children.filter(c => c.className.includes('sidebar-ux-resize-handle'))
    }
    if (sel.includes('button.sidebar-ux-tab-active')) {
      return this.children.filter(c => c.className.includes('sidebar-ux-tab-active'))
    }
    return []
  }
  addEventListener(_type: string, _fn: Function) {}
  removeEventListener(_type: string, _fn: Function) {}
  closest(_sel: string): StubElement | null { return null }
  contains(_node: any): boolean { return false }
}

function makeClassList() {
  const classes: string[] = []
  return {
    add(c: string) { classes.push(c) },
    remove(c: string) { const i = classes.indexOf(c); if (i >= 0) classes.splice(i, 1) },
    contains(c: string) { return classes.includes(c) },
    toString() { return classes.join(' ') },
  }
}

// =====================================================================
// Global stubs — must exist before ANY module import
// =====================================================================

;(globalThis as any).window = {
  innerWidth: 1200,
  addEventListener() {},
  removeEventListener() {},
  matchMedia(q: string) {
      const isMaxWidth = q.includes('max-width')
      const px = isMaxWidth ? parseInt(q.match(/max-width:\s*(\d+)/)?.[1] ?? '600') : 9999
      return { matches: this.innerWidth <= px, addEventListener() {}, removeEventListener() {} }
    },
  location: { href: 'http://localhost' },
}

;(globalThis as any).setTimeout = (fn: Function, _ms?: number) => { fn(); return 0 as any }
;(globalThis as any).clearTimeout = () => {}
// requestAnimationFrame: no-op to avoid recursion in drawer-sync's
  // _runSyncDrawerTabSettings which calls rAF recursively.
  ;(globalThis as any).requestAnimationFrame = (_fn: Function) => 0
;(globalThis as any).cancelAnimationFrame = () => {}
;(globalThis as any).MutationObserver = class { observe() {} disconnect() {} }
;(globalThis as any).ResizeObserver = class { observe() {} disconnect() {} }

const _docEl = {
  classList: makeClassList(),
  style: new StubStyle(),
}

let _bodyChildren: StubElement[] = []

// Fake host chain for the content-park path (S3 eviction tests):
//   [data-spindle-mount="sidebar"] → parentElement (holder)
//   → [class*="_panel_"] → [class*="_panelContent_"]
// Class names carry the literal '_panel_' / '_panelContent_' substrings
// that dom/lumiverse's [class*="…"] selectors match.
const fakePanel = new StubElement()
fakePanel.className = 'drawer_panel_x'
const fakePanelHolder = new StubElement()
fakePanelHolder.appendChild(fakePanel)
const fakeSidebar = new StubElement()
fakeSidebar.parentElement = fakePanelHolder

let fakeContent: StubElement | null = null
function setFakeHostContent(el: StubElement | null) {
  fakeContent = el
  if (el) {
    fakePanel.removeChild(el)
    fakePanel.appendChild(el)
  } else {
    for (const c of Array.from(fakePanel.children)) fakePanel.removeChild(c)
  }
}

;(globalThis as any).document = {
  documentElement: _docEl,
  head: { appendChild(_el: any) {} },
  body: {
    appendChild(child: any) { _bodyChildren.push(child) },
    removeChild(child: any) { _bodyChildren = _bodyChildren.filter(c => c !== child) },
  },
  getElementById(_id: string) { return null },
  createElement(_tag: string) { return new StubElement() },
  querySelector(sel: string) {
    if (sel === '[data-spindle-mount="sidebar"]') return fakeSidebar
    if (sel.includes('data-canvas-main-panel-content')) return fakeContent
    return null
  },
  querySelectorAll(_sel: string) { return [] },
}

// =====================================================================
// Import module after stubs
// =====================================================================

const {
  isMainMirrorActive,
  isCanvasMainOpen,
  __resetMainMirrorForTest,
  applyMainMirrorDrawer,
  reconcileMainMirrorDrawer,
  openCanvasMainDrawer,
  closeCanvasMainDrawer,
  onMainMirrorTabActivated,
} = await import('../main-mirror-drawer')

const mainMirrorModule = await import('../main-mirror-drawer')

export {}

// =====================================================================
// Tests
// =====================================================================

// --- T1: Reset clears state ---
{
  __resetMainMirrorForTest()
  assert(!isMainMirrorActive(), 'T1: isMainMirrorActive false after reset')
  assert(!isCanvasMainOpen(), 'T1: isCanvasMainOpen false after reset')
}

// --- T4: applyMainMirrorDrawer(false) stays inactive ---
{
  __resetMainMirrorForTest()
  applyMainMirrorDrawer(false)
  assert(!isMainMirrorActive(), 'T4: still inactive after apply(false)')
}

// --- T5 (S6): isMainMirrorActive TRUE on mobile — the shell owns the
//     mobile main surface now (full-bleed mount, horizontal list). ---
{
  __resetMainMirrorForTest()
  ;(globalThis as any).window.innerWidth = 400
  applyMainMirrorDrawer(true)
  assert(isMainMirrorActive(), 'T5 (S6): shell ACTIVE on mobile viewport (full-bleed mount)')
  assert(
    String((mainMirrorModule.getMainMirrorDrawer() as any)?.style.width ?? '').includes('app-scaled-viewport-width'),
    'T5b (S6): mobile mount is full-bleed (inline width = scaled-viewport calc)',
  )
  __resetMainMirrorForTest()
  ;(globalThis as any).window.innerWidth = 1200
}

// --- T6: openCanvasMainDrawer no-op when not active ---
{
  __resetMainMirrorForTest()
  openCanvasMainDrawer()
  assert(!isCanvasMainOpen(), 'T6: not open when not active')
}

// --- T7: closeCanvasMainDrawer no-op when not active ---
{
  __resetMainMirrorForTest()
  closeCanvasMainDrawer()
  assert(!isCanvasMainOpen(), 'T7: not open when not active')
}

// --- T8: teardown clears all state ---
{
  __resetMainMirrorForTest()
  assert(!isMainMirrorActive(), 'T8a: inactive after teardown')
  assert(!isCanvasMainOpen(), 'T8b: not open after teardown')
}

// --- T9: applyMainMirrorDrawer(true) on desktop mounts successfully ---
{
  __resetMainMirrorForTest()
  ;(globalThis as any).window.innerWidth = 1200
  applyMainMirrorDrawer(true)
  assert(isMainMirrorActive(), 'T9: active after apply(true) on desktop')
  // Verify a wrapper was appended to body
  assert(_bodyChildren.length > 0, 'T9: wrapper appended to body')
  const shell = _bodyChildren.find((c) =>
    String(c.className || '').includes('sidebar-ux-main-mirror-wrapper'),
  )
  assert(!!shell, 'T9: main-mirror wrapper present')
  assert(
    !!shell && shell.classList.contains('sidebar-ux-shell'),
    'T9: main-mirror wrapper has sidebar-ux-shell',
  )
  assert(
    !!shell && shell.classList.contains('sidebar-ux-main-mirror-wrapper'),
    'T9: main-mirror wrapper keeps owner class',
  )
}

// --- T10: applyMainMirrorDrawer(false) after mount tears down ---
{
  // T9 left it active
  applyMainMirrorDrawer(false)
  assert(!isMainMirrorActive(), 'T10: inactive after apply(false)')
}

// --- T13: S1 gate inversion — reconcileMainMirrorDrawer mounts the shell
// on desktop with taskbarMode OFF (Canvas owns the main drawer
// unconditionally; pin chrome is gated separately in main-tab-pin). ---
{
  __resetMainMirrorForTest()
  ;(globalThis as any).window.innerWidth = 1200
  // Default settings: taskbarMode = false.
  reconcileMainMirrorDrawer()
  assert(isMainMirrorActive(), 'T13: shell active after reconcile with taskbar OFF')
  const shell = _bodyChildren.find((c) =>
    String(c.className || '').includes('sidebar-ux-main-mirror-wrapper'),
  )
  assert(!!shell, 'T13: main-mirror wrapper present without taskbar mode')
  // No pin host may be created by the shell mount (taskbar chrome off).
  assert(
    !_bodyChildren.some((c) =>
      String(c.className || '').includes('sidebar-ux-tab-list-pin-host')),
    'T13: no pin host created (taskbar chrome off)',
  )
  // Tear down for the next case.
  applyMainMirrorDrawer(false)
}

// --- T14 (S6): reconcile MOUNTS on mobile too (shell owns both surfaces) ---
{
  __resetMainMirrorForTest()
  ;(globalThis as any).window.innerWidth = 400
  reconcileMainMirrorDrawer()
  assert(isMainMirrorActive(), 'T14 (S6): shell ACTIVE on mobile after reconcile')
  ;(globalThis as any).window.innerWidth = 1200
  __resetMainMirrorForTest()
}

// =====================================================================
// S3 content single-path — event-driven park (repark poll removed)
// =====================================================================

// --- E1: stale parked node is evicted and replaced by the host's new
// panelContent node on the next event-driven park. ---
{
  __resetMainMirrorForTest()
  ;(globalThis as any).window.innerWidth = 1200

  const fake1 = new StubElement()
  fake1.className = 'drawer_panelContent_stub'
  setFakeHostContent(fake1)
  applyMainMirrorDrawer(true)
  assert(isMainMirrorActive(), 'E1 setup: active after apply(true)')

  // Mount parks the host content event-driven — no timer involved.
  const slot = fake1.parentElement
  assert(!!slot && slot !== fakePanelHolder, 'E1: fake1 parked into shell slot on mount')
  assert(
    fake1.getAttribute('data-canvas-main-panel-content') === '1',
    'E1: fake1 carries the content mark',
  )

  // Host React remounts panelContent → the host returns a NEW node.
  const fake2 = new StubElement()
  fake2.className = 'drawer_panelContent_stub2'
  setFakeHostContent(fake2)
  const { ensureHostContentParkedPublic } = mainMirrorModule
  ensureHostContentParkedPublic()

  // Old node evicted from the slot, unmarked, detached; new node parked.
  assert(!slot!.children.includes(fake1), 'E1: stale fake1 evicted from slot')
  assert(
    fake1.getAttribute('data-canvas-main-panel-content') === null,
    'E1: fake1 mark removed on eviction',
  )
  assert(slot!.children.includes(fake2), 'E1: new fake2 parked into slot')
  assert(
    fake2.getAttribute('data-canvas-main-panel-content') === '1',
    'E1: fake2 carries the content mark',
  )
  assertEqual(fake2.parentElement, slot, 'E1: fake2 parent is the shell slot')

  applyMainMirrorDrawer(false)
  setFakeHostContent(null)
}

// --- E2: park is idempotent — an already-parked node is left in place
// (no eviction, no duplicate). ---
{
  __resetMainMirrorForTest()
  ;(globalThis as any).window.innerWidth = 1200

  const fake1 = new StubElement()
  fake1.className = 'drawer_panelContent_stub'
  setFakeHostContent(fake1)
  applyMainMirrorDrawer(true)
  const slot = fake1.parentElement
  assert(!!slot && slot !== fakePanelHolder, 'E2 setup: fake1 parked on mount')

  // Re-park with the SAME host node: resolve returns it (host-first),
  // identity matches the cache → no eviction, no re-append.
  const { ensureHostContentParkedPublic } = mainMirrorModule
  ensureHostContentParkedPublic()
  ensureHostContentParkedPublic()

  assertEqual(slot!.children.length, 1, 'E2: no duplicate park of the same node')
  assert(slot!.children[0] === fake1, 'E2: parked node is still the host node')
  assert(
    fake1.getAttribute('data-canvas-main-panel-content') === '1',
    'E2: mark retained',
  )

  applyMainMirrorDrawer(false)
  setFakeHostContent(null)
}

// --- E3: the repark poll is gone — no repark exports on the module. ---
{
  const mod = mainMirrorModule as Record<string, unknown>
  assert(!('restartReparkWatch' in mod), 'E3: restartReparkWatch removed')
  assert(!('__getReparkIdleCountForTest' in mod), 'E3: __getReparkIdleCountForTest removed')
  assert(!('startReparkWatch' in mod), 'E3: startReparkWatch not exported')
  assert(!('stopReparkWatch' in mod), 'E3: stopReparkWatch not exported')
}

// --- E4: open + tab activation still park (event-driven, no poll). ---
{
  __resetMainMirrorForTest()
  ;(globalThis as any).window.innerWidth = 1200

  const fake1 = new StubElement()
  fake1.className = 'drawer_panelContent_stub'
  setFakeHostContent(fake1)
  applyMainMirrorDrawer(true)
  const slot = fake1.parentElement
  assert(!!slot && slot !== fakePanelHolder, 'E4 setup: parked on mount')

  // Simulate a host-side re-insertion: detach the parked node, then fire
  // the open/activation events — each re-parks once.
  slot!.removeChild(fake1)
  fakePanelHolder.appendChild(fake1)
  setFakeHostContent(fake1)
  openCanvasMainDrawer()
  assertEqual(fake1.parentElement, slot, 'E4: open re-parked the detached node')

  slot!.removeChild(fake1)
  fakePanelHolder.appendChild(fake1)
  onMainMirrorTabActivated('E4 Tab')
  assertEqual(fake1.parentElement, slot, 'E4: tab activation re-parked the node')

  applyMainMirrorDrawer(false)
  setFakeHostContent(null)
}

// --- S5: shell open/close dispatches setDrawer(primary) through the real
//     dispatch → the owned model carries SHELL truth (close persists). ---
{
  const { createEmptyModel, builtinKey } = require('../../core/model') as typeof import('../../core/model')
  const { FakeHost } = require('../../host/fake/implementation') as typeof import('../../host/fake/implementation')
  const { bootstrap, shutdown, flush } = require('../../recon/dispatch') as typeof import('../../recon/dispatch')

  const key = builtinKey('profile')
  const fakeHost = new FakeHost([
    {
      key, liveId: 'h:profile', location: 'primary',
      hidden: false, activeInPrimary: true, activeInSecondary: false,
      hasContentRoot: true, isBuiltin: true,
    },
  ])
  shutdown()
  bootstrap({
    ...createEmptyModel(),
    primary: [key],
    secondary: [],
    hidden: [],
    active: { primary: key, secondary: null },
    drawers: { primary: { open: false, width: 420 }, secondary: { open: false, width: 420 } },
  }, fakeHost)

  __resetMainMirrorForTest()
  ;(globalThis as any).window.innerWidth = 1200
  const fakeContent = new StubElement()
  fakeContent.className = 'drawer_panelContent_stub'
  setFakeHostContent(fakeContent)
  applyMainMirrorDrawer(true)
  assert(isMainMirrorActive(), 'S5 setup: shell active')

  ;(async () => {
    const dm = require('../../recon/dispatch') as typeof import('../../recon/dispatch')
    // The shell's setDrawer dispatch is a fire-and-forget dynamic import
    // chained onto the dispatch queue — poll the model instead of racing it.
    const waitFor = async (pred: () => boolean, tries = 200): Promise<boolean> => {
      for (let i = 0; i < tries; i++) {
        if (pred()) return true
        await Promise.resolve()
      }
      return false
    }

    openCanvasMainDrawer()
    const opened = await waitFor(() => dm.getModel()!.drawers.primary.open === true)
    assert(opened, 'S5.a: shell open → model primary.open=true')
    assertEqual(dm.getModel()!.drawers.primary.width, 420, 'S5.a2: width carried with the open dispatch')

    closeCanvasMainDrawer()
    const closed = await waitFor(() => dm.getModel()!.drawers.primary.open === false)
    assert(closed, 'S5.b: shell close → model primary.open=false (close persists)')

    applyMainMirrorDrawer(false)
    setFakeHostContent(null)
    shutdown()
    __resetMainMirrorForTest()

    await runS6Tests()
  })()
}

// =====================================================================
// S6: mobile main shell — full-bleed mount, restyle-in-place crossing,
// Canvas↔Canvas exclusion. Defined after the S5 block (hoisted); called
// from the S5 tail so the summary prints once, at the true end.
// =====================================================================
async function runS6Tests(): Promise<void> {
  const { syncMainMirrorToViewport } = mainMirrorModule
  const { enforceExclusionOnOpen } = await import('../mobile-exclusion')
  const { MAIN_MIRROR_WIDTH_VAR } = await import('../styles')

  // Body classList stub — setMobileOpenClass touches document.body.
  const bodyStub = (globalThis as any).document.body as any
  if (!bodyStub.classList) {
    const cls = new Set<string>()
    bodyStub.classList = {
      add: (c: string) => cls.add(c),
      remove: (c: string) => cls.delete(c),
      contains: (c: string) => cls.has(c),
    }
  }
  // Drain the dynamic-import chains the S6 paths fire.
  const settle = async () => { for (let i = 0; i < 60; i++) await Promise.resolve() }

  // ── S6.a: mobile mount — full-bleed, list rides IN the drawer ──
  ;(globalThis as any).window.innerWidth = 500
  const fakeContentA = new StubElement()
  fakeContentA.className = 'drawer_panelContent_stub'
  setFakeHostContent(fakeContentA)
  applyMainMirrorDrawer(true)
  assert(isMainMirrorActive(), 'S6.a1: shell active on mobile')
  assert(
    String((mainMirrorModule.getMainMirrorDrawer() as any)?.style.width ?? '').includes('app-scaled-viewport-width'),
    'S6.a2: full-bleed inline width at mobile mount',
  )
  const listAtMount = mainMirrorModule.getMainMirrorTabList() as any
  assert(!!listAtMount && listAtMount.parentElement === mainMirrorModule.getMainMirrorDrawer(),
    'S6.a3: tab list rides IN the drawer on mobile (no pin reparent)')
  applyMainMirrorDrawer(false)
  setFakeHostContent(null)
  ;(globalThis as any).window.innerWidth = 1200
  __resetMainMirrorForTest()
  await settle()

  // ── S6.b: crossing sync — desktop → mobile → desktop, no remount ──
  const fakeContentB = new StubElement()
  fakeContentB.className = 'drawer_panelContent_stub'
  setFakeHostContent(fakeContentB)
  applyMainMirrorDrawer(true)
  _docEl.style.setProperty(MAIN_MIRROR_WIDTH_VAR, '420px')
  closeCanvasMainDrawer()
  const drawerB = mainMirrorModule.getMainMirrorDrawer() as any
  assert(
    String(drawerB?.style.width ?? '').includes('var(--sidebar-ux-main-mirror-w'),
    'S6.b1: desktop width is var-driven',
  )
  ;(globalThis as any).window.innerWidth = 390
  syncMainMirrorToViewport()
  assert(
    String(drawerB?.style.width ?? '').includes('app-scaled-viewport-width'),
    'S6.b2: cross-down → full-bleed width (restyle-in-place)',
  )
  assertEqual(_docEl.style.getPropertyValue(MAIN_MIRROR_WIDTH_VAR), '390px', 'S6.b3: var = innerWidth approximation')
  {
    // Sign follows the shell's anchored side (stub store default may be
    // either) — closed = ±(ceil(w)+1) away from the viewport edge.
    const { closedTransformPx } = await import('../drawer-shell')
    const { getMainDrawerSide } = await import('../../store')
    const expected = `translateX(${closedTransformPx(getMainDrawerSide() as 'left' | 'right', 390)}px)`
    assertEqual(
      String((mainMirrorModule.getMainMirrorWrapper() as any)?.style.transform ?? ''),
      expected,
      'S6.b4: closed transform tracks the full-bleed width (ceil+1)',
    )
  }
  ;(globalThis as any).window.innerWidth = 1200
  syncMainMirrorToViewport()
  assert(
    String(drawerB?.style.width ?? '').includes('var(--sidebar-ux-main-mirror-w'),
    'S6.b5: cross-up → width var-driven again',
  )
  assertEqual(_docEl.style.getPropertyValue(MAIN_MIRROR_WIDTH_VAR), '420px', 'S6.b6: desktop width restored from the cross-down capture')
  applyMainMirrorDrawer(false)
  setFakeHostContent(null)
  __resetMainMirrorForTest()
  await settle()

  // ── S6.c: exclusion — secondary opens → the SHELL closes directly ──
  ;(globalThis as any).window.innerWidth = 500
  const fakeContentC = new StubElement()
  fakeContentC.className = 'drawer_panelContent_stub'
  setFakeHostContent(fakeContentC)
  applyMainMirrorDrawer(true)
  openCanvasMainDrawer()
  assert(isCanvasMainOpen(), 'S6.c1: shell open on mobile')
  enforceExclusionOnOpen('secondary')
  await settle()
  assert(!isCanvasMainOpen(), 'S6.c2: secondary-open exclusion closed the SHELL (no host-toggle indirection)')
  applyMainMirrorDrawer(false)
  setFakeHostContent(null)
  __resetMainMirrorForTest()
  ;(globalThis as any).window.innerWidth = 1200
  await settle()

  console.log(`main-mirror-drawer tests: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

