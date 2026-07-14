// Tests for main-mirror-drawer.ts (src/sidebar/main-mirror-drawer.ts)
//
// Verifies:
// - Module exports exist and can be imported
// - Reset clears state (isMainMirrorActive, isCanvasMainOpen)
// - restartReparkWatch is exported
// - Basic no-op paths when not active

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
  appendChild(child: StubElement) {
    child.parentElement = this as any
    this.children.push(child)
    return child
  }
  insertBefore(child: StubElement, _ref: StubElement | null) {
    child.parentElement = this as any
    this.children.push(child)
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

;(globalThis as any).document = {
  documentElement: _docEl,
  head: { appendChild(_el: any) {} },
  body: {
    appendChild(child: any) { _bodyChildren.push(child) },
    removeChild(child: any) { _bodyChildren = _bodyChildren.filter(c => c !== child) },
  },
  getElementById(_id: string) { return null },
  createElement(_tag: string) { return new StubElement() },
  querySelector(_sel: string) { return null },
  querySelectorAll(_sel: string) { return [] },
}

// =====================================================================
// Import module after stubs
// =====================================================================

const {
  isMainMirrorActive,
  isCanvasMainOpen,
  __resetMainMirrorForTest,
  __getReparkIdleCountForTest,
  restartReparkWatch,
  applyMainMirrorDrawer,
  openCanvasMainDrawer,
  closeCanvasMainDrawer,
  onMainMirrorTabActivated,
} = await import('../main-mirror-drawer')

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

// --- T2: Idle count starts at 0 after reset ---
{
  __resetMainMirrorForTest()
  assertEqual(__getReparkIdleCountForTest(), 0, 'T2: idle count 0 after reset')
}

// --- T3: restartReparkWatch is exported and callable ---
{
  __resetMainMirrorForTest()
  restartReparkWatch()
  assert(true, 'T3: restartReparkWatch callable without error')
}

// --- T4: applyMainMirrorDrawer(false) stays inactive ---
{
  __resetMainMirrorForTest()
  applyMainMirrorDrawer(false)
  assert(!isMainMirrorActive(), 'T4: still inactive after apply(false)')
}

// --- T5: isMainMirrorActive false on mobile ---
{
  __resetMainMirrorForTest()
  ;(globalThis as any).window.innerWidth = 400
  applyMainMirrorDrawer(true)
  assert(!isMainMirrorActive(), 'T5: inactive on mobile viewport')
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
  assertEqual(__getReparkIdleCountForTest(), 0, 'T8c: idle count reset')
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

// --- T11: openCanvasMainDrawer re-arms repark watch after idle-stop ---
{
  __resetMainMirrorForTest()
  ;(globalThis as any).window.innerWidth = 1200
  applyMainMirrorDrawer(true)
  assert(isMainMirrorActive(), 'T11 setup: active after apply(true)')

  // Sync setTimeout stub causes all ticks to fire immediately.
  // After mount, the repark watch ticks until idle-stop (≥10 idle ticks).
  const idleCountAfterMount = __getReparkIdleCountForTest()
  assert(
    idleCountAfterMount >= 10,
    `T11 setup: repark watch idle-stopped (idle=${idleCountAfterMount})`,
  )

  // Switch to a deferred timer so the restart's ticks are captured but
  // NOT fired. This lets us observe the intermediate state proving the
  // watch was actually reset.
  let capturedTick: Function | null = null
  ;(globalThis as any).setTimeout = (fn: Function, _ms?: number) => {
    capturedTick = fn
    return 0 as any
  }

  openCanvasMainDrawer()

  // The watch was restarted: _reparkIdleCount was reset to 0 by
  // startReparkWatch, but the deferred ticks haven't fired yet.
  assertEqual(
    __getReparkIdleCountForTest(), 0,
    'T11: openCanvasMainDrawer restarted repark watch (idle reset to 0)',
  )

  // Restore sync timers and advance the captured tick to prove the
  // watch actually re-ran its idle cycle.
  ;(globalThis as any).setTimeout = (fn: Function, _ms?: number) => {
    fn()
    return 0 as any
  }
  // capturedTick was assigned inside the deferred stub's callback; TS cannot
  // prove it ran, so cast to bypass the narrowing to never.
  ;(capturedTick as (() => void) | null)?.()

  const idleAfterAdvance = __getReparkIdleCountForTest()
  assert(
    idleAfterAdvance >= 10,
    `T11: repark watch re-idled after restart (idle=${idleAfterAdvance})`,
  )
}

// --- T12: onMainMirrorTabActivated re-arms repark watch after idle-stop ---
{
  __resetMainMirrorForTest()
  ;(globalThis as any).window.innerWidth = 1200
  applyMainMirrorDrawer(true)
  assert(isMainMirrorActive(), 'T12 setup: active after apply(true)')

  const idleBefore = __getReparkIdleCountForTest()
  assert(idleBefore >= 10, `T12 setup: repark watch idle-stopped (idle=${idleBefore})`)

  // Deferred timer: capture the restart's tick without firing it.
  let capturedTick: Function | null = null
  ;(globalThis as any).setTimeout = (fn: Function, _ms?: number) => {
    capturedTick = fn
    return 0 as any
  }

  onMainMirrorTabActivated('Test Tab')

  // Idle count reset to 0 proves the watch was restarted.
  assertEqual(
    __getReparkIdleCountForTest(), 0,
    'T12: onMainMirrorTabActivated restarted repark watch (idle reset to 0)',
  )

  // Advance captured tick with sync timers to prove watch re-ran.
  ;(globalThis as any).setTimeout = (fn: Function, _ms?: number) => {
    fn()
    return 0 as any
  }
  ;(capturedTick as (() => void) | null)?.()

  const idleAfterAdvance = __getReparkIdleCountForTest()
  assert(
    idleAfterAdvance >= 10,
    `T12: repark watch re-idled after restart (idle=${idleAfterAdvance})`,
  )
}

console.log(`main-mirror-drawer tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
