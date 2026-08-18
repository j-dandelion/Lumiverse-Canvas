// Tests for dock-offset: a Spindle dock panel on the same edge as a pinned
// tab strip must be shifted inward by the strip width so the strip stays
// topmost at the screen edge and the dock sits just inside it (never covered,
// never covering). With no strip on the dock's edge the dock stays flush.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { failed++; console.error(`FAIL: ${msg} -- expected ${String(expected)}, got ${String(actual)}`) }
}

class StubStyle {
  position = ''
  zIndex = ''
  top = ''
  bottom = ''
  left = ''
  right = ''
  _vars: Record<string, string> = {}
  setProperty(n: string, v: string) { this._vars[n] = v }
  getPropertyValue(n: string) { return this._vars[n] ?? '' }
}

class StubElement {
  tagName = 'DIV'
  className = ''
  style: Record<string, string> & StubStyle = new StubStyle() as any
  _attrs: Record<string, string> = {}
  setAttribute(n: string, v: string) { this._attrs[n] = v }
  getAttribute(n: string) { return this._attrs[n] ?? null }
  get classList() {
    const self = this
    return {
      contains: (c: string) => self.className.split(/\s+/).includes(c),
      add: (c: string) => { self.className = (self.className + ' ' + c).trim() },
      remove: (c: string) => {
        self.className = self.className.split(/\s+/).filter((x) => x && x !== c).join(' ')
      },
    }
  }
}

const stubDocumentElement = new StubElement()
const _allDivs: StubElement[] = []
const _pinHosts: StubElement[] = []
let stubAppEl: StubElement | null = null
let _computed = new Map<StubElement, StubStyle>()

function makePinHost(side: 'left' | 'right') {
  const host = new StubElement()
  host.className = `sidebar-ux-tab-list-pin-host sidebar-ux-side-${side}`
  _pinHosts.push(host)
  return host
}

function makeDock(edge: 'left' | 'right') {
  const dock = new StubElement()
  const cs = new StubStyle()
  cs.position = 'fixed'
  cs.zIndex = '9980'
  cs.top = '0px'
  cs.bottom = '0px'
  if (edge === 'left') cs.left = '0px'
  else cs.right = '0px'
  _allDivs.push(dock)
  _computed.set(dock, cs)
  return dock
}

function makePlainDiv() {
  const el = new StubElement()
  _allDivs.push(el)
  _computed.set(el, new StubStyle())
  return el
}

const stubDocument: any = {
  documentElement: stubDocumentElement,
  body: new StubElement(),
  querySelector(sel: string) {
    if (sel === '[data-app-root]') return stubAppEl
    return null
  },
  querySelectorAll(sel: string) {
    if (sel === '.sidebar-ux-tab-list-pin-host') return _pinHosts
    if (sel === 'div') return _allDivs
    return []
  },
}

function resetAll() {
  _allDivs.length = 0
  _pinHosts.length = 0
  stubAppEl = null
  _computed = new Map()
  __resetDockOffsetForTest()
}

function setDockInset(side: 'left' | 'right', width: number) {
  if (!stubAppEl) {
    stubAppEl = new StubElement()
    stubAppEl.setAttribute('data-app-root', '')
  }
  stubAppEl.style.setProperty(
    side === 'left' ? '--spindle-dock-left' : '--spindle-dock-right',
    `${width}px`,
  )
}

;(globalThis as any).document = stubDocument
;(globalThis as any).window = {
  innerWidth: 1280,
  innerHeight: 800,
  getComputedStyle: (el: StubElement) => _computed.get(el) ?? new StubStyle(),
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
}

import { updateDockOffsets, __resetDockOffsetForTest, DOCK_EDGE_OFFSET_PX } from '../dock-offset'

// T1: no dock (no app element) → nothing to do, dock style untouched.
resetAll()
const plainDock = makeDock('left')
updateDockOffsets()
assertEqual(plainDock.style.left, '', 'T1: no dock inset → no offset applied')

// T2: dock on left + strip pinned on left → dock shifted right by strip width.
resetAll()
const d2 = makeDock('left')
makePlainDiv()
makePinHost('left')
setDockInset('left', 420)
updateDockOffsets()
assertEqual(d2.style.left, `${DOCK_EDGE_OFFSET_PX}px`, 'T2: left dock offset by strip width')
assertEqual(d2.style.right, '', 'T2: right anchor stays empty')

