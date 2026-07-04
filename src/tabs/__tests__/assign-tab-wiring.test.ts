// src/tabs/__tests__/assign-tab-wiring.test.ts
import { readFileSync } from 'fs'
import { join } from 'path'

let passed = 0, failed = 0
const ok = (c: unknown, m: string) =>
  c ? passed++ : (failed++, console.error('FAIL:', m))

// T-WIRE-1: ensureBuiltInTabActiveInMain(tabId) must be called inside the
// secondary path of assignTab (guarded by `if (sidebar === 'secondary')`),
// and builtInRoot must be obtained before the `if (builtInRoot && bridge)`
// check that gates the built-in branch.
// This pins the call ordering: pre-activation first (or root reuse), so
// getBuiltInTabRoot returns a real (mounted) root, so the built-in branch
// matches.

const src = readFileSync(
  join(process.cwd(), 'src/tabs/assignment.ts'),
  'utf8',
)

// Find the secondary path: everything between "if (sidebar === 'secondary')" and
// the matching closing brace. Use a brace-counting approach for reliability.
const secStart = src.indexOf("if (sidebar === 'secondary')")
ok(secStart !== -1, 'T-WIRE-1: assignTab secondary path found')

if (secStart !== -1) {
  // Find the opening brace
  const braceStart = src.indexOf('{', secStart)
  // Count braces to find the matching close
  let depth = 0
  let braceEnd = -1
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) { braceEnd = i; break }
    }
  }
  const body = src.slice(secStart, braceEnd + 1)

  const ensureIdx = body.indexOf('ensureBuiltInTabActiveInMain(')
  const builtInGateIdx = body.search(/if\s*\(\s*builtInRoot\s*&&\s*bridge\s*\)/)
  ok(
    ensureIdx !== -1,
    'T-WIRE-1: ensureBuiltInTabActiveInMain is called inside secondary path',
  )
  ok(
    builtInGateIdx !== -1,
    'T-WIRE-1: built-in branch gate is present',
  )
  // ensureBuiltInTabActiveInMain (or builtInRoot assignment) must come before
  // the built-in branch gate so the root is available for the branch.
  const rootObtainIdx = body.indexOf('builtInRoot')
  ok(
    rootObtainIdx !== -1 && builtInGateIdx !== -1 && rootObtainIdx < builtInGateIdx,
    'T-WIRE-1: builtInRoot is obtained before the built-in branch gate',
  )
}

console.log(`assign-tab-wiring: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
