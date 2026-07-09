// Tests for src/slash/commands/persona/index.ts — /persona DOM interaction.
// Uses the repo's custom assertion harness (no Jest/Vitest).
//
// Bun's test runner does NOT provide browser globals like `document`.
// We mock the DOM for: persona button lookup (title), popover scrape
// (MutationObserver + buttons), item matching, and getArgCompletions cache.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}

// --- DOM mocks ---

// Persona capture uses `node instanceof HTMLElement` — provide a base class.
class HTMLElement {
  style: Record<string, string> = {}
  className = ''
  children: HTMLElement[] = []
  getAttribute(_name: string): string | null { return null }
  matches(_selector: string): boolean { return false }
  querySelector(_selector: string): HTMLElement | null { return null }
  querySelectorAll(_selector: string): HTMLElement[] { return [] }
}
;(globalThis as any).HTMLElement = HTMLElement

class MockElement extends HTMLElement {
  tag: string
  className = ''
  _textContent: string
  clicked = false
  children: MockElement[] = []
  attrs: Record<string, string> = {}
  style: Record<string, string> = {}

  constructor(tag: string, text: string, attrs: Record<string, string> = {}) {
    super()
    this.tag = tag
    this._textContent = text
    this.attrs = attrs
  }

  get textContent() { return this._textContent }

  click() { this.clicked = true }

  getAttribute(name: string) { return this.attrs[name] ?? null }

  matches(selector: string): boolean {
    if (selector.includes('popover') && this.className.includes('popover')) return true
    return false
  }

  querySelector(selector: string): MockElement | null {
    if (selector.includes('popover')) {
      for (const c of this.children) {
        if (c.className.includes('popover')) return c
      }
    }
    return null
  }

  querySelectorAll(selector: string): MockElement[] {
    if (selector === 'button') {
      return this.collectButtons()
    }
    return []
  }

  collectButtons(): MockElement[] {
    const out: MockElement[] = []
    if (this.tag.toLowerCase() === 'button') out.push(this)
    for (const c of this.children) out.push(...c.collectButtons())
    return out
  }
}

let allButtons: MockElement[] = []
let bodyChildren: MockElement[] = []
let moCallback: ((mutations: any[]) => void) | null = null

const mockDocument = {
  body: {
    // observed target only
  },
  querySelectorAll(selector: string): MockElement[] {
    if (selector === 'button') return allButtons
    return []
  },
  querySelector(_selector: string): MockElement | null {
    return null
  },
  dispatchEvent(_e: Event): boolean {
    return true
  },
}

;(globalThis as any).document = mockDocument
;(globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0)
;(globalThis as any).MutationObserver = class {
  _cb: (mutations: any[]) => void
  constructor(cb: (mutations: any[]) => void) {
    this._cb = cb
    moCallback = cb
  }
  observe() {}
  disconnect() {
    if (moCallback === this._cb) moCallback = null
  }
}
;(globalThis as any).KeyboardEvent = class {
  key: string
  constructor(_type: string, init?: { key?: string }) {
    this.key = init?.key ?? ''
  }
}
;(globalThis as any).CustomEvent = class {
  type: string
  detail: unknown
  constructor(type: string, init?: { detail?: unknown }) {
    this.type = type
    this.detail = init?.detail
  }
}
// window for warmPersonaCache event
const completionEvents: string[] = []
;(globalThis as any).window = {
  dispatchEvent(e: { type: string }) {
    completionEvents.push(e.type)
    return true
  },
  addEventListener() {},
  removeEventListener() {},
}

import {
  makePersonaCommand,
  extractPersonaLabel,
  _resetPersonaCacheForTests,
  warmPersonaCache,
} from '../commands/persona/index'

function mockCtx() {
  const toasts: Array<{ kind: string; text: string }> = []
  return {
    toasts,
    ctx: {
      chatId: 'test-chat',
      setText: () => {},
      toast: (kind: any, text: string) => toasts.push({ kind, text }),
    },
  }
}

function makePersonaBtn(): MockElement {
  return new MockElement('button', 'P', {
    title: 'Switch persona',
  })
}

_resetPersonaCacheForTests()

// --- extractPersonaLabel (pure) ---

{
  assert(extractPersonaLabel('Alice') === 'Alice', 'extract: Alice unchanged')
  assert(extractPersonaLabel('JJaime') === 'Jaime', 'extract: JJaime → Jaime')
}

// --- Command metadata ---

{
  const cmd = makePersonaCommand()
  assert(cmd.name === 'persona', 'metadata: name')
  assert(cmd.owner === 'canvas', 'metadata: owner')
  assert(cmd.category === 'chat', 'metadata: category')
  assert(cmd.usage === '/persona', 'metadata: usage')
  assert(typeof cmd.getArgCompletions === 'function', 'metadata: getArgCompletions present')
}

// --- No argument shows usage error ---

{
  const cmd = makePersonaCommand()
  const { toasts, ctx } = mockCtx()
  await cmd.handler({ _raw: '' } as any, ctx)
  assert(toasts.length === 1, 'no-arg: one toast')
  assert(toasts[0]!.kind === 'error', 'no-arg: error toast')
  assert(toasts[0]!.text.includes('Usage'), 'no-arg: usage message')
}

// --- Whitespace-only argument shows usage error ---