// T3: dock on right + strip pinned on right → dock shifted left by strip width.
resetAll()
const d3 = makeDock('right')
makePinHost('right')
setDockInset('right', 300)
updateDockOffsets()
assertEqual(d3.style.right, `${DOCK_EDGE_OFFSET_PX}px`, 'T3: right dock offset by strip width')
assertEqual(d3.style.left, '', 'T3: left anchor stays empty')

// T4: dock on left, strip pinned on the RIGHT only → left dock stays flush.
resetAll()
const d4 = makeDock('left')
makePinHost('right')
setDockInset('left', 200)
updateDockOffsets()
assertEqual(d4.style.left, '', 'T4: dock on edge without a strip stays flush')
assertEqual(d4.style.right, '', 'T4: right anchor stays empty')

// T5: strip removed → offset cleared.
resetAll()
const d5 = makeDock('left')
makePinHost('left')
setDockInset('left', 420)
updateDockOffsets()
assertEqual(d5.style.left, `${DOCK_EDGE_OFFSET_PX}px`, 'T5a: offset applied while strip present')
_pinHosts.length = 0
updateDockOffsets()
assertEqual(d5.style.left, '', 'T5b: offset cleared after strip removed')

// T6: dock on left, strips on BOTH sides → left dock offset; right dock (if
// any) offset too.
resetAll()
const d6l = makeDock('left')
const d6r = makeDock('right')
makePinHost('left')
makePinHost('right')
setDockInset('left', 420)
setDockInset('right', 300)
updateDockOffsets()
assertEqual(d6l.style.left, `${DOCK_EDGE_OFFSET_PX}px`, 'T6: left dock offset')
assertEqual(d6r.style.right, `${DOCK_EDGE_OFFSET_PX}px`, 'T6: right dock offset')

// T7: non-dock fixed elements (float-widget-like: not full-height) are ignored.
resetAll()
const d7 = makeDock('left')
const floatLike = new StubElement()
const floatCs = new StubStyle()
floatCs.position = 'fixed'
floatCs.zIndex = '9980'
floatCs.top = '100px'
floatCs.bottom = 'auto'
floatCs.left = '20px'
_allDivs.push(floatLike)
_computed.set(floatLike, floatCs)
makePinHost('left')
setDockInset('left', 420)
updateDockOffsets()
assertEqual(d7.style.left, `${DOCK_EDGE_OFFSET_PX}px`, 'T7: real dock offset')
assertEqual(floatLike.style.left, '', 'T7: float-widget-like element untouched')

// T8: collapsed dock (36px inset) still gets the offset.
resetAll()
const d8 = makeDock('left')
makePinHost('left')
setDockInset('left', 36)
updateDockOffsets()
assertEqual(d8.style.left, `${DOCK_EDGE_OFFSET_PX}px`, 'T8: collapsed dock offset')

// T9: a dock added later (inset changes) is found by the rescan.
resetAll()
const d9a = makeDock('left')
makePinHost('left')
setDockInset('left', 36)
updateDockOffsets()
assertEqual(d9a.style.left, `${DOCK_EDGE_OFFSET_PX}px`, 'T9a: first dock offset')
const d9b = makeDock('left')
setDockInset('left', 420) // inset changed → rescan finds the new dock
updateDockOffsets()
assertEqual(d9b.style.left, `${DOCK_EDGE_OFFSET_PX}px`, 'T9b: newly added dock offset after inset change')

// T10: mid-session side flip (left → right) — the same dock node re-anchors
// to right:0 while the stale left:56px inline offset persists; the next scan
// must detect the NEW edge and re-apply on the right (clearing the stale left).
resetAll()
const d10 = makeDock('left')
makePinHost('left')
setDockInset('left', 420)
updateDockOffsets()
assertEqual(d10.style.left, `${DOCK_EDGE_OFFSET_PX}px`, 'T10a: dock offset on the left')
// User flips the dock side in Spindle settings: the panel re-renders with the
// right-edge class (right:0) but keeps our stale inline left offset, and the
// app's dock insets move to the right.
const cs10 = _computed.get(d10)!
cs10.left = '56px' // stale inline offset now shows in computed style
cs10.right = '0px' // new edge anchor from the flipped class
_pinHosts.length = 0
makePinHost('right')
setDockInset('left', 0)
setDockInset('right', 420)
updateDockOffsets()
assertEqual(d10.style.right, `${DOCK_EDGE_OFFSET_PX}px`, 'T10b: dock re-offset on the right after flip')
assertEqual(d10.style.left, '', 'T10b: stale left offset cleared')

console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
process.exit(failed > 0 ? 1 : 0)