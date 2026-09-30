// Host context-menu OS items (D14): Minimize + Close injected into
// Lumiverse's own ContextMenu for main-drawer tab right-clicks.
//
// Verifies the injection shape without the document observer: item order,
// the move-vs-OS independence (second-drawer-disabled gate applies to the
// move item only), the tab-menu identity guard, and the action wiring/side.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) passed++
  else {
    failed++
    console.error('FAIL:', msg)
  }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) passed++
  else {
    failed++
    console.error(`FAIL: ${msg} — expected ${String(expected)}, got ${String(actual)}`)
  }
}

// ── Mutable controls for mocks ──
let osOn = true
let secondEnabled = true
// Model active keys per side: the OS Minimize item shows only for the
// drawer's OPEN/active window (six-concerns #4).
let activeBySide: { primary: string | null; secondary: string | null } = {
  primary: null,
  secondary: null,
}
const minimizeCalls: Array<{ liveId: string; side: string }> = []
const closeCalls: string[] = []
const keyEvents: string[] = []

// ── Minimal DOM stubs ──

class StubStyle {
  cssText = ''
  color = ''
  background = ''
  fontSize = ''
}
class StubButton {
  tagName = 'BUTTON'
  type = ''
  textContent = ''
  style = new StubStyle()
  handlers: Record<string, Array<(e: unknown) => void>> = {}
  addEventListener(ev: string, fn: (e: unknown) => void) {
    ;(this.handlers[ev] ??= []).push(fn)
  }
  click() {
    for (const fn of this.handlers['click'] ?? []) fn({ stopPropagation() {} })
  }
}
class StubMenu {
  tagName = 'DIV'
  dataset: Record<string, string> = {}
  children: Array<StubButton | StubMenu> = []
  style = new StubStyle()
  appendChild<T extends StubButton | StubMenu>(c: T): T {
    this.children.push(c)
    return c
  }
  querySelector(sel: string) {
    return sel === 'button' ? (this.children.find((c) => c.tagName === 'BUTTON') ?? null) : null
  }
  querySelectorAll(sel: string) {
    return sel === 'button' ? this.children.filter((c) => c.tagName === 'BUTTON') : []
  }
  getBoundingClientRect() {
    return { right: 200, bottom: 200, width: 180, height: 140 }
  }
}

function makeMenu(labelsWording = 'Hide tab labels'): StubMenu {
  const menu = new StubMenu()
  const labels = new StubButton()
  labels.textContent = labelsWording
  menu.appendChild(labels)
  return menu
}

function buttonTexts(menu: StubMenu): string[] {
  return menu.querySelectorAll('button').map((b) => (b as StubButton).textContent)
}

;(globalThis as any).document = {
  body: { lastElementChild: null },
  documentElement: { style: { getPropertyValue: () => '' } },
  createElement: (tag: string) => (tag === 'button' ? new StubButton() : new StubMenu()),
  dispatchEvent: (ev: { key?: string }) => {
    keyEvents.push(ev?.key ?? '')
    return true
  },
}
;(globalThis as any).getComputedStyle = () => ({ getPropertyValue: () => '' })
;(globalThis as any).KeyboardEvent = class {
  key: string
  constructor(_type: string, init?: { key?: string }) {
    this.key = init?.key ?? ''
  }
}
;(globalThis as any).window = { innerWidth: 1200, innerHeight: 900 }

const { mock } = await import('bun:test')

import * as actualStore from '../../store'
import * as actualLumiverse from '../../dom/lumiverse'

mock.module('../../sidebar/drawer-sync', () => ({
  isShowTabLabels: () => true,
  syncSecondaryTabLabels: () => {},
  syncDrawerTabSettings: () => {},
}))
mock.module('../../dom/lumiverse', () => ({
  ...actualLumiverse,
  getMainSidebar: () => null,
}))
mock.module('../../store', () => ({
  ...actualStore,
  findStoreData: () => {},
  getDrawerTabs: () => [],
}))
mock.module('../../tabs/assignment', () => ({
  getTabSidebar: () => 'primary',
  assignTab: () => {},
}))
mock.module('../../settings/state', () => ({
  getSettings: () => ({ secondSidebarEnabled: secondEnabled }),
  isOsModeEnabled: () => osOn,
}))
mock.module('../../tabs/tab-context-menu', () => ({
  hideAssignmentMenu: () => {},
}))
mock.module('../../tabs/buttons', () => ({
  isSettingsButton: () => false,
}))
mock.module('../../debug/log', () => ({
  dlog: () => {},
  dwarn: () => {},
}))
mock.module('../../recon/dispatch', () => ({
  dispatchMoveByLiveId: () => Promise.resolve(),
  placementFirstMoveByLiveId: () => Promise.resolve(),
  getHost: () => ({
    findKey: (id: string) => `builtin:${id.replace(/:.*$/, '')}`,
  }),
  getModel: () => ({ active: activeBySide }),
}))
mock.module('../../os/actions', () => ({
  minimizeWindowByLiveId: (liveId: string, side: string) => {
    minimizeCalls.push({ liveId, side })
    return Promise.resolve()
  },
  closeWindowByLiveId: (liveId: string) => {
    closeCalls.push(liveId)
    return Promise.resolve()
  },
}))