{
  const cmd = makePersonaCommand()
  const { toasts, ctx } = mockCtx()
  await cmd.handler({ _raw: '   ' } as any, ctx)
  assert(toasts.length === 1, 'whitespace: one toast')
  assert(toasts[0]!.kind === 'error', 'whitespace: error toast')
}

// --- No persona button found ---

{
  allButtons = []
  const cmd = makePersonaCommand()
  const { toasts, ctx } = mockCtx()
  await cmd.handler({ _raw: 'TestPersona' } as any, ctx)
  assert(toasts.length === 1, 'no-button: one toast')
  assert(toasts[0]!.kind === 'error', 'no-button: error toast')
  assert(toasts[0]!.text.includes('Could not find persona button'), 'no-button: message')
}

// --- Persona found and clicked successfully ---

{
  _resetPersonaCacheForTests()
  const switchBtn = makePersonaBtn()
  const alice = new MockElement('button', 'Alice')
  const bob = new MockElement('button', 'Bob')
  allButtons = [switchBtn, alice, bob]

  // findPersonaItemByName polls requestAnimationFrame; buttons are already in allButtons
  const cmd = makePersonaCommand()
  const { toasts, ctx } = mockCtx()
  await cmd.handler({ _raw: 'Alice' } as any, ctx)
  assert(alice.clicked === true, 'success: Alice was clicked')
  assert(bob.clicked === false, 'success: Bob was NOT clicked')
  assert(toasts.length === 1, 'success: one toast')
  assert(toasts[0]!.kind === 'success', 'success: success toast')
  assert(toasts[0]!.text.includes('Switched to persona: Alice'), 'success: switch message')
}

// --- Case-insensitive matching ---

{
  const switchBtn = makePersonaBtn()
  const alice = new MockElement('button', 'Alice')
  allButtons = [switchBtn, alice]
  const cmd = makePersonaCommand()
  const { toasts, ctx } = mockCtx()
  await cmd.handler({ _raw: 'alice' } as any, ctx)
  assert(alice.clicked === true, 'case: Alice clicked via lowercase input')
  assert(toasts[0]!.kind === 'success', 'case: success toast')
}

// --- Avatar initial prefix match (JJaime) ---

{
  const switchBtn = makePersonaBtn()
  const jaime = new MockElement('button', 'JJaime')
  allButtons = [switchBtn, jaime]
  const cmd = makePersonaCommand()
  const { toasts, ctx } = mockCtx()
  await cmd.handler({ _raw: 'Jaime' } as any, ctx)
  assert(jaime.clicked === true, 'avatar-prefix: JJaime matched Jaime')
  assert(toasts[0]!.kind === 'success', 'avatar-prefix: success')
}

// --- getArgCompletions: empty until warm fills cache ---

{
  _resetPersonaCacheForTests()
  completionEvents.length = 0
  const switchBtn = makePersonaBtn()
  allButtons = [switchBtn]
  const cmd = makePersonaCommand()
  const empty = cmd.getArgCompletions!('', { chatId: 'chat-1' })
  assert(Array.isArray(empty) && empty.length === 0, 'getArgCompletions: empty while cold')
  // warmPersonaCache should have clicked switch button
  assert(switchBtn.clicked === true, 'getArgCompletions: warm clicked persona button')
}

// --- warmPersonaCache scrapes names via MutationObserver ---

{
  _resetPersonaCacheForTests()
  completionEvents.length = 0
  const switchBtn = makePersonaBtn()
  allButtons = [switchBtn]

  warmPersonaCache('chat-2')
  assert(switchBtn.clicked === true, 'warm: clicks persona button')
  assert(moCallback !== null, 'warm: MutationObserver installed')

  // Simulate popover appearing with persona buttons
  const popover = new MockElement('div', '')
  popover.className = 'popover-menu'
  const a = new MockElement('button', 'Alice')
  const j = new MockElement('button', 'JJaime')
  const clear = new MockElement('button', 'Clear persona')
  popover.children = [a, j, clear]

  moCallback!([
    {
      addedNodes: [popover],
    },
  ])

  // Cache should now hold extracted names (Jaime not JJaime; clear excluded)
  const cmd = makePersonaCommand()
  const names = cmd.getArgCompletions!('', { chatId: 'chat-2' })
  assert(names.includes('Alice'), 'warm scrape: Alice')
  assert(names.includes('Jaime'), 'warm scrape: Jaime from JJaime')
  assert(!names.some((n) => n.toLowerCase().includes('clear')), 'warm scrape: clear excluded')
  assert(
    names.filter((n) => n.toLowerCase().startsWith('a')).join(',') ===
      cmd.getArgCompletions!('a', { chatId: 'chat-2' }).join(','),
    'getArgCompletions: prefix filter',
  )
  assert(completionEvents.includes('canvas:slash-completions-changed'), 'warm: dispatches completions-changed')
}

// --- Cleanup ---
_resetPersonaCacheForTests()
;(globalThis as any).document = undefined
;(globalThis as any).requestAnimationFrame = undefined
;(globalThis as any).MutationObserver = undefined
;(globalThis as any).KeyboardEvent = undefined
;(globalThis as any).CustomEvent = undefined
;(globalThis as any).window = undefined

if (failed > 0) { console.error(`FAILED: ${failed}`); throw new Error(`${failed} test failures`) }
console.log(`PASS: ${passed}`)
