// DOM last-resort place + restore for non-CORE built-ins.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { failed++; console.error(`FAIL: ${msg} — expected ${String(expected)}, got ${String(actual)}`) }
}

// Minimal DOM for bun (no browser globals).
type StubEl = {
  tag: string
  attrs: Record<string, string>
  children: StubEl[]
  parentElement: StubEl | null
  className: string
  style: Record<string, unknown>
  setAttribute(name: string, value: string): void
  getAttribute(name: string): string | null
  removeAttribute(name: string): void
  hasAttribute(name: string): boolean
  appendChild(c: StubEl): StubEl
  remove(): void
  contains(other: StubEl): boolean
  querySelector(sel: string): StubEl | null
}

function makeEl(tag: string): StubEl {
  const attrs: Record<string, string> = {}
  const children: StubEl[] = []
  const el: StubEl = {
    tag,
    attrs,
    children,
    parentElement: null,
    className: '',
    style: {},
    setAttribute(name, value) { attrs[name] = value },
    getAttribute(name) { return name in attrs ? attrs[name] : null },
    removeAttribute(name) { delete attrs[name] },
    hasAttribute(name) { return name in attrs },
    appendChild(c) {
      if (c.parentElement) {
        const sibs = c.parentElement.children
        const i = sibs.indexOf(c)
        if (i >= 0) sibs.splice(i, 1)
      }
      c.parentElement = el
      children.push(c)
      return c
    },
    remove() {
      if (!el.parentElement) return
      const sibs = el.parentElement.children
      const i = sibs.indexOf(el)
      if (i >= 0) sibs.splice(i, 1)
      el.parentElement = null
    },
    contains(other) {
      if (other === el) return true
      for (const ch of children) {
        if (ch === other || ch.contains(other)) return true
      }
      return false
    },
    querySelector(sel) {
      // Very small subset used by restore/isDomPlaced
      const walk = (node: StubEl): StubEl | null => {
        if (matchSel(node, sel)) return node
        for (const ch of node.children) {
          const hit = walk(ch)
          if (hit) return hit
        }
        return null
      }
      return walk(el)
    },
  }
  return el
}

function matchSel(node: StubEl, sel: string): boolean {
  // [data-canvas-main-panel-content]
  if (sel === '[data-canvas-main-panel-content]') {
    return node.hasAttribute('data-canvas-main-panel-content')
  }
  // [data-canvas-moved="id"][data-canvas-dom-placed]
  const mBoth = sel.match(
    /^\[data-canvas-moved="([^"]+)"\]\[data-canvas-dom-placed\]$/,
  )
  if (mBoth) {
    return (
      node.getAttribute('data-canvas-moved') === mBoth[1] &&
      node.hasAttribute('data-canvas-dom-placed')
    )
  }
  // [data-canvas-moved="id"]:not([data-canvas-secondary])
  const mMoved = sel.match(
    /^\[data-canvas-moved="([^"]+)"\](?::not\(\[data-canvas-secondary\]\))?$/,
  )
  if (mMoved) {
    return (
      node.getAttribute('data-canvas-moved') === mMoved[1] &&
      !node.hasAttribute('data-canvas-secondary')
    )
  }
  return false
}

const body = makeEl('body')
const doc = {
  body,
  createElement: (tag: string) => makeEl(tag),
  querySelector(sel: string) {
    return body.querySelector(sel)
  },
  querySelectorAll() { return [] },
  documentElement: { classList: { contains() { return false }, add() {}, remove() {} }, style: { removeProperty() {}, setProperty() {} } },
  head: { appendChild() {}, removeChild() {} },
  addEventListener() {},
  removeEventListener() {},
} as any
;(globalThis as any).document = doc
if (typeof CSS === 'undefined') {
  ;(globalThis as any).CSS = { escape: (s: string) => s }
}

import { setHostBridgeContext } from '../../dom/host-bridge'
import { __setHostMoveTabToForTest } from '../host-tab-location'
import {
  __clearDomPlacedForTest,
  isDomPlacedBuiltIn,
  restoreDomPlacedBuiltInToMain,
  CANVAS_DOM_PLACED_ATTR,
} from '../dom-placed-builtin'

async function run() {
  __clearDomPlacedForTest()
  __setHostMoveTabToForTest(null)

  const mainContent = document.createElement('div') as unknown as StubEl
  mainContent.setAttribute('data-canvas-main-panel-content', '1')
  body.appendChild(mainContent)

  const secondaryContent = document.createElement('div') as unknown as StubEl
  secondaryContent.className = 'sidebar-ux-panel-content'
  body.appendChild(secondaryContent)

  const root = document.createElement('div') as unknown as StubEl
  root.setAttribute('data-tab-id', 'connections')
  mainContent.appendChild(root)

  setHostBridgeContext({
    ui: {
      getBuiltInTabRoot: () => root as unknown as HTMLElement,
      requestTabLocation: () => { /* silent no-op non-CORE */ },
      getTabLocation: () => ({ kind: 'main-drawer' }),
    },
    containers: {},
  } as any)

  const origRaf = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    queueMicrotask(() => cb(0))
    return 0
  }) as typeof requestAnimationFrame

  const { moveBuiltInTabToSecondaryContainer, __setSecondaryContentForTest } =
    await import('../builtin-move')
  __setSecondaryContentForTest(secondaryContent as unknown as HTMLElement)

  try {
    const placed = await moveBuiltInTabToSecondaryContainer({
      tabId: 'connections',
      root: root as unknown as HTMLElement,
    })
    assert(!!placed, 'T-DOM-1: place succeeds via DOM when bridge+store fail')
    assert(isDomPlacedBuiltIn('connections'), 'T-DOM-2: tracked as dom-placed')
    assertEqual(
      root.getAttribute(CANVAS_DOM_PLACED_ATTR),
      '',
      'T-DOM-3: data-canvas-dom-placed attr set',
    )
    assert(
      secondaryContent.contains(root),
      'T-DOM-4: root is under secondary panel content',
    )
    assertEqual(
      root.getAttribute('data-canvas-moved'),
      'connections',
      'T-DOM-5: data-canvas-moved stamped',
    )

    const restored = restoreDomPlacedBuiltInToMain(
      'connections',
      root as unknown as HTMLElement,
    )
    assert(restored, 'T-DOM-6: restore returns true')
    assert(!isDomPlacedBuiltIn('connections'), 'T-DOM-7: tracking cleared')
    assert(
      mainContent.contains(root),
      'T-DOM-8: root back under main panel content',
    )
    assertEqual(
      root.getAttribute(CANVAS_DOM_PLACED_ATTR),
      null,
      'T-DOM-9: dom-placed attr cleared',
    )
    assertEqual(
      root.getAttribute('data-canvas-moved'),
      null,
      'T-DOM-10: moved attr cleared',
    )
  } finally {
    globalThis.requestAnimationFrame = origRaf
    __setSecondaryContentForTest(null)
    setHostBridgeContext(null)
    __setHostMoveTabToForTest(null)
    __clearDomPlacedForTest()
  }
}

run().then(() => {
  console.log(`dom-placed-builtin: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}).catch((e) => {
  console.error(e)
  process.exit(1)
})