const { __injectCanvasItemForTest } = await import('../index')

const flush = () => new Promise((r) => setTimeout(r, 0))

// ── S1: OS on — move + Minimize + Close, actions wired with the capture side ──
{
  osOn = true
  secondEnabled = true
  activeBySide = { primary: 'builtin:personas', secondary: null }
  const menu = makeMenu()
  __injectCanvasItemForTest(menu as unknown as HTMLElement, 'personas', 'primary')
  const texts = buttonTexts(menu)
  assertEqual(texts.join('|'), 'Hide tab labels|Move to second drawer|Minimize|Close', 'S1: item order')
  const minimizeBtn = menu.querySelectorAll('button')[2] as StubButton
  const closeBtn = menu.querySelectorAll('button')[3] as StubButton
  minimizeBtn.click()
  closeBtn.click()
  await flush()
  assertEqual(minimizeCalls.length, 1, 'S1: minimize called once')
  assertEqual(minimizeCalls[0]?.liveId, 'personas', 'S1: minimize liveId')
  assertEqual(minimizeCalls[0]?.side, 'primary', 'S1: minimize side from the capture')
  assertEqual(closeCalls.length, 1, 'S1: close called once')
  assertEqual(closeCalls[0], 'personas', 'S1: close liveId')
  assertEqual(keyEvents.filter((k) => k === 'Escape').length, 2, 'S1: each click dismisses the menu')
}

// ── S2: OS off — no OS items ──
{
  osOn = false
  const menu = makeMenu()
  __injectCanvasItemForTest(menu as unknown as HTMLElement, 'personas', 'primary')
  const texts = buttonTexts(menu)
  assert(!texts.includes('Minimize'), 'S2: no Minimize when OS off')
  assert(!texts.includes('Close'), 'S2: no Close when OS off')
  assert(texts.includes('Move to second drawer'), 'S2: move still injected')
}

// ── S3: second drawer disabled — move omitted, OS items independent ──
{
  osOn = true
  secondEnabled = false
  activeBySide = { primary: 'builtin:personas', secondary: null }
  const menu = makeMenu()
  __injectCanvasItemForTest(menu as unknown as HTMLElement, 'personas', 'primary')
  const texts = buttonTexts(menu)
  assert(!texts.includes('Move to second drawer'), 'S3: move omitted when second drawer disabled')
  assert(texts.includes('Minimize') && texts.includes('Close'), 'S3: OS items still injected')
}

// ── S4: foreign menu (no tab wording) — destructive OS pair skipped ──
{
  osOn = true
  secondEnabled = true
  const menu = new StubMenu()
  const foreign = new StubButton()
  foreign.textContent = 'Install'
  menu.appendChild(foreign)
  __injectCanvasItemForTest(menu as unknown as HTMLElement, 'personas', 'primary')
  const texts = buttonTexts(menu)
  assert(!texts.includes('Minimize') && !texts.includes('Close'), 'S4: no OS items on a foreign menu')
}

// ── S5: secondary-side capture — Minimize side follows currentSidebar ──
{
  osOn = true
  secondEnabled = true
  minimizeCalls.length = 0
  activeBySide = { primary: null, secondary: 'builtin:lorebook' }
  const menu = makeMenu()
  __injectCanvasItemForTest(menu as unknown as HTMLElement, 'lorebook', 'secondary')
  const texts = buttonTexts(menu)
  assert(texts.includes('Move to main drawer'), 'S5: move label for a secondary tab')
  const minimizeBtn = menu.querySelectorAll('button').find((b) => (b as StubButton).textContent === 'Minimize') as StubButton
  minimizeBtn.click()
  await flush()
  assertEqual(minimizeCalls[0]?.side, 'secondary', 'S5: minimize side follows the capture')
}

// ── S6: minimized tab — Close only, no Minimize (six-concerns #4) ──
{
  osOn = true
  secondEnabled = true
  closeCalls.length = 0
  activeBySide = { primary: 'builtin:other', secondary: null }
  const menu = makeMenu()
  __injectCanvasItemForTest(menu as unknown as HTMLElement, 'personas', 'primary')
  const texts = buttonTexts(menu)
  assert(!texts.includes('Minimize'), 'S6: no Minimize on a minimized window')
  assert(texts.includes('Close'), 'S6: Close still offered for a minimized window')
  const closeBtn = menu.querySelectorAll('button').find((b) => (b as StubButton).textContent === 'Close') as StubButton
  closeBtn.click()
  await flush()
  assertEqual(closeCalls.length, 1, 'S6: close still wired')
}

console.log(`context-menu os-items tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
export {}
