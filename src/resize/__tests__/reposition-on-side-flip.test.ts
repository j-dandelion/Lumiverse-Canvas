// Regression: after "Swap drawer locations" (drawer side flip), the main
// drawer's drag-to-resize handle must be re-anchored to the drawer's NEW
// inner edge.
//
// Symptom (user): "When drawer sides are swapped, main drawer resize handle
// doesn't appear (maybe on the wrong side?)." Root cause: the host main
// drawer element SURVIVES a React side flip (the wrapper class flips, not
// the node), so the handle mounted at `left: calc(--drawer-panel-w - 4px)`
// for a left drawer stays on that edge — now the drawer's OUTER edge — after
// the drawer moves right. mountResizeHandles used to skip any drawer that
// already had a handle, so nothing ever re-anchored it.
//
// Fix: mountResizeHandles now re-positions an EXISTING handle to the
// current side's inner edge (in addition to mounting missing ones), and
// checkSideChanged calls refreshResizeHandles after every side flip.
//
// Run with: bun run src/resize/__tests__/reposition-on-side-flip.test.ts

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
// Stub element — plain style bag (left/right/cssText settable) + children
// =====================================================================

class StubElement {
  tagName = 'DIV'
  className = ''
  parentElement: StubElement | null = null
  children: StubElement[] = []
  style: Record<string, string> = {}
  private _removed = false
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
    if (sel === '.sidebar-ux-drawer') return this.className.includes('sidebar-ux-drawer') && !this.className.includes('wrapper')
    if (sel === '.sidebar-ux-resize-handle') return this.className.includes('sidebar-ux-resize-handle')
    if (sel === '.sidebar-ux-tab-list') return this.className.includes('sidebar-ux-tab-list')
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

let _hostDrawer: StubElement | null = null

;(globalThis as any).document = {
  documentElement: {
    style: {
      _props: {} as Record<string, string>,
      setProperty(k: string, v: string) { this._props[k] = v },
      getPropertyValue(k: string) { return this._props[k] ?? '' },
      removeProperty(k: string) { delete this._props[k] },
    },
    classList: { add() {}, remove() {}, contains() { return false }, toggle() {} },
  },
  querySelector(sel: string) {
    if (sel === '[data-spindle-mount="sidebar"]') {
      // The host drawer is the sidebar's parentElement.
      const sidebar = makeEl('spindle-sidebar')
      if (_hostDrawer) sidebar.parentElement = _hostDrawer
      return sidebar
    }
    if (sel === '.sidebar-ux-tab-list-pin-host[data-pin-owner="main"] .sidebar-ux-tab-list') return null
    return null
  },
  querySelectorAll(_sel: string) { return [] },
  createElement(_tag: string) { return new StubElement() },
  body: {
    appendChild() {},
    removeChild() {},
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
;(globalThis as any).window = Object.assign(globalThis.window ?? {}, {
  matchMedia: (q: string) => ({
    matches: q.includes('pointer') ? false : q.includes('max-width') ? false : false,
    addEventListener() {},
    removeEventListener() {},
  }),
})

// =====================================================================
// Imports
// =====================================================================

import { mountResizeHandles } from '../handles'
import { setMainDrawerSideOverride, getMainDrawerSide } from '../../store'
import { __setSecondaryWrapperForTest } from '../../sidebar/secondary'

// =====================================================================
// Helpers
// =====================================================================

const HOST_LEFT = 'calc(var(--drawer-panel-w, 420px) - 4px)'

function setupEnv(side: 'left' | 'right') {
  _hostDrawer = makeEl('host-drawer')
  setMainDrawerSideOverride(side)
  __setSecondaryWrapperForTest(null)
}

function resetEnv() {
  _hostDrawer = null
  setMainDrawerSideOverride(null)
  __setSecondaryWrapperForTest(null)
}

// =====================================================================
// T1: existing host handle is re-anchored after side flip (left → right)
// =====================================================================
{
  setupEnv('left')
  try {
    // Pre-existing handle positioned for a LEFT drawer (inner edge = right).
    const handle = makeEl('sidebar-ux-resize-handle')
    handle.style.left = HOST_LEFT
    handle.style.right = ''
    _hostDrawer!.appendChild(handle)

    // Flip the drawer to the right.
    setMainDrawerSideOverride('right')
    assertEqual(getMainDrawerSide(), 'right', 'T1 precondition: side is right')

    mountResizeHandles()

    // Same element, re-anchored to the drawer's new inner edge (left edge).
    const after = _hostDrawer!.querySelector('.sidebar-ux-resize-handle')!
    assert(after === handle, 'T1: handle element preserved (not remounted)')
    assertEqual(after.style.left, '', 'T1: left cleared after flip to right')
    assertEqual(after.style.right, HOST_LEFT, 'T1: handle anchored to right side (right: calc)')
  } finally { resetEnv() }
}

// =====================================================================
// T2: existing host handle re-anchors back (right → left)
// =====================================================================
{
  setupEnv('right')
  try {
    const handle = makeEl('sidebar-ux-resize-handle')
    handle.style.right = HOST_LEFT
    handle.style.left = ''
    _hostDrawer!.appendChild(handle)

    setMainDrawerSideOverride('left')
    mountResizeHandles()

    const after = _hostDrawer!.querySelector('.sidebar-ux-resize-handle')!
    assert(after === handle, 'T2: handle element preserved')
    assertEqual(after.style.right, '', 'T2: right cleared after flip to left')
    assertEqual(after.style.left, HOST_LEFT, 'T2: handle anchored to left side (left: calc)')
  } finally { resetEnv() }
}

// =====================================================================
// T3: host handle created with correct position when missing (left)
// =====================================================================
{
  setupEnv('left')
  try {
    assert(_hostDrawer!.querySelector('.sidebar-ux-resize-handle') === null, 'T3 precondition: no handle yet')
    mountResizeHandles()
    const handle = _hostDrawer!.querySelector('.sidebar-ux-resize-handle')!
    assert(!!handle, 'T3: handle created')
    assertEqual(handle.style.left, HOST_LEFT, 'T3: created handle anchored to left side')
    assertEqual(handle.style.right, '', 'T3: right cleared on left side')
  } finally { resetEnv() }
}

// =====================================================================
// T4: secondary handle re-anchored on side flip (wrapper survives)
// =====================================================================
{
  setupEnv('left')
  try {
    const secDrawer = makeEl('sidebar-ux-drawer')
    const secHandle = makeEl('sidebar-ux-resize-handle')
    secDrawer.appendChild(secHandle)
    const secWrapper = makeEl('sidebar-ux-secondary-wrapper')
    secWrapper.appendChild(secDrawer)
    __setSecondaryWrapperForTest(secWrapper as any)

    // Left main → secondary on right → handle on the drawer's LEFT edge.
    assertEqual(secHandle.style.left ?? '', '', 'T4 precondition: no position yet')
    mountResizeHandles()
    assertEqual(secHandle.style.left, '-4px', 'T4: secondary handle on left edge when main is left')
    assertEqual(secHandle.style.right, '', 'T4: right cleared')

    // Flip main to right → secondary moves left → handle on the drawer's
    // RIGHT edge.
    setMainDrawerSideOverride('right')
    mountResizeHandles()
    assertEqual(secHandle.style.left, '', 'T4: left cleared after flip')
    assertEqual(secHandle.style.right, '-4px', 'T4: secondary handle on right edge when main is right')
  } finally { resetEnv() }
}

// =====================================================================
// Run
// =====================================================================

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
