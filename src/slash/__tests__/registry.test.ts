import { CommandRegistry } from '../registry'
import type { SlashCommandDef } from '../types'

let passed = 0, failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}

const makeCmd = (name: string, owner = 'test'): SlashCommandDef => ({
  name,
  description: `test command ${name}`,
  owner,
  handler: () => {},
})

const reg = new CommandRegistry()

// Empty
assert(reg.list().length === 0, 'empty registry')

// Register
const unregister = reg.register(makeCmd('foo'))
assert(reg.list().length === 1, 'one command')
assert(reg.lookup('foo')?.name === 'foo', 'lookup works')

// Unregister (cleanup function)
unregister()
assert(reg.list().length === 0, 'unregister removes')

// Re-register overwrites
reg.register(makeCmd('foo', 'a'))
reg.register(makeCmd('foo', 'b'))
assert(reg.list().length === 1, 'duplicate name overwrites (not appends)')
assert(reg.lookup('foo')?.owner === 'b', 'newer registration wins')

// Sorted list
reg.register(makeCmd('zebra'))
reg.register(makeCmd('alpha'))
const names = reg.list().map((c) => c.name)
assert(names[0] === 'alpha' && names[1] === 'foo' && names[2] === 'zebra', 'list is sorted by name')

// Safe unregister: cleanup of an older registration does NOT remove a newer one.
const reg2 = new CommandRegistry()
const oldCleanup = reg2.register(makeCmd('shared', 'old'))
reg2.register(makeCmd('shared', 'new'))
oldCleanup()  // call the OLD cleanup
assert(reg2.lookup('shared')?.owner === 'new', 'old cleanup does not remove newer registration')

if (failed > 0) { console.error(`FAILED: ${failed}`); throw new Error(`${failed} test failures`) }
console.log(`PASS: ${passed}`)
