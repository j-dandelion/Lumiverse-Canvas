// src/tabs/__tests__/assign-tab-wiring.test.ts
import { readFileSync } from 'fs'
import { join } from 'path'

let passed = 0, failed = 0
const ok = (c: unknown, m: string) =>
  c ? passed++ : (failed++, console.error('FAIL:', m))

// T-WIRE-1: ensureBuiltInTabActiveInMain(tabId) must be called inside the
// secondary path of assignTab (guarded by `if (sidebar === 'secondary')`),
// and it must run BEFORE the `if (builtInRoot && bridge)` check that gates
// the built-in branch.
// This pins the call ordering: pre-activation first, so getBuiltInTabRoot
// returns a real (mounted) root, so the built-in branch matches.

const src = readFileSync(
  join(process.cwd(), 'src/tabs/assignment.ts'),
  'utf8',
)

const secondaryPath = src.match(
  /if\s*\(\s*sidebar\s*===\s*['"]secondary['"]\s*\)\s*\{[\s\S]*?\n\s*\}/,
)
ok(secondaryPath !== null, 'T-WIRE-1: assignTab secondary path found')

if (secondaryPath) {
  const body = secondaryPath[0]
  const ensureIdx = body.indexOf('ensureBuiltInTabActiveInMain(')
  // Built-in check is `if (builtInRoot && bridge)`. Match that exact
  // opening so we test against the right gate.
  const builtInGateIdx = body.search(/if\s*\(\s*builtInRoot\s*&&\s*bridge\s*\)/)
  ok(
    ensureIdx !== -1,
    'T-WIRE-1: ensureBuiltInTabActiveInMain is called inside secondary path',
  )
  ok(
    builtInGateIdx !== -1,
    'T-WIRE-1: built-in branch gate is present',
  )
  ok(
    ensureIdx !== -1 && builtInGateIdx !== -1 && ensureIdx < builtInGateIdx,
    'T-WIRE-1: ensureBuiltInTabActiveInMain runs BEFORE the built-in branch gate',
  )
}

console.log(`assign-tab-wiring: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
