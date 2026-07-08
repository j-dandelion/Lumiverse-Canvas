// Tests for src/slash/commands/persona/index.ts — /persona DOM interaction.
// Uses the repo's custom assertion harness (no Jest/Vitest).
//
// Bun's test runner does NOT provide browser globals like `document`.
// We mock the DOM to test the handler's logic: container lookup,
// persona item matching, click dispatch, and error cases.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}

// --- DOM mocks ---

/** Minimal HTMLElement mock with textContent and a click tracker. */
class MockElement {
  tag: string
  className = ''
  _textContent: string
  clicked = false
  children: MockElement[] = []
  attrs: Record<string, string> = {}

  constructor(tag: string, text: string, attrs: Record<string, string> = {}) {
    this.tag = tag
    this._textContent = text
    this.attrs = attrs
  }

  get textContent() { return this._textContent }

  click() { this.clicked = true }

  getAttribute(name: string) { return this.attrs[name] ?? null }

  querySelectorAll(_selector: string): MockElement[] {
    // Simple mock: return children whose tag matches a basic pattern
    return this.children.filter((c) => {
      const lower = c.tag.toLowerCase()
      if (_selector === '[role="option"]') return c.attrs['role'] === 'option'
      if (_selector === '[role="menuitem"]') return c.attrs['role'] === 'menuitem'
      if (_selector === '[role="radio"]') return c.attrs['role'] === 'radio'
      if (_selector === 'button') return lower === 'button'
      if (_selector === 'li') return lower === 'li'
      return false
    })
  }
}

// --- Minimal document mock ---

let mockContainer: MockElement | null = null

const mockDocument = {
  querySelector(selector: string): MockElement | null {
    if (!mockContainer) return null
    // Match data-testid, class, or data-component selectors
    if (selector.includes('data-testid') && mockContainer.attrs['data-testid']?.includes('persona')) return mockContainer
    if (selector.includes('class*="persona"') || selector.includes('class*="Persona"')) {
      if (mockContainer.className.toLowerCase().includes('persona')) return mockContainer
    }
    if (selector.includes('data-component') && mockContainer.className.toLowerCase().includes('persona')) return mockContainer
    return null
  },
}

// Global mocks
;(globalThis as any).document = mockDocument
;(globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0)

// --- Import the module under test ---
import { makePersonaCommand } from '../commands/persona/index'

// --- Test helper ---

function mockCtx() {
  const toasts: Array<{ kind: string; text: string }> = []
  return {
    toasts,
    ctx: {
      chatId: 'test',
      setText: () => {},
      toast: (kind: any, text: string) => toasts.push({ kind, text }),
    },
  }
}

// --- Tests ---

// Test 1: No argument shows usage error
{
  const cmd = makePersonaCommand()
  const { toasts, ctx } = mockCtx()
  await cmd.handler({ _raw: '' } as any, ctx)
  assert(toasts.length === 1, 'no-arg: one toast')
  assert(toasts[0].kind === 'error', 'no-arg: error toast')
  assert(toasts[0].text.includes('Usage'), 'no-arg: usage message')
}

// Test 2: Whitespace-only argument shows usage error
{
  const cmd = makePersonaCommand()
  const { toasts, ctx } = mockCtx()
  await cmd.handler({ _raw: '   ' } as any, ctx)
  assert(toasts.length === 1, 'whitespace: one toast')
  assert(toasts[0].kind === 'error', 'whitespace: error toast')
}

// Test 3: No persona container found
{
  mockContainer = null
  const cmd = makePersonaCommand()
  const { toasts, ctx } = mockCtx()
  await cmd.handler({ _raw: 'TestPersona' } as any, ctx)
  assert(toasts.length === 1, 'no-container: one toast')
  assert(toasts[0].kind === 'error', 'no-container: error toast')
  assert(toasts[0].text.includes('Could not find persona picker'), 'no-container: picker not found message')
}

