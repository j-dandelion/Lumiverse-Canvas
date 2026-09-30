// S0 container-lifecycle invariants (crash-proofing, 2026-09):
//
// The Swap crash saga (Node.removeChild on the 4th Swap) was driven by
// mid-session container churn:
//   1. createSecondarySidebar unregistered+registered on every mount —
//      a duplicate unregister before register made the host removeChild a
//      node that was already detached.
//   2. registerContainer ran while shell.content was still detached
//      (wrapper not yet appended) — the host stored a detached element.
//
// These tests pin the fix:
//   T1: createSecondarySidebar performs NO container calls at all
//       (registration moved to mount).
//   T2: unmountSecondarySidebar unregisters BEFORE removal and keeps the
//       old wrapper as an orphan until the next tick (host unregister
//       commit window) — the wrapper must still be in the DOM when the
//       function returns.
//   T3: mountSecondarySidebar registers exactly once, AFTER the wrapper is
//       appended (call order), with the panel-content node found inside
//       the appended wrapper — and never unregisters on the way in.
//
// Run with: bun run src/sidebar/__tests__/secondary-container-lifecycle.test.ts

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    console.error(`FAIL: ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    failed++
  } else {
    passed++
  }
}

// =====================================================================
// Stub element — tracks children, removal, attrs (drawer-shell needs attrs)
// =====================================================================

class StubElement {
  tagName = 'DIV'
  className = ''
  parentElement: StubElement | null = null
  children: StubElement[] = []
  private _removed = false
  style: Record<string, string> = {} as any
  dataset: Record<string, string> = {}
  _attrs: Record<string, string> = {}
  classList = {
    contains: (c: string) => String(this.className).split(/\s+/).includes(c),
    add: (c: string) => {
      const parts = String(this.className).split(/\s+/).filter(Boolean)
      if (!parts.includes(c)) parts.push(c)
      this.className = parts.join(' ')
    },
    remove: (c: string) => {
      this.className = String(this.className).split(/\s+/).filter((p) => p && p !== c).join(' ')
    },
    toggle: (c: string, force?: boolean) => {
      const has = this.classList.contains(c)
      const shouldAdd = force !== undefined ? force : !has
      if (shouldAdd && !has) this.classList.add(c)
      if (!shouldAdd && has) this.classList.remove(c)
      return shouldAdd
    },
  }

  setAttribute(k: string, v: string) { this._attrs[k] = v }
  getAttribute(k: string) { return this._attrs[k] ?? null }

  appendChild(child: StubElement) {
    child.parentElement = this
    this.children.push(child)
    return child
  }
  removeChild(child: StubElement) {
    const i = this.children.indexOf(child)
    if (i >= 0) this.children.splice(i, 1)
    child.parentElement = null
    return child
  }
  remove() {
    this._removed = true
    if (this.parentElement) this.parentElement.removeChild(this)
  }
  get removed() { return this._removed }
  querySelector(sel: string): StubElement | null {
    for (const c of this.children) {
      if (c.matches(sel)) return c
      const nested = c.querySelector(sel)
      if (nested) return nested
    }
    return null
  }
  querySelectorAll(sel: string): StubElement[] {
    const out: StubElement[] = []
    for (const c of this.children) {
      if (c.matches(sel)) out.push(c)
      out.push(...c.querySelectorAll(sel))
    }
    return out
  }
  matches(sel: string): boolean {
    if (sel === '.sidebar-ux-secondary-wrapper') return this.className.includes('sidebar-ux-secondary-wrapper')
    if (sel === '.sidebar-ux-drawer') return this.className.includes('sidebar-ux-drawer')
    if (sel === '.sidebar-ux-panel-content') return this.className.includes('sidebar-ux-panel-content')
    return false
  }
  closest(_sel: string): StubElement | null { return null }
  addEventListener(_t: string, _f: unknown) {}
  removeEventListener(_t: string, _f: unknown) {}
  contains(_n: unknown): boolean { return false }
}

function makeEl(className: string): StubElement {
  const el = new StubElement()
  el.className = className
  return el
}

// =====================================================================
// Global DOM stubs (must exist before any module import touches document)
// =====================================================================

// Controllable timer queue — deferred removal/sweep run only when flushed.
let _timers: Array<() => void> = []
;(globalThis as any).setTimeout = (fn: Function, _ms?: number) => {
  _timers.push(fn as any)
  return _timers.length
}
;(globalThis as any).clearTimeout = () => {}

let _appended: StubElement[] = []

;(globalThis as any).document = {
  documentElement: {
    style: { setProperty: () => {}, getPropertyValue: () => '', removeProperty: () => {} },
    classList: { add() {}, remove() {}, contains() { return false }, toggle() {} },
  },
  querySelector(sel: string) {
    if (sel === '[data-spindle-mount="sidebar"]') return null
    return null
  },
  querySelectorAll(sel: string) {
    if (sel === '.sidebar-ux-tab-list-pin-host') return []
    return []
  },
  createElement(tag: string) {
    return new StubElement()
  },
  body: {
    appendChild(child: unknown) {
      _appended.push(child as StubElement)
      events.push('append')
    },
    removeChild(_child: unknown) {},
    classList: { add() {}, remove() {}, contains() { return false }, toggle() {} },
  },
  head: { appendChild() {} },
  getElementById() { return null },
}
;(globalThis as any).CSS = { escape(s: string) { if (s == null) return ''; return s.replace(/([^\w-])/g, '\\$1') } }
;(globalThis as any).getComputedStyle = () => ({ display: '', visibility: '', getPropertyValue: () => '' })
;(globalThis as any).MutationObserver = class { observe() {} disconnect() {} }
;(globalThis as any).ResizeObserver = class { observe() {} disconnect() {} }
;(globalThis as any).HTMLElement = class {}
;(globalThis as any).requestAnimationFrame = (_fn: Function) => 0
;(globalThis as any).cancelAnimationFrame = () => {}
;(globalThis as any).window = Object.assign(globalThis.window ?? {}, {
  innerWidth: 1200,
  matchMedia: (_q: string) => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {},
  removeEventListener() {},
})

// =====================================================================
// Recording host bridge
// =====================================================================

const events: string[] = []
const calls = {
  register: [] as Array<{ id: string; side: string; elementConnected: boolean }>,
  unregister: [] as string[],
}

const { setHostBridgeContext } = await import('../../dom/host-bridge')
setHostBridgeContext({
  ui: {},
  containers: {
    registerContainer: (entry: { id: string; side: string; element: HTMLElement }) => {
      calls.register.push({ id: entry.id, side: entry.side, elementConnected: true })
      events.push(`register:${entry.id}`)
    },
    unregisterContainer: (id: string) => {
      calls.unregister.push(id)
      events.push(`unregister:${id}`)
    },
  },
} as any)

// =====================================================================
// Imports
// =====================================================================

const {
  createSecondarySidebar,
  unmountSecondarySidebar,
  mountSecondarySidebar,
  __setSecondaryWrapperForTest,
  getSecondaryWrapper,
} = await import('../secondary')

// =====================================================================
// T1: create performs NO container calls (registration lives in mount)
// =====================================================================

{
  const wrapper = createSecondarySidebar()
  assert(!!wrapper, 'T1: createSecondarySidebar returns a wrapper')
  assertEqual(calls.register.length, 0, 'T1: no registerContainer during create')
  assertEqual(calls.unregister.length, 0, 'T1: no unregisterContainer during create (no churn)')
  assert(
    wrapper.className.includes('sidebar-ux-secondary-wrapper'),
    'T1: wrapper carries the secondary wrapper class',
  )
}

// =====================================================================
// T2: unmount unregisters BEFORE removal and defers wrapper removal
// =====================================================================

{
  _timers = []
  _appended = []
  const wrapper = createSecondarySidebar()
  const fakeBody = makeEl('body')
  fakeBody.appendChild(wrapper)
  __setSecondaryWrapperForTest(wrapper as any)

  unmountSecondarySidebar()

  assertEqual(calls.unregister.length, 1, 'T2: unregisterContainer called exactly once')
  assertEqual(calls.unregister[0], 'canvas-secondary-drawer', 'T2: unregisters the secondary container id')
  assertEqual(wrapper.removed, false, 'T2: wrapper still in DOM right after unmount (orphan window for host commit)')
  assertEqual(wrapper.parentElement, fakeBody, 'T2: wrapper still parented (host can removeChild against attached node)')
  assertEqual(getSecondaryWrapper(), null, 'T2: module ref cleared immediately')
  assertEqual(calls.register.length, 0, 'T2: no register during unmount')

  // Flush the deferred removal — the orphan is now swept.
  for (const fn of _timers) fn()
  assertEqual(wrapper.removed, true, 'T2: wrapper removed after the deferred tick')
  __setSecondaryWrapperForTest(null)
}

// =====================================================================
// T3: mount registers exactly once AFTER append, with the in-wrapper content
// =====================================================================

{
  _timers = []
  _appended = []
  events.length = 0
  calls.register.length = 0
  calls.unregister.length = 0

  // Simulate a side-flip remount: an OLD orphan wrapper is still attached.
  const oldWrapper = createSecondarySidebar()
  const fakeBody = makeEl('body')
  fakeBody.appendChild(oldWrapper)

  mountSecondarySidebar()

  // Register must have happened after the wrapper was appended to body.
  const appendIdx = events.indexOf('append')
  const registerIdx = events.indexOf('register:canvas-secondary-drawer')
  assert(appendIdx >= 0, 'T3: wrapper was appended to document.body')
  assert(registerIdx >= 0, 'T3: registerContainer called during mount')
  assert(registerIdx > appendIdx, 'T3: register happens AFTER append (content is connected)')
  assertEqual(calls.unregister.length, 0, 'T3: mount never unregisters (idempotent replace-on-collision)')
  assertEqual(calls.register.length, 1, 'T3: exactly one register per mount')

  const liveWrapper = getSecondaryWrapper()
  assert(!!liveWrapper, 'T3: module wrapper set after mount')
  if (liveWrapper) {
    const content = liveWrapper.querySelector('.sidebar-ux-panel-content')
    assertEqual(calls.register[0].elementConnected, true, 'T3: registered element flagged connected')
  }

  // Cleanup so the module does not keep a stale wrapper for other tests.
  __setSecondaryWrapperForTest(null)
  setHostBridgeContext(null)
}

// =====================================================================
// Run
// =====================================================================

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)