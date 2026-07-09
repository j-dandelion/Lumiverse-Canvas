// Tests for src/slash/arg-completions.ts — pure arg-mode helpers.
// Uses the repo's custom assertion harness (no Jest/Vitest).

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}

import {
  filterPrefix,
  ghostSuffix,
  parseArgMode,
  pickActive,
} from '../arg-completions'

// --- parseArgMode ---

{
  assert(parseArgMode('') === null, 'empty → null')
  assert(parseArgMode('/') === null, '/ alone → null')
  assert(parseArgMode('/sel') === null, 'no space → null (command-name mode)')
  assert(parseArgMode('/select') === null, 'complete name no space → null')
  assert(parseArgMode('hello /select ') === null, 'no leading slash → null')
}

{
  const r = parseArgMode('/select ')
  assert(r !== null, '/select  → arg mode')
  assert(r!.cmdName === 'select', '/select  : cmdName select')
  assert(r!.argPrefix === '', '/select  : empty argPrefix')
  assert(r!.argStart === '/select '.length, '/select  : argStart at end')
  assert(r!.argEnd === '/select '.length, '/select  : argEnd at end')
}

{
  const r = parseArgMode('/select a')
  assert(r !== null, '/select a → arg mode')
  assert(r!.cmdName === 'select', '/select a: cmdName')
  assert(r!.argPrefix === 'a', '/select a: argPrefix a')
  assert(r!.argStart === '/select '.length, '/select a: argStart after space')
  assert(r!.argEnd === '/select a'.length, '/select a: argEnd at end')
}

{
  const r = parseArgMode('/persona  Chris')
  assert(r !== null, '/persona  Chris → arg mode')
  assert(r!.cmdName === 'persona', 'double space: cmdName persona')
  assert(r!.argPrefix === 'Chris', 'double space: argPrefix strips leading spaces for match text')
  assert(r!.argStart === '/persona  '.length, 'double space: range starts at first non-space')
  assert(r!.argEnd === '/persona  Chris'.length, 'double space: argEnd')
}

{
  const r = parseArgMode('/select all')
  assert(r!.cmdName === 'select', '/select all: cmdName')
  assert(r!.argPrefix === 'all', '/select all: argPrefix')
}

{
  // Command names with hyphens
  const r = parseArgMode('/select-all x')
  assert(r!.cmdName === 'select-all', 'hyphenated cmd name')
  assert(r!.argPrefix === 'x', 'hyphenated cmd arg')
}

// --- filterPrefix ---

{
  const c = ['all', 'clear', 'Alice', 'Bob']
  assert(
    filterPrefix(c, '').join(',') === 'all,clear,Alice,Bob',
    'empty prefix → all candidates',
  )
  assert(
    filterPrefix(c, 'a').join(',') === 'all,Alice',
    'prefix a → all, Alice (case-insensitive)',
  )
  assert(
    filterPrefix(c, 'AL').join(',') === 'all,Alice',
    'prefix AL → case-insensitive',
  )
  assert(
    filterPrefix(c, 'c').join(',') === 'clear',
    'prefix c → clear',
  )
  assert(
    filterPrefix(c, 'z').join(',') === '',
    'prefix z → empty',
  )
  assert(
    filterPrefix(c, 'all').join(',') === 'all',
    'exact prefix match still included',
  )
  // Does not mutate input
  const orig = ['x', 'y']
  filterPrefix(orig, 'x')
  assert(orig.length === 2, 'filterPrefix does not mutate input array')
}

// --- ghostSuffix ---

{
  assert(ghostSuffix('all', 'a') === 'll', 'all / a → ll')
  assert(ghostSuffix('all', '') === 'all', 'empty typed → full as ghost')
  assert(ghostSuffix('all', 'all') === null, 'exact match → null')
  assert(ghostSuffix('all', 'all ') === null, 'typed longer → null (no startsWith)')
  assert(ghostSuffix('Chris', 'ch') === 'ris', 'Chris / ch → ris (ci match, preserve casing)')
  assert(ghostSuffix('Chris', 'CH') === 'ris', 'Chris / CH → ris')
  assert(ghostSuffix('Chris', 'bob') === null, 'no prefix match → null')
  assert(ghostSuffix('clear', 'c') === 'lear', 'clear / c → lear')
  assert(ghostSuffix('Alice', 'ali') === 'ce', 'Alice / ali → ce')
}

// --- pickActive ---

{
  assert(pickActive([], 0) === null, 'empty candidates → null')
  assert(pickActive(['a', 'b'], 0) === 'a', 'index 0')
  assert(pickActive(['a', 'b'], 1) === 'b', 'index 1')
  assert(pickActive(['a', 'b'], -1) === null, 'negative → null')
  assert(pickActive(['a', 'b'], 2) === null, 'out of range → null')
}

if (failed > 0) { console.error(`FAILED: ${failed}`); throw new Error(`${failed} test failures`) }
console.log(`PASS: ${passed}`)
