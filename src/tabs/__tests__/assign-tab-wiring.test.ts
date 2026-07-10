// src/tabs/__tests__/assign-tab-wiring.test.ts
// Pins assignTab secondary path: built-ins go through
// moveBuiltInTabToSecondaryContainer (host requestTabLocation), not raw reparent.
import { readFileSync } from 'fs'
import { join } from 'path'

let passed = 0, failed = 0
const ok = (c: unknown, m: string) =>
  c ? passed++ : (failed++, console.error('FAIL:', m))

const src = readFileSync(
  join(process.cwd(), 'src/tabs/assignment.ts'),
  'utf8',
)
const helperSrc = readFileSync(
  join(process.cwd(), 'src/tabs/builtin-move.ts'),
  'utf8',
)

const secStart = src.indexOf("if (sidebar === 'secondary')")
ok(secStart !== -1, 'T-WIRE-1: assignTab secondary path found')

if (secStart !== -1) {
  const braceStart = src.indexOf('{', secStart)
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

  ok(
    body.includes('moveBuiltInTabToSecondaryContainer'),
    'T-WIRE-1: secondary path uses moveBuiltInTabToSecondaryContainer',
  )
  ok(
    body.includes("requestTabLocation") || helperSrc.includes('requestTabLocation'),
    'T-WIRE-1: host requestTabLocation is used (via helper)',
  )
  // Pre-activation lives in the helper when root is missing.
  ok(
    helperSrc.includes('ensureBuiltInTabActiveInMain'),
    'T-WIRE-1: helper pre-activates via ensureBuiltInTabActiveInMain',
  )
  ok(
    helperSrc.includes('branch=LAZY_MOUNT_OK'),
    'T-WIRE-1: helper retains LAZY_MOUNT_OK path for cold roots',
  )
}

console.log(`assign-tab-wiring: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
