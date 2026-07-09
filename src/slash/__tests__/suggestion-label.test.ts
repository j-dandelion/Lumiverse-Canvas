// Tests for suggestionLabel in src/slash/dom-utils.ts

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}

import { suggestionLabel } from '../dom-utils'
import { extractPersonaLabel } from '../commands/persona/index'

// --- suggestionLabel ---

{
  assert(
    suggestionLabel({ name: 'select', usage: '/select' }) === '/select',
    'bare usage without space → usage',
  )
  assert(
    suggestionLabel({ name: 'select-all', usage: '/select-all' }) === '/select-all',
    'hyphenated usage → usage',
  )
  assert(
    suggestionLabel({ name: 'select-clear', usage: '/select-clear' }) === '/select-clear',
    'select-clear hyphenated usage → usage',
  )
  assert(
    suggestionLabel({ name: 'foo', usage: '/foo bar' }) === '/foo bar',
    'concrete multi-token usage preferred over /name',
  )
  assert(
    suggestionLabel({ name: 'select', usage: '/select <range>' }) === '/select',
    'placeholder usage falls back to /name',
  )
  assert(
    suggestionLabel({ name: 'persona', usage: '/persona <name>' }) === '/persona',
    'persona placeholder → /persona',
  )
  assert(
    suggestionLabel({ name: 'Chris', usage: '/persona Chris' }) === '/persona Chris',
    'arg-mode synthetic row uses full usage',
  )
  assert(
    suggestionLabel({ name: 'help' }) === '/help',
    'missing usage → /name',
  )
  assert(
    suggestionLabel({ name: 'foo', usage: '  foo bar  ' }) === '/foo bar',
    'usage without leading slash gets / prepended',
  )
  assert(
    suggestionLabel({ name: 'x', usage: '/cmd <a> <b>' }) === '/x',
    'any <> placeholder → fall back to name',
  )
}

// --- extractPersonaLabel ---

{
  assert(extractPersonaLabel('Alice') === 'Alice', 'Alice: no strip (A !== l)')
  assert(extractPersonaLabel('JJaime') === 'Jaime', 'JJaime → Jaime')
  assert(extractPersonaLabel('jjaime') === 'jaime', 'jjaime → jaime (ci)')
  assert(extractPersonaLabel('  Bob  ') === 'Bob', 'trim whitespace')
  assert(extractPersonaLabel('') === '', 'empty')
  assert(extractPersonaLabel('A') === 'A', 'single char')
  assert(extractPersonaLabel('BBob') === 'Bob', 'BBob → Bob')
}

if (failed > 0) { console.error(`FAILED: ${failed}`); throw new Error(`${failed} test failures`) }
console.log(`PASS: ${passed}`)