// Test 4: Container found but persona not in it
{
  const container = new MockElement('div', '', { 'data-testid': 'persona-picker' })
  container.className = 'persona-container'
  container.children = [
    new MockElement('button', 'Alice'),
    new MockElement('button', 'Bob'),
  ]
  mockContainer = container

  const cmd = makePersonaCommand()
  const { toasts, ctx } = mockCtx()
  await cmd.handler({ _raw: 'Charlie' } as any, ctx)
  assert(toasts.length === 1, 'not-found: one toast')
  assert(toasts[0].kind === 'error', 'not-found: error toast')
  assert(toasts[0].text.includes('Persona not found: Charlie'), 'not-found: persona not found message')
}

// Test 5: Persona found and clicked successfully
{
  const container = new MockElement('div', '', { 'data-testid': 'persona-picker' })
  container.className = 'persona-container'
  const alice = new MockElement('button', 'Alice')
  const bob = new MockElement('button', 'Bob')
  container.children = [alice, bob]
  mockContainer = container

  const cmd = makePersonaCommand()
  const { toasts, ctx } = mockCtx()
  await cmd.handler({ _raw: 'Alice' } as any, ctx)
  assert(alice.clicked === true, 'success: Alice was clicked')
  assert(bob.clicked === false, 'success: Bob was NOT clicked')
  assert(toasts.length === 1, 'success: one toast')
  assert(toasts[0].kind === 'success', 'success: success toast')
  assert(toasts[0].text.includes('Switched to persona: Alice'), 'success: switch message')
}

// Test 6: Case-insensitive matching
{
  const container = new MockElement('div', '', { 'data-testid': 'persona-picker' })
  container.className = 'persona-container'
  const alice = new MockElement('button', 'Alice')
  container.children = [alice]
  mockContainer = container

  const cmd = makePersonaCommand()
  const { toasts, ctx } = mockCtx()
  await cmd.handler({ _raw: 'alice' } as any, ctx)
  assert(alice.clicked === true, 'case: Alice clicked via lowercase input')
  assert(toasts[0].kind === 'success', 'case: success toast')
}

// Test 7: Matches persona with extra whitespace
{
  const container = new MockElement('div', '', { 'data-testid': 'persona-picker' })
  container.className = 'persona-container'
  const alice = new MockElement('button', '  Alice  ')
  container.children = [alice]
  mockContainer = container

  const cmd = makePersonaCommand()
  const { toasts, ctx } = mockCtx()
  await cmd.handler({ _raw: 'Alice' } as any, ctx)
  assert(alice.clicked === true, 'whitespace-texture: Alice clicked despite extra whitespace in text')
  assert(toasts[0].kind === 'success', 'whitespace-texture: success toast')
}

// Test 8: Matches role="option" persona item
{
  const container = new MockElement('div', '', { 'data-testid': 'persona-picker' })
  container.className = 'persona-container'
  const item = new MockElement('span', 'SpecialPersona', { role: 'option' })
  container.children = [item]
  mockContainer = container

  const cmd = makePersonaCommand()
  const { toasts, ctx } = mockCtx()
  await cmd.handler({ _raw: 'SpecialPersona' } as any, ctx)
  assert(item.clicked === true, 'role-option: role=option item clicked')
  assert(toasts[0].kind === 'success', 'role-option: success toast')
}

// Test 9: Command metadata
{
  const cmd = makePersonaCommand()
  assert(cmd.name === 'persona', 'metadata: name')
  assert(cmd.owner === 'canvas', 'metadata: owner')
  assert(cmd.category === 'chat', 'metadata: category')
  assert(cmd.usage === '/persona <name>', 'metadata: usage')
}

// --- Cleanup ---
;(globalThis as any).document = undefined
;(globalThis as any).requestAnimationFrame = undefined

if (failed > 0) { console.error(`FAILED: ${failed}`); throw new Error(`${failed} test failures`) }
console.log(`PASS: ${passed}`)
