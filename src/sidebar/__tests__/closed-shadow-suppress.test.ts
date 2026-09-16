// Closed-drawer shadow suppression (2026-09-15).
//
// Both Canvas shells carry an inline `box-shadow: var(--lumiverse-shadow-xl)`
// on `.sidebar-ux-drawer` (drawer-shell.ts). While a shell is closed it is
// translated off-screen (Sides: drawer edge at ~-1px; Top/Bottom: settled
// closed transform), and the 60px shadow spread bleeds into the viewport.
// CSS suppresses it keyed on `data-drawer-open="false"` — a main-mirror bug
// was that the attribute was never updated after mount (secondary did), and
// the suppression rule only matched the secondary wrapper. These are source
// pins so neither regression can return silently.
//
// Custom assertion harness, see src/os/__tests__/start-menu-lifecycle-pins.test.ts.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertIncludes(haystack: string, needle: string, msg: string) {
  if (haystack.includes(needle)) {
    passed++
  } else {
    console.error(`FAIL: ${msg} — expected to find "${needle}"`)
    failed++
  }
}

import { readFileSync } from 'fs'
import { join } from 'path'

const styles = readFileSync(join(process.cwd(), 'src/sidebar/styles.ts'), 'utf8')
const mainMirror = readFileSync(
  join(process.cwd(), 'src/sidebar/main-mirror-drawer.ts'),
  'utf8',
)

// ── 1. Suppression selector covers BOTH shell owners ──
assertIncludes(
  styles,
  '.sidebar-ux-shell[data-drawer-open="false"] > .sidebar-ux-drawer',
  'suppression is keyed on the shared sidebar-ux-shell wrapper class',
)
assert(
  !styles.includes('.sidebar-ux-secondary-wrapper[data-drawer-open="false"]'),
  'the secondary-only selector must not come back (main mirror would lose suppression)',
)
assertIncludes(
  styles,
  'box-shadow: none !important',
  'the suppression must stay !important (it beats the drawer inline shadow)',
)

// ── 2. Main mirror writes data-drawer-open in open AND close ──
{
  const start = mainMirror.indexOf('export function openCanvasMainDrawer')
  assert(start >= 0, 'openCanvasMainDrawer present')
  const body = mainMirror.substring(start, mainMirror.indexOf('\n}', start))
  assertIncludes(body, "dataset.drawerOpen = 'true'", 'open writes data-drawer-open=true')
  // Drift defense: a repeated open() call with the early return still writes.
  const writeAt = body.indexOf("dataset.drawerOpen = 'true'")
  const returnAt = body.indexOf('if (_open)')
  assert(writeAt >= 0 && returnAt > writeAt, 'open writes the attr BEFORE the already-open return')
}
{
  const start = mainMirror.indexOf('export function closeCanvasMainDrawer')
  assert(start >= 0, 'closeCanvasMainDrawer present')
  const body = mainMirror.substring(start, mainMirror.indexOf('\n}', start))
  assertIncludes(body, "dataset.drawerOpen = 'false'", 'close writes data-drawer-open=false')
  const writeAt = body.indexOf("dataset.drawerOpen = 'false'")
  const returnAt = body.indexOf('if (!_open)')
  assert(writeAt >= 0 && returnAt > writeAt, 'close writes the attr BEFORE the already-closed return')
}

// ── 3. Secondary keeps its writers (parity, no accidental removal) ──
{
  const secondary = readFileSync(
    join(process.cwd(), 'src/sidebar/secondary.tsx'),
    'utf8',
  )
  assertIncludes(secondary, "dataset.drawerOpen = 'true'", 'secondary open still writes the attr')
  assertIncludes(secondary, "dataset.drawerOpen = 'false'", 'secondary close still writes the attr')
}

console.log('---')
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
