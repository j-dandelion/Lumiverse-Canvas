// Custom assertion harness — see Chronicle testing-conventions.md
let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}

import { parseCommand } from '../parse'

// Slash prefix required
assert(parseCommand('hello') === null, 'no slash → null')
assert(parseCommand('') === null, 'empty → null')
assert(parseCommand('  /help') === null, 'leading whitespace → null')

// Basic command
const p1 = parseCommand('/help')
assert(p1 !== null, '/help parses')
assert(p1?.name === 'help', 'name=help')
assert(p1?.args === '', 'no args')

// Command with args
const p2 = parseCommand('/select 25-100')
assert(p2?.name === 'select', 'name=select')
assert(p2?.args === '25-100', 'args=25-100')

// Command with quoted args
const p3 = parseCommand('/theme "iceberg dark"')
assert(p3?.name === 'theme', 'name=theme')
assert(p3?.args === '"iceberg dark"', 'args preserve quotes')

// Edge: just a slash
assert(parseCommand('/') === null, 'just / → null')

// Edge: slash with whitespace inside (not at start) — the parser
// only matches at the very beginning. Mid-text slashes are passed through.
assert(parseCommand('hello /world') === null, 'mid-text slash → null')

// Prefix-matching rule: must be standalone, not part of a word.
// The parser returns the name as-is; the /select handler decides
// whether /select25 is /select with arg 25 or a different command.
assert(parseCommand('/selecting')?.name === 'selecting', 'word /selecting parses as a different command')
assert(parseCommand('/select25-30')?.name === 'select25-30', '/select25-30 is a different command name (NOT select)')

if (failed > 0) { console.error(`FAILED: ${failed}`); throw new Error(`${failed} test failures`) }
console.log(`PASS: ${passed}`)
