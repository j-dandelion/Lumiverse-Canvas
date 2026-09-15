// Header-close policy seam (os/header-close.ts). The Canvas shells ask the
// OS policy whether the panel-header X belongs to OS mode; a false result
// means the caller runs its plain drawer close. The seam is a leaf module so
// the shells can import it without closing the dispatch cycle.
//
// Leaf contract: no runtime imports (only `import type`).

import { readFileSync } from 'fs'
import { join } from 'path'
import { setPanelHeaderCloseHandler, handlePanelHeaderClose } from '../header-close'

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    console.error(`FAIL: ${message} — expected ${String(expected)}, got ${String(actual)}`)
    failed++
  } else {
    passed++
  }
}

// 1. No handler installed (OS off / chrome unmounted) → caller falls back.
assertEqual(handlePanelHeaderClose('primary'), false, 'no handler → false')

// 2. Installed handler result flows through and receives the side.
let seenSide: string | null = null
setPanelHeaderCloseHandler((side) => { seenSide = side; return true })
assertEqual(handlePanelHeaderClose('secondary'), true, 'handler true → true')
assertEqual(seenSide, 'secondary', 'handler receives the requested side')

// 3. Handler can decline (no displayed window) → caller falls back.
setPanelHeaderCloseHandler(() => false)
assertEqual(handlePanelHeaderClose('primary'), false, 'handler false → false')

// 4. Cleared handler → false.
setPanelHeaderCloseHandler(null)
assertEqual(handlePanelHeaderClose('primary'), false, 'cleared handler → false')

// 5. A throwing handler must never break the X click — degrade to fallback.
setPanelHeaderCloseHandler(() => { throw new Error('policy boom') })
assertEqual(handlePanelHeaderClose('primary'), false, 'throwing handler → false (fallback safe)')
setPanelHeaderCloseHandler(null)

// 6. Leaf contract: no runtime imports (an os/actions or dispatch import
// would close the shell → dispatch → active-tab → shell cycle).
{
  const src = readFileSync(join(process.cwd(), 'src/os/header-close.ts'), 'utf8')
  const runtimeImports = src
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('import ') && !l.startsWith('import type '))
  assertEqual(runtimeImports.length, 0, `header-close must stay runtime-import-free (found: ${runtimeImports.join(' | ')})`)
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
