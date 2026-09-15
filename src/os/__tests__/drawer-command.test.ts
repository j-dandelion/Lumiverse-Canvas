// Drawer command seam (os/drawer-command.ts). Primary-drawer open/close is
// shell-owned (the model→host setDrawer write is suppressed while the Canvas
// mirror owns the surface), so OS actions command the shell through this
// leaf. No handler → false so callers rely on the model→host path (secondary
// drawer, or no mirror mounted).
//
// Leaf contract: no runtime imports.

import { readFileSync } from 'fs'
import { join } from 'path'
import { setDrawerCommandHandler, commandDrawerOpen } from '../drawer-command'

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

// 1. No handler (secondary / no shell) → not handled.
assertEqual(commandDrawerOpen('primary', false), false, 'no handler → false')

// 2. Installed handler receives (side, open) and its result flows through.
let seenSide: string | null = null
let seenOpen: boolean | null = null
setDrawerCommandHandler((side, open) => { seenSide = side; seenOpen = open; return true })
assertEqual(commandDrawerOpen('primary', false), true, 'handler true → true')
assertEqual(seenSide, 'primary', 'handler receives the side')
assertEqual(seenOpen, false, 'handler receives the open flag')

// 3. Declining handler (not my side) → false; caller falls back.
setDrawerCommandHandler(() => false)
assertEqual(commandDrawerOpen('secondary', true), false, 'declining handler → false')

// 4. Cleared handler → false.
setDrawerCommandHandler(null)
assertEqual(commandDrawerOpen('primary', true), false, 'cleared handler → false')

// 5. A throwing handler degrades to false (never breaks the action).
setDrawerCommandHandler(() => { throw new Error('handler boom') })
assertEqual(commandDrawerOpen('primary', false), false, 'throwing handler → false')
setDrawerCommandHandler(null)

// 6. Leaf contract.
{
  const src = readFileSync(join(process.cwd(), 'src/os/drawer-command.ts'), 'utf8')
  const runtimeImports = src
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('import ') && !l.startsWith('import type '))
  assertEqual(runtimeImports.length, 0, `drawer-command must stay runtime-import-free (found: ${runtimeImports.join(' | ')})`)
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
