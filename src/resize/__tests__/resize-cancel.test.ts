// Regression: pointer cancellation and window blur must finish a resize drag,
// remove the pointer-blocking overlay, restore body styles, and commit once.

let passed = 0
let failed = 0
function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    console.error('FAIL: ' + message + ' — expected ' + String(expected) + ', got ' + String(actual))
    failed++
  } else {
    passed++
  }
}

class StubStyle {
  cursor = ''
  userSelect = ''
  background = ''
  set cssText(_value: string) {}
}

class StubElement {
  style = new StubStyle()
  className = ''
  parentElement: StubElement | null = null
  closestMatch: StubElement | null = null
  queryMatch: StubElement | null = null
  children: StubElement[] = []
  rectWidth = 420
  private handlers: Record<string, Array<(event: unknown) => void>> = {}

  addEventListener(type: string, handler: (event: unknown) => void) {
    ;(this.handlers[type] ||= []).push(handler)
  }
  removeEventListener(type: string, handler: (event: unknown) => void) {
    this.handlers[type] = (this.handlers[type] ?? []).filter((item) => item !== handler)
  }
  dispatch(type: string, event: unknown = {}) {
    for (const handler of [...(this.handlers[type] ?? [])]) handler(event)
  }
  appendChild(child: StubElement) {
    child.parentElement = this
    this.children.push(child)
    return child
  }
  getBoundingClientRect() {
    return { width: this.rectWidth }
  }
  closest(_selector: string) {
    return this.closestMatch
  }
  querySelector(_selector: string) {
    return this.queryMatch
  }
  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this)
      this.parentElement = null
    }
  }
}

const documentHandlers: Record<string, Array<(event: unknown) => void>> = {}
const windowHandlers: Record<string, Array<(event: unknown) => void>> = {}
function addHandler(target: Record<string, Array<(event: unknown) => void>>, type: string, handler: (event: unknown) => void) {
  ;(target[type] ||= []).push(handler)
}
function removeHandler(target: Record<string, Array<(event: unknown) => void>>, type: string, handler: (event: unknown) => void) {
  target[type] = (target[type] ?? []).filter((item) => item !== handler)
}
function fire(target: Record<string, Array<(event: unknown) => void>>, type: string) {
  for (const handler of [...(target[type] ?? [])]) handler({})
}
function pointerDown() {
  return { clientX: 100, preventDefault() {}, stopPropagation() {} }
}

const body = new StubElement()
;(globalThis as any).document = {
  createElement: () => new StubElement(),
  addEventListener: (type: string, handler: (event: unknown) => void) =>
    addHandler(documentHandlers, type, handler),
  removeEventListener: (type: string, handler: (event: unknown) => void) =>
    removeHandler(documentHandlers, type, handler),
  body,
}
;(globalThis as any).window = {
  addEventListener: (type: string, handler: (event: unknown) => void) =>
    addHandler(windowHandlers, type, handler),
  removeEventListener: (type: string, handler: (event: unknown) => void) =>
    removeHandler(windowHandlers, type, handler),
}

import { createResizeHandle } from '../handles'

function startDrag() {
  let persistCalls = 0
  const content = new StubElement()
  const drawer = new StubElement()
  drawer.queryMatch = content
  const handle = createResizeHandle('right', () => {}, () => persistCalls++) as unknown as StubElement
  handle.closestMatch = drawer
  drawer.appendChild(handle)
  handle.dispatch('pointerdown', pointerDown())
  assertEqual(content.children.length, 1, 'drag installs one overlay')
  assertEqual(body.style.cursor, 'col-resize', 'drag sets resize cursor')
  assertEqual(body.style.userSelect, 'none', 'drag disables selection')
  return { content, handle, persistCalls: () => persistCalls }
}

function assertFinished(
  content: StubElement,
  handle: StubElement,
  persistCalls: () => number,
  eventName: 'pointercancel' | 'blur',
) {
  assertEqual(content.children.length, 0, eventName + ' removes overlay')
  assertEqual(body.style.cursor, '', eventName + ' restores body cursor')
  assertEqual(body.style.userSelect, '', eventName + ' restores body selection')
  assertEqual(persistCalls(), 1, eventName + ' commits resize once')

  // The hover reset is suppressed while dragging; after finish it must run.
  handle.dispatch('mouseenter')
  handle.dispatch('mouseleave')
  assertEqual(handle.style.background, 'transparent', eventName + ' clears dragging state')
}

// pointercancel cleans up and does not commit again if a late pointerup/blur follows.
{
  const { content, handle, persistCalls } = startDrag()
  fire(documentHandlers, 'pointercancel')
  assertFinished(content, handle, persistCalls, 'pointercancel')
  fire(documentHandlers, 'pointerup')
  fire(windowHandlers, 'blur')
  assertEqual(persistCalls(), 1, 'late terminal events do not commit twice')
}

// Window blur has the same cleanup path and removes its own listener.
{
  const { content, handle, persistCalls } = startDrag()
  fire(windowHandlers, 'blur')
  assertFinished(content, handle, persistCalls, 'blur')
  fire(documentHandlers, 'pointerup')
  fire(documentHandlers, 'pointercancel')
  assertEqual(persistCalls(), 1, 'late pointer events do not commit twice')
}

if (failed > 0) {
  console.error('FAILED: ' + failed)
  process.exitCode = 1
}
console.log('PASS: ' + passed)
