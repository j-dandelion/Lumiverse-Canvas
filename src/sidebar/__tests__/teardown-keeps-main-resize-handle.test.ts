// Regression: toggling "Enable second drawer" OFF must NOT strip the MAIN
// drawer's drag-to-resize handle.
//
// Symptom (user): "Toggling enable second drawer on/off breaks drag-to-resize."
// Root cause: tearDownSecondarySidebar's document-wide cleanup removed ANY
// .sidebar-ux-resize-handle whose parent is a .sidebar-ux-drawer. The
// main-mirror drawer (taskbar mode) IS a .sidebar-ux-drawer and carries the
// main drawer's handle — the sweep deleted it, and nothing re-adds it while
// the second drawer stays off. The secondary drawer's own handle is removed
// with the wrapper, so the document-wide sweep is both redundant for the
// secondary AND harmful to the main mirror.
//
// Run with: bun run src/sidebar/__tests__/teardown-keeps-main-resize-handle.test.ts

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    console.error(`FAIL: ${message} — expected ${expected}, got ${actual}`)
    failed++
  } else {
    passed++
  }
}

// =====================================================================
// Stub element — tracks children + removal so handle-presence is real
// =====================================================================

class StubElement {
  tagName = 'DIV'
  className = ''
  parentElement: StubElement | null = null
  children: StubElement[] = []
  private _removed = false
  style: Record<string, string> = {} as any
  dataset: Record<string, string> = {}
  classList = {
    contains: (c: string) => String(this.className).split(/\s+/).includes(c),
  }

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
    if (this.parentElement) {
      this.parentElement.removeChild(this)
    }
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
    if (sel === '.sidebar-ux-drawer') return this.className.includes('sidebar-ux-drawer') && !this.className.includes('wrapper')
    if (sel === '.sidebar-ux-resize-handle') return this.className.includes('sidebar-ux-resize-handle')
    if (sel === '.sidebar-ux-secondary-wrapper') return this.className.includes('sidebar-ux-secondary-wrapper')
    if (sel === '.sidebar-ux-main-mirror-wrapper') return this.className.includes('sidebar-ux-main-mirror-wrapper')
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

// The main-mirror drawer (taskbar mode) holds the MAIN drawer's resize
// handle. It shares the .sidebar-ux-drawer class with the secondary drawer.
const mirrorDrawer = makeEl('sidebar-ux-drawer')
const mirrorHandle = makeEl('sidebar-ux-resize-handle')
mirrorDrawer.appendChild(mirrorHandle)
const mirrorWrapper = makeEl('sidebar-ux-main-mirror-wrapper')
mirrorWrapper.appendChild(mirrorDrawer)

// Secondary wrapper with its own drawer + handle.
const secondaryDrawer = makeEl('sidebar-ux-drawer')
const secondaryHandle = makeEl('sidebar-ux-resize-handle')
secondaryDrawer.appendChild(secondaryHandle)
const secondaryWrapper = makeEl('sidebar-ux-secondary-wrapper')
secondaryWrapper.appendChild(secondaryDrawer)

let _fakeSecondaryWrapper: StubElement | null = secondaryWrapper
let _fakeMainSidebar: any = null
// The handle inside the LIVE secondary wrapper (setupEnv creates a fresh
// wrapper per test; the top-level `secondaryHandle` above is only for the
// document-level querySelectorAll stub).
let _liveSecondaryHandle: StubElement | null = null

;(globalThis as any).document = {
  documentElement: {
    style: { setProperty: () => {}, getPropertyValue: () => '', removeProperty: () => {} },
    classList: { add() {}, remove() {}, contains() { return false }, toggle() {} },
  },
  querySelector(sel: string) {
    if (sel === '[data-spindle-mount="sidebar"]') return _fakeMainSidebar
    if (sel === '.sidebar-ux-resize-handle') return null
    return null
  },
  querySelectorAll(sel: string) {
    if (sel === '.sidebar-ux-resize-handle') {
      // Both drawers' handles are live in the document.
      return [mirrorHandle, secondaryHandle]
    }
    if (sel === '.sidebar-ux-tab-list-pin-host') return []
    if (sel === '.sidebar-ux-secondary-wrapper') return [_fakeSecondaryWrapper].filter(Boolean) as StubElement[]
    return []
  },
  createElement(tag: string) {
    return new StubElement()
  },
  body: {
    appendChild(child: unknown) {},
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
;(globalThis as any).setTimeout = (fn: Function, _ms?: number) => { return 0 as any }
;(globalThis as any).clearTimeout = () => {}
;(globalThis as any).requestAnimationFrame = (_fn: Function) => 0
;(globalThis as any).cancelAnimationFrame = () => {}
// Permanent window.matchMedia — survive setupEnv/restoreEnv
;(globalThis as any).window = Object.assign(globalThis.window ?? {}, {
  matchMedia: (_q: string) => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
})

// =====================================================================
// Imports
// =====================================================================

import { __setSecondaryWrapperForTest } from '../secondary'

// =====================================================================
// Test helpers
// =====================================================================

let _origWindow: typeof globalThis.window

function setupEnv() {
  _origWindow = globalThis.window
  _fakeMainSidebar = null
  // Fresh secondary wrapper (the prior teardown removed the old one).
  const secDrawer = makeEl('sidebar-ux-drawer')
  const secHandle = makeEl('sidebar-ux-resize-handle')
  secDrawer.appendChild(secHandle)
  const secWrapper = makeEl('sidebar-ux-secondary-wrapper')
  secWrapper.appendChild(secDrawer)
  _fakeSecondaryWrapper = secWrapper
  _liveSecondaryHandle = secHandle
  __setSecondaryWrapperForTest(secWrapper as any)
}

function restoreEnv() {
  globalThis.window = _origWindow
  _fakeSecondaryWrapper = null
  __setSecondaryWrapperForTest(null)
}

// =====================================================================
// T1: tearDownSecondarySidebar must NOT remove the main-mirror handle
// =====================================================================
async function testT1_TeardownKeepsMainMirrorHandle() {
  setupEnv()
  try {
    const { tearDownSecondarySidebar } = await import('../secondary')
    tearDownSecondarySidebar()

    // The secondary wrapper (and its handle) is gone.
    assertEqual(!!_liveSecondaryHandle?.removed, true, 'T1: secondary handle removed with its wrapper')
    // The main-mirror handle must survive — it is the MAIN drawer's
    // drag-to-resize handle in taskbar mode.
    assertEqual(mirrorHandle.removed, false, 'T1: main-mirror handle NOT removed by secondary teardown')
  } finally { restoreEnv() }
}

// =====================================================================
// Run
// =====================================================================

async function main() {
  await testT1_TeardownKeepsMainMirrorHandle()

  if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
  console.log(`PASS: ${passed}`)
}

main()
